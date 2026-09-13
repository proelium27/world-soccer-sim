import { describe, it, expect, beforeAll } from "vitest";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import {
  AUTOPILOT_TID, MAX_JUMP_SEASONS, beginAutopilot, clampJumpSeasons, endAutopilot, jumpSeasons,
} from "../../src/core/autopilot.js";
import { FREE_AGENT_TID } from "../../src/core/transfers/negotiation.js";
import {
  ROSTER_CAP, USER_ACADEMY_ENTRY_AGE, USER_ACADEMY_INTAKE_MIN,
} from "../../src/core/constants.js";

describe("autopilot sentinel", () => {
  it("is not a real tid and is not the free-agent sentinel", () => {
    const league = makeLeague(0, 1);
    expect(league.teams.some((t) => t.tid === AUTOPILOT_TID)).toBe(false);
    // -1 is a live value in CompletedTransfer.fromTid/toTid. Reusing it would
    // make "the club the user manages" and "no club at all" the same number.
    expect(AUTOPILOT_TID).not.toBe(FREE_AGENT_TID);
  });

  it("drops the standing instructions the user can't be around to give", () => {
    const league = makeLeague(0, 1);
    const userTid = league.meta.userTid;
    const withOrders: LeagueStore = {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === userTid
          ? {
              ...t,
              starters: t.roster.slice(0, 11),
              transferListed: [t.roster[0]],
              moreMinutes: [t.roster[1]],
            }
          : t,
      ),
      loanListings: [{ pid: league.teams[0].roster[0], seasons: 1 }],
    };

    const handed = beginAutopilot(withOrders);
    const club = handed.teams.find((t) => t.tid === userTid)!;

    expect(handed.meta.userTid).toBe(AUTOPILOT_TID);
    // The manual XI above all: resolveXI keeps a stored starters array as long
    // as it still resolves, so leaving it would have the "AI" field the user's
    // eleven for a decade, minus whoever got sold.
    expect(club.starters).toBeNull();
    expect(club.transferListed).toEqual([]);
    expect(club.moreMinutes).toEqual([]);
    expect(handed.loanListings).toEqual([]);
    expect(handed.negotiations).toEqual([]);
    expect(handed.inboundOffers).toEqual([]);
  });

  it("hands the club back with the real tid and a re-stamped scouting record", () => {
    const league = makeLeague(0, 1);
    const userTid = league.meta.userTid;
    const handed = beginAutopilot(league);
    // Stand in for the jump without paying for one: a player who was there is
    // still there, and one who wasn't has arrived.
    const club = handed.teams.find((t) => t.tid === userTid)!;
    const kept = club.roster[0];
    const arrival = handed.teams.find((t) => t.tid !== userTid)!.roster[0];
    const midJump: LeagueStore = {
      ...handed,
      season: handed.season + 3,
      teams: handed.teams.map((t) => (t.tid === userTid ? { ...t, roster: [kept, arrival] } : t)),
    };

    const back = endAutopilot(midJump, userTid);
    const returned = back.teams.find((t) => t.tid === userTid)!;
    const observed = returned.scoutingObserved;

    expect(back.meta.userTid).toBe(userTid);
    // A long-serving player is not suddenly a stranger; one signed while the
    // user was away is, so his potential comes back fogged.
    expect(observed[kept]).toBe(league.season);
    expect(observed[arrival]).toBe(midJump.season);
    // The record covers exactly the roster: nobody the club no longer has, and
    // nobody it does have left unstamped. Asserted against the roster rather
    // than against [kept, arrival], because endAutopilot runs the safety net
    // first and a two-man squad is well under ROSTER_SAFETY_FLOOR — it is
    // topped up here, and those arrivals are correctly stamped at the return
    // season (i.e. they come back fogged, like any other signing made while
    // the user was away).
    expect(Object.keys(observed).map(Number).sort((a, b) => a - b))
      .toEqual([...returned.roster].sort((a, b) => a - b));
    expect(returned.roster).toContain(kept);
    expect(returned.roster).toContain(arrival);
  });
});

describe("clampJumpSeasons", () => {
  it("keeps a request inside the range the loop can actually serve", () => {
    // 0 would leave the loop with nothing to do and the progress bar frozen;
    // 500 would pin the worker for hours with no way to stop it.
    expect(clampJumpSeasons(0)).toBe(1);
    expect(clampJumpSeasons(-4)).toBe(1);
    expect(clampJumpSeasons(500)).toBe(MAX_JUMP_SEASONS);
    expect(clampJumpSeasons(3.7)).toBe(3);
    expect(clampJumpSeasons(Number.NaN)).toBe(1);
  });
});

/**
 * The one genuinely expensive case: a real season played out with the club on
 * autopilot. Run once and asserted from several angles, because each jump costs
 * a full season sim plus an offseason.
 */
describe("jumpSeasons over a real season", () => {
  const league = makeLeague(0, 7);
  const userTid = league.meta.userTid;
  let result: LeagueStore;

  beforeAll(() => {
    result = jumpSeasons(league, 1);
  }, 300_000);

  it("advances a whole season and gives the club back", () => {
    expect(result.season).toBe(league.season + 1);
    expect(result.phase).toBe("regular");
    // The sentinel must never reach a save: one that carried it would be a save
    // whose owner manages no club.
    expect(result.meta.userTid).toBe(userTid);
    expect(result.aiManagedSeasons).toEqual([league.season]);
  });

  it("lets the AI trade on the club's behalf", () => {
    // The point of the whole feature, and the thing that would silently stop
    // working if a `tid === userTid` carve-out ever started reading something
    // other than meta.userTid.
    const dealt = result.transfers
      .slice(league.transfers.length)
      .filter((t) => t.fromTid === userTid || t.toTid === userTid);
    expect(dealt.length).toBeGreaterThan(0);
  });

  it("leaves a squad that can actually be handed back", () => {
    const club = result.teams.find((t) => t.tid === userTid)!;
    const byPid = new Map(result.players.map((p) => [p.pid, p]));

    expect(club.roster.length).toBeLessThanOrEqual(ROSTER_CAP);
    expect(club.roster.length).toBeGreaterThanOrEqual(11);
    expect(club.starters).toBeNull();
    expect(club.roster.some((pid) => byPid.get(pid)?.pos === "GK")).toBe(true);
    // Every rostered pid still resolves — a jump that orphaned one would crash
    // the next matchday rather than fail here.
    expect(club.roster.every((pid) => byPid.has(pid))).toBe(true);
  });

  it("keeps the academy running, so the jump's intake is waiting in it", () => {
    // The academy runs on defaults, so nobody needs to be in charge for it to
    // work. Before this it keyed off the parked tid like everything else: the
    // intake went to the senior roster as ordinary AI youth and every kid
    // already there lapsed, and a jump handed back an empty academy.
    const club = result.teams.find((t) => t.tid === userTid)!;
    const byPid = new Map(result.players.map((p) => [p.pid, p]));
    const arrivals = club.academyRoster
      .map((pid) => byPid.get(pid)!)
      .filter((p) => result.season - p.born === USER_ACADEMY_ENTRY_AGE);
    expect(arrivals.length).toBeGreaterThanOrEqual(USER_ACADEMY_INTAKE_MIN);
    // The working copy's pointer at the real club must not reach a save.
    expect(result.meta.autopilotTid).toBeUndefined();
  });
});
