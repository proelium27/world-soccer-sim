import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generateLeague } from "../../src/core/league/generate.js";
import { leagueMatchData } from "../../src/core/league/composites.js";
import { doubleRoundRobin } from "../../src/core/schedule.js";
import { simThrough } from "../../src/core/simThrough.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { ScheduleGame } from "../../src/core/schedule.js";
import type { StoredTeam } from "../../src/core/teams/clubs.js";
import {
  INJURY_GAMES_MIN,
  INJURY_GAMES_MAX,
  INTL_INJURY_OFFSEASON_RECOVERY,
  BASE_SEASON_BUDGET,
  HYPE_INITIAL,
  SCOUTING_SPEND_MIN,
} from "../../src/core/constants.js";
import { applyInjuries, carryIntlInjuries } from "../../src/core/injuries.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";
import type { PlayedMatch } from "../../src/core/standings.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { emptyManagerState } from "../../src/core/manager/types.js";
import { emptyNationalManagerState } from "../../src/core/nationalManager/types.js";

function makeLeagueStore(seed: number): LeagueStore {
  const rng = mulberry32(seed);
  const league = generateLeague(rng);

  const teamIds = league.teams.map((t) => t.tid);
  const fixtures = doubleRoundRobin(teamIds);
  const schedule: ScheduleGame[] = fixtures.map((f, i) => ({
    matchday: Math.floor(i / 10) + 1,
    home: f.home,
    away: f.away,
  }));

  const teams: StoredTeam[] = league.teams.map((t) => ({
    tid: t.tid,
    name: t.name,
    abbrev: `T${String(t.tid).padStart(2, "0")}`,
    colors: ["#000000", "#FFFFFF"] as [string, string],
    roster: t.roster,
    academyRoster: [],
    budget: BASE_SEASON_BUDGET,
    hype: HYPE_INITIAL,
    scoutingSpend: SCOUTING_SPEND_MIN,
    nextScoutingSpend: SCOUTING_SPEND_MIN,
    academyBase: t.academyBase,
    compId: t.compId,
    divisionConvergence: null,
    formation: "4-3-3",
    starters: null,
    transferListed: [],
    moreMinutes: [],
    scoutingObserved: {},
  }));

  return {
    lid: 1,
    meta: { name: "Test League", created: Date.now(), userTid: 0 },
    competitions: englandCompetitions(),
    teams,
    players: league.players,
    // Same value the old derived allocator produced, so pids are unchanged.
    nextPid: Math.max(0, ...league.players.map((p) => p.pid)) + 1,
    aiManagedSeasons: [],
    progressionModel: "random" as const,
    rollingCoefficients: true,
    season: 2026,
    phase: "regular",
    schedule,
    played: [],
    negotiations: [],
    inboundOffers: [],
    transfers: [],
    transferClauses: [],
    winterMarketRunSeason: null,
    seasonHistory: [],
    newsEvents: [],
    retiredPlayers: [],
    playerNames: [],
    activeLoans: [],
    loanListings: [],
    loanRejections: [],
    watchlist: [],
    cup: null,
    cupHistory: [],
    shield: null,
    shieldHistory: [],
    domesticCups: [],
    domesticCupHistory: [],
    promotionPlayoffs: [],
    superCups: [],
    international: { qualifying: null, tournament: null, confederationCups: [], history: [], qualifyingHistory: [], confederationCupHistory: [], powerRankings: [], stage: null, stageInjuries: [] },
    powerRankingHistory: [],
    godMode: false,
    difficulty: "normal",
    manager: emptyManagerState(0, 1),
    nationalManager: emptyNationalManagerState(),
  };
}

