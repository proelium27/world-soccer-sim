import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generateLeague } from "../../src/core/league/generate.js";
import { doubleRoundRobin } from "../../src/core/schedule.js";
import { computeStandings } from "../../src/core/standings.js";
import { simThrough } from "../../src/core/simThrough.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { transferWindowState } from "../../src/core/transfers/window.js";
import { TRANSFER_DEADLINE_MATCHDAY } from "../../src/core/calendar.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { ScheduleGame } from "../../src/core/schedule.js";
import type { StoredTeam } from "../../src/core/teams/clubs.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { emptyManagerState } from "../../src/core/manager/types.js";
import { emptyNationalManagerState } from "../../src/core/nationalManager/types.js";

/** Build a LeagueStore fixture from a generated league + double round robin. */
function makeLeagueStore(seed: number): LeagueStore {
  const rng = mulberry32(seed);
  const league = generateLeague(rng);

  const teamIds = league.teams.map((t) => t.tid);
  const fixtures = doubleRoundRobin(teamIds);

  // Assign matchdays: 10 games per matchday (20 teams / 2 = 10 games per round)
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
    budget: 50_000_000,
    hype: 50,
    scoutingSpend: 0,
    nextScoutingSpend: 0,
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

describe("simThrough", () => {
  it("rolls up interceptions into season stats alongside tackles", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(700);
    const result = simThrough(store, { matchday: 4 }, rng);

    const withInterceptions = result.players.find((p) =>
      p.stats.some((s) => s.season === store.season && s.interceptions > 0),
    );
    expect(withInterceptions).toBeDefined();
    const ss = withInterceptions!.stats.find((s) => s.season === store.season)!;
    expect(ss.interceptions).toBeGreaterThan(0);
    expect(ss.appearances).toBeGreaterThan(0);
  });

  it("sim one game: moves exactly 10 games (1 matchday) from schedule to played", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(100);
    const result = simThrough(store, "game", rng);

    expect(result.played).toHaveLength(10);
    expect(result.schedule).toHaveLength(store.schedule.length - 10);
    // All played games should be matchday 1
    for (const m of result.played) {
      const orig = store.schedule.find(
        (g) => g.home === m.home && g.away === m.away,
      );
      expect(orig).toBeDefined();
      expect(orig!.matchday).toBe(1);
    }
  });

  it("sim to a target matchday: from matchday 1, { matchday: 4 } plays matchdays 1-4", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(200);
    const result = simThrough(store, { matchday: 4 }, rng);

    // August = matchdays 1-4 = 40 games
    expect(result.played).toHaveLength(40);
    expect(result.schedule).toHaveLength(store.schedule.length - 40);
    // No remaining game should have matchday <= 4
    for (const g of result.schedule) {
      expect(g.matchday).toBeGreaterThan(4);
    }
  });

  it("sim to the matchday before deadline day leaves the winter window open", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(300);
    const result = simThrough(store, { matchday: TRANSFER_DEADLINE_MATCHDAY - 1 }, rng);

    // Matchdays 1-21 = 210 games; deadline day itself is left unplayed so
    // the user can still do transfer business.
    expect(result.played).toHaveLength(210);
    expect(result.schedule).toHaveLength(store.schedule.length - 210);
    for (const g of result.schedule) {
      expect(g.matchday).toBeGreaterThan(21);
    }
    expect(Math.min(...result.schedule.map((g) => g.matchday))).toBe(22);
    expect(transferWindowState(result)).toMatchObject({ open: true, window: "winter" });
  });

  it("a target already in the past is a no-op, so a stale number can't play a matchday", () => {
    const store = makeLeagueStore(42);
    const target = { matchday: TRANSFER_DEADLINE_MATCHDAY - 1 };
    const atDeadline = simThrough(store, target, mulberry32(300));

    // Re-submitting the same number must NOT play deadline day and shut the
    // window unasked.
    expect(simThrough(atDeadline, target, mulberry32(301))).toBe(atDeadline);

    const pastDeadline: LeagueStore = {
      ...store,
      schedule: store.schedule.filter((g) => g.matchday >= 25),
    };
    expect(simThrough(pastDeadline, target, mulberry32(302))).toBe(pastDeadline);
  });

  it("a target past the end of the season plays out the rest of it", () => {
    const store = makeLeagueStore(42);
    const result = simThrough(store, { matchday: 99 }, mulberry32(310));

    expect(result.played).toHaveLength(380);
    expect(result.schedule).toHaveLength(0);
  });

  it("sim full season: plays all remaining games, phase becomes offseason", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(400);
    const result = simThrough(store, "season", rng);

    expect(result.played).toHaveLength(380);
    expect(result.schedule).toHaveLength(0);
    expect(result.phase).toBe("offseason");
  });

  it("offseason no-op: calling simThrough on an offseason league returns it unchanged", () => {
    const store = makeLeagueStore(42);
    const offseasonStore: LeagueStore = {
      ...store,
      phase: "offseason",
    };
    const rng = mulberry32(500);
    const result = simThrough(offseasonStore, "game", rng);

    expect(result).toBe(offseasonStore); // same reference — returned unchanged
  });

  it("immutability: the input league object is not mutated", () => {
    const store = makeLeagueStore(42);
    const origScheduleLength = store.schedule.length;
    const origPlayedLength = store.played.length;
    const origPhase = store.phase;

    const rng = mulberry32(600);
    simThrough(store, "season", rng);

    expect(store.schedule.length).toBe(origScheduleLength);
    expect(store.played.length).toBe(origPlayedLength);
    expect(store.phase).toBe(origPhase);
  });

  it("standings sanity: after a full season sim, champion 78-94 pts and bottom 15-32 pts", () => {
    // Average over 5 seeded seasons to match M1 validation gates
    let champSum = 0;
    let bottomSum = 0;
    const SEASONS = 5;

    for (let s = 0; s < SEASONS; s++) {
      const store = makeLeagueStore(1000 + s);
      const rng = mulberry32(2000 + s);
      const result = simThrough(store, "season", rng);

      const teamIds = result.teams.map((t) => t.tid);
      const table = computeStandings(teamIds, result.played);

      champSum += table[0].points;
      bottomSum += table[table.length - 1].points;
    }

    const champ = champSum / SEASONS;
    const bottom = bottomSum / SEASONS;

    expect(champ).toBeGreaterThanOrEqual(78);
    expect(champ).toBeLessThanOrEqual(94);
    expect(bottom).toBeGreaterThanOrEqual(15);
    expect(bottom).toBeLessThanOrEqual(32);
  });

  it("newsEvents: starts empty and only grows as matchdays are played, never shrinks", () => {
    const store = makeLeagueStore(42);
    expect(store.newsEvents).toEqual([]);

    const rng = mulberry32(800);
    const afterOneMonth = simThrough(store, { matchday: 4 }, rng);
    expect(Array.isArray(afterOneMonth.newsEvents)).toBe(true);
    expect(afterOneMonth.newsEvents.length).toBeGreaterThanOrEqual(store.newsEvents.length);

    const rng2 = mulberry32(801);
    const afterFullSeason = simThrough(afterOneMonth, "season", rng2);
    expect(afterFullSeason.newsEvents.length).toBeGreaterThanOrEqual(afterOneMonth.newsEvents.length);
  });

  it("newsEvents: every event carries the matchday it happened on and the store's season", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(900);
    const result = simThrough(store, "season", rng);

    for (const e of result.newsEvents) {
      expect(e.season).toBe(store.season);
      expect(e.matchday).toBeGreaterThanOrEqual(1);
      expect(e.matchday).toBeLessThanOrEqual(38);
      expect(["hattrick", "standoutRating", "goalMilestoneSeason", "goalMilestoneCareer"]).toContain(e.type);
    }
  });

  it("powerRankingHistory: a full season stores snapshots every 10 matchdays plus the finale", () => {
    const store = makeLeagueStore(42);
    const rng = mulberry32(1000);
    const result = simThrough(store, "season", rng);

    // Four a season, per POWER_SNAPSHOT_INTERVAL — a save-size constant, since
    // each snapshot is a row per club for the whole world and none are pruned.
    expect(result.powerRankingHistory.map((s) => s.matchday)).toEqual([10, 20, 30, 38]);
    for (const snapshot of result.powerRankingHistory) {
      expect(snapshot.season).toBe(store.season);
      expect(snapshot.rows).toHaveLength(store.teams.length);
      // Form in each snapshot reflects exactly the matches played so far:
      // 10 games per matchday, 2 team-appearances per game.
      const totalPlayed = snapshot.rows.reduce((sum, r) => sum + r.played, 0);
      expect(totalPlayed).toBe(snapshot.matchday * 10 * 2);
    }
  });

  it("powerRankingHistory: no snapshot before matchday 10, and batching sims doesn't duplicate any", () => {
    const store = makeLeagueStore(42);
    const afterOneMonth = simThrough(store, { matchday: 9 }, mulberry32(1100)); // matchdays 1-9
    expect(afterOneMonth.powerRankingHistory).toEqual([]);

    const afterFullSeason = simThrough(afterOneMonth, "season", mulberry32(1101));
    expect(afterFullSeason.powerRankingHistory.map((s) => s.matchday)).toEqual([10, 20, 30, 38]);
  });

  it("never simulates a match between teams in different divisions", () => {
    const rng = mulberry32(11);
    let league = createLeagueState(0, rng);
    league = simThrough(league, "season", rng);
    const divisionByTid = new Map(league.teams.map((t) => [t.tid, t.compId]));
    for (const m of league.played) {
      expect(divisionByTid.get(m.home)).toBe(divisionByTid.get(m.away));
    }
  });
});
