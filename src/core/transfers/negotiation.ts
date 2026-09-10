import type { Player } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { LeagueStore } from "../leagueState.js";
import type { TransferWindowKind } from "./window.js";
import type { Competition } from "../competitions.js";
import { transferWindowState } from "./window.js";
import { trueTransferValue, perceivedTransferValue } from "../finance/valuation.js";
import { clampBudget, financeScaleFor } from "../finance/budget.js";
import { mulberry32 } from "../../engine/rng.js";
import { keepsDepthFloor } from "../freeAgency.js";
import { wouldRefuseExtension } from "../ai/breakoutRefusal.js";
import { isProtectedStar, lastCompletedSeason, userProtectedStarBar } from "./protectedStars.js";
import { refusesMoveToClub } from "./playerWill.js";
import type { ProposedClause } from "./clauses.js";
import {
  settleClausesOnSale, materializeClauses, clauseExpectedValue, clausesAreValid,
} from "./clauses.js";
import {
  difficultyProfile,
  ROSTER_CAP, MAX_TRANSFER_VALUE,
  RESERVATION_FACTOR_MIN, RESERVATION_FACTOR_MAX,
  NEGOTIATION_LOWBALL_FACTOR, NEGOTIATION_MAX_ROUNDS,
  COUNTER_PADDING_START, COUNTER_PADDING_DECAY,
} from "../constants.js";
import { spendPolicy, affordable } from "../finance/debt.js";

/** One user↔club transfer talk over a player, scoped to a single window. */
export interface TransferNegotiation {
  pid: number;
  sellerTid: number;
  /** The window's season identity (TransferWindowState.season), not necessarily league.season. */
  season: number;
  window: TransferWindowKind;
  /** User offer history, most recent last. */
  offers: number[];
  /** The seller's current counter-offer — an amount they will accept right now. */
  counter: number | null;
  /** "collapsed" = the club has ended talks for the rest of the window. */
  status: "open" | "accepted" | "collapsed";
}

/**
 * Sentinel "club" on the from-side of a free-agent signing: nobody owned him,
 * so there's no real tid to name (and -1 can never collide with one). A free
 * signing is recorded as a fee-0 transfer FROM this sentinel so the profile's
 * club-by-season history (and the OVR chart, champion attribution, News Feed)
 * sees every arrival — without a record, a player who joined a club on a free
 * was silently attributed to whatever club his last *paid* move landed him at.
 * UI that renders a tid must map this to "Free agent" — use `clubDisplayName`
 * (src/ui/format.ts) rather than hand-rolling the check.
 *
 * Deliberately one-sided: *departures* into free agency (expiring contracts,
 * roster trims) are NOT recorded. They'd roughly double an already-append-only
 * log for no display gain, since every surface here answers "which club did he
 * belong to in season N", and a release leaves that answer unchanged until his
 * next arrival. The one case where the missing counter-record would lie — a
 * club signing a free agent and then cutting him in the same offseason, so his
 * history claims a club he never played for — is filtered out at the source in
 * offseason.ts instead.
 */
export const FREE_AGENT_TID = -1;

/** True if a transfer's from/to side is the free-agent sentinel, not a club. */
export function isFreeAgentTid(tid: number): boolean {
  return tid === FREE_AGENT_TID;
}

export interface CompletedTransfer {
  pid: number;
  fromTid: number;
  toTid: number;
  fee: number;
  season: number;
  window: TransferWindowKind;
  /** Present for a loan move; the agreed duration in seasons. Absent = a permanent transfer. */
  loanSeasons?: number;
  /** True when a loaned player returns to his parent club at loan end (fee is always 0). */
  loanReturn?: boolean;
}

/**
 * True if the team has room under ROSTER_CAP to add another player.
 */
export function hasRosterRoom(team: StoredTeam): boolean {
  return team.roster.length < ROSTER_CAP;
}

