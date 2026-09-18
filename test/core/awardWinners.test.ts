import { describe, expect, it } from "vitest";
import {
  awardWinnerPids, snapshotAwardWinners, backfillAwardWinners, awardWinnerIndex,
  type AwardWinner,
} from "../../src/core/awardWinners.js";
import { computeAwardTrivia, sortAwardRows } from "../../src/core/frivolities/honours.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import { emptyTotals, emptyBestSeasons } from "../../src/core/frivolities/stats.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";

const SEASON = 2025;

function makePlayer(pid: number, over: Partial<Player> = {}, tid = 1): Player {
  return {
    pid,
    name: `Name ${pid}`,
    nationality: "eng",
    born: SEASON - 27,
    pos: "ST",
    ovr: 70,
    recentStats: [{ ...emptySeasonStats(SEASON, tid), appearances: 30, goals: 20 }],
    // ovrDuringSeason reads the hist entry tagged `season - 1`.
    recentHist: [{ season: SEASON - 1, ovr: 84, potential: 84, academy: false, ratings: {} }],
    ...over,
  } as unknown as Player;
}

/** A season entry whose awards point at pids 1-4. */
function entryFor(over: Partial<SeasonHistoryEntry> = {}): SeasonHistoryEntry {
  return {
    season: SEASON,
    table: [],
    teamStats: [],
    awards: {
      0: { playerOfSeasonPid: 1, goldenBootPid: 2, teamOfSeason: [3, null] },
    },
    world: {
      ballonDOr: [{ pid: 1, tid: 1, score: 9, league: 9, cup: 0, intl: 0, title: 0 }],
      worldTeamOfYear: [4, null],
    },
    compsByTid: { 1: 0, 2: 0 },
    championTidByCompId: { 0: 1 },
    ...over,
  } as unknown as SeasonHistoryEntry;
}

