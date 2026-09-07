/**
 * EA FC player CSV -> a soccer-gm roster file.
 *
 * Pipeline, in order:
 *   1. detect the file's columns (see schema.ts — the exports disagree wildly)
 *   2. keep only rows in the sixteen leagues this converter covers, mapping each
 *      row's EA position onto one of soccer-gm's eight roles (the game itself
 *      models sixteen — Belgium and Turkey have no rules yet, see leagues.ts)
 *   3. rank each league's clubs by squad strength and keep the top 20 (the
 *      game has exactly 20 slots per competition)
 *   4. pick each club a squad shaped like ROSTER_COMPOSITION
 *   5. rank-match EA overalls onto a freshly generated world's OVR
 *      distribution (see scale.ts — this is the anti-inflation step)
 *   6. build each player's per-skill ratings from his EA attributes and shift
 *      them to land on his rescaled overall
 *
 * The output is a plain roster file, loaded through the game's existing import
 * UI — no engine changes, and nothing EA-derived is committed to the repo.
 */
import { readCsvTable } from "./csv.js";
import { resolveColumns, num, str, type ResolvedColumns } from "./schema.js";
import { mapPosition } from "./positions.js";
import { buildLeagueResolver } from "./leagues.js";
import { mapNation } from "./nations.js";
import { ratingShapeFromEa, applySpread, shiftToOverall } from "./ratings.js";
import { buildRescaler, type Rescaler } from "./scale.js";
import { deriveColors, uniquifyAbbrevs, type IdentityOverrides } from "./identity.js";

import type { Position } from "../../src/core/players/types.js";
import { POSITIONS } from "../../src/core/players/types.js";
import { HEIGHT_RANGES } from "../../src/core/players/templates.js";
import { computeOvr } from "../../src/core/players/ovr.js";
import { ROSTER_COMPOSITION, NUM_TEAMS, RATING_MIN, RATING_MAX } from "../../src/core/constants.js";
import { worldCompetitions, competitionTeamCount } from "../../src/core/competitions.js";
import { generateWorld } from "../../src/core/league/generate.js";
import { mulberry32 } from "../../src/engine/rng.js";
import type {
  RosterFile, RosterFileClub, RosterFileCompetition, RosterFilePlayer,
} from "../../src/core/teams/rosterFile.js";
import { ROSTER_FILE_FORMAT, ROSTER_FILE_VERSION } from "../../src/core/teams/rosterFile.js";

export interface ConvertOptions {
  /** Players per club before the game tops the squad up with filler. */
  squadSize: number;
  /** Multiplier on each player's spread of skills around his own mean (1 = keep EA's). */
  spread: number;
  /**
   * "competition" rank-matches each league onto its own soccer-gm counterpart;
   * "global" pools all sixteen. See the note on scaleMode in the CLI help — the
   * default preserves the game's designed country-strength gaps.
   */
  scaleMode: "competition" | "global";
  /** Seed for the reference world whose OVR distribution we match onto. */
  referenceSeed: number;
  /** Per-club abbrev/colors/name overrides, keyed by the club name in the CSV. */
  identityOverrides: IdentityOverrides;
  /**
   * Cap on clubs taken per competition. Undefined means "ask the competition",
   * which is the only correct answer since divisions gained real sizes: the
   * game fields 20 in England, 18 in Germany, 16 in Belgium, 14 in Greece, 12
   * in Scotland and 10 in Scotland's second tier. A flat cap either overfills
   * a small league (the importer then ignores the extras, so the clubs it drops
   * are chosen by slot order rather than by strength) or truncates a big one.
   * Set it only to override every competition at once.
   */
  clubsPerCompetition?: number;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  squadSize: 25,
  spread: 1,
  scaleMode: "competition",
  referenceSeed: 12345,
  identityOverrides: {},
  clubsPerCompetition: undefined,
};

interface EaPlayer {
  name: string;
  pos: Position;
  age: number;
  clubName: string;
  competition: string;
  eaOverall: number;
  eaPotential?: number;
  nationality?: string;
  heightCm: number;
  row: Record<string, string>;
}

