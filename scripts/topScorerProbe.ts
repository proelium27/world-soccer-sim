/**
 * Attribution probe for the M3 top-scorer gate (test/validation/m3-top-scorer.test.ts).
 *
 * That gate takes the max goals over EVERY player in the world, with no
 * competition filter, while its stated rationale is a single league's Golden
 * Boot ("in line with real top-flight totals, ~30-36"). Those are different
 * quantities, and the difference grows with the world: a maximum over a larger
 * sample rises on sample size alone. When the world went from 12 competitions to
 * 16, the gate could therefore fail without any change in how much an individual
 * league scores.
 *
 * This prints both so the two explanations can be told apart:
 *   - world max       — what the gate actually measures
 *   - per-competition — what its rationale is about
 *
 * If per-competition tops sit in their usual range while the world max climbs,
 * the gate is measuring world size, not scoring inflation.
 *
 * Run: npx tsx scripts/topScorerProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { competitionOf } from "../src/core/competitions.js";

const SEASONS = Number(process.env.SEASONS ?? 5);

let worldSum = 0;
const tier1Tops: number[] = [];
let compCount = 0;

for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(3000 + s);
  let league = createLeagueState(0, rng);
  league = simThrough(league, "season", rng);

  const compOfTid = new Map(league.teams.map((t) => [t.tid, t.compId]));
  const bestByComp = new Map<number, number>();
  let worldMax = 0;

  for (const p of league.players) {
    for (const ss of p.recentStats) {
      if (ss.goals > worldMax) worldMax = ss.goals;
      const compId = compOfTid.get(ss.tid);
      if (compId === undefined) continue;
      if (ss.goals > (bestByComp.get(compId) ?? 0)) bestByComp.set(compId, ss.goals);
    }
  }
  compCount = bestByComp.size;
  worldSum += worldMax;

  // Split by tier: only a tier-1 league has a "Golden Boot" the gate's rationale
  // is talking about, and tier-2 totals sit lower, so pooling them would drag
  // the comparison down and flatter the conclusion.
  const t1 = [...bestByComp.entries()]
    .filter(([compId]) => competitionOf(league.competitions, compId).tier === 1)
    .map(([, g]) => g)
    .sort((a, b) => b - a);
  tier1Tops.push(...t1);
  console.log(`seed ${3000 + s}: world max ${worldMax}  | tier-1 tops ${t1.join(", ")}`);
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`\ncompetitions seen: ${compCount}`);
console.log(`world max, mean over ${SEASONS} seasons: ${(worldSum / SEASONS).toFixed(1)}   (gate allows 18-36)`);
console.log(`tier-1 top scorer, mean ${mean(tier1Tops).toFixed(1)}  max ${Math.max(...tier1Tops)}  n=${tier1Tops.length}`);
