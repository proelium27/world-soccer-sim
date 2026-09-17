import type { LeagueStore } from "../core/leagueState.js";
import { isRosterFileFormat } from "../core/teams/rosterFile.js";
import {
  isImageDataUrl, MAX_LOGO_DATA_URL, MAX_LOGO_ENTRIES,
} from "../core/teams/logoPack.js";
import { migrateLeague } from "./migrate.js";
import { withMatchEvents } from "./leagueDb.js";

/**
 * The first two bytes of every gzip stream. Import sniffs for these rather than
 * trusting the file extension, so a save stays readable however it was renamed
 * on its way between two people.
 */
const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Serialize a league to the bytes the export button writes: compact JSON, gzipped.
 *
 * Both halves are pure size. The pretty-printed form this replaced was ~half
 * indentation whitespace and nothing ever read the file as formatted text, and
 * a league save is thousands of records repeating the same key names, which is
 * the shape gzip is best at. Measured on an 8-season save: 84 MB → 5.2 MB.
 *
 * Lossless, so this is not the "prune history to shrink the save" trade in open
 * design decision 6 — every byte survives the round trip.
 */
export async function encodeLeagueFile(
  league: LeagueStore,
  crests?: ReadonlyMap<number, string>,
): Promise<Uint8Array<ArrayBuffer>> {
  // Custom badges ride along as a sibling key rather than on the league itself.
  // They are stored in their own IndexedDB store precisely so they never join
  // `LeagueStore` (see src/db/database.ts) — but an export is a one-off write of
  // a file somebody carries to another browser, and a save that silently lost
  // its badges on the way would be worse than the bytes. Absent when there are
  // none, so a file from a save without them is byte-identical to before.
  const payload = crests && crests.size > 0
    ? { ...league, crests: [...crests].map(([tid, image]) => ({ tid, image })) }
    : league;
  const json = JSON.stringify(payload);
  const gzipped = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(gzipped).arrayBuffer());
}

/**
 * Read any file the game accepts as text, decompressing it if it's gzipped.
 *
 * Every reader of a picked file goes through here, so gzipped and plain files
 * are indistinguishable from that point on and back-compatibility costs the
 * callers nothing: saves exported before this shipped are plain JSON and still
 * load, and so do hand-written roster files, which are never compressed.
 */
export async function readLeagueFileText(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf);
  if (head[0] !== GZIP_MAGIC[0] || head[1] !== GZIP_MAGIC[1]) {
    return new TextDecoder().decode(buf);
  }
  const plain = new Blob([buf])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(plain).text();
}

/**
 * Serialize a league and trigger a browser file download.
 */
