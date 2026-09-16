/**
 * Why does a 30-club SPLIT top flight (MLS, Argentina) close less of its gap to
 * the big four over a dynasty than the same league at 20 clubs?
 *
 * The 20-season audit found it on all four seeds (United States->Greece -2.05
 * against a -0.64 control), and a control run with the two leagues back at 20
 * clubs in one table put the cause on the split rather than on anything else in
 * the change. This is the controlled version, built the way divisionSizeProbe
 * is: countries IDENTICAL in strength, money, promotion and nationality, in twin
 * pairs, differing only in shape:
 *
 *   Size20  - 20 clubs, one table, 38 games
 *   Split30 - 30 clubs in two halves of 15, 30 games (Argentina's shape)
 *   MLS30   - 30 clubs in two halves of 15 plus 4 cross rounds, 34 games
 *
 * What it has found so far:
 *
 *  - PLAYING TIME is not it. The split leagues put fewer players past the minutes
 *    nudge's 30-appearance line, but offseason development is the same in every
 *    shape.
 *  - The extra loss is IN THE SEASON: start-of-season to end-of-season mean OVR
 *    runs ~0 for a 20-club table and -0.1 to -0.2 a season for a split one.
 *  - Ratings do not move in-season, nothing joins or leaves a top flight without
 *    a transfer record, and every in-season move is in the winter window. So the
 *    in-season change is entirely which players the winter window moves.
 *
 * Two readings are taken here:
 *
 *  1. The season, taken apart EXACTLY by move type. With OVR constant,
 *       mean(end) - mean(start) = [ sum over arrivals (ovr - m0)
 *                                 - sum over departures (ovr - m0) ] / |end roster|
 *     where m0 is the league's start-of-season mean. Each arrival or departure is
 *     credited to the type of its last move that season (paid, loan, loan
 *     return, free agent, other free), so the columns add up to the season's
 *     change ("sum" is that check).
 *
 *  2. Whether the league's FOOTBALL is weaker, or only its all-roster average.
 *     The audit's metric averages every rostered player, so a buried youngster
 *     loaned within the league stays in it while one loaned abroad drops out —
 *     a change in who is counted, with no change to who plays. "xi" is each
 *     club's best eleven by OVR, averaged over its clubs, which a loan of a
 *     squad player cannot move. If xi drift matches across shapes while the
 *     roster mean does not, the gap is mostly the metric, not the football.
 *
 * Spectator world (no unmanaged user club). PROMO sets every league's promotion
 * places; PROMO=0 closes them all.
 *
 *   PROMO=2 SEASONS=15 SEED=1 npx tsx scripts/conferenceSizeProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";
import {
  buildCompetitions, competitionOf, competitionSeasonGames, type Competition,
} from "../src/core/competitions.js";
import { FREE_AGENT_TID, type CompletedTransfer } from "../src/core/transfers/negotiation.js";
import { SEASON_MATCHDAYS } from "../src/core/calendar.js";

const SEASONS = Number(process.env.SEASONS ?? 15);
const SEED = Number(process.env.SEED ?? 1);
const PROMO = Number(process.env.PROMO ?? 2);
const XI = 11;

// D2Few20 tests the leading explanation for the loans gap: a 30-club top flight
// has only 20 second-division clubs to loan its benched youngsters down to (2
// for every 3), where a 20-club one has 20 (1 for 1). D2Few20 is a 20-club table
// with that same 2-for-3 ratio beneath it (14). If it loses the 20-club table's
// loan boost and drifts like the split leagues, the ratio is the cause.
// D2Few20 explains the loans half of the gap (seeds 1-2: it loses the 20-club
// table's loan boost and ~half the best-XI deficit). Split20 separates what is
// left: a 20-club top flight in two halves of 10 over a full 20-club second
// division — the split SCHEDULE (each half twice plus 10 cross rounds, 28 games)
// with the normal club count and the normal second-division ratio. If it loses
// ground, the split schedule is the cause; if not, it is the 30-club count.
const SHAPES = [
  { name: "Size20", d1Teams: 20, d2Teams: 20, crossRounds: null },
  { name: "D2Few20", d1Teams: 20, d2Teams: 14, crossRounds: null },
  { name: "Split20", d1Teams: 20, d2Teams: 20, crossRounds: 10 },
  { name: "Split30", d1Teams: 30, d2Teams: 20, crossRounds: 0 },
  { name: "MLS30", d1Teams: 30, d2Teams: 20, crossRounds: 4 },
] as const;
// CUPS=0 gives every league no continental places at all. Every league sends the
// same number of clubs to each competition, so a 30-club league shares that flat
// prize money among half as many clubs again; switching the competitions off
// tests whether that is the half of the gap the second-division ratio leaves.
const CUPS = Number(process.env.CUPS ?? 1);
const specs = SHAPES.flatMap((shape, i) => ["", "Twin"].map((twin) => ({
  country: `${shape.name}${twin}`, d1Teams: shape.d1Teams, d2Teams: shape.d2Teams,
  strengthOffset: 8, budgetScale: 0.6, promotionSpots: PROMO,
  ...(CUPS === 0 ? { cupSlots: 0, shieldSlots: 0 } : {}),
  // Unique per country: one letter per shape, then the twin marker.
  abbrev: `S${String.fromCharCode(65 + i)}${twin ? "T" : "A"}`,
})));
const competitions: Competition[] = buildCompetitions(specs).map((c) => {
  const shape = SHAPES.find((s) => c.country.startsWith(s.name))!;
  return c.tier === 1 && shape.crossRounds !== null
    ? { ...c, conferences: { names: ["Half A", "Half B"] as const, crossRounds: shape.crossRounds } }
    : c;
});

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

/** pid -> ovr for every rostered player at a country's tier-1 clubs. */
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

