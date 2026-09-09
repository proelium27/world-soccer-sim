import type { Player } from "../players/types.js";
import type { PlayerFieldFilters } from "../players/playerQuery.js";
import {
  hasFieldConstraint, playerMatchesFilters, teamMatchesFilters,
} from "../players/playerQuery.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { LeagueStore } from "../leagueState.js";
import { transferWindowState } from "./window.js";
import {
  departsAtRollover, isForSale, isForSaleOrRefusing, movedThisWindow, scoutedValue, windowSeed,
} from "./negotiation.js";
import { scoutingNoiseSd } from "../finance/scouting.js";
import { resolveXI } from "../lineup/resolveXI.js";
import { teamSlots } from "../lineup/formations.js";
import { mulberry32, gaussian } from "../../engine/rng.js";
import { wouldRefuseExtension } from "../ai/breakoutRefusal.js";
import {
  protectedStarPids, lastCompletedSeason, userProtectedStarBar,
} from "./protectedStars.js";
import { refusesMove } from "./playerWill.js";
import { clubStatures } from "../ai/clubContext.js";
import {
  RECOMMENDED_TRANSFERS_MIN, RECOMMENDED_TRANSFERS_MAX,
  RECOMMENDED_OVR_BELOW, RECOMMENDED_OVR_ABOVE, RECOMMENDED_BAND_WIDEN,
  RECOMMENDED_UPSIDE_WEIGHT, RECOMMENDED_NOISE_OVR_SCALE,
  RECOMMENDED_MAX_PER_POSITION,
  PROTECTED_STAR_OVR, PROTECTED_STAR_TOP_FINISH, difficultyProfile,
} from "../constants.js";

/**
 * Why a protected player can't be bought — and it must not lie. On normal the
 * bar is the world's own, so "his club won't sell" is true. On a harder
 * difficulty the bar has been widened for the user alone (the AI market still
 * trades at the shipped bar), so the same player may well move between two AI
 * clubs; saying the club won't sell would be telling the user something the
 * game is about to contradict. See the DIFFICULTIES block in constants.ts.
 */
function protectedStarReason(difficulty: LeagueStore["difficulty"]): string {
  const profile = difficultyProfile(difficulty);
  const widened =
    profile.protectedStarOvr < PROTECTED_STAR_OVR
    || profile.protectedStarTopFinish > PROTECTED_STAR_TOP_FINISH;
  return widened ? "Not available to you" : "Club won't sell their star";
}

export interface TransferTarget {
  player: Player;
  sellerTid: number;
  /** The scouting department's (noisy) valuation — the baseline for offers. */
  scoutedValue: number;
}

/** Value constraints, split out because they cost a `scoutedValue` call to test. */
export interface PlayerValueFilters {
  minValue?: number | null;
  maxValue?: number | null;
}

/** True when a scouted valuation clears both money constraints. */
function valueMatchesFilters(value: number, f: PlayerValueFilters): boolean {
  if (f.minValue != null && value < f.minValue) return false;
  if (f.maxValue != null && value > f.maxValue) return false;
  return true;
}

/**
 * User-supplied scouting criteria for the recommended list. A pinned `position`
 * also lifts the usual per-position variety cap, so asking for "FB" returns a
 * full list of full-backs rather than the two that would fit in the
 * mixed-position list.
 */
export interface RecommendationFilters extends PlayerFieldFilters, PlayerValueFilters {}

/**
 * The Recommended Transfers list: 5-10 for-sale players of similar overall
 * level to the user's team (an ovr band around the starting-XI average,
 * skewed upward) whose scouted valuation fits the budget. Ranked by how much
 * they'd improve the squad (ovr above team level plus potential headroom),
 * with window-seeded noise scaled by scouting quality — poor scouts shuffle
 * the ranking, good scouts surface the genuinely best targets. Deterministic
 * within a window (and stable across renders) for a given `refreshNonce`;
 * empty when no window is open. The UI's Refresh button bumps the nonce to
 * re-roll the noise and surface a different set of targets on demand.
 *
 * `filters` narrows the candidate pool (see RecommendationFilters) so the
 * search actually re-runs against the constraint — e.g. picking a position
 * surfaces fresh targets at that position rather than filtering the mixed
 * list down to whatever happened to rank in the global top few.
 */
