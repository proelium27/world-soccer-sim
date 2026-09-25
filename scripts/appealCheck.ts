/**
 * What a Brazilian at Brazil's best club thinks of a move to a median
 * big-four club, line by line, at a few ratings, on a fresh world. A quick check
 * that the pull toward good clubs beats the home pull before running audits.
 *
 *   SEED=1 npx tsx scripts/appealCheck.ts
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { deriveLeagueContexts } from "../src/core/ai/clubContext.js";
import { clubAppealFor } from "../src/core/transfers/clubAppeal.js";
import { mulberry32 } from "../src/engine/rng.js";
import type { Player } from "../src/core/players/types.js";

const seed = Number(process.env.SEED ?? 1);
const league = createLeagueState(0, mulberry32(seed));
const contexts = deriveLeagueContexts({
  teams: league.teams, players: league.players, season: league.season, played: [],
  competitions: league.competitions,
});
const top = (country: string) => league.competitions.find((c) => c.country === country && c.tier === 1)!;
const clubsOf = (country: string) =>
  league.teams.filter((t) => t.compId === top(country).id).map((t) => contexts.get(t.tid)!).sort((a, b) => b.stature - a.stature);

const brazilBest = clubsOf("Brazil")[0];
const england = clubsOf("England");
const englandMedian = england[Math.floor(england.length / 2)];
console.log(`Brazil best stature ${brazilBest.stature.toFixed(3)}, England median ${englandMedian.stature.toFixed(3)}`);

for (const ovr of [72, 76, 80, 85]) {
  const p = { pid: -1, nationality: "Brazil", pos: "CM", ovr, stats: [], born: 0 } as unknown as Player;
  const a = clubAppealFor(p, englandMedian, { stature: brazilBest.stature, club: brazilBest });
  const lines = a.lines.map((l) => `${l.label} ${l.value >= 0 ? "+" : ""}${l.value.toFixed(3)}`).join(", ");
  console.log(`ovr ${ovr}: score ${a.score >= 0 ? "+" : ""}${a.score.toFixed(3)}${a.refused ? " REFUSED" : ""}  (${lines})`);
}
