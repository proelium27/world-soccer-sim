import { describe, it, expect } from "vitest";
import type { CupState, LeaguePhaseMatch, CupTie } from "../../src/core/cup/types.js";
import { worldCompetitions, competitionRegion } from "../../src/core/competitions.js";
import {
  countryCoefficients, reallocateCupSlots, coefficientSlots,
} from "../../src/core/cup/coefficients.js";
import { cupSlotsForCompetition } from "../../src/core/cup/qualification.js";
import {
  CONTINENTAL_CUP_FORMAT, CUP_LEAGUE_PHASE_SIZE, COEFFICIENT_MIN_SEASONS,
} from "../../src/core/constants.js";

const comps = worldCompetitions();
// Europe's top flights only: the coefficient is a Continental Cup mechanic, and
// an American league holds no Continental Cup places to rank or reallocate.
const tier1 = comps.filter((c) => c.tier === 1 && competitionRegion(c) === "europe");

/** One club per tier-1 league, tid = league index, so a country is a tid. */
const teams = tier1.map((c, i) => ({ tid: i, compId: c.id }));

function lpMatch(home: number, away: number, hg: number, ag: number): LeaguePhaseMatch {
  return { round: 0, matchday: 3, home, away, played: true, homeGoals: hg, awayGoals: ag, boxScore: null };
}

function tie(round: number, home: number, away: number, winner: number): CupTie {
  return {
    round, matchday: 31, home, away, homeGoals: 1, awayGoals: 0,
    wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0,
    winner, boxScore: null,
  };
}

/** A minimal archived cup: whoever is named entered it, plus the given results. */
function cup(season: number, entrants: number[], matches: LeaguePhaseMatch[], ties: CupTie[] = [], championTid: number | null = null): CupState {
  return {
    competition: "continental",
    season,
    name: "Continental Cup",
    teams: [],
    seeds: {},
    leaguePhase: { teams: entrants, matches },
    playoff: null,
    playIn: null,
    ties,
    championTid,
    twoLegged: true,
    koLegs: null,
    statLines: null,
  };
}

describe("country coefficients", () => {
  it("ranks a country that wins its continental matches above one that loses them", () => {
    const history = [cup(2, [0, 1], [lpMatch(0, 1, 3, 0), lpMatch(1, 0, 0, 1)])];
    const coeffs = countryCoefficients(comps, teams, [history], 3);
    const byCountry = new Map(coeffs.map((c) => [c.country, c]));
    expect(byCountry.get(tier1[0].country)!.coefficient)
      .toBeGreaterThan(byCountry.get(tier1[1].country)!.coefficient);
  });

  it("divides by clubs entered, so sending more clubs is not itself worth anything", () => {
    // Country A sends two clubs (0, 1), country B one (2). Every one of them
    // plays the same two matches against a neutral club from a third country
    // and wins one, so per-club form is identical and the two coefficients must
    // come out equal despite A having twice the raw points.
    const mixed = [
      { tid: 0, compId: tier1[0].id }, { tid: 1, compId: tier1[0].id },
      { tid: 2, compId: tier1[1].id }, { tid: 3, compId: tier1[2].id },
    ];
    const history = [cup(2, [0, 1, 2, 3], [
      lpMatch(0, 3, 1, 0), lpMatch(3, 0, 1, 0),
      lpMatch(1, 3, 1, 0), lpMatch(3, 1, 1, 0),
      lpMatch(2, 3, 1, 0), lpMatch(3, 2, 1, 0),
    ])];
    const coeffs = countryCoefficients(comps, mixed, [history], 3);
    const byCountry = new Map(coeffs.map((c) => [c.country, c]));
    const a = byCountry.get(tier1[0].country)!;
    const b = byCountry.get(tier1[1].country)!;
    expect(a.clubsEntered).toBe(2);
    expect(b.clubsEntered).toBe(1);
    expect(a.points).toBe(b.points * 2); // twice the clubs, twice the raw points
    expect(a.coefficient).toBeCloseTo(b.coefficient, 10);
  });

  it("only counts seasons inside the rolling window", () => {
    const old = [cup(1, [0, 1], [lpMatch(0, 1, 5, 0)])];
    const recent = [cup(20, [0, 1], [lpMatch(1, 0, 5, 0)])];
    const coeffs = countryCoefficients(comps, teams, [old, recent], 21);
    const byCountry = new Map(coeffs.map((c) => [c.country, c]));
    // Only season 20 is in range, and league index 1 won it.
    expect(byCountry.get(tier1[1].country)!.coefficient)
      .toBeGreaterThan(byCountry.get(tier1[0].country)!.coefficient);
  });

  it("pools both continental competitions, the way the real coefficient does", () => {
    const cupHistory = [cup(2, [0], [])];
    const shieldHistory = [{ ...cup(2, [1], [lpMatch(1, 0, 2, 0)]), competition: "shield" as const }];
    const coeffs = countryCoefficients(comps, teams, [cupHistory, shieldHistory], 3);
    const byCountry = new Map(coeffs.map((c) => [c.country, c]));
    expect(byCountry.get(tier1[1].country)!.points).toBeGreaterThan(0);
  });

  it("pays for going deep, not just for winning group games", () => {
    const shallow = cup(2, [0, 1], [lpMatch(0, 1, 1, 0)]);
    const deep = cup(2, [0, 1], [lpMatch(0, 1, 1, 0)], [tie(2, 1, 0, 1)], 1);
    const flat = countryCoefficients(comps, teams, [[shallow]], 3);
    const run = countryCoefficients(comps, teams, [[deep]], 3);
    const of = (cs: typeof flat, country: string) => cs.find((c) => c.country === country)!.coefficient;
    expect(of(run, tier1[1].country)).toBeGreaterThan(of(flat, tier1[1].country));
  });
});