/**
 * Pids that have already changed clubs permanently in the given window.
 *
 * A player moves at most once per window: once a club has bought him he is
 * theirs until it shuts. Football has no mid-window resale market the way the
 * North American leagues trade, and without the rule a club can buy cheap and
 * sell on at many times the fee inside one window — a windfall to a middleman
 * for holding a player for zero matchdays. Measured before this existed
 * (scripts/windowDoubleMoveProbe.ts, seed 1): ~3-4% of a summer window's deals
 * were second legs, growing season on season, with single chains running
 * $7.1M -> $113.3M.
 *
 * `AI_MARKET_FEE_FLOOR_FRACTION` is the existing defence against exactly that
 * flip and cannot cover this on its own, which is why the bug survived: it
 * bounds one deal's fee against the player's own market value, while the two
 * legs of a chain come from *different mechanisms* (the division-ceiling sweep
 * and the AI market, which run either side of each other in the offseason), so
 * neither leg ever sees the other's fee. The AI market's internal `moved` set
 * has the same blind spot — it only spans one run of one function.
 *
 * Two kinds of move are deliberately not counted:
 *
 *  - **Free-agent arrivals**, logged from the FREE_AGENT_TID sentinel rather
 *    than from a club. They already carry a stronger hold of their own
 *    (`faTransferLocked`, a full season), and free-agent *departures* are not
 *    logged at all, so counting the sentinel would lock half a story.
 *  - **Loans**, in both directions. A loan moves who a player turns out for,
 *    not who owns him, and buying a player then loaning him straight out is
 *    ordinary business rather than the flip this exists to stop.
 *
 * `enforceDivisionCeilings` is exempt as a *mover* — it is a forced structural
 * correction and it must still be able to confiscate a player the market has
 * just sold below the division ceiling, which is the whole reason it runs
 * after the market. Its moves still land in the log, so a swept player is
 * locked for the rest of the window like anyone else.
 */
export function movedThisWindow(
  transfers: CompletedTransfer[],
  season: number,
  window: TransferWindowKind,
): Set<number> {
  const moved = new Set<number>();
  for (const t of transfers) {
    if (t.season !== season || t.window !== window) continue;
    if (t.loanSeasons !== undefined || t.loanReturn) continue;
    if (isFreeAgentTid(t.fromTid) || isFreeAgentTid(t.toTid)) continue;
    moved.add(t.pid);
  }
  return moved;
}

/**
 * Deterministic per-(league, season, window, player, salt) seed: scout
 * reports, reservation prices, and recommendation ordering stay fixed for a
 * whole window instead of rerolling on every render or probing offer.
 */
export function windowSeed(
  lid: number,
  season: number,
  window: TransferWindowKind,
  pid: number,
  salt: number,
): number {
  const w = window === "summer" ? 1 : 2;
  let h = Math.imul(lid + 1, 2654435761);
  h = (h ^ Math.imul(season, 40503) ^ Math.imul(w, 99991)) >>> 0;
  h = (h ^ Math.imul(pid + 1, 2246822519) ^ Math.imul(salt + 1, 374761393)) >>> 0;
  return h;
}

/**
 * Clubs won't sell themselves hollow: a player is off the market if the sale
 * would leave the club with fewer than half its target complement
 * (ROSTER_COMPOSITION, rounded up) at that position.
 */
export function isForSale(
  seller: StoredTeam,
  players: Map<number, Player>,
  pid: number,
): boolean {
  return keepsDepthFloor(seller, players, pid);
}

/**
 * True if the player is either normally for-sale (isForSale) or a Division
 * 2 breakout player who'd refuse to re-sign (wouldRefuseExtension) — such a
 * player is transfer-listed immediately rather than waiting for a normal
 * sale trigger (see the Division 2 weaker-dynasty design doc).
 */
export function isForSaleOrRefusing(
  seller: StoredTeam,
  players: Map<number, Player>,
  pid: number,
  competitions: Competition[],
): boolean {
  if (isForSale(seller, players, pid)) return true;
  const player = players.get(pid);
  if (!player) return false;
  return wouldRefuseExtension(player, seller, competitions);
}

/**
 * During the offseason half of the summer window, a player in the final year
 * of his contract is about to walk for free (`releaseExpiredContracts` runs
 * at Advance) — paying a fee for him would hand the money over and lose the
 * player days later, so he's off the market until he re-signs somewhere.
 */
