import { describe, it, expect } from "vitest";
import { makeLeague } from "../../helpers/league.js";
import { enforceDivisionCeilings, landingTierFor } from "../../../src/core/ai/divisionCeiling.js";
import {
  ROSTER_CAP, DIVISION_2_REFUSAL_OVR_THRESHOLD, divisionRefusalOvr,
} from "../../../src/core/constants.js";
import { tierOf, buildCompetitions } from "../../../src/core/competitions.js";
import { createLeagueState } from "../../../src/core/leagueState.js";
import { mulberry32 } from "../../../src/engine/rng.js";

const USER_TID = 0;

describe("landingTierFor", () => {
  it("stops at the deepest division whose own ceiling he does not clear", () => {
    // Under tier 3's bar: he stays put.
    expect(landingTierFor(divisionRefusalOvr(3) - 1, 3)).toBe(3);
    // Over tier 3's but under tier 2's: one division, no further.
    expect(landingTierFor(divisionRefusalOvr(3), 3)).toBe(2);
    // Over both: straight to the top flight, because there is no division in
    // between he would be allowed to stay in.
    expect(landingTierFor(divisionRefusalOvr(2), 3)).toBe(1);
  });

  it("always terminates, because tier 1 has no ceiling", () => {
    // divisionRefusalOvr(1) is Infinity, so no rating walks past the top flight.
    expect(landingTierFor(Number.MAX_SAFE_INTEGER, 3)).toBe(1);
    expect(landingTierFor(Number.MAX_SAFE_INTEGER, 1)).toBe(1);
  });
});

