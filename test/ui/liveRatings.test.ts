import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
import type { BoxScore, MatchPlayer, MatchPosition } from "../../src/engine/attribution.js";
import { emptyLine } from "../../src/engine/attribution.js";
import { computeMatchRating } from "../../src/engine/matchRating.js";
import { FORMATIONS } from "../../src/core/lineup/formations.js";
import { matchLineups } from "../../src/ui/live/lineups.js";
import { liveMatchState } from "../../src/ui/live/liveRatings.js";
import { finalMinute } from "../../src/ui/live/liveMatch.js";

/**
 * The claim this file exists to pin: a live rating is EXACT, not an estimate.
 *
 * Every input `computeMatchRating` reads is recoverable from the event stream,
 * so replaying the stream to the final whistle has to reproduce the rating the
 * engine stored on the box score. If that ever stops being true — someone
 * forks INTERCEPTION_WEIGHT away from TACKLE_WEIGHT, or adds a rating term
 * built on a stat the events don't carry — this is what says so, rather than
 * the numbers quietly drifting apart on screen.
 *
 * Run over several seeds because a single match need not contain a red card, a
 * penalty or a keeper who was ever tested.
 */

function player(pid: number, slot: MatchPosition): MatchPlayer {
  return {
    pid,
    pos: slot,
    slot,
    secondary: [],
    ovr: 62,
    shooting: slot === "ST" || slot === "W" ? 75 : 40,
    dribbling: 55,
    tackling: slot === "CB" || slot === "DM" ? 70 : 45,
    keeping: slot === "GK" ? 80 : 5,
    positioning: 55,
    heading: 55,
    // Low, so substitutions actually happen — an unsubbed match would never
    // exercise the half of the derivation that tracks who is on the pitch.
    stamina: 12,
    interceptions: 55,
    passing: 50,
  };
}

function xi(pidBase: number, formation: keyof typeof FORMATIONS): MatchPlayer[] {
  return (FORMATIONS[formation] as MatchPosition[]).map((slot, i) => player(pidBase + i, slot));
}

function bench(pidBase: number): MatchPlayer[] {
  return (["GK", "CB", "FB", "CM", "W", "ST"] as MatchPosition[]).map((slot, i) =>
    player(pidBase + i, slot),
  );
}

function playedMatch(seed: number): BoxScore {
  return simMatchDetailed(
    mulberry32(seed),
    makeTeam("Home"),
    makeTeam("Away"),
    xi(100, "4-3-3"),
    xi(200, "4-4-2"),
    bench(150),
    bench(250),
  ).boxScore;
}

const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88];
const MATCHES = SEEDS.map(playedMatch);

/**
 * The match as it stood at the final whistle.
 *
 * `finalClock` has to reach BOTH calls, and that is why this is a helper rather
 * than each case spelling it out. Stoppage runs on past the last event, so
 * reading the end off the events alone stops the clock short — measured, by up
 * to two minutes — and a player still on the pitch is then credited with fewer
 * minutes than the engine gave him. The rating is damped by minutes, so it
 * comes out wrong.
 */
function atFullTime(box: BoxScore, lineups = matchLineups(box)) {
  const last = finalMinute(box.events, box.finalClock);
  // `firstHalfStoppage` too, for the same reason as `finalClock`: minutes are
  // counted on the match clock, which holds through stoppage, so without it the
  // derivation falls back to the legacy playing-time rule and credits every
  // player with the stoppage the engine no longer counts.
  return liveMatchState(lineups, box.events, last, box.finalClock, box.firstHalfStoppage);
}

/**
 * The assumption the whole derivation rests on, asserted where it can say so.
 *
 * A `turnover` event names who won the ball but not whether it was a tackle or
 * an interception, so liveRatings credits every one as a tackle. That is only
 * sound while the rating weighs the two identically — matchRating.ts aliases
 * INTERCEPTION_WEIGHT to TACKLE_WEIGHT and its comment asks anyone changing
 * that to fork the line deliberately.
 *
 * The full-time equality below would catch a fork too, but it would report it
 * as "expected 6.8 to be 6.9" and leave the reader to work out why. This says
 * it in the test name.
 */
describe("the rating cannot tell a tackle from an interception", () => {
  it("scores them identically at every position, which is what lets a turnover count as either", () => {
    const positions: MatchPosition[] = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];
    for (const pos of positions) {
      const tackled = { ...emptyLine(1), tackles: 4 };
      const intercepted = { ...emptyLine(1), interceptions: 4 };
      expect(computeMatchRating(tackled, pos, 90, 1), pos).toBe(
        computeMatchRating(intercepted, pos, 90, 1),
      );
    }
  });
});

