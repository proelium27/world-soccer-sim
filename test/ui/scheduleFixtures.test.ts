import { describe, expect, it } from "vitest";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { CupState } from "../../src/core/cup/types.js";
import type { DomesticCupState } from "../../src/core/domesticCup/types.js";
import {
  currentMatchdayOf,
  fixtureAction,
  fixturesFor,
  openingMatchday,
  type FixtureRow,
} from "../../src/ui/scheduleFixtures.js";

/** Two two-club leagues (comp 0: 1 and 2, comp 1: 3 and 4), a match played in each and one to come. */
function world(over: Partial<LeagueStore> = {}): LeagueStore {
  const played = (home: number, away: number, matchday: number) =>
    ({ home, away, homeGoals: 1, awayGoals: 0, possessionHome: 0.5, matchday, boxScore: { home: [], away: [], events: [] } });
  return {
    meta: { userTid: 1 },
    phase: "regular",
    teams: [1, 2, 3, 4].map((tid) => ({ tid, compId: tid <= 2 ? 0 : 1 })),
    competitions: [
      { id: 0, country: "England", tier: 1, name: "Premier Division" },
      { id: 1, country: "Spain", tier: 1, name: "Primera" },
    ],
    played: [played(1, 2, 1), played(3, 4, 1)],
    schedule: [{ matchday: 2, home: 2, away: 1 }, { matchday: 2, home: 4, away: 3 }],
    cup: null,
    shield: null,
    domesticCups: [],
    ...over,
  } as unknown as LeagueStore;
}

describe("fixturesFor", () => {
  it("lists one league's games, played and to come, and nobody else's", () => {
    const rows = fixturesFor(world(), { kind: "league", compId: 1 });
    expect(rows.map((r) => [r.matchday, r.home, r.away])).toEqual([[1, 3, 4], [2, 4, 3]]);
    // The played one keeps its index into league.played, for its box score.
    expect(rows[0].playedIndex).toBe(1);
  });

  it("gathers a club's league and cup games, cup first on a shared matchday", () => {
    const cup = {
      competition: "continental",
      name: "Continental Cup",
      teams: [1, 3],
      seeds: {},
      leaguePhase: {
        teams: [1, 3],
        matches: [{ round: 0, matchday: 2, home: 3, away: 1, played: false, homeGoals: 0, awayGoals: 0 }],
      },
      playoff: null,
      koLegs: null,
      ties: [],
      bracket: [],
    } as unknown as CupState;
    const rows = fixturesFor(world({ cup }), { kind: "club", tid: 1 });
    expect(rows.map((r) => [r.matchday, r.kind])).toEqual([[1, "league"], [2, "cup"], [2, "league"]]);
  });

  it("lists a whole domestic cup round, drawn but not yet played", () => {
    const cup = {
      country: "Spain",
      name: "Spanish Cup",
      totalRounds: 1,
      teams: [3, 4],
      rounds: [{ round: 0, matchday: 2, pairings: [{ home: 3, away: 4 }], ties: [], byes: [] }],
    } as unknown as DomesticCupState;
    const rows = fixturesFor(world({ domesticCups: [cup] }), { kind: "domestic", country: "Spain" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ matchday: 2, home: 3, away: 4, result: null, kind: "domestic" });
  });
});

describe("fixtureAction", () => {
  const row = (matchday: number, result: FixtureRow["result"] = null): FixtureRow =>
    ({ matchday, home: 1, away: 2, result, playedIndex: result ? 0 : null, kind: "league" });

  it("replays a played league game", () => {
    expect(fixtureAction(row(1, { homeGoals: 1, awayGoals: 0, possessionHome: 0.5 }), 2))
      .toEqual({ kind: "replay", playedIndex: 0 });
  });

  it("watches a match on the matchday about to be played", () => {
    expect(fixtureAction(row(2), 2)).toEqual({ kind: "watch" });
  });

  it("sims up to the matchday BEFORE a future one, so it is next to play", () => {
    expect(fixtureAction(row(7), 2)).toEqual({ kind: "simTo", throughMatchday: 6 });
  });

  it("offers nothing once the season has stopped playing matchdays", () => {
    expect(fixtureAction(row(7), null)).toEqual({ kind: "none" });
  });
});

describe("matchday helpers", () => {
  it("reads the current matchday off the schedule, and none outside the regular season", () => {
    expect(currentMatchdayOf(world())).toBe(2);
    expect(currentMatchdayOf(world({ phase: "offseason" } as Partial<LeagueStore>))).toBeNull();
  });

  it("opens on the next matchday this competition plays, else its last", () => {
    const rows = [1, 5, 9].map((matchday) => ({ matchday }) as FixtureRow);
    expect(openingMatchday(rows, 3)).toBe(5);
    expect(openingMatchday(rows, 12)).toBe(9);
    expect(openingMatchday(rows, null)).toBe(9);
  });
});
