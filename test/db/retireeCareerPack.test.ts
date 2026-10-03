import { describe, it, expect } from "vitest";
import {
  packRetireeCareer, unpackRetireeCareer, isPackedRetireeCareer,
} from "../../src/db/retireeCareerPack.js";
import { emptySeasonStats } from "../../src/core/players/types.js";

describe("retiree stat line packing", () => {
  const season = (s: number, tid: number, goals: number) => ({
    ...emptySeasonStats(s, tid), appearances: 30, goals, xg: 11.734, ratingSum: 214.6, avgRating: 7.153,
  });

  it("round-trips exactly, a season split by a move included", () => {
    const moved = {
      ...season(4, 2, 9),
      stints: [
        { ...season(4, 1, 4), appearances: 12 },
        { ...season(4, 2, 5), appearances: 18 },
      ],
    };
    const career = {
      pid: 77,
      stats: [season(2, 1, 14), season(3, 1, 11), moved],
      intl: { caps: 9, goals: 2, assists: 1, tournaments: 1, titles: 0, seasons: [] },
    };
    const packed = packRetireeCareer(career);
    expect(packed.rows).toHaveLength(3);
    expect(Object.keys(packed.stints ?? {})).toEqual(["2"]);
    expect(unpackRetireeCareer(structuredClone(packed))).toEqual(career);
  });

  it("is much smaller than the objects it replaces", () => {
    const career = { pid: 1, stats: [2, 3, 4, 5, 6].map((s) => season(s, 1, 10)), intl: null };
    const packed = JSON.stringify(packRetireeCareer(career)).length;
    expect(packed).toBeLessThan(JSON.stringify(career).length * 0.6);
  });

  it("unpacks a row stored before a stat existed as that stat's empty default", () => {
    // `cols` travels with the row, so a field added to SeasonStats later reads
    // as zero on an old row rather than shifting every column after it.
    const old = { pid: 5, cols: ["season", "tid", "goals"], rows: [[7, 3, 21]], intl: null };
    const [line] = unpackRetireeCareer(old).stats;
    expect(line).toEqual({ ...emptySeasonStats(7, 3), goals: 21 });
  });

  it("only accepts well-formed rows from a file", () => {
    expect(isPackedRetireeCareer({ pid: 1, cols: ["season"], rows: [[1]], intl: null })).toBe(true);
    expect(isPackedRetireeCareer({ pid: "1", cols: [], rows: [] })).toBe(false);
    expect(isPackedRetireeCareer({ pid: 1, cols: [3], rows: [] })).toBe(false);
    expect(isPackedRetireeCareer(null)).toBe(false);
  });
});
