import { describe, expect, it } from "vitest";
import {
  clubGoatRanking, clubStint, CLUB_GOAT_PARTS,
} from "../../src/core/frivolities/clubGoat.js";
import { playerGoatRanking, pointsOf } from "../../src/core/frivolities/goat.js";
import { allCareers } from "../../src/core/frivolities/careers.js";
import { emptyTotals, emptyBestSeasons } from "../../src/core/frivolities/stats.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";

/**
 * A player whose every season line names its club, which is the only thing a
 * club board reads. `lines` are `[season, tid, appearances]`, and `hist` is
 * stamped at season - 1, the convention `careers.ts` reads a played rating at.
 */
function makePlayer(o: {
  pid: number;
  name?: string;
  lines: [number, number, number][];
  ovrBySeason?: Record<number, number>;
}): Player {
  const ovrOf = (season: number) => o.ovrBySeason?.[season] ?? 70;
  return {
    pid: o.pid,
    name: o.name ?? `Player ${o.pid}`,
    nationality: "eng",
    born: 2000,
    pos: "ST",
    heightCm: 180,
    ovr: 70,
    potential: 70,
    stats: o.lines.map(([season, tid, appearances]) => ({
      ...emptySeasonStats(season, tid),
      appearances,
      goals: appearances,
      assists: appearances,
      ratingSum: appearances * 7,
      avgRating: 7,
      minutesPlayed: appearances * 90,
    })),
    hist: o.lines.map(([season]) => ({
      season: season - 1, ovr: ovrOf(season), ratings: {}, potential: ovrOf(season), academy: false,
    })),
  } as unknown as Player;
}

function makeArchived(o: Partial<ArchivedPlayer> & { pid: number }): ArchivedPlayer {
  return {
    name: `Retiree ${o.pid}`, nationality: "esp", pos: "ST", born: 1990, heightCm: 180,
    retiredSeason: 2028, retiredAge: 36, firstSeason: 2020, seasonsPlayed: 8,
    peakOvr: 82, peakSeason: 2024, finalOvr: 70, clubs: [1],
    totals: { ...emptyTotals(), appearances: 300, goals: 200, assists: 60, avgRating: 7.5 },
    best: emptyBestSeasons(),
    caps: 90, intlGoals: 40, intlTitles: 1,
    seasons: [{ season: 2024, tid: 1, ovr: 82, apps: 38 }],
    ...o,
  } as ArchivedPlayer;
}

function makeHistory(o: Partial<SeasonHistoryEntry> & { season: number }): SeasonHistoryEntry {
  return {
    table: [], compsByTid: {}, teamStats: [], awards: {}, championTidByCompId: {},
    ...o,
  } as unknown as SeasonHistoryEntry;
}

function makeStore(over: Partial<LeagueStore> = {}): LeagueStore {
  return {
    season: 2030,
    competitions: [{ id: 0, country: "eng", tier: 1, name: "England D1" }],
    teams: [
      { tid: 1, roster: [], academyRoster: [], compId: 0 },
      { tid: 2, roster: [], academyRoster: [], compId: 0 },
    ],
    players: [],
    retiredPlayers: [],
    seasonHistory: [],
    transfers: [],
    cupHistory: [],
    ...over,
  } as unknown as LeagueStore;
}

