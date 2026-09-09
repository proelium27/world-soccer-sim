/**
 * Pure derivations behind the live match viewer.
 *
 * A finished match already carries a fully timestamped event stream
 * (`BoxScore.events`, each with the countdown `clock` it happened at), so
 * "watching" a match is replaying that recording — nothing is re-simulated and
 * no rng is touched. Everything here answers the same shape of question: given
 * the stream and a match minute, what had happened by then?
 *
 * Kept free of React so the playback rules can be tested directly.
 */
import type { MatchEvent, MatchEventType } from "../../engine/attribution.js";
import type { MatchScore, PlayedMatch, StandingsRow } from "../../core/standings.js";
import { computeStandings } from "../../core/standings.js";
import { MATCH_SECONDS } from "../../engine/constants.js";

/**
 * The least a match needs to be watchable: two clubs and a timestamped event
 * stream.
 *
 * Deliberately narrower than `PlayedMatch`, because the viewer is fed from four
 * different shapes — a league fixture, a Continental Cup league-phase match, a
 * knockout leg held in `CupState.koLegs`, and a leg split back out of a
 * finished two-legged tie. None of those are `PlayedMatch`es, and only this
 * much is common to all of them.
 */
export interface LiveMatch {
  home: number;
  away: number;
  matchday: number;
  events: MatchEvent[];
}

/** A league fixture as something the viewer can play. */
export function toLiveMatch(m: PlayedMatch): LiveMatch {
  return { home: m.home, away: m.away, matchday: m.matchday, events: m.boxScore.events };
}

/** Regulation length. Stoppage pushes real matches past this. */
export const REGULATION_MINUTES = MATCH_SECONDS / 60;

/** The minute the half-time break falls on. */
export const HALF_TIME_MINUTE = REGULATION_MINUTES / 2;

/**
 * The match minute an event belongs to. The clock counts DOWN from
 * MATCH_SECONDS, so elapsed time is the remainder; stoppage-time events run the
 * clock below zero and so land past 90. Deliberately identical to BoxScore's
 * `formatClock`, or the same event would be labelled differently on the two
 * surfaces.
 */
export function eventMinute(clock: number): number {
  return Math.max(1, Math.ceil((MATCH_SECONDS - clock) / 60));
}

/**
 * The last minute playback has to reach: 90, or later when stoppage ran long.
 * Read off the events rather than assumed, since stoppage length varies with
 * how eventful the half was.
 */
export function finalMinute(events: MatchEvent[]): number {
  let last = REGULATION_MINUTES;
  for (const e of events) {
    const m = eventMinute(e.clock);
    if (m > last) last = m;
  }
  return last;
}

/**
 * Events that had happened by `minute`, oldest first.
 *
 * The engine appends events in chronological order, but this sorts anyway: the
 * feed reads by minute and a single out-of-order entry would show a goal before
 * the shot that scored it.
 */
export function eventsThrough(events: MatchEvent[], minute: number): MatchEvent[] {
  return events
    .filter((e) => eventMinute(e.clock) <= minute)
    // Clock counts down, so descending clock is chronological.
    .sort((a, b) => b.clock - a.clock);
}

export interface LiveScore {
  home: number;
  away: number;
}

/** The scoreline as it stood at `minute`. */
export function scoreAtMinute(events: MatchEvent[], minute: number): LiveScore {
  const score: LiveScore = { home: 0, away: 0 };
  for (const e of events) {
    if (e.type !== "goal") continue;
    if (eventMinute(e.clock) > minute) continue;
    score[e.side]++;
  }
  return score;
}

/**
 * The stats strip.
 *
 * Deliberately excludes xG and possession: neither is on `MatchEvent`. xG lives
 * on the whole-match `PlayerMatchLine`, and possession is a single full-match
 * tick ratio with no minute-by-minute breakdown to read. Showing either live
 * would mean inventing a number we only know the final value of, so both are
 * left to full time, where the box score has them honestly.
 */
export interface LiveTeamStats {
  goals: number;
  shots: number;
  onTarget: number;
  corners: number;
  yellows: number;
  reds: number;
  subs: number;
}

function emptyStats(): LiveTeamStats {
  return { goals: 0, shots: 0, onTarget: 0, corners: 0, yellows: 0, reds: 0, subs: 0 };
}