describe("awardWinnerPids", () => {
  it("collects every pid an entry's awards point at, world and domestic", () => {
    expect([...awardWinnerPids(entryFor())].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("is empty for a season that handed out nothing", () => {
    expect(awardWinnerPids({}).size).toBe(0);
  });
});

describe("snapshotAwardWinners", () => {
  it("copies each winner's identity, the rating he played the season at, and his club", () => {
    const players = [1, 2, 3, 4].map((pid) => makePlayer(pid, {}, pid + 10));
    const winners = snapshotAwardWinners(players, SEASON, entryFor());
    expect(winners.map((w) => w.pid).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    const one = winners.find((w) => w.pid === 1)!;
    expect(one.name).toBe("Name 1");
    expect(one.nationality).toBe("eng");
    expect(one.tid).toBe(11);
    // Not p.ovr (70) — the rating he carried through the season being judged,
    // which is the same number the award itself was scored on.
    expect(one.ovr).toBe(84);
    expect(one.born).toBe(SEASON - 27);
  });

  it("takes nobody who didn't win anything", () => {
    const players = [makePlayer(1), makePlayer(99)];
    const winners = snapshotAwardWinners(players, SEASON, entryFor());
    expect(winners.map((w) => w.pid)).toEqual([1]);
  });

  it("skips a pid with nobody behind it rather than stubbing a row", () => {
    // A stub that says "unknown" reads the same to a caller as a missing row,
    // and every caller has to keep its fallback anyway.
    const winners = snapshotAwardWinners([makePlayer(1)], SEASON, entryFor());
    expect(winners).toHaveLength(1);
  });
});

function makeArchived(pid: number, over: Partial<ArchivedPlayer> = {}): ArchivedPlayer {
  return {
    pid, name: `Retiree ${pid}`, nationality: "esp", pos: "CB", born: SEASON - 30, heightCm: 180,
    retiredSeason: SEASON + 2, retiredAge: 34, firstSeason: SEASON - 8, seasonsPlayed: 10,
    peakOvr: 80, peakSeason: SEASON, finalOvr: 71, clubs: [7],
    totals: emptyTotals(), best: emptyBestSeasons(),
    caps: 0, intlGoals: 0, intlTitles: 0,
    seasons: [{ season: SEASON, tid: 7, ovr: 79, apps: 34 }],
    ...over,
  } as ArchivedPlayer;
}

describe("backfillAwardWinners", () => {
  it("falls back to the retiree archive for winners the pool has already lost", () => {
    const winners = backfillAwardWinners(
      entryFor(), SEASON, [makePlayer(1)], [makeArchived(3)],
    )!;
    expect(winners.map((w) => w.pid).sort((a, b) => a - b)).toEqual([1, 3]);
    const archived = winners.find((w) => w.pid === 3)!;
    expect(archived.name).toBe("Retiree 3");
    // The archive's own line for that season, not his final rating.
    expect(archived.ovr).toBe(79);
    expect(archived.tid).toBe(7);
  });

  it("leaves an entry that already has winners alone", () => {
    const existing: AwardWinner[] = [
      { pid: 42, name: "Kept", nationality: "esp", pos: "GK", ovr: 80, born: 2000 },
    ];
    const winners = backfillAwardWinners(
      entryFor({ awardWinners: existing }), SEASON, [makePlayer(1)], [],
    );
    expect(winners).toBe(existing);
  });

  it("gives a season that handed out no awards nothing to store", () => {
    expect(backfillAwardWinners(
      entryFor({ awards: {}, world: { ballonDOr: [], worldTeamOfYear: [] } }),
      SEASON, [makePlayer(1)], [],
    )).toBeUndefined();
  });

  it("records only what the save can still resolve, and never invents the rest", () => {
    // The measured failure this record exists for: on a long save most winners
    // are in neither the pool nor the archive. Those stay unnamed — freezing
    // the loss where it already is beats fabricating a name.
    const winners = backfillAwardWinners(entryFor(), SEASON, [], [])!;
    expect(winners).toEqual([]);
  });
});

describe("awardWinnerIndex", () => {
  it("keeps the latest season's name for a repeat winner", () => {
    const index = awardWinnerIndex([
      { awardWinners: [{ pid: 1, name: "Early", nationality: "eng", pos: "ST", ovr: 70, born: 2000 }] },
      { awardWinners: [{ pid: 1, name: "Later", nationality: "eng", pos: "ST", ovr: 80, born: 2000 }] },
    ]);
    expect(index.get(1)!.name).toBe("Later");
  });
});

/** A LeagueStore carrying only what the honours boards read. */
function makeStore(over: Partial<LeagueStore> = {}): LeagueStore {
  return {
    season: SEASON + 40,
    competitions: [{ id: 0, country: "eng", tier: 1, name: "England D1" }],
    teams: [{ tid: 1, roster: [], academyRoster: [], compId: 0 }],
    players: [],
    retiredPlayers: [],
    seasonHistory: [],
    transfers: [],
    cupHistory: [],
    ...over,
  } as unknown as LeagueStore;
}

describe("honours boards, once the winners themselves are gone", () => {
  /** Nobody in the pool, nobody in the archive — the state a century-long save is in. */
  const forgotten = () => makeStore({
    seasonHistory: [entryFor({
      awardWinners: [
        { pid: 1, name: "Lost Legend", nationality: "bra", pos: "ST", ovr: 88, tid: 1, born: SEASON - 26 },
      ],
    })],
  });

  it("names a winner the save has no player record of at all", () => {
    const trivia = computeAwardTrivia(forgotten());
    expect(trivia.rollOfHonour[0].winner.name).toBe("Lost Legend");
    expect(trivia.rollOfHonour[0].winner.nationality).toBe("bra");
    // Age comes off the snapshot's birth season, so the youngest/oldest winner
    // boards keep working too.
    expect(trivia.rollOfHonour[0].winner.age).toBe(26);
  });

  it("still ranks him on the decorated-careers board", () => {
    // Without a career row of his own he vanishes from the board entirely,
    // which on a long save silently drops most of its own winners.
    const rows = sortAwardRows(computeAwardTrivia(forgotten()).careers, "total");
    const row = rows.find((r) => r.career.pid === 1)!;
    expect(row.career.name).toBe("Lost Legend");
    expect(row.career.active).toBe(false);
    expect(row.tally.ballonDOr).toBe(1);
    expect(row.tally.playerOfSeason).toBe(1);
  });

  it("credits his club and his country, which a pid alone cannot", () => {
    const trivia = computeAwardTrivia(forgotten());
    expect(trivia.clubs.find((c) => c.tid === 1)!.ballonDOr).toBe(1);
    expect(trivia.nations.find((n) => n.nationality === "bra")!.playerOfSeason).toBe(1);
  });

  it("prefers the career where the save still has one", () => {
    const store = makeStore({
      players: [makePlayer(1, { name: "Still Playing" })],
      seasonHistory: [entryFor({
        awardWinners: [
          { pid: 1, name: "Stale Copy", nationality: "bra", pos: "ST", ovr: 88, tid: 1, born: SEASON - 26 },
        ],
      })],
    });
    const winner = computeAwardTrivia(store).rollOfHonour[0].winner;
    expect(winner.name).toBe("Still Playing");
    expect(winner.active).toBe(true);
  });

  it("falls back to a placeholder for a season recorded before winners were", () => {
    const store = makeStore({ seasonHistory: [entryFor()] });
    expect(computeAwardTrivia(store).rollOfHonour[0].winner.name).toBe("Player 1");
  });
});
