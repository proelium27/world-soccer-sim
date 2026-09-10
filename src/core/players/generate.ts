import type { Player, Position, PlayerRatings, SkillKey } from "./types.js";
import { SKILL_KEYS } from "./types.js";
import { GEN_OFFSETS, HEIGHT_RANGES, type Tier } from "./templates.js";
import { computeOvr } from "./ovr.js";
import { generateName } from "./names.js";
import { pickNationality, type NationalityWeights } from "./nationalities.js";
import { estimatePotential, baseAgeDelta, PHYSICAL_KEYS } from "./progression.js";
import { gaussian, hashInts, mulberry32 } from "../../engine/rng.js";
import {
  TIER_OFFSET, RATING_NOISE_SD, ABS_LOW_MIN, ABS_LOW_MAX,
  RATING_MIN, RATING_MAX, POSITION_RATING_SPREAD, OVR_SCALE_SHIFT,
  YOUTH_BASE_FLOOR, YOUTH_BASE_SOFTNESS,
  GENERATION_AGE_WEIGHTS, GENERATION_EQUILIBRIUM_LIFT,
  PROGRESSION_PROFILES, BASE_AGE_CURVE_PEAK, GENERATION_DECLINE_SELECTION,
  PHYSICAL_AGE_SHIFT, SKILL_AGE_SHIFT, GK_AGE_SHIFT,
  type ProgressionModel,
} from "../constants.js";
import { seasonSalaryForOvr } from "../contracts.js";
import { emptyCareerSummary } from "./careerSummary.js";

const clampRating = (x: number): number =>
  Math.round(Math.max(RATING_MIN, Math.min(RATING_MAX, x)));

/**
 * One rating draw. `spread` is the position's RATING_NOISE_SD multiplier
 * (POSITION_RATING_SPREAD), which equalizes how much OVR varies within a
 * position — see that constant. It scales the draw, never the draw COUNT, so
 * the shared rng stream advances identically either way.
 *
 * Position-exclusive stats are exempt: an ABS draw is a flat low roll that
 * carries no weight in any OVR row, so scaling it would move nothing but the
 * cosmetic value of a striker's goalkeeping.
 */
/**
 * The single choke point for every generated rating, and therefore where
 * OVR_SCALE_SHIFT is applied — see that constant for why the shift lands on the
 * output here rather than on `base` (the bases feed YOUTH_BASE_FLOOR's softplus
 * and the country/division ladders, all of which must keep reading as they do).
 *
 * The `ABS` tier deliberately does NOT take the shift: it is the floor for
 * skills that are irrelevant at a position, and every such skill carries zero
 * weight in that position's OVR row, so leaving it alone moves no ovr.
 *
 * The shift is added inside `clampRating`, not around it, so the [1, 99] bounds
 * still hold. That is also the one place the shift is not a clean +11: it lifts
 * the weakest academies off the floor they were underflowing into, and pushes a
 * small tail of elite ratings into the ceiling.
 */
function rollRating(rng: () => number, tier: Tier, base: number, spread: number): number {
  if (tier === "ABS") {
    return clampRating(ABS_LOW_MIN + rng() * (ABS_LOW_MAX - ABS_LOW_MIN));
  }
  const offset = TIER_OFFSET[tier];
  return clampRating(
    base + offset + gaussian(rng) * RATING_NOISE_SD * spread + OVR_SCALE_SHIFT,
  );
}

/**
 * Eases a generation base onto a soft floor so it can never fall far enough
 * below `RATING_MIN` to clamp a whole squad into rubble.
 *
 * Shared by youth intake (`youthGenerationBase`) and by generation's own age
 * model (`generationBaseForAge`), because both subtract a flat offset from a
 * base that already spans an order of magnitude across the world's academies —
 * and a flat subtraction from a small number goes negative. See
 * `YOUTH_BASE_FLOOR` in constants.ts for the measurements, and for why this is a
 * softplus rather than a `Math.max` (which makes every club below the cut
 * generate identical players) or a proportional offset (which changes every
 * club, so the swept constants would all need redoing).
 *
 * Strictly monotonic, and identity to within 0.05 once `raw` clears ~20, so a
 * base that was never underflowing is untouched.
 */
export function softFloorBase(raw: number): number {
  const x = (raw - YOUTH_BASE_FLOOR) / YOUTH_BASE_SOFTNESS;
  // softplus, guarded: Math.exp overflows past ~709 and the curve is already
  // identity to well under floating-point noise by x = 30.
  if (x > 30) return raw;
  return YOUTH_BASE_FLOOR + YOUTH_BASE_SOFTNESS * Math.log1p(Math.exp(x));
}

