import { describe, expect, it } from "vitest";
import { computeRecordBook } from "../../src/core/frivolities/records.js";
import { computePlayerBios } from "../../src/core/frivolities/bios.js";
import { computeClubTrivia } from "../../src/core/frivolities/clubs.js";
import { allCareers } from "../../src/core/frivolities/careers.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import {
  emptyTotals, emptyBestSeasons, ALL_TIME_STAT_KEYS, type AllTimeStatKey,
} from "../../src/core/frivolities/stats.js";
import { allTimeLeaderBoards, type LeaderScope } from "../../src/core/frivolities/leaders.js";
import {
  allTimeInternationalBoards, cappedNationalities, type IntlAllTimeKey,
} from "../../src/core/frivolities/international.js";
import {
  computeHonours, honourSourcesOf, playerGoatRanking, teamGoatRanking, pointsOf,
} from "../../src/core/frivolities/goat.js";
import { computeAwardTrivia, sortAwardRows, awardXIForClub } from "../../src/core/frivolities/honours.js";
import { computePlayerHonors } from "../../src/core/playerHonors.js";
import { computeClubHistory } from "../../src/core/clubHistory.js";
import type { WorldAwardEntry } from "../../src/core/worldAwards.js";
import { FREE_AGENT_TID } from "../../src/core/transfers/negotiation.js";
import { GOAT_TEAM_TREBLE_WEIGHT } from "../../src/core/constants.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";
import type { SeasonHistoryEntry, StandingsRow } from "../../src/core/standings.js";

/** A standings row with only the fields these derivations read. */
function row(tid: number, played: number, points: number, gd = 0, gf = 0): StandingsRow {
  return { tid, played, won: 0, drawn: 0, lost: 0, gf, ga: gf - gd, gd, points };
}

interface PlayerOver {
  pid: number;
  ovr?: number;
  age?: number;
  name?: string;
  nationality?: string;
  heightCm?: number;
  /** [season, tid, appearances, goals, assists] */
  lines?: [number, number, number, number, number][];
  recentHist?: [number, number][];
  /** [caps, international goals, World Cups won] */
  intl?: [number, number, number];
}

function makePlayer(o: PlayerOver): Player {
  return {
    pid: o.pid,
    name: o.name ?? `Player ${o.pid}`,
    nationality: o.nationality ?? "eng",
    born: 2030 - (o.age ?? 25),
    pos: "ST",
    heightCm: o.heightCm ?? 180,
    ovr: o.ovr ?? 60,
    potential: o.ovr ?? 60,
    recentStats: (o.lines ?? []).map(([season, tid, appearances, goals, assists]) => ({
      ...emptySeasonStats(season, tid), appearances, goals, assists,
      // Real SeasonStats carries avgRating alongside ratingSum (see its type),
      // so the fixture must too, or the single-season rating board sees nothing.
      ratingSum: appearances * 7, avgRating: 7, minutesPlayed: appearances * 90,
    })),
    recentHist: (o.recentHist ?? []).map(([season, ovr]) => ({
      season, ovr, ratings: {}, potential: ovr, academy: false,
    })),
    intl: o.intl
      ? { caps: o.intl[0], goals: o.intl[1], assists: 0, tournaments: 0, titles: o.intl[2], seasons: [] }
      : undefined,
  } as unknown as Player;
}

function makeArchived(o: Partial<ArchivedPlayer> & { pid: number }): ArchivedPlayer {
  return {
    name: `Retiree ${o.pid}`, nationality: "esp", pos: "ST", born: 1990, heightCm: 180,
    retiredSeason: 2028, retiredAge: 36, firstSeason: 2010, seasonsPlayed: 18,
    peakOvr: 80, peakSeason: 2018, finalOvr: 70, clubs: [1],
    totals: { ...emptyTotals(), appearances: 500, goals: 300, assists: 100, minutesPlayed: 45000, avgRating: 7.5 },
    best: { ...emptyBestSeasons(), goals: { value: 35, season: 2018, appearances: 38 } },
    caps: 100, intlGoals: 50, intlTitles: 0,
    seasons: [{ season: 2018, tid: 1, ovr: 80, apps: 38 }],
    ...o,
  } as ArchivedPlayer;
}

/**
 * A season-history entry carrying only the fields these derivations read.
 * The awards/world/teamStats halves belong to other pages, so they stay empty
 * rather than being filled in with fixture noise.
 */
function makeHistory(
  season: number,
  table: StandingsRow[],
  compsByTid: Record<number, number>,
): SeasonHistoryEntry {
  return {
    season, table, compsByTid, teamStats: [], awards: {}, championTidByCompId: {},
  } as unknown as SeasonHistoryEntry;
}

/** A LeagueStore carrying only what the frivolities derivations read. */
function makeStore(over: Partial<LeagueStore> = {}): LeagueStore {
  return {
    season: 2030,
    competitions: [
      { id: 0, country: "eng", tier: 1, name: "England D1" },
      { id: 1, country: "eng", tier: 2, name: "England D2" },
    ],
    teams: [
      { tid: 1, roster: [], academyRoster: [], compId: 0 },
      { tid: 2, roster: [], academyRoster: [], compId: 0 },
      { tid: 3, roster: [], academyRoster: [], compId: 1 },
    ],
    players: [],
    retiredPlayers: [],
    seasonHistory: [],
    transfers: [],
    cupHistory: [],
    ...over,
  } as unknown as LeagueStore;
}

describe("allCareers", () => {
  it("merges living players and archived retirees into one field", () => {
    // The whole point of the shared row: an all-time list must not quietly
    // cover only the players who happen to still be alive.
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2029, 1, 30, 20, 5]] })],
      retiredPlayers: [makeArchived({ pid: 99 })],
    });
    const careers = allCareers(store);
    expect(careers.map((c) => c.pid).sort()).toEqual([1, 99]);
    expect(careers.find((c) => c.pid === 1)!.active).toBe(true);
    expect(careers.find((c) => c.pid === 99)!.active).toBe(false);
  });

  it("dates a peak with no ratings history to the current season, not the birth season", () => {
    // A first-season player has no `hist` yet. `born` is a season number too,
    // so falling back to it renders a plausible-looking but wrong year.
    const store = makeStore({
      season: 2030,
      players: [makePlayer({ pid: 1, age: 22, lines: [[2030, 1, 30, 5, 5]] })],
    });
    expect(allCareers(store)[0].peakSeason).toBe(2030);
  });

  it("excludes players who never made a senior appearance", () => {
    // Academy kids and unsigned free agents would otherwise pad every list.
    const store = makeStore({ players: [makePlayer({ pid: 1 })] });
    expect(allCareers(store)).toHaveLength(0);
  });
});

