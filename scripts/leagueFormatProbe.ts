/**
 * Plays a fresh world through two seasons and prints what the per-country
 * league formats actually did: each split division's groups and fixture counts,
 * the odd-sized US divisions' game counts, every promotion playoff's shape and
 * every swap's counts, so a format that silently fell back to a double round
 * robin (or a swap that changed a division's size) shows up.
 *
 *   npx tsx scripts/leagueFormatProbe.ts            # seed 1, 2 seasons
 *   SEED=3 SEASONS=3 npx tsx scripts/leagueFormatProbe.ts
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import {
  competitionSplit, competitionTeamCount, competitionSeasonGames, promotionLinks,
  effectivePromotionSpots, competitionPlayoffFormat,
} from "../src/core/competitions.js";
import { computeStandings } from "../src/core/standings.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";

const seed = Number(process.env.SEED ?? 1);
const seasons = Number(process.env.SEASONS ?? 2);
const rng = mulberry32(seed);
let league = createLeagueState(SPECTATOR_TID, rng, seed);

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`); };

for (let s = 0; s < seasons; s++) {
  console.log(`\n=== Season ${league.season} ===`);
  const sizes = new Map(league.competitions.map((c) => [c.id, league.teams.filter((t) => t.compId === c.id).length]));
  league = simThrough(league, "season", rng);
  if (league.phase !== "offseason") fail(`season did not finish (${league.schedule.length} games left)`);

  for (const comp of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const set = new Set(tids);
    const played = league.played.filter((m) => set.has(m.home));
    const perClub = new Map<number, number>();
    for (const m of played) {
      perClub.set(m.home, (perClub.get(m.home) ?? 0) + 1);
      perClub.set(m.away, (perClub.get(m.away) ?? 0) + 1);
    }
    const games = [...perClub.values()];
    const min = Math.min(...games);
    const max = Math.max(...games);
    const split = competitionSplit(comp);
    const expected = competitionSeasonGames(comp);
    const interesting = split || tids.length % 2 === 1 || ["Scotland", "Greece", "United States"].includes(comp.country);
    if (sizes.get(comp.id) !== competitionTeamCount(comp)) fail(`${comp.name} started with ${sizes.get(comp.id)} clubs, expected ${competitionTeamCount(comp)}`);
    if (max > expected) fail(`${comp.name}: a club played ${max} games, the format has ${expected}`);
    if (!interesting) continue;
    console.log(`${comp.name}: ${tids.length} clubs, ${played.length} matches, games per club ${min}-${max} (format max ${expected})`);
    if (split) {
      const table = computeStandings(tids, played, undefined, split);
      const groups = split.groups.map((_, g) => table.filter((r) => r.group === g));
      groups.forEach((rows, g) => {
        console.log(`  ${split.names[g]}: ${rows.map((r) => `${r.points}`).join(" ")}`);
        if (rows.length !== split.groups[g]) fail(`${comp.name} group ${g} has ${rows.length} clubs`);
      });
    }
  }

  for (const p of league.promotionPlayoffs) {
    const d1 = league.competitions.find((c) => c.id === p.d1CompId)!;
    const d2 = league.competitions.find((c) => c.id === p.d2CompId)!;
    if (["France", "Spain", "Scotland", "Portugal", "Netherlands", "Belgium", "Germany"].includes(p.country)) {
      console.log(`playoff ${d2.name} -> ${d1.name}: ${p.format}, ${p.ties.length} ties, winner ${p.winnerTid}, auto ${p.autoPromoted}/${p.autoRelegated}`);
    }
  }
  for (const t of league.titlePlayoffs ?? []) {
    const c = league.competitions.find((x) => x.id === t.compId)!;
    console.log(`title playoff ${c.name}: ${t.format}, ${t.teams.length} entrants, ${t.ties.length} ties, champion ${t.winnerTid}`);
  }

  const before = league;
  league = simOffseason(league, rng);
  for (const link of promotionLinks(league.competitions)) {
    const moved = league.teams.filter((t) => before.teams.find((b) => b.tid === t.tid)!.compId === link.lower.id && t.compId === link.upper.id).length;
    const spots = effectivePromotionSpots(league.competitions, link.upper, link.lower, 99, 99);
    if (["Spain", "Belgium", "Netherlands", "Scotland", "France", "Serbia"].includes(link.upper.country)) {
      console.log(`swap ${link.lower.name} -> ${link.upper.name}: ${moved} up (spots ${spots}, ${competitionPlayoffFormat(link.upper, link.lower)})`);
    }
  }
  for (const comp of league.competitions) {
    const n = league.teams.filter((t) => t.compId === comp.id).length;
    if (n !== competitionTeamCount(comp)) fail(`${comp.name} has ${n} clubs after the offseason`);
  }
}
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
