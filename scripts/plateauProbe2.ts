/**
 * The age→OVR profile of the world, at generation and once it has settled.
 *
 * Companion to plateauProbe.ts. That one asks WHEN the world's ratings stop
 * moving; this one asks WHY. `generatePlayer` rolls ratings from a club's base
 * with no age term at all — age only sets `born` — so a fresh world's age→OVR
 * profile is FLAT: an 18-year-old is generated at the same expected rating as a
 * 27-year-old. The sim's own equilibrium is a hump (grow to ~26, decline after),
 * so the opening seasons are the world converging on a shape it should have
 * started in. This prints both profiles so the gap can be measured rather than
 * assumed, and it is the calibration target for any age term added to
 * generation.
 *
 * The user's club is excluded (unmanaged headlessly).
 *
 * Run: SEASONS=12 SEED=1 npx tsx scripts/plateauProbe2.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { type ProgressionModel } from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 12);
const SEED = Number(process.env.SEED ?? 1);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const USER_TID = 0;
const B4 = new Set(["England", "Spain", "Italy", "Germany"]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** Rostered players outside the user's club: age, ovr, tier, country. */
function rows(l: LeagueStore) {
  const byPid = new Map(l.players.map((p) => [p.pid, p]));
  const out: { age: number; ovr: number; tier: number; b4: boolean }[] = [];
  for (const t of l.teams) {
    if (t.tid === USER_TID) continue;
    const c = competitionOf(l.competitions, t.compId);
    for (const pid of t.roster) {
      const p = byPid.get(pid);
      if (p) out.push({ age: l.season - p.born, ovr: p.ovr, tier: c.tier, b4: B4.has(c.country) });
    }
  }
  return out;
}

function profile(label: string, l: LeagueStore) {
  const all = rows(l);
  const b4 = all.filter((r) => r.tier === 1 && r.b4);
  console.log(`\n=== ${label} (season ${l.season}) ===`);
  console.log("age   big4-T1 n   mean      world n   mean");
  for (let a = 16; a <= 38; a++) {
    const x = b4.filter((r) => r.age === a).map((r) => r.ovr);
    const y = all.filter((r) => r.age === a).map((r) => r.ovr);
    if (!y.length) continue;
    console.log(
      String(a).padStart(3),
      String(x.length).padStart(11),
      (x.length ? mean(x).toFixed(1) : "-").padStart(7),
      String(y.length).padStart(11),
      mean(y).toFixed(1).padStart(7),
    );
  }
  console.log(`ALL b4-T1 mean ${mean(b4.map((r) => r.ovr)).toFixed(2)}   world mean ${mean(all.map((r) => r.ovr)).toFixed(2)}`);
}

let league = createLeagueState(USER_TID, mulberry32(SEED), 0, undefined, undefined, true, null, MODEL);
console.log(`seed ${SEED}, model ${MODEL}, ${SEASONS} seasons`);
profile("GENERATED", league);
for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(SEED * 1000 + s);
  league = simThrough(league, "season", rng);
  for (let r = 0; (league.phase as string) !== "offseason"; r++) {
    if (r >= 3) throw new Error(`season ${league.season} refuses to finish`);
    league = simThrough(league, "season", rng);
  }
  league = simOffseason(league, mulberry32(SEED * 2000 + s));
  process.stdout.write(`  ...season ${league.season - 1} done\n`);
}
profile("SETTLED", league);
