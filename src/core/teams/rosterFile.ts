import type { LeagueStore } from "../leagueState.js";
import type { TeamIdentityEdit } from "./customize.js";
import type { PlayerRatings, Position } from "../players/types.js";
import { POSITIONS, SKILL_KEYS } from "../players/types.js";
import { sanitizeNationalityWeights, type NationalityWeights } from "../players/nationalities.js";
import { worldCompetitions, MAX_DIVISIONS } from "../competitions.js";

/**
 * A compact, human/AI-authorable file describing clubs to overlay onto an
 * existing save's fixed world structure. Unlike the full-save export
 * (src/db/exportImport.ts, which round-trips the entire internal LeagueStore),
 * this format carries only what someone would want to hand-edit to bring their
 * own teams into the game — club identities and, optionally, squads — keyed by
 * which competition to overlay. Real-world leagues are the common case but not
 * the only one; nothing here assumes the clubs or players exist.
 *
 * It is deliberately partial-friendly: list only the competitions (and, within
 * one, only the leading clubs) you care about; every unlisted slot keeps its
 * existing identity and squad. Clubs map positionally onto a competition's
 * teams in the game's own stable order (the same order buildRosterFile emits),
 * so the intended workflow is "export a template, edit it, re-import".
 *
 * `players` is optional per club and opt-in: omit it and only the club's
 * identity (name/abbrev/colors) changes, leaving its auto-generated squad
 * intact. Provide it and that club's squad is replaced by the listed players
 * (topped up with filler to a legal squad — see src/core/teams/rosterImport.ts).
 * buildRosterFile deliberately emits identities only, so a plain
 * export-edit-reimport to rename a club never disturbs any roster.
 */
export interface RosterFilePlayer {
  name: string;
  pos: Position;
  age: number;
  nationality?: string;
  heightCm?: number;
  /** Optional peak-ability hint; defaults to a scouted estimate. Clamped to >= overall. */
  potential?: number;
  /**
   * Target overall (0-100). The game synthesizes position-appropriate ratings
   * scaled to hit it. Ignored if `ratings` is also given.
   */
  overall?: number;
  /** Exact per-skill ratings. Takes precedence over `overall` when both are present. */
  ratings?: PlayerRatings;
}

export interface RosterFileClub {
  name: string;
  abbrev: string;
  colors: [string, string];
  /** Optional real squad. Omit to keep the club's existing auto-generated roster. */
  players?: RosterFilePlayer[];
}

export interface RosterFileCompetition {
  /**
   * The name of the competition to overlay (e.g. "English Division 1"), matched
   * case-insensitively against league.competitions.
   *
   * A name is a WEAK identifier, because division names are the player's to
   * change: someone who renames England's top flight to "Premier League" would
   * otherwise find every file written for "English Division 1" silently
   * skipped. So a name matching nothing falls back to the country and tier it
   * describes — see competitionRef and resolveRosterSlots.
   */
  match: string;
  /**
   * Which country's league this is, as the game names it ("England",
   * "Netherlands"). Optional, and the STRONGEST identifier of the three: a
   * shipped country's name is fixed and unrenameable, so a file that states one
   * keeps landing however the divisions are renamed. Absent, it is derived from
   * `match` where that reads as a division name.
   */
  country?: string;
  /** Which division of `country`: 1 = top flight, 2 = second, 3 = third. Defaults to 1. */
  tier?: number;
  /** Clubs in slot order; up to the competition's team count. Extra entries are ignored (with a warning). */
  clubs: RosterFileClub[];
}

export interface RosterFile {
  format: RosterFileFormat;
  formatVersion: 1;
  competitions: RosterFileCompetition[];
  /**
   * The nationality mix the league this file describes should generate, as
   * relative weights (nation name -> number, plus "__REST__" for the combined
   * rest of the world). Optional; absent leaves the league on whatever it
   * already had.
   *
   * Top level rather than per competition, because a mix belongs to a league as
   * a whole: `competitions` entries are its individual DIVISIONS, and letting a
   * country's two tiers declare different nationalities would be meaningless.
   *
   * Note this does not touch the players the file itself lists — those carry
   * their own `nationality`. It sets what the league generates *around* them:
   * the filler that tops a short squad up to a legal shape, any listed player
   * who omitted a nationality, and every youth intake from then on.
   */
  nationalities?: NationalityWeights;
}

