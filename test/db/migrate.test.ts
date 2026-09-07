import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { migrateLeague } from "../../src/db/migrate.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { buildCompetitionSchedule, type LeagueStore } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { HYPE_INITIAL, SCOUTING_SPEND_DEFAULT } from "../../src/core/constants.js";
import { generateTwoDivisionLeague } from "../../src/core/league/generate.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { assignIdentities } from "../../src/core/teams/clubs.js";
import { awardWinnerPids } from "../../src/core/awardWinners.js";
import { emptyManagerState } from "../../src/core/manager/types.js";
import { emptyNationalManagerState } from "../../src/core/nationalManager/types.js";

/** An England-only LeagueStore, matching what createLeagueState produced before the more-leagues world refactor — used by tests that specifically simulate a pre-refactor save. */
function createEnglandOnlyLeagueState(userTid: number, rng: () => number, seed = 0): LeagueStore {
  const league = generateTwoDivisionLeague(rng, seed);
  const competitions = englandCompetitions();
  const teams = assignIdentities(league, competitions);
  const schedule = buildCompetitionSchedule(teams, competitions);
  return {
    lid: 0,
    meta: { name: "My League", created: Date.now(), userTid },
    competitions,
    teams,
    players: league.players,
    // Same value the old derived allocator produced, so pids are unchanged.
    nextPid: Math.max(0, ...league.players.map((p) => p.pid)) + 1,
    aiManagedSeasons: [],
    rollingCoefficients: true,
    season: 1,
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
    manager: emptyManagerState(userTid, 1),
    nationalManager: emptyNationalManagerState(),
  };
}

