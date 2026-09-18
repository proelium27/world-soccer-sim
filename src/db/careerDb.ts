import type { LeagueStore } from "../core/leagueState.js";
import type { Player, RatingsSnapshot, SeasonStats } from "../core/players/types.js";
import { FREE_AGENT_TID } from "../core/transfers/negotiation.js";
import {
  getDb, SEASON_ROW_HIST, SEASON_ROW_STATS, type StoredSeasonRow,
} from "./database.js";
import { migrateHistRow, migrateStatsRow } from "./migrate.js";

/**
 * Player history that is not in memory: the `seasons` store.
 *
 * A loaded league holds each player's last few stat lines and ratings snapshots
 * (`recentStats`/`recentHist`, the window in core/simArchive.ts) and nothing
 * older. Everything older is here, one row per player per season per kind, and
 * comes back only when a screen asks for it: one player's whole career (the
 * Player Profile), or one season for everyone (Leaders, the Database, a club's
 * past squad).
 *
 * **Resident rows always win over disk rows for the same season.** The window is
 * what the game is actually playing with, and it can be ahead of disk for as
 * long as a save is in flight. Disk only ever supplies what is not in memory.
 */

/** Every history row of one player. Key order is season then kind. */
function playerSeasonRange(lid: number, pid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid, pid], [lid, pid, []]);
}

/** Every history row of one league. */
export function leagueSeasonRange(lid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid], [lid, []]);
}

/** Every row of one player, for deleting him with his history. */
export { playerSeasonRange };

export function statsRow(lid: number, pid: number, row: SeasonStats): StoredSeasonRow {
  return { lid, pid, season: row.season, kind: SEASON_ROW_STATS, row };
}

export function histRow(lid: number, pid: number, row: RatingsSnapshot): StoredSeasonRow {
  return { lid, pid, season: row.season, kind: SEASON_ROW_HIST, row };
}

/**
 * Do two rows hold the same values?
 *
 * By value rather than by reference because the sim clones every player's stat
 * lines on every matchday (`simThrough` copies the window before accumulating
 * into it), so a reference test would rewrite every resident row on every
 * matchday for nothing. Nested values (a snapshot's `ratings`) compare by value
 * too, because a row read back from disk is a copy: by reference, every live row
 * a full save compares against disk would read as changed and be rewritten.
 */
export function sameRow(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k in ra) if (!sameRow(ra[k], rb[k])) return false;
  for (const k in rb) if (!(k in ra)) return false;
  return true;
}

/**
 * The rows of `next` that are not already on disk as `prev` wrote them.
 *
 * Matched by season, not position: the window slides, so the same season sits
 * at a different index once a season has been appended and the oldest trimmed.
 */
export function changedRows<R extends { season: number }>(prev: readonly R[], next: readonly R[]): R[] {
  if (prev === next) return [];
  const out: R[] = [];
  for (const r of next) {
    const old = prev.find((p) => p.season === r.season);
    if (old === undefined || !sameRow(old, r)) out.push(r);
  }
  return out;
}

/** A player's whole history, oldest first. */
export interface Career {
  stats: SeasonStats[];
  hist: RatingsSnapshot[];
}

