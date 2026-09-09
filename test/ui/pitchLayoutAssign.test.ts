import { describe, it, expect } from "vitest";
import { FORMATIONS, FORMATION_IDS } from "../../src/core/lineup/formations.js";
import { assignLayoutIndices, layoutSlots } from "../../src/ui/pitchLayout.js";

/**
 * Putting a reconstructed eleven on the pitch.
 *
 * The Roster page's XI arrives already index-aligned with its formation. A
 * match lineup does not — it comes out of a box score sorted back to front for
 * reading — so this is what stops eleven chips landing on top of each other,
 * which is the one way a pitch fails silently rather than loudly.
 */
describe("assignLayoutIndices", () => {
  it("gives every player of a correctly-shaped eleven a coordinate of his own", () => {
    for (const id of FORMATION_IDS) {
      const slots = FORMATIONS[id];
      // Reading order, which is how live/lineups.ts hands them over.
      const sorted = [...slots].sort();
      const out = assignLayoutIndices(slots, sorted);
      expect(new Set(out).size, id).toBe(11);
      expect(out.every((i) => i >= 0 && i < 11), id).toBe(true);
    }
  });

  it("puts each player at a coordinate meant for his own position", () => {
    for (const id of FORMATION_IDS) {
      const slots = FORMATIONS[id];
      const sorted = [...slots].sort();
      const out = assignLayoutIndices(slots, sorted);
      sorted.forEach((slot, i) => {
        expect(slots[out[i]], `${id} ${slot}`).toBe(slot);
      });
    }
  });

  it("still places a player whose slot the shape doesn't contain", () => {
    // Reachable when the shape could not be named and 4-3-3's coordinates are
    // borrowed: nothing guarantees the slots line up, and a -1 would stack
    // chips at the origin.
    const out = assignLayoutIndices(FORMATIONS["4-3-3"], ["GK", "AM", "AM", "CB"]);
    expect(out.every((i) => i >= 0)).toBe(true);
    expect(new Set(out).size).toBe(4);
  });

  it("places a player with no recorded slot rather than dropping him", () => {
    const out = assignLayoutIndices(FORMATIONS["4-3-3"], ["GK", null, "CB"]);
    expect(out.every((i) => i >= 0)).toBe(true);
    expect(new Set(out).size).toBe(3);
  });

  it("survives a short lineup, which a red card leaves behind", () => {
    const out = assignLayoutIndices(FORMATIONS["4-4-2"], ["GK", "CB", "ST"]);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it("indexes coordinates every shipped formation actually has", () => {
    for (const id of FORMATION_IDS) {
      expect(layoutSlots(id), id).toHaveLength(FORMATIONS[id].length);
    }
  });
});