export function recommendedTransfers(
  league: LeagueStore,
  refreshNonce = 0,
  filters: RecommendationFilters = {},
): TransferTarget[] {
  const ws = transferWindowState(league);
  if (!ws.open) return [];

  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!user) return [];

  const posFilter = filters.position || null;

  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  const rosterPlayers = user.roster
    .map((pid) => playerMap.get(pid))
    .filter((p): p is Player => p !== undefined);
  const xi = resolveXI(rosterPlayers, teamSlots(user), user.starters);
  const reference = xi.length === 11 ? xi : rosterPlayers;
  const teamAvg =
    reference.length > 0
      ? reference.reduce((s, p) => s + p.ovr, 0) / reference.length
      : 50;

  // Top clubs' stars from a big season aren't for sale, so they never show up
  // as recommended targets (see protectedStars.ts).
  const protectedPids = protectedStarPids(
    lastCompletedSeason(league), league.teams, league.players, league.competitions, user.tid,
    userProtectedStarBar(league.difficulty),
  );

  // Precomputed once — see clubStatures; calling per player would be quadratic.
  const statures = clubStatures(league.teams, league.players);
  const userStature = statures.get(user.tid) ?? 0;

  // Nor is anyone who has already moved clubs this window — the offer engine
  // would refuse him, and a recommendation it refuses is a dead end.
  const moved = movedThisWindow(league.transfers, ws.season, ws.window);

  const candidates: TransferTarget[] = [];
  for (const team of league.teams) {
    if (team.tid === user.tid) continue;
    // Club-level constraint first, so a league filter skips a whole roster.
    if (!teamMatchesFilters(team, filters)) continue;
    for (const pid of team.roster) {
      const player = playerMap.get(pid);
      if (!player) continue;
      // Hard user constraints — these narrow *which* players the search
      // considers, so changing a filter surfaces a genuinely new list. Checked
      // before the gates below because they're plain field comparisons.
      if (!playerMatchesFilters(player, filters, ws.season)) continue;
      if (moved.has(pid)) continue;
      if (protectedPids.has(pid)) continue;
      // Nor does anyone who'd simply turn this club down (see playerWill.ts) —
      // recommending a target the offer engine will refuse is just a dead end.
      if (refusesMove(player.ovr, statures.get(team.tid) ?? 0, userStature)) continue;
      if (!isForSale(team, playerMap, pid) && !wouldRefuseExtension(player, team, league.competitions)) continue;
      if (departsAtRollover(league, player)) continue;
      const value = scoutedValue(
      league.lid, ws.season, ws.window, player, user.scoutingSpend,
      difficultyProfile(league.difficulty).buyPriceScale,
    );
      if (value > user.budget) continue;
      if (!valueMatchesFilters(value, filters)) continue;
      candidates.push({ player, sellerTid: team.tid, scoutedValue: value });
    }
  }

  const band = (below: number, above: number) =>
    candidates.filter(
      (c) => c.player.ovr >= teamAvg - below && c.player.ovr <= teamAvg + above,
    );
  let pool = band(RECOMMENDED_OVR_BELOW, RECOMMENDED_OVR_ABOVE);
  if (pool.length < RECOMMENDED_TRANSFERS_MIN) {
    pool = band(
      RECOMMENDED_OVR_BELOW + RECOMMENDED_BAND_WIDEN,
      RECOMMENDED_OVR_ABOVE + RECOMMENDED_BAND_WIDEN,
    );
  }
  if (pool.length < RECOMMENDED_TRANSFERS_MIN) pool = candidates;

  const noiseSd = scoutingNoiseSd(user.scoutingSpend);
  const score = (c: TransferTarget): number => {
    const rng = mulberry32(
      windowSeed(league.lid, ws.season, ws.window, c.player.pid, 3 + refreshNonce * 1000),
    );
    return (
      c.player.ovr - teamAvg
      + RECOMMENDED_UPSIDE_WEIGHT * (c.player.potential - c.player.ovr)
      + gaussian(rng) * noiseSd * RECOMMENDED_NOISE_OVR_SCALE
    );
  };

  const ranked = pool
    .map((c) => ({ target: c, score: score(c) }))
    .sort((a, b) => b.score - a.score || a.target.player.pid - b.target.player.pid);

  // Keep the mixed list varied: never more than a couple of targets per
  // position. When the user has pinned a single position, that variety cap
  // makes no sense — they asked for that position, so show a full list of it.
  const maxPerPosition = posFilter ? RECOMMENDED_TRANSFERS_MAX : RECOMMENDED_MAX_PER_POSITION;
  const picked: TransferTarget[] = [];
  const perPosition = new Map<string, number>();
  for (const { target } of ranked) {
    if (picked.length >= RECOMMENDED_TRANSFERS_MAX) break;
    const pos = target.player.pos;
    const count = perPosition.get(pos) ?? 0;
    if (count >= maxPerPosition) continue;
    perPosition.set(pos, count + 1);
    picked.push(target);
  }

  // Variety is a preference, the 5-target minimum is the contract: if the
  // pool was so position-concentrated that the cap cut below it, backfill
  // with the best remaining candidates regardless of position.
  if (picked.length < RECOMMENDED_TRANSFERS_MIN) {
    const pickedPids = new Set(picked.map((t) => t.player.pid));
    for (const { target } of ranked) {
      if (picked.length >= RECOMMENDED_TRANSFERS_MIN) break;
      if (!pickedPids.has(target.player.pid)) picked.push(target);
    }
  }
  return picked;
}

