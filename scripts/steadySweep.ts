/**
 * Sweeps the three `STEADY_*` constants that decide how far a career can climb,
 * against the `"random"` model measured on the identical cohort.
 *
 * The target is **not** to make steady careers better or worse than random
 * ones. It is to leave the world's shape alone — roughly as many players
 * reaching each rating bar, roughly the same spread of career outcomes, roughly
 * the same lifetime drift — while changing *how* a player gets there from
 * "he rolled well in three consecutive summers" to "he was always going to".
 * So the column to minimise is `err`, the distance from the random row.
 *
 * `growthDamping` and `biasSd` are not independent: the damping only bites
 * above `GROWTH_DAMPING_START` (65), so it shapes the top of the distribution
 * while the bias shapes all of it. Sweeping them together is the point.
 *
 *   npx tsx scripts/steadySweep.ts
 *   BIAS=3,3.5,4 END=80,85 FLOOR=0.02,0.1 npx tsx scripts/steadySweep.ts
 */
import { generatePlayer } from "../src/core/players/generate.js";
import { progressPlayer, retirementProbability } from "../src/core/players/progression.js";
import { mulberry32, hashInts } from "../src/engine/rng.js";
import type { Player } from "../src/core/players/types.js";
import { POSITIONS } from "../src/core/players/types.js";
import {
  type ProgressionModel, type ProgressionProfile,
  PROGRESSION_PROFILES, FULL_SEASON_APPEARANCES, LEAGUE_BASE,
} from "../src/core/constants.js";

const SEEDS = (process.env.SEEDS ?? "1,2").split(",").map(Number);
const COHORT = Number(process.env.N ?? 400);
/**
 * Pinned rather than read from `YOUTH_AGE`, deliberately: it is a shared control
 * across the two arms, not a modelled quantity, and pinning it keeps the sweep
 * that derived the shipped `STEADY_*` constants reproducible. Those were derived
 * at start age 16 against a `YOUTH_BASE_OFFSET` of 34, which is what the `- 34`
 * in the cohort base below is; both have since moved (see YOUTH_AGE).
 */
const START_AGE = 16;
const END_AGE = 38;

const BIAS = (process.env.BIAS ?? "2.5,3,3.5,4,5").split(",").map(Number);
const END = (process.env.END ?? "80,85,90").split(",").map(Number);
const FLOOR = (process.env.FLOOR ?? "0.02,0.1,0.2,0.35").split(",").map(Number);

/**
 * Candidate decline tails for `STEADY_AGE_CURVE`, sharing its growth half.
 *
 * The tail is a separate lever from the three above and pulls on a different
 * number: `biasSd` and the damping decide how far a player *climbs*, while this
 * decides how long he holds what he climbed to — which is what moves `carried`
 * and `drift`, the two inflation guards. Widening the plateau (which is what
 * the request asks for) inherently holds ratings up, so the tail has to give
 * that back later or a steady league's mean ratchets above a random one's.
 *
 * Keyed from x = +3 (the first control point past the plateau); everything
 * below is the shipped growth shoulder and is not swept.
 */
const TAILS: Record<string, readonly (readonly [number, number])[]> = {
  // The first hand-drawn attempt: a gentle start, hard finish.
  soft: [[3, -0.3], [4, -0.8], [5, -1.5], [6, -2.4], [7, -3.4], [8, -4.5], [9, -5.7], [10, -7]],
  // Same shape, pulled down from the mid-30s on.
  mid: [[3, -0.4], [4, -1.0], [5, -1.9], [6, -3.0], [7, -4.2], [8, -5.6], [9, -7.1], [10, -8.8]],
  // Steeper again, and extended past x = 10 so the very end keeps falling
  // instead of flattening on the interpolator's clamp.
  hard: [[3, -0.5], [4, -1.3], [5, -2.4], [6, -3.7], [7, -5.2], [8, -6.9], [9, -8.8], [10, -10.9], [11, -13.2], [12, -15.7]],
};
const CURVES = (process.env.CURVES ?? "soft").split(",");

function withMinutes(p: Player, season: number, share: number): Player {
  return {
    ...p,
    stats: [{
      season, tid: 0, appearances: Math.round(FULL_SEASON_APPEARANCES * share),
      goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, tackles: 0, interceptions: 0,
      saves: 0, cleanSheets: 0, minutesPlayed: 0, ratingSum: 0, avgRating: 0,
      xg: 0, goalsAgainst: 0, xga: 0, passes: 0, passesCompleted: 0, crosses: 0,
      foulsCommitted: 0, yellowCards: 0, redCards: 0,
    } as Player["stats"][number]],
  };
}

