import { describe, it, expect } from "vitest";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { careerRegion, inRegion } from "../../src/core/americasClubs.js";
import { teamGoatRanking } from "../../src/core/frivolities/goat.js";
import { computeClubTrivia } from "../../src/core/frivolities/clubs.js";
import { computeRecordBook } from "../../src/core/frivolities/records.js";
import { GOAT_TEAM_LEAGUE_TITLE_WEIGHT, AMERICAS_ACCOMPLISHMENT_SCALE } from "../../src/core/constants.js";

/*
 * The per-continent all-time boards: a club belongs to its league's continent,
 * a career to wherever most of its appearances were.
 */

const EUROPE_TID = 1;
const AMERICAS_TID = 700;
const AMERICAS = new Set([AMERICAS_TID]);

function row(tid: number, points: number) {
  return { tid, played: 38, won: points / 3, drawn: 0, lost: 38 - points / 3, gf: 60, ga: 30, gd: 30, points };
}

/** One season, an English and a Brazilian champion, and nothing else. */
function league(): LeagueStore {
  return {
    season: 2,
    teams: [
      { tid: EUROPE_TID, compId: 0, roster: [], academyRoster: [] },
      { tid: AMERICAS_TID, compId: 1, roster: [], academyRoster: [] },
    ],
    competitions: [
      { id: 0, country: "England", tier: 1, name: "English Division 1" },
      { id: 1, country: "Brazil", tier: 1, name: "Brazilian Division 1" },
    ],
    seasonHistory: [{
      season: 1,
      table: [row(EUROPE_TID, 90), row(AMERICAS_TID, 81)],
      compsByTid: { [EUROPE_TID]: 0, [AMERICAS_TID]: 1 },
      championTidByCompId: { 0: EUROPE_TID, 1: AMERICAS_TID },
      awards: {},
    }],
    players: [],
    retiredPlayers: [],
    transfers: [],
    cupHistory: [],
    shieldHistory: [],
    americasCupHistory: [],
    domesticCupHistory: [],
  } as unknown as LeagueStore;
}

describe("placing clubs and careers on a continent", () => {
  it("puts a club on its league's continent", () => {
    expect(inRegion(AMERICAS_TID, "americas", AMERICAS)).toBe(true);
    expect(inRegion(AMERICAS_TID, "europe", AMERICAS)).toBe(false);
    expect(inRegion(EUROPE_TID, "europe", AMERICAS)).toBe(true);
  });

  it("puts a career where most of its appearances were, Europe on a tie", () => {
    const seasons = (americasApps: number, europeApps: number) => [
      { tid: AMERICAS_TID, apps: americasApps },
      { tid: EUROPE_TID, apps: europeApps },
    ];
    expect(careerRegion(seasons(90, 30), AMERICAS)).toBe("americas");
    expect(careerRegion(seasons(30, 90), AMERICAS)).toBe("europe");
    expect(careerRegion(seasons(60, 60), AMERICAS)).toBe("europe");
    expect(careerRegion([{ tid: AMERICAS_TID, apps: 0 }], AMERICAS)).toBe("americas");
  });
});

describe("the all-time boards split by continent", () => {
  it("lists one continent's clubs on the club GOAT board, the Americas at full weight", () => {
    expect(teamGoatRanking(league(), 50, "europe").map((r) => r.tid)).toEqual([EUROPE_TID]);
    const americas = teamGoatRanking(league(), 50, "americas");
    expect(americas.map((r) => r.tid)).toEqual([AMERICAS_TID]);
    const titleWeight = (rows: ReturnType<typeof teamGoatRanking>) =>
      rows[0].components.flatMap((c) => c.terms).find((t) => t.key === "leagueTitles")!.weight;
    expect(titleWeight(americas)).toBe(GOAT_TEAM_LEAGUE_TITLE_WEIGHT);
    // On the world board the same club takes the discount.
    const world = teamGoatRanking(league()).filter((r) => r.tid === AMERICAS_TID);
    expect(titleWeight(world)).toBe(GOAT_TEAM_LEAGUE_TITLE_WEIGHT * AMERICAS_ACCOMPLISHMENT_SCALE);
  });

  it("splits the club records and the team-season records the same way", () => {
    expect(computeClubTrivia(league(), 25, "americas").records.map((r) => r.tid)).toEqual([AMERICAS_TID]);
    expect(computeClubTrivia(league(), 25, "europe").records.map((r) => r.tid)).toEqual([EUROPE_TID]);
    expect(computeRecordBook(league(), 25, "americas").bestTeamSeasons.map((r) => r.tid)).toEqual([AMERICAS_TID]);
    // And with no continent given, the world as before.
    expect(computeClubTrivia(league()).records.map((r) => r.tid).sort((a, b) => a - b))
      .toEqual([EUROPE_TID, AMERICAS_TID]);
  });
});
