import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generatePlayer } from "../../src/core/players/generate.js";
import {
  ageOf, progressPlayer, retirementProbability, rollRetirement, estimatePotential,
  isGenerational, isWantedForRetirement,
} from "../../src/core/players/progression.js";
import { computeOvr } from "../../src/core/players/ovr.js";
import type { Player, PlayerRatings } from "../../src/core/players/types.js";
import {
  RETIREMENT_START_AGE, RATING_MAX, RETIREMENT_UNROSTERED_BASE, RETIREMENT_MAX_PROB,
  RETIREMENT_PROSPECT_POT_THRESHOLD, FREE_AGENT_CULL_MAX_POT,
  RETIREMENT_PROSPECT_MAX_AGE, FREE_AGENT_CULL_MIN_AGE,
  RETIREMENT_BASE_PROB, RETIREMENT_PROB_PER_YEAR,
} from "../../src/core/constants.js";

const flatRatings = (v: number): PlayerRatings => ({
  speed: v, strength: v, stamina: v, jumping: v, shortPass: v, longPass: v,
  crosses: v, dribbling: v, longShot: v, finishing: v, tackling: v,
  interceptions: v, positioning: v, goalkeeping: v,
});

describe("ageOf", () => {
  it("computes age from season - born", () => {
    const p = generatePlayer(mulberry32(1), "ST", 55, 1, 11, 1); // born season -10
    expect(ageOf(p, 1)).toBe(11);
    expect(ageOf(p, 5)).toBe(15);
  });
});

describe("estimatePotential", () => {
  it("is always >= ovr", () => {
    for (let i = 0; i < 100; i++) {
      const rng = mulberry32(i);
      const v = 40 + Math.floor(rng() * 40);
      const age = 16 + Math.floor(rng() * 25);
      const ratings = flatRatings(v);
      const ovr = computeOvr("ST", ratings, 180);
      const pot = estimatePotential(mulberry32(i + 500), ratings, ovr, age, "ST", 180, i);
      expect(pot).toBeGreaterThanOrEqual(ovr);
      expect(pot).toBeLessThanOrEqual(RATING_MAX);
    }
  });

  it("gives a teenager more headroom on average than a 32-year-old at the same ovr", () => {
    const ratings = flatRatings(60);
    const ovr = computeOvr("ST", ratings, 180);
    let youngSum = 0, oldSum = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      youngSum += estimatePotential(mulberry32(i), ratings, ovr, 17, "ST", 180, i) - ovr;
      oldSum += estimatePotential(mulberry32(i + 1000), ratings, ovr, 32, "ST", 180, i) - ovr;
    }
    expect(youngSum / N).toBeGreaterThan(oldSum / N);
  });

  it("GKs get extra effective headroom at the same age as outfielders", () => {
    const ratings = flatRatings(60);
    const gkOvr = computeOvr("GK", ratings, 190);
    const stOvr = computeOvr("ST", ratings, 190);
    let gkSum = 0, stSum = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      gkSum += estimatePotential(mulberry32(i), ratings, gkOvr, 28, "GK", 190, i) - gkOvr;
      stSum += estimatePotential(mulberry32(i + 1000), ratings, stOvr, 28, "ST", 190, i) - stOvr;
    }
    expect(gkSum / N).toBeGreaterThan(stSum / N);
  });

  it("does not pile every young star onto exactly 99", () => {
    // High-ovr, young players simulate a spread of career peaks rather than
    // all pinning to the same outcome.
    const ratings = flatRatings(80);
    const ovr = computeOvr("ST", ratings, 185);
    const pots: number[] = [];
    for (let i = 0; i < 200; i++) {
      pots.push(estimatePotential(mulberry32(i), ratings, ovr, 20, "ST", 185, i));
    }
    const distinct = new Set(pots).size;
    expect(distinct).toBeGreaterThan(1);
    expect(pots.filter((p) => p === 99).length).toBeLessThan(pots.length);
    expect(Math.max(...pots)).toBeLessThanOrEqual(RATING_MAX);
  });

  it("still lets a ceiling-ovr player read 99 (potential is never below ovr)", () => {
    // Every rating at the ceiling, at a position carrying a POSITIVE OVR
    // calibration, so the weighted mean lands above 99 and the clamp inside
    // computeOvr is what brings it back. Nothing in play gets here (a fresh
    // world tops out around 81) but God Mode and roster imports can, and an
    // unclamped 102 would leak straight into wages and valuation.
    const ratings = flatRatings(99);
    const ovr = computeOvr("FB", ratings, 178);
    expect(ovr).toBe(99);
    for (let i = 0; i < 50; i++) {
      expect(estimatePotential(mulberry32(i), ratings, ovr, 20, "FB", 178, i)).toBe(99);
    }
  });
});