/** Per country: each tier-1 club's best XI by OVR, averaged over its clubs. */
function xiMeans(league: LeagueStore): Map<string, number> {
  const byPid = new Map(league.players.map((p) => [p.pid, p.ovr]));
  const out = new Map<string, number>();
  for (const [country, tids] of tier1Tids(league)) {
    const clubXis: number[] = [];
    for (const team of league.teams) {
      if (!tids.has(team.tid)) continue;
      const best = team.roster
        .map((pid) => byPid.get(pid))
        .filter((o): o is number => o !== undefined)
        .sort((a, b) => b - a)
        .slice(0, XI);
      if (best.length) clubXis.push(best.reduce((a, b) => a + b, 0) / best.length);
    }
    out.set(country, clubXis.reduce((a, b) => a + b, 0) / clubXis.length);
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const meanOf = (m: Map<number, number>) => mean([...m.values()]);

const TYPES = ["paid", "loan", "return", "fa", "free", "none"] as const;
type MoveType = (typeof TYPES)[number];
function classify(t: CompletedTransfer | undefined): MoveType {
  if (!t) return "none";
  if (t.loanReturn) return "return";
  if (t.loanSeasons !== undefined) return "loan";
  if (t.fromTid === FREE_AGENT_TID) return "fa";
  return t.fee > 0 ? "paid" : "free";
}

interface Acc {
  seasons: number; prog: number; churn: number; inSeason: number;
  contrib: Record<MoveType, number>;
  arrivals: Record<MoveType, number>;
  departures: Record<MoveType, number>;
}
const zeros = (): Record<MoveType, number> =>
  Object.fromEntries(TYPES.map((k) => [k, 0])) as Record<MoveType, number>;
const acc = new Map<string, Acc>();
const bump = (c: string): Acc => {
  let a = acc.get(c);
  if (!a) {
    a = { seasons: 0, prog: 0, churn: 0, inSeason: 0, contrib: zeros(), arrivals: zeros(), departures: zeros() };
    acc.set(c, a);
  }
  return a;
};

const rng = mulberry32(SEED);
let league = createLeagueState(SPECTATOR_TID, rng, SEED, "normal", competitions);
const genMean = new Map([...snapshot(league)].map(([c, m]) => [c, meanOf(m)]));
const genXi = xiMeans(league);
let seasonStart = snapshot(league);

for (let s = 0; s < SEASONS; s++) {
  const seenTransfers = new Set(league.transfers);

  league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
    if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish (phase ${league.phase})`);
    league = simThrough(league, { matchday: SEASON_MATCHDAYS }, rng);
  }

  const before = snapshot(league);
  const lastMove = new Map<number, CompletedTransfer>();
  for (const t of league.transfers) if (!seenTransfers.has(t)) lastMove.set(t.pid, t);

  for (const [country, b] of before) {
    const x = bump(country);
    const s0 = seasonStart.get(country);
    if (!s0 || b.size === 0) continue;
    const m0 = meanOf(s0);
    x.inSeason += meanOf(b) - m0;
    for (const [pid, ovr] of b) {
      if (s0.has(pid)) continue;
      const type = classify(lastMove.get(pid));
      x.contrib[type] += (ovr - m0) / b.size;
      x.arrivals[type]++;
    }
    for (const [pid, ovr] of s0) {
      if (b.has(pid)) continue;
      const type = classify(lastMove.get(pid));
      x.contrib[type] -= (ovr - m0) / b.size;
      x.departures[type]++;
    }
  }

  league = simOffseason(league, rng);
  const after = snapshot(league);
  seasonStart = after;

  for (const [country, b] of before) {
    const a = after.get(country);
    if (!a) continue;
    const retained = [...b.keys()].filter((pid) => a.has(pid));
    const prog = mean(retained.map((pid) => a.get(pid)! - b.get(pid)!));
    const x = bump(country);
    x.prog += prog;
    x.churn += meanOf(a) - meanOf(b) - prog;
    x.seasons++;
  }
}

const end = new Map([...snapshot(league)].map(([c, m]) => [c, meanOf(m)]));
const endXi = xiMeans(league);
const sign = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);

console.log(`seed ${SEED}, ${SEASONS} seasons, promotion ${PROMO}, spectator world`);
console.log("\nTier-1 clubs; per-season means over the run.");
console.log("  drift    = generation to the end, mean OVR over every rostered player (the audit's metric)");
console.log("  xi drift = generation to the end, each club's best 11 by OVR averaged over clubs");
console.log("  inseason = start-of-season to end-of-season mean OVR; sum = the move-type columns added (should match)");
console.log("  paid/loan/return/fa/free/none = each move type's contribution to that change, in mean OVR");
console.log("  counts   = arrivals/departures per club per season, for paid moves and loans\n");
console.log("  league        games   drift  xi drift  prog/yr churn/yr  inseason    sum     paid    loan  return      fa    free    none    paid a/d   loan a/d");
for (const [country, e] of [...end].sort((p, q) => p[0].localeCompare(q[0]))) {
  const x = acc.get(country)!;
  const comp = competitions.find((c) => c.country === country && c.tier === 1)!;
  const clubs = tier1Tids(league).get(country)!.size;
  const per = (v: number) => v / x.seasons;
  const sum = TYPES.reduce((n, k) => n + x.contrib[k], 0);
  const perClub = (v: number) => (per(v) / clubs).toFixed(2);
  console.log(
    `  ${country.padEnd(12)}  ${String(competitionSeasonGames(comp)).padStart(4)}` +
    `  ${sign(e - genMean.get(country)!).padStart(6)}  ${sign(endXi.get(country)! - genXi.get(country)!).padStart(7)}` +
    `  ${sign(per(x.prog)).padStart(6)}  ${sign(per(x.churn)).padStart(6)}` +
    `    ${sign(per(x.inSeason)).padStart(6)}  ${sign(per(sum)).padStart(6)}` +
    TYPES.map((k) => `  ${sign(per(x.contrib[k])).padStart(6)}`).join("") +
    `   ${perClub(x.arrivals.paid)}/${perClub(x.departures.paid)}   ${perClub(x.arrivals.loan)}/${perClub(x.departures.loan)}`,
  );
}
