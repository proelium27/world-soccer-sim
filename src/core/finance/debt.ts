import {
  BASE_SEASON_BUDGET,
  OVERDRAFT_LIMIT_FRACTION,
  DEBT_INTEREST_RATE,
  DEBT_EMBARGO_THRESHOLD,
  DEBT_DEDUCTION_THRESHOLD,
  DEBT_DEDUCTION_POINTS,
  DEBT_DEDUCTION_REPEAT_POINTS,
  DEBT_DEDUCTION_MAX_POINTS,
} from "../constants.js";

/**
 * A season's financial sanction against one club, decided in the offseason
 * from the balance it ended the previous season on and applied to the season
 * named here.
 *
 * One record per season in breach, appended to `LeagueStore.debtSanctions`.
 * Only the user's club is ever assessed (see the DEBT_* block in constants.ts
 * for why that containment matters), but the record carries a `tid` so nothing
 * here has to be rewritten if AI clubs are ever brought in.
 *
 * Deliberately kept free of any `LeagueStore` import so `leagueState.ts` can
 * import the type without a cycle — the same reason `international/career.ts`
 * sits apart from `players/types.ts`.
 */
export interface DebtSanction {
  /** The season the sanction APPLIES to, not the one that triggered it. */
  season: number;
  tid: number;
  /** The end-of-season balance that triggered it — negative, in pounds. */
  balance: number;
  /** Overdraft limit at the time, so the UI can show how deep the breach was. */
  limit: number;
  /** No signings, loans in, or purchases for this season. */
  embargo: boolean;
  /** Points docked from this season's league table. 0 when only embargoed. */
  pointsDeduction: number;
  /** How many seasons running the club has been in breach, this one included. */
  consecutiveSeasons: number;
}

/**
 * How far below zero a club may deliberately spend: a fraction of its own
 * scaled base income. Returns a positive magnitude — the floor on the balance
 * is the negation of it.
 *
 * `scale` is the club's `financeScaleFor(...)`, so this already carries both
 * the country/tier scale and (for the user) the difficulty multiplier.
 */
export function overdraftLimit(scale: number): number {
  return BASE_SEASON_BUDGET * scale * OVERDRAFT_LIMIT_FRACTION;
}

/**
 * The lowest balance a club may voluntarily spend down to. Wages can still
 * carry it below this involuntarily — see OVERDRAFT_LIMIT_FRACTION.
 */
export function minimumBalance(scale: number): number {
  return -overdraftLimit(scale);
}

/** Interest owed this season on a negative balance; 0 when in credit. */
export function debtInterest(budget: number): number {
  return budget < 0 ? -budget * DEBT_INTEREST_RATE : 0;
}

/** A balance with this season's interest taken off it. */
export function applyDebtInterest(budget: number): number {
  return budget - debtInterest(budget);
}

/**
 * Decide the sanction for `season` from the balance a club ended the previous
 * season on.
 *
 * `consecutiveSeasons` is how many seasons running the club was already in
 * breach before this one, which is what makes the deduction escalate — the
 * streak counts seasons past the EMBARGO line, not past the deduction line, so
 * a club that sits under embargo for two years and then tips over is treated
 * as a repeat offender rather than a first-timer. Returns null when the club
 * is clear, which is also what resets the streak.
 */
export function assessDebtSanction(
  season: number,
  tid: number,
  balance: number,
  scale: number,
  consecutiveSeasons: number,
): DebtSanction | null {
  const limit = overdraftLimit(scale);
  if (!(limit > 0)) return null;
  if (balance >= -limit * DEBT_EMBARGO_THRESHOLD) return null;

  const streak = consecutiveSeasons + 1;
  const pointsDeduction = balance < -limit * DEBT_DEDUCTION_THRESHOLD
    ? Math.min(
        DEBT_DEDUCTION_POINTS + (streak - 1) * DEBT_DEDUCTION_REPEAT_POINTS,
        DEBT_DEDUCTION_MAX_POINTS,
      )
    : 0;

  return { season, tid, balance, limit, embargo: true, pointsDeduction, consecutiveSeasons: streak };
}

/** The sanction in force against one club for one season, if any. */
export function debtSanctionFor(
  sanctions: readonly DebtSanction[] | undefined,
  season: number,
  tid: number,
): DebtSanction | undefined {
  return sanctions?.find((s) => s.season === season && s.tid === tid);
}

/**
 * How many seasons running a club was in breach up to and including `season`.
 *
 * Read straight off that season's own record rather than walked backwards:
 * `assessDebtSanction` already stores the running count, and a season with no
 * record is by definition a season the club was clear, which is what ends a
 * run. So this is the streak to hand back in when assessing the next season.
 */
export function breachStreak(
  sanctions: readonly DebtSanction[] | undefined,
  season: number,
  tid: number,
): number {
  return debtSanctionFor(sanctions, season, tid)?.consecutiveSeasons ?? 0;
}

/**
 * Points docked from each club in a competition this season, as the map
 * `computeStandings` takes. Empty when nobody is sanctioned, which is every
 * save that has never been in the red.
 */
export function pointsDeductionMap(
  sanctions: readonly DebtSanction[] | undefined,
  season: number,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of sanctions ?? []) {
    if (s.season === season && s.pointsDeduction > 0) out.set(s.tid, s.pointsDeduction);
  }
  return out;
}

/** Whether a club is barred from registering players this season. */
export function isUnderEmbargo(
  sanctions: readonly DebtSanction[] | undefined,
  season: number,
  tid: number,
): boolean {
  return debtSanctionFor(sanctions, season, tid)?.embargo ?? false;
}

/**
 * What a club is allowed to spend and register right now. Built by the caller
 * (which has the league in scope) and handed to the core spending paths, so
 * those keep their narrow signatures and every non-user path is unaffected.
 */
export interface SpendPolicy {
  /** Lowest balance this club may voluntarily spend down to; 0 means no credit. */
  minBalance: number;
  /** A sanction bars this club from registering anyone at all this season. */
  embargoed: boolean;
}

/** The spending policy for one club this season. */
export function spendPolicy(
  sanctions: readonly DebtSanction[] | undefined,
  season: number,
  tid: number,
  scale: number,
): SpendPolicy {
  return {
    minBalance: minimumBalance(scale),
    embargoed: isUnderEmbargo(sanctions, season, tid),
  };
}

/**
 * Whether a cost is payable under a policy.
 *
 * **An absent policy means the old rule — pay only from cash in hand.** That
 * is what keeps every path this is not wired into behaving exactly as it did,
 * including the automatic ones that must never be blocked — `ensureUserRosterSafety`
 * above all, which has to be able to field a legal XI whatever the books say.
 * Embargo is deliberately not folded in here: it bars a registration outright,
 * even a free one, so callers test it separately and can say which of the two
 * stopped them.
 */
export function affordable(budget: number, cost: number, policy?: SpendPolicy): boolean {
  return budget - cost >= (policy?.minBalance ?? 0);
}