describe("computeRecordBook", () => {
  it("ranks team seasons by points per game, not raw points", () => {
    // The load-bearing case: a 38-game league and a 20-game league in the same
    // save. Raw points would rank the bigger league's weaker season first.
    const store = makeStore({
      seasonHistory: [makeHistory(2029, [row(1, 38, 80), row(3, 20, 55)], { 1: 0, 3: 1 })],
    });
    const book = computeRecordBook(store);
    expect(book.bestTeamSeasons[0].tid).toBe(3); // 2.75 ppg vs 2.11
    expect(book.worstTeamSeasons[0].tid).toBe(1);
  });

  it("files a season under the competition it was played in, not today's", () => {
    // Club 1 sits in compId 0 today but played that season in the second tier.
    const store = makeStore({
      seasonHistory: [makeHistory(2029, [row(1, 20, 50)], { 1: 1 })],
    });
    expect(computeRecordBook(store).bestTeamSeasons[0].tier).toBe(2);
  });

  it("counts only real purchases among the biggest fees", () => {
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2029, 1, 5, 0, 0]] })],
      transfers: [
        { pid: 1, fromTid: 1, toTid: 2, fee: 50, season: 2029, window: "summer" },
        { pid: 1, fromTid: 2, toTid: 1, fee: 900, season: 2029, window: "summer", loanSeasons: 1 },
        { pid: 1, fromTid: FREE_AGENT_TID, toTid: 2, fee: 800, season: 2029, window: "summer" },
        { pid: 1, fromTid: 1, toTid: 2, fee: 0, season: 2029, window: "summer" },
      ],
    } as Partial<LeagueStore>);
    const fees = computeRecordBook(store).biggestTransfers;
    expect(fees).toHaveLength(1);
    expect(fees[0].fee).toBe(50);
  });

  it("carries each transfer's player nationality, so the row can render a flag", () => {
    // Without this the biggest-fees table was the one player list on the page
    // with no flags, because TransferRecord didn't carry a nationality at all.
    const store = makeStore({
      players: [makePlayer({ pid: 1, nationality: "Brazil", lines: [[2029, 1, 5, 0, 0]] })],
      transfers: [
        { pid: 1, fromTid: 1, toTid: 2, fee: 50, season: 2029, window: "summer" },
        // A player the save no longer knows: still a real transfer, but there
        // is no nationality to show, so it must be empty rather than invented.
        { pid: 404, fromTid: 1, toTid: 2, fee: 90, season: 2029, window: "summer" },
      ],
    } as Partial<LeagueStore>);
    const fees = computeRecordBook(store).biggestTransfers;
    expect(fees.find((f) => f.pid === 1)!.nationality).toBe("Brazil");
    expect(fees.find((f) => f.pid === 404)!.nationality).toBe("");
    expect(fees.find((f) => f.pid === 404)!.name).toBe("Player 404");
  });

  it("puts retirees on the all-time lists alongside active players", () => {
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2029, 1, 30, 20, 5]], recentHist: [[2029, 75]] })],
      retiredPlayers: [makeArchived({ pid: 99, peakOvr: 88 })],
    });
    const book = computeRecordBook(store);
    expect(book.careerGoals[0].pid).toBe(99);
    expect(book.peakRatings[0].pid).toBe(99);
    expect(book.seasonGoals[0].pid).toBe(99);
    expect(book.hasArchive).toBe(true);
  });
});

describe("allTimeLeaderBoards", () => {
  /** One stat's board, the way the page reads a card or a full list out. */
  const leaders = (
    store: LeagueStore,
    stat: AllTimeStatKey,
    scope: LeaderScope,
    limit?: number,
  ) => allTimeLeaderBoards(store, scope, limit)[stat];

  const store = makeStore({
    players: [
      makePlayer({ pid: 1, lines: [[2028, 1, 30, 20, 4], [2029, 1, 30, 12, 6]] }),
      makePlayer({ pid: 2, lines: [[2029, 2, 30, 25, 1]] }),
    ],
    // Career 300 goals, best season 35 — ahead of both living players on each.
    retiredPlayers: [makeArchived({ pid: 99 })],
  });

  it("ranks career totals across the living and the retired together", () => {
    const rows = leaders(store, "goals", "career");
    expect(rows.map((r) => r.career.pid)).toEqual([99, 1, 2]);
    expect(rows[0].value).toBe(300);
    expect(rows[1].value).toBe(32); // 20 + 12
    expect(rows[0].season).toBeNull();
  });

  it("ranks one row per player in single-season scope — his own best", () => {
    // A player with two recorded seasons must not occupy two places: a retiree
    // only keeps his best, so listing every season for the living would make
    // the board mean different things for different players.
    const rows = leaders(store, "goals", "single");
    expect(rows.map((r) => r.career.pid)).toEqual([99, 2, 1]);
    expect(rows.find((r) => r.career.pid === 1)!.value).toBe(20);
    expect(rows.find((r) => r.career.pid === 1)!.season).toBe(2028);
    expect(rows.filter((r) => r.career.pid === 1)).toHaveLength(1);
  });

  it("drops players with nothing recorded in the chosen stat", () => {
    // Nobody in this fixture has a save, so the board is empty rather than a
    // list of zeroes.
    expect(leaders(store, "saves", "career")).toEqual([]);
  });

  it("applies an appearance floor to match rating but not to counting stats", () => {
    const cameo = makeStore({
      players: [
        // One brilliant game: must not top a rating board, but must still count
        // for goals.
        makePlayer({ pid: 1, lines: [[2029, 1, 1, 2, 0]] }),
        makePlayer({ pid: 2, lines: [[2029, 2, 38, 5, 0]] }),
      ],
    });
    expect(leaders(cameo, "avgRating", "career").map((r) => r.career.pid)).toEqual([2]);
    expect(leaders(cameo, "avgRating", "single").map((r) => r.career.pid)).toEqual([2]);
    expect(leaders(cameo, "goals", "career").map((r) => r.career.pid)).toEqual([2, 1]);
  });

  it("honours the row limit", () => {
    expect(leaders(store, "goals", "career", 1)).toHaveLength(1);
  });

  it("covers every ranked stat in one call", () => {
    // The grid renders a card per stat off one result, so a missing key is a
    // silently missing board rather than a crash.
    for (const scope of ["career", "single"] as const) {
      expect(Object.keys(allTimeLeaderBoards(store, scope)).sort())
        .toEqual([...ALL_TIME_STAT_KEYS].sort());
    }
  });
});