export async function exportLeagueJSON(
  league: LeagueStore,
  crests?: ReadonlyMap<number, string>,
): Promise<void> {
  // Never write an elided box score to a file — see `withMatchEvents`.
  const bytes = await encodeLeagueFile(await withMatchEvents(league), crests);
  const blob = new Blob([bytes], { type: "application/gzip" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `soccer-gm-league-${league.lid}.json.gz`;
  a.style.display = "none";

  document.body.appendChild(a);
  a.click();

  // Clean up
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** A save read back off disk: the league, plus any custom badges it carried. */
export interface ImportedLeague {
  league: LeagueStore;
  /** tid -> data URL. Empty for a file exported before badges existed, or from a save without them. */
  crests: Map<number, string>;
}

/**
 * Read a File, parse it as JSON, validate the shape, and return the league it
 * holds. Throws a descriptive error if validation fails.
 *
 * Returns the badges alongside rather than folding them in, because they are
 * not part of a `LeagueStore` and must not become part of one on the way
 * through — writing them onto the league record is the exact cost their own
 * store exists to avoid, and it would happen silently.
 */
export async function importLeagueJSON(file: File): Promise<ImportedLeague> {
  const text = await readLeagueFileText(file);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Failed to parse JSON from file "${file.name}": invalid JSON`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `Invalid league file "${file.name}": expected a JSON object`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  // The game reads two kinds of JSON and their files are easy to mix up: this
  // one takes a whole saved game (from Export Save), while a roster file (from
  // the AI prompt, or hand-written) starts a new league. Name that mistake
  // rather than reporting a missing "players" array.
  //
  // Reachable only from the New League screen's "Import League": the Leagues
  // page's Import button sniffs the same field first and routes a roster file
  // to the club picker, so it never gets here. isRosterFileFormat rather than a
  // bare equality check, so a file written before the format was renamed is
  // still recognized and still gets the helpful message.
  if (isRosterFileFormat(obj.format)) {
    throw new Error(
      `"${file.name}" is a roster file, not a saved game. To use it, go to the Leagues page and press "Import" — it starts a new league from the clubs in the file.`,
    );
  }

  // Validate required top-level fields
  const requiredArrays = ["teams", "players", "schedule", "played"] as const;
  for (const key of requiredArrays) {
    if (!Array.isArray(obj[key])) {
      throw new Error(
        `Invalid league file "${file.name}": missing or invalid "${key}" array`,
      );
    }
  }

  if (typeof obj.season !== "number") {
    throw new Error(
      `Invalid league file "${file.name}": missing or invalid "season" (expected number)`,
    );
  }

  if (obj.phase !== "regular" && obj.phase !== "offseason") {
    throw new Error(
      `Invalid league file "${file.name}": missing or invalid "phase" (expected "regular" or "offseason")`,
    );
  }

  if (typeof obj.meta !== "object" || obj.meta === null) {
    throw new Error(
      `Invalid league file "${file.name}": missing or invalid "meta" object`,
    );
  }

  const meta = obj.meta as Record<string, unknown>;
  if (typeof meta.name !== "string") {
    throw new Error(
      `Invalid league file "${file.name}": missing or invalid "meta.name" (expected string)`,
    );
  }
  if (typeof meta.created !== "number") {
    throw new Error(
      `Invalid league file "${file.name}": missing or invalid "meta.created" (expected number)`,
    );
  }
  if (typeof meta.userTid !== "number") {
    throw new Error(
      `Invalid league file "${file.name}": missing or invalid "meta.userTid" (expected number)`,
    );
  }

  // Pulled off BEFORE migrating, not after: `migrateLeague` hands back the
  // object it was given, so a `crests` key left on it would ride into the league
  // record on the next save and be re-serialised on every mutation from then on
  // — silently, and only for saves that had been through a file.
  const { crests: rawCrests, ...rest } = obj;
  return {
    league: dropElisionMarkers(migrateLeague(rest as unknown as LeagueStore)),
    crests: parseExportedCrests(rawCrests),
  };
}

/**
 * Strip any `eventsElided` marker off a league that came out of a file.
 *
 * `exportLeagueJSON` rehydrates before writing, so a file this game produced
 * carries none — this is for the ones it did not: a hand-edited file, or one
 * written by a build where the rehydrate failed or did not exist. The marker
 * means "the real events are on disk at this key", which is a claim about the
 * database it was elided from, and it is false the moment the save lands
 * anywhere else. Left in place, `saveLeague` would skip those rows for the life
 * of the imported save and its matches would never have a timeline again.
 *
 * Deliberately here rather than in `migrateLeague`, which every load also goes
 * through: `loadLeague` elides BEFORE migrating, so stripping there would
 * undo the elision on the spot and put every event straight back in memory.
 */
function dropElisionMarkers(league: LeagueStore): LeagueStore {
  if (!league.played.some((m) => m.boxScore.eventsElided)) return league;
  return {
    ...league,
    played: league.played.map((m) => {
      if (!m.boxScore.eventsElided) return m;
      const { eventsElided: _dropped, ...boxScore } = m.boxScore;
      return { ...m, boxScore };
    }),
  };
}

/**
 * Read the badge block off an exported save.
 *
 * Lenient where the pack parser is strict, and deliberately so: this is not a
 * file someone hand-wrote, it is a block this game emitted, and the failure it
 * has to survive is a *save* that is otherwise perfectly good. Refusing to load
 * a 60-season dynasty over a malformed badge would be the wrong trade, so a bad
 * entry is dropped and the league still opens.
 */
function parseExportedCrests(raw: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw.slice(0, MAX_LOGO_ENTRIES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { tid, image } = entry as Record<string, unknown>;
    if (typeof tid !== "number" || !Number.isFinite(tid)) continue;
    if (typeof image !== "string" || image.length > MAX_LOGO_DATA_URL) continue;
    // Checked here as well as at import, because a save file is a thing people
    // send each other and this string goes straight into an `<img src>`.
    if (!isImageDataUrl(image)) continue;
    out.set(tid, image);
  }
  return out;
}
