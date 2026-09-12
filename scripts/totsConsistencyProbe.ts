/**
 * How often does a player who wins a bigger individual honour miss his own
 * league's Team of the Season?
 *
 * Reported per honour, for the OLD pick (best totsScore per slot, nothing
 * seated) and the SHIPPED pick (honourees seated first, see
 * `computeSeasonAwards`), both scored on the same worlds so the two columns are
 * directly comparable: league Player of the Season, league Golden Boot, the
 * Ballon d'Or winner / top 3, the World Team of the Year, and the Goalkeeper /
 * Defender of the Year. Old-rule misses are printed with who took the slot and
 * why, since "why did he miss" is the whole question.
 *
 * Also reports how many XI places the new rule changes hands per competition
 * season — the displaced players are the ones whose protected-star status can
 * move, which is the market-side cost.
 *
 *   npx tsx scripts/totsConsistencyProbe.ts
 *   SEASONS=6 SEEDS=1,2 SHOW=20 npx tsx scripts/totsConsistencyProbe.ts
 *
 * The league a player's TOTS is judged in is the competition of the club whose
 * roster he is on when the offseason scores the awards — the rosters handed to
 * simOffseason, the same rule awardsByCompetition applies.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import {
  computeSeasonAwards, totsScore, statsFor, ovrDuringSeason, TOTS_SLOTS,
} from "../src/core/awards.js";
import { worldHonourees } from "../src/core/worldAwards.js";
import { AWARD_MIN_APPEARANCES } from "../src/core/constants.js";
import type { Player, SeasonStats } from "../src/core/players/types.js";

const SEASONS = Number(process.env.SEASONS ?? 5);
const SEEDS = (process.env.SEEDS ?? "1,2").split(",").map(Number);
const SHOW = Number(process.env.SHOW ?? 12);

type Entry = { player: Player; stats: SeasonStats };

/** The pick as it shipped before honourees were seated. */
function oldXI(entries: Entry[], season: number): (number | null)[] {
  const used = new Set<number>();
  return TOTS_SLOTS.map((slot) => {
    let best: Entry | null = null;
    let bestScore = -Infinity;
    for (const e of entries) {
      if (e.player.pos !== slot || used.has(e.player.pid)) continue;
      const score = (e.stats.appearances >= AWARD_MIN_APPEARANCES ? 1000 : 0)
        + totsScore(e.player, e.stats, season);
      if (score > bestScore) { best = e; bestScore = score; }
    }
    if (!best) return null;
    used.add(best.player.pid);
    return best.player.pid;
  });
}

type Tally = { total: number; oldMade: number; newMade: number; oldMissPos: Map<string, number> };
const tallies = new Map<string, Tally>();
const misses: string[] = [];
let compSeasons = 0;
let changedPlaces = 0;
let storedMismatch = 0;

