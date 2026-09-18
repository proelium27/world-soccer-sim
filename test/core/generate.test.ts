import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generatePlayer } from "../../src/core/players/generate.js";
import { RATING_MIN, RATING_MAX, ABS_LOW_MAX } from "../../src/core/constants.js";
import { generateLeague, generateTwoDivisionLeague, generateWorld } from "../../src/core/league/generate.js";
import { NUM_TEAMS, NUM_TEAMS_D2 } from "../../src/core/constants.js";
import { worldCompetitions, competitionTeamCount, countryClubRanges, countryDivisions } from "../../src/core/competitions.js";

describe("generatePlayer", () => {
  it("returns a complete player with all ratings in range", () => {
    const p = generatePlayer(mulberry32(7), "ST", 55, 1, 20, 1);
    expect(p.pid).toBe(1);
    expect(p.pos).toBe("ST");
    expect(p.ovr).toBeGreaterThan(0);
    for (const v of Object.values(p.ratings)) {
      expect(v).toBeGreaterThanOrEqual(RATING_MIN);
      expect(v).toBeLessThanOrEqual(RATING_MAX);
    }
    expect(p.potential).toBeGreaterThanOrEqual(p.ovr);
  });
  it("is deterministic for a given seed", () => {
    const a = generatePlayer(mulberry32(9), "CB", 60, 3, 20, 1);
    const b = generatePlayer(mulberry32(9), "CB", 60, 3, 20, 1);
    expect(a).toEqual(b);
  });
  it("archetype holds: a generated ST out-finishes a generated CB on average", () => {
    let stFin = 0, cbFin = 0;
    for (let i = 0; i < 200; i++) {
      stFin += generatePlayer(mulberry32(1000 + i), "ST", 55, i, 20, 1).ratings.finishing;
      cbFin += generatePlayer(mulberry32(1000 + i), "CB", 55, i, 20, 1).ratings.finishing;
    }
    expect(stFin / 200).toBeGreaterThan(cbFin / 200 + 15);
  });
  it("position-exclusive stats stay low regardless of team quality", () => {
    // An elite-base striker still cannot keep goal.
    const elite = generatePlayer(mulberry32(3), "ST", 80, 1, 20, 1);
    expect(elite.ratings.goalkeeping).toBeLessThanOrEqual(ABS_LOW_MAX);
  });
});

describe("generateTwoDivisionLeague", () => {
  it("produces 40 teams: tids 0-19 division 0, tids 20-39 division 1", () => {
    const league = generateTwoDivisionLeague(mulberry32(42));
    expect(league.teams).toHaveLength(NUM_TEAMS + NUM_TEAMS_D2);
    for (const t of league.teams) {
      if (t.tid < NUM_TEAMS) expect(t.compId).toBe(0);
      else expect(t.compId).toBe(1);
    }
  });

  it("D2's strongest team is no stronger than D1's average team", () => {
    const league = generateTwoDivisionLeague(mulberry32(42));
    const d1 = league.teams.filter((t) => t.compId === 0);
    const d2 = league.teams.filter((t) => t.compId === 1);
    const avgOvr = (ts: typeof d1) => ts.reduce((s, t) => s + t.avgOvr, 0) / ts.length;
    const d1Avg = avgOvr(d1);
    const d2Best = Math.max(...d2.map((t) => t.avgOvr));
    expect(d2Best).toBeLessThanOrEqual(d1Avg + 0.5); // small tolerance for generation noise
  });

  it("D1 half is identical to plain generateLeague for the same seed", () => {
    const plain = generateLeague(mulberry32(42));
    const combined = generateTwoDivisionLeague(mulberry32(42));
    const d1FromCombined = combined.teams.filter((t) => t.compId === 0);
    expect(d1FromCombined.map((t) => t.roster)).toEqual(plain.teams.map((t) => t.roster));
  });
});

