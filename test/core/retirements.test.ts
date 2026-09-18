import { describe, expect, it } from "vitest";
import { summarizeRetirements, farewellIndex } from "../../src/core/players/retirements.js";
import { RETIREMENT_NOTABLE_LIMIT } from "../../src/core/constants.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";
import type { HonourSources } from "../../src/core/frivolities/goat.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";

const SEASON = 2030;

/**
 * The least that can score a career. No cast: the scorer asks for the two
 * sources it actually reads rather than a whole league, which is what stops it
 * silently reading empty cup histories inside the worker.
 */
function honoursWith(seasonHistory: SeasonHistoryEntry[] = []): HonourSources {
  return { seasonHistory, cup: [], shield: [], domestic: [] };
}

const HONOURS = honoursWith();

interface Over {
  pid: number;
  ovr?: number;
  age?: number;
  /** [season, appearances, goals, assists] per season line. */
  lines?: [season: number, appearances: number, goals: number, assists: number][];
  caps?: number;
}

function makePlayer({ pid, ovr = 60, age = 34, lines = [], caps }: Over): Player {
  return {
    pid,
    name: `Player ${pid}`,
    nationality: "eng",
    born: SEASON - age,
    pos: "ST",
    ovr,
    potential: ovr,
    recentStats: lines.map(([season, appearances, goals, assists]) => ({
      ...emptySeasonStats(season), appearances, goals, assists,
    })),
    recentHist: [],
    ...(caps === undefined ? {} : { intl: { caps, goals: 0, assists: 0, tournaments: 0, titles: 0, seasons: [] } }),
  } as unknown as Player;
}

