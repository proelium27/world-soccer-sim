import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generatePlayer } from "../../src/core/players/generate.js";
import {
  resolveAcademyCheckpoints, trimAcademyToCap, projectAcademyCheckpoints, academyDuePids,
} from "../../src/core/academyPipeline.js";
import {
  academyCheckpointExpiry, academyContractTerms, contractTerms,
} from "../../src/core/contracts.js";
import {
  ACADEMY_ROSTER_CAP, ACADEMY_SCHOLARSHIP_AGE, ACADEMY_GRADUATION_AGE, ROSTER_CAP,
  SCOUTING_SPEND_MAX, USER_ACADEMY_ENTRY_AGE, YOUTH_CONTRACT_LENGTH, USER_ACADEMY_INTAKE_MAX,
} from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";
import type { StoredTeam } from "../../src/core/teams/clubs.js";

const SEASON = 10;
const NEXT = SEASON + 1;
const TID = 0;

/**
 * A kid `age` years old in `SEASON`, whose academy deal ends at `expires`.
 * Potentials are set far apart in the ranking tests, so the scouting band's
 * seeded jitter can never reorder them.
 */
function kid(pid: number, age: number, potential: number, expires = SEASON): Player {
  const p = generatePlayer(mulberry32(pid), "CM", 20, pid, age, SEASON);
  return { ...p, potential, contract: { salary: 26_000, expiresSeason: expires } };
}

function team(academy: Player[], seniors = 20): StoredTeam {
  return {
    tid: TID,
    roster: Array.from({ length: seniors }, (_, i) => 10_000 + i),
    academyRoster: academy.map((p) => p.pid),
    scoutingSpend: SCOUTING_SPEND_MAX,
    scoutingObserved: {},
  } as unknown as StoredTeam;
}

describe("academy contracts run to the next checkpoint", () => {
  it("ends a kid's deal the season before each cut", () => {
    expect(academyCheckpointExpiry(SEASON - USER_ACADEMY_ENTRY_AGE, SEASON))
      .toBe(SEASON - USER_ACADEMY_ENTRY_AGE + ACADEMY_SCHOLARSHIP_AGE - 1);
    const sixteen = SEASON - ACADEMY_SCHOLARSHIP_AGE;
    expect(academyCheckpointExpiry(sixteen, SEASON)).toBe(sixteen + ACADEMY_GRADUATION_AGE - 1);
    expect(academyCheckpointExpiry(SEASON - ACADEMY_GRADUATION_AGE, SEASON)).toBeNull();
  });

  it("gives an older prospect an ordinary academy deal", () => {
    expect(academyContractTerms(SEASON, SEASON - 19).expiresSeason).toBe(SEASON + YOUTH_CONTRACT_LENGTH);
    expect(academyContractTerms(SEASON).expiresSeason).toBe(SEASON + YOUTH_CONTRACT_LENGTH);
  });
});

describe("resolveAcademyCheckpoints", () => {
  const best = kid(1, ACADEMY_GRADUATION_AGE - 1, 90);
  const worst = kid(2, ACADEMY_GRADUATION_AGE - 1, 35);
  const scholar = kid(3, ACADEMY_SCHOLARSHIP_AGE - 1, 60);
  const young = kid(4, USER_ACADEMY_ENTRY_AGE, 60, SEASON + 1);
  const players = [best, worst, scholar, young];

  it("promotes the best-scouted graduate into the last senior place and releases the rest", () => {
    const t = team(players, ROSTER_CAP - 1);
    const out = resolveAcademyCheckpoints([t], players, TID, SEASON, NEXT);
    const after = out.teams[0];

    expect(out.promoted).toEqual([best.pid]);
    expect(out.released).toEqual([worst.pid]);
    expect(after.roster).toContain(best.pid);
    expect(after.academyRoster).not.toContain(best.pid);
    expect(after.academyRoster).not.toContain(worst.pid);
    // Promoted onto senior terms, not the stipend.
    const promoted = out.players.find((p) => p.pid === best.pid)!;
    expect(promoted.contract.expiresSeason).toBe(contractTerms(best, NEXT).expiresSeason);
  });

  it("releases every graduate when the senior roster is full", () => {
    const out = resolveAcademyCheckpoints([team(players, ROSTER_CAP)], players, TID, SEASON, NEXT);
    expect(out.promoted).toEqual([]);
    expect(new Set(out.released)).toEqual(new Set([best.pid, worst.pid]));
  });

  it("re-contracts a kid at the scholarship cut to the professional one", () => {
    const out = resolveAcademyCheckpoints([team(players)], players, TID, SEASON, NEXT);
    const renewed = out.players.find((p) => p.pid === scholar.pid)!;
    expect(out.teams[0].academyRoster).toContain(scholar.pid);
    expect(renewed.contract.expiresSeason).toBe(scholar.born + ACADEMY_GRADUATION_AGE - 1);
  });

  it("leaves a kid not yet at a checkpoint untouched, by reference", () => {
    // By reference matters: the save layer's dirty-set diff treats an unchanged
    // object as unchanged (test/db/playerIdentity.test.ts).
    const out = resolveAcademyCheckpoints([team(players)], players, TID, SEASON, NEXT);
    expect(out.players.find((p) => p.pid === young.pid)).toBe(young);
    expect(out.teams[0].academyRoster).toContain(young.pid);
  });

  it("returns the league unchanged when nobody is due", () => {
    const teams = [team([young])];
    const pool = [young];
    const out = resolveAcademyCheckpoints(teams, pool, TID, SEASON, NEXT);
    expect(out.teams).toBe(teams);
    expect(out.players).toBe(pool);
  });

  it("does nothing for a club nobody manages", () => {
    // A spectator or a jump has no club at userTid, so no academy is touched.
    const teams = [team(players)];
    const out = resolveAcademyCheckpoints(teams, players, -3, SEASON, NEXT);
    expect(out.teams).toBe(teams);
  });
});