export function departsAtRollover(
  league: Pick<LeagueStore, "phase" | "season">,
  player: Player,
): boolean {
  return league.phase === "offseason" && player.contract.expiresSeason <= league.season;
}

/**
 * The hidden fee a club will accept for a player, fixed for the whole window.
 *
 * This is the ONLY call site of the difficulty buy-price lever, and that's
 * what makes the lever safe: it prices what the *user* pays and nothing else.
 * AI↔AI deals price through valueToClub/keepValueToClub and never come through
 * here, so no difficulty level can move the world's transfer economy.
 *
 * The MAX_TRANSFER_VALUE clamp is applied AFTER the scale and is deliberately
 * NOT scaled with it: that constant exists so no club ever quotes a fantasy
 * number, and letting a hard level ask £560M for a striker would break exactly
 * the promise it makes. The cost is that the tax compresses against the ceiling
 * at the very top of the market — which is moot in practice, because those are
 * the players a hard level's protected-star bar has already taken off the user's
 * market entirely (measured: scripts/difficultyProbe.ts).
 */
export function reservationPrice(
  lid: number,
  season: number,
  window: TransferWindowKind,
  player: Player,
  priceScale = 1,
): number {
  const rng = mulberry32(windowSeed(lid, season, window, player.pid, 1));
  const factor =
    RESERVATION_FACTOR_MIN + rng() * (RESERVATION_FACTOR_MAX - RESERVATION_FACTOR_MIN);
  // Clamp to the same believable ceiling as the value itself — the reservation
  // factor must not push a headline asking price past MAX_TRANSFER_VALUE.
  return Math.min(
    MAX_TRANSFER_VALUE,
    Math.round(trueTransferValue(player, season) * factor * priceScale),
  );
}

/**
 * The valuation the user's scouting department reports for a player, stable
 * for the whole window (noise shrinks with scouting spend).
 */
export function scoutedValue(
  lid: number,
  season: number,
  window: TransferWindowKind,
  player: Player,
  scoutingSpend: number,
  priceScale = 1,
): number {
  const rng = mulberry32(windowSeed(lid, season, window, player.pid, 2));
  // Buy-side surfaces pass the difficulty price scale so the figure the user
  // compares against his budget is the figure he'll actually be asked for —
  // a valuation that ignored the tax would read as a bug, not a difficulty.
  // Clamped like the reservation price it's meant to predict, and for the same
  // reason: quoted figures stay believable.
  return Math.min(
    MAX_TRANSFER_VALUE,
    Math.round(perceivedTransferValue(rng, player, season, scoutingSpend) * priceScale),
  );
}

export type OfferOutcome =
  | { kind: "accepted"; fee: number }
  | { kind: "countered"; counter: number }
  | { kind: "collapsed" };

/**
 * How a club answers an offer, per docs/finance-design.md: accept anything at
 * or above the reservation price; end talks outright on a way-off lowball, a
 * non-improving repeat offer, or once patience runs out; otherwise counter,
 * starting above the reservation price and converging toward it each round.
 */
export function respondToOffer(
  reservation: number,
  offer: number,
  priorOffers: number[],
): OfferOutcome {
  if (offer >= reservation) return { kind: "accepted", fee: offer };
  if (offer < reservation * NEGOTIATION_LOWBALL_FACTOR) return { kind: "collapsed" };
  const bestPrior = priorOffers.length > 0 ? Math.max(...priorOffers) : null;
  if (bestPrior !== null && offer <= bestPrior) return { kind: "collapsed" };
  if (priorOffers.length + 1 >= NEGOTIATION_MAX_ROUNDS) return { kind: "collapsed" };
  const padding = COUNTER_PADDING_START * COUNTER_PADDING_DECAY ** priorOffers.length;
  // Never counter above the believable ceiling (the padding sits on top of an
  // already-clamped reservation, so cap the result too).
  const counter = Math.min(MAX_TRANSFER_VALUE, Math.round(reservation * (1 + padding)));
  return { kind: "countered", counter };
}

