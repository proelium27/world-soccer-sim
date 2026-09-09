/**
 * What is actually available in free agency at the moment the USER shops it.
 *
 * The pool is stocked by `trimRosterSurplus` (offseason step 6), which releases
 * whoever a club is *deepest* at rather than whoever is worst — so it is
 * routinely stocked with players better than the club shopping for them. Two
 * separate things used to make that exploitable, and this probe measures both:
 *
 *   1. AI free agency ran at step 4, BEFORE the trim that creates the pool, so
 *      nothing in the world signed a free agent between one summer and the
 *      next. Read the "END OF SEASON" line against the previous "SUMMER
 *      WINDOW" line: if they are identical, the user held a twelve-month
 *      monopoly on every player released that year.
 *   2. `signFreeAgent` skipped the player-will module, so a free transfer was
 *      the one route around a gate the buy path has always applied. The
 *      "signable by" columns are the measurement for that: a free agent a club
 *      cannot attract is not really in its market, however long he sits there.
 *
 * Usage:
 *   SEASONS=6 SEED=7 npx tsx scripts/freeAgentWindowProbe.ts
 */
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { clubStatures } from "../src/core/ai/clubContext.js";
import { refusesFreeAgentSigningWith } from "../src/core/transfers/playerWill.js";
import type { Player } from "../src/core/players/types.js";

const SEASONS = Number(process.env.SEASONS ?? 6);
const SEED = Number(process.env.SEED ?? 7);
const USER_TID = 276;

/** Statures to report "best signable" for: roughly a third, second and top tier club. */
const BANDS: [string, number][] = [["weak (0.15)", 0.15], ["mid (0.30)", 0.30], ["big (0.60)", 0.60]];

function pool(l: LeagueStore): Player[] {
  const on = new Set<number>();
  for (const t of l.teams) {
    for (const p of t.roster) on.add(p);
    for (const p of t.academyRoster ?? []) on.add(p);
    for (const p of t.youthTrialists ?? []) on.add(p);
  }
  return l.players.filter((p) => !on.has(p.pid));
}

function line(tag: string, l: LeagueStore): string {
  const fa = pool(l);
  const statures = clubStatures(l.teams, l.players);
  const n = (lo: number, hi: number) => fa.filter((p) => p.ovr >= lo && p.ovr < hi).length;
  const best = BANDS.map(([label, s]) => {
    const top = fa
      .filter((p) => !refusesFreeAgentSigningWith(p, s, statures))
      .sort((a, b) => b.ovr - a.ovr)[0];
    return `${label} ${top ? String(top.ovr).padStart(2) : "--"}`;
  }).join("  ");
  return `  ${tag.padEnd(34)} 85+:${String(n(85, 999)).padStart(3)}  80-84:${String(n(80, 85)).padStart(3)}`
    + `  75-79:${String(n(75, 80)).padStart(3)}  70-74:${String(n(70, 75)).padStart(3)}`
    + `  pool ${String(fa.length).padStart(5)} | best signable by: ${best}`;
}

let league = createLeagueState(
  USER_TID, mulberry32(SEED), 0, undefined, undefined, true, null, "random",
);
console.log(`seed ${SEED}, ${SEASONS} seasons, ${league.teams.length} clubs`);
console.log(`"best signable by" = highest-ovr free agent a club of that stature can actually attract\n`);

for (let s = 1; s <= SEASONS; s++) {
  const seasonRng = mulberry32(SEED * 1000 + s);
  league = simThrough(league, "season", seasonRng);
  // simThrough halts before the user's cup final; a second call finishes it.
  if (league.phase !== "offseason") league = simThrough(league, "season", seasonRng);
  console.log(`season ${s}:`);
  console.log(line("END OF SEASON (before offseason)", league));
  league = simOffseason(league, mulberry32(SEED * 2000 + s));
  console.log(line("SUMMER WINDOW (what the user sees)", league));
}