/** A shot is anything that was struck, on target or not. */
const SHOT_TYPES: ReadonlySet<MatchEventType> = new Set<MatchEventType>([
  "shot_blocked",
  "shot_off_target",
  "shot_saved",
  "goal",
]);

/** On target means it needed keeping out — a save, or a goal. */
const ON_TARGET_TYPES: ReadonlySet<MatchEventType> = new Set<MatchEventType>([
  "shot_saved",
  "goal",
]);

export function statsAtMinute(
  events: MatchEvent[],
  minute: number,
): { home: LiveTeamStats; away: LiveTeamStats } {
  const out = { home: emptyStats(), away: emptyStats() };
  for (const e of events) {
    if (eventMinute(e.clock) > minute) continue;
    const side = out[e.side];
    if (SHOT_TYPES.has(e.type)) side.shots++;
    if (ON_TARGET_TYPES.has(e.type)) side.onTarget++;
    switch (e.type) {
      case "goal":
        side.goals++;
        break;
      case "corner":
        side.corners++;
        break;
      case "yellow_card":
        side.yellows++;
        break;
      case "red_card":
        side.reds++;
        break;
      case "substitution":
        side.subs++;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Split a two-legged tie's merged event stream back into its two legs.
 *
 * `resolveTwoLeggedTie` stores `[...leg1.events, ...leg2.events]` on one box
 * score, and both legs count their clock DOWN from the same 5400 — so replaying
 * the merged stream would cram 180 minutes onto a 90-minute clock and show the
 * score lurching about. The legs are concatenated rather than interleaved,
 * though, so the boundary is the single point where the clock jumps back up.
 *
 * Safe because extra time contributes **no events** (it only updates player
 * lines), so nothing follows leg 2 to confuse the split. A single-leg tie has
 * no such jump and comes back as one leg and an empty second.
 *
 * Note leg 2 is played at the other ground, so its events use the reversed
 * orientation: `side: "home"` there means the tie's *away* club. Callers show
 * leg 2 with the clubs swapped, which is what actually happened.
 */
export function splitTwoLeggedEvents(events: MatchEvent[]): [MatchEvent[], MatchEvent[]] {
  for (let i = 1; i < events.length; i++) {
    if (events[i].clock > events[i - 1].clock) {
      return [events.slice(0, i), events.slice(i)];
    }
  }
  return [events, []];
}

export interface LiveOtherMatch {
  match: LiveMatch;
  score: LiveScore;
  /** True when this match's score changed on exactly this minute, so the rail can flash it. */
  justScored: boolean;
}

/**
 * The score-centre rail: every other match on the matchday as it stood at
 * `minute`. Matches on a matchday kick off together, so they share one clock.
 *
 * Free of extra simulation — each match already carries its own event stream,
 * so this is the same goal count applied across the fixture list.
 */
export function scoresAtMinute(matches: LiveMatch[], minute: number): LiveOtherMatch[] {
  return matches.map((match) => {
    const score = scoreAtMinute(match.events, minute);
    const previous = scoreAtMinute(match.events, minute - 1);
    return {
      match,
      score,
      justScored: score.home !== previous.home || score.away !== previous.away,
    };
  });
}

/**
 * The table as it stands mid-matchday, counting today's in-progress matches at
 * their current score.
 *
 * Provisional by design — a real live table does the same, which is the point:
 * you watch your position move as results land. Before kickoff every match in
 * play counts as a goalless draw, so each club shows a point it hasn't earned
 * yet. That is how live tables read everywhere, and the alternative (hiding
 * today entirely) means the table never moves while you watch.
 */
export function liveTableRows(
  teamIds: number[],
  priorMatches: MatchScore[],
  todayMatches: LiveMatch[],
  minute: number,
  deductions?: ReadonlyMap<number, number>,
): StandingsRow[] {
  const inProgress: MatchScore[] = todayMatches.map((m) => {
    const score = scoreAtMinute(m.events, minute);
    return { home: m.home, away: m.away, homeGoals: score.home, awayGoals: score.away };
  });
  return computeStandings(teamIds, [...priorMatches, ...inProgress], deductions);
}
