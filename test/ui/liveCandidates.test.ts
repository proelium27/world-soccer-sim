import { describe, expect, it } from "vitest";
import type { MatchEvent } from "../../src/engine/attribution.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import type { CupState } from "../../src/core/cup/types.js";
import { liveCandidates } from "../../src/ui/live/liveCandidates.js";

/**
 * A cup matchday is an ordinary league matchday too — the schedule has no cup
 * awareness — so a qualified club plays twice on matchdays 3, 7, 11 and so on.
 *
 * These pin the awkward half of that: the cup stores the user's match in four
 * different shapes depending on the round, and a second leg has to be split
 * back out of a merged two-leg event stream.
 */

const USER = 1;
const MD = 3;

function at(minute: number, type: MatchEvent["type"], side: MatchEvent["side"] = "home"): MatchEvent {
  return { clock: 5400 - (minute - 1) * 60 - 1, type, side, pids: [1] };
}

function box(events: MatchEvent[]) {
  return { home: [], away: [], events };
}

function playedMatch(home: number, away: number, events: MatchEvent[]): PlayedMatch {
  return {
    home,
    away,
    homeGoals: 0,
    awayGoals: 0,
    possessionHome: 0.5,
    matchday: MD,
    boxScore: box(events),
  } as unknown as PlayedMatch;
}

/** A league with four clubs in one competition, the user being tid 1. */
function league(cup: CupState | null = null): LeagueStore {
  return {
    meta: { userTid: USER },
    teams: [1, 2, 3, 4].map((tid) => ({ tid, compId: 0, name: `Club ${tid}`, abbrev: `C${tid}` })),
    competitions: [{ id: 0, country: "England", tier: 1, name: "Premier Division" }],
    played: [],
    cup,
  } as unknown as LeagueStore;
}

/** A finished cup tie with the bookkeeping fields the type requires. */
function tie(over: Record<string, unknown>) {
  return {
    round: 0,
    matchday: MD,
    home: USER,
    away: 3,
    homeGoals: 0,
    awayGoals: 0,
    wentToExtraTime: false,
    wentToPens: false,
    homePens: 0,
    awayPens: 0,
    winner: USER,
    ...over,
  } as never;
}

const nameOf = (tid: number) => `Club ${tid}`;

function cupState(over: Partial<CupState>): CupState {
  return {
    season: 2,
    name: "Continental Cup",
    // Eight bracket slots because these cases assert quarter-final names, and
    // the bracket's LENGTH is now what says how deep it is (koRoundsOf reads it,
    // since a cup's bracket is sized from its field — see cupKnockoutPlan). A
    // four-slot bracket is a semi-final-and-final cup, so it would read round 0
    // as "Semi-finals" and round 2 as nothing sensible at all. Same class of
    // fixture trap as the leaguePhase note below.
    teams: [1, 2, 3, 4, 5, 6, 7, 8],
    seeds: { 1: 1, 2: 2, 3: 3, 4: 4 },
    // A real Swiss cup keeps its league phase for the whole season — nothing
    // clears it once the knockouts start, and `isSwissCup` is exactly this
    // field being present. Leaving it null here would quietly make every
    // knockout round read with the legacy cup's names (Round of 16 rather than
    // Quarter-finals), which is a property of the fixture, not the code.
    leaguePhase: { teams: [1, 2, 3, 4], matches: [] },
    playoff: null,
    playIn: null,
    koLegs: null,
    ties: [],
    twoLegged: true,
    ...over,
  } as unknown as CupState;
}

describe("liveCandidates — league only", () => {
  it("offers just the league fixture when there is no cup", () => {
    const results = [playedMatch(USER, 2, [at(10, "goal")]), playedMatch(3, 4, [])];
    const got = liveCandidates(league(), league(), results, nameOf);
    expect(got).toHaveLength(1);
    expect(got[0].key).toBe("league");
    expect(got[0].view.match.home).toBe(USER);
    // The rail carries the division's other match, not this one.
    expect(got[0].view.otherMatches).toHaveLength(1);
    expect(got[0].view.tableAtMinute).not.toBeNull();
  });

  it("offers nothing at all when the user's club did not play", () => {
    const results = [playedMatch(2, 3, []), playedMatch(4, 2, [])];
    expect(liveCandidates(league(), league(), results, nameOf)).toHaveLength(0);
  });
});

