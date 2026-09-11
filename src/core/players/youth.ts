import type { Player, Position } from "./types.js";
import { POSITIONS } from "./types.js";
import { generatePlayer, softFloorBase, entryGrowthDebt } from "./generate.js";
import type { NationalityWeights } from "./nationalities.js";
import {
  YOUTH_AGE, YOUTH_INTAKE_MIN, YOUTH_INTAKE_MAX, YOUTH_BASE_OFFSET,
  YOUTH_CONTRACT_LENGTH, ROSTER_COMPOSITION, YOUTH_BASE_REFERENCE_AGE,
  SCOUT_POSITION_SHARE, type ProgressionModel,
} from "../constants.js";

/**
 * The strength base a club's youth are generated around: its academy anchor
 * dropped by YOUTH_BASE_OFFSET, then eased onto a soft floor so it can never
 * fall far enough below RATING_MIN to clamp a whole intake into rubble. See
 * YOUTH_BASE_FLOOR in constants.ts for the measurements and for why this is a
 * softplus rather than a `Math.max` or a proportional offset.
 *
 * Strictly monotonic in `academyBase` (a weaker academy always yields a weaker
 * base) and identity to within 0.05 once the raw base clears ~20, so clubs that
 * were never underflowing generate exactly what they generated before.
 */
export function youthGenerationBase(academyBase: number): number {
  return softFloorBase(academyBase - YOUTH_BASE_OFFSET);
}

/**
 * The same base, split per rating group and charged for entering below
 * `YOUTH_BASE_REFERENCE_AGE`.
 *
 * WHY THIS EXISTS RATHER THAN A BIGGER `YOUTH_BASE_OFFSET`. Ratings are rolled
 * with no age term, so taking a player in a year early does not make him rawer,
 * it hands him an extra year on the growth side of the age curve - and every
 * player in the world with him. Measured on a 20-season dynasty with no
 * correction at all, that is **+5 OVR in every country** and weak-league
 * solvency goes with it. `entryGrowthDebt` is exactly what that year is worth,
 * so subtracting it leaves him arriving at his peak where he always did.
 *
 * It has to be PER GROUP. Physicals and skills read the curve 4.5 years apart,
 * so the extra year is worth 2.70 to one and 3.00 to the other, and a scalar
 * cannot say that. Two scalar levers were built and measured before this and
 * both failed: raising `YOUTH_BASE_OFFSET` is eaten by the soft floor (~0.27 OVR
 * per point, so parity needs ~42, which flattens every academy onto the floor),
 * and extending the age curve's left tail closed only a quarter of the gap
 * because it never reaches physicals at all.
 *
 * THE FLOOR IS APPLIED ONCE, AFTER the debt, and that ordering matters:
 * `softFloorBase` is not idempotent (it lifts a value sitting on the floor), so
 * flooring the scalar first and charging the debt afterwards would both
 * double-bend the weak clubs and let the debt push them back under.
 */
export function youthGenerationBases(
  academyBase: number,
  age: number,
  pos: Position,
  model: ProgressionModel,
): { physical: number; skill: number } {
  const raw = academyBase - YOUTH_BASE_OFFSET;
  const debt = entryGrowthDebt(age, YOUTH_BASE_REFERENCE_AGE, pos, model);
  return {
    physical: softFloorBase(raw - debt.physical),
    skill: softFloorBase(raw - debt.skill),
  };
}

/**
 * Cumulative distribution over positions, weighted by ROSTER_COMPOSITION.
 * A uniform draw overproduced low-slot positions (AM/DM keep only 2 per
 * squad vs 4 for CB/FB/CM): each offseason the surplus — including good ones
 * no club had a free slot for — drained into free agency, so the FA list
 * filled with a wall of the same couple of positions while CB/FB slowly ran
 * short over long dynasties. Weighting intake by how many of each position a
 * roster actually wants keeps the pipeline matched to demand. Precomputed
 * once so the pick below is still a single rng() draw (RNG-stream count
 * unchanged; only the position it maps to moves).
 */
const POSITION_CDF: { pos: Position; cum: number }[] = (() => {
  const total = POSITIONS.reduce((s, p) => s + ROSTER_COMPOSITION[p], 0);
  let running = 0;
  return POSITIONS.map((pos) => {
    running += ROSTER_COMPOSITION[pos] / total;
    return { pos, cum: running };
  });
})();

/** Draw a position from a cumulative table, consuming one rng() draw. */
function weightedPosition(r: number, cdf = POSITION_CDF): Position {
  for (const { pos, cum } of cdf) {
    if (r < cum) return pos;
  }
  return cdf[cdf.length - 1].pos; // fp guard on the last bin
}

