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
  storedSeasonRows,
  storedRetireeRows,
  trimWrittenCareers,
  loadCareer,
  loadSeasonStats,
  withFullCareers,
} from "../../src/db/index.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { emptySeasonStats } from "../../src/core/players/types.js";
import { RECENT_HIST_SEASONS, RECENT_STATS_SEASONS } from "../../src/core/simArchive.js";
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
  await db.clear("seasons");
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
    league.players[0].recentStats = [{ ...league.players[0].recentStats[0], season: 1 }];
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

/**
 * A copy of the world where the first `n` players have long careers.
 *
 * A fresh world's players have one snapshot and no stat lines, which is all
 * inside the window — so nothing about windowing could fail on it. These have
 * eight seasons of each, most of which must live on disk alone.
 */
function withLongCareers(n = 5) {
  const league = makeLeague();
  league.season = 9;
  league.players = league.players.map((p, i) => {
    if (i >= n) return p;
    const line = (season: number) => ({
      ...emptySeasonStats(season, 1), appearances: 20 + season, goals: season + i,
    });
    return {
      ...p,
      recentStats: [1, 2, 3, 4, 5, 6, 7, 8].map(line),
      recentHist: [0, 1, 2, 3, 4, 5, 6, 7].map((season) => ({
        ...p.recentHist[0], season, ovr: 50 + season,
      })),
    };
  });
  return league;
}

/** Every season of one player as the save knows it: disk under memory. */
async function careerOnDisk(league: LeagueStore, pid: number) {
  const player = league.players.find((p) => p.pid === pid)!;
  return loadCareer(league, player);
}

