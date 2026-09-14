import { describe, it, expect } from "vitest";
import {
  DEFAULT_AWARD_FORMULA, resolveAwardFormula, isCustomAwardFormula, type AwardFormula,
} from "../../src/core/awardFormula.js";
import { computeSeasonAwards, potyScore, totsScore } from "../../src/core/awards.js";
import { computeWorldAwards, type WorldAwardContext } from "../../src/core/worldAwards.js";
import {
  AWARD_MIN_APPEARANCES, AWARD_OVR_WEIGHT, POTY_GOAL_WEIGHT, TOTS_POSITION_WORK,
  WORLD_AWARD_LEAGUE_TITLE_BONUS, WORLD_AWARD_CUP_RUN_BONUS,
} from "../../src/core/constants.js";
import { emptySeasonStats, type Player, type Position } from "../../src/core/players/types.js";

const SEASON = 5;

interface Spec {
  pid: number;
  pos: Position;
  tid?: number;
  ovr?: number;
  goals?: number;
  avgRating?: number;
  appearances?: number;
  tackles?: number;
}

function player(spec: Spec): Player {
  const ovr = spec.ovr ?? 75;
  const appearances = spec.appearances ?? 30;
  const stats = {
    ...emptySeasonStats(SEASON, spec.tid ?? 1),
    appearances,
    goals: spec.goals ?? 0,
    tackles: spec.tackles ?? 0,
    avgRating: spec.avgRating ?? 6.5,
    minutesPlayed: appearances * 90,
  };
  return {
    pid: spec.pid,
    name: `Player ${spec.pid}`,
    nationality: "England",
    born: SEASON - 26,
    pos: spec.pos,
    ovr,
    stats: [stats],
    hist: [{ season: SEASON - 1, ovr, potential: ovr, academy: false, ratings: {} }],
  } as unknown as Player;
}

/** A formula with one edit applied, built the way the God Mode editor builds it. */
function edited(fn: (f: AwardFormula) => void): AwardFormula {
  const f = structuredClone(DEFAULT_AWARD_FORMULA) as AwardFormula;
  fn(f);
  return f;
}

describe("the shipped award formula", () => {
  it("is the constants gathered up", () => {
    expect(DEFAULT_AWARD_FORMULA.minAppearances).toBe(AWARD_MIN_APPEARANCES);
    expect(DEFAULT_AWARD_FORMULA.ovrWeight).toBe(AWARD_OVR_WEIGHT);
    expect(DEFAULT_AWARD_FORMULA.ratingWeight).toBe(1);
    expect(DEFAULT_AWARD_FORMULA.goalWeight).toEqual(POTY_GOAL_WEIGHT);
    expect(DEFAULT_AWARD_FORMULA.positionWork).toEqual(TOTS_POSITION_WORK);
    expect(DEFAULT_AWARD_FORMULA.world.leagueTitleBonus).toBe(WORLD_AWARD_LEAGUE_TITLE_BONUS);
    expect(DEFAULT_AWARD_FORMULA.world.cupRunBonus).toEqual([...WORLD_AWARD_CUP_RUN_BONUS]);
  });

  it("is what a save with nothing stored resolves to", () => {
    expect(resolveAwardFormula(undefined)).toBe(DEFAULT_AWARD_FORMULA);
    expect(resolveAwardFormula({})).toEqual(DEFAULT_AWARD_FORMULA);
    expect(isCustomAwardFormula(undefined)).toBe(false);
    expect(isCustomAwardFormula(structuredClone(DEFAULT_AWARD_FORMULA))).toBe(false);
  });

  /**
   * The load-bearing guarantee: a save that never opens the editor scores its
   * awards exactly as before the formula became editable. Passing the default
   * explicitly must be indistinguishable from passing nothing, to the bit.
   */
  it("scores identically whether passed explicitly or omitted", () => {
    const players = [
      player({ pid: 1, pos: "ST", goals: 22, avgRating: 7.1, ovr: 82 }),
      player({ pid: 2, pos: "CB", tackles: 90, avgRating: 6.9 }),
      player({ pid: 3, pos: "GK", avgRating: 6.8 }),
    ];
    for (const p of players) {
      expect(potyScore(p, p.stats[0], SEASON, DEFAULT_AWARD_FORMULA)).toBe(potyScore(p, p.stats[0], SEASON));
      expect(totsScore(p, p.stats[0], SEASON, DEFAULT_AWARD_FORMULA)).toBe(totsScore(p, p.stats[0], SEASON));
    }
    expect(computeSeasonAwards(players, SEASON, DEFAULT_AWARD_FORMULA)).toEqual(computeSeasonAwards(players, SEASON));
  });
});

