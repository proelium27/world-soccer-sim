import { describe, it, expect } from "vitest";
import {
  worldCompetitions, competitionRegion, competitionTitlePlayoff, competitionTeamCount,
} from "../../src/core/competitions.js";
import type { Competition } from "../../src/core/competitions.js";
import type { StandingsRow } from "../../src/core/standings.js";
import {
  CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT, AMERICAS_CUP_FORMAT, AMERICAS_CUP_LEAGUE_PHASE_SIZE,
  COUNTRY_STRENGTH_OFFSET, COUNTRY_BUDGET_SCALE,
} from "../../src/core/constants.js";
import {
  cupPlan, cupSlotsForCompetition, allocateContinentalPlaces,
} from "../../src/core/cup/qualification.js";
import { reallocateCupSlots, countryCoefficients } from "../../src/core/cup/coefficients.js";
import {
  titlePlayoffFields, titleChampions, TITLE_PLAYOFF_QF_PAIRS, type TitlePlayoff,
} from "../../src/core/titlePlayoff.js";
import { computeCountrySwaps } from "../../src/core/promotion.js";
import { buildSuperCups } from "../../src/core/superCup/superCup.js";
import type { CupState } from "../../src/core/cup/types.js";

const AMERICAS = ["Brazil", "Argentina", "Mexico", "United States"];

/** A final table for one competition: tids base..base+n-1, best first. */
function table(base: number, n: number): StandingsRow[] {
  return Array.from({ length: n }, (_, i) => ({
    tid: base + i, played: 38, won: n - i, drawn: 0, lost: i, gf: 60 - i, ga: 20 + i,
    gd: 40 - 2 * i, points: 3 * (n - i),
  } as StandingsRow));
}

function tablesFor(comps: Competition[]): Map<number, StandingsRow[]> {
  return new Map(comps.map((c, i) => [c.id, table(i * 100, 16)]));
}

describe("continental regions", () => {
  const comps = worldCompetitions();

  it("puts exactly the four American countries in the Americas", () => {
    const americas = [...new Set(comps.filter((c) => competitionRegion(c) === "americas").map((c) => c.country))];
    expect(americas).toEqual(AMERICAS);
  });

  it("gives a league no places in another continent's competition, whatever its own slots say", () => {
    const brazil = comps.find((c) => c.country === "Brazil" && c.tier === 1)!;
    const england = comps.find((c) => c.country === "England" && c.tier === 1)!;
    expect(cupSlotsForCompetition(brazil, CONTINENTAL_CUP_FORMAT)).toBe(0);
    expect(cupSlotsForCompetition(brazil, SHIELD_FORMAT)).toBe(0);
    expect(cupSlotsForCompetition(england, AMERICAS_CUP_FORMAT)).toBe(0);
    // A hand-set count cannot cross the boundary either.
    const rogue = { ...brazil, continentalSlots: { continental: 6 } };
    expect(cupSlotsForCompetition(rogue, CONTINENTAL_CUP_FORMAT)).toBe(0);
  });

  it("leaves the European fields exactly the size they were and fields a 16-club Americas Cup", () => {
    expect(cupPlan(comps, CONTINENTAL_CUP_FORMAT)!.total).toBe(32);
    expect(cupPlan(comps, SHIELD_FORMAT)!.total).toBe(24);
    expect(cupPlan(comps, AMERICAS_CUP_FORMAT)!.total).toBe(AMERICAS_CUP_LEAGUE_PHASE_SIZE);
  });

  it("never lets a club into a competition outside its continent", () => {
    const places = allocateContinentalPlaces(comps, tablesFor(comps));
    const countryOfTid = new Map<number, string>();
    comps.forEach((c, i) => {
      for (let k = 0; k < 16; k++) countryOfTid.set(i * 100 + k, c.country);
    });
    for (const e of places.get("continental")!) expect(AMERICAS).not.toContain(e.country);
    for (const e of places.get("shield")!) expect(AMERICAS).not.toContain(e.country);
    const americas = places.get("americas")!;
    expect(americas).toHaveLength(16);
    for (const e of americas) expect(AMERICAS).toContain(e.country);
  });

  it("gives an American domestic cup winner an Americas Cup place from mid-table", () => {
    const brazil = comps.find((c) => c.country === "Brazil" && c.tier === 1)!;
    const tables = tablesFor(comps);
    const ninth = tables.get(brazil.id)![8].tid;
    const places = allocateContinentalPlaces(comps, tables, {
      domesticCupWinners: new Map([["Brazil", ninth]]),
    });
    const entry = places.get("americas")!.find((e) => e.tid === ninth);
    expect(entry?.route).toBe("domestic-cup");
    expect(places.get("americas")!.filter((e) => e.country === "Brazil")).toHaveLength(4);
  });

  it("ranks only European countries on the coefficient ladder", () => {
    const coeffs = countryCoefficients(comps, [], [], 10);
    for (const c of coeffs) expect(AMERICAS).not.toContain(c.country);
    // With no record there is nothing to reallocate, and no American league is
    // ever handed a Continental Cup place by it.
    expect(reallocateCupSlots(comps, coeffs)).toBeNull();
  });

  it("keeps the American strength and money ladders monotonic with Europe's", () => {
    const entries = Object.keys(COUNTRY_STRENGTH_OFFSET)
      .map((country) => ({ country, s: COUNTRY_STRENGTH_OFFSET[country], m: COUNTRY_BUDGET_SCALE[country] }));
    for (const a of entries) {
      for (const b of entries) {
        if (a.s > b.s) expect(a.m, `${a.country} weaker but richer than ${b.country}`).toBeLessThanOrEqual(b.m);
      }
    }
  });
});

