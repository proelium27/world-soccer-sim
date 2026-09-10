import { describe, expect, it } from "vitest";
import { HALF_TIME_MINUTE } from "../../src/ui/live/liveMatch.js";
import { SPEEDS, tickDelayMs, type PlaybackSpeed } from "../../src/ui/live/useMatchPlayback.js";

/**
 * There is no DOM test environment in this repo, so the playback clock itself
 * can't be driven. What can be pinned is its arithmetic, and that is where the
 * one silent failure lives: the speed DIVIDES the delay, so getting it the
 * wrong way round leaves every button working and every one of them wrong.
 */

describe("playback speed", () => {
  const ORDINARY = 40; // any minute that isn't the half-time beat

  it("holds a minute longer the lower the speed", () => {
    const delays = SPEEDS.map((s) => tickDelayMs(ORDINARY, s));
    // SPEEDS is offered slowest-first, so the delays must fall across it.
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeLessThan(delays[i - 1]);
    }
  });

  it("runs half speed at twice the length of 1x", () => {
    expect(tickDelayMs(ORDINARY, 0.5)).toBe(tickDelayMs(ORDINARY, 1) * 2);
  });

  it("offers half speed", () => {
    expect(SPEEDS).toContain(0.5);
  });

  it("keeps the half-time beat longer than a minute at every speed", () => {
    for (const s of SPEEDS) {
      expect(tickDelayMs(HALF_TIME_MINUTE, s)).toBeGreaterThan(tickDelayMs(ORDINARY, s));
    }
  });

  it("scales the half-time beat with the speed too", () => {
    // A break that stayed a fixed length would read as SHORTER than the minutes
    // around it once the match slowed down.
    const half: PlaybackSpeed = 0.5;
    expect(tickDelayMs(HALF_TIME_MINUTE, half)).toBe(tickDelayMs(HALF_TIME_MINUTE, 1) * 2);
  });
});
