import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../../src/engine/rng.js";
import { trueTransferValue, perceivedTransferValue } from "../../../src/core/finance/valuation.js";
import type { Player, PlayerRatings } from "../../../src/core/players/types.js";
import { SCOUTING_SPEND_MAX, MAX_TRANSFER_VALUE } from "../../../src/core/constants.js";

const RATINGS: PlayerRatings = {
  speed: 50, strength: 50, stamina: 50, jumping: 50,
  shortPass: 50, longPass: 50, crosses: 50, dribbling: 50, longShot: 50, finishing: 50,
  tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 50,
};

function makePlayer(overrides: Partial<Player>): Player {
  return {
    pid: 1,
    name: "Test Player",
    nationality: "TST",
    born: 2000,
    pos: "CM",
    heightCm: 180,
    ratings: RATINGS,
    ovr: 60,
    potential: 65,
    contract: { salary: 1000, expiresSeason: 2027 },
    injury: null,
    recentStats: [],
    recentHist: [],
    ...overrides,
  };
}

describe("trueTransferValue", () => {
  it("is worth ~nothing at or below the ovr floor", () => {
    const player = makePlayer({ ovr: 35 });
    expect(trueTransferValue(player, 2026)).toBe(0);
  });

  it("increases with ovr", () => {
    const low = makePlayer({ ovr: 55 });
    const high = makePlayer({ ovr: 85 });
    expect(trueTransferValue(high, 2026)).toBeGreaterThan(trueTransferValue(low, 2026));
  });

  it("values a player near their peak age higher than an aging one, at equal ovr", () => {
    const prime = makePlayer({ ovr: 75, born: 2026 - 26 });
    const aging = makePlayer({ ovr: 75, born: 2026 - 36 });
    expect(trueTransferValue(prime, 2026)).toBeGreaterThan(trueTransferValue(aging, 2026));
  });

  it("values more remaining contract length higher, at equal ovr and age", () => {
    const shortDeal = makePlayer({ ovr: 75, contract: { salary: 1000, expiresSeason: 2027 } });
    const longDeal = makePlayer({ ovr: 75, contract: { salary: 1000, expiresSeason: 2032 } });
    expect(trueTransferValue(longDeal, 2026)).toBeGreaterThan(trueTransferValue(shortDeal, 2026));
  });

  it("applies an accelerating elite premium above the threshold, without saturating", () => {
    // At/below the elite threshold (VALUATION_ELITE_THRESHOLD, currently 76) the
    // premium is zero; above it, value climbs faster and faster.
    //
    // Rebased 2026-08-08. This test used to assert that value hit
    // MAX_TRANSFER_VALUE by ovr 80 and stayed pinned there — which was true, and
    // was precisely the bug: the whole elite band priced identically, so an 80
    // and an 87 both cost $350M and (via AI_MARKET_FEE_FLOOR_FRACTION) every
    // elite deal opened at $175M. What the curve owes us is a *gradient* across
    // the elite band, with the clamp reserved for the genuine freak — so that's
    // what's asserted now. See VALUATION_ELITE_* / VALUATION_OVR_COEFF.
    const prime = { born: 2026 - 26, contract: { salary: 1000, expiresSeason: 2027 } };
    const at76 = trueTransferValue(makePlayer({ ovr: 76, potential: 76, ...prime }), 2026);
    const at78 = trueTransferValue(makePlayer({ ovr: 78, potential: 78, ...prime }), 2026);
    const at80 = trueTransferValue(makePlayer({ ovr: 80, potential: 80, ...prime }), 2026);
    const at82 = trueTransferValue(makePlayer({ ovr: 82, potential: 82, ...prime }), 2026);
    const at85 = trueTransferValue(makePlayer({ ovr: 85, potential: 85, ...prime }), 2026);

    // Strictly increasing across the elite band — no flat, saturated top end.
    expect(at78).toBeGreaterThan(at76);
    expect(at80).toBeGreaterThan(at78);
    expect(at82).toBeGreaterThan(at80);
    expect(at85).toBeGreaterThan(at82);

    // ...and accelerating: each equal step up in ovr costs more than the last,
    // which is what keeps the genuine difference-makers expensive.
    expect(at80 - at78).toBeGreaterThan(at78 - at76);
    expect(at82 - at80).toBeGreaterThan(at80 - at78);

    // The clamp still holds, but is not reached by a merely elite player.
    expect(at85).toBeLessThan(MAX_TRANSFER_VALUE);
  });

  it("never exceeds the value ceiling, even for an extreme player", () => {
    const monster = makePlayer({
      ovr: 99, potential: 99, born: 2026 - 19,
      contract: { salary: 1000, expiresSeason: 2046 },
    });
    expect(trueTransferValue(monster, 2026)).toBe(MAX_TRANSFER_VALUE);
  });
});

describe("perceivedTransferValue", () => {
  it("is closer on average to true value with max scouting spend than with none", () => {
    const player = makePlayer({ ovr: 75 });
    const trueValue = trueTransferValue(player, 2026);
    const rng = mulberry32(1);

    const n = 200;
    let errNoScouting = 0;
    let errMaxScouting = 0;
    for (let i = 0; i < n; i++) {
      errNoScouting += Math.abs(perceivedTransferValue(rng, player, 2026, 0) - trueValue);
      errMaxScouting += Math.abs(perceivedTransferValue(rng, player, 2026, SCOUTING_SPEND_MAX) - trueValue);
    }
    expect(errMaxScouting / n).toBeLessThan(errNoScouting / n);
  });

  it("never goes negative", () => {
    const player = makePlayer({ ovr: 41 });
    const rng = mulberry32(2);
    for (let i = 0; i < 50; i++) {
      expect(perceivedTransferValue(rng, player, 2026, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});
