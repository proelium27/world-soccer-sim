/**
 * Why a lower `YOUTH_AGE` inflates the world, discriminating between the two
 * explanations that want opposite fixes.
 *
 * Three separate corrections (a bigger `YOUTH_BASE_OFFSET`, an extended
 * `BASE_AGE_CURVE` tail, and the exact per-group `entryGrowthDebt`) each left a
 * ~+3.3 OVR gap at season 21, despite the last of them being verified to land at
 * generation. Two things could be happening and they are not distinguishable
 * from a rostered mean:
 *
 *   DEVELOPMENT - the players really are better, because compensating at
 *     generation does not survive `growthDamping`. Damping scales down only
 *     POSITIVE deltas above `GROWTH_DAMPING_START`, so a player generated lower
 *     spends his extra year in the undamped region and overshoots the one he was
 *     supposed to match. Fix: reduce growth, not the starting level.
 *
 *   SELECTION - the players are no better, there are simply MORE of them. Entry
 *     a year earlier lengthens every career by a year, so the steady-state pool
 *     is bigger while roster slots are fixed, and clubs keep the best of a
 *     deeper pool. Fix: hold the pool size constant (intake volume), since
 *     nothing about how an individual is generated will help.
 *
 * The discriminator is to measure each age band over EVERY player alive - free
 * agents and academy included - and not just the rostered ones. If the whole
 * population's band means match across arms while the rostered means differ, it
 * is selection. If the whole population is also better, it is development.
 *
 *   SEASONS=20 SEED=1 npx tsx scripts/youthAgeDiagnose.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import {
  YOUTH_AGE, YOUTH_BASE_OFFSET, YOUTH_CONTRACT_LENGTH, YOUTH_INTAKE_MIN, YOUTH_INTAKE_MAX,
} from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 1);

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng);
const userTid = league.meta.userTid;

for (let s = 1; s <= SEASONS; s++) {
  league = simThrough(league, "season", rng);
  league = simOffseason(league, rng);
}

const tier1 = new Set(league.competitions.filter((c) => c.tier === 1).map((c) => c.id));
const d1Tids = new Set(
  league.teams.filter((t) => tier1.has(t.compId) && t.tid !== userTid).map((t) => t.tid),
);
/** pid -> the club holding him, senior roster or academy. */
const holder = new Map<number, number>();
for (const t of league.teams) {
  for (const pid of t.roster) holder.set(pid, t.tid);
  for (const pid of t.academyRoster) holder.set(pid, t.tid);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const BANDS: [string, number, number][] = [
  ["15-17", 15, 17], ["18-20", 18, 20], ["21-23", 21, 23],
  ["24-26", 24, 26], ["27-29", 27, 29], ["30-32", 30, 32], ["33+", 33, 99],
];

interface Row { age: number; ovr: number; rosteredD1: boolean; free: boolean }
const all: Row[] = league.players.map((p) => {
  const tid = holder.get(p.pid);
  return {
    age: league.season - p.born,
    ovr: p.ovr,
    rosteredD1: tid != null && d1Tids.has(tid),
    free: tid == null,
  };
});

console.log(
  `YOUTH_AGE ${YOUTH_AGE}, offset ${YOUTH_BASE_OFFSET}, contract ${YOUTH_CONTRACT_LENGTH}, `
  + `intake ${YOUTH_INTAKE_MIN}-${YOUTH_INTAKE_MAX}; season ${league.season}, seed ${SEED}\n`,
);
console.log(`POOL: ${all.length} players alive, ${all.filter((r) => r.free).length} unattached`);
console.log(`      ${all.filter((r) => r.rosteredD1).length} on tier-1 AI rosters\n`);

console.log("  band      ALL alive          |   tier-1 rostered");
console.log("            n     meanOvr      |     n     meanOvr");
for (const [label, lo, hi] of BANDS) {
  const alive = all.filter((r) => r.age >= lo && r.age <= hi);
  const ros = alive.filter((r) => r.rosteredD1);
  console.log(
    `  ${label.padEnd(6)} ${String(alive.length).padStart(5)}  ${mean(alive.map((r) => r.ovr)).toFixed(2).padStart(7)}      `
    + `| ${String(ros.length).padStart(5)}  ${mean(ros.map((r) => r.ovr)).toFixed(2).padStart(7)}`,
  );
}

const aliveAll = all.filter((r) => r.age >= 15);
const rosAll = all.filter((r) => r.rosteredD1);
console.log(
  `\n  TOTAL  ${String(aliveAll.length).padStart(5)}  ${mean(aliveAll.map((r) => r.ovr)).toFixed(2).padStart(7)}      `
  + `| ${String(rosAll.length).padStart(5)}  ${mean(rosAll.map((r) => r.ovr)).toFixed(2).padStart(7)}`,
);

/**
 * The sharpest single number: where a tier-1 roster place sits in the world's
 * own ovr distribution. If entry age only made the pool deeper, the BAR should
 * rise while the population behind it stays put.
 */
const sorted = [...aliveAll].map((r) => r.ovr).sort((a, b) => b - a);
const cut = rosAll.length;
console.log(
  `\n  a tier-1 place is the top ${cut} of ${sorted.length} alive `
  + `(${(cut / sorted.length * 100).toFixed(1)}%); the cut-off ovr is ${sorted[cut - 1] ?? 0}`,
);