/** What newly written roster files declare. */
export const ROSTER_FILE_FORMAT = "world-soccer-sim-roster";

/**
 * Format strings still accepted on read. `soccer-gm-roster` was what the format
 * announced itself as before the game settled on its name, and files carrying
 * it are already in people's hands — including every file the EA FC converter
 * has produced so far — so it is read forever. Only the value written changes.
 */
export const LEGACY_ROSTER_FILE_FORMATS = ["soccer-gm-roster"] as const;

export type RosterFileFormat =
  | typeof ROSTER_FILE_FORMAT
  | (typeof LEGACY_ROSTER_FILE_FORMATS)[number];

export const ROSTER_FILE_VERSION = 1;

/**
 * Is this a roster file's format string? Shared by the parser and by the
 * Leagues page's Import button, which sniffs the same field to tell a roster
 * file from an exported save — the two must agree on what counts, or a file the
 * parser would happily read gets routed as a save.
 */
export function isRosterFileFormat(value: unknown): value is RosterFileFormat {
  return (
    value === ROSTER_FILE_FORMAT ||
    (LEGACY_ROSTER_FILE_FORMATS as readonly unknown[]).includes(value)
  );
}

/**
 * The parts of a world that decide which club slot a file entry lands on. A
 * LeagueStore satisfies this structurally, and so does the slot layout of a
 * save that hasn't been generated yet (see worldTeamSlots in competitions.ts) —
 * which is what lets the new-league importer show real club names in its picker
 * without generating a world first.
 */
export interface RosterSlotWorld {
  competitions: { id: number; name: string; country: string; tier: number }[];
  teams: { tid: number; compId: number }[];
}

/** Which league a file competition claims, independent of what it is called. */
export interface CompetitionRef {
  country: string;
  tier: number;
}

const normName = (s: string) => s.trim().toLowerCase();
const refKey = (country: string, tier: number) => `${normName(country)}\0${tier}`;

/**
 * The shipped competitions' own names, read back as the country and tier they
 * stand for ("english division 1" -> England, tier 1).
 *
 * Built from worldCompetitions() rather than from a hand-written demonym table,
 * so the two cannot drift: every name the game has ever shipped a league under
 * is by construction in here, and adding a country puts its name in for free.
 * Lazily built and cached — the table is a pure constant, and resolving a
 * roster file is on the new-league render path.
 */
let shippedRefsCache: Map<string, CompetitionRef> | null = null;
function shippedNameRefs(): Map<string, CompetitionRef> {
  if (!shippedRefsCache) {
    shippedRefsCache = new Map(
      worldCompetitions().map((c) => [normName(c.name), { country: c.country, tier: c.tier }]),
    );
  }
  return shippedRefsCache;
}

/**
 * Read a competition NAME back as the league it describes, so a file written
 * for a division that has since been renamed can still find it.
 *
 * Two forms are understood, and between them they cover every name the game
 * itself has ever put on a division:
 *
 *  - a shipped competition's name, whose country is a demonym rather than the
 *    country ("Dutch Division 1" is the Netherlands', "English Division 2"
 *    England's). Resolved through the shipped table above.
 *  - "<country> Division <n>", which is what a league the player ADDS is called
 *    until they name it something else.
 *
 * Anything else — a real-world name like "Eredivisie", or an invented one —
 * returns null and is left to match by name alone, which is right: nothing in
 * the string says which country it belongs to. That is what the optional
 * `country` field on a file competition is for.
 */
export function competitionRefFromName(name: string): CompetitionRef | null {
  const shipped = shippedNameRefs().get(normName(name));
  if (shipped) return shipped;
  const m = /^(.+?)\s+division\s+([12])$/i.exec(name.trim());
  return m ? { country: m[1]!.trim(), tier: Number(m[2]) } : null;
}

/**
 * Which league a file competition claims, preferring what it says outright over
 * what its name implies.
 */
export function competitionRef(comp: RosterFileCompetition): CompetitionRef | null {
  if (comp.country && comp.country.trim() !== "") {
    return { country: comp.country, tier: comp.tier ?? 1 };
  }
  return competitionRefFromName(comp.match);
}

/** The competition's teams, in the game's stable slot order (ascending tid). */
function teamsInCompetition(world: RosterSlotWorld, compId: number) {
  return world.teams
    .filter((t) => t.compId === compId)
    .sort((a, b) => a.tid - b.tid);
}

