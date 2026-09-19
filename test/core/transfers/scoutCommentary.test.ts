import { describe, it, expect } from "vitest";
import { scoutCommentary } from "../../../src/core/transfers/scoutCommentary.js";
import { trueTransferValue } from "../../../src/core/finance/valuation.js";
import { scoutingNoiseSd } from "../../../src/core/finance/scouting.js";
import { windowSeed } from "../../../src/core/transfers/negotiation.js";
import { gaussian, mulberry32 } from "../../../src/engine/rng.js";
import type { Player, PlayerRatings } from "../../../src/core/players/types.js";
import { SCOUTING_SPEND_MAX } from "../../../src/core/constants.js";

const RATINGS: PlayerRatings = {
  speed: 70, strength: 70, stamina: 70, jumping: 70,
  shortPass: 70, longPass: 70, crosses: 70, dribbling: 70, longShot: 70, finishing: 70,
  tackling: 70, interceptions: 70, positioning: 70, goalkeeping: 70,
};

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    pid: 1,
    name: "Test Player",
    nationality: "TST",
    born: 2000,
    pos: "CM",
    heightCm: 180,
    ratings: RATINGS,
    ovr: 75,
    potential: 78,
    contract: { salary: 1_000_000, expiresSeason: 2027 },
    injury: null,
    recentStats: [],
    recentHist: [],
    ...overrides,
  };
}

const LID = 1;
const SEASON = 2026;
const WINDOW = "summer" as const;

/** Reproduce the scout's noised read of the player's market value. */
function perceivedMarket(player: Player, spend: number): number {
  const marketValue = trueTransferValue(player, SEASON);
  const noiseSd = scoutingNoiseSd(spend);
  const rng = mulberry32(windowSeed(LID, SEASON, WINDOW, player.pid, 7));
  return Math.max(0, marketValue * (1 + gaussian(rng) * noiseSd));
}

describe("scoutCommentary", () => {
  it("varies the verdict with the offer size (regression: used to always say 'good')", () => {
    const player = makePlayer();
    const spend = SCOUTING_SPEND_MAX; // sharpest read
    const perceived = perceivedMarket(player, spend);

    const good = scoutCommentary(player, perceived * 1.5, spend, LID, SEASON, WINDOW);
    const counter = scoutCommentary(player, perceived * 0.8, spend, LID, SEASON, WINDOW);
    const bad = scoutCommentary(player, perceived * 0.4, spend, LID, SEASON, WINDOW);

    expect(good.tone).toBe("good");
    expect(counter.tone).toBe("counter");
    expect(bad.tone).toBe("bad");
  });

  it("suggests a counter near the perceived market value", () => {
    const player = makePlayer();
    const spend = SCOUTING_SPEND_MAX;
    const perceived = perceivedMarket(player, spend);

    const c = scoutCommentary(player, perceived * 0.8, spend, LID, SEASON, WINDOW);
    expect(c.tone).toBe("counter");
    if (c.tone === "counter") {
      expect(c.suggested).toBe(Math.round(perceived));
    }
  });

  it("is deterministic per player/window", () => {
    const player = makePlayer();
    const a = scoutCommentary(player, 5_000_000, 0, LID, SEASON, WINDOW);
    const b = scoutCommentary(player, 5_000_000, 0, LID, SEASON, WINDOW);
    expect(a).toEqual(b);
  });
});
