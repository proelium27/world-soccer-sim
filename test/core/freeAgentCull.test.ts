import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  awardedPids,
  careerPeakOvr,
  cullOnLoad,
  cullablePids,
  cullFreeAgentPool,
  freeAgentCount,
} from "../../src/core/players/freeAgentCull.js";
import {
  FREE_AGENT_CULL_MIN_AGE,
  FREE_AGENT_CULL_MAX_PEAK_OVR,
  FREE_AGENT_CULL_MAX_POT,
  FREE_AGENT_CULL_LOAD_THRESHOLD,
} from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { Player } from "../../src/core/players/types.js";
import { createCustomPlayer } from "../../src/core/godMode.js";

/** A free agent (on no roster) with the given age/peak/potential. */
function addFreeAgent(
  league: LeagueStore,
  over: { age: number; ovr: number; potential: number; peakOvr?: number; pid: number },
): Player {
  const p: Player = {
    ...structuredClone(league.players[0]),
    pid: over.pid,
    born: league.season - over.age,
    ovr: over.ovr,
    potential: over.potential,
    recentStats: [],
    recentHist: over.peakOvr === undefined
      ? []
      : [{
          season: league.season - 1,
          ratings: structuredClone(league.players[0].ratings),
          ovr: over.peakOvr,
          potential: over.potential,
          academy: false,
          pos: league.players[0].pos,
        }],
    // Kept in step with the history above, because `peakOvr` is authoritative
    // wherever it is set (see careerPeakOvr) — the clone at the top of this
    // helper would otherwise carry the generated player's peak while `hist` and
    // `ovr` describe someone else entirely, which is a player the game cannot
    // produce. Absent when there is no history, so the fallback path is
    // exercised too.
    ...(over.peakOvr === undefined
      ? { peakOvr: undefined, peakOvrSeason: undefined }
      : { peakOvr: over.peakOvr, peakOvrSeason: league.season - 1 }),
  };
  league.players.push(p);
  return p;
}

describe("careerPeakOvr", () => {
  it("takes the best of current ovr and every history snapshot", () => {
    const league = makeLeague(0, 11);
    const p = addFreeAgent(league, { pid: 900001, age: 30, ovr: 58, potential: 60, peakOvr: 71 });
    expect(careerPeakOvr(p)).toBe(71);
  });
});

describe("cullablePids", () => {
  it("culls an old free agent who was never any good", () => {
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900001, age: FREE_AGENT_CULL_MIN_AGE + 4, ovr: 50, potential: 55,
    });
    expect(cullablePids(league).has(900001)).toBe(true);
  });

  it("never culls a player on a senior roster", () => {
    const league = makeLeague(0, 11);
    const rostered = league.teams[1].roster[0];
    expect(cullablePids(league).has(rostered)).toBe(false);
  });

  it("never culls a player in an academy", () => {
    const league = makeLeague(0, 11);
    const p = addFreeAgent(league, {
      pid: 900002, age: FREE_AGENT_CULL_MIN_AGE + 5, ovr: 45, potential: 50,
    });
    // Same player, but parked in a club's academy.
    league.teams[2].academyRoster.push(p.pid);
    expect(cullablePids(league).has(p.pid)).toBe(false);
  });

  it("protects young prospects, even though their career peak is low", () => {
    // The trap this guard exists for: a 17-year-old at ovr 45 with potential 80
    // has a career *peak* of 45, so culling on peak alone deletes the youth
    // pipeline before the player ever sees it on /incoming-talent.
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900003, age: FREE_AGENT_CULL_MIN_AGE - 1, ovr: 45, potential: 80,
    });
    expect(cullablePids(league).has(900003)).toBe(false);
  });

  it("protects an older free agent who still projects upward", () => {
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900004, age: FREE_AGENT_CULL_MIN_AGE + 2, ovr: 60,
      potential: FREE_AGENT_CULL_MAX_POT + 5,
    });
    expect(cullablePids(league).has(900004)).toBe(false);
  });

  it("protects a former star who has since declined", () => {
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900005, age: 34, ovr: 58, potential: 58,
      peakOvr: FREE_AGENT_CULL_MAX_PEAK_OVR + 10,
    });
    expect(cullablePids(league).has(900005)).toBe(false);
  });

  it("honours explicitly protected pids", () => {
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900006, age: FREE_AGENT_CULL_MIN_AGE + 4, ovr: 50, potential: 55,
    });
    expect(cullablePids(league, new Set([900006])).has(900006)).toBe(false);
  });
});

