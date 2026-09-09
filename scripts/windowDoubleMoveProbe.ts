/**
 * Can a player move clubs twice inside ONE transfer window?
 *
 * The AI<->AI market keeps a `moved` set, so it can't move the same player
 * twice within one run, and it runs once per window. But the window is wider
 * than that one run: `enforceDivisionCeilings` logs summer-window moves either
 * side of it, and the user's own buying and selling happen in the same window
 * on top. This counts, per (season, window), how many pids carry more than one
 * permanent club-to-club transfer.
 *
 * It should read 0 everywhere. It is kept because the bug it found was
 * invisible to the test suite: every individual mechanism was internally
 * consistent, and only the log for a whole window showed the same player moving
 * twice.
 *
 * HOW TO ATTRIBUTE A LEG, if this ever goes non-zero again. Do NOT try to
 * recognise a mechanism by the shape of its transfer — an earlier version of
 * this script guessed "sweep" from the destination tier and the player's OVR,
 * and it sent the investigation to the wrong mechanism twice. Both fields are
 * read at the END of the run, by which point promotion, relegation and
 * progression have all moved them, so neither is what it was when the move
 * happened. What works is tagging the producer: give one mechanism a marker
 * `window` for a single throwaway run (stamping `enforceDivisionCeilings`'
 * transfers `"winter"` is the one that cracked it) and see which bucket the
 * chains land in. That is exact rather than inferred, and it takes one line.
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

