/**
 * How big a club looks to a player (stature), league by league, on a freshly
 * generated world: the best, median and worst top-flight club of each country.
 * Used to size the ambition pull against the home pull (docs/club-reputation.md).
 *
 *   SEED=1 npx tsx scripts/statureGapProbe.ts
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { clubStatures } from "../src/core/ai/clubContext.js";
import { mulberry32 } from "../src/engine/rng.js";

const seed = Number(process.env.SEED ?? 1);
const league = createLeagueState(0, mulberry32(seed));
const statures = clubStatures(league.teams, league.players);
const byComp = new Map(league.competitions.filter((c) => c.tier === 1).map((c) => [c.id, c]));

const rows: { country: string; best: number; median: number; worst: number }[] = [];
for (const comp of byComp.values()) {
  const s = league.teams
    .filter((t) => t.compId === comp.id)
    .map((t) => statures.get(t.tid)!)
    .sort((a, b) => b - a);
  rows.push({ country: comp.country, best: s[0], median: s[Math.floor(s.length / 2)], worst: s[s.length - 1] });
}
rows.sort((a, b) => b.median - a.median);
console.log("top-flight stature at generation (0-1): best / median / worst");
for (const r of rows) {
  console.log(`${r.country.padEnd(15)} ${r.best.toFixed(3)}  ${r.median.toFixed(3)}  ${r.worst.toFixed(3)}`);
}
