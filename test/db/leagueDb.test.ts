import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  saveLeague,
  loadLeague,
  listLeagues,
  deleteLeague,
  getDb,
  resetDb,
  resetWriteCache,
  storedPlayerRows,
  storedCareerRows,
  storedRetireeRows,
} from "../../src/db/index.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";

// An England-only world (two divisions, ~1,000 players) rather than the full
// 36-competition one (~15,650). What this file asserts is structural — that a
// save splits across its object stores, that the dirty diff writes only what
// changed, that a tampered row survives a reload — and none of that is a
// function of how many players there are: every length assertion below is
// relative to `league.players.length`, never a literal.
//
// It is also the fix for the recurring timeout documented below. The costs here
// scale with the player count, so each new country pushed this file closer to
// its limit and the answer each time was a bigger budget. A world sized to what
// the tests actually need takes the growth out of the loop instead. Same
// argument, and the same englandCompetitions() world, that
// test/core/simArchive.test.ts spells out for its own aged fixture.
//
// Built once and handed out as copies (tests mutate what they are given).
let base: ReturnType<typeof createLeagueState> | null = null;
function makeLeague() {
  base ??= createLeagueState(3, mulberry32(42), 0, "normal", englandCompetitions());
  return structuredClone(base);
}

// History, because it explains why these numbers exist at all and why they are
// now much smaller. On the full world several tests here did enough IDB work to
// land near vitest's 5s default, and a test that is *near* a timeout is a test
// that fails when the machine is busy: measured on CI, "splits a v3 row that
// still carries its career inline" took 5347ms and "falls back to a full
// rewrite when another writer touched the record" 5286ms, both against a 5000ms
// limit, both failing on main as well as on branches (run 32961751301 failed
// the first at 5348ms while a second run of the identical commit passed). The
// budget went 30s → 60s → 120s as the world grew 8,000 → 10,000 → 12,000
// players, with a standing note that it needed re-checking on every new country.
//
// Raising it was treating the symptom. The world is now England-only (see
// makeLeague above), the whole file runs in ~2.6s locally, and the budget is
// back to something that would actually catch a hang. Growing the world no
// longer moves it, so the standing re-check is gone with it.
//
// hookTimeout still matters as much as testTimeout and is easy to miss: the
// beforeEach below clears four object stores, and a hook that times out
// mid-flight skips its own cleanup, so every later test in the file fails with
// InvalidStateError on a dead transaction rather than with anything that points
// at the real cause.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Pay for the world up front rather than lazily inside whichever test happens
// to run first: a generation that times out mid-test skips the cleanup below
// and cascades into "expected 1 league, got 2" failures in every test after it.
// The England-only world generates in well under a second, so the budget here
// is margin for a busy machine rather than a real expectation.
beforeAll(() => {
  makeLeague();
}, 60_000);

// Clear all leagues between tests so each test starts with an empty store.
beforeEach(async () => {
  const db = await getDb();
  await db.clear("leagues");
  await db.clear("players");
  await db.clear("careers");
  await db.clear("retirees");
  await db.clear("played");
  // Otherwise this tab still believes the pool it wrote in the previous test is
  // on disk, and would write only a diff against a store that was just wiped.
  resetWriteCache();
  // Close & reset so autoIncrement counters start fresh
  db.close();
  resetDb();
});

