/**
 * A/B probe that runs unmodified on BOTH the merge base and the clock branch.
 *
 * Uses only APIs both trees have. `-finalClock` is total stoppage on either
 * model (the base plays both halves' worth at the end; the branch splits it, but
 * the whistle still sits that far below zero).
 *
 * shots/match is the honest read on "how much football was played" — goals are
 * the same measurement with several times the variance on top.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";

const SEASONS = Number(process.env.SEASONS ?? 12);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

const goals: number[] = [];
const shots: number[] = [];
const homeWins: number[] = [];
const champPts: number[] = [];
const stoppage: number[] = [];

for (let i = 0; i < SEASONS; i++) {
  const s = simSeason(mulberry32(12345 + i * 977));
  let g = 0;
  let sh = 0;
  let hw = 0;
  const pts = new Map<number, number>();
  for (const m of s.matches) {
    g += m.homeGoals + m.awayGoals;
    if (m.homeGoals > m.awayGoals) hw++;
    for (const l of m.boxScore.home) sh += l.shots;
    for (const l of m.boxScore.away) sh += l.shots;
    const fc = m.boxScore.finalClock;
    if (fc !== undefined) stoppage.push(-fc);
    const h = m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    const a = m.awayGoals > m.homeGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    pts.set(m.home, (pts.get(m.home) ?? 0) + h);
    pts.set(m.away, (pts.get(m.away) ?? 0) + a);
  }
  goals.push(g / s.matches.length);
  shots.push(sh / s.matches.length);
  homeWins.push(hw / s.matches.length);
  champPts.push(Math.max(...pts.values()));
}

const line = (name: string, a: number[], dp = 4) =>
  `${name.padEnd(16)} mean ${mean(a).toFixed(dp)}  sd ${sd(a).toFixed(dp)}  se ${(sd(a) / Math.sqrt(a.length)).toFixed(dp)}`;

console.log(`seasons ${SEASONS}`);
console.log(line("goals/match", goals));
console.log(line("shots/match", shots, 3));
console.log(line("home win rate", homeWins));
console.log(line("champion pts", champPts, 2));
console.log(
  `stoppage/match   mean ${mean(stoppage).toFixed(1)}s  (${(mean(stoppage) / 60).toFixed(2)} min)  n=${stoppage.length}`,
);
