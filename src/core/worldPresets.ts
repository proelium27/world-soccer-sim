import type { LeagueSpec } from "./competitions.js";
import { MAX_DIVISIONS } from "./competitions.js";

/**
 * Named league shapes for the New League world editor, and the plain-language
 * reading of what a shape produces.
 *
 * The editor used to open on `Strength 20` and `Money 1.00` followed by
 * eighteen selects, which states every knob and answers no question a person
 * actually has ("is this league any good?", "does it work like England?").
 * This is the same shape God Mode's Awards tab settled on: presets first, a
 * preview of what you would get, raw numbers last.
 *
 * Everything here is pure and read-only. A preset is a partial `LeagueSpec`,
 * so applying one is a spread and nothing here needs to know how the editor
 * stores its state.
 */

/** A preset's knobs. `country` is the one field a preset never sets. */
export type LeagueShape = Omit<LeagueSpec, "country" | "nationalities" | "abbrev">;

export interface LeaguePreset {
  id: string;
  /** Shown on the button. */
  name: string;
  /** One sentence: what picking this gets you. */
  blurb: string;
  /**
   * Absent for "As shipped", which means "clear every knob and follow the
   * shipped tables" rather than "set these values" — the distinction matters,
   * because an absent knob is what lets a shipped country keep its own rules
   * (see LeagueSpec's own notes on absent-means-default).
   */
  shape?: LeagueShape;
}

/**
 * What each Strength rung actually produces, measured rather than extrapolated
 * from the 0.94-OVR-per-point slope.
 *
 * Regenerate with `npx tsx scripts/strengthAnchorProbe.ts`, which builds ONE
 * world holding the same league at every offset so the rungs are directly
 * comparable. Last measured 2026-09-21 on the 884-club world, seed 7. These
 * are OVR on the current scale (see OVR_SCALE_SHIFT), so re-measure after any
 * scale move rather than adding a constant.
 */
export const STRENGTH_ANCHORS: readonly { offset: number; bestClub: number; like?: string }[] = [
  { offset: 0, bestClub: 87, like: "England, Spain, Italy and Germany" },
  { offset: 2, bestClub: 84 },
  { offset: 5, bestClub: 81, like: "France" },
  { offset: 8, bestClub: 79 },
  { offset: 10, bestClub: 79, like: "Portugal" },
  { offset: 11, bestClub: 77, like: "Belgium" },
  { offset: 12, bestClub: 76, like: "Turkey" },
  { offset: 14, bestClub: 74 },
  { offset: 16, bestClub: 71 },
  { offset: 18, bestClub: 70 },
  { offset: 20, bestClub: 68 },
];

/** The measured rung nearest an offset, for describing a value between two. */
export function nearestAnchor(offset: number): { offset: number; bestClub: number; like?: string } {
  let best = STRENGTH_ANCHORS[0];
  for (const a of STRENGTH_ANCHORS) {
    if (Math.abs(a.offset - offset) < Math.abs(best.offset - offset)) best = a;
  }
  return best;
}

/**
 * How strong this league is, in football rather than in slider points.
 *
 * Names a shipped country only when the offset is close enough to one that the
 * comparison is honest (the ladder's own resolution is about a point, and
 * adjacent rungs converge over a dynasty anyway — see CLAUDE.md on the weak
 * ladder), otherwise it quotes the rating its best club would carry.
 */
export function describeStrength(offset: number, country?: string): string {
  const a = nearestAnchor(offset);
  const rating = `Its best club would rate around ${a.bestClub}.`;
  if (!a.like || Math.abs(a.offset - offset) > 1) return rating;

  // Don't compare a country to itself. England sitting at the top rung would
  // otherwise read "about as strong as England", which is true and useless.
  const others = a.like
    .split(/,| and /)
    .map((s) => s.trim())
    .filter((s) => s && s !== country);
  if (others.length === 0) return `As strong as the game's best leagues. ${rating}`;

  const list = others.length === 1
    ? others[0]
    : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
  return `About as strong as ${list}. ${rating}`;
}

/**
 * The shipped shapes, as presets.
 *
 * Each one is a real country's arrangement rather than an invented mix, so the
 * blurb can name it and the numbers are already known to work — a world built
 * entirely of these is a world the audits have seen.
 */
