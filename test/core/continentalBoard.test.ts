import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  cupStages, judgeContinentalRun, expectedContinentalPlace, judgeQualification, boardContinentalGoals,
} from "../../src/core/manager/continentalExpectation.js";
import { judgeSeason } from "../../src/core/manager/confidence.js";
import { reviewSeason } from "../../src/core/manager/index.js";
import { emptyManagerState } from "../../src/core/manager/types.js";
import {
  CUP_STRONG_LEAGUE_SLOTS, SHIELD_STRONG_LEAGUE_SLOTS, AMERICAS_CUP_LEAGUE_SLOTS,
  MANAGER_CONTINENTAL_PLACE_CONFIDENCE,
} from "../../src/core/constants.js";
import type { CupState, CupTie } from "../../src/core/cup/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { PlayedMatch } from "../../src/core/standings.js";

function tie(round: number, home: number, away: number, winner: number): CupTie {
  return {
    round, matchday: 0, home, away, homeGoals: winner === home ? 1 : 0, awayGoals: winner === away ? 1 : 0,
    wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0, winner, boxScore: null,
  };
}

/**
 * A finished 32-club Swiss cup (tids 100..131, seeded in order): 4 straight to
 * the quarter-finals, 8 in the playoff, 20 out in the league phase. The seeds
 * win every tie except those `upsets` hands to the other side.
 */
function finishedCup(upsets: Set<number> = new Set()): CupState {
  const field = Array.from({ length: 32 }, (_, i) => 100 + i);
  const seeds: Record<number, number> = {};
  field.forEach((t, i) => (seeds[t] = i + 1));
  const win = (a: number, b: number) => (upsets.has(b) ? b : a);
  const po = [[4, 11], [5, 10], [6, 9], [7, 8]].map(([a, b]) => tie(-1, field[a], field[b], win(field[a], field[b])));
  const qfTeams = [field[0], po[3].winner, field[3], po[0].winner, field[1], po[2].winner, field[2], po[1].winner];
  const qf = [0, 2, 4, 6].map((i) => tie(0, qfTeams[i], qfTeams[i + 1], win(qfTeams[i], qfTeams[i + 1])));
  const sf = [tie(1, qf[0].winner, qf[1].winner, win(qf[0].winner, qf[1].winner)),
    tie(1, qf[2].winner, qf[3].winner, win(qf[2].winner, qf[3].winner))];
  const final = tie(2, sf[0].winner, sf[1].winner, win(sf[0].winner, sf[1].winner));
  return {
    competition: "continental", season: 1, name: "Continental Cup",
    teams: qfTeams, seeds, leaguePhase: { teams: field, matches: [] },
    playoff: { teams: field.slice(4, 12), slots: [], ties: po },
    playIn: null, ties: [...qf, ...sf, final], championTid: final.winner,
    twoLegged: true, koLegs: null, statLines: null,
  } as unknown as CupState;
}

describe("continental stages", () => {
  it("covers every seat in the field exactly once", () => {
    const stages = cupStages(finishedCup())!;
    const seats = stages.flatMap((s) => Array.from({ length: s.placeLo - s.placeHi + 1 }, (_, i) => s.placeHi + i));
    expect(seats).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(stages.map((s) => s.kind)).toEqual(["champion", "knockout", "knockout", "knockout", "playoff", "opening"]);
  });

  it("holds each seed to its stage and reads the exit", () => {
    const cup = finishedCup();
    const top = judgeContinentalRun([cup], 100)!;
    expect(top.goal).toBe("win it");
    expect(top.result).toBe("won it");
    expect(top.expectedPlace).toBe(top.actualPlace);
    expect(judgeContinentalRun([cup], 101)!.goal).toBe("reach the final");
    expect(judgeContinentalRun([cup], 106)!.goal).toBe("reach the quarter-finals");
    expect(judgeContinentalRun([cup], 110)!.goal).toBe("get out of the league phase");
    const minnow = judgeContinentalRun([cup], 130)!;
    expect(minnow.goal).toBeNull();
    expect(minnow.result).toBe("went out in the league phase");
    expect(judgeContinentalRun([cup], 999)).toBeNull();
  });

  it("scores an upset for the underdog and against the favourite", () => {
    // Seed 8 knocks the top seed out in the quarter-finals.
    const cup = finishedCup(new Set([107]));
    const fav = judgeContinentalRun([cup], 100)!;
    expect(fav.result).toBe("went out in the quarter-finals");
    expect(fav.actualPlace).toBeGreaterThan(fav.expectedPlace);
    const dog = judgeContinentalRun([cup], 107)!;
    expect(dog.actualPlace).toBeLessThan(dog.expectedPlace);
    const facts = (run: typeof fav) => ({
      finish: 5, expectedRank: 5, clubs: 20, demand: 0.5, titles: 0, trophies: 0,
      promoted: false, relegated: false, continentalRun: run,
    });
    expect(judgeSeason(facts(fav), 50, 3, true, 1).delta).toBeLessThan(0);
    expect(judgeSeason(facts(dog), 50, 3, true, 1).delta).toBeGreaterThan(0);
  });

  it("skips a competition with no champion yet", () => {
    expect(judgeContinentalRun([{ ...finishedCup(), championTid: null }], 100)).toBeNull();
  });
});

