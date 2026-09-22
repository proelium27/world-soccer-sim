import { describe, expect, it } from "vitest";
import { promotionBands } from "../../src/core/promotionBands.js";
import { promotionPlayoffFields } from "../../src/core/promotionPlayoff.js";
import { computeCountrySwaps } from "../../src/core/promotion.js";
import {
  competitionTeamCount, countryDivisions, worldCompetitions,
} from "../../src/core/competitions.js";
import type { StandingsRow } from "../../src/core/standings.js";

/**
 * `promotionBands` answers in positions so a live table can shade them, which
 * means it re-derives arithmetic that already exists in `seatField` and
 * `computeCountrySwaps`. Two copies of a rule drift, and this one drifts
 * silently — a wrong band paints a perfectly plausible relegation zone on the
 * wrong rows. So rather than checking the bands against hand-written numbers,
 * every case here builds real tables, runs the real functions, and demands the
 * bands describe exactly what they did.
 */
const comps = worldCompetitions();

/** A full table for one competition, in finishing order, with unique tids. */
function table(compId: number, size: number): StandingsRow[] {
  return Array.from({ length: size }, (_, i) => ({
    tid: compId * 1000 + i,
    played: 10, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0,
    points: size - i,
  }));
}

const tables = new Map(comps.map((c) => [c.id, table(c.id, competitionTeamCount(c))]));
/** Position (1-based) of a tid in its own division's table. */
const positionOf = (compId: number, tid: number) =>
  tables.get(compId)!.findIndex((r) => r.tid === tid) + 1;

describe("promotionBands", () => {
  const fields = promotionPlayoffFields(comps, tables);

  // Play every seated playoff, with the club from BELOW winning — the one
  // result that exercises both halves of a cross-division tie, since a German
  // or French incumbent losing is what sends him down. `teams[0]` is that
  // incumbent, so the last entrant is a challenger under every format.
  const outcomes = new Map(fields.map((f) => [f.d2CompId, {
    format: f.format,
    promotedTid: f.teams[f.teams.length - 1],
    relegatedTid: f.format === "english" ? null : f.teams[0],
  }]));
  const swaps = computeCountrySwaps(comps, tables, outcomes);

  it("names exactly the positions the swap moves on the table alone", () => {
    for (const comp of comps) {
      const bands = promotionBands(comps, comp, competitionTeamCount(comp));
      const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

      // Going up: this division is the lower half of the link above it. The
      // swap's list is the automatic places plus whoever won the playoff, so
      // taking the winner back out must leave exactly the automatic band.
      const up = swaps.find((s) => s.d2CompId === comp.id);
      const winner = outcomes.get(comp.id)?.promotedTid ?? null;
      const promoted = sorted(
        (up?.promoted ?? []).filter((tid) => tid !== winner).map((tid) => positionOf(comp.id, tid)),
      );
      expect(bands.promoted).toEqual(promoted);

      // Going down: the upper half of the link below it, minus the incumbent
      // who lost his place in the tie.
      const down = swaps.find((s) => s.d1CompId === comp.id);
      const lost = down ? outcomes.get(down.d2CompId)?.relegatedTid ?? null : null;
      const relegated = sorted(
        (down?.relegated ?? []).filter((tid) => tid !== lost).map((tid) => positionOf(comp.id, tid)),
      );
      expect(bands.relegated).toEqual(relegated);
    }
  });

  it("accounts for every club the swap moves, between the two bands", () => {
    for (const comp of comps) {
      const bands = promotionBands(comps, comp, competitionTeamCount(comp));
      const up = swaps.find((s) => s.d2CompId === comp.id);
      for (const tid of up?.promoted ?? []) {
        const pos = positionOf(comp.id, tid);
        expect([...bands.promoted, ...bands.promotionPlayoff]).toContain(pos);
      }
      const down = swaps.find((s) => s.d1CompId === comp.id);
      for (const tid of down?.relegated ?? []) {
        const pos = positionOf(comp.id, tid);
        expect([...bands.relegated, ...bands.relegationPlayoff]).toContain(pos);
      }
    }
  });

  it("names exactly the positions that play off, on each side of the tie", () => {
    for (const comp of comps) {
      const bands = promotionBands(comps, comp, competitionTeamCount(comp));

      const seatedBelow = fields.find((f) => f.d2CompId === comp.id);
      const fromBelow = (seatedBelow?.positions ?? [])
        .filter((_, i) => seatedBelow!.tiers[i] === comp.tier)
        .sort((a, b) => a - b);
      expect(bands.promotionPlayoff).toEqual(fromBelow);

      const seatedAbove = fields.find((f) => f.d1CompId === comp.id);
      const fromAbove = (seatedAbove?.positions ?? [])
        .filter((_, i) => seatedAbove!.tiers[i] === comp.tier)
        .sort((a, b) => a - b);
      expect(bands.relegationPlayoff).toEqual(fromAbove);
    }
  });

  it("covers the formats the world actually ships, so the check isn't vacuous", () => {
    const all = comps.map((c) => promotionBands(comps, c, competitionTeamCount(c)));
    // English playoffs (four clubs below the automatic places).
    expect(all.some((b) => b.promotionPlayoff.length === 4)).toBe(true);
    // German and French ties, which are the only ones that put a club from the
    // division ABOVE into a playoff for its own place.
    expect(all.some((b) => b.relegationPlayoff.length === 1)).toBe(true);
    expect(all.some((b) => b.promotionPlayoff.length === 3)).toBe(true);
    // Closed divisions: the Dutch and Belgian third tiers take nobody.
    expect(all.some((b) => b.promoted.length === 0 && b.promotionPlayoff.length === 0)).toBe(true);
  });

  it("gives a top flight no promotion and a bottom division no relegation", () => {
    for (const { divisions } of countryDivisions(comps)) {
      const top = promotionBands(comps, divisions[0], competitionTeamCount(divisions[0]));
      expect(top.promoted).toEqual([]);
      expect(top.promotionPlayoff).toEqual([]);

      const bottom = divisions[divisions.length - 1];
      const last = promotionBands(comps, bottom, competitionTeamCount(bottom));
      expect(last.relegated).toEqual([]);
      expect(last.relegationPlayoff).toEqual([]);
    }
  });

  it("never claims a position the table does not have", () => {
    for (const comp of comps) {
      const size = competitionTeamCount(comp);
      const bands = promotionBands(comps, comp, size);
      const every = [
        ...bands.promoted, ...bands.promotionPlayoff,
        ...bands.relegationPlayoff, ...bands.relegated,
      ];
      for (const p of every) {
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(size);
      }
      // ...and never claims one twice, which is what an overlapping band would
      // look like: a club both promoted and relegated in the same season.
      expect(new Set(every).size).toBe(every.length);
    }
  });
});