for (const seed of SEEDS) {
  const rng = mulberry32(seed);
  let league = createLeagueState(0, rng);
  for (let s = 0; s < SEASONS; s++) {
    while (league.phase !== "offseason") league = simThrough(league, "season", rng);
    const before = league;
    league = simOffseason(league, rng);
    const entry = league.seasonHistory.at(-1)!;
    const season = entry.season;
    const byPid = new Map<number, Player>(before.players.map((p) => [p.pid, p]));
    const honourees = worldHonourees(entry.world);

    const oldByComp = new Map<number, (number | null)[]>();
    const newByComp = new Map<number, (number | null)[]>();
    const compOfPid = new Map<number, number>();
    for (const comp of before.competitions) {
      const roster = new Set(before.teams.filter((t) => t.compId === comp.id).flatMap((t) => t.roster));
      for (const pid of roster) compOfPid.set(pid, comp.id);
      const pool = before.players.filter((p) => roster.has(p.pid));
      const entries: Entry[] = [];
      for (const p of pool) {
        const st = statsFor(p, season);
        if (st && st.appearances > 0) entries.push({ player: p, stats: st });
      }
      const oldPick = oldXI(entries, season);
      const newPick = computeSeasonAwards(pool, season, honourees).teamOfSeason;
      if (JSON.stringify(newPick) !== JSON.stringify(entry.awards[comp.id]?.teamOfSeason)) storedMismatch++;
      oldByComp.set(comp.id, oldPick);
      newByComp.set(comp.id, newPick);
      compSeasons++;
      changedPlaces += newPick.filter((pid) => pid !== null && !oldPick.includes(pid)).length;
    }

    const check = (name: string, pid: number | null | undefined) => {
      if (pid === null || pid === undefined) return;
      const c = compOfPid.get(pid);
      if (c === undefined) return; // not on a roster at the award pass
      const p = byPid.get(pid);
      const oldPick = oldByComp.get(c)!;
      const newPick = newByComp.get(c)!;
      if (!tallies.has(name)) tallies.set(name, { total: 0, oldMade: 0, newMade: 0, oldMissPos: new Map() });
      const t = tallies.get(name)!;
      t.total++;
      if (newPick.includes(pid)) t.newMade++;
      if (oldPick.includes(pid)) { t.oldMade++; return; }
      const pos = p?.pos ?? "?";
      t.oldMissPos.set(pos, (t.oldMissPos.get(pos) ?? 0) + 1);
      if (!p) return;
      const st = statsFor(p, season)!;
      const line = (x: Player) => {
        const xs = statsFor(x, season)!;
        return `${x.name} ${x.pos} ovr ${ovrDuringSeason(x, season)} tots ${totsScore(x, xs, season).toFixed(2)}` +
          ` (${xs.appearances}ap ${xs.goals}g ${xs.assists}a ${xs.tackles + xs.interceptions}def ${xs.avgRating.toFixed(2)}r)`;
      };
      const holders = TOTS_SLOTS.map((slot, i) => ({ slot, pid: oldPick[i] }))
        .filter((x) => x.slot === p.pos && x.pid !== null)
        .map((x) => line(byPid.get(x.pid!)!));
      misses.push(`s${seed} season ${season} ${name}: ${line(p)}${st ? "" : ""} lost to ${holders.join(" | ") || "nobody"}`);
    };

    for (const a of Object.values(entry.awards)) {
      check("league POTY", a.playerOfSeasonPid);
      check("league Golden Boot", a.goldenBootPid);
    }
    const w = entry.world;
    if (w) {
      check("Ballon d'Or winner", w.ballonDOr[0]?.pid);
      for (const e of w.ballonDOr.slice(0, 3)) check("Ballon d'Or top 3", e.pid);
      for (const pid of w.worldTeamOfYear) check("World XI member", pid);
      check("Goalkeeper of the Year", w.goalkeeperOfYear?.[0]?.pid);
      check("Defender of the Year", w.defenderOfYear?.[0]?.pid);
    }
    console.error(`seed ${seed} season ${season} done`);
  }
}

console.log(`\n${SEEDS.length} seed(s) x ${SEASONS} seasons`);
console.log("honour                    old rule            new rule            old misses by position");
const pct = (n: number, d: number) => `${String(n).padStart(4)}/${String(d).padEnd(4)} (${((100 * n) / d).toFixed(1)}%)`;
for (const [name, t] of tallies) {
  const miss = [...t.oldMissPos].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join("  ") || "none";
  console.log(`${name.padEnd(24)}  ${pct(t.oldMade, t.total)}  ${pct(t.newMade, t.total)}  ${miss}`);
}
console.log(`\nXI places changing hands: ${changedPlaces} over ${compSeasons} competition-seasons` +
  ` (${(changedPlaces / compSeasons).toFixed(2)} per XI)`);
console.log(`stored awards that disagree with the probe's own new pick: ${storedMismatch} (should be 0)`);
console.log(`\nsample old-rule misses (${Math.min(SHOW, misses.length)} of ${misses.length}):`);
for (const m of misses.slice(0, SHOW)) console.log("  " + m);
