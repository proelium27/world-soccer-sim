import { describe, it, expect, vi } from "vitest";
import { makeLeague } from "../helpers/league.js";

// The fixture has no matches on record, and the board stays silent over a
// season with nothing to judge, so whether the review RAN is read off a
// passthrough spy rather than off the verdict it would have left.
const reviewCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/core/manager/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/core/manager/index.js")>();
  return {
    ...actual,
    reviewSeason: (...args: Parameters<typeof actual.reviewSeason>) => {
      reviewCalls.count++;
      return actual.reviewSeason(...args);
    },
  };
});
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { StandingsRow } from "../../src/core/standings.js";
import {
  drawTitlePlayoffs, playTitlePlayoffs, completeTitlePlayoffs, titlePlayoffRoundsLeft,
  titlePlayoffNextEntrants,
} from "../../src/core/titlePlayoff.js";
import {
  drawPromotionPlayoffs, playPromotionPlayoffs, completePromotionPlayoffs, promotionPlayoffRoundsLeft,
} from "../../src/core/promotionPlayoff.js";
import {
  playoffsPending, nextPlayoffStage, playPlayoffStage, simThroughPlayoffs, playoffStageProgress,
} from "../../src/core/playoffStages.js";
import { simThrough } from "../../src/core/simThrough.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";
import { mulberry32 } from "../../src/engine/rng.js";

/**
 * Staged playoffs are only worth having if they land on exactly what the
 * single pass does, so every test here draws the brackets off one set of
 * tables and plays them both ways. The tables are made up (tid order within
 * each division) rather than simmed: the brackets only need a ranking, and a
 * season sim would cost a minute to say nothing extra.
 */
const BASE = makeLeague(0, 7);

function fakeTables(league: LeagueStore): Map<number, StandingsRow[]> {
  const tables = new Map<number, StandingsRow[]>();
  for (const c of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === c.id).map((t) => t.tid);
    tables.set(c.id, tids.map((tid, i) => ({
      tid, played: 30, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 100 - i,
    })));
  }
  return tables;
}

const TABLES = fakeTables(BASE);

function drawn(league: LeagueStore = BASE): LeagueStore {
  return {
    ...league,
    phase: "offseason",
    titlePlayoffs: drawTitlePlayoffs(league.competitions, TABLES, league.teams, league.season),
    promotionPlayoffs: drawPromotionPlayoffs(league.competitions, TABLES, league.season),
  };
}

describe("simThrough with stagePlayoffs (the worker's path)", () => {
  it("draws the brackets at the season's end, and playing them out lands where the single pass does", () => {
    // A spectator, so no cup final of the user's pauses the run.
    const start: LeagueStore = { ...BASE, meta: { ...BASE.meta, userTid: SPECTATOR_TID } };
    const lastMd = Math.max(...start.schedule.map((g) => g.matchday));
    const pre = simThrough(start, { matchday: lastMd - 1 }, mulberry32(11));

    const bulk = simThrough(pre, "game", mulberry32(12));
    const staged = simThrough(pre, "game", mulberry32(12), undefined, { stagePlayoffs: true });
    expect(bulk.phase).toBe("offseason");
    expect(staged.phase).toBe("offseason");

    expect(playoffsPending(bulk)).toBe(false);
    expect(playoffsPending(staged)).toBe(true);
    expect((staged.titlePlayoffs ?? []).length).toBeGreaterThan(0);
    for (const p of staged.titlePlayoffs ?? []) {
      expect(p.ties).toEqual([]);
      expect(p.winnerTid).toBeNull();
    }
    for (const p of staged.promotionPlayoffs) expect(p.winnerTid).toBeNull();

    const finished = simThroughPlayoffs(staged);
    expect(finished.titlePlayoffs).toEqual(bulk.titlePlayoffs);
    expect(finished.promotionPlayoffs).toEqual(bulk.promotionPlayoffs);
    // Nothing else the season's end did depends on whether the playoffs were staged.
    expect(finished.teams).toEqual(bulk.teams);
    expect(finished.players).toEqual(bulk.players);
    expect(finished.international).toEqual(bulk.international);
  });
});

