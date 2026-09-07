import type { Player, Position, PlayerRatings, SkillKey } from "./types.js";
import { SKILL_KEYS } from "./types.js";
import { GEN_OFFSETS, HEIGHT_RANGES, type Tier } from "./templates.js";
import { computeOvr } from "./ovr.js";
import { generateName } from "./names.js";
import { pickNationality, type NationalityWeights } from "./nationalities.js";
import { estimatePotential } from "./progression.js";
import { gaussian, hashInts, mulberry32 } from "../../engine/rng.js";
import {
  TIER_OFFSET, RATING_NOISE_SD, ABS_LOW_MIN, ABS_LOW_MAX,
  RATING_MIN, RATING_MAX, POSITION_RATING_SPREAD,
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
function rollRating(rng: () => number, tier: Tier, base: number, spread: number): number {
  if (tier === "ABS") {
    return clampRating(ABS_LOW_MIN + rng() * (ABS_LOW_MAX - ABS_LOW_MIN));
  }
  const offset = TIER_OFFSET[tier];
  return clampRating(base + offset + gaussian(rng) * RATING_NOISE_SD * spread);
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
): Player {
  const tiers = GEN_OFFSETS[pos];
  const spread = POSITION_RATING_SPREAD[pos];
  const ratings = {} as PlayerRatings;
  for (const key of SKILL_KEYS as readonly SkillKey[]) {
    ratings[key] = rollRating(rng, tiers[key], base, spread);
  }

  const [loH, hiH] = HEIGHT_RANGES[pos];
  const heightCm = Math.round(loH + rng() * (hiH - loH));

  const ovr = computeOvr(pos, ratings, heightCm);
  const potential = estimatePotential(rng, ratings, ovr, age, pos, heightCm, pid);
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
