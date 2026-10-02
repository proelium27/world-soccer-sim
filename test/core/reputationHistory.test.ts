import { describe, it, expect } from "vitest";
import { reputationSnapshot, reputationHistory, reputationChange } from "../../src/core/teams/reputation.js";
import { migrateLeague } from "../../src/db/migrate.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import { makeLeague } from "../helpers/league.js";

const entry = (season: number, reputation?: Record<number, number>) => ({ season, reputation });

describe("reputation history", () => {
  it("snapshots every club to one decimal", () => {
    expect(reputationSnapshot([
      { tid: 0, reputation: 61.237, hype: 10 },
      { tid: 1, reputation: undefined, hype: 42 },
    ])).toEqual({ 0: 61.2, 1: 42 });
  });

  it("lists a club's recorded seasons and skips the ones that weren't recorded", () => {
    const history = [entry(1), entry(2, { 5: 40 }), entry(3, { 5: 44.5 })];
    expect(reputationHistory(history, 5)).toEqual([
      { season: 2, reputation: 40 }, { season: 3, reputation: 44.5 },
    ]);
    expect(reputationHistory(history, 6)).toEqual([]);
  });

  it("measures the last offseason's move only when the last two seasons were both recorded", () => {
    expect(reputationChange([entry(2, { 5: 40 }), entry(3, { 5: 44.5 })], 5)).toBe(4.5);
    expect(reputationChange([entry(2, { 5: 44.5 }), entry(3, { 5: 41.3 })], 5)).toBe(-3.2);
    expect(reputationChange([entry(2), entry(3, { 5: 44.5 })], 5)).toBeNull();
    expect(reputationChange([entry(3, { 5: 44.5 })], 5)).toBeNull();
    expect(reputationChange([], 5)).toBeNull();
  });
});

describe("reputation backfill on load", () => {
  const base = makeLeague(0, 1);
  const shell = (season: number, reputation?: Record<number, number>): SeasonHistoryEntry => ({
    season, table: [], teamStats: [], awards: {}, compsByTid: {}, championTidByCompId: {},
    world: { ballonDOr: [], worldTeamOfYear: [] }, reputation,
  } as unknown as SeasonHistoryEntry);
  const withHistory = (first?: Record<number, number>): LeagueStore => ({
    ...base,
    seasonHistory: [shell(1, first), shell(2)],
  });

  it("stamps the latest season with what every club holds now", () => {
    const migrated = migrateLeague(withHistory());
    expect(migrated.seasonHistory.at(-1)!.reputation).toEqual(reputationSnapshot(migrated.teams));
    expect(migrated.seasonHistory[0].reputation).toBeUndefined();
  });

  it("leaves a save alone once any season carries reputations", () => {
    expect(migrateLeague(withHistory({ 0: 12 })).seasonHistory.at(-1)!.reputation).toBeUndefined();
  });

  it("does not stamp a seed as a club's past", () => {
    const unseeded = withHistory();
    unseeded.teams = unseeded.teams.map((t, i) => (i === 0 ? { ...t, reputation: undefined } : t));
    expect(migrateLeague(unseeded).seasonHistory.at(-1)!.reputation).toBeUndefined();
  });
});