/**
 * Serialize a save's current club identities to a roster file — one entry per
 * competition (in the competitions-table order), each listing its clubs in
 * slot order. It emits identities only (no `players`): the template's job is to
 * show the club/slot structure to rename, and exporting the fictional squads
 * would (a) bloat the file and (b) make a rename-only round-trip destructively
 * replace rosters.
 *
 * NOTE: no longer reachable from the UI. It backed the Leagues page's "Export
 * Teams" button, which was replaced by "Export Save" (2026-08-10, user call),
 * so nothing in the app calls it and Vite drops it from the bundle. Kept
 * because it is the roster format's writer — the counterpart to
 * parseRosterFile, still covered by rosterFile.test.ts, and the shape any
 * future template export would emit. Delete it only alongside the format.
 */
export function buildRosterFile(league: LeagueStore): RosterFile {
  return {
    format: ROSTER_FILE_FORMAT,
    formatVersion: ROSTER_FILE_VERSION,
    competitions: league.competitions.map((comp) => ({
      match: comp.name,
      // Stated outright as well as named, so a template survives the divisions
      // being renamed after it was exported — the name is the label, the
      // country and tier are the address.
      country: comp.country,
      tier: comp.tier,
      // Same filter/sort as teamsInCompetition, but over the full StoredTeams —
      // the template needs each club's identity, not just its slot.
      clubs: league.teams
        .filter((t) => t.compId === comp.id)
        .sort((a, b) => a.tid - b.tid)
        .map((t) => ({
          name: t.name,
          abbrev: t.abbrev,
          colors: [...t.colors] as [string, string],
        })),
    })),
  };
}