describe("progressPlayer", () => {
  it("appends a hist snapshot for the season", () => {
    const rng = mulberry32(7);
    const p = generatePlayer(rng, "CB", 55, 1, 19, 1);
    expect(p.hist).toHaveLength(1);
    const after = progressPlayer(rng, p, 1);
    expect(after.hist).toHaveLength(2);
    expect(after.hist[1].season).toBe(1);
  });

  it("does not mutate the input player", () => {
    const rng = mulberry32(3);
    const p = generatePlayer(rng, "CM", 55, 1, 17, 1);
    const ratingsBefore = { ...p.ratings };
    progressPlayer(rng, p, 1);
    expect(p.ratings).toEqual(ratingsBefore);
  });

  it("re-rolls potential from the new ovr rather than keeping the old value fixed", () => {
    const rng = mulberry32(11);
    const p = generatePlayer(rng, "ST", 55, 1, 18, 1);
    const after = progressPlayer(rng, p, 1);
    expect(after.potential).toBeGreaterThanOrEqual(after.ovr);
  });

  it("teenagers improve on average across many rolls", () => {
    let total = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      const rng = mulberry32(2000 + i);
      const p = generatePlayer(rng, "CM", 55, i, 18, 1);
      const after = progressPlayer(rng, p, 1);
      total += after.ovr - p.ovr;
    }
    expect(total / N).toBeGreaterThan(0);
  });

  it("players well past peak decline on average", () => {
    let total = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      const rng = mulberry32(3000 + i);
      const p = generatePlayer(rng, "CB", 55, i, 37, 1);
      const after = progressPlayer(rng, p, 1);
      total += after.ovr - p.ovr;
    }
    expect(total / N).toBeLessThan(0);
  });

  it("outcomes vary across identical starting players (busts and breakouts both happen)", () => {
    const outcomes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const rng = mulberry32(4000 + i);
      const p = generatePlayer(rng, "ST", 55, i, 18, 1);
      const after = progressPlayer(rng, p, 1);
      outcomes.push(after.ovr - p.ovr);
    }
    // Real spread: not every teenager gets the same delta.
    expect(new Set(outcomes).size).toBeGreaterThan(5);
    expect(Math.min(...outcomes)).toBeLessThan(Math.max(...outcomes) - 5);
  });

  it("the form roll + development bias let even growth-age players regress, not just grow slower", () => {
    // The correlated form roll and per-player bias (on top of independent
    // per-rating noise) are what make real breakout/bust seasons possible:
    // without them, per-rating noise mostly cancels out across the many
    // ratings a weighted-average ovr is built from, and a 22-year-old's ovr
    // would move almost deterministically.
    const outcomes: number[] = [];
    for (let i = 0; i < 300; i++) {
      const rng = mulberry32(6000 + i);
      const p = generatePlayer(rng, "CM", 55, i, 22, 1);
      const after = progressPlayer(rng, p, 1);
      outcomes.push(after.ovr - p.ovr);
    }
    expect(outcomes.some((d) => d <= -5)).toBe(true);
    expect(outcomes.some((d) => d >= 6)).toBe(true);
  });

  it("produces a +-5-magnitude single-season swing regularly, not just as a rare tail event", () => {
    // Retuned 2026-07-15 per explicit user request for more dramatic
    // progression/degression ("more +5, -5") — a prior pass had deliberately
    // tightened PROGRESSION_FORM_SD_*/PROGRESSION_BIAS_SD_YOUNG specifically
    // to make big swings rare; this reverses that. A +-5 swing should now be
    // a routine occurrence for a growth-age player, and even a +-10 swing,
    // while still a minority outcome, shouldn't be vanishingly rare.
    const outcomes: number[] = [];
    for (let i = 0; i < 500; i++) {
      const rng = mulberry32(8000 + i);
      const p = generatePlayer(rng, "CM", 55, i, 22, 1);
      const after = progressPlayer(rng, p, 1);
      outcomes.push(after.ovr - p.ovr);
    }
    const swingGe5 = outcomes.filter((d) => Math.abs(d) >= 5).length / outcomes.length;
    const swingGe10 = outcomes.filter((d) => Math.abs(d) >= 10).length / outcomes.length;
    expect(swingGe5).toBeGreaterThan(0.2);
    expect(swingGe10).toBeGreaterThan(0.02);
  });

  it("some players are consistent developers and some are consistent busts across consecutive seasons", () => {
    // The persistent per-player development bias should make same-direction
    // multi-season runs more common than pure independent per-season noise
    // would produce (iid baseline for 4 seasons all-same-sign is ~12.5%).
    // Threshold lowered 0.35->0.20 (2026-07-15) alongside the PROGRESSION_FORM_SD_*/
    // PROGRESSION_BIAS_SD_YOUNG widening for more dramatic swings: both were
    // scaled up together so the bias-to-noise ratio is unchanged, but the
    // now-larger form roll is a bigger share of total variance relative to
    // the fixed age-curve mean, so a single bad-form season can now more
    // often flip the sign away from the persistent bias's pull -- an
    // expected trade-off of bigger swings, not a bug.
    let allSameDir = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const rng = mulberry32(9000 + i);
      let p = generatePlayer(rng, "CM", 55, i, 19, 1);
      const deltas: number[] = [];
      for (let season = 1; season <= 4; season++) {
        const after = progressPlayer(rng, p, season);
        deltas.push(after.ovr - p.ovr);
        p = after;
      }
      const nonzero = deltas.filter((d) => d !== 0);
      if (nonzero.length > 0 && (nonzero.every((d) => d > 0) || nonzero.every((d) => d < 0))) {
        allSameDir++;
      }
    }
    expect(allSameDir / N).toBeGreaterThan(0.2);
  });

  it("growth damping makes big jumps rarer the closer a player already is to elite", () => {
    // A player already near GROWTH_DAMPING_START/END should see a smaller
    // mean/max positive delta than a mid-tier player of the same age, even
    // though both draw from the same age-curve/bias/form distributions.
    const meanDeltaAt = (startOvr: number): number => {
      const N = 800;
      let total = 0;
      for (let i = 0; i < N; i++) {
        const rng = mulberry32(i);
        const p = generatePlayer(rng, "CM", 55, i, 22, 1);
        const ratio = startOvr / p.ovr;
        const scaled = { ...p.ratings };
        for (const k of Object.keys(scaled) as (keyof PlayerRatings)[]) {
          scaled[k] = Math.max(1, Math.min(99, Math.round(scaled[k] * ratio)));
        }
        const actualOvr = computeOvr(p.pos, scaled, p.heightCm);
        const after = progressPlayer(rng, { ...p, ratings: scaled, ovr: actualOvr }, 1);
        total += after.ovr - actualOvr;
      }
      return total / N;
    };
    const midTier = meanDeltaAt(55);
    const nearElite = meanDeltaAt(85);
    expect(nearElite).toBeLessThan(midTier);
  });

  // God Mode's ratings lock. The freeze has to be invisible to the rng stream:
  // see the note on progressPlayer for why an early exit would re-roll the rest
  // of the world.
  describe("ratingsLocked", () => {
    it("leaves ratings, ovr, position and potential exactly where they were", () => {
      const rng = mulberry32(21);
      const p = generatePlayer(rng, "CM", 55, 1, 18, 1);
      const after = progressPlayer(rng, { ...p, ratingsLocked: true }, 1);
      expect(after.ratings).toEqual(p.ratings);
      expect(after.ovr).toBe(p.ovr);
      expect(after.pos).toBe(p.pos);
      expect(after.potential).toBe(p.potential);
    });

    it("still records the season, so the career chart runs flat rather than stopping", () => {
      const rng = mulberry32(22);
      const p = generatePlayer(rng, "CB", 55, 1, 19, 1);
      const after = progressPlayer(rng, { ...p, ratingsLocked: true }, 1);
      expect(after.hist).toHaveLength(p.hist.length + 1);
      const snap = after.hist[after.hist.length - 1];
      expect(snap.season).toBe(1);
      expect(snap.ovr).toBe(p.ovr);
      expect(snap.ratings).toEqual(p.ratings);
    });

    it("holds him still across a whole career, ageing included", () => {
      const rng = mulberry32(23);
      let p: Player = { ...generatePlayer(rng, "ST", 55, 1, 19, 1), ratingsLocked: true };
      const ovr = p.ovr;
      for (let season = 1; season <= 20; season++) p = progressPlayer(rng, p, season);
      expect(p.ovr).toBe(ovr);
    });

    // The invariant that keeps one locked player from changing anyone else's
    // career: identical draw count, so every player progressed after him sees
    // the stream he would have seen anyway.
    it("consumes exactly the same rng draws as an unlocked player", () => {
      const counted = (seed: number) => {
        const base = mulberry32(seed);
        let draws = 0;
        return { rng: () => { draws++; return base(); }, count: () => draws };
      };
      for (const seed of [31, 32, 33]) {
        const p = generatePlayer(mulberry32(seed), "W", 55, 1, 22, 1);
        const free = counted(seed + 900);
        progressPlayer(free.rng, p, 1);
        const held = counted(seed + 900);
        progressPlayer(held.rng, { ...p, ratingsLocked: true }, 1);
        expect(held.count()).toBe(free.count());
      }
    });

    // Unlocking is a real state, not just the absence of ever having locked him.
    it("resumes developing once the lock comes off", () => {
      const rng = mulberry32(24);
      const p = generatePlayer(rng, "CM", 55, 1, 18, 1);
      const held = progressPlayer(mulberry32(41), { ...p, ratingsLocked: true }, 1);
      const freed = progressPlayer(mulberry32(41), { ...held, ratingsLocked: false }, 2);
      expect(freed.ratings).not.toEqual(p.ratings);
    });
  });
});

