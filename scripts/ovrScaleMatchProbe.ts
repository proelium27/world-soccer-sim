/**
 * The distributional half of `ovrScaleProbe.ts`.
 *
 * The fingerprint probe answers "is it bit-identical". This one answers "and if
 * not, does it matter" — because the rating clamps at RATING_MIN/RATING_MAX mean
 * a shift cannot be perfectly neutral, and a scoreline hash is all-or-nothing so
 * it cannot tell a one-goal difference from a broken sim.
 *
 * Flip OVR_SCALE_SHIFT to 0 in constants.ts to get the merge base's numbers:
 * every shifted constant is written `<calibrated> + OVR_SCALE_SHIFT`, so 0
 * reproduces main exactly.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { OVR_SCALE_SHIFT } from "../src/core/constants.js";

const SEASONS = 8;

function pct(a: number[], f: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) * f)];
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

console.log(`OVR_SCALE_SHIFT = ${OVR_SCALE_SHIFT}`);

// --- match realism, averaged over several independent seasons -------------
const goals: number[] = [];
const homeWins: number[] = [];
const champPts: number[] = [];
for (let i = 0; i < SEASONS; i++) {
  const s = simSeason(mulberry32(12345 + i * 977));
  let g = 0;
  let hw = 0;
  for (const m of s.matches) {
    g += m.homeGoals + m.awayGoals;
    if (m.homeGoals > m.awayGoals) hw++;
  }
  goals.push(g / s.matches.length);
  homeWins.push(hw / s.matches.length);
  const pts = new Map<number, number>();
  for (const m of s.matches) {
    const h = m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    const a = m.awayGoals > m.homeGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    pts.set(m.home, (pts.get(m.home) ?? 0) + h);
    pts.set(m.away, (pts.get(m.away) ?? 0) + a);
  }
  champPts.push(Math.max(...pts.values()));
}
console.log(`goals/match   mean ${mean(goals).toFixed(4)}  range ${Math.min(...goals).toFixed(3)}-${Math.max(...goals).toFixed(3)}`);
console.log(`home win rate mean ${mean(homeWins).toFixed(4)}`);
console.log(`champion pts  mean ${mean(champPts).toFixed(2)}  range ${Math.min(...champPts)}-${Math.max(...champPts)}`);

// --- potential, which feeds transfer value through the potential gap ------
const league = createLeagueState(0, mulberry32(1), 1);
const pot = league.players.map((p) => p.potential);
const gap = league.players.map((p) => p.potential - p.ovr);
const atCeil = league.players.filter((p) => p.potential >= 99).length;
console.log(
  `potential     p50 ${pct(pot, 0.5)}  p99 ${pct(pot, 0.99)}  max ${Math.max(...pot)}  at 99: ${atCeil}`,
);
console.log(
  `potential gap mean ${mean(gap).toFixed(3)}  p50 ${pct(gap, 0.5)}  p90 ${pct(gap, 0.9)}  max ${Math.max(...gap)}`,
);
const ovrs = league.players.map((p) => p.ovr);
console.log(
  `world ovr     p50 ${pct(ovrs, 0.5)}  p99 ${pct(ovrs, 0.99)}  max ${Math.max(...ovrs)}`,
);
