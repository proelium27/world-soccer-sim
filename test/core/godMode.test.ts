import { describe, it, expect } from "vitest";
import {
  detachPlayer, movePlayerToClub, applyPlayerEdit, createCustomPlayer, setClubFinances,
  unretirePlayer,
} from "../../src/core/godMode.js";
import { computeOvr } from "../../src/core/players/ovr.js";
import { ratingsForOvr } from "../../src/core/players/generate.js";
import { archivePlayer } from "../../src/core/players/archive.js";
import { summaryOf } from "../../src/core/players/careerSummary.js";
import { computePlayerHonors } from "../../src/core/playerHonors.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import type { StoredTeam } from "../../src/core/teams/clubs.js";
import { emptySeasonStats, type Player, type PlayerRatings, type Position } from "../../src/core/players/types.js";

function team(tid: number, over: Partial<StoredTeam> = {}): StoredTeam {
  return {
    tid, name: `T${tid}`, abbrev: `T${tid}`, colors: ["#000", "#fff"],
    roster: [], academyRoster: [], budget: 100, hype: 50,
    scoutingSpend: 0, nextScoutingSpend: 0, academyBase: 55, compId: 0,
    divisionConvergence: null, formation: "4-3-3", starters: null,
    scoutingObserved: {}, transferListed: [], ...over,
  } as StoredTeam;
}

function league(over: Partial<LeagueStore> = {}): LeagueStore {
  return {
    lid: 0, meta: { name: "L", created: 0, userTid: 0 }, competitions: [],
    teams: [], players: [], season: 3, phase: "regular", schedule: [], played: [],
    negotiations: [], inboundOffers: [], transfers: [], winterMarketRunSeason: null,
    seasonHistory: [], newsEvents: [], powerRankingHistory: [], activeLoans: [],
    loanListings: [], loanRejections: [], cup: null, cupHistory: [], godMode: true,
    nextPid: 1,
    ...over,
  } as LeagueStore;
}

const RATINGS: PlayerRatings = {
  speed: 50, strength: 50, stamina: 50, jumping: 50, shortPass: 50, longPass: 50,
  crosses: 50, dribbling: 50, longShot: 50, finishing: 50, tackling: 50,
  interceptions: 50, positioning: 50, goalkeeping: 50,
};

function player(over: Partial<Player> = {}): Player {
  return {
    pid: 1, name: "A", nationality: "England", born: 2000, pos: "ST",
    heightCm: 180, ratings: { ...RATINGS }, ovr: computeOvr("ST", RATINGS, 180),
    potential: 70, contract: { salary: 1000, expiresSeason: 5 }, injury: null,
    stats: [], hist: [], ...over,
  };
}

describe("detachPlayer", () => {
  it("removes the pid from every roster and academy", () => {
    const l = league({
      teams: [team(0, { roster: [1, 2] }), team(1, { academyRoster: [1] })],
    });
    const out = detachPlayer(l, 1);
    expect(out.teams[0].roster).toEqual([2]);
    expect(out.teams[1].academyRoster).toEqual([]);
  });

  it("clears starters to null when the detached pid was a starter", () => {
    const l = league({ teams: [team(0, { roster: [1, 2], starters: [1, 2] })] });
    const out = detachPlayer(l, 1);
    expect(out.teams[0].starters).toBeNull();
  });

  it("leaves starters intact when the pid was not a starter", () => {
    const starters = Array.from({ length: 11 }, (_, i) => i + 10);
    const l = league({ teams: [team(0, { roster: [1, ...starters], starters })] });
    const out = detachPlayer(l, 1);
    expect(out.teams[0].starters).toBe(starters);
  });

  it("scrubs transient per-window state and transferListed", () => {
    const l = league({
      teams: [team(0, { roster: [1], transferListed: [1, 2] })],
      negotiations: [{ pid: 1 } as never, { pid: 9 } as never],
      inboundOffers: [{ pid: 1 } as never],
      loanListings: [{ pid: 1 } as never],
      activeLoans: [{ pid: 1 } as never, { pid: 8 } as never],
      loanRejections: [{ pid: 1 } as never],
    });
    const out = detachPlayer(l, 1);
    expect(out.teams[0].transferListed).toEqual([2]);
    expect(out.negotiations.map((n) => n.pid)).toEqual([9]);
    expect(out.inboundOffers).toEqual([]);
    expect(out.loanListings).toEqual([]);
    expect(out.activeLoans.map((x) => x.pid)).toEqual([8]);
    expect(out.loanRejections).toEqual([]);
  });
});

