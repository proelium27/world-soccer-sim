import type { Player } from "./players/types.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { LeagueStore } from "./leagueState.js";
import type { CompletedTransfer } from "./transfers/negotiation.js";
import type { TransferWindowKind } from "./transfers/window.js";
import type { Competition } from "./competitions.js";
import { tierOf } from "./competitions.js";
import { transferWindowState } from "./transfers/window.js";
import {
  windowSeed, departsAtRollover, acquisitionWageCharge, hasRosterRoom,
} from "./transfers/negotiation.js";
import { trueTransferValue } from "./finance/valuation.js";
import { clampBudget, financeScale, financeScaleFor } from "./finance/budget.js";
import { keepsDepthFloor } from "./freeAgency.js";
import { resolveXI } from "./lineup/resolveXI.js";
import { teamSlots } from "./lineup/formations.js";
import { deriveLeagueContexts } from "./ai/clubContext.js";
import { keepValueToClub, perceivedValueToClub } from "./ai/evaluate.js";
import { mulberry32 } from "../engine/rng.js";
import {
  ROSTER_CAP, ROSTER_SAFETY_FLOOR, LOAN_MAX_SEASONS,
  LOAN_FEE_RATE, LOAN_DURATION_MULTIPLIER, LOAN_AI_MAX_AGE,
  LOAN_MIN_SURPLUS, LOAN_OFFERS_MAX, AI_LOAN_MAX_MOVES,
  divisionRefusalOvr,
} from "./constants.js";

/** A player's loan-out choice, before any club has agreed to take him. */
export interface LoanListing {
  pid: number;
  seasons: 1 | 2 | 3;
}

/** A currently-in-effect loan: pid physically plays for loaneeTid, still owned by parentTid. */
export interface ActiveLoan {
  pid: number;
  parentTid: number;
  loaneeTid: number;
  startSeason: number;
  seasons: number;
  /** The first season pid must be back on parentTid's roster. */
  returnSeason: number;
  fee: number;
}

/** A user-listed player's loan offer turned down this window — kept off the candidate list until the next window. */
export interface LoanRejection {
  pid: number;
  buyerTid: number;
  season: number;
  window: TransferWindowKind;
}

/**
 * Flat loan fee: a fraction of the player's true (permanent) market value,
 * scaled by a diminishing per-duration multiplier — see LOAN_FEE_RATE /
 * LOAN_DURATION_MULTIPLIER for why loans are priced far below a sale.
 */
export function computeLoanFee(player: Player, season: number, seasons: 1 | 2 | 3): number {
  return Math.round(trueTransferValue(player, season) * LOAN_FEE_RATE * LOAN_DURATION_MULTIPLIER[seasons]);
}

/**
 * The longest loan a player's current contract can cover, starting this
 * season: he plays seasons `startSeason .. startSeason + seasons - 1` at the
 * loanee, so the deal has to expire no earlier than the last of them. 0 means
 * he can't be loaned at all — his contract is already up.
 *
 * Loans are not allowed to outlast the contract because the club sending him
 * gets nothing out of one: he is away when the deal runs down, and he leaves
 * on a free the moment he lands back home. Capping the duration is the honest
 * version of the choice — extend him first, then loan him for as long as you
 * like.
 */
export function maxLoanSeasons(player: Player, startSeason: number): number {
  return Math.max(0, Math.min(LOAN_MAX_SEASONS, player.contract.expiresSeason - startSeason + 1));
}

/** True if a loan of this length would still be running after his contract expires. */
export function loanOutlivesContract(player: Player, startSeason: number, seasons: number): boolean {
  return seasons > maxLoanSeasons(player, startSeason);
}

/**
 * Move a player onto another club's roster for a fixed-duration loan: the
 * loanee pays a flat fee (+ any mid-season wage charge, same rule as a
 * permanent acquisition) and takes over his wages for as long as he's there,
 * which falls out for free since wage charging already keys off roster
 * membership rather than contract ownership. The player's contract itself is
 * untouched and travels back to the parent club unchanged at loan end.
 */
