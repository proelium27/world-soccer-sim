/**
 * Finds the age-curve shape that lets youth intake arrive a year younger
 * without inflating the world.
 *
 * THE PROBLEM. `generatePlayer` rolls ratings with no age term, so taking a
 * player in at 15 rather than 16 does not make him rawer — it hands him, and
 * so every player in the world, an extra year on the growth side of
 * `BASE_AGE_CURVE`. Measured on a 20-season dynasty, that is worth ~5 OVR in
 * every country and it breaks weak-league solvency.
 *
 * WHY NOT `YOUTH_BASE_OFFSET`, the constant that exists for exactly this.
 * `youthGenerationBase`'s softplus floor absorbs most of any increase: measured
 * on a real world's academy anchors, one offset point buys back only ~0.27 OVR,
 * so parity needs roughly offset 42 — which would sit most of the world's
 * academies on that floor generating identical youth, the gradient collapse
 * `YOUTH_BASE_FLOOR`'s comment exists to prevent.
 *
 * THE FIX THIS SWEEPS. `BASE_AGE_CURVE` is clamped at x = -8, so it claims a
 * 15-year-old grows exactly as fast as an 18-year-old. Extending it leftward
 * with smaller values, and trimming the shoulder, makes the extra year come out
 * of the years around it rather than being added on top — total growth from
 * entry to peak stays put, and the generation base (hence the academy gradient)
 * is untouched.
 *
 * THE CONSTRAINT THAT SHAPES THE SEARCH, and it is not obvious: the rating
 * groups read the curve at shifted ages, so entering at 15 they reach
 *   physical  x >= -7.0     (extra 2.700)
 *   skill     x >= -11.5    (extra 3.000)
 *   gk skill  x >= -12.0    (extra 3.000)
 * A left tail below -8 therefore cannot touch PHYSICAL at all. Two knobs:
 *   `young` — the far-left plateau, which pays for skill and keepers
 *   `cut`   — subtracted from the growth shoulder, the only thing physical sees
 *
 * The target row is age 16 on the SHIPPED curve. A candidate is right when
 * `err` is ~0: same league, entered a year earlier.
 *
 *   npx tsx scripts/youthCurveSweep.ts
 *   YOUNG=0,0.5,1 CUT=0.2,0.3,0.4 npx tsx scripts/youthCurveSweep.ts
 */
import { generatePlayer } from "../src/core/players/generate.js";
import { progressPlayer, retirementProbability } from "../src/core/players/progression.js";
import { mulberry32, hashInts } from "../src/engine/rng.js";
import type { Player } from "../src/core/players/types.js";
import { POSITIONS } from "../src/core/players/types.js";
import { createLeagueState } from "../src/core/leagueState.js";
import {
  FULL_SEASON_APPEARANCES, YOUTH_BASE_OFFSET, YOUTH_BASE_FLOOR, YOUTH_BASE_SOFTNESS,
  PROGRESSION_PROFILES, type ProgressionProfile, type ProgressionModel,
} from "../src/core/constants.js";

const SEEDS = (process.env.SEEDS ?? "1,2,3").split(",").map(Number);
const COHORT = Number(process.env.N ?? 400);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const END_AGE = 38;
const SENIOR_AGE = 18;

const YOUNG = (process.env.YOUNG ?? "0,0.5,1,1.5,2").split(",").map(Number);
const CUT = (process.env.CUT ?? "0,0.15,0.3,0.45").split(",").map(Number);
const OFFSETS = (process.env.OFFSETS ?? String(YOUTH_BASE_OFFSET)).split(",").map(Number);

/** A real world's academy anchors — see youthAgeSweep.ts for why not a synthetic spread. */
const ANCHORS: number[] = (() => {
  const league = createLeagueState(0, mulberry32(99));
  return league.teams.map((t) => t.academyBase).sort((a, b) => a - b);
})();

function genBase(academyBase: number, offset: number): number {
  const raw = academyBase - offset;
  const x = (raw - YOUTH_BASE_FLOOR) / YOUTH_BASE_SOFTNESS;
  if (x > 30) return raw;
  return YOUTH_BASE_FLOOR + YOUTH_BASE_SOFTNESS * Math.log1p(Math.exp(x));
}

const SHIPPED = PROGRESSION_PROFILES[MODEL].ageCurve;

/**
 * A candidate curve: the shipped one with the growth side trimmed by `cut` and
 * a tail added below -8 ramping from `young` at -13 up to the trimmed -8.
 *
 * Growth points only. The decline side is deliberately untouched — the extra
 * year is on the growth side, so paying for it out of decline would change how
 * long a career lasts rather than how high it reaches.
 */
