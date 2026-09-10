import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { buildPowerSnapshot, confederationOf } from "../../src/core/international/index.js";
import type { IntlPowerSnapshot } from "../../src/core/international/index.js";
import {
  powerRows, confederationsPresent,
} from "../../src/ui/pages/nationalTeams/PowerRankings.js";

/**
 * The National Teams power rankings, narrowed to one confederation.
 *
 * Tested through the exported derivation rather than a render, because the
 * filter is component state and there is no DOM test env here — a static
 * render can only ever reach the unfiltered default. Same arrangement as the
 * News Feed's `capSeason`.
 */

/** A snapshot in the shape `buildPowerSnapshot` produces: world order, strongest first. */
function snap(season: number, ranks: [string, number][]): IntlPowerSnapshot {
  return { season, ranks: ranks.map(([nation, rating]) => ({ nation, rating })) };
}

describe("power rankings by confederation", () => {
  it("numbers the confederation from 1 and keeps the world place beside it", () => {
    const s = snap(4, [
      ["Spain", 80], ["Brazil", 78], ["France", 77], ["Argentina", 70], ["England", 69],
    ]);
    const rows = powerRows(s, null, "South America");

    expect(rows.map((r) => r.nation)).toEqual(["Brazil", "Argentina"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows.map((r) => r.worldRank)).toEqual([2, 4]);
  });

  it("measures movement inside the confederation, not against the world", () => {
    // Argentina holds 4th in the world both years, but Brazil has fallen below
    // it, so within South America it has gone from 2nd to 1st. A world-rank
    // reading would print "-" beside a rank that visibly moved.
    const before = snap(4, [["Spain", 80], ["Brazil", 78], ["France", 77], ["Argentina", 70]]);
    const after = snap(8, [["Spain", 80], ["Argentina", 78], ["France", 77], ["Brazil", 70]]);

    const world = powerRows(after, before, null);
    expect(world.find((r) => r.nation === "Brazil")).toMatchObject({ rank: 4, delta: -2 });
    expect(world.find((r) => r.nation === "Argentina")).toMatchObject({ rank: 2, delta: 2 });

    const conmebol = powerRows(after, before, "South America");
    expect(conmebol.map((r) => r.nation)).toEqual(["Argentina", "Brazil"]);
    expect(conmebol[0]).toMatchObject({ rank: 1, worldRank: 2, delta: 1 });
    expect(conmebol[1]).toMatchObject({ rank: 2, worldRank: 4, delta: -1 });
  });

  it("leaves the unfiltered view exactly as it was", () => {
    const before = snap(4, [["Spain", 80], ["Brazil", 78], ["France", 77]]);
    const after = snap(8, [["Brazil", 81], ["Spain", 80], ["France", 77]]);
    const rows = powerRows(after, before, null);

    // Rank is the world rank, so the two columns are the same number.
    expect(rows.map((r) => r.rank)).toEqual(rows.map((r) => r.worldRank));
    expect(rows.map((r) => [r.nation, r.delta])).toEqual([
      ["Brazil", 1], ["Spain", -1], ["France", 0],
    ]);
    expect(rows.every((r) => !r.isNew)).toBe(true);
  });

  it("reports a nation absent from the previous snapshot as new, in either view", () => {
    const before = snap(4, [["Spain", 80], ["Brazil", 78]]);
    const after = snap(8, [["Spain", 80], ["Brazil", 78], ["Argentina", 60]]);

    for (const view of [null, "South America"]) {
      const argentina = powerRows(after, before, view)!.find((r) => r.nation === "Argentina");
      expect(argentina).toMatchObject({ isNew: true, delta: 0 });
    }
  });

  it("offers only the confederations the snapshot actually fields, in table order", () => {
    const s = snap(4, [["Brazil", 78], ["Spain", 77], ["Nigeria", 60], ["France", 59]]);
    expect(confederationsPresent(s)).toEqual(["Europe", "South America", "Africa"]);
  });

  it("finds real nations to filter on a generated world", () => {
    const league = makeLeague(0, 1);
    const s = buildPowerSnapshot(league.players, league.season);
    const present = confederationsPresent(s);

    // Non-vacuity: every rung of this feature rests on the filter matching
    // somebody. Europe is where the leagues are, so it must be there.
    expect(present).toContain("Europe");
    const europe = powerRows(s, null, "Europe");
    expect(europe.length).toBeGreaterThan(10);
    expect(europe.every((r) => confederationOf(r.nation) === "Europe")).toBe(true);
    expect(europe.map((r) => r.rank)).toEqual(europe.map((_, i) => i + 1));

    // Every offered confederation yields rows; every row is offered.
    for (const c of present) expect(powerRows(s, null, c).length).toBeGreaterThan(0);
    const offered = new Set(present);
    expect(s.ranks.every((r) => offered.has(confederationOf(r.nation)!))).toBe(true);
  });
});
