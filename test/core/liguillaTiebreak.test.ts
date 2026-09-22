import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { leagueMatchData } from "../../src/core/league/composites.js";
import { playFirstLeg, resolveTwoLeggedTie } from "../../src/core/cup/simCup.js";
import { mulberry32 } from "../../src/engine/rng.js";

/**
 * The Liguilla's tiebreaker: in the quarter-finals and semi-finals a tie level
 * on aggregate goes to the better-placed club, with no extra time and no
 * penalties. Only the final goes to extra time and penalties.
 *
 * Tested on real match data from Mexico's top flight. A level aggregate can't be
 * forced, so the test searches seeds for one — a two-legged tie between two
 * clubs of one division ends level often enough that the search is short.
 */
describe("the Liguilla tiebreaker", () => {
  const league = makeLeague(0, 1);
  const mexico = league.competitions.find((c) => c.country === "Mexico" && c.tier === 1)!;
  const clubs = league.teams.filter((t) => t.compId === mexico.id);
  const data = leagueMatchData({
    teams: clubs.map((t) => ({
      tid: t.tid, name: t.name, roster: t.roster, avgOvr: 0, academyBase: t.academyBase,
      compId: t.compId, starters: t.starters, formation: t.formation, moreMinutes: t.moreMinutes,
    })),
    players: league.players,
  });
  const [low, high] = [clubs[1].tid, clubs[0].tid];
  const [ld, hd] = [data[1], data[0]];

  const play = (seed: number, levelGoesTo?: number) => {
    const rng = mulberry32(seed);
    const leg1 = playFirstLeg(rng, low, high, ld, hd, 0);
    return resolveTwoLeggedTie(rng, leg1, ld, hd, 0, { levelGoesTo });
  };

  const levelSeed = Array.from({ length: 400 }, (_, s) => s).find((s) => play(s).wentToExtraTime);
  const decidedSeed = Array.from({ length: 400 }, (_, s) => s).find((s) => !play(s).wentToExtraTime);

  it("sends a level aggregate to the better-placed club, with no extra time or penalties", () => {
    expect(levelSeed).toBeDefined();
    const tie = play(levelSeed!, high);
    expect(tie.homeGoals).toBe(tie.awayGoals);
    expect(tie.winner).toBe(high);
    expect(tie.wentToExtraTime).toBe(false);
    expect(tie.wentToPens).toBe(false);
    expect(tie.decidedByTablePosition).toBe(true);
  });

  it("plays extra time on the same tie when no club is named, which is what the final does", () => {
    const tie = play(levelSeed!);
    expect(tie.wentToExtraTime).toBe(true);
    expect(tie.decidedByTablePosition).toBeUndefined();
  });

  it("changes nothing about a tie that wasn't level", () => {
    expect(decidedSeed).toBeDefined();
    const plain = play(decidedSeed!);
    const withRule = play(decidedSeed!, high);
    expect(withRule).toEqual(plain);
  });
});
