import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { leagueMatchData } from "../../src/core/league/composites.js";
import { playFirstLeg, resolveCupTie, resolveTwoLeggedTie } from "../../src/core/cup/simCup.js";
import type { CupTie } from "../../src/core/cup/types.js";
import type { BoxScore, MatchEvent } from "../../src/engine/attribution.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { EXTRA_TIME_SECONDS, MATCH_SECONDS } from "../../src/engine/constants.js";
import { CUP_ET_CHANCES_PER_SIDE } from "../../src/core/constants.js";
import { finalMinute, splitTwoLeggedEvents } from "../../src/ui/live/liveMatch.js";
import { matchLineups } from "../../src/ui/live/lineups.js";
import { liveMatchState } from "../../src/ui/live/liveRatings.js";
import { extraTimeStartMinute, matchMinuteLabel, periodMarkers } from "../../src/ui/matchClock.js";

/**
 * Extra time is on the timeline, so the live viewer plays on into it rather
 * than cutting from the 90th minute to the result.
 *
 * On real match data, like the away-goals tests: a level tie can't be forced,
 * so the tests search seeds for them.
 */
const league = makeLeague(0, 1);
const england = league.competitions.find((c) => c.country === "England" && c.tier === 1)!;
const clubs = league.teams.filter((t) => t.compId === england.id);
const data = leagueMatchData({
  teams: clubs.map((t) => ({
    tid: t.tid, name: t.name, roster: t.roster, avgOvr: 0, academyBase: t.academyBase,
    compId: t.compId, starters: t.starters, formation: t.formation, moreMinutes: t.moreMinutes,
  })),
  players: league.players,
});
const [home, away] = [clubs[0].tid, clubs[1].tid];
const [hd, ad] = [data[0], data[1]];

const single = (seed: number): CupTie => resolveCupTie(mulberry32(seed), home, away, hd, ad, 0, 0);
const twoLegged = (seed: number): CupTie => {
  const rng = mulberry32(seed);
  return resolveTwoLeggedTie(rng, playFirstLeg(rng, home, away, hd, ad, 0), hd, ad, 0);
};

const seeds = Array.from({ length: 300 }, (_, s) => s);
const singles = seeds.map(single);
const etSingles = singles.filter((t) => t.wentToExtraTime);
const etTwoLegged = seeds.map(twoLegged).filter((t) => t.wentToExtraTime).slice(0, 8);

const extraTimeEvents = (box: BoxScore): MatchEvent[] =>
  box.events.filter((e) => e.clock < box.extraTimeClock!);

/** Who a side had on the pitch at the whistle, read back from the events. */
function onAtWhistle(box: BoxScore, side: "home" | "away", events: MatchEvent[]): Set<number> {
  const subbedOn = new Set(events.filter((e) => e.type === "substitution" && e.side === side).map((e) => e.pids[1]));
  const on = new Set(box[side].filter((l) => l.minutesPlayed > 0 && !subbedOn.has(l.pid)).map((l) => l.pid));
  for (const e of events) {
    if (e.side !== side) continue;
    if (e.type === "substitution") {
      on.delete(e.pids[0]);
      on.add(e.pids[1]);
    } else if (e.type === "red_card") {
      on.delete(e.pids[0]);
    }
  }
  return on;
}