describe("allTimeInternationalBoards", () => {
  /** One counter's board, the way the page reads a card or a full list out. */
  const intl = (
    store: LeagueStore,
    key: IntlAllTimeKey,
    nationality: string | null = null,
    limit?: number,
  ) => allTimeInternationalBoards(store, nationality, limit)[key];

  const store = makeStore({
    players: [
      makePlayer({ pid: 1, nationality: "eng", lines: [[2029, 1, 30, 20, 4]], intl: [40, 18, 0] }),
      makePlayer({ pid: 2, nationality: "eng", lines: [[2029, 2, 30, 25, 1]], intl: [70, 9, 1] }),
      makePlayer({ pid: 3, nationality: "bra", lines: [[2029, 2, 30, 5, 1]], intl: [12, 30, 0] }),
      // Never called up: must not appear on any of the boards.
      makePlayer({ pid: 4, nationality: "eng", lines: [[2029, 1, 30, 9, 0]] }),
    ],
    // The retiree the whole board exists for: 50 international goals, more than
    // any active player, and gone from `players` entirely.
    retiredPlayers: [makeArchived({ pid: 99, nationality: "esp" })],
  });

  it("ranks scorers across the living and the retired together", () => {
    // A nation's all-time top scorer is by definition a long career, so he is
    // usually retired. A board off the live pool alone would hand the record to
    // a new man every few seasons.
    const rows = intl(store, "intlGoals");
    expect(rows.map((r) => r.pid)).toEqual([99, 3, 1, 2]);
    expect(rows[0].intlGoals).toBe(50);
    expect(rows[0].active).toBe(false);
  });

  it("ranks by caps and by World Cups won when asked", () => {
    expect(intl(store, "caps").map((r) => r.pid)).toEqual([99, 2, 1, 3]);
    // Only one player in the fixture has ever won one, so the board is a single
    // row rather than a list padded with zeroes.
    expect(intl(store, "intlTitles").map((r) => r.pid)).toEqual([2]);
  });

  it("filters to one country's record book", () => {
    // The question the page is really for: who is *our* all-time top scorer.
    expect(intl(store, "intlGoals", "eng").map((r) => r.pid)).toEqual([1, 2]);
    expect(intl(store, "intlGoals", "esp").map((r) => r.pid)).toEqual([99]);
  });

  it("leaves out players who were never capped", () => {
    expect(intl(store, "caps").map((r) => r.pid)).not.toContain(4);
    expect(intl(store, "intlGoals").map((r) => r.pid)).not.toContain(4);
  });

  it("offers only countries that have a capped career on record", () => {
    // A country in the dropdown that filters to an empty table reads as a bug.
    expect(cappedNationalities(store)).toEqual(["bra", "eng", "esp"]);
  });

  it("honours the row limit", () => {
    expect(intl(store, "intlGoals", null, 2)).toHaveLength(2);
  });

  it("covers every counter in one call", () => {
    // The grid renders a card per counter off one result, so a missing key is a
    // silently missing board rather than a crash.
    expect(Object.keys(allTimeInternationalBoards(store)).sort())
      .toEqual(["caps", "intlGoals", "intlTitles"]);
  });
});

describe("computePlayerBios", () => {
  const store = makeStore({
    teams: [{ tid: 1, roster: [1, 2], academyRoster: [3], compId: 0 }],
    players: [
      makePlayer({ pid: 1, name: "Alan Smith", nationality: "eng", heightCm: 200, age: 34, ovr: 70 }),
      makePlayer({ pid: 2, name: "Bob Smith", nationality: "eng", heightCm: 165, age: 30, ovr: 80 }),
      makePlayer({ pid: 3, name: "Carlos Ruiz", nationality: "esp", heightCm: 180, age: 17, ovr: 50 }),
    ],
  } as Partial<LeagueStore>);
  const bios = computePlayerBios(store);

  it("finds the height and age extremes", () => {
    expect(bios.tallest[0].pid).toBe(1);
    expect(bios.shortest[0].pid).toBe(2);
    expect(bios.oldest[0].pid).toBe(1);
    // The academy teenager must be eligible or the youngest list is nonsense.
    expect(bios.youngest[0].pid).toBe(3);
  });

  it("aggregates each country's players and names its best", () => {
    const eng = bios.nationalities.find((n) => n.nationality === "eng")!;
    expect(eng.count).toBe(2);
    expect(eng.avgOvr).toBe(75);
    expect(eng.best!.pid).toBe(2);
    // Academy players count toward the country but not the rostered tally.
    const esp = bios.nationalities.find((n) => n.nationality === "esp")!;
    expect(esp.rostered).toBe(0);
  });

  it("counts shared surnames, keeping multi-word surnames whole", () => {
    expect(bios.commonSurnames).toEqual([{ name: "Smith", count: 2 }]);
    // A name nobody shares is not a "common name".
    expect(bios.commonFirstNames).toEqual([]);
  });
});

