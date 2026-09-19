/**
 * The board's verdict on a season.
 *
 * Confidence is a running 0-100 balance rather than a "last N seasons" rule, for
 * two reasons. It's legible — the user can watch it move and know exactly where
 * they stand — and it lets goodwill be *banked*: a manager who overachieved for
 * three years survives a bad fourth, which a consecutive-seasons counter can't
 * express.
 *
 * Pure and rng-free. Nothing here touches a player, a valuation or the shared
 * rng stream — it decides which club the user owns, not anything about the world.
 */
import {
  MANAGER_CONFIDENCE_SWING,
  MANAGER_TITLE_CONFIDENCE,
  MANAGER_TROPHY_CONFIDENCE,
  MANAGER_RELEGATION_CONFIDENCE,
  MANAGER_PROMOTION_CONFIDENCE,
  MANAGER_MISSED_PLAYOFFS_CONFIDENCE,
  MANAGER_CONTINENTAL_RUN_SWING,
  MANAGER_CONTINENTAL_PLACE_CONFIDENCE,
  MANAGER_DEMAND_PENALTY_SCALE,
  MANAGER_DEMAND_REWARD_DAMPING,
  MANAGER_GRACE_SEASONS,
  MANAGER_SACK_THRESHOLD,
  MANAGER_CONFIDENCE_DANGER,
  MANAGER_CONFIDENCE_UNEASY,
  MANAGER_CONFIDENCE_RECOVERY,
  MANAGER_START_CONFIDENCE,
} from "../constants.js";
import type { PlayoffJudgement } from "./playoffExpectation.js";
import type { ContinentalRunJudgement, QualificationJudgement } from "./continentalExpectation.js";

/** What the club achieved, and what the board made of it. */
export interface SeasonVerdict {
  /** Where the club finished, 1 = champions. */
  finish: number;
  /** Where its squad said it should finish. */
  expectedRank: number;
  clubs: number;
  /** Finish versus expectation as a fraction of the division; see `overperformance`. */
  overperformance: number;
  /** 1 if the club won its division. */
  titles: number;
  /** Cups won this season (domestic cup, shield, Continental Cup). */
  trophies: number;
  promoted: boolean;
  relegated: boolean;
  /** How demanding this board is, [0,1]. */
  demand: number;
  /** How far confidence moved, before clamping. */
  delta: number;
  /** Confidence after the verdict, 0-100. */
  confidence: number;
  /** The board has dismissed you. */
  sacked: boolean;
  /**
   * Set in a league whose title is decided by a playoff: the season was judged
   * on the playoff run rather than the table (see playoffExpectation.ts).
   * Optional, so a verdict stored before this reads as a table verdict.
   */
  playoff?: PlayoffJudgement;
  /** Continental qualification against what the board expected. Optional: absent on older verdicts. */
  qualification?: QualificationJudgement;
  /** This season's continental run against the club's seed, if it played in one. */
  continentalRun?: ContinentalRunJudgement;
}

export interface SeasonFacts {
  finish: number;
  expectedRank: number;
  clubs: number;
  demand: number;
  titles: number;
  trophies: number;
  promoted: boolean;
  relegated: boolean;
  /** A playoff league's run, which replaces the table as what the board judges. */
  playoff?: PlayoffJudgement;
  qualification?: QualificationJudgement;
  continentalRun?: ContinentalRunJudgement;
}

const clamp01to100 = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * Apply a season to a manager's standing with the board.
 *
 * `seasonsAtClub` is the number of seasons already completed here, so the grace
 * period is counted in seasons *survived*, not seasons in charge — a manager
 * appointed in the summer has always had a full window before the first season
 * that can cost them the job.
 */
