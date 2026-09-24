/**
 * Club reputation: a slow-moving 0-100 record of what a club has won and where
 * it plays. docs/club-reputation.md, Stage 2.
 *
 * ONE world scale. The finish score starts from the league's ceiling, which
 * falls with the league's strength offset and with each division below the top
 * flight, so a club at the bottom of the Premier League outranks the Serbian
 * champion by construction.
 *
 * Each offseason a target is built from that season's achievements only: the
 * league finish, a title, the domestic cup, the continental run, promotion or
 * relegation. There is deliberately no squad-strength and no hype term, so a
 * club cannot buy reputation by assembling a squad; it has to win something
 * with it. Reputation then moves part of the way toward the target, quickly up
 * and slowly down, so a famous club keeps some of its name through a bad
 * decade and a newly rich one takes years to earn one.
 *
 * Pure and rng-free. Must not import ai/clubContext.ts (that imports this
 * module's readers, and the cycle would bite); seeding, which does need squad
 * strength, lives in reputationSeed.ts.
 */
import type { Competition } from "../competitions.js";
import { competitionStrengthOffset } from "../competitions.js";
import type { CupState } from "../cup/types.js";
import { clubCupRun, koFinalRound, CUP_STAGE_PLAYOFF, CUP_STAGE_LEAGUE_PHASE } from "../cup/cup.js";
import type { StoredTeam } from "./clubs.js";
import {
  REPUTATION_MAX, REPUTATION_RISE_RATE, REPUTATION_FALL_RATE, REPUTATION_FINISH_TOP,
  REPUTATION_FINISH_SPREAD_SHARE, REPUTATION_PER_OFFSET_SHARE, REPUTATION_TIER_FACTOR, REPUTATION_TITLE_BONUS,
  REPUTATION_DOMESTIC_CUP_BONUS, REPUTATION_PROMOTION_BONUS, REPUTATION_RELEGATION_PENALTY,
  REPUTATION_CONTINENTAL_WON, REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL,
  REPUTATION_CONTINENTAL_PLAYOFF, REPUTATION_CONTINENTAL_OPENING, REPUTATION_COMPETITION_SCALE,
} from "../constants.js";

/** The finish score for top of this division: lower for a weaker league and for each tier down. */
export function leagueCeiling(comp: Competition): number {
  return REPUTATION_FINISH_TOP
    * Math.max(0, 1 - REPUTATION_PER_OFFSET_SHARE * competitionStrengthOffset(comp))
    * REPUTATION_TIER_FACTOR ** (comp.tier - 1);
}

/** The finish score for `rank` (1 = top) in a division of `size` clubs. */
export function finishScore(comp: Competition, rank: number, size: number): number {
  const ceiling = leagueCeiling(comp);
  if (size <= 1) return ceiling;
  return ceiling * (1 - REPUTATION_FINISH_SPREAD_SHARE * (rank - 1) / (size - 1));
}

/**
 * What a club's run in one continental competition is worth. 0 when there is no
 * cup or the club was not in it. Scaled by REPUTATION_COMPETITION_SCALE, so the
 * Shield counts for less than the Cup.
 */
export function continentalScore(cup: CupState | null | undefined, tid: number): number {
  if (!cup) return 0;
  const run = clubCupRun(cup, tid);
  if (!run) return 0;
  let base: number;
  if (run.round === CUP_STAGE_LEAGUE_PHASE) {
    base = REPUTATION_CONTINENTAL_OPENING;
  } else if (run.round === CUP_STAGE_PLAYOFF) {
    base = REPUTATION_CONTINENTAL_PLAYOFF;
  } else {
    const final = koFinalRound(cup);
    if (run.round === final && run.wonRound) {
      base = REPUTATION_CONTINENTAL_WON;
    } else {
      const table = REPUTATION_CONTINENTAL_BY_ROUNDS_FROM_FINAL;
      const fromFinal = Math.max(0, final - run.round);
      base = table[Math.min(fromFinal, table.length - 1)];
    }
  }
  return base * (REPUTATION_COMPETITION_SCALE[cup.competition] ?? 1);
}

export interface ReputationSeason {
  /** `finishScore` for where the club finished, in the division it played in. */
  finish: number;
  /** Won the league: a top flight's champion, a lower division's title-playoff winner, else its table-topper. */
  champion: boolean;
  domesticCup: boolean;
  /** Sum of `continentalScore` over every continental competition. */
  continental: number;
  promoted: boolean;
  relegated: boolean;
}

/** The reputation a club's season earns, clamped to [0, REPUTATION_MAX]. */
export function reputationTarget(s: ReputationSeason): number {
  const raw = s.finish
    + (s.champion ? REPUTATION_TITLE_BONUS : 0)
    + (s.domesticCup ? REPUTATION_DOMESTIC_CUP_BONUS : 0)
    + s.continental
    + (s.promoted ? REPUTATION_PROMOTION_BONUS : 0)
    - (s.relegated ? REPUTATION_RELEGATION_PENALTY : 0);
  return Math.max(0, Math.min(REPUTATION_MAX, raw));
}

/** One season's move toward the target: quickly up, slowly down. */
export function stepReputation(current: number, target: number): number {
  const rate = target > current ? REPUTATION_RISE_RATE : REPUTATION_FALL_RATE;
  const next = current + (target - current) * rate;
  return Math.max(0, Math.min(REPUTATION_MAX, next));
}

/**
 * A club's reputation. The hype fallback is a last resort only: every team is
 * seeded at world creation, roster import and migration, so a missing value
 * means a hand-built fixture rather than a real save.
 */
export function teamReputation(t: Pick<StoredTeam, "reputation" | "hype">): number {
  return t.reputation ?? t.hype;
}
