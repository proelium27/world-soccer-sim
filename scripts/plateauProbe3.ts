/**
 * Two claims about a young world, checked directly:
 *   (a) the best players are implausibly young (real football peaks ~26-30);
 *   (b) the world's age distribution has a HOLE in it.
 *
 * (b) is structural, not noise. Starting rosters are generated at ages
 * INITIAL_AGE_MIN..INITIAL_AGE_MAX (18-33) in season 1; youth intake then adds
 * its first 16-year-olds for season 2. The two cohorts never meet, so there is
 * a band of birth seasons no player was ever created in — a gap that is exactly
 * (INITIAL_AGE_MIN - YOUTH_AGE) years wide and marches up one year per season,
 * crossing peak age around season 10.
 *
 * Reads the whole player pool, not just senior rosters: a birth-season gap is a
 * property of the population, so measuring it on rosters alone would let the
 * free-agent pool hide it.
 *
 * Run: SEASONS=12 SEED=1 npx tsx scripts/plateauProbe3.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { INITIAL_AGE_MIN, INITIAL_AGE_MAX, YOUTH_AGE, type ProgressionModel } from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 12);
const SEED = Number(process.env.SEED ?? 1);
const TOP = Number(process.env.TOP ?? 30);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const USER_TID = 0;
const B4 = new Set(["England", "Spain", "Italy", "Germany"]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

console.log(`seed ${SEED}, model ${MODEL}, top ${TOP}`);
console.log(`INITIAL_AGE ${INITIAL_AGE_MIN}-${INITIAL_AGE_MAX}, YOUTH_AGE ${YOUTH_AGE}`);
console.log("");
console.log("seas  topN: meanAge  minAge  maxAge  meanOvr   | ages of the best 10        | empty age bands (whole pool)");

function report(l: LeagueStore) {
  const byPid = new Map(l.players.map((p) => [p.pid, p]));
  const b4: { age: number; ovr: number }[] = [];
  for (const t of l.teams) {
    if (t.tid === USER_TID) continue;
    const c = competitionOf(l.competitions, t.compId);
    if (c.tier !== 1 || !B4.has(c.country)) continue;
    for (const pid of t.roster) {
      const p = byPid.get(pid);
      if (p) b4.push({ age: l.season - p.born, ovr: p.ovr });
    }
  }
  const top = [...b4].sort((a, b) => b.ovr - a.ovr).slice(0, TOP);
  const ages = top.map((r) => r.age);

  // A birth-season gap is a property of the whole pool, rostered or not.
  const present = new Set(l.players.map((p) => l.season - p.born));
  const empty: number[] = [];
  for (let a = 17; a <= 34; a++) if (!present.has(a)) empty.push(a);

  console.log(
    String(l.season).padStart(4),
    mean(ages).toFixed(1).padStart(13),
    String(Math.min(...ages)).padStart(7),
    String(Math.max(...ages)).padStart(7),
    mean(top.map((r) => r.ovr)).toFixed(1).padStart(8),
    "  |",
    top.slice(0, 10).map((r) => `${r.age}`).join(" ").padEnd(26),
    "|",
    empty.length ? empty.join(",") : "(none)",
  );
}

let league = createLeagueState(USER_TID, mulberry32(SEED), 0, undefined, undefined, true, null, MODEL);
report(league);
for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(SEED * 1000 + s);
  league = simThrough(league, "season", rng);
  for (let r = 0; (league.phase as string) !== "offseason"; r++) {
    if (r >= 3) throw new Error(`season ${league.season} refuses to finish`);
    league = simThrough(league, "season", rng);
  }
  league = simOffseason(league, mulberry32(SEED * 2000 + s));
  report(league);
}
