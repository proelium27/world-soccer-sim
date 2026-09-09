import type { Player } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { PlayedMatch } from "../standings.js";
import type { CompletedTransfer } from "../transfers/negotiation.js";
import type { TransferWindowKind } from "../transfers/window.js";
import type { Competition } from "../competitions.js";
import type { ActiveLoan } from "../loans.js";
import { deriveLeagueContexts } from "./clubContext.js";
import { keepValueToClub, perceivedValueToClub, hasPositionalGap } from "./evaluate.js";
import { moveAppealBetween, settledMultiplier, joinedSeasons } from "../transfers/playerWill.js";
import { movedThisWindow } from "../transfers/negotiation.js";
import { trueTransferValue } from "../finance/valuation.js";
import { clampBudget, financeScale, financeScaleFor } from "../finance/budget.js";
import { tierOf } from "../competitions.js";
import { keepsDepthFloor } from "../freeAgency.js";
import { mulberry32 } from "../../engine/rng.js";
import {
  ROSTER_CAP, ROSTER_SAFETY_FLOOR,
  AI_MARKET_MIN_VALUE, AI_MARKET_MIN_SURPLUS,
  AI_MARKET_FEE_SHARE, AI_MARKET_FEE_FLOOR_FRACTION,
  AI_MARKET_MAX_BUYS, AI_MARKET_MAX_SELLS,
  AI_MARKET_RESERVE_FRACTION_MIN, AI_MARKET_RESERVE_FRACTION_MAX,
  AI_NEED_BUY_MIN_SURPLUS, AI_NEED_BUY_RESERVE_RELIEF,
  divisionRefusalOvr,
} from "../constants.js";
import type { Difficulty } from "../constants.js";
import type { TransferClause } from "../transfers/clauses.js";
import { settleClausesOnSale } from "../transfers/clauses.js";

export interface AITransferResult {
  teams: StoredTeam[];
  transfers: CompletedTransfer[];
  /**
   * Contingent obligations after the window, with any this market's sales
   * triggered already settled and removed. Echoes back what was passed in when
   * no clause context is supplied, so a caller that doesn't care is unaffected.
   */
  clauses: TransferClause[];
}

/**
 * The clause state an AI↔AI window needs, passed as one optional object.
 *
 * Optional because this function has a dozen call sites across tests and
 * probes and none of them should have to care — absent means no clauses exist,
 * which is byte-identical to the market before the feature. Same reason
 * `simOffseason` took its precomputed aggregate as an optional trailing param.
 *
 * `difficulty` rides along because a sell-on can pay the USER (he sold a player
 * to an AI club, which is now selling him on), and every site where the user's
 * budget rises must scale through `financeScaleFor` rather than `financeScale`
 * — see the invariant stated on that function.
 */
export interface ClauseContext {
  clauses: TransferClause[];
  difficulty: Difficulty | undefined;
}

/** One evaluation-driven deal the market has decided is worth executing. */
interface Candidate {
  pid: number;
  sellerTid: number;
  buyerTid: number;
  /** Seller's keep-value (valueToClub to the current club) — the floor on the fee. */
  reservation: number;
  /** Buyer's (jittered) valuation — the ceiling on the fee. */
  buyerValue: number;
  /** Club-agnostic true market value — the anchor for AI_MARKET_FEE_FLOOR_FRACTION. */
  market: number;
  /** buyerValue − reservation: how much more useful he is to the buyer. */
  surplus: number;
  /** Buyer has a real positional gap here → relaxed surplus bar + deeper reserve draw. */
  needBuy: boolean;
}

