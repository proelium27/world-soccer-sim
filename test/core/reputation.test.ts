import { describe, it, expect } from "vitest";
import {
  leagueCeiling, finishScore, continentalScore, reputationTarget, stepReputation, teamReputation,
  type ReputationSeason,
} from "../../src/core/teams/reputation.js";
import { seedReputations } from "../../src/core/teams/reputationSeed.js";
import { worldCompetitions, type Competition } from "../../src/core/competitions.js";
import type { CupState } from "../../src/core/cup/types.js";
import {
  REPUTATION_MAX, REPUTATION_CONTINENTAL_WON, REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL,
  REPUTATION_CONTINENTAL_PLAYOFF, REPUTATION_CONTINENTAL_OPENING, REPUTATION_COMPETITION_SCALE,
} from "../../src/core/constants.js";
import { makeLeague } from "../helpers/league.js";

const comps = worldCompetitions();
const division = (country: string, tier: number): Competition =>
  comps.find((c) => c.country === country && c.tier === tier)!;
const england = division("England", 1);
const serbia = division("Serbia", 1);
const englandD2 = division("England", 2);

const season = (over: Partial<ReputationSeason> = {}): ReputationSeason => ({
  finish: finishScore(england, 8, 20),
  champion: false,
  domesticCup: false,
  continental: 0,
  promoted: false,
  relegated: false,
  ...over,
});

/**
 * A minimal finished Swiss cup: an 8-slot bracket (QF, SF, final) plus a
 * playoff. Club 1 won it, 2 lost the final, 3 went out in the semis, 5 in the
 * quarters, 9 in the playoff, and 10 in the league phase.
 */
function cup(competition: CupState["competition"] = "continental"): CupState {
  return {
    competition,
    teams: [1, 8, 5, 4, 3, 6, 2, 7],
    leaguePhase: { teams: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    playoff: { ties: [{ round: -1, home: 9, away: 8, winner: 8 }] },
    ties: [
      { round: 0, home: 1, away: 5, winner: 1 },
      { round: 1, home: 1, away: 3, winner: 1 },
      { round: 2, home: 1, away: 2, winner: 1 },
    ],
  } as unknown as CupState;
}

describe("club reputation", () => {
  it("a bottom English top-flight finish outranks the Serbian champion's", () => {
    expect(finishScore(england, 20, 20)).toBeGreaterThan(finishScore(serbia, 1, 16));
    expect(leagueCeiling(englandD2)).toBeLessThan(leagueCeiling(england));
    expect(finishScore(england, 1, 1)).toBe(leagueCeiling(england));
  });

  it("scores a continental run by how far the club went, scaled by competition", () => {
    const c = cup();
    expect(continentalScore(c, 1)).toBe(REPUTATION_CONTINENTAL_WON);
    expect(continentalScore(c, 2)).toBe(REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL[0]);
    expect(continentalScore(c, 3)).toBe(REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL[1]);
    expect(continentalScore(c, 5)).toBe(REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL[2]);
    expect(continentalScore(c, 9)).toBe(REPUTATION_CONTINENTAL_PLAYOFF);
    expect(continentalScore(c, 10)).toBe(REPUTATION_CONTINENTAL_OPENING);
    expect(continentalScore(c, 99)).toBe(0);
    expect(continentalScore(null, 1)).toBe(0);
    expect(continentalScore(cup("shield"), 1)).toBe(REPUTATION_CONTINENTAL_WON * REPUTATION_COMPETITION_SCALE.shield);
  });

  // From an eighth-place finish in England: winning the Continental Cup, then
  // losing its final, then a semi-final, all beat climbing to first and taking
  // the title, which beats the domestic cup. docs/club-reputation.md, Stage 2.
  it("orders seasons: cup win > final > semi-final > league title > domestic cup > plain finish", () => {
    const winner = reputationTarget(season({ continental: REPUTATION_CONTINENTAL_WON }));
    const final = reputationTarget(season({ continental: REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL[0] }));
    const semi = reputationTarget(season({ continental: REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL[1] }));
    const title = reputationTarget(season({ finish: finishScore(england, 1, 20), champion: true }));
    const cupWin = reputationTarget(season({ domesticCup: true }));
    const plain = reputationTarget(season());
    expect(winner).toBeGreaterThan(final);
    expect(final).toBeGreaterThan(semi);
    expect(semi).toBeGreaterThan(title);
    expect(title).toBeGreaterThan(cupWin);
    expect(cupWin).toBeGreaterThan(plain);
  });

  it("relegation lowers the target, and the target is clamped", () => {
    const bottom = season({ finish: finishScore(england, 20, 20) });
    expect(reputationTarget({ ...bottom, relegated: true })).toBeLessThan(reputationTarget(bottom));
    expect(reputationTarget(season({ continental: 500 }))).toBe(REPUTATION_MAX);
    expect(reputationTarget(season({ finish: -50 }))).toBe(0);
  });

  it("rises faster than it falls, and stays on the scale", () => {
    const up = stepReputation(50, 70) - 50;
    const down = 50 - stepReputation(50, 30);
    expect(up).toBeGreaterThan(down);
    expect(down).toBeGreaterThan(0);
    expect(stepReputation(50, 50)).toBe(50);
    expect(stepReputation(99, 1000)).toBeLessThanOrEqual(REPUTATION_MAX);
  });

  it("falls back to hype only when a club has no reputation", () => {
    expect(teamReputation({ reputation: 40, hype: 70 })).toBe(40);
    expect(teamReputation({ hype: 70 })).toBe(70);
  });

  it("seeds every club of a new world on the finish scale, strongest squads highest", () => {
    const league = makeLeague(0, 1);
    for (const t of league.teams) expect(t.reputation).toBeTypeOf("number");
    const byComp = (c: Competition) => league.teams.filter((t) => t.compId === c.id).map((t) => t.reputation!);
    expect(Math.max(...byComp(england))).toBeCloseTo(leagueCeiling(england));
    expect(Math.min(...byComp(england))).toBeGreaterThan(Math.max(...byComp(serbia)));

    // A club without a value is seeded; one with a value is left alone unless forced.
    const stripped = league.teams.map((t, i) => (i === 0 ? { ...t, reputation: undefined } : t));
    const reseeded = seedReputations(stripped, league.competitions, league.players);
    expect(reseeded[0].reputation).toBe(league.teams[0].reputation);
    expect(reseeded[1]).toBe(stripped[1]);
    expect(seedReputations(league.teams, league.competitions, league.players)).toBe(league.teams);
  });
});
