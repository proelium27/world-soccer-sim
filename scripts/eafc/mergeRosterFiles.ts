/**
 * Fill the slots a roster file doesn't cover with club identities from another
 * roster file.
 *
 * The EA FC converter can only import leagues its dataset actually carries, so
 * a converted file leaves gaps: the 18-club leagues (Bundesliga, Ligue 1,
 * Primeira Liga) leave 2 slots each, and a division missing from the dataset
 * entirely (FC26 has no Liga Portugal 2) leaves all 20. Those slots keep their
 * fictional club. This merges a second roster file — typically one produced by
 * the game's own "Export Teams" button after renaming clubs by hand — into
 * those gaps, so the world has real names everywhere even where it can't have
 * real squads.
 *
 * The whole difficulty is DUPLICATE CLUBS, and it is not hypothetical. A names
 * file built by hand routinely disagrees with the dataset about which division
 * a club is in: the two clubs spare in its Bundesliga list are Bochum, Kiel and
 * Schalke, all of which the FC26 export puts in the 2. Bundesliga, and its
 * Liga Portugal 2 list contains Rio Ave, Nacional, Casa Pia and Chaves, all of
 * which are in its own top flight. Fill by slot position and you get the same
 * club in two divisions at once, which promotion/relegation then has to try to
 * make sense of. So every candidate is checked against every club already in
 * the merged world, by a normalized name comparison that has to survive
 * "Casa Pia" vs "Casa Pia AC", "Alverca" vs "FC Alverca", "VfL Bochum 1848" vs
 * "VfL Bochum", and "ESTAC Troyes" vs "Troyes Aubois".
 *
 * Names only — a filled slot keeps its generated squad. Nothing here invents
 * players.
 *
 *   npx tsx scripts/eafc/mergeRosterFiles.ts \
 *     --base eafc-roster.json --names soccer-gm-teams-x.json --out merged-roster.json
 */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { parseRosterFile, type RosterFile, type RosterFileClub } from "../../src/core/teams/rosterFile.js";
import { uniqueAbbrev } from "./identity.js";

/**
 * Club-type words, legal-form suffixes and founding years, none of which
 * distinguish one club from another. Stripping them is what makes "Casa Pia"
 * and "Casa Pia AC" the same club.
 */
const NOISE = new Set([
  "fc", "afc", "cf", "sc", "ac", "cd", "ud", "sd", "rc", "as", "ss", "ssc", "aj", "og", "ogc",
  "sl", "gd", "cp", "vfl", "vfb", "tsg", "fsv", "spvgg", "dsc", "bsc", "ea", "usl", "us", "estac",
  "sm", "losc", "sad", "futebol", "clube", "club", "de", "da", "do", "des", "du", "la", "le",
  "the", "and", "1", "04", "05", "07", "29", "38", "63", "96", "98", "1846", "1848", "1899",
  "calcio", "sport", "sportive", "sporting", "stade", "olympique", "borussia", "eintracht",
  "fortuna", "dynamo", "hertha", "werder", "greuther", "holstein", "jahn", "preussen", "arminia",
  "karlsruher", "hamburger", "united", "city", "town", "athletic", "atletico", "real", "deportivo",
  "racing", "union", "sv", "tsv", "vf", "aveyron", "football", "alsace", "praia", "amadora",
]);

/**
 * Place names the two files spell in different languages. Not fuzziness — a
 * transliteration table, which no general string rule recovers: "Bayern Munich"
 * and "FC Bayern München" share no comparable token after accent-stripping
 * ("munich" vs "munchen"), so without this the merge adds Bayern twice.
 */
const SPELLING: Record<string, string> = {
  munich: "munchen", cologne: "koln", milan: "milano", turin: "torino",
  seville: "sevilla", lisbon: "lisboa", nuremberg: "nurnberg", brunswick: "braunschweig",
};

/** Lowercase, strip accents and punctuation, drop noise words, unify spellings. */
function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t))
    .map((t) => SPELLING[t] ?? t);
}

/**
 * Do these two names denote the same club? True when every distinctive token of
 * the shorter name appears in the longer one — after NOISE removal what
 * survives is the place or family name, so "Casa Pia" ⊆ "Casa Pia AC",
 * "Alverca" ⊆ "FC Alverca" and "ESTAC Troyes" ⊆ "Troyes Aubois" all resolve,
 * while "Borussia Dortmund" and "Borussia Mönchengladbach" stay distinct.
 *
 * Containment rather than mere overlap because overlap is too loose: it matched
 * AS Saint-Étienne to Paris Saint-Germain on the shared "saint". The residual
 * false positive is a single-token name contained in a longer unrelated one —
 * "Paris FC" still reads as a subset of "Paris Saint-Germain" — which is why
 * every rejection is printed rather than silently dropped, and why the reported
 * reason prefers an exact match when one exists.
 */
