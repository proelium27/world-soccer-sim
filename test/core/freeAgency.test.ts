import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  freeAgentPids, releaseExpiredContracts, runAIFreeAgency, signFreeAgent, releasePlayer,
  signToAcademy, promoteFromAcademy, releaseAcademyPlayer, ensureUserRosterSafety,
  faTransferLocked, freeAgencySigningOrder,
} from "../../src/core/freeAgency.js";
import {
  ROSTER_COMPOSITION, ROSTER_CAP, ACADEMY_ROSTER_CAP, ROSTER_SAFETY_FLOOR,
  PROSPECT_AGE_MAX,
} from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";
import { clubStatures } from "../../src/core/ai/clubContext.js";

describe("freeAgentPids", () => {
  it("is empty when every player is rostered", () => {
    const league = makeLeague(0, 1);
    expect(freeAgentPids(league.teams, league.players).size).toBe(0);
  });
});

describe("releaseExpiredContracts", () => {
  it("removes players with expired contracts from every roster", () => {
    const league = makeLeague(0, 1);
    const someTeam = league.teams[0];
    const pid = someTeam.roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1; // force expiry at season 1

    const teams = releaseExpiredContracts(league.teams, league.players, 1);
    const updatedTeam = teams.find((t) => t.tid === someTeam.tid)!;
    expect(updatedTeam.roster).not.toContain(pid);
    expect(freeAgentPids(teams, league.players).has(pid)).toBe(true);
  });
});

describe("runAIFreeAgency", () => {
  it("fills a positional shortfall for a non-user team from the free agent pool", () => {
    const league = makeLeague(0, 1);
    const targetTid = 1;
    const target = league.teams.find((t) => t.tid === targetTid)!;

    // Force-release all GKs from the target team, leaving a shortfall.
    const gkPids = new Set(
      league.players.filter((p) => p.pos === "GK" && target.roster.includes(p.pid)).map((p) => p.pid),
    );
    const teams = league.teams.map((t) =>
      t.tid === targetTid ? { ...t, roster: t.roster.filter((pid) => !gkPids.has(pid)) } : t,
    );

    const signingOrder = teams.map((t) => t.tid);
    const rng = mulberry32(3);
    const { teams: updatedTeams, players: updatedPlayers } = runAIFreeAgency(
      teams, league.players, 2, rng, /* userTid */ -1, signingOrder,
    );

    const updatedTarget = updatedTeams.find((t) => t.tid === targetTid)!;
    const playerMap = new Map(updatedPlayers.map((p) => [p.pid, p]));
    const gkCount = updatedTarget.roster.filter((pid) => playerMap.get(pid)?.pos === "GK").length;
    expect(gkCount).toBe(ROSTER_COMPOSITION.GK);
  });

  it("never signs a free agent to the user's team", () => {
    const league = makeLeague(0, 1);
    const userTid = 0;
    const rosterBefore = new Set(league.teams.find((t) => t.tid === userTid)!.roster);

    // Free up some players league-wide.
    const players = league.players.map((p, i) =>
      i % 20 === 0 ? { ...p, contract: { ...p.contract, expiresSeason: 1 } } : p,
    );
    const teams = releaseExpiredContracts(league.teams, players, 1);
    const signingOrder = teams.map((t) => t.tid);

    const { teams: updatedTeams } = runAIFreeAgency(
      teams, players, 2, mulberry32(5), userTid, signingOrder,
    );
    const updatedUser = updatedTeams.find((t) => t.tid === userTid)!;
    // Every pid still on the user's roster was there before; nothing new was signed.
    for (const pid of updatedUser.roster) expect(rosterBefore.has(pid)).toBe(true);
  });

  it("never signs the same free agent to two different teams", () => {
    const league = makeLeague(0, 1);
    const signingOrder = league.teams.map((t) => t.tid);
    const { teams } = runAIFreeAgency(
      league.teams, league.players, 2, mulberry32(7), -1, signingOrder,
    );
    const allPids = teams.flatMap((t) => t.roster);
    expect(new Set(allPids).size).toBe(allPids.length);
  });

  it("reports each signing (pid + destination) so the caller can log it as a transfer", () => {
    const league = makeLeague(0, 1);
    const targetTid = 1;
    const target = league.teams.find((t) => t.tid === targetTid)!;
    // Leave a GK shortfall so at least one signing happens.
    const gkPids = new Set(
      league.players.filter((p) => p.pos === "GK" && target.roster.includes(p.pid)).map((p) => p.pid),
    );
    const teams = league.teams.map((t) =>
      t.tid === targetTid ? { ...t, roster: t.roster.filter((pid) => !gkPids.has(pid)) } : t,
    );
    const rosterBefore = new Map(teams.map((t) => [t.tid, new Set(t.roster)]));

    const { teams: updatedTeams, signings } = runAIFreeAgency(
      teams, league.players, 2, mulberry32(3), -1, teams.map((t) => t.tid),
    );

    expect(signings.length).toBeGreaterThan(0);
    // Every reported signing is a pid now on its destination roster, and was
    // not there before — i.e. the signings list is exactly the new arrivals.
    for (const s of signings) {
      const dest = updatedTeams.find((t) => t.tid === s.toTid)!;
      expect(dest.roster).toContain(s.pid);
      expect(rosterBefore.get(s.toTid)!.has(s.pid)).toBe(false);
    }
    // And every genuinely-new roster arrival is reported.
    const reported = new Set(signings.map((s) => `${s.toTid}:${s.pid}`));
    for (const t of updatedTeams) {
      for (const pid of t.roster) {
        if (!rosterBefore.get(t.tid)!.has(pid)) {
          expect(reported.has(`${t.tid}:${pid}`)).toBe(true);
        }
      }
    }
  });

});