describe("leagueDb history store", () => {
  it("puts every season in `seasons` and only the window on the player row", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    const long = league.players[0];

    const rows = await storedSeasonRows(lid);
    const mine = rows.filter((r) => r.pid === long.pid);
    expect(mine.filter((r) => r.kind === 0)).toHaveLength(8);
    expect(mine.filter((r) => r.kind === 1)).toHaveLength(8);

    const stored = (await storedPlayerRows(lid)).find((r) => r.pid === long.pid)!;
    expect(stored.recentStats).toHaveLength(RECENT_STATS_SEASONS);
    expect(stored.recentHist).toHaveLength(RECENT_HIST_SEASONS);
    expect(stored.stats).toBeUndefined();
  });

  it("loads only the window, and reads the rest back whole", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    resetWriteCache();
    const loaded = (await loadLeague(lid))!;

    const orig = league.players[0];
    const p = loaded.players.find((x) => x.pid === orig.pid)!;
    expect(p.recentStats.map((s) => s.season)).toEqual([7, 8]);
    expect(p.recentHist.map((h) => h.season)).toEqual([5, 6, 7]);

    const career = await careerOnDisk(loaded, orig.pid);
    expect(career.stats.map((s) => s.goals)).toEqual(orig.recentStats.map((s) => s.goals));
    expect(career.hist.map((h) => h.season)).toEqual(orig.recentHist.map((h) => h.season));
  });

  /**
   * THE data-loss gate. A save made after a load holds only windows, and it is a
   * full write (load seeds no cache). If a full write cleared history and put
   * back what memory holds, every season older than the window would be gone
   * after the first click of every session.
   */
  it("never loses older seasons to a save of a windowed pool", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    resetWriteCache();
    const loaded = (await loadLeague(lid))!;

    // Any mutation: a new object for one player, forcing a write.
    const mutated = {
      ...loaded,
      players: loaded.players.map((p, i) => (i === 0 ? { ...p, ovr: p.ovr + 1 } : p)),
    };
    await saveLeague(mutated);
    resetWriteCache();
    const again = (await loadLeague(lid))!;

    for (const orig of league.players.slice(0, 5)) {
      const career = await careerOnDisk(again, orig.pid);
      expect(career.stats.map((s) => s.season)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(career.hist.map((h) => h.season)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it("converts a v4-v6 save, whose careers sit in `careers`, without losing a season", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);

    // The shape the previous build wrote: identity-only player rows, whole
    // careers in `careers`, nothing in `seasons`.
    const db = await getDb();
    await db.clear("seasons");
    for (const p of league.players) {
      const { recentStats, recentHist, ...identity } = p;
      await db.put("players", identity as never, [lid, p.pid]);
      await db.put("careers", { stats: recentStats, hist: recentHist }, [lid, p.pid]);
    }
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    const p = loaded.players.find((x) => x.pid === league.players[0].pid)!;
    expect(p.recentStats).toHaveLength(RECENT_STATS_SEASONS);

    const career = await careerOnDisk(loaded, p.pid);
    expect(career.stats).toHaveLength(8);
    expect(career.hist).toHaveLength(8);
    // Converted once: the legacy store is empty for this league afterwards.
    expect(await storedCareerRows(lid)).toEqual([]);
  });

  it("converts a v3 row that still carries its career inline", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    const db = await getDb();
    await db.clear("seasons");
    for (const p of league.players) {
      const { recentStats, recentHist, ...identity } = p;
      await db.put("players", { ...identity, stats: recentStats, hist: recentHist } as never, [lid, p.pid]);
    }
    resetWriteCache();

    const loaded = (await loadLeague(lid))!;
    const career = await careerOnDisk(loaded, league.players[0].pid);
    expect(career.stats).toHaveLength(8);
    // Written back in the current shape, or every startup redoes this.
    const rows = await storedPlayerRows(lid);
    expect(rows.every((r) => r.stats === undefined)).toBe(true);
  });

  it("writes no history when only a player's identity changed", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    league.lid = lid;
    const before = await storedSeasonRows(lid);

    const target = league.players[0];
    const bumped = { ...target, contract: { ...target.contract, salary: target.contract.salary + 1 } };
    await saveLeague({ ...league, players: league.players.map((p) => (p === target ? bumped : p)) });

    expect(await storedSeasonRows(lid)).toEqual(before);
    const row = (await storedPlayerRows(lid)).find((r) => r.pid === target.pid)!;
    expect(row.contract.salary).toBe(bumped.contract.salary);
  });

  /**
   * What keeps a matchday cheap. The sim clones every player's stat lines before
   * accumulating, so after a matchday every player is a new object carrying new
   * row objects — most of them with the same values. Only a real change is
   * written.
   */
  it("writes nothing for a player whose rows were cloned but not changed", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    league.lid = lid;
    const playersBefore = await storedPlayerRows(lid);

    const cloned = league.players.map((p) => ({ ...p, recentStats: p.recentStats.map((s) => ({ ...s })) }));
    await saveLeague({ ...league, players: cloned });
    expect(await storedPlayerRows(lid)).toEqual(playersBefore);
  });

  it("writes a season's line when it really changed", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    league.lid = lid;
    const target = league.players[0];
    const scored = {
      ...target,
      recentStats: target.recentStats.map((s) => (s.season === 8 ? { ...s, goals: 99 } : s)),
    };
    await saveLeague({ ...league, players: league.players.map((p) => (p === target ? scored : p)) });

    const lines = await loadSeasonStats({ ...league, players: [] } as LeagueStore, 8);
    expect(lines.get(target.pid)!.goals).toBe(99);
  });

  it("reads one season for everyone, from disk, under the window", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    resetWriteCache();
    const loaded = (await loadLeague(lid))!;

    const season3 = await loadSeasonStats(loaded, 3);
    for (const [i, orig] of league.players.slice(0, 5).entries()) {
      expect(season3.get(orig.pid)!.goals).toBe(3 + i);
    }
  });

  it("cuts a grown window back once its save has landed, keeping everything on disk", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    // The pool just saved still holds whole careers, as memory does straight
    // after a conversion or an import.
    const trimmed = trimWrittenCareers({ ...league, lid });
    expect(trimmed.players[0].recentStats).toHaveLength(RECENT_STATS_SEASONS);

    const career = await careerOnDisk(trimmed, league.players[0].pid);
    expect(career.stats).toHaveLength(8);
  });

  it("leaves a pool alone when its save has not landed", () => {
    const league = { ...withLongCareers(), lid: 12345 };
    expect(trimWrittenCareers(league)).toBe(league);
  });

  it("writes whole careers into an export", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    resetWriteCache();
    const loaded = (await loadLeague(lid))!;

    const full = await withFullCareers(loaded);
    const p = full.players.find((x) => x.pid === league.players[0].pid)!;
    expect(p.recentStats.map((s) => s.season)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("deletes history along with the league", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    expect((await storedSeasonRows(lid)).length).toBeGreaterThan(0);
    await deleteLeague(lid);
    expect(await storedSeasonRows(lid)).toEqual([]);
  });

  it("drops the history of a player who left the save, and only his", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    league.lid = lid;
    const gone = league.players[0].pid;
    const kept = league.players[1].pid;

    await saveLeague({ ...league, players: league.players.filter((p) => p.pid !== gone) });
    const rows = await storedSeasonRows(lid);
    expect(rows.some((r) => r.pid === gone)).toBe(false);
    expect(rows.filter((r) => r.pid === kept && r.kind === 0)).toHaveLength(8);
  });

  it("drops a leaver's history on a FULL write too", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    resetWriteCache();
    const gone = league.players[0].pid;
    await saveLeague({ ...league, lid, players: league.players.filter((p) => p.pid !== gone) });

    const rows = await storedSeasonRows(lid);
    expect(rows.some((r) => r.pid === gone)).toBe(false);
    expect((await storedPlayerRows(lid)).some((r) => r.pid === gone)).toBe(false);
  });
});

describe("leagueDb history store, full writes", () => {
  /**
   * A full write skips rows already on disk (the first save of every session
   * would otherwise rewrite every resident row). The skip must never swallow a
   * LIVE row that really differs from disk — the reason a full write exists is
   * that disk cannot be trusted to match memory.
   */
  it("still writes a live-season row that differs from disk", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    const target = league.players[0];
    const scored = {
      ...target,
      recentStats: target.recentStats.map((s) => (s.season === 8 ? { ...s, goals: 77 } : s)),
    };
    resetWriteCache();
    await saveLeague({ ...league, lid, players: league.players.map((p) => (p === target ? scored : p)) });

    const lines = await loadSeasonStats({ ...league, lid, players: [] } as LeagueStore, 8);
    expect(lines.get(target.pid)!.goals).toBe(77);
  });

  it("writes an old-season row that is missing from disk, as a multi-season jump creates", async () => {
    const league = withLongCareers();
    const lid = await saveLeague(league);
    const db = await getDb();
    const target = league.players[0];
    await db.delete("seasons", [lid, target.pid, 3, 0]);
    resetWriteCache();
    await saveLeague({ ...league, lid });

    const lines = await loadSeasonStats({ ...league, lid, players: [] } as LeagueStore, 3);
    expect(lines.get(target.pid)!.goals).toBe(3);
  });
});