describe("movePlayerToClub", () => {
  it("moves a player from his old club to the target club with no cap/fee check", () => {
    const l = league({ teams: [team(0, { roster: [1] }), team(1, { roster: [] })] });
    const out = movePlayerToClub(l, 1, 1);
    expect(out.teams[0].roster).toEqual([]);
    expect(out.teams[1].roster).toEqual([1]);
  });

  it("adds a free agent onto a club without duplicating him", () => {
    const l = league({ teams: [team(0, { roster: [] })], players: [{ pid: 5 } as never] });
    const out = movePlayerToClub(l, 5, 0);
    expect(out.teams[0].roster).toEqual([5]);
  });

  it("is a no-op when the target tid does not exist", () => {
    const l = league({ teams: [team(0, { roster: [1] })] });
    const out = movePlayerToClub(l, 1, 99);
    expect(out).toBe(l);
  });

  it("is a no-op when the player is already on the target club", () => {
    const l = league({ teams: [team(0, { roster: [1] })] });
    const out = movePlayerToClub(l, 1, 0);
    expect(out).toBe(l);
  });
});

describe("applyPlayerEdit", () => {
  it("recomputes ovr when a rating changes", () => {
    const before = player();
    const out = applyPlayerEdit([before], 1, 4, { ratings: { finishing: 99 } });
    const expected = computeOvr("ST", { ...RATINGS, finishing: 99 }, 180);
    expect(out[0].ratings.finishing).toBe(99);
    expect(out[0].ovr).toBe(expected);
  });

  it("recomputes ovr when position changes", () => {
    const out = applyPlayerEdit([player()], 1, 4, { pos: "GK" });
    expect(out[0].pos).toBe("GK");
    expect(out[0].ovr).toBe(computeOvr("GK", RATINGS, 180));
  });

  it("maps age to born using the season", () => {
    const out = applyPlayerEdit([player()], 1, 2030, { age: 25 });
    expect(out[0].born).toBe(2005);
  });

  it("sets contract fields and potential, and clears injury", () => {
    const injured = player({ injury: { gamesRemaining: 3, type: "knock" } });
    const out = applyPlayerEdit([injured], 1, 4, {
      potential: 88, contract: { salary: 5000, expiresSeason: 9 }, clearInjury: true,
    });
    expect(out[0].potential).toBe(88);
    expect(out[0].contract).toEqual({ salary: 5000, expiresSeason: 9 });
    expect(out[0].injury).toBeNull();
  });

  it("locks and unlocks ratings, and leaves the setting alone when the edit is silent", () => {
    const locked = applyPlayerEdit([player()], 1, 4, { ratingsLocked: true });
    expect(locked[0].ratingsLocked).toBe(true);

    // An edit that says nothing about the lock must not clear one — the modal
    // sends a full PlayerEdit, but the one-click toggles send only this field.
    const stillLocked = applyPlayerEdit(locked, 1, 4, { potential: 90 });
    expect(stillLocked[0].ratingsLocked).toBe(true);

    const unlocked = applyPlayerEdit(locked, 1, 4, { ratingsLocked: false });
    expect(unlocked[0].ratingsLocked).toBeUndefined();
  });

  it("leaves an unlocked player's flag absent rather than false", () => {
    // "Absent means unlocked" is the invariant migrate.ts leans on to need no
    // backfill; writing `false` would make it merely usually true.
    const out = applyPlayerEdit([player()], 1, 4, { potential: 80 });
    expect(out[0].ratingsLocked).toBeUndefined();
  });

  it("still applies a rating edit to a locked player", () => {
    // The lock stops the simulation, not the sandbox.
    const locked = applyPlayerEdit([player()], 1, 4, { ratingsLocked: true });
    const out = applyPlayerEdit(locked, 1, 4, { ratings: { finishing: 99 } });
    expect(out[0].ratings.finishing).toBe(99);
    expect(out[0].ovr).toBe(computeOvr("ST", { ...RATINGS, finishing: 99 }, 180));
    expect(out[0].ratingsLocked).toBe(true);
  });

  it("leaves other players untouched and is immutable", () => {
    const a = player();
    const out = applyPlayerEdit([a], 1, 4, { name: "B" });
    expect(out[0]).not.toBe(a);
    expect(a.name).toBe("A");
    expect(out[0].name).toBe("B");
  });
});

