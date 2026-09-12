import { describe, it, expect, beforeAll } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { playSeason } from "../helpers/offseasonLeague.js";
import { simOffseason } from "../../src/core/offseason.js";
import { freeAgentPids, ensureUserRosterSafety } from "../../src/core/freeAgency.js";
import { academyFacilitiesBonus } from "../../src/core/players/academyFacilities.js";
import {
  USER_ACADEMY_INTAKE_MIN, USER_ACADEMY_INTAKE_MAX, USER_ACADEMY_ENTRY_AGE,
  ACADEMY_SCHOLARSHIP_AGE, ACADEMY_GRADUATION_AGE, ACADEMY_ROSTER_CAP,
  SCOUTING_SPEND_MAX, HYPE_MAX, ROSTER_SAFETY_FLOOR,
} from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { Player } from "../../src/core/players/types.js";

/**
 * One season plus its offseason, which is what brings an academy intake in.
 *
 * Goes through `playSeason` rather than calling `simThrough` once: it HALTS
 * before the user's own cup final, so a single call finishes a season only when
 * his club happens not to reach one. Handed a league still in the regular
 * phase, `simOffseason` silently does nothing and there is no intake to assert
 * on — a failure that reads as "the feature is broken" rather than "the season
 * never ended".
 */
function advance(league: LeagueStore, rng: () => number): LeagueStore {
  return simOffseason(playSeason(league, rng), rng);
}

/**
 * Shallow-freeze the parts of a shared league these tests actually touch, so a
 * test that mutates the fixture in place fails on the line that did it rather
 * than in whichever unrelated test happens to run next. The core is functional
 * by invariant (`test/db/playerIdentity.test.ts`), which is exactly what sharing
 * one world across these tests rests on.
 */
function freezeFixture(league: LeagueStore): LeagueStore {
  for (const t of league.teams) {
    Object.freeze(t.roster);
    Object.freeze(t.academyRoster);
    Object.freeze(t);
  }
  Object.freeze(league.teams);
  return Object.freeze(league);
}

/**
 * The worlds every test below reads, built ONCE, off one seed.
 *
 * This file used to build and sim the identical world once per test, which made
 * it the slowest file in the suite by 2.3x (see CLAUDE.md, CI shards (g)). Three
 * offseasons are what the academy needs to show its whole shape: `world` has
 * the first intake at USER_ACADEMY_ENTRY_AGE, `nextWorld` holds it a year older
 * and still undeveloped, and `scholarshipWorld` puts it in front of the
 * scholarship cut.
 */
let preIntake: LeagueStore;
let world: LeagueStore;
let nextWorld: LeagueStore;
let scholarshipWorld: LeagueStore;

beforeAll(() => {
  const rng = mulberry32(4);
  preIntake = createLeagueState(0, rng);
  world = advance(preIntake, rng);
  nextWorld = advance(world, rng);
  scholarshipWorld = advance(nextWorld, rng);
  freezeFixture(preIntake);
  freezeFixture(world);
  freezeFixture(nextWorld);
  freezeFixture(scholarshipWorld);
});

const userTeam = (l: LeagueStore) => l.teams.find((t) => t.tid === l.meta.userTid)!;
const byPidOf = (l: LeagueStore) => new Map(l.players.map((p) => [p.pid, p]));

/** The kids who arrived at `l`'s last rollover: USER_ACADEMY_ENTRY_AGE and new. */
function intakeOf(l: LeagueStore, before: LeagueStore): Player[] {
  const known = new Set(before.players.map((p) => p.pid));
  const byPid = byPidOf(l);
  const team = userTeam(l);
  return [...team.academyRoster, ...team.roster]
    .map((pid) => byPid.get(pid)!)
    .filter((p) => !known.has(p.pid) && l.season - p.born === USER_ACADEMY_ENTRY_AGE);
}

