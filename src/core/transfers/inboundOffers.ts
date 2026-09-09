import type { Player } from "../players/types.js";
import { isBorrowed, borrowedPids } from "../loanOwnership.js";
import type { LeagueStore } from "../leagueState.js";
import type { ClubContext } from "../ai/clubContext.js";
import type { TransferWindowKind, TransferWindowState } from "./window.js";
import type { StoredTeam } from "../teams/clubs.js";
import { transferWindowState } from "./window.js";
import { faTransferLocked } from "../freeAgency.js";
import {
  windowSeed, departsAtRollover, acquisitionWageCharge, hasRosterRoom, executeTransfer,
  movedThisWindow,
} from "./negotiation.js";
import { deriveLeagueContexts } from "../ai/clubContext.js";
import type { ProposedClause } from "./clauses.js";
import { clauseExpectedValue, clausesAreValid } from "./clauses.js";
import { keepValueToClub, valueToClub, perceivedValueToClub } from "../ai/evaluate.js";
import { moveAppealBetween, settledMultiplier, joinedSeasons } from "./playerWill.js";
import { mulberry32 } from "../../engine/rng.js";
import { tierOf } from "../competitions.js";
import {
  AI_MARKET_MIN_SURPLUS, AI_MARKET_FEE_SHARE,
  AI_MARKET_RESERVE_FRACTION_MIN, AI_MARKET_RESERVE_FRACTION_MAX,
  INBOUND_OFFERS_MAX, LISTED_FOR_TRANSFER_MIN_SURPLUS,
  NEGOTIATION_LOWBALL_FACTOR, NEGOTIATION_MAX_ROUNDS,
  COUNTER_PADDING_START, COUNTER_PADDING_DECAY,
  divisionRefusalOvr,
} from "../constants.js";

/**
 * Toggle whether the user has explicitly listed a player for transfer (see
 * StoredTeam.transferListed / LISTED_FOR_TRANSFER_MIN_SURPLUS). No-op unless
 * the pid is actually on the user's own roster.
 */
export function setTransferListed(league: LeagueStore, pid: number, listed: boolean): LeagueStore {
  const userTid = league.meta.userTid;
  // A player in on loan sits on the user's roster but belongs to his parent
  // club, so listing him would advertise someone else's player for sale.
  if (isBorrowed(league.activeLoans, userTid, pid)) return league;
  return {
    ...league,
    teams: league.teams.map((t) => {
      if (t.tid !== userTid || !t.roster.includes(pid)) return t;
      const has = t.transferListed.includes(pid);
      if (listed === has) return t;
      return {
        ...t,
        transferListed: listed
          ? [...t.transferListed, pid]
          : t.transferListed.filter((p) => p !== pid),
      };
    }),
  };
}

/**
 * What a buyer can actually spend right now without dipping into its cash
 * reserve (see AI_MARKET_RESERVE_FRACTION_* — same reserve rule the AI↔AI
 * market uses, so a rich club chasing one of the user's players doesn't get
 * spent to zero any more than it would chasing another club's).
 */
export function buyerSpendable(buyer: StoredTeam, buyerCtx: ClubContext, wageCharge: number): number {
  const reserveFraction =
    AI_MARKET_RESERVE_FRACTION_MIN +
    buyerCtx.frugality * (AI_MARKET_RESERVE_FRACTION_MAX - AI_MARKET_RESERVE_FRACTION_MIN);
  return buyer.budget * (1 - reserveFraction) - wageCharge;
}

/**
 * An AI club's live interest in one of the user's players, scoped to a
 * single window. Unlike TransferNegotiation (user↔club, user is the buyer),
 * the user is the seller here and the AI club is the buyer.
 */
export interface InboundOffer {
  pid: number;
  buyerTid: number;
  season: number;
  window: TransferWindowKind;
  /** Buyer's offer history, most recent last (starts with their opening offer). */
  offers: number[];
  /** The user's ask history, most recent last — empty until the user counters. */
  asks: number[];
  status: "open" | "accepted" | "rejected" | "collapsed";
}

