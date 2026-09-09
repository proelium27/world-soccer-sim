/**
 * Substitution-rate probe for the window model (engine/matchSim.ts).
 *
 * Subs used to fire at two fixed checkpoints, one player each, so no side could
 * ever make more than two however deep its bench. Windows replaced that. This
 * reports what the sim actually does now, and — the part that matters when
 * retuning — WHY a side stops short of MAX_SUBS, which is the difference
 * between the window budget binding and the quality gate refusing.
 *
 * Real top-flight reference: ~4.5 subs per team per match, most sides using all
 * five. Before windows this measured 1.58.
 *
 * Run: npx tsx scripts/subWindowProbe.ts   (SEED=n to change world)
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import {
  MAX_SUBS,
  MATCH_SECONDS,
  MAX_DT,
  SUB_WINDOW_HALFTIME_ELAPSED,
  SUB_WINDOWS_IN_PLAY,
  SUB_MAX_PER_WINDOW,
} from "../src/engine/constants.js";

const SEED = Number(process.env.SEED ?? 7);
const rng = mulberry32(SEED);
let league = createLeagueState(0, rng, 0);
league = simThrough(league, "season", mulberry32(SEED * 1000 + 1));

const subsPerSide: number[] = [];
const windowsPerSide: number[] = [];
let matches = 0;
const stoppages: number[] = [];
const byMinute = new Map<number, number>();
// Why a side that made fewer than MAX_SUBS stopped.
let stoppedByWindows = 0;
let stoppedByGate = 0;
let usedAll = 0;
const perWindowCounts = new Map<number, number>();

for (const m of league.played) {
  const b = m.boxScore;
  if (!b?.events) continue;
  matches++;
  let minClock = 0;
  for (const e of b.events) if (e.clock < minClock) minClock = e.clock;
  stoppages.push(-minClock);

  for (const side of ["home", "away"] as const) {
    const injured = new Set(
      b.events.filter((e) => e.type === "injury" && e.side === side).map((e) => e.pids[0]),
    );
    const subs = b.events.filter((e) => e.type === "substitution" && e.side === side);
    subsPerSide.push(subs.length);
    for (const e of subs) {
      byMinute.set(
        Math.round((MATCH_SECONDS - e.clock) / 60),
        (byMinute.get(Math.round((MATCH_SECONDS - e.clock) / 60)) ?? 0) + 1,
      );
    }

    // Planned changes only: an injury replacement fires immediately, not at a window.
    const planned = subs.filter((e) => !injured.has(e.pids[0]));
    // Every change made inside one window is committed on the same tick, so an
    // exact clock value identifies the window. That stays true now that the
    // moments are jittered per side, where matching against the nominal minutes
    // would not.
    const moments = planned.map((e) => e.clock);
    const inPlay = new Set(moments.filter((c) => MATCH_SECONDS - c > SUB_WINDOW_HALFTIME_ELAPSED + MAX_DT));
    windowsPerSide.push(inPlay.size);
    for (const w of new Set(moments)) {
      const n = moments.filter((x) => x === w).length;
      perWindowCounts.set(n, (perWindowCounts.get(n) ?? 0) + 1);
    }

    if (subs.length >= MAX_SUBS) usedAll++;
    else if (inPlay.size >= SUB_WINDOWS_IN_PLAY) stoppedByWindows++;
    else stoppedByGate++;
  }
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const hist = (xs: number[]) => {
  const h = new Map<number, number>();
  for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1);
  return [...h.entries()].sort((a, b) => a[0] - b[0]);
};

console.log(`seed ${SEED}: ${matches} matches, ${subsPerSide.length} team-matches`);
console.log(`\nsubs per team per match: mean ${mean(subsPerSide).toFixed(2)}  (real ~4.5, pre-windows 1.58)`);
for (const [k, n] of hist(subsPerSide)) {
  console.log(`  ${k}: ${String(n).padStart(6)}  ${((n / subsPerSide.length) * 100).toFixed(1)}%`);
}

console.log(`\nin-play windows used (budget ${SUB_WINDOWS_IN_PLAY}):`);
for (const [k, n] of hist(windowsPerSide)) {
  console.log(`  ${k}: ${String(n).padStart(6)}  ${((n / windowsPerSide.length) * 100).toFixed(1)}%`);
}

console.log(`\nchanges made per window used (cap ${SUB_MAX_PER_WINDOW}):`);
for (const [k, n] of [...perWindowCounts.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k}: ${String(n).padStart(6)}`);
}

const tm = subsPerSide.length;
console.log(`\nwhy a side stopped short of ${MAX_SUBS}:`);
console.log(`  used all ${MAX_SUBS}      : ${String(usedAll).padStart(6)}  ${((usedAll / tm) * 100).toFixed(1)}%`);
console.log(`  window budget spent : ${String(stoppedByWindows).padStart(6)}  ${((stoppedByWindows / tm) * 100).toFixed(1)}%`);
console.log(`  gate refused        : ${String(stoppedByGate).padStart(6)}  ${((stoppedByGate / tm) * 100).toFixed(1)}%`);

console.log(
  `\nstoppage past 90': mean ${mean(stoppages).toFixed(0)}s (min 120s, cap 600s).` +
    ` Below the cap means extra subs really do lengthen matches.`,
);
console.log(`\nsubs by minute (top 12):`);
for (const [k, n] of [...byMinute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${k}': ${n}`);
}
