import type { LeagueStore } from "../core/leagueState.js";
import type { Player } from "../core/players/types.js";
import type { ArchivedPlayer } from "../core/players/archive.js";
import type { PlayedMatch } from "../core/standings.js";
import type { BoxScore } from "../engine/attribution.js";
import {
  emptyTeamSeasonAcc, addToTeamSeasonAcc, teamSeasonStatsFromAcc, cloneTeamSeasonAcc,
  type TeamSeasonAcc, type TeamSeasonStats,
} from "../core/standings.js";
import { getDb, type StoredLeague, type StoredPlayer, type PlayerCareer, type StoredSeasonRow } from "./database.js";
import { migrateLeague } from "./migrate.js";
import { changedRows, histRow, leagueSeasonRange, playerSeasonRange, statsRow } from "./careerDb.js";
import { windowCareer } from "../core/simArchive.js";

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

/**
 * Every played-match row for one league. Same key shape again, except the
 * second element is an array index rather than a pid — see database.ts.
 */
function playedRange(lid: number): IDBKeyRange {
  return IDBKeyRange.bound([lid], [lid, []]);
}

/**
 * How many played-match rows are pulled out of IndexedDB at a time.
 *
 * The read is chunked rather than one `getAll` because the point of eliding is
 * to keep match detail out of memory, and `getAll` over the whole range would
 * materialise every box score first — lowering the steady-state floor while
 * leaving the peak, which is the half that actually runs a phone tab out of
 * memory. A chunk is read, folded, stripped and dropped, so at most this many
 * box scores are live at once.
 *
 * Chunked with `getAll(range, count)` and an advancing lower bound rather than
 * a cursor: keys are dense (`[lid, 0..n-1]`, an invariant `saveLeague` keeps),
 * so the next key after N rows is exactly `[lid, N]`. That is ~20 round trips
 * on a full season against ~10,500 cursor advances.
 */
const PLAYED_READ_CHUNK = 512;

/**
 * The running team-season fold for the one league whose played matches are held
 * without their player lines.
 *
 * Those lines have exactly one whole-season reader, `computeTeamSeasonStats`, so
 * they are folded into this as they are read (`loadLeague`) or written
 * (`elideWrittenDetail`) and then dropped; `teamSeasonStatsFor` answers from it.
 * `folded` is how many of `played`'s matches it covers — always a prefix, since
 * `played` is only ever appended to or cleared.
 *
 * Deliberately separate from `lastWritten`: that cache answers "what is on
 * disk", this one "what have the lines added up to", and they are invalidated by
 * different things. Keyed by lid rather than a single slot because a save that
 * is not the active one can be loaded mid-session (customising another save's
 * teams does) and must not evict the active league's fold — `lastWritten` can
 * afford one slot because losing it only costs a full rewrite; losing this
 * loses the season's team totals.
 */
const seasonFolds = new Map<number, { folded: number; acc: TeamSeasonAcc }>();

/**
 * Read one league's played matches with their detail dropped, folding each
 * match's player lines into the team-season accumulator on the way past.
 *
 * Its own read-only transaction, deliberately not the one `loadLeague` uses for
 * everything else: this issues a request per chunk with an await between, and a
 * transaction that goes idle between requests is free to auto-commit. Nothing
 * here needs atomicity with the player read — they are reads of a save the app's
 * own action chain guarantees nobody is writing.
 */
async function readPlayedElided(lid: number): Promise<PlayedMatch[]> {
  const db = await getDb();
  const out: PlayedMatch[] = [];
  const acc = emptyTeamSeasonAcc();
  for (;;) {
    const store = db.transaction("played", "readonly").objectStore("played");
    // Keys are dense, so everything already read sits below `[lid, out.length]`.
    const from: IDBKeyRange = out.length === 0
      ? playedRange(lid)
      : IDBKeyRange.bound([lid, out.length], [lid, []]);
    const batch = await store.getAll(from, PLAYED_READ_CHUNK);
    // Fold BEFORE stripping: the lines are gone from memory the moment the
    // stripped copy replaces the row.
    addToTeamSeasonAcc(acc, batch);
    for (const m of batch) out.push(elideDetail(m));
    if (batch.length < PLAYED_READ_CHUNK) break;
  }
  seasonFolds.set(lid, { folded: out.length, acc });
  return out;
}