describe("retirementProbability", () => {
  it("is zero below the retirement start age for a rostered player", () => {
    expect(retirementProbability(RETIREMENT_START_AGE - 1, true)).toBe(0);
  });
  it("increases with age past the start age", () => {
    const a = retirementProbability(RETIREMENT_START_AGE, true);
    const b = retirementProbability(RETIREMENT_START_AGE + 5, true);
    expect(b).toBeGreaterThan(a);
  });

  // The rework: roster status scales the curve, age still shapes it.
  it("gives an unrostered player a real chance at any age", () => {
    // A 20-year-old nobody signed drifts out of the game; a rostered one can't.
    expect(retirementProbability(20, false)).toBeCloseTo(RETIREMENT_UNROSTERED_BASE, 10);
    expect(retirementProbability(20, true)).toBe(0);
  });
  it("always retires an unrostered player faster than a rostered one of the same age", () => {
    for (let age = 18; age <= 42; age++) {
      expect(retirementProbability(age, false)).toBeGreaterThan(
        retirementProbability(age, true),
      );
    }
  });
  it("damps but never zeroes a rostered veteran, so age still dominates", () => {
    // The "good enough to play till 40" ask: still a live career at 39-40,
    // but never a free pass — the probability keeps climbing.
    const at39 = retirementProbability(39, true);
    expect(at39).toBeGreaterThan(0);
    expect(at39).toBeLessThan(1);
    expect(retirementProbability(40, true)).toBeGreaterThan(at39);
  });
  it("never exceeds the cap", () => {
    for (const rostered of [true, false]) {
      for (let age = 16; age <= 60; age++) {
        expect(retirementProbability(age, rostered)).toBeLessThanOrEqual(RETIREMENT_MAX_PROB);
      }
    }
  });
});