describe("injuries persist across matchdays via simThrough", () => {
  it("players with an injury flag are excluded from XI and bench selection", () => {
    const rng = mulberry32(11);
    const league = generateLeague(rng);

    // Take a confirmed starter from team 0, injure him, and re-select.
    const healthy = leagueMatchData(league);
    const starterPid = healthy[0].xi[0].pid;
    const starter = league.players.find((p) => p.pid === starterPid)!;
    starter.injury = { gamesRemaining: 2, type: "knock" };

    const injured = leagueMatchData(league);
    const selectedPids = [...injured[0].xi, ...injured[0].bench].map((p) => p.pid);
    expect(selectedPids).not.toContain(starterPid);

    // Healed players are selectable again.
    starter.injury = null;
    const recovered = leagueMatchData(league);
    expect(recovered[0].xi.map((p) => p.pid)).toContain(starterPid);
  });

  it("a full season sim leaves only in-bounds injury flags, and injuries do occur", () => {
    const store = makeLeagueStore(11);
    const rng = mulberry32(9001);
    const result = simThrough(store, "season", rng);

    let sawAnyInjury = false;
    for (const p of result.players) {
      if (!p.injury) continue;
      sawAnyInjury = true;
      expect(p.injury.gamesRemaining).toBeGreaterThanOrEqual(1);
      expect(p.injury.gamesRemaining).toBeLessThanOrEqual(INJURY_GAMES_MAX);
    }
    // Over a full season across 20 teams, injuries should occur at least once.
    expect(sawAnyInjury).toBe(true);
  });

  it("applyInjuries: a fresh injury this matchday rolls a duration in bounds, and an existing one ticks down to null", () => {
    const rng = mulberry32(1);
    const makePlayer = (pid: number, injury: Player["injury"]): Player => ({
      pid,
      name: `Player ${pid}`,
      nationality: "USA",
      born: 2000,
      pos: "CM",
      heightCm: 180,
      ratings: {
        speed: 50, strength: 50, stamina: 50, jumping: 50,
        shortPass: 50, longPass: 50, crosses: 50,
        dribbling: 50, longShot: 50, finishing: 50,
        tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 5,
      },
      ovr: 50,
      potential: 50,
      contract: { salary: 1000, expiresSeason: 2030 },
      injury,
      stats: [emptySeasonStats(2026)],
      hist: [],
    });

    const healthy = makePlayer(1, null);
    const aboutToRecover = makePlayer(2, { gamesRemaining: 1, type: "knock" });
    const stillOut = makePlayer(3, { gamesRemaining: 3, type: "knock" });
    const untouched = makePlayer(4, null);

    const matches: PlayedMatch[] = [
      {
        home: 0, away: 1, homeGoals: 1, awayGoals: 0, possessionHome: 0.5, matchday: 1,
        boxScore: {
          home: [], away: [],
          events: [{ clock: 1000, type: "injury", side: "home", pids: [healthy.pid] }],
        },
      },
    ];

    const result = applyInjuries(rng, [healthy, aboutToRecover, stillOut, untouched], matches);
    const byPid = new Map(result.map((p) => [p.pid, p]));

    const newlyInjured = byPid.get(1)!.injury;
    expect(newlyInjured).not.toBeNull();
    expect(newlyInjured!.gamesRemaining).toBeGreaterThanOrEqual(INJURY_GAMES_MIN);
    expect(newlyInjured!.gamesRemaining).toBeLessThanOrEqual(INJURY_GAMES_MAX);

    expect(byPid.get(2)!.injury).toBeNull(); // ticked from 1 -> healed
    expect(byPid.get(3)!.injury).toEqual({ gamesRemaining: 2, type: "knock" }); // ticked down by 1
    expect(byPid.get(4)!.injury).toBeNull(); // untouched
  });
});

describe("carryIntlInjuries", () => {
  const mk = (pid: number): Player => ({
    pid,
    name: `P${pid}`,
    nationality: "USA",
    born: 2000,
    pos: "CM",
    heightCm: 180,
    ratings: {
      speed: 50, strength: 50, stamina: 50, jumping: 50,
      shortPass: 50, longPass: 50, crosses: 50,
      dribbling: 50, longShot: 50, finishing: 50,
      tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 5,
    },
    ovr: 50,
    potential: 50,
    contract: { salary: 1000, expiresSeason: 2030 },
    injury: null,
    stats: [emptySeasonStats(2026)],
    hist: [],
  });

  it("carries a reduced injury (or none) onto named pids only, leaving others untouched", () => {
    const players = Array.from({ length: 20 }, (_, i) => mk(i + 1));
    const named = players.slice(0, 10).map((p) => p.pid);
    const out = carryIntlInjuries(players, named, mulberry32(5));
    const byPid = new Map(out.map((p) => [p.pid, p]));

    // Unnamed players are never touched.
    for (const p of players.slice(10)) expect(byPid.get(p.pid)!.injury).toBeNull();

    // Named players either healed over the summer break (null) or carry a spell
    // shortened by the offseason recovery — never the full rolled duration.
    const carried = named.map((pid) => byPid.get(pid)!.injury).filter((i) => i !== null);
    expect(carried.length).toBeGreaterThan(0); // some were serious enough to linger
    for (const inj of carried) {
      expect(inj!.gamesRemaining).toBeGreaterThanOrEqual(1);
      expect(inj!.gamesRemaining).toBeLessThanOrEqual(INJURY_GAMES_MAX - INTL_INJURY_OFFSEASON_RECOVERY);
    }
  });

  it("is a no-op (same reference) when there's nothing to carry", () => {
    const players = [mk(1)];
    expect(carryIntlInjuries(players, [], mulberry32(5))).toBe(players);
  });
});
