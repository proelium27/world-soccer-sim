import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  saveLeague, loadLeague, deleteLeague, getDb, resetDb, resetWriteCache,
  storedPlayedRows,
} from "../../src/db/index.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import type { StoredLeague } from "../../src/db/database.js";

/**
 * `played` is the biggest field in the game and it used to sit on the league
 * record, which `saveLeague` rewrites in full on every mutation. Measured on a
 * *season-1* save on the 626-club world, one lineup drag wrote 216.6 MB at
 * matchday 38 and took 2,653 ms just to structuredClone, on a fast desktop.
 *
 * These pin the two properties that make the split worth having, plus the ones
 * that make it *safe*. The safety half matters more than usual here, because
 * rows are keyed by **array position** rather than by an id: a hole or a stale
 * tail in the range does not throw, it silently renumbers everybody, and the
 * UI addresses matches by that index (`/box-score/:idx`, `/watch/:matchIndex`).
 */

// An England-only world rather than the 36-competition one, for the reason
// test/db/leagueDb.test.ts spells out: nothing here is a function of the pool
// size, while every cost is.
let base: LeagueStore | null = null;
function makeLeague(): LeagueStore {
  base ??= createLeagueState(3, mulberry32(42), 0, "normal", englandCompetitions());
  return structuredClone(base);
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
beforeAll(() => { makeLeague(); }, 60_000);

/**
 * A match, identifiable by its `possessionHome` so a test can tell one row from
 * another. The box score is a stub: nothing here reads it, and a real one is
 * ~16 KB, which is the whole reason this field is being moved.
 */
const match = (matchday: number, mark: number): PlayedMatch => ({
  home: 0, away: 1, homeGoals: 1, awayGoals: 0,
  possessionHome: mark, matchday,
  boxScore: { home: [], away: [], events: [] } as unknown as PlayedMatch["boxScore"],
});

const marks = (rows: PlayedMatch[]) => rows.map((m) => m.possessionHome);

/** The raw league record, to check what is and is not on it. */
async function rawRecord(lid: number): Promise<StoredLeague> {
  const db = await getDb();
  return (await db.get("leagues", lid))!;
}

/**
 * Overwrite one stored row behind `saveLeague`'s back.
 *
 * This is how every "did the save rewrite this?" assertion below works, and it
 * is the same trick test/db/leagueDb.test.ts uses for the player pool: a
 * tampered row that survives proves the row was *not* written, which plain
 * equality cannot distinguish from a full rewrite of identical data.
 */
async function tamper(lid: number, index: number, mark: number): Promise<void> {
  const db = await getDb();
  await db.put("played", match(99, mark), [lid, index]);
}

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["leagues", "players", "careers", "retirees", "played"] as const) {
    await db.clear(store);
  }
  resetWriteCache();
  db.close();
  resetDb();
});