export interface ConvertReport {
  rowsRead: number;
  rowsKept: number;
  skipped: {
    unmappedLeague: number;
    unmappedPosition: number;
    missingOverall: number;
    missingClub: number;
    missingName: number;
    unparseableAge: number;
  };
  /** League cells seen that mapped to nothing, with counts — surfaces naming drift. */
  unmappedLeagues: { league: string; rows: number }[];
  /**
   * League names covering more than one league id (e.g. Germany's and
   * Austria's "Bundesliga"). Rows under an id we don't recognise are dropped
   * rather than guessed at, so these are worth showing.
   */
  ambiguousLeagues: { name: string; ids: string[] }[];
  competitions: {
    name: string;
    clubsAvailable: number;
    clubsUsed: number;
    playersEmitted: number;
    /** A few (EA overall -> soccer-gm overall) pairs so the rescale is inspectable. */
    scaleSamples: { ea: number; gm: number }[];
  }[];
  missingColumns: string[];
  warnings: string[];
}

/**
 * Fraction of a competition's slots the source must fill before its players are
 * rank-matched against that competition's own OVR band rather than the pooled
 * world. See wellCovered — 0.75 clears every league FC26 actually carries
 * (England's second tier is the thinnest at 20 of 24) and catches Greece, which
 * it holds 4 of 14 of.
 */
export const PARTIAL_LEAGUE_COVERAGE = 0.75;

const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));

function defaultHeight(pos: Position): number {
  const [lo, hi] = HEIGHT_RANGES[pos];
  return Math.round((lo + hi) / 2);
}

/** Parse every usable row into an EaPlayer, tallying why the rest were dropped. */
function readPlayers(
  rows: Record<string, string>[],
  cols: ResolvedColumns,
): {
  players: EaPlayer[];
  report: Pick<ConvertReport, "skipped" | "unmappedLeagues" | "ambiguousLeagues">;
} {
  const skipped: ConvertReport["skipped"] = {
    unmappedLeague: 0, unmappedPosition: 0, missingOverall: 0,
    missingClub: 0, missingName: 0, unparseableAge: 0,
  };
  const unmapped = new Map<string, number>();
  const players: EaPlayer[] = [];

  // League ids beat names: several federations share a league name, and the
  // exports drop the country prefix that would tell them apart.
  const resolver = buildLeagueResolver(
    rows.map((row) => ({ name: str(row, cols, "league"), id: str(row, cols, "league_id") })),
  );

  for (const row of rows) {
    const leagueRaw = str(row, cols, "league");
    const competition = resolver.resolve(leagueRaw, str(row, cols, "league_id"));
    if (competition === null) {
      skipped.unmappedLeague++;
      if (leagueRaw) unmapped.set(leagueRaw, (unmapped.get(leagueRaw) ?? 0) + 1);
      continue;
    }
    const pos = mapPosition(str(row, cols, "position"));
    if (pos === null) { skipped.unmappedPosition++; continue; }

    const name = str(row, cols, "name");
    if (!name) { skipped.missingName++; continue; }

    const clubName = str(row, cols, "club");
    if (!clubName) { skipped.missingClub++; continue; }

    const eaOverall = num(row, cols, "overall");
    if (eaOverall === undefined) { skipped.missingOverall++; continue; }

    const age = num(row, cols, "age");
    // The game's own parser rejects ages outside 15-45, so clamp rather than
    // emit a file it will refuse.
    if (age === undefined) { skipped.unparseableAge++; continue; }

    players.push({
      name,
      pos,
      age: clampInt(age, 15, 45),
      clubName,
      competition,
      eaOverall,
      eaPotential: num(row, cols, "potential"),
      nationality: mapNation(str(row, cols, "nationality")),
      heightCm: clampInt(num(row, cols, "height") ?? defaultHeight(pos), 150, 220),
      row,
    });
  }

  const unmappedLeagues = [...unmapped]
    .map(([league, rows]) => ({ league, rows }))
    .sort((a, b) => b.rows - a.rows);

  return { players, report: { skipped, unmappedLeagues, ambiguousLeagues: resolver.ambiguous } };
}

/**
 * Pick a club's squad: the best players at each position up to
 * ROSTER_COMPOSITION, then the best remaining regardless of position until
 * `squadSize`. Shaping by position matters — taking the flat top 25 by overall
 * can leave a club with one goalkeeper and seven strikers, and while the game's
 * importer would paper over that with filler, the filler is deliberately weak
 * and would end up in the XI.
 */
export function pickSquad(players: EaPlayer[], squadSize: number): EaPlayer[] {
  const byPos = new Map<Position, EaPlayer[]>();
  for (const p of players) {
    if (!byPos.has(p.pos)) byPos.set(p.pos, []);
    byPos.get(p.pos)!.push(p);
  }
  for (const list of byPos.values()) list.sort((a, b) => b.eaOverall - a.eaOverall);

  const picked: EaPlayer[] = [];
  const used = new Set<EaPlayer>();
  for (const pos of POSITIONS as readonly Position[]) {
    for (const p of (byPos.get(pos) ?? []).slice(0, ROSTER_COMPOSITION[pos])) {
      picked.push(p);
      used.add(p);
    }
  }
  if (picked.length < squadSize) {
    const rest = players
      .filter((p) => !used.has(p))
      .sort((a, b) => b.eaOverall - a.eaOverall)
      .slice(0, squadSize - picked.length);
    picked.push(...rest);
  }
  return picked.slice(0, squadSize);
}