describe("cullFreeAgentPool", () => {
  it("removes the players and leaves no dangling references", () => {
    const league = makeLeague(0, 11);
    const doomed = addFreeAgent(league, {
      pid: 900007, age: FREE_AGENT_CULL_MIN_AGE + 6, ovr: 48, potential: 52,
    });
    // References that would otherwise render as "Player 900007".
    league.transfers.push({
      pid: doomed.pid, fromTid: 1, toTid: 2, fee: 100, season: 1, window: "summer",
    });
    league.newsEvents.push({
      type: "hattrick", pid: doomed.pid, tid: 1, season: 1, matchday: 3, detail: 3,
    });
    league.teams[0].scoutingObserved = { [doomed.pid]: 1 };
    // A watched player who is then culled could never be un-starred through the
    // UI — his profile page goes with him, and that is where the star lives.
    league.watchlist = [doomed.pid, league.teams[1].roster[0]];

    const after = cullFreeAgentPool(league);

    expect(after.players.some((p) => p.pid === doomed.pid)).toBe(false);
    expect(after.transfers.some((t) => t.pid === doomed.pid)).toBe(false);
    expect(after.newsEvents.some((e) => "pid" in e && e.pid === doomed.pid)).toBe(false);
    expect(after.teams[0].scoutingObserved[doomed.pid]).toBeUndefined();
    expect(after.watchlist).toEqual([league.teams[1].roster[0]]);
  });

  it("drops culled pids from national-team squads and pending injuries", () => {
    // Reachable because a weak nation can genuinely name a sub-65 player, and a
    // squad listing a player who no longer exists is worse than one short.
    const league = makeLeague(0, 11);
    const doomed = addFreeAgent(league, {
      pid: 900009, age: FREE_AGENT_CULL_MIN_AGE + 7, ovr: 47, potential: 51,
    });
    const keeper = league.teams[3].roster[0];
    league.international = {
      ...league.international,
      qualifying: {
        season: league.season,
        nations: ["Nowhere"],
        squads: [{
          nation: "Nowhere", pids: [doomed.pid, keeper], formation: "4-3-3", rating: 50,
        }],
        groups: [], results: [], qualified: [],
      } as unknown as LeagueStore["international"]["qualifying"],
      stageInjuries: [doomed.pid, keeper],
    };

    const after = cullFreeAgentPool(league);
    const squad = after.international.qualifying!.squads[0];
    expect(squad.pids).not.toContain(doomed.pid);
    expect(squad.pids).toContain(keeper);
    expect(after.international.stageInjuries).toEqual([keeper]);
  });

  it("leaves a league with nothing to cull byte-identical", () => {
    const league = makeLeague(0, 11);
    // A fresh world has every player on a roster, so nothing qualifies.
    expect(cullablePids(league).size).toBe(0);
    expect(cullFreeAgentPool(league)).toBe(league);
  });

  it("keeps every rostered player", () => {
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900008, age: FREE_AGENT_CULL_MIN_AGE + 3, ovr: 44, potential: 50,
    });
    const rostered = new Set(league.teams.flatMap((t) => [...t.roster, ...t.academyRoster]));
    const after = cullFreeAgentPool(league);
    const surviving = new Set(after.players.map((p) => p.pid));
    for (const pid of rostered) expect(surviving.has(pid)).toBe(true);
  });
});

describe("pid reuse after a cull", () => {
  it("never reissues a culled player's pid, even when he held the highest one", () => {
    // The failure this guards: pids used to be allocated as max(pid) + 1, so
    // deleting the highest-pid player made the allocator go backwards and hand
    // his pid to a new player — who then inherited his transfer history, news
    // events and cup box-score lines, since a pid is the only link.
    const league = makeLeague(0, 11);
    const highest = Math.max(...league.players.map((p) => p.pid));
    const doomedPid = highest + 1;
    addFreeAgent(league, {
      pid: doomedPid, age: FREE_AGENT_CULL_MIN_AGE + 5, ovr: 45, potential: 50,
    });
    league.nextPid = doomedPid + 1;
    // History that must never be re-attributed to somebody else.
    league.transfers.push({
      pid: doomedPid, fromTid: 1, toTid: 2, fee: 5, season: 1, window: "summer",
    });

    const after = cullFreeAgentPool(league);
    expect(after.players.some((p) => p.pid === doomedPid)).toBe(false);
    // The cursor is untouched by the cull, so it still points past him.
    expect(after.nextPid).toBe(doomedPid + 1);

    const { pid } = createCustomPlayer(after, {
      name: "New Guy", nationality: "England", age: 20, pos: "CM",
      heightCm: 178, ratings: structuredClone(league.players[0].ratings),
      potential: 70, contract: { salary: 1_000_000, expiresSeason: after.season + 2 },
      tid: null,
    });
    expect(pid).not.toBe(doomedPid);
    expect(pid).toBeGreaterThan(doomedPid);
  });
});

