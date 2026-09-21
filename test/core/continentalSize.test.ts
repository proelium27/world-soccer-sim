import { describe, it, expect } from "vitest";
import { worldCompetitions, competitionTeamCount } from "../../src/core/competitions.js";
import {
  CUP_FORMATS, CONTINENTAL_ORDER, CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT,
} from "../../src/core/constants.js";
import {
  cupPlan, cupSlotsForCompetition, continentalSlotOverrides, allocateContinentalPlaces,
  qualifyCupTeams,
} from "../../src/core/cup/qualification.js";
import {
  DEFAULT_CONTINENTAL_FORMAT, FIELD_SIZE_OPTIONS, snapFieldSize,
  sanitizeContinentalFormat, isDefaultContinentalFormat,
  type ContinentalFormats,
} from "../../src/core/cup/cupShape.js";
import type { StandingsRow } from "../../src/core/standings.js";

/**
 * God Mode's continental SIZE setting: how many clubs contest a competition.
 *
 * It is applied as a SlotOverrides map (see continentalSlotOverrides) rather
 * than by trimming the field at the draw, which is what lets a competition grow
 * as well as shrink — but it also means several things have to agree about the
 * number. They disagree silently: a plan promising a size the allocation
 * doesn't produce makes buildCupState return null, i.e. no competition at all
 * that season, with nothing logged anywhere.
 */

const comps = worldCompetitions();
const tier1 = comps.filter((c) => c.tier === 1);

const sized = (id: "continental" | "shield" | "americas", n: number | "auto"): ContinentalFormats =>
  ({ [id]: { ...DEFAULT_CONTINENTAL_FORMAT, fieldSize: n } });

const overridesFor = (f: ContinentalFormats | undefined) =>
  continentalSlotOverrides(comps, f, null) ?? undefined;

const totalFor = (id: keyof typeof CUP_FORMATS, f: ContinentalFormats | undefined): number =>
  tier1.reduce((n, c) => n + cupSlotsForCompetition(c, CUP_FORMATS[id], overridesFor(f)), 0);

/** One row per club in every competition, best-first, so allocation has real tables. */
function fakeTables(): Map<number, StandingsRow[]> {
  let tid = 0;
  const out = new Map<number, StandingsRow[]>();
  for (const c of comps) {
    const rows: StandingsRow[] = [];
    for (let i = 0; i < competitionTeamCount(c); i++) {
      rows.push({
        tid: tid++, played: 38, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 1000 - i,
      } as StandingsRow);
    }
    out.set(c.id, rows);
  }
  return out;
}

