/**
 * Can a player move clubs twice inside ONE transfer window?
 *
 * The AI<->AI market keeps a `moved` set, so it can't move the same player
 * twice within one run, and it runs once per window. But the window is wider
 * than that one run: `enforceDivisionCeilings` logs summer-window moves either
 * side of it, and the user's own buying and selling happen in the same window
 * on top. This counts, per (season, window), how many pids carry more than one
 * permanent club-to-club transfer, and attributes each pair to a shape.
 *
 *   npx tsx scripts/windowDoubleMoveProbe.ts [seasons] [seed]
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { FREE_AGENT_TID } from "../src/core/transfers/negotiation.js";
import type { CompletedTransfer } from "../src/core/transfers/negotiation.js";

const SEASONS = Number(process.argv[2] ?? 6);
const SEED = Number(process.argv[3] ?? 1);

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng);

/** A permanent club-to-club move: not a loan, not a loan return, not free agency. */
function isClubToClub(t: CompletedTransfer): boolean {
  return (
    t.loanSeasons === undefined && !t.loanReturn &&
    t.fromTid !== FREE_AGENT_TID && t.toTid !== FREE_AGENT_TID
  );
}

console.log(`seed ${SEED}\n`);
console.log("season  window  moves   pids>1   extra   chains(A->B->C)   returns(A->B->A)");

let seen = 0;
for (let s = 1; s <= SEASONS; s++) {
  const before = league.transfers.length;
  league = simThrough(league, "season", rng);
  league = simOffseason(league, rng);
  const fresh = league.transfers.slice(before).filter(isClubToClub);

  const byWindow = new Map<string, CompletedTransfer[]>();
  for (const t of fresh) {
    const key = `${t.season}|${t.window}`;
    const arr = byWindow.get(key) ?? [];
    arr.push(t);
    byWindow.set(key, arr);
  }

  for (const [key, rows] of [...byWindow.entries()].sort()) {
    const byPid = new Map<number, CompletedTransfer[]>();
    for (const t of rows) {
      const arr = byPid.get(t.pid) ?? [];
      arr.push(t);
      byPid.set(t.pid, arr);
    }
    let multi = 0, extra = 0, chains = 0, returns = 0;
    for (const [, moves] of byPid) {
      if (moves.length < 2) continue;
      multi++;
      extra += moves.length - 1;
      // In log order, does the second move start where the first ended?
      for (let i = 1; i < moves.length; i++) {
        if (moves[i].fromTid === moves[i - 1].toTid) {
          if (moves[i].toTid === moves[i - 1].fromTid) returns++;
          else chains++;
        }
      }
    }
    seen += extra;
    const [season, window] = key.split("|");
    console.log(
      `${season.padStart(6)}  ${window.padEnd(6)}  ${String(rows.length).padStart(5)}   ` +
      `${String(multi).padStart(6)}   ${String(extra).padStart(5)}   ` +
      `${String(chains).padStart(15)}   ${String(returns).padStart(16)}`,
    );
  }
}

console.log(`\ntotal extra in-window moves: ${seen}`);

// Attribution: the ceiling sweep only ever moves an at-or-over-threshold
// player from a lower tier up to tier 1, so a leg with that shape is the
// sweep and anything else is the market.
import { tierOf } from "../src/core/competitions.js";
import { DIVISION_2_REFUSAL_OVR_THRESHOLD } from "../src/core/constants.js";
const tierByTid = new Map(league.teams.map((t) => [t.tid, tierOf(league.competitions, t.compId)]));
const ovrByPid = new Map(league.players.map((p) => [p.pid, p.ovr]));
const all = league.transfers.filter(isClubToClub);
const groups = new Map<string, CompletedTransfer[]>();
for (const t of all) {
  const k = `${t.pid}|${t.season}|${t.window}`;
  const a = groups.get(k) ?? []; a.push(t); groups.set(k, a);
}
const shape = (t: CompletedTransfer) => {
  const up = tierByTid.get(t.toTid) === 1 && (tierByTid.get(t.fromTid) ?? 1) > 1;
  const ovr = ovrByPid.get(t.pid);
  return up && ovr !== undefined && ovr >= DIVISION_2_REFUSAL_OVR_THRESHOLD ? "sweep?" : "market";
};
const tally = new Map<string, number>();
let shown = 0;
for (const [, moves] of groups) {
  if (moves.length < 2) continue;
  const key = moves.map(shape).join(" then ");
  tally.set(key, (tally.get(key) ?? 0) + 1);
  if (shown < 8) {
    shown++;
    console.log(
      `  pid ${moves[0].pid} ovr ${ovrByPid.get(moves[0].pid)} s${moves[0].season} ${moves[0].window}: ` +
      moves.map((m) => `${m.fromTid}(t${tierByTid.get(m.fromTid)})->${m.toTid}(t${tierByTid.get(m.toTid)}) $${(m.fee/1e6).toFixed(1)}M`).join("  |  "),
    );
  }
}
console.log("\nshape tally:");
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(4)}  ${k}`);
