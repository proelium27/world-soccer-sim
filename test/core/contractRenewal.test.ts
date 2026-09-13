import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { renewalsDue, extendAllContracts } from "../../src/core/contractRenewal.js";
import {
  canExtend, contractTerms, academyContractTerms, extendContract, academyCheckpointExpiry,
} from "../../src/core/contracts.js";
import { DIVISION_2_REFUSAL_OVR_THRESHOLD } from "../../src/core/constants.js";
import { tierOf } from "../../src/core/competitions.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { Player } from "../../src/core/players/types.js";

/** Put every pid in their final year, so there's something to re-sign. */
function expireAll(league: LeagueStore, pids: number[]): LeagueStore {
  const set = new Set(pids);
  return {
    ...league,
    players: league.players.map((p) => (
      set.has(p.pid)
        ? { ...p, contract: { ...p.contract, expiresSeason: league.season } }
        : p
    )),
  };
}

function userTeamOf(league: LeagueStore) {
  const team = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!team) throw new Error("no user team");
  return team;
}

function byPid(league: LeagueStore): Map<number, Player> {
  return new Map(league.players.map((p) => [p.pid, p]));
}

describe("renewalsDue", () => {
  it("names every senior player in his final year, and nobody else", () => {
    const base = makeLeague(0, 1);
    const team = userTeamOf(base);
    const expiring = team.roster.slice(0, 4);
    const league = expireAll(base, expiring);

    const due = renewalsDue(league, "senior");
    expect([...due.pids].sort()).toEqual([...expiring].sort());
    expect(due.refusingPids).toEqual([]);
  });

  it("totals the exact wage bill of the deals it would sign", () => {
    const base = makeLeague(0, 1);
    const league = expireAll(base, userTeamOf(base).roster.slice(0, 5));
    const due = renewalsDue(league, "senior");
    const players = byPid(league);
    const expected = due.pids.reduce(
      (sum, pid) => sum + contractTerms(players.get(pid)!, league.season).salary, 0,
    );
    expect(due.pids.length).toBe(5);
    expect(due.totalSalary).toBe(expected);
  });

  it("reports a Division 2 holdout separately instead of counting him in", () => {
    // Manage a tier-2 club, where wouldRefuseExtension can actually fire.
    const base = makeLeague(0, 1);
    const tier2 = base.teams.find((t) => tierOf(base.competitions, t.compId) === 2);
    if (!tier2) throw new Error("no tier-2 club");
    const rehomed: LeagueStore = { ...base, meta: { ...base.meta, userTid: tier2.tid } };
    const [starPid, ...rest] = tier2.roster.slice(0, 3);
    const expired = expireAll(rehomed, tier2.roster.slice(0, 3));
    const league: LeagueStore = {
      ...expired,
      players: expired.players.map((p) => (
        p.pid === starPid ? { ...p, ovr: DIVISION_2_REFUSAL_OVR_THRESHOLD + 5 } : p
      )),
    };

    const due = renewalsDue(league, "senior");
    expect(due.refusingPids).toEqual([starPid]);
    expect([...due.pids].sort()).toEqual([...rest].sort());
  });

  it("prices academy prospects on the flat stipend, not the ovr-cubic wage", () => {
    const base = makeLeague(0, 1);
    const team = userTeamOf(base);
    // createLeagueState leaves the academy empty; stock it from the pool.
    // Past the professional cut: a younger kid's academy deal runs to his next
    // checkpoint and is resolved by the rollover, not re-signed.
    const prospects = base.players
      .filter((p) => !base.teams.some((t) => t.roster.includes(p.pid)))
      .filter((p) => academyCheckpointExpiry(p.born, base.season) === null)
      .slice(0, 3)
      .map((p) => p.pid);
    const stocked: LeagueStore = {
      ...base,
      teams: base.teams.map((t) => (
        t.tid === team.tid ? { ...t, academyRoster: prospects } : t
      )),
    };
    const league = expireAll(stocked, prospects);

    const due = renewalsDue(league, "academy");
    expect([...due.pids].sort()).toEqual([...prospects].sort());
    expect(due.totalSalary).toBe(prospects.length * academyContractTerms(league.season).salary);
  });

  it("covers players out on loan, who are on nobody else's list", () => {
    const base = makeLeague(0, 1);
    const team = userTeamOf(base);
    const other = base.teams.find((t) => t.tid !== team.tid)!;
    const pid = team.roster[0];
    // A loan moves the pid onto the loanee's roster; the parent keeps the contract.
    const loaned: LeagueStore = {
      ...base,
      teams: base.teams.map((t) => {
        if (t.tid === team.tid) return { ...t, roster: t.roster.filter((r) => r !== pid) };
        if (t.tid === other.tid) return { ...t, roster: [...t.roster, pid] };
        return t;
      }),
      activeLoans: [{
        pid, parentTid: team.tid, loaneeTid: other.tid,
        startSeason: base.season, seasons: 1, returnSeason: base.season + 1, fee: 0,
      }],
    };
    const league = expireAll(loaned, [pid]);

    expect(renewalsDue(league, "senior").pids).not.toContain(pid);
    expect(renewalsDue(league, "loanedOut").pids).toEqual([pid]);
  });

  it("finds nothing when every deal has time left", () => {
    const league = makeLeague(0, 1);
    for (const group of ["senior", "academy", "loanedOut"] as const) {
      expect(renewalsDue(league, group).pids).toEqual([]);
    }
  });
});

describe("extendAllContracts", () => {
  it("re-signs exactly the players renewalsDue named, on their default terms", () => {
    const base = makeLeague(0, 1);
    const league = expireAll(base, userTeamOf(base).roster.slice(0, 6));
    const due = renewalsDue(league, "senior");
    const before = byPid(league);

    const after = extendAllContracts(league, "senior");
    const players = byPid(after);
    for (const pid of due.pids) {
      const terms = contractTerms(before.get(pid)!, league.season);
      expect(players.get(pid)!.contract).toEqual({
        salary: terms.salary, expiresSeason: terms.expiresSeason,
      });
      expect(canExtend(players.get(pid)!, league.season)).toBe(false);
    }
  });

  it("leaves every untouched player at the SAME OBJECT, so the save's dirty-set diff stays honest", () => {
    const base = makeLeague(0, 1);
    const expiring = userTeamOf(base).roster.slice(0, 3);
    const league = expireAll(base, expiring);
    const after = extendAllContracts(league, "senior");

    const set = new Set(expiring);
    const changed = league.players.filter((p, i) => after.players[i] !== p);
    expect(changed.map((p) => p.pid).sort()).toEqual([...expiring].sort());
    expect(changed.every((p) => set.has(p.pid))).toBe(true);
  });

  it("returns the league by reference when there is nobody to re-sign", () => {
    const league = makeLeague(0, 1);
    expect(extendAllContracts(league, "senior")).toBe(league);
    expect(extendAllContracts(league, "academy")).toBe(league);
    expect(extendAllContracts(league, "loanedOut")).toBe(league);
  });

  it("matches extending each player one at a time", () => {
    const base = makeLeague(0, 1);
    const league = expireAll(base, userTeamOf(base).roster.slice(0, 5));
    const due = renewalsDue(league, "senior");

    let oneAtATime = league.players;
    for (const pid of due.pids) oneAtATime = extendContract(oneAtATime, pid, league.season);

    expect(extendAllContracts(league, "senior").players).toEqual(oneAtATime);
  });
});