describe("continental competition size", () => {
  it("leaves a save that has never set one completely untouched", () => {
    expect(continentalSlotOverrides(comps, undefined, null)).toBeNull();
    expect(continentalSlotOverrides(comps, sized("continental", "auto"), null)).toBeNull();
    // And a coefficient allocation passes straight through rather than being rebuilt.
    const base = new Map([[0, { continental: 3 }]]);
    expect(continentalSlotOverrides(comps, undefined, base)).toBe(base);
  });

  it("grows and shrinks the Cup to exactly the size asked for", () => {
    for (const n of [16, 24, 48, 64]) {
      expect(totalFor("continental", sized("continental", n))).toBe(n);
    }
  });

  it("keeps the ladder: a strong league always sends at least as many as a weak one", () => {
    for (const n of [16, 48, 64]) {
      const ov = overridesFor(sized("continental", n));
      const slots = (country: string) => {
        const c = tier1.find((x) => x.country === country)!;
        return cupSlotsForCompetition(c, CONTINENTAL_CUP_FORMAT, ov);
      };
      expect(slots("England")).toBeGreaterThanOrEqual(slots("Serbia"));
      expect(slots("Spain")).toBeGreaterThanOrEqual(slots("Scotland"));
    }
  });

  it("sizes each competition independently, and the one below slides down the tables", () => {
    const f: ContinentalFormats = {
      ...sized("continental", 48),
      ...sized("shield", 36),
    };
    expect(totalFor("continental", f)).toBe(48);
    expect(totalFor("shield", f)).toBe(36);
    // The Shield's usual entry point is derived from the slots above it, so a
    // bigger Cup pushes it down rather than shrinking it.
    const ov = overridesFor(f);
    const england = tier1.find((c) => c.country === "England")!;
    const cupSlots = cupSlotsForCompetition(england, CONTINENTAL_CUP_FORMAT, ov);
    const plain = cupSlotsForCompetition(england, CONTINENTAL_CUP_FORMAT);
    expect(cupSlots).toBeGreaterThan(plain);
  });

  it("never asks a league for more clubs than it has", () => {
    const f: ContinentalFormats = { ...sized("continental", 64), ...sized("shield", 36) };
    const ov = overridesFor(f);
    for (const c of tier1) {
      const asked = CONTINENTAL_ORDER.reduce(
        (n, id) => n + cupSlotsForCompetition(c, CUP_FORMATS[id], ov), 0,
      );
      expect(asked).toBeLessThanOrEqual(competitionTeamCount(c));
    }
  });

  it("caps at what the leagues can actually fill instead of promising a field it can't build", () => {
    // The Americas Cup draws on four leagues; ask for far more than they hold.
    const f = sized("americas", 64);
    const total = totalFor("americas", f);
    const available = tier1
      .filter((c) => cupSlotsForCompetition(c, CUP_FORMATS.americas) > 0)
      .reduce((n, c) => n + competitionTeamCount(c), 0);
    expect(total).toBeLessThanOrEqual(available);
    expect(total).toBeLessThanOrEqual(64);
  });

  /**
   * The one that matters most. cupPlan promises a size, the allocation produces
   * a field, and buildCupState refuses to build anything if they differ — so
   * this is the assertion standing between a resized competition and a season
   * where it silently does not exist.
   */
  it("promises exactly the field the allocation then produces", () => {
    const tables = fakeTables();
    for (const n of [16, 24, 32, 48, 64]) {
      const f: ContinentalFormats = { ...sized("continental", n), ...sized("shield", 20) };
      const ov = overridesFor(f);
      for (const format of [CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT]) {
        const plan = cupPlan(comps, format, ov);
        const alloc = allocateContinentalPlaces(comps, tables, { slots: ov }).get(format.id) ?? [];
        const field = qualifyCupTeams(comps, tables, format, { slots: ov }).field;
        expect(plan).not.toBeNull();
        expect(alloc.length).toBe(plan!.total);
        expect(field.length).toBe(plan!.total);
      }
    }
  });

  it("keeps the competitions disjoint at every size", () => {
    const tables = fakeTables();
    const f: ContinentalFormats = { ...sized("continental", 48), ...sized("shield", 36) };
    const ov = overridesFor(f);
    const alloc = allocateContinentalPlaces(comps, tables, { slots: ov });
    const seen = new Set<number>();
    for (const id of CONTINENTAL_ORDER) {
      for (const e of alloc.get(id) ?? []) {
        expect(seen.has(e.tid)).toBe(false);
        seen.add(e.tid);
      }
    }
  });
});

describe("the size setting itself", () => {
  it("offers only sizes the league-phase draw can build", () => {
    for (const n of FIELD_SIZE_OPTIONS) expect(snapFieldSize(n)).toBe(n);
  });

  it("snaps a hand-edited number down to a buildable one rather than refusing it", () => {
    expect(snapFieldSize(23)).toBe(20);
    expect(snapFieldSize(47)).toBe(44);
    expect(snapFieldSize(3)).toBe(12);
    expect(sanitizeContinentalFormat({ fieldSize: 23 }).fieldSize).toBe(20);
    expect(sanitizeContinentalFormat({ fieldSize: "big" }).fieldSize).toBe("auto");
    expect(sanitizeContinentalFormat({ fieldSize: 2 }).fieldSize).toBe("auto");
  });

  it("counts as a change to the format, so the page marks it and the cup stores a shape", () => {
    expect(isDefaultContinentalFormat({ ...DEFAULT_CONTINENTAL_FORMAT, fieldSize: 24 })).toBe(false);
    expect(isDefaultContinentalFormat({ ...DEFAULT_CONTINENTAL_FORMAT })).toBe(true);
  });
});
