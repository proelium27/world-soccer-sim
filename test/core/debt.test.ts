import { describe, it, expect, beforeAll } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { playSeason } from "../helpers/offseasonLeague.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { simOffseason } from "../../src/core/offseason.js";
import { computeStandings } from "../../src/core/standings.js";
import { financeScaleFor } from "../../src/core/finance/budget.js";
import {
  overdraftLimit, minimumBalance, debtInterest, applyDebtInterest,
  assessDebtSanction, breachStreak, pointsDeductionMap, isUnderEmbargo,
  spendPolicy, affordable,
} from "../../src/core/finance/debt.js";
import {
  BASE_SEASON_BUDGET, OVERDRAFT_LIMIT_FRACTION, DEBT_INTEREST_RATE,
  DEBT_EMBARGO_THRESHOLD, DEBT_DEDUCTION_THRESHOLD, DEBT_DEDUCTION_POINTS,
  DEBT_DEDUCTION_REPEAT_POINTS, DEBT_DEDUCTION_MAX_POINTS,
} from "../../src/core/constants.js";
import { AUTOPILOT_TID } from "../../src/core/autopilot.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { DebtSanction } from "../../src/core/finance/debt.js";

const SEED = 4;

/** A sanction record, for the lookup tests. */
function sanction(over: Partial<DebtSanction> = {}): DebtSanction {
  return {
    season: 2, tid: 0, balance: -1, limit: 1,
    embargo: true, pointsDeduction: 0, consecutiveSeasons: 1, ...over,
  };
}

/** The user's club's finance scale, the one the sanction is assessed against. */
function userScale(league: LeagueStore): number {
  const tid = league.meta.userTid;
  const team = league.teams.find((t) => t.tid === tid)!;
  return financeScaleFor(league.competitions, team.compId, tid, tid, league.difficulty);
}

function setUserBudget(league: LeagueStore, budget: number): LeagueStore {
  return {
    ...league,
    teams: league.teams.map((t) => (t.tid === league.meta.userTid ? { ...t, budget } : t)),
  };
}

describe("debt: the overdraft", () => {
  it("scales with the club's own income", () => {
    expect(overdraftLimit(1)).toBe(BASE_SEASON_BUDGET * OVERDRAFT_LIMIT_FRACTION);
    // A poorer club gets proportionally less credit, so the lever means the
    // same thing at every rung of the ladder.
    expect(overdraftLimit(0.35)).toBeCloseTo(overdraftLimit(1) * 0.35, 6);
    expect(minimumBalance(1)).toBe(-overdraftLimit(1));
  });

  it("lets a club spend into the red, but only to the limit", () => {
    const policy = spendPolicy(undefined, 1, 0, 1);
    const limit = overdraftLimit(1);
    expect(affordable(0, limit / 2, policy)).toBe(true);
    expect(affordable(0, limit, policy)).toBe(true);
    expect(affordable(0, limit + 1, policy)).toBe(false);
  });

  /**
   * The absent-policy default is what keeps every path this is not wired into
   * behaving exactly as it did — above all the automatic ones (`ensureUser-
   * RosterSafety`) that must never be blocked, since a club that cannot field
   * eleven crashes the engine rather than degrading.
   */
  it("falls back to cash in hand when no policy is supplied", () => {
    expect(affordable(100, 100)).toBe(true);
    expect(affordable(100, 101)).toBe(false);
    expect(affordable(-1, 0)).toBe(false);
  });
});

describe("debt: interest", () => {
  it("is charged on a negative balance and nothing else", () => {
    expect(debtInterest(1_000_000)).toBe(0);
    expect(debtInterest(0)).toBe(0);
    expect(debtInterest(-1_000_000)).toBeCloseTo(1_000_000 * DEBT_INTEREST_RATE, 6);
  });

  it("compounds, because it deepens the balance it is next measured against", () => {
    const first = applyDebtInterest(-1_000_000);
    const second = applyDebtInterest(first);
    expect(first).toBeLessThan(-1_000_000);
    expect(second - first).toBeLessThan(first - -1_000_000);
  });
});

