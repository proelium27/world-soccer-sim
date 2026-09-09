import { describe, it, expect } from "vitest";
import { mulberry32, hashInts } from "../../src/engine/rng.js";
import { generatePlayer, generationBaseForAge } from "../../src/core/players/generate.js";
import { generateYouthIntake } from "../../src/core/players/youth.js";
import { generateWorld } from "../../src/core/league/generate.js";
import {
  progressPlayer, estimatePotential, isWantedForRetirement,
} from "../../src/core/players/progression.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { migrateLeague } from "../../src/db/migrate.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import {
  PROGRESSION_PROFILES,
  BASE_AGE_CURVE, STEADY_AGE_CURVE, BASE_AGE_CURVE_PEAK,
  PROGRESSION_NOISE_SD_YOUNG, PROGRESSION_NOISE_SD_OLD,
  PROGRESSION_FORM_SD_YOUNG, PROGRESSION_FORM_SD_OLD,
  PROGRESSION_BIAS_SD_YOUNG,
  GROWTH_DAMPING_END, GROWTH_DAMPING_FLOOR,
  FULL_SEASON_APPEARANCES,
  AI_PROSPECT_MIN_POT, RETIREMENT_PROSPECT_POT_THRESHOLD, potentialBar,
} from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/** A counting rng, so a test can assert how many draws something spent. */
function counting(seed: number) {
  const inner = mulberry32(seed);
  let calls = 0;
  const fn = () => {
    calls++;
    return inner();
  };
  return { fn, calls: () => calls };
}

function player(seed: number, age: number, pid = 1): Player {
  return generatePlayer(mulberry32(seed), "CM", 60, pid, age, 1, seed);
}

/**
 * Two English divisions rather than the shipped 36-competition world. Every
 * claim in this file is about one player's development or about a draw count,
 * and neither cares how many countries the world holds — where the full world
 * costs ~17s a build and this costs a fraction of it.
 */
const SMALL = englandCompetitions;

/**
 * A 16-year-old's real generation base. `youthGenerationBase` takes
 * YOUTH_BASE_OFFSET (34) off a club's academy anchor, so an academy prospect is
 * generated in the teens-to-thirties, not at a senior club's LEAGUE_BASE. It
 * matters here rather than being a detail: `growthDamping` starts biting at ovr
 * 65, so a cohort generated at senior strength is already against the wall and
 * shows almost none of the growth this file is checking for.
 */
const YOUTH_BASE = 25;

/** Give him a full season of appearances so `minutesFactor` reads a real value. */
function withFullSeason(p: Player, season: number): Player {
  return {
    ...p,
    stats: [{
      season, tid: 0, appearances: FULL_SEASON_APPEARANCES,
      goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, tackles: 0, interceptions: 0,
      saves: 0, cleanSheets: 0, minutesPlayed: 0, ratingSum: 0, avgRating: 0,
      xg: 0, goalsAgainst: 0, xga: 0, passes: 0, passesCompleted: 0, crosses: 0,
      foulsCommitted: 0, yellowCards: 0, redCards: 0,
    } as Player["stats"][number]],
  };
}