/**
 * The full box score of one played match, read back from disk.
 *
 * Returns undefined when there is no such row, which a caller must treat as
 * "unknown" rather than as "nothing happened": an index past the end of the
 * season and a save that has never been written both land here.
 */
export async function loadMatchBoxScore(
  lid: number,
  index: number,
): Promise<BoxScore | undefined> {
  const db = await getDb();
  const row = await db.get("played", [lid, index]);
  return row?.boxScore;
}

/**
 * The same league with every elided box score read back off disk.
 *
 * For anything that takes a league OUT of the app — an export above all. A file
 * is the one place the elision marker must never reach: it says "the real detail
 * is on disk at this key", which is a claim about THIS database, and a file
 * carrying it would be imported into a save where the claim is false.
 * `saveLeague` would then skip those rows forever and the imported dynasty would
 * silently have no box scores at all.
 *
 * So the marker is dropped whether or not the detail was recovered. An export
 * missing a box score is a small loss; one carrying a marker aimed at somebody
 * else's database is a permanent, silent one.
 */
export async function withMatchDetail(league: LeagueStore): Promise<LeagueStore> {
  if (!league.played.some(isDetailElided)) return league;
  const rows = league.lid ? await storedPlayedRows(league.lid) : [];
  return {
    ...league,
    played: league.played.map((m, i) => {
      if (!isDetailElided(m)) return m;
      const stored = rows[i]?.boxScore;
      if (stored) return { ...m, boxScore: stored };
      const { detailElided: _dropped, ...boxScore } = m.boxScore;
      return { ...m, boxScore };
    }),
  };
}

/**
 * The league just saved, with the detail of the matches it wrote dropped from
 * memory.
 *
 * `loadLeague` elides on the way in, but a match simmed during the session
 * arrives from the worker with its full box score and would otherwise stay
 * resident until the next load, so a season simmed in one sitting climbs back
 * to the full weight. This closes that half.
 *
 * It only ever elides rows it can PROVE are on disk: the league's `played` must
 * be the exact array the last `saveLeague` for this lid wrote (same reference),
 * which is what `lastWritten` records. Anything else is returned untouched —
 * a league that was never saved, a different save, or one edited since. Eliding
 * a row that isn't on disk would lose it, which is the failure this whole
 * mechanism exists to prevent.
 *
 * Before any line is dropped it is folded into `seasonFold`, since that is the
 * only place the season's team totals survive. The write cache is pointed at
 * the elided array too, so the next save still sees an unchanged prefix and
 * takes the cheap append path rather than a full rewrite.
 */
export function elideWrittenDetail(league: LeagueStore): LeagueStore {
  const cached = lastWritten;
  if (!cached || !league.lid || cached.lid !== league.lid || cached.played !== league.played) {
    return league;
  }
  if (!league.played.some((m) => !isDetailElided(m) && hasDetail(m))) return league;

  const fold = foldFor(league);
  const rest = league.played.slice(fold.folded);
  // A stripped match past the fold has no lines left to add, so folding it
  // would count the game and none of its goals. Leave everything as it is;
  // `teamSeasonStatsFor` reports the gap loudly rather than this hiding it.
  if (rest.some(isDetailElided)) return league;
  addToTeamSeasonAcc(fold.acc, rest);
  seasonFolds.set(league.lid, { folded: league.played.length, acc: fold.acc });

  const played = league.played.map(elideDetail);
  lastWritten = { ...cached, played };
  return { ...league, played };
}

/**
 * The accumulator covering a prefix of `league.played`, or a fresh one.
 *
 * Fresh whenever the cached fold is for another save or covers more matches
 * than the league now holds — the offseason empties `played`, and a fold of last
 * season's matches must not leak into this one's.
 */
