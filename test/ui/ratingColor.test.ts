import { describe, it, expect } from "vitest";
import {
  getRatingColor, LOW_VALUE, MID_VALUE, HIGH_VALUE,
} from "../../src/ui/utils/ratingColor.js";

/**
 * The anchors are read from the module rather than written out, because they
 * are positions on the OVR scale and move with OVR_SCALE_SHIFT. Spelling them
 * as numbers here meant this file had to be edited every time the scale moved,
 * and -- worse -- a stale number would have gone on passing while describing a
 * gradient the app no longer draws. What is actually being asserted is the
 * shape: the three colours land on the three anchors, it interpolates between
 * them, it clamps outside them, and it never goes backwards.
 */
describe("getRatingColor", () => {
  it("hits the exact anchor colors at the low, mid and high anchors", () => {
    expect(getRatingColor(LOW_VALUE)).toBe("rgb(220, 53, 69)"); // #dc3545
    expect(getRatingColor(MID_VALUE)).toBe("rgb(108, 117, 125)"); // #6c757d
    expect(getRatingColor(HIGH_VALUE)).toBe("rgb(25, 135, 84)"); // #198754
  });

  it("interpolates halfway between anchors", () => {
    const mix = (from: number[], to: number[]) =>
      `rgb(${from.map((c, i) => Math.round(c + (to[i] - c) / 2)).join(", ")})`;
    const RED = [220, 53, 69];
    const GRAY = [108, 117, 125];
    const GREEN = [25, 135, 84];
    expect(getRatingColor((LOW_VALUE + MID_VALUE) / 2)).toBe(mix(RED, GRAY));
    expect(getRatingColor((MID_VALUE + HIGH_VALUE) / 2)).toBe(mix(GRAY, GREEN));
  });

  it("clamps values outside the band to the end colors", () => {
    expect(getRatingColor(0)).toBe(getRatingColor(LOW_VALUE));
    expect(getRatingColor(LOW_VALUE - 1)).toBe(getRatingColor(LOW_VALUE));
    expect(getRatingColor(HIGH_VALUE + 1)).toBe(getRatingColor(HIGH_VALUE));
    expect(getRatingColor(100)).toBe(getRatingColor(HIGH_VALUE));
  });

  it("gets monotonically greener (and less red) as the rating climbs", () => {
    const red = (c: string): number => Number(c.match(/rgb\((\d+),/)![1]);
    let prev = red(getRatingColor(LOW_VALUE));
    for (let v = LOW_VALUE + 5; v <= HIGH_VALUE; v += 5) {
      const cur = red(getRatingColor(v));
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it("keeps the neutral midpoint on an average top-flight starter", () => {
    // The point of the gradient: an ordinary first-teamer reads neutral, not
    // green. This is the assertion that would have caught the anchors being
    // left behind when the scale moved.
    expect(MID_VALUE).toBeGreaterThan(70);
    expect(MID_VALUE).toBeLessThan(82);
  });
});