describe("staged playoffs", () => {
  it("lands every playoff on exactly what a single pass plays", () => {
    const staged = simThroughPlayoffs(drawn());
    expect(playoffsPending(staged)).toBe(false);
    expect(staged.titlePlayoffs).toEqual(
      playTitlePlayoffs(BASE.competitions, BASE.teams, BASE.players, TABLES, BASE.lid, BASE.season),
    );
    expect(staged.promotionPlayoffs).toEqual(
      playPromotionPlayoffs(BASE.competitions, BASE.teams, BASE.players, TABLES, BASE.lid, BASE.season),
    );
  });

  it("plays in aligned blocks so every final is on the last one", () => {
    let league = drawn();
    const { stages } = playoffStageProgress(league);
    // MLS's bracket is the deepest: wild card, round one, conference
    // semis, conference finals, final.
    expect(stages).toBe(5);
    let blocks = 0;
    while (playoffsPending(league)) {
      const before = league;
      const entries = nextPlayoffStage(league);
      expect(entries.length).toBeGreaterThan(0);
      expect(playoffStageProgress(league).stage).toBe(blocks + 1);
      league = playPlayoffStage(league);
      blocks++;
      if (blocks === stages - 1) {
        // Going into the last block, every playoff still undecided has exactly
        // its final left.
        for (const p of league.titlePlayoffs ?? []) expect(titlePlayoffRoundsLeft(p)).toBe(1);
        for (const p of league.promotionPlayoffs) expect(promotionPlayoffRoundsLeft(p)).toBe(1);
      }
      expect(league).not.toBe(before);
    }
    expect(blocks).toBe(stages);
    expect(nextPlayoffStage(league)).toEqual([]);
    // A decided set is a no-op.
    expect(playPlayoffStage(league)).toBe(league);
  });

  it("holds the board's review until the last final is played", () => {
    let league = drawn();
    reviewCalls.count = 0;
    while (playoffStageProgress(league).stage < playoffStageProgress(league).stages) {
      league = playPlayoffStage(league);
      expect(reviewCalls.count).toBe(0);
    }
    league = playPlayoffStage(league);
    expect(playoffsPending(league)).toBe(false);
    expect(reviewCalls.count).toBe(1);
  });

  it("stops before a round the user's club plays in, but always plays one block", () => {
    const start = drawn();
    // A club that skips the wild card and plays in round one of MLS's playoff.
    const after = playPlayoffStage(start);
    const firstEntrants = new Set(nextPlayoffStage(start).length > 0
      ? (start.titlePlayoffs ?? []).flatMap((p) => [...titlePlayoffNextEntrants(p)])
      : []);
    const us = (after.titlePlayoffs ?? []).find((p) => p.format === "conference")!;
    const userTid = [...titlePlayoffNextEntrants(us)].find((tid) => !firstEntrants.has(tid))!;
    expect(userTid).toBeDefined();

    const league = { ...start, meta: { ...start.meta, userTid } };
    expect(nextPlayoffStage(league).some((e) => e.includesUser)).toBe(false);
    const stopped = simThroughPlayoffs(league, { stopBeforeUserRound: true });
    expect(playoffStageProgress(stopped).stage).toBe(2);
    expect(nextPlayoffStage(stopped).some((e) => e.includesUser)).toBe(true);

    // Pressing it again on that round plays the round rather than stopping at once.
    const resumed = simThroughPlayoffs(stopped, { stopBeforeUserRound: true });
    expect(playoffStageProgress(resumed).stage).toBeGreaterThan(2);
  });

  it("finishes a half-played bracket the same way the clicks would have", () => {
    const half = playPlayoffStage(playPlayoffStage(drawn()));
    const clicked = simThroughPlayoffs(half);
    expect(completeTitlePlayoffs(half.titlePlayoffs ?? [], half.teams, half.players, half.lid))
      .toEqual(clicked.titlePlayoffs);
    expect(completePromotionPlayoffs(half.promotionPlayoffs, half.teams, half.players, half.lid))
      .toEqual(clicked.promotionPlayoffs);
  });

  it("is never pending outside the offseason", () => {
    expect(playoffsPending({ ...drawn(), phase: "regular" as LeagueStore["phase"] })).toBe(false);
  });
});
