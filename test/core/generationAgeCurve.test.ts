import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  generatePlayer, drawGenerationAge, generationBaseForAge, softFloorBase,
} from "../../src/core/players/generate.js";
import { youthGenerationBase } from "../../src/core/players/youth.js";
import {
  GENERATION_AGE_WEIGHTS, GENERATION_EQUILIBRIUM_LIFT, YOUTH_AGE,
  YOUTH_BASE_OFFSET, YOUTH_BASE_FLOOR, YOUTH_BASE_SOFTNESS,
  INITIAL_AGE_MIN, INITIAL_AGE_MAX, BASE_AGE_CURVE_PEAK,
} from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";
import { makeLeague } from "../helpers/league.js";

/**
 * World generation used to roll every rating from a club's base with NO age
 * term — `age` only set `born` — so a fresh world's age->OVR profile was flat: a
 * generated 18-year-old averaged 76.2 against a 33-year-old's 75.2. The sim then
 * ran the age curve over that, which handed every generated teenager peak-age
 * ratings AND the growth curve on top. Measured consequences, all of them
 * reported by players: the ten best players in the big four were aged
 * 21/21/23/21/23/21/21/22/21/21 by season 4, the best OVR went 91 -> 99 by
 * season 5 with the 90+ population 11 -> 60, and squad mean fell 75.4 -> 63.3
 * while p90 rose.
 *
 * These tests pin the properties that fix rests on, not the numbers it produced.
 */
describe("generation age model", () => {
  /**
   * The whole safety argument for the change. The offsets are zero-mean under
   * `GENERATION_AGE_WEIGHTS`, so generation's overall LEVEL is untouched and
   * every constant calibrated against it — LEAGUE_BASE, the country and division
   * ladders, the wage and valuation curves — keeps meaning what it did. Only the
   * shape moves.
   *
   * Checked through `generationBaseForAge` rather than on the private table, so
   * it covers the lift and the soft floor as the caller sees them.
   */
  it("shifts a squad's shape without moving its level", () => {
    const BASE = 40; // comfortably clear of the soft floor, so it is pure arithmetic
    const ages = Object.keys(GENERATION_AGE_WEIGHTS).map(Number);
    const totalW = ages.reduce((s, a) => s + GENERATION_AGE_WEIGHTS[a], 0);
    for (const group of ["physical", "skill"] as const) {
      const weighted = ages.reduce(
        (s, a) => s + GENERATION_AGE_WEIGHTS[a] * generationBaseForAge(BASE, a, "CM", "random")[group],
        0,
      ) / totalW;
      expect(weighted - GENERATION_EQUILIBRIUM_LIFT).toBeCloseTo(BASE, 1);
    }
  });

  /**
   * The correction has to run the right way round, and the sign is the entire
   * mechanism: a player below the peak starts BELOW his club's base because he
   * still has that growth coming, and a player past it starts below too because
   * he has already spent it.
   */
  it("puts peak age at the top and both tails below it", () => {
    const at = (age: number) => generationBaseForAge(50, age, "CM", "random").skill;
    const peak = at(BASE_AGE_CURVE_PEAK);
    expect(at(YOUTH_AGE)).toBeLessThan(peak);
    expect(at(INITIAL_AGE_MAX)).toBeLessThan(peak);
    // Monotone rising through the growth years — a dip would mean an age band
    // generated below the one beneath it.
    for (let a = YOUTH_AGE; a < BASE_AGE_CURVE_PEAK; a++) {
      expect(at(a + 1)).toBeGreaterThanOrEqual(at(a));
    }
  });

  /**
   * Physicals read the curve at `age + PHYSICAL_AGE_SHIFT` and skills at
   * `age + SKILL_AGE_SHIFT`, 4.5 years apart. Splitting the offset the same way
   * progression splits its deltas is what makes a generated veteran read like an
   * old player — legs gone, technique intact — rather than uniformly faded.
   */
  it("ages physicals faster than technique", () => {
    const old = generationBaseForAge(50, 35, "CM", "random");
    const young = generationBaseForAge(50, 20, "CM", "random");
    expect(old.physical).toBeLessThan(old.skill);
    expect(young.physical).toBeGreaterThan(young.skill);
  });

  /**
   * The default MUST be the old flat behaviour. Youth intake already drops its
   * 16-year-olds by `YOUTH_BASE_OFFSET`, so an age curve applied on top would
   * count the same adjustment twice and generate rubble; God Mode, the roster
   * importer's archetype and every fixture likewise expect what they had.
   */
  it("leaves a caller that does not opt in byte-identical", () => {
    const mk = (ageAdjusted: boolean, age: number): Player => generatePlayer(
      mulberry32(99), "CM", 40, 1, age, 1, 0, undefined, null, "random", ageAdjusted,
    );
    expect(mk(false, 18).ratings).toEqual(mk(false, 30).ratings);
    // ...and opting in genuinely changes it, or the test above proves nothing.
    expect(mk(true, 18).ratings).not.toEqual(mk(true, 30).ratings);
  });

  /**
   * The age model scales what a draw produces, never how many draws happen —
   * the same contract `POSITION_RATING_SPREAD` and `OVR_SCALE_SHIFT` hold to.
   * `generateWorld` is a single rng pass in table order precisely so that
   * appending a country cannot perturb an existing one's players.
   */
  it("consumes the same rng draws either way", () => {
    const count = (ageAdjusted: boolean) => {
      let n = 0;
      const src = mulberry32(7);
      const rng = () => { n++; return src(); };
      generatePlayer(rng, "CM", 40, 1, 22, 1, 0, undefined, null, "random", ageAdjusted);
      return n;
    };
    expect(count(true)).toBe(count(false));
  });

  /**
   * `youthGenerationBase` was refactored onto the shared `softFloorBase` in the
   * same change. It is a swept anti-inflation constant's only consumer, so it
   * has to come out bit-identical rather than merely close.
   */
  it("keeps youth intake's base exactly as it was", () => {
    const before = (academyBase: number) => {
      const raw = academyBase - YOUTH_BASE_OFFSET;
      const x = (raw - YOUTH_BASE_FLOOR) / YOUTH_BASE_SOFTNESS;
      if (x > 30) return raw;
      return YOUTH_BASE_FLOOR + YOUTH_BASE_SOFTNESS * Math.log1p(Math.exp(x));
    };
    for (let b = -20; b <= 80; b += 0.25) {
      expect(youthGenerationBase(b)).toBe(before(b));
    }
  });

  /**
   * A weak third-division base is already low enough that `TIER_OFFSET`'s `VL`
   * row underflows into `RATING_MIN`; subtracting another ~18 for a teenager
   * without the floor clamps his whole rating set to 1, which yields not a weak
   * player but a destroyed one. That is the exact failure `YOUTH_BASE_FLOOR`
   * exists to prevent, reachable again from a new direction.
   */
  it("never sends a weak club's base below the soft floor", () => {
    for (const age of Object.keys(GENERATION_AGE_WEIGHTS).map(Number)) {
      const { physical, skill } = generationBaseForAge(2, age, "CM", "random");
      expect(physical).toBeGreaterThanOrEqual(YOUTH_BASE_FLOOR);
      expect(skill).toBeGreaterThanOrEqual(YOUTH_BASE_FLOOR);
    }
    expect(softFloorBase(-50)).toBeGreaterThan(0);
  });

  /**
   * THE AGE-DISTRIBUTION HOLE. Starting rosters used to be drawn from ages 18-33
   * while youth intake starts at `YOUTH_AGE`, so the two cohorts never met: no
   * player was ever created with a birth season in between. Measured on a real
   * world, the whole pool had zero players aged 17 at season 1, 17-18 at season
   * 2, 18-19 at season 3, and 28-29 by season 13 — a gap two years wide marching
   * up one year per season, crossing peak age around season 10.
   *
   * The fix is that generation reaches down to `YOUTH_AGE`, so intake lands
   * inside the range rather than below it.
   */
  it("leaves no gap between the starting squad and youth intake", () => {
    expect(INITIAL_AGE_MIN).toBe(YOUTH_AGE);
    const drawn = new Set<number>();
    for (let i = 0; i < 20000; i++) drawn.add(drawGenerationAge(i / 20000));
    for (let a = INITIAL_AGE_MIN; a <= INITIAL_AGE_MAX; a++) {
      expect(drawn.has(a), `no starting player is ever generated aged ${a}`).toBe(true);
    }
  });

  /** The draw is one rng value, as the uniform draw it replaced was. */
  it("draws an age from one rng value and stays inside the table", () => {
    for (let i = 0; i <= 1000; i++) {
      const age = drawGenerationAge(i / 1000);
      expect(age).toBeGreaterThanOrEqual(INITIAL_AGE_MIN);
      expect(age).toBeLessThanOrEqual(INITIAL_AGE_MAX);
    }
  });
});

