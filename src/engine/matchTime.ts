/**
 * Minutes played, counted the way football counts them.
 *
 * The match clock a box score reports holds at 45:00 through first-half stoppage
 * and at 90:00 through second-half stoppage, so a player who plays the whole
 * match has played 90 minutes — not 90 plus however long the referee added.
 * That is the convention every stats provider uses and the one per-90 already
 * assumed: `per90QualifyingMinutes` budgets 90 minutes a match, while stored
 * minutes counted stoppage, so every per-90 rate in the game read about 7% low
 * and the box score's MIN column read 97, then 103 once halves became periods.
 *
 * ONE implementation, imported by both the engine (`minutesFor` at full time,
 * `liveMinutesFor` mid-match) and the live viewer (`liveRatings`, which has to
 * reproduce the stored figure exactly). Three hand-kept copies of this arithmetic
 * is how the live rating came to disagree with the box score beside it once
 * already; see liveRatings.ts.
 *
 * The in-match half matters as much as the stored one. `liveMinutesFor` feeds the
 * live match rating that `subPriority` and the bench gate read, and counting
 * playing time there made a starter at the 60th minute read 60 PLUS the first
 * half's stoppage — so inserting first-half stoppage quietly loosened the rating
 * damping behind every second-half substitution. On the match clock he is at 60,
 * which is exactly what the merge base read.
 */
import { HALF_SECONDS, MATCH_SECONDS } from "./constants.js";

/**
 * Where a clock reading sits on the MATCH clock, in seconds from kickoff.
 *
 * `firstHalfStoppage` is the first half's board in seconds. Mid-match it is 0
 * until that board goes up, which is harmless: every reading before then is in
 * first-half regulation, where it is not consulted.
 */
export function matchSecondsAt(clock: number, firstHalfStoppage: number): number {
  const elapsed = MATCH_SECONDS - clock;
  if (elapsed <= HALF_SECONDS) return Math.max(0, elapsed);
  // First-half stoppage: the clock on the wall holds at 45:00.
  if (elapsed <= HALF_SECONDS + firstHalfStoppage) return HALF_SECONDS;
  // Second half, net of the stoppage already played; holds at 90:00 after that.
  return Math.min(MATCH_SECONDS, elapsed - firstHalfStoppage);
}

/**
 * Whole match minutes between two clock readings. Rounds the DURATION, never the
 * endpoints — the same rule `minutesFor` has always used, for the reason
 * liveRatings.ts spells out.
 */
export function matchMinutesBetween(
  enterClock: number,
  exitClock: number,
  firstHalfStoppage: number,
): number {
  const played = matchSecondsAt(exitClock, firstHalfStoppage) - matchSecondsAt(enterClock, firstHalfStoppage);
  return Math.max(0, Math.round(played / 60));
}
