/**
 * Which gate actually decides who keeps a career page: `isArchiveWorthy`, or
 * `RETIREE_ARCHIVE_LIMIT`?
 *
 * Sims a dynasty and reports, per offseason, how many retirees clear the quality
 * gate at its shipped thresholds and at some looser ones, plus how many are
 * referenced by the save at all. The point is to size the cap against the rate
 * that feeds it rather than against a guess.
 *
 * Run: npx tsx scripts/archiveGateProbe.ts [seasons] [seed]
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { referencedPids } from "../src/core/players/playerNames.js";
import type { Player } from "../src/core/players/types.js";

const SEASONS = Number(process.argv[2] ?? 10);
const SEED = Number(process.argv[3] ?? 7);

const apps = (p: Player) => p.recentStats.reduce((n, s) => n + s.appearances, 0);
const peak = (p: Player) => Math.max(p.ovr, ...p.recentHist.map((h) => h.ovr));

/** The shipped gate and three looser ones, to price how much each would admit. */
const GATES = [
  { name: "shipped (70 / 200)", peak: 70, apps: 200 },
  { name: "peak 65 / 200", peak: 65, apps: 200 },
  { name: "peak 60 / 100", peak: 60, apps: 100 },
  { name: "any appearance", peak: 0, apps: 1 },
] as const;

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng);
const totals = GATES.map(() => 0);
let retiredTotal = 0;

console.log(`seasons=${SEASONS} seed=${SEED}`);
console.log(`season | retired | ${GATES.map((g) => g.name.padStart(18)).join(" | ")} | referenced`);

for (let s = 1; s <= SEASONS; s++) {
  league = simThrough(league, "season", rng);
  while (league.phase !== "offseason") league = simThrough(league, "season", rng);

  const before = new Map(league.players.map((p) => [p.pid, p]));
  league = simOffseason(league, rng);
  const after = new Set(league.players.map((p) => p.pid));
  // Retirement and the free-agent cull both delete; only retirees are archived,
  // and only retirees leave references behind (the cull scrubs its own).
  const gone = [...before.values()].filter((p) => !after.has(p.pid));

  const counts = GATES.map((g) =>
    gone.filter((p) => apps(p) > 0 && (peak(p) >= g.peak || apps(p) >= g.apps)).length);
  counts.forEach((c, i) => { totals[i] += c; });
  retiredTotal += gone.length;

  const refs = referencedPids(league);
  const refGone = gone.filter((p) => refs.has(p.pid)).length;

  console.log(
    `${String(league.season).padStart(6)} | ${String(gone.length).padStart(7)} | ${counts.map((c) => String(c).padStart(18)).join(" | ")} | ${String(refGone).padStart(10)}`,
  );
}

const BYTES = 2204;
console.log(`\nper season, averaged over ${SEASONS}:`);
console.log(`  deleted           ${(retiredTotal / SEASONS).toFixed(0)}`);
GATES.forEach((g, i) => {
  const perSeason = totals[i] / SEASONS;
  console.log(
    `  ${g.name.padEnd(18)} ${perSeason.toFixed(1).padStart(6)}/season` +
    `  ->  ${((perSeason * 100 * BYTES) / 1e6).toFixed(1)} MB per century` +
    `, ${((perSeason * 159 * BYTES) / 1e6).toFixed(1)} MB by season 159`,
  );
});
console.log(`\narchive now holds ${league.retiredPlayers.length} rows, ${(JSON.stringify(league.retiredPlayers).length / 1e6).toFixed(2)} MB`);
