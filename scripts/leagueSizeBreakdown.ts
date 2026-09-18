/**
 * Where the bytes actually are in an aged save.
 *
 * `leagueSizeTiming.ts` shows the league reaching ~88 MB of JSON by season 14,
 * with every mutation's IndexedDB write costing seconds and postMessage's
 * structuredClone costing more. This breaks that total down per top-level field
 * (and inside `players`) so a fix can target the bulk instead of guessing.
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";

const SEASONS = Number(process.argv[2] ?? 14);

const mb = (n: number) => (n / 1e6).toFixed(1).padStart(6);

const rng = mulberry32(7);
let league = createLeagueState(0, rng);
for (let s = 1; s <= SEASONS; s++) {
  league = simThrough(league, "season", rng);
  league = simOffseason(league, rng);
}

const total = JSON.stringify(league).length;
console.log(`After ${SEASONS} seasons: ${mb(total)} MB total\n`);

const rows = Object.entries(league as unknown as Record<string, unknown>)
  .map(([key, v]) => [key, JSON.stringify(v ?? null).length] as const)
  .sort((a, b) => b[1] - a[1]);

console.log("top-level field           MB     % of save");
for (const [key, size] of rows) {
  if (size < 10_000) continue;
  console.log(
    `${key.padEnd(24)} ${mb(size)}  ${((size / total) * 100).toFixed(1)}%`,
  );
}

// Inside players: retired vs active, and how much is career stat history.
const players = league.players;
const activePids = new Set(league.teams.flatMap((t) => [...t.roster, ...t.academyRoster]));
const active = players.filter((p) => activePids.has(p.pid));
const inactive = players.filter((p) => !activePids.has(p.pid));
const statsBytes = players.reduce((n, p) => n + JSON.stringify(p.recentStats).length, 0);
const histBytes = players.reduce((n, p) => n + JSON.stringify(p.recentHist ?? null).length, 0);

console.log(`\nplayers: ${players.length} total`);
console.log(`  on a roster:     ${String(active.length).padStart(6)}  ${mb(JSON.stringify(active).length)} MB`);
console.log(`  not on a roster: ${String(inactive.length).padStart(6)}  ${mb(JSON.stringify(inactive).length)} MB  (retired/free, never pruned)`);
console.log(`  of which stats[] history: ${mb(statsBytes)} MB`);
console.log(`  of which hist[] ratings:  ${mb(histBytes)} MB`);

console.log(`\ntransfers: ${league.transfers.length} rows`);
console.log(`newsEvents: ${league.newsEvents.length} rows`);