export function executeLoan(
  league: LeagueStore,
  pid: number,
  parentTid: number,
  loaneeTid: number,
  seasons: 1 | 2 | 3,
  fee: number,
  startSeason: number,
  window: TransferWindowKind,
): LeagueStore {
  const player = league.players.find((p) => p.pid === pid);
  if (!player) return league;
  const wageCharge = acquisitionWageCharge(league, player);

  const loan: ActiveLoan = {
    pid, parentTid, loaneeTid, startSeason, seasons,
    returnSeason: startSeason + seasons, fee,
  };

  return {
    ...league,
    teams: league.teams.map((t) => {
      if (t.tid === parentTid) {
        return {
          ...t,
          roster: t.roster.filter((p) => p !== pid),
          budget: clampBudget(
            t.budget + fee,
            financeScaleFor(league.competitions, t.compId, t.tid, league.meta.userTid, league.difficulty),
            t.hype,
          ),
        };
      }
      if (t.tid === loaneeTid) {
        return { ...t, roster: [...t.roster, pid], budget: t.budget - fee - wageCharge };
      }
      return t;
    }),
    loanListings: league.loanListings.filter((l) => l.pid !== pid),
    activeLoans: [...league.activeLoans, loan],
    transfers: [
      ...league.transfers,
      { pid, fromTid: parentTid, toTid: loaneeTid, fee, season: startSeason, window, loanSeasons: seasons },
    ],
  };
}

/**
 * Return every loan due back this season (returnSeason <= the season about
 * to start) to its parent club — called once at the offseason rollover,
 * before season-start wages are charged, so the wage lands on the correct
 * club for the new season. A parent club always gets him back regardless of
 * roster size (mirrors how youth intake can briefly push a club over
 * ROSTER_CAP — AI clubs get trimmed back down the same offseason;
 * ROSTER_CAP is enforced at the next acquisition, not on return).
 */
export function processLoanReturns(
  teams: StoredTeam[],
  activeLoans: ActiveLoan[],
  transfers: CompletedTransfer[],
  nextSeason: number,
): { teams: StoredTeam[]; activeLoans: ActiveLoan[]; transfers: CompletedTransfer[] } {
  const due = activeLoans.filter((l) => l.returnSeason <= nextSeason);
  if (due.length === 0) return { teams, activeLoans, transfers };

  const dueByPid = new Map(due.map((l) => [l.pid, l]));
  const updatedTeams = teams.map((t) => {
    const departing = new Set(due.filter((l) => l.loaneeTid === t.tid).map((l) => l.pid));
    // Only bring home pids the parent isn't already carrying — a returning
    // player must land on his parent exactly once, never appended blindly, so
    // a loan left in an inconsistent state can't be materialized into a
    // duplicate here (defense-in-depth behind the no-orphaned-loan guards).
    const kept = t.roster.filter((pid) => !departing.has(pid));
    const keptSet = new Set(kept);
    const arriving = due
      .filter((l) => l.parentTid === t.tid && !keptSet.has(l.pid))
      .map((l) => l.pid);
    if (arriving.length === 0 && departing.size === 0) return t;
    return { ...t, roster: [...kept, ...arriving] };
  });

  const returnTransfers: CompletedTransfer[] = due.map((l) => ({
    pid: l.pid, fromTid: l.loaneeTid, toTid: l.parentTid, fee: 0,
    season: nextSeason, window: "summer", loanReturn: true,
  }));

  return {
    teams: updatedTeams,
    activeLoans: activeLoans.filter((l) => !dueByPid.has(l.pid)),
    transfers: [...transfers, ...returnTransfers],
  };
}

/** A not-yet-negotiated incoming loan offer for one of the user's listed players. */
export interface LoanOfferCandidate {
  player: Player;
  buyerTid: number;
  seasons: 1 | 2 | 3;
  fee: number;
}

