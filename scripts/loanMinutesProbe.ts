/**
 * Does a loan deliver the thing it exists for — minutes for a young player who
 * wasn't getting them at home?
 *
 * A loan's whole purpose is development: `minutesFactor` nudges progression
 * during a player's growth years, so a loan that produces no appearances has
 * achieved nothing for anybody. `runAILoanMarket` screens for a player who is
 * young and outside his own club's XI, then requires the borrower to value him
 * above his parent's keep price by LOAN_MIN_SURPLUS — but **"values him more"
 * is not "will play him"**, and this probe measures the gap between those two.
 *
 * Plays a season, runs the offseason (which fires the summer AI loan market),
 * then plays the next season in full so every summer loanee has all 38
 * matchdays at his new club.
 *
 *   npx tsx scripts/loanMinutesProbe.ts        # SEED=n to vary the world
 *
 * Measured on seed 7, 626-club world (2026-09-07): of 1,110 summer loans, 47%
 * played at all, 31% made the loanee's XI, and the MEDIAN loanee played zero
 * games. It is still better than staying home (mean 11.1 appearances against
 * 6.4 for comparable u23 players outside their club's XI), so the mechanic
 * helps — it just misses more often than it lands.
 *
 * The diagnostic at the bottom is the actionable half: the two groups separate
 * almost perfectly on one number. Players who never played were a median 16 ovr
 * BELOW the weakest man in the loanee's XI; players who did were 6 ABOVE. Only
 * 30 of 592 non-playing loanees were better than their new club's worst
 * starter. So the market is sending players to clubs that rate them without
 * checking whether they would get in the team, which is the same class of
 * mistake `posWeakestStarterOvr` was added to fix on the buy side.
 */
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { resolveXI } from "../src/core/lineup/resolveXI.js";
import { teamSlots } from "../src/core/lineup/formations.js";
import { LOAN_AI_MAX_AGE } from "../src/core/constants.js";
import type { Player } from "../src/core/players/types.js";

const SEED = Number(process.env.SEED ?? 7);

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : "-");

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng);

/** simThrough halts before the user's own cup final, so one call may not finish. */
function playSeason(l: LeagueStore): LeagueStore {
  let out = l;
  for (let i = 0; i < 4 && out.phase !== "offseason"; i++) out = simThrough(out, "season", rng);
  return out;
}

league = playSeason(league);
league = simOffseason(league, rng);
const loans = league.activeLoans.filter((l) => l.startSeason === league.season);
console.log(`seed ${SEED}: ${loans.length} summer loans across ${league.teams.length} clubs`);

league = playSeason(league);
const season = league.season;
const byPid = new Map(league.players.map((p) => [p.pid, p]));
const appsOf = (pid: number) =>
  byPid.get(pid)?.stats.find((s) => s.season === season)?.appearances ?? 0;
const minsOf = (pid: number) =>
  byPid.get(pid)?.stats.find((s) => s.season === season)?.minutesPlayed ?? 0;

const xiCache = new Map<number, Player[]>();
function xiOf(tid: number): Player[] {
  const hit = xiCache.get(tid);
  if (hit) return hit;
  const team = league.teams.find((t) => t.tid === tid);
  if (!team) return [];
  const squad = team.roster
    .map((pid) => byPid.get(pid))
    .filter((p): p is Player => p !== undefined);
  const xi = resolveXI(squad, teamSlots(team), team.starters);
  xiCache.set(tid, xi);
  return xi;
}

const apps: number[] = [];
const mins: number[] = [];
let startedNow = 0;
const neverGap: number[] = [];
const playedGap: number[] = [];

for (const loan of loans) {
  const p = byPid.get(loan.pid);
  if (!p) continue;
  const a = appsOf(loan.pid);
  apps.push(a);
  mins.push(minsOf(loan.pid));

  const xi = xiOf(loan.loaneeTid);
  if (xi.some((q) => q.pid === loan.pid)) startedNow++;
  if (xi.length > 0) {
    const gap = p.ovr - Math.min(...xi.map((q) => q.ovr));
    (a > 0 ? playedGap : neverGap).push(gap);
  }
}

const playedAtAll = apps.filter((a) => a > 0).length;
console.log(`\nover a full season at the loanee club:`);
console.log(`  played at all       ${playedAtAll} (${pct(playedAtAll, apps.length)})`);
console.log(`  in the loanee's XI  ${startedNow} (${pct(startedNow, apps.length)})`);
console.log(`  appearances  mean ${mean(apps).toFixed(1)}  median ${median(apps)}  max ${Math.max(...apps)}`);
console.log(`  minutes      mean ${mean(mins).toFixed(0)}  median ${median(mins)}`);

// Counterfactual: comparable players who stayed home — same age band and the
// same "outside his club's XI" condition the loan market screens on.
const loaned = new Set(loans.map((l) => l.pid));
const stayed: number[] = [];
for (const team of league.teams) {
  const xi = new Set(xiOf(team.tid).map((p) => p.pid));
  for (const pid of team.roster) {
    const p = byPid.get(pid);
    if (!p || loaned.has(pid) || xi.has(pid)) continue;
    if (season - p.born > LOAN_AI_MAX_AGE) continue;
    stayed.push(appsOf(pid));
  }
}
console.log(`\ncomparable players NOT loaned (n=${stayed.length}):`);
console.log(`  appearances  mean ${mean(stayed).toFixed(1)}  median ${median(stayed)}`);

console.log(`\nwhy the misses miss — ovr vs the loanee's WEAKEST starter:`);
console.log(`  never played (n=${neverGap.length})  mean ${mean(neverGap).toFixed(1)}  median ${median(neverGap)}`);
console.log(`  did play     (n=${playedGap.length})  mean ${mean(playedGap).toFixed(1)}  median ${median(playedGap)}`);
console.log(`  never-played who were better than that starter: ${neverGap.filter((g) => g > 0).length}`);