describe("resolving a stored formula", () => {
  it("keeps edits and fills everything else from the shipped weights", () => {
    const f = resolveAwardFormula({ goalWeight: { FWD: 0.5 }, world: { worldCupBonus: 9 } });
    expect(f.goalWeight.FWD).toBe(0.5);
    expect(f.goalWeight.DEF).toBe(POTY_GOAL_WEIGHT.DEF);
    expect(f.world.worldCupBonus).toBe(9);
    expect(f.world.leagueTitleBonus).toBe(WORLD_AWARD_LEAGUE_TITLE_BONUS);
  });

  it("falls back on anything that isn't a finite number, so a cleared box can't poison a ranking", () => {
    const f = resolveAwardFormula({
      ovrWeight: Number.NaN,
      ratingWeight: "2",
      goalWeight: { FWD: Number.POSITIVE_INFINITY },
      world: { cupRunBonus: [null, 3] },
    });
    expect(f.ovrWeight).toBe(AWARD_OVR_WEIGHT);
    expect(f.ratingWeight).toBe(1);
    expect(f.goalWeight.FWD).toBe(POTY_GOAL_WEIGHT.FWD);
    expect(f.world.cupRunBonus).toEqual([WORLD_AWARD_CUP_RUN_BONUS[0], 3, ...WORLD_AWARD_CUP_RUN_BONUS.slice(2)]);
  });

  it("keeps appearances a whole, non-negative number", () => {
    expect(resolveAwardFormula({ minAppearances: 12.6 }).minAppearances).toBe(13);
    expect(resolveAwardFormula({ minAppearances: -4 }).minAppearances).toBe(0);
  });

  it("reports a genuine edit as custom", () => {
    expect(isCustomAwardFormula(edited((f) => { f.world.intlCapWeight = 1; }))).toBe(true);
  });
});

describe("an edited formula decides the awards", () => {
  it("can hand Player of the Season to the better performer instead of the scorer", () => {
    const scorer = player({ pid: 1, pos: "ST", goals: 20, avgRating: 6.5 });
    const creator = player({ pid: 2, pos: "ST", goals: 5, avgRating: 7.5 });
    expect(computeSeasonAwards([scorer, creator], SEASON).playerOfSeasonPid).toBe(1);
    const noGoals = edited((f) => { f.goalWeight.FWD = 0; });
    expect(computeSeasonAwards([scorer, creator], SEASON, noGoals).playerOfSeasonPid).toBe(2);
  });

  it("moves the appearances bar", () => {
    const regular = player({ pid: 1, pos: "ST", avgRating: 6.6, appearances: 30 });
    const cameo = player({ pid: 2, pos: "ST", avgRating: 8.5, appearances: 10 });
    expect(computeSeasonAwards([regular, cameo], SEASON).playerOfSeasonPid).toBe(1);
    const anyone = edited((f) => { f.minAppearances = 0; });
    expect(computeSeasonAwards([regular, cameo], SEASON, anyone).playerOfSeasonPid).toBe(2);
  });

  it("reshapes a Team of the Season slot", () => {
    const stopper = player({ pid: 1, pos: "CB", avgRating: 6.5, tackles: 150 });
    const ballPlayer = player({ pid: 2, pos: "CB", avgRating: 7.2, tackles: 20 });
    const xi = (f?: AwardFormula) => computeSeasonAwards([stopper, ballPlayer], SEASON, f).teamOfSeason;
    // The first CB slot takes whoever scores highest.
    expect(xi()[1]).toBe(1);
    expect(xi(edited((f) => { f.positionWork.CB.defendingPerGame = 0; }))[1]).toBe(2);
  });

  it("reaches the worldwide awards", () => {
    const ctx: WorldAwardContext = {
      compsByTid: { 1: 0, 2: 0 },
      competitions: [{ id: 0, country: "England", tier: 1, name: "English Division 1" }],
      championTidByCompId: { 0: 1 },
      cup: null,
      worldCupChampion: null,
    };
    const champion = player({ pid: 1, pos: "ST", tid: 1, avgRating: 6.5 });
    const better = player({ pid: 2, pos: "ST", tid: 2, avgRating: 7.5 });
    expect(computeWorldAwards([champion, better], SEASON, ctx).ballonDOr[0].pid).toBe(2);
    const titlesMatter = edited((f) => { f.world.leagueTitleBonus = 100; });
    const { ballonDOr } = computeWorldAwards([champion, better], SEASON, ctx, titlesMatter);
    expect(ballonDOr[0].pid).toBe(1);
    expect(ballonDOr[0].title).toBeGreaterThan(10);
  });
});