describe("extra time on the timeline", () => {
  it("finds enough level ties to say anything", () => {
    expect(etSingles.length).toBeGreaterThanOrEqual(5);
    expect(etTwoLegged.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves a tie settled in 90 minutes exactly as it was", () => {
    for (const tie of singles.filter((t) => !t.wentToExtraTime)) {
      expect(tie.boxScore!.extraTimeClock).toBeUndefined();
    }
  });

  it("puts every chance in the 30 minutes after the whistle, starting on a minute boundary", () => {
    for (const tie of etSingles) {
      const box = tie.boxScore!;
      const start = box.extraTimeClock!;
      expect(start).toBeLessThanOrEqual(box.finalClock!);
      expect((MATCH_SECONDS - start) % 60).toBe(0);
      const et = extraTimeEvents(box);
      expect(et).toHaveLength(2 * CUP_ET_CHANCES_PER_SIDE);
      for (const e of et) expect(e.clock).toBeGreaterThanOrEqual(start - EXTRA_TIME_SECONDS);
      // The whole stream stays chronological (the clock counts down).
      for (let i = 1; i < box.events.length; i++) {
        expect(box.events[i].clock).toBeLessThanOrEqual(box.events[i - 1].clock);
      }
    }
  });

  it("scores exactly the goals the tie records, so the live score ends on the result", () => {
    for (const tie of etSingles) {
      const goals = (side: "home" | "away") =>
        tie.boxScore!.events.filter((e) => e.type === "goal" && e.side === side).length;
      expect(goals("home")).toBe(tie.homeGoals);
      expect(goals("away")).toBe(tie.awayGoals);
    }
  });

  it("only gives extra-time chances to men still on the pitch", () => {
    for (const tie of etSingles) {
      const box = tie.boxScore!;
      const regulation = box.events.filter((e) => e.clock >= box.extraTimeClock!);
      for (const side of ["home", "away"] as const) {
        const on = onAtWhistle(box, side, regulation);
        for (const e of extraTimeEvents(box).filter((x) => x.side === side)) {
          for (const pid of e.pids) expect(on.has(pid), `pid ${pid}`).toBe(true);
        }
      }
    }
  });

  it("keeps a two-legged tie's extra time in the second leg, where it was played", () => {
    for (const tie of etTwoLegged) {
      const [leg1, leg2] = splitTwoLeggedEvents(tie.boxScore!.events);
      const goals = (events: MatchEvent[], side: "home" | "away") =>
        events.filter((e) => e.type === "goal" && e.side === side).length;
      expect(goals(leg1, "home")).toBe(tie.legs![0].homeGoals);
      // Leg 2 is in its own orientation: the tie's `home` club is its away side.
      expect(goals(leg1, "home") + goals(leg2, "away")).toBe(tie.homeGoals);
      expect(goals(leg1, "away") + goals(leg2, "home")).toBe(tie.awayGoals);
      expect(leg2.filter((e) => e.clock < tie.boxScore!.extraTimeClock!)).toHaveLength(2 * CUP_ET_CHANCES_PER_SIDE);
    }
  });
});

describe("watching extra time", () => {
  const box = etSingles[0].boxScore!;
  const et = box.extraTimeClock!;
  const start = extraTimeStartMinute(et);

  it("plays on to the 120th and labels extra time 91' to 120'", () => {
    expect(finalMinute(box.events, box.finalClock, et)).toBe(start + 30);
    expect(matchMinuteLabel(start + 1, box.firstHalfStoppage, et)).toBe("91'");
    expect(matchMinuteLabel(start + 15, box.firstHalfStoppage, et)).toBe("105'");
    expect(matchMinuteLabel(start + 30, box.firstHalfStoppage, et)).toBe("120'");
    // Regulation still reads as it did.
    expect(matchMinuteLabel(start, box.firstHalfStoppage, et)).toBe(matchMinuteLabel(start, box.firstHalfStoppage));
  });

  it("marks the end of normal time, extra time's break and its end", () => {
    const labels = periodMarkers(box.firstHalfStoppage, box.finalClock, et).map((m) => m.label);
    expect(labels).toContain("End of normal time");
    expect(labels).toContain("Extra time, half time");
    expect(labels).toContain("End of extra time");
    expect(labels).not.toContain("Full time");
    expect(periodMarkers(box.firstHalfStoppage, box.finalClock).map((m) => m.label)).toContain("Full time");
  });

  /**
   * The engine rates everyone at the end of normal time and extra time only adds
   * to their lines afterwards, so after 120 minutes the live rating and minutes
   * must be exactly what a replay of normal time alone gives, while goals and
   * assists count extra time too, as the stored line does.
   *
   * Compared against the normal-time replay rather than the stored rating
   * because a handful of real-world lines (about 0.15%, ties that never reach
   * extra time included) already disagree with the stored minutes for reasons
   * that have nothing to do with extra time.
   */
  it("keeps the rating and minutes at normal time, and counts extra-time goals", () => {
    let checked = 0;
    for (const tie of etSingles) {
      const b = tie.boxScore!;
      const state = liveMatchState(
        matchLineups(b),
        b.events,
        finalMinute(b.events, b.finalClock, b.extraTimeClock),
        b.finalClock,
        b.firstHalfStoppage,
        b.extraTimeClock,
      );
      const regulation = b.events.filter((e) => e.clock >= b.extraTimeClock!);
      const atNinety = liveMatchState(
        matchLineups(b, regulation),
        regulation,
        finalMinute(regulation, b.finalClock),
        b.finalClock,
        b.firstHalfStoppage,
      );
      for (const side of ["home", "away"] as const) {
        const stored = new Map(b[side].map((l) => [l.pid, l]));
        const ninety = new Map(atNinety[side].all.map((l) => [l.pid, l]));
        for (const live of state[side].all) {
          const line = stored.get(live.pid)!;
          expect(live.minutesPlayed, `minutes, pid ${live.pid}`).toBe(ninety.get(live.pid)!.minutesPlayed);
          expect(live.rating, `rating, pid ${live.pid}`).toBe(ninety.get(live.pid)!.rating);
          expect(live.goals, `goals, pid ${live.pid}`).toBe(line.goals);
          expect(live.assists, `assists, pid ${live.pid}`).toBe(line.assists);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
