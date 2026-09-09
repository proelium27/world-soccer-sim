/**
 * Derives the constants that give world generation an age model, by measuring
 * the equilibrium the sim actually settles into.
 *
 * WHY THIS EXISTS. `generatePlayer` rolls ratings from a club's base with no age
 * term — `age` only sets `born` — so a fresh world's age->OVR profile is FLAT:
 * measured, a generated 18-year-old averages 76.2 and a 33-year-old 75.2. That
 * is not the world the sim runs; the sim's equilibrium is a hump. So a new save
 * spends its opening seasons converging on a shape it should have started in,
 * and three things follow, all of them reported by players:
 *
 *   1. Generated teenagers are handed peak-age ratings AND the full growth
 *      curve on top, so they become the best players in the world within two
 *      seasons. Measured, the ten best players in the big four are aged
 *      25/21/32/29/19/22/32/23/32/33 at season 1 and 21/21/23/21/23/21/21/22/
 *      21/21 by season 4.
 *   2. Those same players blow through GROWTH_DAMPING into the RATING_MAX
 *      ceiling: best OVR 91 -> 99 by season 5, the 90+ population 11 -> 60.
 *   3. The generated 30-33 band only ever declines and retires, so squads
 *      hollow out: big-four top-flight mean 75.4 -> 63.3 by season 4 while p90
 *      RISES. Uniformly-good squads become top-heavy.
 *
 * WHAT IT MEASURES. The equilibrium rostered age distribution and the
 * equilibrium mean OVR at each age, pooled over SEEDS, then:
 *
 *   weight(a) = share of rostered players aged a
 *   offset(a) = E(a) - Ê          (Ê = weighted mean of E under weight)
 *   lift      = Ê - G             (G = the flat level generation produces today)
 *
 * so a generated player of age `a` lands at `E(a)` when both are applied, and at
 * the correct SHAPE with today's overall LEVEL when `lift` is dropped. Keeping
 * them separate is deliberate: the shape is the bug, the lift is a level change
 * that raises opening wage bills (wages are cubic in ovr) and has to clear the
 * documented season-1 solvency knife-edge on its own evidence.
 *
 * SEASONS=25 IS A FLOOR, NOT A PREFERENCE. A generated player is aged
 * INITIAL_AGE_MIN..MAX at season 1, so at season S he is S-1+18 .. S-1+33.
 * Measuring at season 13 — the cheap choice — reads every age above 30 off the
 * generated cohort, which is precisely the inflated population being corrected;
 * its 30-33 band is not equilibrium. At season 26 that cohort is 43-58, i.e.
 * gone. Measure earlier and you calibrate against the bug.
 *
 * The user's club is excluded throughout (unmanaged headlessly, so it rots and
 * contaminates every tail — see the audit headers).
 *
 * Run: SEEDS=1,2 SEASONS=25 npx tsx scripts/generationAgeCalibrate.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { YOUTH_AGE, type ProgressionModel } from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 25);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const seedsRaw = process.env.SEEDS?.trim();
const SEEDS = (seedsRaw || "1,2").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
if (!SEEDS.length || !SEEDS.every(Number.isFinite)) throw new Error(`bad SEEDS "${process.env.SEEDS}"`);
const USER_TID = 0;
/** Ages the table covers. Below YOUTH_AGE nobody exists; above this the counts are single digits. */
const AGE_MIN = YOUTH_AGE;
const AGE_MAX = 38;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function rostered(l: LeagueStore) {
  const byPid = new Map(l.players.map((p) => [p.pid, p]));
  const out: { age: number; ovr: number; tier: number }[] = [];
  for (const t of l.teams) {
    if (t.tid === USER_TID) continue;
    const c = competitionOf(l.competitions, t.compId);
    for (const pid of t.roster) {
      const p = byPid.get(pid);
      if (p) out.push({ age: l.season - p.born, ovr: p.ovr, tier: c.tier });
    }
  }
  return out;
}