/**
 * Cumulative table over the ages starting rosters are drawn from, weighted by
 * `GENERATION_AGE_WEIGHTS` — the equilibrium's own rostered age distribution.
 *
 * Derived at module load from the weights so the two cannot drift, and built as
 * a CDF so the draw stays exactly ONE `rng()` call, as the uniform draw it
 * replaces was. That matters: `generateWorld` is a single rng pass and each
 * country is generated in table order precisely so appending one never perturbs
 * an existing country's players.
 *
 * The distribution is load-bearing rather than decorative, because the age
 * offsets are zero-meaned UNDER IT: change the weights and every offset moves.
 * That is what makes the shape safe (the world's level cannot drift out from
 * under it) and also what makes a careless edit expensive — weighting the ends
 * more heavily drags every peak-age player up to compensate.
 */
const AGE_CDF: { age: number; cum: number }[] = (() => {
  const entries = Object.entries(GENERATION_AGE_WEIGHTS)
    .map(([a, w]) => ({ age: Number(a), w }))
    .sort((a, b) => a.age - b.age);
  const total = entries.reduce((s, e) => s + e.w, 0);
  let running = 0;
  return entries.map((e) => {
    running += e.w / total;
    return { age: e.age, cum: running };
  });
})();

/**
 * Draw a starting-roster age, consuming one `rng()` draw.
 *
 * Takes the drawn number rather than the generator so the call site reads as the
 * single draw it is (same shape as `weightedPosition` in youth.ts).
 */
export function drawGenerationAge(r: number): number {
  for (const e of AGE_CDF) if (r < e.cum) return e.age;
  return AGE_CDF[AGE_CDF.length - 1].age;
}

/**
 * How far below his own peak the age curve says a player of each age still sits,
 * per rating group — derived from `PROGRESSION_PROFILES[model].ageCurve`, the
 * very curve progression will run him along.
 *
 * THE AMPLITUDE IS THE POINT, AND IT IS NOT A FREE PARAMETER. What went wrong
 * without an age model is that a generated 18-year-old was rolled at a
 * 27-year-old's level and then handed eight years of growth on top, so he became
 * the best player in the world by season 2. The exact correction for that is the
 * growth he has left: integrate the curve from his age to the peak and start him
 * that far down. Then progression gives him back precisely what generation took
 * off, and a season-1 world is stable instead of transient.
 *
 * MEASURING THE EQUILIBRIUM AND COPYING IT WAS TRIED FIRST AND IS WRONG, which
 * is worth recording because it is the obvious move. The sim's settled rostered
 * profile spans ~33 OVR from 16 to peak, and reproducing it blew the calibrated
 * range apart: a big-four top flight generated 61/75.5/92 (min/mean/max, matched
 * against EA FC's Premier League) came out at max 98 with 182 players at 90+
 * instead of 11, because a hump that tall does not fit inside a 31-point league.
 * The reason the measured hump is so much taller than the curve's own is
 * `AI_PROSPECT_SLOTS`: an AI club retains five high-potential teenagers on its
 * SENIOR roster, so the equilibrium's 16-17 band is a pool of players who are
 * there for their ceiling and never play. That is a sim artifact with no
 * counterpart in a real squad or in EA's ratings, and calibrating generation to
 * it would import it.
 *
 * PER GROUP, NOT PER PLAYER, because progression is: physicals read the curve at
 * `age + PHYSICAL_AGE_SHIFT` and skills at `age + SKILL_AGE_SHIFT`, i.e. 4.5
 * years apart, with a further `GK_AGE_SHIFT` for keepers. Splitting them costs
 * nothing and buys the right thing for free — a generated 34-year-old comes out
 * quick-legged no more but technically intact, which is what an old player is.
 *
 * ZERO-MEANED UNDER `GENERATION_AGE_WEIGHTS`, per group, so each group's mean
 * offset is 0 and therefore ANY OVR weighting of the two is also 0. That is what
 * keeps this a pure change of shape: the world's overall level, the country and
 * division ladders, and every constant calibrated against them are untouched.
 *
 * Memoised per model — the tables are a pure function of the profile, and
 * `generatePlayer` is called ~15,650 times per world.
 */
