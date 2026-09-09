import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  saveLeague, getDb, resetDb, resetWriteCache, storedRetireeRows,
} from "../../src/db/index.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * The point of splitting the archive out was never disk, it was the write paid
 * on *every* mutation: `saveLeague` rewrites the whole non-player league record,
 * so an inline archive was re-serialised when the user changed a lineup.
 *
 * These pin the property that makes `RETIREE_ARCHIVE_LIMIT` affordable at
 * 20,000. If they ever fail, raising that cap silently starts costing latency on
 * every action again, which is the regression PR #210 exists to have fixed.
 */

// An England-only world (two divisions, ~1,000 players) rather than the full
// 36-competition one. Nothing here is a function of the pool size — the
// retirees these tests measure are hand-built, and the league is only present
// so there is a valid save to write — while every cost in this file scales with
// it. Same reasoning as test/db/leagueDb.test.ts and test/core/simArchive.ts.
let base: LeagueStore | null = null;
function makeLeague(): LeagueStore {
  base ??= createLeagueState(3, mulberry32(42), 0, "normal", englandCompetitions());
  return structuredClone(base);
}

const retiree = (pid: number): ArchivedPlayer => ({
  pid, name: `Retiree ${pid}`, nationality: "eng", pos: "ST", born: 2000, heightCm: 180,
  retiredSeason: 12, retiredAge: 34, firstSeason: 2, seasonsPlayed: 10,
  peakOvr: 78, peakSeason: 8, finalOvr: 71, clubs: [1],
  seasons: [{ season: 8, tid: 1, ovr: 78, apps: 30 }],
  totals: {} as ArchivedPlayer["totals"], best: {} as ArchivedPlayer["best"],
  caps: 0, intlGoals: 0, intlTitles: 0,
});

// This file had no timeout config at all and rode vitest's 5s default while
// lazily paying ~6s of createLeagueState inside whichever test ran first — the
// exact trap leagueDb.test.ts documents and solved. On the 12,000-player world
// that tipped over and took the whole file with it (a timed-out hook skips its
// cleanup, so the rest fail on a dead transaction). Same fix as its sibling:
// pay for the world up front, and give the tests and hooks budgets that reflect
// what IDB work on a full world actually costs. Re-check when a country is added.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

beforeAll(() => {
  makeLeague();
}, 60_000);

beforeEach(async () => {
  const db = await getDb();
  await db.clear("leagues");
  await db.clear("players");
  await db.clear("retirees");
  await db.clear("played");
  resetWriteCache();
  db.close();
  resetDb();
});

describe("archive write cost", () => {
  it("writes no retiree rows on a save that only changed a lineup", async () => {
    const league = makeLeague();
    league.retiredPlayers = Array.from({ length: 50 }, (_, i) => retiree(9000 + i));
    const lid = await saveLeague(league);
    league.lid = lid;

    // Tamper with one row directly, behind saveLeague's back. If the next save
    // rewrites the archive the doctored name is overwritten; if the diff skips
    // it, the tampering survives. That is observable proof of a skipped write
    // rather than an assertion that the data merely still looks right.
    const db = await getDb();
    const doctored = { ...retiree(9000), name: "TAMPERED" };
    await db.put("retirees", doctored, [lid, 9000]);

    // A lineup change: the archive array is the same object by reference, and
    // one team object is replaced, which is what a real mutation looks like.
    league.teams = league.teams.map((t, i) => (i === 0 ? { ...t, formation: "4-4-2" } : t));
    await saveLeague(league);

    const rows = await storedRetireeRows(lid);
    expect(rows).toHaveLength(50);
    expect(rows.find((r) => r.pid === 9000)!.name).toBe("TAMPERED");
  });

  it("writes only the rows an offseason added", async () => {
    const league = makeLeague();
    const first = Array.from({ length: 20 }, (_, i) => retiree(9000 + i));
    league.retiredPlayers = first;
    const lid = await saveLeague(league);
    league.lid = lid;

    // An offseason appends, keeping every existing row by reference — which is
    // exactly what extendRetireeArchive does when under the cap.
    league.retiredPlayers = [...first, retiree(9100), retiree(9101)];
    await saveLeague(league);

    expect(await storedRetireeRows(lid)).toHaveLength(22);
  });

  it("keeps the league record free of the archive at any size", async () => {
    const league = makeLeague();
    league.retiredPlayers = Array.from({ length: 500 }, (_, i) => retiree(9000 + i));
    const lid = await saveLeague(league);

    const db = await getDb();
    const raw = await db.get("leagues", lid);
    expect(raw!.retiredPlayers).toBeUndefined();
    // The whole point: the record the user pays for on every save carries none
    // of this, however long the dynasty runs.
    expect(JSON.stringify(raw)).not.toContain("Retiree 9000");
  });
});
