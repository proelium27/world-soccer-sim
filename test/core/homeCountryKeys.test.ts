/**
 * Home-country pull compares `player.nationality` against `comp.country`
 * (docs/club-reputation.md). That only works if the two use the same strings,
 * and nothing throws when they don't: `pickNationality` falls back to England's
 * table for an unknown country, and a string compare simply never matches. So
 * a mismatch would present as a league with no home pull at all, or one full of
 * Englishmen. This pins the shared key space for every shipped league.
 */
import { describe, it, expect } from "vitest";
import { worldCompetitions } from "../../src/core/competitions.js";
import {
  LEAGUE_NATIONALITY_WEIGHTS,
  namePoolFor,
} from "../../src/core/players/nationalities.js";
import { confederationOf } from "../../src/core/international/confederations.js";
import { makeLeague } from "../helpers/league.js";

const countries = [...new Set(worldCompetitions().map((c) => c.country))];

describe("home-country keys", () => {
  it("every shipped country is a nationality-table key, a name pool and a confederation member", () => {
    for (const country of countries) {
      expect(LEAGUE_NATIONALITY_WEIGHTS[country], `${country} table`).toBeDefined();
      expect(LEAGUE_NATIONALITY_WEIGHTS[country][country], `${country} domestic weight`).toBeGreaterThan(0);
      expect(namePoolFor(country), `${country} name pool`).toBeDefined();
      expect(confederationOf(country), `${country} confederation`).not.toBeNull();
    }
  });

  it("a generated league's players carry its country string as their nationality", () => {
    const league = makeLeague(0, 1);
    const compCountry = new Map(league.competitions.map((c) => [c.id, c.country]));
    const byPid = new Map(league.players.map((p) => [p.pid, p]));
    const domestic = new Map<string, number>();
    for (const t of league.teams) {
      const country = compCountry.get(t.compId)!;
      for (const pid of t.roster) {
        if (byPid.get(pid)?.nationality === country) domestic.set(country, (domestic.get(country) ?? 0) + 1);
      }
    }
    for (const country of countries) {
      expect(domestic.get(country) ?? 0, `${country} home players`).toBeGreaterThan(50);
    }
  });
});
