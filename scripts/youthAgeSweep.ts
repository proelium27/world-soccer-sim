/**
 * What it costs to take youth intake in a year younger, and the
 * YOUTH_BASE_OFFSET that pays for it.
 *
 * `YOUTH_BASE_OFFSET` is an anti-inflation constant, swept (twice) to hold a
 * 40-season league mean flat. Its whole justification is that
 * `generatePlayer`'s rating rolls do not depend on age at all, so an intake
 * player is generated at an adult's quality distribution and then given
 * however many growth years remain before his peak. Lowering YOUTH_AGE hands
 * every player in the world one MORE of those years, so the offset has to rise
 * or the equilibrium reopens.
 *
 * Measured as a cohort rather than a world sim, following steadySweep.ts: the
 * question ("where does a career end up if it starts a year earlier") is about
 * a trajectory, and a 626-club dynasty adds seasons of noise and hours of
 * compute to answer it.
 *
 * The objective is `carried` — mean ovr over the plateau years, i.e. what a
 * league actually FIELDS — plus the rating bars either side of it. Explicitly
 * NOT peak ovr: a peak is a maximum over a noisy trajectory and reads high for
 * structural reasons that have nothing to do with the age a player entered at
 * (steadySweep.ts's `carriedMean` comment has the full argument).
 *
 * The target row is the SHIPPED pair (YOUTH_AGE, YOUTH_BASE_OFFSET). A
 * candidate is right when `err` is ~0 — same league, entered a year earlier.
 *
 *   npx tsx scripts/youthAgeSweep.ts
 *   AGES=15 OFFSETS=34,35,36,37 npx tsx scripts/youthAgeSweep.ts
 */
import { generatePlayer } from "../src/core/players/generate.js";
import { progressPlayer, retirementProbability } from "../src/core/players/progression.js";
import { mulberry32, hashInts } from "../src/engine/rng.js";
import type { Player } from "../src/core/players/types.js";
import { POSITIONS } from "../src/core/players/types.js";
import {
  FULL_SEASON_APPEARANCES, YOUTH_AGE, YOUTH_BASE_OFFSET,
  YOUTH_BASE_FLOOR, YOUTH_BASE_SOFTNESS,
  type ProgressionModel,
} from "../src/core/constants.js";
import { createLeagueState } from "../src/core/leagueState.js";

/**
 * The academy anchors a real world actually has, read off one.
 *
 * NOT a synthetic spread around LEAGUE_BASE, which is what this probe did on
 * its first pass and which made it wrong by ~5 ovr. `academyBase` spans roughly
 * 1 to 30 once the offset is taken off it, while `LEAGUE_BASE - offset + 0..19`
 * lands at 19-38 — and `growthDamping` bites above ovr 65, so a cohort pitched
 * that much too high is over-damped and badly understates what an extra growth
 * year is worth to the players who actually come out of an academy. Measured on
 * the world: the shipped 15/35 pair read -0.4 here and +5.0 in a 20-season
 * dynasty. Read a real distribution.
 */
const ANCHORS: number[] = (() => {
  const league = createLeagueState(0, mulberry32(99));
  return league.teams.map((t) => t.academyBase).sort((a, b) => a - b);
})();

/** `youthGenerationBase` with the offset as a parameter rather than the constant. */
function genBase(academyBase: number, offset: number): number {
  const raw = academyBase - offset;
  const x = (raw - YOUTH_BASE_FLOOR) / YOUTH_BASE_SOFTNESS;
  if (x > 30) return raw;
  return YOUTH_BASE_FLOOR + YOUTH_BASE_SOFTNESS * Math.log1p(Math.exp(x));
}

const SEEDS = (process.env.SEEDS ?? "1,2,3").split(",").map(Number);
const COHORT = Number(process.env.N ?? 400);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const END_AGE = 38;

const AGES = (process.env.AGES ?? "16,15,14").split(",").map(Number);
const OFFSETS = (process.env.OFFSETS ?? "34,35,36,37,38").split(",").map(Number);

/**
 * Age at which a graduate starts getting senior minutes. Below it he is an
 * academy player and `minutesFactor` bottoms out.
 *
 * This is the one modelling assumption in here and it matters, because it is
 * exactly the extra year being priced: crediting a 15-year-old with a full
 * season of senior football would overstate what that year is worth. Both arms
 * use the same policy, and MINUTES=full re-runs the whole sweep with everyone
 * on full minutes at every age as the opposite bound — if the answer holds
 * across both, the assumption is not carrying it.
 */
const SENIOR_AGE = Number(process.env.SENIOR_AGE ?? 18);
const UNIFORM_MINUTES = process.env.MINUTES === "full";