/** Squad strength used to rank clubs for the 20 available slots. */
function clubStrength(players: EaPlayer[]): number {
  const top = [...players].sort((a, b) => b.eaOverall - a.eaOverall).slice(0, 11);
  if (top.length === 0) return 0;
  return top.reduce((a, p) => a + p.eaOverall, 0) / top.length;
}

interface ReferenceDistribution {
  byCompetition: Map<string, number[]>;
  all: number[];
  /**
   * Potentials get their own distribution, and therefore their own curve.
   * Pushing EA potentials through the *overall* curve was measurably wrong:
   * a 94-potential teenager sits above every current overall in the source, so
   * he clamped to the top of the overall range and every wonderkid in the world
   * came out with the same ceiling. Potential is display-only in this game
   * (progression never reads it — it's a scout estimate), but flattening it
   * loses the one number that tells you who is worth developing.
   */
  potentialByCompetition: Map<string, number[]>;
  allPotential: number[];
}

/**
 * Generating the 240-club reference world costs ~4s, and it depends on nothing
 * but the seed, so it is memoized — converting twice in one process (the tests
 * do) should not pay for it twice.
 */
const referenceCache = new Map<number, ReferenceDistribution>();

/** OVR distribution of a freshly generated world, per competition name and pooled. */
function referenceDistribution(seed: number): ReferenceDistribution {
  const cached = referenceCache.get(seed);
  if (cached) return cached;
  const world = generateWorld(mulberry32(seed), seed);
  const comps = worldCompetitions();
  const nameById = new Map(comps.map((c) => [c.id, c.name]));
  const byPid = new Map(world.players.map((p) => [p.pid, p]));
  const byCompetition = new Map<string, number[]>();
  const potentialByCompetition = new Map<string, number[]>();
  for (const t of world.teams) {
    const name = nameById.get(t.compId);
    if (!name) continue;
    if (!byCompetition.has(name)) byCompetition.set(name, []);
    if (!potentialByCompetition.has(name)) potentialByCompetition.set(name, []);
    for (const pid of t.roster) {
      const p = byPid.get(pid)!;
      byCompetition.get(name)!.push(p.ovr);
      potentialByCompetition.get(name)!.push(p.potential);
    }
  }
  const dist: ReferenceDistribution = {
    byCompetition,
    all: world.players.map((p) => p.ovr),
    potentialByCompetition,
    allPotential: world.players.map((p) => p.potential),
  };
  referenceCache.set(seed, dist);
  return dist;
}

/** Turn one EA row into a roster-file player at his rescaled overall. */
function materialize(
  p: EaPlayer,
  cols: ResolvedColumns,
  rescale: Rescaler,
  rescalePotential: Rescaler,
  spread: number,
): RosterFilePlayer {
  const target = clampInt(rescale(p.eaOverall), RATING_MIN, RATING_MAX);
  const shape = applySpread(ratingShapeFromEa(p.row, cols, p.pos, target), spread);
  const ratings = shiftToOverall(shape, p.pos, p.heightCm, target);
  const ovr = computeOvr(p.pos, ratings, p.heightCm);

  // Potential goes through its own curve (see ReferenceDistribution) — it is a
  // different distribution from overall, and reusing the overall curve
  // collapsed every wonderkid onto the same ceiling. The game clamps potential
  // to >= ovr on import; we pre-clamp so the emitted file is self-consistent.
  const potential =
    p.eaPotential !== undefined
      ? clampInt(Math.max(rescalePotential(p.eaPotential), ovr), RATING_MIN, RATING_MAX)
      : undefined;

  return {
    name: p.name,
    pos: p.pos,
    age: p.age,
    nationality: p.nationality,
    heightCm: p.heightCm,
    potential,
    ratings,
  };
}