describe("liveCandidates — the cup", () => {
  const leagueResults = [playedMatch(USER, 2, [])];

  it("finds a league-phase match, and puts the cup first", () => {
    const cup = cupState({
      leaguePhase: {
        teams: [1, 2, 3, 4],
        matches: [
          { round: 1, matchday: MD, home: USER, away: 3, played: true, homeGoals: 1, awayGoals: 0, boxScore: box([at(30, "goal")]) },
          { round: 1, matchday: MD, home: 2, away: 4, played: true, homeGoals: 0, awayGoals: 0, boxScore: box([]) },
        ],
      },
    });
    const got = liveCandidates(league(), league(cup), leagueResults, nameOf);
    expect(got.map((c) => c.key)).toEqual(["cup", "league"]);
    expect(got[0].view.subtitle).toBe("League phase, round 2");
    expect(got[0].view.otherMatches).toHaveLength(1);
    // The Swiss table stands in for the league table on these matchdays.
    expect(got[0].view.tableAtMinute).not.toBeNull();
  });

  it("finds a playoff tie, and shows no table for it", () => {
    const cup = cupState({
      playoff: {
        teams: [1, 3],
        slots: [0],
        matchday: MD,
        ties: [tie({ round: -1, boxScore: box([at(20, "goal")]) })],
      },
    });
    const got = liveCandidates(league(), league(cup), leagueResults, nameOf);
    expect(got[0].key).toBe("cup");
    expect(got[0].view.subtitle).toBe("Playoff round");
    expect(got[0].view.tableAtMinute).toBeNull();
  });

  it("finds a knockout first leg while it is still held pending the second", () => {
    const cup = cupState({
      koLegs: [
        { round: 0, home: USER, away: 3, homeGoals: 1, awayGoals: 1, boxScore: box([at(40, "goal")]) },
        { round: 0, home: 2, away: 4, homeGoals: 0, awayGoals: 0, boxScore: box([]) },
      ],
    });
    const got = liveCandidates(league(), league(cup), leagueResults, nameOf);
    expect(got[0].view.subtitle).toBe("Quarter-finals, first leg");
    expect(got[0].view.match.home).toBe(USER);
    expect(got[0].view.otherMatches).toHaveLength(1);
  });

  it("splits a second leg out of the finished tie, with the clubs swapped", () => {
    // Leg 1 at the user's ground, then leg 2 away — one merged stream.
    const leg1 = [at(10, "goal", "home")];
    const leg2 = [at(5, "goal", "home"), at(70, "goal", "away")];
    const cup = cupState({
      ties: [
        tie({
          homeGoals: 2,
          awayGoals: 1,
          boxScore: box([...leg1, ...leg2]),
          legs: [{ homeGoals: 1, awayGoals: 0 }, { homeGoals: 1, awayGoals: 1 }],
        }),
      ],
    });
    const got = liveCandidates(league(), league(cup), leagueResults, nameOf);
    expect(got[0].view.subtitle).toBe("Quarter-finals, second leg");
    // Leg 2 is played at the other ground, so club 3 hosts.
    expect(got[0].view.match.home).toBe(3);
    expect(got[0].view.match.away).toBe(USER);
    // Only leg 2's events — the merged stream would have carried three.
    expect(got[0].view.match.events).toEqual(leg2);
  });

  it("plays a single-leg final whole, without splitting anything", () => {
    const events = [at(10, "goal", "home"), at(80, "goal", "away")];
    const cup = cupState({
      ties: [tie({ round: 2, homeGoals: 1, awayGoals: 1, boxScore: box(events) })],
    });
    const got = liveCandidates(league(), league(cup), leagueResults, nameOf);
    expect(got[0].view.subtitle).toBe("Final");
    expect(got[0].view.match.home).toBe(USER);
    expect(got[0].view.match.events).toEqual(events);
  });

  it("offers only the league fixture when the user's club is not in the cup", () => {
    const cup = cupState({
      leaguePhase: {
        teams: [2, 3, 4],
        matches: [
          { round: 0, matchday: MD, home: 2, away: 3, played: true, homeGoals: 0, awayGoals: 0, boxScore: box([]) },
        ],
      },
    });
    const got = liveCandidates(league(), league(cup), leagueResults, nameOf);
    expect(got.map((c) => c.key)).toEqual(["league"]);
  });
});

describe("liveCandidates — watching someone else's match", () => {
  it("follows the club it is pointed at, and reads as a neutral", () => {
    const results = [playedMatch(USER, 2, []), playedMatch(3, 4, [at(10, "goal")])];
    const got = liveCandidates(league(), league(), results, nameOf, 3);
    expect(got).toHaveLength(1);
    expect(got[0].view.match.home).toBe(3);
    expect(got[0].choice.detail).toBe("Matchday 3, Club 3 v Club 4");
    // The rail still carries the rest of that division, the user's game included.
    expect(got[0].view.otherMatches.map((m) => m.home)).toEqual([USER]);
  });

  it("finds a Continental Shield match, which lives on its own state", () => {
    const shield = cupState({
      name: "Continental Shield",
      leaguePhase: {
        teams: [1, 2, 3, 4],
        matches: [
          { round: 0, matchday: MD, home: 3, away: 4, played: true, homeGoals: 1, awayGoals: 0, boxScore: box([at(30, "goal")]) },
        ],
      },
    });
    const after = { ...league(), shield } as unknown as LeagueStore;
    const got = liveCandidates(league(), after, [playedMatch(3, 2, [])], nameOf, 3);
    expect(got.map((c) => c.key)).toEqual(["cup", "league"]);
    expect(got[0].view.competitionName).toBe("Continental Shield");
  });
});
