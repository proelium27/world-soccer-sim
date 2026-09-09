/**
 * The loan market from the borrowing side: which of the world's players another
 * club would let the user take on loan, and the action that takes one.
 *
 * This is to `loans.ts` what `transfers/recommendations.ts` is to
 * `transfers/negotiation.ts` — a read-only browse layer over mechanics that
 * already exist. Nothing here invents a new kind of loan: a request that clears
 * the gate goes straight through `executeLoan`, so the fee, the wage handoff,
 * the transfer record and the automatic return at `returnSeason` are the same
 * ones an AI↔AI loan or a user loan-out uses.
 *
 * **Who is loanable is defined once, in `runAILoanMarket`, and mirrored here.**
 * A parent club parts with a player on loan when he is young
 * (LOAN_AI_MAX_AGE), sitting outside its own starting XI, on a deal that covers
 * the loan, and the borrower values him meaningfully more than it does
 * (LOAN_MIN_SURPLUS). Those are not four arbitrary screens — together they are
 * what a loan *is* in this game: minutes for a prospect who isn't getting them
 * at home. The user gets the same market on the same terms, which is the whole
 * change; nothing about the AI's half moves.
 */
import type { Player } from "./players/types.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { LeagueStore } from "./leagueState.js";
import type { PlayerFieldFilters } from "./transfers/recommendations.js";
import { playerMatchesFilters, teamMatchesFilters } from "./transfers/recommendations.js";
import { transferWindowState } from "./transfers/window.js";
import { acquisitionWageCharge, hasRosterRoom } from "./transfers/negotiation.js";
import {
  computeLoanFee, executeLoan, loanOutlivesContract, maxLoanSeasons,
} from "./loans.js";
import { keepsDepthFloor } from "./freeAgency.js";
import { resolveXI } from "./lineup/resolveXI.js";
import { teamSlots } from "./lineup/formations.js";
import { deriveLeagueContexts } from "./ai/clubContext.js";
import { keepValueToClub, valueToClub } from "./ai/evaluate.js";
import {
  LOAN_AI_MAX_AGE, LOAN_DURATION_MULTIPLIER, LOAN_FEE_MIN, LOAN_IN_MAX_PER_WINDOW,
  LOAN_MIN_SURPLUS, ROSTER_SAFETY_FLOOR, difficultyProfile,
} from "./constants.js";

/**
 * What a loan costs the **user**, as against `computeLoanFee`'s club-blind
 * figure. Two corrections, both user-facing price rules rather than changes to
 * the market:
 *
 *  - the difficulty's `buyPriceScale`, exactly as `reservationPrice` and
 *    `scoutedValue` take it on the buy side. Without it a loan is the one
 *    acquisition route that ignores the difficulty entirely, so Brutal makes
 *    buying 1.6x dearer and borrowing free — see the constant's own note about
 *    a figure that ignores the tax reading as a bug rather than a difficulty.
 *  - `LOAN_FEE_MIN`, because `trueTransferValue` is exactly 0 below
 *    `VALUATION_OVR_FLOOR` and a fee is a fraction of it, so more than half the
 *    world would otherwise be free to borrow.
 *
 * **The floor is taken first and the difficulty scaled over the top of it**, so
 * the markup reaches the whole range. Scaling only the computed half leaves the
 * floor flat, and since the floor is what binds for the ~55% of the world that
 * values at 0, difficulty would be inert for most of the pool while the Manual
 * and the changelog both say it applies.
 *
 * **One definition, used by the row, the affordability gate and the charge.** A
 * quoted fee that isn't the fee actually taken out of the budget is the same
 * class of bug as a button the action refuses.
 */
export function userLoanFee(
  league: LeagueStore,
  player: Player,
  season: number,
  seasons: 1 | 2 | 3,
): number {
  const scale = difficultyProfile(league.difficulty).buyPriceScale;
  const beforeDifficulty = Math.max(
    LOAN_FEE_MIN * LOAN_DURATION_MULTIPLIER[seasons],
    computeLoanFee(player, season, seasons),
  );
  return Math.round(beforeDifficulty * scale);
}

/** One borrowable player, with what a loan of a given length would cost. */
export interface LoanTarget {
  player: Player;
  /** The club that owns him — the one paid the fee and the one he returns to. */
  parentTid: number;
  /** Longest loan his contract can cover, 1..LOAN_MAX_SEASONS. Always >= 1 here. */
  maxSeasons: number;
  /** Fee for a loan of `seasons`, the length this row was priced at. */
  fee: number;
  /** True when a request at `seasons` would go through right now. */
  available: boolean;
  /** Short reason a request would be refused; null when `available`. */
  unavailableReason: string | null;
}

/** Cap on rendered rows. The borrowable pool is far narrower than the transfer market's. */
export const LOAN_SEARCH_LIMIT = 40;

/** Filters for the loan search — the shared field constraints, plus a name box. */
export interface LoanSearchFilters extends PlayerFieldFilters {
  /** Case-insensitive substring match on the player's name. */
  name?: string;
  /** Drop rows a request would be refused on, instead of listing them with a reason. */
  availableOnly?: boolean;
}