describe("createCustomPlayer", () => {
  const spec = {
    name: "Zed", nationality: "England", pos: "CM" as const, heightCm: 178,
    age: 20, ratings: { ...RATINGS }, potential: 82,
    contract: { salary: 2000, expiresSeason: 8 }, tid: 0,
  };

  it("allocates a fresh pid (max existing + 1)", () => {
    const l = league({ players: [{ pid: 4 } as never, { pid: 9 } as never], teams: [team(0)] });
    const { league: out, pid } = createCustomPlayer(l, spec);
    expect(pid).toBe(10);
    expect(out.players.some((p) => p.pid === 10)).toBe(true);
  });

  it("computes ovr from ratings and seeds a baseline hist snapshot", () => {
    const l = league({ players: [], teams: [team(0)], season: 3 });
    const { league: out, pid } = createCustomPlayer(l, spec);
    const p = out.players.find((x) => x.pid === pid)!;
    expect(p.ovr).toBe(computeOvr("CM", RATINGS, 178));
    expect(p.born).toBe(l.season - spec.age); // season 3 - age 20
    expect(p.hist).toHaveLength(1);
    expect(p.hist[0].season).toBe(l.season - 1); // baseline snapshot at season - 1
    expect(p.stats).toEqual([]);
  });

  it("places the new player on the requested club", () => {
    const l = league({ players: [], teams: [team(0), team(1)] });
    const { league: out, pid } = createCustomPlayer(l, { ...spec, tid: 1 });
    expect(out.teams[1].roster).toContain(pid);
    expect(out.teams[0].roster).not.toContain(pid);
  });

  it("leaves the new player a free agent when tid is null", () => {
    const l = league({ players: [], teams: [team(0)] });
    const { league: out, pid } = createCustomPlayer(l, { ...spec, tid: null });
    expect(out.teams.every((t) => !t.roster.includes(pid))).toBe(true);
    expect(out.players.some((p) => p.pid === pid)).toBe(true);
  });
});

describe("setClubFinances", () => {
  it("sets budget and clamps hype to 0..100", () => {
    const teams = [team(0, { budget: 10, hype: 20 })];
    expect(setClubFinances(teams, 0, 500, 130)[0]).toMatchObject({ budget: 500, hype: 100 });
    expect(setClubFinances(teams, 0, -50, -5)[0]).toMatchObject({ budget: -50, hype: 0 });
  });

  it("is a no-op for an unknown tid", () => {
    const teams = [team(0)];
    expect(setClubFinances(teams, 99, 500, 50)).toBe(teams);
  });
});

