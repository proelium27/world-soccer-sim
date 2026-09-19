import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { simThrough } from "../../src/core/simThrough.js";
import { computeTeamSeasonStats } from "../../src/core/standings.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  saveLeague, loadLeague, getDb, resetDb, resetWriteCache,
  storedPlayedRows, loadMatchBoxScore, isDetailElided, withMatchDetail,
  elideWrittenDetail, teamSeasonStatsFor,
} from "../../src/db/index.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import type { MatchEvent, PlayerMatchLine } from "../../src/engine/attribution.js";

/**
 * A season's box scores (event timelines plus both teams' player lines) are most
 * of what a mid-season league weighs, so `loadLeague` holds played matches
 * without them and `loadMatchBoxScore` reads one back on demand. The lines have
 * one whole-season reader, the team totals, which `teamSeasonStatsFor` answers
 * from a fold taken as the lines went past.
 *
 * Two things here can go wrong SILENTLY, and they are what this file pins:
 *   - a hollow in-memory copy written back over the real row, which deletes the
 *     match's box score on disk for good;
 *   - the fold disagreeing with the matches it summarised, which puts wrong
 *     numbers on Leaders, the Club Database and into the offseason.
 * Neither throws or fails a type check on its own.
 */

// An England-only world, for the reason test/db/playedStore.test.ts gives:
// nothing here is a function of pool size, while every cost is.
let base: LeagueStore | null = null;
function makeLeague(): LeagueStore {
  base ??= createLeagueState(3, mulberry32(42), 0, "normal", englandCompetitions());
  return structuredClone(base);
}

/** A few real matchdays, so the fold is checked against genuine engine output. */
let simmed: LeagueStore | null = null;
function simmedLeague(matchdays: number): LeagueStore {
  if (!simmed) {
    let l = makeLeague();
    for (let md = 1; md <= matchdays; md++) {
      l = simThrough(l, { matchday: md }, mulberry32(900 + md));
    }
    simmed = l;
  }
  return structuredClone(simmed);
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
beforeAll(() => { simmedLeague(4); }, 120_000);

const event = (clock: number): MatchEvent => ({
  clock, type: "goal", side: "home", pids: [1, 2],
});

const line = (pid: number): PlayerMatchLine => ({
  pid, goals: 1, assists: 0, shots: 3, shotsOnTarget: 2, xg: 0.8,
  goalsAgainst: 0, xga: 0, saves: 0, tackles: 2, interceptions: 1,
  minutesPlayed: 90, rating: 7.4, passes: 40, crosses: 2, foulsCommitted: 1,
  yellowCards: 0, redCards: 0,
} as unknown as PlayerMatchLine);

/** A match carrying `events` events and one line a side, identifiable by `mark`. */
const match = (matchday: number, mark: number, events: number): PlayedMatch => ({
  home: 0, away: 1, homeGoals: 1, awayGoals: 0,
  possessionHome: mark / 100, matchday,
  boxScore: {
    home: [line(1)], away: [line(2)],
    events: Array.from({ length: events }, (_, i) => event(i * 60)),
  },
} as unknown as PlayedMatch);

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["leagues", "players", "careers", "retirees", "played"] as const) {
    await db.clear(store);
  }
  resetWriteCache();
  db.close();
  resetDb();
});

/** Every stored match's event count, which is the thing that can silently vanish. */
async function storedEventCounts(lid: number): Promise<number[]> {
  return (await storedPlayedRows(lid)).map((m) => m.boxScore.events.length);
}

const allTids = (l: LeagueStore) => l.teams.map((t) => t.tid);

