import type { LeagueStore } from "../core/leagueState.js";
import { financeScaleFor } from "../core/finance/budget.js";
import {
  spendPolicy, overdraftLimit, debtInterest, debtSanctionFor,
  type SpendPolicy, type DebtSanction,
} from "../core/finance/debt.js";
import { DEBT_EMBARGO_THRESHOLD, DEBT_DEDUCTION_THRESHOLD } from "../core/constants.js";

/**
 * The user's club's finances as every debt-aware surface needs to see them.
 *
 * One derivation shared by the spending actions, the Finance panel and the
 * Dashboard warning, so the page that tells you how much room you have and the
 * action that refuses the signing cannot disagree — the same reason
 * `saleGateFor` was extracted for "would his club sell?".
 */
export interface UserDebtView {
  /** Current balance. Negative means the club is in the red. */
  balance: number;
  /** How far below zero the club may deliberately spend. */
  limit: number;
  /** What is left of the overdraft; 0 once it is spent. */
  headroom: number;
  /** True when the balance is below zero at all. */
  inDebt: boolean;
  /** Interest this balance would be charged at the next season start. */
  interestNext: number;
  /** The balance at which ending the season costs a registration embargo. */
  embargoAt: number;
  /** The balance at which ending the season also costs points. */
  deductionAt: number;
  /** The sanction in force this season, if any. */
  sanction: DebtSanction | undefined;
  /** What ending the season on today's balance would cost next season. */
  projected: "clear" | "embargo" | "deduction";
}

/** The user's club's spending policy, or undefined when there is no club. */
export function userSpendPolicy(league: LeagueStore): SpendPolicy | undefined {
  const tid = league.meta.userTid;
  const team = league.teams.find((t) => t.tid === tid);
  if (!team) return undefined;
  return spendPolicy(
    league.debtSanctions,
    league.season,
    tid,
    financeScaleFor(league.competitions, team.compId, tid, tid, league.difficulty),
  );
}

/**
 * The user's club's debt position, or null when there is no club (a spectator
 * save, or a jump in progress).
 *
 * `projected` is the load-bearing field for the UI: the sanction is read off
 * the balance at the FINAL WHISTLE, so a player needs to be told during the
 * season what today's balance would cost him, in time to sell his way out.
 * Telling him only once the penalty has landed is the version of this feature
 * that just feels arbitrary.
 */
export function userDebtView(league: LeagueStore): UserDebtView | null {
  const tid = league.meta.userTid;
  const team = league.teams.find((t) => t.tid === tid);
  if (!team) return null;

  const scale = financeScaleFor(league.competitions, team.compId, tid, tid, league.difficulty);
  const limit = overdraftLimit(scale);
  const balance = team.budget;
  const embargoAt = -limit * DEBT_EMBARGO_THRESHOLD;
  const deductionAt = -limit * DEBT_DEDUCTION_THRESHOLD;

  return {
    balance,
    limit,
    headroom: Math.max(0, balance + limit),
    inDebt: balance < 0,
    interestNext: debtInterest(balance),
    embargoAt,
    deductionAt,
    sanction: debtSanctionFor(league.debtSanctions, league.season, tid),
    projected: balance < deductionAt ? "deduction" : balance < embargoAt ? "embargo" : "clear",
  };
}
