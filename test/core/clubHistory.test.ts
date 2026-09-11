import { describe, it, expect } from "vitest";
import { computeClubHistory } from "../../src/core/clubHistory.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { StandingsRow, SeasonHistoryEntry } from "../../src/core/standings.js";
import type { SeasonAwards } from "../../src/core/awards.js";
import type { Player } from "../../src/core/players/types.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import type { CupState, CupTie } from "../../src/core/cup/types.js";
import { CUP_FINAL_ROUND } from "../../src/core/constants.js";

// Minimal StandingsRow with sensible defaults.
function row(tid: number, points: number, won = points / 3, extra: Partial<StandingsRow> = {}): StandingsRow {
  return { tid, played: 38, won, drawn: 0, lost: 38 - won, gf: won * 2, ga: 38 - won, gd: won * 2 - (38 - won), points, ...extra };
}

// A season entry where `orderByComp` gives, per compId, the tids in finishing order.
function entry(
  season: number,
  orderByComp: Record<number, number[]>,
  awards: Record<number, SeasonAwards>,
): SeasonHistoryEntry {
  const table: StandingsRow[] = [];
  const compsByTid: Record<number, number> = {};
  const championTidByCompId: Record<number, number> = {};
  for (const [compIdStr, tids] of Object.entries(orderByComp)) {
    const compId = Number(compIdStr);
    tids.forEach((tid, i) => {
      table.push(row(tid, (tids.length - i) * 3)); // first place = most points
      compsByTid[tid] = compId;
    });
    if (compId === 0) championTidByCompId[compId] = tids[0];
  }
  return {
    season, table, teamStats: [], awards, compsByTid, championTidByCompId,
    world: { ballonDOr: [], worldTeamOfYear: [] },
  };
}

const noAwards: SeasonAwards = { playerOfSeasonPid: null, goldenBootPid: null, teamOfSeason: [] };

function player(pid: number, seasonTids: Record<number, number>): Player {
  const stats = Object.entries(seasonTids).map(([s, tid]) => ({ season: Number(s), tid }) as Player["stats"][number]);
  return { pid, stats } as unknown as Player;
}

function makeLeague(
  history: SeasonHistoryEntry[],
  teams: { tid: number; compId: number }[],
  players: Player[],
  cupHistory: CupState[] = [],
): LeagueStore {
  return {
    competitions: englandCompetitions(),
    seasonHistory: history,
    teams,
    players,
    cupHistory,
  } as unknown as LeagueStore;
}

function cupTie(round: number, home: number, away: number, winner: number): CupTie {
  return { round, home, away, winner } as unknown as CupTie;
}

function cup(season: number, teams: number[], ties: CupTie[]): CupState {
  return { season, teams, ties } as unknown as CupState;
}

