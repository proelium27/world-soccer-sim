import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { offseasonCoefficientSlots } from "../../src/core/cup/coefficients.js";
import { detachNews } from "../../src/core/simArchive.js";
import { COEFFICIENT_MIN_SEASONS, CUP_STRONG_LEAGUE_SLOTS, CUP_WEAK_LEAGUE_SLOTS } from "../../src/core/constants.js";
import type { CupState } from "../../src/core/cup/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * The rolling coefficient reads the archived cups, and the sim worker is handed
 * those archives empty (`detachNews`). Worked out inside the worker, then, no
 * country ever had enough seasons of record and the allocation always fell back
 * to the fixed strength classes, with nothing to say so. The fix works the slots
 * out on the main thread and hands them in (`OffseasonInputs.cupSlots`).
 */
describe("coefficient slots across the worker boundary", () => {
  const base = makeLeague(0, 11);
  const belgium = base.competitions.find((c) => c.country === "Belgium" && c.tier === 1)!;
  const europe = base.competitions.filter(
    (c) => c.tier === 1 && ["England", "Spain", "Italy", "Germany", "France", "Belgium"].includes(c.country),
  );

  /** A finished cup in which Belgium's club won every tie and the title. */
  function cup(season: number): CupState {
    const entrants = europe.map((c) => base.teams.find((t) => t.compId === c.id)!.tid);
    const belgian = entrants[europe.indexOf(belgium)];
    return {
      competition: "continental", season, name: "Continental Cup",
      teams: [], seeds: {}, leaguePhase: { teams: entrants, matches: [] },
      playoff: null, playIn: null, ties: [], championTid: belgian,
      twoLegged: true, koLegs: null, statLines: null,
    } as unknown as CupState;
  }

  // Seasons of record: COEFFICIENT_MIN_SEASONS - 1 archived plus the live cup.
  const archived = Array.from({ length: COEFFICIENT_MIN_SEASONS - 1 }, (_, i) =>
    cup(base.season - COEFFICIENT_MIN_SEASONS + 1 + i));
  const full: LeagueStore = {
    ...base, cupHistory: archived, cup: cup(base.season), rollingCoefficients: true,
  };

  it("reallocates places off the full history", () => {
    const slots = offseasonCoefficientSlots(full)!;
    expect(slots).not.toBeNull();
    // Belgium tops the coefficient, so it moves up from the weak-league count.
    expect(CUP_WEAK_LEAGUE_SLOTS).toBeLessThan(CUP_STRONG_LEAGUE_SLOTS);
    expect(slots.get(belgium.id)?.continental).toBe(CUP_STRONG_LEAGUE_SLOTS);
  });

  it("finds no record on what the worker is handed, which is why it is precomputed", () => {
    const { payload } = detachNews(full);
    expect(offseasonCoefficientSlots(payload)).toBeNull();
  });

  it("survives the protocol's entries round trip", () => {
    const slots = offseasonCoefficientSlots(full)!;
    expect(new Map([...slots])).toEqual(slots);
  });

  it("stays off for a save with rolling coefficients switched off", () => {
    expect(offseasonCoefficientSlots({ ...full, rollingCoefficients: false })).toBeNull();
  });
});
