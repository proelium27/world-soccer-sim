/**
 * Does division SIZE alone move a league's strength over a dynasty — and if
 * so, through which offseason step?
 *
 * The 12-country world put Scotland (12 clubs, generated second-weakest) top of
 * the world's tier-1 mean OVR after 20 seasons, on both audited seeds. Division
 * size was the only thing that changed, but the shipped world confounds it with
 * strength offset, budget scale, promotion spots and nationality, so it cannot
 * say whether size is the cause.
 *
 * This is the controlled version: several countries IDENTICAL in every tunable
 * except how many clubs they field, in twin pairs so a reading can be checked
 * against its twin. Any spread that opens up is size, and nothing else.
 *
 * The drift is then ATTRIBUTED. OVR changes only in progression, so on the
 * players a league keeps across an offseason the mean change is pure
 * progression; whatever is left of the league's mean move is churn — who came
 * and who went. Free-agent arrivals are already in the transfer log
 * (fromTid === FREE_AGENT_TID), so their count and quality per league come for
 * free, as do paid arrivals and departures. Mean raw points is printed because
 * it is the key the offseason sorts the world's free-agency queue by.
 *
 *   SEASONS=15 SEED=1 npx tsx scripts/divisionSizeProbe.ts
 *   SIZES=12,20 SEASONS=10 SEED=2 npx tsx scripts/divisionSizeProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { buildCompetitions, competitionOf } from "../src/core/competitions.js";
import { computeStandings } from "../src/core/standings.js";
import { FREE_AGENT_TID } from "../src/core/transfers/negotiation.js";
import { SEASON_MATCHDAYS } from "../src/core/calendar.js";

const SEASONS = Number(process.env.SEASONS ?? 15);
const SEED = Number(process.env.SEED ?? 1);
const SIZES = (process.env.SIZES ?? "12,16,20").split(",").map(Number);

// Same strength, same money, same promotion, same nationality table. Only the
// club count differs. Country count kept even so both continental fields stay
// buildable (see competitions.ts).
const specs = SIZES.flatMap((n) => [
  { country: `Size${n}`, d1Teams: n, d2Teams: n, strengthOffset: 8, budgetScale: 0.6,
    promotionSpots: 2, abbrev: `S${n}` },
  { country: `Twin${n}`, d1Teams: n, d2Teams: n, strengthOffset: 8, budgetScale: 0.6,
    promotionSpots: 2, abbrev: `T${n}` },
]);
const competitions = buildCompetitions(specs);

/** Tier-1 clubs per country, user's club excluded. */
function tier1Tids(league: LeagueStore): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const team of league.teams) {
    if (team.tid === league.meta.userTid) continue;
    const comp = competitionOf(league.competitions, team.compId);
    if (comp.tier !== 1) continue;
    let set = out.get(comp.country);
    if (!set) out.set(comp.country, (set = new Set()));
    set.add(team.tid);
  }
  return out;
}