interface Stats {
  /**
   * Mean ovr over the plateau years (24-32) — what a league actually fields.
   *
   * This sweep started on peak ovr and that was the wrong objective. A peak is a
   * *maximum over a trajectory*, so noise inflates it structurally: the random
   * model's peaks read ~2.5 points above the rating its players carry, purely
   * because a wandering line touches a higher point than a smooth one through
   * the same ground. Matching steady's peaks to random's would therefore not
   * make the two worlds equivalent — it would make steady players genuinely
   * better, since theirs is a rating they hold rather than one they touched in
   * a good summer. The tell was that the 70+ share on peaks sat ~14 points below
   * random's under every combination of these three constants: a gap that no
   * lever moves is usually a gap in the question.
   */
  carriedMean: number;
  carriedSd: number;
  /** Share of PLAYER-SEASONS at 24-32 spent at each bar — the league's star population. */
  bar70: number;
  bar80: number;
  bar85: number;
  /** Peak ovr, kept because peakOvr is a stored field the archive and GOAT boards read. */
  peakMean: number;
  /** Survival-weighted lifetime ovr drift — the inflation proxy. */
  drift: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * One cohort under whatever `PROGRESSION_PROFILES[model]` currently holds.
 * The sweep mutates that entry in place between runs — a scripts-only liberty
 * (the `readonly` on `ProgressionProfile` is compile-time), which is what lets
 * this measure candidate constants without a build per candidate.
 */
const PLATEAU_LO = 24;
const PLATEAU_HI = 32;

function measure(model: ProgressionModel, share = 1): Stats {
  const peaks: number[] = [];
  const carried: number[] = [];
  let drift = 0;
  let n = 0;
  for (const seed of SEEDS) {
    const rng = mulberry32(hashInts(seed, 0x63_6f_68));
    for (let i = 0; i < COHORT; i++) {
      const pos = POSITIONS[i % POSITIONS.length];
      const base = LEAGUE_BASE - 34 + (i % 20);
      let p = generatePlayer(rng, pos, base, i + 1, START_AGE, 1, seed, undefined, null, model);
      const byAge = [p.ovr];
      let peak = p.ovr;
      for (let age = START_AGE; age < END_AGE; age++) {
        const season = age - START_AGE + 1;
        p = progressPlayer(rng, withMinutes(p, season, share), season, false, model);
        byAge.push(p.ovr);
        if (p.ovr > peak) peak = p.ovr;
      }
      peaks.push(peak);
      for (let age = PLATEAU_LO; age <= PLATEAU_HI; age++) carried.push(byAge[age - START_AGE]);
      let alive = 1;
      for (let age = 19; age <= END_AGE; age++) {
        alive *= 1 - retirementProbability(age, true);
        drift += alive * (byAge[age - START_AGE] - byAge[age - 1 - START_AGE]);
      }
      n++;
    }
  }
  const at = (bar: number) => (carried.filter((x) => x >= bar).length / carried.length) * 100;
  return {
    carriedMean: mean(carried), carriedSd: sd(carried),
    bar70: at(70), bar80: at(80), bar85: at(85),
    peakMean: mean(peaks),
    drift: drift / n,
  };
}

const f = (x: number, d = 1) => x.toFixed(d).padStart(6);

const target = measure("random");
console.log(`cohort ${COHORT} x ${SEEDS.length} seeds; target row is the SHIPPED "random" model\n`);
console.log("  tail  bias   end floor | carried    sd    70+    80+    85+   peak  drift |    err");
console.log(`  RANDOM (target)       | ${f(target.carriedMean)} ${f(target.carriedSd)} ${f(target.bar70)} ${f(target.bar80)} ${f(target.bar85)} ${f(target.peakMean)} ${f(target.drift, 2)} |      -`);
console.log("  " + "-".repeat(64));

const base = PROGRESSION_PROFILES.steady;
/** The shipped steady growth half, reused under every candidate tail. */
const GROWTH = base.ageCurve.filter(([x]) => x < 3);
const rows: { key: string; s: Stats; err: number }[] = [];
// Printed as each candidate finishes rather than sorted at the end: a full grid
// is minutes of work and a run that shows nothing until it is done cannot be
// read early or interrupted usefully.
for (const curve of CURVES) {
for (const bias of BIAS) {
  for (const end of END) {
    for (const floor of FLOOR) {
      // Swap in the candidate. Mutating a `readonly` field is a scripts-only
      // liberty; nothing here ships.
      (PROGRESSION_PROFILES as Record<ProgressionModel, ProgressionProfile>).steady = {
        ...base, biasSdYoung: bias, dampingEnd: end, dampingFloor: floor,
        ageCurve: [...GROWTH, ...TAILS[curve]],
      };
      const s = measure("steady");
      // Distance from the shipped world's shape. The rating bars are the
      // headline (they are what a league's star population looks like), the
      // spread and the drift are the guards either side of it.
      const err =
        Math.abs(s.bar80 - target.bar80) * 1.0
        + Math.abs(s.bar85 - target.bar85) * 1.5
        + Math.abs(s.bar70 - target.bar70) * 0.5
        + Math.abs(s.carriedSd - target.carriedSd) * 1.0
        + Math.abs(s.carriedMean - target.carriedMean) * 1.0
        + Math.abs(s.drift - target.drift) * 2.0;
      const key = `${curve.padEnd(4)} ${f(bias, 2)} ${f(end, 0)} ${f(floor, 2)}`;
      rows.push({ key, s, err });
      console.log(`  ${key} | ${f(s.carriedMean)} ${f(s.carriedSd)} ${f(s.bar70)} ${f(s.bar80)} ${f(s.bar85)} ${f(s.peakMean)} ${f(s.drift, 2)} | ${f(err, 2)}`);
    }
  }
}
}
(PROGRESSION_PROFILES as Record<ProgressionModel, ProgressionProfile>).steady = base;

rows.sort((a, b) => a.err - b.err);
console.log("\n  BEST FIRST:");
for (const { key, s, err } of rows.slice(0, 12)) {
  console.log(`  ${key} | ${f(s.carriedMean)} ${f(s.carriedSd)} ${f(s.bar70)} ${f(s.bar80)} ${f(s.bar85)} ${f(s.peakMean)} ${f(s.drift, 2)} | ${f(err, 2)}`);
}
console.log("\n  (sorted best-first. `err` weights 85+ heaviest — an over-generous ceiling is");
console.log("   the failure that most obviously breaks a league, and the one the first");
console.log("   hand-guessed constants produced.)");
