/**
 * Dynasty audit for career position changes.
 *
 * The probe (positionChangeProbe.ts) measured the *backlog* a world builds up
 * while nothing can convert. This measures the mechanic actually running, which
 * is a different question: a backlog released once is not the same as a steady
 * flow, and only the flow can compound.
 *
 * Reports the four things that can go wrong, three of which are invisible if you
 * only look at whether the feature "works":
 *
 *  - RATE. Conversions per season. Too many and a position badge stops meaning
 *    anything; too few and the feature isn't there.
 *  - INFLATION. Mean OVR, rostered and tier-1. `ovr` is position-relative, so
 *    every conversion mints rating points, and taking a best-of-N is a maximum
 *    over noisy quantities — biased upward by construction. Compare against the
 *    same script on origin/main; the anti-inflation equilibrium is fragile and
 *    league mean ovr already drifts on main for unrelated reasons.
 *  - POSITION MIX. Share of the pool at each position vs ROSTER_COMPOSITION.
 *    COVERABLE is asymmetric, so flows need not balance: at a 3-point margin the
 *    backlog alone would have swollen AM from 8.0% to 10.5% of the pool while
 *    draining CM and FB. AM has two slots a squad; a third more of them and
 *    clubs cannot field the shape they were built for.
 *  - ROUND TRIPS. A player converting back to a position he already left. Each
 *    leg raises his ovr, so an oscillator is a rating pump. This should be ~0;
 *    if it isn't, POSITION_CHANGE_SEASONS is too short.
 *
 * Run: SEEDS=1,2 SEASONS=20 npx tsx scripts/positionChangeAudit.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import type { LeagueStore } from "../src/core/leagueState.js";
import { POSITIONS, type Player, type Position } from "../src/core/players/types.js";
import { ROSTER_COMPOSITION } from "../src/core/constants.js";
import { wageBill } from "../src/core/finance/budget.js";

const SEEDS = (process.env.SEEDS ?? "1").split(",").map(Number);
const SEASONS = Number(process.env.SEASONS ?? 20);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((100 * n) / d).toFixed(1));

function rosteredPids(l: LeagueStore): Set<number> {
  const s = new Set<number>();
  for (const t of l.teams) {
    for (const pid of t.roster) s.add(pid);
    for (const pid of t.academyRoster ?? []) s.add(pid);
  }
  return s;
}

/**
 * Every position change in a player's recorded history, read straight off the
 * hist snapshots. Works on origin/main too, where `pos` is absent and every
 * entry therefore reads as his current position — i.e. zero changes, which is
 * the truth there.
 */
function changesOf(p: Player): { season: number; from: Position; to: Position }[] {
  const out: { season: number; from: Position; to: Position }[] = [];
  let prev: Position | null = null;
  for (const h of p.recentHist) {
    const at = (h as { pos?: Position }).pos ?? p.pos;
    if (prev !== null && at !== prev) out.push({ season: h.season, from: prev, to: at });
    prev = at;
  }
  return out;
}

for (const SEED of SEEDS) {
  const rng = mulberry32(SEED);
  let league = createLeagueState(0, rng, SEED);
  const userTid = league.meta.userTid;

  console.log(`\n########## seed ${SEED} ##########`);

  const tier1 = new Set(
    league.competitions.filter((c) => c.tier === 1).map((c) => c.id),
  );

  function snapshot(label: string) {
    const on = rosteredPids(league);
    // The user's club is unmanaged in a headless run and rots, producing all
    // the extreme roster/finance tails — excluded from everything but its own
    // line, per the standing rule for these audits.
    const rostered = league.players.filter((p) => on.has(p.pid));
    const t1Tids = new Set(
      league.teams.filter((t) => tier1.has(t.compId) && t.tid !== userTid).map((t) => t.tid),
    );
    const t1Pids = new Set(
      league.teams.filter((t) => t1Tids.has(t.tid)).flatMap((t) => t.roster),
    );
    const t1 = league.players.filter((p) => t1Pids.has(p.pid));

    const mix = POSITIONS.map((pos) => {
      const n = rostered.filter((p) => p.pos === pos).length;
      return `${pos} ${pct(n, rostered.length)}`;
    }).join("  ");

    const budgets = league.teams
      .filter((t) => t.tid !== userTid)
      .map((t) => t.budget);
    const salary = new Map(league.players.map((p) => [p.pid, p.contract.salary]));
    const wages = league.teams
      .filter((t) => t.tid !== userTid)
      .map((t) => wageBill(t.roster, salary));

    console.log(`  [${label}]`);
    console.log(`    mean ovr  rostered ${mean(rostered.map((p) => p.ovr)).toFixed(2)}` +
      `   tier-1 ${mean(t1.map((p) => p.ovr)).toFixed(2)}`);
    console.log(`    mix       ${mix}`);
    console.log(`    finance   min AI budget ${(Math.min(...budgets) / 1e6).toFixed(1)}M` +
      `   mean wage bill ${(mean(wages) / 1e6).toFixed(1)}M`);
  }

  const targetTotal = POSITIONS.reduce((a, pos) => a + (ROSTER_COMPOSITION[pos] ?? 0), 0);
  console.log("  target mix  " + POSITIONS.map((pos) =>
    `${pos} ${((100 * (ROSTER_COMPOSITION[pos] ?? 0)) / targetTotal).toFixed(1)}`).join("  "));
  snapshot("fresh");

  for (let s = 1; s <= SEASONS; s++) {
    league = simThrough(league, "season", rng);
    league = simOffseason(league, rng);

    const on = rosteredPids(league);
    const rostered = league.players.filter((p) => on.has(p.pid));
    // Conversions stamped this offseason. hist entries are stamped with the
    // season that just ended, so the fresh ones carry `endingSeason`.
    const justMoved = rostered.flatMap((p) =>
      changesOf(p).filter((c) => c.season >= league.season - 1));
    const flow = new Map<string, number>();
    for (const c of justMoved) flow.set(`${c.from}->${c.to}`, (flow.get(`${c.from}->${c.to}`) ?? 0) + 1);
    const top = [...flow.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  season ${String(s).padStart(2)}: ${String(justMoved.length).padStart(4)} conversions ` +
      `(${pct(justMoved.length, rostered.length)}% of rostered)${top ? `  [${top}]` : ""}`);

    if (s % 10 === 0 || s === SEASONS) snapshot(`after ${s} seasons`);
  }

  // Round trips: a player who returned to a position he had already left. Each
  // leg of an oscillation raises his ovr, so this is the rating-pump check.
  const all = league.players;
  let roundTrips = 0;
  let everChanged = 0;
  let multi = 0;
  for (const p of all) {
    const cs = changesOf(p);
    if (cs.length > 0) everChanged++;
    if (cs.length > 1) multi++;
    const visited = new Set<Position>();
    if (cs.length > 0) visited.add(cs[0].from);
    for (const c of cs) {
      if (visited.has(c.to)) { roundTrips++; break; }
      visited.add(c.to);
    }
  }
  console.log(`  careers: ${everChanged} players changed position ` +
    `(${pct(everChanged, all.length)}% of pool), ${multi} more than once, ` +
    `${roundTrips} round trips`);
}