describe("trimAcademyToCap", () => {
  it("cuts only kids turning sixteen, lowest-scouted first", () => {
    const low = kid(1, ACADEMY_SCHOLARSHIP_AGE - 1, 30);
    const mid = kid(2, ACADEMY_SCHOLARSHIP_AGE - 1, 50);
    const high = kid(3, ACADEMY_SCHOLARSHIP_AGE - 1, 95);
    // The rest of the academy is a year short of any cut, so none of it is fair game.
    const others = Array.from({ length: ACADEMY_ROSTER_CAP - 1 }, (_, i) =>
      kid(100 + i, USER_ACADEMY_ENTRY_AGE, 99, NEXT + 1));
    const players = [low, mid, high, ...others];

    const { teams, released } = trimAcademyToCap([team(players)], players, TID, SEASON, NEXT);
    expect(new Set(released)).toEqual(new Set([low.pid, mid.pid]));
    expect(teams[0].academyRoster).toContain(high.pid);
    expect(teams[0].academyRoster).toHaveLength(ACADEMY_ROSTER_CAP);
  });

  it("stays over the cap rather than cutting a kid who isn't at a decision", () => {
    const players = Array.from({ length: ACADEMY_ROSTER_CAP + 3 }, (_, i) =>
      kid(200 + i, USER_ACADEMY_ENTRY_AGE, 40, NEXT + 1));
    const teams = [team(players)];
    const out = trimAcademyToCap(teams, players, TID, SEASON, NEXT);
    expect(out.released).toEqual([]);
    expect(out.teams).toBe(teams);
  });
});

describe("projectAcademyCheckpoints", () => {
  it("previews the promotions the rollover makes", () => {
    const players = [
      kid(1, ACADEMY_GRADUATION_AGE - 1, 90),
      kid(2, ACADEMY_GRADUATION_AGE - 1, 35),
    ];
    const t = team(players, ROSTER_CAP - 1);
    const preview = projectAcademyCheckpoints(t, players, SEASON);
    const resolved = resolveAcademyCheckpoints([t], players, TID, SEASON, NEXT);

    for (const pid of resolved.promoted) expect(preview.get(pid)!.outcome).toBe("promote");
    for (const pid of resolved.released) expect(preview.get(pid)!.outcome).toBe("release");
  });

  it("marks the lowest-scouted kids at the scholarship cut at risk when the next intake would overfill the academy", () => {
    const low = kid(1, ACADEMY_SCHOLARSHIP_AGE - 1, 30);
    const high = kid(2, ACADEMY_SCHOLARSHIP_AGE - 1, 95);
    // Full enough that a maximum intake pushes it one over the cap.
    const others = Array.from(
      { length: ACADEMY_ROSTER_CAP - USER_ACADEMY_INTAKE_MAX - 1 },
      (_, i) => kid(100 + i, USER_ACADEMY_ENTRY_AGE, 60, NEXT + 1),
    );
    const players = [low, high, ...others];
    const preview = projectAcademyCheckpoints(team(players), players, SEASON);

    expect(preview.get(low.pid)!.outcome).toBe("atRisk");
    expect(preview.get(high.pid)!.outcome).toBe("keep");
    expect(preview.size).toBe(academyDuePids(team(players), players, SEASON).size);
  });
});