/** pid → ovr for every rostered player at a country's tier-1 clubs. */
function snapshot(league: LeagueStore): Map<string, Map<number, number>> {
  const byPid = new Map(league.players.map((p) => [p.pid, p.ovr]));
  const out = new Map<string, Map<number, number>>();
  for (const [country, tids] of tier1Tids(league)) {
    const m = new Map<number, number>();
    for (const team of league.teams) {
      if (!tids.has(team.tid)) continue;
      for (const pid of team.roster) {
        const ovr = byPid.get(pid);
        if (ovr !== undefined) m.set(pid, ovr);
      }
    }
    out.set(country, m);
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

interface Acc {
  prog: number; churn: number; seasons: number;
  faN: number; faOvr: number;
  inN: number; inOvr: number; outN: number; outOvr: number;
  points: number; sub40: number; roster: number; snaps: number;
}
const acc = new Map<string, Acc>();
const bump = (c: string) => {
  let a = acc.get(c);
  if (!a) acc.set(c, (a = {
    prog: 0, churn: 0, seasons: 0, faN: 0, faOvr: 0, inN: 0, inOvr: 0, outN: 0, outOvr: 0,
    points: 0, sub40: 0, roster: 0, snaps: 0,
  }));
  return a;
};

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng, SEED, "normal", competitions);
const genMean = new Map([...snapshot(league)].map(([c, m]) => [c, mean([...m.values()])]));

for (let s = 0; s < SEASONS; s++) {
  league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  // simThrough pauses before the user's cup final and simOffseason silently
  // no-ops on any phase but "offseason", so a season where club 0 reached a
  // final would otherwise record no offseason. Same loop weakLeaguesAudit uses.
  for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
    if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish (phase ${league.phase})`);
    league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  }

  // Mean raw points per tier-1 club: the free-agency sort key.
  const tidsBefore = tier1Tids(league);
  for (const [country, tids] of tidsBefore) {
    const own = new Set(tids);
    const table = computeStandings([...tids],
      league.played.filter((m) => own.has(m.home) && own.has(m.away)));
    bump(country).points += mean(table.map((r) => r.points));
  }

  const before = snapshot(league);
  league = simOffseason(league, rng);
  const after = snapshot(league);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const tidsAfter = tier1Tids(league);

  for (const [country, b] of before) {
    const a = after.get(country);
    if (!a) continue;
    const retained = [...b.keys()].filter((pid) => a.has(pid));
    const prog = mean(retained.map((pid) => a.get(pid)! - b.get(pid)!));
    const move = mean([...a.values()]) - mean([...b.values()]);
    const x = bump(country);
    x.prog += prog;
    x.churn += move - prog;
    x.seasons++;

    const tids = tidsAfter.get(country)!;
    for (const t of league.transfers) {
      if (t.season !== league.season) continue;
      const p = byPid.get(t.pid);
      if (!p) continue;
      if (t.fromTid === FREE_AGENT_TID && tids.has(t.toTid)) { x.faN++; x.faOvr += p.ovr; }
      else if (t.fromTid >= 0 && tids.has(t.toTid) && !tids.has(t.fromTid)) { x.inN++; x.inOvr += p.ovr; }
      else if (t.toTid >= 0 && tids.has(t.fromTid) && !tids.has(t.toTid)) { x.outN++; x.outOvr += p.ovr; }
    }
    x.sub40 += [...a.values()].filter((o) => o < 40).length / tids.size;
    x.roster += a.size / tids.size;
    x.snaps++;
  }
}

const end = new Map([...snapshot(league)].map(([c, m]) => [c, mean([...m.values()])]));
const sign = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2);

console.log(`seed ${SEED}, ${SEASONS} seasons, ${competitions.length} competitions`);
console.log("\nDrift attributed per offseason (mean over the run), tier-1 clubs, user excluded.");
console.log("  prog  = mean OVR change on players the league KEPT (pure progression)");
console.log("  churn = the rest of the league's mean move (who came minus who went)");
console.log("  FA    = free-agent arrivals per club per offseason, and their mean OVR");
console.log("  pts   = mean raw points per club at season end (the FA queue's sort key)\n");
console.log("  league     clubs  gen→end   drift   prog/yr  churn/yr   FA/club  FA ovr   paid in  paid out   pts   <40  roster");
for (const [country, e] of [...end].sort((a, b) => b[1] - a[1])) {
  const x = acc.get(country)!;
  const n = competitionOf(competitions,
    competitions.find((c) => c.country === country && c.tier === 1)!.id).teamCount ?? 20;
  const clubs = tier1Tids(league).get(country)!.size;
  const per = (v: number) => v / x.seasons;
  console.log(
    `  ${country.padEnd(10)} ${String(n).padStart(3)}  ${genMean.get(country)!.toFixed(1)}→${e.toFixed(1)}` +
    `  ${sign(e - genMean.get(country)!).padStart(6)}` +
    `   ${sign(per(x.prog)).padStart(6)}   ${sign(per(x.churn)).padStart(6)}` +
    `   ${(per(x.faN) / clubs).toFixed(2).padStart(5)}   ${(x.faN ? x.faOvr / x.faN : NaN).toFixed(1).padStart(5)}` +
    `   ${(per(x.inN) / clubs).toFixed(2).padStart(5)}/${(x.inN ? x.inOvr / x.inN : NaN).toFixed(0)}` +
    `  ${(per(x.outN) / clubs).toFixed(2).padStart(5)}/${(x.outN ? x.outOvr / x.outN : NaN).toFixed(0)}` +
    `  ${(x.points / x.seasons).toFixed(1).padStart(5)}` +
    `  ${(x.sub40 / x.snaps).toFixed(1).padStart(4)}  ${(x.roster / x.snaps).toFixed(1).padStart(5)}`,
  );
}
