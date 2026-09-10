import { describe, it, expect, beforeAll } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { playSeason } from "../helpers/offseasonLeague.js";
import { simOffseason } from "../../src/core/offseason.js";
import {
  freeAgentPids, signTrialist, trialSigningsLeft, ensureUserRosterSafety,
} from "../../src/core/freeAgency.js";
import { academyFacilitiesBonus } from "../../src/core/players/academyFacilities.js";
import { switchClub } from "../../src/core/manager/switchClub.js";
import { beginAutopilot } from "../../src/core/autopilot.js";
import {
  YOUTH_TRIAL_GROUP_MIN, YOUTH_TRIAL_GROUP_MAX, YOUTH_TRIAL_SIGN_LIMIT,
  SCOUTING_SPEND_MAX, HYPE_MAX, YOUTH_AGE, ROSTER_SAFETY_FLOOR,
} from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * One season plus its offseason, which is what lays out a trial group.
 *
 * Goes through `playSeason` rather than calling `simThrough` once: it HALTS
 * before the user's own cup final, so a single call finishes a season only when
 * his club happens not to reach one. Handed a league still in the regular
 * phase, `simOffseason` silently does nothing and there is no trial group to
 * assert on — a failure that reads as "the feature is broken" rather than "the
 * season never ended". Third divisions made that reachable on these seeds.
 */
function advance(league: LeagueStore, rng: () => number): LeagueStore {
  return simOffseason(playSeason(league, rng), rng);
}

/**
 * Shallow-freeze the parts of a shared league these tests actually touch, so a
 * test that mutates the fixture in place fails on the line that did it rather
 * than in whichever unrelated test happens to run next.
 *
 * The core is functional by invariant — `test/db/playerIdentity.test.ts` is the
 * gate for it, and the split-storage dirty-set diff depends on the same thing —
 * so in a healthy tree there is nothing here to freeze against. That invariant
 * is exactly what sharing one world across twelve tests now rests on, and this
 * is the cheap way to keep resting on it. Players are left alone: they are only
 * ever read here, and there are 15,650 of them.
 */
function freezeFixture(league: LeagueStore): LeagueStore {
  for (const t of league.teams) {
    Object.freeze(t.roster);
    Object.freeze(t.academyRoster);
    if (t.youthTrialists) Object.freeze(t.youthTrialists);
    Object.freeze(t);
  }
  Object.freeze(league.teams);
  return Object.freeze(league);
}

/**
 * The worlds every test below reads, built ONCE.
 *
 * Each test used to run `advance(createLeagueState(0, mulberry32(4)), rng)` for
 * itself, and all twelve used that same seed — so the file built and simmed the
 * identical 626-club world twelve times over. Measured on CI it was **2,073s in
 * one file**, against a shard wall clock of 2,114s: one runner spent its last
 * twenty-two minutes on this file alone while the rest of it idled, and it was
 * the slowest file in the suite by 2.3x. Nothing about the tests needed that.
 * They want one world; they now share one.
 *
 * `preIntake` is the league as created, before any offseason has run — the
 * containment test needs it to know which pids already existed. `world` is
 * after one season and its offseason, which is where a trial group first
 * appears. `nextWorld` is after a second, which is the only thing any test
 * wanted a continued rng for; running it here rather than in that test keeps
 * the rng out of the tests entirely, so nothing depends on the order they run
 * in.
 */
let preIntake: LeagueStore;
let world: LeagueStore;
let nextWorld: LeagueStore;

beforeAll(() => {
  const rng = mulberry32(4);
  preIntake = createLeagueState(0, rng);
  world = advance(preIntake, rng);
  nextWorld = advance(world, rng);
  freezeFixture(preIntake);
  freezeFixture(world);
  freezeFixture(nextWorld);
});