describe("a live rating at full time is the rating the engine stored", () => {
  it("agrees for every player of every match, to the decimal", () => {
    let checked = 0;
    for (const box of MATCHES) {
      const lineups = matchLineups(box);
      const state = atFullTime(box, lineups);
      for (const side of ["home", "away"] as const) {
        const stored = new Map(box[side].map((l) => [l.pid, l]));
        for (const live of state[side].all) {
          const line = stored.get(live.pid);
          expect(line, `pid ${live.pid} is missing from the box score`).toBeDefined();
          // Minutes are asserted directly, because the rating is a far weaker
          // gate on them than it looks: it damps by minutes on a curve that is
          // flat near 90, so a wrong figure only moves the rounded rating when
          // the player sits on the steep part of it. Measured when this was
          // found, 140 wrong minute figures were surfacing as 6 wrong ratings —
          // so the ratings alone would let a one-minute error back in
          // everywhere except the handful of cases that cross a 0.05 boundary.
          expect(live.minutesPlayed, `minutes, pid ${live.pid}`).toBe(line!.minutesPlayed);
          expect(live.rating, `pid ${live.pid}`).toBe(line!.rating);
          checked++;
        }
      }
    }
    // Guard against the test passing by checking nothing.
    expect(checked).toBeGreaterThan(200);
  });

  it("recovered every goal, assist and card the box score recorded", () => {
    for (const box of MATCHES) {
      const state = atFullTime(box);
      for (const side of ["home", "away"] as const) {
        const stored = new Map(box[side].map((l) => [l.pid, l]));
        for (const live of state[side].all) {
          const line = stored.get(live.pid)!;
          expect(live.goals, `goals, pid ${live.pid}`).toBe(line.goals);
          expect(live.assists, `assists, pid ${live.pid}`).toBe(line.assists);
          expect(live.yellowCards, `yellows, pid ${live.pid}`).toBe(line.yellowCards);
          expect(live.redCards, `reds, pid ${live.pid}`).toBe(line.redCards);
        }
      }
    }
  });

  it("saw the same players play as the box score did", () => {
    for (const box of MATCHES) {
      const state = atFullTime(box);
      for (const side of ["home", "away"] as const) {
        expect(new Set(state[side].all.map((l) => l.pid))).toEqual(
          new Set(box[side].map((l) => l.pid)),
        );
      }
    }
  });

  it("found cards and substitutions across the sample, so the above means something", () => {
    const totals = MATCHES.flatMap((box) => {
      const state = atFullTime(box);
      return [...state.home.all, ...state.away.all];
    });
    expect(totals.reduce((n, l) => n + l.yellowCards, 0)).toBeGreaterThan(0);
    expect(totals.filter((l) => l.from > 0).length).toBeGreaterThan(0);
    expect(totals.filter((l) => l.until !== null).length).toBeGreaterThan(0);
  });
});

describe("a rating as the match runs", () => {
  const box = MATCHES[0];
  const lineups = matchLineups(box);

  it("gives nobody a rating before kickoff", () => {
    const state = liveMatchState(lineups, box.events, 0);
    for (const l of [...state.home.all, ...state.away.all]) expect(l.rating).toBeNull();
  });

  it("has not let a single event through at minute zero", () => {
    const state = liveMatchState(lineups, box.events, 0);
    const all = [...state.home.all, ...state.away.all];
    expect(all.every((l) => l.goals === 0 && l.yellowCards === 0)).toBe(true);
    expect(state.home.goals + state.away.goals).toBe(0);
  });

  it("never counts an event that hasn't happened yet", () => {
    const last = finalMinute(box.events, box.finalClock);
    let previous = 0;
    for (let m = 1; m <= last; m++) {
      const state = liveMatchState(lineups, box.events, m);
      const goals = state.home.goals + state.away.goals;
      expect(goals).toBeGreaterThanOrEqual(previous);
      previous = goals;
    }
    const stored = box.events.filter((e) => e.type === "goal").length;
    expect(previous).toBe(stored);
  });

  it("holds a substitute off the pitch until the minute he came on", () => {
    const sub = lineups.home.subs[0] ?? lineups.away.subs[0];
    expect(sub, "the sample match made no substitutions").toBeDefined();
    const side = lineups.home.subs.includes(sub!) ? "home" : "away";
    const before = liveMatchState(lineups, box.events, sub!.minute - 1)[side];
    const after = liveMatchState(lineups, box.events, sub!.minute)[side];
    expect(before.all.some((l) => l.pid === sub!.on)).toBe(false);
    expect(after.all.some((l) => l.pid === sub!.on)).toBe(true);
    // And he takes the slot on the pitch, rather than being appended to it.
    expect(after.onPitch).toHaveLength(before.onPitch.length);
    expect(after.onPitch.some((l) => l.pid === sub!.on)).toBe(true);
    expect(after.onPitch.some((l) => l.pid === sub!.off)).toBe(false);
  });
});
