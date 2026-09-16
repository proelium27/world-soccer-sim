import { describe, it, expect } from "vitest";
import { computeWorldAwards, type WorldAwardContext } from "../../src/core/worldAwards.js";
import { emptySeasonStats, type Player, type Position } from "../../src/core/players/types.js";
import type { CupState, CupTie } from "../../src/core/cup/types.js";
import type { BoxScore, PlayerMatchLine } from "../../src/engine/attribution.js";
import { TOTS_SLOTS } from "../../src/core/awards.js";
import { AMERICAS_ACCOMPLISHMENT_SCALE } from "../../src/core/constants.js";

/*
 * The Americas in the worldwide awards: a case made at a club there is
 * discounted by AMERICAS_ACCOMPLISHMENT_SCALE, the Americas Cup counts where the
 * Continental Cup would, and the Americas get their own set of honours judged
 * over their leagues alone.
 */

const SEASON = 5;

/** Club 1-2 play in England (Europe), 11-12 in Brazil (the Americas). */
function ctx(overrides: Partial<WorldAwardContext> = {}): WorldAwardContext {
  return {
    compsByTid: { 1: 0, 2: 0, 11: 1, 12: 1 },
    competitions: [
      { id: 0, country: "England", tier: 1, name: "English Division 1" },
      { id: 1, country: "Brazil", tier: 1, name: "Brazilian Division 1" },
    ],
    championTidByCompId: {},
    cup: null,
    worldCupChampion: null,
    ...overrides,
  };
}

function player(spec: {
  pid: number; tid: number; ovr: number; pos?: Position; goals?: number; avgRating?: number;
}): Player {
  const stats = {
    ...emptySeasonStats(SEASON, spec.tid),
    appearances: 30,
    goals: spec.goals ?? 0,
    avgRating: spec.avgRating ?? 6.5,
    minutesPlayed: 30 * 90,
  };
  return {
    pid: spec.pid,
    name: `Player ${spec.pid}`,
    nationality: "Brazil",
    born: SEASON - 26,
    pos: spec.pos ?? "ST",
    ovr: spec.ovr,
    stats: [stats],
    hist: [{ season: SEASON - 1, ovr: spec.ovr, potential: spec.ovr, academy: false, ratings: {} }],
  } as unknown as Player;
}

function squad(startPid: number, tid: number, ovr: number): Player[] {
  return TOTS_SLOTS.map((pos, i) => player({ pid: startPid + i, tid, ovr, pos, avgRating: 6.4 }));
}

function matchLine(pid: number, goals: number): PlayerMatchLine {
  return {
    pid, goals, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, goalsAgainst: 0, xga: 0,
    saves: 0, tackles: 0, interceptions: 0, passes: 0, passesCompleted: 0, crosses: 0,
    foulsCommitted: 0, yellowCards: 0, redCards: 0, minutesPlayed: 90, rating: 7.5,
  } as PlayerMatchLine;
}

/** A small cup `winnerTid` wins against `loserTid`, with one scorer on each side. */
function cup(winnerTid: number, winnerPid: number, loserTid: number, loserPid: number): CupState {
  const box = { home: [matchLine(winnerPid, 1)], away: [matchLine(loserPid, 0)], events: [] } as unknown as BoxScore;
  const finalTie: CupTie = {
    round: 2, matchday: 37, home: winnerTid, away: loserTid,
    homeGoals: 1, awayGoals: 0, wentToExtraTime: false, wentToPens: false,
    homePens: 0, awayPens: 0, winner: winnerTid, boxScore: box,
  };
  return {
    competition: "americas",
    season: SEASON,
    name: "Americas Cup",
    teams: [winnerTid, loserTid],
    seeds: {},
    statLines: null,
    leaguePhase: {
      teams: [winnerTid, loserTid],
      matches: Array.from({ length: 6 }, (_, round) => ({
        round, matchday: 3 + round * 4, home: winnerTid, away: loserTid,
        played: true, homeGoals: 1, awayGoals: 0, boxScore: box,
      })),
    },
    playoff: null,
    playIn: null,
    ties: [finalTie],
    championTid: winnerTid,
    twoLegged: false,
    koLegs: null,
  };
}

/** A fine European season and a far better one in Brazil. */
function worldWithAStarInBrazil(): Player[] {
  return [
    player({ pid: 1, tid: 1, ovr: 80, goals: 18, avgRating: 7.1 }),
    player({ pid: 2, tid: 11, ovr: 90, goals: 40, avgRating: 8.2 }),
    ...squad(100, 2, 72),
    ...squad(200, 12, 72),
  ];
}

