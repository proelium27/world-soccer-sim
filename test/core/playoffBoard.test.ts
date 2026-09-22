import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  playoffStages, expectedPlayoffStage, playoffGoalLabel, playoffResult, playoffResultLabel,
  judgePlayoffSeason, boardPlayoffGoal,
} from "../../src/core/manager/playoffExpectation.js";
import { judgeSeason } from "../../src/core/manager/confidence.js";
import { reviewSeason } from "../../src/core/manager/index.js";
import { emptyManagerState } from "../../src/core/manager/types.js";
import { MANAGER_MISSED_PLAYOFFS_CONFIDENCE } from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { TitlePlayoff } from "../../src/core/titlePlayoff.js";
import type { CupTie } from "../../src/core/cup/types.js";
import type { PlayedMatch } from "../../src/core/standings.js";

function tie(round: number, home: number, away: number, winner: number): CupTie {
  return {
    round, matchday: 0, home, away, homeGoals: winner === home ? 1 : 0, awayGoals: winner === away ? 1 : 0,
    wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0, winner, boxScore: null,
  };
}

/** An eight-club bracket, seeds 1v8 4v5 2v7 3v6, the better seed winning every tie except `upsetBy`'s. */
function bracket(teams: number[], upsetBy: number | null = null): TitlePlayoff {
  const win = (a: number, b: number) => (b === upsetBy ? b : a);
  const qf = [[0, 7], [3, 4], [1, 6], [2, 5]].map(([a, b]) => tie(0, teams[a], teams[b], win(teams[a], teams[b])));
  const sf = [tie(1, qf[0].winner, qf[1].winner, win(qf[0].winner, qf[1].winner)),
    tie(1, qf[2].winner, qf[3].winner, win(qf[2].winner, qf[3].winner))];
  const final = tie(2, sf[0].winner, sf[1].winner, win(sf[0].winner, sf[1].winner));
  return {
    season: 1, country: "Mexico", compId: 0, format: "two-legged", teams,
    ties: [...qf, ...sf, final], winnerTid: final.winner,
  };
}

describe("playoff stages", () => {
  it("splits every format into exits that cover every seat exactly once", () => {
    for (const format of ["single", "two-legged", "zones", "conference", "conference-single"] as const) {
      const stages = playoffStages(format);
      const seats = stages.flatMap((s) => Array.from({ length: s.placeLo - s.placeHi + 1 }, (_, i) => s.placeHi + i));
      expect(seats).toEqual(Array.from({ length: seats.length }, (_, i) => i + 1));
    }
    const mls = playoffStages("conference");
    expect(mls.map((s) => [s.placeHi, s.placeLo])).toEqual([[1, 1], [2, 2], [3, 4], [5, 8], [9, 16], [17, 18]]);
  });

  it("names what a contender is expected to do", () => {
    const goal = (rank: number) => playoffGoalLabel(expectedPlayoffStage("conference", rank)!);
    expect(goal(1)).toBe("win the title");
    expect(goal(2)).toBe("reach the final");
    expect(goal(4)).toBe("reach the conference finals");
    expect(goal(7)).toBe("reach the conference semi-finals");
    expect(goal(12)).toBe("make the playoffs");
    expect(goal(18)).toBe("make the playoffs");
    expect(expectedPlayoffStage("conference", 19)).toBeNull();
    expect(playoffGoalLabel(expectedPlayoffStage("single", 6)!)).toBe("make the playoffs");
    expect(playoffGoalLabel(expectedPlayoffStage("zones", 6)!)).toBe("reach the quarter-finals");
  });

  it("reads a club's exit off a played bracket", () => {
    const teams = [10, 11, 12, 13, 14, 15, 16, 17];
    const p = bracket(teams);
    expect(playoffResultLabel(playoffResult(p, 10))).toBe("won the title");
    expect(playoffResultLabel(playoffResult(p, 11))).toBe("lost the final");
    expect(playoffResultLabel(playoffResult(p, 13))).toBe("went out in the semi-finals");
    expect(playoffResultLabel(playoffResult(p, 17))).toBe("went out in the quarter-finals");
    expect(playoffResultLabel(playoffResult(p, 99))).toBe("missed the playoffs");
  });
});