export function convert(csvText: string, opts: Partial<ConvertOptions> = {}): {
  file: RosterFile;
  report: ConvertReport;
} {
  const o: ConvertOptions = { ...DEFAULT_OPTIONS, ...opts };
  const table = readCsvTable(csvText);
  const cols = resolveColumns(table);
  if (cols.missingRequired.length > 0) {
    throw new Error(
      `This CSV is missing required column(s): ${cols.missingRequired.join(", ")}. ` +
        `Found headers: ${table.headers.slice(0, 40).join(", ")}${table.headers.length > 40 ? ", ..." : ""}`,
    );
  }

  const { players, report: readReport } = readPlayers(table.rows, cols);
  const warnings: string[] = [];

  // --- Group into competitions and clubs, and choose which clubs get slots ---
  const byComp = new Map<string, Map<string, EaPlayer[]>>();
  for (const p of players) {
    if (!byComp.has(p.competition)) byComp.set(p.competition, new Map());
    const clubs = byComp.get(p.competition)!;
    if (!clubs.has(p.clubName)) clubs.set(p.clubName, []);
    clubs.get(p.clubName)!.push(p);
  }

  // How many slots each competition actually has. Read off the game rather than
  // assumed, since divisions have real sizes (Scotland's second tier is 10).
  const slotsByComp = new Map(worldCompetitions().map((c) => [c.name, competitionTeamCount(c)]));
  const slotsFor = (comp: string): number =>
    o.clubsPerCompetition ?? slotsByComp.get(comp) ?? NUM_TEAMS;

  interface ChosenClub { clubName: string; squad: EaPlayer[] }
  const chosen = new Map<string, ChosenClub[]>();
  const coverage = new Map<string, { available: number; slots: number }>();
  for (const [comp, clubs] of byComp) {
    const slots = slotsFor(comp);
    const ranked = [...clubs]
      .map(([clubName, roster]) => ({ clubName, roster, strength: clubStrength(roster) }))
      .sort((a, b) => b.strength - a.strength || a.clubName.localeCompare(b.clubName));

    coverage.set(comp, { available: ranked.length, slots });

    if (ranked.length > slots) {
      warnings.push(
        `"${comp}" has ${ranked.length} clubs in the CSV but the game has ${slots} slots — ` +
          `kept the strongest ${slots}, dropped ${ranked.length - slots}.`,
      );
    } else if (ranked.length < slots) {
      warnings.push(
        `"${comp}" has only ${ranked.length} clubs in the CSV — the remaining ` +
          `${slots - ranked.length} slot(s) keep their existing fictional club and squad.`,
      );
    }

    chosen.set(
      comp,
      ranked.slice(0, slots).map((c) => ({
        clubName: c.clubName,
        squad: pickSquad(c.roster, o.squadSize),
      })),
    );
  }

  // --- Build the rescale curves ---
  const reference = referenceDistribution(o.referenceSeed);
  const squads = [...chosen.values()].flatMap((cs) => cs.flatMap((c) => c.squad));
  const globalRescaler = buildRescaler(squads.map((p) => p.eaOverall), reference.all);
  const globalPotentialRescaler = buildRescaler(
    squads.map((p) => p.eaPotential).filter((x): x is number => x !== undefined),
    reference.allPotential,
  );

  /**
   * Is this league covered well enough to be rank-matched against its own
   * reference band?
   *
   * Rank-matching maps the source's WEAKEST player onto the reference league's
   * weakest, so a per-competition curve is only sound when the source spans
   * that league. FC26 carries 4 of Greece's 14 clubs and they are the four best
   * in the country — matched onto the full Greek band, Panathinaikos' squad
   * players land near a relegation squad, because the curve has been told they
   * are the bottom of their own league. The pooled curve makes no such claim:
   * it places each player where his EA overall ranks against every imported
   * league at once, which is a statement about football rather than about a
   * league we only partly hold.
   *
   * The bar is deliberately generous. Every league the FC26 export actually
   * covers is complete or nearly so (the worst is England's second tier at 20
   * of 24 real clubs, and Belgium and the Netherlands land exactly on their
   * slot counts), so this only ever catches the genuinely fragmentary case.
   */
  const wellCovered = (comp: string): boolean => {
    const c = coverage.get(comp);
    if (!c || c.slots === 0) return false;
    return c.available / c.slots >= PARTIAL_LEAGUE_COVERAGE;
  };

  /** The overall and potential curves for one competition. */
  const rescalersFor = (comp: string): { ovr: Rescaler; pot: Rescaler } => {
    if (o.scaleMode === "global") return { ovr: globalRescaler, pot: globalPotentialRescaler };
    if (!wellCovered(comp)) return { ovr: globalRescaler, pot: globalPotentialRescaler };
    const squad = (chosen.get(comp) ?? []).flatMap((c) => c.squad);

    const refOvr = reference.byCompetition.get(comp);
    const srcOvr = squad.map((p) => p.eaOverall);
    const ovr = !refOvr || refOvr.length === 0 || srcOvr.length === 0
      ? globalRescaler
      : buildRescaler(srcOvr, refOvr);

    const refPot = reference.potentialByCompetition.get(comp);
    const srcPot = squad.map((p) => p.eaPotential).filter((x): x is number => x !== undefined);
    const pot = !refPot || refPot.length === 0 || srcPot.length === 0
      ? globalPotentialRescaler
      : buildRescaler(srcPot, refPot);

    return { ovr, pot };
  };

  // --- Emit, in the game's own competition order ---
  const competitionsOut: RosterFileCompetition[] = [];
  const reportComps: ConvertReport["competitions"] = [];

  for (const comp of worldCompetitions()) {
    const clubs = chosen.get(comp.name);
    if (!clubs || clubs.length === 0) {
      // Worth saying out loud: the whole competition keeps its fictional clubs.
      warnings.push(
        `"${comp.name}" has no clubs in the CSV — all ${slotsFor(comp.name)} slots keep their existing fictional club and squad.`,
      );
      continue;
    }
    if (!wellCovered(comp.name)) {
      const c = coverage.get(comp.name)!;
      warnings.push(
        `"${comp.name}" has only ${c.available} of its ${c.slots} clubs in the CSV, so its players are scaled ` +
          `against the whole imported world rather than against this league — a partial league cannot be ` +
          `rank-matched onto its own band without pretending its best clubs are its worst.`,
      );
    }
    const { ovr: rescale, pot: rescalePotential } = rescalersFor(comp.name);

    const displayNames = clubs.map((c) => o.identityOverrides[c.clubName]?.name ?? c.clubName);
    const abbrevs = uniquifyAbbrevs(displayNames);

    const outClubs: RosterFileClub[] = clubs.map((c, i) => {
      const override = o.identityOverrides[c.clubName] ?? {};
      return {
        name: displayNames[i],
        abbrev: override.abbrev ?? abbrevs[i],
        colors: override.colors ?? deriveColors(displayNames[i]),
        players: c.squad.map((p) => materialize(p, cols, rescale, rescalePotential, o.spread)),
      };
    });

    // Country and tier as well as the name: a division's name is the player's
    // to change in World setup, a shipped country's is not, so stating both is
    // what lets one of these files import into a world where the top flight has
    // been renamed to "Premier League" (see resolveRosterSlots).
    competitionsOut.push({
      match: comp.name, country: comp.country, tier: comp.tier, clubs: outClubs,
    });

    const seen = new Map<number, number>();
    for (const c of clubs) for (const p of c.squad) {
      if (!seen.has(p.eaOverall)) seen.set(p.eaOverall, clampInt(rescale(p.eaOverall), RATING_MIN, RATING_MAX));
    }
    const eaVals = [...seen.keys()].sort((a, b) => a - b);
    const sampleAt = [0, 0.25, 0.5, 0.75, 1].map((q) => eaVals[Math.floor(q * (eaVals.length - 1))]);
    reportComps.push({
      name: comp.name,
      clubsAvailable: byComp.get(comp.name)?.size ?? 0,
      clubsUsed: clubs.length,
      playersEmitted: outClubs.reduce((a, c) => a + (c.players?.length ?? 0), 0),
      scaleSamples: [...new Set(sampleAt)].map((ea) => ({ ea, gm: seen.get(ea)! })),
    });
  }

  if (competitionsOut.length === 0) {
    throw new Error(
      "No rows in this CSV mapped onto any of the leagues this converter reads. " +
        `Check the league column${cols.found.league ? ` ("${cols.found.league}")` : " (not found)"}` +
        `; the most common unmatched values were: ${readReport.unmappedLeagues.slice(0, 5).map((u) => u.league).join(", ") || "(none)"}.`,
    );
  }

  const file: RosterFile = {
    format: ROSTER_FILE_FORMAT,
    formatVersion: ROSTER_FILE_VERSION,
    competitions: competitionsOut,
  };

  const rowsKept = competitionsOut.reduce(
    (a, c) => a + c.clubs.reduce((b, k) => b + (k.players?.length ?? 0), 0),
    0,
  );

  return {
    file,
    report: {
      rowsRead: table.rows.length,
      rowsKept,
      skipped: readReport.skipped,
      unmappedLeagues: readReport.unmappedLeagues,
      ambiguousLeagues: readReport.ambiguousLeagues,
      competitions: reportComps,
      missingColumns: cols.missingOptional,
      warnings,
    },
  };
}