function parsePlayer(raw: unknown, path: string): RosterFilePlayer {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid roster file: ${path} must be an object.`);
  }
  const p = raw as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name.trim() === "") {
    throw new Error(`Invalid roster file: ${path}.name must be a non-empty string.`);
  }
  if (typeof p.pos !== "string" || !(POSITIONS as readonly string[]).includes(p.pos)) {
    throw new Error(`Invalid roster file: ${path}.pos must be one of ${POSITIONS.join(", ")}.`);
  }
  if (typeof p.age !== "number" || !Number.isFinite(p.age) || p.age < 15 || p.age > 45) {
    throw new Error(`Invalid roster file: ${path}.age must be a number between 15 and 45.`);
  }
  const hasRatings = p.ratings !== undefined;
  const hasOverall = p.overall !== undefined;
  if (!hasRatings && !hasOverall) {
    throw new Error(`Invalid roster file: ${path} must have either "overall" or "ratings".`);
  }
  let ratings: PlayerRatings | undefined;
  if (hasRatings) {
    if (typeof p.ratings !== "object" || p.ratings === null) {
      throw new Error(`Invalid roster file: ${path}.ratings must be an object of skill ratings.`);
    }
    const r = p.ratings as Record<string, unknown>;
    for (const key of SKILL_KEYS) {
      if (typeof r[key] !== "number" || !Number.isFinite(r[key])) {
        throw new Error(`Invalid roster file: ${path}.ratings.${key} must be a number.`);
      }
    }
    ratings = Object.fromEntries(SKILL_KEYS.map((k) => [k, r[k] as number])) as PlayerRatings;
  }
  let overall: number | undefined;
  if (hasOverall) {
    if (typeof p.overall !== "number" || !Number.isFinite(p.overall)) {
      throw new Error(`Invalid roster file: ${path}.overall must be a number.`);
    }
    overall = p.overall;
  }
  if (p.nationality !== undefined && typeof p.nationality !== "string") {
    throw new Error(`Invalid roster file: ${path}.nationality must be a string.`);
  }
  if (p.heightCm !== undefined && (typeof p.heightCm !== "number" || !Number.isFinite(p.heightCm))) {
    throw new Error(`Invalid roster file: ${path}.heightCm must be a number.`);
  }
  if (p.potential !== undefined && (typeof p.potential !== "number" || !Number.isFinite(p.potential))) {
    throw new Error(`Invalid roster file: ${path}.potential must be a number.`);
  }
  return {
    name: p.name,
    pos: p.pos as Position,
    age: p.age,
    nationality: p.nationality as string | undefined,
    heightCm: p.heightCm as number | undefined,
    potential: p.potential as number | undefined,
    overall,
    ratings,
  };
}

/**
 * Parse and structurally validate raw file text as a RosterFile. Throws a
 * descriptive error (naming the offending path) on any malformed field, so the
 * UI can surface exactly what's wrong rather than half-loading a bad file.
 */
export function parseRosterFile(text: string): RosterFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid roster file: not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid roster file: expected a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (!isRosterFileFormat(obj.format)) {
    throw new Error(
      `Invalid roster file: "format" must be "${ROSTER_FILE_FORMAT}" (got ${JSON.stringify(obj.format)}).`,
    );
  }
  if (obj.formatVersion !== ROSTER_FILE_VERSION) {
    throw new Error(
      `Unsupported roster file version ${JSON.stringify(obj.formatVersion)}: this game reads version ${ROSTER_FILE_VERSION}.`,
    );
  }
  if (!Array.isArray(obj.competitions)) {
    throw new Error(`Invalid roster file: "competitions" must be an array.`);
  }

  const competitions: RosterFileCompetition[] = obj.competitions.map((c, ci) => {
    if (typeof c !== "object" || c === null) {
      throw new Error(`Invalid roster file: competitions[${ci}] must be an object.`);
    }
    const comp = c as Record<string, unknown>;
    if (typeof comp.match !== "string" || comp.match.trim() === "") {
      throw new Error(`Invalid roster file: competitions[${ci}].match must be a non-empty string.`);
    }
    if (
      comp.country !== undefined
      && (typeof comp.country !== "string" || comp.country.trim() === "")
    ) {
      throw new Error(`Invalid roster file: competitions[${ci}].country must be a non-empty string.`);
    }
    if (comp.tier !== undefined
      && (typeof comp.tier !== "number" || !Number.isInteger(comp.tier)
        || comp.tier < 1 || comp.tier > MAX_DIVISIONS)) {
      throw new Error(
        `Invalid roster file: competitions[${ci}].tier must be 1 to ${MAX_DIVISIONS}.`,
      );
    }
    if (!Array.isArray(comp.clubs)) {
      throw new Error(`Invalid roster file: competitions[${ci}].clubs must be an array.`);
    }
    const clubs: RosterFileClub[] = comp.clubs.map((raw, ki) => {
      const path = `competitions[${ci}].clubs[${ki}]`;
      if (typeof raw !== "object" || raw === null) {
        throw new Error(`Invalid roster file: ${path} must be an object.`);
      }
      const club = raw as Record<string, unknown>;
      if (typeof club.name !== "string" || club.name.trim() === "") {
        throw new Error(`Invalid roster file: ${path}.name must be a non-empty string.`);
      }
      if (typeof club.abbrev !== "string" || club.abbrev.trim() === "") {
        throw new Error(`Invalid roster file: ${path}.abbrev must be a non-empty string.`);
      }
      if (
        !Array.isArray(club.colors) ||
        club.colors.length !== 2 ||
        !club.colors.every((x) => typeof x === "string")
      ) {
        throw new Error(`Invalid roster file: ${path}.colors must be an array of two color strings.`);
      }
      let players: RosterFilePlayer[] | undefined;
      if (club.players !== undefined) {
        if (!Array.isArray(club.players)) {
          throw new Error(`Invalid roster file: ${path}.players must be an array.`);
        }
        players = club.players.map((pr, pi) => parsePlayer(pr, `${path}.players[${pi}]`));
      }
      return {
        name: club.name,
        abbrev: club.abbrev,
        colors: [club.colors[0], club.colors[1]] as [string, string],
        players,
      };
    });
    return {
      match: comp.match,
      // Absent stays absent rather than being filled in from the name here:
      // resolveRosterSlots derives it when it needs it, and a parsed file that
      // invented a country would then state one it was never given.
      ...(comp.country !== undefined ? { country: comp.country as string } : {}),
      ...(comp.tier !== undefined ? { tier: comp.tier as number } : {}),
      clubs,
    };
  });

  const nationalities = parseNationalities(obj.nationalities);

  return {
    format: ROSTER_FILE_FORMAT,
    formatVersion: ROSTER_FILE_VERSION,
    competitions,
    ...(nationalities ? { nationalities } : {}),
  };
}

/**
 * Read the optional top-level nationality block.
 *
 * Deliberately strict about SHAPE (a wrong type is an authoring mistake worth
 * reporting) and lenient about CONTENT: an unknown nation name is dropped
 * rather than thrown, because these files are usually AI-written and one
 * hallucinated country shouldn't cost the author the other forty that were
 * right. What survives is whatever sanitizeNationalityWeights accepts — every
 * nation the game has names and a flag for.
 */
function parseNationalities(raw: unknown): NationalityWeights | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid roster file: "nationalities" must be an object of nation -> number.`);
  }
  const out: NationalityWeights = {};
  for (const [nation, weight] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new Error(
        `Invalid roster file: nationalities["${nation}"] must be a number (got ${JSON.stringify(weight)}).`,
      );
    }
    out[nation] = weight;
  }
  return sanitizeNationalityWeights(out) ?? undefined;
}