describe("leagueDb", () => {
  it("saves a league and returns a lid > 0", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    expect(typeof lid).toBe("number");
    expect(lid).toBeGreaterThan(0);
  });

  it("loads a saved league by lid", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    const loaded = await loadLeague(lid);
    expect(loaded).toBeDefined();
    expect(loaded!.meta.name).toBe(league.meta.name);
    expect(loaded!.meta.userTid).toBe(league.meta.userTid);
    expect(loaded!.teams).toHaveLength(league.teams.length);
    expect(loaded!.players).toHaveLength(league.players.length);
  });

  it("returns undefined for a non-existent lid", async () => {
    const loaded = await loadLeague(999);
    expect(loaded).toBeUndefined();
  });

  it("lists leagues with correct count and metadata", async () => {
    const league1 = makeLeague();
    const league2 = makeLeague();
    league2.meta.name = "Second League";

    await saveLeague(league1);
    await saveLeague(league2);

    const list = await listLeagues();
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveProperty("lid");
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("created");
    // The picker shows the season so two saves of the same club (which share a
    // name, since saves are named after the club) can be told apart.
    expect(list[0].season).toBe(league1.season);
    expect(list.map((l) => l.name)).toContain("My League");
    expect(list.map((l) => l.name)).toContain("Second League");
  });

  /**
   * Adding a record is the one thing that can duplicate a save, so it has to
   * happen exactly when a caller means "create", and never as a side effect of
   * a record arriving in an odd shape. An imported or hand-made league can turn
   * up with no lid at all; that used to look up key `undefined` in the update
   * branch instead of being recognized as new.
   */
  it("treats a league with no lid as new, then updates it in place", async () => {
    const league = makeLeague();
    const { lid: _dropped, ...noLid } = league;

    const lid = await saveLeague(noLid as typeof league);
    expect(lid).toBeGreaterThan(0);
    expect(await listLeagues()).toHaveLength(1);

    await saveLeague({ ...league, lid });
    expect(await listLeagues()).toHaveLength(1);
  });

  it("deletes a league so subsequent load returns undefined", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    expect(await loadLeague(lid)).toBeDefined();

    await deleteLeague(lid);
    expect(await loadLeague(lid)).toBeUndefined();
  });

  it("persists a one-player edit on a later, incremental save", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // A second save of an almost-identical league writes only the changed
    // player. Mirrors the core's style: unchanged players keep their identity.
    // The edit has to be one the load path preserves: `ovr` is re-derived from
    // ratings on load (migrate.ts), so hand-setting it to a sentinel proves
    // nothing about whether the write happened.
    const pid = league.players[5].pid;
    const edited = {
      ...league,
      lid,
      players: league.players.map((p) => (p.pid === pid ? { ...p, name: "Edited Player" } : p)),
    };
    await saveLeague(edited);

    const loaded = await loadLeague(lid);
    expect(loaded!.players.find((p) => p.pid === pid)!.name).toBe("Edited Player");
    expect(loaded!.players).toHaveLength(league.players.length);
  });

  it("removes players dropped since the last save", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    const gone = league.players[0].pid;

    await saveLeague({
      ...league,
      lid,
      players: league.players.filter((p) => p.pid !== gone),
    });

    const rows = await storedPlayerRows(lid);
    expect(rows).toHaveLength(league.players.length - 1);
    expect(rows.some((p) => p.pid === gone)).toBe(false);
  });

  /**
   * The incremental write is only valid while the pool on disk is the one this
   * tab last wrote. Another tab saving in between invalidates that, and merging
   * a diff onto someone else's state would produce a league that never existed.
   */
  it("falls back to a full rewrite when another writer touched the record", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // Stand in for a second tab: bump the counter and wipe a row behind our back.
    const db = await getDb();
    const stored = (await db.get("leagues", lid))!;
    await db.put("leagues", { ...stored, writeSeq: (stored.writeSeq ?? 0) + 7 });
    await db.delete("players", [lid, league.players[0].pid]);

    await saveLeague({ ...league, lid });

    const rows = await storedPlayerRows(lid);
    expect(rows).toHaveLength(league.players.length);
  });

  it("splits a pre-split save that still has players inline", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // Rewrite it in the old shape: everything in one record, no player rows.
    const db = await getDb();
    const stored = (await db.get("leagues", lid))!;
    await db.put("leagues", { ...stored, players: league.players, writeSeq: undefined });
    await db.delete("players", IDBKeyRange.bound([lid], [lid, []]));
    expect(await storedPlayerRows(lid)).toHaveLength(0);

    const loaded = await loadLeague(lid);
    expect(loaded!.players).toHaveLength(league.players.length);

    // Loading must have migrated it: players now live in their own store and
    // are no longer duplicated inside the league record.
    expect(await storedPlayerRows(lid)).toHaveLength(league.players.length);
    expect((await db.get("leagues", lid))!.players).toBeUndefined();
  });

  it("writes back the award winners' names it recovers on load", async () => {
    // Every other backfill recomputes the same way on the next load. This one
    // reads names off players who are in the save right now, and the next
    // offseason deletes more of them for good, so leaving it in memory would
    // mean the recovery is lost if nothing else happens to save.
    const league = makeLeague();
    league.seasonHistory = [{
      season: 1,
      table: [],
      teamStats: [],
      awards: { 0: { playerOfSeasonPid: league.players[0].pid, goldenBootPid: null, teamOfSeason: [] } },
      world: { ballonDOr: [], worldTeamOfYear: [] },
      compsByTid: {},
      championTidByCompId: {},
    }] as unknown as typeof league.seasonHistory;
    // He has to have played that season for the award to be able to name him.
    league.players[0].stats = [{ ...league.players[0].stats[0], season: 1 }];
    const lid = await saveLeague(league);

    const db = await getDb();
    const stored = (await db.get("leagues", lid))!;
    expect(stored.seasonHistory[0].awardWinners).toBeUndefined();

    const loaded = await loadLeague(lid);
    expect(loaded!.seasonHistory[0].awardWinners).toHaveLength(1);
    // On disk, not just in the object that was handed back.
    const after = (await db.get("leagues", lid))!;
    expect(after.seasonHistory[0].awardWinners![0].name).toBe(league.players[0].name);
  });

  it("round-trip: create -> save -> load -> verify all fields", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    const loaded = await loadLeague(lid);

    expect(loaded).toBeDefined();
    expect(loaded!.lid).toBe(lid);
    expect(loaded!.meta.name).toBe(league.meta.name);
    expect(loaded!.meta.created).toBe(league.meta.created);
    expect(loaded!.meta.userTid).toBe(league.meta.userTid);
    expect(loaded!.season).toBe(league.season);
    expect(loaded!.phase).toBe(league.phase);
    expect(loaded!.teams).toEqual(league.teams);
    expect(loaded!.players).toEqual(league.players);
    expect(loaded!.schedule).toEqual(league.schedule);
    expect(loaded!.played).toEqual(league.played);
  });
});

