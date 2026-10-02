import { describe, it, expect, beforeAll } from "vitest";
import { mulberry32, mulberry32Resumable } from "../../src/engine/rng.js";
import { simThrough, type SimThrough } from "../../src/core/simThrough.js";
import { createLeagueState, type LeagueStore } from "../../src/core/leagueState.js";
import { buildCompetitions, worldLeagueSpecs } from "../../src/core/competitions.js";
import { simChunkTargets, simMatchdayCount } from "../../src/core/simChunks.js";
import { beginAutopilot, endAutopilot, jumpSeasons } from "../../src/core/autopilot.js";
import { simOffseason } from "../../src/core/offseason.js";
import { emptyTeamSeasonAcc, addToTeamSeasonAcc } from "../../src/core/standings.js";

/**
 * The gate for splitting a long sim into chunks (core/simChunks.ts).
 *
 * Splitting exists to keep a phone tab's memory down, and it is only acceptable
 * if nobody can tell: a season played in chunks must be EXACTLY the season one
 * call plays. Each chunk is run the way the worker runs it — a fresh resumable
 * stream from the previous chunk's state, and the batch's starting matchday
 * carried across — and the two leagues are compared whole.
 */
describe("simChunks", () => {
  it("resumes a mulberry32 stream exactly where it stopped", () => {
    const whole = mulberry32(12345);
    const first = mulberry32Resumable(12345);
    const expected = Array.from({ length: 200 }, () => whole());
    const got = Array.from({ length: 77 }, () => first.next());
    const resumed = mulberry32Resumable(first.state());
    got.push(...Array.from({ length: 123 }, () => resumed.next()));
    expect(got).toEqual(expected);
  });

  it("splits between matchdays and always ends on the user's own target", () => {
    const schedule = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((m) => [{ matchday: m }, { matchday: m }]);
    expect(simChunkTargets(schedule, "season", 4)).toEqual([{ matchday: 4 }, { matchday: 8 }, "season"]);
    expect(simChunkTargets(schedule, "game", 4)).toEqual(["game"]);
    // Exactly one chunk's worth needs no stop.
    expect(simChunkTargets(schedule, { matchday: 4 }, 4)).toEqual([{ matchday: 4 }]);
    expect(simChunkTargets(schedule, { matchday: 9 }, 4)).toEqual([{ matchday: 4 }, { matchday: 8 }, { matchday: 9 }]);
    // Mid-season: counted from the next matchday to play, not from 1.
    const later = schedule.filter((g) => g.matchday >= 6);
    expect(simChunkTargets(later, "season", 4)).toEqual([{ matchday: 9 }, "season"]);
    expect(simMatchdayCount(later, "season")).toBe(5);
    expect(simMatchdayCount(later, "game")).toBe(1);
  });

  /**
   * England plus Scotland: Scotland's top flight splits after matchday 33, so
   * its second phase is built mid-sim and lands in a later chunk than the one
   * that finished the first phase — the one place a chunk boundary changes
   * which call schedules a fixture.
   */
  let start: LeagueStore;
  beforeAll(() => {
    const comps = buildCompetitions(
      worldLeagueSpecs().filter((s) => s.country === "England" || s.country === "Scotland"),
    );
    start = createLeagueState(0, mulberry32(77), 0, "normal", comps);
  }, 300_000);

  /**
   * The first match the two leagues disagree on, or null. Checked before the
   * deep-equal because a failing toEqual on two whole leagues (or even on two
   * long strings) takes vitest many minutes to diff; this fails in one line.
   */
  const firstDifference = (a: LeagueStore, b: LeagueStore): string | null => {
    const line = (m: LeagueStore["played"][number] | undefined) =>
      m ? `md${m.matchday} ${m.home}-${m.away} ${m.homeGoals}-${m.awayGoals}` : "none";
    for (let i = 0; i < Math.max(a.played.length, b.played.length); i++) {
      if (line(a.played[i]) !== line(b.played[i])) {
        return `match ${i}: ${line(a.played[i])} vs ${line(b.played[i])}`;
      }
    }
    return null;
  };

  /** One worker round trip per target, threaded exactly as LeagueContext does. */
  function simChunked(league: LeagueStore, through: SimThrough): LeagueStore {
    const targets = simChunkTargets(league.schedule, through);
    const batchStartMatchday = Math.min(...league.schedule.map((g) => g.matchday));
    let work = league;
    let rngState: number | undefined;
    for (const target of targets) {
      const rng = mulberry32Resumable(rngState ?? (work.lid * 1000 + work.played.length) >>> 0);
      work = simThrough(work, target, rng.next, undefined, { stagePlayoffs: true, batchStartMatchday });
      rngState = rng.state();
    }
    return work;
  }

  it("a season played in chunks is the season one call plays", () => {
    expect(simChunkTargets(start.schedule, "season").length).toBeGreaterThan(5);
    const whole = simThrough(
      start, "season", mulberry32((start.lid * 1000 + start.played.length) >>> 0),
      undefined, { stagePlayoffs: true },
    );
    const chunked = simChunked(start, "season");
    expect(firstDifference(chunked, whole)).toBeNull();
    expect(chunked).toEqual(whole);
  }, 300_000);

  it("a mid-season sim to a matchday is identical in chunks too", () => {
    const opening = simThrough(start, { matchday: 3 }, mulberry32(5), undefined, { stagePlayoffs: true });
    const seed = (opening.lid * 1000 + opening.played.length) >>> 0;
    const whole = simThrough(opening, { matchday: 30 }, mulberry32(seed), undefined, { stagePlayoffs: true });
    const chunked = simChunked(opening, { matchday: 30 });
    expect(firstDifference(chunked, whole)).toBeNull();
    expect(chunked).toEqual(whole);
  }, 300_000);

  /**
   * The jump as it was before it folded and stripped each chunk: one
   * simThrough per season and an offseason that totals the season from the
   * box scores themselves. The new jump must land on exactly this world.
   */
  function jumpOneShot(league: LeagueStore, seasons: number): LeagueStore {
    const userTid = league.meta.userTid;
    const target = league.season + seasons;
    let work = beginAutopilot(league);
    const managed: number[] = [];
    while (work.season < target) {
      if (work.phase === "regular") {
        managed.push(work.season);
        const played = work.played.length;
        work = simThrough(work, "season", mulberry32((work.lid * 1000 + played) >>> 0));
        if (work.phase === "regular" && work.played.length === played) break;
      }
      const advanced = simOffseason(work, mulberry32((work.lid * 1000 + work.season) >>> 0));
      if (advanced.season === work.season) break;
      work = advanced;
    }
    return { ...endAutopilot(work, userTid), aiManagedSeasons: [...league.aiManagedSeasons, ...managed] };
  }

  it("a jump that drops each chunk's box scores lands where the one-shot jump does", () => {
    const whole = jumpOneShot(start, 2);
    const folded = jumpSeasons(start, 2);
    expect(folded.season).toBe(start.season + 2);
    expect(folded.seasonHistory.at(-1)!.teamStats).toEqual(whole.seasonHistory.at(-1)!.teamStats);
    expect(folded).toEqual(whole);
  }, 600_000);

  /**
   * The game's own league holds this session's matches with their player
   * lines dropped, so a jump started mid-season is handed the season's totals
   * instead. Before, it added them up from the emptied matches and recorded
   * every club's goals, shots and ratings for those matches as zero.
   */
  it("a mid-season jump from stripped matches plus their totals matches one from real box scores", () => {
    const midway = simThrough(start, { matchday: 12 }, mulberry32(9), undefined, { stagePlayoffs: true });
    const acc = emptyTeamSeasonAcc();
    addToTeamSeasonAcc(acc, midway.played);
    const stripped: LeagueStore = {
      ...midway,
      played: midway.played.map((m) => ({
        ...m,
        boxScore: { ...m.boxScore, home: [], away: [], events: [], detailElided: true as const },
      })),
    };
    const fromReal = jumpOneShot(midway, 1);
    const fromStripped = jumpSeasons(stripped, 1, undefined, { seasonAcc: acc });
    expect(fromStripped.seasonHistory.at(-1)!.teamStats).toEqual(fromReal.seasonHistory.at(-1)!.teamStats);
    expect(fromStripped).toEqual(fromReal);
  }, 600_000);
});
