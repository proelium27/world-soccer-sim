import { describe, it, expect } from "vitest";
import { isProtectedStar, protectedStarPids, lastCompletedSeason } from "../../../src/core/transfers/protectedStars.js";
import type { CompletedSeasonInfo } from "../../../src/core/transfers/protectedStars.js";
import type { Competition } from "../../../src/core/competitions.js";
import type { Player, PlayerRatings } from "../../../src/core/players/types.js";
import type { StandingsRow } from "../../../src/core/standings.js";
import type { StoredTeam } from "../../../src/core/teams/clubs.js";
import { PROTECTED_STAR_OVR, PROTECTED_STAR_TOP_FINISH } from "../../../src/core/constants.js";

const COMPS: Competition[] = [
  { id: 0, country: "England", tier: 1, name: "D1" },
  { id: 1, country: "England", tier: 2, name: "D2" },
];

const RATINGS: PlayerRatings = {
  speed: 50, strength: 50, stamina: 50, jumping: 50,
  shortPass: 50, longPass: 50, crosses: 50, dribbling: 50, longShot: 50, finishing: 50,
  tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 50,
};

function player(pid: number, ovr: number): Player {
  return {
    pid, name: `P${pid}`, nationality: "TST", born: 2000, pos: "CM", heightCm: 180,
    ratings: RATINGS, ovr, potential: ovr, contract: { salary: 1000, expiresSeason: 2030 },
    injury: null, recentStats: [], recentHist: [],
  };
}

function row(tid: number, points: number): StandingsRow {
  return { tid, played: 38, won: points / 3, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points };
}

/**
 * Season record: tid 10 is the tier-1 champion, tids 11-13 the rest of the top
 * four, tid 14 finishes fifth, tid 20 tops the tier-2 table. Awards go to a
 * lone honoree (pid 500) on the fifth-placed club.
 */
function seasonInfo(): CompletedSeasonInfo {
  return {
    // Concatenated per-competition blocks, each already sorted best-first
    // (the real seasonHistory shape).
    table: [
      row(10, 90), row(11, 80), row(12, 70), row(13, 60), row(14, 50), // tier-1 comp 0
      row(20, 88), row(21, 70), // tier-2 comp 1
    ],
    compsByTid: { 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 20: 1, 21: 1 },
    awards: {
      0: { playerOfSeasonPid: 500, goldenBootPid: null, teamOfSeason: [] },
    },
  };
}

describe("isProtectedStar", () => {
  const last = seasonInfo();

  it("protects a high-OVR player on a top-four tier-1 club", () => {
    expect(isProtectedStar(last, COMPS, 10, player(1, PROTECTED_STAR_OVR))).toBe(true);
    expect(isProtectedStar(last, COMPS, 13, player(2, PROTECTED_STAR_OVR + 5))).toBe(true);
  });

  it("does NOT protect a high-OVR player on a club that finished fifth", () => {
    expect(isProtectedStar(last, COMPS, 14, player(3, PROTECTED_STAR_OVR + 5))).toBe(false);
  });

  it("does NOT protect a modest player on a top-four club (not world-class)", () => {
    expect(isProtectedStar(last, COMPS, 10, player(4, PROTECTED_STAR_OVR - 1))).toBe(false);
  });

  it("protects a last-season award winner on a top-four club even below the OVR bar", () => {
    // pid 500 won Player of the Season last season; put him on a top-four club.
    expect(isProtectedStar(last, COMPS, 11, player(500, 70))).toBe(true);
  });

  it("does NOT protect an award winner whose club only finished fifth", () => {
    expect(isProtectedStar(last, COMPS, 14, player(500, 70))).toBe(false);
  });

  it("does NOT protect stars in a second division, however they finished", () => {
    // tid 20 won its tier-2 league — still not the kind of success that gates.
    expect(isProtectedStar(last, COMPS, 20, player(5, PROTECTED_STAR_OVR + 10))).toBe(false);
  });

  it("protects nobody before the first season completes", () => {
    expect(isProtectedStar(null, COMPS, 10, player(1, 90))).toBe(false);
  });

  it("does NOT protect a club that didn't exist last season", () => {
    expect(isProtectedStar(last, COMPS, 999, player(1, 90))).toBe(false);
  });

  it("uses exactly the top PROTECTED_STAR_TOP_FINISH places", () => {
    // Row order in seasonInfo puts tids 10,11,12,13 in the top four.
    const topFour = [10, 11, 12, 13].slice(0, PROTECTED_STAR_TOP_FINISH);
    for (const tid of topFour) {
      expect(isProtectedStar(last, COMPS, tid, player(1, PROTECTED_STAR_OVR))).toBe(true);
    }
  });
});

describe("protectedStarPids", () => {
  const last = seasonInfo();

  function team(tid: number, roster: number[]): StoredTeam {
    return { tid, roster } as unknown as StoredTeam;
  }

  it("collects every protected pid across AI clubs but never the user's own", () => {
    const userTid = 10; // champion — but it's the user's club, so its stars aren't gated
    const teams = [
      team(10, [1]),   // user champion: star pid 1 (90 ovr) — excluded (user controls sales)
      team(11, [2, 3]), // top-four AI: pid 2 elite (protected), pid 3 modest (not)
      team(14, [4]),   // fifth AI: pid 4 elite but club had no big season (not protected)
    ];
    const players = [
      player(1, 90), player(2, PROTECTED_STAR_OVR + 2), player(3, 60), player(4, 90),
    ];
    const pids = protectedStarPids(last, teams, players, COMPS, userTid);
    expect([...pids].sort((a, b) => a - b)).toEqual([2]);
  });

  it("is empty before any season completes", () => {
    const pids = protectedStarPids(null, [team(11, [2])], [player(2, 90)], COMPS, 0);
    expect(pids.size).toBe(0);
  });
});

describe("lastCompletedSeason", () => {
  it("returns the most recent seasonHistory entry, or null when empty", () => {
    expect(lastCompletedSeason({ seasonHistory: [] })).toBe(null);
    const a = seasonInfo(), b = seasonInfo();
    // Only table/awards/compsByTid are read; identity is enough to assert order.
    const hist = [a, b] as unknown as Parameters<typeof lastCompletedSeason>[0]["seasonHistory"];
    expect(lastCompletedSeason({ seasonHistory: hist })).toBe(b);
  });
});
