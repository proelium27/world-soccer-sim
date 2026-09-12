import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
import { matchMinutesBetween, matchSecondsAt } from "../../src/engine/matchTime.js";
import type { MatchPlayer, MatchPosition } from "../../src/engine/attribution.js";

const H1 = 180; // three minutes added before the break

describe("matchSecondsAt — the clock on the wall", () => {
  it("runs normally through first-half regulation", () => {
    expect(matchSecondsAt(5400, H1)).toBe(0);
    expect(matchSecondsAt(3600, H1)).toBe(1800);
    expect(matchSecondsAt(2700, H1)).toBe(2700);
  });

  it("holds at 45:00 through first-half stoppage", () => {
    expect(matchSecondsAt(2700 - 60, H1)).toBe(2700);
    expect(matchSecondsAt(2700 - H1, H1)).toBe(2700);
  });

  it("resumes at 45:00 for the second half, net of the stoppage already played", () => {
    // One playing-time minute after the break is the 46th on the wall.
    expect(matchSecondsAt(2700 - H1 - 60, H1)).toBe(2760);
    // 90:00 on the wall is H1 seconds below zero on the countdown.
    expect(matchSecondsAt(-H1, H1)).toBe(5400);
  });

  it("holds at 90:00 through second-half stoppage", () => {
    expect(matchSecondsAt(-H1 - 240, H1)).toBe(5400);
  });
});

describe("matchMinutesBetween", () => {
  it("gives a full match 90, whatever the referee added", () => {
    // Four minutes added at the end on top of three at the break.
    expect(matchMinutesBetween(5400, -H1 - 240, H1)).toBe(90);
  });

  it("gives a half-time substitution exactly 45 each way", () => {
    const theBreak = 2700 - H1;
    expect(matchMinutesBetween(5400, theBreak, H1)).toBe(45);
    expect(matchMinutesBetween(theBreak, -H1 - 240, H1)).toBe(45);
  });

  it("does not credit a player sent off in first-half stoppage with the stoppage", () => {
    expect(matchMinutesBetween(5400, 2700 - 120, H1)).toBe(45);
  });

  it("counts a late substitute's minutes on the wall clock, not his stoppage", () => {
    // On at the 80th minute, match ends 90+4: ten minutes on the wall.
    const on80 = 2700 - H1 - 35 * 60;
    expect(matchMinutesBetween(on80, -H1 - 240, H1)).toBe(10);
  });
});

function squad(base: number): MatchPlayer[] {
  return (["GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST"] as MatchPosition[]).map(
    (pos, i) => ({
      pid: base + i + 1,
      pos,
      slot: pos,
      secondary: [],
      ovr: 62,
      shooting: pos === "ST" ? 75 : 45,
      dribbling: 50,
      tackling: 55,
      keeping: pos === "GK" ? 75 : 5,
      positioning: 55,
      heading: 50,
      stamina: 60,
      interceptions: 55,
      passing: 50,
    }),
  );
}

describe("in a real match", () => {
  it("records 90 for everyone who played the whole match, and nobody above 90", () => {
    // The user-visible claim: the box score's MIN column read 103 for a
    // full-match player once halves became periods. A keeper is never
    // substituted, so every match has at least two full-match players to check.
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const box = simMatchDetailed(mulberry32(seed), makeTeam("H"), makeTeam("A"), squad(0), squad(100))
        .boxScore;
      // Guard: this test is about the new engine, which records the board.
      expect(box.firstHalfStoppage).toBeGreaterThan(0);
      for (const line of [...box.home, ...box.away]) {
        expect(line.minutesPlayed).toBeLessThanOrEqual(90);
        // A keeper is never substituted, but he can be sent off; one who
        // finished the match is the clean full-match case.
        if (line.slot === "GK" && line.redCards === 0) {
          expect(line.minutesPlayed).toBe(90);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(36);
  });
});