describe("lazy match detail", () => {
  it("loads a league with the box scores dropped and the scores kept", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;

    expect(loaded.played.every(isDetailElided)).toBe(true);
    expect(loaded.played.map((m) => m.boxScore.events.length)).toEqual([0, 0]);
    expect(loaded.played.map((m) => m.boxScore.home.length)).toEqual([0, 0]);
    // The part every table reads survives.
    expect(loaded.played.map((m) => m.possessionHome)).toEqual([0.1, 0.11]);
    expect(await storedEventCounts(lid)).toEqual([5, 3]);
  });

  /**
   * THE GATE. Loading seeds no write cache, so the very next save takes
   * `playedToWrite`'s full-rewrite branch — which used to clear the whole key
   * range and put every match back. With elided rows in hand that is a delete
   * of the real box scores followed by a write of nothing.
   *
   * Verified to fail before the fix: every count came back 0.
   */
  it("never writes an elided box score over the real one", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3), match(2, 12, 7)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    await saveLeague({ ...loaded, meta: { ...loaded.meta, userTid: 1 } });

    expect(await storedEventCounts(lid)).toEqual([5, 3, 7]);
    expect((await storedPlayedRows(lid)).every((m) => m.boxScore.home.length === 1)).toBe(true);
  });

  it("still writes a freshly simmed match sitting behind elided ones", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    await saveLeague({ ...loaded, played: [...loaded.played, match(2, 11, 4)] });

    expect(await storedEventCounts(lid)).toEqual([5, 4]);
  });

  it("still clears the range when the season rolls over", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    await saveLeague({ ...loaded, played: [] });

    expect(await storedPlayedRows(lid)).toHaveLength(0);
  });

  it("does not mark a match that recorded nothing at all", async () => {
    const league = makeLeague();
    const bare = { ...match(1, 10, 0), boxScore: { home: [], away: [], events: [] } } as PlayedMatch;
    league.played = [bare];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;

    // Unmarked, so a reader knows there is nothing to go and fetch.
    expect(isDetailElided(loaded.played[0])).toBe(false);
  });

  it("reads one match's box score back on demand", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);

    const box = (await loadMatchBoxScore(lid, 1))!;
    expect(box.events).toHaveLength(3);
    expect(box.home[0].rating).toBe(7.4);
    // Past the end is "unknown", never "nothing happened".
    expect(await loadMatchBoxScore(lid, 9)).toBeUndefined();
  });

  it("puts the box scores back for an export, carrying no marker", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    const whole = await withMatchDetail(loaded);

    expect(whole.played.map((m) => m.boxScore.events.length)).toEqual([5, 3]);
    expect(whole.played.map((m) => m.boxScore.home.length)).toEqual([1, 1]);
    // The marker is a claim about THIS database. A file carrying it would be
    // imported into a save where it is false, and `saveLeague` would then skip
    // those rows forever.
    expect(whole.played.some((m) => m.boxScore.detailElided)).toBe(false);
  });

  describe("eliding what was just written", () => {
    it("drops the box scores the last save wrote, and the disk keeps them", async () => {
      const league = makeLeague();
      league.played = [match(1, 10, 5), match(1, 11, 3)];
      const lid = await saveLeague(league);

      const lean = elideWrittenDetail({ ...league, lid });

      expect(lean.played.every(isDetailElided)).toBe(true);
      expect(await storedEventCounts(lid)).toEqual([5, 3]);
    });

    it("leaves alone anything that is not exactly what was saved", async () => {
      const league = makeLeague();
      league.played = [match(1, 10, 5)];
      const lid = await saveLeague(league);

      const other = { ...league, lid, played: [...league.played] };
      expect(elideWrittenDetail(other)).toBe(other);

      resetWriteCache();
      const fresh = { ...league, lid };
      expect(elideWrittenDetail(fresh)).toBe(fresh);
    });

    /**
     * The next save must still see an unchanged prefix, or eliding would turn
     * every matchday's save into a full rewrite. A row tampered with behind the
     * save's back surviving proves it was not rewritten.
     */
    it("keeps the next save on the append path", async () => {
      const league = makeLeague();
      league.played = [match(1, 10, 5), match(1, 11, 3)];
      const lid = await saveLeague(league);
      const lean = elideWrittenDetail({ ...league, lid });

      const db = await getDb();
      await db.put("played", match(9, 99, 1), [lid, 0]);

      await saveLeague({ ...lean, played: [...lean.played, match(2, 12, 4)] });

      const rows = await storedPlayedRows(lid);
      expect(rows.map((m) => m.possessionHome)).toEqual([0.99, 0.11, 0.12]);
      expect(rows[2].boxScore.events).toHaveLength(4);
    });
  });

  /**
   * The team totals, which Leaders, the Club Database and the offseason all
   * read, must not move by a bit when the lines behind them leave memory.
   * `toEqual` on the floats is deliberate: the fold adds in match order, the
   * same order the one-shot fold does, so the sums are identical, not close.
   */
  describe("team season totals without the lines", () => {
    it("match a full fold after a load", async () => {
      const league = simmedLeague(4);
      const expected = computeTeamSeasonStats(allTids(league), league.played);
      const lid = await saveLeague(league);
      resetWriteCache();

      const loaded = (await loadLeague(lid))!;
      expect(loaded.played.every(isDetailElided)).toBe(true);

      expect(teamSeasonStatsFor(loaded, allTids(loaded))).toEqual(expected);
      // A subset, as Leaders asks for one division.
      const some = allTids(loaded).slice(5, 12);
      expect(teamSeasonStatsFor(loaded, some)).toEqual(computeTeamSeasonStats(some, league.played));
    });

    it("match a full fold across a session's saves", async () => {
      const full = simmedLeague(4);
      const matchdays = [...new Set(full.played.map((m) => m.matchday))].sort((a, b) => a - b);
      let session: LeagueStore = { ...full, played: [] };
      session = { ...session, lid: await saveLeague(session) };

      // Commit a matchday at a time, eliding after each save as the app does.
      for (const md of matchdays) {
        const next = [...session.played, ...full.played.filter((m) => m.matchday === md)];
        const withMd = { ...session, played: next };
        session = elideWrittenDetail({ ...withMd, lid: await saveLeague(withMd) });
      }

      expect(session.played.every(isDetailElided)).toBe(true);
      expect(teamSeasonStatsFor(session, allTids(session)))
        .toEqual(computeTeamSeasonStats(allTids(full), full.played));
    });

    /**
     * A live match is simmed, shown, and only saved when the viewer closes. A
     * read against the uncommitted league must not advance the shared fold, or
     * abandoning the match would leave its goals in every total.
     */
    it("are not moved by reading a league that is never committed", async () => {
      const league = simmedLeague(4);
      const lid = await saveLeague(league);
      resetWriteCache();
      const loaded = (await loadLeague(lid))!;
      const before = teamSeasonStatsFor(loaded, allTids(loaded));

      const pending = { ...loaded, played: [...loaded.played, match(9, 50, 2)] };
      teamSeasonStatsFor(pending, allTids(pending));

      expect(teamSeasonStatsFor(loaded, allTids(loaded))).toEqual(before);
    });

    it("start fresh when the season rolls over", async () => {
      const league = simmedLeague(4);
      const lid = await saveLeague(league);
      resetWriteCache();
      const loaded = (await loadLeague(lid))!;

      const rolled = { ...loaded, played: [match(1, 10, 1)] };
      expect(teamSeasonStatsFor(rolled, allTids(rolled)))
        .toEqual(computeTeamSeasonStats(allTids(rolled), rolled.played));
    });

    /** A stripped match nothing has folded is a bookkeeping bug; a wrong table is worse than a loud one. */
    it("refuse to answer for stripped matches they have no fold for", async () => {
      const league = simmedLeague(4);
      const lid = await saveLeague(league);
      resetWriteCache();
      const loaded = (await loadLeague(lid))!;
      resetWriteCache();

      expect(() => teamSeasonStatsFor(loaded, allTids(loaded))).toThrow(/no season fold/);
    });
  });
});
