import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  saveLeague, loadLeague, getDb, resetDb, resetWriteCache,
  storedPlayedRows, loadMatchEvents, isEventsElided, withMatchEvents,
} from "../../src/db/index.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import type { MatchEvent, PlayerMatchLine } from "../../src/engine/attribution.js";

/**
 * Match events are ~66% of a box score and `played` is ~83% of a mid-season
 * save, so a loaded league that carries every event is most of what the tab is
 * holding. `loadLeague` therefore drops them and `loadMatchEvents` reads one
 * match's back on demand.
 *
 * The elision itself is easy. What these pin is the part that can LOSE DATA:
 * once an in-memory box score can be a hollow copy of a real row, every write
 * path has to know not to put it back. Getting that wrong does not throw and
 * does not fail a type check — the match simply loses its timeline, on disk,
 * permanently, on the first mutation after a load. That is the failure mode
 * this whole file exists for.
 */

// An England-only world, for the reason test/db/playedStore.test.ts gives:
// nothing here is a function of pool size, while every cost is.
let base: LeagueStore | null = null;
function makeLeague(): LeagueStore {
  base ??= createLeagueState(3, mulberry32(42), 0, "normal", englandCompetitions());
  return structuredClone(base);
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
beforeAll(() => { makeLeague(); }, 60_000);

const event = (clock: number): MatchEvent => ({
  clock, type: "goal", side: "home", pids: [1, 2],
});

/** One player line, so a test can prove the LINES survive while the events go. */
const line = (pid: number): PlayerMatchLine => ({
  pid, goals: 1, assists: 0, shots: 3, shotsOnTarget: 2, xg: 0.8,
  goalsAgainst: 0, xga: 0, saves: 0, tackles: 2, interceptions: 1,
  minutesPlayed: 90, rating: 7.4, passes: 40, crosses: 2, foulsCommitted: 1,
  yellowCards: 0, redCards: 0,
} as unknown as PlayerMatchLine);

/**
 * A match carrying `events` real events, identifiable by `mark`.
 *
 * `events` is what gets elided; `home`/`away` must NOT be, because
 * `computeTeamSeasonStats` folds those player lines and is called on the main
 * thread to feed the offseason. Eliding them would make it silently return
 * zeroes for the whole season — which is exactly why this change drops only
 * the timeline and keeps the lines.
 */
const match = (matchday: number, mark: number, events: number): PlayedMatch => ({
  home: 0, away: 1, homeGoals: 1, awayGoals: 0,
  possessionHome: mark, matchday,
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

describe("lazy match events", () => {
  it("loads a league with the timelines dropped and the player lines kept", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;

    expect(loaded.played.map((m) => m.boxScore.events)).toEqual([[], []]);
    expect(loaded.played.every(isEventsElided)).toBe(true);
    // The half that must survive: `computeTeamSeasonStats` folds these.
    expect(loaded.played[0].boxScore.home).toHaveLength(1);
    expect(loaded.played[0].boxScore.home[0].rating).toBe(7.4);
    // And the scores, which is what the standings and every table read.
    expect(loaded.played.map((m) => m.possessionHome)).toEqual([10, 11]);
    // Still all there on disk.
    expect(await storedEventCounts(lid)).toEqual([5, 3]);
  });

  /**
   * THE GATE. Loading seeds no write cache, so the very next save takes
   * `playedToWrite`'s full-rewrite branch — which used to clear the whole key
   * range and put every match back. With elided rows in hand that is a delete
   * of the real events followed by a write of nothing.
   *
   * Verified to fail before the fix: every count came back 0.
   */
  it("never writes an elided box score over the real one", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3), match(2, 12, 7)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    // Any ordinary mutation. The league object is new, so this is the full
    // rewrite branch, which is the dangerous one.
    await saveLeague({ ...loaded, meta: { ...loaded.meta, userTid: 1 } });

    expect(await storedEventCounts(lid)).toEqual([5, 3, 7]);
  });

  it("still writes a freshly simmed match sitting behind elided ones", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    // What a simmed matchday looks like: the old rows elided, a new one real.
    await saveLeague({ ...loaded, played: [...loaded.played, match(2, 11, 4)] });

    expect(await storedEventCounts(lid)).toEqual([5, 4]);
    expect((await storedPlayedRows(lid)).map((m) => m.possessionHome)).toEqual([10, 11]);
  });

  it("still clears the range when the season rolls over", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    // The offseason empties `played`. The tail delete has to take everything.
    await saveLeague({ ...loaded, played: [] });

    expect(await storedPlayedRows(lid)).toHaveLength(0);
  });

  it("does not mark a match that genuinely recorded no events", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 0)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;

    // Unmarked, so a reader knows there is nothing to go and fetch — otherwise
    // every goalless, cardless match would be re-queried forever.
    expect(isEventsElided(loaded.played[0])).toBe(false);
  });

  it("reads one match's timeline back on demand", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);

    expect(await loadMatchEvents(lid, 1)).toHaveLength(3);
    expect((await loadMatchEvents(lid, 0))![0].clock).toBe(0);
    // Past the end is "unknown", never "no events".
    expect(await loadMatchEvents(lid, 9)).toBeUndefined();
  });

  it("puts the timelines back for an export, carrying no marker", async () => {
    const league = makeLeague();
    league.played = [match(1, 10, 5), match(1, 11, 3)];
    const lid = await saveLeague(league);
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    const whole = await withMatchEvents(loaded);

    expect(whole.played.map((m) => m.boxScore.events.length)).toEqual([5, 3]);
    // The marker is a claim about THIS database. A file carrying it would be
    // imported into a save where it is false, and `saveLeague` would then skip
    // those rows forever.
    expect(whole.played.some((m) => m.boxScore.eventsElided)).toBe(false);
  });
});