function foldFor(league: LeagueStore): { folded: number; acc: TeamSeasonAcc } {
  const f = league.lid ? seasonFolds.get(league.lid) : undefined;
  if (f && f.folded <= league.played.length) return f;
  return { folded: 0, acc: emptyTeamSeasonAcc() };
}

/**
 * Team season stats for this league's current season, whether or not its
 * matches' player lines are still in memory.
 *
 * The drop-in replacement for `computeTeamSeasonStats(teamIds, league.played)`
 * everywhere outside the sim: it answers from the fold for the prefix of matches
 * already stripped, and folds any it still holds in full. It never advances the
 * shared fold, because a caller can hand it a league that is never committed —
 * a live match the user then abandons — and the fold must not count matches
 * that did not happen.
 *
 * Throws on an elided match it has no fold for, rather than returning a total
 * that silently omits it: that state is a bug in the elision bookkeeping, and a
 * wrong table is worse than a loud one.
 */
export function teamSeasonStatsFor(league: LeagueStore, teamIds: number[]): TeamSeasonStats[] {
  const f = foldFor(league);
  const acc = cloneTeamSeasonAcc(f.acc);
  const rest = league.played.slice(f.folded);
  if (rest.some(isDetailElided)) {
    throw new Error(
      `teamSeasonStatsFor: league ${league.lid} holds elided matches with no season fold covering them`,
    );
  }
  addToTeamSeasonAcc(acc, rest);
  return teamSeasonStatsFromAcc(acc, teamIds);
}

/** Whether this match's box score was dropped from memory rather than never recorded. */
export function isDetailElided(m: PlayedMatch): boolean {
  return m.boxScore.detailElided === true;
}

function hasDetail(m: PlayedMatch): boolean {
  const b = m.boxScore;
  return b.events.length > 0 || b.home.length > 0 || b.away.length > 0;
}

/**
 * The same match with its box score detail dropped: the event timeline and both
 * teams' player lines. The score, possession and matchday stay, being what the
 * standings, the schedule and every table read.
 *
 * A match that recorded nothing is returned untouched and stays unmarked, so
 * `isDetailElided` keeps meaning "there is detail on disk that is not here"
 * rather than "there may or may not be".
 */
function elideDetail(m: PlayedMatch): PlayedMatch {
  if (!hasDetail(m) || isDetailElided(m)) return m;
  return {
    ...m,
    boxScore: { ...m.boxScore, home: [], away: [], events: [], detailElided: true },
  };
}

/**
 * Every row of one league in the v4-v6 `careers` store. Read only to convert a
 * save onto `seasons`, and cleared by the full-write branch once it has.
 */
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
  /**
   * The season's matches as last written, held for the append check in
   * `playedToWrite`. One more pointer, not a copy: the elements are the very
   * objects `league.played` holds, which the app is keeping alive anyway.
   */
  played: PlayedMatch[];
} | null = null;

/** Exported for tests: forget what this tab thinks is on disk. */
export function resetWriteCache(): void {
  lastWritten = null;
  seasonFolds.clear();
}

/**
 * Does anything about this player *except his history* differ?
 *
 * Object identity is not a fine enough question on its own. A simmed matchday
 * hands back a new player object for everyone — `simThrough` copies the stat
 * lines before accumulating into them — while leaving name, ratings, ovr and
 * contract exactly as they were, so identity-by-reference would rewrite every
 * player row for nothing. Measured before careers left memory, that doubled the
 * puts and took a matchday save from 622ms to 1459ms.
 *
 * A field compare is sound here for the same reason the reference diff is: the
 * core is purely functional, so a nested value (`ratings`, `contract`, `intl`)
 * is replaced rather than edited and compares by reference too. `for...in`
 * rather than `Object.keys` to keep it allocation-free across the whole pool.
 */
function identityChanged(a: Player, b: Player): boolean {
  for (const k in a) {
    if (k === "recentStats" || k === "recentHist") continue;
    if ((a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]) {
      return true;
    }
  }
  // A key present only on the new object, e.g. a player who just picked up an
  // injury. Cheap because it only walks keys, allocating nothing.
  for (const k in b) if (!(k in a)) return true;
  return false;
}