describe("the random profile is the shipped game", () => {
  /**
   * The whole safety argument for adding a second model rests on the first one
   * being a restatement of what shipped, so this pins it by reference rather
   * than by value: retuning any of these constants must retune the profile with
   * it, never leave the profile holding a stale copy.
   */
  it("restates every shipped progression constant", () => {
    const p = PROGRESSION_PROFILES.random;
    expect(p.ageCurve).toBe(BASE_AGE_CURVE);
    expect(p.noiseSdYoung).toBe(PROGRESSION_NOISE_SD_YOUNG);
    expect(p.noiseSdOld).toBe(PROGRESSION_NOISE_SD_OLD);
    expect(p.formSdYoung).toBe(PROGRESSION_FORM_SD_YOUNG);
    expect(p.formSdOld).toBe(PROGRESSION_FORM_SD_OLD);
    expect(p.biasSdYoung).toBe(PROGRESSION_BIAS_SD_YOUNG);
    expect(p.dampingEnd).toBe(GROWTH_DAMPING_END);
    expect(p.dampingFloor).toBe(GROWTH_DAMPING_FLOOR);
  });

  it("is what a caller that names no model gets", () => {
    const p = player(7, 20);
    const explicit = progressPlayer(mulberry32(3), p, 1, false, "random");
    const implicit = progressPlayer(mulberry32(3), p, 1, false);
    expect(explicit).toEqual(implicit);
  });

  it("is what an old save migrates to", () => {
    const league = createLeagueState(0, mulberry32(1), 1, undefined, SMALL());
    const { progressionModel: _drop, ...withoutField } = league;
    const migrated = migrateLeague(withoutField as unknown as LeagueStore);
    expect(migrated.progressionModel).toBe("random");
  });

  it("keeps an explicitly stored model", () => {
    const league = createLeagueState(0, mulberry32(1), 1, undefined, SMALL(), true, null, "steady");
    expect(migrateLeague(league).progressionModel).toBe("steady");
  });
});

describe("the model scales draws, never their count", () => {
  /**
   * The property that makes the setting safe to flip mid-save and makes
   * `"random"` provably unchanged: both models spend the same rng, so the
   * shared stream advances identically and nothing downstream of a progression
   * pass re-rolls. `gaussian` is two draws with no rejection loop, which is what
   * lets this hold at all.
   */
  it("spends identical rng progressing the same player", () => {
    for (const age of [17, 22, 27, 33]) {
      const p = withFullSeason(player(11 + age, age), 1);
      const a = counting(5);
      const b = counting(5);
      progressPlayer(a.fn, p, 1, false, "random");
      progressPlayer(b.fn, p, 1, false, "steady");
      expect(b.calls()).toBe(a.calls());
    }
  });

  it("spends identical rng estimating a potential", () => {
    const p = player(21, 18);
    const a = counting(9);
    const b = counting(9);
    estimatePotential(a.fn, p.ratings, p.ovr, 18, "CM", 180, 1, "random");
    estimatePotential(b.fn, p.ratings, p.ovr, 18, "CM", 180, 1, "steady");
    expect(b.calls()).toBe(a.calls());
  });

  it("spends identical rng generating a whole world", () => {
    const a = counting(4);
    const b = counting(4);
    generateWorld(a.fn, 4, SMALL(), "random");
    generateWorld(b.fn, 4, SMALL(), "steady");
    expect(b.calls()).toBe(a.calls());
  });

  /**
   * Generation reads the model's OWN age curve, so a steady world's ratings
   * differ from a random one's as well as its forecast.
   *
   * This used to assert the opposite ("ratings are rolled before any progression
   * term is read"), and that premise died when world generation gained an age
   * model: a generated player is now placed at the level his age implies, which
   * is a statement about the curve he is going to develop along. Generating both
   * models against the shipped curve would hand a steady save its own version of
   * the very transient that model was added to remove, since `STEADY_AGE_CURVE`
   * declines far harder late.
   *
   * The property that actually protected the mid-save switch is the draw COUNT,
   * and it is asserted three times above. This is now about the curve.
   */
  it("generates each model's world against its own age curve", () => {
    const random = generateWorld(mulberry32(4), 4, SMALL(), "random");
    const steady = generateWorld(mulberry32(4), 4, SMALL(), "steady");
    expect(steady.players.map((p) => p.ratings))
      .not.toEqual(random.players.map((p) => p.ratings));
    expect(steady.players.map((p) => p.potential))
      .not.toEqual(random.players.map((p) => p.potential));

    // And it differs in the direction the two curves differ: steady's late
    // decline is much steeper, so it generates a veteran further below a
    // peak-age player than random does. Read off the bases rather than off
    // sampled players, since a world this small has few 37-year-olds.
    const gap = (model: "random" | "steady") =>
      generationBaseForAge(50, BASE_AGE_CURVE_PEAK, "CM", model).skill
      - generationBaseForAge(50, 37, "CM", model).skill;
    expect(gap("steady")).toBeGreaterThan(gap("random"));
  });
});