describe("computeClubTrivia", () => {
  const history = [
    makeHistory(2028, [row(1, 38, 90, 40, 80), row(2, 38, 70, 20, 60), row(3, 38, 88, 30, 70)],
      { 1: 0, 2: 0, 3: 1 }),
    makeHistory(2029, [row(1, 38, 60, 10, 50), row(2, 38, 85, 35, 75), row(3, 38, 91, 45, 85)],
      { 1: 0, 2: 0, 3: 1 }),
  ];

  it("counts titles per competition, separating the tiers", () => {
    const trivia = computeClubTrivia(makeStore({ seasonHistory: history }));
    const byTid = new Map(trivia.records.map((r) => [r.tid, r]));
    expect(byTid.get(1)!.leagueTitles).toBe(1); // won the 2028 top flight
    expect(byTid.get(2)!.leagueTitles).toBe(1); // won the 2029 top flight
    // Club 3 topped the second tier twice — trophies, but not league titles.
    expect(byTid.get(3)!.leagueTitles).toBe(0);
    expect(byTid.get(3)!.secondTierTitles).toBe(2);
    expect(byTid.get(3)!.topFlightSeasons).toBe(0);
  });

  it("measures a never-won club's drought as its whole recorded history", () => {
    const trivia = computeClubTrivia(makeStore({ seasonHistory: history }));
    const club3 = trivia.records.find((r) => r.tid === 3)!;
    expect(club3.lastTitleSeason).toBeNull();
    expect(club3.titleDrought).toBe(2);
    // Club 1 last won in 2028 and the latest recorded season is 2029.
    expect(trivia.records.find((r) => r.tid === 1)!.titleDrought).toBe(1);
  });

  it("counts cup titles from the archived cups", () => {
    const trivia = computeClubTrivia(makeStore({
      seasonHistory: history,
      cupHistory: [{ championTid: 2 }, { championTid: 2 }, { championTid: null }],
    } as unknown as Partial<LeagueStore>));
    expect(trivia.records.find((r) => r.tid === 2)!.cupTitles).toBe(2);
  });

  it("excludes loans and free moves from transfer spending", () => {
    const trivia = computeClubTrivia(makeStore({
      transfers: [
        { pid: 1, fromTid: 1, toTid: 2, fee: 100, season: 2029, window: "summer" },
        { pid: 2, fromTid: 1, toTid: 2, fee: 500, season: 2029, window: "summer", loanSeasons: 1 },
        { pid: 3, fromTid: FREE_AGENT_TID, toTid: 2, fee: 700, season: 2029, window: "summer" },
      ],
    } as Partial<LeagueStore>));
    const buyer = trivia.biggestSpenders.find((s) => s.tid === 2)!;
    expect(buyer.spent).toBe(100);
    expect(buyer.signings).toBe(1);
    // The sentinel must never appear as a club in a spending table.
    expect(trivia.biggestSpenders.some((s) => s.tid === FREE_AGENT_TID)).toBe(false);
    expect(trivia.biggestSellers.find((s) => s.tid === 1)!.net).toBe(100);
  });

  /**
   * A finished Continental Cup that `winner` lifted. Round 3 is the final of a
   * legacy bracket: a fixture with no `leaguePhase` is not a Swiss cup, so it
   * gets the four legacy rounds rather than the Swiss three.
   */
  function continentalCup(season: number, winner: number, loser: number) {
    return {
      season, teams: [winner, loser], championTid: winner,
      ties: [{ round: 3, home: winner, away: loser, winner }],
    };
  }

  /** A finished one-round domestic cup that `winner` lifted. */
  function domesticCup(season: number, winner: number, loser: number) {
    return {
      season, country: "eng", name: "English Cup", teams: [winner, loser],
      totalRounds: 1, championTid: winner, statLines: [],
      rounds: [{
        round: 0, matchday: 36, byes: [],
        pairings: [{ home: winner, away: loser }],
        ties: [{ round: 0, home: winner, away: loser, winner }],
      }],
    };
  }

  /**
   * The same two seasons as `history`, but with each competition's rows in
   * finishing order, which is how the sim stores them. It matters here and not
   * elsewhere in this file: `computeClubTrivia` re-sorts a table by points
   * before picking the winner, while `clubHistory` reads a club's position
   * straight off the stored order. Only a table in the real shape lets the two
   * be compared at all.
   */
  const trebleHistory = [
    makeHistory(2028, [row(1, 38, 90, 40, 80), row(2, 38, 70, 20, 60), row(3, 38, 88, 30, 70)],
      { 1: 0, 2: 0, 3: 1 }),
    makeHistory(2029, [row(2, 38, 85, 35, 75), row(1, 38, 60, 10, 50), row(3, 38, 91, 45, 85)],
      { 1: 0, 2: 0, 3: 1 }),
  ];

  /**
   * Club 1 wins the 2028 league and the 2028 Continental Cup, but club 3 takes
   * that season's domestic cup. Club 2 wins all three in 2029.
   */
  const trebleStore = () => makeStore({
    seasonHistory: trebleHistory,
    cupHistory: [continentalCup(2028, 1, 2), continentalCup(2029, 2, 1)],
    domesticCupHistory: [domesticCup(2028, 3, 1), domesticCup(2029, 2, 3)],
  } as unknown as Partial<LeagueStore>);

  it("counts a treble only when all three trophies land in the same season", () => {
    const byTid = new Map(computeClubTrivia(trebleStore()).records.map((r) => [r.tid, r]));
    expect(byTid.get(2)!.trebles).toBe(1);
    // Two of the three is not a treble, however good the season was.
    expect(byTid.get(1)!.trebles).toBe(0);
    // Club 3 won a domestic cup, but its league titles are second-tier ones.
    expect(byTid.get(3)!.trebles).toBe(0);
  });

  it("keeps a treble out of the total, since its three wins are already counted", () => {
    const club2 = computeClubTrivia(trebleStore()).records.find((r) => r.tid === 2)!;
    expect(club2.trebles).toBe(1);
    // League title + Continental Cup + domestic cup. Not four.
    expect(club2.totalTrophies).toBe(3);
  });

  it("agrees with clubHistory about what a treble is", () => {
    // Two derivations answer the same question: this one walks every club in a
    // single pass over history, clubHistory walks one club's own seasons. A
    // divergence shows up as a club page and the trophy cabinet disagreeing
    // about the same season, so it is pinned rather than left to drift.
    const store = trebleStore();
    const byTid = new Map(computeClubTrivia(store).records.map((r) => [r.tid, r]));
    for (const tid of [1, 2, 3]) {
      expect(computeClubHistory(store, tid).trebles.length).toBe(byTid.get(tid)!.trebles);
    }
  });

  it("counts total trophies across both tiers and the cup", () => {
    const trivia = computeClubTrivia(makeStore({
      seasonHistory: history,
      cupHistory: [{ season: 2029, championTid: 2 }],
    } as unknown as Partial<LeagueStore>));
    const byTid = new Map(trivia.records.map((r) => [r.tid, r]));
    expect(byTid.get(1)!.totalTrophies).toBe(1);
    expect(byTid.get(2)!.totalTrophies).toBe(2); // one league title, one cup
    expect(byTid.get(3)!.totalTrophies).toBe(2); // two second-tier titles
    // The table leads with this column, so the ranking has to follow it.
    const totals = trivia.records.map((r) => r.totalTrophies);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });
});

describe("one-club men", () => {
  it("finds players who only ever appeared for one club", () => {
    const bios = computePlayerBios(makeStore({
      players: [
        makePlayer({ pid: 1, lines: [[2028, 1, 30, 0, 0], [2029, 1, 30, 0, 0]] }),
        makePlayer({ pid: 2, lines: [[2028, 1, 30, 0, 0], [2029, 2, 30, 0, 0]] }),
      ],
    } as Partial<LeagueStore>));
    expect(bios.oneClubMen.map((m) => m.career.pid)).toEqual([1]);
    expect(bios.oneClubMen[0].tid).toBe(1);
  });
});

