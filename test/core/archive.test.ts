import { describe, expect, it } from "vitest";
import {
  archivePlayer, extendRetireeArchive, isArchiveWorthy, type ArchivedPlayer,
} from "../../src/core/players/archive.js";
import {
  RETIREE_ARCHIVE_MIN_APPEARANCES, RETIREE_ARCHIVE_MIN_PEAK_OVR,
} from "../../src/core/constants.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";

const SEASON = 2030;

interface Over {
  pid: number;
  ovr?: number;
  age?: number;
  /** [season, tid, appearances, goals, assists] per season line. */
  lines?: [season: number, tid: number, appearances: number, goals: number, assists: number][];
  /** [season, ovr] ratings snapshots. */
  hist?: [season: number, ovr: number][];
  caps?: number;
}

function makePlayer({ pid, ovr = 60, age = 34, lines = [], hist = [], caps }: Over): Player {
  return {
    pid,
    name: `Player ${pid}`,
    nationality: "eng",
    born: SEASON - age,
    pos: "ST",
    heightCm: 180,
    ovr,
    potential: ovr,
    stats: lines.map(([season, tid, appearances, goals, assists]) => ({
      ...emptySeasonStats(season, tid), appearances, goals, assists,
      // Real SeasonStats carries avgRating alongside ratingSum (see its type),
      // so the fixture must too, or the single-season rating board sees nothing.
      ratingSum: appearances * 7, avgRating: 7, minutesPlayed: appearances * 90,
    })),
    hist: hist.map(([season, h]) => ({ season, ovr: h, ratings: {}, potential: h, academy: false })),
    ...(caps === undefined ? {} : { intl: { caps, goals: 3, assists: 0, tournaments: 0, titles: 0, seasons: [] } }),
  } as unknown as Player;
}

describe("isArchiveWorthy", () => {
  it("rejects a player who never made a senior appearance, however highly rated", () => {
    // The bulk of every offseason's retirees: unsigned players with no career.
    // Letting these through is what turns the archive into the 88 MB save.
    const p = makePlayer({ pid: 1, hist: [[2029, 90]] });
    expect(isArchiveWorthy(p)).toBe(false);
  });

  it("keeps a player who reached the peak-rating bar", () => {
    const p = makePlayer({
      pid: 2,
      lines: [[2029, 3, 10, 2, 1]],
      hist: [[2029, RETIREE_ARCHIVE_MIN_PEAK_OVR]],
    });
    expect(isArchiveWorthy(p)).toBe(true);
  });

  it("keeps a long-serving player who never reached the rating bar", () => {
    // The longevity lists exist for exactly this career, so the appearance
    // clause has to admit him despite a modest peak.
    const p = makePlayer({
      pid: 3,
      lines: [[2029, 3, RETIREE_ARCHIVE_MIN_APPEARANCES, 5, 5]],
      hist: [[2029, RETIREE_ARCHIVE_MIN_PEAK_OVR - 10]],
    });
    expect(isArchiveWorthy(p)).toBe(true);
  });

  it("rejects a short career at a modest peak", () => {
    const p = makePlayer({
      pid: 4,
      lines: [[2029, 3, 20, 1, 1]],
      hist: [[2029, RETIREE_ARCHIVE_MIN_PEAK_OVR - 1]],
    });
    expect(isArchiveWorthy(p)).toBe(false);
  });
});

describe("archivePlayer", () => {
  const player = makePlayer({
    pid: 7,
    ovr: 55,
    age: 35,
    lines: [
      [2026, 1, 30, 10, 5],
      [2027, 1, 28, 18, 3],
      [2028, 2, 25, 12, 9],
      [2029, 2, 0, 0, 0], // injured out — must not count as a season played
    ],
    hist: [[2026, 72], [2027, 78], [2028, 74]],
    caps: 40,
  });
  const row = archivePlayer(player, SEASON);

  it("sums league career totals across seasons he actually played", () => {
    expect(row.totals.appearances).toBe(83);
    expect(row.totals.goals).toBe(40);
    expect(row.totals.assists).toBe(17);
    expect(row.seasonsPlayed).toBe(3);
    expect(row.firstSeason).toBe(2026);
  });

  it("reads peak ovr off the ratings history, not the post-decline value", () => {
    // player.ovr is 55: retirement rolls after progression has applied his
    // final decline, so the live field is a rating he never actually played at.
    expect(row.peakOvr).toBe(78);
    expect(row.peakSeason).toBe(2027);
  });

  it("records the best single season separately from career totals", () => {
    // Goals and assists peaked in different seasons — the point of storing both.
    expect(row.best.goals.value).toBe(18);
    expect(row.best.goals.season).toBe(2027);
    expect(row.best.assists.value).toBe(9);
    expect(row.best.assists.season).toBe(2028);
    // Appearances ride along so the rate-stat floor can be applied to a
    // retiree the same way it is to a living player.
    expect(row.best.goals.appearances).toBe(28);
  });

  it("lists distinct clubs in the order he played for them", () => {
    expect(row.clubs).toEqual([1, 2]);
  });

  it("averages rating per appearance, not per season", () => {
    expect(row.totals.avgRating).toBeCloseTo(7, 5);
  });

  it("carries international totals", () => {
    expect(row.caps).toBe(40);
    expect(row.intlGoals).toBe(3);
  });
});

describe("extendRetireeArchive", () => {
  const worthy = (pid: number, peak: number) => makePlayer({
    pid,
    lines: [[2029, 1, 30, 5, 5]],
    hist: [[2029, peak]],
  });

  it("appends only the archive-worthy retirees", () => {
    const out = extendRetireeArchive([], [
      worthy(1, 80),
      makePlayer({ pid: 2, hist: [[2029, 90]] }), // never played
    ], SEASON);
    expect(out.map((r) => r.pid)).toEqual([1]);
  });

  it("keeps the best careers when the cap is exceeded, not the oldest", () => {
    // A dynasty must lose its journeymen, not its legends — the whole reason
    // the cap prunes by career score rather than by age.
    const existing: ArchivedPlayer[] = [archivePlayer(worthy(1, 95), 2000)];
    const out = extendRetireeArchive(
      existing,
      [worthy(2, 71), worthy(3, 85)],
      SEASON,
      2,
    );
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.pid).sort()).toEqual([1, 3]);
  });

  it("is pure: the same input produces the same output and the input is untouched", () => {
    const existing: ArchivedPlayer[] = [];
    const retirees = [worthy(1, 80), worthy(2, 82)];
    const a = extendRetireeArchive(existing, retirees, SEASON);
    const b = extendRetireeArchive(existing, retirees, SEASON);
    expect(a).toEqual(b);
    expect(existing).toHaveLength(0);
  });
});
