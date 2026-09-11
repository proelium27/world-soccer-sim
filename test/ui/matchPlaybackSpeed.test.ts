import { describe, expect, it } from "vitest";
import { HALF_TIME_MINUTE } from "../../src/ui/live/liveMatch.js";
import {
  parseSpeed,
  readStoredSpeed,
  SPEED_STORAGE_KEY,
  SPEEDS,
  storeSpeed,
  tickDelayMs,
  type PlaybackSpeed,
} from "../../src/ui/live/useMatchPlayback.js";

/** A plain in-memory stand-in for `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("remembered playback speed", () => {
  it("opens at 1x when nothing has been picked yet", () => {
    expect(readStoredSpeed(memoryStorage())).toBe(1);
  });

  it("opens at whatever speed was picked last, every speed included", () => {
    for (const s of SPEEDS) {
      const storage = memoryStorage();
      storeSpeed(s, storage);
      expect(readStoredSpeed(storage)).toBe(s);
    }
  });

  it("falls back to 1x on a value that isn't a speed we offer", () => {
    for (const raw of ["3", "", "fast", "NaN", "0"]) {
      expect(readStoredSpeed(memoryStorage({ [SPEED_STORAGE_KEY]: raw }))).toBe(1);
    }
    expect(parseSpeed(null)).toBeNull();
  });

  it("survives storage that throws or isn't there", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredSpeed(broken)).toBe(1);
    expect(() => storeSpeed(2, broken)).not.toThrow();
    expect(readStoredSpeed(null)).toBe(1);
  });
});

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
