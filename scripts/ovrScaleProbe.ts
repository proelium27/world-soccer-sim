/**
 * Fingerprints everything the OVR scale shift must NOT change, plus the one
 * thing it must (the ratings themselves).
 *
 * A uniform additive shift of every rating is an affine relabel, and the game
 * is invariant to it by construction: match composites z-normalise within each
 * competition (so a constant added to everyone leaves every z-score alone), and
 * both money curves are differences from a floor -- wages are
 * `(ovr - WAGE_OVR_FLOOR)^3`, value is `(ovr - VALUATION_OVR_FLOOR)^n` plus
 * `(ovr - VALUATION_ELITE_THRESHOLD)^2` -- so shifting the floors with the
 * ratings leaves every wage and fee identical to the pound.
 *
 * That invariance is the whole reason the shift needs no dynasty audit, so it
 * is verified rather than asserted. Run it on the merge base, run it again on
 * the branch, diff the two:
 *
 *   npx tsx scripts/ovrScaleProbe.ts > before.json    # on origin/main
 *   npx tsx scripts/ovrScaleProbe.ts > after.json     # on the branch
 *   npx tsx scripts/ovrScaleProbe.ts --compare before.json after.json
 *
 * The comparison expects: wages identical, values identical, the simSeason
 * scoreline hash identical, and every ovr up by exactly OVR_SCALE_SHIFT except
 * where the 1/99 rating clamps bind -- reported separately, since a shift
 * necessarily un-clamps the bottom of the weakest academies, which is a real
 * (and wanted) behaviour change rather than a failure.
 */
import { readFileSync } from "node:fs";
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simSeason } from "../src/core/season.js";
import { seasonSalaryForOvr } from "../src/core/contracts.js";
import { trueTransferValue } from "../src/core/finance/valuation.js";

const SEED = 1;

interface Fingerprint {
  scorelineHash: string;
  players: Record<string, [ovr: number, pot: number, wage: number, value: number]>;
  ratingsAtFloor: number;
  ratingsAtCeiling: number;
  compMeans: Record<string, number>;
}

function hashScorelines(): string {
  const season = simSeason(mulberry32(12345));
  let h = 0;
  for (const m of season.matches) {
    for (const v of [m.homeGoals, m.awayGoals]) h = (Math.imul(h, 31) + v) | 0;
  }
  return String(h);
}

function fingerprint(): Fingerprint {
  const league = createLeagueState(0, mulberry32(SEED), SEED);
  const players: Fingerprint["players"] = {};
  let atFloor = 0;
  let atCeiling = 0;
  for (const p of league.players) {
    players[p.pid] = [
      p.ovr,
      p.potential,
      seasonSalaryForOvr(p.ovr, p.pid, league.season),
      Math.round(trueTransferValue(p, league.season)),
    ];
    for (const v of Object.values(p.ratings as Record<string, number>)) {
      if (v <= 1) atFloor++;
      if (v >= 99) atCeiling++;
    }
  }
  const compTotals = new Map<number, [sum: number, n: number]>();
  const pool = new Map(league.players.map((p) => [p.pid, p]));
  for (const t of league.teams) {
    const cur = compTotals.get(t.compId) ?? [0, 0];
    for (const pid of t.roster) {
      const p = pool.get(pid);
      if (p) {
        cur[0] += p.ovr;
        cur[1]++;
      }
    }
    compTotals.set(t.compId, cur);
  }
  const compMeans: Record<string, number> = {};
  for (const c of league.competitions) {
    const [sum, n] = compTotals.get(c.id) ?? [0, 0];
    if (n) compMeans[c.name] = Number((sum / n).toFixed(2));
  }
  return {
    scorelineHash: hashScorelines(),
    players,
    ratingsAtFloor: atFloor,
    ratingsAtCeiling: atCeiling,
    compMeans,
  };
}

function compare(beforePath: string, afterPath: string): void {
  const a: Fingerprint = JSON.parse(readFileSync(beforePath, "utf8"));
  const b: Fingerprint = JSON.parse(readFileSync(afterPath, "utf8"));
  const shifts = new Map<number, number>();
  let wageDiffs = 0;
  let valueDiffs = 0;
  let worstWage = 0;
  let worstValue = 0;
  for (const [pid, [ovr, , wage, value]] of Object.entries(a.players)) {
    const after = b.players[pid];
    if (!after) {
      console.log(`MISSING pid ${pid} after`);
      continue;
    }
    shifts.set(after[0] - ovr, (shifts.get(after[0] - ovr) ?? 0) + 1);
    if (after[2] !== wage) {
      wageDiffs++;
      worstWage = Math.max(worstWage, Math.abs(after[2] - wage));
    }
    if (after[3] !== value) {
      valueDiffs++;
      worstValue = Math.max(worstValue, Math.abs(after[3] - value));
    }
  }
  const total = Object.keys(a.players).length;
  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
  console.log(`players: ${total}`);
  console.log(
    `scoreline hash: ${a.scorelineHash} -> ${b.scorelineHash}  ` +
      `${a.scorelineHash === b.scorelineHash ? "IDENTICAL" : "*** MOVED ***"}`,
  );
  console.log(`wages differing:  ${wageDiffs} (${pct(wageDiffs)}), worst delta ${worstWage}`);
  console.log(`values differing: ${valueDiffs} (${pct(valueDiffs)}), worst delta ${worstValue}`);
  console.log(`ratings clamped at 1:  ${a.ratingsAtFloor} -> ${b.ratingsAtFloor}`);
  console.log(`ratings clamped at 99: ${a.ratingsAtCeiling} -> ${b.ratingsAtCeiling}`);
  console.log("ovr shift distribution (delta: count):");
  for (const [d, n] of [...shifts].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${d >= 0 ? "+" : ""}${d}: ${n} (${pct(n)})`);
  }
  console.log("competition mean ovr:");
  for (const name of Object.keys(a.compMeans)) {
    const delta = (b.compMeans[name] - a.compMeans[name]).toFixed(2);
    console.log(`  ${name}\t${a.compMeans[name]} -> ${b.compMeans[name]}\t(+${delta})`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--compare") compare(args[1], args[2]);
else console.log(JSON.stringify(fingerprint()));