/** A not-yet-negotiated inbound offer, freshly computed from current league state. */
export interface InboundOfferCandidate {
  player: Player;
  buyerTid: number;
  /** The player's value to the user's own club — the floor a sale must clear. */
  reservation: number;
  /** The buyer's (jittered) willingness-to-pay ceiling. */
  ceiling: number;
  /** reservation + AI_MARKET_FEE_SHARE * (ceiling - reservation), rounded. */
  openingOffer: number;
}

/**
 * Inbound offers for the user's players this window: for each roster player,
 * the single AI club that values him most (if any club clears him by at
 * least AI_MARKET_MIN_SURPLUS above his worth to the user's own club),
 * capped to the INBOUND_OFFERS_MAX most compelling. Reuses the exact same
 * valueToClub primitive and fee-split math as the AI↔AI market (phase 2) —
 * the user's club is just one more context in that comparison. Deterministic
 * within a window (a per-player seeded scouting-noise jitter on the buyer's
 * valuation via perceivedValueToClub, the same role it plays in the AI↔AI
 * market); empty when no window is open or nobody clears the bar.
 *
 * Buyers are diversified: a club already tied to an offer this window
 * (either picked earlier in this same pass, or already negotiating for a
 * different player per persisted state) is skipped in favor of the next-best
 * distinct buyer, so the same wealthy 1-2 clubs — which tend to clear the
 * affordability bar for almost anyone — don't dominate every offer. A buyer
 * is only reused if literally no other club clears the bar for that player.
 */