export const LEAGUE_PRESETS: readonly LeaguePreset[] = [
  {
    id: "shipped",
    name: "As shipped",
    blurb: "However this country already works in the game.",
  },
  {
    id: "big-four",
    name: "Like the big four",
    blurb: "The strongest football in the world: three divisions of 20, three up and three down, a playoff for the last place up.",
    shape: {
      strengthOffset: 0,
      budgetScale: 1,
      divisions: 3,
      d1Teams: 20,
      d2Teams: 20,
      d3Teams: 20,
      promotionSpots: 3,
      playoffFormat: "english",
      titlePlayoff: "none",
      region: "europe",
    },
  },
  {
    id: "mid-europe",
    name: "Mid-tier European",
    blurb: "Around France or the Netherlands: 18 clubs a division, still three deep, three up and down.",
    shape: {
      strengthOffset: 6,
      budgetScale: 0.65,
      divisions: 3,
      d1Teams: 18,
      d2Teams: 18,
      d3Teams: 18,
      promotionSpots: 3,
      playoffFormat: "english",
      titlePlayoff: "none",
      region: "europe",
    },
  },
  {
    id: "small-europe",
    name: "Small European",
    blurb: "Around Scotland or Greece: a 12-club top flight, two up and down, no playoff.",
    shape: {
      strengthOffset: 14,
      budgetScale: 0.36,
      divisions: 3,
      d1Teams: 12,
      d2Teams: 12,
      d3Teams: 12,
      promotionSpots: 2,
      playoffFormat: "none",
      titlePlayoff: "none",
      region: "europe",
    },
  },
  {
    id: "south-america",
    name: "South American",
    blurb: "Around Brazil: 20 clubs, four up and down, and it plays in the Americas rather than Europe.",
    shape: {
      strengthOffset: 6,
      budgetScale: 0.65,
      divisions: 3,
      d1Teams: 20,
      d2Teams: 20,
      d3Teams: 20,
      promotionSpots: 4,
      playoffFormat: "none",
      titlePlayoff: "none",
      region: "americas",
    },
  },
  {
    id: "closed",
    name: "Closed league",
    blurb: "MLS-style: 30 clubs in two conferences, nobody promoted or relegated, and the title settled in playoffs.",
    shape: {
      strengthOffset: 12,
      budgetScale: 0.4,
      divisions: 2,
      d1Teams: 30,
      d2Teams: 20,
      d1Conferences: { names: ["Eastern Conference", "Western Conference"] as const, crossRounds: 4 },
      promotionSpots: 0,
      playoffFormat: "none",
      titlePlayoff: "conference",
      region: "americas",
    },
  },
];

/** Every knob a preset speaks for, so "which preset is this" asks about the same set it sets. */
const SHAPE_KEYS: readonly (keyof LeagueShape)[] = [
  "strengthOffset", "budgetScale", "divisions",
  "d1Teams", "d2Teams", "d3Teams",
  "d1Conferences", "d2Conferences", "d3Conferences",
  "promotionSpots", "playoffFormat", "titlePlayoff", "region",
];

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Which preset a spec currently matches, if any.
 *
 * Read on every render so a league the player has already shaped reopens on
 * its own preset rather than on "custom" — the same recognition the Awards tab
 * does, and the reason a preset is data rather than a one-way button handler.
 *
 * `baseline` is the country's own shipped spec, when it has one. It is
 * REQUIRED for "As shipped" to mean anything, and that is not a detail: a
 * shipped spec is NOT knob-free, because `worldLeagueSpecs()` carries its
 * sizes, divisions and promotion counts back so that
 * `buildCompetitions(worldLeagueSpecs())` still equals `worldCompetitions()`.
 * Testing for absence instead reads every shipped country as hand-tuned, which
 * is exactly what the first cut of this did — England opened on "Custom".
 */
export function matchingLeaguePreset(
  spec: Omit<LeagueSpec, "country">,
  baseline?: Omit<LeagueSpec, "country">,
): LeaguePreset | undefined {
  if (baseline && SHAPE_KEYS.every((k) => sameValue(spec[k], baseline[k]))) {
    return LEAGUE_PRESETS.find((p) => p.id === "shipped");
  }
  return LEAGUE_PRESETS.find((p) => {
    if (!p.shape) return false;
    return SHAPE_KEYS.every((k) => sameValue(spec[k], p.shape![k]));
  });
}

/** The presets on offer: "As shipped" only where there is a shipped shape to go back to. */
export function leaguePresetsFor(
  baseline?: Omit<LeagueSpec, "country">,
): readonly LeaguePreset[] {
  return baseline ? LEAGUE_PRESETS : LEAGUE_PRESETS.filter((p) => p.id !== "shipped");
}

/**
 * Apply a preset, keeping the fields a preset never speaks for (name,
 * nationalities, continental places, roster files).
 *
 * "As shipped" restores the baseline's values rather than clearing the keys,
 * for the reason `matchingLeaguePreset` gives: on a shipped country those keys
 * are present and carry its real arrangement, so clearing them would hand it
 * the generic defaults and quietly rebuild England as an 18-club league.
 */
export function applyLeaguePreset<T extends Omit<LeagueSpec, "country">>(
  spec: T,
  preset: LeaguePreset,
  baseline?: Omit<LeagueSpec, "country">,
): T {
  const next = { ...spec };
  for (const k of SHAPE_KEYS) delete next[k];
  const shape = preset.shape ?? (baseline ? pickShape(baseline) : undefined);
  return shape ? { ...next, ...shape } : next;
}

/** Just the shape keys of a spec, with absent ones left absent. */
function pickShape(spec: Omit<LeagueSpec, "country">): Partial<LeagueShape> {
  const out: Record<string, unknown> = {};
  for (const k of SHAPE_KEYS) if (spec[k] !== undefined) out[k] = spec[k];
  return out as Partial<LeagueShape>;
}

/** How many clubs a shape holds, for the preview line. */
export function shapeClubCount(sizes: readonly number[], divisions: number): number {
  return sizes.slice(0, Math.min(divisions, MAX_DIVISIONS)).reduce((n, s) => n + s, 0);
}