/**
 * The same competition replayed over enough seasons to clear
 * COEFFICIENT_MIN_SEASONS, so a reallocation test is measuring the ranking
 * rather than the too-little-history guard.
 */
function overSeasons(
  entrants: number[],
  matches: LeaguePhaseMatch[],
  ties: CupTie[] = [],
  championTid: number | null = null,
): { history: CupState[]; season: number } {
  const history = Array.from(
    { length: COEFFICIENT_MIN_SEASONS },
    (_, i) => cup(2 + i, entrants, matches, ties, championTid),
  );
  return { history, season: 2 + COEFFICIENT_MIN_SEASONS };
}

describe("slot reallocation", () => {
  it("is zero-sum: the world sends exactly as many clubs as before", () => {
    const before = tier1.reduce((n, c) => n + cupSlotsForCompetition(c, CONTINENTAL_CUP_FORMAT), 0);
    expect(before).toBe(CUP_LEAGUE_PHASE_SIZE);

    // A world turned upside down: the weakest league has the best record.
    const { history, season } = overSeasons(tier1.map((_, i) => i), [
      lpMatch(7, 0, 3, 0), lpMatch(7, 1, 3, 0), lpMatch(6, 2, 2, 0),
    ]);
    const slots = reallocateCupSlots(comps, countryCoefficients(comps, teams, [history], season))!;
    const after = [...slots.values()].reduce((a, b) => a + b, 0);
    expect(after).toBe(before);
  });

  it("hands the same ladder of counts back out, only in a different order", () => {
    const before = tier1
      .map((c) => cupSlotsForCompetition(c, CONTINENTAL_CUP_FORMAT))
      .sort((a, b) => a - b);
    const { history, season } = overSeasons(tier1.map((_, i) => i), [lpMatch(7, 0, 3, 0), lpMatch(6, 1, 2, 0)]);
    const slots = reallocateCupSlots(comps, countryCoefficients(comps, teams, [history], season))!;
    expect([...slots.values()].sort((a, b) => a - b)).toEqual(before);
  });

  it("promotes the country with the best continental record to the top of the ladder", () => {
    // The last league in the world wins everything; it should get the most places.
    const weakest = tier1[tier1.length - 1];
    const { history, season } = overSeasons(tier1.map((_, i) => i), tier1.slice(0, -1).map(
      (_, i) => lpMatch(tier1.length - 1, i, 2, 0),
    ));
    const slots = reallocateCupSlots(comps, countryCoefficients(comps, teams, [history], season))!;
    const top = Math.max(...slots.values());
    expect(slots.get(weakest.id)).toBe(top);
  });

  it("never leaves a league with no way back: everyone keeps a place", () => {
    const { history, season } = overSeasons(tier1.map((_, i) => i), [lpMatch(0, 1, 9, 0)]);
    const slots = reallocateCupSlots(comps, countryCoefficients(comps, teams, [history], season))!;
    for (const n of slots.values()) expect(n).toBeGreaterThanOrEqual(1);
  });

  it("declines to reallocate before there is any record to rank on", () => {
    expect(reallocateCupSlots(comps, countryCoefficients(comps, teams, [[]], 2))).toBeNull();
    expect(coefficientSlots(comps, teams, [[]], 2, true)).toBeNull();
  });

  it("declines on one noisy season, however lopsided it was", () => {
    // Measured on a real dynasty: with no floor, season 3 reallocated off a
    // single season and handed Belgium four places while dropping Germany to
    // two, then reverted. A world's first cups are its noisiest data.
    const history = [cup(2, tier1.map((_, i) => i), [lpMatch(7, 0, 9, 0), lpMatch(7, 1, 9, 0)])];
    expect(coefficientSlots(comps, teams, [history], 3, true)).toBeNull();

    // The same lopsided season, sustained, does move places.
    const sustained = overSeasons(tier1.map((_, i) => i), [lpMatch(7, 0, 9, 0), lpMatch(7, 1, 9, 0)]);
    expect(coefficientSlots(comps, teams, [sustained.history], sustained.season, true)).not.toBeNull();
  });

  it("leaves a league its author gave no Cup place with no Cup place", () => {
    // A custom world can put a league outside the Cup entirely. That is a
    // decision about the world, not something the reordering did, so the
    // "everyone keeps a place" floor must not overrule it — and the total still
    // has to come out the same.
    const optedOut = comps.map((c) => (
      c.id === tier1[3].id ? { ...c, continentalSlots: { continental: 0 } } : c
    ));
    const optedOutTier1 = optedOut.filter((c) => c.tier === 1);
    const base = optedOutTier1.reduce(
      (n, c) => n + cupSlotsForCompetition(c, CONTINENTAL_CUP_FORMAT), 0,
    );

    const { history, season } = overSeasons(tier1.map((_, i) => i), [lpMatch(7, 0, 3, 0)]);
    const slots = reallocateCupSlots(
      optedOut, countryCoefficients(optedOut, teams, [history], season),
    )!;
    expect([...slots.values()].reduce((a, b) => a + b, 0)).toBe(base);
    expect([...slots.values()].filter((n) => n === 0)).toHaveLength(1);
  });

  it("reallocates nothing at all when the save turned the setting off", () => {
    // The save-scoped switch (LeagueStore.rollingCoefficients). Same history
    // that provably moves places above, so a null here is the setting and not
    // an absence of record.
    const { history, season } = overSeasons(tier1.map((_, i) => i), [lpMatch(7, 0, 3, 0)]);
    expect(coefficientSlots(comps, teams, [history], season, true)).not.toBeNull();
    expect(coefficientSlots(comps, teams, [history], season, false)).toBeNull();
  });

  it("moves the Cup's places only, leaving the Shield's alone", () => {
    const { history, season } = overSeasons(tier1.map((_, i) => i), [lpMatch(7, 0, 3, 0)]);
    const slots = coefficientSlots(comps, teams, [history], season, true)!;
    for (const entry of slots.values()) {
      expect(entry.continental).toBeGreaterThanOrEqual(1);
      expect(entry.shield).toBeUndefined();
    }
  });
});
