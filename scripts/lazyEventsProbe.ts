/**
 * What a loaded league weighs once match event timelines stop coming with it.
 *
 * `played` is ~83% of a mid-season save and events are the bulk of a box score,
 * so a loaded league that carries every one of them is most of what the tab is
 * holding. `loadLeague` now drops them and `loadMatchEvents` fetches a match's
 * back on demand. Run:
 *
 *   npx tsx scripts/lazyEventsProbe.ts [matchdays]
 *
 * "Before" is not a stale reading from another branch: it is the same loaded
 * league with its timelines read back off disk, which is exactly the object
 * `loadLeague` used to return.
 *
 * As with playedStoreProbe, these numbers are NOT a function of save age —
 * `played` is emptied every offseason, so they scale with world size and how
 * far into the season you are.
 */
import "fake-indexeddb/auto";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { mulberry32 } from "../src/engine/rng.js";
import {
  saveLeague, loadLeague, resetWriteCache, withMatchEvents, isEventsElided,
} from "../src/db/index.js";
import type { LeagueStore } from "../src/core/leagueState.js";

const TARGET = Number(process.argv[2] ?? 19);

const mb = (n: number) => (n / 1e6).toFixed(1).padStart(7) + " MB";
const pct = (a: number, b: number) => ((a / b) * 100).toFixed(1).padStart(5) + "%";
const bytes = (v: unknown) => JSON.stringify(v).length;
const timed = async (fn: () => Promise<unknown>) => {
  const t = performance.now();
  await fn();
  return (performance.now() - t).toFixed(0).padStart(5) + " ms";
};

async function main() {
  let league: LeagueStore = createLeagueState(0, mulberry32(7));
  console.log(`world: ${league.teams.length} clubs, ${league.players.length} players`);
  for (let md = 1; md <= TARGET; md++) {
    league = simThrough(league, { matchday: md }, mulberry32(1000 + md));
  }
  console.log(`simmed to matchday ${TARGET}: ${league.played.length} matches\n`);

  const lid = await saveLeague(league);
  resetWriteCache();

  const after = (await loadLeague(lid))!;
  const before = await withMatchEvents(after);

  const elided = after.played.filter(isEventsElided).length;
  console.log(`matches whose timeline was dropped: ${elided} of ${after.played.length}\n`);

  const playedBefore = bytes(before.played);
  const playedAfter = bytes(after.played);
  const wholeBefore = bytes(before);
  const wholeAfter = bytes(after);

  console.log("the league object the app holds for the whole session:");
  console.log(`  before  ${mb(wholeBefore)}   of which played ${mb(playedBefore)} (${pct(playedBefore, wholeBefore)})`);
  console.log(`  after   ${mb(wholeAfter)}   of which played ${mb(playedAfter)} (${pct(playedAfter, wholeAfter)})`);
  console.log(`  saved   ${mb(wholeBefore - wholeAfter)}   (${pct(wholeBefore - wholeAfter, wholeBefore)} of the league)`);

  const perMatch = (playedBefore - playedAfter) / Math.max(after.played.length, 1);
  console.log(`\n  events per match: ${(perMatch / 1000).toFixed(1)} KB`);
  // The shipped world plays this many league fixtures in a season, so a full
  // season's worth of timelines is what a save carries by matchday 38.
  const FULL_SEASON_FIXTURES = 10_538;
  console.log(`  extrapolated to a full season (${FULL_SEASON_FIXTURES} fixtures): ${mb(perMatch * FULL_SEASON_FIXTURES)} never loaded`);

  resetWriteCache();
  console.log(`\nloadLeague: ${await timed(() => loadLeague(lid))}`);
}

await main();
