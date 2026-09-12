/**
 * The gate for the half-time/stoppage clock rework (2026-09-10).
 *
 * Two questions, and they need different measurements:
 *
 *  1. DID THE FOOTBALL MOVE? Goal celebrations consume clock and the referee
 *     credits it back, so playing time — and therefore scoring — should be
 *     unchanged. This is the number that would quietly break a benchmark gate,
 *     and it is invisible to any check of the timeline.
 *  2. IS THE TIMELINE RIGHT? First-half stoppage has to exist, 45+n has to be
 *     reachable, and two goals must never share a displayed minute — the
 *     reported symptom.
 *
 * Run against the merge base by setting GOAL_RESTART_MAX_SECONDS =
 * GOAL_RESTART_MIN_SECONDS = 0 for question 1's control, or just check the
 * numbers out with `git stash`-free worktree comparison.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";
import { formatClock, eventMinute } from "../src/ui/matchClock.js";
import { HALF_SECONDS, MATCH_SECONDS } from "../src/engine/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 6);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const pct = (a: number[], f: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) * f)];
};

const goals: number[] = [];
const homeWins: number[] = [];
const champPts: number[] = [];

const h1Stoppages: number[] = [];
const h2Stoppages: number[] = [];
const finalMinutes: number[] = [];
let sameMinuteGoalPairs = 0;
let goalPairs = 0;
let firstHalfStoppageEvents = 0;
let totalEvents = 0;
const labelSamples = new Set<string>();

for (let i = 0; i < SEASONS; i++) {
  const s = simSeason(mulberry32(12345 + i * 977));
  let g = 0;
  let hw = 0;
  const pts = new Map<number, number>();
  for (const m of s.matches) {
    g += m.homeGoals + m.awayGoals;
    if (m.homeGoals > m.awayGoals) hw++;
    const h = m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    const a = m.awayGoals > m.homeGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    pts.set(m.home, (pts.get(m.home) ?? 0) + h);
    pts.set(m.away, (pts.get(m.away) ?? 0) + a);

    const box = m.boxScore;
    const h1 = box.firstHalfStoppage ?? 0;
    h1Stoppages.push(h1);
    // Second-half stoppage is the whistle past the 90, net of the first half's.
    const finalClock = box.finalClock ?? 0;
    h2Stoppages.push(Math.max(0, -(finalClock + h1)));
    finalMinutes.push(eventMinute(finalClock));

    // Every goal's displayed minute, in order, so back-to-back goals are visible.
    const goalMinutes: number[] = [];
    for (const e of box.events) {
      totalEvents++;
      const elapsed = MATCH_SECONDS - e.clock;
      if (elapsed > HALF_SECONDS && elapsed <= HALF_SECONDS + h1) firstHalfStoppageEvents++;
      if (labelSamples.size < 400) labelSamples.add(formatClock(e.clock, h1));
      if (e.type === "goal") goalMinutes.push(eventMinute(e.clock));
    }
    for (let k = 1; k < goalMinutes.length; k++) {
      goalPairs++;
      if (goalMinutes[k] === goalMinutes[k - 1]) sameMinuteGoalPairs++;
    }
  }
  goals.push(g / s.matches.length);
  homeWins.push(hw / s.matches.length);
  champPts.push(Math.max(...pts.values()));
}

console.log(`seasons ${SEASONS}`);
console.log("--- did the football move? ---");
console.log(`goals/match   mean ${mean(goals).toFixed(4)}  range ${Math.min(...goals).toFixed(3)}-${Math.max(...goals).toFixed(3)}`);
console.log(`home win rate mean ${mean(homeWins).toFixed(4)}`);
console.log(`champion pts  mean ${mean(champPts).toFixed(2)}  range ${Math.min(...champPts)}-${Math.max(...champPts)}`);
console.log("--- is the timeline right? ---");
console.log(`1st-half stoppage  mean ${mean(h1Stoppages).toFixed(1)}s  p50 ${pct(h1Stoppages, 0.5)}s  p95 ${pct(h1Stoppages, 0.95).toFixed(0)}s  max ${Math.max(...h1Stoppages).toFixed(0)}s`);
console.log(`2nd-half stoppage  mean ${mean(h2Stoppages).toFixed(1)}s  p50 ${pct(h2Stoppages, 0.5)}s  p95 ${pct(h2Stoppages, 0.95).toFixed(0)}s  max ${Math.max(...h2Stoppages).toFixed(0)}s`);
console.log(`final minute       mean ${mean(finalMinutes).toFixed(2)}  max ${Math.max(...finalMinutes)}`);
console.log(`events in 1st-half stoppage: ${firstHalfStoppageEvents} of ${totalEvents}`);
console.log(`back-to-back goals sharing a displayed minute: ${sameMinuteGoalPairs} of ${goalPairs} consecutive pairs`);
const stoppageLabels = [...labelSamples].filter((l) => l.includes("+")).sort();
console.log(`stoppage labels seen: ${stoppageLabels.slice(0, 14).join(" ")}${stoppageLabels.length > 14 ? " ..." : ""}`);
