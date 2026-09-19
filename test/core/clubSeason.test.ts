import { describe, it, expect } from "vitest";
import { computeClubSeason, hasClubSeason } from "../../src/core/clubSeason.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { StandingsRow, SeasonHistoryEntry } from "../../src/core/standings.js";
import type { SeasonAwards } from "../../src/core/awards.js";
import { SKILL_KEYS, type Player } from "../../src/core/players/types.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import { englandCompetitions } from "../../src/core/competitions.js";

function row(tid: number, points: number): StandingsRow {
  const won = points / 3;
  return {
    tid, played: 38, won, drawn: 0, lost: 38 - won,
    gf: won * 2, ga: 38 - won, gd: won * 2 - (38 - won), points,
  };
}

const noAwards: SeasonAwards = { playerOfSeasonPid: null, goldenBootPid: null, teamOfSeason: [] };

/** `orderByComp` gives, per compId, the tids in finishing order. */
function entry(
  season: number,
  orderByComp: Record<number, number[]>,
  awards: Record<number, SeasonAwards> = { 0: noAwards },
): SeasonHistoryEntry {
  const table: StandingsRow[] = [];
  const compsByTid: Record<number, number> = {};
  const championTidByCompId: Record<number, number> = {};
  for (const [compIdStr, tids] of Object.entries(orderByComp)) {
    const compId = Number(compIdStr);
    tids.forEach((tid, i) => {
      table.push(row(tid, (tids.length - i) * 3));
      compsByTid[tid] = compId;
    });
    if (compId === 0) championTidByCompId[compId] = tids[0];
  }
  return {
    season, table, teamStats: [], awards, compsByTid, championTidByCompId,
    world: { ballonDOr: [], worldTeamOfYear: [] },
  };
}

/** A live player with a stats row per season and a ratings snapshot per season. */
function player(
  pid: number,
  seasonTids: Record<number, number>,
  opts: { ovrBySeason?: Record<number, number>; ovr?: number; born?: number; pos?: string } = {},
): Player {
  const stats = Object.entries(seasonTids).map(([s, tid]) => ({
    season: Number(s), tid, appearances: 10, goals: 2, assists: 1,
    minutesPlayed: 900, avgRating: 7,
  }) as Player["recentStats"][number]);
  const hist = Object.entries(opts.ovrBySeason ?? {}).map(([s, ovr]) => ({
    season: Number(s), ovr,
  }) as Player["recentHist"][number]);
  return {
    pid, recentStats: stats, recentHist: hist, name: `P${pid}`, nationality: "England",
    pos: opts.pos ?? "CM", born: opts.born ?? 0, ovr: opts.ovr ?? 60,
    // A flat skill set, because the live-season path runs computeTeamRating,
    // which picks an XI and therefore reads real per-position ratings. The
    // values don't matter to anything asserted here; their presence does.
    ratings: Object.fromEntries(SKILL_KEYS.map((k) => [k, 60])),
    potential: 70,
  } as unknown as Player;
}

function archived(pid: number, seasonTids: Record<number, number>): ArchivedPlayer {
  return {
    pid, name: `R${pid}`, nationality: "Spain", pos: "ST", born: 0,
    seasons: Object.entries(seasonTids).map(([s, tid]) => ({
      season: Number(s), tid, ovr: 71, apps: 20,
    })),
  } as unknown as ArchivedPlayer;
}

function makeLeague(over: Partial<LeagueStore>): LeagueStore {
  return {
    competitions: englandCompetitions(),
    seasonHistory: [],
    teams: [{ tid: 7, compId: 0, roster: [], starters: null }],
    players: [],
    retiredPlayers: [],
    powerRankingHistory: [],
    cupHistory: [],
    shieldHistory: [],
    domesticCupHistory: [],
    domesticCups: [],
    cup: null,
    shield: null,
    played: [],
    season: 99,
    ...over,
  } as unknown as LeagueStore;
}

