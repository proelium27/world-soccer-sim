/**
 * How big does AMERICAS_ACCOMPLISHMENT_SCALE have to be for a career in the
 * Americas to stay off the worldwide honours and the GOAT board?
 *
 * Sims a spectator world on the shipped competitions, then re-scores every
 * completed season's world awards and the final GOAT board at several scales.
 * World awards feed nothing in the sim, so one simmed world answers every
 * scale. Reported per scale:
 *
 *  - Ballon d'Or: seasons with a player at a club in the Americas in the top 10,
 *    and the best rank one reached.
 *  - World Team of the Year: places taken by clubs in the Americas.
 *  - Goalkeeper / Defender of the Year shortlists: best rank from the Americas.
 *  - GOAT board: best rank of a career spent mostly (by appearances) in the
 *    Americas, and how many such careers make the top 50.
 *
 * Past seasons are re-scored on the players still in the pool, so a season's
 * retirees are missing from it — fine for a question about who reaches the top.
 *
 *   SEASONS=15 SEED=1 npx tsx scripts/americasScaleProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";
import { SEASON_MATCHDAYS } from "../src/core/calendar.js";
import { computeWorldAwards } from "../src/core/worldAwards.js";
import { confederationCupChampions } from "../src/core/international/index.js";
import { allCareers } from "../src/core/frivolities/careers.js";
import {
  computeHonours, emptyHonours, honourSourcesOf, scorePlayer,
} from "../src/core/frivolities/goat.js";
import { americasTids } from "../src/core/americasClubs.js";

const SEASONS = Number(process.env.SEASONS ?? 15);
const SEED = Number(process.env.SEED ?? 1);
const SCALES = [1, 0.5, 0.35, 0.25, 0.15];
const GOAT_TOP = 50;

const rng = mulberry32(SEED);
let league: LeagueStore = createLeagueState(SPECTATOR_TID, rng, SEED, "normal");
for (let s = 0; s < SEASONS; s++) {
  league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
    if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish`);
    league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  }
  league = simOffseason(league, rng);
  console.error(`season ${s + 1}/${SEASONS} done`);
}

const americas = new Set(americasTids(league.teams, league.competitions));
const seasons = league.seasonHistory.slice(-SEASONS);

console.log(`seed ${SEED}, ${seasons.length} seasons, ${americas.size} clubs in the Americas\n`);
console.log("world awards (re-scored)");
console.log("scale  BdO-top10-seasons  best-BdO-rank  XI-places  best-GK-rank  best-DEF-rank");
for (const scale of SCALES) {
  let bdoSeasons = 0;
  let bestBdo = Infinity;
  let xiPlaces = 0;
  let bestGk = Infinity;
  let bestDef = Infinity;
  for (const h of seasons) {
    const awards = computeWorldAwards(league.players, h.season, {
      compsByTid: h.compsByTid,
      competitions: league.competitions,
      championTidByCompId: h.championTidByCompId,
      cup: league.cupHistory.find((c) => c.season === h.season) ?? null,
      americasCup: (league.americasCupHistory ?? []).find((c) => c.season === h.season) ?? null,
      domesticCups: (league.domesticCupHistory ?? []).filter((c) => c.season === h.season),
      worldCupChampion: league.international.history.find((t) => t.season === h.season)?.champion ?? null,
      confederationCupChampions: confederationCupChampions(league.international.confederationCupHistory, h.season),
      americasScale: scale,
    });
    const rankOf = (list: { tid: number }[]) => list.findIndex((e) => americas.has(e.tid));
    const b = rankOf(awards.ballonDOr);
    if (b >= 0) { bdoSeasons++; bestBdo = Math.min(bestBdo, b + 1); }
    const gk = rankOf(awards.goalkeeperOfYear ?? []);
    if (gk >= 0) bestGk = Math.min(bestGk, gk + 1);
    const def = rankOf(awards.defenderOfYear ?? []);
    if (def >= 0) bestDef = Math.min(bestDef, def + 1);
    const tidByPid = new Map<number, number>();
    for (const p of league.players) {
      const line = p.recentStats.find((st) => st.season === h.season);
      if (line) tidByPid.set(p.pid, line.tid);
    }
    for (const pid of awards.worldTeamOfYear) {
      if (pid !== null && americas.has(tidByPid.get(pid) ?? -1)) xiPlaces++;
    }
  }
  const fmt = (n: number) => (n === Infinity ? "-" : String(n));
  console.log(
    `${scale.toFixed(2).padStart(5)}  ${String(bdoSeasons).padStart(17)}  ${fmt(bestBdo).padStart(13)}  `
    + `${String(xiPlaces).padStart(9)}  ${fmt(bestGk).padStart(12)}  ${fmt(bestDef).padStart(13)}`,
  );
}

const careers = allCareers(league);
const sources = honourSourcesOf(league);
const honours = computeHonours(sources, careers);
const americasShare = new Map(careers.map((c) => {
  let apps = 0;
  let am = 0;
  for (const s of c.seasons) {
    apps += s.apps;
    if (americas.has(s.tid)) am += s.apps;
  }
  return [c.pid, apps > 0 ? am / apps : 0];
}));

console.log("\nGOAT board (final season)");
console.log("scale  best-rank-mostly-Americas  mostly-Americas-in-top50  best-rank-any-Americas-time");
for (const scale of SCALES) {
  const ranked = careers
    .map((c) => ({ pid: c.pid, score: scorePlayer(c, honours.get(c.pid) ?? emptyHonours(), americas, scale).score }))
    .sort((a, b) => b.score - a.score || a.pid - b.pid);
  const mostly = ranked.findIndex((r) => (americasShare.get(r.pid) ?? 0) > 0.5);
  const any = ranked.findIndex((r) => (americasShare.get(r.pid) ?? 0) > 0);
  const inTop = ranked.slice(0, GOAT_TOP).filter((r) => (americasShare.get(r.pid) ?? 0) > 0.5).length;
  console.log(
    `${scale.toFixed(2).padStart(5)}  ${String(mostly + 1).padStart(25)}  ${String(inTop).padStart(24)}  `
    + `${String(any + 1).padStart(27)}`,
  );
}

// Who the best careers spent mostly in the Americas are, at the shipped scale,
// and where their points come from — to tell a genuine Americas career reaching
// the board from one that made its name in Europe after starting there.
console.log("\nbest mostly-Americas careers at 0.25");
const shipped = careers
  .map((c) => ({ c, row: scorePlayer(c, honours.get(c.pid) ?? emptyHonours(), americas, 0.25) }))
  .sort((a, b) => b.row.score - a.row.score || a.c.pid - b.c.pid);
shipped
  .map((x, i) => ({ ...x, rank: i + 1 }))
  .filter((x) => (americasShare.get(x.c.pid) ?? 0) > 0.5)
  .slice(0, 3)
  .forEach(({ c, row, rank }) => {
    const europeSeasons = c.seasons.filter((s) => s.apps > 0 && !americas.has(s.tid)).length;
    const americasSeasons = c.seasons.filter((s) => s.apps > 0 && americas.has(s.tid)).length;
    const parts = row.components.map((comp) => `${comp.key} ${comp.points}`).join(", ");
    const top = row.components
      .flatMap((comp) => comp.terms)
      .sort((a, b) => b.points - a.points)
      .slice(0, 4)
      .map((t) => `${t.key} ${t.count}x${Number(t.weight.toFixed(3))}`)
      .join("; ");
    console.log(
      `#${rank} ${c.name} peak ${c.peakOvr}, ${((americasShare.get(c.pid) ?? 0) * 100).toFixed(0)}% Americas apps, `
      + `${americasSeasons} seasons there / ${europeSeasons} in Europe, score ${row.score} (${parts})\n    top terms: ${top}`,
    );
  });
console.log(`board #1: ${shipped[0].c.name}, score ${shipped[0].row.score}, `
  + `${((americasShare.get(shipped[0].c.pid) ?? 0) * 100).toFixed(0)}% Americas apps`);
console.log(`board #50 score: ${shipped[49]?.row.score ?? "-"}`);
