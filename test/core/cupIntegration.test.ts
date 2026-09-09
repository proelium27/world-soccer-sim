import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { type LeagueStore } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { tierOf } from "../../src/core/competitions.js";
import { isCupComplete } from "../../src/core/cup/cup.js";
import { leaguePhaseComplete } from "../../src/core/cup/leaguePhase.js";
import type { CupTie } from "../../src/core/cup/types.js";
import {
  CUP_KO_ROUND_MATCHDAYS, CUP_PLAYOFF_MATCHDAY,
  CUP_LEAGUE_PHASE_SIZE, CUP_KO_SIZE, cupKnockoutPlan,
} from "../../src/core/constants.js";

/** Advance a fresh save to the start of season 2 (regular phase), by which point a cup is seeded. */
function toSeason2(seed: number, userTid = 0): LeagueStore {
  let league = makeLeague(userTid, 1);
  expect(league.cup).toBeNull(); // season 1 never has a cup
  league = simThrough(league, "season", mulberry32(seed + 1));
  expect(league.phase).toBe("offseason");
  league = simOffseason(league, mulberry32(seed + 2));
  expect(league.season).toBe(2);
  return league;
}

function stubTie(round: number, home: number, away: number, winner: number): CupTie {
  return {
    round, matchday: CUP_KO_ROUND_MATCHDAYS[round], home, away,
    homeGoals: winner === home ? 1 : 0, awayGoals: winner === away ? 1 : 0,
    wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0, winner,
    boxScore: { home: [], away: [], events: [] },
  };
}

describe("Continental Cup — season lifecycle", () => {
  it("seeds a Swiss cup at the first offseason and completes it during season 2", () => {
    // Pick a tier-2 club as the user so the sim is never halted by the
    // stop-before-final rule (a tier-2 club can't qualify for the cup).
    const fresh = makeLeague(0, 1);
    const tier2Tid = fresh.teams.find((t) => tierOf(fresh.competitions, t.compId) === 2)!.tid;
    const league2 = toSeason2(5, tier2Tid);

    expect(league2.cup).not.toBeNull();
    expect(league2.cup!.leaguePhase).not.toBeNull();
    expect(league2.cup!.leaguePhase!.teams).toHaveLength(CUP_LEAGUE_PHASE_SIZE);
    expect(league2.cup!.season).toBe(2);
    // The knockout bracket is empty until the league phase resolves.
    expect(league2.cup!.teams).toHaveLength(CUP_KO_SIZE);
    expect(league2.cup!.teams.every((t) => t === -1)).toBe(true);
    expect(league2.cup!.playoff).toBeNull();
    // No qualifier is a tier-2 club.
    for (const tid of league2.cup!.leaguePhase!.teams) {
      expect(tierOf(league2.competitions, league2.teams.find((t) => t.tid === tid)!.compId)).toBe(1);
    }

    const played = simThrough(league2, "season", mulberry32(99));
    expect(played.phase).toBe("offseason");
    expect(isCupComplete(played.cup!)).toBe(true);
    expect(played.cup!.championTid).not.toBeNull();
    // The whole league phase was played, the playoff filled the bracket, and the
    // three knockout rounds are recorded (QF 4 + SF 2 + F 1 = 7; playoff separate).
    expect(leaguePhaseComplete(played.cup!.leaguePhase!)).toBe(true);
    expect(played.cup!.teams.every((t) => t >= 0)).toBe(true);
    expect(played.cup!.playoff!.ties).toHaveLength(cupKnockoutPlan(CUP_LEAGUE_PHASE_SIZE).playoffTeams / 2);
    expect(played.cup!.ties).toHaveLength(4 + 2 + 1);

    // The champion won the final (the single round-2 tie).
    const finalWinners = played.cup!.ties.filter((t) => t.round === 2).map((t) => t.winner);
    expect(finalWinners).toEqual([played.cup!.championTid]);

    // The completed cup is archived at the next offseason and a fresh one seeded.
    const after = simOffseason(played, mulberry32(100));
    expect(after.cupHistory).toHaveLength(1);
    expect(after.cupHistory[0].championTid).toBe(played.cup!.championTid);
    expect(after.cup!.season).toBe(3);
  });

  it("halts a season sim before the final when the user's club is a finalist", () => {
    const league2 = toSeason2(7);
    const userTid = league2.meta.userTid;
    const others = league2.teams.map((t) => t.tid).filter((t) => t !== userTid).slice(0, 7);
    const bracket = [userTid, ...others]; // 8 knockout qualifiers

    // Inject a Swiss cup whose league phase + playoff are already done (empty
    // matches count as complete; a non-empty playoff.ties clears "pending"), and
    // whose QF/SF are played with the user winning his semi-final. Only the set
    // of completed rounds and the SF winners matter for the stop rule.
    league2.cup = {
      competition: "continental",
      season: 2,
      name: "Continental Cup",
      teams: bracket,
      seeds: {},
      leaguePhase: { teams: bracket, matches: [] },
      playoff: { teams: [], slots: [], matchday: CUP_PLAYOFF_MATCHDAY, ties: [stubTie(0, others[5], others[6], others[5])] },
      playIn: null,
      ties: [
        stubTie(0, userTid, others[0], userTid), // QF win
        stubTie(1, userTid, others[1], userTid), // user wins his SF → a finalist
        stubTie(1, others[2], others[3], others[2]),
      ],
      championTid: null,
      twoLegged: true,
      koLegs: null,
    statLines: null,
    };

    let result = simThrough(league2, "season", mulberry32(8));
    // A club can be in several finals at once, and the sim halts before each of
    // them: the domestic final is matchday 36, the continental one 37. Step past
    // every halt that isn't the one under test — those courtesies have their own
    // tests; this one is the continental final's. A batch resumed ON a final's
    // matchday plays it (simThrough's `matchday > currentMatchday`).
    //
    // A LOOP rather than a single `if` on the domestic matchday, because which
    // finals the unmanaged user club reaches is a property of the world and
    // moves whenever the world does. It was one extra halt on this seed until
    // generation gained an age model, at which point the single step stopped
    // being enough and the test failed on `phase` — three matchdays from
    // anything it is actually about.
    const next = (l: LeagueStore) => Math.min(...l.schedule.map((g) => g.matchday));
    for (let i = 0; next(result) !== CUP_KO_ROUND_MATCHDAYS[2]; i++) {
      expect(i, `never reached the continental final (next matchday ${next(result)})`).toBeLessThan(4);
      result = simThrough(result, "season", mulberry32(8));
    }
    // Stopped before the final's matchday: still in regular play, final unplayed.
    expect(result.phase).toBe("regular");
    expect(result.cup!.championTid).toBeNull();
    expect(next(result)).toBe(CUP_KO_ROUND_MATCHDAYS[2]); // the final's matchday, still to be played

    // Resuming from exactly the final's matchday plays it. Bounded loop for the
    // same reason as above: the continental final is matchday 37 and nothing is
    // scheduled after it, but a halt is a property of the world rather than of
    // this fixture, so assert the end state rather than the number of calls.
    let resumed = simThrough(result, "season", mulberry32(9));
    for (let i = 0; (resumed.phase as string) !== "offseason"; i++) {
      expect(i, `season refuses to finish (phase ${resumed.phase})`).toBeLessThan(4);
      resumed = simThrough(resumed, "season", mulberry32(9));
    }
    expect(isCupComplete(resumed.cup!)).toBe(true);
  });
});