/**
 * Incoming loan offers this window: for each player the user has listed, the
 * single AI club most interested (its perceivedValueToClub must clear the
 * player's worth to the user's own club by LOAN_MIN_SURPLUS — a much looser
 * bar than a permanent sale since a loan is cheap and reversible), skipping
 * clubs that already turned this listing down this window and diversifying
 * buyers the same way inbound (permanent) offers do. Computed live, not
 * stored — only becomes persisted state via acceptLoanOffer/rejectLoanOffer.
 */
export function loanOfferCandidates(league: LeagueStore): LoanOfferCandidate[] {
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
  const rejectedFor = (pid: number): Set<number> => new Set(
    league.loanRejections
      .filter((r) => r.pid === pid && r.season === ws.season && r.window === ws.window)
      .map((r) => r.buyerTid),
  );

  const candidates: LoanOfferCandidate[] = [];
  const usedBuyers = new Set<number>();
  for (const listing of league.loanListings) {
    if (!user.roster.includes(listing.pid)) continue;
    const player = playerMap.get(listing.pid);
    if (!player) continue;
    if (departsAtRollover(league, player)) continue;
    // A listing made before his contract shortened (or carried in from an
    // older save) can outlast the deal — no offer on it, same as the listing
    // screen refuses to make one.
    if (loanOutlivesContract(player, ws.season, listing.seasons)) continue;

    const reservation = keepValueToClub(player, userCtx);
    const jitter = mulberry32(windowSeed(league.lid, ws.season, ws.window, listing.pid, 5));
    const skip = rejectedFor(listing.pid);

    let best: { tid: number; value: number } | null = null;
    for (const buyer of league.teams) {
      if (buyer.tid === userTid || usedBuyers.has(buyer.tid) || skip.has(buyer.tid)) continue;
      if (buyer.roster.length >= ROSTER_CAP) continue;
      const buyerCtx = contexts.get(buyer.tid);
      if (!buyerCtx) continue;
      const value = perceivedValueToClub(player, buyerCtx, jitter);
      // Only a club that would actually play him, the same rule the AI↔AI
      // market and the user's borrowing side both enforce. This is the half
      // that matters most to the user, because it is his own stated reason for
      // lending: a player good enough to develop but not good enough for his
      // XI, sent somewhere he'll get games. An offer from a club that would
      // bench him looks like the deal he wanted and delivers nothing — the
      // player comes back a season older having played as little as if he had
      // stayed. A weak enough player may now draw no offers at all, which is
      // the honest answer rather than a broken one.
      //
      // After the jitter draw, like the other two, so a filtered buyer doesn't
      // shift every later buyer's noise.
      if (player.ovr <= buyerCtx.posWeakestStarterOvr[player.pos]) continue;
      if (value < reservation * (1 + LOAN_MIN_SURPLUS)) continue;
      if (!best || value > best.value) best = { tid: buyer.tid, value };
    }
    if (best) {
      usedBuyers.add(best.tid);
      candidates.push({
        player, buyerTid: best.tid, seasons: listing.seasons,
        fee: computeLoanFee(player, ws.season, listing.seasons),
      });
    }
  }

  return candidates.slice(0, LOAN_OFFERS_MAX);
}

/** Accept an AI club's offer to take a listed player on loan. */
export function acceptLoanOffer(league: LeagueStore, pid: number): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;
  const candidate = loanOfferCandidates(league).find((c) => c.player.pid === pid);
  if (!candidate) return league;

  const buyer = league.teams.find((t) => t.tid === candidate.buyerTid);
  if (!buyer || !hasRosterRoom(buyer)) return league;
  const wageCharge = acquisitionWageCharge(league, candidate.player);
  if (candidate.fee + wageCharge > buyer.budget) return league;

  return executeLoan(
    league, pid, league.meta.userTid, candidate.buyerTid, candidate.seasons,
    candidate.fee, ws.season, ws.window,
  );
}