/** Pooled across seeds: every rostered OVR observed at each age at equilibrium. */
const eqByAge = new Map<number, number[]>();
/** Per-tier, kept only as a diagnostic: one world-wide table is an approximation. */
const eqByTierAge = new Map<string, number[]>();
/** The flat level generation produces today, pooled across seeds. */
const genOvrs: number[] = [];

for (const seed of SEEDS) {
  console.log(`\n=== seed ${seed} ===`);
  let league = createLeagueState(USER_TID, mulberry32(seed), 0, undefined, undefined, true, null, MODEL);
  for (const r of rostered(league)) genOvrs.push(r.ovr);
  for (let s = 0; s < SEASONS; s++) {
    const rng = mulberry32(seed * 1000 + s);
    league = simThrough(league, "season", rng);
    for (let k = 0; (league.phase as string) !== "offseason"; k++) {
      if (k >= 3) throw new Error(`season ${league.season} refuses to finish`);
      league = simThrough(league, "season", rng);
    }
    league = simOffseason(league, mulberry32(seed * 2000 + s));
    process.stdout.write(`  ...season ${league.season - 1}\n`);
  }
  for (const r of rostered(league)) {
    if (r.age < AGE_MIN || r.age > AGE_MAX) continue;
    if (!eqByAge.has(r.age)) eqByAge.set(r.age, []);
    eqByAge.get(r.age)!.push(r.ovr);
    const k = `${r.tier}:${r.age}`;
    if (!eqByTierAge.has(k)) eqByTierAge.set(k, []);
    eqByTierAge.get(k)!.push(r.ovr);
  }
}

const G = mean(genOvrs);
const ages: number[] = [];
for (let a = AGE_MIN; a <= AGE_MAX; a++) if (eqByAge.get(a)?.length) ages.push(a);
const total = ages.reduce((s, a) => s + eqByAge.get(a)!.length, 0);
const weight = new Map(ages.map((a) => [a, eqByAge.get(a)!.length / total]));
const E = new Map(ages.map((a) => [a, mean(eqByAge.get(a)!)]));
const Ehat = ages.reduce((s, a) => s + weight.get(a)! * E.get(a)!, 0);

console.log(`\n\npooled over seeds ${SEEDS.join(",")}, ${SEASONS} seasons, model ${MODEL}`);
console.log(`generation's flat level G = ${G.toFixed(2)}`);
console.log(`equilibrium weighted mean E-hat = ${Ehat.toFixed(2)}`);
console.log(`=> lift = ${(Ehat - G).toFixed(2)}\n`);

console.log("age      n    weight    E(a)   offset(a)   |  per-tier E(a): T1 / T2 / T3");
for (const a of ages) {
  const tiers = [1, 2, 3].map((t) => {
    const xs = eqByTierAge.get(`${t}:${a}`);
    return xs?.length ? mean(xs).toFixed(1).padStart(5) : "    -";
  });
  console.log(
    String(a).padStart(3),
    String(eqByAge.get(a)!.length).padStart(6),
    weight.get(a)!.toFixed(4).padStart(8),
    E.get(a)!.toFixed(1).padStart(7),
    (E.get(a)! - Ehat).toFixed(1).padStart(9),
    "  | ", tiers.join(" / "),
  );
}

// Emitted ready to paste, because a hand-typed table is a table that drifts from
// the run that justified it.
console.log("\n\n// --- paste into constants.ts ---");
console.log("export const GENERATION_AGE_WEIGHTS: Readonly<Record<number, number>> = {");
console.log("  " + ages.map((a) => `${a}: ${weight.get(a)!.toFixed(4)}`).join(", "));
console.log("};");
console.log("export const GENERATION_AGE_OFFSET: Readonly<Record<number, number>> = {");
console.log("  " + ages.map((a) => `${a}: ${(E.get(a)! - Ehat).toFixed(1)}`).join(", "));
console.log("};");
console.log(`export const GENERATION_EQUILIBRIUM_LIFT = ${(Ehat - G).toFixed(1)};`);