describe("signFreeAgent", () => {
  it("adds a free agent to the given team's roster with a fresh contract", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    const teams = releaseExpiredContracts(league.teams, league.players, 1);

    const { teams: signedTeams, players: signedPlayers } = signFreeAgent(
      teams, league.players, 0, pid, 1, "offseason",
    );
    expect(signedTeams.find((t) => t.tid === 0)!.roster).toContain(pid);
    const signed = signedPlayers.find((p) => p.pid === pid)!;
    expect(signed.contract.expiresSeason).toBeGreaterThan(1);
  });

  it("is a no-op if the pid is not actually a free agent", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[2].roster[0]; // still rostered on team 2
    const result = signFreeAgent(league.teams, league.players, 0, pid, 1, "offseason");
    expect(result.teams).toBe(league.teams);
    expect(result.players).toBe(league.players);
  });

  it("is a no-op if the signing team is already at ROSTER_CAP", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    let teams = releaseExpiredContracts(league.teams, league.players, 1);

    // Pad team 0's roster up to the cap with fabricated pids.
    teams = teams.map((t) =>
      t.tid === 0
        ? { ...t, roster: [...t.roster, ...Array.from(
            { length: ROSTER_CAP - t.roster.length }, (_, i) => 100_000 + i,
          )] }
        : t,
    );
    expect(teams.find((t) => t.tid === 0)!.roster.length).toBe(ROSTER_CAP);

    const result = signFreeAgent(teams, league.players, 0, pid, 1, "offseason");
    expect(result.teams).toBe(teams);
    expect(result.players).toBe(league.players);
  });
});

describe("free-agent transfer hold", () => {
  it("stamps faSignedSeason at next season for an offseason signing", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 5;
    const teams = releaseExpiredContracts(league.teams, league.players, 5);

    const { players } = signFreeAgent(teams, league.players, 0, pid, 5, "offseason");
    const signed = players.find((p) => p.pid === pid)!;
    // Signed in the offseason after season 5 → he joins for season 6.
    expect(signed.faSignedSeason).toBe(6);
    expect(faTransferLocked(signed, 6)).toBe(true);
    expect(faTransferLocked(signed, 7)).toBe(false);
  });

  it("stamps faSignedSeason at the current season for a mid-season signing", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 5;
    const teams = releaseExpiredContracts(league.teams, league.players, 5);
    // Give team 0 enough budget to cover the mid-season wage charge.
    const funded = teams.map((t) => (t.tid === 0 ? { ...t, budget: 1_000_000_000 } : t));

    const { players } = signFreeAgent(funded, league.players, 0, pid, 6, "regular");
    const signed = players.find((p) => p.pid === pid)!;
    expect(signed.faSignedSeason).toBe(6);
    expect(faTransferLocked(signed, 6)).toBe(true);
    expect(faTransferLocked(signed, 7)).toBe(false);
  });

  it("treats a player never signed from free agency as unlocked", () => {
    const league = makeLeague(0, 1);
    const player = league.players[0];
    expect(player.faSignedSeason).toBeUndefined();
    expect(faTransferLocked(player, 1)).toBe(false);
  });
});

