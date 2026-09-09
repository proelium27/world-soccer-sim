import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
import { computeMatchRating } from "../../src/engine/matchRating.js";
import { MATCH_SECONDS } from "../../src/engine/constants.js";
import { emptyLine } from "../../src/engine/attribution.js";
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
    heading: pos === "CB" || pos === "ST" ? 70 : 40,
    stamina: 50,
    interceptions: pos === "CB" || pos === "DM" ? 70 : 40,
    passing: 50,
  }));
}

function makeBench(pidOffset: number): MatchPlayer[] {
  const positions: MatchPlayer["pos"][] = ["GK", "CB", "FB", "CM", "ST"];
  return positions.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: pos === "ST" ? 68 : 62,
    shooting: 40,
    dribbling: 50,
    tackling: 40,
    keeping: pos === "GK" ? 80 : 5,
    positioning: 55,
    heading: 40,
    stamina: 60,
    interceptions: 40,
    passing: 50,
  }));
}

describe("computeMatchRating", () => {
  it("returns exactly the 6.0 baseline for a no-stat full 90 (FWD gets no clean-sheet bonus)", () => {
    const line = emptyLine(1);
    expect(computeMatchRating(line, "ST", 90, 0)).toBeCloseTo(6.0, 5);
  });

  it("gives a clean-sheet bonus to MID/DEF/GK but not FWD", () => {
    const line = emptyLine(1);
    expect(computeMatchRating(line, "ST", 90, 0)).toBeCloseTo(6.0, 5);
    expect(computeMatchRating(line, "CM", 90, 0)).toBeCloseTo(6.2, 5);
    expect(computeMatchRating(line, "CB", 90, 0)).toBeCloseTo(6.8, 5);
    expect(computeMatchRating(line, "GK", 90, 0)).toBeCloseTo(7.0, 5);
  });

  it("rewards a goal more for a defender than a forward, per the weighting matrix", () => {
    const line = { ...emptyLine(1), goals: 1 };
    const defRating = computeMatchRating(line, "CB", 90, 0);
    const fwdRating = computeMatchRating(line, "ST", 90, 0);
    expect(defRating).toBeGreaterThan(fwdRating);
  });

  it("rewards interceptions like tackles, more for a defender than a forward", () => {
    const line = { ...emptyLine(1), interceptions: 5 };
    const defRating = computeMatchRating(line, "CB", 90, 0);
    const fwdRating = computeMatchRating(line, "ST", 90, 0);
    expect(defRating).toBeGreaterThan(6.8); // above the CB clean-sheet-bonus baseline
    expect(defRating).toBeGreaterThan(fwdRating);
  });

  it("does not let a realistic interception count alone push a scoreless CB above 8", () => {
    // Regression guard for the original bug report: a busy-but-scoreless CB
    // (5 interceptions, the top end of the new realistic per-match range)
    // should not rating-farm into the 9s the way high-teens tackles used to.
    const line = { ...emptyLine(1), interceptions: 5 };
    expect(computeMatchRating(line, "CB", 90, 0)).toBeLessThan(8);
  });

  it("gives goalkeepers a clean-sheet bonus for a shutout, more than defenders get", () => {
    const line = emptyLine(1);
    const gkRating = computeMatchRating(line, "GK", 90, 0);
    const cbRating = computeMatchRating(line, "CB", 90, 0);
    expect(gkRating).toBeGreaterThan(6.0);
    expect(gkRating).toBeGreaterThan(cbRating);
  });

  it("damps the swing for a short cameo relative to the same stat line over a full 90", () => {
    const line = { ...emptyLine(1), goals: 1 };
    const cameoRating = computeMatchRating(line, "ST", 10, 1);
    const fullRating = computeMatchRating(line, "ST", 90, 1);
    expect(cameoRating - 6.0).toBeLessThan(fullRating - 6.0);
  });

  it("stays within the documented 0-10 bounds even for an extreme stat line", () => {
    const hatTrick = { ...emptyLine(1), goals: 6, assists: 4 };
    expect(computeMatchRating(hatTrick, "GK", 90, 0)).toBeLessThanOrEqual(10);
    const disaster = { ...emptyLine(1), redCards: 1, yellowCards: 1 };
    expect(computeMatchRating(disaster, "GK", 90, 10)).toBeGreaterThanOrEqual(0);
  });
});

describe("minutesPlayed via simMatchDetailed", () => {
  it("credits every starter close to a full 90 (plus stoppage) when no subs/cards/injuries fire", () => {
    // Deterministic seed check isn't reliable here since subs/cards/injuries are
    // probabilistic; instead assert the invariant holds across many seeds.
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng, makeTeam("Home"), makeTeam("Away"),
        makeSquad(0), makeSquad(100), makeBench(50), makeBench(150),
      );
      for (const line of [...result.boxScore.home, ...result.boxScore.away]) {
        expect(line.minutesPlayed).toBeGreaterThanOrEqual(0);
        // Nobody plays more than a full match plus a generous stoppage allowance.
        expect(line.minutesPlayed).toBeLessThanOrEqual(105);
        expect(line.rating).toBeGreaterThanOrEqual(0);
        expect(line.rating).toBeLessThanOrEqual(10);
      }
    }
  });

  it("splits the match between a starter and his replacement at the minute of the change", () => {
    // The starter banks the minutes up to the substitution and the man coming on
    // plays what is left, so the pair account for the whole match between them.
    //
    // This deliberately does NOT assert the substitute plays fewer minutes than
    // the starter, which was true only while subs could not happen before the
    // hour. Half-time is a substitution window, and a man brought on at the break
    // plays the longer half — the second, plus stoppage.
    //
    // Injury-forced subs (which log an "injury" event immediately before, and
    // can fire at any minute) are excluded since that ordering isn't guaranteed.
    let checked = false;
    for (let seed = 1; seed <= 60 && !checked; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng, makeTeam("Home"), makeTeam("Away"),
        makeSquad(0), makeSquad(100), makeBench(50), makeBench(150),
      );
      const events = result.boxScore.events;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type !== "substitution") continue;
        const prev = events[i - 1];
        if (prev && prev.type === "injury" && prev.pids[0] === e.pids[0]) continue;

        const [offPid, onPid] = e.pids;
        // Skip a replacement who is himself later replaced — he then holds only
        // part of the remainder and the pair no longer span the match.
        const replacedAgain = events.some(
          (x, j) => j > i && x.type === "substitution" && x.pids[0] === onPid,
        );
        if (replacedAgain) continue;

        const offLine = [...result.boxScore.home, ...result.boxScore.away].find((l) => l.pid === offPid);
        const onLine = [...result.boxScore.home, ...result.boxScore.away].find((l) => l.pid === onPid);
        expect(offLine).toBeDefined();
        expect(onLine).toBeDefined();

        // The starter's minutes are the elapsed time at the change...
        const elapsedMin = Math.round((MATCH_SECONDS - e.clock) / 60);
        expect(Math.abs(offLine!.minutesPlayed - elapsedMin)).toBeLessThanOrEqual(1);
        // ...and the substitute really did play the rest of it.
        expect(onLine!.minutesPlayed).toBeGreaterThan(0);
        expect(offLine!.minutesPlayed + onLine!.minutesPlayed).toBeGreaterThanOrEqual(90);
        checked = true;
        break;
      }
      if (checked) break;
    }
    expect(checked).toBe(true);
  });
});
