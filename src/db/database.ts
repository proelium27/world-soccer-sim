import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import type { LeagueStore } from "../core/leagueState.js";
import type { Player } from "../core/players/types.js";
import type { ArchivedPlayer } from "../core/players/archive.js";
import type { PlayedMatch } from "../core/standings.js";

const DB_NAME = "soccer-gm";
/**
 * 2 split `players` out of the league record. See docs/save-performance-plan.md:
 * with one record per league, every mutation rewrote the entire world, so the
 * cost of any action grew with how long the save had been played.
 *
 * 3 split `retiredPlayers` out for the same reason, and it is the same bug one
 * field along: `saveLeague` writes the whole non-player record every time, so
 * the archive was re-serialised on every lineup change and signing. Measured at
 * 2,204 bytes a row that is 11ms per save at the old 2,000-row cap and 91ms at
 * 20,000, before mobile's 5-10x. The cap exists to bound *that*, not disk, so
 * splitting the store is what lets it rise (RETIREE_ARCHIVE_LIMIT).
 *
 * 4 split each player's `stats`/`hist` into `careers`. Different goal from 2
 * and 3, and worth being clear about: those two were about **write** cost,
 * and both deliberately left `loadLeague` reassembling one ordinary
 * `LeagueStore` so nothing above the db layer had to change. That is exactly
 * why the pool is still fully resident. Measured on the reported season-60
 * save: a player's identity is 4.5 MB across the whole world while the career
 * records are 45.2 MB, ten to one, and the ratio worsens every season. This
 * version is the storage half; `docs/lazy-career-plan.md` phase 3 is what
 * stops loading them. It buys one thing immediately — a contract change or a
 * transfer rewrites identity without re-serialising a career.
 *
 * 5 added `crests`, for the custom club badges a player brings in with a logo
 * pack. Same argument as 2 and 3 rather than a new one: a world of badges is a
 * few megabytes, the league record is rewritten in full on every mutation and
 * cloned to the worker on every sim, so putting them on `LeagueStore` would pay
 * for them on every lineup change and every matchday. In their own store they
 * are written once at import and read once at load, which is what they are.
 *
 * 6 split `played` out, and it is the same bug as 2 and 3 with by far the
 * biggest field. Every one of those entries says the league record "is
 * rewritten in full on every mutation" — and `played` was sitting in it, which
 * nothing connected because **`played` is invisible to every save-size probe in
 * this repo**: they all sample after the offseason, which wipes it (the same
 * blind spot core/simArchive.ts documents for the worker boundary). Measured on
 * a *season-1* save on the 626-club world, what one lineup drag wrote:
 *
 *     matchday  1 →   6.4 MB     structuredClone   32 ms
 *     matchday 10 →  63.0 MB                      350 ms
 *     matchday 19 → 113.1 MB                    1,091 ms
 *     matchday 28 → 162.3 MB                    1,430 ms
 *     matchday 38 → 216.6 MB                    2,653 ms
 *
 * on a fast desktop, before IndexedDB serialises a byte, against mobile's
 * documented 5-10x. Real player saves agree (season 47 mid-season: 166.7 MB,
 * 944 ms). Note what that table is NOT: it is not a save-age curve. `played`
 * scales with world size and how far into the season you are, so it hits a
 * season-2 player exactly as hard as a season-60 one, worsens every matchday
 * and vanishes at the rollover — which is why it reads as "slow on some
 * devices" rather than "slow on old saves".
 *
 * Split out, that same record is 12.5 MB / 117 ms, and a mutation writes **no
 * played rows at all** — see `playedToWrite` in leagueDb.ts for why the diff is
 * an append rather than the identity comparison players need.
 */
const DB_VERSION = 6;

/**
 * A league as it sits on disk.
 *
 * `players` is optional because both shapes exist: v2 records keep the pool in
 * the `players` store, while v1 records written before the split still carry it
 * inline until `loadLeague` next rewrites them. Nothing above the db layer sees
 * this — `loadLeague` reassembles a normal `LeagueStore` either way.
 */
/**
 * A player as he sits in the `players` store: everything except his career.
 *
 * `stats`/`hist` are optional rather than gone because both shapes exist on
 * disk — a v2/v3 row still carries them inline until `loadLeague` splits it, in
 * the same lazy way v1's inline pool was handled.
 */
export type StoredPlayer = Omit<Player, "stats" | "hist"> & {
  stats?: Player["stats"];
  hist?: Player["hist"];
};

/**
 * One club's custom badge: a row in `crests`, keyed `[lid, tid]`.
 *
 * Carries its own `tid` even though the key already holds it, so a `getAll`
 * over one league's range answers "which club" without a parallel
 * `getAllKeys` — the same convenience `retirees` gets for free from
 * `ArchivedPlayer.pid`.
 */
export interface StoredCrest {
  tid: number;
  /** A `data:image/...` URL. Validated on the way in; see core/teams/logoPack.ts. */
  image: string;
}

/** The half of a player that grows without bound: one row in `careers`. */
export interface PlayerCareer {
  stats: Player["stats"];
  hist: Player["hist"];
}