describe("runAIFreeAgency quality poaching", () => {
  it("poaches a high-ovr free agent even when no club has a shortfall", () => {
    const league = makeLeague(0, 1);
    // A pure extra free agent: a strong CM belonging to no roster, so no club
    // has a positional shortfall — only the poaching pass can pick him up.
    const star = { ...structuredClone(league.players[0]), pid: 999_001, pos: "CM" as const, ovr: 99 };
    // RATING_MIN, so he is worse than any club's weakest CM by construction.
    // He was ovr 20, which stopped being "worse than everyone" once every
    // country gained a third division: those squads run well below that, so a
    // third-tier club genuinely upgraded by signing him and the pool kept him
    // no longer. Pinning him at the floor makes the premise world-independent.
    const scrub = { ...structuredClone(league.players[0]), pid: 999_002, pos: "CM" as const, ovr: 1 };
    const players = [...league.players, star, scrub];

    const signingOrder = league.teams.map((t) => t.tid);
    const { teams } = runAIFreeAgency(
      league.teams, players, 2, mulberry32(11), /* userTid */ -1, signingOrder,
    );

    const stillFree = freeAgentPids(teams, players);
    // The star upgrades someone's weakest CM, so he's poached out of the pool;
    // the scrub is worse than every club's weakest CM, so he's left behind.
    expect(stillFree.has(star.pid)).toBe(false);
    expect(stillFree.has(scrub.pid)).toBe(true);
  });

  it("never poaches onto the user's club", () => {
    const league = makeLeague(0, 1);
    const userTid = 0;
    const before = new Set(league.teams.find((t) => t.tid === userTid)!.roster);
    const star = { ...structuredClone(league.players[0]), pid: 999_003, pos: "CM" as const, ovr: 99 };
    const players = [...league.players, star];

    const { teams } = runAIFreeAgency(
      league.teams, players, 2, mulberry32(13), userTid, league.teams.map((t) => t.tid),
    );
    const after = teams.find((t) => t.tid === userTid)!;
    for (const pid of after.roster) expect(before.has(pid)).toBe(true);
  });
});

describe("releasePlayer depth floor", () => {
  it("releases a player while depth stays at or above half the target complement", () => {
    const league = makeLeague(0, 1);
    const team = league.teams[0];
    const gks = league.players.filter(
      (p) => p.pos === "GK" && team.roster.includes(p.pid),
    );
    expect(gks.length).toBe(ROSTER_COMPOSITION.GK);

    // GK target is 3, floor after a release is ceil(3/2) = 2: first release ok.
    const teams = releasePlayer(league.teams, league.players, team.tid, gks[0].pid);
    expect(teams.find((t) => t.tid === team.tid)!.roster).not.toContain(gks[0].pid);
  });

  it("refuses a release that would drop a position below the floor", () => {
    const league = makeLeague(0, 1);
    const team = league.teams[0];
    const gks = league.players.filter(
      (p) => p.pos === "GK" && team.roster.includes(p.pid),
    );

    const afterFirst = releasePlayer(league.teams, league.players, team.tid, gks[0].pid);
    // Down to 2 GKs — releasing another would leave 1 < ceil(3/2), so no-op.
    const afterSecond = releasePlayer(afterFirst, league.players, team.tid, gks[1].pid);
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond.find((t) => t.tid === team.tid)!.roster).toContain(gks[1].pid);
  });

  it("no-ops for a pid that isn't on the team", () => {
    const league = makeLeague(0, 1);
    const team = league.teams[0];
    const otherPid = league.teams[1].roster[0];
    const teams = releasePlayer(league.teams, league.players, team.tid, otherPid);
    expect(teams).toBe(league.teams);
  });
});