describe("enforceDivisionCeilings", () => {
  it("moves an AI Division 2 player at/above the OVR threshold to a Division 1 club", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: DIVISION_2_REFUSAL_OVR_THRESHOLD };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams, transfers } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const newTeam = teams.find((t) => t.roster.includes(star.pid))!;
    // The receiving pool is every tier-1 club worldwide (not just England's),
    // so the destination competition can be any country's Division 1.
    expect(tierOf(league.competitions, newTeam.compId)).toBe(1);
    expect(newTeam.tid).not.toBe(USER_TID);
    expect(transfers.some((t) => t.pid === star.pid && t.fee > 0)).toBe(true);
  });

  it("charges the buyer the market fee and credits the seller", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: DIVISION_2_REFUSAL_OVR_THRESHOLD };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams, transfers } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const deal = transfers.find((t) => t.pid === star.pid)!;
    const buyerBefore = league.teams.find((t) => t.tid === deal.toTid)!;
    const buyerAfter = teams.find((t) => t.tid === deal.toTid)!;
    const sellerBefore = league.teams.find((t) => t.tid === deal.fromTid)!;
    const sellerAfter = teams.find((t) => t.tid === deal.fromTid)!;

    expect(deal.fee).toBeGreaterThan(0);
    expect(deal.fee).toBeLessThanOrEqual(buyerBefore.budget);
    expect(buyerAfter.budget).toBe(buyerBefore.budget - deal.fee);
    expect(sellerAfter.budget).toBeGreaterThan(sellerBefore.budget);
  });

  it("never pushes the buyer's budget negative even when it can't afford the full fee", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: 90 };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));
    // Impoverish every Division 1 club worldwide (any tier-1 competition,
    // not just England's) so no buyer can afford a 90-ovr fee.
    const teams = league.teams.map((t) =>
      tierOf(league.competitions, t.compId) === 1 ? { ...t, budget: 1000 } : t,
    );

    const { teams: updated, transfers } = enforceDivisionCeilings(
      teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const deal = transfers.find((t) => t.pid === star.pid)!;
    expect(deal.fee).toBe(1000);
    for (const t of updated) expect(t.budget).toBeGreaterThanOrEqual(0);
    // The move itself still happens regardless of affordability.
    expect(tierOf(league.competitions, updated.find((t) => t.roster.includes(star.pid))!.compId)).toBe(1);
  });

  it("leaves a Division 2 player below the threshold in place", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const weak = { ...target, ovr: DIVISION_2_REFUSAL_OVR_THRESHOLD - 1 };
    const players = league.players.map((p) => (p.pid === target.pid ? weak : p));

    const { teams } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const team = teams.find((t) => t.roster.includes(weak.pid))!;
    expect(team.tid).toBe(d2Team.tid);
  });

  it("never moves a player off the user's own Division 2 roster", () => {
    const league = makeLeague(USER_TID, 1);
    const userTeam = league.teams.find((t) => t.tid === USER_TID)!;
    // Force the user's own club into Division 2 for this test.
    const teams = league.teams.map((t) => (t.tid === USER_TID ? { ...t, compId: 1 } : t));
    const target = league.players.find((p) => userTeam.roster.includes(p.pid))!;
    const star = { ...target, ovr: 95 };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams: updated } = enforceDivisionCeilings(
      teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const team = updated.find((t) => t.roster.includes(star.pid))!;
    expect(team.tid).toBe(USER_TID);
  });

  it("never force-adds a player onto the user's Division 1 roster", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: 95 };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const userTeam = teams.find((t) => t.tid === USER_TID)!;
    expect(userTeam.roster.includes(star.pid)).toBe(false);
  });

  it("releases the receiving club's weakest player if it's already at ROSTER_CAP", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: 90 };
    let players = league.players.map((p) => (p.pid === target.pid ? star : p));

    // Pad the weakest Division 1 club worldwide (whichever ends up as the buyer) to ROSTER_CAP.
    const d1TeamsByOvr = league.teams
      .filter((t) => tierOf(league.competitions, t.compId) === 1 && t.tid !== USER_TID)
      .map((t) => {
        const ovrs = t.roster.map((pid) => league.players.find((p) => p.pid === pid)!.ovr);
        return { tid: t.tid, avg: ovrs.reduce((s, o) => s + o, 0) / ovrs.length };
      })
      .sort((a, b) => a.avg - b.avg);
    const weakestD1Tid = d1TeamsByOvr[0].tid;

    let nextPid = Math.max(...players.map((p) => p.pid)) + 1;
    const padPids: number[] = [];
    const filler = { ...league.players[0] };
    while (
      (league.teams.find((t) => t.tid === weakestD1Tid)!.roster.length + padPids.length) < ROSTER_CAP
    ) {
      const pid = nextPid++;
      players.push({ ...filler, pid, ovr: 1, pos: star.pos });
      padPids.push(pid);
    }
    const teams = league.teams.map((t) =>
      t.tid === weakestD1Tid ? { ...t, roster: [...t.roster, ...padPids] } : t,
    );
    expect(teams.find((t) => t.tid === weakestD1Tid)!.roster.length).toBe(ROSTER_CAP);

    const { teams: updated } = enforceDivisionCeilings(
      teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    const buyer = updated.find((t) => t.roster.includes(star.pid))!;
    expect(buyer.roster.length).toBeLessThanOrEqual(ROSTER_CAP);
  });

  it("never sweeps a player who is out on loan (a borrowed D2 player would be duplicated on loan return)", () => {
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    // Comfortably above the threshold — without the loan flag he'd be swept
    // (see the first test in this file), so this proves the guard, not luck.
    const star = { ...target, ovr: DIVISION_2_REFUSAL_OVR_THRESHOLD + 5 };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));
    // He's only on this D2 club on loan — owned by someone else, due back next
    // season — so the sweep must leave him where he is.
    const activeLoans = [{
      pid: star.pid, parentTid: -1, loaneeTid: d2Team.tid,
      startSeason: league.season, seasons: 1 as const, returnSeason: league.season + 1, fee: 0,
    }];

    const { teams, transfers } = enforceDivisionCeilings(
      league.teams, players, activeLoans, league.transfers, league.season, USER_TID, league.competitions,
    );
    expect(teams.find((t) => t.roster.includes(star.pid))!.tid).toBe(d2Team.tid);
    expect(transfers.some((t) => t.pid === star.pid)).toBe(false);
  });

  it("leaves the arrays it was handed untouched", () => {
    // Replaces a determinism test that could not fail: enforceDivisionCeilings
    // draws no rng at all (no rng argument, no Math.random, no hashInts), so
    // calling it twice with identical arguments was comparing a pure function's
    // output to itself. Non-mutation is the property actually worth guarding
    // here — the sweep rewrites rosters, and the split-player-storage dirty
    // diff (see test/db/playerIdentity.test.ts) detects a changed player by
    // object identity, so an in-place edit here would be silently never saved.
    const league = makeLeague(USER_TID, 1);
    const d2Team = league.teams.find((t) => t.compId === 1 && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d2Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: 88 };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const teamsBefore = JSON.parse(JSON.stringify(league.teams));
    const playersBefore = JSON.parse(JSON.stringify(players));

    const out = enforceDivisionCeilings(league.teams, players, league.activeLoans, league.transfers, league.season, USER_TID, league.competitions);

    // The sweep did something, or the assertions below are vacuous.
    expect(out.teams).not.toEqual(league.teams);
    expect(league.teams).toEqual(teamsBefore);
    expect(players).toEqual(playersBefore);
  });

  // A three-division world, deliberately tiny (8 clubs a division) so the whole
  // case costs a fraction of a second rather than a full world generation.
  function threeTierLeague() {
    const competitions = buildCompetitions([
      { country: "Deepland", divisions: 3, d1Teams: 8, d2Teams: 8, d3Teams: 8 },
    ]);
    return createLeagueState(USER_TID, mulberry32(7), 7, "normal", competitions);
  }

  it("sweeps a third-division player one division up, not straight to the top flight", () => {
    const league = threeTierLeague();
    const d3 = league.competitions.find((c) => c.tier === 3)!;
    const d3Team = league.teams.find((t) => t.compId === d3.id && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d3Team.roster.includes(p.pid))!;
    // Over tier 3's bar but under tier 2's, so exactly one hop is warranted.
    const ovr = Math.floor((divisionRefusalOvr(3) + divisionRefusalOvr(2)) / 2);
    expect(ovr).toBeGreaterThanOrEqual(divisionRefusalOvr(3));
    expect(ovr).toBeLessThan(divisionRefusalOvr(2));
    const star = { ...target, ovr };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season,
      USER_TID, league.competitions,
    );
    const landed = teams.find((t) => t.roster.includes(star.pid))!;
    expect(tierOf(league.competitions, landed.compId)).toBe(2);
  });

  it("carries a player over EVERY tier's bar all the way up in one pass", () => {
    const league = threeTierLeague();
    const d3 = league.competitions.find((c) => c.tier === 3)!;
    const d3Team = league.teams.find((t) => t.compId === d3.id && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d3Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: divisionRefusalOvr(2) };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season,
      USER_TID, league.competitions,
    );
    // This is what the deepest-first pass order buys. Shallowest-first would
    // leave him in tier 2 for a whole extra season, which is the drift the
    // ceiling exists to prevent.
    const landed = teams.find((t) => t.roster.includes(star.pid))!;
    expect(tierOf(league.competitions, landed.compId)).toBe(1);
  });

  it("records that as ONE transfer, and leaves the division it passed over untouched", () => {
    // A sweep spanning two divisions used to log a transfer and bank a fee per
    // rung, which is the one place in the game a player still changed clubs
    // twice inside a single window (see movedThisWindow). The intermediate club
    // could not affect where he ended up — the receiving pool is drawn from the
    // seller's country, which never changes on the way up — so it was an
    // artifact of the loop, and one that pocketed the difference between a
    // second-tier fee and a top-flight one for holding him no time at all.
    const league = threeTierLeague();
    const d3 = league.competitions.find((c) => c.tier === 3)!;
    const d2 = league.competitions.find((c) => c.tier === 2)!;
    const d3Team = league.teams.find((t) => t.compId === d3.id && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d3Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: divisionRefusalOvr(2) };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams, transfers } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season,
      USER_TID, league.competitions,
    );

    const his = transfers.filter((t) => t.pid === star.pid);
    expect(his).toHaveLength(1);
    expect(his[0].fromTid).toBe(d3Team.tid);
    expect(tierOf(league.competitions, teams.find((t) => t.tid === his[0].toTid)!.compId)).toBe(1);

    // No second-division club paid for him, was paid for him, or briefly held
    // him — the money is one payment from the club that actually got him.
    const d2Before = new Map(
      league.teams.filter((t) => t.compId === d2.id).map((t) => [t.tid, t]),
    );
    for (const after of teams.filter((t) => t.compId === d2.id)) {
      const before = d2Before.get(after.tid)!;
      expect(after.budget).toBe(before.budget);
      expect(after.roster).toEqual(before.roster);
    }
  });

  it("leaves a third-division player below his own tier's bar where he is", () => {
    const league = threeTierLeague();
    const d3 = league.competitions.find((c) => c.tier === 3)!;
    const d3Team = league.teams.find((t) => t.compId === d3.id && t.tid !== USER_TID)!;
    const target = league.players.find((p) => d3Team.roster.includes(p.pid))!;
    const star = { ...target, ovr: divisionRefusalOvr(3) - 1 };
    const players = league.players.map((p) => (p.pid === target.pid ? star : p));

    const { teams } = enforceDivisionCeilings(
      league.teams, players, league.activeLoans, league.transfers, league.season,
      USER_TID, league.competitions,
    );
    const landed = teams.find((t) => t.roster.includes(star.pid))!;
    expect(landed.tid).toBe(d3Team.tid);
  });
});