/**
 * The wage charge a buying/signing club pays on top of any fee when adding a
 * player mid-season: wages are paid up front at each season's start, so a
 * player acquired during the regular phase charges his full season salary at
 * acquisition (clubs eat the year's wages on mid-season signings). Offseason
 * additions cost nothing here — the upcoming season-start charge covers them.
 */
export function acquisitionWageCharge(league: LeagueStore, player: Player): number {
  return league.phase === "regular" ? player.contract.salary : 0;
}

/**
 * Move a player between clubs for a fee: rosters swap membership, the fee
 * moves buyer→seller (money is conserved), the deal is logged, and the buyer
 * additionally pays any mid-season wage charge (acquisitionWageCharge). The
 * player's contract travels with them untouched (contracts are never
 * negotiated).
 */
export function executeTransfer(
  league: LeagueStore,
  pid: number,
  fromTid: number,
  toTid: number,
  fee: number,
  wageCharge: number,
  season: number,
  window: TransferWindowKind,
  /** Clauses the buyer is agreeing to as part of this deal (see clauses.ts). */
  newClauses: ProposedClause[] = [],
): LeagueStore {
  // Any sell-on the SELLER still owes on this player fires now, and every
  // clause naming him at this club dies either way. Settled before the new
  // deal's own clauses are attached, so a club cannot pay itself out of a
  // clause it is agreeing to in the same breath.
  const { payouts, remaining } = settleClausesOnSale(
    league.transferClauses ?? [], pid, fromTid, fee, season,
  );
  const owed = payouts.reduce((sum, p) => sum + p.amount, 0);

  // A delta map rather than a chain of tid tests, because the same club can
  // legitimately be two parties at once: sell a player on with a sell-on and
  // buy him back later and the buyer is also the beneficiary. Two separate
  // branches would apply one and silently drop the other.
  const delta = new Map<number, number>();
  const add = (tid: number, amount: number) =>
    delta.set(tid, (delta.get(tid) ?? 0) + amount);
  // Money is conserved: the buyer pays the whole fee, the seller keeps what is
  // left after any sell-on, and the beneficiaries take the rest.
  add(fromTid, fee - owed);
  add(toTid, -fee - wageCharge);
  for (const p of payouts) add(p.toTid, p.amount);

  return {
    ...league,
    teams: league.teams.map((t) => {
      const d = delta.get(t.tid);
      const roster =
        t.tid === fromTid ? t.roster.filter((p) => p !== pid)
        : t.tid === toTid ? [...t.roster, pid]
        : t.roster;
      if (d === undefined) return roster === t.roster ? t : { ...t, roster };
      // Clamp a club whose balance rises, which is where the ceiling has always
      // been applied (see clampBudget) — clamping a club that just spent would
      // be a new rule, not this one. The seller is clamped unconditionally
      // rather than only on a positive delta, because that is exactly what this
      // function did before clauses existed and a zero-fee move must not
      // quietly change. The scale is difficulty-aware because the seller is the
      // user himself when he sells.
      const budget = (t.tid === fromTid || d > 0)
        ? clampBudget(
            t.budget + d,
            financeScaleFor(league.competitions, t.compId, t.tid, league.meta.userTid, league.difficulty),
            t.hype,
          )
        : t.budget + d;
      return { ...t, roster, budget };
    }),
    transferClauses: [
      ...remaining,
      ...materializeClauses(newClauses, pid, fromTid, toTid, season, fee),
    ],
    transfers: [
      ...league.transfers,
      { pid, fromTid, toTid, fee, season, window },
    ],
  };
}

/** Negotiations for the currently open window (what the UI should show). */
export function currentNegotiations(league: LeagueStore): TransferNegotiation[] {
  const ws = transferWindowState(league);
  if (!ws.open) return [];
  return league.negotiations.filter(
    (n) => n.season === ws.season && n.window === ws.window,
  );
}

function upsertNegotiation(
  league: LeagueStore,
  negotiation: TransferNegotiation,
): TransferNegotiation[] {
  // Prune talks from earlier windows while we're here so the list never
  // accumulates across seasons.
  const rest = league.negotiations.filter(
    (n) =>
      n.season === negotiation.season &&
      n.window === negotiation.window &&
      n.pid !== negotiation.pid,
  );
  return [...rest, negotiation];
}