describe("debt: assessing a sanction", () => {
  const limit = overdraftLimit(1);

  it("leaves a club inside the embargo line alone", () => {
    expect(assessDebtSanction(2, 0, 0, 1, 0)).toBeNull();
    expect(assessDebtSanction(2, 0, -limit * DEBT_EMBARGO_THRESHOLD + 1, 1, 0)).toBeNull();
  });

  it("embargoes past the first line without docking points", () => {
    const s = assessDebtSanction(2, 0, -limit * DEBT_EMBARGO_THRESHOLD - 1, 1, 0)!;
    expect(s.embargo).toBe(true);
    expect(s.pointsDeduction).toBe(0);
    expect(s.season).toBe(2);
    expect(s.consecutiveSeasons).toBe(1);
  });

  it("docks points past the second line", () => {
    const s = assessDebtSanction(2, 0, -limit * DEBT_DEDUCTION_THRESHOLD - 1, 1, 0)!;
    expect(s.embargo).toBe(true);
    expect(s.pointsDeduction).toBe(DEBT_DEDUCTION_POINTS);
  });

  it("escalates while the club stays in breach, up to the cap", () => {
    const deep = -limit * DEBT_DEDUCTION_THRESHOLD - 1;
    expect(assessDebtSanction(2, 0, deep, 1, 1)!.pointsDeduction)
      .toBe(DEBT_DEDUCTION_POINTS + DEBT_DEDUCTION_REPEAT_POINTS);
    expect(assessDebtSanction(2, 0, deep, 1, 99)!.pointsDeduction)
      .toBe(DEBT_DEDUCTION_MAX_POINTS);
  });

  /**
   * A clear season returns null, and a season with no record reads a streak of
   * 0 — which is what makes one good year genuinely wipe the slate rather than
   * merely pausing the escalation.
   */
  it("resets the streak on a clear season", () => {
    const sanctions = [sanction({ season: 5, tid: 3, consecutiveSeasons: 4 })];
    expect(breachStreak(sanctions, 5, 3)).toBe(4);
    expect(breachStreak(sanctions, 6, 3)).toBe(0);
    expect(breachStreak(sanctions, 5, 9)).toBe(0);
    expect(breachStreak(undefined, 5, 3)).toBe(0);
  });
});

describe("debt: reading sanctions back", () => {
  const sanctions = [
    sanction({ season: 3, tid: 7, pointsDeduction: 6 }),
    sanction({ season: 3, tid: 8, pointsDeduction: 0 }),
    sanction({ season: 4, tid: 7, pointsDeduction: 9 }),
  ];

  it("maps only the docked clubs, only for the season asked", () => {
    const m = pointsDeductionMap(sanctions, 3);
    expect(m.get(7)).toBe(6);
    // Embargoed but not docked: it must not appear, or the table would show a
    // "-0" marker against a club whose points are untouched.
    expect(m.has(8)).toBe(false);
    expect(pointsDeductionMap(sanctions, 4).get(7)).toBe(9);
    expect(pointsDeductionMap(sanctions, 5).size).toBe(0);
    expect(pointsDeductionMap(undefined, 3).size).toBe(0);
  });

  it("reports the embargo per club per season", () => {
    expect(isUnderEmbargo(sanctions, 3, 7)).toBe(true);
    expect(isUnderEmbargo(sanctions, 5, 7)).toBe(false);
    expect(isUnderEmbargo(undefined, 3, 7)).toBe(false);
  });
});

describe("debt: the league table", () => {
  const matches = [
    { home: 1, away: 2, homeGoals: 3, awayGoals: 0 },
    { home: 2, away: 1, homeGoals: 1, awayGoals: 0 },
  ];

  it("is untouched when no deductions are passed", () => {
    const rows = computeStandings([1, 2], matches);
    expect(rows.map((r) => [r.tid, r.points])).toEqual([[1, 3], [2, 3]]);
    expect(rows.every((r) => r.deducted === undefined)).toBe(true);
  });

  /**
   * The deduction has to come off before the sort or a docked club sits where
   * its undocked total put it — which is the version of this feature that
   * shows a penalty and then quietly does not apply it.
   */
  it("docks points and re-sorts on the docked total", () => {
    const rows = computeStandings([1, 2], matches, new Map([[1, 3]]));
    expect(rows[0].tid).toBe(2);
    const docked = rows.find((r) => r.tid === 1)!;
    expect(docked.points).toBe(0);
    expect(docked.deducted).toBe(3);
    // W/D/L are untouched: only the points move, which is why the row has to
    // carry the reason for the gap.
    expect(docked.won).toBe(1);
  });

  it("ignores a club that is not in the table, and a zero deduction", () => {
    const rows = computeStandings([1, 2], matches, new Map([[99, 5], [1, 0]]));
    expect(rows.find((r) => r.tid === 1)!.points).toBe(3);
    expect(rows.every((r) => r.deducted === undefined)).toBe(true);
  });
});