describe("the model reaches every path that forecasts a career", () => {
  /**
   * `model` is a trailing optional defaulting to the shipped `"random"`, which
   * is a safe default everywhere except the handful of call sites that have a
   * league in scope. These are those call sites. A steady save that lost one of
   * them would misprice prospects with no error and no crash — most damagingly
   * on the Youth Intake screen, where a listed potential is the only thing the
   * user is given to choose five of twelve on.
   */
  it("world generation", () => {
    const random = createLeagueState(0, mulberry32(2), 2, undefined, SMALL());
    const steady = createLeagueState(0, mulberry32(2), 2, undefined, SMALL(), true, null, "steady");
    expect(steady.players.map((p) => p.potential))
      .not.toEqual(random.players.map((p) => p.potential));
  });

  it("youth intake", () => {
    const random = generateYouthIntake(mulberry32(8), 55, 3, 900, 0, "England", null);
    const steady = generateYouthIntake(
      mulberry32(8), 55, 3, 900, 0, "England", null, undefined, undefined, "steady",
    );
    expect(steady.players.map((p) => p.ovr)).toEqual(random.players.map((p) => p.ovr));
    expect(steady.players.map((p) => p.potential))
      .not.toEqual(random.players.map((p) => p.potential));
  });

  it("the offseason progression pass", () => {
    const p = withFullSeason(player(31, 19), 1);
    const random = progressPlayer(mulberry32(6), p, 1, false, "random");
    const steady = progressPlayer(mulberry32(6), p, 1, false, "steady");
    expect(steady.ratings).not.toEqual(random.ratings);
  });
});

