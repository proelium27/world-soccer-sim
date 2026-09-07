import { describe, it, expect, beforeAll } from "vitest";
import { playSeason } from "../helpers/offseasonLeague.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason, simOffseasonReporting } from "../../src/core/offseason.js";
import {
  detachArchive, reattachArchive, detachPlayed, reattachPlayed,
  detachCareer, reattachCareer, detachNews, reattachNews,
  detachTransfers, reattachTransfers,
} from "../../src/core/simArchive.js";
import { PLAYER_SETTLED_SEASONS } from "../../src/core/constants.js";
import { referencedPids } from "../../src/core/players/playerNames.js";
import { honourSourcesOf } from "../../src/core/frivolities/goat.js";
import { computeTeamSeasonStats } from "../../src/core/standings.js";
import { pruneRetireeArchive } from "../../src/core/players/archive.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * The gate for core/simArchive.ts.
 *
 * Holding history back from the worker is only safe while the sim never reads
 * it. A read would see an empty array — no type error, no crash, just quietly
 * wrong output — so the test that matters is the end-to-end equivalence: a
 * detached round trip must land on exactly the league an undetached one does.
 */
describe("simArchive", () => {
  /**
   * One aged England-only league, shared by every case.
   *
   * Two deliberate economies, because what this file asserts is structural and
   * a slow test file here is not free: the whole suite runs its files in
   * parallel, and `test/db/leagueDb.test.ts` sits on 5s timeouts that a heavy
   * neighbour pushes it past. Two divisions instead of sixteen competitions
   * costs a fraction of the sim and proves exactly the same property, and one
   * league shared across cases beats building it four times over (nothing here
   * mutates it). Three seasons is the floor that gives real snapshots *and* a
   * real retiree archive to merge against.
   *
   * `createLeagueState` rather than `makeLeague`: the rng is reused after
   * generation, so it has to be the one generation advanced (see the note on
   * the helper).
   */
  let league: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(41);
    league = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    for (let i = 0; i < 3; i++) {
      league = playSeason(league, rng);
      league = simOffseason(league, rng);
    }
  }, 600_000);

  it("detach empties exactly the held-back fields and keeps everything else", () => {
    const { payload, archive } = detachArchive(league);

    expect(archive.powerRankingHistory.length).toBeGreaterThan(0);
    expect(archive.retiredPlayers.length).toBeGreaterThan(0);
    expect(payload.powerRankingHistory).toEqual([]);
    expect(payload.retiredPlayers).toEqual([]);

    // Nothing else may be disturbed — the sim reads the rest.
    const rest = (l: LeagueStore) => ({ ...l, powerRankingHistory: [], retiredPlayers: [] });
    expect(rest(payload)).toEqual(rest(league));
  });

  it("an offseason on a detached league lands where an undetached one does", () => {
    const whole = simOffseason(league, mulberry32(7));

    const { payload, archive } = detachArchive(league);
    const detached = reattachArchive(simOffseason(payload, mulberry32(7)), archive);

    expect(detached).toEqual(whole);
  });

  it("a season plus its offseason lands where an undetached run does", () => {
    const rngA = mulberry32(9);
    const whole = simOffseason(simThrough(league, "season", rngA), rngA);

    const { payload, archive } = detachArchive(league);
    const rngB = mulberry32(9);
    const detached = reattachArchive(
      simOffseason(simThrough(payload, "season", rngB), rngB),
      archive,
    );

    expect(detached).toEqual(whole);
    // The point of the exercise: the worker never carried the old history.
    expect(detached.powerRankingHistory.length).toBeGreaterThan(
      archive.powerRankingHistory.length,
    );
  });

  it("what comes back in the held-back fields is only the new entries", () => {
    const { payload, archive } = detachArchive(league);
    const rng = mulberry32(11);
    const result = simOffseason(simThrough(payload, "season", rng), rng);

    // Not the accumulated history — that is the whole saving.
    expect(result.powerRankingHistory.length).toBeLessThan(archive.powerRankingHistory.length);
    for (const snap of result.powerRankingHistory) {
      expect(snap.season).toBe(league.season);
    }
  });

  it("pruning the merged archive once matches pruning it every season", () => {
    // careerScore is a pure function of a row, so iterated eviction and a
    // single final top-N must select the same set. Rows are stand-ins; only
    // the ordering key matters.
    const row = (pid: number, apps: number): ArchivedPlayer =>
      ({ pid, totals: { appearances: apps }, best: {}, seasons: [] }) as unknown as ArchivedPlayer;

    const seasons = [
      [row(1, 500), row(2, 10)],
      [row(3, 400), row(4, 20)],
      [row(5, 300), row(6, 30)],
    ];

    let iterated: ArchivedPlayer[] = [];
    for (const batch of seasons) iterated = pruneRetireeArchive([...iterated, ...batch], 3);

    const atOnce = pruneRetireeArchive(seasons.flat(), 3);

    expect(iterated.map((r) => r.pid)).toEqual(atOnce.map((r) => r.pid));
  });
});

