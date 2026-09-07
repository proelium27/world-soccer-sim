import { describe, it, expect } from "vitest";
import { getRatingColor } from "../../src/ui/utils/ratingColor.js";

describe("getRatingColor", () => {
  it("hits the exact anchor colors at 40 (red), 65 (gray), and 90 (green)", () => {
    expect(getRatingColor(40)).toBe("rgb(220, 53, 69)"); // #dc3545
    expect(getRatingColor(65)).toBe("rgb(108, 117, 125)"); // #6c757d
    expect(getRatingColor(90)).toBe("rgb(25, 135, 84)"); // #198754
  });

  it("interpolates halfway between anchors", () => {
    expect(getRatingColor(52.5)).toBe("rgb(164, 85, 97)"); // red -> gray midpoint
    expect(getRatingColor(77.5)).toBe("rgb(67, 126, 105)"); // gray -> green midpoint
  });

  it("clamps values outside the 40-90 band to the end colors", () => {
    expect(getRatingColor(0)).toBe(getRatingColor(40));
    expect(getRatingColor(39)).toBe(getRatingColor(40));
    expect(getRatingColor(91)).toBe(getRatingColor(90));
    expect(getRatingColor(100)).toBe(getRatingColor(90));
  });

  it("gets monotonically greener (and less red) as the rating climbs", () => {
    const red = (c: string): number => Number(c.match(/rgb\((\d+),/)![1]);
    let prev = red(getRatingColor(40));
    for (let v = 45; v <= 90; v += 5) {
      const cur = red(getRatingColor(v));
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });
});