/** Filters for the free-form world player search (all null/""/undefined = "no constraint"). */
export interface PlayerSearchFilters extends PlayerFieldFilters, PlayerValueFilters {
  /** Case-insensitive substring match on the player's name. */
  name?: string;
  /**
   * Drop players their club won't part with, instead of listing them with a
   * reason. Applied in the second pass (it needs the sale gates), so it thins
   * the rows *before* the render cap: a for-sale-only search fills all
   * PLAYER_SEARCH_LIMIT rows with players you can actually bid on rather than
   * spending most of them on the untouchable names at the top of the ovr sort.
   */
  forSaleOnly?: boolean;
}

export interface PlayerSearchResult extends TransferTarget {
  /**
   * Whether an offer would actually be entertained. False when the owning club
   * won't sell (depth floor / protected star) — the same gates `makeTransferOffer`
   * enforces, surfaced up front so the UI can explain instead of no-op'ing.
   */
  forSale: boolean;
  /** Short reason a not-for-sale player can't be bought; null when `forSale`. */
  notForSaleReason: string | null;
}

/** Cap on rendered rows — enough to be useful, not so many the table drags. */
export const PLAYER_SEARCH_LIMIT = 60;

/**
 * Builds the "would this club entertain an offer at all?" test — every sale
 * gate `makeTransferOffer` enforces, in the order it enforces them, returning
 * the reason it would refuse or null if it wouldn't.
 *
 * A factory rather than a plain function because the expensive halves are
 * per-league, not per-player: `protectedStarPids` recomputes last season's
 * standings and `clubStatures` walks every squad in the world. Build it once
 * per pass, then call it per candidate.
 *
 * **Shared on purpose.** Two surfaces ask this question — the transfer search
 * and the watchlist — and they must never answer it differently for the same
 * player, which is exactly what a second copy of these five gates would drift
 * into. Building it is the expensive part, so keep the call site's laziness:
 * `searchWorldPlayers` only builds it once it knows something matched.
 */
export function saleGateFor(
  league: LeagueStore,
  user: StoredTeam,
  playerMap: Map<number, Player>,
): (player: Player, team: StoredTeam) => string | null {
  const loanedPids = new Set(league.activeLoans.map((l) => l.pid));
  // Empty with both windows shut, which is the honest answer: the Watchlist is
  // readable then and nothing is locked, it is simply that nothing can move at
  // all. Whether a window is open is gated at the offer, not here.
  const gateWindow = transferWindowState(league);
  const movedPids = gateWindow.open
    ? movedThisWindow(league.transfers, gateWindow.season, gateWindow.window)
    : new Set<number>();
  const protectedPids = protectedStarPids(
    lastCompletedSeason(league), league.teams, league.players, league.competitions, user.tid,
    userProtectedStarBar(league.difficulty),
  );
  const protectedReason = protectedStarReason(league.difficulty);
  const statures = clubStatures(league.teams, league.players);
  const userStature = statures.get(user.tid) ?? 0;

  return (player, team) => {
    if (loanedPids.has(player.pid)) return "Out on loan";
    // Before the judgement calls below, because this one is a plain fact about
    // what just happened rather than a view his club holds — and it tells the
    // reader something useful, that waiting for the next window is the move.
    if (movedPids.has(player.pid)) return "Just moved clubs this window";
    if (departsAtRollover(league, player)) return "Free agent at season's end";
    if (protectedPids.has(player.pid)) return protectedReason;
    if (!isForSaleOrRefusing(team, playerMap, player.pid, league.competitions)) {
      return "Club needs him for depth";
    }
    // Mirrors makeTransferOffer's playerWill gate, so a player who'd turn the
    // move down says so instead of silently swallowing the offer.
    if (refusesMove(player.ovr, statures.get(team.tid) ?? 0, userStature)) {
      return "Wouldn't drop to a club this size";
    }
    return null;
  };
}