/**
 * The gate for detachPlayed/reattachPlayed.
 *
 * Box scores of already-played matches are the heaviest thing in a save (88% of
 * it by the end of a season on a large world), and the sim reads them in
 * exactly one place. Same shape of test as above and for the same reason: a
 * stub the sim *does* read yields zeroes, not an error.
 */
describe("simArchive played box scores", () => {
  let mid: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(77);
    const fresh = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    mid = simThrough(fresh, { matchday: 12 }, rng);
  }, 600_000);

  it("strips the box scores but keeps everything the sim reads", () => {
    const { payload, played } = detachPlayed(mid);

    expect(played.length).toBeGreaterThan(0);
    expect(payload.played).toHaveLength(mid.played.length);
    for (let i = 0; i < payload.played.length; i++) {
      const before = mid.played[i];
      const after = payload.played[i];
      // Scores, possession and matchday are read by standings, form and the
      // markets, so they must survive untouched.
      expect(after.home).toBe(before.home);
      expect(after.away).toBe(before.away);
      expect(after.homeGoals).toBe(before.homeGoals);
      expect(after.awayGoals).toBe(before.awayGoals);
      expect(after.matchday).toBe(before.matchday);
      expect(after.possessionHome).toBe(before.possessionHome);
      // The weight is gone.
      expect(after.boxScore.home).toEqual([]);
      expect(after.boxScore.away).toEqual([]);
      expect(after.boxScore.events).toEqual([]);
    }
    expect(JSON.stringify(payload).length).toBeLessThan(JSON.stringify(mid).length / 2);
  });

  it("simming on stripped matches lands where an unstripped run does", () => {
    const whole = simThrough(mid, { matchday: 20 }, mulberry32(5));

    const { payload, played } = detachPlayed(mid);
    const stripped = reattachPlayed(simThrough(payload, { matchday: 20 }, mulberry32(5)), played);

    expect(stripped).toEqual(whole);
  });

  it("a whole season plus its offseason lands where an unstripped run does", () => {
    const rngA = mulberry32(6);
    const whole = simOffseason(simThrough(mid, "season", rngA), rngA);

    // What the worker boundary actually does: strip, sim, reattach, then strip
    // again for the offseason with the team stats worked out on this side.
    const rngB = mulberry32(6);
    const a = detachPlayed(mid);
    const seasonDone = reattachPlayed(simThrough(a.payload, "season", rngB), a.played);
    const teamStats = computeTeamSeasonStats(
      seasonDone.teams.map((t) => t.tid),
      seasonDone.played,
    );
    const b = detachPlayed(seasonDone);
    const stripped = reattachPlayed(simOffseason(b.payload, rngB, { teamStats }), b.played);

    expect(stripped).toEqual(whole);
  });

  it("keeps the worker's own matches when the offseason wiped the array", () => {
    // No leading stubs in the result means `played` was cleared and refilled,
    // so nothing may be restored over the top of it.
    const { played } = detachPlayed(mid);
    const rolled: LeagueStore = { ...mid, played: [] };
    expect(reattachPlayed(rolled, played).played).toEqual([]);
  });
});