describe("youth trial group", () => {
  it("hands the user a group to choose from instead of signing his intake for him", () => {
    const user = world.teams.find((t) => t.tid === world.meta.userTid)!;

    expect(user.youthTrialists?.length ?? 0).toBeGreaterThanOrEqual(YOUTH_TRIAL_GROUP_MIN);
    expect(user.youthTrialists!.length).toBeLessThanOrEqual(YOUTH_TRIAL_GROUP_MAX);
    // Nobody is signed: the academy is still empty and no trialist is rostered.
    expect(user.academyRoster).toHaveLength(0);
    expect(user.youthTrialSignings).toBe(0);

    const byPid = new Map(world.players.map((p) => [p.pid, p]));
    for (const pid of user.youthTrialists!) {
      expect(byPid.get(pid)!.born).toBe(world.season - YOUTH_AGE);
    }
  });

  it("holds trialists out of the free-agent pool while the decision is pending", () => {
    // Or an AI club would sign one out from under the user mid-decision, and
    // the free-agent cull would be free to delete him.
    const user = world.teams.find((t) => t.tid === world.meta.userTid)!;
    const fa = freeAgentPids(world.teams, world.players, world.activeLoans);
    for (const pid of user.youthTrialists!) expect(fa.has(pid)).toBe(false);
  });

  it("signs a trialist into the academy and stops at the limit", () => {
    let league = world;
    const tid = league.meta.userTid;

    const group = [...league.teams.find((t) => t.tid === tid)!.youthTrialists!];
    // One more than allowed, so the cap is exercised rather than assumed.
    for (const pid of group.slice(0, YOUTH_TRIAL_SIGN_LIMIT + 1)) {
      const { teams, players } = signTrialist(league.teams, league.players, tid, pid, league.season);
      league = { ...league, teams, players };
    }

    const user = league.teams.find((t) => t.tid === tid)!;
    expect(user.academyRoster).toHaveLength(YOUTH_TRIAL_SIGN_LIMIT);
    expect(trialSigningsLeft(user)).toBe(0);
    // The one over the limit is still on trial, not silently dropped.
    expect(user.youthTrialists).toContain(group[YOUTH_TRIAL_SIGN_LIMIT]);

    // A signed trialist carries academy terms and an academy-stamped history,
    // so his OVR chart starts in the academy rather than with a senior point.
    const signed = league.players.find((p) => p.pid === group[0])!;
    expect(signed.contract.expiresSeason).toBeGreaterThan(league.season);
    expect(signed.hist.every((h) => h.academy)).toBe(true);
  });

  it("keeps an undecided trialist out of the free-agent pool, so the sign limit holds", () => {
    // There is deliberately no "release" action. One existed and was the way
    // round the limit: a declined trialist became a free agent immediately and
    // Free Agents no longer filters by age, so you could sign five to the
    // academy and the other seven straight to the senior roster the same day.
    // Undecided trialists simply stay held until the next rollover.
    const tid = world.meta.userTid;
    const group = world.teams.find((t) => t.tid === tid)!.youthTrialists!;
    const fa = freeAgentPids(world.teams, world.players, world.activeLoans);
    for (const pid of group) expect(fa.has(pid)).toBe(false);
  });

  it("replaces an undecided group at the next offseason rather than accumulating", () => {
    const tid = world.meta.userTid;
    const first = world.teams.find((t) => t.tid === tid)!.youthTrialists!;

    const user = nextWorld.teams.find((t) => t.tid === tid)!;
    // The old group is gone rather than appended to — otherwise a user who
    // never opens the screen accumulates a permanent unsignable holding pool.
    expect(user.youthTrialists!.length).toBeLessThanOrEqual(YOUTH_TRIAL_GROUP_MAX);
    for (const pid of first) expect(user.youthTrialists).not.toContain(pid);
    expect(user.youthTrialSignings).toBe(0);
    // And last year's undecided trialists are signable by anyone now.
    const fa = freeAgentPids(nextWorld.teams, nextWorld.players, nextWorld.activeLoans);
    expect(first.some((pid) => fa.has(pid))).toBe(true);
  });
});

describe("the trial group's containment", () => {
  it("allocates every extra trialist a pid above every other player generated", () => {
    // The property that keeps the rest of the world identical, and it is not
    // cosmetic: developmentBias and isGenerational are hashed off the pid, so
    // an academy taking pids mid-sequence would change which players are
    // wonderkids at all 420 clubs. Verified end-to-end by fingerprinting every
    // non-user rostered player with and without this feature (identical on
    // seeds 4 and 11, 10,375 and 10,326 players); pinned structurally here so
    // a regression shows up without a two-branch measurement.
    const known = new Set(preIntake.players.map((p) => p.pid));
    const fresh = world.players.filter((p) => !known.has(p.pid));
    const trialists = new Set(
      world.teams.find((t) => t.tid === world.meta.userTid)!.youthTrialists!,
    );

    // The user's ordinary intake is drawn inside the main loop and keeps its
    // place in the sequence, so only the top-up sits above everyone else.
    const othersMax = Math.max(
      ...fresh.filter((p) => !trialists.has(p.pid)).map((p) => p.pid),
    );
    const extras = [...trialists].filter((pid) => pid > othersMax);
    expect(extras.length).toBeGreaterThan(0);
    const lowestExtra = Math.min(...extras);
    for (const p of fresh) {
      if (trialists.has(p.pid)) continue;
      expect(p.pid).toBeLessThan(lowestExtra);
    }
  });
});