describe("awardedPids", () => {
  // This returned an empty set for every save at one point: it looked for objects
  // with a `pid` property, but SeasonAwards stores bare numbers under
  // playerOfSeasonPid / goldenBootPid / teamOfSeason[]. The award protection was
  // therefore doing nothing at all, silently.
  it("finds every pid an honours board names", () => {
    const league = {
      seasonHistory: [{
        awards: {
          0: { playerOfSeasonPid: 111, goldenBootPid: 222, teamOfSeason: [333, 444, null] },
        },
      }],
      international: { history: [] },
    } as unknown as LeagueStore;
    expect([...awardedPids(league)].sort((a, b) => a - b)).toEqual([111, 222, 333, 444]);
  });

  it("handles the older single-SeasonAwards and tuple shapes too", () => {
    const single = {
      seasonHistory: [{ awards: { playerOfSeasonPid: 7, goldenBootPid: null, teamOfSeason: [8] } }],
      international: { history: [] },
    } as unknown as LeagueStore;
    expect([...awardedPids(single)].sort((a, b) => a - b)).toEqual([7, 8]);

    const tuple = {
      seasonHistory: [{
        awards: [
          { playerOfSeasonPid: 1, goldenBootPid: 2, teamOfSeason: [] },
          { playerOfSeasonPid: 3, goldenBootPid: null, teamOfSeason: [4] },
        ],
      }],
      international: { history: [] },
    } as unknown as LeagueStore;
    expect([...awardedPids(tuple)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("protects a tournament top scorer, whose profile link uses his pid", () => {
    const league = {
      seasonHistory: [],
      international: { history: [{ topScorer: { pid: 55, nation: "X", goals: 6 } }] },
    } as unknown as LeagueStore;
    expect([...awardedPids(league)]).toEqual([55]);
  });

  it("keeps an award winner who would otherwise be culled", () => {
    // Reachable: tier-2 squads are capped below the D2 ceiling, so a
    // second-division Team-of-the-Season pick really can sit at peak ovr <= 65.
    const league = makeLeague(0, 11);
    const winner = addFreeAgent(league, {
      pid: 900100, age: FREE_AGENT_CULL_MIN_AGE + 6, ovr: 61, potential: 62,
    });
    league.seasonHistory = [{
      awards: { 0: { playerOfSeasonPid: null, goldenBootPid: winner.pid, teamOfSeason: [] } },
    }] as unknown as LeagueStore["seasonHistory"];

    expect(cullablePids(league).has(winner.pid)).toBe(true); // no protection passed
    const after = cullFreeAgentPool(league);                 // applies awardedPids
    expect(after.players.some((p) => p.pid === winner.pid)).toBe(true);
  });
});

describe("cullOnLoad", () => {
  it("leaves a normal-sized pool alone, so a released player stays re-signable", () => {
    const league = makeLeague(0, 11);
    addFreeAgent(league, {
      pid: 900101, age: FREE_AGENT_CULL_MIN_AGE + 3, ovr: 55, potential: 58,
    });
    expect(freeAgentCount(league)).toBeLessThan(FREE_AGENT_CULL_LOAD_THRESHOLD);
    const after = cullOnLoad(league);
    expect(after).toBe(league);
    expect(after.players.some((p) => p.pid === 900101)).toBe(true);
  });

  it("drains a bloated pool, which is the frozen-save case it exists for", () => {
    const league = makeLeague(0, 11);
    // Push the pool past the threshold with cullable free agents.
    for (let i = 0; i < FREE_AGENT_CULL_LOAD_THRESHOLD + 10; i++) {
      addFreeAgent(league, {
        pid: 950000 + i, age: FREE_AGENT_CULL_MIN_AGE + 5, ovr: 45, potential: 50,
      });
    }
    const after = cullOnLoad(league);
    expect(after.players.length).toBeLessThan(league.players.length);
    expect(freeAgentCount(after)).toBeLessThan(FREE_AGENT_CULL_LOAD_THRESHOLD);
  });
});
