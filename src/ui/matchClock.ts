/**
 * Turning a match clock reading into something a reader recognises.
 *
 * Shared by the box score and the live viewer deliberately. They already carried
 * two copies of this arithmetic with a comment on each saying they must not
 * drift; that was survivable while it was one `ceil`, and stopped being so the
 * moment a minute could read `45+2`.
 *
 * TWO DIFFERENT NUMBERS LIVE HERE AND CONFLATING THEM IS THE TRAP.
 *
 *  - The PLAYING-TIME minute (`eventMinute`) is a position on a continuous axis
 *    that runs from kickoff to the final whistle with no gaps. Playback walks
 *    it, events sort on it, `liveRatings` reconstructs minutes played from it.
 *    Stoppage is ordinary time on this axis: it is what the players experience.
 *  - The DISPLAYED minute (`matchMinuteLabel`) is what a broadcast shows, where
 *    the clock stops at 45 and 90 and stoppage is counted separately. It is not
 *    a number at all — `45+2` is a label — which is exactly why it must not be
 *    what anything sorts or indexes on.
 *
 * The bridge between them is one value, the first half's stoppage, recorded on
 * the box score. A second-half event sits that far further down the playing-time
 * axis than its displayed minute implies, and without it nothing can tell 45+2
 * from 47.
 */
import type { MatchEvent } from "../engine/attribution.js";
import { MATCH_SECONDS } from "../engine/constants.js";

/** Regulation length in minutes. Stoppage pushes real matches past this. */
export const REGULATION_MINUTES = MATCH_SECONDS / 60;

/** The displayed minute the half-time break falls on. Always 45. */
export const HALF_TIME_MINUTE = REGULATION_MINUTES / 2;

/**
 * The whole minutes a stoppage board shows.
 *
 * The engine already rounds a period's stoppage to a whole minute (see
 * `computeStoppageSeconds`), so this is a conversion rather than a rounding —
 * but it is written to round anyway, because `undefined` has to mean 0 and
 * because a hand-built fixture should not be able to produce a fractional half.
 */
export function stoppageMinutes(seconds: number | undefined): number {
  if (!seconds || seconds <= 0) return 0;
  return Math.round(seconds / 60);
}

/**
 * The playing-time minute a clock reading falls in — the playback axis.
 *
 * The clock counts DOWN from MATCH_SECONDS, so elapsed time is the remainder,
 * and stoppage runs it below zero. Deliberately takes no account of which half
 * it is: this is the continuous axis, and everything that orders, indexes or
 * measures duration wants exactly that.
 */
export function eventMinute(clock: number): number {
  return Math.max(1, Math.ceil((MATCH_SECONDS - clock) / 60));
}

/**
 * The playing-time minute the first half ends on: 45, plus its stoppage.
 *
 * This is where playback should hold for the break, and it is a playing-time
 * minute rather than a displayed one — the break falls at 45+3, which is minute
 * 48 of football.
 */
export function halfTimeMinute(firstHalfStoppage?: number): number {
  return HALF_TIME_MINUTE + stoppageMinutes(firstHalfStoppage);
}

/**
 * What the clock on the wall reads at a given playing-time minute.
 *
 * Exact rather than approximate, and that is what the engine rounding buys: with
 * stoppage a whole number of minutes, every period boundary lands on a minute
 * boundary, so a minute is unambiguously in regulation or in stoppage and no
 * minute straddles the break.
 *
 * A box score with no `firstHalfStoppage` decodes as a first half that had none,
 * which for anything written before 2026-09-10 is the literal truth — that
 * engine played both halves' stoppage together at the end. Those matches read
 * exactly as they always did, except that the tail now says 90+3 rather than 93.
 */
export function matchMinuteLabel(minute: number, firstHalfStoppage?: number): string {
  const h1 = stoppageMinutes(firstHalfStoppage);
  if (minute <= HALF_TIME_MINUTE) return `${minute}'`;
  if (minute <= HALF_TIME_MINUTE + h1) return `${HALF_TIME_MINUTE}+${minute - HALF_TIME_MINUTE}'`;
  const displayed = minute - h1;
  if (displayed <= REGULATION_MINUTES) return `${displayed}'`;
  return `${REGULATION_MINUTES}+${displayed - REGULATION_MINUTES}'`;
}