describe("GOAT rankings", () => {
  /** A season-history entry that also carries awards and a champion. */
  function historyWithAwards(
    season: number,
    table: StandingsRow[],
    compsByTid: Record<number, number>,
    extra: {
      champion?: number;
      ballonDOr?: number;
      worldXI?: (number | null)[];
      poty?: number;
      goldenBoot?: number;
      tots?: (number | null)[];
    } = {},
  ): SeasonHistoryEntry {
    return {
      season, table, compsByTid, teamStats: [],
      awards: {
        0: {
          playerOfSeasonPid: extra.poty ?? null,
          goldenBootPid: extra.goldenBoot ?? null,
          teamOfSeason: extra.tots ?? [],
        },
      },
      world: {
        ballonDOr: extra.ballonDOr == null ? [] : [{ pid: extra.ballonDOr }],
        worldTeamOfYear: extra.worldXI ?? [],
      },
      championTidByCompId: extra.champion == null ? {} : { 0: extra.champion },
    } as unknown as SeasonHistoryEntry;
  }

  describe("computeHonours", () => {
    it("agrees with the Player Profile's honours for the same player", () => {
      // Two implementations of the same question exist for a real reason (this
      // one covers archived retirees, who have no Player object at all), but a
      // divergence would show as a profile and a GOAT row disagreeing about the
      // same trophy. Pin them together.
      const player = makePlayer({
        pid: 1,
        lines: [[2028, 1, 30, 10, 2], [2029, 1, 0, 0, 0]],
        recentHist: [[2027, 85], [2028, 86]],
      });
      const history = [
        historyWithAwards(2028, [row(1, 38, 90)], { 1: 0 },
          { champion: 1, ballonDOr: 1, poty: 1, tots: [1], worldXI: [1], goldenBoot: 1 }),
        // He was in the squad but never played: main's rule credits this title,
        // so this one has to as well.
        historyWithAwards(2029, [row(1, 38, 88)], { 1: 0 }, { champion: 1 }),
      ];
      const store = makeStore({ players: [player], seasonHistory: history } as unknown as Partial<LeagueStore>);

      const mine = computeHonours(honourSourcesOf(store), allCareers(store)).get(1)!;
      const theirs = computePlayerHonors(player, history);

      expect(mine.leagueTitles).toBe(theirs.leagueTitles.length);
      expect(mine.leagueTitles).toBe(2);
      expect(mine.ballonDOr).toBe(theirs.ballonDOr.length);
      expect(mine.worldXI).toBe(theirs.worldTeamOfYear.length);
      expect(mine.playerOfSeason).toBe(theirs.playerOfSeason.length);
      expect(mine.goldenBoot).toBe(theirs.goldenBoot.length);
      expect(mine.teamOfSeason).toBe(theirs.teamOfSeason.length);
    });

    it("credits awards and titles to retired players, not just the living", () => {
      // The whole reason honours are derived from seasonHistory instead of
      // snapshotted: a retiree must keep every trophy he ever won.
      const store = makeStore({
        players: [],
        retiredPlayers: [makeArchived({
          pid: 99,
          seasons: [{ season: 2028, tid: 1, ovr: 90, apps: 38 }, { season: 2029, tid: 1, ovr: 88, apps: 38 }],
          intlTitles: 1,
        })],
        cupHistory: [{ season: 2029, championTid: 1 }],
        seasonHistory: [
          historyWithAwards(2028, [row(1, 38, 90)], { 1: 0 },
            { champion: 1, ballonDOr: 99, poty: 99, tots: [99] }),
          historyWithAwards(2029, [row(1, 38, 88)], { 1: 0 },
            { champion: 1, worldXI: [99], goldenBoot: 99 }),
        ],
      } as unknown as Partial<LeagueStore>);

      const h = computeHonours(honourSourcesOf(store), allCareers(store)).get(99)!;
      expect(h.ballonDOr).toBe(1);
      expect(h.playerOfSeason).toBe(1);
      expect(h.teamOfSeason).toBe(1);
      expect(h.worldXI).toBe(1);
      expect(h.goldenBoot).toBe(1);
      expect(h.leagueTitles).toBe(2);
      expect(h.cupTitles).toBe(1);
      expect(h.worldCups).toBe(1);
    });

    it("only credits a title to players who were at the club that season", () => {
      // He joined the champions the season *after* they won it.
      const store = makeStore({
        players: [makePlayer({ pid: 1, lines: [[2029, 1, 30, 5, 0]] })],
        seasonHistory: [
          historyWithAwards(2028, [row(1, 38, 90)], { 1: 0 }, { champion: 1 }),
          historyWithAwards(2029, [row(1, 38, 60), row(2, 38, 90)], { 1: 0, 2: 0 }, { champion: 2 }),
        ],
      } as unknown as Partial<LeagueStore>);
      expect(computeHonours(honourSourcesOf(store), allCareers(store)).get(1)!.leagueTitles).toBe(0);
    });
  });

  describe("playerGoatRanking", () => {
    it("ranks a decorated career above an equally rated one with no honours", () => {
      const store = makeStore({
        players: [
          makePlayer({ pid: 1, lines: [[2029, 1, 38, 20, 5]], recentHist: [[2028, 90]] }),
          makePlayer({ pid: 2, lines: [[2029, 2, 38, 20, 5]], recentHist: [[2028, 90]] }),
        ],
        seasonHistory: [
          historyWithAwards(2029, [row(1, 38, 90), row(2, 38, 80)], { 1: 0, 2: 0 },
            { champion: 1, ballonDOr: 1, poty: 1 }),
        ],
      } as unknown as Partial<LeagueStore>);

      const rank = playerGoatRanking(store);
      expect(rank[0].career.pid).toBe(1);
      expect(pointsOf(rank[0], "awards")).toBeGreaterThan(0);
      expect(pointsOf(rank[1], "awards")).toBe(0);
    });

    it("returns exactly the parts the score is made of, with nothing left over", () => {
      // The UI shows these six as columns and the score beside them, so any
      // component missing from this list is a breakdown a reader can't
      // reconcile with the total. That shipped once already.
      const store = makeStore({
        players: [makePlayer({
          pid: 1, lines: [[2029, 1, 38, 20, 5]], recentHist: [[2028, 90]],
        })],
        seasonHistory: [
          historyWithAwards(2029, [row(1, 38, 90)], { 1: 0 },
            { champion: 1, ballonDOr: 1, poty: 1, goldenBoot: 1, tots: [1], worldXI: [1] }),
        ],
      } as unknown as Partial<LeagueStore>);

      const r = playerGoatRanking(store)[0];
      // Exact, not close, at both levels: terms sum to their component and
      // components sum to the score, so nothing the UI shows can fail to
      // reconcile with the number beside it.
      expect(r.components.reduce((sum, c) => sum + c.points, 0)).toBe(r.score);
      for (const c of r.components) {
        // The component is the rounded sum of its exact terms.
        expect(c.points).toBe(Math.round(c.terms.reduce((sum, t) => sum + t.points, 0)));
        expect(Number.isInteger(c.points)).toBe(true);
        for (const t of c.terms) {
          // Exact, so a reader multiplying count by weight gets the shown
          // figure. Rounding here produced lines like "24 x 0.15 = 4".
          expect(t.points).toBe(t.count * t.weight);
        }
      }
      // All six must be carrying something here, or the test would pass just as
      // well with a component silently stuck at zero.
      expect(r.components.map((c) => c.key)).toEqual([
        "peak", "prime", "longevity", "awards", "trophies", "production",
      ]);
      for (const c of r.components) expect(c.points).toBeGreaterThan(0);
    });

    it("names each award in the breakdown, so a reader can check the working", () => {
      const store = makeStore({
        players: [makePlayer({ pid: 1, lines: [[2029, 1, 38, 20, 5]], recentHist: [[2028, 90]] })],
        seasonHistory: [
          historyWithAwards(2029, [row(1, 38, 90)], { 1: 0 },
            { champion: 1, ballonDOr: 1, tots: [1] }),
        ],
      } as unknown as Partial<LeagueStore>);

      const awards = playerGoatRanking(store)[0].components.find((c) => c.key === "awards")!;
      const bdo = awards.terms.find((t) => t.key === "ballonDOr")!;
      expect(bdo.count).toBe(1);
      expect(bdo.points).toBe(bdo.weight);
      expect(bdo.count * bdo.weight).toBe(bdo.points);
      // Awards he never won must not clutter the breakdown with zero rows.
      expect(awards.terms.some((t) => t.key === "goldenBoot")).toBe(false);
    });

    it("rewards a long prime over a single brilliant season", () => {
      // Same peak, very different careers — the distinction the formula exists
      // to make.
      const oneYear = makePlayer({
        pid: 1, lines: [[2029, 1, 38, 20, 5]], recentHist: [[2028, 90]],
      });
      const longCareer = makePlayer({
        pid: 2,
        lines: Array.from({ length: 10 }, (_, i) => [2020 + i, 2, 38, 20, 5] as [number, number, number, number, number]),
        recentHist: Array.from({ length: 10 }, (_, i) => [2019 + i, 88] as [number, number]),
      });
      const store = makeStore({ players: [oneYear, longCareer] });
      const rank = playerGoatRanking(store);
      expect(rank[0].career.pid).toBe(2);
      expect(pointsOf(rank[0], "prime")).toBeGreaterThan(pointsOf(rank[1], "prime"));
    });

    it("gives no peak or prime credit below the baseline", () => {
      // A journeyman shouldn't accumulate a GOAT case just by existing.
      const store = makeStore({
        players: [makePlayer({ pid: 1, lines: [[2029, 1, 38, 0, 0]], recentHist: [[2028, 55]] })],
      });
      const r = playerGoatRanking(store)[0];
      expect(pointsOf(r, "peak")).toBe(0);
      expect(pointsOf(r, "prime")).toBe(0);
    });
  });

  describe("teamGoatRanking", () => {
    const store = makeStore({
      seasonHistory: [
        historyWithAwards(2028, [row(1, 38, 90, 40), row(2, 38, 70, 10), row(3, 20, 55)],
          { 1: 0, 2: 0, 3: 1 }, { champion: 1 }),
        historyWithAwards(2029, [row(1, 38, 88, 35), row(2, 38, 60, 5), row(3, 20, 50)],
          { 1: 0, 2: 0, 3: 1 }, { champion: 1 }),
      ],
      cupHistory: [{ season: 2029, championTid: 1 }],
    } as unknown as Partial<LeagueStore>);

    it("puts the serial winner top and shows its cabinet", () => {
      const rank = teamGoatRanking(store);
      expect(rank[0].tid).toBe(1);
      expect(rank[0].leagueTitles).toBe(2);
      expect(rank[0].cupTitles).toBe(1);
      expect(rank[0].components.reduce((sum, c) => sum + c.points, 0)).toBe(rank[0].score);
    });

    it("counts a second-tier title separately from a top-flight one", () => {
      const club3 = teamGoatRanking(store).find((r) => r.tid === 3)!;
      expect(club3.leagueTitles).toBe(0);
      expect(club3.secondTierTitles).toBe(2);
      expect(club3.topFlightSeasons).toBe(0);
      // And it must not outrank the club that won the actual league twice.
      expect(club3.score).toBeLessThan(teamGoatRanking(store)[0].score);
    });

    it("computes career points per game across seasons, not a mean of means", () => {
      // 178 points from 76 matches.
      expect(teamGoatRanking(store).find((r) => r.tid === 1)!.ppg).toBeCloseTo(178 / 76, 6);
    });

    /**
     * Club 1 won the league in both seasons and the Continental Cup in 2029, so
     * giving it the domestic cup in 2029 completes a treble and in 2028 does
     * not. Either way it has won exactly the same three trophies, which is what
     * isolates the bonus from the trophies it sits on top of.
     */
    const storeWithDomesticCup = (season: number) => makeStore({
      seasonHistory: [
        historyWithAwards(2028, [row(1, 38, 90, 40), row(2, 38, 70, 10), row(3, 20, 55)],
          { 1: 0, 2: 0, 3: 1 }, { champion: 1 }),
        historyWithAwards(2029, [row(1, 38, 88, 35), row(2, 38, 60, 5), row(3, 20, 50)],
          { 1: 0, 2: 0, 3: 1 }, { champion: 1 }),
      ],
      cupHistory: [{ season: 2029, championTid: 1 }],
      domesticCupHistory: [{ season, championTid: 1 }],
    } as unknown as Partial<LeagueStore>);

    it("scores a treble as a bonus on top of the three trophies that make it up", () => {
      const treble = teamGoatRanking(storeWithDomesticCup(2029)).find((r) => r.tid === 1)!;
      const spread = teamGoatRanking(storeWithDomesticCup(2028)).find((r) => r.tid === 1)!;

      expect(treble.trebles).toBe(1);
      expect(spread.trebles).toBe(0);
      // Same cabinet in both: two league titles, one Continental Cup, one
      // domestic cup. Only the timing differs.
      expect(treble.leagueTitles).toBe(spread.leagueTitles);
      expect(treble.cupTitles).toBe(spread.cupTitles);
      expect(treble.domesticCupTitles).toBe(spread.domesticCupTitles);
      // So the entire gap is the bonus, and nothing was double-counted.
      expect(treble.score - spread.score).toBe(GOAT_TEAM_TREBLE_WEIGHT);
    });

    it("shows the treble in the trophies breakdown, still summing to the score", () => {
      const treble = teamGoatRanking(storeWithDomesticCup(2029)).find((r) => r.tid === 1)!;
      const trophies = treble.components.find((c) => c.key === "trophies")!;
      const term = trophies.terms.find((t) => t.key === "trebles")!;
      expect(term.count).toBe(1);
      expect(term.weight).toBe(GOAT_TEAM_TREBLE_WEIGHT);
      // The board generates its columns from `components`, so a term that
      // counts toward the score has to be visible in the breakdown too.
      expect(treble.components.reduce((sum, c) => sum + c.points, 0)).toBe(treble.score);
    });
  });
});