/** Disk rows under resident ones, by season, oldest first. */
function merge<R extends { season: number }>(disk: R[], resident: readonly R[]): R[] {
  const bySeason = new Map<number, R>();
  for (const r of disk) bySeason.set(r.season, r);
  for (const r of resident) bySeason.set(r.season, r);
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

/**
 * A career read earlier with the player's CURRENT window laid over it.
 *
 * Sound because the rows under the window never change once written, so an old
 * read only ever lacks what the window now holds.
 */
export function mergeCareer(career: Career, player: Pick<Player, "recentStats" | "recentHist">): Career {
  return { stats: merge(career.stats, player.recentStats), hist: merge(career.hist, player.recentHist) };
}

/**
 * One player's whole career: disk under his resident window.
 *
 * Every row read is put through the same per-row migration `loadLeague` gives the
 * window (`migrateStatsRow`/`migrateHistRow`), so a season read back here is the
 * season load would have produced. A league that has never been saved has no
 * disk rows and answers with the window alone.
 */
export async function loadCareer(league: LeagueStore, player: Player): Promise<Career> {
  if (!league.lid) return { stats: [...player.recentStats], hist: [...player.recentHist] };
  const db = await getDb();
  const rows = await db.getAll("seasons", playerSeasonRange(league.lid, player.pid));
  const stats: SeasonStats[] = [];
  const hist: RatingsSnapshot[] = [];
  for (const r of rows) {
    if (r.kind === SEASON_ROW_STATS) stats.push(migrateStatsRow(r.row, FREE_AGENT_TID));
    else hist.push(migrateHistRow(r.row, player.pos, player.heightCm));
  }
  return { stats: merge(stats, player.recentStats), hist: merge(hist, player.recentHist) };
}

/**
 * Everyone's stat line for one season as it sits on DISK, keyed by pid.
 *
 * Disk only, with no resident overlay: for a caller that overlays the window
 * itself (`useSeasonStats`), so the read can be cached by league and season
 * without holding a league object. Rows of a season older than the window never
 * change again, which is what makes caching them sound.
 */
export async function readSeasonStats(lid: number, season: number): Promise<Map<number, SeasonStats>> {
  const out = new Map<number, SeasonStats>();
  const db = await getDb();
  const rows = await db.getAllFromIndex("seasons", "bySeason", IDBKeyRange.only([lid, season, SEASON_ROW_STATS]));
  for (const r of rows) {
    if (r.kind === SEASON_ROW_STATS) out.set(r.pid, migrateStatsRow(r.row, FREE_AGENT_TID));
  }
  return out;
}

/**
 * Everyone's stat line for one season, keyed by pid: disk under the window.
 *
 * Covers the players still in the pool. A player deleted from the save (the
 * free-agent cull, retirement) takes his rows with him, exactly as he took his
 * `stats` with him before careers moved to disk.
 */
export async function loadSeasonStats(
  league: LeagueStore,
  season: number,
): Promise<Map<number, SeasonStats>> {
  const out = league.lid ? await readSeasonStats(league.lid, season) : new Map<number, SeasonStats>();
  for (const p of league.players) {
    const row = p.recentStats.find((s) => s.season === season);
    if (row) out.set(p.pid, row);
  }
  return out;
}

/**
 * Everyone's ratings snapshot stamped at the end of one season, keyed by pid:
 * disk under the window. Only players still in the pool, whose position and
 * height the per-row migration needs.
 */
export async function loadSeasonHist(
  league: LeagueStore,
  season: number,
): Promise<Map<number, RatingsSnapshot>> {
  const out = new Map<number, RatingsSnapshot>();
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  if (league.lid) {
    const db = await getDb();
    const rows = await db.getAllFromIndex("seasons", "bySeason", IDBKeyRange.only([league.lid, season, SEASON_ROW_HIST]));
    for (const r of rows) {
      const p = byPid.get(r.pid);
      if (p && r.kind === SEASON_ROW_HIST) out.set(r.pid, migrateHistRow(r.row, p.pos, p.heightCm));
    }
  }
  for (const p of league.players) {
    const row = p.recentHist.find((h) => h.season === season);
    if (row) out.set(p.pid, row);
  }
  return out;
}

/**
 * The league with every player's whole career in `recentStats`/`recentHist`.
 *
 * For taking a league OUT of the app — an export — where a window would be a
 * silent loss of every season before it. One read of the league's whole history,
 * which is heavy and is only ever paid for a deliberate export.
 */
export async function withFullCareers(league: LeagueStore): Promise<LeagueStore> {
  if (!league.lid) return league;
  const db = await getDb();
  const rows = await db.getAll("seasons", leagueSeasonRange(league.lid));
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const disk = new Map<number, Career>();
  for (const r of rows) {
    const p = byPid.get(r.pid);
    if (!p) continue;
    let c = disk.get(r.pid);
    if (!c) disk.set(r.pid, (c = { stats: [], hist: [] }));
    if (r.kind === SEASON_ROW_STATS) c.stats.push(migrateStatsRow(r.row, FREE_AGENT_TID));
    else c.hist.push(migrateHistRow(r.row, p.pos, p.heightCm));
  }
  return {
    ...league,
    players: league.players.map((p) => {
      const c = disk.get(p.pid);
      if (!c) return p;
      return { ...p, recentStats: merge(c.stats, p.recentStats), recentHist: merge(c.hist, p.recentHist) };
    }),
  };
}
