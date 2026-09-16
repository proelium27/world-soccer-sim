/**
 * What the Americas cost in memory: the save, what crosses to the sim worker,
 * and the heap a season sim needs, on the 898-club world against the same world
 * without the four American countries (626 clubs).
 *
 * The payload is built with the exact detach chain `useSimWorker` runs before
 * every non-jump command, so "worker payload" is what a matchday advance really
 * structured-clones. `played` is measured mid-season and at the end, because it
 * is wiped every offseason and every other size probe in scripts/ samples after
 * that and misses it.
 *
 * One world per process, so resident size isn't carried from one into the other:
 *
 *   WORLD=full    SEASONS=2 node --expose-gc --import tsx scripts/americasMemoryProbe.ts
 *   WORLD=europe  SEASONS=2 node --expose-gc --import tsx scripts/americasMemoryProbe.ts
 */
import v8 from "node:v8";
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import {
  worldCompetitions, buildCompetitions, worldLeagueSpecs,
} from "../src/core/competitions.js";
import { COUNTRY_REGION } from "../src/core/constants.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";
import {
  detachArchive, detachPlayed, detachCareer, detachNews, detachTransfers,
} from "../src/core/simArchive.js";

const WORLD = process.env.WORLD ?? "full";
const SEASONS = Number(process.env.SEASONS ?? 2);
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with node --expose-gc --import tsx");

const comps = WORLD === "europe"
  ? buildCompetitions(worldLeagueSpecs().filter((s) => !COUNTRY_REGION[s.country]))
  : worldCompetitions();

const MB = (bytes: number) => (bytes / 1e6).toFixed(1);
const jsonBytes = (x: unknown) => JSON.stringify(x).length;

function workerPayload(league: LeagueStore): LeagueStore {
  const { payload: base } = detachArchive(league);
  const { payload: a } = detachPlayed(base);
  const { payload: b } = detachCareer(a);
  const { payload: c } = detachNews(b);
  return detachTransfers(c).payload;
}

function timeClone(x: unknown): number {
  const t0 = performance.now();
  structuredClone(x);
  return performance.now() - t0;
}

let peakRss = 0;
let peakHeapAfterSim = 0;

function sample(): void {
  const m = process.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
}

function report(label: string, league: LeagueStore, heapJustAfterSim: number | null): void {
  gc!();
  const live = process.memoryUsage();
  peakRss = Math.max(peakRss, live.rss);
  const payload = workerPayload(league);
  const row = {
    label,
    clubs: league.teams.length,
    players: league.players.length,
    matches: league.played.length,
    saveMB: MB(jsonBytes(league)),
    playedMB: MB(jsonBytes(league.played)),
    workerPayloadMB: MB(jsonBytes(payload)),
    cloneSaveMs: Math.round(timeClone(league)),
    clonePayloadMs: Math.round(timeClone(payload)),
    liveHeapMB: MB(live.heapUsed),
    heapJustAfterSimMB: heapJustAfterSim === null ? "-" : MB(heapJustAfterSim),
    rssMB: MB(live.rss),
  };
  console.log(JSON.stringify(row));
}

const rng = mulberry32(7);
const tGen = performance.now();
let league = createLeagueState(SPECTATOR_TID, rng, 0, undefined, comps);
console.log(`# world=${WORLD} generated in ${Math.round((performance.now() - tGen) / 1000)}s`);
const timer = setInterval(sample, 250);
report("season 1 start", league, null);

for (let s = 1; s <= SEASONS; s++) {
  let t0 = performance.now();
  league = simThrough(league, { matchday: 19 }, rng);
  let heap = process.memoryUsage().heapUsed;
  peakHeapAfterSim = Math.max(peakHeapAfterSim, heap);
  console.log(`# season ${s} to matchday 19 in ${Math.round((performance.now() - t0) / 1000)}s`);
  report(`season ${s} matchday 19`, league, heap);

  t0 = performance.now();
  league = simThrough(league, "season", rng);
  heap = process.memoryUsage().heapUsed;
  peakHeapAfterSim = Math.max(peakHeapAfterSim, heap);
  console.log(`# season ${s} to the end in ${Math.round((performance.now() - t0) / 1000)}s`);
  report(`season ${s} end`, league, heap);

  t0 = performance.now();
  league = simOffseason(league, rng);
  heap = process.memoryUsage().heapUsed;
  peakHeapAfterSim = Math.max(peakHeapAfterSim, heap);
  console.log(`# season ${s} offseason in ${Math.round((performance.now() - t0) / 1000)}s`);
  report(`season ${s} after offseason`, league, heap);
}

clearInterval(timer);
const stats = v8.getHeapStatistics();
console.log(
  `# peak rss ${MB(peakRss)} MB, highest heap seen straight after a sim ${MB(peakHeapAfterSim)} MB, `
    + `heap limit ${MB(stats.heap_size_limit)} MB`,
);
