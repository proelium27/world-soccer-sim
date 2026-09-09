import { describe, it, expect } from "vitest";
import {
  EMPTY_PLAYER_FILTERS,
  hasAnyFilter,
  moneyFilter,
  numFilter,
  toSearchFilters,
} from "../../src/ui/components/PlayerFilterBar.js";
import {
  encodeScope, worldCompetitions, strongestCountries, TOP_LEAGUE_COUNTRY_COUNT,
} from "../../src/core/competitions.js";

const COMPS = worldCompetitions();

describe("numFilter", () => {
  it("reads an empty or blank box as no constraint", () => {
    expect(numFilter("")).toBeNull();
    expect(numFilter("   ")).toBeNull();
  });

  it("rejects text rather than passing NaN into the search", () => {
    expect(numFilter("abc")).toBeNull();
  });

  it("reads a number", () => {
    expect(numFilter("70")).toBe(70);
    expect(numFilter("0")).toBe(0);
  });
});

describe("moneyFilter", () => {
  it("keeps a bare number in dollars, so old-style entries still mean the same", () => {
    expect(moneyFilter("50000000")).toBe(50_000_000);
    expect(moneyFilter("50,000,000")).toBe(50_000_000);
  });

  it("accepts the shorthand people actually type", () => {
    expect(moneyFilter("50m")).toBe(50_000_000);
    expect(moneyFilter("50M")).toBe(50_000_000);
    expect(moneyFilter("2.5m")).toBe(2_500_000);
    expect(moneyFilter("800k")).toBe(800_000);
    expect(moneyFilter("$50m")).toBe(50_000_000);
    expect(moneyFilter(" 50 m ")).toBe(50_000_000);
  });

  it("is no constraint when empty or unparseable", () => {
    expect(moneyFilter("")).toBeNull();
    expect(moneyFilter("lots")).toBeNull();
    expect(moneyFilter("50bn")).toBeNull();
  });
});

describe("hasAnyFilter", () => {
  it("is false for a cleared bar and true once any field is set", () => {
    expect(hasAnyFilter(EMPTY_PLAYER_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY_PLAYER_FILTERS, nationality: "Portugal" })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY_PLAYER_FILTERS, maxWage: "200k" })).toBe(true);
  });
});

describe("toSearchFilters", () => {
  it("turns a cleared bar into an all-null constraint set", () => {
    const f = toSearchFilters(EMPTY_PLAYER_FILTERS, COMPS);
    expect(f.position).toBeUndefined();
    expect(f.nationality).toBeUndefined();
    // Null rather than a set holding every id, so the candidate scan can skip
    // the membership test entirely on the common case.
    expect(f.compIds).toBeNull();
    expect(f.minOvr).toBeNull();
    expect(f.maxValue).toBeNull();
    expect(f.maxWeeklyWage).toBeNull();
    expect(f.maxContractYears).toBeNull();
  });

  it("parses each field into the units the core search expects", () => {
    const f = toSearchFilters({
      ...EMPTY_PLAYER_FILTERS,
      position: "ST",
      nationality: "Spain",
      scope: encodeScope({ kind: "competition", compId: 2 }),
      minOvr: "70",
      maxOvr: "80",
      minAge: "18",
      maxAge: "24",
      minValue: "5m",
      maxValue: "50m",
      maxWage: "200k",
      maxContractYears: "1",
    }, COMPS);
    expect(f.compIds).toEqual(new Set([2]));
    expect(f).toMatchObject({
      position: "ST",
      nationality: "Spain",
      minOvr: 70,
      maxOvr: 80,
      minAge: 18,
      maxAge: 24,
      minValue: 5_000_000,
      maxValue: 50_000_000,
      maxWeeklyWage: 200_000,
      maxContractYears: 1,
    });
  });

  it("keeps a contract filter of 0 (expiring now) rather than dropping it as falsy", () => {
    expect(
      toSearchFilters({ ...EMPTY_PLAYER_FILTERS, maxContractYears: "0" }, COMPS).maxContractYears,
    ).toBe(0);
  });

  it("resolves a scope preset to the competitions it actually covers", () => {
    const top = toSearchFilters(
      { ...EMPTY_PLAYER_FILTERS, scope: encodeScope({ kind: "tier", tier: 1 }) },
      COMPS,
    ).compIds;
    expect(top).not.toBeNull();
    expect([...top!].sort((a, b) => a - b))
      .toEqual(COMPS.filter((c) => c.tier === 1).map((c) => c.id).sort((a, b) => a - b));

    // "Top N leagues" is the strongest countries' top flights, derived from the
    // world's own ladder rather than from a list of country names.
    const five = toSearchFilters(
      {
        ...EMPTY_PLAYER_FILTERS,
        scope: encodeScope({ kind: "topLeagues", countries: TOP_LEAGUE_COUNTRY_COUNT }),
      },
      COMPS,
    ).compIds;
    const countries = strongestCountries(COMPS, TOP_LEAGUE_COUNTRY_COUNT);
    expect(five!.size).toBe(TOP_LEAGUE_COUNTRY_COUNT);
    for (const id of five!) {
      const comp = COMPS.find((c) => c.id === id)!;
      expect(comp.tier).toBe(1);
      expect(countries).toContain(comp.country);
    }
  });
});
