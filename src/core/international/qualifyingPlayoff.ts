import type { TeamMatchData } from "../league/composites.js";
import type { CupTie } from "../cup/types.js";
import type { IntlQualifyingPlayoff, IntlQualifyingPlayoffRound } from "./types.js";
import type { CareerDelta } from "./simIntl.js";
import { accumulate, collectInjured } from "./simIntl.js";
import { resolveCupTie } from "../cup/simCup.js";
import { mulberry32, hashInts } from "../../engine/rng.js";

/**
 * Qualifying playoffs.
 *
 * When a confederation's places run out part-way through a finishing position
 * (six groups, four places left for the third-placed nations), every nation
 * that finished there plays for those places rather than the best records
 * taking them. Group record only seeds the playoff: who hosts, who meets whom.
 *
 * The bracket is built so nobody qualifies without winning a match, which a
 * plain knockout can't manage once there are more than half as many places as
 * entrants (six for four would need two byes). Each round is one of two kinds:
 *
 *  - While the pool is at most twice the places left, every pair plays and
 *    every WINNER is through. The losers (and an odd one out) play on for
 *    whatever is left. Six for four: three ties, three through, then the three
 *    losers play for the last place.
 *  - While there are more than twice as many nations as places, the bottom of
 *    the pool plays elimination ties until it is down to exactly twice the
 *    places, and the rule above finishes it. Six for one: three ties, then the
 *    three winners play down to one.
 *
 * Every round plays at least one tie and settles at least one nation, so it
 * always finishes, and it hands out exactly the places it was given.
 *
 * Pure apart from the tie resolver it is handed; the sim plugs in
 * `resolveCupTie` on its own seeded stream (see playQualifyingPlayoff), never
 * the league's shared rng.
 */

/** A played tie as the bracket needs it: who played, who won. */
export interface PlayoffTie {
  home: number;
  away: number;
  winner: number;
}

export function runPlayoff<T extends PlayoffTie>(
  entrants: number[],
  places: number,
  playTie: (home: number, away: number, round: number) => T,
): { rounds: { qualifies: boolean; ties: T[] }[]; qualified: number[] } {
  const seed = new Map(entrants.map((nid, i) => [nid, i]));
  const bySeed = (xs: number[]): number[] => [...xs].sort((a, b) => seed.get(a)! - seed.get(b)!);

  const rounds: { qualifies: boolean; ties: T[] }[] = [];
  const qualified: number[] = [];
  let pool = [...entrants];
  let left = Math.max(0, Math.min(places, entrants.length));

  // Pair the first half of `players` against the second, best against worst.
  const pairUp = (players: number[], round: number): T[] => {
    const ties: T[] = [];
    for (let i = 0; i < Math.floor(players.length / 2); i++) {
      ties.push(playTie(players[i], players[players.length - 1 - i], round));
    }
    return ties;
  };

  while (left > 0 && pool.length > left) {
    const round = rounds.length;
    if (pool.length <= 2 * left) {
      const ties = pairUp(pool, round);
      const winners = ties.map((t) => t.winner);
      qualified.push(...winners);
      left -= ties.length;
      const won = new Set(winners);
      pool = bySeed(pool.filter((nid) => !won.has(nid)));
      rounds.push({ qualifies: true, ties });
    } else {
      const playing = Math.min(Math.floor(pool.length / 2), pool.length - 2 * left) * 2;
      const byes = pool.slice(0, pool.length - playing);
      const ties = pairUp(pool.slice(pool.length - playing), round);
      pool = bySeed([...byes, ...ties.map((t) => t.winner)]);
      rounds.push({ qualifies: false, ties });
    }
  }
  // Only reachable with no places to play for, or no more nations than places.
  if (left > 0) qualified.push(...pool.slice(0, left));
  return { rounds, qualified };
}

/** rng-stream tag for qualifying playoffs, clear of every other international stream. */
export const QUALIFYING_PLAYOFF_STREAM = 850;

/**
 * Play one confederation's playoff. Each round draws its own stream from
 * (lid, campaign season, round, confederation index), so the result is the
 * same however the campaign was reached. Ties are single-leg at the better
 * seed's ground, with extra time and a shootout if level; the box score feeds
 * caps and carried injuries and is then dropped, as every qualifier's is.
 */
export function playQualifyingPlayoff(
  confederation: string,
  confederationIndex: number,
  position: number,
  entrants: number[],
  places: number,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  season: number,
  delta: CareerDelta,
  injured: Set<number>,
): IntlQualifyingPlayoff {
  const streams = new Map<number, () => number>();
  const rngFor = (round: number): (() => number) => {
    let rng = streams.get(round);
    if (!rng) {
      rng = mulberry32(hashInts(lid, season, QUALIFYING_PLAYOFF_STREAM + round, confederationIndex));
      streams.set(round, rng);
    }
    return rng;
  };

  const { rounds, qualified } = runPlayoff<CupTie>(entrants, places, (home, away, round) => {
    const hd = matchData.get(home);
    const ad = matchData.get(away);
    if (!hd || !ad) {
      // Defensive: every entrant names a squad at the draw. A walkover keeps
      // the bracket whole rather than stranding a place.
      const winner = hd || !ad ? home : away;
      return {
        round, matchday: 0, home, away, homeGoals: 0, awayGoals: 0,
        wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0, winner, boxScore: null,
      };
    }
    const tie = resolveCupTie(rngFor(round), home, away, hd, ad, round, 0);
    if (tie.boxScore) {
      accumulate(delta, tie.boxScore);
      collectInjured(tie.boxScore, injured);
    }
    return { ...tie, boxScore: null };
  });

  const stored: IntlQualifyingPlayoffRound[] = rounds;
  return { confederation, position, places, entrants, rounds: stored, qualified };
}