describe("steady careers", () => {
  /** One career from 16 to `to`, at full minutes, under one model. */
  function career(model: "random" | "steady", seed: number, to: number): number[] {
    const rng = mulberry32(seed);
    let p = generatePlayer(rng, "CM", YOUTH_BASE, seed + 1, 16, 1, seed, undefined, null, model);
    const ovrs = [p.ovr];
    for (let age = 16; age < to; age++) {
      const season = age - 15;
      p = progressPlayer(rng, withFullSeason(p, season), season, false, model);
      ovrs.push(p.ovr);
    }
    return ovrs;
  }

  /**
   * The headline behaviour, and it is deliberately measured over a population
   * rather than on one player: a single steady career can still move a couple
   * of points in a season, which is the "hover" the request asks for.
   *
   * Measured on a player's change around *his own* average rather than raw
   * movement, because raw movement conflates growth and decline — both of which
   * are meant to be large — with the unpredictability this setting removes.
   */
  it("makes a season's movement far more predictable through the peak years", () => {
    const surprise = (model: "random" | "steady") => {
      const resid: number[] = [];
      for (let seed = 1; seed <= 60; seed++) {
        const ovrs = career(model, seed * 17, 31);
        // Ages 24-30 — the plateau, where movement should be near zero and any
        // movement at all is the dice rather than the age curve.
        const deltas: number[] = [];
        for (let age = 24; age <= 30; age++) deltas.push(ovrs[age - 16] - ovrs[age - 17]);
        const own = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        for (const d of deltas) resid.push(Math.abs(d - own));
      }
      return resid.reduce((a, b) => a + b, 0) / resid.length;
    };
    // Not a tuned threshold: the claim is "much smaller", and the measured gap
    // is far wider than half.
    expect(surprise("steady")).toBeLessThan(surprise("random") / 2);
  });

  /**
   * The other half of the deal, and the one that is easy to lose while chasing
   * the first: careers must still differ from one another. If the spread
   * collapses the variance was deleted rather than moved from per-season to
   * per-player, and every academy in the world starts producing the same man.
   */
  it("still produces visibly different careers from identical starting points", () => {
    const peaks: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      peaks.push(Math.max(...career("steady", seed * 17, 31)));
    }
    const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const sd = Math.sqrt(peaks.reduce((s, x) => s + (x - mean) ** 2, 0) / peaks.length);
    expect(sd).toBeGreaterThan(5);
  });

  /**
   * The arc the request describes, checked as a shape rather than as numbers:
   * grow through the early twenties, hold through the peak, fall away from
   * thirty at an accelerating rate.
   */
  it("grows, then holds, then falls away faster and faster", () => {
    const n = 120;
    const byAge: number[][] = [];
    for (let seed = 1; seed <= n; seed++) byAge.push(career("steady", seed * 31, 38));
    const at = (age: number) =>
      byAge.reduce((s, c) => s + c[age - 16], 0) / n;

    // Growth years: a clear climb.
    expect(at(23) - at(19)).toBeGreaterThan(4);
    // Peak years: holds. Not pinned to exactly zero — physicals are already
    // easing off while skills still inch up, so a mild net fade is the plateau
    // rather than a failure of it.
    expect(Math.abs(at(29) - at(25))).toBeLessThan(2);
    // Decline, and accelerating: each later stretch falls further than the one
    // before it.
    const early = at(30) - at(33);
    const late = at(33) - at(36);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it("uses its own age curve", () => {
    expect(PROGRESSION_PROFILES.steady.ageCurve).toBe(STEADY_AGE_CURVE);
    expect(STEADY_AGE_CURVE).not.toEqual(BASE_AGE_CURVE);
  });
});

describe("potential gates move with the model", () => {
  /**
   * Every gate that compares a POTENTIAL against a fixed bar is an absolute
   * number, and steady development lists lower potentials for the same players
   * (an honest forecast sits below an optimistic one). So the whole
   * distribution slides out from under all of them at once, and silently:
   * nothing throws, AI clubs just stop protecting the wonderkids
   * `AI_PROSPECT_SLOTS` exists to protect. Measured before the offset, the share
   * of a real youth intake clearing `AI_PROSPECT_MIN_POT` fell 18.7% to 7.8%.
   *
   * The invariant is the SHARE, not the number. Both bars are defined by what
   * they are for ("genuine wonderkids, not every teenager"), which is a
   * statement about where a player sits in his own intake.
   */
  function intakePotentials(model: "random" | "steady"): number[] {
    const pots: number[] = [];
    for (let anchor = 20; anchor <= 62; anchor += 6) {
      const { players } = generateYouthIntake(
        mulberry32(hashInts(anchor, 0x59_54_48)),
        anchor, 1, 1, 3, "England", null, 60, undefined, model,
      );
      for (const p of players) pots.push(p.potential);
    }
    return pots;
  }

  it("keeps roughly the same share of an intake above each bar", () => {
    for (const bar of [AI_PROSPECT_MIN_POT, RETIREMENT_PROSPECT_POT_THRESHOLD]) {
      const share = (model: "random" | "steady") => {
        const pots = intakePotentials(model);
        const at = potentialBar(bar, model);
        return pots.filter((p) => p >= at).length / pots.length;
      };
      // A band rather than an exact match: one offset covers both bars, so it
      // lands close on each rather than exactly on either.
      expect(Math.abs(share("steady") - share("random"))).toBeLessThan(0.05);
    }
  });

  it("leaves the random model's bars exactly where they were", () => {
    expect(potentialBar(AI_PROSPECT_MIN_POT, "random")).toBe(AI_PROSPECT_MIN_POT);
    expect(potentialBar(RETIREMENT_PROSPECT_POT_THRESHOLD, "random"))
      .toBe(RETIREMENT_PROSPECT_POT_THRESHOLD);
  });

  it("exempts a prospect from retirement on the model's own bar", () => {
    // A ceiling that clears the steady bar but not the random one: the same
    // player is a prospect worth keeping in one save and a journeyman in the
    // other, which is the point of moving the bar rather than the player.
    const between = RETIREMENT_PROSPECT_POT_THRESHOLD - 6;
    const p = { ...player(5, 20), potential: between } as Player;
    expect(isWantedForRetirement(p, false, 20, "random")).toBe(false);
    expect(isWantedForRetirement(p, false, 20, "steady")).toBe(true);
  });
});
