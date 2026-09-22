/**
 * Offseason: budgets, hype, scouting, contract renewals and injury healing.
 *
 * Part of the offseason suite, which is split across several files.
 *
 * Not for tidiness: every test here plays its own full season (~55s), and as a
 * single file that ran to ~32 minutes on CI — long enough that it *was* the
 * build, since a shard can never be faster than its slowest file. Vitest gives
 * each file its own worker, so splitting is what lets these run in parallel.
 * `test/helpers/shardPartition.ts` then keeps the pieces on different shards.
 *
 * Tests are independent (each builds its own seeded rng), so they can move
 * between these files freely — keep a new one with its subject.
 */

import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { computeStandings } from "../../src/core/standings.js";
import { simOffseason } from "../../src/core/offseason.js";
import { playFullSeason } from "../helpers/offseasonLeague.js";
import { worldCompetitions, competitionTeamCount } from "../../src/core/competitions.js";
import {
  HYPE_MAX, HYPE_MIN, SCOUTING_SPEND_DEFAULT,
} from "../../src/core/constants.js";

describe("simOffseason — finance and renewals", () => {
  it("settles every team's budget and hype, and locks in each team's next-season scouting spend", () => {
    const rng = mulberry32(7);
    const league = playFullSeason(rng);
    const budgetsBefore = new Map(league.teams.map((t) => [t.tid, t.budget]));
    const next = simOffseason(league, rng);

    // Divisions have their real sizes now, so this is the sum of the table
    // rather than 12 x (NUM_TEAMS + NUM_TEAMS_D2). Derived so it does not need
    // touching again the next time a country or a size changes; the point of the
    // assertion is that the offseason neither loses nor gains a club.
    expect(next.teams).toHaveLength(
      worldCompetitions().reduce((n, c) => n + competitionTeamCount(c), 0),
    );
    for (const team of next.teams) {
      // Budget moved (performance money in at season end, base in and wages
      // out at the new season's start).
      expect(team.budget).not.toBe(budgetsBefore.get(team.tid));
      expect(team.hype).toBeGreaterThanOrEqual(HYPE_MIN);
      expect(team.hype).toBeLessThanOrEqual(HYPE_MAX);
      // The committed scouting spend for the new season is nextScoutingSpend
      // carried through (clamped to budget), and the two are kept in sync so
      // the offseason slider defaults to the just-locked value.
      expect(team.scoutingSpend).toBeGreaterThanOrEqual(0);
      expect(team.scoutingSpend).toBe(team.nextScoutingSpend);
      // AI teams never touch nextScoutingSpend, so they stay at the default.
      expect(team.scoutingSpend).toBeLessThanOrEqual(SCOUTING_SPEND_DEFAULT);
    }
  });

  it("carries a user-set next-season scouting spend through the offseason into the locked value", () => {
    const rng = mulberry32(7);
    const league = playFullSeason(rng);
    const userTid = league.meta.userTid;
    // Simulate an offseason edit: the user bumps next season's scouting budget.
    const target = SCOUTING_SPEND_DEFAULT / 2;
    league.teams = league.teams.map((t) =>
      t.tid === userTid ? { ...t, nextScoutingSpend: target } : t,
    );
    const next = simOffseason(league, rng);
    const userTeam = next.teams.find((t) => t.tid === userTid)!;
    // The value locks in for the new season (clamped to budget, which is ample
    // here), and scoutingSpend now equals it.
    expect(userTeam.scoutingSpend).toBe(target);
    expect(userTeam.nextScoutingSpend).toBe(target);
  });

  it("produces a spread of budgets across clubs (success payouts aren't flat)", () => {
    const rng = mulberry32(8);
    const league = playFullSeason(rng);
    const next = simOffseason(league, rng);

    const budgets = next.teams.map((t) => t.budget);
    expect(Math.max(...budgets)).toBeGreaterThan(Math.min(...budgets));
  });

  it("proactively renews an AI player's contract before it would otherwise expire", () => {
    const rng = mulberry32(31);
    const league = playFullSeason(rng);
    const userTid = league.meta.userTid;
    // Must be a safely mid-table-or-better Division 1 club: a bottom-3
    // finisher would get relegated this offseason, and enforceDivisionCeilings
    // would then immediately move this test's boosted 90-OVR player off him
    // again (correctly, but that's a different, separately tested mechanism —
    // not what this test is checking).
    const d1Ids = league.teams.filter((t) => t.compId === 0).map((t) => t.tid);
    const d1IdSet = new Set(d1Ids);
    const d1Table = computeStandings(d1Ids, league.played.filter((m) => d1IdSet.has(m.home)));
    const aiTid = d1Table.find((row) => row.tid !== userTid)!.tid;
    const aiTeam = league.teams.find((t) => t.tid === aiTid)!;

    // Force the AI team's best outfield player into his final contract
    // season (would expire at league.season + 1, i.e. the very next
    // offseason, if nothing renews him first) and make him an obvious keep:
    // in his prime, at a position where he's the club's only option.
    //
    // He must be a player this club OWNS, not one it is borrowing: a roster
    // answers "who plays here", never "who belongs here". A loanee is renewed
    // by his parent and then handed back by processLoanReturns, so the roster
    // assertion below would fail on correct behaviour. Which player the sort
    // lands on moves with any rng change, so this cannot be left to luck —
    // it was picking a borrowed player as of 2026-09-22.
    const borrowed = new Set(
      league.activeLoans.filter((l) => l.loaneeTid === aiTid).map((l) => l.pid),
    );
    const best = league.players
      .filter((p) => aiTeam.roster.includes(p.pid) && p.pos !== "GK" && !borrowed.has(p.pid))
      .sort((a, b) => b.ovr - a.ovr)[0];
    const withExpiring = {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === aiTid
          ? { ...t, roster: t.roster.filter((pid) =>
              !(league.players.find((p) => p.pid === pid)?.pos === best.pos && pid !== best.pid)
            ), budget: 300_000_000 }
          : t,
      ),
      players: league.players.map((p) =>
        p.pid === best.pid
          ? { ...p, born: (league.season + 1) - 26, ovr: 90, contract: { ...p.contract, expiresSeason: league.season + 1 } }
          : p,
      ),
    };

    const next = simOffseason(withExpiring, rng);
    const renewed = next.players.find((p) => p.pid === best.pid);
    // He must still be on the roster (not released to free agency) and his
    // contract must run past the season simOffseason just rolled into.
    expect(next.teams.find((t) => t.tid === aiTid)!.roster).toContain(best.pid);
    expect(renewed!.contract.expiresSeason).toBeGreaterThan(next.season);
  });
});

describe("simOffseason injuries", () => {
  it("clears any lingering injury at the season rollover", () => {
    const rng = mulberry32(21);
    const league = playFullSeason(rng);
    // Wound a handful of players as if hurt on the final matchday, with the
    // longest possible recovery still outstanding.
    const wounded = new Set(league.players.slice(0, 5).map((p) => p.pid));
    const withInjuries = {
      ...league,
      // Isolate club-injury healing: clear any international campaign the season
      // drew, so simOffseason doesn't play it and carry fresh tournament
      // injuries in (that carry-over is covered by international.test.ts).
      international: { ...league.international, stage: null, stageInjuries: [] },
      players: league.players.map((p) =>
        wounded.has(p.pid) ? { ...p, injury: { gamesRemaining: 6, type: "knock" } } : p,
      ),
    };

    const next = simOffseason(withInjuries, rng);
    for (const p of next.players) {
      expect(p.injury).toBeNull();
    }
  });
});
