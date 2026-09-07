/**
 * The tuning tool for `ProgressionModel` — run it before touching any
 * `STEADY_*` constant.
 *
 * It answers the five questions the setting has to get right, and they pull
 * against each other, so read them together rather than optimising any one:
 *
 *   A. **The arc.** Does a career grow through the early twenties, hold
 *      through the peak years and fall away from thirty at an accelerating
 *      rate? That is the shape the request describes and the whole point.
 *   B. **The dice.** How big is a typical season-to-season ovr move? This is
 *      what "turn off rng" means in practice, and it is the one number that
 *      must move a long way.
 *   C. **The spread.** Do careers still differ from one another? If B is
 *      fixed by making every career identical, the mode is worthless — the
 *      variance has to move from per-season to per-player, not disappear.
 *   D. **The ceiling.** Can anyone still get near elite? `growthDamping` was
 *      sized against a wide form roll; with the roll gone it can wall the
 *      league off below 80 and leave the world with no stars at all.
 *   E. **Inflation.** Mean lifetime delta must stay ~0 or slightly negative,
 *      per `PHYSICAL_AGE_SHIFT`'s comment. This is a fast proxy for the real
 *      gate, which is a dynasty audit.
 *
 * Cohorts are synthetic and progressed directly, so this runs in seconds and
 * is a tuning instrument, not a verdict. `SEEDS=1,2 npx tsx scripts/progressionModelProbe.ts`
 */
import { generatePlayer } from "../src/core/players/generate.js";
import { progressPlayer, retirementProbability } from "../src/core/players/progression.js";
import { mulberry32, hashInts } from "../src/engine/rng.js";
import type { Player, Position } from "../src/core/players/types.js";
import { POSITIONS } from "../src/core/players/types.js";
import {
  type ProgressionModel, FULL_SEASON_APPEARANCES, LEAGUE_BASE,
} from "../src/core/constants.js";

const MODELS: ProgressionModel[] = ["random", "steady"];
const SEEDS = (process.env.SEEDS ?? "1").split(",").map(Number);
/** Players per cohort per seed. Large enough that a 1-in-N tail reads cleanly. */
const COHORT = Number(process.env.N ?? 400);
const START_AGE = 16;
const END_AGE = 38;

/**
 * Give the player a stat line so `progressPlayer` reads a real `minutesFactor`
 * rather than the zero-appearance floor every synthetic cohort would otherwise
 * sit on. `share` is his slice of a full season, so 1 is an ever-present
 * starter and 0 is a man who did not play — which is the "depending on game
 * time they might grow faster or slower" axis the request names, and the only
 * non-random source of variation the steady model keeps.
 */
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

interface Career {
  pos: Position;
  /** ovr at each age from START_AGE to END_AGE inclusive. */
  byAge: number[];
  peak: number;
  potentialAt16: number;
}

