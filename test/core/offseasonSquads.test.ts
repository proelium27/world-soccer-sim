/**
 * Offseason: youth intake and free agency.
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
import { isFreeAgentTid } from "../../src/core/transfers/negotiation.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { playFullSeason } from "../helpers/offseasonLeague.js";
import {
  NUM_TEAMS, YOUTH_AGE,
} from "../../src/core/constants.js";

describe("simOffseason — youth intake and free agency", () => {
  /**
   * One seed-5 offseason, shared by the three youth-intake cases below.
   *
   * They opened with the identical three lines — mulberry32(5),
   * playFullSeason, simOffseason — and the sim is deterministic, so all three
   * were building byte-identical leagues at roughly 55s each to make three
   * different assertions about the same result. Nothing here mutates it.
   *
   * Lazy rather than a beforeAll so that running one test by name still pays
   * for exactly one season. This shares a run *within* a describe block; it
   * does not touch the file split the header above describes, which is about
   * CI shard parallelism and stays as it is.
   */
  let seed5: LeagueStore | null = null;
  const youthIntakeOffseason = (): LeagueStore => {
    if (!seed5) {
      const rng = mulberry32(5);
      seed5 = simOffseason(playFullSeason(rng), rng);
    }
    return seed5;
  };

  it("youth intake adds new players at YOUTH_AGE to every club", () => {
    const next = youthIntakeOffseason();

    const intake = next.players.filter((p) => next.season - p.born === YOUTH_AGE);
    expect(intake.length).toBeGreaterThanOrEqual(NUM_TEAMS * 3);
  });

  it("routes the user's youth intake to the trial list, signing nobody for him", () => {
    // Used to assert the intake landed in academyRoster. It now arrives
    // unsigned on youthTrialists and the user chooses (see YOUTH_TRIAL_*):
    // the assertion moves with the contract rather than being dropped.
    const next = youthIntakeOffseason();

    const userTeam = next.teams.find((t) => t.tid === next.meta.userTid)!;
    const trialists = userTeam.youthTrialists ?? [];
    expect(trialists.length).toBeGreaterThan(0);
    for (const pid of trialists) {
      const p = next.players.find((q) => q.pid === pid)!;
      expect(next.season - p.born).toBe(YOUTH_AGE);
    }
    // Nobody is signed on his behalf, and no trialist leaks onto either squad.
    expect(userTeam.youthTrialSignings).toBe(0);
    for (const pid of trialists) {
      expect(userTeam.academyRoster).not.toContain(pid);
      expect(userTeam.roster).not.toContain(pid);
    }
  });

  it("still lands AI clubs' youth intake straight on the senior roster", () => {
    const next = youthIntakeOffseason();

    const aiTeams = next.teams.filter((t) => t.tid !== next.meta.userTid);
    for (const t of aiTeams) expect(t.academyRoster).toEqual([]);
    // Some youth get trimmed back out immediately by trimRosterSurplus if a
    // club was already at target depth, so check across all AI clubs rather
    // than any single one.
    const intake = aiTeams.flatMap((t) => t.roster).filter((pid) => {
      const p = next.players.find((q) => q.pid === pid);
      return p && next.season - p.born === YOUTH_AGE;
    });
    expect(intake.length).toBeGreaterThan(0);
  });

  it("records every AI free-agent arrival as a fee-0 transfer from the sentinel", () => {
    const rng = mulberry32(31);
    // Deliberately runs a *second* season before checking. After only one
    // season nobody's contract has expired and nobody has retired, so the free
    // pool's only source is collateral from enforceDivisionCeilings releasing a
    // club's weakest man to make room. That used to be plentiful because the
    // transfer market kept selling good players into Division 2 for the sweep
    // to confiscate back; now that stars no longer pour downhill (playerWill.ts
    // / keep-side valuation), sweeps dropped 61 -> 18 in this fixture and the
    // first offseason legitimately has no free agents at all. Season 2 is the
    // steady state this test means to describe.
    let league = playFullSeason(rng);
    league = simOffseason(league, rng);
    league = simThrough(league, "season", rng);
    const next = simOffseason(league, rng);

    const logged = next.transfers.filter(
      (t) => t.season === next.season && isFreeAgentTid(t.fromTid),
    );
    // AI clubs fill holes from the free pool every offseason, so there is
    // always some; each one must be free and land at a real club.
    expect(logged.length).toBeGreaterThan(0);
    for (const t of logged) {
      expect(t.fee).toBe(0);
      expect(next.teams.some((team) => team.tid === t.toTid)).toBe(true);
    }
  });

  it("logs no free signing for a player the same offseason then dropped again", () => {
    const rng = mulberry32(32);
    const league = playFullSeason(rng);
    const next = simOffseason(league, rng);

    // Nothing records a *departure* into free agency, so a signing later undone
    // by trimRosterSurplus would leave the player's history permanently
    // claiming a club he never played for. Every logged arrival must therefore
    // either still hold him, or be followed by a real recorded move.
    const holder = new Map<number, number>();
    for (const team of next.teams) {
      for (const pid of [...team.roster, ...team.academyRoster]) holder.set(pid, team.tid);
    }
    const lastIndex = new Map<number, number>();
    next.transfers.forEach((t, i) => lastIndex.set(t.pid, i));

    const phantoms = next.transfers.filter(
      (t, i) =>
        isFreeAgentTid(t.fromTid) &&
        t.season === next.season &&
        holder.get(t.pid) !== t.toTid &&
        (lastIndex.get(t.pid) ?? i) === i,
    );
    expect(phantoms).toEqual([]);
  });
});
