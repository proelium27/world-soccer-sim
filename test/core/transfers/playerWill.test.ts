import { describe, it, expect } from "vitest";
import {
  statureSensitivity, refusesMove, moveAppeal, settledMultiplier, joinedSeasons,
  refusesFreeAgentSigning, refusesFreeAgentSigningWith,
} from "../../../src/core/transfers/playerWill.js";
import { clubStatures } from "../../../src/core/ai/clubContext.js";
import type { Player } from "../../../src/core/players/types.js";
import type { StoredTeam } from "../../../src/core/teams/clubs.js";
import {
  PLAYER_WILL_CARE_FLOOR, PLAYER_WILL_CARE_CEILING, PLAYER_SETTLED_SEASONS,
} from "../../../src/core/constants.js";

describe("statureSensitivity", () => {
  it("is zero for a squad player and full for a star", () => {
    expect(statureSensitivity(PLAYER_WILL_CARE_FLOOR - 5)).toBe(0);
    expect(statureSensitivity(PLAYER_WILL_CARE_CEILING + 5)).toBe(1);
  });

  it("ramps monotonically in between", () => {
    const mid = (PLAYER_WILL_CARE_FLOOR + PLAYER_WILL_CARE_CEILING) / 2;
    const low = statureSensitivity(PLAYER_WILL_CARE_FLOOR + 1);
    const high = statureSensitivity(PLAYER_WILL_CARE_CEILING - 1);
    expect(low).toBeLessThan(statureSensitivity(mid));
    expect(statureSensitivity(mid)).toBeLessThan(high);
  });
});

describe("moveAppeal", () => {
  it("leaves a squad player indifferent to club size", () => {
    // The whole point of the care ramp: a fringe player takes the game time.
    const fringe = PLAYER_WILL_CARE_FLOOR - 1;
    expect(moveAppeal(fringe, 0.9, 0.1)).toBe(1);
    expect(refusesMove(fringe, 0.9, 0.1)).toBe(false);
  });

  it("refuses a star a big step down, whatever the money", () => {
    // This is the Mbappe-to-Sociedad case the module exists to stop.
    expect(refusesMove(85, 0.9, 0.2)).toBe(true);
    expect(moveAppeal(85, 0.9, 0.2)).toBe(0);
  });

  it("still allows a star a sideways or upward move", () => {
    expect(refusesMove(85, 0.7, 0.7)).toBe(false);
    expect(moveAppeal(85, 0.7, 0.7)).toBeGreaterThanOrEqual(1);
    // A genuine step up is actively attractive.
    expect(moveAppeal(85, 0.5, 0.9)).toBeGreaterThan(1);
  });

  it("penalises a small step down without forbidding it", () => {
    const appeal = moveAppeal(80, 0.62, 0.55);
    expect(appeal).toBeGreaterThan(0);
    expect(appeal).toBeLessThan(1);
  });

  it("is harsher on a better player for the same step down", () => {
    const good = moveAppeal(70, 0.6, 0.5);
    const great = moveAppeal(80, 0.6, 0.5);
    expect(great).toBeLessThan(good);
  });
});

describe("settledMultiplier", () => {
  it("treats a player who never moved as fully settled", () => {
    expect(settledMultiplier(undefined, 10)).toBe(1);
  });

  it("charges the most for a player who just arrived, decaying to nothing", () => {
    const justArrived = settledMultiplier(10, 10);
    const oneOn = settledMultiplier(10, 11);
    expect(justArrived).toBeGreaterThan(1);
    expect(oneOn).toBeLessThan(justArrived);
    expect(oneOn).toBeGreaterThan(1);
    expect(settledMultiplier(10, 10 + PLAYER_SETTLED_SEASONS)).toBe(1);
  });
});

describe("joinedSeasons", () => {
  it("takes each player's most recent permanent move", () => {
    const joined = joinedSeasons([
      { pid: 1, season: 4 },
      { pid: 1, season: 7 },
      { pid: 2, season: 5 },
    ]);
    expect(joined.get(1)).toBe(7);
    expect(joined.get(2)).toBe(5);
  });

  it("ignores loans and loan returns, which don't change who owns him", () => {
    const joined = joinedSeasons([
      { pid: 1, season: 3 },
      { pid: 1, season: 6, loanSeasons: 2 },
      { pid: 1, season: 8, loanReturn: true },
    ]);
    expect(joined.get(1)).toBe(3);
  });
});

