import type { Player, PlayerRatings, SkillKey } from "./types.js";
import { computeOvr } from "./ovr.js";
import { changedPosition } from "./positions.js";
import { gaussian, hashInts, mulberry32 } from "../../engine/rng.js";
import {
  BASE_AGE_CURVE_PEAK, PHYSICAL_AGE_SHIFT, SKILL_AGE_SHIFT,
  GK_AGE_SHIFT,
  MINUTES_FACTOR_MIN, MINUTES_FACTOR_MAX, FULL_SEASON_APPEARANCES,
  PROGRESSION_PROFILES, potentialBar, type ProgressionModel, type ProgressionProfile,
  GROWTH_DAMPING_START,
  GENERATIONAL_CHANCE, GENERATIONAL_DAMPING_END, GENERATIONAL_DAMPING_FLOOR,
  GENERATIONAL_BIAS_MIN_Z,
  POTENTIAL_SIM_TRIALS, POTENTIAL_SIM_MAX_AGE, POTENTIAL_SIM_PERCENTILE,
  RATING_MIN, RATING_MAX,
  RETIREMENT_START_AGE, RETIREMENT_BASE_PROB, RETIREMENT_PROB_PER_YEAR,
  RETIREMENT_ROSTERED_DAMPING, RETIREMENT_UNROSTERED_BASE, RETIREMENT_MAX_PROB,
  RETIREMENT_PROSPECT_POT_THRESHOLD, RETIREMENT_PROSPECT_MAX_AGE,
} from "../constants.js";

/** Salt distinguishing this hash use from other pid-keyed hashes (e.g. identity rng). */
const DEV_BIAS_SALT = 0x4445_5642; // "DEVB"
/** Salt for the generational-talent flag (must differ from every other pid-keyed salt). */
const GENERATIONAL_SALT = 0x4745_4E54; // "GENT"

/**
 * Whether this player is a once-in-a-generation talent — a fixed, hidden
 * trait derived deterministically from pid (same pattern as developmentBias:
 * never drawn from the shared rng stream, so introducing it shifts nothing
 * else). Generational players develop under a much softer growth-damping
 * curve (see GENERATIONAL_* in constants.ts) and can genuinely reach the
 * 90+ OVR range the normal curve makes unreachable.
 */
export function isGenerational(pid: number): boolean {
  return mulberry32(hashInts(GENERATIONAL_SALT, pid))() < GENERATIONAL_CHANCE;
}

/**
 * A player's fixed development "personality": a standard-normal z-score
 * derived deterministically from their pid, not drawn from the shared rng
 * stream (so introducing/tuning this never shifts other players' generated
 * ratings/names/etc. — see the RNG-stream-order lesson). Positive = trends
 * toward a clean developer every season; negative = trends toward a bust.
 * Same value for a given pid every time it's read, so it applies
 * consistently across a player's whole career.
 */
function developmentBias(pid: number): number {
  return gaussian(mulberry32(hashInts(DEV_BIAS_SALT, pid)));
}

/** Physical ratings peak earliest and decline first. */
const PHYSICAL_KEYS: readonly SkillKey[] = ["speed", "strength", "stamina", "jumping"];
/** Everything else: technical/mental skills (plus goalkeeping) peak later and decline slower. */
const SKILL_KEYS_GROUP: readonly SkillKey[] = [
  "shortPass", "longPass", "crosses", "dribbling", "longShot", "finishing",
  "tackling", "interceptions", "positioning", "goalkeeping",
];

const clampRating = (x: number): number =>
  Math.round(Math.max(RATING_MIN, Math.min(RATING_MAX, x)));

/** Piecewise-linear interpolation over sorted [x, y] control points, clamped at the ends. */
function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** Age at the given season, derived from the player's birth season. */
export function ageOf(player: Player, season: number): number {
  return season - player.born;
}

/** Base expected rating delta for an age, read off the model's curve (keyed by age - peak). */
function baseAgeDelta(profile: ProgressionProfile, effectiveAge: number): number {
  return interpolate(profile.ageCurve, effectiveAge - BASE_AGE_CURVE_PEAK);
}

/** Linearly interpolate a young/old std dev pair by age (narrows as players age). */
function sdAt(young: number, old: number, age: number): number {
  return young + (old - young) * Math.max(0, Math.min(1, (age - 18) / (RETIREMENT_START_AGE - 18)));
}