/**
 * Loans the user has already agreed this window. Derived from the transfer log
 * rather than stored: `executeLoan` records every loan with `loanSeasons` and
 * the window it was agreed in, so the count is already in the save and there is
 * no field to migrate. Loan *returns* carry `loanReturn` and no `loanSeasons`,
 * so they can't be miscounted as new deals.
 */
export function loansTakenThisWindow(league: LeagueStore): number {
  const ws = transferWindowState(league);
  if (!ws.open) return 0;
  return league.transfers.filter(
    (t) => t.toTid === league.meta.userTid && t.loanSeasons != null
      && t.season === ws.season && t.window === ws.window,
  ).length;
}

/**
 * Is this player borrowable at all? The three screens that define the pool
 * rather than merely price it — he must be young, unowned by another loan, and
 * out of his club's starting XI. Separated from `loanGateFor` because these are
 * cheap and answer "is he in this market", where the gate answers "would this
 * particular deal be agreed"; the search uses the first to build a list worth
 * reading and the second to explain each row.
 */
interface PoolContext {
  onLoan: Set<number>;
  /** Lazily-built per club, since resolveXI over 600-odd squads is not free. */
  xiOf: (team: StoredTeam) => Set<number>;
  season: number;
}

function poolContext(league: LeagueStore, season: number): PoolContext {
  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  const cache = new Map<number, Set<number>>();
  return {
    onLoan: new Set(league.activeLoans.map((l) => l.pid)),
    season,
    xiOf: (team) => {
      const hit = cache.get(team.tid);
      if (hit) return hit;
      const squad = team.roster
        .map((pid) => playerMap.get(pid))
        .filter((p): p is Player => p !== undefined);
      const xi = new Set(resolveXI(squad, teamSlots(team), team.starters).map((p) => p.pid));
      cache.set(team.tid, xi);
      return xi;
    },
  };
}

function inPool(player: Player, team: StoredTeam, ctx: PoolContext): boolean {
  if (ctx.onLoan.has(player.pid)) return false;
  if (ctx.season - player.born > LOAN_AI_MAX_AGE) return false;
  // A starter is already getting his minutes — the same rule runAILoanMarket
  // applies, and the reason it is a pool filter rather than a per-row reason:
  // without it the list is simply the world's best young players, none of whom
  // are going anywhere, and the loan market is invisible underneath them.
  if (ctx.xiOf(team).has(player.pid)) return false;
  return maxLoanSeasons(player, ctx.season) >= 1;
}

/**
 * Builds "would this club agree to lend him to us, for this long, right now?"
 * — every condition `requestLoan` enforces, in the order it enforces them,
 * returning the reason it would refuse or null if it wouldn't.
 *
 * A factory for the same reason `saleGateFor` is one: the expensive halves are
 * per-league, not per-player (`deriveLeagueContexts` walks every squad in the
 * world). Build once per pass, then call per candidate.
 *
 * **Shared on purpose.** The search's row state and the action's decision must
 * never disagree for the same player — a "Request loan" button that the action
 * then silently refuses is the failure this shape exists to prevent.
 */
export function loanGateFor(
  league: LeagueStore,
  user: StoredTeam,
  season: number,
): ((player: Player, team: StoredTeam, seasons: 1 | 2 | 3) => string | null) | null {
  const contexts = deriveLeagueContexts({
    teams: league.teams, players: league.players, season: league.season,
    played: league.played, competitions: league.competitions,
  });
  const userCtx = contexts.get(user.tid);
  if (!userCtx) return null;

  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  const atCap = loansTakenThisWindow(league) >= LOAN_IN_MAX_PER_WINDOW;

  return (player, team, seasons) => {
    // The user's own situation first. These two are true of *every* row, so
    // checked last they never surface: the list is ranked by overall and its
    // top rows are refused on price long before anything about the user is
    // reached, which left a full squad reading as forty clubs rating their
    // players too highly. A reason the user can act on outranks one he can't.
    if (!hasRosterRoom(user)) return "Your squad is full";
    if (atCap) return `You've agreed ${LOAN_IN_MAX_PER_WINDOW} loans this window`;

    if (loanOutlivesContract(player, season, seasons)) {
      const most = maxLoanSeasons(player, season);
      return most === 0
        ? "His contract runs out first"
        : `His contract only covers ${most} season${most > 1 ? "s" : ""}`;
    }
    // The parent has to be able to spare him — the same two floors that stop an
    // AI club lending itself into an unfieldable squad.
    if (team.roster.length <= ROSTER_SAFETY_FLOOR) return "His club is too short of bodies";
    if (!keepsDepthFloor(team, playerMap, player.pid)) return "His club needs him for depth";

    const parentCtx = contexts.get(team.tid);
    if (!parentCtx) return "His club won't discuss it";
    // Protection by price, exactly as on the AI's side of the market: he moves
    // only to a club he is worth meaningfully more to. No club-blind market
    // price is involved — comparing a club-relative keep value against one is
    // the category error that inverted the strength ladder (see loans.ts).
    // He has to be getting a game, because that is what his club is lending him
    // for. Same rule the AI half enforces (see runAILoanMarket), and it has to
    // apply here too or the user is offered a deal no AI club could get — one
    // that leaves the player exactly as benched as he already was, which is the
    // opposite of why his club agreed. It also does the work an arbitrary
    // minimum-value floor would have done on the list, and does it on the
    // principle rather than on a number: the players it drops are the ones who
    // would sit in your reserves.
    //
    // BEFORE the price test, and that is a copy decision rather than a
    // behavioural one — a strong club fails both, and "he wouldn't get a game"
    // is about the user's own squad and explains the short list, where "his
    // club rates him too highly" is about somebody else and reads as bad luck.
    // A player who really is only blocked on price still says so, since he
    // passes this one.
    if (player.ovr <= userCtx.posWeakestStarterOvr[player.pos]) {
      return "He wouldn't get a game with you";
    }

    const reservation = keepValueToClub(player, parentCtx);
    if (valueToClub(player, userCtx) < reservation * (1 + LOAN_MIN_SURPLUS)) {
      return "His club rates him too highly to lend";
    }

    // Last, because it's the only user-side check that depends on the player.
    // A club in the red therefore still can't surface it on an overall-ranked
    // list, whose top rows fail on price first — the page says that once, above
    // the table, rather than leaving the user's own finances invisible.
    const cost = userLoanFee(league, player, season, seasons) + acquisitionWageCharge(league, player);
    if (cost > user.budget) return "You can't afford the fee";
    return null;
  };
}

