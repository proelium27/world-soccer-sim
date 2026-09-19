import { describe, it, expect } from "vitest";
import { careerValueHistory, peakValue } from "../../../src/core/finance/valueHistory.js";
import { trueTransferValue } from "../../../src/core/finance/valuation.js";
import type { Player, PlayerRatings, RatingsSnapshot } from "../../../src/core/players/types.js";

const RATINGS: PlayerRatings = {
  speed: 50, strength: 50, stamina: 50, jumping: 50,
  shortPass: 50, longPass: 50, crosses: 50, dribbling: 50, longShot: 50, finishing: 50,
  tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 50,
};

function snap(season: number, ovr: number, potential = ovr, academy = false): RatingsSnapshot {
  return { season, ratings: RATINGS, ovr, potential, academy, pos: "ST" };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    pid: 1,
    name: "Test Player",
    nationality: "TST",
    born: 2000,
    pos: "CM",
    heightCm: 180,
    ratings: RATINGS,
    ovr: 70,
    potential: 75,
    contract: { salary: 1000, expiresSeason: 2029 },
    injury: null,
    recentStats: [],
    recentHist: [],
    ...overrides,
  };
}

describe("careerValueHistory", () => {
  it("plots each snapshot at the season it was in force, not the one it was stamped in", () => {
    // A RatingsSnapshot is written at the *end* of a season, so the one labelled
    // 2025 is what the player carried through 2026 — the same offset awards.ts
    // reads with hist.find(h => h.season === season - 1).
    const player = makePlayer({ recentHist: [snap(2025, 68), snap(2026, 70), snap(2027, 72)] });
    const points = careerValueHistory(player, player.recentHist, 2028);
    expect(points.map((p) => p.season)).toEqual([2026, 2027, 2028]);
    expect(points.map((p) => p.ovr)).toEqual([68, 70, 72]);
  });

  it("ends on the player's value today", () => {
    // The final snapshot is the one he currently carries, so the last plotted
    // point has to agree with what the market would quote for him right now.
    const player = makePlayer({ ovr: 72, potential: 75, recentHist: [snap(2025, 68, 75), snap(2026, 72, 75)] });
    const points = careerValueHistory(player, player.recentHist, 2027);
    const last = points[points.length - 1];
    expect(last.season).toBe(2027);
    expect(last.value).toBe(Math.round(trueTransferValue(player, 2027)));
  });

  it("holds the contract multiplier flat, so the curve reads on ability rather than a running-down deal", () => {
    // Two seasons at an identical rating and age-curve position must not drift
    // apart just because today's expiry is further from one than the other.
    const flat = makePlayer({
      born: 2000,
      contract: { salary: 1000, expiresSeason: 2032 },
      recentHist: [snap(2024, 70, 70), snap(2025, 70, 70), snap(2026, 70, 70)],
    });
    const points = careerValueHistory(flat, flat.recentHist, 2027);
    // Age still moves across those seasons (25 → 27), so values aren't equal;
    // what matters is that the ratio tracks the age curve alone. Re-deriving
    // each point with the same years-remaining reproduces it exactly.
    const yearsRemaining = 2032 - 2027;
    for (const p of points) {
      const asOf = { ...flat, ovr: p.ovr, potential: p.potential,
        contract: { salary: 1000, expiresSeason: p.season + yearsRemaining } };
      expect(p.value).toBe(Math.round(trueTransferValue(asOf, p.season)));
    }
  });

  it("prices off the perceived potential it is handed, so a fogged POT can't be read back", () => {
    const player = makePlayer({ born: 2006, ovr: 60, potential: 85, recentHist: [snap(2024, 58, 85), snap(2025, 60, 85)] });
    const exact = careerValueHistory(player, player.recentHist, 2026);
    const fogged = careerValueHistory(player, player.recentHist, 2026, () => 62);
    expect(fogged[1].potential).toBe(62);
    // A big unfulfilled gap is a real premium — hiding it has to move the price.
    expect(fogged[1].value).toBeLessThan(exact[1].value);
  });

  it("does not carry the academy flag forward with the ratings", () => {
    // The flag records where he was during the season the snapshot was stamped
    // in, while the ratings are what he carried into the *next* one. Shifting it
    // along with them would label a promoted youngster's first senior season as
    // an academy year, so it's left for the caller to resolve per played season.
    const player = makePlayer({ recentHist: [snap(2025, 55, 70, true), snap(2026, 62, 70, false)] });
    const points = careerValueHistory(player, player.recentHist, 2027);
    expect(points.every((p) => !("academy" in p))).toBe(true);
  });

  it("sorts an out-of-order history", () => {
    const player = makePlayer({ recentHist: [snap(2027, 72), snap(2025, 68), snap(2026, 70)] });
    expect(careerValueHistory(player, player.recentHist, 2028).map((p) => p.season)).toEqual([2026, 2027, 2028]);
  });

  it("returns nothing for a player with no history", () => {
    expect(careerValueHistory(makePlayer(), makePlayer().recentHist, 2027)).toEqual([]);
  });

  it("survives an expired contract without going negative on years remaining", () => {
    const player = makePlayer({
      contract: { salary: 1000, expiresSeason: 2020 },
      recentHist: [snap(2025, 68), snap(2026, 70)],
    });
    const points = careerValueHistory(player, player.recentHist, 2027);
    expect(points.every((p) => p.value >= 0)).toBe(true);
  });
});

describe("peakValue", () => {
  it("finds the career high", () => {
    const player = makePlayer({ born: 2000, recentHist: [snap(2024, 62), snap(2025, 78), snap(2026, 70)] });
    const points = careerValueHistory(player, player.recentHist, 2027);
    const best = peakValue(points)!;
    expect(best.ovr).toBe(78);
  });

  it("is null for an empty history", () => {
    expect(peakValue([])).toBeNull();
  });
});