/**
 * The gate for detachCareer/reattachCareer.
 *
 * `stats[]` + `hist[]` are 45.2 MB of the reported season-60 save and, unlike
 * the box scores, are there whatever the matchday. Nothing in the sim reads a
 * whole career now that `archivePlayer` builds from the stored summary, so the
 * worker gets a window instead.
 *
 * The window is sized from the code — the position-change spell walk is the
 * widest consumer — but reading the constants cannot prove it is wide enough.
 * Running a whole season and offseason on the window and requiring the same
 * league out is what proves it, because the offseason is where a career is
 * actually read: the spell walk, the awards' ovrDuringSeason, the career fold
 * and the retiree archive all happen there.
 */
describe("simArchive career windows", () => {
  let aged: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(88);
    aged = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    for (let i = 0; i < 3; i++) {
      aged = simThrough(aged, "season", rng);
      aged = simOffseason(aged, rng);
    }
  }, 600_000);

  it("hands the worker a fraction of the career data", () => {
    const { payload, careers } = detachCareer(aged);
    expect(careers.size).toBeGreaterThan(100);

    const bytes = (l: LeagueStore) =>
      l.players.reduce(
        (n, p) => n + JSON.stringify(p.stats).length + JSON.stringify(p.hist).length,
        0,
      );
    expect(bytes(payload)).toBeLessThan(bytes(aged));
  });

  it("a season on windowed careers lands where a full-career run does", () => {
    const whole = simThrough(aged, "season", mulberry32(21));

    const { payload, careers } = detachCareer(aged);
    const windowed = reattachCareer(simThrough(payload, "season", mulberry32(21)), careers);

    expect(windowed).toEqual(whole);
  });

  it("an offseason on windowed careers lands where a full-career run does", () => {
    const full = simThrough(aged, "season", mulberry32(22));
    const whole = simOffseason(full, mulberry32(23));

    const { payload, careers } = detachCareer(full);
    const windowed = reattachCareer(simOffseason(payload, mulberry32(23)), careers);

    expect(windowed).toEqual(whole);
  });
});

/**
 * The gate for detachNews/reattachNews.
 *
 * ~23 MB on the reported season-60 save, and the trickiest of the four, because
 * these are not purely append-only: `cullFreeAgentPool` scrubs a culled
 * player's rows out of them, and `extendPlayerNames` walks them to decide which
 * retirees are still worth naming. So the round trip has to reproduce a scrub
 * the worker could not perform and a decision it could not make.
 */
describe("simArchive news and cup histories", () => {
  let aged: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(95);
    aged = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    for (let i = 0; i < 3; i++) {
      aged = simThrough(aged, "season", rng);
      aged = simOffseason(aged, rng);
    }
  }, 600_000);

  it("empties exactly those fields and leaves the rest alone", () => {
    const { payload, news } = detachNews(aged);
    expect(news.newsEvents.length).toBeGreaterThan(0);
    expect(payload.newsEvents).toEqual([]);
    expect(payload.cupHistory).toEqual([]);
    expect(payload.shieldHistory).toEqual([]);
    expect(payload.domesticCupHistory).toEqual([]);

    const rest = (l: LeagueStore) => ({
      ...l, newsEvents: [], cupHistory: [], shieldHistory: [], domesticCupHistory: [],
    });
    expect(rest(payload)).toEqual(rest(aged));
  });

  it("a season on a detached league lands where an undetached run does", () => {
    const whole = simThrough(aged, "season", mulberry32(31));
    const { payload, news } = detachNews(aged);
    // No offseason, so nothing was culled.
    const detached = reattachNews(
      simThrough(payload, "season", mulberry32(31)), news, new Set(),
    );
    expect(detached).toEqual(whole);
  });

  it("an offseason lands where an undetached run does, cull and all", () => {
    const full = simThrough(aged, "season", mulberry32(32));
    const whole = simOffseason(full, mulberry32(33));

    // Exactly what the worker boundary does: hold the history back, hand in
    // what the offseason still needs from it, then scrub with the pids the
    // worker reports. Two things are handed in, and both are here because
    // reading them off the emptied payload is silently wrong rather than an
    // error: the referenced set (for `extendPlayerNames`) and the cup champions
    // (for ranking the retirees, which would otherwise score a five-time
    // Continental Cup winner as if he had won none). See useSimWorker's post().
    const { payload, news } = detachNews(full);
    const { league: result, report } = simOffseasonReporting(payload, mulberry32(33), {
      referencedPids: referencedPids(full),
      cupChampions: honourSourcesOf(full),
    });
    const detached = reattachNews(result, news, report.culledPids);

    expect(detached).toEqual(whole);
  });

  it("scrubs a culled player out of the history the worker never saw", () => {
    // The failure this exists for: without the scrub a deleted player's rows
    // survive and render as "Player 4821".
    const full = simThrough(aged, "season", mulberry32(34));
    const { payload, news } = detachNews(full);
    const { report } = simOffseasonReporting(payload, mulberry32(35), {
      referencedPids: referencedPids(full),
    });

    if (report.culledPids.size === 0) return; // nothing culled this run
    const before = news.newsEvents.filter(
      (e) => "pid" in e && typeof e.pid === "number" && report.culledPids.has(e.pid),
    ).length;
    const kept = reattachNews(
      { ...payload, newsEvents: [] } as LeagueStore, news, report.culledPids,
    ).newsEvents.filter(
      (e) => "pid" in e && typeof e.pid === "number" && report.culledPids.has(e.pid),
    ).length;
    expect(kept).toBe(0);
    expect(before).toBeGreaterThanOrEqual(kept);
  });
});