describe("rollRetirement", () => {
  it("never retires a young rostered player", () => {
    const rng = mulberry32(1);
    const p = generatePlayer(rng, "ST", 55, 1, 21, 1);
    expect(rollRetirement(rng, p, 1, true)).toBe(false);
  });
  it("defaults to the rostered curve when roster status is not passed", () => {
    const p = generatePlayer(mulberry32(1), "ST", 55, 1, 21, 1);
    expect(rollRetirement(() => 0.0001, p, 1)).toBe(false);
  });
  it("retires young unrostered players at roughly the unrostered base rate", () => {
    const rng = mulberry32(9);
    // Pin potential at the threshold so the prospect exemption doesn't apply —
    // a generated player's own ceiling could land either side of it.
    const p = {
      ...generatePlayer(mulberry32(1), "ST", 55, 1, 21, 1),
      potential: RETIREMENT_PROSPECT_POT_THRESHOLD,
    };
    let retired = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (rollRetirement(rng, p, 1, false)) retired++;
    }
    expect(retired / N).toBeCloseTo(RETIREMENT_UNROSTERED_BASE, 1);
  });
  it("spares an unrostered kid whose ceiling is still high", () => {
    // The exemption: a high-potential prospect between clubs must not wash out
    // at the same rate as a journeyman nobody will ever sign.
    const kid = {
      ...generatePlayer(mulberry32(1), "ST", 45, 1, 17, 1),
      potential: RETIREMENT_PROSPECT_POT_THRESHOLD + 15,
    };
    const journeyman = {
      ...generatePlayer(mulberry32(1), "ST", 45, 2, 17, 1),
      potential: RETIREMENT_PROSPECT_POT_THRESHOLD,
    };
    // rng returns just under the unrostered base: enough to retire the
    // journeyman, while the prospect is on the damped curve (zero at 17).
    const draw = () => RETIREMENT_UNROSTERED_BASE - 0.01;
    expect(rollRetirement(draw, journeyman, 1, false)).toBe(true);
    expect(rollRetirement(draw, kid, 1, false)).toBe(false);
  });
  it("does not spare an unrostered player whose ceiling is at or below the threshold", () => {
    const p = {
      ...generatePlayer(mulberry32(1), "ST", 45, 1, 17, 1),
      potential: RETIREMENT_PROSPECT_POT_THRESHOLD,
    };
    expect(isWantedForRetirement(p, false, 17)).toBe(false);
    expect(isWantedForRetirement(p, true, 17)).toBe(true);
  });
  it("does not let the prospect exemption spare an unsigned veteran", () => {
    // estimatePotential never returns less than current ovr, so a good older
    // player always clears the potential bar. Without the age bound he'd be
    // exempted onto the damped curve and retire LESS than under the old
    // age-only model, which is backwards.
    const vet = {
      ...generatePlayer(mulberry32(1), "ST", 70, 1, 37, 1),
      potential: RETIREMENT_PROSPECT_POT_THRESHOLD + 10,
    };
    expect(isWantedForRetirement(vet, false, 37)).toBe(false);
    // ...and he must retire at least as fast as the old age-only curve did.
    const oldModel = RETIREMENT_BASE_PROB
      + (37 - RETIREMENT_START_AGE) * RETIREMENT_PROB_PER_YEAR;
    expect(retirementProbability(37, false)).toBeGreaterThan(oldModel);
  });
  it("applies the exemption right up to, but not at, the age bound", () => {
    const kid = {
      ...generatePlayer(mulberry32(1), "ST", 60, 1, 20, 1),
      potential: RETIREMENT_PROSPECT_POT_THRESHOLD + 10,
    };
    expect(isWantedForRetirement(kid, false, RETIREMENT_PROSPECT_MAX_AGE - 1)).toBe(true);
    expect(isWantedForRetirement(kid, false, RETIREMENT_PROSPECT_MAX_AGE)).toBe(false);
  });
  it("keeps the prospect exemption pinned to the pool cull's own bounds", () => {
    // Both bounds are shared with the cull so the pair can't drift apart on
    // either axis. This is NOT a claim that the two are fully complementary:
    // the cull additionally spares career peak > FREE_AGENT_CULL_MAX_PEAK_OVR,
    // which retirement deliberately ignores (an unsigned ex-good 30-year-old
    // should retire). It only pins the two axes they do share.
    expect(RETIREMENT_PROSPECT_POT_THRESHOLD).toBe(FREE_AGENT_CULL_MAX_POT);
    expect(RETIREMENT_PROSPECT_MAX_AGE).toBe(FREE_AGENT_CULL_MIN_AGE);
  });
  it("consumes exactly one rng draw either way, keeping stream order stable", () => {
    const p = generatePlayer(mulberry32(1), "ST", 55, 1, 21, 1);
    for (const rostered of [true, false]) {
      let draws = 0;
      const rng = () => { draws++; return 0.5; };
      rollRetirement(rng, p, 40, rostered);
      expect(draws).toBe(1);
    }
  });
});