/**
 * The same properties on a real generated world rather than on the helpers, so
 * they cover the whole path — the age draw, the per-group bases, the soft floor,
 * `computeOvr` and the rating clamps together.
 */
describe("a generated world's age profile", () => {
  const league = makeLeague(0, 1);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const rostered: { age: number; ovr: number }[] = [];
  for (const t of league.teams) {
    for (const pid of t.roster) {
      const p = byPid.get(pid);
      if (p) rostered.push({ age: league.season - p.born, ovr: p.ovr });
    }
  }
  const meanAt = (lo: number, hi: number) => {
    const xs = rostered.filter((r) => r.age >= lo && r.age <= hi).map((r) => r.ovr);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };

  /**
   * The headline property, and the one a player sees first. Before the age
   * model these three bands were within a point of each other.
   */
  it("rates teenagers below peak age, and veterans below it too", () => {
    const teen = meanAt(16, 19);
    const peak = meanAt(25, 29);
    const old = meanAt(35, 38);
    expect(peak - teen).toBeGreaterThan(5);
    expect(peak - old).toBeGreaterThan(5);
  });

  /**
   * "All the best players are 20-23", the user's own words, and measurably true
   * before this: at season 4 the ten best players in the big four were aged
   * 21/21/23/21/23/21/21/22/21/21. A generated world's best players should be at
   * the age real football's are.
   */
  it("puts its best players at peak age, not in their teens", () => {
    const top = [...rostered].sort((a, b) => b.ovr - a.ovr).slice(0, 50);
    const meanAge = top.reduce((s, r) => s + r.age, 0) / top.length;
    expect(meanAge).toBeGreaterThan(23);
    expect(meanAge).toBeLessThan(31);
  });

  /** Every age in the table is actually represented, on a real world. */
  it("generates players at every age in the table", () => {
    const present = new Set(rostered.map((r) => r.age));
    for (let a = INITIAL_AGE_MIN; a <= INITIAL_AGE_MAX; a++) {
      expect(present.has(a), `world has no player aged ${a}`).toBe(true);
    }
  });
});
