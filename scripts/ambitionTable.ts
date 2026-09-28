/**
 * The numbers behind "at what level do players move for quality":
 *  1. per rating: how much he cares about club size (refusals), how ambitious he
 *     is (the pull up), what a 0.1 step up in stature is worth to him, and the
 *     biggest step down he'll accept;
 *  2. real moves on a fresh world: the rating at which leaving for a better
 *     club beats staying home, line by line.
 *
 *   SEED=1 npx tsx scripts/ambitionTable.ts
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { deriveLeagueContexts, type ClubContext } from "../src/core/ai/clubContext.js";
import { appealScore } from "../src/core/transfers/clubAppeal.js";
import { statureSensitivity, playerAmbition } from "../src/core/transfers/playerWill.js";
import { PLAYER_WILL_RISE_BONUS, PLAYER_WILL_REFUSAL_DROP } from "../src/core/constants.js";
import { mulberry32 } from "../src/engine/rng.js";
import type { Player } from "../src/core/players/types.js";

console.log("rating  care  ambition  worth of a +0.1 step up  biggest step down he accepts");
for (let ovr = 60; ovr <= 92; ovr += 4) {
  const care = statureSensitivity(ovr);
  const amb = playerAmbition(ovr);
  const drop = care > 0 ? (PLAYER_WILL_REFUSAL_DROP / care).toFixed(2) : "any";
  console.log(`${String(ovr).padStart(6)}  ${care.toFixed(2)}  ${amb.toFixed(2).padStart(8)}  ${("+" + (amb * PLAYER_WILL_RISE_BONUS * 0.1).toFixed(3)).padStart(24)}  ${drop.padStart(28)}`);
}

const seed = Number(process.env.SEED ?? 1);
const league = createLeagueState(0, mulberry32(seed));
const contexts = deriveLeagueContexts({
  teams: league.teams, players: league.players, season: league.season, played: [],
  competitions: league.competitions,
});
const top = (country: string) => league.competitions.find((c) => c.country === country && c.tier === 1)!;
const ranked = (country: string) =>
  league.teams.filter((t) => t.compId === top(country).id).map((t) => contexts.get(t.tid)!).sort((a, b) => b.stature - a.stature);
const pick = (country: string, where: "best" | "top quarter" | "median") => {
  const r = ranked(country);
  return where === "best" ? r[0] : where === "top quarter" ? r[Math.floor(r.length / 4)] : r[Math.floor(r.length / 2)];
};

const MOVES: [string, string, "best" | "top quarter" | "median", string, "best" | "top quarter" | "median"][] = [
  ["Brazil", "Brazil", "median", "England", "median"],
  ["Brazil", "Brazil", "best", "England", "median"],
  ["Brazil", "Brazil", "best", "Spain", "top quarter"],
  ["Argentina", "Argentina", "best", "Spain", "median"],
  ["Serbia", "Serbia", "best", "Germany", "median"],
  ["Netherlands", "Netherlands", "best", "England", "median"],
  ["France", "France", "median", "England", "median"],
  ["England", "England", "median", "England", "top quarter"],
];

console.log("\nmove (stature from -> to)                                      moves once rated");
for (const [nat, fc, fw, tc, tw] of MOVES) {
  const from = pick(fc, fw);
  const to = pick(tc, tw);
  let breakEven: number | null = null;
  for (let ovr = 60; ovr <= 95; ovr++) {
    // Rated as a CM who would start at both clubs, so playing time is level
    // and the move is decided on club size and home.
    const p = { pid: -1, nationality: nat, pos: "CM", ovr, stats: [], born: 0 } as unknown as Player;
    const level = (c: ClubContext) => ({ ...c, posWeakestStarterOvr: Object.fromEntries(Object.keys(c.posWeakestStarterOvr).map((k) => [k, 0])) as ClubContext["posWeakestStarterOvr"] });
    const s = appealScore(p, level(to), { stature: from.stature, club: level(from) });
    if (!s.refused && s.score > 0) { breakEven = ovr; break; }
  }
  const label = `${nat}: ${fc} ${fw} -> ${tc} ${tw} (${from.stature.toFixed(2)} -> ${to.stature.toFixed(2)})`;
  console.log(`${label.padEnd(64)} ${breakEven ?? "never (<= 95)"}`);
}