describe("the roster safety net, once the academy stopped filling itself", () => {
  // Both cases here are crashes in disguise, not cosmetic shortfalls: a roster
  // short of eleven fit players leaves selectXI with empty slots, and the
  // engine then dereferences an undefined player and takes the sim down.
  const stripSquad = (league: LeagueStore, keep: number): LeagueStore => {
    const tid = league.meta.userTid;
    return {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === tid ? { ...t, roster: t.roster.slice(0, keep), academyRoster: [] } : t,
      ),
    };
  };

  it("calls up trialists when the academy is empty", () => {
    const league = stripSquad(world, 5);
    const tid = league.meta.userTid;
    const before = league.teams.find((t) => t.tid === tid)!.youthTrialists!.length;

    const { teams } = ensureUserRosterSafety(
      league.teams, league.players, tid, league.season, league.activeLoans,
    );
    const after = teams.find((t) => t.tid === tid)!;
    expect(after.roster.length).toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
    expect(after.youthTrialists!.length).toBeLessThan(before);
  });

  it("never calls the same player up twice", () => {
    // freeAgentPids reads the caller's teams, which the promotion loop doesn't
    // write back, so an already-promoted player still looks unsigned on the
    // next pass. Duplicating a pid leaves selectXI unable to fill a slot.
    let league = stripSquad(world, 3);
    league = {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === league.meta.userTid ? { ...t, youthTrialists: [] } : t,
      ),
    };

    const { teams } = ensureUserRosterSafety(
      league.teams, league.players, league.meta.userTid, league.season, league.activeLoans,
    );
    const roster = teams.find((t) => t.tid === league.meta.userTid)!.roster;
    expect(roster.length).toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
    expect(new Set(roster).size).toBe(roster.length);
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

describe("a trial group is never stranded on a club the user leaves", () => {
  // The failure this guards is silent and permanent: freeAgentPids counts
  // trialists as rostered, and the offseason only resets the group belonging to
  // the CURRENT userTid. A group left behind is invisible to every signing path
  // for the life of the save, never plays again, and (being high-potential)
  // escapes the free-agent cull too.
  it("clears them when the club is handed to the AI", () => {
    const oldTid = world.meta.userTid;
    const newTid = world.teams.find((t) => t.tid !== oldTid)!.tid;
    const stranded = world.teams.find((t) => t.tid === oldTid)!.youthTrialists!;
    expect(stranded.length).toBeGreaterThan(0);

    const after = switchClub(world, newTid, "left");
    const left = after.teams.find((t) => t.tid === oldTid)!;
    expect(left.youthTrialists ?? []).toEqual([]);
    expect(left.youthTrialSignings ?? 0).toBe(0);
    // ...and they are signable again rather than locked away forever.
    const fa = freeAgentPids(after.teams, after.players, after.activeLoans);
    expect(stranded.some((pid) => fa.has(pid))).toBe(true);
  });

  it("clears them when the club goes on autopilot", () => {
    // During a jump meta.userTid is AUTOPILOT_TID, so the offseason's reset
    // matches no team and the group would survive the whole jump — the user
    // coming back to a page offering twenty-somethings as "youngsters on trial".
    const tid = world.meta.userTid;
    expect(world.teams.find((t) => t.tid === tid)!.youthTrialists!.length).toBeGreaterThan(0);

    const club = beginAutopilot(world).teams.find((t) => t.tid === tid)!;
    expect(club.youthTrialists ?? []).toEqual([]);
    expect(club.youthTrialSignings ?? 0).toBe(0);
  });
});

describe("an emergency call-up off the market is recorded like any other signing", () => {
  it("reports the market arrivals and puts them under the transfer hold", () => {
    // Club-by-season history is rebuilt from league.transfers alone, so an
    // unrecorded free arrival keeps displaying whichever club last had a record
    // for him — the bug the FREE_AGENT_TID sentinel record exists to prevent.
    const tid = world.meta.userTid;
    const league = {
      ...world,
      teams: world.teams.map((t) =>
        t.tid === tid
          ? { ...t, roster: t.roster.slice(0, 3), academyRoster: [], youthTrialists: [] }
          : t,
      ),
    };

    const { teams, players, marketSignings } = ensureUserRosterSafety(
      league.teams, league.players, tid, league.season, league.activeLoans,
    );
    expect(marketSignings.length).toBeGreaterThan(0);
    expect(teams.find((t) => t.tid === tid)!.roster.length)
      .toBeGreaterThanOrEqual(ROSTER_SAFETY_FLOOR);
    for (const pid of marketSignings) {
      expect(players.find((p) => p.pid === pid)!.faSignedSeason).toBe(league.season);
    }
  });

  it("does not report a player called up from inside the club", () => {
    const tid = world.meta.userTid;
    const trial = world.teams.find((t) => t.tid === tid)!.youthTrialists!;
    const thin = {
      ...world,
      teams: world.teams.map((t) =>
        t.tid === tid ? { ...t, roster: t.roster.slice(0, 16) } : t,
      ),
    };

    const { marketSignings } = ensureUserRosterSafety(
      thin.teams, thin.players, tid, thin.season, thin.activeLoans,
    );
    // Own players go first, and they need no transfer record: same club, so the
    // owner such a record would establish is already correct.
    for (const pid of marketSignings) expect(trial).not.toContain(pid);
  });
});