describe("the academy fills itself", () => {
  it("enrols the yearly intake straight into the academy at the entry age", () => {
    const intake = intakeOf(world, preIntake);
    expect(intake.length).toBeGreaterThanOrEqual(USER_ACADEMY_INTAKE_MIN);
    expect(intake.length).toBeLessThanOrEqual(USER_ACADEMY_INTAKE_MAX);

    const academy = new Set(userTeam(world).academyRoster);
    for (const p of intake) {
      expect(academy.has(p.pid)).toBe(true);
      // The first deal runs to the season before the scholarship cut, which is
      // what puts him in front of it at exactly the right rollover.
      expect(p.contract.expiresSeason).toBe(p.born + ACADEMY_SCHOLARSHIP_AGE - 1);
      // His history starts in the academy rather than with a senior point.
      expect(p.hist.every((h) => h.academy)).toBe(true);
    }
  });

  it("holds academy kids out of the free-agent pool", () => {
    const fa = freeAgentPids(world.teams, world.players, world.activeLoans);
    for (const pid of userTeam(world).academyRoster) expect(fa.has(pid)).toBe(false);
  });

  it("allocates the academy's extra kids pids above every other player generated", () => {
    // The property that keeps the rest of the world identical, and it is not
    // cosmetic: developmentBias and isGenerational are hashed off the pid, so an
    // academy taking pids mid-sequence would change which players are wonderkids
    // at every other club. The user's ordinary intake is drawn inside the main
    // loop and keeps its place in the sequence, so only the top-up sits above.
    const known = new Set(preIntake.players.map((p) => p.pid));
    const fresh = world.players.filter((p) => !known.has(p.pid));
    const intake = new Set(intakeOf(world, preIntake).map((p) => p.pid));

    const othersMax = Math.max(...fresh.filter((p) => !intake.has(p.pid)).map((p) => p.pid));
    const extras = [...intake].filter((pid) => pid > othersMax);
    expect(extras.length).toBeGreaterThan(0);
    const lowestExtra = Math.min(...extras);
    for (const p of fresh) {
      if (!intake.has(p.pid)) expect(p.pid).toBeLessThan(lowestExtra);
    }
  });

  it("adds the next intake without releasing the last one", () => {
    const first = intakeOf(world, preIntake);
    const second = intakeOf(nextWorld, world);
    expect(second.length).toBeGreaterThanOrEqual(USER_ACADEMY_INTAKE_MIN);

    const team = userTeam(nextWorld);
    const squad = new Set([...team.academyRoster, ...team.roster]);
    // Nobody in the first intake has reached a checkpoint, so nobody left.
    for (const p of first) expect(squad.has(p.pid)).toBe(true);
  });

  it("holds a kid's ratings still until the age development starts", () => {
    // The whole reason the academy can take kids younger than the world's
    // YOUTH_AGE: a kid generated at 14 is generated off the same base as a
    // 16-year-old, so letting him develop from 14 would hand every graduate two
    // growth years nobody else gets.
    const before = byPidOf(world);
    const after = byPidOf(nextWorld);
    const checked = intakeOf(world, preIntake);
    expect(checked.length).toBeGreaterThan(0);
    for (const kid of checked) {
      const later = after.get(kid.pid)!;
      expect(later.ratings).toEqual(before.get(kid.pid)!.ratings);
      expect(later.ovr).toBe(before.get(kid.pid)!.ovr);
    }
  });
});

describe("the scholarship cut, through a real offseason", () => {
  it("re-contracts kids reaching it rather than letting their deal lapse", () => {
    // Their first deal expired at this rollover. The failure this guards is
    // silent: without the checkpoint the ordinary expiry sweep releases the
    // whole year into free agency and nothing says so.
    const first = intakeOf(world, preIntake);
    const team = userTeam(scholarshipWorld);
    const academy = new Set(team.academyRoster);
    const roster = new Set(team.roster);
    const byPid = byPidOf(scholarshipWorld);

    let kept = 0;
    for (const kid of first) {
      const now = byPid.get(kid.pid)!;
      expect(scholarshipWorld.season - now.born).toBe(ACADEMY_SCHOLARSHIP_AGE);
      if (academy.has(kid.pid)) {
        kept++;
        expect(now.contract.expiresSeason).toBe(now.born + ACADEMY_GRADUATION_AGE - 1);
      } else if (!roster.has(kid.pid)) {
        // Released: only ever because the academy was full, which the cut
        // leaves it at.
        expect(team.academyRoster.length).toBeGreaterThanOrEqual(ACADEMY_ROSTER_CAP);
      }
    }
    expect(kept).toBeGreaterThan(0);
  });
});