describe("ratingsForOvr", () => {
  const POSITIONS: Position[] = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];

  it("lands on the target OVR at every position", () => {
    for (const pos of POSITIONS) {
      for (const target of [62, 76, 88]) {
        const r = ratingsForOvr(pos, target, 182, 7);
        expect(Math.abs(computeOvr(pos, r, 182) - target)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is shaped like the position, not flat", () => {
    const st = ratingsForOvr("ST", 80, 182, 7);
    expect(st.finishing).toBeGreaterThan(st.tackling);
    const gk = ratingsForOvr("GK", 80, 190, 7);
    expect(gk.goalkeeping).toBeGreaterThan(gk.finishing);
  });

  it("is deterministic for a seed", () => {
    expect(ratingsForOvr("CM", 75, 180, 11)).toEqual(ratingsForOvr("CM", 75, 180, 11));
  });
});

describe("unretirePlayer", () => {
  const SEASON = 3;
  // A three-season striker at club 0, retired at the end of season 2.
  function retiree(): Player {
    const stats = [0, 1, 2].map((season) => ({
      ...emptySeasonStats(season, 0), appearances: 30, goals: 12 + season,
      ratingSum: 30 * 7, avgRating: 7, minutesPlayed: 2700,
    }));
    const hist = [
      { season: -1, ratings: RATINGS, ovr: 80, potential: 84, academy: false, pos: "ST" as const },
      { season: 0, ratings: RATINGS, ovr: 84, potential: 84, academy: false, pos: "ST" as const },
      { season: 1, ratings: RATINGS, ovr: 82, potential: 84, academy: false, pos: "ST" as const },
    ];
    const ovrFor = (s: number) => hist.find((h) => h.season === s - 1)!.ovr;
    return player({
      pid: 7, born: SEASON - 36, ovr: 79, stats, hist,
      peakOvr: 84, peakOvrSeason: 0,
      career: summaryOf(stats, ovrFor),
      intl: { caps: 40, goals: 15, assists: 0, tournaments: 2, titles: 1, seasons: [] },
    });
  }
  const archived = archivePlayer(retiree(), 2);

  it("brings him back as a free agent and takes him out of the archive", () => {
    const l = league({ season: SEASON, teams: [team(0)], retiredPlayers: [archived] });
    const next = unretirePlayer(l, 7);
    const p = next.players.find((x) => x.pid === 7)!;
    expect(p).toBeDefined();
    expect(next.retiredPlayers).toEqual([]);
    expect(next.teams[0].roster).not.toContain(7);
    expect(p.contract.expiresSeason).toBe(SEASON);
    expect(p.born).toBe(archived.born);
    expect(Math.abs(p.ovr - archived.finalOvr)).toBeLessThanOrEqual(1);
  });

  it("keeps his career: archiving him again gives back the same record", () => {
    const next = unretirePlayer(league({ season: SEASON, retiredPlayers: [archived] }), 7);
    const p = next.players.find((x) => x.pid === 7)!;
    const again = archivePlayer(p, 2);
    expect(again.totals).toEqual(archived.totals);
    expect(again.best).toEqual(archived.best);
    expect(again.seasons).toEqual(archived.seasons);
    expect(again.peakOvr).toBe(archived.peakOvr);
    expect(again.peakSeason).toBe(archived.peakSeason);
    expect(again.caps).toBe(40);
    expect(again.intlTitles).toBe(1);
    // One rating snapshot per archived season plus today's, oldest first.
    expect(p.hist.map((h) => h.season)).toEqual([-1, 0, 1, 2]);
    expect(p.hist.slice(0, 3).map((h) => h.ovr)).toEqual(archived.seasons.map((s) => s.ovr));
  });

  it("still credits the titles he won before retiring", () => {
    const history = [1].map((season) => ({
      season, awards: {}, championTidByCompId: { 0: 0 },
    })) as unknown as SeasonHistoryEntry[];
    const next = unretirePlayer(league({ season: SEASON, retiredPlayers: [archived] }), 7);
    const p = next.players.find((x) => x.pid === 7)!;
    expect(p.stats).toEqual([]);
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([1]);
  });

  it("comes back the same way every time", () => {
    const l = league({ season: SEASON, retiredPlayers: [archived] });
    expect(unretirePlayer(l, 7).players).toEqual(unretirePlayer(l, 7).players);
  });

  it("is a no-op for a pid that isn't archived, or one already in the pool", () => {
    const l = league({ season: SEASON, retiredPlayers: [archived] });
    expect(unretirePlayer(l, 99)).toBe(l);
    const clash = league({ season: SEASON, players: [player({ pid: 7 })], retiredPlayers: [archived] });
    expect(unretirePlayer(clash, 7)).toBe(clash);
  });
});
