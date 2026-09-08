import type { FormationId } from "../core/lineup/formations.js";

export interface SlotCoord {
  x: number;
  y: number;
}

/**
 * Pitch coordinates for each formation, as percentages within the pitch
 * container. The pitch is drawn horizontally: x:0 = the GK's own goal line
 * (left), x:100 = the attacking end (right); y:0 = top touchline, y:100 =
 * bottom. Each array is index-aligned with that formation's slot array in
 * FORMATIONS, so slot i renders at coordinate i. Per-formation (rather than
 * per-position) so back-3/back-5 shapes and pushed-up wing-backs lay out
 * correctly instead of reusing a fixed two-CB template.
 */
export const FORMATION_LAYOUTS: Record<FormationId, SlotCoord[]> = {
  // GK, CB, CB, FB, FB, DM, CM, CM, W, W, ST
  "4-3-3": [
    { x: 8, y: 50 },
    { x: 25, y: 35 },
    { x: 25, y: 65 },
    { x: 28, y: 12 },
    { x: 28, y: 88 },
    { x: 42, y: 50 },
    { x: 55, y: 35 },
    { x: 55, y: 65 },
    { x: 75, y: 15 },
    { x: 75, y: 85 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, FB, FB, W, CM, CM, W, ST, ST
  "4-4-2": [
    { x: 8, y: 50 },
    { x: 25, y: 38 },
    { x: 25, y: 62 },
    { x: 25, y: 12 },
    { x: 25, y: 88 },
    { x: 52, y: 12 },
    { x: 50, y: 38 },
    { x: 50, y: 62 },
    { x: 52, y: 88 },
    { x: 88, y: 38 },
    { x: 88, y: 62 },
  ],
  // GK, CB, CB, CB, FB, FB, CM, CM, AM, ST, ST
  "3-5-2": [
    { x: 8, y: 50 },
    { x: 24, y: 25 },
    { x: 24, y: 50 },
    { x: 24, y: 75 },
    { x: 48, y: 10 },
    { x: 48, y: 90 },
    { x: 46, y: 38 },
    { x: 46, y: 62 },
    { x: 66, y: 50 },
    { x: 88, y: 38 },
    { x: 88, y: 62 },
  ],
  // GK, CB, CB, CB, FB, FB, DM, CM, CM, ST, ST
  "5-3-2": [
    { x: 8, y: 50 },
    { x: 24, y: 30 },
    { x: 24, y: 50 },
    { x: 24, y: 70 },
    { x: 28, y: 10 },
    { x: 28, y: 90 },
    { x: 48, y: 50 },
    { x: 58, y: 32 },
    { x: 58, y: 68 },
    { x: 88, y: 38 },
    { x: 88, y: 62 },
  ],
  // GK, CB, CB, FB, FB, DM, DM, W, AM, W, ST
  "4-2-3-1": [
    { x: 8, y: 50 },
    { x: 24, y: 38 },
    { x: 24, y: 62 },
    { x: 26, y: 12 },
    { x: 26, y: 88 },
    { x: 44, y: 38 },
    { x: 44, y: 62 },
    { x: 68, y: 15 },
    { x: 66, y: 50 },
    { x: 68, y: 85 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, FB, FB, CM, CM, CM, W, W, ST
  "4-5-1": [
    { x: 8, y: 50 },
    { x: 24, y: 38 },
    { x: 24, y: 62 },
    { x: 26, y: 12 },
    { x: 26, y: 88 },
    { x: 52, y: 32 },
    { x: 52, y: 50 },
    { x: 52, y: 68 },
    { x: 58, y: 12 },
    { x: 58, y: 88 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, CB, FB, FB, CM, CM, W, W, ST
  "3-4-3": [
    { x: 8, y: 50 },
    { x: 24, y: 25 },
    { x: 24, y: 50 },
    { x: 24, y: 75 },
    { x: 46, y: 10 },
    { x: 46, y: 90 },
    { x: 48, y: 38 },
    { x: 48, y: 62 },
    { x: 72, y: 20 },
    { x: 72, y: 80 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, CB, FB, FB, DM, CM, W, W, ST
  "5-4-1": [
    { x: 8, y: 50 },
    { x: 24, y: 28 },
    { x: 24, y: 50 },
    { x: 24, y: 72 },
    { x: 28, y: 10 },
    { x: 28, y: 90 },
    { x: 46, y: 42 },
    { x: 48, y: 58 },
    { x: 62, y: 14 },
    { x: 62, y: 86 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, FB, FB, DM, CM, CM, AM, ST, ST
  "4-3-1-2": [
    { x: 8, y: 50 },
    { x: 24, y: 38 },
    { x: 24, y: 62 },
    { x: 26, y: 12 },
    { x: 26, y: 88 },
    { x: 42, y: 50 },
    { x: 52, y: 30 },
    { x: 52, y: 70 },
    { x: 64, y: 50 },
    { x: 88, y: 38 },
    { x: 88, y: 62 },
  ],
  // GK, CB, CB, FB, FB, W, CM, CM, W, AM, ST
  "4-4-1-1": [
    { x: 8, y: 50 },
    { x: 25, y: 38 },
    { x: 25, y: 62 },
    { x: 25, y: 12 },
    { x: 25, y: 88 },
    { x: 50, y: 12 },
    { x: 48, y: 38 },
    { x: 48, y: 62 },
    { x: 50, y: 88 },
    { x: 70, y: 50 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, FB, FB, DM, CM, CM, AM, AM, ST
  "4-3-2-1": [
    { x: 8, y: 50 },
    { x: 24, y: 38 },
    { x: 24, y: 62 },
    { x: 26, y: 12 },
    { x: 26, y: 88 },
    { x: 42, y: 50 },
    { x: 52, y: 28 },
    { x: 52, y: 72 },
    { x: 70, y: 36 },
    { x: 70, y: 64 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, FB, FB, DM, DM, AM, AM, ST, ST
  "4-2-2-2": [
    { x: 8, y: 50 },
    { x: 24, y: 38 },
    { x: 24, y: 62 },
    { x: 26, y: 12 },
    { x: 26, y: 88 },
    { x: 44, y: 34 },
    { x: 44, y: 66 },
    { x: 66, y: 28 },
    { x: 66, y: 72 },
    { x: 88, y: 38 },
    { x: 88, y: 62 },
  ],
  // GK, CB, CB, CB, FB, FB, CM, CM, AM, AM, ST
  "3-4-2-1": [
    { x: 8, y: 50 },
    { x: 24, y: 25 },
    { x: 24, y: 50 },
    { x: 24, y: 75 },
    { x: 46, y: 10 },
    { x: 46, y: 90 },
    { x: 48, y: 38 },
    { x: 48, y: 62 },
    { x: 70, y: 32 },
    { x: 70, y: 68 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, CB, FB, FB, DM, CM, CM, AM, ST
  "3-5-1-1": [
    { x: 8, y: 50 },
    { x: 24, y: 25 },
    { x: 24, y: 50 },
    { x: 24, y: 75 },
    { x: 48, y: 10 },
    { x: 48, y: 90 },
    { x: 42, y: 50 },
    { x: 54, y: 34 },
    { x: 54, y: 66 },
    { x: 70, y: 50 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, CB, FB, FB, DM, DM, W, W, ST
  "5-2-3": [
    { x: 8, y: 50 },
    { x: 24, y: 28 },
    { x: 24, y: 50 },
    { x: 24, y: 72 },
    { x: 28, y: 10 },
    { x: 28, y: 90 },
    { x: 46, y: 38 },
    { x: 46, y: 62 },
    { x: 72, y: 18 },
    { x: 72, y: 82 },
    { x: 90, y: 50 },
  ],
  // GK, CB, CB, CB, FB, FB, DM, DM, AM, ST, ST
  "5-2-1-2": [
    { x: 8, y: 50 },
    { x: 24, y: 28 },
    { x: 24, y: 50 },
    { x: 24, y: 72 },
    { x: 28, y: 10 },
    { x: 28, y: 90 },
    { x: 46, y: 38 },
    { x: 46, y: 62 },
    { x: 66, y: 50 },
    { x: 88, y: 38 },
    { x: 88, y: 62 },
  ],
};

/** The pitch coordinates for a formation, one per slot, index-aligned with FORMATIONS[formation]. */
export function layoutSlots(formation: FormationId): SlotCoord[] {
  return FORMATION_LAYOUTS[formation];
}

/**
 * Which layout coordinate each of an eleven belongs at.
 *
 * The Roster page hands its XI over already index-aligned with the formation,
 * because that is how selectXI built it. A match lineup is not: it is
 * reconstructed from a box score and sorted back-to-front for reading (see
 * live/lineups.ts), so slot i of that list is not layout coordinate i. This
 * matches them up by slot, first come first served.
 *
 * Ties among identical slots are arbitrary and that is fine — two centre-backs
 * at y 35 and y 65 are the same pair of chips whichever way round they go.
 * Anything left over (a slot the shape doesn't contain, which only happens when
 * a formation could not be named at all) falls back to the first free
 * coordinate, so every player is placed somewhere rather than stacked at the
 * origin.
 */
export function assignLayoutIndices(
  formationSlots: readonly string[],
  slots: readonly (string | null)[],
): number[] {
  const taken = new Array<boolean>(formationSlots.length).fill(false);
  const out = new Array<number>(slots.length).fill(-1);

  slots.forEach((slot, i) => {
    if (slot === null) return;
    const at = formationSlots.findIndex((f, j) => !taken[j] && f === slot);
    if (at >= 0) {
      taken[at] = true;
      out[i] = at;
    }
  });
  // Whoever the pass above could not place takes the first free coordinate.
  out.forEach((at, i) => {
    if (at >= 0) return;
    const free = taken.findIndex((t) => !t);
    if (free >= 0) {
      taken[free] = true;
      out[i] = free;
    }
  });
  return out;
}

/**
 * Pitch coordinates for an award XI, index-aligned with TOTS_SLOTS.
 *
 * Its own array rather than a FORMATION_LAYOUTS lookup, for the same reason
 * TOTS_SLOTS is its own list: the award XI is a showcase shape, not a tactical
 * one, and must not shift because the sim's formation table was retuned.
 *
 * It is still drawn as a 4-3-3 — back four, midfield three, front three — and
 * every coordinate matches that layout except slot 7, which holds the AM rather
 * than a second CM and so sits further forward (x 55 -> 62) so the 10 reads as
 * playing ahead of the 8.
 */
export const TOTS_LAYOUT: SlotCoord[] = [
  { x: 8, y: 50 },   // GK
  { x: 25, y: 35 },  // CB
  { x: 25, y: 65 },  // CB
  { x: 28, y: 12 },  // FB
  { x: 28, y: 88 },  // FB
  { x: 42, y: 50 },  // DM
  { x: 55, y: 35 },  // CM
  { x: 62, y: 65 },  // AM
  { x: 75, y: 15 },  // W
  { x: 75, y: 85 },  // W
  { x: 90, y: 50 },  // ST
];