type AgeOffsets = { physical: Map<number, number>; skill: Map<number, number> };
const ageOffsetCache = new Map<string, AgeOffsets>();
/** Module scope: `generatePlayer` runs ~15,650 times per world. */
const PHYSICAL_KEY_SET: ReadonlySet<string> = new Set(PHYSICAL_KEYS);

function ageCurveOffsets(model: ProgressionModel, gkShift: number): AgeOffsets {
  const key = `${model}:${gkShift}`;
  const hit = ageOffsetCache.get(key);
  if (hit) return hit;

  const profile = PROGRESSION_PROFILES[model];
  const ages = Object.keys(GENERATION_AGE_WEIGHTS).map(Number).sort((a, b) => a - b);
  const totalW = ages.reduce((s, a) => s + GENERATION_AGE_WEIGHTS[a], 0);

  const build = (shift: number): Map<number, number> => {
    // Cumulative growth still ahead of a player of this age, walked along the
    // same curve progression reads. Negative below the peak (he has growth to
    // come, so he starts below it); positive above it (he has already declined,
    // so he starts below his own peak by that much too — hence the sign flip).
    const raw = new Map<number, number>();
    for (const age of ages) {
      let cum = 0;
      if (age < BASE_AGE_CURVE_PEAK) {
        for (let a = age + 1; a <= BASE_AGE_CURVE_PEAK; a++) cum -= baseAgeDelta(profile, a + shift);
      } else {
        for (let a = BASE_AGE_CURVE_PEAK + 1; a <= age; a++) cum += baseAgeDelta(profile, a + shift);
        // The decline side is damped, and ONLY the decline side. The curve gives
        // the mean decline of everyone who ages, but a player still on a roster
        // at 36 is not a mean player: the ones who fell off retired, and
        // `retirementProbability` climbs every year from RETIREMENT_START_AGE, so
        // what is left is a survivor sample. Applying the undamped curve
        // generates veterans far worse than the ones the sim actually carries —
        // measured, a big-four 35-year-old came out ~15 below his peak-age
        // team-mate against ~9 at equilibrium — and under `"steady"`, whose late
        // decline is much steeper, it drove the physical base onto the soft floor
        // outright (1.00 at age 37, i.e. every veteran's legs identically dead).
        //
        // The growth side takes NO such factor, deliberately. Selection there
        // runs the other way: `AI_PROSPECT_SLOTS` keeps teenagers for their
        // ceiling rather than their ability, so equilibrium's young band is
        // *below* what an unselected draw would give, not above it — see
        // GENERATION_AGE_WEIGHTS for why that artifact is not reproduced.
        cum *= GENERATION_DECLINE_SELECTION;
      }
      raw.set(age, cum);
    }
    const mean = ages.reduce((s, a) => s + GENERATION_AGE_WEIGHTS[a] * raw.get(a)!, 0) / totalW;
    return new Map(ages.map((a) => [a, raw.get(a)! - mean]));
  };

  const out: AgeOffsets = { physical: build(gkShift + PHYSICAL_AGE_SHIFT), skill: build(gkShift + SKILL_AGE_SHIFT) };
  ageOffsetCache.set(key, out);
  return out;
}

/**
 * The two group bases a generated player of `age` is rolled around: the club's
 * base shifted by the age curve, then eased onto the shared soft floor.
 *
 * Pure arithmetic on the base — no rng draw, and no change to the draw count.
 *
 * The floor is not optional. A weak third-division club's base is already low
 * enough that `TIER_OFFSET`'s `VL` row underflows into `RATING_MIN`; subtracting
 * another ~15 for a teenager without the floor would clamp his whole rating set
 * to 1, which yields not a weak player but a destroyed one — the exact failure
 * `YOUTH_BASE_FLOOR` was added to fix, arriving from a new direction.
 */
export function generationBaseForAge(
  base: number, age: number, pos: Position, model: ProgressionModel,
): { physical: number; skill: number } {
  const offsets = ageCurveOffsets(model, pos === "GK" ? GK_AGE_SHIFT : 0);
  // An age outside the table is a caller error rather than a shape to guess at,
  // but generation must not throw mid-world: fall back to no age adjustment,
  // which is exactly what generation did before it had an age model.
  const lift = GENERATION_EQUILIBRIUM_LIFT;
  return {
    physical: softFloorBase(base + (offsets.physical.get(age) ?? 0) + lift),
    skill: softFloorBase(base + (offsets.skill.get(age) ?? 0) + lift),
  };
}