describe("closed leagues", () => {
  const comps = worldCompetitions();

  it("swaps nobody in Mexico or the United States", () => {
    const tables = tablesFor(comps);
    for (const swap of computeCountrySwaps(comps, tables)) {
      const country = comps.find((c) => c.id === swap.d1CompId)!.country;
      if (country === "Mexico" || country === "United States") {
        expect(swap.promoted).toEqual([]);
        expect(swap.relegated).toEqual([]);
      }
    }
  });
});

describe("title playoffs", () => {
  const comps = worldCompetitions();

  it("is held by Argentina, Mexico and the United States, and only in their top flights", () => {
    const holders = comps.filter((c) => competitionTitlePlayoff(c) !== "none");
    expect(holders.map((c) => `${c.country}:${c.tier}`)).toEqual([
      "Argentina:1", "Mexico:1", "United States:1",
    ]);
    expect(competitionTitlePlayoff(holders.find((c) => c.country === "Mexico")!)).toBe("two-legged");
  });

  it("seats the table's top eight, best first", () => {
    // Real division sizes: MLS needs nine per conference out of its thirty.
    const tables = new Map(comps.map((c, i) => [c.id, table(i * 100, competitionTeamCount(c))]));
    const fields = titlePlayoffFields(comps, tables);
    expect(fields.map((f) => f.country)).toEqual(["Argentina", "Mexico", "United States"]);
    const mexico = comps.find((c) => c.country === "Mexico" && c.tier === 1)!;
    const field = fields.find((f) => f.country === "Mexico")!;
    expect(field.teams).toEqual(tables.get(mexico.id)!.slice(0, 8).map((r) => r.tid));
  });

  it("pairs 1v8, 4v5, 2v7 and 3v6 so the top two seeds meet only in the final", () => {
    expect(TITLE_PLAYOFF_QF_PAIRS).toEqual([[0, 7], [3, 4], [1, 6], [2, 5]]);
  });

  it("maps each decided playoff's winner onto its competition", () => {
    const playoffs = [
      { compId: 39, winnerTid: 704 },
      { compId: 42, winnerTid: null },
    ] as unknown as TitlePlayoff[];
    expect([...titleChampions(playoffs)]).toEqual([[39, 704]]);
  });
});

describe("the Intercontinental Cup", () => {
  const cup = (championTid: number): CupState => ({ championTid } as unknown as CupState);

  it("pairs the Continental Cup winner with the Americas Cup winner", () => {
    const superCups = buildSuperCups({
      competitions: worldCompetitions(),
      tablesByCompId: new Map(),
      championTidByCompId: {},
      domesticCups: [],
      cup: cup(3),
      shield: cup(40),
      americasCup: cup(650),
      season: 5,
    });
    const inter = superCups.find((sc) => sc.competition === "intercontinental");
    expect(inter?.teams).toEqual([3, 650]);
    expect(inter?.routes).toEqual(["continental-cup", "americas-cup"]);
  });

  it("is not built until both competitions have a champion", () => {
    const superCups = buildSuperCups({
      competitions: worldCompetitions(),
      tablesByCompId: new Map(),
      championTidByCompId: {},
      domesticCups: [],
      cup: cup(3),
      shield: cup(40),
      americasCup: null,
      season: 5,
    });
    expect(superCups.some((sc) => sc.competition === "intercontinental")).toBe(false);
  });
});