/** A parsed roster file with the name the user picked it by. */
export interface NamedRosterFile {
  name: string;
  file: RosterFile;
}

export interface CombinedRosterFile {
  file: RosterFile;
  /** Non-fatal issues (the same competition listed twice) worth showing the user. */
  warnings: string[];
}

/**
 * Point a roster file's competitions at one specific league's divisions,
 * whatever the file itself calls them.
 *
 * A file normally names the competition it belongs to ("English Division 1"),
 * which is right when someone is dressing an existing world. It is exactly
 * wrong when the file is being loaded *into* a league the player has just
 * invented: that league's divisions did not exist when the file was written, so
 * nothing in it can name them, and `resolveRosterSlots` would skip every
 * competition as unrecognised.
 *
 * Competitions are taken **in the file's own order** onto the divisions given,
 * top tier first — the same positional rule clubs already follow onto slots. A
 * one-competition file therefore fills the top division and leaves the second
 * alone, which is the common case.
 */
export function retargetRosterFile(
  file: RosterFile,
  divisionNames: string[],
): CombinedRosterFile {
  const warnings: string[] = [];
  const competitions: RosterFileCompetition[] = [];

  file.competitions.forEach((comp, i) => {
    const match = divisionNames[i];
    if (match === undefined) {
      warnings.push(
        `"${comp.match}" was left out: this league has ${divisionNames.length} `
        + `${divisionNames.length === 1 ? "division" : "divisions"} and the file lists more.`,
      );
      return;
    }
    // Any country/tier the file states is DROPPED, not carried over. It is the
    // strongest identifier resolveRosterSlots has, so leaving a file's original
    // "England, tier 1" on an entry now aimed at Neverland's top flight would
    // send it back to England — the exact opposite of retargeting.
    const { country: _country, tier: _tier, ...rest } = comp;
    competitions.push({ ...rest, match });
  });

  // `...file` carries the top-level nationality block through unchanged:
  // retargeting renames which divisions the file points at, not what the
  // league it describes should generate.
  return { file: { ...file, competitions }, warnings };
}

/**
 * Fold several roster files into the single one the importer applies.
 *
 * Authoring a whole world in one file is impractical when squads are involved
 * — an AI answer covering twelve competitions runs to megabytes — so the normal
 * workflow is a file per league. Each file names the competitions it covers, and
 * competitions are independent of each other, so combining them is just
 * concatenation in load order.
 *
 * The one ambiguous case is two files claiming the same competition: clubs map
 * *positionally* onto slots, so their club lists can't be interleaved into
 * anything meaningful. The later file wins outright (it is the one the user
 * picked most recently, so it is likely the redo) and the collision is reported
 * rather than silently resolved.
 */
export function combineRosterFiles(files: NamedRosterFile[]): CombinedRosterFile {
  const byMatch = new Map<string, { comp: RosterFileCompetition; from: string }>();
  const order: string[] = [];
  const warnings: string[] = [];

  for (const { name, file } of files) {
    for (const comp of file.competitions) {
      const key = comp.match.trim().toLowerCase();
      const existing = byMatch.get(key);
      if (existing) {
        warnings.push(
          `"${comp.match}" is listed in both ${existing.from} and ${name}, so the one from ${name} was used.`,
        );
      } else {
        order.push(key);
      }
      byMatch.set(key, { comp, from: name });
    }
  }

  return {
    file: {
      format: ROSTER_FILE_FORMAT,
      formatVersion: ROSTER_FILE_VERSION,
      competitions: order.map((key) => byMatch.get(key)!.comp),
    },
    warnings,
  };
}