describe("academy", () => {
  it("signToAcademy adds a free agent to the academy pool on a flat stipend", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    player.born = 1 - 20; // age 20 at season 1, within PROSPECT_AGE_MAX
    const teams = releaseExpiredContracts(league.teams, league.players, 1);

    const { teams: signedTeams, players: signedPlayers } = signToAcademy(
      teams, league.players, 0, pid, 1, "offseason",
    );
    const userTeam = signedTeams.find((t) => t.tid === 0)!;
    expect(userTeam.academyRoster).toContain(pid);
    expect(userTeam.roster).not.toContain(pid);
    const signed = signedPlayers.find((p) => p.pid === pid)!;
    expect(signed.contract.salary).toBeLessThan(player.contract.salary || Infinity);
  });

  it("signToAcademy is a no-op once the academy is at ACADEMY_ROSTER_CAP", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    player.born = 1 - 20;
    let teams = releaseExpiredContracts(league.teams, league.players, 1);
    teams = teams.map((t) =>
      t.tid === 0
        ? { ...t, academyRoster: Array.from({ length: ACADEMY_ROSTER_CAP }, (_, i) => 200_000 + i) }
        : t,
    );

    const result = signToAcademy(teams, league.players, 0, pid, 1, "offseason");
    expect(result.teams).toBe(teams);
    expect(result.players).toBe(league.players);
  });

  it("signToAcademy charges the stipend to budget when signed mid-season", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    player.born = 1 - 20;
    const teams = releaseExpiredContracts(league.teams, league.players, 1);
    const budgetBefore = teams.find((t) => t.tid === 0)!.budget;

    const { teams: signedTeams } = signToAcademy(teams, league.players, 0, pid, 1, "regular");
    const userTeam = signedTeams.find((t) => t.tid === 0)!;
    expect(userTeam.academyRoster).toContain(pid);
    expect(userTeam.budget).toBeLessThan(budgetBefore);
  });

  it("signToAcademy is a no-op for a prospect older than PROSPECT_AGE_MAX", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    player.born = 1 - 25; // age 25, over PROSPECT_AGE_MAX
    const teams = releaseExpiredContracts(league.teams, league.players, 1);

    const result = signToAcademy(teams, league.players, 0, pid, 1, "offseason");
    expect(result.teams).toBe(teams);
    expect(result.players).toBe(league.players);
  });

  it("promoteFromAcademy moves a pid to the senior roster with a fresh ovr-based wage", () => {
    const league = makeLeague(0, 1);
    const userTeam = league.teams.find((t) => t.tid === 0)!;
    const pid = userTeam.roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    // Simulate the player already being in the academy on a stipend.
    const teams = league.teams.map((t) =>
      t.tid === 0
        ? { ...t, roster: t.roster.filter((p) => p !== pid), academyRoster: [pid] }
        : t,
    );
    const players = league.players.map((p) =>
      p.pid === pid ? { ...p, contract: { salary: 26_000, expiresSeason: 3 } } : p,
    );

    const { teams: promotedTeams, players: promotedPlayers } = promoteFromAcademy(
      teams, players, 0, pid, 2, "offseason",
    );
    const updatedTeam = promotedTeams.find((t) => t.tid === 0)!;
    expect(updatedTeam.roster).toContain(pid);
    expect(updatedTeam.academyRoster).not.toContain(pid);
    const promoted = promotedPlayers.find((p) => p.pid === pid)!;
    expect(promoted.contract.salary).toBeGreaterThan(26_000);
    void player;
  });

  it("promoteFromAcademy is a no-op for a pid not in that team's academy", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0]; // rostered elsewhere, never in academy
    const result = promoteFromAcademy(league.teams, league.players, 0, pid, 2, "offseason");
    expect(result.teams).toBe(league.teams);
    expect(result.players).toBe(league.players);
  });

  it("promoteFromAcademy is a no-op once the roster is at ROSTER_CAP", () => {
    const league = makeLeague(0, 1);
    let teams = league.teams.map((t) =>
      t.tid === 0
        ? {
            ...t,
            roster: [...t.roster, ...Array.from(
              { length: ROSTER_CAP - t.roster.length }, (_, i) => 300_000 + i,
            )],
            academyRoster: [999_999],
          }
        : t,
    );
    const players = [...league.players, {
      ...league.players[0], pid: 999_999,
      contract: { salary: 26_000, expiresSeason: 3 },
    }];
    const result = promoteFromAcademy(teams, players, 0, 999_999, 2, "offseason");
    expect(result.teams).toBe(teams);
  });

  it("releaseAcademyPlayer removes a pid from the academy with no depth floor", () => {
    const league = makeLeague(0, 1);
    const teams = league.teams.map((t) => (t.tid === 0 ? { ...t, academyRoster: [111_111] } : t));
    const result = releaseAcademyPlayer(teams, 0, 111_111);
    expect(result.find((t) => t.tid === 0)!.academyRoster).not.toContain(111_111);
  });

  it("releaseAcademyPlayer no-ops for a pid not in that team's academy", () => {
    const league = makeLeague(0, 1);
    const result = releaseAcademyPlayer(league.teams, 0, 222_222);
    expect(result).toBe(league.teams);
  });

  it("freeAgentPids excludes players parked in an academy", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const player = league.players.find((p) => p.pid === pid)!;
    player.contract.expiresSeason = 1;
    let teams = releaseExpiredContracts(league.teams, league.players, 1);
    expect(freeAgentPids(teams, league.players).has(pid)).toBe(true);

    teams = teams.map((t) => (t.tid === 0 ? { ...t, academyRoster: [pid] } : t));
    expect(freeAgentPids(teams, league.players).has(pid)).toBe(false);
  });

  it("releaseExpiredContracts also clears expired academy contracts", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[1].roster[0];
    const players = league.players.map((p) =>
      p.pid === pid ? { ...p, contract: { salary: 1000, expiresSeason: 1 } } : p,
    );
    const teams = league.teams.map((t) => (t.tid === 0 ? { ...t, academyRoster: [pid] } : t));

    const result = releaseExpiredContracts(teams, players, 1);
    expect(result.find((t) => t.tid === 0)!.academyRoster).not.toContain(pid);
    expect(freeAgentPids(result, players).has(pid)).toBe(true);
  });

  describe("ensureUserRosterSafety", () => {
    it("is a no-op when the user's roster is already above the safety floor", () => {
      const league = makeLeague(0, 1);
      const result = ensureUserRosterSafety(league.teams, league.players, 0, 2);
      expect(result.teams).toBe(league.teams);
      expect(result.players).toBe(league.players);
    });

    it("promotes from the academy until the roster reaches the safety floor", () => {
      const league = makeLeague(0, 1);
      const userTeam = league.teams.find((t) => t.tid === 0)!;
      // Strip the roster down to a single GK, well below the floor, and stock
      // the academy with enough outfielders (plus a spare GK) to cover it.
      const gk = league.players.find((p) => userTeam.roster.includes(p.pid) && p.pos === "GK")!;
      const academyCandidates = league.teams
        .filter((t) => t.tid !== 0)
        .flatMap((t) => t.roster)
        .slice(0, ROSTER_SAFETY_FLOOR + 2);

      const teams = league.teams.map((t) =>
        t.tid === 0 ? { ...t, roster: [gk.pid], academyRoster: academyCandidates } : t,
      );

      const { teams: safeTeams, players: safePlayers } = ensureUserRosterSafety(
        teams, league.players, 0, 2,
      );
      const safeUser = safeTeams.find((t) => t.tid === 0)!;
      expect(safeUser.roster.length).toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
      expect(safeUser.roster).toContain(gk.pid);
      void safePlayers;
    });

    it("promotes a GK from the academy if the user's roster has none at all", () => {
      const league = makeLeague(0, 1);
      const userTeam = league.teams.find((t) => t.tid === 0)!;
      const outfielders = league.players
        .filter((p) => userTeam.roster.includes(p.pid) && p.pos !== "GK")
        .map((p) => p.pid);
      const academyGk = league.players.find(
        (p) => !userTeam.roster.includes(p.pid) && p.pos === "GK",
      )!;

      const teams = league.teams.map((t) =>
        t.tid === 0 ? { ...t, roster: outfielders, academyRoster: [academyGk.pid] } : t,
      );

      const { teams: safeTeams } = ensureUserRosterSafety(teams, league.players, 0, 2);
      const safeUser = safeTeams.find((t) => t.tid === 0)!;
      expect(safeUser.roster).toContain(academyGk.pid);
    });

    it("falls back to the free-agent pool for a GK if the academy has none either", () => {
      const league = makeLeague(0, 1);
      const userTeam = league.teams.find((t) => t.tid === 0)!;
      const playerMap = new Map(league.players.map((p) => [p.pid, p]));
      // Drop the user's own GKs to free agency (not just off the roster) and
      // leave the academy empty, so the only path to a GK is the fallback.
      const outfielders = userTeam.roster.filter((pid) => playerMap.get(pid)?.pos !== "GK");
      const teams = league.teams.map((t) =>
        t.tid === 0 ? { ...t, roster: outfielders, academyRoster: [] } : t,
      );
      expect(teams.find((t) => t.tid === 0)!.roster.some((pid) => playerMap.get(pid)?.pos === "GK"))
        .toBe(false);

      const { teams: safeTeams } = ensureUserRosterSafety(teams, league.players, 0, 2);
      const safeUser = safeTeams.find((t) => t.tid === 0)!;
      expect(safeUser.roster.some((pid) => playerMap.get(pid)?.pos === "GK")).toBe(true);
    });
  });
});