export function inboundOfferCandidates(league: LeagueStore): InboundOfferCandidate[] {
  const ws = transferWindowState(league);
  if (!ws.open) return [];

  const userTid = league.meta.userTid;
  const user = league.teams.find((t) => t.tid === userTid);
  if (!user) return [];

  const contexts = deriveLeagueContexts({
    teams: league.teams, players: league.players, season: league.season, played: league.played,
    competitions: league.competitions,
  });
  const userCtx = contexts.get(userTid);
  if (!userCtx) return [];

  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  const listedSet = new Set(user.transferListed);

  const usedBuyers = new Set(
    league.inboundOffers
      .filter((o) => o.season === ws.season && o.window === ws.window && o.status === "open")
      .map((o) => o.buyerTid),
  );

  const joined = joinedSeasons(league.transfers);

  // Players the user has in on loan are on his roster but aren't his to sell —
  // the same reason makeTransferOffer refuses to buy one. Without this an AI
  // club could bid for a borrowed player and the user could bank a fee for
  // someone else's asset, orphaning the live loan.
  const borrowed = borrowedPids(league.activeLoans, userTid);

  // Anyone who has already changed clubs this window is settled until it shuts,
  // which on this side of the market is what stops the user buying a player
  // cheap and selling him on in the same window (see movedThisWindow).
  const moved = movedThisWindow(league.transfers, ws.season, ws.window);

  const candidates: InboundOfferCandidate[] = [];
  for (const pid of user.roster) {
    if (borrowed.has(pid)) continue;
    const player = playerMap.get(pid);
    if (!player) continue;
    if (departsAtRollover(league, player)) continue;
    // A free agent the user just signed is under a one-season transfer hold —
    // no club can bid on him until it clears (see faTransferLocked).
    if (faTransferLocked(player, league.season)) continue;
    if (moved.has(pid)) continue;

    // Keep-side, exactly as an AI seller prices its own players, plus the
    // settling-in premium (see ValuationSide / playerWill.ts). The user's stars
    // used to be priced by the buy-side formula, which valued them against
    // themselves and so lowballed the asking price badly.
    const reservation =
      keepValueToClub(player, userCtx) * settledMultiplier(joined.get(pid), ws.season);
    const wageCharge = acquisitionWageCharge(league, player);
    const jitter = mulberry32(windowSeed(league.lid, ws.season, ws.window, pid, 4));
    // Listing lowers the surplus a buyer needs to clear — see
    // LISTED_FOR_TRANSFER_MIN_SURPLUS.
    const minSurplus = listedSet.has(pid) ? LISTED_FOR_TRANSFER_MIN_SURPLUS : AI_MARKET_MIN_SURPLUS;

    let best: InboundOfferCandidate | null = null;
    let bestAnyBuyer: InboundOfferCandidate | null = null;
    for (const buyer of league.teams) {
      if (buyer.tid === userTid) continue;
      const buyerCtx = contexts.get(buyer.tid);
      if (!buyerCtx) continue;

      const rawCeiling = perceivedValueToClub(player, buyerCtx, jitter);
      // A club below the top flight never bids on a player at or above its own
      // tier's ceiling threshold — same prevention rule as the AI↔AI market (the
      // sweep would confiscate him from the buyer anyway). Placed AFTER the
      // jitter draw so filtered buyers still consume their draw and don't
      // shift later buyers' jitter (RNG-stream-order lesson).
      if (
        player.ovr >= divisionRefusalOvr(tierOf(league.competitions, buyer.compId))
      ) continue;
      // A buyer only shows up as a candidate if it can actually pay a fair
      // fee without dipping into its cash reserve — otherwise the offer
      // would just fail affordability at accept time (see buyerSpendable).
      // The player's own say, applied after the jitter draw like the Division 2
      // guard above (RNG-stream-order lesson). A club much smaller than the
      // user's won't get anywhere near his reservation, so no more insulting
      // bids from minnows for the user's best player.
      const appealed = rawCeiling * moveAppealBetween(player, userCtx, buyerCtx);
      const ceiling = Math.min(appealed, buyerSpendable(buyer, buyerCtx, wageCharge));
      if (ceiling < reservation * (1 + minSurplus)) continue;
      const candidate: InboundOfferCandidate = {
        player,
        buyerTid: buyer.tid,
        reservation,
        ceiling,
        openingOffer: Math.round(reservation + AI_MARKET_FEE_SHARE * (ceiling - reservation)),
      };
      if (!bestAnyBuyer || ceiling > bestAnyBuyer.ceiling) bestAnyBuyer = candidate;
      if (usedBuyers.has(buyer.tid)) continue;
      if (!best || ceiling > best.ceiling) best = candidate;
    }
    // Fall back to reusing a buyer only if no fresh buyer clears the bar.
    const chosen = best ?? bestAnyBuyer;
    if (chosen) {
      candidates.push(chosen);
      usedBuyers.add(chosen.buyerTid);
    }
  }

  // Listed players are prioritized within the INBOUND_OFFERS_MAX cap — the
  // user asked for offers on them, so they shouldn't get crowded out by
  // unlisted players with a bigger surplus.
  return candidates
    .sort((a, b) => {
      const aListed = listedSet.has(a.player.pid);
      const bListed = listedSet.has(b.player.pid);
      if (aListed !== bListed) return aListed ? -1 : 1;
      return (
        (b.ceiling - b.reservation) - (a.ceiling - a.reservation) || a.player.pid - b.player.pid
      );
    })
    .slice(0, INBOUND_OFFERS_MAX);
}

/** Inbound offers (negotiated or not) for the currently open window. */
export function currentInboundOffers(league: LeagueStore): InboundOffer[] {
  const ws = transferWindowState(league);
  if (!ws.open) return [];
  return league.inboundOffers.filter((o) => o.season === ws.season && o.window === ws.window);
}

function upsertInboundOffer(league: LeagueStore, offer: InboundOffer): InboundOffer[] {
  const rest = league.inboundOffers.filter(
    (o) => !(o.season === offer.season && o.window === offer.window && o.pid === offer.pid),
  );
  return [...rest, offer];
}

/** The live offer on the table for a player: persisted state if talks have started, else the fresh candidate. */
function resolveOpenOffer(
  league: LeagueStore,
  pid: number,
): { buyerTid: number; fee: number; offers: number[]; asks: number[] } | null {
  const ws = transferWindowState(league);
  if (!ws.open) return null;

  const existing = league.inboundOffers.find(
    (o) => o.pid === pid && o.season === ws.season && o.window === ws.window,
  );
  if (existing) {
    if (existing.status !== "open") return null;
    return {
      buyerTid: existing.buyerTid,
      fee: existing.offers.at(-1)!,
      offers: existing.offers,
      asks: existing.asks,
    };
  }

  const candidate = inboundOfferCandidates(league).find((c) => c.player.pid === pid);
  if (!candidate) return null;
  return { buyerTid: candidate.buyerTid, fee: candidate.openingOffer, offers: [candidate.openingOffer], asks: [] };
}