/**
 * The user offers `amount` for another club's player. No-op unless a window
 * is open, the player is on another club's roster and for sale, the amount is
 * within budget, and talks haven't already ended this window. On acceptance
 * the transfer executes immediately at the offered fee.
 */
export function makeTransferOffer(
  league: LeagueStore,
  pid: number,
  amount: number,
  /**
   * Contingent extras the user is offering on top of the cash (see clauses.ts).
   * They do NOT sweeten the deal: the seller's cash reservation drops by exactly
   * what they are worth, so this trades certain money for uncertain money and
   * the total price is unchanged.
   */
  clauses: ProposedClause[] = [],
): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;

  const userTid = league.meta.userTid;
  const user = league.teams.find((t) => t.tid === userTid);
  const seller = league.teams.find((t) => t.tid !== userTid && t.roster.includes(pid));
  const player = league.players.find((p) => p.pid === pid);
  if (!user || !seller || !player) return league;
  // A player out on loan physically sits on the loanee's roster but is owned
  // by his parent — the loanee can't sell what it doesn't own, or the live
  // loan would be orphaned and processLoanReturns would later duplicate the
  // pid onto the parent's roster too.
  if (league.activeLoans.some((l) => l.pid === pid)) return league;
  // One move per window, for the user exactly as for an AI buyer — a player
  // his new club signed days ago isn't going anywhere yet (see
  // movedThisWindow). Exempting the user here would just hand him the flip.
  if (movedThisWindow(league.transfers, ws.season, ws.window).has(pid)) return league;

  const offer = Math.round(amount);
  const wageCharge = acquisitionWageCharge(league, player);
  if (!Number.isFinite(offer) || offer <= 0) return league;
  if (!clausesAreValid(clauses, offer)) return league;
  // Add-ons sit ON TOP of the cash, the way a real transfer is reported. The
  // budget only has to cover what changes hands now, which is the whole point:
  // promising a share of a future sale is exactly how you sign someone you
  // could not have afforded outright.
  // The overdraft is what makes an ambitious signing possible at all: the club
  // may spend into the red up to its own limit, rather than only out of cash in
  // hand. A registration embargo stops the deal outright, whatever the price —
  // that is the point of it, and it is why the two are asked separately.
  const policy = spendPolicy(
    league.debtSanctions,
    league.season,
    user.tid,
    financeScaleFor(
      league.competitions, user.compId, user.tid, league.meta.userTid, league.difficulty,
    ),
  );
  if (policy.embargoed) return league;
  if (!affordable(user.budget, offer + wageCharge, policy)) return league;
  if (!hasRosterRoom(user)) return league;

  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  if (!isForSaleOrRefusing(seller, playerMap, pid, league.competitions)) return league;
  // A top club's star from a big season simply isn't for sale (see
  // protectedStars.ts). The bar the USER faces widens on the harder
  // difficulties; the AI market keeps using the shipped one.
  if (isProtectedStar(
    lastCompletedSeason(league), league.competitions, seller.tid, player,
    userProtectedStarBar(league.difficulty),
  )) return league;
  // ...and even a selling club's willingness isn't enough on its own: a good
  // player won't drop to a much smaller club, whoever is managing it (see
  // playerWill.ts). The user is gated here exactly like an AI buyer.
  if (refusesMoveToClub(player, seller, user, league.players)) return league;
  if (departsAtRollover(league, player)) return league;

  const existing = league.negotiations.find(
    (n) => n.pid === pid && n.season === ws.season && n.window === ws.window,
  );
  if (existing && existing.status !== "open") return league;

  const priorOffers = existing?.offers ?? [];
  const reservation = reservationPrice(
    league.lid, ws.season, ws.window, player,
    difficultyProfile(league.difficulty).buyPriceScale,
  );
  // ONE model across all four negotiation entry points: the number you name is
  // the CASH, and the add-ons are extra that the other club weighs alongside
  // it. So the seller judges the offer plus what the clauses are worth to him,
  // and a deal your cash alone could not reach can still clear his price.
  //
  // This is also what keeps the feature honest in both directions. Selling, the
  // same sum is measured against the buyer's ceiling, so demanding a sell-on
  // costs you the cash you could otherwise have asked for rather than being
  // free money on top.
  const clauseValue = clauseExpectedValue(league, pid, userTid, offer, clauses);
  const outcome = respondToOffer(reservation, offer + clauseValue, priorOffers);

  const negotiation: TransferNegotiation = {
    pid,
    sellerTid: seller.tid,
    season: ws.season,
    window: ws.window,
    offers: [...priorOffers, offer],
    counter: outcome.kind === "countered" ? outcome.counter : null,
    status:
      outcome.kind === "accepted" ? "accepted"
      : outcome.kind === "collapsed" ? "collapsed"
      : "open",
  };

  let updated: LeagueStore = { ...league, negotiations: upsertNegotiation(league, negotiation) };
  if (outcome.kind === "accepted") {
    // The cash is exactly what he offered. `outcome.fee` carries the clause
    // value the seller weighed and is not what changes hands.
    updated = executeTransfer(
      updated, pid, seller.tid, userTid, offer, wageCharge, ws.season, ws.window,
      clauses,
    );
  }
  return updated;
}

