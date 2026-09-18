import { describe, it, expect } from "vitest";
import { playerGoalTotals, detectMatchdayNewsEvents } from "../../src/core/newsEvents.js";
import type { Player } from "../../src/core/players/types.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import type { PlayerMatchLine } from "../../src/engine/attribution.js";

function line(overrides: Partial<PlayerMatchLine> & { pid: number }): PlayerMatchLine {
  return {
    goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, goalsAgainst: 0,
    xga: 0, saves: 0, tackles: 0, interceptions: 0,
    passes: 0, passesCompleted: 0, crosses: 0, foulsCommitted: 0,
    yellowCards: 0, redCards: 0,
    minutesPlayed: 90, rating: 6.0,
    ...overrides,
  };
}

function match(overrides: Partial<PlayedMatch>): PlayedMatch {
  return {
    home: 0, away: 1, homeGoals: 0, awayGoals: 0, possessionHome: 50, matchday: 1,
    boxScore: { home: [], away: [], events: [] },
    ...overrides,
  };
}

function makePlayer(pid: number, statsBySeasonGoals: [season: number, goals: number][]): Player {
  return {
    pid,
    recentStats: statsBySeasonGoals.map(([season, goals]) => ({
      season, goals, appearances: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0,
      goalsAgainst: 0, xga: 0, saves: 0, tackles: 0, interceptions: 0,
      minutesPlayed: 0, ratingSum: 0, avgRating: 0,
    })),
  } as unknown as Player;
}

describe("playerGoalTotals", () => {
  it("sums career goals across all seasons and isolates the current season's goals", () => {
    const players = [makePlayer(1, [[2025, 8], [2026, 4]])];
    const totals = playerGoalTotals(players, 2026);
    expect(totals.get(1)).toEqual({ season: 4, career: 12 });
  });

  it("defaults a player with no stats entry for the season to 0 season goals", () => {
    const players = [makePlayer(1, [[2025, 8]])];
    const totals = playerGoalTotals(players, 2026);
    expect(totals.get(1)).toEqual({ season: 0, career: 8 });
  });
});

describe("detectMatchdayNewsEvents — hat-tricks", () => {
  it("fires for a 3-goal match", () => {
    const md = [match({ boxScore: { home: [line({ pid: 1, goals: 3 })], away: [], events: [] } })];
    const events = detectMatchdayNewsEvents(md, 2026, 5, new Map(), new Map());
    expect(events).toContainEqual({ type: "hattrick", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 3 });
  });

  it("does not fire for a 2-goal match", () => {
    const md = [match({ boxScore: { home: [line({ pid: 1, goals: 2 })], away: [], events: [] } })];
    const events = detectMatchdayNewsEvents(md, 2026, 5, new Map(), new Map());
    expect(events.some((e) => e.type === "hattrick")).toBe(false);
  });
});

describe("detectMatchdayNewsEvents — standout rating", () => {
  it("fires for the single highest rating at or above the floor", () => {
    const md = [match({
      boxScore: {
        home: [line({ pid: 1, rating: 8.0 }), line({ pid: 2, rating: 7.9 })],
        away: [line({ pid: 3, rating: 9.4 })],
        events: [],
      },
    })];
    const events = detectMatchdayNewsEvents(md, 2026, 5, new Map(), new Map());
    const standouts = events.filter((e) => e.type === "standoutRating");
    expect(standouts).toEqual([{ type: "standoutRating", pid: 3, tid: 1, season: 2026, matchday: 5, detail: 94 }]);
  });

  it("does not fire when the matchday's best rating is below the floor", () => {
    const md = [match({ boxScore: { home: [line({ pid: 1, rating: 7.9 })], away: [], events: [] } })];
    const events = detectMatchdayNewsEvents(md, 2026, 5, new Map(), new Map());
    expect(events.some((e) => e.type === "standoutRating")).toBe(false);
  });
});

describe("detectMatchdayNewsEvents — goal milestones", () => {
  /** One scoring player, with the goal totals he carried into and out of the match. */
  function milestones(
    before: { season: number; career: number },
    after: { season: number; career: number },
  ) {
    const md = [match({ boxScore: { home: [line({ pid: 1, goals: 1 })], away: [], events: [] } })];
    return detectMatchdayNewsEvents(
      md, 2026, 5, new Map([[1, before]]), new Map([[1, after]]),
    ).filter((e) => e.type.startsWith("goalMilestone"));
  }

  it("fires a career milestone on an exact crossing of the first rung", () => {
    expect(milestones({ season: 3, career: 49 }, { season: 4, career: 50 })).toEqual([
      { type: "goalMilestoneCareer", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 50 },
    ]);
  });

  it("reports the rung reached when a haul jumps past it without landing on it", () => {
    const md = [match({ boxScore: { home: [line({ pid: 1, goals: 3 })], away: [], events: [] } })];
    const events = detectMatchdayNewsEvents(
      md, 2026, 5, new Map([[1, { season: 3, career: 48 }]]), new Map([[1, { season: 6, career: 51 }]]),
    );
    expect(events).toContainEqual(
      { type: "goalMilestoneCareer", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 50 },
    );
  });

  it("stays silent below the first rung — the every-10 ladder is gone", () => {
    // These are exactly the crossings that used to bury the feed: measured on a
    // 16-competition world, a flat step of 10 fired 1,661 career milestones a
    // season by season 4, most of them journeymen passing 60.
    expect(milestones({ season: 3, career: 8 }, { season: 4, career: 10 })).toEqual([]);
    expect(milestones({ season: 8, career: 18 }, { season: 9, career: 20 })).toEqual([]);
    expect(milestones({ season: 19, career: 39 }, { season: 20, career: 40 })).toEqual([]);
  });

  it("climbs the career ladder in 50s", () => {
    expect(milestones({ season: 4, career: 99 }, { season: 5, career: 100 })[0]?.detail).toBe(100);
    expect(milestones({ season: 4, career: 149 }, { season: 5, career: 150 })[0]?.detail).toBe(150);
  });

  it("starts the season ladder at 25 and climbs it in 5s", () => {
    expect(milestones({ season: 24, career: 200 }, { season: 25, career: 201 })).toEqual([
      { type: "goalMilestoneSeason", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 25 },
    ]);
    expect(milestones({ season: 29, career: 205 }, { season: 30, career: 206 })[0]?.detail).toBe(30);
  });

  it("does not fire when no rung is crossed", () => {
    expect(milestones({ season: 26, career: 114 }, { season: 27, career: 115 })).toEqual([]);
  });

  // One goal can carry a player over both ladders at once. Reporting both puts
  // two rows on the same matchday for the same player, each quoting a bare goal
  // count — and in a league's first season the totals are identical, so every
  // career milestone restated a season one (measured: 747 of 747).
  describe("when one goal crosses both ladders", () => {
    it("reports the career milestone alone when the two rank equally", () => {
      expect(milestones({ season: 24, career: 49 }, { season: 25, career: 50 })).toEqual([
        { type: "goalMilestoneCareer", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 50 },
      ]);
    });

    it("prefers the season milestone when only it reaches the world tier", () => {
      // A 35-goal season travels; a 50th career goal does not.
      expect(milestones({ season: 34, career: 49 }, { season: 35, career: 50 })).toEqual([
        { type: "goalMilestoneSeason", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 35 },
      ]);
    });

    it("keeps the career milestone when both reach the world tier", () => {
      expect(milestones({ season: 34, career: 99 }, { season: 35, career: 100 })).toEqual([
        { type: "goalMilestoneCareer", pid: 1, tid: 0, season: 2026, matchday: 5, detail: 100 },
      ]);
    });
  });
});