describe("played store", () => {
  it("keeps the season's matches out of the league record", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11)];
    const lid = await saveLeague(league);

    // The point of the whole change: this object is what a lineup drag
    // re-serialises, and the matches are no longer in it.
    expect((await rawRecord(lid)).played).toBeUndefined();
    expect(await storedPlayedRows(lid)).toHaveLength(2);
  });

  it("round-trips matches in order", async () => {
    const league = makeLeague();
    league.played = Array.from({ length: 12 }, (_, i) => match(i + 1, i));
    const lid = await saveLeague(league);

    const loaded = await loadLeague(lid);
    // Twelve rather than a couple deliberately: the key is [lid, index] and IDB
    // compares array keys element-wise with numbers *numerically*, so [lid, 2]
    // sorts below [lid, 10]. A string key would come back 0,1,10,11,2,... and
    // silently renumber every match the UI links to.
    expect(marks(loaded!.played)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("writes no match rows when a mutation does not touch played", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11)];
    const lid = await saveLeague(league);
    await tamper(lid, 1, 999);

    // A lineup drag, a signing, the scouting slider: `played` is untouched.
    league.lid = lid;
    league.teams[0].scoutingSpend = 12345;
    await saveLeague(league);

    // The tampered row survived, so the save wrote nothing here at all.
    expect(marks(await storedPlayedRows(lid))).toEqual([10, 999]);
  });

  it("appends only the new matches after a matchday", async () => {
    const league = makeLeague();
    const first = [match(1, 10), match(1, 11)];
    league.played = first;
    const lid = await saveLeague(league);
    await tamper(lid, 0, 999);

    // Exactly what simThrough does: `[...league.played, ...newResults]`, so the
    // existing entries keep their object identity.
    league.lid = lid;
    league.played = [...first, match(2, 12)];
    await saveLeague(league);

    // Row 0 is still tampered — untouched — and only the new one was written.
    expect(marks(await storedPlayedRows(lid))).toEqual([999, 11, 12]);
    // The load still reflects what is on disk, tamper and all.
    expect(marks((await loadLeague(lid))!.played)).toEqual([999, 11, 12]);
  });

  it("clears the range at the offseason rollover", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11), match(2, 12)];
    const lid = await saveLeague(league);

    // What simOffseason does: `played: []`.
    league.lid = lid;
    league.played = [];
    await saveLeague(league);

    expect(await storedPlayedRows(lid)).toEqual([]);
    expect((await loadLeague(lid))!.played).toEqual([]);
  });

  it("rewrites everything when the array is not an extension of what was written", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11)];
    const lid = await saveLeague(league);
    await tamper(lid, 0, 999);

    // A replaced entry rather than an appended one — not something the sim does,
    // which is exactly why it must fall back rather than trust the prefix.
    league.lid = lid;
    league.played = [match(1, 20), league.played[1]];
    await saveLeague(league);

    expect(marks(await storedPlayedRows(lid))).toEqual([20, 11]);
  });

  it("rewrites everything when another writer touched the record", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11), match(1, 12)];
    const lid = await saveLeague(league);
    await tamper(lid, 0, 999);

    // A second tab saving in between: writeSeq on disk is no longer the one we
    // wrote, so our idea of the range is stale and an append would merge two
    // states that never coexisted.
    const db = await getDb();
    const record = await rawRecord(lid);
    await db.put("leagues", { ...record, writeSeq: (record.writeSeq ?? 0) + 7 });

    league.lid = lid;
    await saveLeague(league);

    expect(marks(await storedPlayedRows(lid))).toEqual([10, 11, 12]);
  });

  it("leaves no stale tail when a full rewrite shrinks the season", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11), match(1, 12), match(1, 13)];
    const lid = await saveLeague(league);

    // Rows are keyed by position, so without the range delete a full rewrite
    // starts with, indices 2 and 3 would survive and `loadLeague` would read a
    // four-match season back out of a two-match one.
    resetWriteCache();
    league.lid = lid;
    league.played = [match(1, 20), match(1, 21)];
    await saveLeague(league);

    expect(marks(await storedPlayedRows(lid))).toEqual([20, 21]);
    expect(marks((await loadLeague(lid))!.played)).toEqual([20, 21]);
  });

  it("splits a pre-v6 record that still carries its matches inline", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // Put the old shape back on disk, as a v5 build would have left it.
    const db = await getDb();
    const record = await rawRecord(lid);
    await db.put("leagues", {
      ...record,
      played: [match(1, 10), match(1, 11)],
    } as StoredLeague);
    resetWriteCache();

    const loaded = await loadLeague(lid);
    expect(marks(loaded!.played)).toEqual([10, 11]);
    // And the load wrote it back in the new shape, so the split is paid once
    // rather than redone before first paint on every startup.
    expect((await rawRecord(lid)).played).toBeUndefined();
    expect(marks(await storedPlayedRows(lid))).toEqual([10, 11]);
  });

  it("splits a pre-v6 record whose season is legitimately empty", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // The offseason case, and the one an `inlinePlayed?.length` test would get
    // wrong: an empty inline array still means "not split yet", so it has to
    // trigger the write-back or the record keeps its old shape and rewrites
    // itself on every single load.
    const db = await getDb();
    await db.put("leagues", { ...(await rawRecord(lid)), played: [] } as StoredLeague);
    resetWriteCache();

    expect((await loadLeague(lid))!.played).toEqual([]);
    expect((await rawRecord(lid)).played).toBeUndefined();
  });

  it("deletes a league's match rows with the league", async () => {
    const league = makeLeague();
    league.played = [match(1, 10), match(1, 11)];
    const lid = await saveLeague(league);

    await deleteLeague(lid);

    // In deleteLeague's own transaction rather than a later one, so a reused lid
    // can never inherit the previous league's matches.
    expect(await storedPlayedRows(lid)).toEqual([]);
  });

  it("keeps two leagues' matches apart", async () => {
    const a = makeLeague();
    a.played = [match(1, 10)];
    const lidA = await saveLeague(a);

    const b = makeLeague();
    b.played = [match(1, 20), match(1, 21)];
    const lidB = await saveLeague(b);

    expect(marks(await storedPlayedRows(lidA))).toEqual([10]);
    expect(marks(await storedPlayedRows(lidB))).toEqual([20, 21]);
    // Saving one must not disturb the other's range, which is the thing the
    // [lid, index] key exists to guarantee.
    expect(marks((await loadLeague(lidA))!.played)).toEqual([10]);
  });
});