describe("judging a playoff season", () => {
  const teams = [10, 11, 12, 13, 14, 15, 16, 17];
  const facts = (playoff: ReturnType<typeof judgePlayoffSeason> | undefined, finish: number, expectedRank: number) => ({
    finish, expectedRank, clubs: 18, demand: 0.5, titles: 0, trophies: 0,
    promoted: false, relegated: false, playoff,
  });

  it("holds the favourite to a deep run, not to the table", () => {
    // Top of the table, out in the quarter-finals: a bad season for the favourite.
    const early = judgePlayoffSeason(bracket(teams, 17), 10, 1, 1);
    expect(early.goal).toBe("win the title");
    const out = judgeSeason(facts(early, 1, 1), 50, 3, true, 1);
    expect(out.overperformance).toBeLessThan(0);
    // The same side finishing 3rd in the table and winning it has met the bar.
    const won = judgePlayoffSeason(bracket(teams), 10, 1, 3);
    const champ = judgeSeason(facts(won, 3, 1), 50, 3, true, 1);
    expect(champ.overperformance).toBe(0);
    expect(champ.delta).toBeGreaterThan(out.delta);
  });

  it("charges every club for missing the playoffs, however small", () => {
    // A minnow expected 16th that finishes 11th and misses out: the table term
    // still rewards it, and the flat penalty still applies.
    const missed = judgePlayoffSeason(bracket(teams), 99, 16, 11);
    expect(missed.missed).toBe(true);
    expect(missed.goal).toBeNull();
    const withPenalty = judgeSeason(facts(missed, 11, 16), 50, 3, true, 1);
    const tableOnly = judgeSeason(facts(undefined, 11, 16), 50, 3, true, 1);
    expect(withPenalty.overperformance).toBeGreaterThan(0);
    expect(withPenalty.delta).toBeCloseTo(tableOnly.delta + MANAGER_MISSED_PLAYOFFS_CONFIDENCE);
    // Scraping in and going straight out beats finishing higher and missing out.
    const madeIt = judgePlayoffSeason(bracket(teams), 17, 16, 8);
    expect(judgeSeason(facts(madeIt, 8, 16), 50, 3, true, 1).delta).toBeGreaterThan(withPenalty.delta);
  });

  it("never scores a missed club above the worst exit", () => {
    expect(judgePlayoffSeason(bracket(teams), 99, 5, 3).actualPlace).toBe(8);
  });
});

describe("reviewSeason in a playoff league", () => {
  const base = makeLeague(0, 11);
  const mexico = base.competitions.find((c) => c.country === "Mexico" && c.tier === 1)!;
  const england = base.competitions.find((c) => c.country === "England" && c.tier === 1)!;

  function asManagerOf(compId: number): { league: LeagueStore; clubs: number[] } {
    const clubs = base.teams.filter((t) => t.compId === compId).map((t) => t.tid);
    const user = clubs[0];
    // Every club beats every club after it once, so the table is `clubs` in order.
    const played: PlayedMatch[] = [];
    for (let i = 0; i < clubs.length; i++) {
      for (let j = i + 1; j < clubs.length; j++) {
        played.push({ home: clubs[i], away: clubs[j], homeGoals: 1, awayGoals: 0 } as PlayedMatch);
      }
    }
    const fresh = emptyManagerState(user, 1);
    const manager = { ...fresh, confidence: 50, stints: [{ ...fresh.stints[0], seasons: 3 }] };
    return { league: { ...base, meta: { ...base.meta, userTid: user }, manager, played }, clubs };
  }

  const review = (league: LeagueStore, titlePlayoffs?: TitlePlayoff[]) => reviewSeason({
    league, teams: league.teams, players: league.players, played: league.played,
    cup: null, shield: null, domesticCups: [], titlePlayoffs,
  }).verdict!;

  it("judges a playoff league's club on its run", () => {
    const { league, clubs } = asManagerOf(mexico.id);
    const teams = clubs.slice(0, 8);
    const champion = review(league, [{ ...bracket(teams), compId: mexico.id }]);
    const upset = review(league, [{ ...bracket(teams, teams[7]), compId: mexico.id }]);
    expect(champion.playoff?.result).toBe("won the title");
    expect(champion.titles).toBe(1);
    expect(upset.playoff?.result).toBe("went out in the quarter-finals");
    expect(upset.titles).toBe(0);
    expect(champion.confidence).toBeGreaterThan(upset.confidence);
    // Same table finish in both: only the playoff moved the board.
    expect(champion.finish).toBe(upset.finish);
  });

  it("leaves a table league exactly as it was", () => {
    const { league } = asManagerOf(england.id);
    expect(review(league).playoff).toBeUndefined();
    expect(boardPlayoffGoal(england, 1)).toEqual({ playoffLeague: false, goal: null });
    expect(boardPlayoffGoal(mexico, 1).playoffLeague).toBe(true);
  });
});
