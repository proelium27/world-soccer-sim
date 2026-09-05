import { describe, it, expect } from "vitest";
import { seasonSummaries, type SeasonSummaryRecords } from "../../src/core/seasonSummary.js";
import type { CupState } from "../../src/core/cup/types.js";
import type { DomesticCupState } from "../../src/core/domesticCup/types.js";
import type { SuperCupTie } from "../../src/core/superCup/types.js";
import type { IntlTournamentSummary } from "../../src/core/international/types.js";

function cup(over: Partial<CupState> & { season: number }): CupState {
  return {
    competition: "continental",
    name: "Continental Cup",
    teams: [],
    seeds: {},
    leaguePhase: null,
    playoff: null,
    playIn: null,
    ties: [],
    championTid: null,
    twoLegged: true,
    koLegs: null,
    statLines: null,
    ...over,
  } as unknown as CupState;
}

function domestic(over: Partial<DomesticCupState> & { season: number; country: string }): DomesticCupState {
  return {
    name: `${over.country} Cup`,
    teams: [],
    rounds: [],
    totalRounds: 4,
    championTid: null,
    statLines: null,
    ...over,
  } as DomesticCupState;
}

function tournament(
  over: Partial<IntlTournamentSummary> & { season: number },
): IntlTournamentSummary {
  return {
    name: "World Cup",
    champion: "Brazil",
    runnerUp: "France",
    finalScore: { champion: 2, runnerUp: 1, pens: null },
    topScorer: null,
    field: [],
    groups: [],
    knockout: [],
    ...over,
  } as IntlTournamentSummary;
}

const empty: SeasonSummaryRecords = {
  cup: null,
  cupHistory: [],
  shield: null,
  shieldHistory: [],
  international: null,
  seasonHistory: [],
  domesticCups: [],
  domesticCupHistory: [],
};

describe("seasonSummaries", () => {
  it("reports nothing for a save that has decided nothing", () => {
    expect(seasonSummaries(empty)).toEqual([]);
  });

  it("gives every completed season a row, newest first, even a trophyless one", () => {
    const rows = seasonSummaries({
      ...empty,
      seasonHistory: [
        { season: 1, championTidByCompId: { 0: 5 } },
        { season: 2, championTidByCompId: { 0: 9 } },
      ],
    });
    expect(rows.map((r) => r.season)).toEqual([2, 1]);
    expect(rows.map((r) => r.complete)).toEqual([true, true]);
    expect(rows[0].leagueChampions).toEqual({ 0: 9 });
  });

  it("takes each top flight's champion from the season's own record", () => {
    // championTidByCompId holds tier-1 champions only, keyed by the competition
    // as it was that season — which is what makes it right after a club has
    // since been promoted or relegated.
    const rows = seasonSummaries({
      ...empty,
      seasonHistory: [{ season: 4, championTidByCompId: { 0: 3, 2: 44 } }],
    });
    expect(rows[0].leagueChampions).toEqual({ 0: 3, 2: 44 });
  });

  it("opens a row for the season in progress once its continental final is played", () => {
    // Both continental finals are played before the offseason, so the season is
    // not in seasonHistory yet and has no league champions. Holding the row back
    // until the rollover would hide the club season's biggest result.
    const rows = seasonSummaries({
      ...empty,
      seasonHistory: [{ season: 1, championTidByCompId: { 0: 5 } }],
      cup: cup({ season: 2, championTid: 12 }),
    });
    expect(rows.map((r) => r.season)).toEqual([2, 1]);
    expect(rows[0].complete).toBe(false);
    expect(rows[0].leagueChampions).toEqual({});
    expect(rows[0].continentalCup).toEqual({ name: "Continental Cup", tid: 12 });
  });

  it("ignores a competition still being played", () => {
    const rows = seasonSummaries({
      ...empty,
      cup: cup({ season: 3 }),
      domesticCups: [domestic({ season: 3, country: "England" })],
    });
    expect(rows).toEqual([]);
  });

  it("reads the Shield separately from the Cup", () => {
    const rows = seasonSummaries({
      ...empty,
      cupHistory: [cup({ season: 2, championTid: 1 })],
      shieldHistory: [
        cup({ season: 2, championTid: 8, competition: "shield", name: "Continental Shield" }),
      ],
    });
    expect(rows[0].continentalCup?.tid).toBe(1);
    expect(rows[0].continentalShield).toEqual({ name: "Continental Shield", tid: 8 });
  });

  it("keys domestic cup winners by country, reading the live cups and the archive", () => {
    const rows = seasonSummaries({
      ...empty,
      domesticCupHistory: [
        domestic({ season: 1, country: "England", championTid: 4 }),
        domestic({ season: 1, country: "Spain", championTid: 41 }),
      ],
      domesticCups: [domestic({ season: 2, country: "England", championTid: 7 })],
    });
    expect(rows.map((r) => r.season)).toEqual([2, 1]);
    expect(rows[0].domesticCupWinners).toEqual({ England: 7 });
    expect(rows[1].domesticCupWinners).toEqual({ England: 4, Spain: 41 });
  });

  it("files an international tournament under the club season it followed", () => {
    // It is played in the *offseason* after that season and stamped with it —
    // the same convention worldAwards.ts and the News Feed already use.
    const rows = seasonSummaries({
      ...empty,
      seasonHistory: [{ season: 4, championTidByCompId: { 0: 5 } }],
      international: {
        history: [tournament({ season: 4 })],
        confederationCupHistory: [],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].international).toEqual([
      {
        name: "World Cup",
        confederation: undefined,
        nation: "Brazil",
        runnerUp: "France",
        score: "2-1",
      },
    ]);
  });

  it("carries each confederation championship's confederation, sorted by name", () => {
    // A confederation season decides several at once, and they are shown side by
    // side — so the caller needs to say which is which, and the order must not
    // depend on which archive order they happen to sit in.
    const rows = seasonSummaries({
      ...empty,
      international: {
        history: [],
        confederationCupHistory: [
          tournament({
            season: 6, name: "European Championship", confederation: "Europe",
            champion: "Spain", runnerUp: "Italy",
          }),
          tournament({
            season: 6, name: "Africa Cup of Nations", confederation: "Africa",
            champion: "Ghana", runnerUp: "Senegal",
          }),
        ],
      },
    });
    expect(rows[0].international.map((w) => [w.confederation, w.nation])).toEqual([
      ["Africa", "Ghana"],
      ["Europe", "Spain"],
    ]);
  });

  it("keeps a shootout in the international score", () => {
    const rows = seasonSummaries({
      ...empty,
      international: {
        history: [tournament({
          season: 8,
          finalScore: { champion: 1, runnerUp: 1, pens: { champion: 4, runnerUp: 3 } },
        })],
        confederationCupHistory: [],
      },
    });
    expect(rows[0].international[0].score).toBe("1-1 (4-3 pens)");
  });

  it("never opens a row for a super cup alone", () => {
    // A super cup is played in the PRESEASON, so counting one would open a row
    // for the new season on matchday 0 with nothing else in it — and the table
    // has no column for it anyway. They live on the Champions Cups page.
    const superCup = {
      season: 9,
      name: "English Super Cup",
      home: 1,
      away: 2,
      tie: { home: 1, away: 2, homeGoals: 2, awayGoals: 0, winner: 1, boxScore: null },
    } as unknown as SuperCupTie;
    const rows = seasonSummaries({ ...empty, superCups: [superCup] });
    expect(rows).toEqual([]);
  });
});