describe("clubStint", () => {
  it("narrows a career to one club's seasons", () => {
    const store = makeStore({
      players: [makePlayer({
        pid: 1,
        lines: [[2021, 1, 30], [2022, 1, 30], [2023, 2, 30]],
        ovrBySeason: { 2021: 72, 2022: 74, 2023: 90 },
      })],
    });
    const stint = clubStint(allCareers(store)[0], 1)!;

    expect(stint.seasonsPlayed).toBe(2);
    expect(stint.firstSeason).toBe(2021);
    expect(stint.lastSeason).toBe(2022);
    // His 90 came at the other club, so it is not this club's peak.
    expect(stint.peakOvr).toBe(74);
    expect(stint.totals.appearances).toBe(60);
    expect(stint.clubs).toEqual([1]);
  });

  it("zeroes production and international totals rather than carrying career figures", () => {
    // `StatTotals` is a career aggregate and `ArchivedSeason` records no goals,
    // so a per-club figure is not recoverable — carrying the career one would
    // credit a striker's goals elsewhere to every club he ever played for.
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2021, 1, 30], [2022, 2, 30]] })],
    });
    const stint = clubStint(allCareers(store)[0], 1)!;
    expect(stint.totals.goals).toBe(0);
    expect(stint.totals.assists).toBe(0);
    expect(stint.totals.avgRating).toBe(0);
    expect(stint.caps).toBe(0);
    expect(stint.intlTitles).toBe(0);
    // Appearances survive: `ArchivedSeason.apps` records them for retirees too.
    expect(stint.totals.appearances).toBe(30);
  });

  it("returns null for a club he never played a game for", () => {
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2021, 1, 30], [2022, 2, 0]] })],
    });
    expect(clubStint(allCareers(store)[0], 2)).toBeNull();
  });

  it("keeps squad-membership seasons in the slice, so a title from the bench still counts", () => {
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2021, 1, 30], [2022, 1, 0]] })],
    });
    const stint = clubStint(allCareers(store)[0], 1)!;
    expect(stint.seasons.map((s) => s.season)).toEqual([2021, 2022]);
    // But the year he never played doesn't count as a season played.
    expect(stint.seasonsPlayed).toBe(1);
  });
});

