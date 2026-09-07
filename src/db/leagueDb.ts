import type { LeagueStore } from "../core/leagueState.js";
import type { Player } from "../core/players/types.js";
import type { ArchivedPlayer } from "../core/players/archive.js";
import { getDb, type StoredLeague, type StoredPlayer, type PlayerCareer } from "./database.js";
import { migrateLeague } from "./migrate.js";

/**
 * Every player row for one league.
 *
 * Keys are `[lid, pid]`, and IndexedDB orders arrays lexicographically with any
 * array sorting after any number, so `[lid]` falls below every `[lid, pid]` and
 * `[lid, []]` falls above every one of them. That brackets exactly one league's
 * pool without needing an index or a sentinel pid.
 */
function playerRange(lid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid], [lid, []]);
}

/** Every archived-retiree row for one league. Same key shape as `playerRange`. */
function retireeRange(lid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid], [lid, []]);
}

/** Every career row for one league. Same key shape again. */
function careerRange(lid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid], [lid, []]);
}

/**
 * Every custom-crest row for one league. Same key shape once more — see
 * src/db/crestDb.ts, which owns reading and writing them; this is here only so
 * `deleteLeague` can clear them inside the same transaction as everything else.
 */
function crestRange(lid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid], [lid, []]);
}

/** Identity and career, as they are stored: two rows from one in-memory player. */
function splitPlayer(p: Player): { identity: StoredPlayer; career: PlayerCareer } {
  const { stats, hist, ...identity } = p;
  return { identity, career: { stats, hist } };
}

/**
 * The pool exactly as this tab last wrote it, so the next save can work out what
 * changed. Holds references, not copies — the whole point is that an unchanged
 * player is the *same object*, so this costs one pointer per player and comparing
 * is a pointer check.
 *
 * Deliberately **one league, not a map**. A map would keep every league opened
 * this session alive: the entries are references, but they pin the ~26 MB of
 * Player objects behind them, so switching saves would leak the old one. The app
 * only ever has one active league, so a single slot loses nothing — the one cost
 * is that saving some *other* league (customizeTeams can) evicts this and makes
 * the next save of the active one full, which is merely slower.
 *
 * Deliberately not populated by `loadLeague`: migration rebuilds player objects,
 * so a freshly loaded pool cannot be assumed identical to what is on disk. Leaving
 * it empty makes the first save of a session a full write and every later one
 * incremental, which is both obviously correct and cheap.
 */
let lastWritten: {
  lid: number;
  seq: number;
  players: Player[];
  /**
   * The archive as last written, for the same identity diff. One slot for both
   * because they are written in the same transaction under the same `writeSeq`,
   * so they can never disagree about what is on disk.
   *
   * Cheaper to hold than the pool: an `ArchivedPlayer` is created once at
   * retirement and never touched again, so in practice the diff finds only the
   * rows this offseason added and the rows the cap dropped.
   */
  retirees: ArchivedPlayer[];
} | null = null;

/** Exported for tests: forget what this tab thinks is on disk. */
export function resetWriteCache(): void {
  lastWritten = null;
}

/**
 * Does anything about this player *except his career* differ?
 *
 * Object identity is no longer a fine enough question once the two halves are
 * stored apart. A simmed matchday hands back a new player object for everyone —
 * `accumulateStats` replaces `stats` — while leaving name, ratings, ovr and
 * contract exactly as they were, so identity-by-reference would rewrite ~11k
 * identity rows that are byte-for-byte what is already on disk. Measured, that
 * doubled the puts and took a matchday save from 622ms to 1459ms.
 *
 * A field compare is sound here for the same reason the reference diff is: the
 * core is purely functional, so a nested value (`ratings`, `contract`, `intl`)
 * is replaced rather than edited and compares by reference too. `for...in`
 * rather than `Object.keys` to keep it allocation-free across the whole pool.
 */
function identityChanged(a: Player, b: Player): boolean {
  for (const k in a) {
    if (k === "stats" || k === "hist") continue;
    if ((a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]) {
      return true;
    }
  }
  // A key present only on the new object, e.g. a player who just picked up an
  // injury. Cheap because it only walks keys, allocating nothing.
  for (const k in b) if (!(k in a)) return true;
  return false;
}

