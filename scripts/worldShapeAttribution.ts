/**
 * Where does a league lose ground over a dynasty IN THE REAL WORLD — through
 * development, or through who comes and goes, and does its money explain it?
 *
 * Built for the 30-club split top flights (MLS, Argentina). The 20-season audit
 * put them ~1.4 below the same leagues at 20 clubs on all four seeds
 * (United States->Greece -2.05 against -0.64), but conferenceSizeProbe found no
 * difference at all between equal-strength countries of each shape. So whatever
 * it is only shows up where a weak league trades with stronger ones: the
 * transfer market, free agency, the division-ceiling sweep, or the flat
 * continental and cup prize money a league's clubs now share among more of them.
 *
 * Run it in two trees on the same seed — this one (30-club splits) and a copy
 * with those two top flights back at 20 clubs in one table — and compare rows.
 * Per country, tier-1 clubs only, user's club excluded:
 *
 *   prog/churn  - offseason drift split the divisionSizeProbe way: mean OVR change
 *                 on players the league kept, and the rest of its mean move
 *   budget      - mean club balance at season end, before the offseason (GBP m)
 *   sold/bought - fees received and paid per club per season (GBP m), transfers
 *                 with anyone outside that country's top flight
 *   out/in      - players sold and bought per club per season, and their OVR
 *   FA          - free-agent arrivals per club per season, and their OVR
 *
 *   ARM=split SEASONS=15 SEED=1 npx tsx scripts/worldShapeAttribution.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf, competitionTeamCount } from "../src/core/competitions.js";
import { FREE_AGENT_TID } from "../src/core/transfers/negotiation.js";
import { SEASON_MATCHDAYS } from "../src/core/calendar.js";

const SEASONS = Number(process.env.SEASONS ?? 15);
const SEED = Number(process.env.SEED ?? 1);
const ARM = process.env.ARM ?? "?";

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
  prog: number; churn: number; seasons: number; budget: number;
  sold: number; bought: number; outN: number; outOvr: number; inN: number; inOvr: number;
  faN: number; faOvr: number;
}
const acc = new Map<string, Acc>();
const bump = (c: string): Acc => {
  let a = acc.get(c);
  if (!a) {
    a = { prog: 0, churn: 0, seasons: 0, budget: 0, sold: 0, bought: 0, outN: 0, outOvr: 0, inN: 0, inOvr: 0, faN: 0, faOvr: 0 };
    acc.set(c, a);
  }
  return a;
};

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng, SEED);
const genMean = new Map([...snapshot(league)].map(([c, m]) => [c, mean([...m.values()])]));
const countries = [...new Set(league.competitions.map((c) => c.country))];

for (let s = 0; s < SEASONS; s++) {
  // Every record already in the log. Whatever is in the log after the offseason
  // and NOT in here is this season's business. Compared by identity rather than
  // by season/window stamps, which differ by transfer type, and rather than by
  // array index, which the free-agent cull's scrub can shift.
  const seenTransfers = new Set(league.transfers);
  league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
    if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish (phase ${league.phase})`);
    league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  }
  const endingSeason = league.season;

  const tidsBefore = tier1Tids(league);
  for (const [country, tids] of tidsBefore) {
    bump(country).budget += mean(league.teams.filter((t) => tids.has(t.tid)).map((t) => t.budget)) / 1e6;
  }

  const before = snapshot(league);
  league = simOffseason(league, rng);
  const after = snapshot(league);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));

  // One season of transfer business: everything logged since the season began.
  const business = league.transfers.filter((t) => !seenTransfers.has(t));

  for (const [country, b] of before) {
    const a = after.get(country);
    if (!a) continue;
    const tids = tidsBefore.get(country)!;
    const retained = [...b.keys()].filter((pid) => a.has(pid));
    const prog = mean(retained.map((pid) => a.get(pid)! - b.get(pid)!));
    const move = mean([...a.values()]) - mean([...b.values()]);
    const x = bump(country);
    x.prog += prog;
    x.churn += move - prog;
    x.seasons++;
    for (const t of business) {
      if ("loan" in t && (t as { loan?: boolean }).loan) continue;
      const ovr = byPid.get(t.pid)?.ovr;
      const fromHere = tids.has(t.fromTid);
      const toHere = tids.has(t.toTid);
      if (t.fromTid === FREE_AGENT_TID && toHere) {
        x.faN++; if (ovr !== undefined) x.faOvr += ovr;
      } else if (fromHere && !toHere && t.toTid >= 0) {
        x.outN++; x.sold += t.fee / 1e6; if (ovr !== undefined) x.outOvr += ovr;
      } else if (toHere && !fromHere && t.fromTid >= 0) {
        x.inN++; x.bought += t.fee / 1e6; if (ovr !== undefined) x.inOvr += ovr;
      }
    }
  }
}

const end = new Map([...snapshot(league)].map(([c, m]) => [c, mean([...m.values()])]));
const sign = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
const tier1Size = (country: string) =>
  competitionTeamCount(league.competitions.find((c) => c.country === country && c.tier === 1)!);

console.log(`arm ${ARM}, seed ${SEED}, ${SEASONS} seasons, ${league.teams.length} clubs`);
console.log("  country        clubs  gen->end    drift  prog/yr  churn/yr  budget  sold/yr  bought/yr  out/yr(ovr)  in/yr(ovr)  FA/yr(ovr)");
for (const country of countries) {
  const x = acc.get(country);
  if (!x) continue;
  const clubs = tier1Size(country);
  const per = (v: number) => v / x.seasons;
  const perClub = (v: number) => per(v) / clubs;
  console.log(
    `  ${country.padEnd(13)}  ${String(clubs).padStart(4)}  ${genMean.get(country)!.toFixed(1)}->${end.get(country)!.toFixed(1)}` +
    `  ${sign(end.get(country)! - genMean.get(country)!).padStart(6)}` +
    `  ${sign(per(x.prog)).padStart(6)}  ${sign(per(x.churn)).padStart(7)}` +
    `  ${per(x.budget).toFixed(1).padStart(6)}  ${perClub(x.sold).toFixed(2).padStart(6)}  ${perClub(x.bought).toFixed(2).padStart(8)}` +
    `   ${perClub(x.outN).toFixed(2)}(${(x.outN ? x.outOvr / x.outN : NaN).toFixed(0)})` +
    `   ${perClub(x.inN).toFixed(2)}(${(x.inN ? x.inOvr / x.inN : NaN).toFixed(0)})` +
    `   ${perClub(x.faN).toFixed(2)}(${(x.faN ? x.faOvr / x.faN : NaN).toFixed(0)})`,
  );
}