/** The label for a raw clock reading. The form every event row wants. */
export function formatClock(clock: number, firstHalfStoppage?: number): string {
  return matchMinuteLabel(eventMinute(clock), firstHalfStoppage);
}

/* ---------------------------------------------------------------------------
   Period markers
   --------------------------------------------------------------------------- */

/**
 * The beats a broadcast puts in a timeline that are not events: the fourth
 * official's board, the half-time whistle, full time.
 *
 * DERIVED, never stored. Every one is a pure function of two numbers the box
 * score already carries, so they cost nothing on disk, cannot drift from the
 * match they describe, and appear on saves that predate them — the same argument
 * `trophyNews` and `awardNews` make for not persisting what is already recorded.
 * Adding them as real `MatchEvent`s would have put four more rows on every box
 * score in the game forever, on the largest field in a save.
 *
 * The board rows are also the answer to "how is stoppage worked out": the player
 * watches the number go up, and watches it revised when a late goal is scored.
 */
export interface PeriodMarker {
  /** Clock reading this falls at, so it sorts among the events. */
  clock: number;
  /** Playing-time minute, for playback. */
  minute: number;
  label: string;
  /** The board's number, when this marker is a board. */
  addedMinutes?: number;
}

export function periodMarkers(firstHalfStoppage?: number, finalClock?: number): PeriodMarker[] {
  const h1 = stoppageMinutes(firstHalfStoppage);
  const halfSeconds = MATCH_SECONDS / 2;
  const out: PeriodMarker[] = [];

  // First-half board, at 45:00 exactly. Suppressed when there is nothing to
  // announce — which is every match played before halves became real periods,
  // and where a "+0" row would read as a bug rather than as history.
  if (h1 > 0) {
    out.push({ clock: halfSeconds, minute: HALF_TIME_MINUTE, label: "added", addedMinutes: h1 });
  }
  out.push({ clock: halfSeconds - h1 * 60, minute: HALF_TIME_MINUTE + h1, label: "Half time" });

  if (finalClock !== undefined) {
    // Second-half stoppage is the whistle past the 90, net of the first half's.
    const h2 = stoppageMinutes(-(finalClock + h1 * 60));
    if (h2 > 0) {
      out.push({
        clock: -h1 * 60,
        minute: REGULATION_MINUTES + h1,
        label: "added",
        addedMinutes: h2,
      });
    }
    out.push({ clock: finalClock, minute: eventMinute(finalClock), label: "Full time" });
  }
  return out;
}

/** One row of a match timeline: something that happened, or a beat of the clock. */
export type TimelineItem =
  | { kind: "event"; clock: number; minute: number; event: MatchEvent }
  | { kind: "marker"; clock: number; minute: number; marker: PeriodMarker };

/**
 * Events and period markers as one chronological list.
 *
 * Markers are appended before sorting and the sort is stable, so a marker shares
 * its clock with the events of the minute it closes and lands AFTER them — the
 * board goes up at the end of the 45th minute, not in the middle of it.
 *
 * `throughMinute` is what the live viewer passes to reveal the match a minute at
 * a time; the box score omits it and gets the finished timeline.
 */
export function matchTimeline(
  events: MatchEvent[],
  markers: PeriodMarker[],
  throughMinute?: number,
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events.map((event) => ({
      kind: "event" as const,
      clock: event.clock,
      minute: eventMinute(event.clock),
      event,
    })),
    ...markers.map((marker) => ({
      kind: "marker" as const,
      clock: marker.clock,
      minute: marker.minute,
      marker,
    })),
  ];
  const visible =
    throughMinute === undefined ? items : items.filter((i) => i.minute <= throughMinute);
  // Clock counts down, so descending clock is chronological.
  return visible.sort((a, b) => b.clock - a.clock);
}
