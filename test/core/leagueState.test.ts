import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  worldCompetitions, competitionTeamCount, competitionConferences,
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

  it("has 48 competitions (sixteen countries, three divisions each) and 898 teams, each division its own size", () => {
    expect(state.competitions).toHaveLength(48);
    expect(state.teams).toHaveLength(898);
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

  it("has 22450 players (898 teams x 25 players)", () => {
    expect(state.players).toHaveLength(22450);
  });

  it("schedules n(n-1) games per competition, each within one competition", () => {
    // Divisions are no longer all 20 clubs, so the total is the sum of each
    // competition's own double round robin rather than 380 x 24.
    // A split top flight (MLS, Argentina) plays its own half twice plus games
    // across, rather than everyone twice.
    expect(state.schedule).toHaveLength(
      worldCompetitions().reduce((n, c) => {
        const size = competitionTeamCount(c);
        const split = competitionConferences(c);
        if (!split) return n + size * (size - 1);
        const half = size / 2;
        const perClub = (half % 2 === 1 ? 2 * half : 2 * (half - 1)) + split.crossRounds;
        return n + (size * perClub) / 2;
      }, 0),
    );
    expect(state.schedule).toHaveLength(15106);
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
