import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
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

describe("set pieces + penalties", () => {
  it("penalty events resolve to a goal, a save, or an off-target miss, attributed to the taker", () => {
    let penaltyCount = 0;
    let goals = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng, makeTeam("Home"), makeTeam("Away"), makeSquad(0), makeSquad(100),
      );
      const events = result.boxScore.events;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type !== "penalty") continue;
        penaltyCount++;
        const taker = e.pids[0];
        const next = events[i + 1];
        expect(["goal", "shot_saved", "shot_off_target"]).toContain(next.type);
        expect(next.pids[0]).toBe(taker);
        const line = [...result.boxScore.home, ...result.boxScore.away].find((l) => l.pid === taker);
        expect(line).toBeDefined();
        expect(line!.shots).toBeGreaterThanOrEqual(1);
        if (next.type === "goal") goals++;
      }
    }
    expect(penaltyCount).toBeGreaterThan(0);
    // Conversion rate should be in the right ballpark of the ~76% spec target.
    const conversion = goals / penaltyCount;
    expect(conversion).toBeGreaterThan(0.5);
    expect(conversion).toBeLessThan(0.95);
  });

  it("a corner followed by a same-tick shot is a header; the rest are cleared, and every corner names a taker", () => {
    let corners = 0;
    let headers = 0;
    let matches = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rng = mulberry32(seed);
      const home = makeSquad(0);
      const away = makeSquad(100);
      const result = simMatchDetailed(rng, makeTeam("Home"), makeTeam("Away"), home, away);
      matches++;
      const events = result.boxScore.events;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type !== "corner") continue;
        corners++;
        // The taker is an outfielder on the side that won it.
        const side = e.side === "home" ? home : away;
        const taker = side.find((p) => p.pid === e.pids[0]);
        expect(taker).toBeDefined();
        expect(taker!.pos).not.toBe("GK");
        const next = events[i + 1];
        if (next && next.clock === e.clock && next.side === e.side
          && ["goal", "shot_saved", "shot_blocked", "shot_off_target"].includes(next.type)) {
          headers++;
          expect(next.pids[0]).not.toBe(e.pids[0]);
          if (next.type === "goal") expect(next.pids[1]).toBe(e.pids[0]);
        }
      }
    }
    // Real top-flight football averages ~10 a match, and most come to nothing.
    expect(corners / matches).toBeGreaterThan(6);
    expect(corners / matches).toBeLessThan(14);
    expect(headers).toBeGreaterThan(0);
    expect(headers / corners).toBeLessThan(0.1);
  });

  it("the same player takes every penalty: the named taker while he's on, else the best finisher", () => {
    const takers = new Set<number>();
    const namedTakers = new Set<number>();
    for (let seed = 1; seed <= 600; seed++) {
      const home = makeSquad(0);
      const away = makeSquad(100).map((p) => (p.pid === 108 ? { ...p, penaltyTaker: true } : p));
      const result = simMatchDetailed(mulberry32(seed), makeTeam("Home"), makeTeam("Away"), home, away);
      for (const e of result.boxScore.events) {
        if (e.type !== "penalty") continue;
        (e.side === "home" ? takers : namedTakers).add(e.pids[0]);
      }
    }
    // Home: auto, and the striker is the side's one clear finisher.
    expect([...takers]).toEqual([11]);
    // Away: pid 108 is a CM with 40 shooting, named by the user.
    expect([...namedTakers]).toEqual([108]);
  });

  it("a named penalty taker is subbed off far less often", () => {
    const subbedOff = (named: boolean): number => {
      let off = 0;
      for (let seed = 1; seed <= 300; seed++) {
        // The striker (pid 11) with a weak engine, so fatigue makes him a sub target.
        const home = makeSquad(0).map((p) =>
          p.pid === 11 ? { ...p, ovr: 62, stamina: 20, penaltyTaker: named } : p);
        // A bench good enough that swapping a tired starter is always worth it.
        const bench = makeSquad(200).filter((p) => p.pos !== "GK").slice(0, 7)
          .map((p) => ({ ...p, ovr: 66 }));
        const result = simMatchDetailed(
          mulberry32(seed), makeTeam("Home"), makeTeam("Away"), home, makeSquad(100), bench, [],
        );
        if (result.boxScore.events.some((e) => e.type === "substitution" && e.pids[0] === 11)) off++;
      }
      return off;
    };
    const plain = subbedOff(false);
    const shielded = subbedOff(true);
    expect(plain).toBeGreaterThan(30);
    expect(shielded).toBeLessThan(plain / 2);
  });
});
