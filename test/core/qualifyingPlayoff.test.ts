import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { runPlayoff, playoffShape, qualifyingPlan } from "../../src/core/international/index.js";
import { runQualifying } from "../../src/core/international/qualifying.js";
import { summarizeQualifying } from "../../src/core/international/tournament.js";
import { groupTable } from "../../src/core/international/groups.js";
import { mulberry32 } from "../../src/engine/rng.js";

/**
 * When a confederation's places run out part-way through a finishing position,
 * the nations finishing there play for them instead of the best records taking
 * them. These pin the two things that has to guarantee: nobody goes through
 * without winning a match, and exactly the places the draw promised are filled.
 */

const coinFlip = (seed: number) => {
  const rng = mulberry32(seed);
  return (home: number, away: number) => ({ home, away, winner: rng() < 0.5 ? home : away });
};

describe("runPlayoff", () => {
  const SHAPES: [number, number][] = [
    [6, 4], [4, 2], [6, 1], [4, 1], [7, 6], [5, 3], [8, 3], [12, 5], [3, 2], [2, 1], [9, 4],
  ];

  it("fills exactly its places, and only with nations that won a tie that qualifies", () => {
    for (const [n, k] of SHAPES) {
      for (let s = 0; s < 40; s++) {
        const entrants = Array.from({ length: n }, (_, i) => 100 + i);
        const { rounds, qualified } = runPlayoff(entrants, k, coinFlip(s * 97 + n * 13 + k));

        expect(qualified).toHaveLength(k);
        expect(new Set(qualified).size).toBe(k);
        const wonAQualifier = new Set(rounds.filter((r) => r.qualifies).flatMap((r) => r.ties.map((t) => t.winner)));
        expect(new Set(qualified)).toEqual(wonAQualifier);

        // Every entrant plays at least once, and nobody twice in one round.
        const played = new Set(rounds.flatMap((r) => r.ties.flatMap((t) => [t.home, t.away])));
        for (const e of entrants) expect(played.has(e)).toBe(true);
        for (const r of rounds) {
          const sides = r.ties.flatMap((t) => [t.home, t.away]);
          expect(new Set(sides).size).toBe(sides.length);
        }
        // The better group record hosts.
        for (const t of rounds.flatMap((r) => r.ties)) {
          expect(entrants.indexOf(t.home)).toBeLessThan(entrants.indexOf(t.away));
        }
      }
    }
  });

  it("sends three winners through a six-for-four playoff and makes the losers play on for the last place", () => {
    const { rounds } = runPlayoff([1, 2, 3, 4, 5, 6], 4, coinFlip(3));
    expect(rounds.map((r) => [r.qualifies, r.ties.length])).toEqual([[true, 3], [false, 1], [true, 1]]);
    // Round one is best against worst.
    expect(rounds[0].ties.map((t) => [t.home, t.away])).toEqual([[1, 6], [2, 5], [3, 4]]);
  });

  it("plays a two-for-one playoff as a straight knockout", () => {
    expect(runPlayoff([1, 2, 3, 4], 2, coinFlip(5)).rounds.map((r) => r.qualifies)).toEqual([true]);
    expect(runPlayoff([1, 2, 3, 4], 1, coinFlip(5)).rounds.map((r) => r.qualifies)).toEqual([false, true]);
  });
});

describe("playoffShape", () => {
  it("finds the position the places run out in", () => {
    expect(playoffShape([4, 4, 4, 4, 4, 4], 16)).toEqual({ position: 2, entrants: 6, places: 4 });
    expect(playoffShape([4, 4, 4, 4], 6)).toEqual({ position: 1, entrants: 4, places: 2 });
  });

  it("is null when every position reached goes through outright", () => {
    expect(playoffShape([4, 4, 4], 6)).toBeNull();
    // Only the five-nation group has a fifth-placed side, and it takes the place.
    expect(playoffShape([5, 4, 4], 13)).toBeNull();
    expect(playoffShape([], 3)).toBeNull();
  });
});

describe("qualifying playoffs in a played campaign", () => {
  const league = makeLeague(0, 7);
  const result = runQualifying(league.players, league.season, league.lid, 32);

  it("still fills the World Cup exactly", () => {
    expect(result).not.toBeNull();
    const { campaign } = result!;
    expect(campaign.qualified).toHaveLength(32);
    expect(new Set(campaign.qualified).size).toBe(32);
  });

  it("plays the playoff the draw promised, between the nations that finished there", () => {
    const { campaign } = result!;
    const plans = qualifyingPlan(campaign).filter((p) => p.playoff);
    expect(plans.length).toBeGreaterThan(0);
    expect(campaign.playoffs).toHaveLength(plans.length);

    const qualified = new Set(campaign.qualified);
    for (const plan of plans) {
      const playoff = campaign.playoffs!.find((p) => p.confederation === plan.confederation)!;
      expect(playoff.position).toBe(plan.playoff!.position);
      expect(playoff.places).toBe(plan.playoff!.places);
      expect(playoff.entrants).toHaveLength(plan.playoff!.entrants);

      const atPosition = campaign.groups
        .filter((g) => g.confederation === plan.confederation)
        .map((g) => groupTable(g)[playoff.position]?.nid)
        .filter((nid): nid is number => nid !== undefined);
      expect(new Set(playoff.entrants)).toEqual(new Set(atPosition));

      const winners = new Set(playoff.qualified);
      expect(winners.size).toBe(playoff.places);
      for (const nid of playoff.entrants) {
        expect(qualified.has(campaign.nations[nid])).toBe(winners.has(nid));
      }
      for (const tie of playoff.rounds.flatMap((r) => r.ties)) expect(tie.boxScore).toBeNull();
    }
  });

  it("archives the playoffs with the campaign and replays them identically", () => {
    const summary = summarizeQualifying(result!.campaign);
    expect(summary.playoffs).toHaveLength(result!.campaign.playoffs!.length);
    for (const p of summary.playoffs!) {
      for (const nation of p.qualified) expect(summary.qualified).toContain(nation);
    }
    const again = runQualifying(league.players, league.season, league.lid, 32)!;
    expect(again.campaign.playoffs).toEqual(result!.campaign.playoffs);
    expect(again.campaign.qualified).toEqual(result!.campaign.qualified);
  });
});