function sameClub(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

/** The club in `pool` that `name` duplicates, preferring an exact-token match. */
function duplicateOf(pool: string[], name: string): string | undefined {
  const t = tokens(name).sort().join(" ");
  return pool.find((n) => tokens(n).sort().join(" ") === t) ?? pool.find((n) => sameClub(n, name));
}

/** Country prefix of a competition name ("German Division 1" -> "German"). */
const countryOf = (match: string): string => match.trim().split(/\s+/)[0]!.toLowerCase();

interface Filled {
  competition: string;
  club: string;
  from: string;
}

export interface MergeResult {
  file: RosterFile;
  filled: Filled[];
  /** Slots left fictional because every remaining candidate was already in the world. */
  unfilled: { competition: string; slots: number }[];
  /** Candidates rejected as duplicates, so a bad match can be spotted. */
  rejected: { candidate: string; duplicateOf: string }[];
  /** Clubs that took their colors from the names file. */
  recolored: { club: string; from: string; colors: [string, string] }[];
}

/**
 * Merge `names` into `base`: adopt the names file's colors for clubs the base
 * already has, then fill each competition up to the slot count the names file
 * implies. Base clubs always win their slots; names only ever land in slots the
 * base file left empty.
 *
 * The colors matter more than they sound. The EA FC converter has no color data
 * — the datasets carry none — so it synthesizes a pair by hashing the club name,
 * which makes Liverpool purple and gold. That was invisible while clubs showed
 * the game's built-in crest art, and became the entire visual identity the
 * moment imported clubs stopped drawing a crest (their slot's badge belongs to
 * the fictional club they displaced). A hand-built names file has real colors,
 * so anything it recognizes gets them.
 */
export function mergeRosterFiles(base: RosterFile, names: RosterFile): MergeResult {
  const namesByComp = new Map(names.competitions.map((c) => [c.match.trim().toLowerCase(), c]));
  const baseByComp = new Map(base.competitions.map((c) => [c.match.trim().toLowerCase(), c]));

  // Every competition either file knows about, base order first so a converted
  // file's own ordering is preserved.
  const order = [
    ...base.competitions.map((c) => c.match),
    ...names.competitions.map((c) => c.match).filter((m) => !baseByComp.has(m.trim().toLowerCase())),
  ];

  // Claimed names span the WHOLE world, not one competition: the duplicates
  // this exists to prevent are cross-division ones.
  const claimed: string[] = [];
  for (const c of base.competitions) for (const k of c.clubs) claimed.push(k.name);

  const used = new Set<RosterFileClub>();
  const filled: Filled[] = [];
  const rejected: { candidate: string; duplicateOf: string }[] = [];
  const unfilled: { competition: string; slots: number }[] = [];
  const recolored: MergeResult["recolored"] = [];

  // Pass one: hand every base club the names file's colors for it, and consume
  // that entry. Runs BEFORE any filling, because an entry that describes a club
  // already in the world must be spent recoloring it rather than left lying
  // around as a candidate to fill some other slot with a second copy.
  const recolor = new Map<RosterFileClub, [string, string]>();
  const allNamesClubs = names.competitions.flatMap((c) => c.clubs);
  for (const comp of base.competitions) {
    for (const club of comp.clubs) {
      const match = allNamesClubs.find((n) => !used.has(n) && sameClub(n.name, club.name));
      if (!match) continue;
      used.add(match);
      // Colors only, never the abbreviation: the converter already ran its
      // abbreviations through a uniqueness pass, and adopting a hand-written
      // one could reintroduce a collision inside a competition.
      recolor.set(club, match.colors);
      recolored.push({ club: club.name, from: match.name, colors: match.colors });
    }
  }

  const competitions = order.map((match) => {
    const key = match.trim().toLowerCase();
    const baseComp = baseByComp.get(key);
    const nameComp = namesByComp.get(key);
    const clubs = (baseComp?.clubs ?? []).map((c) => {
      const colors = recolor.get(c);
      return colors ? { ...c, colors } : c;
    });
    const slots = Math.max(clubs.length, nameComp?.clubs.length ?? 0);

    // Abbrevs a filled slot must not reuse. Base clubs hold their codes (the
    // converter already made those unique among themselves); a names file has
    // had no such pass, so its codes are the ones that get re-derived.
    const takenAbbrevs = new Set(clubs.map((c) => c.abbrev));

    /** Take unused, non-duplicate candidates from a pool until the slots fill. */
    const drawFrom = (pool: RosterFileClub[]) => {
      for (const cand of pool) {
        if (clubs.length >= slots) return;
        if (used.has(cand)) continue;
        const dupe = duplicateOf(claimed, cand.name);
        if (dupe) {
          rejected.push({ candidate: cand.name, duplicateOf: dupe });
          used.add(cand); // a duplicate here is a duplicate everywhere
          continue;
        }
        // Identity only: a filled slot keeps the squad the game generated for it.
        const abbrev = uniqueAbbrev(cand.name, cand.abbrev, takenAbbrevs);
        takenAbbrevs.add(abbrev);
        clubs.push({ name: cand.name, abbrev, colors: cand.colors });
        claimed.push(cand.name);
        used.add(cand);
        filled.push({ competition: match, club: cand.name, from: nameComp?.match ?? "" });
      }
    };

    if (clubs.length < slots && nameComp) drawFrom(nameComp.clubs);
    // Still short: try the same country's other division, where a names file
    // that disagrees about tiers keeps the clubs this one is missing.
    if (clubs.length < slots) {
      for (const other of names.competitions) {
        if (other === nameComp || countryOf(other.match) !== countryOf(match)) continue;
        drawFrom(other.clubs);
      }
    }
    if (clubs.length < slots) unfilled.push({ competition: match, slots: slots - clubs.length });

    return { match, clubs };
  });

  return {
    // `ovrScale` and `nationalities` are carried across from the base, and the
    // first of those is load-bearing rather than tidiness. The base is a
    // converted file whose ratings are already on the current scale, and it
    // says so with `ovrScale`; dropping the stamp here leaves a merged file
    // that reads as pre-shift, so `rescaleRosterFile` lifts it a SECOND time
    // and every real player lands OVR_SCALE_SHIFT points above where the
    // converter put him. Nothing throws — the world simply imports too strong.
    // The names file cannot disagree about the scale, because it contributes
    // identities only and carries no ratings to be on a scale at all.
    file: {
      format: base.format,
      formatVersion: base.formatVersion,
      ...(base.ovrScale === undefined ? {} : { ovrScale: base.ovrScale }),
      ...(base.nationalities === undefined ? {} : { nationalities: base.nationalities }),
      competitions,
    },
    filled,
    unfilled,
    rejected,
    recolored,
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      names: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !values.base || !values.names || !values.out) {
    console.log(
      "Usage: npx tsx scripts/eafc/mergeRosterFiles.ts --base <roster.json> --names <roster.json> --out <roster.json>",
    );
    process.exit(values.help ? 0 : 1);
  }

  const base = parseRosterFile(readFileSync(values.base, "utf8"));
  const names = parseRosterFile(readFileSync(values.names, "utf8"));
  const { file, filled, unfilled, rejected, recolored } = mergeRosterFiles(base, names);

  const squads = file.competitions.reduce(
    (n, c) => n + c.clubs.filter((k) => k.players && k.players.length > 0).length,
    0,
  );
  const clubs = file.competitions.reduce((n, c) => n + c.clubs.length, 0);

  console.log(`\n${clubs} clubs across ${file.competitions.length} competitions, ${squads} with a real squad.\n`);

  if (recolored.length) {
    console.log(`Took real colors from the names file for ${recolored.length} club(s).\n`);
  }
  if (filled.length) {
    console.log(`Filled ${filled.length} empty slot(s) with names only (they keep a generated squad):`);
    const byComp = new Map<string, string[]>();
    for (const f of filled) byComp.set(f.competition, [...(byComp.get(f.competition) ?? []), f.club]);
    for (const [comp, list] of byComp) console.log(`  ${comp}: ${list.join(", ")}`);
    console.log();
  }
  if (rejected.length) {
    console.log(`Skipped ${rejected.length} candidate(s) already in the world:`);
    for (const r of rejected) console.log(`  ${r.candidate} — already present as "${r.duplicateOf}"`);
    console.log();
  }
  if (unfilled.length) {
    console.log("Slots with no real club left to give them (they keep their fictional club):");
    for (const u of unfilled) console.log(`  ${u.competition}: ${u.slots}`);
    console.log();
  }

  writeFileSync(values.out, JSON.stringify(file, null, 2));
  console.log(`Wrote ${values.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
