/**
 * How long a FULL save takes (the first save of every session), under
 * fake-indexeddb, split by what it writes. Diagnoses the full-write cost the
 * `seasons` store added (docs/lazy-career-plan.md phase 3).
 *
 *   npx tsx scripts/fullSaveTiming.ts
 */
import "fake-indexeddb/auto";
import { createLeagueState } from "../src/core/leagueState.js";
import { englandCompetitions } from "../src/core/competitions.js";
import { mulberry32 } from "../src/engine/rng.js";
import { saveLeague, resetWriteCache, storedSeasonRows } from "../src/db/index.js";

const league = createLeagueState(3, mulberry32(42), 0, "normal", englandCompetitions());
console.log(`${league.players.length} players`);

let t = performance.now();
const lid = await saveLeague(league);
console.log(`first save (new league): ${(performance.now() - t).toFixed(0)}ms`);
console.log(`history rows: ${(await storedSeasonRows(lid)).length}`);

for (let i = 0; i < 3; i++) {
  resetWriteCache();
  t = performance.now();
  await saveLeague({ ...league, lid });
  console.log(`full rewrite ${i + 1}: ${(performance.now() - t).toFixed(0)}ms`);
}
t = performance.now();
await saveLeague({ ...league, lid });
console.log(`incremental save: ${(performance.now() - t).toFixed(0)}ms`);