describe("the roster safety net", () => {
  // Both cases here are crashes in disguise, not cosmetic shortfalls: a roster
  // short of eleven fit players leaves selectXI with empty slots, and the
  // engine then dereferences an undefined player and takes the sim down.
  const strip = (league: LeagueStore, keep: number, academy = true): LeagueStore => ({
    ...league,
    teams: league.teams.map((t) =>
      t.tid === league.meta.userTid
        ? { ...t, roster: t.roster.slice(0, keep), academyRoster: academy ? t.academyRoster : [] }
        : t,
    ),
  });

  it("calls up academy kids before anyone off the market", () => {
    const league = strip(world, 5);
    const tid = league.meta.userTid;
    const before = userTeam(league).academyRoster.length;

    const { teams } = ensureUserRosterSafety(
      league.teams, league.players, tid, league.season, league.activeLoans,
    );
    const after = teams.find((t) => t.tid === tid)!;
    expect(after.roster.length).toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
    expect(after.academyRoster.length).toBeLessThan(before);
  });

  it("never calls the same player up twice", () => {
    // freeAgentPids reads the caller's teams, which the promotion loop doesn't
    // write back, so an already-promoted player still looks unsigned on the
    // next pass. Duplicating a pid leaves selectXI unable to fill a slot.
    const league = strip(world, 3, false);
    const { teams } = ensureUserRosterSafety(
      league.teams, league.players, league.meta.userTid, league.season, league.activeLoans,
    );
    const roster = teams.find((t) => t.tid === league.meta.userTid)!.roster;
    expect(roster.length).toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
    expect(new Set(roster).size).toBe(roster.length);
  });

  it("reports market arrivals and puts them under the transfer hold", () => {
    // Club-by-season history is rebuilt from league.transfers alone, so an
    // unrecorded free arrival keeps displaying whichever club last had a record
    // for him — the bug the FREE_AGENT_TID sentinel record exists to prevent.
    const league = strip(world, 3, false);
    const tid = league.meta.userTid;
    const { teams, players, marketSignings } = ensureUserRosterSafety(
      league.teams, league.players, tid, league.season, league.activeLoans,
    );
    expect(marketSignings.length).toBeGreaterThan(0);
    expect(teams.find((t) => t.tid === tid)!.roster.length).toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
    for (const pid of marketSignings) {
      expect(players.find((p) => p.pid === pid)!.faSignedSeason).toBe(league.season);
    }
  });

  it("does not report a player called up from inside the club", () => {
    const league = strip(world, 16);
    const academy = userTeam(league).academyRoster;
    const { marketSignings } = ensureUserRosterSafety(
      league.teams, league.players, league.meta.userTid, league.season, league.activeLoans,
    );
    // Own players go first, and they need no transfer record: same club, so the
    // owner such a record would establish is already correct.
    for (const pid of marketSignings) expect(academy).not.toContain(pid);
  });
});

describe("academyFacilitiesBonus", () => {
  const team = (scoutingSpend: number, hype: number) =>
    ({ scoutingSpend, hype, academyRoster: [], roster: [] }) as never;

  it("pays nothing at no spend and no hype, and the full swing at both maxed", () => {
    expect(academyFacilitiesBonus(team(0, 0))).toBe(0);
    expect(academyFacilitiesBonus(team(SCOUTING_SPEND_MAX, HYPE_MAX))).toBeCloseTo(6, 5);
  });

  it("is a bonus only — never negative, however badly the club is run", () => {
    // Deliberately out of range on both axes: the anchor and academy form
    // already push downward, and a third penalty would stack on a struggling
    // club's cheapest route back.
    expect(academyFacilitiesBonus(team(-1, -50))).toBe(0);
    expect(academyFacilitiesBonus(team(NaN, NaN))).toBe(0);
  });

  it("caps rather than extrapolating past the top of each range", () => {
    expect(academyFacilitiesBonus(team(SCOUTING_SPEND_MAX * 10, HYPE_MAX * 10)))
      .toBeCloseTo(6, 5);
  });
});
