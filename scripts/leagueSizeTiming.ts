/**
 * Time the main-thread costs that scale with total league size, rather than
 * with any one page's work.
 *
 * The Transfers page's own derivations and render measure flat (~40-100ms) even
 * on a 24-season save, yet production INP on /transfers is p75 31s on mobile.
 * So the freeze is something shared. Both of these block the main thread and
 * grow with the save: the IndexedDB write on every mutation, and the
 * structuredClone that postMessage does to hand the league to the sim worker.
 */
import "fake-indexeddb/auto";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { saveLeague } from "../src/db/leagueDb.js";

const SEASONS = Number(process.argv[2] ?? 12);

async function ms(fn: () => unknown | Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

const rng = mulberry32(7);
let league = createLeagueState(0, rng);

console.log(
  ["season", "players", "statLines", "MB(json)", "structuredClone", "saveLeague"].join("\t"),
);

for (let s = 1; s <= SEASONS; s++) {
  league = simThrough(league, "season", rng);
  league = simOffseason(league, rng);

  const statLines = league.players.reduce((n, p) => n + p.recentStats.length, 0);
  const bytes = JSON.stringify(league).length;

  // What postMessage to the sim worker costs on the main thread.
  const tClone = await ms(() => structuredClone(league));
  // What every single league mutation costs before the UI can update.
  const tSave = await ms(() => saveLeague({ ...league, lid: 1 }));

  console.log(
    [
      s, league.players.length, statLines, (bytes / 1e6).toFixed(1),
      tClone.toFixed(0), tSave.toFixed(0),
    ].join("\t"),
  );
}