describe("the world's awards discount a case made in the Americas", () => {
  it("keeps a far better season in Brazil below a European one", () => {
    const { ballonDOr } = computeWorldAwards(worldWithAStarInBrazil(), SEASON, ctx());
    expect(ballonDOr[0].pid).toBe(1);
  });

  it("is the discount doing it, not the league-strength correction", () => {
    const { ballonDOr } = computeWorldAwards(worldWithAStarInBrazil(), SEASON, ctx({ americasScale: 1 }));
    expect(ballonDOr[0].pid).toBe(2);
  });

  it("scales every part of his case, so the parts still add up to the score", () => {
    // No supporting casts, so both stars are on the shortlist to be compared —
    // with them, the discount drops the Brazilian out of the top ten entirely.
    const players = worldWithAStarInBrazil().slice(0, 2);
    const discounted = computeWorldAwards(players, SEASON, ctx()).ballonDOr.find((e) => e.pid === 2)!;
    const full = computeWorldAwards(players, SEASON, ctx({ americasScale: 1 })).ballonDOr.find((e) => e.pid === 2)!;
    expect(discounted.score).toBeCloseTo(full.score * AMERICAS_ACCOMPLISHMENT_SCALE, 9);
    expect(discounted.league).toBeCloseTo(full.league * AMERICAS_ACCOMPLISHMENT_SCALE, 9);
    const parts = discounted.league + discounted.cup + discounted.intl + discounted.title + (discounted.domesticCup ?? 0);
    expect(parts).toBeCloseTo(discounted.score, 9);
  });

  it("keeps him out of the World Team of the Year when a European is there to take the slot", () => {
    const { worldTeamOfYear } = computeWorldAwards(worldWithAStarInBrazil(), SEASON, ctx());
    expect(worldTeamOfYear).not.toContain(2);
    expect(worldTeamOfYear).toContain(1);
  });

  it("leaves a world with no league in the Americas exactly as it was", () => {
    const europe = ctx({
      compsByTid: { 1: 0, 2: 0, 11: 1, 12: 1 },
      competitions: [
        { id: 0, country: "England", tier: 1, name: "English Division 1" },
        { id: 1, country: "France", tier: 1, name: "French Division 1" },
      ],
    });
    const players = worldWithAStarInBrazil();
    const plain = computeWorldAwards(players, SEASON, europe);
    expect(plain.americas).toBeUndefined();
    expect(computeWorldAwards(players, SEASON, { ...europe, americasScale: 0.5 })).toEqual(plain);
  });
});

describe("the Americas' own awards", () => {
  it("go to the best of the Americas, judged without the discount", () => {
    const awards = computeWorldAwards(worldWithAStarInBrazil(), SEASON, ctx());
    expect(awards.americas).toBeDefined();
    expect(awards.americas!.ballonDOr[0].pid).toBe(2);
    // Nobody from Europe is eligible for them.
    expect(awards.americas!.ballonDOr.some((e) => e.pid === 1)).toBe(false);
    expect(awards.americas!.worldTeamOfYear).not.toContain(1);
    // The same season that won the Americas' award is nowhere on the world's
    // shortlist, behind European squad players.
    expect(awards.ballonDOr.some((e) => e.pid === 2)).toBe(false);
    // And the discount never reaches the Americas' own set.
    const full = computeWorldAwards(worldWithAStarInBrazil(), SEASON, ctx({ americasScale: 1 }));
    expect(full.americas).toEqual(awards.americas);
  });

  it("credit the Americas Cup where the Continental Cup would be", () => {
    // Two identical Brazilian seasons; the one whose club won the Americas Cup wins.
    const players = [
      player({ pid: 2, tid: 11, ovr: 84, goals: 20, avgRating: 7.3 }),
      player({ pid: 3, tid: 12, ovr: 84, goals: 20, avgRating: 7.3 }),
      player({ pid: 1, tid: 1, ovr: 80, goals: 18, avgRating: 7.1 }),
      ...squad(100, 2, 72),
      ...squad(200, 12, 72),
      ...squad(300, 11, 72),
    ];
    const awards = computeWorldAwards(players, SEASON, ctx({ americasCup: cup(11, 2, 12, 3) }));
    const winner = awards.americas!.ballonDOr[0];
    expect(winner.pid).toBe(2);
    expect(winner.cup).toBeGreaterThan(0);
    // The world's awards see the same cup, at the discount.
    const inWorld = awards.ballonDOr.find((e) => e.pid === 2);
    if (inWorld) expect(inWorld.cup).toBeCloseTo(winner.cup * AMERICAS_ACCOMPLISHMENT_SCALE, 9);
  });
});