describe("computeClubHistory", () => {
  it("counts titles, promotions and finishing positions across seasons", () => {
    // Club 7 wins tier-2 in season 1 (promoted), then wins tier-1 in season 2.
    const history = [
      entry(1, { 0: [1, 2, 3], 1: [7, 8, 9] }, { 0: noAwards, 1: noAwards }),
      entry(2, { 0: [7, 1, 2], 1: [3, 8, 9] }, { 0: noAwards, 1: noAwards }),
    ];
    // In season 3 club 7 is still tier-1 (compId 0).
    const league = makeLeague(history, [{ tid: 7, compId: 0 }], []);
    const h = computeClubHistory(league, 7);

    expect(h.seasonsPlayed).toBe(2);
    expect(h.leagueTitles).toEqual([2]); // tier-1 title, newest first
    expect(h.secondTierTitles).toEqual([1]);
    expect(h.promotions).toEqual([1]); // promoted at end of season 1
    expect(h.relegations).toEqual([]);

    // Newest-first season records.
    expect(h.seasons[0].season).toBe(2);
    expect(h.seasons[0].position).toBe(1);
    expect(h.seasons[0].tier).toBe(1);
    expect(h.seasons[1].season).toBe(1);
    expect(h.seasons[1].position).toBe(1);
    expect(h.seasons[1].tier).toBe(2);
    expect(h.seasons[1].promoted).toBe(true);
  });

  it("attributes individual awards only to the club the player was on that season", () => {
    const awardsS1: SeasonAwards = { playerOfSeasonPid: 100, goldenBootPid: 101, teamOfSeason: [100, 200, 101] };
    const history = [entry(1, { 0: [7, 1, 2] }, { 0: awardsS1 })];
    const league = makeLeague(
      history,
      [{ tid: 7, compId: 0 }],
      [
        player(100, { 1: 7 }), // on club 7 in season 1
        player(101, { 1: 7 }), // on club 7
        player(200, { 1: 1 }), // on a different club
      ],
    );
    const h = computeClubHistory(league, 7);

    expect(h.playerOfSeason.map((a) => a.pid)).toEqual([100]);
    expect(h.goldenBoots.map((a) => a.pid)).toEqual([101]);
    // 200 belonged to another club, so only 100 and 101 count for club 7.
    expect(h.teamOfSeasonSelections.map((a) => a.pid).sort()).toEqual([100, 101]);
    expect(h.seasons[0].teamOfSeasonPids.sort()).toEqual([100, 101]);
  });

  // Retirement deletes a player from `league.players`, so a lookup that only
  // reads the live pool loses every award he won once he hangs up his boots.
  it("keeps crediting a retired player's awards to the club he won them at", () => {
    const awardsS1: SeasonAwards = { playerOfSeasonPid: 100, goldenBootPid: 101, teamOfSeason: [100, 101, 200] };
    const history = [entry(1, { 0: [7, 1, 2] }, { 0: awardsS1 })];
    history[0].world = { ballonDOr: [{ pid: 100 } as never], worldTeamOfYear: [101] };
    // 100 retired into the archive; 101 retired below the archive's bar and
    // survives only in the season's award snapshot; 200 was elsewhere.
    history[0].awardWinners = [
      { pid: 100, name: "A", nationality: "England", pos: "ST", ovr: 90, tid: 7, born: 0 },
      { pid: 101, name: "B", nationality: "England", pos: "W", ovr: 80, tid: 7, born: 0 },
      { pid: 200, name: "C", nationality: "England", pos: "CB", ovr: 80, tid: 1, born: 0 },
    ];
    const league = makeLeague(history, [{ tid: 7, compId: 0 }], []);
    (league as { retiredPlayers: unknown }).retiredPlayers = [
      { pid: 100, seasons: [{ season: 1, tid: 7, ovr: 90, apps: 38 }] },
    ];
    const h = computeClubHistory(league, 7);

    expect(h.playerOfSeason.map((a) => a.pid)).toEqual([100]);
    expect(h.goldenBoots.map((a) => a.pid)).toEqual([101]);
    expect(h.teamOfSeasonSelections.map((a) => a.pid).sort()).toEqual([100, 101]);
    expect(h.seasons[0].ballonDOrPid).toBe(100);
    expect(h.seasons[0].worldTeamOfYearPids).toEqual([101]);
  });

  it("detects relegation and computes franchise records", () => {
    // Club 3 is tier-1 in season 1 (finishes last), tier-2 in season 2.
    const history = [
      entry(1, { 0: [1, 2, 3], 1: [7, 8, 9] }, { 0: noAwards, 1: noAwards }),
      entry(2, { 0: [1, 2, 7], 1: [3, 8, 9] }, { 0: noAwards, 1: noAwards }),
    ];
    const league = makeLeague(history, [{ tid: 3, compId: 1 }], []);
    const h = computeClubHistory(league, 3);

    expect(h.relegations).toEqual([1]);
    expect(h.promotions).toEqual([]);
    // Best finish prefers the tier-1 season even though it was 3rd, over the tier-2 title.
    expect(h.bestFinish).toEqual({ season: 1, position: 3, tier: 1 });
    expect(h.secondTierTitles).toEqual([2]); // won tier-2 in season 2
    expect(h.totals.played).toBe(76); // 38 * 2 seasons
    expect(h.mostPoints!.points).toBeGreaterThan(0);
  });

  it("records Continental Cup titles, finals lost, and eliminations per season", () => {
    // Club 7 plays three seasons: wins the cup, loses the final, then goes out in the semis.
    const history = [
      entry(1, { 0: [7, 1, 2] }, { 0: noAwards }),
      entry(2, { 0: [7, 1, 2] }, { 0: noAwards }),
      entry(3, { 0: [7, 1, 2] }, { 0: noAwards }),
    ];
    const cups = [
      cup(1, [7, 8], [cupTie(CUP_FINAL_ROUND, 7, 8, 7)]), // won the final
      cup(2, [7, 8], [cupTie(CUP_FINAL_ROUND, 7, 8, 8)]), // lost the final
      cup(3, [7, 8], [cupTie(CUP_FINAL_ROUND - 1, 7, 8, 8)]), // out in the semis
    ];
    const league = makeLeague(history, [{ tid: 7, compId: 0 }], [], cups);
    const h = computeClubHistory(league, 7);

    expect(h.cupTitles).toEqual([1]);
    expect(h.cupFinals).toEqual([2]);
    // Per-season cup runs, newest first (seasons 3, 2, 1).
    expect(h.seasons[0].cupRun).toEqual({ note: "Semi-finals", isChampion: false, isRunnerUp: false });
    expect(h.seasons[1].cupRun).toEqual({ note: "Runners-up", isChampion: false, isRunnerUp: true });
    expect(h.seasons[2].cupRun).toEqual({ note: "Winners", isChampion: true, isRunnerUp: false });
  });

  it("leaves cup runs null when the club didn't qualify or no cup ran", () => {
    const history = [entry(1, { 0: [7, 1, 2] }, { 0: noAwards })];
    // A cup that season, but club 7 isn't in it.
    const cups = [cup(1, [1, 2], [cupTie(CUP_FINAL_ROUND, 1, 2, 1)])];
    const league = makeLeague(history, [{ tid: 7, compId: 0 }], [], cups);
    const h = computeClubHistory(league, 7);
    expect(h.cupTitles).toEqual([]);
    expect(h.cupFinals).toEqual([]);
    expect(h.seasons[0].cupRun).toBeNull();
  });

  it("returns an empty history when no seasons are completed", () => {
    const league = makeLeague([], [{ tid: 7, compId: 0 }], []);
    const h = computeClubHistory(league, 7);
    expect(h.seasonsPlayed).toBe(0);
    expect(h.leagueTitles).toEqual([]);
    expect(h.bestFinish).toBeNull();
    expect(h.seasons).toEqual([]);
  });
});
