import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { placePanel } from "../../src/ui/components/anchoredPanel.js";

/**
 * Where a hover panel lands, and the rule that keeps it visible at all.
 *
 * The bug: both hover panels were `position: absolute` inside their anchor, and
 * most of the tables carrying them sit in a `.table-responsive` — which is
 * `overflow-x: auto`, so CSS computes `overflow-y: auto` alongside it and the
 * box clips vertically. Measured on `/database/players`, hovering the last row
 * showed **5.8% of a 366px panel**. On the national My Squad page the clip
 * lands where the substitutes table starts, so it read as the bench table
 * covering the tooltip. No z-index escapes a clipping ancestor, which is why
 * the panel is portalled out and positioned against the viewport instead.
 */

const VIEWPORT = { width: 1200, height: 800 };
const PANEL = { width: 220, height: 366 };

describe("placePanel", () => {
  it("opens below the anchor when there is room", () => {
    const pos = placePanel({ top: 100, bottom: 116, left: 300 }, PANEL, VIEWPORT);
    expect(pos.top).toBeGreaterThan(116);
    expect(pos.left).toBe(300);
  });

  it("flips above when the panel would run off the bottom", () => {
    // The case the reader actually hits: the last row of a table, low on screen.
    const anchor = { top: 700, bottom: 716, left: 300 };
    const pos = placePanel(anchor, PANEL, VIEWPORT);
    expect(pos.top + PANEL.height).toBeLessThanOrEqual(anchor.top);
  });

  it("keeps the panel on screen whichever way it opens", () => {
    for (let top = 0; top < VIEWPORT.height; top += 25) {
      const pos = placePanel({ top, bottom: top + 16, left: 300 }, PANEL, VIEWPORT);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.top + PANEL.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it("pulls a panel near the right edge back inside, and never off the left", () => {
    const wide = placePanel({ top: 100, bottom: 116, left: 1150 }, PANEL, VIEWPORT);
    expect(wide.left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width);
    const narrow = placePanel({ top: 100, bottom: 116, left: 2 }, PANEL, { width: 320, height: 800 });
    expect(narrow.left).toBeGreaterThanOrEqual(0);
  });

  it("opens downward from the anchor when it is taller than the viewport", () => {
    // Nothing fits; anchoring the top to the anchor at least starts the panel
    // where the reader is looking, rather than pinning it to a far edge.
    const pos = placePanel({ top: 300, bottom: 316, left: 300 }, { width: 220, height: 900 }, VIEWPORT);
    expect(pos.top).toBeLessThanOrEqual(316 + 4);
  });
});

/**
 * The CSS half of the fix. Restoring `position: absolute` on either panel puts
 * it back inside the clipping ancestor, and nothing else would fail: the panel
 * renders perfectly, just cropped by a box several elements up.
 */
describe("neither hover panel is positioned inside its anchor", () => {
  const css = readFileSync("src/ui/styles.css", "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} missing from styles.css`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  for (const selector of [".player-ratings-tooltip-panel", ".help-hint-panel"]) {
    it(`${selector} leaves positioning to AnchoredPanel`, () => {
      expect(rule(selector)).not.toMatch(/position:\s*absolute/);
    });
  }
});