describe("migrateLeague", () => {
  it("backfills finance fields on teams from pre-M6 saves", () => {
    const league = makeLeague(0, 1);
    // Strip the finance fields to simulate a league saved before M6.
    const preM6 = {
      ...league,
      teams: league.teams.map(({ budget: _b, hype: _h, scoutingSpend: _s, nextScoutingSpend: _ns, ...rest }) => rest),
    } as unknown as LeagueStore;

    const migrated = migrateLeague(preM6);
    for (const [i, team] of migrated.teams.entries()) {
      // Backfill seeds the budget like a season start (base in, wages out),
      // which for an untouched fresh league equals its creation-time budget.
      expect(team.budget).toBe(league.teams[i].budget);
      expect(team.hype).toBe(HYPE_INITIAL);
      expect(team.scoutingSpend).toBe(SCOUTING_SPEND_DEFAULT);
      expect(team.nextScoutingSpend).toBe(SCOUTING_SPEND_DEFAULT);
    }
  });

  it("backfills the transfer-market lists from pre-phase-3 saves", () => {
    const league = makeLeague(0, 1);
    const { negotiations: _n, transfers: _t, ...rest } = league;
    const preTransfers = rest as unknown as LeagueStore;

    const migrated = migrateLeague(preTransfers);
    expect(migrated.negotiations).toEqual([]);
    expect(migrated.transfers).toEqual([]);
  });

  it("leaves existing transfer-market lists untouched", () => {
    const league = makeLeague(0, 1);
    const withDeals: LeagueStore = {
      ...league,
      transfers: [{ pid: 1, fromTid: 2, toTid: 0, fee: 5_000_000, season: 1, window: "winter" }],
    };
    expect(migrateLeague(withDeals).transfers).toEqual(withDeals.transfers);
  });

  it("backfills newsEvents to an empty array for saves written before this feature", () => {
    const league = makeLeague(0, 1);
    const { newsEvents: _ne, ...withoutNewsEvents } = league;
    const migrated = migrateLeague(withoutNewsEvents as unknown as LeagueStore);
    expect(migrated.newsEvents).toEqual([]);
  });

  it("backfills powerRankingHistory to an empty array for saves written before this feature", () => {
    const league = makeLeague(0, 1);
    const { powerRankingHistory: _prh, ...withoutHistory } = league;
    const migrated = migrateLeague(withoutHistory as unknown as LeagueStore);
    expect(migrated.powerRankingHistory).toEqual([]);
  });

  it("backfills godMode to false for a save without it", () => {
    const league = makeLeague(0, 1);
    const { godMode: _gm, ...withoutGodMode } = league;
    const migrated = migrateLeague(withoutGodMode as unknown as LeagueStore);
    expect(migrated.godMode).toBe(false);
  });

  it("backfills difficulty to normal for a save without it", () => {
    // A save that predates difficulty was played on the shipped tuning, which
    // is what "normal" is, so this backfill changes nothing about it.
    const league = makeLeague(0, 1);
    const { difficulty: _d, ...withoutDifficulty } = league;
    const migrated = migrateLeague(withoutDifficulty as unknown as LeagueStore);
    expect(migrated.difficulty).toBe("normal");
  });

  it("leaves an existing difficulty untouched", () => {
    const league = makeLeague(0, 1);
    const migrated = migrateLeague({ ...league, difficulty: "brutal" });
    expect(migrated.difficulty).toBe("brutal");
  });

  it("backfills rollingCoefficients to on for a save without it", () => {
    // Cup places have been re-earned since the coefficient shipped, so a save
    // that predates the SETTING was played with it on.
    const league = makeLeague(0, 1);
    const { rollingCoefficients: _r, ...without } = league;
    const migrated = migrateLeague(without as unknown as LeagueStore);
    expect(migrated.rollingCoefficients).toBe(true);
  });

  it("leaves rollingCoefficients off when the save turned it off", () => {
    const league = makeLeague(0, 1);
    const migrated = migrateLeague({ ...league, rollingCoefficients: false });
    expect(migrated.rollingCoefficients).toBe(false);
  });

  it("leaves an existing powerRankingHistory untouched", () => {
    const league = makeLeague(0, 1);
    const withHistory: LeagueStore = {
      ...league,
      powerRankingHistory: [{ season: 1, matchday: 5, rows: [] }],
    };
    expect(migrateLeague(withHistory).powerRankingHistory).toEqual(withHistory.powerRankingHistory);
  });

  it("leaves existing newsEvents untouched", () => {
    const league = makeLeague(0, 1);
    const withEvents: LeagueStore = {
      ...league,
      newsEvents: [{ type: "hattrick", pid: 1, tid: 0, season: 1, matchday: 3, detail: 3 }],
    };
    expect(migrateLeague(withEvents).newsEvents).toEqual(withEvents.newsEvents);
  });

  it("strips generational-talent announcements from saves in progress", () => {
    const league = makeLeague(0, 1);
    const hattrick = { type: "hattrick" as const, pid: 1, tid: 0, season: 1, matchday: 3, detail: 3 };
    const withEvents = {
      ...league,
      newsEvents: [
        hattrick,
        // The removed event type, as an older save would still hold it. The
        // feed is append-only, so without this filter the announcement keeps
        // giving away a hidden trait forever (and renders a blank label, since
        // nothing maps the type any more).
        { type: "generationalTalent", pid: 7, tid: 2, season: 1, matchday: 0, detail: 16 },
      ],
    } as unknown as LeagueStore;
    expect(migrateLeague(withEvents).newsEvents).toEqual([hattrick]);
  });

  it("backfills minutesPlayed/rating fields from pre-Match-Rating saves", () => {
    const league = simThrough(makeLeague(0, 1), "game", mulberry32(6));
    const preRating = {
      ...league,
      players: league.players.map((p) => ({
        ...p,
        stats: p.stats.map(({ minutesPlayed: _m, ratingSum: _r, avgRating: _a, ...rest }) => rest),
      })),
      played: league.played.map((m) => ({
        ...m,
        boxScore: {
          ...m.boxScore,
          home: m.boxScore.home.map(({ minutesPlayed: _m, rating: _r, ...rest }) => rest),
          away: m.boxScore.away.map(({ minutesPlayed: _m, rating: _r, ...rest }) => rest),
        },
      })),
    } as unknown as LeagueStore;

    const migrated = migrateLeague(preRating);
    for (const p of migrated.players) {
      for (const ss of p.stats) {
        expect(ss.minutesPlayed).toBe(0);
        expect(ss.ratingSum).toBe(0);
        expect(ss.avgRating).toBe(0);
      }
    }
    for (const m of migrated.played) {
      for (const line of [...m.boxScore.home, ...m.boxScore.away]) {
        expect(line.minutesPlayed).toBe(0);
        expect(line.rating).toBe(6.0);
      }
    }
  });

  it("backfills interceptions to 0 on pre-existing box-score lines and season stats", () => {
    const league = simThrough(makeLeague(0, 1), "game", mulberry32(6));
    const preInterceptions = {
      ...league,
      players: league.players.map((p) => ({
        ...p,
        stats: p.stats.map(({ interceptions: _i, ...rest }) => rest),
      })),
      played: league.played.map((m) => ({
        ...m,
        boxScore: {
          ...m.boxScore,
          home: m.boxScore.home.map(({ interceptions: _i, ...rest }) => rest),
          away: m.boxScore.away.map(({ interceptions: _i, ...rest }) => rest),
        },
      })),
    } as unknown as LeagueStore;

    const migrated = migrateLeague(preInterceptions);
    for (const p of migrated.players) {
      for (const ss of p.stats) {
        expect(ss.interceptions).toBe(0);
      }
    }
    for (const m of migrated.played) {
      for (const line of [...m.boxScore.home, ...m.boxScore.away]) {
        expect(line.interceptions).toBe(0);
      }
    }
  });

  it("leaves current match-rating fields untouched", () => {
    const league = simThrough(makeLeague(0, 1), "game", mulberry32(8));
    const migrated = migrateLeague(league);
    expect(migrated.players).toEqual(league.players);
    expect(migrated.played).toEqual(league.played);
  });

  it("backfills academyRoster to [] on pre-Academy saves", () => {
    const league = makeLeague(0, 1);
    const preAcademy = {
      ...league,
      teams: league.teams.map(({ academyRoster: _a, ...rest }) => rest),
    } as unknown as LeagueStore;

    const migrated = migrateLeague(preAcademy);
    for (const team of migrated.teams) {
      expect(team.academyRoster).toEqual([]);
    }
  });

  it("leaves an existing academyRoster untouched", () => {
    const league = makeLeague(0, 1);
    const withAcademy: LeagueStore = {
      ...league,
      teams: league.teams.map((t) => (t.tid === 0 ? { ...t, academyRoster: [42] } : t)),
    };
    const migrated = migrateLeague(withAcademy);
    expect(migrated.teams.find((t) => t.tid === 0)!.academyRoster).toEqual([42]);
  });

  it("leaves current saves' finance values untouched", () => {
    const league = makeLeague(0, 1);
    const custom = {
      ...league,
      teams: league.teams.map((t) => ({ ...t, budget: 123_456, hype: 77, scoutingSpend: 5_000 })),
    };

    const migrated = migrateLeague(custom);
    for (const team of migrated.teams) {
      expect(team.budget).toBe(123_456);
      expect(team.hype).toBe(77);
      expect(team.scoutingSpend).toBe(5_000);
    }
  });

  it("backfills award winners' names from whatever a save can still resolve", () => {
    // A save written before winners were named has award pids going back to
    // season 1 and no names for any of them. Migration records everyone it can
    // still look up, permanently — this is the one thing that CAN'T be
    // reconstructed later, because retirement plus the capped archive delete
    // the player outright.
    const rng = mulberry32(21);
    const league = simOffseason(simThrough(makeLeague(0, 21), "season", rng), rng);
    const entry = league.seasonHistory.at(-1)!;
    expect(entry.awardWinners!.length).toBeGreaterThan(0);

    const older = {
      ...league,
      seasonHistory: league.seasonHistory.map(({ awardWinners: _w, ...rest }) => rest),
    } as unknown as LeagueStore;

    const migrated = migrateLeague(older);
    const backfilled = migrated.seasonHistory.at(-1)!.awardWinners!;
    const wanted = awardWinnerPids(entry);
    // Every winner still in the pool or the archive gets his name back; anyone
    // already deleted stays unnamed rather than invented.
    const resolvable = new Set([
      ...migrated.players.map((p) => p.pid),
      ...migrated.retiredPlayers.map((p) => p.pid),
    ]);
    expect(backfilled.length).toBeGreaterThan(0);
    for (const pid of wanted) {
      expect(backfilled.some((w) => w.pid === pid)).toBe(resolvable.has(pid));
    }
    for (const w of backfilled) expect(w.name).not.toBe("");
  });

  it("leaves award winners a save already recorded exactly as they are", () => {
    const rng = mulberry32(22);
    const league = simOffseason(simThrough(makeLeague(0, 22), "season", rng), rng);
    const before = league.seasonHistory.at(-1)!.awardWinners!;
    expect(migrateLeague(league).seasonHistory.at(-1)!.awardWinners).toEqual(before);
  });

  it("backfills compId/divisionConvergence on old-save teams, and a competitions table on a pre-refactor save", () => {
    const rng = mulberry32(12);
    const league = simOffseason(simThrough(createEnglandOnlyLeagueState(0, mulberry32(11)), "season", rng), rng);
    // Simulate a save from before the second division / competitions
    // refactor: teams have legacy `division` (not `compId`), history entries
    // have `divisionsByTid` and a [D1, D2] awards tuple with a top-level
    // `championTid`, and the league has no `competitions` table at all.
    const legacyHistory = league.seasonHistory.map((h) => {
      const { compsByTid, championTidByCompId, ...rest } = h;
      return {
        ...rest,
        divisionsByTid: compsByTid,
        championTid: championTidByCompId[0],
        awards: [h.awards[0], h.awards[1] ?? h.awards[0]],
      };
    });
    const oldLeague = {
      ...league,
      teams: league.teams.map(({ compId, divisionConvergence: _dc, ...rest }) => ({
        ...rest, division: compId as 0 | 1,
      })),
      seasonHistory: legacyHistory,
    } as unknown as LeagueStore;
    const { competitions: _c, ...oldLeagueNoCompetitions } = oldLeague;

    const migrated = migrateLeague(oldLeagueNoCompetitions as LeagueStore);

    expect(migrated.competitions).toEqual([
      { id: 0, country: "England", tier: 1, name: "English Division 1" },
      { id: 1, country: "England", tier: 2, name: "English Division 2" },
    ]);
    for (const t of migrated.teams) {
      expect(t.compId === 0 || t.compId === 1).toBe(true);
      expect(t.divisionConvergence).toBeNull();
    }

    for (const [i, h] of migrated.seasonHistory.entries()) {
      expect(Array.isArray(h.awards)).toBe(false);
      expect(h.compsByTid).toEqual(legacyHistory[i].divisionsByTid);
      expect(h.championTidByCompId[0]).toBe(legacyHistory[i].championTid);
    }
  });
});