describe("freeAgencySigningOrder", () => {
  // The queue is "worst club picks first", and the whole world is one queue. So
  // "worst" has to be comparable ACROSS divisions, and raw points are not once
  // divisions differ in size: a 12-club league plays 22 games, a 20-club one
  // 38, so its clubs carry ~58% of the points at the same quality and pick
  // first whatever they are worth. The pool drains by quality, so picking
  // first is the whole prize. Measured on the controlled probe: a 12-club
  // league's free-agent arrivals averaged 39 OVR against a 20-club league's
  // 26, same count per club, and that gap alone was ~7 OVR of whole-roster
  // drift over 15 seasons (scripts/divisionSizeProbe.ts).
  const row = (tid: number, played: number, points: number) => ({
    tid, played, points, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0,
  });

  it("ranks a club by points per game, so a short season does not read as a bad one", () => {
    // A 20-club league's bottom club (0.79 ppg) is worse than a 12-club
    // league's mid-table club (1.18 ppg), and it has MORE raw points.
    const bottomOf20 = row(1, 38, 30);
    const midOf12 = row(2, 22, 26);
    expect(freeAgencySigningOrder([midOf12, bottomOf20])).toEqual([1, 2]);
  });

  it("is the raw-points order within one division, so uniform worlds are untouched", () => {
    const rows = [row(1, 38, 70), row(2, 38, 40), row(3, 38, 55), row(4, 38, 40)];
    expect(freeAgencySigningOrder(rows)).toEqual([2, 4, 3, 1]);
  });
});

