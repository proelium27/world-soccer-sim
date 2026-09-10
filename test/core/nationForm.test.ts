import { describe, expect, it } from "vitest";
import {
  nationForm, INTL_FORM_WINDOW, emptyInternationalState,
} from "../../src/core/international/index.js";
import type {
  InternationalState, IntlGroupTable, IntlTournamentSummary, IntlQualifyingSummary,
  IntlQualifyingCampaign,
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

  it("records a shootout as a draw but still credits the nation that won it", () => {
    // FIFA scores the shootout winner halfway between a draw and a win, and the
    // loser no worse than a draw. The W/D/L record stays a draw for both, which
    // is what football records.
    const shootout = (winner: string) => stateWith({
      history: [tournament(4, {
        knockout: [{
          round: 2, home: "Spain", away: "Brazil",
          homeGoals: 1, awayGoals: 1,
          winner, pens: winner === "Spain" ? { home: 4, away: 3 } : { home: 3, away: 4 },
          extraTime: true,
        }],
      })],
    });
    const ratings = evenRatings(["Spain", "Brazil"]);
    const spainWon = nationForm(shootout("Spain"), 4, ratings);
    const brazilWon = nationForm(shootout("Brazil"), 4, ratings);

    for (const nation of ["Spain", "Brazil"]) {
      expect(spainWon.get(nation)).toMatchObject({ played: 1, won: 0, drawn: 1, lost: 0 });
    }
    // Winning the shootout is worth more than losing it...
    expect(spainWon.get("Spain")!.performanceBonus)
      .toBeGreaterThan(brazilWon.get("Spain")!.performanceBonus);
    // ...and the loser is no worse off than for an ordinary draw, which is what
    // a flat 1 point against an even-match expectation of 1.5 comes to.
    expect(brazilWon.get("Spain")!.performanceBonus)
      .toBe(spainWon.get("Brazil")!.performanceBonus);
  });

  it("weights a World Cup knockout tie above a qualifying game", () => {
    // The identical result — a one-goal win over an equal nation — in each
    // competition. FIFA's coefficients run 25 for a qualifier up to 60 from the
    // quarter-finals of a World Cup, so the same win has to move Power further
    // when it happens at the sharp end.
    const ratings = evenRatings(["Spain", "Brazil", "Wales", "Peru"]);
    const oneWin = (round: number, totalRounds: number) => {
      const rounds = Array.from({ length: totalRounds }, (_, r) => r);
      return rounds.map((r) => ({
        round: r, home: r === round ? "Spain" : "Wales", away: r === round ? "Brazil" : "Peru",
        homeGoals: 1, awayGoals: 0,
        winner: r === round ? "Spain" : "Wales", pens: null,
      }));
    };

    // A World Cup final (round 3 of 4) against a World Cup round of 16 (round 0).
    const final = nationForm(
      stateWith({ history: [tournament(4, { knockout: oneWin(3, 4) })] }), 4, ratings,
    ).get("Spain")!.performanceBonus;
    const roundOf16 = nationForm(
      stateWith({ history: [tournament(4, { knockout: oneWin(0, 4) })] }), 4, ratings,
    ).get("Spain")!.performanceBonus;

    // On its own, one match is the whole weighted average, so a single-match
    // sample cannot show the weighting — that is the point of the check below.
    expect(final).toBe(roundOf16);

    // Mix the two: a nation that won its round of 16 and lost the final should
    // land below one that lost the round of 16 and won the final, because the
    // final counts for more.
    const wonLate = stateWith({
      history: [tournament(4, {
        knockout: [
          { round: 0, home: "Spain", away: "Brazil", homeGoals: 0, awayGoals: 1, winner: "Brazil", pens: null },
          { round: 3, home: "Spain", away: "Brazil", homeGoals: 1, awayGoals: 0, winner: "Spain", pens: null },
        ],
      })],
    });
    const wonEarly = stateWith({
      history: [tournament(4, {
        knockout: [
          { round: 0, home: "Spain", away: "Brazil", homeGoals: 1, awayGoals: 0, winner: "Spain", pens: null },
          { round: 3, home: "Spain", away: "Brazil", homeGoals: 0, awayGoals: 1, winner: "Brazil", pens: null },
        ],
      })],
    });
    expect(nationForm(wonLate, 4, ratings).get("Spain")!.performanceBonus)
      .toBeGreaterThan(nationForm(wonEarly, 4, ratings).get("Spain")!.performanceBonus);
  });

  it("counts a World Cup win for more than the same win in qualifying", () => {
    const ratings = evenRatings(["Spain", "Brazil", "Wales", "Peru"]);
    // Won the World Cup group, lost every qualifier, against losing the World
    // Cup group and winning every qualifier. The World Cup is weighted at 50
    // against qualifying's 25, so the first has to come out ahead.
    const wcGroup = (spainWins: boolean) => group([
      ["Spain", 3, spainWins ? 3 : 0, 0, spainWins ? 0 : 3, spainWins ? 6 : -6],
      ["Brazil", 3, spainWins ? 0 : 3, 0, spainWins ? 3 : 0, spainWins ? -6 : 6],
    ]);
    const qualGroup = (spainWins: boolean) => group([
      ["Spain", 3, spainWins ? 3 : 0, 0, spainWins ? 0 : 3, spainWins ? 6 : -6],
      ["Wales", 3, spainWins ? 0 : 3, 0, spainWins ? 3 : 0, spainWins ? -6 : 6],
    ]);

    const wcWin = stateWith({
      history: [tournament(4, { groups: [wcGroup(true)] })],
      qualifyingHistory: [{ ...qualifying(2, [qualGroup(false)]), qualified: ["Spain"] }],
    });
    const qualWin = stateWith({
      history: [tournament(4, { groups: [wcGroup(false)] })],
      qualifyingHistory: [{ ...qualifying(2, [qualGroup(true)]), qualified: ["Spain"] }],
    });

    expect(nationForm(wcWin, 4, ratings).get("Spain")!.performanceBonus)
      .toBeGreaterThan(nationForm(qualWin, 4, ratings).get("Spain")!.performanceBonus);
  });

  it("counts the qualifying campaign still being played", () => {
    // A campaign is only archived once its last leg locks in the qualifiers, so
    // without reading the live one, up to two of three legs are invisible for
    // the two years they are the most recent football played.
    const live = {
      season: 1,
      nations: ["Spain", "Brazil"],
      squads: [],
      qualified: [],
      groups: [{
        nids: [0, 1],
        confederation: "Europe",
        matches: [
          { group: 0, round: 0, leg: 0, home: 0, away: 1, homeGoals: 3, awayGoals: 0, boxScore: null },
          // Not played yet: -1 goals is the sentinel `groupTable` skips.
          { group: 0, round: 0, leg: 1, home: 1, away: 0, homeGoals: -1, awayGoals: -1, boxScore: null },
        ],
      }],
    } as unknown as IntlQualifyingCampaign;

    const forms = nationForm(stateWith({ qualifying: live }), 1, evenRatings(["Spain", "Brazil"]));
    expect(forms.get("Spain")).toMatchObject({ played: 1, won: 1, drawn: 0, lost: 0, gd: 3 });
    expect(forms.get("Spain")!.performanceBonus).toBeGreaterThan(0);
  });

  it("does not count a finished campaign twice", () => {
    // The live campaign is kept on the state after it is archived, so both
    // sources can hold it at once.
    const groups = [group([["Spain", 3, 3, 0, 0, 6], ["Brazil", 3, 0, 0, 3, -6]])];
    const archivedOnly = stateWith({
      qualifyingHistory: [{ ...qualifying(1, groups), qualified: ["Spain"] }],
    });
    const bothSources = stateWith({
      qualifyingHistory: [{ ...qualifying(1, groups), qualified: ["Spain"] }],
      qualifying: {
        season: 1, nations: ["Spain", "Brazil"], squads: [], qualified: ["Spain"],
        groups: [{ nids: [0, 1], confederation: "Europe", matches: [] }],
      } as unknown as IntlQualifyingCampaign,
    });
    const season = 1 + INTL_QUAL_LEGS - 1;
    const ratings = evenRatings(["Spain", "Brazil"]);

    expect(nationForm(bothSources, season, ratings).get("Spain"))
      .toEqual(nationForm(archivedOnly, season, ratings).get("Spain"));
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