describe("summarizeRetirements", () => {
  it("counts everyone but names only the best, bounded by the display cap", () => {
    // More retirees than the cap, ovr ascending with pid so the expected order is known.
    const retirees = Array.from({ length: RETIREMENT_NOTABLE_LIMIT + 20 }, (_, i) =>
      makePlayer({ pid: i + 1, ovr: 40 + i }));
    const summary = summarizeRetirements(retirees, SEASON, new Map(), 0, HONOURS);

    expect(summary.total).toBe(RETIREMENT_NOTABLE_LIMIT + 20);
    expect(summary.notable).toHaveLength(RETIREMENT_NOTABLE_LIMIT);
    // Best first, and the weakest retirees are the ones dropped.
    expect(summary.notable[0].ovr).toBe(40 + RETIREMENT_NOTABLE_LIMIT + 19);
    expect(summary.notable.at(-1)!.ovr).toBe(40 + 20);
    expect([...summary.notable].sort((a, b) => b.ovr - a.ovr)).toEqual(summary.notable);
  });

  it("separates who a club had on its books from who was unsigned", () => {
    const retirees = [makePlayer({ pid: 1 }), makePlayer({ pid: 2 }), makePlayer({ pid: 3 })];
    // pid 3 is in nobody's squad.
    const summary = summarizeRetirements(retirees, SEASON, new Map([[1, 7], [2, 9]]), 0, HONOURS);

    expect(summary.total).toBe(3);
    expect(summary.rostered).toBe(2);
    expect(summary.notable.find((r) => r.pid === 1)!.tid).toBe(7);
    expect(summary.notable.find((r) => r.pid === 3)!.tid).toBeNull();
  });

  it("keeps the user's own retirees even when the world's are better", () => {
    // 30 elite AI retirees would otherwise fill the list on their own.
    const retirees = [
      ...Array.from({ length: 30 }, (_, i) => makePlayer({ pid: 100 + i, ovr: 85 })),
      makePlayer({ pid: 1, ovr: 52 }),
    ];
    const tids = new Map<number, number>([[1, 4]]);
    for (let i = 0; i < 30; i++) tids.set(100 + i, 11);

    const summary = summarizeRetirements(retirees, SEASON, tids, 4, HONOURS);

    expect(summary.notable.map((r) => r.pid)).toContain(1);
    // Still bounded, and still ranked by caliber rather than pinning his to the top.
    expect(summary.notable).toHaveLength(RETIREMENT_NOTABLE_LIMIT);
    expect(summary.notable.at(-1)!.pid).toBe(1);
  });

  it("stays bounded even when the user retires more players than the cap", () => {
    const retirees = Array.from({ length: RETIREMENT_NOTABLE_LIMIT + 5 }, (_, i) =>
      makePlayer({ pid: i + 1, ovr: 50 + i }));
    const tids = new Map(retirees.map((p) => [p.pid, 4]));

    const summary = summarizeRetirements(retirees, SEASON, tids, 4, HONOURS);

    expect(summary.notable).toHaveLength(RETIREMENT_NOTABLE_LIMIT);
    expect(summary.total).toBe(RETIREMENT_NOTABLE_LIMIT + 5);
  });

  it("snapshots the career totals the profile page could no longer show", () => {
    const player = makePlayer({
      pid: 1, ovr: 78, age: 37, caps: 64,
      // The middle season is a full year out injured: no appearances, so it
      // doesn't count as a season played.
      lines: [[2027, 30, 18, 6], [2028, 0, 0, 0], [2029, 22, 9, 11]],
    });

    const [row] = summarizeRetirements([player], SEASON, new Map([[1, 3]]), 0, HONOURS).notable;

    expect(row).toMatchObject({
      pid: 1, name: "Player 1", nationality: "eng", pos: "ST",
      age: 37, ovr: 78, tid: 3, seasonsPlayed: 2, appearances: 52, goals: 27, assists: 17, caps: 64,
    });
  });

  it("remembers the rating he played his last season at, not his post-decline one", () => {
    // Retirement rolls after progression, so the live `ovr` is already the
    // rating he'd have carried into a season he never plays. A veteran who
    // dropped 6 points in his final offseason should be remembered at 80.
    const player = makePlayer({ pid: 1, ovr: 74, age: 38 });
    player.recentHist = [{
      season: SEASON - 1, ratings: player.ratings, ovr: 80, potential: 80, academy: false, pos: player.pos,
    }];

    const [row] = summarizeRetirements([player], SEASON, new Map(), 0, HONOURS).notable;
    expect(row.ovr).toBe(80);
  });

  it("reports zero caps for a player who was never called up", () => {
    const [row] = summarizeRetirements([makePlayer({ pid: 1 })], SEASON, new Map(), 0, HONOURS).notable;
    expect(row.caps).toBe(0);
  });

  it("ranks the bigger career above the higher final rating", () => {
    // A twelve-year forward bowing out at 68 against a journeyman who drifted
    // out of the game at 78. Sorting on the rating each retired at puts the
    // journeyman first, which is exactly backwards for a list of the biggest
    // names to go.
    const legend = makePlayer({
      pid: 1, ovr: 68, age: 37,
      lines: Array.from({ length: 12 }, (_, i): [number, number, number, number] =>
        [SEASON - 12 + i, 30, 15, 8]),
    });
    const journeyman = makePlayer({ pid: 2, ovr: 78, age: 30 });

    const summary = summarizeRetirements([journeyman, legend], SEASON, new Map(), 0, HONOURS);

    expect(summary.notable.map((r) => r.pid)).toEqual([1, 2]);
  });

  it("counts the honours a retiree won, not just what he played at", () => {
    // Nothing separates these two on the pitch — the decorated one is the
    // weaker player by his final rating — so a Ballon d'Or is the whole case.
    const decorated = makePlayer({ pid: 1, ovr: 60, age: 36 });
    const better = makePlayer({ pid: 2, ovr: 78, age: 30 });
    const honours = honoursWith([
      { season: SEASON - 4, world: { ballonDOr: [{ pid: 1 }] } } as unknown as SeasonHistoryEntry,
    ]);

    const summary = summarizeRetirements([better, decorated], SEASON, new Map(), 0, honours);

    expect(summary.notable.map((r) => r.pid)).toEqual([1, 2]);
  });

  it("records the score it ranked on, since the player is about to be deleted", () => {
    const decorated = makePlayer({ pid: 1, ovr: 60, age: 36 });
    const nobody = makePlayer({ pid: 2, ovr: 60, age: 36 });
    const honours = honoursWith([
      { season: SEASON - 4, world: { ballonDOr: [{ pid: 1 }] } } as unknown as SeasonHistoryEntry,
    ]);

    const { notable } = summarizeRetirements([decorated, nobody], SEASON, new Map(), 0, honours);

    // Every fresh row carries one, the Ballon d'Or is worth something, and the
    // stored order is the order those scores put them in.
    expect(notable.every((r) => r.goat !== undefined)).toBe(true);
    expect(notable[0].goat!).toBeGreaterThan(notable[1].goat!);
    expect(notable.map((r) => r.pid)).toEqual([1, 2]);
  });

  it("handles an offseason where nobody retired", () => {
    expect(summarizeRetirements([], SEASON, new Map(), 0, HONOURS))
      .toEqual({ total: 0, rostered: 0, notable: [] });
  });
});

describe("farewellIndex", () => {
  const row = (pid: number, name: string) => ({
    pid, name, nationality: "eng", pos: "ST" as const, age: 34, ovr: 70,
    tid: 1, seasonsPlayed: 10, appearances: 300, goals: 90, assists: 40, caps: 0,
  });

  it("names every retiree the season history said farewell to", () => {
    const index = farewellIndex([
      { retirements: { total: 400, rostered: 90, notable: [row(1, "Ade Bello"), row(2, "Cai Duarte")] } },
      { retirements: { total: 380, rostered: 88, notable: [row(3, "Eli Fournier")] } },
    ]);
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(index.get(2)?.name).toBe("Cai Duarte");
  });

  it("skips seasons that never recorded a farewell list", () => {
    // The field is optional and deliberately never backfilled: a season played
    // before the record existed deleted its retirees without a trace, so the
    // index has to tolerate a history that is only partly populated.
    const index = farewellIndex([
      {},
      { retirements: { total: 1, rostered: 1, notable: [row(7, "Gus Halle")] } },
      {},
    ]);
    expect(index.size).toBe(1);
    expect(index.get(7)?.name).toBe("Gus Halle");
  });

  it("is empty for a save with no history at all", () => {
    expect(farewellIndex([]).size).toBe(0);
  });
});