describe("awards trivia", () => {
  /** A Ballon d'Or shortlist entry, defaulting every part into the league component. */
  function bdo(pid: number, tid: number, score: number, parts: Partial<WorldAwardEntry> = {}): WorldAwardEntry {
    return { pid, tid, score, league: score, cup: 0, intl: 0, title: 0, ...parts };
  }

  /** A season-history entry carrying only the award records these boards read. */
  function awardHistory(season: number, o: {
    ballonDOr?: WorldAwardEntry[];
    worldXI?: (number | null)[];
    poty?: number;
    goldenBoot?: number;
    tots?: (number | null)[];
  }): SeasonHistoryEntry {
    return {
      season, table: [], teamStats: [], compsByTid: {}, championTidByCompId: {},
      awards: {
        0: {
          playerOfSeasonPid: o.poty ?? null,
          goldenBootPid: o.goldenBoot ?? null,
          teamOfSeason: o.tots ?? [],
        },
      },
      world: { ballonDOr: o.ballonDOr ?? [], worldTeamOfYear: o.worldXI ?? [] },
    } as unknown as SeasonHistoryEntry;
  }

  it("counts every individual award per career and re-ranks on demand", () => {
    const store = makeStore({
      players: [
        makePlayer({ pid: 1, lines: [[2028, 1, 38, 30, 5]], nationality: "bra" }),
        makePlayer({ pid: 2, lines: [[2028, 2, 38, 25, 5]], nationality: "esp" }),
      ],
      seasonHistory: [
        awardHistory(2028, {
          ballonDOr: [bdo(1, 1, 9), bdo(2, 2, 8)],
          worldXI: [2], poty: 2, goldenBoot: 2, tots: [1, 2],
        }),
      ],
    });

    const trivia = computeAwardTrivia(store);
    const one = trivia.careers.find((r) => r.career.pid === 1)!;
    const two = trivia.careers.find((r) => r.career.pid === 2)!;
    expect(one.tally.ballonDOr).toBe(1);
    expect(one.tally.total).toBe(2); // Ballon d'Or + a Team of the Season place.
    expect(two.tally.total).toBe(4); // World XI, Player of the Season, Golden Boot, TOTS.
    // Ranked by the whole haul the runner-up leads; ranked by the Ballon d'Or
    // itself, the winner does.
    expect(trivia.careers[0].career.pid).toBe(2);
    expect(sortAwardRows(trivia.careers, "ballonDOr")[0].career.pid).toBe(1);
    // A board ranked by one award never lists players who haven't won it.
    expect(sortAwardRows(trivia.careers, "ballonDOr")).toHaveLength(1);
  });

  it("scores a career of near-misses on shares, and counts wins in a row", () => {
    const store = makeStore({
      players: [
        makePlayer({ pid: 1, lines: [[2028, 1, 38, 30, 5]] }),
        makePlayer({ pid: 2, lines: [[2028, 2, 38, 25, 5]] }),
      ],
      seasonHistory: [
        awardHistory(2028, { ballonDOr: [bdo(1, 1, 9), bdo(2, 2, 8.5)] }),
        awardHistory(2029, { ballonDOr: [bdo(1, 1, 9), bdo(2, 2, 8.4)] }),
        // A gap year, so the streak below has to stop at two.
        awardHistory(2031, { ballonDOr: [bdo(2, 2, 9), bdo(1, 1, 8)] }),
      ],
    });

    const trivia = computeAwardTrivia(store);
    const one = trivia.ballonDOr.find((r) => r.career.pid === 1)!;
    const two = trivia.ballonDOr.find((r) => r.career.pid === 2)!;
    expect(one.ballon.wins).toBe(2);
    expect(one.ballon.runnerUp).toBe(1);
    expect(one.ballon.bestRun).toBe(2);
    expect(two.ballon.bestRun).toBe(1);
    // A win is a whole share, a runner-up nine tenths of one.
    expect(one.ballon.shares).toBeCloseTo(2.9, 6);
    expect(two.ballon.shares).toBeCloseTo(2.8, 6);
    expect(trivia.ballonDOr[0].career.pid).toBe(1);
  });

  it("ranks single seasons by score across the whole save, winners and losers alike", () => {
    // A monster runner-up season must be allowed to outrank a weak winner from
    // another year — that's the question this board answers.
    const store = makeStore({
      players: [
        makePlayer({ pid: 1, lines: [[2028, 1, 38, 30, 5]] }),
        makePlayer({ pid: 2, lines: [[2028, 2, 38, 25, 5]] }),
      ],
      seasonHistory: [
        awardHistory(2028, { ballonDOr: [bdo(1, 1, 12, { cup: 3 }), bdo(2, 2, 11)] }),
        awardHistory(2029, { ballonDOr: [bdo(2, 2, 7)] }),
      ],
    });

    const seasons = computeAwardTrivia(store).dominantSeasons;
    expect(seasons.map((s) => [s.pid, s.season, s.rank]))
      .toEqual([[1, 2028, 1], [2, 2028, 2], [2, 2029, 1]]);
    // The parts behind the top score survive for the breakdown.
    expect(seasons[0].entry.cup).toBe(3);
  });

  it("credits an award to the club he was at that season, not the one he's at now", () => {
    const store = makeStore({
      players: [makePlayer({
        pid: 1, nationality: "bra",
        lines: [[2028, 1, 38, 30, 5], [2029, 2, 38, 20, 5]],
      })],
      seasonHistory: [awardHistory(2028, { poty: 1, tots: [1] })],
    });

    const trivia = computeAwardTrivia(store);
    expect(trivia.clubs.map((c) => c.tid)).toEqual([1]);
    expect(trivia.clubs[0].total).toBe(2);
    expect(trivia.nations[0]).toMatchObject({ nationality: "bra", playerOfSeason: 1, total: 2 });
  });

  it("keeps a retiree's honours, and still shows an award nobody remembers winning", () => {
    const store = makeStore({
      players: [],
      retiredPlayers: [makeArchived({
        pid: 99, name: "Old Hand", born: 1998,
        seasons: [{ season: 2028, tid: 1, ovr: 90, apps: 38 }],
      })],
      seasonHistory: [
        awardHistory(2028, { ballonDOr: [bdo(99, 1, 10), bdo(7, 2, 9)], poty: 99 }),
      ],
    });

    const trivia = computeAwardTrivia(store);
    expect(trivia.careers[0].career.name).toBe("Old Hand");
    expect(trivia.careers[0].tally.total).toBe(2);
    // pid 7 is in neither the pool nor the archive: the award happened, so the
    // row renders under a placeholder rather than disappearing.
    const stranger = trivia.dominantSeasons.find((s) => s.pid === 7)!;
    expect(stranger.name).toBe("Player 7");
    expect(stranger.nationality).toBe("");
    expect(stranger.age).toBeNull();
    // ...and an unknown pid can't be filed under a country.
    expect(trivia.nations.map((n) => n.nationality)).toEqual(["esp"]);
  });

  describe("a club's all-time award XI", () => {
    /** Selections for slot `slot`, as an 11-long team-of-the-year array. */
    function atSlot(slot: number, pid: number): (number | null)[] {
      const xi: (number | null)[] = Array(11).fill(null);
      xi[slot] = pid;
      return xi;
    }

    it("fills each slot with the club's most-selected player there", () => {
      const store = makeStore({
        players: [
          makePlayer({ pid: 1, lines: [[2028, 1, 38, 30, 5], [2029, 1, 38, 28, 5]] }),
          makePlayer({ pid: 2, lines: [[2028, 1, 38, 10, 5], [2029, 1, 38, 12, 5]] }),
        ],
        seasonHistory: [
          awardHistory(2028, { tots: atSlot(10, 1), worldXI: atSlot(9, 2) }),
          awardHistory(2029, { tots: atSlot(10, 1) }),
        ],
      });

      const xi = awardXIForClub(computeAwardTrivia(store), 1);
      expect(xi).toHaveLength(11);
      expect(xi[10].pick).toMatchObject({ pid: 1, teamOfSeason: 2, worldXI: 0, seasons: [2028, 2029] });
      expect(xi[9].pick).toMatchObject({ pid: 2, worldXI: 1 });
      // Slots nobody has ever been picked in stay empty rather than being
      // filled with whoever is nearest.
      expect(xi.filter((s) => s.pick !== null)).toHaveLength(2);
      expect(xi[0].pick).toBeNull();
    });

    it("gives a player only one slot, and hands the other to the next-best man", () => {
      // He was picked up front one season and wide the next. Printing him twice
      // in one XI reads as a bug, so the weaker slot falls to someone else.
      const store = makeStore({
        players: [
          makePlayer({ pid: 1, lines: [[2028, 1, 38, 30, 5], [2029, 1, 38, 28, 5], [2030, 1, 38, 20, 5]] }),
          makePlayer({ pid: 2, lines: [[2030, 1, 38, 15, 5]] }),
        ],
        seasonHistory: [
          // Two selections at slot 10, one at slot 9.
          awardHistory(2028, { tots: atSlot(10, 1) }),
          awardHistory(2029, { tots: atSlot(10, 1) }),
          awardHistory(2030, { tots: atSlot(9, 1) }),
          awardHistory(2030, { tots: atSlot(9, 2) }),
        ],
      });

      const xi = awardXIForClub(computeAwardTrivia(store), 1);
      expect(xi[10].pick!.pid).toBe(1);
      expect(xi[9].pick!.pid).toBe(2);
    });

    it("counts a worldwide place above a domestic one", () => {
      const store = makeStore({
        players: [
          makePlayer({ pid: 1, lines: [[2028, 1, 38, 30, 5]] }),
          makePlayer({ pid: 2, lines: [[2028, 1, 38, 20, 5], [2029, 1, 38, 20, 5]] }),
        ],
        seasonHistory: [
          awardHistory(2028, { worldXI: atSlot(10, 1), tots: atSlot(10, 2) }),
          awardHistory(2029, { tots: atSlot(10, 2) }),
        ],
      });

      // Two Team of the Season places don't outweigh one World XI.
      expect(awardXIForClub(computeAwardTrivia(store), 1)[10].pick!.pid).toBe(1);
    });

    it("credits the selection to the club he was at that season", () => {
      const store = makeStore({
        players: [makePlayer({
          pid: 1, lines: [[2028, 1, 38, 30, 5], [2029, 2, 38, 28, 5]],
        })],
        seasonHistory: [
          awardHistory(2028, { tots: atSlot(10, 1) }),
          awardHistory(2029, { tots: atSlot(10, 1) }),
        ],
      });

      const trivia = computeAwardTrivia(store);
      expect(awardXIForClub(trivia, 1)[10].pick).toMatchObject({ pid: 1, seasons: [2028] });
      expect(awardXIForClub(trivia, 2)[10].pick).toMatchObject({ pid: 1, seasons: [2029] });
    });

    it("gives a club with no selections the full empty shape", () => {
      const store = makeStore({ seasonHistory: [awardHistory(2028, {})] });
      const xi = awardXIForClub(computeAwardTrivia(store), 3);
      expect(xi).toHaveLength(11);
      expect(xi.every((s) => s.pick === null)).toBe(true);
      // The shape is the 4-3-3 both awards are picked in.
      expect(xi[0].pos).toBe("GK");
    });
  });

  it("ages a winner by the season he won it, not by today", () => {
    const store = makeStore({
      season: 2040,
      players: [
        makePlayer({ pid: 1, age: 30, lines: [[2028, 1, 38, 30, 5]] }),
        makePlayer({ pid: 2, age: 40, lines: [[2029, 2, 38, 25, 5]] }),
      ],
      seasonHistory: [
        awardHistory(2028, { ballonDOr: [bdo(1, 1, 9)] }),
        awardHistory(2029, { ballonDOr: [bdo(2, 2, 9)] }),
      ],
    });

    const trivia = computeAwardTrivia(store);
    // makePlayer dates a birth off season 2030, so these are 2000 and 1990.
    expect(trivia.youngestWinners.map((w) => [w.pid, w.age])).toEqual([[1, 28], [2, 39]]);
    expect(trivia.oldestWinners[0].pid).toBe(2);
    expect(trivia.rollOfHonour.map((r) => r.season)).toEqual([2029, 2028]);
    expect(trivia.rollOfHonour[0].runnerUp).toBeNull();
  });
});