/** Run one cohort of 16-year-olds all the way to END_AGE under one model. */
function runCohort(model: ProgressionModel, seed: number, share: number): Career[] {
  const rng = mulberry32(hashInts(seed, 0x63_6f_68));
  const out: Career[] = [];
  for (let i = 0; i < COHORT; i++) {
    const pos = POSITIONS[i % POSITIONS.length];
    // A spread of academy bases, so the cohort spans the world's clubs rather
    // than all coming out of one academy.
    const base = LEAGUE_BASE - 34 + (i % 20);
    let p = generatePlayer(
      rng, pos, base, i + 1, START_AGE, 1, seed, undefined, null, model,
    );
    const byAge = [p.ovr];
    let peak = p.ovr;
    const potentialAt16 = p.potential;
    for (let age = START_AGE; age < END_AGE; age++) {
      const season = age - START_AGE + 1;
      p = progressPlayer(rng, withMinutes(p, season, share), season, false, model);
      byAge.push(p.ovr);
      if (p.ovr > peak) peak = p.ovr;
    }
    out.push({ pos, byAge, peak, potentialAt16 });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const f = (x: number, d = 1) => x.toFixed(d).padStart(6);

function allCareers(model: ProgressionModel, share: number): Career[] {
  return SEEDS.flatMap((s) => runCohort(model, s, share));
}

console.log(`cohort ${COHORT} x ${SEEDS.length} seed(s) = ${COHORT * SEEDS.length} careers per model\n`);

// ---------------------------------------------------------------- A. the arc
const careers: Record<string, Career[]> = {};
for (const model of MODELS) careers[model] = allCareers(model, 1);

console.log("A. CAREER ARC — mean ovr by age, first-team regular (full minutes)");
console.log("   'd' is the year-on-year change: growth, then a plateau near 0, then an accelerating fall.");
console.log("   age |  random    d  |  steady    d");
for (let age = START_AGE; age <= END_AGE; age++) {
  const i = age - START_AGE;
  const cells = MODELS.map((m) => {
    const cur = mean(careers[m].map((c) => c.byAge[i]));
    const prev = i === 0 ? cur : mean(careers[m].map((c) => c.byAge[i - 1]));
    return `${f(cur)} ${f(cur - prev, 2)}`;
  });
  console.log(`   ${String(age).padStart(3)} | ${cells.join("  | ")}`);
}

// ------------------------------------------------------- A2. the minutes axis
console.log("\nA2. THE MINUTES AXIS — peak ovr by how much he played (the non-random lever)");
console.log("   share |  random  steady");
for (const share of [0, 0.5, 1]) {
  const cells = MODELS.map((m) => f(mean(allCareers(m, share).map((c) => c.peak))));
  console.log(`   ${share.toFixed(2).padStart(5)} | ${cells.join("  ")}`);
}

// --------------------------------------------------------------- B. the dice
/**
 * The measurement that actually answers "is the rng gone", and the naive one
 * does not. Raw |ovr change| conflates *movement* with *unpredictability*: a
 * 17-year-old gaining 5 is the age curve doing its job, and a 37-year-old
 * losing 5 is the decline doing its. Both are supposed to be large, and both
 * are perfectly predictable.
 *
 * What the setting is about is whether a player's development is knowable in
 * advance, so this reports the spread of a player's season-to-season change
 * **around his own average** at that life stage — the part that is genuinely a
 * surprise. A career that grows steadily scores near 0 however fast it grows.
 */
console.log("\nB. UNPREDICTABILITY — sd of a player's ovr change around HIS OWN average");
console.log("   Raw |change| would conflate growth and decline with randomness; both are");
console.log("   meant to be big and both are predictable. This is the surprise only.");
console.log("   'shock' is the share of seasons landing 5+ away from that player's own norm.");
console.log("   ages   |  random:   sd  shock  |  steady:   sd  shock");
for (const [lo, hi, label] of [[16, 23, "16-23"], [24, 30, "24-30"], [31, 38, "31-38"]] as const) {
  const cells = MODELS.map((m) => {
    const resid: number[] = [];
    for (const c of careers[m]) {
      const deltas: number[] = [];
      for (let age = Math.max(lo, START_AGE + 1); age <= Math.min(hi, END_AGE); age++) {
        const i = age - START_AGE;
        deltas.push(c.byAge[i] - c.byAge[i - 1]);
      }
      if (deltas.length < 2) continue;
      const own = mean(deltas);
      for (const d of deltas) resid.push(d - own);
    }
    const shock = resid.filter((d) => Math.abs(d) >= 5).length / resid.length;
    return `${f(sd(resid), 2)} ${f(shock * 100, 1)}%`;
  });
  console.log(`   ${label}  | ${cells.join("  | ")}`);
}

// ------------------------------------------------------------- C. the spread
console.log("\nC. CAREER SPREAD — do careers still differ from one another?");
console.log("   If steady's sd collapses, the variance was deleted rather than moved.");
console.log("   metric        |  random  steady");
const peakRows: [string, (c: Career[]) => number][] = [
  ["peak ovr mean", (c) => mean(c.map((x) => x.peak))],
  ["peak ovr sd", (c) => sd(c.map((x) => x.peak))],
  ["peak p10", (c) => pct(c.map((x) => x.peak), 0.1)],
  ["peak p90", (c) => pct(c.map((x) => x.peak), 0.9)],
];
for (const [label, fn] of peakRows) {
  console.log(`   ${label.padEnd(13)} | ${MODELS.map((m) => f(fn(careers[m]))).join("  ")}`);
}

// ------------------------------------------------------------ D. the ceiling
console.log("\nD. THE CEILING — share of a full-minutes cohort whose peak reaches:");
console.log("   Steady near zero at 75+ means growthDamping has walled the league off.");
console.log("   bar |  random  steady");
for (const bar of [70, 75, 80, 85]) {
  const cells = MODELS.map((m) =>
    `${f((careers[m].filter((c) => c.peak >= bar).length / careers[m].length) * 100, 1)}%`);
  console.log(`   ${String(bar).padStart(3)} | ${cells.join("  ")}`);
}

// ---------------------------------------------------------- E. the inflation
console.log("\nE. INFLATION PROXY — survival-weighted mean lifetime ovr delta, age 18 on");
console.log("   Must be ~0 or slightly negative per PHYSICAL_AGE_SHIFT. Positive = the");
console.log("   league's rostered mean ratchets up over a dynasty. Real gate is a dynasty audit.");
console.log("   pos |  random  steady");
for (const pos of [...POSITIONS, "ALL" as const]) {
  const cells = MODELS.map((m) => {
    let total = 0;
    let n = 0;
    for (const c of careers[m]) {
      if (pos !== "ALL" && c.pos !== pos) continue;
      // Sum of each season's change, weighted by the chance he is still
      // playing to have it — i.e. the drift a surviving population actually
      // experiences, which is what moves a league's rostered mean. Growth he
      // retires before collecting does not count.
      let alive = 1;
      for (let age = 19; age <= END_AGE; age++) {
        alive *= 1 - retirementProbability(age, true);
        total += alive * (c.byAge[age - START_AGE] - c.byAge[age - 1 - START_AGE]);
      }
      n++;
    }
    return f(n === 0 ? 0 : total / n, 2);
  });
  console.log(`   ${String(pos).padEnd(3)} | ${cells.join("  ")}`);
}

// ------------------------------------------------------------ F. the forecast
console.log("\nF. THE SCOUT — how well does potential at 16 predict the peak he reaches?");
console.log("   Steady should forecast far better: sixteen trials of a near-deterministic");
console.log("   career agree with each other. That is correct, not degenerate — the scouting");
console.log("   fog becomes the only thing between the user and the answer.");
console.log("   metric            |  random  steady");
for (const [label, fn] of [
  ["mean potential", (c: Career[]) => mean(c.map((x) => x.potentialAt16))],
  ["mean |pot - peak|", (c: Career[]) => mean(c.map((x) => Math.abs(x.potentialAt16 - x.peak)))],
  ["share peak >= pot", (c: Career[]) => (c.filter((x) => x.peak >= x.potentialAt16).length / c.length) * 100],
] as const) {
  console.log(`   ${label.padEnd(17)} | ${MODELS.map((m) => f(fn(careers[m]))).join("  ")}`);
}
console.log("   (above is an EVER-PRESENT, the best case. estimatePotential forecasts at a");
console.log("    minutesFactor of 1 against MINUTES_FACTOR_MAX 1.15, so a man who plays every");
console.log("    week is expected to beat it. At rotation minutes:)");
const rotation: Record<string, Career[]> = {};
for (const model of MODELS) rotation[model] = allCareers(model, 0.5);
for (const [label, fn] of [
  ["mean |pot - peak|", (c: Career[]) => mean(c.map((x) => Math.abs(x.potentialAt16 - x.peak)))],
  ["share peak >= pot", (c: Career[]) => (c.filter((x) => x.peak >= x.potentialAt16).length / c.length) * 100],
] as const) {
  console.log(`   ${label.padEnd(17)} | ${MODELS.map((m) => f(fn(rotation[m]))).join("  ")}`);
}