/**
 * Development bias's std dev, tapering to 0 by peak age (not retirement age
 * like `sdAt` above). A persistent per-player bias that kept a nonzero
 * contribution all the way through decline years would give a lucky
 * player's rating group a nonzero *expected lifetime delta* over a
 * 15+-season career — precisely the compounding failure mode
 * `SKILL_AGE_SHIFT`/`GK_AGE_SHIFT` were tuned to close (see their comment).
 * Confining the bias to growth years keeps its effect to "how this prospect
 * develops," not "this veteran defies the aging curve forever."
 */
function biasSdAt(young: number, age: number): number {
  return young * Math.max(0, 1 - Math.max(0, age - 18) / (BASE_AGE_CURVE_PEAK - 18));
}

/**
 * Scales down the *positive* part of a season's development as current ovr
 * climbs through [GROWTH_DAMPING_START, GROWTH_DAMPING_END] toward
 * GROWTH_DAMPING_FLOOR — big breakout jumps should get rarer the closer a
 * player already is to elite, independent of age. 1 (no damping) at/below
 * the start of the range, GROWTH_DAMPING_FLOOR at/above the end.
 */
function growthDamping(profile: ProgressionProfile, ovr: number, generational: boolean): number {
  // Generational talents damp on a much softer curve (same start, far higher
  // end and floor) — elite is resistible, legendary is merely rare. Deliberately
  // NOT read off the profile: a generational talent is a property of the player,
  // not of the save's development model, and both shipped models put the same
  // numbers in `dampingEnd`/`dampingFloor` anyway (see PROGRESSION_PROFILES for
  // why relaxing them for "steady" was built, measured and reverted).
  const end = generational ? GENERATIONAL_DAMPING_END : profile.dampingEnd;
  const floor = generational ? GENERATIONAL_DAMPING_FLOOR : profile.dampingFloor;
  if (ovr <= GROWTH_DAMPING_START) return 1;
  if (ovr >= end) return floor;
  const t = (ovr - GROWTH_DAMPING_START) / (end - GROWTH_DAMPING_START);
  return 1 - t * (1 - floor);
}

/**
 * One season of rating movement: each rating group (physical vs. skill,
 * further shifted for GKs) reads its own expected delta off the base age
 * curve, nudged by `minutesFactor` during growth years only; decline years
 * are age/group-driven alone. On top of that mean, the player's fixed
 * `developmentBias` (same sign/scale every season — a clean developer or a
 * bust) and a per-group "form" roll (fresh gaussian each season, shared
 * across every rating in that group) combine into a single per-group
 * delta; if that combined delta is positive, `growthDamping` scales it down
 * based on the player's *current* ovr (declines are never damped — a bust
 * should decline just as easily whether they're rated 55 or 75). Finally,
 * independent per-rating noise applies on top, undamped. Per-rating noise
 * alone would mostly cancel out once averaged into a weighted ovr across
 * 10+ ratings, making real breakout/bust seasons statistically
 * near-impossible; the shared bias/form terms survive that averaging and
 * are what actually swings ovr season to season. Shared by real progression
 * and potential's forward simulation so both use the exact same development
 * model. Does not mutate the input.
 *
 * Which curve and which spreads it reads come from the save's
 * `ProgressionModel` (see `PROGRESSION_PROFILES`). **The model scales the
 * draws, never the draw COUNT**: both `gaussian(rng)` calls below happen
 * whatever the profile says, and `gaussian` is itself exactly two `rng()`
 * draws with no rejection loop. So switching a save's model advances the
 * shared stream identically — which is what makes the setting safe to flip
 * mid-save, and what lets `"random"` be provably the game as it was.
 */