/**
 * Which rows a save has to touch, for both stores in one pass.
 *
 * `full` forces a rewrite of everything, which is the safe answer whenever we
 * cannot prove what is on disk. Otherwise the two halves are asked separately:
 * a career row only when `stats`/`hist` actually moved (the core never mutates
 * them in place, so a reference compare answers it exactly), and an identity row
 * only when something else did. Most saves touch one or the other, never both —
 * a matchday moves every career and no identity, a contract extension the
 * reverse.
 *
 * One `Map` for both, deliberately: building a second one over ~11k players
 * cost ~50ms a save on its own, and two maps could in principle disagree about
 * what is on disk.
 */
function rowsToWrite(
  lid: number,
  players: Player[],
  storedSeq: number | undefined,
): { identities: Player[]; careers: Player[]; remove: number[]; full: boolean } {
  const cached = lastWritten;
  // Only trust the cache if it describes this league and the record on disk is
  // still the one we wrote: a second tab saving in between makes our idea of the
  // pool stale, and an incremental write on top of that would merge two states
  // into one that never existed.
  if (!cached || cached.lid !== lid || storedSeq === undefined || cached.seq !== storedSeq) {
    return { identities: players, careers: players, remove: [], full: true };
  }

  const prev = new Map(cached.players.map((p) => [p.pid, p]));
  const identities: Player[] = [];
  const careers: Player[] = [];
  for (const p of players) {
    const old = prev.get(p.pid);
    if (old === undefined) {
      identities.push(p);
      careers.push(p);
    } else if (old !== p) {
      if (old.stats !== p.stats || old.hist !== p.hist) careers.push(p);
      if (identityChanged(old, p)) identities.push(p);
    }
    prev.delete(p.pid);
  }
  return { identities, careers, remove: [...prev.keys()], full: false };
}

/**
 * The same diff for the retiree archive.
 *
 * Identity rather than pid-only, even though an `ArchivedPlayer` is written once
 * and never edited: an identity check is correct whether or not that holds, and
 * a pid check would silently skip a row whose contents ever did change.
 *
 * `remove` matters here in a way it rarely does for players — the archive is
 * pruned to `RETIREE_ARCHIVE_LIMIT`, so rows genuinely leave it.
 */
function retireesToWrite(
  lid: number,
  retirees: ArchivedPlayer[],
  storedSeq: number | undefined,
): { write: ArchivedPlayer[]; remove: number[]; full: boolean } {
  const cached = lastWritten;
  if (!cached || cached.lid !== lid || storedSeq === undefined || cached.seq !== storedSeq) {
    return { write: retirees, remove: [], full: true };
  }

  const prev = new Map(cached.retirees.map((r) => [r.pid, r]));
  const write: ArchivedPlayer[] = [];
  for (const r of retirees) {
    const old = prev.get(r.pid);
    if (old === undefined || old !== r) write.push(r);
    prev.delete(r.pid);
  }
  return { write, remove: [...prev.keys()], full: false };
}

/**
 * Save a league into IndexedDB. Returns the lid (key).
 *
 * The league record and the player rows are written in **one** transaction. That
 * is a correctness requirement, not tidiness: `teams[].roster` holds pids, so a
 * crash between the two writes would leave rosters pointing at players that do
 * not exist — a corrupt save rather than a merely stale one.
 *
 * Only players whose object identity changed since this tab's last write are
 * written (docs/save-performance-plan.md phase 2). That is sound because the core
 * is purely functional — it never mutates a player in place, so a changed player
 * always arrives as a new object. `test/db/playerIdentity.test.ts` is what holds
 * that invariant up; if it ever breaks, edits would silently stop persisting.
 *
 * If the league has no lid yet (0, or missing on a hand-made or imported record),
 * the lid property is stripped so IDB's autoIncrement generates a fresh key, which
 * is then written back onto the record. Note this is the ONE branch that can add a
 * save rather than update one, so anything calling it has to be sure it means to
 * create a league: a caller that fires twice makes two of them.
 */