/**
 * Run one round of AI↔AI transfers for an open window. The user's club
 * (`userTid`) never buys or sells — inbound offers for the user's players are
 * a later phase. Only rosters and budgets change (a player's contract travels
 * with him untouched), plus one CompletedTransfer logged per deal; the
 * `players` array is returned to the caller unchanged.
 *
 * The whole market is a single comparison applied everywhere: a player's
 * reservation price is his value to his *current* club, and he moves to
 * whichever other club values him enough more to clear that reservation and
 * afford the fee. Surplus dumping, sell-at-peak, and needs-based buying all
 * fall out of that — no scripted "if rebuilding…" branches.
 *
 * Determinism: valuations are taken as a snapshot at window open (contexts
 * are not recomputed between deals in the same window), deals execute in
 * descending-surplus order, and the only randomness is a seeded per-buyer
 * valuation jitter. Budgets, roster room, per-club move caps, and the
 * seller's positional depth floor are all enforced live as deals execute.
 *
 * @param season  the season the acquired squads will play (age/valuation basis)
 * @param played  results so far this season, for the clubs' form context
 * @param phase   "regular" charges the buyer the player's season wage on top
 *                of the fee (mid-season signings are paid up front); in the
 *                offseason the upcoming season-start charge covers wages.
 * @param protectedPids  pids that are off the market entirely this window — a
 *                top club's stars from a big season, never sold at any price
 *                (see core/transfers/protectedStars.ts).
 */