describe("migrateLeague pre-M3 box scores", () => {
  it("tolerates played matches with no boxScore at all", () => {
    const league = simThrough(makeLeague(0, 1), "game", mulberry32(8));
    expect(league.played.length).toBeGreaterThan(0);
    const preM3 = {
      ...league,
      played: league.played.map(({ boxScore: _b, ...rest }) => rest),
    } as unknown as LeagueStore;

    const migrated = migrateLeague(preM3);
    expect(migrated.played).toHaveLength(league.played.length);
    for (const m of migrated.played) {
      expect(m.boxScore).toEqual({ home: [], away: [], events: [] });
    }
  });
});

describe("migrateLeague international stage", () => {
  /**
   * The three named World Cup knockout stages collapsed into one repeating
   * "knockout" when the field grew to 32 and the bracket gained a round. A save
   * caught mid-knockout has to land on it, or the offseason sits on a stage the
   * machine no longer recognises and the campaign can never finish.
   */
  const withStage = (stage: string): LeagueStore => {
    const league = makeLeague(0, 1);
    return {
      ...league,
      international: { ...league.international, stage },
    } as unknown as LeagueStore;
  };

  it("maps the retired per-round knockout stages onto the repeating one", () => {
    for (const old of ["qf", "sf", "final"]) {
      expect(migrateLeague(withStage(old)).international.stage).toBe("knockout");
    }
  });

  it("leaves a current stage alone", () => {
    const current = [
      "qualifying", "groups", "knockout", "confederation-groups", "confederation-ko", "done",
    ];
    for (const stage of current) {
      expect(migrateLeague(withStage(stage)).international.stage).toBe(stage);
    }
  });

  it("treats an unrecognised stage as nothing pending", () => {
    // Not a crash: the next offseason simply draws a fresh campaign.
    expect(migrateLeague(withStage("who-knows")).international.stage).toBeNull();
  });
});