function stepRatings(
  rng: () => number,
  profile: ProgressionProfile,
  ratings: PlayerRatings,
  age: number,
  pos: Player["pos"],
  minutesFactor: number,
  pid: number,
  heightCm: number,
): PlayerRatings {
  const gkShift = pos === "GK" ? GK_AGE_SHIFT : 0;
  const noiseSd = sdAt(profile.noiseSdYoung, profile.noiseSdOld, age);
  const formSd = sdAt(profile.formSdYoung, profile.formSdOld, age);
  const biasSd = biasSdAt(profile.biasSdYoung, age);
  const generational = isGenerational(pid);
  // A generational talent's development personality is floored at a solidly
  // positive z — never a total bust, though per-season form rolls still vary
  // (a slump season stays possible; the trend doesn't).
  const biasZ = generational
    ? Math.max(developmentBias(pid), GENERATIONAL_BIAS_MIN_Z)
    : developmentBias(pid);
  const bias = biasZ * biasSd;
  const damping = growthDamping(profile, computeOvr(pos, ratings, heightCm), generational);
  const next = { ...ratings };
  for (const [group, shift] of [
    [PHYSICAL_KEYS, gkShift + PHYSICAL_AGE_SHIFT],
    [SKILL_KEYS_GROUP, gkShift + SKILL_AGE_SHIFT],
  ] as const) {
    const base = baseAgeDelta(profile, age + shift);
    const mean = base > 0 ? base * minutesFactor : base;
    const formRoll = gaussian(rng) * formSd;
    const combined = mean + bias + formRoll;
    const dampedCombined = combined > 0 ? combined * damping : combined;
    for (const key of group) {
      next[key] = clampRating(next[key] + dampedCombined + gaussian(rng) * noiseSd);
    }
  }
  return next;
}

/**
 * Potential (BBGM-style): a scout's *estimate*, not a growth ceiling — it has
 * no influence on progressPlayer. Computed by simulating a player's future
 * career forward POTENTIAL_SIM_TRIALS times using the same age-curve model
 * (assuming average future playing time), tracking the peak ovr reached in
 * each trial, and reading off the POTENTIAL_SIM_PERCENTILE. So on average a
 * player exceeds this number about 25% of the time, matching real careers
 * where most players fall short of their potential but some meet or beat it.
 *
 * Because it forward-simulates with the *save's own* development model, a
 * `"steady"` save's estimate is a far sharper forecast than a `"random"`
 * one's — sixteen trials of a near-deterministic career agree with each other.
 * That is the correct reading rather than a degenerate one: in a world where
 * luck no longer decides careers, a scout genuinely can tell you where a
 * prospect ends up, and the scouting fog (`potentialFog`) becomes the only
 * thing standing between the user and that answer.
 *
 * `model` defaults to `"random"` — the shipped model, and the model every
 * save that predates the setting is on — so a caller that does not care
 * (tests, probes, fixtures) gets the game as it was. The three call paths
 * that *must* pass it are world generation, youth intake and roster import,
 * all of which reach here via `generatePlayer`; a steady save that forgot one
 * would misprice exactly the prospects its Youth Intake screen is asking the
 * user to choose between, so `progressionModel.test.ts` pins each of them.
 */
export function estimatePotential(
  rng: () => number,
  ratings: PlayerRatings,
  ovr: number,
  age: number,
  pos: Player["pos"],
  heightCm: number,
  pid: number,
  model: ProgressionModel = "random",
): number {
  const profile = PROGRESSION_PROFILES[model];
  const peaks: number[] = [];
  for (let trial = 0; trial < POTENTIAL_SIM_TRIALS; trial++) {
    let simRatings = ratings;
    let peak = ovr;
    for (let simAge = age + 1; simAge <= POTENTIAL_SIM_MAX_AGE; simAge++) {
      simRatings = stepRatings(rng, profile, simRatings, simAge, pos, 1, pid, heightCm);
      const simOvr = computeOvr(pos, simRatings, heightCm);
      if (simOvr > peak) peak = simOvr;
    }
    peaks.push(peak);
  }
  peaks.sort((a, b) => a - b);
  const idx = Math.min(peaks.length - 1, Math.floor(POTENTIAL_SIM_PERCENTILE * peaks.length));
  return peaks[idx];
}

/**
 * Season-end rating movement (see stepRatings) followed by a fresh potential
 * estimate off the new ratings. Does not mutate the input.
 */