/** Every history row a player holds in memory, as `seasons` rows. */
function allRows(lid: number, p: Player): StoredSeasonRow[] {
  return [
    ...p.recentStats.map((s) => statsRow(lid, p.pid, s)),
    ...p.recentHist.map((h) => histRow(lid, p.pid, h)),
  ];
}

/**
 * Which rows a save has to touch, in one pass over the pool.
 *
 * `full` forces a write of everything in memory, the safe answer whenever we
 * cannot prove what is on disk. Otherwise each player is asked two things: which
 * of his history rows are new or changed (`changedRows`, by value — see there),
 * and whether his player row moved, i.e. his identity or his window. A matchday
 * touches the players who played and nobody else; a contract extension touches
 * one player row and no history.
 *
 * **A full write never removes a history row a player still has.** The rows not
 * in memory — every season older than the window — are only on disk, and a full
 * write has nothing to put back in their place. The same lesson as `played`'s
 * elided box scores (see `saveLeague`): anything that can be missing from memory
 * must never be cleared on the strength of being missing. Rows go only with the
 * player they belong to (`remove`).
 *
 * One `Map`, deliberately: building a second one over the pool cost ~50ms a save
 * on its own, and two maps could in principle disagree about what is on disk.
 */
function rowsToWrite(
  lid: number,
  players: Player[],
  storedSeq: number | undefined,
): { players: Player[]; rows: StoredSeasonRow[]; remove: number[]; full: boolean } {
  const cached = lastWritten;
  // Only trust the cache if it describes this league and the record on disk is
  // still the one we wrote: a second tab saving in between makes our idea of the
  // pool stale, and an incremental write on top of that would merge two states
  // into one that never existed.
  if (!cached || cached.lid !== lid || storedSeq === undefined || cached.seq !== storedSeq) {
    return { players, rows: players.flatMap((p) => allRows(lid, p)), remove: [], full: true };
  }

  const prev = new Map(cached.players.map((p) => [p.pid, p]));
  const out: Player[] = [];
  const rows: StoredSeasonRow[] = [];
  for (const p of players) {
    const old = prev.get(p.pid);
    if (old === undefined) {
      out.push(p);
      rows.push(...allRows(lid, p));
    } else if (old !== p) {
      const stats = changedRows(old.recentStats, p.recentStats);
      const hist = changedRows(old.recentHist, p.recentHist);
      for (const s of stats) rows.push(statsRow(lid, p.pid, s));
      for (const h of hist) rows.push(histRow(lid, p.pid, h));
      const windowMoved = stats.length > 0 || hist.length > 0
        || old.recentStats.length !== p.recentStats.length
        || old.recentHist.length !== p.recentHist.length;
      if (windowMoved || identityChanged(old, p)) out.push(p);
    }
    prev.delete(p.pid);
  }
  return { players: out, rows, remove: [...prev.keys()], full: false };
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
 * Where a save has to start writing played-match rows, if anywhere.
 *
 * Deliberately **not** the identity diff `players` and `retirees` use, and the
 * difference is the point. Those are pools: a row can change at any position,
 * so finding what moved costs a map and a per-row comparison. `played` is a
 * *log* — `simThrough` only ever does `[...league.played, ...newResults]` and
 * the offseason only ever sets it to `[]` — so the only two shapes it can take
 * are "what we wrote, plus some" and "something else entirely". That makes the
 * answer an index rather than a set, and it is what gets the common case to
 * zero work: a lineup drag or a signing does not touch `played` at all, so
 * `from === played.length` and nothing is written.
 *
 * The append-only claim is checked rather than assumed. A pointer compare per
 * match with no allocation, ~10.5k of them at the very worst, and anything
 * unexpected falls back to a full rewrite — the same "cannot prove what is on
 * disk, so rewrite it" rule the other two diffs open with.
 */
function playedToWrite(
  lid: number,
  played: PlayedMatch[],
  storedSeq: number | undefined,
): { from: number; full: boolean } {
  const cached = lastWritten;
  if (!cached || cached.lid !== lid || storedSeq === undefined || cached.seq !== storedSeq) {
    return { from: 0, full: true };
  }
  const prev = cached.played;
  // Shorter than what we wrote is the offseason rollover, which sets `played`
  // to []. A full rewrite is the right answer and, at length 0, the range
  // delete it starts with is also the entire cost of the year's cleanup.
  if (played.length < prev.length) return { from: 0, full: true };
  for (let i = 0; i < prev.length; i++) {
    if (played[i] !== prev[i]) return { from: 0, full: true };
  }
  return { from: prev.length, full: false };
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
  const { players, retiredPlayers, played, ...rest } = league;

  const tx = db.transaction(
    ["leagues", "players", "careers", "seasons", "retirees", "played"],
    "readwrite",
  );
  const leagues = tx.objectStore("leagues");
  const playerStore = tx.objectStore("players");
  const careerStore = tx.objectStore("careers");
  const seasonStore = tx.objectStore("seasons");
  const retireeStore = tx.objectStore("retirees");
  const playedStore = tx.objectStore("played");

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

  const written = rowsToWrite(lid, players, storedSeq);
  let remove = written.remove;
  if (written.full) {
    // A full write cannot diff against a cache, so it works out who went away
    // (retirement, the free-agent cull) from what is on disk: every player row
    // not in the pool. Deleting by pid rather than clearing the range, because
    // clearing would take the history rows with it — see `rowsToWrite`.
    const inPool = new Set(players.map((p) => p.pid));
    const onDisk = await playerStore.getAllKeys(playerRange(lid));
    remove = onDisk.map((k) => k[1]).filter((pid) => !inPool.has(pid));
    // The v4-v6 store, emptied once this save's history is in `seasons`. Only
    // ever non-empty on the first write after `loadLeague` converted a save,
    // and that write is always full (load seeds no cache).
    await careerStore.delete(careerRange(lid));
  }

  const archive = retiredPlayers ?? [];
  const retirees = retireesToWrite(lid, archive, storedSeq);
  if (retirees.full) await retireeStore.delete(retireeRange(lid));

  // Rows are keyed by position, so a full rewrite must drop anything past the
  // end: without it a season that shrank (the rollover, or a save loaded from
  // an export with fewer matches) would leave the tail of the old one behind,
  // and `loadLeague` reads the range as a dense array.
  //
  // Only the TAIL, never the whole range, and that is load-bearing rather than
  // an optimisation. Clearing the range used to be equivalent, because every
  // surviving index was written again immediately below — that stopped being
  // true once rows could be skipped. An elided row is deliberately not
  // rewritten, so clearing first would delete the real events and put nothing
  // back, losing the timeline of every match played before this session.
  const playedWrite = playedToWrite(lid, played, storedSeq);
  if (playedWrite.full) {
    await playedStore.delete(IDBKeyRange.bound([lid, played.length], [lid, []]));
  }
  const playedPuts: Promise<unknown>[] = [];
  for (let i = playedWrite.from; i < played.length; i++) {
    // Never write a box score whose events were elided on load: the row already
    // on disk holds them and this copy does not. Skipping is exact rather than
    // best-effort — an elided row can only have come from `loadLeague`, at this
    // same index, and `played` is only ever appended to or cleared wholesale,
    // so the row sitting at this key IS this match.
    if (isDetailElided(played[i])) continue;
    playedPuts.push(playedStore.put(played[i], [lid, i]));
  }

  await Promise.all([
    ...remove.map((pid) => playerStore.delete([lid, pid])),
    ...remove.map((pid) => seasonStore.delete(playerSeasonRange(lid, pid))),
    // Always the WINDOW, whatever memory holds. The window in memory is longer
    // for a moment after a conversion (whole careers, cut once this lands) and
    // for a while in play (a session appends a season a year); stored as-is,
    // the `players` store would hold those careers again and every load would
    // read them back. Everything older than the window is in `written.rows`.
    ...written.players.map((p) => playerStore.put(windowCareer(p), [lid, p.pid])),
    ...written.rows.map((r) => seasonStore.put(r)),
    ...retirees.remove.map((pid) => retireeStore.delete([lid, pid])),
    ...retirees.write.map((r) => retireeStore.put(r, [lid, r.pid])),
    ...playedPuts,
  ]);

  await tx.done;
  lastWritten = { lid, seq, players, retirees: archive, played };
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

  const tx = db.transaction(
    ["leagues", "players", "careers", "retirees"],
    "readonly",
  );
  const stored = await tx.objectStore("leagues").get(lid);
  if (!stored) return undefined;
  const rows = await tx.objectStore("players").getAll(playerRange(lid));
  // A v4-v6 save keeps each whole career in `careers`, and this is the one load
  // that reads them: to put them into `seasons` (the write-back below), after
  // which the store is empty for this league and every later load skips it.
  const unconverted = (await tx.objectStore("careers").count(careerRange(lid))) > 0;
  const careerKeys = unconverted ? await tx.objectStore("careers").getAllKeys(careerRange(lid)) : [];
  const careerRows = unconverted ? await tx.objectStore("careers").getAll(careerRange(lid)) : [];
  const retireeRows = await tx.objectStore("retirees").getAll(retireeRange(lid));
  await tx.done;

  // In key order, which is index order: IDB compares array keys element-wise
  // and numbers numerically, so [lid, 2] sorts below [lid, 10]. Taken as a
  // dense array because `saveLeague` keeps it one — see playedToWrite.
  //
  // Read WITHOUT its box scores (timelines and player lines), which are most of
  // what a mid-season save weighs; `loadMatchBoxScore` fetches a match's back
  // when a screen needs it, and the lines are folded into the team-season
  // totals on the way past (`teamSeasonStatsFor`).
  // A record still carrying `played` inline is pre-v6 and has not been split
  // yet, and there its box scores are the only copy in existence — eliding them
  // would destroy them, since the split write-back below is what first puts
  // them in the store. So that case reads nothing here and keeps the inline
  // array whole.
  const playedRows = stored.played !== undefined ? [] : await readPlayedElided(lid);

  const careerByPid = new Map<number, PlayerCareer>();
  careerKeys.forEach((key, i) => careerByPid.set(key[1], careerRows[i]));

  // A row still carrying `stats` is pre-v4 and holds its whole career inline.
  // Same lazy migration as v1's inline pool, and the same reason for the
  // write-back below: without it every startup redoes this before first paint.
  //
  // Either older shape arrives with the WHOLE career in the window fields, which
  // is what the conversion needs: `migrateLeague` then brings every season up to
  // date (the per-row migrations only ever run on what is in memory), the
  // write-back puts every season into `seasons`, and only after that is the
  // window cut. Cutting first would leave the older seasons nowhere.
  const inlineCareers = rows.some((r) => r.stats !== undefined);
  const joined: Player[] = rows.map((r) => {
    const { stats, hist, recentStats, recentHist, ...identity } = r;
    const career = careerByPid.get(r.pid);
    return {
      ...identity,
      recentStats: recentStats ?? stats ?? career?.stats ?? [],
      recentHist: recentHist ?? hist ?? career?.hist ?? [],
    } as Player;
  });

  const {
    players: inline,
    retiredPlayers: inlineRetirees,
    played: inlinePlayed,
    ...meta
  } = stored;
  const assembled = {
    ...meta,
    players: inline ?? joined,
    // An inline archive means a v1/v2 record that has not been split yet. Note
    // an empty inline array is still "inline" and must win over the (also
    // empty) store read, or a save whose archive is legitimately empty would
    // look unsplit forever and rewrite itself on every load.
    retiredPlayers: inlineRetirees ?? retireeRows,
    // Same "empty inline still counts as inline" rule as the archive above,
    // and it bites more often here: a save sitting in the offseason has no
    // matches at all, so `?? ` rather than a length test is what stops it
    // looking unsplit forever and rewriting itself on every load.
    played: inlinePlayed ?? playedRows,
  } as LeagueStore;

  const migrated = migrateLeague(assembled);
  if (
    inline !== undefined
    || inlineRetirees !== undefined
    || inlinePlayed !== undefined
    || inlineCareers
    || unconverted
    || shrankOnLoad(assembled, migrated)
    || namedAwardWinners(assembled, migrated)
    // A rating-scale lift, like the award-winner backfill above, has to be
    // persisted rather than left in memory. It is deterministic from the stored
    // originals so a repeat would be correct — but it replaces every player
    // object, so an un-persisted lift costs a deep map over the whole pool on
    // every load AND makes the session's first save a full write of all ~15k
    // player rows instead of a dirty-set diff.
    || assembled.meta.ovrScale !== migrated.meta.ovrScale
  ) {
    await saveLeague(migrated);
    // Written, so the window can be cut: everything older is now in `seasons`.
    return trimWrittenCareers(migrated);
  }
  // Nothing needed writing: a current-shape save, whose player rows are stored
  // cut to the window already (`saveLeague`). Cut again anyway, for free when it
  // is a no-op, so a row written under a wider window than today's cannot make
  // the resident pool bigger than intended.
  return { ...migrated, players: migrated.players.map(windowCareer) };
}

/**
 * The league with each player cut back to the resident window — but only once
 * the save that wrote his history has provably landed.
 *
 * The window grows in play: every offseason appends a snapshot and every season
 * opens a stat line, so a session that plays on for years would slowly hold
 * careers again. Cutting is only safe for rows that are on disk, and the proof
 * is the same one `elideWrittenDetail` uses: the pool is the exact array the
 * last `saveLeague` for this league recorded, and that save put every row it
 * held (`rowsToWrite`). Anything else — a pool not yet saved, another league —
 * comes back untouched, and a later commit trims it.
 *
 * `lastWritten.players` is repointed at the cut pool so the next save diffs
 * against what the app now holds. Cut players are new objects, but the rows in
 * them are the same objects the save wrote, so `changedRows` finds nothing and
 * the next save writes no history for them.
 */
export function trimWrittenCareers(league: LeagueStore): LeagueStore {
  if (!lastWritten || lastWritten.lid !== league.lid || lastWritten.players !== league.players) {
    return league;
  }
  let cut = false;
  const players = league.players.map((p) => {
    const w = windowCareer(p);
    if (w !== p) cut = true;
    return w;
  });
  if (!cut) return league;
  lastWritten.players = players;
  return { ...league, players };
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

/**
 * Delete a league by lid, along with all of its player, history, retiree,
 * played and crest rows.
 */
export async function deleteLeague(lid: number): Promise<void> {
  // A reused lid must not inherit this save's team-season fold.
  seasonFolds.delete(lid);
  const db = await getDb();
  const tx = db.transaction(
    ["leagues", "players", "careers", "seasons", "retirees", "crests", "played"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("leagues").delete(lid),
    tx.objectStore("players").delete(playerRange(lid)),
    tx.objectStore("careers").delete(careerRange(lid)),
    tx.objectStore("seasons").delete(leagueSeasonRange(lid)),
    tx.objectStore("retirees").delete(retireeRange(lid)),
    tx.objectStore("played").delete(playedRange(lid)),
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

/** Exported for tests: the history rows currently stored for a league. */
export async function storedSeasonRows(lid: number): Promise<StoredSeasonRow[]> {
  const db = await getDb();
  return db.getAll("seasons", leagueSeasonRange(lid));
}

/** Exported for tests: the v4-v6 career rows still stored for a league. */
export async function storedCareerRows(lid: number): Promise<PlayerCareer[]> {
  const db = await getDb();
  return db.getAll("careers", careerRange(lid));
}

/** Exported for tests: the played-match rows currently stored for a league. */
export async function storedPlayedRows(lid: number): Promise<PlayedMatch[]> {
  const db = await getDb();
  return db.getAll("played", playedRange(lid));
}

/** Exported for tests: the archived-retiree rows currently stored for a league. */
export async function storedRetireeRows(lid: number): Promise<ArchivedPlayer[]> {
  const db = await getDb();
  return db.getAll("retirees", retireeRange(lid));
}
