import { describe, it, expect, beforeAll } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { simThrough } from "../../src/core/simThrough.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import {
  clubLines, statsAtClub, statsAtClubs, mergeLines, moveSeasonRowTo, addMatchToSeasonRow,
} from "../../src/core/players/seasonStints.js";
import { emptySeasonStats, type SeasonStatLine, type SeasonStats } from "../../src/core/players/types.js";
import type { PlayerMatchLine } from "../../src/engine/attribution.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/** Every summed field of a stat line, for comparing a total against its parts. */
const SUMMED = [
  "appearances", "goals", "assists", "shots", "shotsOnTarget", "goalsAgainst", "saves",
  "tackles", "interceptions", "passes", "passesCompleted", "crosses", "foulsCommitted",
  "yellowCards", "redCards", "minutesPlayed",
] as const;

function matchLine(goals: number): PlayerMatchLine {
  return {
    pid: 1, goals, assists: 0, shots: goals, shotsOnTarget: goals, xg: 0.5, goalsAgainst: 0, xga: 0,
    saves: 0, tackles: 1, interceptions: 0, passes: 10, passesCompleted: 8, crosses: 0,
    foulsCommitted: 0, yellowCards: 0, redCards: 0, minutesPlayed: 90, rating: 7,
  } as PlayerMatchLine;
}

describe("season stints (unit)", () => {
  it("a player who never moves has no breakdown and one club line", () => {
    const ss: SeasonStats = emptySeasonStats(3, 10);
    addMatchToSeasonRow(ss, matchLine(1));
    moveSeasonRowTo(ss, 10);
    expect(ss.stints).toBeUndefined();
    expect(clubLines(ss)).toHaveLength(1);
    expect(statsAtClub({ stats: [ss] }, 3, 10)?.goals).toBe(1);
    expect(statsAtClub({ stats: [ss] }, 3, 11)).toBeUndefined();
  });

  it("a move splits the season: the old club keeps what he did there", () => {
    const ss: SeasonStats = emptySeasonStats(3, 10);
    addMatchToSeasonRow(ss, matchLine(2));
    addMatchToSeasonRow(ss, matchLine(1));
    moveSeasonRowTo(ss, 20);
    addMatchToSeasonRow(ss, matchLine(4));

    expect(ss.tid).toBe(20);
    expect(ss.goals).toBe(7); // the row is still the whole season
    const p = { stats: [ss] };
    expect(statsAtClub(p, 3, 10)).toMatchObject({ tid: 10, goals: 3, appearances: 2 });
    expect(statsAtClub(p, 3, 20)).toMatchObject({ tid: 20, goals: 4, appearances: 1 });
    expect(statsAtClub(p, 3, 20)?.avgRating).toBe(7);
  });

  it("a loan and its return merge back into one line for the parent club", () => {
    const ss: SeasonStats = emptySeasonStats(3, 10);
    addMatchToSeasonRow(ss, matchLine(1));
    moveSeasonRowTo(ss, 20);
    addMatchToSeasonRow(ss, matchLine(2));
    moveSeasonRowTo(ss, 10);
    addMatchToSeasonRow(ss, matchLine(3));

    const lines = clubLines(ss);
    expect(lines.map((l) => l.tid)).toEqual([10, 20]);
    expect(lines[0].goals).toBe(4);
    expect(lines[0].appearances).toBe(2);
  });

  it("a per-league board sums every club in its scope", () => {
    const ss: SeasonStats = emptySeasonStats(3, 10);
    addMatchToSeasonRow(ss, matchLine(1));
    moveSeasonRowTo(ss, 11);
    addMatchToSeasonRow(ss, matchLine(2));
    moveSeasonRowTo(ss, 99);
    addMatchToSeasonRow(ss, matchLine(5));

    const sameLeague = statsAtClubs({ stats: [ss] }, 3, (tid) => tid < 50);
    expect(sameLeague).toMatchObject({ goals: 3, appearances: 2, tid: 11 });
    expect(statsAtClubs({ stats: [ss] }, 3, (tid) => tid === 42)).toBeUndefined();
  });

  it("merging lines keeps ratings as a volume-weighted average", () => {
    const a = { ...emptySeasonStats(1, 1), appearances: 1, ratingSum: 9, avgRating: 9 } as SeasonStatLine;
    const b = { ...emptySeasonStats(1, 2), appearances: 3, ratingSum: 15, avgRating: 5 } as SeasonStatLine;
    expect(mergeLines([a, b]).avgRating).toBe(6);
  });
});

describe("season stints (a real mid-season move)", () => {
  let before: LeagueStore;
  let after: LeagueStore;
  let pid: number;
  let fromTid: number;
  let toTid: number;
  let atMove: SeasonStats;

  beforeAll(() => {
    const rng = mulberry32(71);
    let league = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    league = simThrough(league, { matchday: 12 }, rng);

    // Move the best player at one AI club to another, the way a winter deal
    // would: off one roster, onto the other. He is good enough to start there.
    const tier1 = league.competitions.find((c) => c.tier === 1)!;
    const clubs = league.teams.filter((t) => t.compId === tier1.id && t.tid !== league.meta.userTid);
    const [from, to] = [clubs[1], clubs[2]];
    const byPid = new Map(league.players.map((p) => [p.pid, p]));
    pid = [...from.roster].sort((a, b) => byPid.get(b)!.ovr - byPid.get(a)!.ovr)[0];
    fromTid = from.tid;
    toTid = to.tid;
    atMove = structuredClone(byPid.get(pid)!.stats.find((s) => s.season === league.season)!);
    expect(atMove.appearances).toBeGreaterThan(0);

    league = {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === fromTid ? { ...t, roster: t.roster.filter((x) => x !== pid), starters: null }
        : t.tid === toTid ? { ...t, roster: [...t.roster, pid], starters: null }
        : t),
    };
    before = league;
    after = simThrough(league, { matchday: 24 }, rng);
  }, 300_000);

  it("keeps his games for the old club at the old club", () => {
    const p = after.players.find((x) => x.pid === pid)!;
    const row = p.stats.find((s) => s.season === after.season)!;
    expect(row.tid).toBe(toTid);
    const atOld = statsAtClub(p, after.season, fromTid)!;
    for (const k of SUMMED) expect(atOld[k]).toBe(atMove[k]);
  });

  it("credits the new club only with what he did there", () => {
    const p = after.players.find((x) => x.pid === pid)!;
    const row = p.stats.find((s) => s.season === after.season)!;
    const atNew = statsAtClub(p, after.season, toTid)!;
    expect(atNew.appearances).toBeGreaterThan(0);
    for (const k of SUMMED) expect(atNew[k] + atMove[k]).toBe(row[k]);
  });

  it("leaves the league it was handed untouched", () => {
    const p = before.players.find((x) => x.pid === pid)!;
    const row = p.stats.find((s) => s.season === before.season)!;
    expect(row.stints).toBeUndefined();
    expect(row.tid).toBe(fromTid);
    expect(row.appearances).toBe(atMove.appearances);
  });

  it("gives nobody who stayed put a breakdown", () => {
    const moved = after.players.filter((p) => p.stats.some((s) => s.stints));
    // Only the player moved here (and anyone the winter market or a loan moved).
    expect(moved.some((p) => p.pid === pid)).toBe(true);
    for (const p of moved) {
      const row = p.stats.find((s) => s.stints)!;
      expect(new Set(row.stints!.map((s) => s.tid)).size).toBeGreaterThan(1);
    }
  });
});