/**
 * The most this buyer would pay for the player right now, all in.
 *
 * Pulled out of `counterInboundOffer` so accepting-with-add-ons and the button
 * that offers it can ask the same question. Returns null when there is nothing
 * to answer it about.
 */
export function inboundCeiling(league: LeagueStore, pid: number): number | null {
  const resolved = resolveOpenOffer(league, pid);
  const player = league.players.find((p) => p.pid === pid);
  if (!resolved || !player) return null;
  const buyer = league.teams.find((t) => t.tid === resolved.buyerTid);
  if (!buyer) return null;
  const contexts = deriveLeagueContexts({
    teams: league.teams, players: league.players, season: league.season,
    played: league.played, competitions: league.competitions,
  });
  const buyerCtx = contexts.get(resolved.buyerTid);
  const userCtx = contexts.get(league.meta.userTid);
  if (!buyerCtx || !userCtx) return null;
  const wageCharge = acquisitionWageCharge(league, player);
  const live = Math.min(
    valueToClub(player, buyerCtx) * moveAppealBetween(player, userCtx, buyerCtx),
    buyerSpendable(buyer, buyerCtx, wageCharge),
  );
  return Math.max(live, resolved.offers.at(-1) ?? 0);
}

/**
 * Whether the buyer would still wear his own standing offer with these add-ons
 * hung on top of it.
 *
 * Accepting is not a negotiation, so rather than let an accept quietly turn
 * into a counter this answers up front — and the Incoming Offers page uses the
 * same call to grey the button out instead of leaving it inert.
 */
export function buyerAcceptsClauses(
  league: LeagueStore,
  pid: number,
  clauses: ProposedClause[],
): boolean {
  if (clauses.length === 0) return true;
  const resolved = resolveOpenOffer(league, pid);
  if (!resolved) return false;
  const ceiling = inboundCeiling(league, pid);
  if (ceiling === null) return false;
  const value = clauseExpectedValue(league, pid, resolved.buyerTid, resolved.fee, clauses);
  return resolved.fee + value <= ceiling;
}

export type InboundResponse =
  | { kind: "accepted"; fee: number }
  | { kind: "countered"; offer: number }
  | { kind: "collapsed" };

/**
 * Mirror image of respondToOffer (negotiation.ts): the buyer's ceiling plays
 * the role of the seller's reservation, and the user's ask plays the role of
 * the buyer's offer, with every "higher is better" comparison flipped to
 * "lower is better". Reuses the exact same tuning constants so both
 * directions of the market haggle at the same pace and give up at the same
 * point.
 */
export function respondToAsk(
  ceiling: number,
  ask: number,
  priorAsks: number[],
  standingOffer = 0,
): InboundResponse {
  if (ask <= ceiling) return { kind: "accepted", fee: ask };
  if (ask > ceiling / NEGOTIATION_LOWBALL_FACTOR) return { kind: "collapsed" };
  const bestPrior = priorAsks.length > 0 ? Math.min(...priorAsks) : null;
  if (bestPrior !== null && ask >= bestPrior) return { kind: "collapsed" };
  if (priorAsks.length + 1 >= NEGOTIATION_MAX_ROUNDS) return { kind: "collapsed" };
  const padding = COUNTER_PADDING_START * COUNTER_PADDING_DECAY ** priorAsks.length;
  // The buyer concedes ground from what it has already offered toward its
  // ceiling, holding back `padding` of the remaining gap and giving up more of
  // it each round. Anchoring on the standing offer keeps counters monotonically
  // rising; padding down from the ceiling alone does not, because the opening
  // bid is built by splitting the reservation-to-ceiling gap. While sellers
  // lowballed their own players that opening bid sat far below the ceiling and
  // the flaw was invisible, but once a club prices its own player properly the
  // opening bid lands near the ceiling and a ceiling-padded "counter" comes in
  // *below* the offer already on the table.
  const floor = Math.max(0, Math.min(standingOffer, ceiling));
  return { kind: "countered", offer: Math.round(ceiling - padding * (ceiling - floor)) };
}

