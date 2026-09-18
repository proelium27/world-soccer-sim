import { describe, it, expect, beforeAll } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import {
  summaryOf, withSeason, emptyCareerSummary, ovrLookup, liveCareer,
} from "../../src/core/players/careerSummary.js";
import { totalsOf, bestSeasonsOf } from "../../src/core/frivolities/stats.js";
import { migrateLeague } from "../../src/db/migrate.js";
import { archivePlayer, isArchiveWorthy } from "../../src/core/players/archive.js";
import type { Player } from "../../src/core/players/types.js";
import { emptySeasonStats } from "../../src/core/players/types.js";
import { seasonIsResident, windowCareer } from "../../src/core/simArchive.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * `Player.career` lets the all-time boards rank 10,864 careers without reading
 * 10,864 careers once `stats[]` moves to disk (docs/lazy-career-plan.md). That
 * is only true while the stored summary is exactly what folding the seasons
 * produces, so that equality is the whole test.
 *
 * The contract under test: a stored summary covers **finished** seasons only,
 * so a live number is the stored summary plus the current season's row.
 */
describe("career summary", () => {
  let league: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(52);
    league = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    for (let i = 0; i < 4; i++) {
      league = simThrough(league, "season", rng);
      league = simOffseason(league, rng);
    }
    // Part-way into a fifth, so there is an unfinished season to exclude.
    league = simThrough(league, { matchday: 9 }, rng);
  }, 600_000);

  it("stored + the current season equals folding the whole career", () => {
    let checked = 0;
    for (const p of league.players) {
      const current = p.recentStats.find((s) => s.season === league.season);
      const ovrFor = ovrLookup(p.recentHist, p.peakOvr ?? p.ovr);
      const live = current
        ? withSeason(p.career ?? emptyCareerSummary(), current, ovrFor(current.season))
        : (p.career ?? emptyCareerSummary());
      const whole = summaryOf(p.recentStats, ovrFor);

      expect(live.totals).toEqual(whole.totals);
      expect(live.best).toEqual(whole.best);
      expect(live.seasons).toEqual(whole.seasons);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("excludes the season still being played", () => {
    // Someone has played this season; his stored summary must not contain it,
    // or the fold above would double-count.
    const active = league.players.filter((p) => {
      const cur = p.recentStats.find((s) => s.season === league.season);
      return cur !== undefined && cur.appearances > 0;
    });
    expect(active.length).toBeGreaterThan(100);

    for (const p of active.slice(0, 100)) {
      const finished = p.recentStats.filter((s) => s.season !== league.season);
      expect(p.career!.totals).toEqual(summaryOf(finished, ovrLookup(p.recentHist, p.peakOvr ?? p.ovr)).totals);
    }
  });

  it("is actually maintained, not falling through to a default", () => {
    const veterans = league.players.filter((p) => p.recentStats.some((s) => s.season < league.season));
    expect(veterans.length).toBeGreaterThan(500);
    expect(veterans.every((p) => p.career !== undefined)).toBe(true);
  });

  it("agrees with the functions it stands in for", () => {
    for (const p of league.players.slice(0, 300)) {
      const s = summaryOf(p.recentStats, ovrLookup(p.recentHist, p.peakOvr ?? p.ovr));
      expect(s.totals).toEqual(totalsOf(p.recentStats));
      expect(s.best).toEqual(bestSeasonsOf(p.recentStats));
    }
  });

  it("keeps the earlier season when two tie for a best", () => {
    const a = { ...emptyRow(3), appearances: 10, goals: 5, ratingSum: 60 };
    const b = { ...emptyRow(7), appearances: 10, goals: 5, ratingSum: 60 };
    // Walking in order replaces only on strictly greater, so season 3 holds it.
    expect(summaryOf([a, b], () => 0).best.goals.season).toBe(3);
  });

  it("ignores a season with no appearances, so avgRating is not dragged down", () => {
    const played = { ...emptyRow(1), appearances: 10, goals: 4, ratingSum: 70 };
    const absent = emptyRow(2);
    expect(summaryOf([played, absent], () => 0).totals).toEqual(summaryOf([played], () => 0).totals);
    expect(summaryOf([played], () => 0).totals.avgRating).toBeCloseTo(7);
    // ...but the absent season is still a season he was on a roster.
    expect(summaryOf([played, absent], () => 0).seasons.map((x) => x.season)).toEqual([1, 2]);
  });

  it("migrate backfills it exactly, for a save that never had it", () => {
    const stripped: LeagueStore = {
      ...league,
      players: league.players.map((p) => {
        const { career: _c, ...rest } = p;
        return rest as Player;
      }),
    };
    expect(stripped.players.every((p) => p.career === undefined)).toBe(true);

    const migrated = migrateLeague(stripped);
    const before = new Map(league.players.map((p) => [p.pid, p.career]));
    for (const p of migrated.players) {
      expect(p.career!.totals).toEqual(before.get(p.pid)!.totals);
      expect(p.career!.best).toEqual(before.get(p.pid)!.best);
    }
  });
});

/**
 * The gate that settles open question 1 in docs/lazy-career-plan.md.
 *
 * `archivePlayer` was the only place in the sim that needed a whole career, and
 * therefore the only reason careers had to reach the worker at all. It now
 * builds from the stored summary — so what has to hold is that the row it
 * produces is identical to the one it produced while walking the seasons.
 */
describe("archivePlayer from the stored summary", () => {
  let aged: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(64);
    aged = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    for (let i = 0; i < 5; i++) {
      aged = simThrough(aged, "season", rng);
      aged = simOffseason(aged, rng);
    }
  }, 600_000);

  it("matches archiving the same player with no summary to fall back on", () => {
    const worthy = aged.players.filter(isArchiveWorthy);
    expect(worthy.length).toBeGreaterThan(10);

    for (const p of worthy.slice(0, 200)) {
      const fromSummary = archivePlayer(p, aged.season);
      // The old path: with no stored summary, careerOf folds his seasons.
      const { career: _dropped, ...noSummary } = p;
      const fromSeasons = archivePlayer(noSummary as Player, aged.season);
      expect(fromSummary).toEqual(fromSeasons);
    }
  });

  it("decides worthiness the same way either way", () => {
    for (const p of aged.players.slice(0, 500)) {
      const { career: _dropped, ...noSummary } = p;
      expect(isArchiveWorthy(p)).toBe(isArchiveWorthy(noSummary as Player));
    }
  });
});

