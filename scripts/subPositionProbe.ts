/**
 * Task 0, part 2: when a substitution happens, does the player coming on
 * actually play the slot he's inheriting?
 *
 * The starter probe found essentially zero out-of-position starts, so the
 * substitution path is where slot-aware composites will actually bite. This
 * counts real sub events from real matches: each incoming player inherits the
 * outgoing player's slot (which is what the slot-aware model will do), and we
 * compare that slot to his natural position.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { leagueMatchData } from "../src/core/league/composites.js";
import { simMatchDetailed } from "../src/engine/matchSim.js";
import { teamSlots } from "../src/core/lineup/formations.js";
import { SUB_WINDOW_MOMENTS_ELAPSED, MATCH_SECONDS } from "../src/engine/constants.js";
import type { Position } from "../src/core/players/types.js";

/** Mirrors the private table in core/lineup/selectXI.ts. */
const ADJACENCY: Record<Position, Position[]> = {
  GK: [],
  CB: ["DM", "FB"],
  FB: ["W", "CB", "DM"],
  DM: ["CM", "CB"],
  CM: ["DM", "AM"],
  AM: ["CM", "W"],
  W: ["AM", "FB", "ST"],
  ST: ["W", "AM"],
};

const SEEDS = [1, 2, 3];
const MATCHDAYS = 6;

let exact = 0;
let adjacent = 0;
let foreign = 0;
let subs = 0;
const foreignPairs = new Map<string, number>();

for (const seed of SEEDS) {
  const rng = mulberry32(seed);
  const league = createLeagueState(0, rng);
  const data = leagueMatchData({
    teams: league.teams.map((t) => ({ ...t, avgOvr: 0 })),
    players: league.players,
  });
  const idx = new Map(league.teams.map((t, i) => [t.tid, i]));
  const slotsByTid = new Map(league.teams.map((t) => [t.tid, teamSlots(t)]));
  const posByPid = new Map(league.players.map((p) => [p.pid, p.pos]));

  const fixtures = league.schedule.filter((g) => g.matchday <= MATCHDAYS);
  for (const f of fixtures) {
    const hi = idx.get(f.home)!;
    const aiIdx = idx.get(f.away)!;
    const hd = data[hi];
    const ad = data[aiIdx];
    const r = simMatchDetailed(rng, hd.composites, ad.composites, hd.xi, ad.xi, hd.bench, ad.bench, {
      recompute: { home: hd.recompute, away: ad.recompute },
    });

    // Track slot ownership per side: starters own their formation slot, and a
    // substitute inherits the slot of the man he replaces.
    const slotOf = new Map<number, Position>();
    for (const [tid, d] of [[f.home, hd], [f.away, ad]] as const) {
      const slots = slotsByTid.get(tid)!;
      d.xi.forEach((mp, i) => slotOf.set(mp.pid, slots[i]));
    }

    // A chase-the-game sub is a deliberate reshape: the man coming on plays his
    // OWN position rather than inheriting the departing player's slot. Mirror
    // the engine's rule (final window moment, side trailing) so we measure what the
    // sim actually does instead of counting reshapes as out-of-position.
    const lastCheckpoint = SUB_WINDOW_MOMENTS_ELAPSED[SUB_WINDOW_MOMENTS_ELAPSED.length - 1];
    const scoreAt = (clock: number, side: "home" | "away"): number =>
      r.boxScore.events.filter((e) => e.type === "goal" && e.side === side && e.clock > clock).length;

    for (const ev of r.boxScore.events) {
      if (ev.type !== "substitution") continue;
      const [offPid, onPid] = ev.pids;
      const pos = posByPid.get(onPid);
      if (!pos) continue;
      const elapsed = MATCH_SECONDS - ev.clock;
      const trailing = scoreAt(ev.clock, ev.side) < scoreAt(ev.clock, ev.side === "home" ? "away" : "home");
      const reshape = elapsed >= lastCheckpoint && trailing;
      const slot = reshape ? pos : slotOf.get(offPid);
      if (!slot) continue;
      slotOf.set(onPid, slot);
      subs++;
      if (pos === slot) exact++;
      else if (ADJACENCY[slot].includes(pos)) adjacent++;
      else {
        foreign++;
        const key = `${pos} -> ${slot}`;
        foreignPairs.set(key, (foreignPairs.get(key) ?? 0) + 1);
      }
    }
  }
}

const pct = (n: number) => ((100 * n) / subs).toFixed(2);
console.log(`\nReal substitutions, ${SEEDS.length} seeds x ${MATCHDAYS} matchdays: n=${subs}`);
console.log(`  incoming player plays the slot he inherits : ${pct(exact).padStart(6)}%  (${exact})`);
console.log(`  adjacent to it                             : ${pct(adjacent).padStart(6)}%  (${adjacent})`);
console.log(`  foreign to it                              : ${pct(foreign).padStart(6)}%  (${foreign})`);

console.log(`\nMost common foreign sub pairings (natural pos -> inherited slot):`);
const top = [...foreignPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [pair, n] of top) {
  console.log(`  ${pair.padEnd(14)} ${String(n).padStart(6)}  (${((100 * n) / subs).toFixed(2)}% of all subs)`);
}
