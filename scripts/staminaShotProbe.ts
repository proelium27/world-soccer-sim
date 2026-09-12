/**
 * Diagnostic for test/engine/fatigue.test.ts's stamina-vs-shots gate.
 *
 * The gate compares two SYMMETRIC matches — both sides tired, against both sides
 * fresh — and asserts the fresh pair produces more shots. That is very nearly a
 * null measurement, and the numbers say so: the merge base passes it by ONE shot
 * in 5052. `chanceP` is driven by `off.attack - def.defense`, so fatigue applied
 * equally to both sides largely cancels out of the difference, leaving only the
 * residual from attack and defense being scaled on slightly different curves.
 *
 * The ASYMMETRIC arm below is what the gate was reaching for: one tired side
 * against one fresh side, with the orientation flipped and summed so home
 * advantage cancels. That is a real effect rather than a rounding error.
 *
 * Copy to a merge-base checkout and run there too — the point is that the fix is
 * not tuned to whichever branch happens to need it.
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simMatchDetailed } from "../src/engine/matchSim.js";
import type { MatchPlayer, MatchPosition } from "../src/engine/attribution.js";
import { makeTeam } from "../src/engine/composites.js";

// Fixture copied EXACTLY from test/engine/fatigue.test.ts — a probe built on a
// different squad measures a different question.
const SLOTS: MatchPosition[] = ["GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST"];

function makeSquad(pidOffset: number, stamina: number): MatchPlayer[] {
  return SLOTS.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: pos === "ST" ? 68 : 62,
    shooting: pos === "ST" ? 80 : 40,
    dribbling: 50,
    tackling: pos === "CB" || pos === "DM" ? 70 : 40,
    keeping: pos === "GK" ? 80 : 5,
    positioning: 55,
    heading: 45,
    stamina,
    interceptions: pos === "CB" || pos === "DM" ? 70 : 40,
    passing: 50,
  }));
}

const shots = (r: ReturnType<typeof simMatchDetailed>) =>
  [r.stat.home.shots, r.stat.away.shots] as const;

console.log("--- SYMMETRIC (what the gate measures today) ---");
for (const trials of [200, 600, 1500]) {
  let low = 0;
  let high = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const l = simMatchDetailed(
      mulberry32(seed), makeTeam("Home"), makeTeam("Away"), makeSquad(0, 1), makeSquad(100, 1),
    );
    low += l.stat.home.shots + l.stat.away.shots;
    const h = simMatchDetailed(
      mulberry32(seed), makeTeam("Home"), makeTeam("Away"), makeSquad(0, 99), makeSquad(100, 99),
    );
    high += h.stat.home.shots + h.stat.away.shots;
  }
  console.log(
    `  trials ${String(trials).padStart(4)}  tired ${low}  fresh ${high}  diff ${high - low} (${(((high - low) / low) * 100).toFixed(2)}%)  ${high > low ? "PASS" : "FAIL"}`,
  );
}

console.log("--- ASYMMETRIC (tired side vs fresh side, both orientations) ---");
for (const trials of [100, 300]) {
  let tired = 0;
  let fresh = 0;
  for (let seed = 1; seed <= trials; seed++) {
    // Fresh at home.
    const a = simMatchDetailed(
      mulberry32(seed), makeTeam("Home"), makeTeam("Away"), makeSquad(0, 99), makeSquad(100, 1),
    );
    fresh += shots(a)[0];
    tired += shots(a)[1];
    // Fresh away, so home advantage cancels across the pair.
    const b = simMatchDetailed(
      mulberry32(seed), makeTeam("Home"), makeTeam("Away"), makeSquad(0, 1), makeSquad(100, 99),
    );
    tired += shots(b)[0];
    fresh += shots(b)[1];
  }
  console.log(
    `  trials ${String(trials).padStart(4)}  tired ${tired}  fresh ${fresh}  diff ${fresh - tired} (${(((fresh - tired) / tired) * 100).toFixed(2)}%)  ${fresh > tired ? "PASS" : "FAIL"}`,
  );
}