export type StoredLeague = Omit<LeagueStore, "players" | "retiredPlayers" | "played"> & {
  players?: Player[];
  /**
   * Same story again: v5-and-earlier records keep the season's matches inline,
   * while a v6 record keeps them in the `played` store. Note an *empty* inline
   * array still counts as inline — a save written in the offseason legitimately
   * has none, and `loadLeague` has to tell "not split yet" from "split, and
   * there are none" or it would rewrite itself on every load.
   */
  played?: PlayedMatch[];
  /**
   * Same story one field along: v3 records keep the archive in the `retirees`
   * store, while v1/v2 records still carry it inline until `loadLeague` next
   * rewrites them. Also absent on a save old enough to predate the archive.
   */
  retiredPlayers?: ArchivedPlayer[];
  /**
   * Bumped on every write. Lets `saveLeague` prove the pool on disk is still the
   * one it last wrote before trusting an incremental write — if another tab saved
   * in between, the counter will not match and it falls back to a full rewrite.
   * Absent on v1 records and on any league last written before this existed.
   */
  writeSeq?: number;
};

export interface SoccerGMDB extends DBSchema {
  leagues: {
    key: number;
    value: StoredLeague;
  };
  /**
   * One record per player, keyed `[lid, pid]`. The compound key is what makes a
   * league's pool a single range query, so no secondary index is needed.
   *
   * Since v4 this is identity only — `stats`/`hist` live in `careers`. They stay
   * optional on the type because v2/v3 rows still carry them inline until
   * `loadLeague` next rewrites them.
   */
  players: {
    key: [number, number];
    value: StoredPlayer;
  };
  /**
   * One player's career record, keyed `[lid, pid]` like the other two.
   *
   * Split from `players` rather than left on it because the two have completely
   * different read patterns and completely different sizes: identity is wanted
   * on every load and is 4.5 MB across a whole world, while the career is wanted
   * by a handful of cold surfaces and is 45.2 MB. Keeping them in one record
   * means a league's pool query drags ten times its own weight along with it,
   * which is what `docs/lazy-career-plan.md` phase 3 exists to stop.
   */
  careers: {
    key: [number, number];
    value: PlayerCareer;
  };
  /**
   * One record per archived retiree, keyed `[lid, pid]` exactly like `players`.
   *
   * Separate from `players` rather than sharing it: the two are read at
   * different times (the pool on every load, the archive only by the all-time
   * surfaces) and a shared store would make the pool's range query drag the
   * archive along with it.
   */
  retirees: {
    key: [number, number];
    value: ArchivedPlayer;
  };
  /**
   * One league match, keyed `[lid, matchIndex]`.
   *
   * The key's second element is the match's **position in `league.played`**,
   * not an id — the UI addresses matches by index (`/box-score/:idx`,
   * `/watch/:matchIndex`, Schedule's rows), so the array's order is itself
   * load-bearing state. IndexedDB compares array keys element-wise and numbers
   * numerically, so `[lid, 2]` really does sort below `[lid, 10]` and a
   * `getAll` over the range comes back in index order. `loadLeague` therefore
   * takes the rows as-is; density is an invariant `saveLeague` maintains by
   * falling back to a full rewrite the moment the array is anything but an
   * extension of what it last wrote.
   *
   * Rows per league are bounded by the season, not by save age: the offseason
   * sets `played` to `[]`, which lands here as one range delete a year.
   */
  played: {
    key: [number, number];
    value: PlayedMatch;
  };
  /**
   * One custom club badge, keyed `[lid, tid]` — the same out-of-line compound
   * key the other three use, so a league's whole set is one range query.
   *
   * Deliberately NOT a field on the league record. Crest art is a few megabytes
   * for a full world and the league record is rewritten in its entirety on every
   * save, so parking it there would re-serialise every badge each time the user
   * changed a lineup — the exact bug versions 2, 3 and 4 exist to undo. It is
   * also why nothing in `src/core` knows these exist: they are never read by the
   * sim, never cross the worker boundary and never touch an rng stream.
   */
  crests: {
    key: [number, number];
    value: StoredCrest;
  };
}

let dbPromise: Promise<IDBPDatabase<SoccerGMDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<SoccerGMDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SoccerGMDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("leagues")) {
          db.createObjectStore("leagues", {
            keyPath: "lid",
            autoIncrement: true,
          });
        }
        if (!db.objectStoreNames.contains("players")) {
          // No keyPath: the key is the out-of-line pair [lid, pid], which a
          // Player does not carry (it has no idea which save it belongs to).
          // Splitting existing v1 records is deliberately NOT done here —
          // loadLeague does it lazily, so the work is testable and a large
          // save can't stall a versionchange transaction on startup.
          db.createObjectStore("players");
        }
        if (!db.objectStoreNames.contains("retirees")) {
          // Same out-of-line `[lid, pid]` key as `players`, and split from the
          // league record lazily in loadLeague for the same reasons.
          db.createObjectStore("retirees");
        }
        if (!db.objectStoreNames.contains("crests")) {
          // Out-of-line `[lid, tid]`, like the rest. Nothing to migrate lazily
          // here, unlike the three above: a save written before this had no
          // custom badges at all, so an empty set is the truth rather than a
          // shape waiting to be split.
          db.createObjectStore("crests");
        }
        if (!db.objectStoreNames.contains("played")) {
          // Out-of-line `[lid, matchIndex]`, and split out of existing league
          // records lazily in loadLeague like every other store here — a
          // mid-season record carries ~10.5k matches and a versionchange
          // transaction is the worst possible place to move them.
          db.createObjectStore("played");
        }
        if (!db.objectStoreNames.contains("careers")) {
          // Same out-of-line `[lid, pid]` key again, and split out of the
          // existing player rows lazily in loadLeague — a season-60 save has
          // ~11k careers to move and a versionchange transaction is the worst
          // possible place to discover that.
          db.createObjectStore("careers");
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Reset the cached DB promise. Useful in tests to get a fresh connection.
 */
export function resetDb(): void {
  dbPromise = null;
}
