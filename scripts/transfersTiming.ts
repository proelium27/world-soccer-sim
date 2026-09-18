/**
 * Time the work the Transfers page does on open, as a save ages.
 *
 * The page is reported to freeze the whole site indefinitely when opened. It's
 * fast on a young league, so the question is what scales with season count.
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { recommendedTransfers, searchWorldPlayers } from "../src/core/transfers/recommendations.js";
import { currentNegotiations } from "../src/core/transfers/negotiation.js";
import { protectedStarPids, lastCompletedSeason } from "../src/core/transfers/protectedStars.js";

const SEASONS = Number(process.argv[2] ?? 30);

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const rng = mulberry32(7);
let league = createLeagueState(0, rng);

console.log(
  ["season", "players", "transfers", "newsEvents", "statLines",
    "protectedStarPids", "recommended", "search(empty)", "TOTAL"].join("\t"),
);

for (let s = 1; s <= SEASONS; s++) {
  league = simThrough(league, "season", rng);
  league = simOffseason(league, rng);

  const l = structuredClone(league);
  l.phase = "offseason";

  const statLines = l.players.reduce((n, p) => n + p.recentStats.length, 0);
  const user = l.teams.find((t) => t.tid === l.meta.userTid)!;

  const tProtected = ms(() => {
    protectedStarPids(lastCompletedSeason(l), l.teams, l.players, l.competitions, user.tid);
  });
  const tRec = ms(() => { recommendedTransfers(l, 0, {}); });
  // The page's initial state: no filter set, so this must return [] cheaply.
  const tSearch = ms(() => { searchWorldPlayers(l, {}); });
  const tNeg = ms(() => { currentNegotiations(l); });

  if (s % 2 === 0 || s <= 4 || s === SEASONS) {
    console.log(
      [
        s, l.players.length, l.transfers.length, l.newsEvents.length, statLines,
        tProtected.toFixed(1), tRec.toFixed(1), tSearch.toFixed(1),
        (tProtected + tRec + tSearch + tNeg).toFixed(1),
      ].join("\t"),
    );
  }
}