/**
 * Every player another club would consider lending, narrowed by `filters` and
 * ranked by overall. Each row is priced and gated at `seasons`, the length the
 * caller is asking about, since both the fee and the contract check depend on
 * it. Empty when no window is open — a loan is a transfer-window action.
 *
 * Unlike `searchWorldPlayers` this needs no constraint to return anything: the
 * pool is already narrow by construction (young, benched, lendable), so an
 * unfiltered list is the loan market rather than a dump of the world.
 */
export function searchLoanTargets(
  league: LeagueStore,
  seasons: 1 | 2 | 3 = 1,
  filters: LoanSearchFilters = {},
): LoanTarget[] {
  const ws = transferWindowState(league);
  if (!ws.open) return [];

  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!user) return [];

  const nameQuery = (filters.name ?? "").trim().toLowerCase();
  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  const pool = poolContext(league, ws.season);

  // Two passes, like the transfer search and for the same reason: this runs on
  // the user's keystroke path over every roster in the world. Pass 1 is the
  // cheap field comparisons plus the pool screens; pass 2 does the valuations
  // and stops as soon as the render cap is full. Ranking is by (ovr, pid),
  // which pass 1 already knows, so stopping early yields exactly the rows a
  // value-everyone-then-slice would.
  const candidates: { player: Player; team: StoredTeam }[] = [];
  for (const team of league.teams) {
    if (team.tid === user.tid) continue;
    if (!teamMatchesFilters(team, filters)) continue;
    for (const pid of team.roster) {
      const player = playerMap.get(pid);
      if (!player) continue;
      if (nameQuery && !player.name.toLowerCase().includes(nameQuery)) continue;
      if (!playerMatchesFilters(player, filters, ws.season)) continue;
      if (!inPool(player, team, pool)) continue;
      candidates.push({ player, team });
    }
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.player.ovr - a.player.ovr || a.player.pid - b.player.pid);

  // Only built once something survived the cheap pass — it derives a context
  // for every club in the world, which is wasted on a no-match query.
  const gate = loanGateFor(league, user, ws.season);
  if (!gate) return [];

  const results: LoanTarget[] = [];
  for (const { player, team } of candidates) {
    if (results.length >= LOAN_SEARCH_LIMIT) break;
    const reason = gate(player, team, seasons);
    if (filters.availableOnly && reason !== null) continue;
    results.push({
      player,
      parentTid: team.tid,
      maxSeasons: maxLoanSeasons(player, ws.season),
      fee: userLoanFee(league, player, ws.season, seasons),
      available: reason === null,
      unavailableReason: reason,
    });
  }
  return results;
}

/**
 * Take a player on loan. Re-runs the same gate the search showed — the list may
 * be a render old, and the roster/budget/window-cap halves of it move as the
 * user acts — and refuses by returning the league unchanged, the convention
 * every action in this layer follows.
 */
export function requestLoan(league: LeagueStore, pid: number, seasons: 1 | 2 | 3): LeagueStore {
  const ws = transferWindowState(league);
  if (!ws.open) return league;

  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  const player = league.players.find((p) => p.pid === pid);
  const parent = league.teams.find((t) => t.tid !== league.meta.userTid && t.roster.includes(pid));
  if (!user || !player || !parent) return league;

  const pool = poolContext(league, ws.season);
  if (!inPool(player, parent, pool)) return league;

  const gate = loanGateFor(league, user, ws.season);
  if (!gate || gate(player, parent, seasons) !== null) return league;

  return executeLoan(
    league, pid, parent.tid, user.tid, seasons,
    userLoanFee(league, player, ws.season, seasons), ws.season, ws.window,
  );
}

