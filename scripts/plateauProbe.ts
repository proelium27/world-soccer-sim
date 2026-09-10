/**
 * Season-by-season shape of the world's OVR distribution.
 *
 * Written to answer "ratings inflate and then plateau after ~5 seasons": that
 * report could mean the league MEAN climbs and flattens, or that the TOP of the
 * distribution saturates against RATING_MAX. They have different causes and
 * different fixes, so this prints both, plus the two things that would explain a
 * hard ceiling — the share of individual ratings pinned at RATING_MAX, and how
 * many players sit above GROWTH_DAMPING_END where growth is throttled to the
 * floor.
 *
 * It also splits drift into PROGRESSION vs CHURN by following the exact cohort
 * present at generation: a player's ovr only ever changes in progression, so a
 * fixed cohort's mean change is pure progression and the rest is composition.
 *
 * The user's club is excluded (unmanaged headlessly — see the audit headers).
 *
 * Run: SEASONS=12 SEED=1 npx tsx scripts/plateauProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import {
  RATING_MAX, GROWTH_DAMPING_START, GROWTH_DAMPING_END, type ProgressionModel,
} from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 12);
const SEED = Number(process.env.SEED ?? 1);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const USER_TID = 0;
const BIG_FOUR = new Set(["England", "Spain", "Italy", "Germany"]);

function q(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** Every rostered player outside the user's club, with his competition. */
function rostered(l: LeagueStore) {
  const byPid = new Map(l.players.map((p) => [p.pid, p]));
  const out: { ovr: number; tier: number; country: string; pid: number; ratings: number[] }[] = [];
  for (const t of l.teams) {
    if (t.tid === USER_TID) continue;
    const c = competitionOf(l.competitions, t.compId);
    for (const pid of t.roster) {
      const p = byPid.get(pid);
      if (!p) continue;
      out.push({ ovr: p.ovr, tier: c.tier, country: c.country, pid, ratings: Object.values(p.ratings) });
    }
  }
  return out;
}

let league = createLeagueState(USER_TID, mulberry32(SEED), 0, undefined, undefined, true, null, MODEL);

/** The exact players on a roster at generation — followed for the progression split. */
const cohort = new Set(rostered(league).map((r) => r.pid));

console.log(`seed ${SEED}, model ${MODEL}, ${SEASONS} seasons`);
console.log(`GROWTH_DAMPING_START ${GROWTH_DAMPING_START}  END ${GROWTH_DAMPING_END}  RATING_MAX ${RATING_MAX}`);
console.log("");
console.log("            |------------- BIG-4 TIER 1 -------------|  |--- WORLD ---|  |-- pinned/damped --|  cohort");
console.log("seas   n    mean   p50   p90   p99   max   >=90  >=95   mean   p90       rat@max%  ovr>=end%   mean  n");

function report(label: string) {
  const all = rostered(league);
  const b4 = all.filter((r) => r.tier === 1 && BIG_FOUR.has(r.country));
  const b4o = b4.map((r) => r.ovr);
  const worldO = all.map((r) => r.ovr);
  const flat = all.flatMap((r) => r.ratings);
  const pinned = flat.filter((x) => x >= RATING_MAX).length;
  const damped = worldO.filter((x) => x >= GROWTH_DAMPING_END).length;
  const coh = all.filter((r) => cohort.has(r.pid)).map((r) => r.ovr);
  console.log(
    label.padStart(4),
    String(b4o.length).padStart(5),
    mean(b4o).toFixed(1).padStart(6),
    String(q(b4o, 0.5)).padStart(5),
    String(q(b4o, 0.9)).padStart(5),
    String(q(b4o, 0.99)).padStart(5),
    String(Math.max(...b4o)).padStart(5),
    String(b4o.filter((x) => x >= 90).length).padStart(6),
    String(b4o.filter((x) => x >= 95).length).padStart(5),
    mean(worldO).toFixed(1).padStart(7),
    String(q(worldO, 0.9)).padStart(5),
    ((100 * pinned) / flat.length).toFixed(2).padStart(10) + "%",
    ((100 * damped) / worldO.length).toFixed(2).padStart(8) + "%",
    mean(coh).toFixed(1).padStart(7),
    String(coh.length).padStart(6),
  );
}

report("gen");
for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(SEED * 1000 + s);
  league = simThrough(league, "season", rng);
  for (let r = 0; (league.phase as string) !== "offseason"; r++) {
    if (r >= 3) throw new Error(`season ${league.season} refuses to finish`);
    league = simThrough(league, "season", rng);
  }
  league = simOffseason(league, mulberry32(SEED * 2000 + s));
  report(String(league.season - 1));
}