export function judgeSeason(
  facts: SeasonFacts,
  confidence: number,
  seasonsAtClub: number,
  sackingEnabled: boolean,
  boardPatience: number,
): SeasonVerdict {
  const { finish, expectedRank, clubs, demand, playoff } = facts;
  // In a playoff league both sides are playoff places rather than table places.
  const expectedPlace = playoff ? playoff.expectedPlace : expectedRank;
  const actualPlace = playoff ? playoff.actualPlace : finish;
  const over = clubs > 1 ? (expectedPlace - actualPlace) / (clubs - 1) : 0;

  // Boards forget, in both directions. Applied before the verdict so a manager
  // who is merely meeting expectations slowly climbs out of a bad patch instead
  // of being stuck one season from the sack forever, and so a title six years
  // ago stops working as a permanent shield.
  const remembered =
    confidence + (MANAGER_START_CONFIDENCE - confidence) * MANAGER_CONFIDENCE_RECOVERY;

  // The finish itself, asymmetric in the board's demands: a big club's board
  // treats success as the baseline (damped reward) and failure as a crisis
  // (amplified penalty). That asymmetry is the difficulty knob the user asked
  // to scale with the league.
  const withDemand = (v: number): number =>
    v >= 0
      ? v * (1 - demand * MANAGER_DEMAND_REWARD_DAMPING)
      : v * (1 + demand * MANAGER_DEMAND_PENALTY_SCALE);
  let delta = withDemand(over * MANAGER_CONFIDENCE_SWING);

  // The continental run against the club's seed, with the same asymmetry: a
  // big club going out early is a crisis, a small one going deep a bonus.
  const run = facts.continentalRun;
  if (run && run.field > 1) {
    delta += withDemand(
      ((run.expectedPlace - run.actualPlace) / (run.field - 1)) * MANAGER_CONTINENTAL_RUN_SWING,
    );
  }
  // Qualifying, per rung above or below the ask. Flat, like trophies.
  if (facts.qualification) delta += facts.qualification.rungs * MANAGER_CONTINENTAL_PLACE_CONFIDENCE;

  // Trophies and division changes are judged flat, not scaled by demand. A
  // trophy is a trophy: damping a superclub's cup win toward nothing would make
  // the one unambiguously good outcome in football worth almost no goodwill.
  delta += facts.titles * MANAGER_TITLE_CONFIDENCE;
  delta += facts.trophies * MANAGER_TROPHY_CONFIDENCE;
  if (facts.promoted) delta += MANAGER_PROMOTION_CONFIDENCE;
  if (facts.relegated) delta += MANAGER_RELEGATION_CONFIDENCE;
  if (playoff?.missed) delta += MANAGER_MISSED_PLAYOFFS_CONFIDENCE;

  // The save's difficulty setting is the global patience knob: an easy board
  // banks your good seasons and shrugs off your bad ones, a brutal one does the
  // reverse. Applied last, to the whole verdict rather than to the finish alone,
  // so a difficulty level moves job security uniformly instead of quietly
  // re-weighting trophies against league position.
  const patience = boardPatience > 0 ? boardPatience : 1;
  delta = delta >= 0 ? delta * patience : delta / patience;

  const next = clamp01to100(remembered + delta);
  // Relegation is never an automatic sacking — a manager who overachieved all
  // the way to the drop can have banked enough goodwill to get another year,
  // which is a judgement a flat "relegated = fired" rule can't make.
  const sacked =
    sackingEnabled && next <= MANAGER_SACK_THRESHOLD && seasonsAtClub >= MANAGER_GRACE_SEASONS;

  return {
    finish,
    expectedRank,
    clubs,
    overperformance: over,
    titles: facts.titles,
    trophies: facts.trophies,
    promoted: facts.promoted,
    relegated: facts.relegated,
    demand,
    delta,
    confidence: next,
    sacked,
    ...(playoff ? { playoff } : {}),
    ...(facts.qualification ? { qualification: facts.qualification } : {}),
    ...(run ? { continentalRun: run } : {}),
  };
}

export type ConfidenceMood = "secure" | "settled" | "uneasy" | "danger";

/** The plain-language read on a confidence number, for UI. */
export function confidenceMood(confidence: number, sackingEnabled: boolean): ConfidenceMood {
  if (!sackingEnabled) return "secure";
  if (confidence < MANAGER_CONFIDENCE_DANGER) return "danger";
  if (confidence < MANAGER_CONFIDENCE_UNEASY) return "uneasy";
  if (confidence < 75) return "settled";
  return "secure";
}

export function confidenceLabel(mood: ConfidenceMood): string {
  switch (mood) {
    case "danger": return "On thin ice";
    case "uneasy": return "Under pressure";
    case "settled": return "Backed";
    case "secure": return "Secure";
  }
}
