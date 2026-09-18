import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  worldCompetitions, competitionTeamCount,
} from "../../src/core/competitions.js";

describe("createLeagueState", () => {
  const state = makeLeague(3, 42);

  it("returns correct shape", () => {
    expect(state).toHaveProperty("lid");
    expect(state).toHaveProperty("meta");
    expect(state).toHaveProperty("teams");
    expect(state).toHaveProperty("players");
    expect(state).toHaveProperty("season");
    expect(state).toHaveProperty("phase");
    expect(state).toHaveProperty("schedule");
    expect(state).toHaveProperty("played");
    expect(state).toHaveProperty("competitions");
  });

  it("has 48 competitions (sixteen countries, three divisions each) and 884 teams, each division its own size", () => {
    expect(state.competitions).toHaveLength(48);
    expect(state.teams).toHaveLength(884);
    const validCompIds = new Set(state.competitions.map((c) => c.id));
    for (const t of state.teams) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.abbrev).toBe("string");
      expect(t.abbrev.length).toBeGreaterThan(0);
      expect(t.colors).toHaveLength(2);
      expect(typeof t.colors[0]).toBe("string");
      expect(typeof t.colors[1]).toBe("string");
      expect(t.roster.length).toBeGreaterThan(0);
      expect(validCompIds.has(t.compId)).toBe(true);
    }
    for (const comp of state.competitions) {
      expect(state.teams.filter((t) => t.compId === comp.id))
        .toHaveLength(competitionTeamCount(comp));
    }
  });

  it("has 22100 players (884 teams x 25 players)", () => {
    expect(state.players).toHaveLength(22100);
  });

  it("schedules each competition's opening fixtures, each within one competition", () => {
    // Divisions differ in size and shape: a double round robin for most, a
    // split top flight (MLS, Argentina) its own half twice plus games across,
    // Scotland's lower divisions four times over, and a table that splits
    // (Scotland, Greece) only its first phase until that phase is played. So
    // the count is each division's own opening schedule, summed.
    const perComp = worldCompetitions().map((c) => {
      const tids = state.teams.filter((t) => t.compId === c.id).map((t) => t.tid);
      return state.schedule.filter((g) => tids.includes(g.home)).length;
    });
    expect(perComp.reduce((a, b) => a + b, 0)).toBe(state.schedule.length);
    expect(state.schedule).toHaveLength(14964);
    const compByTid = new Map(state.teams.map((t) => [t.tid, t.compId]));
    for (const g of state.schedule) {
      expect(g).toHaveProperty("matchday");
      expect(g).toHaveProperty("home");
      expect(g).toHaveProperty("away");
      expect(typeof g.matchday).toBe("number");
      expect(compByTid.get(g.home)).toBe(compByTid.get(g.away));
    }
  });

  it("phase is 'regular', season is 1, played is empty", () => {
    expect(state.phase).toBe("regular");
    expect(state.season).toBe(1);
    expect(state.played).toEqual([]);
  });

  it("meta.userTid matches the input", () => {
    expect(state.meta.userTid).toBe(3);
  });
});
