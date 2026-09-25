import { describe, it, expect } from "vitest";
import { makeLeague } from "../../helpers/league.js";
import type { Player, Position } from "../../../src/core/players/types.js";
import { POSITIONS } from "../../../src/core/players/types.js";
import type { ClubContext, StrategicDirection } from "../../../src/core/ai/clubContext.js";
import {
  evaluatePlayerForClub, valueToClub, keepValueToClub, scoutNoiseFraction,
  perceivedValueToClub, hasPositionalGap,
} from "../../../src/core/ai/evaluate.js";
import {
  ROSTER_COMPOSITION, AI_NEED_MIN, AI_NEED_MAX,
  AI_SCOUT_NOISE_MIN, AI_SCOUT_NOISE_MAX, AI_NEED_BUY_WEAK_STARTER_GAP,
} from "../../../src/core/constants.js";

const SEASON = 10;

/**
 * One real generated player, loaded once for the whole file, used as the
 * template every case spreads over — so every field is valid without this
 * file having to hand-maintain a complete Player literal.
 *
 * Hoisted rather than loaded per call: samplePlayer is used ~20 times here and
 * each call used to load the cached 626-club / 15,650-player world just to read
 * `players[0]`. Nothing mutates the template (every case spreads it into a
 * fresh object), so one load serves all of them.
 */
const BASE_PLAYER: Player = makeLeague(0, 1).players[0];

/** A real generated player we can override fields on (so every field is valid). */
function samplePlayer(overrides: Partial<Player> = {}): Player {
  return {
    ...BASE_PLAYER,
    pos: "ST",
    born: SEASON - 26, // age 26 by default
    ovr: 70,
    potential: 70,
    contract: { salary: 5_000_000, expiresSeason: SEASON + 3 },
    ...overrides,
  };
}

function ctx(overrides: Partial<ClubContext> = {}): ClubContext {
  const posDepth = { ...ROSTER_COMPOSITION } as Record<Position, number>;
  const posBestOvr = Object.fromEntries(POSITIONS.map((p) => [p, 65])) as Record<Position, number>;
  const posSecondBestOvr = Object.fromEntries(POSITIONS.map((p) => [p, 60])) as Record<Position, number>;
  // Same value as posBestOvr, so a club with no explicit hole reads exactly as
  // it did when buy-side valuation measured against the best player: these cases
  // are about the other multipliers, not about depth behind the starters.
  const posWeakestStarterOvr = Object.fromEntries(POSITIONS.map((p) => [p, 65])) as Record<Position, number>;
  return {
    tid: 0,
    season: SEASON,
    budget: 80_000_000,
    squadStrength: 65,
    squadAvgAge: 26,
    posDepth,
    posBestOvr,
    posSecondBestOvr,
    posWeakestStarterOvr,
    hype: 50,
    stature: 0.5,
    statureParts: { strength: 0.325, reputation: 0.175, wealth: 0 },
    ambition: 0.5,
    frugality: 0.5,
    direction: "Midtable Stability" as StrategicDirection,
    ...overrides,
  };
}

describe("evaluatePlayerForClub", () => {
  it("returns a breakdown whose value is the product of base and multipliers", () => {
    const v = evaluatePlayerForClub(samplePlayer(), ctx());
    expect(v.value).toBeCloseTo(v.base * v.needMult * v.timelineMult * v.affordabilityMult, 3);
    expect(v.value).toBeGreaterThan(0);
  });

  it("keeps the need multiplier within its clamp regardless of extremes", () => {
    // An empty position, huge upgrade → clamped at the max.
    const emptyStacked = ctx({
      posDepth: { ...ROSTER_COMPOSITION, ST: 0 } as Record<Position, number>,
      posBestOvr: Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>,
    });
    const hi = evaluatePlayerForClub(samplePlayer({ ovr: 95 }), emptyStacked);
    expect(hi.needMult).toBeLessThanOrEqual(AI_NEED_MAX + 1e-9);
    expect(hi.needMult).toBeGreaterThanOrEqual(AI_NEED_MIN - 1e-9);

    // A hopelessly stacked position with a far superior incumbent → clamped at the min.
    const overStacked = ctx({
      posDepth: { ...ROSTER_COMPOSITION, ST: 12 } as Record<Position, number>,
      posBestOvr: Object.fromEntries(POSITIONS.map((p) => [p, 90])) as Record<Position, number>,
    });
    const lo = evaluatePlayerForClub(samplePlayer({ ovr: 55 }), overStacked);
    expect(lo.needMult).toBeGreaterThanOrEqual(AI_NEED_MIN - 1e-9);
    expect(lo.needMult).toBeLessThanOrEqual(AI_NEED_MAX + 1e-9);
  });
});