export async function saveLeague(league: LeagueStore): Promise<number> {
  const db = await getDb();
  const { players, retiredPlayers, ...rest } = league;

  const tx = db.transaction(["leagues", "players", "careers", "retirees"], "readwrite");
  const leagues = tx.objectStore("leagues");
  const playerStore = tx.objectStore("players");
  const careerStore = tx.objectStore("careers");
  const retireeStore = tx.objectStore("retirees");

  let lid: number;
  let storedSeq: number | undefined;
  let seq: number;
  if (!league.lid) {
    // Strip lid so autoIncrement assigns a new key; leaving lid: 0 in place
    // would make IDB store the record under key 0 instead of generating one.
    // `!lid` rather than `=== 0` so an absent lid takes this path too — it used
    // to fall through to the update branch and look up key `undefined`.
    const { lid: _stripped, ...fresh } = rest;
    seq = 1;
    lid = await leagues.add({ ...fresh, writeSeq: seq } as StoredLeague);
    const stored = (await leagues.get(lid))!;
    stored.lid = lid;
    await leagues.put(stored);
  } else {
    lid = league.lid;
    storedSeq = (await leagues.get(lid))?.writeSeq;
    seq = (storedSeq ?? 0) + 1;
    await leagues.put({ ...rest, writeSeq: seq } as StoredLeague);
  }

  const { identities, careers, remove, full } = rowsToWrite(lid, players, storedSeq);
  // A full write clears first, so players dropped since the last save
  // (retirement, the free-agent cull) cannot linger as orphan rows in either
  // store. An incremental one deletes exactly the pids that went away.
  if (full) {
    await playerStore.delete(playerRange(lid));
    await careerStore.delete(careerRange(lid));
  }

  const archive = retiredPlayers ?? [];
  const retirees = retireesToWrite(lid, archive, storedSeq);
  if (retirees.full) await retireeStore.delete(retireeRange(lid));

  await Promise.all([
    ...remove.map((pid) => playerStore.delete([lid, pid])),
    ...remove.map((pid) => careerStore.delete([lid, pid])),
    ...identities.map((p) => playerStore.put(splitPlayer(p).identity, [lid, p.pid])),
    ...careers.map((p) => careerStore.put(splitPlayer(p).career, [lid, p.pid])),
    ...retirees.remove.map((pid) => retireeStore.delete([lid, pid])),
    ...retirees.write.map((r) => retireeStore.put(r, [lid, r.pid])),
  ]);

  await tx.done;
  lastWritten = { lid, seq, players, retirees: archive };
  return lid;
}

/**
 * Load a league by lid. Returns undefined if it does not exist.
 *
 * Reassembles the split record into an ordinary `LeagueStore`, so everything
 * above this layer — migrate, export, the worker, every page — keeps working
 * against one in-memory players array and needs no knowledge of the split.
 *
 * Two cases trigger an immediate write-back:
 *   - a v1 record still carrying `players` inline, which is split here (the
 *     lazy migration; see database.ts for why not in `upgrade`);
 *   - migration shrinking the record, as before.
 * Without the write-back the on-disk record keeps its old shape and every
 * startup redoes this work before first paint.
 */
export async function loadLeague(
  lid: number,
): Promise<LeagueStore | undefined> {
  const db = await getDb();

  const tx = db.transaction(["leagues", "players", "careers", "retirees"], "readonly");
  const stored = await tx.objectStore("leagues").get(lid);
  if (!stored) return undefined;
  const rows = await tx.objectStore("players").getAll(playerRange(lid));
  const careerKeys = await tx.objectStore("careers").getAllKeys(careerRange(lid));
  const careerRows = await tx.objectStore("careers").getAll(careerRange(lid));
  const retireeRows = await tx.objectStore("retirees").getAll(retireeRange(lid));
  await tx.done;

  const careerByPid = new Map<number, PlayerCareer>();
  careerKeys.forEach((key, i) => careerByPid.set(key[1], careerRows[i]));

  // A row still carrying `stats` is pre-v4 and has not been split yet. Same
  // lazy migration as v1's inline pool, and the same reason for the write-back
  // below: without it every startup redoes this before first paint.
  const inlineCareers = rows.some((r) => r.stats !== undefined);
  const joined: Player[] = rows.map((r) => {
    const { stats, hist, ...identity } = r;
    const career = careerByPid.get(r.pid);
    return {
      ...identity,
      stats: stats ?? career?.stats ?? [],
      hist: hist ?? career?.hist ?? [],
    } as Player;
  });

  const { players: inline, retiredPlayers: inlineRetirees, ...meta } = stored;
  const assembled = {
    ...meta,
    players: inline ?? joined,
    // An inline archive means a v1/v2 record that has not been split yet. Note
    // an empty inline array is still "inline" and must win over the (also
    // empty) store read, or a save whose archive is legitimately empty would
    // look unsplit forever and rewrite itself on every load.
    retiredPlayers: inlineRetirees ?? retireeRows,
  } as LeagueStore;

  const migrated = migrateLeague(assembled);
  if (
    inline !== undefined
    || inlineRetirees !== undefined
    || inlineCareers
    || shrankOnLoad(assembled, migrated)
    || namedAwardWinners(assembled, migrated)
  ) {
    await saveLeague(migrated);
  }
  return migrated;
}