describe("signFreeAgent player will", () => {
  // A free transfer used to be the one route around the player-will module:
  // a player who would flatly refuse to be *bought* by a club would happily
  // *sign* for it, which is how a third-tier side assembled a top-flight squad
  // for nothing. See refusesFreeAgentSigning.
  const setup = () => {
    const league = makeLeague(0, 1);
    // A weak club, and a star released by a strong one.
    const clubs = [...league.teams].sort(
      (a, b) => strengthOf(a, league.players) - strengthOf(b, league.players),
    );
    const weak = clubs[0];
    const strong = clubs[clubs.length - 1];
    const star = league.players.find((p) => p.pid === strong.roster[0])!;
    // Release him from the strong club, leaving the stats line that records
    // where he played — the only trace of a departure into free agency.
    const teams = league.teams.map((t) =>
      t.tid === strong.tid ? { ...t, roster: t.roster.filter((pid) => pid !== star.pid) } : t,
    );
    const players = league.players.map((p) =>
      p.pid === star.pid
        // 82, not something absurd: abilityStature clamps at the top of the
        // squad-strength band, so a 95 is beyond what any club in a fresh world
        // justifies and nobody could sign him — which is correct, and useless
        // as a positive control.
        ? { ...p, ovr: 82, stats: [{ season: 1, tid: strong.tid } as never] }
        : p,
    );
    return { league, teams, players, star, weak, strong };
  };
  const strengthOf = (t: { roster: number[] }, players: Player[]) => {
    const byPid = new Map(players.map((p) => [p.pid, p]));
    const r = t.roster.map((pid) => byPid.get(pid)!).filter(Boolean).map((p) => p.ovr);
    return r.reduce((a, b) => a + b, 0) / Math.max(1, r.length);
  };

  it("refuses to put a star at a club far below the one that released him", () => {
    const { teams, players, star, weak } = setup();
    const out = signFreeAgent(teams, players, weak.tid, star.pid, 1, "offseason");
    expect(out.teams.find((t) => t.tid === weak.tid)!.roster).not.toContain(star.pid);
  });

  it("still lets a club of his own level sign him", () => {
    const { teams, players, star, strong } = setup();
    const out = signFreeAgent(teams, players, strong.tid, star.pid, 1, "offseason");
    expect(out.teams.find((t) => t.tid === strong.tid)!.roster).toContain(star.pid);
  });

  it("gates the academy route too, which has an age cap but no rating cap", () => {
    // Otherwise the identical exploit runs through a flat stipend instead of
    // an ovr-cubic wage — a cheaper door to the same place.
    const { teams, players, star, weak } = setup();
    const young = players.map((p) =>
      p.pid === star.pid ? { ...p, born: 1 - PROSPECT_AGE_MAX } : p,
    );
    const out = signToAcademy(teams, young, weak.tid, star.pid, 1, "offseason");
    expect(out.teams.find((t) => t.tid === weak.tid)!.academyRoster).not.toContain(star.pid);
  });
});