describe("positional need", () => {
  const player = samplePlayer({ pos: "GK", ovr: 72 });

  it("values a player more when the club is thin at his position", () => {
    const thin = ctx({
      posDepth: { ...ROSTER_COMPOSITION, GK: 1 } as Record<Position, number>,
      posBestOvr: { ...ctx().posBestOvr, GK: 60 },
    });
    const stacked = ctx({
      posDepth: { ...ROSTER_COMPOSITION, GK: 5 } as Record<Position, number>,
      posBestOvr: { ...ctx().posBestOvr, GK: 80 },
    });
    expect(valueToClub(player, thin)).toBeGreaterThan(valueToClub(player, stacked));
  });
});

describe("timeline fit (age × ambition)", () => {
  it("a developer club values a young prospect more than a win-now club does", () => {
    const prospect = samplePlayer({ born: SEASON - 19, ovr: 70, potential: 85 });
    const developer = ctx({ ambition: 0.1 });
    const contender = ctx({ ambition: 0.9 });
    expect(valueToClub(prospect, developer)).toBeGreaterThan(valueToClub(prospect, contender));
  });

  it("a win-now club values a prime-age player more than a developer club does", () => {
    const prime = samplePlayer({ born: SEASON - 26, ovr: 78 });
    const developer = ctx({ ambition: 0.1 });
    const contender = ctx({ ambition: 0.9 });
    expect(valueToClub(prime, contender)).toBeGreaterThan(valueToClub(prime, developer));
  });
});

describe("scoutNoiseFraction / perceivedValueToClub", () => {
  it("gives the wealthiest club (frugality 0) the minimum noise and the poorest (frugality 1) the max", () => {
    expect(scoutNoiseFraction(ctx({ frugality: 0 }))).toBeCloseTo(AI_SCOUT_NOISE_MIN, 6);
    expect(scoutNoiseFraction(ctx({ frugality: 1 }))).toBeCloseTo(AI_SCOUT_NOISE_MAX, 6);
  });

  it("stays within scoutNoiseFraction of the true valueToClub for any jitter draw", () => {
    const player = samplePlayer();
    const c = ctx({ frugality: 0.7 });
    const trueValue = valueToClub(player, c);
    const noise = scoutNoiseFraction(c);
    for (const draw of [0, 0.25, 0.5, 0.75, 1]) {
      const perceived = perceivedValueToClub(player, c, () => draw);
      expect(perceived).toBeGreaterThanOrEqual(trueValue * (1 - noise) - 1e-6);
      expect(perceived).toBeLessThanOrEqual(trueValue * (1 + noise) + 1e-6);
    }
  });

  it("a poorer (more frugal) club's perceived value swings further from true value than a wealthy club's", () => {
    const player = samplePlayer();
    const rich = ctx({ frugality: 0 });
    const poor = ctx({ frugality: 1 });
    const richSwing = Math.abs(perceivedValueToClub(player, rich, () => 1) - valueToClub(player, rich));
    const poorSwing = Math.abs(perceivedValueToClub(player, poor, () => 1) - valueToClub(player, poor));
    expect(poorSwing).toBeGreaterThan(richSwing);
  });
});

describe("hasPositionalGap", () => {
  const everywhere = (v: number) =>
    Object.fromEntries(POSITIONS.map((p) => [p, v])) as Record<Position, number>;

  // At target depth everywhere, and strong in every slot it actually fields —
  // not merely strong in its best man at each position, which is the thing this
  // predicate used to confuse for the same fact.
  const noGap = ctx({
    squadStrength: 72,
    posBestOvr: everywhere(74),
    posWeakestStarterOvr: everywhere(74),
  });

  /** A club whose weakest starter at `pos` sits clearly below its own level. */
  const softAt = (pos: Position, ovr: number) =>
    ctx({
      squadStrength: 72,
      posBestOvr: everywhere(74),
      posWeakestStarterOvr: { ...everywhere(74), [pos]: ovr },
    });

  it("is false when the club is at target depth and has a solid incumbent", () => {
    expect(hasPositionalGap(samplePlayer({ pos: "ST", ovr: 80 }), noGap)).toBe(false);
  });

  it("is true when the club is understaffed at the position (needs bodies)", () => {
    const thin = ctx({
      ...noGap,
      posDepth: { ...ROSTER_COMPOSITION, ST: ROSTER_COMPOSITION.ST - 1 } as Record<Position, number>,
    });
    // Even a merely-decent player counts — a short position needs a body.
    expect(hasPositionalGap(samplePlayer({ pos: "ST", ovr: 68 }), thin)).toBe(true);
  });

  it("is true for a weak startable hole the player would upgrade", () => {
    const weak = softAt("ST", 72 - AI_NEED_BUY_WEAK_STARTER_GAP - 2);
    // Player beats the weak incumbent → a real upgrade to a soft spot.
    expect(hasPositionalGap(samplePlayer({ pos: "ST", ovr: 74 }), weak)).toBe(true);
  });

  it("is false at a weak spot when the player would not upgrade the incumbent", () => {
    const weak = softAt("ST", 72 - AI_NEED_BUY_WEAK_STARTER_GAP - 2);
    const incumbent = weak.posWeakestStarterOvr.ST;
    expect(hasPositionalGap(samplePlayer({ pos: "ST", ovr: incumbent - 1 }), weak)).toBe(false);
  });

  it("sees a hole BEHIND an excellent player, which is the reported bug", () => {
    // Regensburg Steinerne, season 8: centre-backs {73, 32, 29, 29}, four bodies
    // for the four ROSTER_COMPOSITION wants, £125M in the bank, and a 16-year-old
    // starting alongside the 73. Reading the club's *best* centre-back said "no
    // need here" and the market never offered them one. A back four fields two.
    const oneGoodCentreBack = ctx({
      squadStrength: 69,
      posBestOvr: { ...everywhere(70), CB: 73 },
      posWeakestStarterOvr: { ...everywhere(70), CB: 32 },
    });
    expect(hasPositionalGap(samplePlayer({ pos: "CB", ovr: 60 }), oneGoodCentreBack)).toBe(true);
    // And the valuation has to agree, or the club registers the need and still
    // refuses to pay: measured against the 73 he read as a downgrade.
    const upgrade = evaluatePlayerForClub(samplePlayer({ pos: "CB", ovr: 60 }), oneGoodCentreBack).needMult;
    const stocked = evaluatePlayerForClub(
      samplePlayer({ pos: "CB", ovr: 60 }),
      ctx({ squadStrength: 69, posBestOvr: { ...everywhere(70), CB: 73 }, posWeakestStarterOvr: { ...everywhere(70), CB: 73 } }),
    ).needMult;
    expect(upgrade).toBeGreaterThan(stocked);
  });
});