describe("clubGoatRanking", () => {
  it("ranks on time at the club, not on career — the whole point of the board", () => {
    // A one-season visitor with a monumental career elsewhere against a club
    // servant. The world board has the visitor first; the club board must not.
    const visitor = makePlayer({
      pid: 1,
      name: "Visitor",
      lines: [[2021, 1, 30], ...Array.from({ length: 10 }, (_, i): [number, number, number] =>
        [2022 + i, 2, 38])],
      ovrBySeason: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [2021 + i, 90])),
    });
    const servant = makePlayer({
      pid: 2,
      name: "Servant",
      lines: Array.from({ length: 10 }, (_, i): [number, number, number] => [2021 + i, 1, 38]),
      ovrBySeason: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [2021 + i, 78])),
    });
    const store = makeStore({ players: [visitor, servant] });

    expect(playerGoatRanking(store)[0].career.pid).toBe(1);

    const board = clubGoatRanking(store, 1);
    expect(board.map((r) => r.career.pid)).toEqual([2, 1]);
    // And the visitor's row describes his single season here, not his career.
    const visitorRow = board.find((r) => r.career.pid === 1)!;
    expect(visitorRow.stint.seasonsPlayed).toBe(1);
    expect(visitorRow.stint.totals.appearances).toBe(30);
  });

  it("leaves out anyone who never played for the club", () => {
    const store = makeStore({
      players: [
        makePlayer({ pid: 1, lines: [[2021, 1, 30]] }),
        makePlayer({ pid: 2, lines: [[2021, 2, 30]] }),
      ],
    });
    expect(clubGoatRanking(store, 1).map((r) => r.career.pid)).toEqual([1]);
    expect(clubGoatRanking(store, 2).map((r) => r.career.pid)).toEqual([2]);
  });

  it("counts an award won here and ignores one won somewhere else", () => {
    // A Player of the Season is stored by pid alone. Without the award scope it
    // would follow him onto the board of every club he ever played for.
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2021, 1, 30], [2022, 2, 30]] })],
      seasonHistory: [
        makeHistory({ season: 2021, awards: { 0: { playerOfSeasonPid: 1, goldenBootPid: null, teamOfSeason: [] } } }),
        makeHistory({ season: 2022, awards: { 0: { playerOfSeasonPid: 1, goldenBootPid: null, teamOfSeason: [] } } }),
      ],
    });

    // He won it twice, at one club each.
    expect(clubGoatRanking(store, 1)[0].honours.playerOfSeason).toBe(1);
    expect(clubGoatRanking(store, 2)[0].honours.playerOfSeason).toBe(1);
    // The world board still has both — the scope is opt-in, so it is unchanged.
    expect(playerGoatRanking(store)[0].honours.playerOfSeason).toBe(2);
  });

  it("credits a league title won while he was on the books, played or not", () => {
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2021, 1, 30], [2022, 1, 0], [2023, 2, 30]] })],
      seasonHistory: [
        makeHistory({ season: 2022, championTidByCompId: { 0: 1 } }),
        makeHistory({ season: 2023, championTidByCompId: { 0: 2 } }),
      ],
    });
    const here = clubGoatRanking(store, 1)[0];
    expect(here.honours.leagueTitles).toBe(1);
    expect(pointsOf(here, "trophies")).toBeGreaterThan(0);
    // The title he won at the other club belongs to that club's board.
    expect(clubGoatRanking(store, 2)[0].honours.leagueTitles).toBe(1);
  });

  it("drops the World Cup from a club board", () => {
    // A cap and a World Cup are his country's, not the club's.
    const store = makeStore({ retiredPlayers: [makeArchived({ pid: 9, intlTitles: 3 })] });
    const row = clubGoatRanking(store, 1)[0];
    expect(row.honours.worldCups).toBe(0);
    const trophies = row.components.find((c) => c.key === "trophies")!;
    expect(trophies.terms.map((t) => t.key)).not.toContain("worldCups");
  });

  it("includes archived retirees, who are what a club's all-time board is about", () => {
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2029, 1, 20]] })],
      retiredPlayers: [makeArchived({ pid: 9 })],
    });
    const board = clubGoatRanking(store, 1);
    expect(board.map((r) => r.career.pid).sort()).toEqual([1, 9]);
    expect(board.find((r) => r.career.pid === 9)!.career.active).toBe(false);
  });

  it("keeps the score equal to the sum of its components", () => {
    // The table's columns are generated from `components`, so a score that
    // doesn't reconcile with them renders as an unsorted-looking list.
    const store = makeStore({
      players: [makePlayer({ pid: 1, lines: [[2021, 1, 30], [2022, 1, 30]] })],
    });
    for (const r of clubGoatRanking(store, 1)) {
      expect(r.score).toBe(r.components.reduce((sum, c) => sum + c.points, 0));
    }
  });

  describe("CLUB_GOAT_PARTS", () => {
    // A player with something in every scorable part: a long stint, a title and
    // an award. If the list is honest he scores in all five and in nothing else.
    const decorated = () => makeStore({
      players: [makePlayer({
        pid: 1,
        lines: Array.from({ length: 6 }, (_, i): [number, number, number] => [2021 + i, 1, 38]),
        ovrBySeason: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [2021 + i, 82])),
      })],
      seasonHistory: [
        makeHistory({
          season: 2022,
          championTidByCompId: { 0: 1 },
          awards: { 0: { playerOfSeasonPid: 1, goldenBootPid: 1, teamOfSeason: [1] } },
        }),
      ],
    });

    it("lists every part a club board can actually award", () => {
      const [row] = clubGoatRanking(decorated(), 1);
      for (const key of CLUB_GOAT_PARTS) {
        const c = row.components.find((x) => x.key === key);
        expect(c, `${key} is listed but not scored`).toBeDefined();
        expect(c!.points, `${key} is listed but scored nothing`).toBeGreaterThan(0);
      }
    });

    it("omits only parts a club board structurally cannot award", () => {
      // The omitted part is "production", and it is omitted because `clubStint`
      // zeroes goals, assists and caps rather than because this player happens
      // to have none. If that ever becomes sliceable, this fails and forces the
      // list to be updated instead of quietly dropping a real column.
      const [row] = clubGoatRanking(decorated(), 1);
      const omitted = row.components.filter((c) => !CLUB_GOAT_PARTS.includes(c.key));
      expect(omitted.map((c) => c.key)).toEqual(["production"]);
      for (const c of omitted) {
        expect(c.points, `${c.key} is omitted from the columns but scores`).toBe(0);
      }
    });

    it("keeps the listed columns adding up to the score", () => {
      // The omitted part scores nothing, so the visible columns must reconcile
      // with the total on their own or the board reads as an unsorted list.
      const [row] = clubGoatRanking(decorated(), 1);
      const shown = CLUB_GOAT_PARTS.reduce(
        (sum, key) => sum + (row.components.find((c) => c.key === key)?.points ?? 0), 0);
      expect(shown).toBe(row.score);
    });
  });

  it("honours the limit", () => {
    const store = makeStore({
      players: Array.from({ length: 12 }, (_, i) =>
        makePlayer({ pid: i + 1, lines: [[2021, 1, 30]] })),
    });
    expect(clubGoatRanking(store, 1, 5)).toHaveLength(5);
  });
});
