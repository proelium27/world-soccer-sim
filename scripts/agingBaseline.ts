/**
 * The world's equilibrium, measured long enough that the generated cohort has
 * left it — and the season-by-season path it takes to get there.
 *
 * This is the calibration target for giving world generation an age term.
 * `generatePlayer` rolls ratings from a club's base with NO age term, so a fresh
 * world's age->OVR profile is flat (an 18-year-old is generated at a
 * 27-year-old's level). The sim's own equilibrium is a hump, so the opening
 * seasons are a transient. To calibrate generation against equilibrium we need
 * an equilibrium profile that is not itself contaminated by the transient:
 *
 *   - a generated player is aged INITIAL_AGE_MIN..MAX at season 1, so at season
 *     S he is S-1+18 .. S-1+33. At S=25 that is 42-57, i.e. all retired.
 *   - measuring at season 13 (the obvious cheap choice) reads ages 30+ off the
 *     generated cohort, which is exactly the inflated population we are trying
 *     to remove. Its 30-33 band is NOT equilibrium.
 *
 * Hence 25 seasons by default. Also reports the RATING_MAX pinning rate, which
 * answers a separate question: whether the elite tail settles or ratchets.
 *
 * Run: SEASONS=25 SEED=1 npx tsx scripts/agingBaseline.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { RATING_MAX, type ProgressionModel } from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 25);
const SEED = Number(process.env.SEED ?? 1);
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
const USER_TID = 0;
const B4 = new Set(["England", "Spain", "Italy", "Germany"]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

type Row = { age: number; ovr: number; tier: number; b4: boolean; ratings: number[] };
function rows(l: LeagueStore): Row[] {
  const byPid = new Map(l.players.map((p) => [p.pid, p]));
  const out: Row[] = [];
  for (const t of l.teams) {
    if (t.tid === USER_TID) continue;
    const c = competitionOf(l.competitions, t.compId);
    for (const pid of t.roster) {
      const p = byPid.get(pid);
      if (p) out.push({
        age: l.season - p.born, ovr: p.ovr, tier: c.tier,
        b4: B4.has(c.country), ratings: Object.values(p.ratings),
      });
    }
  }
  return out;
}

const trace: string[] = [];
function line(l: LeagueStore) {
  const all = rows(l);
  const b4 = all.filter((r) => r.tier === 1 && r.b4);
  const o = b4.map((r) => r.ovr);
  const flat = all.flatMap((r) => r.ratings);
  const top = [...b4].sort((a, b) => b.ovr - a.ovr).slice(0, 30);
  trace.push([
    String(l.season).padStart(4),
    mean(o).toFixed(1).padStart(6),
    String(q(o, 0.5)).padStart(5),
    String(q(o, 0.9)).padStart(5),
    String(Math.max(...o)).padStart(5),
    String(o.filter((x) => x >= 90).length).padStart(6),
    ((100 * flat.filter((x) => x >= RATING_MAX).length) / flat.length).toFixed(2).padStart(9) + "%",
    mean(top.map((r) => r.age)).toFixed(1).padStart(9),
    mean(all.map((r) => r.ovr)).toFixed(1).padStart(8),
  ].join(" "));
}

function profile(label: string, l: LeagueStore) {
  const all = rows(l);
  const b4 = all.filter((r) => r.tier === 1 && r.b4);
  console.log(`\n=== ${label} (season ${l.season}) — mean OVR by age ===`);
  console.log("age    big4-T1 n    mean       world n    mean");
  for (let a = 16; a <= 40; a++) {
    const x = b4.filter((r) => r.age === a).map((r) => r.ovr);
    const y = all.filter((r) => r.age === a).map((r) => r.ovr);
    if (!y.length) { console.log(String(a).padStart(3), "        (no players at this age)"); continue; }
    console.log(
      String(a).padStart(3), String(x.length).padStart(12),
      (x.length ? mean(x).toFixed(1) : "-").padStart(8),
      String(y.length).padStart(13), mean(y).toFixed(1).padStart(8),
    );
  }
  console.log(`ALL b4-T1 mean ${mean(b4.map((r) => r.ovr)).toFixed(2)}  world mean ${mean(all.map((r) => r.ovr)).toFixed(2)}`);
}

let league = createLeagueState(USER_TID, mulberry32(SEED), 0, undefined, undefined, true, null, MODEL);
console.log(`seed ${SEED}, model ${MODEL}, ${SEASONS} seasons`);
profile("GENERATED", league);
line(league);
for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(SEED * 1000 + s);
  league = simThrough(league, "season", rng);
  for (let r = 0; (league.phase as string) !== "offseason"; r++) {
    if (r >= 3) throw new Error(`season ${league.season} refuses to finish`);
    league = simThrough(league, "season", rng);
  }
  league = simOffseason(league, mulberry32(SEED * 2000 + s));
  line(league);
  process.stdout.write(`  ...season ${league.season - 1}\n`);
}
profile("EQUILIBRIUM", league);
console.log("\n=== trajectory (big-four tier 1 unless noted) ===");
console.log("seas   mean   p50   p90   max   >=90   rat@max   top30age  worldMean");
for (const t of trace) console.log(t);
