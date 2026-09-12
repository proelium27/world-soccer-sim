import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatch, simMatchDetailed, computeStoppageSeconds, stoppageBoardSeconds } from "../../src/engine/matchSim.js";
import {
  STOPPAGE_MIN_SECONDS_PER_HALF,
  STOPPAGE_MAX_SECONDS_PER_HALF,
  STOPPAGE_BOARD_MAX_SECONDS,
  STOPPAGE_SECONDS_PER_EVENT,
} from "../../src/engine/constants.js";
import type { MatchPlayer } from "../../src/engine/attribution.js";

function makeSquad(pidOffset: number): MatchPlayer[] {
  const positions: MatchPlayer["pos"][] = [
    "GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST",
  ];
  return positions.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: pos === "ST" ? 68 : 62,
    shooting: pos === "ST" ? 80 : 40,
    dribbling: 50,
    tackling: pos === "CB" || pos === "DM" ? 70 : 40,
    keeping: pos === "GK" ? 80 : 5,
    positioning: 55,
    heading: 45,
    stamina: 50,
    interceptions: pos === "CB" || pos === "DM" ? 70 : 40,
    passing: 50,
  }));
}

describe("stoppage time", () => {
  it("simMatch: every match plays at least the minimum stoppage (1 min/half) beyond regulation", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      const r = simMatch(rng, makeTeam("Home"), makeTeam("Away"));
      const totalTicks = r.stat.home.ticks + r.stat.away.ticks;
      // Regulation is 5400s and every tick is at most MAX_DT=10s, so a match that
      // stopped dead at 90:00 could not have fewer than 540 ticks; the guaranteed
      // 2-minute combined stoppage floor adds at least a dozen more.
      const regulationFloorTicks = 540;
      expect(totalTicks).toBeGreaterThan(regulationFloorTicks);
    }
  });

  it("simMatchDetailed: play-by-play events occur past the 90th minute (regulation + stoppage)", () => {
    let sawStoppageEvent = false;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng, makeTeam("Home"), makeTeam("Away"), makeSquad(0), makeSquad(100),
      );
      for (const e of result.boxScore.events) {
        if (e.clock < 0) {
          sawStoppageEvent = true;
          // Clock shouldn't run away indefinitely: bounded by the detailed
          // engine's board cap for both halves combined. That is its OWN cap,
          // not simMatch's STOPPAGE_MAX_SECONDS_PER_HALF — see the constants.
          expect(e.clock).toBeGreaterThanOrEqual(-2 * STOPPAGE_BOARD_MAX_SECONDS);
        }
      }
    }
    expect(sawStoppageEvent).toBe(true);
  });

  it("a busier half earns more stoppage, bounded by the 1-5 minute spec range", () => {
    // Monotone in event count...
    expect(computeStoppageSeconds(0)).toBe(STOPPAGE_MIN_SECONDS_PER_HALF);
    expect(computeStoppageSeconds(3)).toBe(
      STOPPAGE_MIN_SECONDS_PER_HALF + 3 * STOPPAGE_SECONDS_PER_EVENT,
    );
    expect(computeStoppageSeconds(6)).toBeGreaterThan(computeStoppageSeconds(3));
    // ...and clamped to the per-half maximum no matter how eventful the half.
    expect(computeStoppageSeconds(1000)).toBe(STOPPAGE_MAX_SECONDS_PER_HALF);
    for (const n of [0, 1, 5, 10, 100]) {
      const s = computeStoppageSeconds(n);
      expect(s).toBeGreaterThanOrEqual(STOPPAGE_MIN_SECONDS_PER_HALF);
      expect(s).toBeLessThanOrEqual(STOPPAGE_MAX_SECONDS_PER_HALF);
    }
  });

  it("simMatch's stoppage is NOT rounded — it is the M1 benchmark path and must not move", () => {
    // One event is 60 + 20 = 80 seconds. The detailed board would round that to
    // 60; simMatch must keep it at 80, or its golden snapshot and the M1 bands
    // it is calibrated against move. This is the exact leak the half-time
    // rework's first cut shipped with.
    expect(computeStoppageSeconds(1)).toBe(80);
  });

  it("the detailed engine's board is whole minutes, credits the celebrations, and caps at its own maximum", () => {
    for (const events of [0, 1, 2, 5, 9]) {
      for (const lost of [0, 55, 140, 260]) {
        const s = stoppageBoardSeconds(events, lost);
        expect(s % 60).toBe(0);
        expect(s).toBeGreaterThanOrEqual(STOPPAGE_MIN_SECONDS_PER_HALF);
        expect(s).toBeLessThanOrEqual(STOPPAGE_BOARD_MAX_SECONDS);
      }
    }
    // Celebration time is added, not ignored...
    expect(stoppageBoardSeconds(2, 150)).toBeGreaterThan(stoppageBoardSeconds(2, 0));
    // ...and the cap holds however much the half lost.
    expect(stoppageBoardSeconds(1000, 1000)).toBe(STOPPAGE_BOARD_MAX_SECONDS);
  });
});
