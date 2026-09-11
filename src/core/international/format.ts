import {
  WORLD_CUP_SIZES, WORLD_CUP_AUTO_MIN_NATIONS,
  type WorldCupFieldSize, type WorldCupSize,
} from "../constants.js";

/**
 * Tournament shapes.
 *
 * A confederation cup's field varies with its confederation: Europe fields two
 * dozen nations and South America five, and the same code has to run both. So
 * a tournament's shape is chosen from this table by how many nations actually
 * turned up. The World Cup's size is a per-save setting and has a table of its
 * own (WORLD_CUP_FORMATS, below), because two of its sizes need a rule this
 * table has no use for.
 *
 * Every shape ends in a power-of-two knockout, which is what lets the staged
 * offseason play several tournaments side by side and still land their finals
 * on the same click (see confederationCup.ts). The smallest shape is a single
 * round-robin whose top two contest a final — which is not a fudge for a thin
 * field but how Copa America was genuinely played until 1975.
 */

/** A tournament's shape: how the field splits into groups and how many advance. */
export interface TournamentFormat {
  fieldSize: number;
  groupCount: number;
  qualifyPerGroup: number;
  /**
   * Third-placed nations that also go through, the best of them across every
   * group — how a 24- or 48-nation field still reaches a power-of-two bracket.
   * Absent means none, which is every shape in TOURNAMENT_FORMATS.
   */
  bestThirds?: number;
}

/**
 * Supported shapes, largest field first. Each one's knockout is
 * `groupCount * qualifyPerGroup` nations, always a power of two:
 *
 *   32 -> 8 groups of 4, top 2 -> 16-nation knockout (the World Cup's shape)
 *   16 -> 4 groups of 4, top 2 -> 8
 *   12 -> 4 groups of 3, top 2 -> 8
 *    8 -> 2 groups of 4, top 2 -> 4
 *    6 -> 2 groups of 3, top 2 -> 4
 *    5 -> one round-robin,  top 2 -> a final
 *    4 -> one round-robin,  top 2 -> a final
 */
export const TOURNAMENT_FORMATS: TournamentFormat[] = [
  { fieldSize: 32, groupCount: 8, qualifyPerGroup: 2 },
  { fieldSize: 16, groupCount: 4, qualifyPerGroup: 2 },
  { fieldSize: 12, groupCount: 4, qualifyPerGroup: 2 },
  { fieldSize: 8, groupCount: 2, qualifyPerGroup: 2 },
  { fieldSize: 6, groupCount: 2, qualifyPerGroup: 2 },
  { fieldSize: 5, groupCount: 1, qualifyPerGroup: 2 },
  { fieldSize: 4, groupCount: 1, qualifyPerGroup: 2 },
];

/**
 * The biggest shape that fits: no larger than the target field the competition
 * wants, and no larger than the number of nations available to fill it. Null
 * when neither reaches the smallest supported shape, which is the signal to not
 * hold the tournament at all.
 */
export function formatFor(available: number, target: number): TournamentFormat | null {
  const cap = Math.min(available, target);
  return TOURNAMENT_FORMATS.find((f) => f.fieldSize <= cap) ?? null;
}

/** How many knockout rounds a shape plays (4 for a sixteen-nation bracket, 1 for a lone final). */
export function knockoutRounds(format: TournamentFormat): number {
  return Math.log2(format.groupCount * format.qualifyPerGroup + (format.bestThirds ?? 0));
}

/**
 * The World Cup's shape at each size it can be set to. All four are groups of
 * four with the top two through; 24 and 48 then add the best third-placed
 * sides, exactly as Euro 2016 (six groups, four thirds, a round of 16) and the
 * 2026 World Cup (twelve groups, eight thirds, a round of 32) do. That rule is
 * what a group count that isn't a power of two needs, and the alternative for
 * 48 — sixteen groups of three — was passed over because a group of three gives
 * each nation two games and leaves the last match between two sides who already
 * know what result sends them both through.
 */
export const WORLD_CUP_FORMATS: Record<WorldCupFieldSize, TournamentFormat> = {
  16: { fieldSize: 16, groupCount: 4, qualifyPerGroup: 2 },
  24: { fieldSize: 24, groupCount: 6, qualifyPerGroup: 2, bestThirds: 4 },
  32: { fieldSize: 32, groupCount: 8, qualifyPerGroup: 2 },
  48: { fieldSize: 48, groupCount: 12, qualifyPerGroup: 2, bestThirds: 8 },
};

/**
 * How many third-placed nations a tournament with `groupCount` groups sends
 * through: whatever tops the group qualifiers up to the next power of two. Zero
 * for every confederation cup shape and for a World Cup of 16 or 32, four for
 * six groups and eight for twelve.
 *
 * Derived from the group count rather than stored on the tournament, which is
 * what lets a World Cup drawn before this existed (always eight groups) read
 * correctly with nothing to migrate — and it cannot disagree with
 * WORLD_CUP_FORMATS, which a test holds it to.
 */
export function bestThirdsFor(groupCount: number, qualifyPerGroup: number): number {
  if (groupCount <= 1) return 0;
  const through = groupCount * qualifyPerGroup;
  let bracket = 1;
  while (bracket < through) bracket *= 2;
  const thirds = bracket - through;
  // Every group supplies at most one third-placed nation, so a shape that would
  // need more of them than it has groups has no valid bracket at all.
  return thirds <= groupCount ? thirds : 0;
}

/** The fewest eligible nations "auto" wants before it picks `size` — see WORLD_CUP_AUTO_MIN_NATIONS. */
export function autoWorldCupThreshold(size: WorldCupFieldSize): number {
  return WORLD_CUP_AUTO_MIN_NATIONS[size];
}

/**
 * The size a World Cup is actually played at, given the save's setting and how
 * many nations the world can field a squad for. Null when the world cannot fill
 * even the smallest size, which keeps international football dark exactly as a
 * too-small world always has.
 *
 *  - A fixed setting is a ceiling, not a promise: a world that can't fill the
 *    size picked drops to the largest one it can, rather than staying dark.
 *  - "auto" picks the largest size whose bar the world clears (see
 *    WORLD_CUP_AUTO_MIN_NATIONS).
 */
export function resolveWorldCupSize(setting: WorldCupSize, eligible: number): WorldCupFieldSize | null {
  const descending = [...WORLD_CUP_SIZES].sort((a, b) => b - a);
  if (setting === "auto") {
    return descending.find((s) => eligible >= autoWorldCupThreshold(s) && s <= eligible) ?? null;
  }
  return descending.find((s) => s <= setting && s <= eligible) ?? null;
}

/**
 * The World Cup shape for a field of `nations`: the largest supported size that
 * fits. A tournament is drawn at exactly its qualifying campaign's size, so this
 * only ever steps down when a qualified nation has since lost the players to
 * name a squad and no other nation is left to take its place.
 */
export function worldCupFormatFor(nations: number): TournamentFormat | null {
  const size = [...WORLD_CUP_SIZES].sort((a, b) => b - a).find((s) => s <= nations);
  return size === undefined ? null : WORLD_CUP_FORMATS[size];
}
