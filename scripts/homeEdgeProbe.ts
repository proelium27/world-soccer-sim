/**
 * Diagnostic for test/engine/neutralVenue.test.ts, which compares the goal gap
 * two identical sides produce with the home bonus against the residual gap on a
 * neutral ground. Both are sums of ~400 noisy matches, so the test is really
 * asking whether one noisy number is less than half another noisy one.
 *
 * Reports both at several sample sizes so "did home advantage break" can be told
 * apart from "did this sample re-roll". Copy to a merge-base checkout and run
 * there too.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simMatchDetailed } from "../src/engine/matchSim.js";
import { makeTeam } from "../src/engine/composites.js";
import type { MatchPlayer, MatchPosition } from "../src/engine/attribution.js";

const SLOTS: MatchPosition[] = ["GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST"];

function makeSquad(pidOffset: number): MatchPlayer[] {
  return SLOTS.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: 65,
    shooting: pos === "ST" ? 75 : 45,
    dribbling: 50,
    tackling: pos === "CB" || pos === "DM" ? 70 : 45,
    keeping: pos === "GK" ? 75 : 5,
    positioning: 55,
    heading: 50,
    stamina: 60,
    interceptions: pos === "CB" || pos === "DM" ? 70 : 45,
    passing: 55,
  }));
}

function aggregate(neutral: boolean, matches: number) {
  let home = 0;
  let away = 0;
  for (let seed = 1; seed <= matches; seed++) {
    const r = simMatchDetailed(
      mulberry32(seed),
      makeTeam("Home"), makeTeam("Away"),
      makeSquad(0), makeSquad(100), [], [],
      neutral ? { neutral: true } : {},
    );
    home += r.home;
    away += r.away;
  }
  return { home, away, gap: home - away };
}

const share = (r: { home: number; away: number }) => r.home / (r.home + r.away);

for (const matches of [400, 800, 1200, 2000]) {
  const normal = aggregate(false, matches);
  const neutral = aggregate(true, matches);
  console.log(
    `matches ${String(matches).padStart(4)}  bonus gap ${String(normal.gap).padStart(5)}` +
      `  neutral gap ${String(neutral.gap).padStart(5)}` +
      `  home share ${share(normal).toFixed(4)} -> ${share(neutral).toFixed(4)}` +
      `  ${share(neutral) < share(normal) ? "PASS" : "FAIL"}`,
  );
}