/**
 * Whether migration actually made the record smaller, so the write-back is worth
 * it. Deliberately cheap: comparing sizes would mean serializing the whole league
 * twice, which on an aged save is the very cost being avoided.
 */
function shrankOnLoad(before: LeagueStore, after: LeagueStore): boolean {
  if (after.players.length < before.players.length) return true;
  const storedCups = before.cupHistory ?? [];
  return (after.cupHistory ?? []).some((cup, i) => cup.statLines !== storedCups[i]?.statLines);
}

/**
 * Whether migration gave a past season its award winners' names back.
 *
 * The one migration whose result must be written down rather than left in
 * memory. Every other backfill recomputes identically on the next load; this one
 * copies names off players who are still in the save *right now*, and the next
 * offseason deletes more of them for good (see core/awardWinners.ts). Writing
 * on load is what makes "the loss stops here" true at load, rather than true
 * only once the player happens to do something that saves.
 *
 * Cheap for the same reason as `shrankOnLoad`: it counts entries, not bytes,
 * and only fires once per save, since after that every entry has the field.
 */
function namedAwardWinners(before: LeagueStore, after: LeagueStore): boolean {
  return after.seasonHistory.some(
    (h, i) => h.awardWinners !== undefined && before.seasonHistory[i]?.awardWinners === undefined,
  );
}

/**
 * List all leagues with minimal metadata (lid, name, created, season).
 *
 * Cheap since the split: the league records no longer contain the player pool,
 * so this stopped deserializing tens of MB per save to render a few rows.
 *
 * `season` is here so the picker can tell two saves of the same club apart —
 * they're named after the club, so a name and a date alone make near-identical
 * rows out of anything started on the same day.
 */
export async function listLeagues(): Promise<
  Array<{ lid: number; name: string; created: number; season: number }>
> {
  const db = await getDb();
  const all = await db.getAll("leagues");
  return all.map((l) => ({
    lid: l.lid,
    name: l.meta.name,
    created: l.meta.created,
    season: l.season,
  }));
}

/** Delete a league by lid, along with all of its player, career, retiree and crest rows. */
export async function deleteLeague(lid: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["leagues", "players", "careers", "retirees", "crests"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("leagues").delete(lid),
    tx.objectStore("players").delete(playerRange(lid)),
    tx.objectStore("careers").delete(careerRange(lid)),
    tx.objectStore("retirees").delete(retireeRange(lid)),
    // In this transaction rather than through crestDb's own, so a deleted
    // league can never leave its badges behind for a later save to inherit by
    // reusing the lid.
    tx.objectStore("crests").delete(crestRange(lid)),
  ]);
  await tx.done;
  // Drop the pool we were holding for it, rather than pinning a deleted
  // league's players in memory for the rest of the session.
  if (lastWritten?.lid === lid) lastWritten = null;
}

/** Exported for tests: the player rows currently stored for a league. */
export async function storedPlayerRows(lid: number): Promise<StoredPlayer[]> {
  const db = await getDb();
  return db.getAll("players", playerRange(lid));
}

/** Exported for tests: the career rows currently stored for a league. */
export async function storedCareerRows(lid: number): Promise<PlayerCareer[]> {
  const db = await getDb();
  return db.getAll("careers", careerRange(lid));
}

/** Exported for tests: the archived-retiree rows currently stored for a league. */
export async function storedRetireeRows(lid: number): Promise<ArchivedPlayer[]> {
  const db = await getDb();
  return db.getAll("retirees", retireeRange(lid));
}
