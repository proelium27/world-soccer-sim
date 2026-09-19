import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generateLeague } from "../../src/core/league/generate.js";
import { leagueMatchData } from "../../src/core/league/composites.js";
import { applySuspensions, clearSuspension, isSuspended } from "../../src/core/suspensions.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import type { PlayerMatchLine } from "../../src/engine/attribution.js";
import {
  SUSPENSION_YELLOW_THRESHOLD,
  SUSPENSION_YELLOW_MATCHES,
  SUSPENSION_SECOND_YELLOW_MATCHES,
  SUSPENSION_RED_MATCHES,
} from "../../src/core/constants.js";

function mk(pid: number, over: Partial<Player> = {}): Player {
  return {
    pid,
    name: `P${pid}`,
    nationality: "USA",
    born: 2000,
    pos: "CM",
    heightCm: 180,
    ratings: {
      speed: 50, strength: 50, stamina: 50, jumping: 50,
      shortPass: 50, longPass: 50, crosses: 50,
      dribbling: 50, longShot: 50, finishing: 50,
      tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 5,
    },
    ovr: 50,
    potential: 50,
    contract: { salary: 1000, expiresSeason: 2030 },
    injury: null,
    recentStats: [emptySeasonStats(2026)],
    recentHist: [],
    ...over,
  };
}

function line(pid: number, yellowCards: number, redCards: number): PlayerMatchLine {
  return { ...emptyLine(), pid, yellowCards, redCards };
}

/** A box-score line with every counter at zero; only the cards matter here. */
function emptyLine(): PlayerMatchLine {
  return {
    pid: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0,
    goalsAgainst: 0, xga: 0, saves: 0, tackles: 0, interceptions: 0,
    passes: 0, passesCompleted: 0, crosses: 0, foulsCommitted: 0,
    yellowCards: 0, redCards: 0, minutesPlayed: 90, rating: 6.0,
  };
}

function matchWith(lines: PlayerMatchLine[]): PlayedMatch {
  return {
    home: 0, away: 1, homeGoals: 1, awayGoals: 0, possessionHome: 0.5, matchday: 1,
    boxScore: { home: lines, away: [], events: [] },
  };
}