describe("generational talents", () => {
  it("isGenerational is deterministic and rare (~1 in 2500)", () => {
    let count = 0;
    for (let pid = 0; pid < 200_000; pid++) {
      if (isGenerational(pid)) count++;
    }
    // Expected 80 at 1/2500; allow generous hash noise either side.
    expect(count).toBeGreaterThan(40);
    expect(count).toBeLessThan(140);  });

  it("a generational kid's career peaks far above an otherwise-identical normal kid's", () => {
    // Find one flagged pid and one unflagged pid, then run the same
    // 16-year-old template through full careers under each identity with
    // identical rng seeds — only the pid (and therefore the generational
    // flag + development bias) differs.
    let genPid = -1;
    for (let pid = 0; pid < 100_000 && genPid < 0; pid++) {
      if (isGenerational(pid)) genPid = pid;
    }
    expect(genPid).toBeGreaterThanOrEqual(0);
    const normalPid = isGenerational(1) ? 2 : 1;

    const template = generatePlayer(mulberry32(11), "CM", 24, 999, 16, 2026);
    const careerPeak = (pid: number, seed: number): number => {
      const rng = mulberry32(seed);
      let p: Player = { ...template, pid, stats: [], hist: [] };
      let peak = p.ovr;
      for (let season = 2027; season <= 2044; season++) {
        p = progressPlayer(rng, p, season, true);
        if (p.ovr > peak) peak = p.ovr;
      }
      return peak;
    };

    const trials = 8;
    let genSum = 0;
    let normSum = 0;
    for (let i = 0; i < trials; i++) {
      genSum += careerPeak(genPid, 100 + i);
      normSum += careerPeak(normalPid, 100 + i);
    }
    // Tuned so generational careers peak at a median ~80 vs ~46 for the same
    // kid unflagged — demand a wide, unambiguous margin, not a tie-breaker.
    expect(genSum / trials).toBeGreaterThan(normSum / trials + 10);
  });
});
