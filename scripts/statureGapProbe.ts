/**
 * How big a club looks to a player (stature), league by league, on a freshly
 * generated world: the best and median top-flight club of each country, under
 * the shipped weighting and a few candidate ones that add the club's own wealth
 * (its income scale, `financeScale`). Used to size the pull toward good clubs
 * (docs/club-reputation.md).
 *
 *   SEED=1 npx tsx scripts/statureGapProbe.ts
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { squadStrength } from "../src/core/ai/clubContext.js";
import { teamReputation } from "../src/core/teams/reputation.js";
import { financeScale } from "../src/core/finance/budget.js";
import { mulberry32 } from "../src/engine/rng.js";
import {
  STATURE_STRENGTH_LO, STATURE_STRENGTH_HI, REPUTATION_MAX,
} from "../src/core/constants.js";
import type { Player } from "../src/core/players/types.js";

const seed = Number(process.env.SEED ?? 1);
const league = createLeagueState(0, mulberry32(seed));
const byPid = new Map(league.players.map((p) => [p.pid, p]));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// [strength, reputation, wealth] weights.
const WEIGHTINGS: Record<string, [number, number, number]> = {
  shipped: [0.65, 0.35, 0],
  "wealth .25": [0.5, 0.25, 0.25],
  "wealth .35": [0.45, 0.2, 0.35],
};

const parts = new Map<number, [number, number, number]>();
for (const t of league.teams) {
  const roster = t.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
  const s = clamp01((squadStrength(roster) - STATURE_STRENGTH_LO) / (STATURE_STRENGTH_HI - STATURE_STRENGTH_LO));
  const r = clamp01(teamReputation(t) / REPUTATION_MAX);
  const w = clamp01(financeScale(league.competitions, t.compId));
  parts.set(t.tid, [s, r, w]);
}

for (const [name, [ws, wr, ww]] of Object.entries(WEIGHTINGS)) {
  console.log(`\n${name} (strength ${ws}, reputation ${wr}, wealth ${ww}): best / median top-flight club`);
  const rows: { country: string; best: number; median: number }[] = [];
  for (const comp of league.competitions.filter((c) => c.tier === 1)) {
    const s = league.teams
      .filter((t) => t.compId === comp.id)
      .map((t) => { const [a, b, c] = parts.get(t.tid)!; return ws * a + wr * b + ww * c; })
      .sort((a, b) => b - a);
    rows.push({ country: comp.country, best: s[0], median: s[Math.floor(s.length / 2)] });
  }
  rows.sort((a, b) => b.median - a.median);
  for (const r of rows) console.log(`  ${r.country.padEnd(15)} ${r.best.toFixed(3)}  ${r.median.toFixed(3)}`);
}