/**
 * The retiree archive lives in its own store as of DB_VERSION 3, for the same
 * reason the pool does: `saveLeague` rewrites the whole non-player record on
 * every mutation, so anything left inline is re-serialised on every lineup
 * change. See the RETIREE_ARCHIVE_LIMIT comment for the measurements.
 */
describe("leagueDb retiree store", () => {
  const retiree = (pid: number, name: string): ArchivedPlayer => ({
    pid, name, nationality: "eng", pos: "ST", born: 2000, heightCm: 180,
    retiredSeason: 12, retiredAge: 34, firstSeason: 2, seasonsPlayed: 10,
    peakOvr: 78, peakSeason: 8, finalOvr: 71, clubs: [1],
    seasons: [{ season: 8, tid: 1, ovr: 78, apps: 30 }],
    totals: {} as ArchivedPlayer["totals"], best: {} as ArchivedPlayer["best"],
    caps: 0, intlGoals: 0, intlTitles: 0,
  });

  it("writes the archive to its own store, not the league record", async () => {
    const league = makeLeague();
    league.retiredPlayers = [retiree(9001, "Ade Bello"), retiree(9002, "Cai Duarte")];
    const lid = await saveLeague(league);

    expect(await storedRetireeRows(lid)).toHaveLength(2);
    // The league record must no longer carry it, or the split bought nothing.
    const db = await getDb();
    const raw = await db.get("leagues", lid);
    expect(raw!.retiredPlayers).toBeUndefined();
  });

  it("reassembles the archive on load", async () => {
    const league = makeLeague();
    league.retiredPlayers = [retiree(9001, "Ade Bello")];
    const lid = await saveLeague(league);

    const loaded = await loadLeague(lid);
    expect(loaded!.retiredPlayers).toHaveLength(1);
    expect(loaded!.retiredPlayers[0].name).toBe("Ade Bello");
  });

  it("splits a v2 record that still carries the archive inline", async () => {
    // What every existing save looks like on first load after this ships.
    const league = makeLeague();
    const lid = await saveLeague(league);
    const db = await getDb();
    const stored = await db.get("leagues", lid);
    await db.put("leagues", {
      ...stored!,
      retiredPlayers: [retiree(9003, "Eli Fournier")],
    });
    resetWriteCache();

    const loaded = await loadLeague(lid);
    expect(loaded!.retiredPlayers[0].name).toBe("Eli Fournier");
    // loadLeague writes it back, so the inline copy is gone and the row is in
    // the store — otherwise every startup would redo this.
    expect(await storedRetireeRows(lid)).toHaveLength(1);
    const after = await db.get("leagues", lid);
    expect(after!.retiredPlayers).toBeUndefined();
  });

  it("drops rows the cap pruned rather than leaving them orphaned", async () => {
    const league = makeLeague();
    league.retiredPlayers = [retiree(9001, "Ade Bello"), retiree(9002, "Cai Duarte")];
    const lid = await saveLeague(league);

    league.lid = lid;
    league.retiredPlayers = [league.retiredPlayers[0]];
    await saveLeague(league);

    const rows = await storedRetireeRows(lid);
    expect(rows.map((r) => r.pid)).toEqual([9001]);
  });

  it("deletes the archive along with the league", async () => {
    const league = makeLeague();
    league.retiredPlayers = [retiree(9001, "Ade Bello")];
    const lid = await saveLeague(league);
    await deleteLeague(lid);
    expect(await storedRetireeRows(lid)).toHaveLength(0);
  });

  it("keeps an empty archive empty instead of rewriting on every load", async () => {
    // An empty inline array and an empty store read are indistinguishable by
    // length, so the split has to key off the field being present at all.
    const league = makeLeague();
    league.retiredPlayers = [];
    const lid = await saveLeague(league);
    const loaded = await loadLeague(lid);
    expect(loaded!.retiredPlayers).toEqual([]);
    expect(await storedRetireeRows(lid)).toHaveLength(0);
  });
});

