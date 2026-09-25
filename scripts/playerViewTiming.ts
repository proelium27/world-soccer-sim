/**
 * How long the Player Profile's "How he sees clubs" card takes, and a sample of
 * what it says (core/transfers/playerView.ts). The first call builds the club
 * contexts; every later profile against the same league reuses them.
 *   npx tsx scripts/playerViewTiming.ts
 */
import { makeLeague } from "../test/helpers/league.js";
import { playerClubView } from "../src/core/transfers/playerView.js";

const league = makeLeague(0, 1);
const name = (tid: number) => league.teams.find((t) => t.tid === tid)?.name ?? `#${tid}`;
const ps = league.players.filter((p) => p.ovr > 70).slice(0, 20);
let t = performance.now();
playerClubView(league, ps[0]);
console.log("first (builds contexts)", (performance.now() - t).toFixed(1), "ms");
t = performance.now();
for (const p of ps.slice(1)) playerClubView(league, p);
console.log("per further player", ((performance.now() - t) / (ps.length - 1)).toFixed(2), "ms");
for (const p of ps.slice(0, 3)) {
  const v = playerClubView(league, p);
  console.log(`\n${p.name} (${p.ovr}, ${p.nationality})`);
  console.log(" likes:", v.favourites.map((c) => `${name(c.tid)} ${c.interest}`).join(" | "));
  console.log(" plays:", v.wouldPlay.map((c) => name(c.tid)).join(" | "));
  console.log(" refuses", v.refusedCount, "of", v.clubCount, "| your club:", v.yourClub?.interest ?? "-");
}