describe("refusesFreeAgentSigning", () => {
  // The pool is stocked by trimRosterSurplus, which releases whoever a club is
  // deepest at rather than whoever is bad — so it routinely holds players
  // better than the club shopping for them. Before this gate a free transfer
  // was the one route around the whole module.
  const bigTid = 1;
  const smallTid = 2;
  // A second weak club, so a case can put his last club and the buyer at the
  // same LEVEL without them being the same CLUB — which would trip the
  // rejoin-your-own-club exemption and mask what the case is testing.
  const otherSmallTid = 3;

  /** Two weak clubs and one strong, hyped one, plus a single free agent. */
  const world = (faOvr: number, lastTid: number | null) => {
    const mk = (pid: number, ovr: number): Player => ({
      pid, name: `p${pid}`, pos: "CM", nationality: "England", born: 0, ovr,
      potential: ovr, ratings: {} as never, contract: { salary: 1, expiresSeason: 9 },
      stats: [], hist: [],
    } as unknown as Player);
    const team = (tid: number, hype: number) =>
      ({ tid, hype, roster: [] as number[] } as unknown as StoredTeam);
    const big = team(bigTid, 90);
    const small = team(smallTid, 5);
    const otherSmall = team(otherSmallTid, 5);
    const players: Player[] = [];
    const fill = (t: StoredTeam, base: number, ovr: number) => {
      for (let i = 0; i < 20; i++) { const p = mk(base + i, ovr); t.roster.push(p.pid); players.push(p); }
    };
    // 82, not 88: clubStature blends squad strength with hype, and a squad of
    // 88s on hype 90 measures ~0.94 — stronger than any club a real world ever
    // produces (measured max 0.763 fresh, 0.831 five seasons in). An unrealistic
    // ceiling here hides exactly the bug the cap exists to fix, because the
    // uncapped ability of 1.0 is already reachable.
    fill(big, 100, 82);
    fill(small, 200, 45);
    fill(otherSmall, 300, 45);
    const fa = mk(999, faOvr);
    // The stats line is how a free agent's last club is recovered at all.
    if (lastTid != null) (fa as { stats: { tid: number }[] }).stats = [{ tid: lastTid } as never];
    players.push(fa);
    return { teams: [big, small, otherSmall], players, fa, big, small, otherSmall };
  };

  it("keeps a star released by a big club out of a small one", () => {
    const w = world(PLAYER_WILL_CARE_CEILING + 5, bigTid);
    expect(refusesFreeAgentSigning(w.fa, w.small, w.teams, w.players)).toBe(true);
  });

  it("lets that same star join a club of his own level", () => {
    const w = world(PLAYER_WILL_CARE_CEILING + 5, bigTid);
    expect(refusesFreeAgentSigning(w.fa, w.big, w.teams, w.players)).toBe(false);
  });

  it("leaves a squad filler free to join anyone", () => {
    // The care ramp, not a special case: a fringe player takes the game time.
    const w = world(PLAYER_WILL_CARE_FLOOR - 1, bigTid);
    expect(refusesFreeAgentSigning(w.fa, w.small, w.teams, w.players)).toBe(false);
  });

  it("judges a player with no senior career on his ability alone", () => {
    // He still has a level even with nowhere to have played it. On the save
    // that prompted this an 81-rated free agent had no club on record and
    // signed for a third-division side; ability is what stops that.
    const w = world(PLAYER_WILL_CARE_CEILING + 5, null);
    expect(refusesFreeAgentSigning(w.fa, w.small, w.teams, w.players)).toBe(true);
    expect(refusesFreeAgentSigning(w.fa, w.big, w.teams, w.players)).toBe(false);
  });

  it("takes the higher of his last club and his ability, not just the last club", () => {
    // The hole this closes, measured on a real save: an 85-rated free agent
    // had last played for a club of stature 0.158, so joining a second-division
    // side read as a step UP and nothing gated it. Good players sit at small
    // clubs, especially in a world whose pool is stocked by clubs releasing
    // whoever they are deepest at.
    // A DIFFERENT small club, or the rejoin-your-own-club exemption fires and
    // hides the thing under test.
    const w = world(PLAYER_WILL_CARE_CEILING + 5, smallTid);
    expect(refusesFreeAgentSigning(w.fa, w.otherSmall, w.teams, w.players)).toBe(true);
  });

  it("leaves the best player alive signable by the best club there is", () => {
    // abilityStature reaches 1.0 at ovr 89 while the strongest club in a fresh
    // 626-club world measures 0.763, so uncapped an 89+ free agent needed a
    // 0.82 club and there was none — he was refused by every club in the game,
    // on a world whose best players are 90-91. The cap is the world's own
    // maximum, so somewhere will always have him.
    // A separate world per half, so neither reading is masked by the
    // rejoin-your-own-club exemption below.
    const up = world(99, smallTid);
    expect(refusesFreeAgentSigning(up.fa, up.big, up.teams, up.players)).toBe(false);
    // ...and he still won't drop to the bottom of the pyramid.
    const down = world(99, bigTid);
    expect(refusesFreeAgentSigning(down.fa, down.small, down.teams, down.players)).toBe(true);
  });

  it("lets a club re-sign a player whose contract it just let lapse", () => {
    // `max(lastClub, ability)` otherwise makes this impossible by construction
    // whenever he outgrew the club: a mid-table side that develops a star and
    // forgets to extend him could never take him back, while an AI club could.
    // Nobody refuses to stay where he already is.
    const w = world(PLAYER_WILL_CARE_CEILING + 5, smallTid);
    expect(refusesFreeAgentSigning(w.fa, w.small, w.teams, w.players)).toBe(false);
  });

  it("agrees with the precomputed-stature form, which is what listing pages use", () => {
    // Two implementations of one rule is exactly how a page and the action
    // behind its button start disagreeing.
    const w = world(PLAYER_WILL_CARE_CEILING + 5, bigTid);
    const statures = clubStatures(w.teams, w.players);
    for (const buyer of w.teams) {
      expect(refusesFreeAgentSigningWith(w.fa, statures.get(buyer.tid)!, statures))
        .toBe(refusesFreeAgentSigning(w.fa, buyer, w.teams, w.players));
    }
  });
});
