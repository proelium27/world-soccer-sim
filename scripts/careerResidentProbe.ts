/**
 * What a player's career history costs to hold in memory, on a real save, and
 * what cutting it to the resident window saves.
 *
 * `docs/lazy-career-plan.md` phase 3 holds only the last few seasons of each
 * player (`windowCareer`, the same window the worker is handed) and reads the
 * rest back from disk on demand. This loads an exported save — which carries
 * whole careers — three ways and measures the live heap each one holds: whole
 * careers (what the game held before), the window (what it holds now), and no
 * history at all. Live heap rather than bytes, because live objects cost more
 * than their serialized form.
 *
 * Each variant is built and measured inside its own function and dropped before
 * the next, so one cannot keep another alive through a module-level temporary.
 *
 *   node --expose-gc --import tsx scripts/careerResidentProbe.ts <save.json[.gz]>
 */
import { readFileSync } from "node:fs";
import type { LeagueStore } from "../src/core/leagueState.js";
import type { Player } from "../src/core/players/types.js";
import { migrateLeague } from "../src/db/migrate.js";
import { readLeagueFileText } from "../src/db/exportImport.js";
import { windowCareer } from "../src/core/simArchive.js";

const path = process.argv[2];
if (!path) throw new Error("usage: careerResidentProbe.ts <save>");
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with node --expose-gc");

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
function heap(): number {
  gc!(); gc!(); gc!();
  return process.memoryUsage().heapUsed;
}

const text = await readLeagueFileText(new Blob([readFileSync(path)]));
const load = (): LeagueStore => migrateLeague(JSON.parse(text) as LeagueStore);

type Shape = (p: Player) => Player;
const whole: Shape = (p) => p;
const windowed: Shape = (p) => windowCareer(p);
const none: Shape = (p) => ({ ...p, recentStats: [], recentHist: [] });

let held: LeagueStore | null = null;
/** Built in its own frame so the whole-career league it starts from is garbage by return. */
function shaped(shape: Shape): LeagueStore {
  const l = load();
  return { ...l, players: l.players.map(shape) };
}
function measure(shape: Shape): { bytes: number; stats: number; hist: number } {
  const base = heap();
  held = shaped(shape);
  const bytes = heap() - base;
  const stats = held.players.reduce((s, p) => s + p.recentStats.length, 0);
  const hist = held.players.reduce((s, p) => s + p.recentHist.length, 0);
  held = null;
  return { bytes, stats, hist };
}

const w = measure(whole);
const r = measure(windowed);
const n = measure(none);
const probe = load();
console.log(path);
console.log(`season ${probe.season}, ${probe.teams.length} clubs, ${probe.players.length} players`);
console.log("");
console.log("live heap of the whole league:");
console.log(`  whole careers   ${mb(w.bytes)}   (${w.stats} stat lines, ${w.hist} snapshots)`);
console.log(`  window only     ${mb(r.bytes)}   (${r.stats} stat lines, ${r.hist} snapshots)`);
console.log(`  no history      ${mb(n.bytes)}`);
console.log("");
console.log(`saved by the window: ${mb(w.bytes - r.bytes)} (${((1 - r.bytes / w.bytes) * 100).toFixed(1)}% of the league)`);