function candidate(young: number, cut: number): readonly (readonly [number, number])[] {
  const trimmed = SHIPPED.map(([x, y]) => [x, y > 0 ? Math.max(0, y - cut) : y] as const);
  const at8 = trimmed.find(([x]) => x === -8)![1];
  const tail: (readonly [number, number])[] = [];
  for (let x = -13; x <= -9; x++) {
    const t = (x + 13) / 5; // 0 at -13, 1 at -8
    tail.push([x, young + (at8 - young) * t] as const);
  }
  return [...tail, ...trimmed];
}

function withMinutes(p: Player, season: number, age: number): Player {
  const share = age < SENIOR_AGE ? 0 : 1;
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
  carried: number; bar70: number; bar80: number; bar85: number;
  entry: number; peak: number; drift: number; pot: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
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
    const rng = mulberry32(hashInts(seed, 0x79_6f_75));
    for (let i = 0; i < COHORT; i++) {
      const pos = POSITIONS[i % POSITIONS.length];
      const base = genBase(ANCHORS[(i * 7) % ANCHORS.length], offset);
      let p = generatePlayer(rng, pos, base, i + 1, startAge, 1, seed, undefined, null, MODEL);
      entries.push(p.ovr);
      pots.push(p.potential);

      const byAge = new Map<number, number>([[startAge, p.ovr]]);
      let peak = p.ovr;
      for (let age = startAge; age < END_AGE; age++) {
        p = progressPlayer(rng, withMinutes(p, age - startAge + 1, age), age - startAge + 1, false, MODEL);
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
    carried: mean(carried), bar70: at(70), bar80: at(80), bar85: at(85),
    entry: mean(entries), peak: mean(peaks), drift: drift / n, pot: mean(pots),
  };
}

const f = (x: number, d = 1) => x.toFixed(d).padStart(6);
const setCurve = (c: readonly (readonly [number, number])[]) => {
  (PROGRESSION_PROFILES as Record<ProgressionModel, ProgressionProfile>)[MODEL] = {
    ...PROGRESSION_PROFILES[MODEL], ageCurve: c,
  };
};

console.log(`cohort ${COHORT} x ${SEEDS.length} seeds, model "${MODEL}", offset ${OFFSETS.join("/")}\n`);

// The world as it ships: entering at 16 on the shipped curve.
const target = measure(16, YOUTH_BASE_OFFSET);
console.log("young   cut  off | carried    70+    80+    85+  entry   peak  drift    pot |    err");
console.log(
  `  TARGET age16 shipped | ${f(target.carried)} ${f(target.bar70)} ${f(target.bar80)} `
  + `${f(target.bar85)} ${f(target.entry)} ${f(target.peak)} ${f(target.drift, 2)} ${f(target.pot)} |      -`,
);
console.log("  " + "-".repeat(74));

const rows: { key: string; s: Stats; err: number }[] = [];
for (const young of YOUNG) {
  for (const cut of CUT) {
    setCurve(candidate(young, cut));
    for (const offset of OFFSETS) {
      const s = measure(15, offset);
      // Deliberately NOT scored on `drift`. It is a survival-weighted sum over a
      // FIXED window (19-38), and the two arms arrive at 19 having had a
      // different number of growth years — the younger one is higher there and
      // so has less left to gain. That makes it structurally lower for the
      // treatment whatever the curve does, which is a property of the window
      // rather than a signal. It is still printed, as a one-way guard: it
      // should never come out ABOVE the target.
      const err =
        Math.abs(s.carried - target.carried) * 2.0
        + Math.abs(s.bar70 - target.bar70) * 0.5
        + Math.abs(s.bar80 - target.bar80) * 1.0
        + Math.abs(s.bar85 - target.bar85) * 1.5;
      const key = `${f(young, 2)} ${f(cut, 2)} ${String(offset).padStart(4)}`;
      rows.push({ key, s, err });
      console.log(
        `${key} | ${f(s.carried)} ${f(s.bar70)} ${f(s.bar80)} ${f(s.bar85)} `
        + `${f(s.entry)} ${f(s.peak)} ${f(s.drift, 2)} ${f(s.pot)} | ${f(err, 2)}`,
      );
    }
  }
}
setCurve(SHIPPED);

rows.sort((a, b) => a.err - b.err);
console.log("\nclosest to the shipped world:");
for (const r of rows.slice(0, 3)) console.log(`  young=${r.key.trim()}  err ${r.err.toFixed(2)}`);