function withMinutes(p: Player, season: number, age: number): Player {
  const share = UNIFORM_MINUTES ? 1 : age < SENIOR_AGE ? 0 : 1;
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
  /** Mean ovr over the plateau years (24-32) — what a league fields. THE objective. */
  carried: number;
  carriedSd: number;
  /** Share of plateau PLAYER-SEASONS at each bar — the league's star population. */
  bar70: number;
  bar80: number;
  bar85: number;
  /** Ovr as generated, before a single season of progression. */
  entry: number;
  /** Peak ovr — a stored field, reported but never the objective. */
  peak: number;
  /** Survival-weighted lifetime drift — the inflation proxy. */
  drift: number;
  /**
   * Mean LISTED potential at generation — the second knock-on, and the one a
   * player sees. estimatePotential simulates forward from `age + 1`, so a
   * younger intake is forecast over one more growth year and reads higher.
   * Every absolute potential gate in the game (AI_PROSPECT_MIN_POT,
   * RETIREMENT_PROSPECT_POT_THRESHOLD) is a fixed number underneath it.
   */
  pot: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const PLATEAU_LO = 24;
const PLATEAU_HI = 32;

function measure(startAge: number, offset: number): Stats {
  const carried: number[] = [];
  const peaks: number[] = [];
  const entries: number[] = [];
  const pots: number[] = [];
  let drift = 0;
  let n = 0;

  for (const seed of SEEDS) {
    // Same stream per (age, offset) candidate, so rows differ by the candidate
    // rather than by which draws they happened to get.
    const rng = mulberry32(hashInts(seed, 0x79_6f_75));
    for (let i = 0; i < COHORT; i++) {
      const pos = POSITIONS[i % POSITIONS.length];
      // Exactly what youthGenerationBase hands generatePlayer, off a real
      // world's anchors — including the softplus floor, which is load-bearing
      // here: it means raising the offset does far less at the clubs already
      // sitting on it, so the compensation is not 1:1.
      const base = genBase(ANCHORS[(i * 7) % ANCHORS.length], offset);
      let p = generatePlayer(rng, pos, base, i + 1, startAge, 1, seed, undefined, null, MODEL);
      entries.push(p.ovr);
      pots.push(p.potential);

      // Indexed by age so the plateau window is read at the same REAL ages in
      // both arms — the whole point is that one arm has more seasons in it.
      const byAge = new Map<number, number>([[startAge, p.ovr]]);
      let peak = p.ovr;
      for (let age = startAge; age < END_AGE; age++) {
        const season = age - startAge + 1;
        p = progressPlayer(rng, withMinutes(p, season, age), season, false, MODEL);
        byAge.set(age + 1, p.ovr);
        if (p.ovr > peak) peak = p.ovr;
      }
      peaks.push(peak);
      for (let age = PLATEAU_LO; age <= PLATEAU_HI; age++) carried.push(byAge.get(age)!);

      let alive = 1;
      for (let age = 19; age <= END_AGE; age++) {
        alive *= 1 - retirementProbability(age, true);
        drift += alive * (byAge.get(age)! - byAge.get(age - 1)!);
      }
      n++;
    }
  }

  const at = (bar: number) => (carried.filter((x) => x >= bar).length / carried.length) * 100;
  return {
    carried: mean(carried), carriedSd: sd(carried),
    bar70: at(70), bar80: at(80), bar85: at(85),
    entry: mean(entries), peak: mean(peaks), drift: drift / n, pot: mean(pots),
  };
}

const f = (x: number, d = 1) => x.toFixed(d).padStart(6);

console.log(
  `cohort ${COHORT} x ${SEEDS.length} seeds, model "${MODEL}", `
  + `minutes ${UNIFORM_MINUTES ? "full at every age" : `senior from ${SENIOR_AGE}`}\n`,
);

const target = measure(YOUTH_AGE, YOUTH_BASE_OFFSET);
console.log(" age  off | carried    sd    70+    80+    85+  entry   peak  drift    pot |    err");
console.log(
  `  SHIPPED ${YOUTH_AGE}/${YOUTH_BASE_OFFSET} | ${f(target.carried)} ${f(target.carriedSd)} `
  + `${f(target.bar70)} ${f(target.bar80)} ${f(target.bar85)} ${f(target.entry)} `
  + `${f(target.peak)} ${f(target.drift, 2)} ${f(target.pot)} |      -`,
);
console.log("  " + "-".repeat(76));

const rows: { key: string; s: Stats; err: number }[] = [];
for (const age of AGES) {
  for (const offset of OFFSETS) {
    const s = measure(age, offset);
    // Distance from the shipped world's shape. `carried` is the headline (it is
    // the rating a league fields); the bars are the star population either side
    // of it; drift is the inflation guard. Weighted like steadySweep's, whose
    // objective is the same "leave the world alone" one.
    const err =
      Math.abs(s.carried - target.carried) * 1.0
      + Math.abs(s.carriedSd - target.carriedSd) * 1.0
      + Math.abs(s.bar70 - target.bar70) * 0.5
      + Math.abs(s.bar80 - target.bar80) * 1.0
      + Math.abs(s.bar85 - target.bar85) * 1.5
      + Math.abs(s.drift - target.drift) * 2.0;
    const key = `${String(age).padStart(4)} ${String(offset).padStart(4)}`;
    rows.push({ key, s, err });
    console.log(
      `${key} | ${f(s.carried)} ${f(s.carriedSd)} ${f(s.bar70)} ${f(s.bar80)} ${f(s.bar85)} `
      + `${f(s.entry)} ${f(s.peak)} ${f(s.drift, 2)} ${f(s.pot)} | ${f(err, 2)}`,
    );
  }
}

rows.sort((a, b) => a.err - b.err);
console.log(`\nclosest to the shipped world: ${rows.slice(0, 3).map((r) => r.key.trim()).join("  |  ")}`);