/**
 * Free-form world search: every player on another club's roster, narrowed by
 * `filters` (name and/or the usual numeric constraints), ranked by OVR and
 * capped at PLAYER_SEARCH_LIMIT. Unlike `recommendedTransfers` this applies no
 * ovr-band, budget, or per-position variety cap — you can look up anyone. Each
 * result carries a `forSale` flag mirroring the offer engine's gates
 * (`makeTransferOffer`), so the UI can show why an unbuyable player can't be
 * bid on rather than silently dropping the offer. Empty when no window is open
 * (offers require an open window) or when no filter is set (avoids dumping the
 * whole world).
 */
export function searchWorldPlayers(
  league: LeagueStore,
  filters: PlayerSearchFilters = {},
): PlayerSearchResult[] {
  const ws = transferWindowState(league);
  if (!ws.open) return [];

  const user = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!user) return [];

  const nameQuery = (filters.name ?? "").trim().toLowerCase();

  // Require at least one constraint — an unfiltered search would just list the
  // 60 highest-rated (and mostly unbuyable) players in the world. "For sale
  // only" is deliberately not a constraint on its own: by itself it still
  // describes most of the world.
  const hasConstraint =
    nameQuery !== "" || hasFieldConstraint(filters)
    || filters.minValue != null || filters.maxValue != null;
  if (!hasConstraint) return [];

  const playerMap = new Map(league.players.map((p) => [p.pid, p]));

  // Two passes, because this runs on the interaction path (the user typing in
  // the search box) over every player in the world. Pass 1 applies only the
  // cheap field comparisons; pass 2 does the expensive per-player work —
  // `scoutedValue`, the loan/rollover/protected/depth gates — and stops as soon
  // as the render cap is full. Ranking is by (ovr, pid), which pass 1 already
  // knows, so walking the sorted candidates and stopping at PLAYER_SEARCH_LIMIT
  // yields exactly the same rows as valuing everyone and slicing afterwards —
  // just without valuing the thousands of players that were never going to be
  // shown.
  const candidates: { player: Player; team: StoredTeam }[] = [];
  for (const team of league.teams) {
    if (team.tid === user.tid) continue;
    // Club-level constraint first, so a league filter skips a whole roster.
    if (!teamMatchesFilters(team, filters)) continue;
    for (const pid of team.roster) {
      const player = playerMap.get(pid);
      if (!player) continue;
      if (nameQuery && !player.name.toLowerCase().includes(nameQuery)) continue;
      if (!playerMatchesFilters(player, filters, ws.season)) continue;
      candidates.push({ player, team });
    }
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.player.ovr - a.player.ovr || a.player.pid - b.player.pid);

  // Only built once we know at least one player survived the cheap filters —
  // it recomputes last season's standings, which is wasted on a no-match query.
  const gate = saleGateFor(league, user, playerMap);

  const results: PlayerSearchResult[] = [];
  for (const { player, team } of candidates) {
    if (results.length >= PLAYER_SEARCH_LIMIT) break;
    const value = scoutedValue(
      league.lid, ws.season, ws.window, player, user.scoutingSpend,
      difficultyProfile(league.difficulty).buyPriceScale,
    );
    if (!valueMatchesFilters(value, filters)) continue;

    const notForSaleReason = gate(player, team);

    if (filters.forSaleOnly && notForSaleReason !== null) continue;

    results.push({
      player,
      sellerTid: team.tid,
      scoutedValue: value,
      forSale: notForSaleReason === null,
      notForSaleReason,
    });
  }

  return results;
}
