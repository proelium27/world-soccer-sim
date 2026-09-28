import type { Player } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { LeagueStore } from "../leagueState.js";
import type { Competition } from "../competitions.js";
import type { SeasonHistoryEntry } from "../standings.js";
import {
  PROTECTED_STAR_OVR, PROTECTED_STAR_TOP_FINISH, difficultyProfile, type Difficulty,
} from "../constants.js";

/**
 * "Protected star" not-for-sale gate. A top club simply won't sell its best
 * player at any price, so rather than pricing such a player into the
 * stratosphere we take him off the market entirely — no asking price at all.
 *
 * A player is protected when BOTH halves hold, keyed on the season that just
 * ended:
 *   1. His club had a *big season* — finished in the top PROTECTED_STAR_TOP_FINISH
 *      of a tier-1 league (a strong second-division finish doesn't count).
 *   2. He was *one of the best in the world* — either OVR ≥ PROTECTED_STAR_OVR,
 *      or he won an individual honor last season (Player of the Season, Golden
 *      Boot, or a Team of the Season place, in any league).
 *
 * The gate is deliberately data-driven (it takes a completed-season record, not
 * the live league) because it's consulted in two different moments: during the
 * regular season / winter window the record is the last entry in
 * `seasonHistory`, but the offseason summer market runs *before* that entry is
 * appended, so its caller passes the freshly-computed standings directly.
 */

/** The subset of a completed season's record this gate reads. */
export type CompletedSeasonInfo = Pick<
  SeasonHistoryEntry,
  "table" | "awards" | "compsByTid"
>;

/** The most recently completed season, or null before any season has finished. */
export function lastCompletedSeason(
  league: Pick<LeagueStore, "seasonHistory">,
): CompletedSeasonInfo | null {
  const h = league.seasonHistory;
  return h.length > 0 ? h[h.length - 1] : null;
}

/** True if the player won any individual honor in the given completed season. */
function wonHonorLastSeason(last: CompletedSeasonInfo, pid: number): boolean {
  for (const a of Object.values(last.awards)) {
    if (a.playerOfSeasonPid === pid) return true;
    if (a.goldenBootPid === pid) return true;
    if (a.teamOfSeason.includes(pid)) return true;
  }
  return false;
}

/** The club's finishing rank (0-based) within its own competition last season, or -1. */
function finishingRank(last: CompletedSeasonInfo, tid: number): number {
  const compId = last.compsByTid[tid];
  if (compId === undefined) return -1;
  // The stored table concatenates each competition's already-sorted block, so
  // filtering to this club's competition preserves finishing order.
  const compRows = last.table.filter((r) => last.compsByTid[r.tid] === compId);
  return compRows.findIndex((r) => r.tid === tid);
}

/**
 * How wide the gate is. Defaults to the shipped constants, which is what every
 * AI↔AI caller uses and must keep using: widening it world-wide would cut
 * market volume, and the weak leagues run on transfer receipts (see the
 * DIFFICULTIES block in constants.ts). Only the user-facing call sites pass a
 * difficulty-adjusted bar, so a hard level narrows what the *user* can buy
 * without touching how the world trades.
 */
export interface ProtectedStarBar {
  ovr: number;
  topFinish: number;
}

const DEFAULT_BAR: ProtectedStarBar = {
  ovr: PROTECTED_STAR_OVR,
  topFinish: PROTECTED_STAR_TOP_FINISH,
};

/**
 * Whether `player`, currently on club `tid`, is a protected star — off the
 * market because his club had a big season last season and he's world-class.
 * `last` is the just-completed season's record (null before season 1 ends).
 */
export function isProtectedStar(
  last: CompletedSeasonInfo | null,
  competitions: Competition[],
  tid: number,
  player: Player,
  bar: ProtectedStarBar = DEFAULT_BAR,
): boolean {
  if (!last) return false;
  const compId = last.compsByTid[tid];
  if (compId === undefined) return false;
  // Only top-flight success protects a player — a second-division title isn't
  // the kind of season that takes a star off the market.
  // A competition God Mode has since removed isn't in the live table; none of
  // its clubs can be a top-flight side now (see core/worldRestructure.ts).
  const comp = competitions.find((c) => c.id === compId);
  if (!comp || comp.tier !== 1) return false;
  const rank = finishingRank(last, tid);
  if (rank < 0 || rank >= bar.topFinish) return false;
  return player.ovr >= bar.ovr || wonHonorLastSeason(last, player.pid);
}

/** The gate as the user sees it on this save's difficulty. */
export function userProtectedStarBar(difficulty: Difficulty | undefined): ProtectedStarBar {
  const profile = difficultyProfile(difficulty);
  return { ovr: profile.protectedStarOvr, topFinish: profile.protectedStarTopFinish };
}

/**
 * All pids currently protected across every AI club. The user's own club is
 * excluded — the user always controls their own sales. Computed once and
 * membership-tested by the market / recommendation paths.
 */
export function protectedStarPids(
  last: CompletedSeasonInfo | null,
  teams: StoredTeam[],
  players: Player[],
  competitions: Competition[],
  userTid: number,
  bar: ProtectedStarBar = DEFAULT_BAR,
): Set<number> {
  const set = new Set<number>();
  if (!last) return set;
  const playerMap = new Map(players.map((p) => [p.pid, p]));
  for (const team of teams) {
    if (team.tid === userTid) continue;
    for (const pid of team.roster) {
      const player = playerMap.get(pid);
      if (player && isProtectedStar(last, competitions, team.tid, player, bar)) set.add(pid);
    }
  }
  return set;
}