/** Turn down the AI club's offer — it won't be re-offered for this listing this window. */
export function rejectLoanOffer(league: LeagueStore, pid: number): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;
  const candidate = loanOfferCandidates(league).find((c) => c.player.pid === pid);
  if (!candidate) return league;

  const rest = league.loanRejections.filter(
    (r) => !(r.season === ws.season && r.window === ws.window),
  );
  const thisWindow = league.loanRejections.filter(
    (r) => r.season === ws.season && r.window === ws.window,
  );
  return {
    ...league,
    loanRejections: [...rest, ...thisWindow, { pid, buyerTid: candidate.buyerTid, season: ws.season, window: ws.window }],
  };
}

/** Add (or update the duration of) a listing for one of the user's own senior-roster players. */
export function listPlayerForLoan(league: LeagueStore, pid: number, seasons: 1 | 2 | 3): LeagueStore {
  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  if (!user || !keepsDepthFloor(user, playerMap, pid)) return league;
  if (league.activeLoans.some((l) => l.pid === pid)) return league;
  const player = playerMap.get(pid);
  if (!player) return league;
  // Never list a loan his contract can't cover (see maxLoanSeasons). The page
  // caps the duration picker to the same number, so this is the guard behind
  // the UI rather than something the user can walk into. Measured against the
  // window's season, since that is the season the loan would start in (in the
  // offseason that is league.season + 1, not league.season).
  const ws = transferWindowState(league);
  if (loanOutlivesContract(player, ws.open ? ws.season : league.season, seasons)) return league;

  const rest = league.loanListings.filter((l) => l.pid !== pid);
  return { ...league, loanListings: [...rest, { pid, seasons }] };
}

/** Withdraw a listing before any offer is accepted. */
export function unlistPlayerForLoan(league: LeagueStore, pid: number): LeagueStore {
  return { ...league, loanListings: league.loanListings.filter((l) => l.pid !== pid) };
}

export interface AILoanResult {
  teams: StoredTeam[];
  activeLoans: ActiveLoan[];
  transfers: CompletedTransfer[];
}

/**
 * AI↔AI loans, one round per open window: a young, buried player at one AI
 * club moves on a 1-season loan to whichever other
 * AI club values him meaningfully more (LOAN_MIN_SURPLUS). Deterministic
 * given `seed`; the user's club is never a party on either side (loaning the
 * user's own players in/out is a manual action — see loanOfferCandidates /
 * the Loans page).
 *
 * "Buried" is literal, not just a valuation screen: a player in his club's
 * own starting XI is never loaned out, whatever his keep-value — the whole
 * point of a loan is real minutes for a young player who isn't getting them
 * at home, and a starter already is.
 *
 * That was also once claimed to keep Division 2 from hosting a loaned-in star
 * the ceiling sweep can never touch ("a 75+ prospect is starting somewhere").
 * **It does not, and the arithmetic is the giveaway: the ceiling threshold is
 * DIVISION_2_REFUSAL_OVR_THRESHOLD (70), not 75.** A 70-73 under-24 outside a
 * strong club's XI is entirely ordinary. Measured over 12 seasons
 * (scripts/loanCeilingProbe.ts): 0-3 such players per season sitting in tier 2
 * on loan — and they were **100% of all over-threshold tier-2 players**, every
 * season, i.e. the sweep handles owned players perfectly and this was the only
 * remaining hole. It is also the worst kind of hole, because
 * enforceDivisionCeilings *cannot* clean it: it skips loaned pids deliberately
 * (sweeping one would have processLoanReturns hand a copy back to the parent,
 * putting the same pid on two rosters), so each breach sits for the loan's full
 * 1-3 seasons. Hence the explicit tier-2 guard in the buyer loop below.
 */