/** A blank season line, so the tie/absent cases are readable. */
function emptyRow(season: number) {
  return {
    season, tid: 0, appearances: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0,
    xg: 0, goalsAgainst: 0, xga: 0, saves: 0, tackles: 0, interceptions: 0, passes: 0,
    passesCompleted: 0, crosses: 0, foulsCommitted: 0, yellowCards: 0, redCards: 0,
    minutesPlayed: 0, ratingSum: 0, avgRating: 0,
  };
}

/**
 * The two claims the resident window rests on (docs/lazy-career-plan.md phase
 * 3), pinned rather than argued.
 */
describe("the resident window", () => {
  const line = (season: number, apps = 10) => ({
    ...emptySeasonStats(season, 1), appearances: apps, goals: season, ratingSum: apps * 7,
  });

  it("liveCareer is the whole career folded, with the season in progress added from the window", () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => line(s));
    const hist = [0, 1, 2, 3, 4, 5, 6, 7].map((season) => ({ season, ovr: 60 + season }));
    const finished = summaryOf(all.slice(0, 7), ovrLookup(hist, 70));
    const player = {
      career: finished, recentStats: all.slice(-2), recentHist: hist.slice(-3), ovr: 70, peakOvr: 70,
    };
    expect(liveCareer(player, 8)).toEqual(summaryOf(all, ovrLookup(hist, 70)));
    // And once the offseason has folded season 8 for good, nothing is added twice.
    const folded = { ...player, career: summaryOf(all, ovrLookup(hist, 70)) };
    expect(liveCareer(folded, 8)).toEqual(summaryOf(all, ovrLookup(hist, 70)));
  });

  it("holds every line for the current and previous season, whatever the gaps in a career", () => {
    // Every pattern of which of ten seasons a player was on a squad.
    for (let mask = 0; mask < 1 << 10; mask++) {
      const seasons = [...Array(10).keys()].map((i) => i + 1).filter((s) => mask & (1 << (s - 1)));
      const player = windowCareer({ recentStats: seasons.map((s) => line(s)), recentHist: [] });
      for (const season of [9, 10]) {
        expect(seasonIsResident(season, 10)).toBe(true);
        const had = seasons.includes(season);
        expect(player.recentStats.some((s) => s.season === season)).toBe(had);
      }
    }
  });
});