describe("debt: the offseason", () => {
  /**
   * One played season shared by every case here. `simOffseason` is pure and
   * each case mutates only its own copy, and a full season is ~80s on the
   * shipped world — paying for it once rather than six times is the difference
   * between a file you run and one you skip.
   */
  let played: LeagueStore;
  let limit: number;
  beforeAll(() => {
    played = playSeason(makeLeague(0, SEED), mulberry32(SEED));
    limit = overdraftLimit(userScale(played));
  });

  /**
   * The whole feature end to end: end a season deep enough in the red and next
   * season opens embargoed and docked.
   *
   * The balance has to be set well past the line rather than just over it,
   * because season-end prize money and hype revenue land BEFORE the assessment
   * — which is the year-end reading the design rests on, and is pinned
   * separately below.
   */
  it("sanctions a club that ends the season deep in the red", () => {
    const broke = setUserBudget(played, -limit * 3);
    const rolled = simOffseason(broke, mulberry32(SEED));
    const s = (rolled.debtSanctions ?? []).find((x) => x.season === rolled.season);

    expect(s).toBeDefined();
    expect(s!.tid).toBe(0);
    expect(s!.embargo).toBe(true);
    expect(s!.pointsDeduction).toBe(DEBT_DEDUCTION_POINTS);
    expect(s!.consecutiveSeasons).toBe(1);
    expect(isUnderEmbargo(rolled.debtSanctions, rolled.season, 0)).toBe(true);
    expect(pointsDeductionMap(rolled.debtSanctions, rolled.season).get(0))
      .toBe(DEBT_DEDUCTION_POINTS);
  });

  it("leaves a solvent club unsanctioned", () => {
    const rolled = simOffseason(played, mulberry32(SEED));
    expect(rolled.debtSanctions ?? []).toHaveLength(0);
  });

  /**
   * Prize money settles BEFORE the assessment, so a club marginally in the red
   * at the final whistle is paid out of it rather than sanctioned. That is the
   * year-end reading, and it is what makes "sell before the season ends" the
   * instruction the UI gives.
   */
  it("assesses the balance after prize money, not before", () => {
    const marginal = setUserBudget(played, -limit * DEBT_EMBARGO_THRESHOLD - 1);
    expect(simOffseason(marginal, mulberry32(SEED)).debtSanctions ?? []).toHaveLength(0);
  });

  /**
   * Isolated by comparing two DEEP debts rather than a debt against zero: both
   * runs stay in the red the whole way through, so the only thing that can
   * separate them by more than the extra borrowing is the interest charged on
   * it. Against a solvent run the season's income swamps the effect.
   */
  it("charges interest on a balance still in the red at the season start", () => {
    const extra = 10_000_000;
    const budgetOf = (l: LeagueStore) => l.teams.find((t) => t.tid === 0)!.budget;

    const shallower = simOffseason(setUserBudget(played, -limit * 3), mulberry32(SEED));
    const deeper = simOffseason(setUserBudget(played, -limit * 3 - extra), mulberry32(SEED));

    const gap = budgetOf(shallower) - budgetOf(deeper);
    expect(gap).toBeGreaterThan(extra);
    expect(gap).toBeCloseTo(extra * (1 + DEBT_INTEREST_RATE), -3);
  });

  /**
   * A jumped or spectated save has a `userTid` no club holds, so nobody is
   * assessed — the same reason the board review sits one out. Without this a
   * jump could end with a sanction against a club the user never managed.
   */
  it("assesses nobody when no club is the user's", () => {
    const broke = setUserBudget(played, -limit * 3);
    for (const tid of [AUTOPILOT_TID, SPECTATOR_TID]) {
      const rolled = simOffseason(
        { ...broke, meta: { ...broke.meta, userTid: tid } }, mulberry32(SEED),
      );
      expect(rolled.debtSanctions ?? []).toHaveLength(0);
    }
  });

  /**
   * The containment the whole feature rests on: no AI club is ever assessed,
   * whatever its balance. If this fails, the feature has reached the world and
   * needs scripts/weakLeaguesAudit.ts run on both sides before it can ship.
   */
  it("never sanctions an AI club", () => {
    const bankrupt = {
      ...played,
      teams: played.teams.map((t) => (t.tid === 0 ? t : { ...t, budget: -500_000_000 })),
    };
    const rolled = simOffseason(bankrupt, mulberry32(SEED));
    expect(rolled.debtSanctions ?? []).toHaveLength(0);
  });
});