export function runAILoanMarket(
  teams: StoredTeam[],
  players: Player[],
  activeLoans: ActiveLoan[],
  transfers: CompletedTransfer[],
  season: number,
  played: LeagueStore["played"],
  window: TransferWindowKind,
  userTid: number,
  seed: number,
  competitions: Competition[],
): AILoanResult {
  const contexts = deriveLeagueContexts({ teams, players, season, played, competitions });
  const playerMap = new Map(players.map((p) => [p.pid, p]));
  const jitter = mulberry32(seed);
  const onLoanPids = new Set(activeLoans.map((l) => l.pid));
  const tierByTid = new Map(teams.map((t) => [t.tid, tierOf(competitions, t.compId)]));

  interface Candidate {
    pid: number; sellerTid: number; buyerTid: number; reservation: number; buyerValue: number; surplus: number;
  }
  const candidates: Candidate[] = [];
  for (const seller of teams) {
    if (seller.tid === userTid) continue;
    const sellerCtx = contexts.get(seller.tid);
    if (!sellerCtx) continue;

    // A starter is getting his minutes at home — only players outside the
    // club's starting XI are loan candidates (see the doc comment above).
    const sellerPlayers = seller.roster
      .map((pid) => playerMap.get(pid))
      .filter((p): p is Player => p !== undefined);
    const xiPids = new Set(
      resolveXI(sellerPlayers, teamSlots(seller), seller.starters).map((p) => p.pid),
    );

    for (const pid of seller.roster) {
      if (onLoanPids.has(pid)) continue;
      if (xiPids.has(pid)) continue;
      const player = playerMap.get(pid);
      if (!player) continue;
      if (season - player.born > LOAN_AI_MAX_AGE) continue;
      // Not on a deal that would die while he's away. This is the loop that
      // used to re-loan a player who had already come home on a dead contract,
      // keeping him stale for seasons (docs/player-save-findings.md #2). AI
      // loans are always 1 season, so on a healthy league this only ever
      // matches an already-expired contract — i.e. it is inert going forward
      // and repairs old saves. It sits ahead of the buyer loop's `jitter`
      // draws for that reason: it cannot fire on a league that has no stale
      // contracts left to find.
      if (loanOutlivesContract(player, season, 1)) continue;

      // No availability screen. There used to be one here — skip anyone whose
      // keep-value to his parent exceeded LOAN_AVAILABILITY × his market value —
      // and it made the same category error the permanent market's version made:
      // it compares a club-relative keep value against a club-blind market price.
      // The permanent market's copy excluded every club's best player outright
      // and inverted the country strength ladder (docs/transfer-mobility.md); it
      // was deleted on 2026-08-11 and this one was left in place deliberately, to
      // avoid changing two markets at once, with a comment conceding its
      // justification was "reasoning, not a measurement".
      //
      // Measured (scripts/loanAvailabilityProbe.ts): it excluded ~71% of clubs'
      // best loan-eligible players, median keep/market 1.30. So it was a binding
      // constraint, not the rarely-hit backstop it was argued to be. Protection
      // is by price instead: LOAN_MIN_SURPLUS below still requires the borrower
      // to value him above what he is worth to his parent, which is the sound
      // form of the same question.
      const reservation = keepValueToClub(player, sellerCtx);

      for (const buyer of teams) {
        if (buyer.tid === seller.tid || buyer.tid === userTid) continue;
        const buyerCtx = contexts.get(buyer.tid);
        if (!buyerCtx) continue;
        const value = perceivedValueToClub(player, buyerCtx, jitter);
        // A tier-2 club never takes an at-or-over-threshold player, on loan or
        // otherwise — the same prevention guard the two buy paths carry. It
        // matters more here than there: a bought player the sweep can reclaim
        // next offseason, a loaned one it cannot touch at all (it skips loaned
        // pids, or processLoanReturns would duplicate him onto two rosters), so
        // he sits illegally for the loan's full 1-3 seasons. Measured as 100% of
        // all remaining over-threshold tier-2 residents — see the doc comment.
        //
        // Placed AFTER the jitter draw, like the market's identical guard:
        // skipping the draw for a filtered buyer would shift every subsequent
        // buyer's jitter (the documented RNG-stream-order lesson).
        if (
          player.ovr >= divisionRefusalOvr(tierByTid.get(buyer.tid) ?? 1)
        ) continue;
        // ...and he has to get into their team, which is the whole point of
        // sending him. A loan exists to convert a benched prospect into
        // minutes (progression's `minutesFactor` only bites during growth
        // years), and the surplus test below asks whether the borrower *values*
        // him — not whether it would *play* him, which is a different question.
        // Measured before this gate existed (scripts/loanMinutesProbe.ts, seed
        // 7, 1,110 summer loans followed through a full season): 47% played at
        // all, 31% made the loanee's XI, and the MEDIAN loanee played zero
        // games. The two groups separated almost perfectly on exactly this
        // number — those who never played were a median 16 ovr BELOW the
        // weakest man in the borrower's XI, those who played were 6 above, and
        // only 30 of 592 non-players were better than their new club's worst
        // starter.
        //
        // `posWeakestStarterOvr` is the buy-side fix for the same class of
        // error (posBestOvr assumed one starter per position and left clubs
        // fielding 40-rated full-backs), pointed at loans. A position the
        // borrower's shape leaves short reads 0, so an outright hole always
        // passes — which is right, since an empty slot is a guaranteed game.
        //
        // After the jitter draw, for the same RNG-stream reason as the guard
        // above it.
        if (player.ovr <= buyerCtx.posWeakestStarterOvr[player.pos]) continue;
        if (value < reservation * (1 + LOAN_MIN_SURPLUS)) continue;
        candidates.push({ pid, sellerTid: seller.tid, buyerTid: buyer.tid, reservation, buyerValue: value, surplus: value - reservation });
      }
    }
  }

  candidates.sort((a, b) => b.surplus - a.surplus || a.pid - b.pid || a.buyerTid - b.buyerTid);

  const roster = new Map(teams.map((t) => [t.tid, [...t.roster]]));
  const budget = new Map(teams.map((t) => [t.tid, t.budget]));
  const takes = new Map<number, number>();
  const sends = new Map<number, number>();
  const moved = new Set<number>();
  const newLoans: ActiveLoan[] = [];
  const executed: CompletedTransfer[] = [];

  for (const c of candidates) {
    if (moved.has(c.pid)) continue;
    if ((takes.get(c.buyerTid) ?? 0) >= AI_LOAN_MAX_MOVES) continue;
    if ((sends.get(c.sellerTid) ?? 0) >= AI_LOAN_MAX_MOVES) continue;

    const buyerRoster = roster.get(c.buyerTid)!;
    if (buyerRoster.length >= ROSTER_CAP) continue;

    const sellerRoster = roster.get(c.sellerTid)!;
    if (!sellerRoster.includes(c.pid)) continue;
    if (sellerRoster.length <= ROSTER_SAFETY_FLOOR) continue;
    if (!keepsDepthFloor({ ...teams.find((t) => t.tid === c.sellerTid)!, roster: sellerRoster }, playerMap, c.pid)) {
      continue;
    }

    const player = playerMap.get(c.pid)!;
    const fee = computeLoanFee(player, season, 1);
    if ((budget.get(c.buyerTid) ?? 0) < fee) continue;

    roster.set(c.sellerTid, sellerRoster.filter((p) => p !== c.pid));
    buyerRoster.push(c.pid);
    const sellerTeam = teams.find((t) => t.tid === c.sellerTid)!;
    budget.set(c.sellerTid, clampBudget((budget.get(c.sellerTid) ?? 0) + fee, financeScale(competitions, sellerTeam.compId), sellerTeam.hype));
    budget.set(c.buyerTid, (budget.get(c.buyerTid) ?? 0) - fee);
    moved.add(c.pid);
    takes.set(c.buyerTid, (takes.get(c.buyerTid) ?? 0) + 1);
    sends.set(c.sellerTid, (sends.get(c.sellerTid) ?? 0) + 1);
    newLoans.push({
      pid: c.pid, parentTid: c.sellerTid, loaneeTid: c.buyerTid,
      startSeason: season, seasons: 1, returnSeason: season + 1, fee,
    });
    executed.push({ pid: c.pid, fromTid: c.sellerTid, toTid: c.buyerTid, fee, season, window, loanSeasons: 1 });
  }

  return {
    teams: teams.map((t) => ({ ...t, roster: roster.get(t.tid)!, budget: budget.get(t.tid)! })),
    activeLoans: [...activeLoans, ...newLoans],
    transfers: [...transfers, ...executed],
  };
}