describe("runAIFreeAgency player will", () => {
  // freeAgencySigningOrder is worst-first, so without this gate the WEAKEST
  // club in the world got first pick of every elite free agent — while the user
  // was refused the identical signing. The pass most likely to move a star down
  // the pyramid was the one pass that never asked him.
  it("does not let the weakest club in the world sign an elite free agent", () => {
    const league = makeLeague(0, 1);
    const statures = clubStatures(league.teams, league.players);
    const ranked = [...league.teams].sort(
      (a, b) => (statures.get(a.tid) ?? 0) - (statures.get(b.tid) ?? 0),
    );
    const weakest = ranked[0];
    const strongest = ranked[ranked.length - 1];

    // An ADDED free agent rather than one taken off a roster: removing a player
    // leaves his club a man short at that position, and the shortfall pass runs
    // for every club before the poach pass runs for any, so his old club simply
    // signs him straight back and the poach pass — the thing under test — never
    // sees him.
    const pid = Math.max(...league.players.map((p) => p.pid)) + 1;
    const star = {
      ...league.players.find((p) => p.pos === "CM")!,
      pid,
      ovr: 88,
      // The stats line is how a free agent's last club is recovered at all.
      stats: [{ season: 1, tid: strongest.tid } as never],
    };
    const players = [...league.players, star];

    // Worst club first, which is the real signing order.
    const order = [weakest.tid, strongest.tid];
    const out = runAIFreeAgency(
      league.teams, players, 2, mulberry32(1), league.meta.userTid, order, [], "random",
    );
    const landed = out.signings.find((s) => s.pid === pid);
    expect(landed?.toTid).not.toBe(weakest.tid);
  });
});

describe("runAIFreeAgency poolMinOvr", () => {
  // The post-trim mop-up (offseason step 6.05) passes MOP_UP_MIN_OVR so it takes
  // the elite tail out of the pool and leaves the rest for the user. Without a
  // floor it does not thin the pool, it empties it: ~25 good free agents a year
  // against 626 clubs clears every time, whatever quality bar is used.
  const freeUp = (league: ReturnType<typeof makeLeague>, count: number) => {
    const donor = league.teams[1];
    const pids = donor.roster.slice(0, count);
    const teams = league.teams.map((t) =>
      t.tid === donor.tid ? { ...t, roster: t.roster.filter((p) => !pids.includes(p)) } : t,
    );
    const order = teams.map((t) => t.tid).filter((tid) => tid !== league.meta.userTid);
    return { pids, teams, order };
  };

  it("signs nobody below the floor, and still takes those above it", () => {
    const league = makeLeague(0, 1);
    const { pids: [elitePid, fillerPid], teams, order } = freeUp(league, 2);
    const players = league.players.map((p) =>
      p.pid === elitePid ? { ...p, ovr: 95 } : p.pid === fillerPid ? { ...p, ovr: 55 } : p,
    );
    const out = runAIFreeAgency(
      teams, players, 2, mulberry32(1), league.meta.userTid, order, [], "random", 80,
    );
    const signed = new Set(out.signings.map((s) => s.pid));
    expect(signed.has(elitePid)).toBe(true);
    expect(signed.has(fillerPid)).toBe(false);
  });

  it("defaults to no floor, so the step-4 pass is unchanged", () => {
    const league = makeLeague(0, 1);
    const { pids: [pid], teams, order } = freeUp(league, 1);
    const players = league.players.map((p) => (p.pid === pid ? { ...p, ovr: 55 } : p));
    const out = runAIFreeAgency(
      teams, players, 2, mulberry32(1), league.meta.userTid, order, [], "random",
    );
    expect(out.signings.some((s) => s.pid === pid)).toBe(true);
  });
});