export function generatePlayer(
  rng: () => number,
  pos: Position,
  base: number,
  pid: number,
  age: number,
  season: number,
  genSeed = 0,
  homeCountry?: string,
  nationalities?: NationalityWeights | null,
  // The save's development model, forwarded to `estimatePotential` so a
  // prospect's listed ceiling is a forecast of the world he will actually
  // develop in. Trailing and defaulted for the same reason the two above are:
  // this is a 10-argument function with ~50 call sites, most of them fixtures
  // that want the shipped model. Every call site that has a league in scope
  // passes it.
  model: ProgressionModel = "random",
  /**
   * Roll this player at the level the age curve says his age sits at, rather
   * than flat (see `generationBaseForAge`).
   *
   * OPT-IN, and defaulting to the old flat behaviour, because the one caller
   * that must NOT take it is youth intake: `youthGenerationBase` already drops
   * its 16-year-olds by `YOUTH_BASE_OFFSET`, so applying an age curve on top
   * would count the same adjustment twice and generate rubble. World generation
   * and roster-import filler pass true; everything else — youth intake, God
   * Mode, the roster importer's archetype, every fixture — keeps what it had.
   *
   * Scales what a draw produces, never how many draws happen: the loop below is
   * one `rollRating` per skill either way.
   */
  ageAdjusted = false,
): Player {
  const tiers = GEN_OFFSETS[pos];
  const spread = POSITION_RATING_SPREAD[pos];
  const groupBase = ageAdjusted
    ? generationBaseForAge(base, age, pos, model)
    : { physical: base, skill: base };
  const ratings = {} as PlayerRatings;
  for (const key of SKILL_KEYS as readonly SkillKey[]) {
    ratings[key] = rollRating(
      rng, tiers[key], PHYSICAL_KEY_SET.has(key) ? groupBase.physical : groupBase.skill, spread,
    );
  }

  const [loH, hiH] = HEIGHT_RANGES[pos];
  const heightCm = Math.round(loH + rng() * (hiH - loH));

  const ovr = computeOvr(pos, ratings, heightCm);
  const potential = estimatePotential(rng, ratings, ovr, age, pos, heightCm, pid, model);
  const born = season - age;

  // Nationality/name draw from a (genSeed, pid)-derived sub-stream: `genSeed`
  // is caller-supplied (not drawn from `rng`) so this never shifts the shared
  // rng sequence consumed by ratings/potential for other players, while still
  // varying across different games/seeds via genSeed.
  const identityRng = mulberry32(hashInts(genSeed, pid));
  const nationality = pickNationality(identityRng, homeCountry, nationalities);

  return {
    pid,
    name: generateName(identityRng, nationality),
    nationality,
    born,
    pos,
    heightCm,
    ratings,
    ovr,
    potential,
    // Placeholder contract — length/expiry are a caller concern (initial gen,
    // youth intake, and free agency all set these differently).
    contract: { salary: seasonSalaryForOvr(ovr, pid, season), expiresSeason: 1 },
    injury: null,
    stats: [],
    // Seeded with the player's generation-time ratings (stamped season - 1,
    // matching progressPlayer's "entry X = ratings entering season X + 1"
    // convention) so hist reaches length 2 — and the Roster page's
    // RatingDelta starts showing a season-over-season arrow — after just one
    // offseason, instead of needing two (previously hist started at [],
    // silently swallowing the very first progression's visible delta even
    // though ovr itself was already updating correctly).
    // academy: false here is just the pre-career baseline snapshot — a
    // youth-intake player routed to the user's academy has his real academy
    // seasons recorded by progressPlayer each offseason from here on.
    hist: [{ season: season - 1, ratings, ovr, potential, academy: false, pos }],
    // Seeded here, not left to the first progression, so *every* player carries
    // a career peak from the moment he exists. `progressPlayer` maintains it
    // afterwards. Without this a youth-intake player has a `hist` entry but no
    // peak until his first offseason, and the readers' fallback scan would be
    // the only thing answering for him — which stops working the moment careers
    // are no longer resident (`docs/lazy-career-plan.md`).
    peakOvr: ovr,
    peakOvrSeason: season - 1,
    // Seeded for the same reason as the peak: every player carries the field
    // from the moment he exists, so no reader ever needs a "or compute it from
    // his seasons" fallback — which stops being possible once the seasons live
    // on disk. He has played nothing, so it is empty rather than absent.
    career: emptyCareerSummary(),
  };
}
