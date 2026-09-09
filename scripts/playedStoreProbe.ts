/**
 * What one mutation costs, before and after splitting `played` out.
 *
 * "Before" is not a guess or a stale reading from another branch: it is the
 * same record with `played` still on it, which is exactly the object
 * `saveLeague` used to put. Run:
 *
 *   npx tsx scripts/playedStoreProbe.ts [matchdays]
 *
 * Note the numbers here are NOT a function of save age. `played` is emptied
 * every offseason and rebuilt every season, so it scales with world size and
 * how far into the season you are — which is why every save-size probe in this
 * repo missed it (they all sample after the offseason) and why the symptom
 * reads as "slow on some devices" rather than "slow on old saves".
 */
import "fake-indexeddb/auto";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { mulberry32 } from "../src/engine/rng.js";
import { saveLeague, loadLeague, resetWriteCache, storedPlayedRows, getDb } from "../src/db/index.js";
import type { LeagueStore } from "../src/core/leagueState.js";

const TARGET = Number(process.argv[2] ?? 38);

const mb = (n: number) => (n / 1e6).toFixed(1).padStart(7) + " MB";
const clone = (v: unknown) => {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    structuredClone(v);
    best = Math.min(best, performance.now() - t);
  }
  return best.toFixed(0).padStart(5) + " ms";
};
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

  const rest = { ...league } as Partial<LeagueStore>;
  delete rest.players;
  delete rest.retiredPlayers;
  const before = { ...rest };
  delete rest.played;

  console.log("The object saveLeague puts on the leagues record:");
  console.log(`  before (played inline)  ${mb(JSON.stringify(before).length)}  structuredClone ${clone(before)}`);
  console.log(`  after  (played split)   ${mb(JSON.stringify(rest).length)}  structuredClone ${clone(rest)}`);

  const lid = await saveLeague(league);
  console.log(`\nthrough the real save path:`);
  console.log(`  full write (first save of a session) ${await timed(() => saveLeague({ ...league, lid }))}`);

  const mutated: LeagueStore = {
    ...league,
    lid,
    teams: league.teams.map((t, i) => (i === 0 ? { ...t, scoutingSpend: 4242 } : t)),
  };
  console.log(`  one mutation (scouting slider)       ${await timed(() => saveLeague(mutated))}`);
  console.log(`  match rows on disk: ${(await storedPlayedRows(lid)).length}`);

  // Load is the one thing this could have made worse: the same ~203 MB of box
  // scores now arrives as 10.5k rows rather than inside one record. Paid once a
  // session against once a click, but worth knowing rather than assuming.
  resetWriteCache();
  console.log(`  loadLeague                           ${await timed(() => loadLeague(lid))}`);
  resetWriteCache();

  // The A/B for that, on the part that actually changed: one store read of a
  // record carrying played inline (the pre-v6 shape loadLeague still accepts)
  // against the split record plus the range query that replaces the field.
  const db = await getDb();
  const stored = (await db.get("leagues", lid))!;
  await db.put("leagues", { ...stored, lid: 999, played: league.played } as typeof stored);

  console.log(`\nreading the same data back:`);
  console.log(`  before  one record, played inline    ${await timed(() => db.get("leagues", 999))}`);
  const recordOnly = await timed(() => db.get("leagues", lid));
  const range = await timed(() => db.getAll("played", IDBKeyRange.bound([lid], [lid, []])));
  console.log(`  after   league record                ${recordOnly}`);
  console.log(`        + ${league.played.length} played rows            ${range}`);
}

await main();
