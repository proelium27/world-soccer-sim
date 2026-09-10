import { describe, expect, it } from "vitest";
import {
  nationForm, INTL_FORM_WINDOW, emptyInternationalState,
} from "../../src/core/international/index.js";
import type {
  InternationalState, IntlGroupTable, IntlTournamentSummary, IntlQualifyingSummary,
} from "../../src/core/international/index.js";
import { nationExpectations } from "../../src/core/nationalManager/expectation.js";
import { INTL_QUAL_LEGS } from "../../src/core/constants.js";

/**
 * The national Power column's form half.
 *
 * The property that matters most here is the one about what it does NOT touch:
 * `IntlPowerSnapshot.ranks` feeds `nationExpectations`, so a form-blended
 * ranking must stay a display concern or it moves the bar a federation judges
 * its manager against.
 */

function group(rows: [string, number, number, number, number, number][]): IntlGroupTable {
  return {
    confederation: null,
    rows: rows.map(([nation, played, won, drawn, lost, gd]) => ({
      nation,
      played,
      won,
      drawn,
      lost,
      gf: Math.max(gd, 0) + 5,
      ga: Math.max(-gd, 0) + 5,
      gd,
      points: won * 3 + drawn,
    })),
  };
}

function qualifying(season: number, groups: IntlGroupTable[]): IntlQualifyingSummary {
  return { season, entered: groups.length * 4, groups, qualified: [] };
}

function tournament(season: number, over: Partial<IntlTournamentSummary> = {}): IntlTournamentSummary {
  return {
    season,
    name: "World Cup",
    champion: "Spain",
    runnerUp: "Brazil",
    finalScore: { champion: 2, runnerUp: 1, pens: null },
    topScorer: null,
    field: ["Spain", "Brazil"],
    groups: [],
    knockout: [],
    ...over,
  };
}

function stateWith(over: Partial<InternationalState>): InternationalState {
  return { ...emptyInternationalState(), ...over };
}

const evenRatings = (nations: string[]) => new Map(nations.map((n) => [n, 70]));

describe("national team form", () => {
  it("reads a nation's record straight out of the archived group table", () => {
    const intl = stateWith({
      qualifyingHistory: [qualifying(1, [group([
        ["Spain", 6, 5, 1, 0, 12],
        ["Brazil", 6, 3, 1, 2, 2],
        ["Wales", 6, 1, 2, 3, -4],
        ["Peru", 6, 0, 2, 4, -10],
      ])])],
    });
    const forms = nationForm(intl, 1 + INTL_QUAL_LEGS - 1, evenRatings(["Spain", "Brazil", "Wales", "Peru"]));

    expect(forms.get("Spain")).toMatchObject({ played: 6, won: 5, drawn: 1, lost: 0, gd: 12 });
    expect(forms.get("Peru")).toMatchObject({ played: 6, won: 0, drawn: 2, lost: 4, gd: -10 });
  });

  it("rewards beating nations you were expected to lose to", () => {
    // The same 5-1-0 record, once against far stronger opposition and once
    // against far weaker. Overperforming has to be worth more.
    const rows: [string, number, number, number, number, number][] = [
      ["Wales", 6, 5, 1, 0, 12],
      ["A", 6, 1, 1, 4, -4],
      ["B", 6, 1, 1, 4, -4],
      ["C", 6, 1, 1, 4, -4],
    ];
    const intl = stateWith({ qualifyingHistory: [qualifying(1, [group(rows)])] });
    const season = 1 + INTL_QUAL_LEGS - 1;

    const vsStrong = nationForm(intl, season, new Map([["Wales", 60], ["A", 85], ["B", 85], ["C", 85]]));
    const vsWeak = nationForm(intl, season, new Map([["Wales", 85], ["A", 60], ["B", 60], ["C", 60]]));

    expect(vsStrong.get("Wales")!.performanceBonus)
      .toBeGreaterThan(vsWeak.get("Wales")!.performanceBonus);
    // Beating everyone when nobody expected it is a genuine bonus, not merely a
    // bigger one than the alternative.
    expect(vsStrong.get("Wales")!.performanceBonus).toBeGreaterThan(0);
  });

  it("scores a knockout tie won on penalties as the draw it was", () => {
    const intl = stateWith({
      history: [tournament(4, {
        knockout: [{
          round: 2, home: "Spain", away: "Brazil",
          homeGoals: 1, awayGoals: 1,
          winner: "Spain", pens: { home: 4, away: 3 }, extraTime: true,
        }],
      })],
    });
    const forms = nationForm(intl, 4, evenRatings(["Spain", "Brazil"]));

    for (const nation of ["Spain", "Brazil"]) {
      expect(forms.get(nation)).toMatchObject({ played: 1, won: 0, drawn: 1, lost: 0 });
    }
  });

  it("drops campaigns that fall out of the window and keeps a tournament for a full cycle", () => {
    const intl = stateWith({ history: [tournament(4)], confederationCupHistory: [] });
    const withGroups = stateWith({
      history: [tournament(4, {
        groups: [group([["Spain", 3, 3, 0, 0, 6], ["Brazil", 3, 0, 0, 3, -6]])],
      })],
    });
    const ratings = evenRatings(["Spain", "Brazil"]);

    // Still counted at the end of the window...
    expect(nationForm(withGroups, 4 + INTL_FORM_WINDOW - 1, ratings).get("Spain")?.played).toBe(3);
    // ...and gone the season after it.
    expect(nationForm(withGroups, 4 + INTL_FORM_WINDOW, ratings).has("Spain")).toBe(false);
    // A tournament that has not happened yet is never counted.
    expect(nationForm(intl, 3, ratings).size).toBe(0);
  });

  it("gives a nation with no games a zero bonus rather than a penalty", () => {
    const forms = nationForm(stateWith({}), 8, evenRatings(["Spain"]));
    expect(forms.has("Spain")).toBe(false);
  });

  it("leaves the stored snapshot, and so the federation's expectations, untouched", () => {
    // The load-bearing property. nationExpectations reads the snapshot's own
    // ordering; deriving Power must not disturb it.
    const snapshot = {
      season: 4,
      ranks: [
        { nation: "Spain", rating: 80 },
        { nation: "Brazil", rating: 79 },
        { nation: "Wales", rating: 50 },
      ],
    };
    const before = JSON.stringify(snapshot);
    const expectedBefore = nationExpectations(snapshot);

    const intl = stateWith({
      powerRankings: [snapshot],
      history: [tournament(4, {
        groups: [group([["Wales", 3, 3, 0, 0, 9], ["Spain", 3, 0, 0, 3, -9]])],
      })],
    });
    const forms = nationForm(intl, 4, new Map(snapshot.ranks.map((r) => [r.nation, r.rating])));

    // Wales really did overperform, so Power would reorder the table...
    expect(forms.get("Wales")!.performanceBonus).toBeGreaterThan(0);
    expect(forms.get("Spain")!.performanceBonus).toBeLessThan(0);
    // ...and the snapshot and the bar it sets are both unmoved.
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(nationExpectations(snapshot)).toEqual(expectedBefore);
  });
});