/**
 * Accept the buyer's current offer (their opening bid, or a raised counter
 * from a prior round) at face value. No-op unless a window is open, an offer
 * is actually on the table, and the buyer can still afford it (its budget or
 * roster may have moved since the offer was computed).
 */
/**
 * Can the user still sell this pid at all, at the moment he clicks?
 *
 * Every condition on a sale (borrowed, out on loan, already moved this window)
 * otherwise lives in `inboundOfferCandidates`, which builds a FRESH offer. A
 * persisted offer skips that builder entirely — `resolveOpenOffer` returns the
 * stored row first — so an offer opened in one state and accepted in another is
 * checked against nothing. `acceptCounterOffer` on the buy side already
 * re-checks its own conditions for exactly this reason ("the roster may have
 * changed since the counter was made"); this is the missing mirror.
 *
 * The loan case is the one with teeth. Nothing in `loans.ts` clears
 * `inboundOffers`, so a player can go out on loan with an open offer still on
 * the table. He then sits on the LOANEE's roster, and `executeTransfer` removes
 * a pid only from the seller's roster — the user's, where he no longer is —
 * while pushing him onto the buyer's. That leaves one pid on two rosters with a
 * live loan pointing at a third club, which `processLoanReturns` would later
 * duplicate again. Same reasoning as the AI market's `onLoanPids` skip.
 */
function canStillSell(league: LeagueStore, pid: number, ws: TransferWindowState): boolean {
  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!user || !user.roster.includes(pid)) return false;
  // Covers both directions: a player in on loan isn't his to sell, and one out
  // on loan isn't on his roster to hand over.
  if (league.activeLoans.some((l) => l.pid === pid)) return false;
  if (ws.open && movedThisWindow(league.transfers, ws.season, ws.window).has(pid)) return false;
  return true;
}

export function acceptInboundOffer(
  league: LeagueStore,
  pid: number,
  /**
   * Contingent extras the user is holding back from the deal (see clauses.ts) —
   * a sell-on share of the buyer's future profit, or add-ons. The buyer's total
   * willingness to pay is unchanged, so every pound of clause comes off the
   * cash: you are choosing upside over money now, not being handed both.
   */
  clauses: ProposedClause[] = [],
): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;

  const resolved = resolveOpenOffer(league, pid);
  if (!resolved) return league;
  if (!canStillSell(league, pid, ws)) return league;

  const buyer = league.teams.find((t) => t.tid === resolved.buyerTid);
  const player = league.players.find((p) => p.pid === pid);
  if (!buyer || !player) return league;
  if (departsAtRollover(league, player)) return league;
  if (!hasRosterRoom(buyer)) return league;

  const wageCharge = acquisitionWageCharge(league, player);
  if (!clausesAreValid(clauses, resolved.fee)) return league;
  // Add-ons ride ON TOP of the cash offer, so accepting with them attached is
  // asking the buyer for more than he put on the table. He wears it only while
  // the whole package still sits under what the player is worth to him —
  // otherwise this is a no-op and the user has to counter instead. That bound
  // is what stops "accept, and also give me a sell-on" being free money.
  if (!buyerAcceptsClauses(league, pid, clauses)) return league;
  if (resolved.fee + wageCharge > buyer.budget) return league;

  const accepted: InboundOffer = {
    pid, buyerTid: resolved.buyerTid, season: ws.season, window: ws.window,
    offers: resolved.offers, asks: resolved.asks, status: "accepted",
  };
  const updated: LeagueStore = { ...league, inboundOffers: upsertInboundOffer(league, accepted) };
  return executeTransfer(
    updated, pid, league.meta.userTid, resolved.buyerTid, resolved.fee, wageCharge,
    ws.season, ws.window, clauses,
  );
}