export function runAITransferMarket(
  teams: StoredTeam[],
  players: Player[],
  activeLoans: ActiveLoan[],
  transfers: CompletedTransfer[],
  season: number,
  played: PlayedMatch[],
  window: TransferWindowKind,
  phase: "regular" | "offseason",
  userTid: number,
  seed: number,
  competitions: Competition[],
  protectedPids: Set<number>,
  clauseCtx?: ClauseContext,
): AITransferResult {
  let clauses = clauseCtx?.clauses ?? [];
  const contexts = deriveLeagueContexts({ teams, players, season, played, competitions });
  const playerMap = new Map(players.map((p) => [p.pid, p]));
  const jitter = mulberry32(seed);
  const tierByTid = new Map(teams.map((t) => [t.tid, tierOf(competitions, t.compId)]));

  // A player physically playing for a club on loan sits on that club's roster
  // but is still owned by his parent — the loanee must never be able to sell
  // him permanently, or processLoanReturns would later hand a copy back to the
  // parent and the same pid would end up on two rosters at once. Skip anyone
  // currently out on loan (keyed by pid, so this holds whoever the parent is).
  const onLoanPids = new Set(activeLoans.map((l) => l.pid));

  // When each player last arrived somewhere, for the settling-in premium on his
  // reservation. Derived from the transfer log, so no persisted field and no
  // migration; a player with no record has never moved and is fully settled.
  const joined = joinedSeasons(transfers);

  // Assemble every deal that looks worthwhile at window open. Valuations are
  // read from this snapshot; live roster/budget state is applied later.
  const candidates: Candidate[] = [];
  for (const seller of teams) {
    if (seller.tid === userTid) continue;
    const sellerCtx = contexts.get(seller.tid);
    if (!sellerCtx) continue;

    for (const pid of seller.roster) {
      if (onLoanPids.has(pid)) continue;
      // A top club's star from a big season isn't for sale to anyone, AI clubs
      // included — his club simply won't part with him (see protectedStars.ts).
      if (protectedPids.has(pid)) continue;
      const player = playerMap.get(pid);
      if (!player) continue;

      const market = trueTransferValue(player, season);
      if (market < AI_MARKET_MIN_VALUE) continue;

      // Reservation = what it would take to prise the player away from his
      // current club (keep-side valuation — see ValuationSide), scaled up if he
      // has only just arrived and hasn't settled.
      //
      // Every player his club would rather keep is priced, not excluded. There
      // used to be an AI_MARKET_AVAILABILITY pre-filter here that skipped anyone
      // whose reservation exceeded his open-market value, but that compares two
      // things which are not commensurable — a club-relative keep value against
      // a club-blind market price — and keep-side valuation is *built* to exceed
      // market for a club's own best player. Measured: of 239 clubs, the number
      // whose best player could ever be offered was **zero** — the screen was an
      // absolute exclusion, not a preference. That shut off the upward drain of
      // talent and inverted the league strength ladder outright
      // (docs/transfer-mobility.md). What it was meant to protect — "don't let a
      // rich rival walk off with our irreplaceable core player" — is exactly
      // what the reservation now expresses, enforced below by requiring a buyer
      // to clear it by AI_MARKET_MIN_SURPLUS. Protection by price, not by veto.
      //
      // Cost of removing it: this was also the only early-out ahead of the
      // O(teams) buyer loop, so one market run goes ~52ms -> ~357ms on a
      // 320-club world (scripts/marketTiming.ts). It runs in the sim worker, so
      // it doesn't block paint. A replacement prune must bound the *best
      // possible buyer valuation* against the reservation — anything comparing
      // to club-blind market value reintroduces exactly this bug.
      //
      // (Division 2's strength ceiling is enforced separately and
      // deterministically — see enforceDivisionCeilings — so this market
      // doesn't need any Division-2-specific carve-out of its own.)
      const reservation =
        keepValueToClub(player, sellerCtx) * settledMultiplier(joined.get(pid), season);

      for (const buyer of teams) {
        if (buyer.tid === seller.tid || buyer.tid === userTid) continue;
        const buyerCtx = contexts.get(buyer.tid);
        if (!buyerCtx) continue;

        const rawJittered = perceivedValueToClub(player, buyerCtx, jitter);
        // The player's own say. Applied AFTER the jitter draw, like the
        // Division 2 guard below, so filtering a buyer out can never shift the
        // next buyer's draw (see the documented RNG-stream-order lesson).
        // A club materially smaller than the one he's at gets scaled toward
        // zero here and simply never clears the reservation — this is what
        // stops world-class players pouring downhill into weak clubs.
        const jittered = rawJittered * moveAppealBetween(player, sellerCtx, buyerCtx);
        // A club below the top flight never buys a player at or above its own
        // tier's ceiling threshold — the ceiling sweep would just confiscate
        // him straight back up the same offseason (summer) or he'd sit
        // illegally below the line for half a season (winter). Prevention
        // beats correction: a 15-season audit found 44% of all sweep moves
        // were players this market had sold into Division 2 that same
        // window. Guard placed AFTER the jitter draw — skipping the draw
        // for filtered buyers would shift every subsequent buyer's jitter
        // (see the documented RNG-stream-order lesson).
        //
        // Reads `divisionRefusalOvr(tier)`, which answers Infinity at tier 1,
        // rather than testing for tier 2 against the tier-2 constant. It was
        // written the second way when two divisions were all there were, and
        // was the one buy path left behind when third divisions landed (#308)
        // — `inboundOffers` and `runAILoanMarket` were both generalized then.
        // The gap was not cosmetic: it left tier-3 buyers entirely unguarded,
        // so the market sold over-ceiling players into third divisions all
        // summer and the post-market sweep hauled them back up, which is where
        // most of the game's move-twice-in-one-window chains came from.
        if (
          player.ovr >= divisionRefusalOvr(tierByTid.get(buyer.tid) ?? 1)
        ) continue;
        // A club filling a genuine positional gap doesn't hold out for the usual
        // bargain margin — it'll pay a fair price (down to the seller's full
        // reservation) to address a real hole. Everything else about the deal
        // (fee floor, affordability, reserve) still applies.
        //
        // NOTE (2026-08-11): AI_NEED_BUY_MIN_SURPLUS is 0, so a need buy clears
        // at the seller's bare reservation with no margin at all. That was
        // written when the availability screen above kept a club's best players
        // out of this loop entirely; they now reach it, so a buyer with a hole
        // can take a seller's best man on a favourable scouting-noise draw
        // alone. moveAppealBetween still damps a step down, and the measured
        // effect is contained and stable: moves to a weaker squad run 5-8%
        // across four seeds, against 3% before this change and 17% before the
        // rework. The real gap it exposes is that the market models the buyer's
        // urgency (this path) with no mirror for the seller's — a club under no
        // pressure to sell cannot express that, so it accepts a bare
        // reservation. A need-to-sell term is the principled fix; flooring this
        // above 0 is the patch. See docs/transfer-mobility.md.
        const needBuy = hasPositionalGap(player, buyerCtx);
        const minSurplus = needBuy ? AI_NEED_BUY_MIN_SURPLUS : AI_MARKET_MIN_SURPLUS;
        if (jittered < reservation * (1 + minSurplus)) continue;

        candidates.push({
          pid,
          sellerTid: seller.tid,
          buyerTid: buyer.tid,
          reservation,
          buyerValue: jittered,
          market,
          surplus: jittered - reservation,
          needBuy,
        });
      }
    }
  }

  // Best (most mutually beneficial) deals first; deterministic tie-break.
  candidates.sort(
    (a, b) => b.surplus - a.surplus || a.pid - b.pid || a.buyerTid - b.buyerTid,
  );

  // Live mutable state.
  const roster = new Map(teams.map((t) => [t.tid, [...t.roster]]));
  const budget = new Map(teams.map((t) => [t.tid, t.budget]));
  const hypeByTid = new Map(teams.map((t) => [t.tid, t.hype]));
  const buys = new Map<number, number>();
  const sells = new Map<number, number>();
  // One move per player per window. Seeded from anything already logged for
  // this window rather than starting empty, because this run is not the whole
  // window: `enforceDivisionCeilings` moves players immediately before and
  // after it, and the user trades in the same window afterwards. Without the
  // seed a player swept up a division in the morning could be sold on in the
  // afternoon (see movedThisWindow for the measurements).
  //
  // Seeded here rather than filtered out of the candidate loop above, and that
  // placement is load-bearing: every jitter draw happens while candidates are
  // assembled, so skipping a player up there would shift the draws for every
  // player after him (the RNG-stream-order rule). By the time this set is
  // read, all randomness is already spent.
  const moved = movedThisWindow(transfers, season, window);
  const executed: CompletedTransfer[] = [];

  for (const c of candidates) {
    if (moved.has(c.pid)) continue;
    if ((buys.get(c.buyerTid) ?? 0) >= AI_MARKET_MAX_BUYS) continue;
    if ((sells.get(c.sellerTid) ?? 0) >= AI_MARKET_MAX_SELLS) continue;

    const buyerRoster = roster.get(c.buyerTid)!;
    if (buyerRoster.length >= ROSTER_CAP) continue;

    // Re-check the seller's depth floor against the live roster (an earlier
    // sale this window may have already thinned this position).
    const sellerRoster = roster.get(c.sellerTid)!;
    if (!sellerRoster.includes(c.pid)) continue;
    if (!keepsDepthFloor({ ...teams.find((t) => t.tid === c.sellerTid)!, roster: sellerRoster }, playerMap, c.pid)) {
      continue;
    }
    // keepsDepthFloor only protects the sold player's own position — a club
    // can still sell AI_MARKET_MAX_SELLS players across several different
    // well-stocked positions and end up dangerously thin overall (a real
    // 22-team dynasty audit caught a club dropping to 19 total this way).
    // Guard the whole-roster floor too, same bar as the user's own academy
    // emergency call-up (ROSTER_SAFETY_FLOOR).
    if (sellerRoster.length <= ROSTER_SAFETY_FLOOR) continue;

    // The seller's reservation can be crushed well below true value by a bad
    // need/timeline/affordability fit; require the buyer to actually value
    // him at a reasonable fraction of true market value before the deal
    // executes, and floor the fee there too, so a lowballed seller can't be
    // flipped for many times the fee he was just sold for.
    const feeFloor = Math.round(AI_MARKET_FEE_FLOOR_FRACTION * c.market);
    if (c.buyerValue < feeFloor) continue;

    const player = playerMap.get(c.pid)!;
    const wageCharge = phase === "regular" ? player.contract.salary : 0;
    let fee = Math.max(
      feeFloor,
      Math.round(c.reservation + AI_MARKET_FEE_SHARE * (c.buyerValue - c.reservation)),
    );

    // A club spends only the surplus above its cash reserve (never its whole
    // budget), and covers any mid-season wage charge on top. The reserve
    // fraction rises with frugality — cautious/poorer clubs hold more back.
    // Measured against the live budget, so selling first frees up spend. A need
    // buy frees up part of that frugality premium (AI_NEED_BUY_RESERVE_RELIEF) —
    // a club filling a real hole digs deeper into its cash — but never below the
    // MIN reserve, so no club empties its vault or risks a deficit.
    const frugality = contexts.get(c.buyerTid)?.frugality ?? 0.5;
    const frugalityPremium =
      frugality * (AI_MARKET_RESERVE_FRACTION_MAX - AI_MARKET_RESERVE_FRACTION_MIN);
    const reserveFraction =
      AI_MARKET_RESERVE_FRACTION_MIN +
      frugalityPremium * (c.needBuy ? 1 - AI_NEED_BUY_RESERVE_RELIEF : 1);
    const spendable = (budget.get(c.buyerTid) ?? 0) * (1 - reserveFraction);

    // A fee squeezed down to the seller's reservation is still an acceptable
    // deal, but below it isn't (and neither is one the reserve won't cover).
    const affordableFee = spendable - wageCharge;
    if (affordableFee < fee) fee = affordableFee;
    if (fee < c.reservation) continue;

    // Execute: rosters swap, fee moves buyer→seller, buyer also eats any
    // mid-season wage charge. Money is conserved between the two clubs.
    roster.set(c.sellerTid, sellerRoster.filter((p) => p !== c.pid));
    buyerRoster.push(c.pid);
    const sellerCompId = teams.find((t) => t.tid === c.sellerTid)!.compId;
    // Any sell-on the seller still owes on this player fires here, exactly as
    // it does on a deal the user negotiates — that is the entire point of the
    // clause, since the club that bought him will usually be an AI one and its
    // resale is an AI↔AI deal. Same shared settlement function, so the two
    // paths cannot disagree about who gets paid.
    const settled = settleClausesOnSale(clauses, c.pid, c.sellerTid, fee, season);
    clauses = settled.remaining;
    const owed = settled.payouts.reduce((sum, p) => sum + p.amount, 0);
    budget.set(c.sellerTid, clampBudget((budget.get(c.sellerTid) ?? 0) + fee - owed, financeScale(competitions, sellerCompId), hypeByTid.get(c.sellerTid) ?? 0));
    budget.set(c.buyerTid, (budget.get(c.buyerTid) ?? 0) - fee - wageCharge);
    for (const p of settled.payouts) {
      const beneficiary = teams.find((t) => t.tid === p.toTid);
      if (!beneficiary) continue;
      budget.set(p.toTid, clampBudget(
        (budget.get(p.toTid) ?? 0) + p.amount,
        financeScaleFor(competitions, beneficiary.compId, p.toTid, userTid, clauseCtx?.difficulty),
        hypeByTid.get(p.toTid) ?? 0,
      ));
    }
    moved.add(c.pid);
    buys.set(c.buyerTid, (buys.get(c.buyerTid) ?? 0) + 1);
    sells.set(c.sellerTid, (sells.get(c.sellerTid) ?? 0) + 1);
    executed.push({ pid: c.pid, fromTid: c.sellerTid, toTid: c.buyerTid, fee, season, window });
  }

  return {
    teams: teams.map((t) => ({ ...t, roster: roster.get(t.tid)!, budget: budget.get(t.tid)! })),
    transfers: [...transfers, ...executed],
    clauses,
  };
}
