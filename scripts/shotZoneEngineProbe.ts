/**
 * What shot zones do to scoring (engine/matchSim.ts, SHOT_ZONE_STAGE).
 *
 * Zones are meant to REDISTRIBUTE chance quality — tap-ins convert, long shots
 * rarely do — without moving league scoring. This runs `simSeason` over a few
 * seeds and prints the totals that must hold (shots, on target, goals, xG per
 * match) plus, where the events carry a zone, the split and conversion per zone
 * against real top-flight figures (~7/55/38 of shots, ~32% / ~12.5% / ~3.5%).
 *
 * Run on this tree and on the merge base; the totals should match within noise.
 * Run: SEEDS=3 npx tsx scripts/shotZoneEngineProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";

const SEEDS = Number(process.env.SEEDS ?? 3);
const SHOT_TYPES = new Set(["shot_blocked", "shot_off_target", "shot_saved", "goal"]);

let matches = 0, shots = 0, sot = 0, goals = 0, xg = 0;
const zShots = [0, 0, 0], zGoals = [0, 0, 0], zBlocked = [0, 0, 0];
let homeWins = 0;

for (let s = 0; s < SEEDS; s++) {
  const season = simSeason(mulberry32(9100 + s));
  for (const m of season.matches) {
    matches++;
    goals += m.homeGoals + m.awayGoals;
    if (m.homeGoals > m.awayGoals) homeWins++;
    for (const l of [...m.boxScore.home, ...m.boxScore.away]) {
      shots += l.shots;
      sot += l.shotsOnTarget;
      xg += l.xg;
    }
    for (const e of m.boxScore.events) {
      const z = (e as { zone?: number }).zone;
      if (z === undefined || !SHOT_TYPES.has(e.type)) continue;
      zShots[z]++;
      if (e.type === "goal") zGoals[z]++;
      if (e.type === "shot_blocked") zBlocked[z]++;
    }
  }
}

const zTotal = zShots.reduce((a, b) => a + b, 0);
console.log(`${matches} matches over ${SEEDS} seasons`);
console.log(`  shots/match       ${(shots / matches).toFixed(3)}`);
console.log(`  on target/match   ${(sot / matches).toFixed(3)}`);
console.log(`  goals/match       ${(goals / matches).toFixed(4)}`);
console.log(`  xG/match          ${(xg / matches).toFixed(4)}`);
console.log(`  goals per shot    ${(goals / shots).toFixed(4)}`);
console.log(`  home-win rate     ${(homeWins / matches).toFixed(4)}`);
if (zTotal > 0) {
  const names = ["six-yard", "box", "outside"];
  const real = ["7% / 32%", "55% / 12.5%", "38% / 3.5%"];
  console.log(`  zoned open-play shots: ${zTotal}`);
  names.forEach((n, i) =>
    console.log(
      `    ${n.padEnd(9)} share ${(100 * zShots[i] / zTotal).toFixed(1)}%  converts ${(100 * zGoals[i] / zShots[i]).toFixed(1)}%  blocked ${(100 * zBlocked[i] / zShots[i]).toFixed(1)}%   (real ${real[i]})`,
    ),
  );
}