/** Turn down the offer on the table outright — talks end for this window. */
export function rejectInboundOffer(league: LeagueStore, pid: number): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;

  const resolved = resolveOpenOffer(league, pid);
  if (!resolved) return league;

  const rejected: InboundOffer = {
    pid, buyerTid: resolved.buyerTid, season: ws.season, window: ws.window,
    offers: resolved.offers, asks: resolved.asks, status: "rejected",
  };
  return { ...league, inboundOffers: upsertInboundOffer(league, rejected) };
}

/**
 * Ask the buyer for more. The buyer re-evaluates against a freshly computed
 * ceiling (their willingness-to-pay may have shifted since the opening offer
 * if the roster/budget state moved) and either meets the ask, raises their
 * offer partway, or walks — via respondToAsk, mirroring how an AI seller
 * responds to the user's outgoing offers.
 */
export function counterInboundOffer(
  league: LeagueStore,
  pid: number,
  askAmount: number,
  clauses: ProposedClause[] = [],
): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;

  const resolved = resolveOpenOffer(league, pid);
  if (!resolved) return league;
  // Countering can end in an immediate sale, so it needs the same re-check as
  // accepting outright (see canStillSell).
  if (!canStillSell(league, pid, ws)) return league;

  const ask = Math.round(askAmount);
  if (!Number.isFinite(ask) || ask <= 0) return league;

  const buyer = league.teams.find((t) => t.tid === resolved.buyerTid);
  const player = league.players.find((p) => p.pid === pid);
  if (!buyer || !player) return league;

  const contexts = deriveLeagueContexts({
    teams: league.teams, players: league.players, season: league.season, played: league.played,
    competitions: league.competitions,
  });
  const buyerCtx = contexts.get(resolved.buyerTid);
  const userCtx = contexts.get(league.meta.userTid);
  if (!buyerCtx || !userCtx) return league;
  const wageCharge = acquisitionWageCharge(league, player);
  // Re-derived live (no jitter — that's only for opening-offer variety), but
  // still carrying the same move-appeal scaling and spendable cap the candidate
  // used, so a buyer's ceiling can't silently grow between offer and counter.
  // One definition of the buyer's ceiling, shared with `buyerAcceptsClauses` so
  // accepting and countering cannot disagree about what he can afford.
  const ceiling = inboundCeiling(league, pid);
  if (ceiling === null) return league;

  // Same model as every other entry point: the ask is the CASH you want, and
  // the add-ons are extra the buyer weighs alongside it (see makeTransferOffer).
  // So asking for a sell-on as well as the same cash really is asking for more,
  // and he may push back on it — which is the whole reason it is not free.
  if (!clausesAreValid(clauses, ask)) return league;
  const clauseValue = clauseExpectedValue(league, pid, resolved.buyerTid, ask, clauses);
  const response = respondToAsk(
    ceiling, ask + clauseValue, resolved.asks, resolved.offers.at(-1) ?? 0,
  );
  const offers = response.kind === "countered" ? [...resolved.offers, response.offer] : resolved.offers;
  const asks = [...resolved.asks, ask];

  const negotiation: InboundOffer = {
    pid, buyerTid: resolved.buyerTid, season: ws.season, window: ws.window,
    offers, asks,
    status:
      response.kind === "accepted" ? "accepted"
      : response.kind === "collapsed" ? "collapsed"
      : "open",
  };
  let updated: LeagueStore = { ...league, inboundOffers: upsertInboundOffer(league, negotiation) };

  if (response.kind === "accepted") {
    // The buyer agreed in principle, but their budget/roster may no longer
    // cover it — fall back to a collapse rather than execute an impossible deal.
    // Measured against the CASH, which is what actually leaves their account
    // now; the add-ons fall due later, if at all.
    if (!hasRosterRoom(buyer) || ask + wageCharge > buyer.budget) {
      return {
        ...updated,
        inboundOffers: upsertInboundOffer(updated, { ...negotiation, status: "collapsed" }),
      };
    }
    updated = executeTransfer(
      updated, pid, league.meta.userTid, resolved.buyerTid, ask,
      wageCharge, ws.season, ws.window, clauses,
    );
  }
  return updated;
}
