/**
 * Saying which club jobs you'd like.
 *
 * An interest is a note to the offer generator, not an application: it gives
 * that club its own roll each offseason if you're good enough for it (see
 * `interestReach`), and nothing else. So the only rules here are the ones that
 * keep the list meaningful — a real club, not your own, and a short list.
 *
 * Pure, and it touches no rng stream.
 */
import type { LeagueStore } from "../leagueState.js";
import { MANAGER_MAX_INTERESTS } from "../constants.js";
import type { ManagerState } from "./types.js";

/** The clubs the user has asked about. Absent on every save that predates the feature. */
export function clubInterests(manager: ManagerState): number[] {
  return manager.interests ?? [];
}

/**
 * Add or remove a club from the list. Returns null when nothing changes —
 * already on it, not on it, your own club, a tid the save doesn't know, or the
 * list already full — so the caller writes nothing.
 */
export function setClubInterest(league: LeagueStore, tid: number, on: boolean): LeagueStore | null {
  const current = clubInterests(league.manager);
  let next: number[];
  if (on) {
    if (current.includes(tid)) return null;
    if (tid === league.meta.userTid) return null;
    if (!league.teams.some((t) => t.tid === tid)) return null;
    if (current.length >= MANAGER_MAX_INTERESTS) return null;
    next = [...current, tid];
  } else {
    if (!current.includes(tid)) return null;
    next = current.filter((t) => t !== tid);
  }
  return { ...league, manager: { ...league.manager, interests: next } };
}

export type InterestOutlook = "within-reach" | "long-shot" | "out-of-reach";

/** A reach from `interestReach` in words the page can show. */
export function interestOutlook(reach: number): InterestOutlook {
  if (reach >= 1) return "within-reach";
  if (reach > 0) return "long-shot";
  return "out-of-reach";
}