describe("continental qualification", () => {
  const league = makeLeague(0, 11);
  const england = league.competitions.find((c) => c.country === "England" && c.tier === 1)!;
  const england2 = league.competitions.find((c) => c.country === "England" && c.tier === 2)!;
  const brazil = league.competitions.find((c) => c.country === "Brazil" && c.tier === 1)!;

  it("expects the places a league's table hands out", () => {
    expect(expectedContinentalPlace(england, 1)).toBe("continental");
    expect(expectedContinentalPlace(england, CUP_STRONG_LEAGUE_SLOTS)).toBe("continental");
    expect(expectedContinentalPlace(england, CUP_STRONG_LEAGUE_SLOTS + 1)).toBe("shield");
    expect(expectedContinentalPlace(england, CUP_STRONG_LEAGUE_SLOTS + SHIELD_STRONG_LEAGUE_SLOTS + 1)).toBeNull();
    expect(expectedContinentalPlace(england2, 1)).toBeNull();
    expect(expectedContinentalPlace(brazil, AMERICAS_CUP_LEAGUE_SLOTS)).toBe("americas");
    expect(expectedContinentalPlace(brazil, AMERICAS_CUP_LEAGUE_SLOTS + 1)).toBeNull();
  });

  it("charges per rung missed and credits a place nobody expected", () => {
    const facts = { finish: 10, expectedRank: 10, clubs: 20, demand: 0.5, titles: 0, trophies: 0, promoted: false, relegated: false };
    const plain = judgeSeason(facts, 50, 3, true, 1).delta;
    const missed = judgeSeason({ ...facts, qualification: { expected: "continental", earned: null, rungs: -2 } }, 50, 3, true, 1).delta;
    const surprise = judgeSeason({ ...facts, qualification: { expected: null, earned: "shield", rungs: 1 } }, 50, 3, true, 1).delta;
    expect(missed).toBeCloseTo(plain - 2 * MANAGER_CONTINENTAL_PLACE_CONFIDENCE);
    expect(surprise).toBeCloseTo(plain + MANAGER_CONTINENTAL_PLACE_CONFIDENCE);
  });

  function tablesWithOrder(compId: number) {
    const clubs = league.teams.filter((t) => t.compId === compId).map((t) => t.tid);
    const played: PlayedMatch[] = [];
    for (let i = 0; i < clubs.length; i++) {
      for (let j = i + 1; j < clubs.length; j++) {
        played.push({ home: clubs[i], away: clubs[j], homeGoals: 1, awayGoals: 0 } as PlayedMatch);
      }
    }
    return { clubs, played };
  }

  it("reads the place a finish actually earned, and the board uses it", () => {
    const { clubs, played } = tablesWithOrder(england.id);
    const cups = { cup: null, shield: null, domesticCups: [] };
    const withEngland = reviewSeason({
      league: {
        ...league,
        meta: { ...league.meta, userTid: clubs[0] },
        manager: (() => {
          const m = emptyManagerState(clubs[0], 1);
          return { ...m, confidence: 50, stints: [{ ...m.stints[0], seasons: 3 }] };
        })(),
      } as LeagueStore,
      teams: league.teams, players: league.players, played, ...cups,
    }).verdict!;
    expect(withEngland.qualification?.earned).toBe("continental");
    // The last-placed club earns nothing.
    const bottom = judgeQualification(
      league.competitions,
      new Map([[england.id, clubs.map((tid, i) => ({ tid, points: 100 - i, played: 1 }) as never)]]),
      cups, england, clubs[clubs.length - 1], 1,
    );
    expect(bottom).toEqual({ expected: "continental", earned: null, rungs: -2 });
  });

  it("describes the goals for the UI", () => {
    const goals = boardContinentalGoals(england, 1, [finishedCup()], 101);
    expect(goals.qualify).toBe("Continental Cup");
    expect(goals.run).toEqual({ name: "Continental Cup", goal: "reach the final", seed: 2 });
    expect(boardContinentalGoals(england2, 1, [], 1)).toEqual({ qualify: null, run: null });
  });
});
