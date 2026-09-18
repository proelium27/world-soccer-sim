/**
 * Second-level breakdown of the two fields that dominate an aged save.
 *
 * `leagueSizeBreakdown.ts` (14 seasons, 87.9 MB) found:
 *   players 56.2 MB (64%) -- of which hist[] ratings 34.0 MB, stats[] 16.0 MB
 *   cupHistory 18.6 MB (21%)
 * Both are far bigger than expected, so this drills into what's actually inside
 * them and what each candidate prune would save.
 *
 * Dumps the simmed league to $CLAUDE_JOB_DIR/tmp (or /tmp) so repeat analysis
 * doesn't pay the ~10 minute sim again: pass a path as argv[3] to reuse it.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";

const SEASONS = Number(process.argv[2] ?? 14);
const cachePath = process.argv[3]
  ?? `${process.env.CLAUDE_JOB_DIR ?? "/tmp"}/tmp/league${SEASONS}.json`;

const mb = (n: number) => (n / 1e6).toFixed(1).padStart(6);
const size = (v: unknown) => JSON.stringify(v ?? null).length;

let league: LeagueStore;
if (existsSync(cachePath)) {
  console.log(`(reusing cached league at ${cachePath})\n`);
  league = JSON.parse(readFileSync(cachePath, "utf8")) as LeagueStore;
} else {
  const rng = mulberry32(7);
  league = createLeagueState(0, rng);
  for (let s = 1; s <= SEASONS; s++) {
    league = simThrough(league, "season", rng);
    league = simOffseason(league, rng);
  }
  // /tmp/tmp does not exist when CLAUDE_JOB_DIR is unset, and throwing here
  // would waste the whole sim that just ran.
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(league));
  console.log(`(cached league to ${cachePath})\n`);
}

const total = size(league);
console.log(`${SEASONS} seasons, ${mb(total)} MB total\n`);

// --- cupHistory ---------------------------------------------------------
const cupHistory = league.cupHistory as unknown as Record<string, unknown>[];
const cupTotal = size(cupHistory);
console.log(`cupHistory: ${mb(cupTotal)} MB across ${cupHistory.length} seasons`);
if (cupHistory.length > 0) {
  const perField = new Map<string, number>();
  for (const cup of cupHistory) {
    for (const [k, v] of Object.entries(cup)) {
      perField.set(k, (perField.get(k) ?? 0) + size(v));
    }
  }
  for (const [k, v] of [...perField].sort((a, b) => b[1] - a[1])) {
    if (v < 5_000) continue;
    console.log(`  ${k.padEnd(20)} ${mb(v)} MB  ${((v / cupTotal) * 100).toFixed(1)}% of cupHistory`);
  }
  // Box scores are the suspected bulk: per-player lines for every cup tie ever.
  let boxBytes = 0;
  let ties = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.boxScore !== undefined) { boxBytes += size(o.boxScore); ties++; }
      Object.values(o).forEach(walk);
    }
  };
  walk(cupHistory);
  console.log(`  -> boxScore payloads: ${mb(boxBytes)} MB across ${ties} ties/matches`);
}

// --- players ------------------------------------------------------------
const players = league.players;
const activePids = new Set(league.teams.flatMap((t) => [...t.roster, ...t.academyRoster]));
let histBytes = 0, statsBytes = 0, histRows = 0, statRows = 0;
let retiredHist = 0, retiredStats = 0;
for (const p of players) {
  const h = size(p.recentHist), st = size(p.recentStats);
  histBytes += h; statsBytes += st;
  histRows += (p.recentHist ?? []).length; statRows += p.recentStats.length;
  if (!activePids.has(p.pid)) { retiredHist += h; retiredStats += st; }
}
console.log(`\nplayers: ${mb(size(players))} MB across ${players.length} players`);
console.log(`  hist[]  ${mb(histBytes)} MB  ${histRows} rows  (~${Math.round(histBytes / Math.max(histRows, 1))} bytes/row)`);
console.log(`  stats[] ${mb(statsBytes)} MB  ${statRows} rows  (~${Math.round(statsBytes / Math.max(statRows, 1))} bytes/row)`);
if (players.length > 0) {
  const sample = players.find((p) => (p.recentHist ?? []).length > 2);
  if (sample?.recentHist?.[0]) {
    console.log(`  one hist row has ${Object.keys(sample.recentHist[0]).length} keys: ${Object.keys(sample.recentHist[0]).join(",")}`);
  }
}

// --- what each prune would save ----------------------------------------
console.log("\nsavings if we...");
const rows: [string, number][] = [
  ["drop boxScores from cupHistory", (() => {
    let b = 0; const walk = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o.boxScore !== undefined) b += size(o.boxScore);
        Object.values(o).forEach(walk);
      }
    }; walk(league.cupHistory); return b;
  })()],
  ["drop hist[] for players off every roster", retiredHist],
  ["drop stats[] for players off every roster", retiredStats],
  ["drop every player off every roster entirely", players.filter((p) => !activePids.has(p.pid)).reduce((n, p) => n + size(p), 0)],
  ["drop powerRankingHistory", size(league.powerRankingHistory)],
  ["drop newsEvents", size(league.newsEvents)],
];
for (const [label, bytes] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(42)} -${mb(bytes)} MB  (${((bytes / total) * 100).toFixed(1)}% of save)`);
}