/**
 * The gate for detachTransfers/reattachTransfers.
 *
 * 14.8 MB on the reported season-60 save, and the only one of the five the sim
 * actually reads. It is safe because that read — `joinedSeasons` feeding
 * `settledMultiplier` — gives the same answer for a player who arrived
 * PLAYER_SETTLED_SEASONS ago as for one with no record at all, so a row older
 * than the window cannot change a decision. That is what these assert: the
 * window is genuinely a suffix of the log, and a season and an offseason run on
 * it land where a run on the whole thing does.
 */
describe("simArchive transfer window", () => {
  let aged: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(96);
    aged = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    // Long enough that the window really cuts something: PLAYER_SETTLED_SEASONS
    // is 3, so a shorter dynasty would keep the whole log and assert nothing.
    for (let i = 0; i < 5; i++) {
      aged = simThrough(aged, "season", rng);
      aged = simOffseason(aged, rng);
    }
  }, 900_000);

  it("cuts a suffix, holds the prefix, and loses nothing in between", () => {
    const { payload, transfers } = detachTransfers(aged);
    expect(transfers.length).toBeGreaterThan(0); // the window is doing work
    expect(payload.transfers.length).toBeGreaterThan(0);
    expect([...transfers, ...payload.transfers]).toEqual(aged.transfers);
    // Everything inert is held back, everything still live is sent.
    const cutoff = aged.season - PLAYER_SETTLED_SEASONS;
    expect(transfers.every((t) => t.season < cutoff)).toBe(true);
    expect(payload.transfers.every((t) => t.season >= cutoff)).toBe(true);
  });

  it("a season on the window lands where a run on the whole log does", () => {
    const whole = simThrough(aged, "season", mulberry32(41));
    const { payload, transfers } = detachTransfers(aged);
    const detached = reattachTransfers(
      simThrough(payload, "season", mulberry32(41)), transfers, new Set(),
    );
    expect(detached).toEqual(whole);
  });

  it("an offseason does too, cull and all", () => {
    const full = simThrough(aged, "season", mulberry32(42));
    const whole = simOffseason(full, mulberry32(43));

    const { payload, transfers } = detachTransfers(full);
    const { league: result, report } = simOffseasonReporting(payload, mulberry32(43), {
      referencedPids: referencedPids(full),
    });
    const detached = reattachTransfers(result, transfers, report.culledPids);

    expect(detached).toEqual(whole);
  });

  it("holds back none of a save younger than the window", () => {
    const young = createLeagueState(0, mulberry32(97), 0, "normal", englandCompetitions());
    expect(detachTransfers(young).transfers).toEqual([]);
  });
});