/**
 * Accept the seller's current counter-offer: the transfer executes at exactly
 * the countered fee. No-op without an open negotiation holding a counter the
 * user can afford — and the sale conditions (depth floor, contract expiry)
 * are re-checked here, since the roster may have changed since the counter
 * was made (e.g. a parallel negotiation already sold a teammate).
 */
export function acceptCounterOffer(
  league: LeagueStore,
  pid: number,
  clauses: ProposedClause[] = [],
): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;

  const negotiation = league.negotiations.find(
    (n) => n.pid === pid && n.season === ws.season && n.window === ws.window,
  );
  if (!negotiation || negotiation.status !== "open" || negotiation.counter === null) {
    return league;
  }

  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  const seller = league.teams.find((t) => t.tid === negotiation.sellerTid);
  const player = league.players.find((p) => p.pid === pid);
  if (!user || !seller || !player) return league;
  // A player who went out on loan since the counter was made is no longer the
  // seller's to sell (see makeTransferOffer).
  if (league.activeLoans.some((l) => l.pid === pid)) return league;
  // ...and one who has moved clubs since it was made is settled for the window,
  // whoever countered. Re-checked here rather than trusted from offer time for
  // the same reason the depth floor is: the world moves between the two.
  if (movedThisWindow(league.transfers, ws.season, ws.window).has(pid)) return league;
  const wageCharge = acquisitionWageCharge(league, player);
  // The counter is a CASH price the seller has already named, so meeting it in
  // cash is all that is required. Any add-ons attached here ride on top and can
  // only make the deal more attractive to him, never less — to pay less cash
  // instead, make a fresh offer with the add-ons on it.
  if (!clausesAreValid(clauses, negotiation.counter)) return league;
  if (negotiation.counter + wageCharge > user.budget) return league;
  if (!hasRosterRoom(user)) return league;

  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  if (!isForSaleOrRefusing(seller, playerMap, pid, league.competitions)) return league;
  // A top club's star from a big season simply isn't for sale (see
  // protectedStars.ts). The bar the USER faces widens on the harder
  // difficulties; the AI market keeps using the shipped one.
  if (isProtectedStar(
    lastCompletedSeason(league), league.competitions, seller.tid, player,
    userProtectedStarBar(league.difficulty),
  )) return league;
  // ...and even a selling club's willingness isn't enough on its own: a good
  // player won't drop to a much smaller club, whoever is managing it (see
  // playerWill.ts). The user is gated here exactly like an AI buyer.
  if (refusesMoveToClub(player, seller, user, league.players)) return league;
  if (departsAtRollover(league, player)) return league;

  const accepted: TransferNegotiation = { ...negotiation, status: "accepted" };
  const updated: LeagueStore = { ...league, negotiations: upsertNegotiation(league, accepted) };
  return executeTransfer(
    updated, pid, seller.tid, user.tid, negotiation.counter, wageCharge, ws.season, ws.window,
    clauses,
  );
}