/** One resolved file club paired with the save tid it maps onto. */
export interface RosterSlot {
  tid: number;
  club: RosterFileClub;
}

export interface RosterSlotResolution {
  slots: RosterSlot[];
  /** Non-fatal issues (unmatched competition, more clubs than slots) worth showing the user. */
  warnings: string[];
}

/**
 * Resolve every file club to the save tid it overlays. Its clubs then map
 * positionally onto that competition's teams in slot order. Anything that can't
 * be mapped cleanly becomes a warning rather than an error, so a mostly-good
 * file still applies what it can. Shared by both the identity-edit path and the
 * roster-replacement path so the "which club goes where" rule lives once.
 *
 * **A file competition is matched three ways, most authoritative first**, and
 * the order is what makes a renamed division still importable:
 *
 *  1. an explicit `country`/`tier` on the file entry. A shipped country's name
 *     is fixed — the player can rename its divisions but not the country — so
 *     this is the one identifier nothing in World setup can invalidate.
 *  2. the competition's NAME, case-insensitively. Still first among the two
 *     name-shaped routes: if the world really does have a division called that,
 *     that is the division the file meant.
 *  3. the country and tier its name DESCRIBES (competitionRefFromName). This is
 *     what carries an untouched file — including every one the EA FC converter
 *     has ever written, which names competitions "English Division 1" — onto a
 *     league the player has since renamed to "Premier League".
 *
 * Each competition can be claimed once. Two entries landing on the same
 * division would otherwise both write their clubs onto the same slots, with the
 * later one silently winning; the first claim holds and the collision is
 * reported, since it now takes two *different* names to collide.
 */
export function resolveRosterSlots(world: RosterSlotWorld, file: RosterFile): RosterSlotResolution {
  const byName = new Map(world.competitions.map((c) => [normName(c.name), c.id]));
  const byRef = new Map(world.competitions.map((c) => [refKey(c.country, c.tier), c.id]));
  const claimedBy = new Map<number, string>();
  const slots: RosterSlot[] = [];
  const warnings: string[] = [];

  const idFor = (ref: CompetitionRef | null) =>
    ref ? byRef.get(refKey(ref.country, ref.tier)) : undefined;

  for (const fc of file.competitions) {
    const stated = fc.country && fc.country.trim() !== ""
      ? { country: fc.country, tier: fc.tier ?? 1 }
      : null;
    const compId =
      idFor(stated)
      ?? byName.get(normName(fc.match))
      ?? idFor(competitionRefFromName(fc.match));
    if (compId === undefined) {
      warnings.push(`No competition named "${fc.match}" in this save — skipped.`);
      continue;
    }
    const claimed = claimedBy.get(compId);
    if (claimed !== undefined) {
      warnings.push(
        `"${fc.match}" and "${claimed}" both point at the same division, so only "${claimed}" was used.`,
      );
      continue;
    }
    claimedBy.set(compId, fc.match);
    const targets = teamsInCompetition(world, compId);
    if (fc.clubs.length > targets.length) {
      warnings.push(
        `"${fc.match}" lists ${fc.clubs.length} clubs but has ${targets.length} slots — the extra ${fc.clubs.length - targets.length} were ignored.`,
      );
    }
    const count = Math.min(fc.clubs.length, targets.length);
    for (let i = 0; i < count; i++) {
      slots.push({ tid: targets[i].tid, club: fc.clubs[i] });
    }
  }

  return { slots, warnings };
}

export interface RosterFileEdits {
  edits: TeamIdentityEdit[];
  /** Non-fatal issues (unmatched competition, more clubs than slots) worth showing the user. */
  warnings: string[];
}

/**
 * Map a parsed roster file to the identity edits to feed applyTeamIdentities
 * (names/abbrevs/colors only — squads are handled separately by
 * applyRosterFile in src/core/teams/rosterImport.ts).
 */
export function rosterFileToEdits(league: LeagueStore, file: RosterFile): RosterFileEdits {
  const { slots, warnings } = resolveRosterSlots(league, file);
  const edits: TeamIdentityEdit[] = slots.map(({ tid, club }) => ({
    tid,
    name: club.name,
    abbrev: club.abbrev,
    colors: club.colors,
  }));
  return { edits, warnings };
}