export function progressPlayer(
  rng: () => number,
  player: Player,
  season: number,
  inAcademy = false,
  model: ProgressionModel = "random",
): Player {
  const profile = PROGRESSION_PROFILES[model];
  const age = ageOf(player, season);

  let minutesFactor: number;
  if (inAcademy) {
    // Academy players have no senior appearances to read minutes from, but
    // they train full-time — assume a full season rather than reading their
    // (always-zero) senior stats and penalizing them for not playing games
    // they're not eligible for.
    minutesFactor = MINUTES_FACTOR_MAX;
  } else {
    const lastSeasonStats = player.stats.find((s) => s.season === season);
    const appearances = lastSeasonStats?.appearances ?? 0;
    minutesFactor = MINUTES_FACTOR_MIN
      + (MINUTES_FACTOR_MAX - MINUTES_FACTOR_MIN)
        * Math.max(0, Math.min(1, appearances / FULL_SEASON_APPEARANCES));
  }

  // He trains as what he currently is, so the rating step reads his old
  // position; only once the season's development has landed do we ask whether
  // it has made him something else.
  const ratings = stepRatings(rng, profile, player.ratings, age, player.pos, minutesFactor, player.pid, player.heightCm);
  const pos = changedPosition(player, ratings) ?? player.pos;
  const ovr = computeOvr(pos, ratings, player.heightCm);
  const potential = estimatePotential(rng, ratings, ovr, age, pos, player.heightCm, player.pid, model);

  // Career peak, kept as a running maximum rather than re-derived from `hist`
  // by everyone who wants it. Compared against the snapshot being appended
  // here, which is the only place a player's ovr ever changes.
  const priorPeak = player.peakOvr ?? player.ovr;
  const beatsPeak = ovr > priorPeak;

  return {
    ...player,
    pos,
    ratings,
    ovr,
    potential,
    peakOvr: beatsPeak ? ovr : priorPeak,
    peakOvrSeason: beatsPeak ? season : (player.peakOvrSeason ?? season),
    hist: [...player.hist, { season, ratings, ovr, potential, academy: inAcademy, pos }],
  };
}

/**
 * Retirement probability for one offseason. Age sets the curve's shape,
 * `wanted` sets its scale — see the `RETIREMENT_*` block in constants.ts for
 * why roster status is (almost) the whole quality signal and why it has to be
 * read from last season rather than live.
 *
 * A wanted player gets the age curve damped but never zeroed; an unwanted one
 * gets a flat per-season chance at any age on top of the undamped curve, so
 * players nobody will sign drift out of the game instead of accumulating in
 * the free-agent pool forever.
 */
export function retirementProbability(age: number, wanted = true): number {
  const ageTerm = age < RETIREMENT_START_AGE
    ? 0
    : RETIREMENT_BASE_PROB + (age - RETIREMENT_START_AGE) * RETIREMENT_PROB_PER_YEAR;
  return Math.min(
    RETIREMENT_MAX_PROB,
    wanted
      ? ageTerm * RETIREMENT_ROSTERED_DAMPING
      : RETIREMENT_UNROSTERED_BASE + ageTerm,
  );
}

/**
 * Whether retirement treats this player as wanted: a club rostered him last
 * season, or he's young enough and high-ceilinged enough that one plainly will.
 * The second clause stops a high-ceiling teenager who happens to be between
 * clubs from washing out at journeyman rates.
 *
 * The age bound is essential, not cosmetic: `estimatePotential` never returns
 * less than current ovr, so without it every unsigned player above ovr 65 —
 * veterans included — would be exempted onto the damped curve and retire *less*
 * than under the old age-only model. See `RETIREMENT_PROSPECT_MAX_AGE`.
 *
 * The ceiling bar moves with the save's development model. A steady save lists
 * lower potentials for the same players, so a fixed bar would exempt half as
 * many prospects and wash the pool's young free agents out — which measurably
 * starves AI free agency of the useful under-24s it fills holes with. See
 * `potentialBar`.
 */
export function isWantedForRetirement(
  player: Player,
  rostered: boolean,
  age: number,
  model: ProgressionModel = "random",
): boolean {
  return rostered
    || (age < RETIREMENT_PROSPECT_MAX_AGE
      && player.potential > potentialBar(RETIREMENT_PROSPECT_POT_THRESHOLD, model));
}

/**
 * Roll whether a player retires at the end of the given season. Consumes
 * exactly one `rng()` draw whether or not he's rostered, so the shared stream's
 * draw *count* is unchanged from the age-only version (the outcomes move, of
 * course — that's the point).
 */
export function rollRetirement(
  rng: () => number,
  player: Player,
  season: number,
  rostered = true,
  model: ProgressionModel = "random",
): boolean {
  const age = ageOf(player, season);
  return rng() < retirementProbability(age, isWantedForRetirement(player, rostered, age, model));
}
