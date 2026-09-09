import type { ActiveLoan } from "./loans.js";

/**
 * Who is on a club's roster without belonging to it.
 *
 * A roster holding a player the club does not own only became reachable when
 * the user could borrow, and several club actions quietly assume ownership:
 * releasing him, listing him for sale, extending his contract, fielding an
 * offer for him. Every one of those has to ask this question, so it is asked
 * in one place.
 *
 * **Its own module, and not `loans.ts`, because of a cycle.** `loans.ts`
 * imports `keepsDepthFloor` from `freeAgency.ts`, and `freeAgency.ts` is one
 * of the callers here — a runtime import back into `loans.ts` would close the
 * loop. Nothing here needs anything but the `ActiveLoan` shape, and that is a
 * type-only import, so this module sits under all of them.
 *
 * Both take `ActiveLoan[]` rather than a `LeagueStore`, because two of the
 * callers (`releasePlayer`, the AI paths) never hold a league.
 */

/** True when `pid` is on `tid`'s roster on loan from someone else. */
export function isBorrowed(activeLoans: ActiveLoan[], tid: number, pid: number): boolean {
  return activeLoans.some((l) => l.pid === pid && l.loaneeTid === tid && l.parentTid !== tid);
}

/** The pids on `tid`'s roster it does not own — everyone it has in on loan. */
export function borrowedPids(activeLoans: ActiveLoan[], tid: number): Set<number> {
  return new Set(
    activeLoans.filter((l) => l.loaneeTid === tid && l.parentTid !== tid).map((l) => l.pid),
  );
}