describe("computeClubSeason", () => {
  it("rebuilds a past squad from stats rows, and reads each man's rating for that season", () => {
    const league = makeLeague({
      seasonHistory: [entry(2, { 0: [7, 1, 2] })],
      players: [
        // At club 7 in season 2 — belongs in the squad.
        player(100, { 2: 7 }, { ovrBySeason: { 1: 68 }, ovr: 74 }),
        // At another club that season — must not.
        player(200, { 2: 1 }),
        // At club 7, but a different season.
        player(300, { 1: 7 }),
      ],
    });

    const cs = computeClubSeason(league, 7, 2)!;
    expect(cs.squad.map((p) => p.pid)).toEqual([100]);
    // The snapshot stamped at the end of season 1 is what he carried through 2,
    // NOT his present-day 74.
    expect(cs.squad[0].ovr).toBe(68);
    expect(cs.squad[0].stats?.goals).toBe(2);
    expect(cs.live).toBe(false);
  });

  it("includes retirees from the archive, flagged, with no per-season stat line", () => {
    const league = makeLeague({
      seasonHistory: [entry(2, { 0: [7, 1, 2] })],
      players: [player(100, { 2: 7 })],
      retiredPlayers: [archived(500, { 2: 7 }), archived(501, { 2: 1 })],
    });

    const cs = computeClubSeason(league, 7, 2)!;
    expect(cs.squad.map((p) => p.pid).sort()).toEqual([100, 500]);
    expect(cs.fromArchiveCount).toBe(1);

    const retiree = cs.squad.find((p) => p.pid === 500)!;
    expect(retiree.fromArchive).toBe(true);
    expect(retiree.ovr).toBe(71);
    expect(retiree.appearances).toBe(20);
    // Archival keeps career totals, not a row per season, so his goals that
    // year are genuinely gone rather than zero.
    expect(retiree.stats).toBeNull();
  });

  it("takes the league finish from the season's own table, not the club's tier today", () => {
    const league = makeLeague({
      // Club 7 finished 2nd of three in the second tier that season, and is in
      // the top flight now.
      seasonHistory: [entry(2, { 0: [1, 2, 3], 1: [8, 7, 9] })],
      teams: [{ tid: 7, compId: 0, roster: [], starters: null }] as never,
    });

    const cs = computeClubSeason(league, 7, 2)!;
    expect(cs.position).toBe(2);
    expect(cs.teamsInComp).toBe(3);
    expect(cs.tier).toBe(2);
    expect(cs.champion).toBe(false);
  });

  it("reads the power ranking from the LAST snapshot of that season", () => {
    const league = makeLeague({
      seasonHistory: [entry(2, { 0: [7, 1, 2] })],
      powerRankingHistory: [
        // An earlier snapshot of the same season must lose to the finale.
        { season: 2, matchday: 20, rows: [
          { tid: 1, compId: 0, ovr: 70, pot: 75, powerScore: 70 },
          { tid: 7, compId: 0, ovr: 60, pot: 65, powerScore: 60 },
        ] },
        { season: 2, matchday: 38, rows: [
          { tid: 7, compId: 0, ovr: 72, pot: 78, powerScore: 74.5 },
          { tid: 1, compId: 1, ovr: 71, pot: 74, powerScore: 71 },
          { tid: 2, compId: 0, ovr: 65, pot: 70, powerScore: 65 },
        ] },
        // A different season must not be read at all.
        { season: 3, matchday: 38, rows: [
          { tid: 2, compId: 0, ovr: 90, pot: 90, powerScore: 90 },
          { tid: 7, compId: 0, ovr: 10, pot: 10, powerScore: 10 },
        ] },
      ] as never,
    });

    const cs = computeClubSeason(league, 7, 2)!;
    expect(cs.power).not.toBeNull();
    expect(cs.power!.matchday).toBe(38);
    expect(cs.power!.worldRank).toBe(1);
    expect(cs.power!.worldTotal).toBe(3);
    // Club 1 sits above club 7 in the world list but plays in another
    // competition, so the divisional rank must skip it.
    expect(cs.power!.divisionRank).toBe(1);
    expect(cs.power!.divisionTotal).toBe(2);
    expect(cs.power!.ovr).toBe(72);
  });

  it("has no power ranking for a season nothing was snapshotted in", () => {
    const league = makeLeague({ seasonHistory: [entry(2, { 0: [7, 1, 2] })] });
    expect(computeClubSeason(league, 7, 2)!.power).toBeNull();
  });

  it("builds the season being played from live state, and wins nothing yet", () => {
    const league = makeLeague({
      season: 5,
      teams: [{ tid: 7, compId: 0, roster: [100, 101], starters: null },
              { tid: 1, compId: 0, roster: [200], starters: null }] as never,
      players: [
        player(100, { 5: 7 }, { ovr: 77 }),
        player(101, {}, { ovr: 55 }),
        player(200, { 5: 1 }),
      ],
      played: [
        { home: 7, away: 1, homeGoals: 3, awayGoals: 0 },
      ] as never,
    });

    const cs = computeClubSeason(league, 7, 5)!;
    expect(cs.live).toBe(true);
    // The live squad is the roster, including a player yet to feature.
    expect(cs.squad.map((p) => p.pid).sort()).toEqual([100, 101]);
    // Mid-season his live ovr IS what he's playing at — ratings only move in
    // the offseason — so no snapshot lookup applies.
    expect(cs.squad.find((p) => p.pid === 100)!.ovr).toBe(77);
    expect(cs.squad.find((p) => p.pid === 101)!.appearances).toBe(0);
    expect(cs.position).toBe(1);
    expect(cs.row.points).toBe(3);
    // Top of the table in November is not a title.
    expect(cs.champion).toBe(false);
    expect(cs.promoted).toBe(false);
    expect(cs.fromArchiveCount).toBe(0);
    // The Power Rankings only snapshot every few matchdays, so the live squad
    // has to supply its own rating or the card sits blank at kickoff.
    expect(cs.power).toBeNull();
    expect(cs.liveRating).not.toBeNull();
    expect(cs.awaitingRollover).toBe(false);
  });

  it("flags a season whose football is done but which hasn't rolled over yet", () => {
    const league = makeLeague({
      season: 5,
      phase: "offseason",
      teams: [{ tid: 7, compId: 0, roster: [], starters: null }] as never,
    });
    const cs = computeClubSeason(league, 7, 5)!;
    expect(cs.live).toBe(true);
    expect(cs.awaitingRollover).toBe(true);
  });

  it("reads a completed season's rating off its snapshot, never today's squad", () => {
    const league = makeLeague({
      seasonHistory: [entry(2, { 0: [7, 1, 2] })],
      powerRankingHistory: [
        { season: 2, matchday: 38, rows: [{ tid: 7, compId: 0, ovr: 72, pot: 78, powerScore: 74 }] },
      ] as never,
    });
    const cs = computeClubSeason(league, 7, 2)!;
    expect(cs.power!.ovr).toBe(72);
    expect(cs.liveRating).toBeNull();
  });

  it("returns null for a season the club has no record of", () => {
    const league = makeLeague({ seasonHistory: [entry(2, { 0: [7, 1, 2] })] });
    expect(computeClubSeason(league, 7, 1)).toBeNull();
  });

  it("knows which seasons exist, so a link is never offered to one that doesn't", () => {
    const league = makeLeague({ season: 5, seasonHistory: [entry(2, { 0: [7, 1, 2] })] });
    expect(hasClubSeason(league, 5)).toBe(true);
    expect(hasClubSeason(league, 2)).toBe(true);
    // Season 0 is the baseline ratings snapshot stamped at league creation. It
    // is on every player's history table and was never played.
    expect(hasClubSeason(league, 0)).toBe(false);
    expect(hasClubSeason(league, 3)).toBe(false);
  });

  it("agrees with Club History about the same season", async () => {
    const { computeClubHistory } = await import("../../src/core/clubHistory.js");
    const league = makeLeague({
      seasonHistory: [entry(1, { 0: [1, 7, 2] }), entry(2, { 0: [7, 1, 2] })],
    });

    const record = computeClubHistory(league, 7).seasons.find((s) => s.season === 2)!;
    const cs = computeClubSeason(league, 7, 2)!;
    expect(cs.position).toBe(record.position);
    expect(cs.champion).toBe(record.champion);
    expect(cs.row).toEqual(record.row);
    expect(cs.tier).toBe(record.tier);
  });
});