describe("generateWorld", () => {
  // One world, shared by every seed-42 case below. Generating the full 626-club
  // world costs ~15s, and this block used to pay that six times over for tests
  // that only ever read the result -- nothing here mutates `world`, so a single
  // generation serves all of them. The byte-identical-to-England case keeps its
  // own generation because it is a different seed.
  const world = generateWorld(mulberry32(42));

  it("produces 884 teams across 48 competitions, each its own size", () => {
    expect(world.teams).toHaveLength(884);
    for (const comp of worldCompetitions()) {
      expect(world.teams.filter((t) => t.compId === comp.id))
        .toHaveLength(competitionTeamCount(comp));
    }
  });

  it("assigns tid blocks in country order, sized by each country's divisions", () => {
    // Cross-checked against countryClubRanges rather than spelled out as a
    // literal per competition: the two derive the layout independently, so this
    // catches them drifting apart, and a country changing size or pyramid depth
    // no longer means editing two dozen hardcoded tids.
    const comps = worldCompetitions();
    const compById = new Map(comps.map((c) => [c.id, c]));

    for (const { country, start, end } of countryClubRanges(comps)) {
      const tids = world.teams
        .filter((t) => compById.get(t.compId)!.country === country)
        .map((t) => t.tid)
        .sort((a, b) => a - b);
      expect(tids).toEqual(Array.from({ length: end - start }, (_, i) => start + i));
    }

    // Within a country the divisions are contiguous too, top flight first — the
    // order club identities are handed out in.
    for (const { divisions } of countryDivisions(comps)) {
      let cursor = Math.min(...world.teams
        .filter((t) => divisions.some((d) => d.id === t.compId))
        .map((t) => t.tid));
      for (const d of divisions) {
        const tids = world.teams.filter((t) => t.compId === d.id).map((t) => t.tid);
        expect(Math.min(...tids)).toBe(cursor);
        expect(tids).toHaveLength(competitionTeamCount(d));
        cursor += competitionTeamCount(d);
      }
    }
  });

  it("has 22100 players (884 teams x 25)", () => {
    expect(world.players).toHaveLength(22100);
  });

  it("generates the weak leagues in coefficient order: England > France > Netherlands > Portugal > Belgium > Turkey > Greece > Scotland > Serbia", () => {
    const d1Avg = (country: string) => {
      const comp = worldCompetitions().find((c) => c.country === country && c.tier === 1)!;
      const teams = world.teams.filter((t) => t.compId === comp.id);
      return teams.reduce((s, t) => s + t.avgOvr, 0) / teams.length;
    };
    const ladder = [
      "England", "France", "Netherlands", "Portugal", "Belgium", "Turkey", "Greece",
      "Scotland", "Serbia",
    ].map(d1Avg);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeLessThan(ladder[i - 1]);
    }
  });

  it("has unique pids across the whole world", () => {
    const pids = world.players.map((p) => p.pid);
    expect(new Set(pids).size).toBe(pids.length);
  });

  it("England's block is byte-identical to generateTwoDivisionLeague for the same seed", () => {
    const world = generateWorld(mulberry32(9));
    const plain = generateTwoDivisionLeague(mulberry32(9));
    const englandFromWorld = world.teams.filter((t) => t.tid < 40);
    expect(englandFromWorld.map((t) => t.roster)).toEqual(plain.teams.map((t) => t.roster));
  });

  it("each country's tier-2 strongest team is no stronger than its own tier-1 average (equal-sibling generation)", () => {
    for (const country of ["England", "Spain", "Italy", "Germany"]) {
      const comps = worldCompetitions().filter((c) => c.country === country);
      const d1 = world.teams.filter((t) => t.compId === comps.find((c) => c.tier === 1)!.id);
      const d2 = world.teams.filter((t) => t.compId === comps.find((c) => c.tier === 2)!.id);
      const d1Avg = d1.reduce((s, t) => s + t.avgOvr, 0) / d1.length;
      const d2Best = Math.max(...d2.map((t) => t.avgOvr));
      expect(d2Best).toBeLessThanOrEqual(d1Avg + 0.5);
    }
  });

  it("majority nationality among Spain's players is Spain more often than among England's players", () => {
    const spainComp = worldCompetitions().find((c) => c.country === "Spain" && c.tier === 1)!;
    const englandComp = worldCompetitions().find((c) => c.country === "England" && c.tier === 1)!;
    const spainTids = new Set(world.teams.filter((t) => t.compId === spainComp.id).map((t) => t.tid));
    const englandTids = new Set(world.teams.filter((t) => t.compId === englandComp.id).map((t) => t.tid));
    const nationalityShare = (tids: Set<number>, nationality: string) => {
      const rosterPids = new Set(world.teams.filter((t) => tids.has(t.tid)).flatMap((t) => t.roster));
      const players = world.players.filter((p) => rosterPids.has(p.pid));
      return players.filter((p) => p.nationality === nationality).length / players.length;
    };
    expect(nationalityShare(spainTids, "Spain")).toBeGreaterThan(nationalityShare(englandTids, "Spain"));
  });
});