describe("affordability", () => {
  it("penalizes an expensive deal more for a poor, frugal club than a rich one", () => {
    const star = samplePlayer({ ovr: 88, potential: 88, contract: { salary: 12_000_000, expiresSeason: SEASON + 3 } });
    const rich = ctx({ budget: 400_000_000, frugality: 0 });
    const poor = ctx({ budget: 15_000_000, frugality: 1 });
    const richMult = evaluatePlayerForClub(star, rich).affordabilityMult;
    const poorMult = evaluatePlayerForClub(star, poor).affordabilityMult;
    expect(richMult).toBeGreaterThan(poorMult);
    expect(richMult).toBeLessThanOrEqual(1);
    expect(poorMult).toBeLessThan(1);
  });
});

describe("keepValueToClub (keep side)", () => {
  it("values a club's own best player far above what the buy side would say", () => {
    // The core inversion this split exists to fix: on the buy side a club's own
    // star is measured against himself, so he reads as adding nothing, and he's
    // discounted again for "affordability" despite already being on the books.
    // Measured on a real world, that had an 85-ovr player's own club valuing him
    // at $132M against a $350M market, which made every star cheap to buy.
    const star = samplePlayer({ ovr: 85, potential: 85, pos: "ST" });
    const stacked = ctx({
      posBestOvr: { ...ctx().posBestOvr, ST: 85 },
      posSecondBestOvr: { ...ctx().posSecondBestOvr, ST: 68 },
      budget: 40_000_000,
      frugality: 0.8,
    });
    expect(keepValueToClub(star, stacked)).toBeGreaterThan(valueToClub(star, stacked));
  });

  it("prices him by the drop-off to his replacement, not by zero", () => {
    // Same club, same player: the only difference is who would step up if he
    // left. A club with a ready deputy should part with him more cheaply.
    const star = samplePlayer({ ovr: 85, potential: 85, pos: "ST" });
    const noDeputy = ctx({
      posBestOvr: { ...ctx().posBestOvr, ST: 85 },
      posSecondBestOvr: { ...ctx().posSecondBestOvr, ST: 60 },
    });
    const goodDeputy = ctx({
      posBestOvr: { ...ctx().posBestOvr, ST: 85 },
      posSecondBestOvr: { ...ctx().posSecondBestOvr, ST: 82 },
    });
    expect(keepValueToClub(star, noDeputy)).toBeGreaterThan(keepValueToClub(star, goodDeputy));
  });

  it("does not discount a player it already owns for affordability", () => {
    // Affordability is a spending penalty; nothing is being bought here.
    const star = samplePlayer({ ovr: 82, potential: 82, pos: "ST" });
    const poor = ctx({ budget: 5_000_000, frugality: 1 });
    const rich = ctx({ budget: 400_000_000, frugality: 0 });
    expect(keepValueToClub(star, poor)).toBeCloseTo(keepValueToClub(star, rich), 5);
    // ...whereas the buy side very much does.
    expect(valueToClub(star, poor)).toBeLessThan(valueToClub(star, rich));
  });

  it("won't let a win-now club write off its own young talent", () => {
    // A win-now club discounts a 21-year-old when buying, but must not conclude
    // it should therefore sell its own - that stripped clubs of exactly the
    // players they should build on.
    const kid = samplePlayer({ ovr: 75, potential: 88, born: SEASON - 21, pos: "ST" });
    const winNow = ctx({ ambition: 1 });
    expect(keepValueToClub(kid, winNow)).toBeGreaterThan(valueToClub(kid, winNow));
  });
});