describe("leagueDb career store", () => {
  it("writes careers to their own store, not onto the player rows", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    const rows = await storedPlayerRows(lid);
    const careers = await storedCareerRows(lid);

    expect(rows.length).toBe(league.players.length);
    expect(careers.length).toBe(league.players.length);
    // The whole point: a player row no longer carries the half that grows.
    expect(rows.every((r) => r.stats === undefined && r.hist === undefined)).toBe(true);
    expect(careers.every((c) => Array.isArray(c.stats) && Array.isArray(c.hist))).toBe(true);
  });

  it("reassembles whole players on load", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    const loaded = await loadLeague(lid);

    expect(loaded!.players.length).toBe(league.players.length);
    const before = new Map(league.players.map((p) => [p.pid, p]));
    for (const p of loaded!.players) {
      const orig = before.get(p.pid)!;
      expect(p.stats).toEqual(orig.stats);
      expect(p.hist).toEqual(orig.hist);
      expect(p.ovr).toBe(orig.ovr);
    }
  });

  it("splits a v3 row that still carries its career inline", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // Put the pre-v4 shape back on disk: career inline on the player row and the
    // career store empty, which is exactly what a save written by the previous
    // build looks like.
    const db = await getDb();
    await db.clear("careers");
    for (const p of league.players) {
      await db.put("players", p as never, [lid, p.pid]);
    }
    resetWriteCache();

    const loaded = await loadLeague(lid);
    expect(loaded!.players.length).toBe(league.players.length);
    expect(loaded!.players[0].hist.length).toBeGreaterThan(0);

    // And it must have been written back in the new shape, or every startup
    // redoes the split before first paint.
    const rows = await storedPlayerRows(lid);
    const careers = await storedCareerRows(lid);
    expect(rows.every((r) => r.stats === undefined)).toBe(true);
    expect(careers.length).toBe(league.players.length);
  });

  it("does not rewrite a career when only the player's identity changed", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    // A contract extension: new player object, same career arrays. This is the
    // case the narrower diff exists for.
    const target = league.players[0];
    const bumped = {
      ...target,
      contract: { ...target.contract, salary: target.contract.salary + 1 },
    };

    const careersBefore = await storedCareerRows(lid);
    await saveLeague({
      ...league,
      lid,
      players: league.players.map((p) => (p.pid === target.pid ? bumped : p)),
    });
    const careersAfter = await storedCareerRows(lid);

    expect(careersAfter).toEqual(careersBefore);
    // The identity row did change, so that one must have been rewritten.
    const rows = await storedPlayerRows(lid);
    expect(rows.find((r) => r.pid === target.pid)!.contract.salary).toBe(bumped.contract.salary);
  });

  /**
   * The mirror of the test above, and the one that keeps a matchday cheap.
   *
   * `accumulateStats` hands back a new player object for everyone who played
   * while leaving ratings, contract and ovr untouched, so a reference-only diff
   * would rewrite the whole identity store with rows byte-for-byte identical to
   * what is already on disk. Measured, that doubled the puts and took a matchday
   * save from 622ms to 1459ms.
   */
  it("does not rewrite identity rows when only the career moved", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    const rowsBefore = await storedPlayerRows(lid);

    // Every player gets a new object carrying a new stats array, exactly as a
    // simmed matchday produces, with nothing else changed.
    await saveLeague({
      ...league,
      lid,
      players: league.players.map((p) => ({ ...p, stats: [...p.stats] })),
    });

    expect(await storedPlayerRows(lid)).toEqual(rowsBefore);
    // ...but the careers must all have been rewritten.
    const careers = await storedCareerRows(lid);
    expect(careers.length).toBe(league.players.length);
  });

  it("writes a career when the career itself moved", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);

    const target = league.players[0];
    const played = { ...target, hist: [...target.hist, { ...target.hist[0], season: 99 }] };
    await saveLeague({
      ...league,
      lid,
      players: league.players.map((p) => (p.pid === target.pid ? played : p)),
    });

    const loaded = await loadLeague(lid);
    expect(loaded!.players.find((p) => p.pid === target.pid)!.hist.at(-1)!.season).toBe(99);
  });

  it("deletes careers along with the league", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    expect((await storedCareerRows(lid)).length).toBeGreaterThan(0);

    await deleteLeague(lid);
    expect(await storedCareerRows(lid)).toEqual([]);
  });

  it("drops the career of a player who left the save", async () => {
    const league = makeLeague();
    const lid = await saveLeague(league);
    const gone = league.players[0].pid;

    await saveLeague({ ...league, lid, players: league.players.filter((p) => p.pid !== gone) });

    const careers = await storedCareerRows(lid);
    expect(careers.length).toBe(league.players.length - 1);
    const rows = await storedPlayerRows(lid);
    expect(rows.some((r) => r.pid === gone)).toBe(false);
  });
});