/**
 * The position table for a club whose scouts have been told what to look for:
 * the targets take SCOUT_POSITION_SHARE of the draw between them, and
 * ROSTER_COMPOSITION supplies the rest.
 *
 * **A skew, not a filter**, for the same reason the country blend is one — an
 * intake of nothing but strikers reads as a bug rather than a plan, and would
 * leave the academy unable to feed the positions the user isn't thinking about
 * this year. The targets split their share evenly: he picked them, and ranking
 * them for him would be a number he cannot see.
 *
 * Still exactly ONE rng draw, as the plain table is, so a caller that passes
 * targets advances the stream identically to one that doesn't. That is what
 * would allow this anywhere — though it deliberately is not used anywhere but
 * the trial extras, because the position decides which TIER ROW the ratings are
 * rolled from and those draw counts differ. See SCOUT_POSITION_SHARE.
 */
function targetedPositionCdf(targets: readonly Position[]): { pos: Position; cum: number }[] {
  const wanted = new Set(targets);
  if (wanted.size === 0) return POSITION_CDF;

  const perTarget = SCOUT_POSITION_SHARE / wanted.size;
  // What is left goes to everyone else, spread by roster demand as usual.
  const restTotal = POSITIONS
    .filter((pos) => !wanted.has(pos))
    .reduce((sum, pos) => sum + ROSTER_COMPOSITION[pos], 0);

  let running = 0;
  return POSITIONS.map((pos) => {
    running += wanted.has(pos)
      ? perTarget
      // restTotal is 0 only if every position is a target, which the picker's
      // SCOUT_POSITION_MAX cap makes unreachable; guarded so it degrades to an
      // even spread rather than dividing by zero.
      : restTotal > 0
        ? (1 - SCOUT_POSITION_SHARE) * (ROSTER_COMPOSITION[pos] / restTotal)
        : (1 - SCOUT_POSITION_SHARE) / POSITIONS.length;
    return { pos, cum: running };
  });
}

/**
 * Generate one club's youth intake for the season: 3-5 raw teenagers at
 * `YOUTH_AGE`, quality anchored to the club's fixed generation-time academy
 * strength (a
 * stand-in for the budget-weighted intake described in the spec, until
 * finances are designed) — NOT the club's current roster average, which
 * would let any random upward drift in the roster compound into every future
 * intake and inflate the league without bound over a long dynasty.
 * Assigns fresh pids starting at `nextPid` and returns them alongside the
 * next free pid for the caller to continue from.
 */
export function generateYouthIntake(
  rng: () => number,
  academyBase: number,
  season: number,
  nextPid: number,
  genSeed = 0,
  homeCountry?: string,
  nationalities?: NationalityWeights | null,
  /**
   * Exact number to generate, for the user's youth trial group (see
   * YOUTH_TRIAL_GROUP_MIN). Omitted, the count is drawn from `rng` as always —
   * so passing it also SKIPS that draw, which is why the trial top-up must run
   * on its own stream rather than the shared one.
   */
  countOverride?: number,
  /**
   * The positions the user's scouts were told to look for, and ONLY ever for
   * his trial group's scouted extras. It does not change the rng draw COUNT — a
   * position is still one draw off a cumulative table — but it changes which
   * player comes out, because the position decides which tier row his ratings
   * are rolled from, and those draw counts differ. So passing this anywhere
   * that runs on the shared stream re-rolls the world.
   */
  directions?: { positions?: readonly Position[] },
  /**
   * The save's development model. Matters more here than anywhere else it is
   * threaded: a trialist's listed potential is the *only* thing the Youth
   * Intake screen gives the user to choose five of twelve on, and he is not
   * re-estimated until the end of his first offseason — i.e. long after the
   * decision. Scaling a draw, never the count, so this cannot re-roll a world.
   */
  model: ProgressionModel = "random",
): { players: Player[]; nextPid: number } {
  const count = countOverride ?? YOUTH_INTAKE_MIN
    + Math.floor(rng() * (YOUTH_INTAKE_MAX - YOUTH_INTAKE_MIN + 1));
  const base = youthGenerationBase(academyBase);
  const cdf = targetedPositionCdf(directions?.positions ?? []);

  const players: Player[] = [];
  let pid = nextPid;
  for (let i = 0; i < count; i++) {
    const pos = weightedPosition(rng(), cdf);
    // Deliberately the FLAT base, not a per-group one charged for arriving
    // young. That was built, measured and abandoned: see `entryGrowthDebt`. The
    // extra year is paid for in `progressPlayer` instead, which is the only
    // place the payment cannot be clamped away.
    const p = generatePlayer(
      rng, pos, base, pid++, YOUTH_AGE, season, genSeed, homeCountry, nationalities, model,
    );
    p.contract.expiresSeason = season + YOUTH_CONTRACT_LENGTH;
    players.push(p);
  }

  return { players, nextPid: pid };
}