describe("applySuspensions", () => {
  it("a straight red bans him for the full tariff, starting next matchday", () => {
    const [p] = applySuspensions([mk(1)], [matchWith([line(1, 0, 1)])]);
    expect(p.suspension).toEqual({
      matchesRemaining: SUSPENSION_RED_MATCHES,
      reason: "red card",
    });
  });

  it("a second yellow is a shorter ban than a straight red, and is labelled as such", () => {
    const [p] = applySuspensions([mk(1)], [matchWith([line(1, 2, 1)])]);
    expect(p.suspension).toEqual({
      matchesRemaining: SUSPENSION_SECOND_YELLOW_MATCHES,
      reason: "second yellow",
    });
    expect(SUSPENSION_SECOND_YELLOW_MATCHES).toBeLessThan(SUSPENSION_RED_MATCHES);
  });

  it("a player booked once and then sent off outright reads as a straight red, not a second yellow", () => {
    const [p] = applySuspensions([mk(1)], [matchWith([line(1, 1, 1)])]);
    expect(p.suspension!.reason).toBe("red card");
    expect(p.suspension!.matchesRemaining).toBe(SUSPENSION_RED_MATCHES);
  });

  it("bans on the threshold yellow, and not one booking earlier", () => {
    let players = [mk(1)];
    for (let i = 0; i < SUSPENSION_YELLOW_THRESHOLD - 1; i++) {
      players = applySuspensions(players, [matchWith([line(1, 1, 0)])]);
      expect(isSuspended(players[0])).toBe(false);
    }
    expect(players[0].yellowCount).toBe(SUSPENSION_YELLOW_THRESHOLD - 1);

    players = applySuspensions(players, [matchWith([line(1, 1, 0)])]);
    expect(players[0].suspension).toEqual({
      matchesRemaining: SUSPENSION_YELLOW_MATCHES,
      reason: "yellow cards",
    });
    expect(players[0].yellowCount).toBe(0);
  });

  it("carries a surplus booking past the threshold toward the next ban rather than dropping it", () => {
    // Arrives at the threshold already carrying one, i.e. two bookings land in
    // the same match as the fifth. The extra must survive the reset.
    const primed = mk(1, { yellowCount: SUSPENSION_YELLOW_THRESHOLD - 1 });
    const [p] = applySuspensions([primed], [matchWith([line(1, 2, 0)])]);
    expect(p.yellowCount).toBe(1);
    expect(p.suspension!.reason).toBe("yellow cards");
  });

  it("takes the longer ban rather than the sum when a sending-off and the fifth yellow land together", () => {
    const primed = mk(1, { yellowCount: SUSPENSION_YELLOW_THRESHOLD - 1 });
    const [p] = applySuspensions([primed], [matchWith([line(1, 1, 1)])]);
    expect(p.suspension!.matchesRemaining).toBe(SUSPENSION_RED_MATCHES);
    expect(p.suspension!.reason).toBe("red card");
  });

  it("ticks a running ban down one match per matchday and clears it at zero", () => {
    let players = [mk(1, { suspension: { matchesRemaining: 2, reason: "red card" } })];
    players = applySuspensions(players, [matchWith([])]);
    expect(players[0].suspension!.matchesRemaining).toBe(1);
    players = applySuspensions(players, [matchWith([])]);
    expect(players[0].suspension).toBeNull();
    expect(isSuspended(players[0])).toBe(false);
  });

  it("does not serve part of the ban on the matchday it was earned", () => {
    // The sending-off happens *in* this match, so this match cannot count
    // toward it — the full tariff must survive the same call's tick.
    const [p] = applySuspensions([mk(1)], [matchWith([line(1, 0, 1)])]);
    expect(p.suspension!.matchesRemaining).toBe(SUSPENSION_RED_MATCHES);
  });

  it("leaves uncarded, unbanned players untouched by reference", () => {
    const quiet = mk(7);
    const [p] = applySuspensions([quiet], [matchWith([line(1, 0, 1)])]);
    // Reference identity is what the db layer's dirty-player diff keys off
    // (see test/db/playerIdentity.test.ts) — an untouched player must stay ===.
    expect(p).toBe(quiet);
  });

  it("sums a player's cards across every match in the matchday", () => {
    // Defensive: one pid can only appear in one league match per matchday, but
    // the fold must not silently keep just the last line if that ever changes.
    const [p] = applySuspensions(
      [mk(1, { yellowCount: SUSPENSION_YELLOW_THRESHOLD - 2 })],
      [matchWith([line(1, 1, 0)]), matchWith([line(1, 1, 0)])],
    );
    expect(p.suspension!.reason).toBe("yellow cards");
  });
});

describe("suspended players are unavailable for selection", () => {
  it("a banned player is excluded from the XI and the bench, and returns once the ban lapses", () => {
    const league = generateLeague(mulberry32(11));

    const available = leagueMatchData(league, { unavailable: isSuspended });
    const starterPid = available[0].xi[0].pid;
    const starter = league.players.find((p) => p.pid === starterPid)!;
    starter.suspension = { matchesRemaining: 2, reason: "red card" };

    const banned = leagueMatchData(league, { unavailable: isSuspended });
    const selected = [...banned[0].xi, ...banned[0].bench].map((p) => p.pid);
    expect(selected).not.toContain(starterPid);

    starter.suspension = null;
    const back = leagueMatchData(league, { unavailable: isSuspended });
    expect(back[0].xi.map((p) => p.pid)).toContain(starterPid);
  });

  it("a league ban does NOT sideline him for callers that don't opt in — the cup and internationals", () => {
    const league = generateLeague(mulberry32(11));
    const starterPid = leagueMatchData(league)[0].xi[0].pid;
    const starter = league.players.find((p) => p.pid === starterPid)!;
    starter.suspension = { matchesRemaining: 3, reason: "red card" };

    // No `unavailable` predicate — this is exactly how cupMatchData and
    // nationMatchData call it, and the ban must not leak into those matches.
    const cupLike = leagueMatchData(league);
    expect(cupLike[0].xi.map((p) => p.pid)).toContain(starterPid);
  });
});

describe("clearSuspension", () => {
  it("wipes the ban and the yellow tally at the offseason", () => {
    const p = clearSuspension(
      mk(1, { yellowCount: 3, suspension: { matchesRemaining: 2, reason: "red card" } }),
    );
    expect(p.suspension).toBeNull();
    expect(p.yellowCount).toBe(0);
  });

  it("is a no-op by reference for a player with a clean record", () => {
    const clean = mk(1);
    expect(clearSuspension(clean)).toBe(clean);
  });
});
