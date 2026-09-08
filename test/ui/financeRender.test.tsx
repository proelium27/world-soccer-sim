import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { advanceDomesticCup, pendingRound } from "../../src/core/domesticCup/cup.js";
import type { CupTie } from "../../src/core/cup/types.js";
import { budgetCap, financeScaleFor } from "../../src/core/finance/budget.js";
import { overdraftLimit } from "../../src/core/finance/debt.js";
import { currency } from "../../src/ui/format.js";
import {
  DEBT_EMBARGO_THRESHOLD, DEBT_DEDUCTION_THRESHOLD, DEBT_DEDUCTION_POINTS,
} from "../../src/core/constants.js";

/**
 * Render harness for the Finance page. No DOM test env here, so server
 * rendering is the cheapest thing that catches a page-level throw — and it does
 * NOT run error boundaries, so a crash fails the test rather than quietly
 * rendering a fallback.
 *
 * What's worth pinning is the page's honesty rather than its layout: the money
 * year has to name every moment money moves, the cup card has to distinguish
 * "nothing yet" from an empty table, and — the one that is a real bug if it
 * regresses — the projection must run through the same clamp the offseason
 * does, so a club near its savings ceiling is never promised money that will be
 * destroyed on arrival.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    setScoutingSpendAction: async () => {},
    simming: false,
  }),
}));

const { Finance } = await import("../../src/ui/pages/Finance.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(Finance)),
  );
}

/** Let the home side through every round, so the user's club banks real money. */
function playUserCupRounds(league: LeagueStore, rounds: number): LeagueStore {
  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid)!;
  const country = league.competitions.find((c) => c.id === userTeam.compId)!.country;
  const cups = league.domesticCups.map((cup) => {
    if (cup.country !== country) return cup;
    let c = cup;
    for (let i = 0; i < rounds; i++) {
      const round = pendingRound(c);
      if (!round) break;
      const ties: CupTie[] = round.pairings.map((p) => ({
        round: round.round, matchday: round.matchday, home: p.home, away: p.away,
        homeGoals: 1, awayGoals: 0, wentToExtraTime: false, wentToPens: false,
        homePens: 0, awayPens: 0,
        // Send the user through wherever they appear, so the card has content.
        winner: p.away === league.meta.userTid ? p.away : p.home,
        boxScore: null,
      }));
      c = advanceDomesticCup(c, league.competitions, ties);
    }
    return c;
  });
  return { ...league, domesticCups: cups };
}

function withUserBudget(league: LeagueStore, budget: number): LeagueStore {
  return {
    ...league,
    teams: league.teams.map((t) => (t.tid === league.meta.userTid ? { ...t, budget } : t)),
  };
}


/**
 * One stage of a `fin-year` timeline, picked out by its heading. Sliced rather
 * than matched against the whole page because "You are here" is rendered by
 * every timeline on the page, so a bare `toContain` would pass on the wrong
 * one — the money year is always marking a stage of its own.
 */
function stageOf(html: string, when: string): string {
  const chunk = html.split('<li class="fin-stage').find((c) => c.includes(when));
  expect(chunk, `no stage headed ${when}`).toBeDefined();
  return chunk!;
}

/** The user's club's overdraft limit, as the page derives it. */
function limitOf(league: LeagueStore): number {
  const team = league.teams.find((t) => t.tid === league.meta.userTid)!;
  return overdraftLimit(financeScaleFor(
    league.competitions, team.compId, team.tid, league.meta.userTid, league.difficulty,
  ));
}

describe("Finance page", () => {
  it("lays the year out as the four moments money actually moves", () => {
    const html = render(makeLeague(0, 1));
    expect(html).toContain("Your money year");
    expect(html).toContain("During the season");
    expect(html).toContain("At season end");
    expect(html).toContain("In the offseason");
    expect(html).toContain("When next season starts");
  });

  it("marks which stage the save is sitting in", () => {
    // A fresh league is mid-season, so the in-season stage is the live one.
    const html = render(makeLeague(0, 1));
    expect(html).toContain("You are here");
    expect(html).toContain("fin-stage--now");
  });

  it("says nothing has been earned in the cups before a tie is played", () => {
    const html = render(makeLeague(0, 1));
    expect(html).toContain("No ties played yet");
  });

  it("lists what the club banked once its cup ties are played", () => {
    const league = playUserCupRounds(makeLeague(0, 1), 3);
    const html = render(league);
    expect(html).not.toContain("No ties played yet");
    expect(html).toContain("Cup prize money banked");
    // The league-prize projection is a separate stage and must survive.
    expect(html).toContain("League prize money");
  });

  /**
   * Before a ball is kicked every club in the division is level on nothing, so
   * `computeStandings` hands back array order and "1st" is not a position. The
   * page has to say what it's actually assuming instead of quoting a rank.
   */
  it("does not quote a league position before any league game is played", () => {
    const html = render(makeLeague(0, 1));
    expect(html).toContain("standing start");
    expect(html).not.toMatch(/League prize money \(\d/);
  });

  it("shows the savings ceiling, which is otherwise invisible", () => {
    const html = render(makeLeague(0, 1));
    expect(html).toContain("ceiling");
  });

  /**
   * The regression that matters. `clampBudget` destroys anything a club would
   * bank above its ceiling, so a projection that just adds the rows up promises
   * money the offseason will delete. Pinned by putting the club ON its ceiling:
   * every projected figure from there has to stay at the cap.
   */
  it("never projects a balance above the savings ceiling", () => {
    const base = makeLeague(0, 1);
    const userTeam = base.teams.find((t) => t.tid === base.meta.userTid)!;
    const cap = budgetCap(
      financeScaleFor(
        base.competitions, userTeam.compId, userTeam.tid, base.meta.userTid, base.difficulty,
      ),
      userTeam.hype,
    );
    const html = render(withUserBudget(base, cap));

    // Sitting on the cap, the club cannot bank another dollar, so the page has
    // to say so rather than quoting income it will never receive.
    expect(html).toContain("won&#x27;t reach you");

    // And the projected figure itself must be capped. Read it back out of the
    // strip rather than recomputing it, so this fails on a wrong NUMBER and not
    // merely on missing copy — which is exactly how the old `budget + net`
    // projection went wrong.
    const tile = /Next season starts with<\/div><div class="fin-stat-value[^"]*">([^<]+)</.exec(html);
    expect(tile).not.toBeNull();
    const projected = Number(tile![1].replace(/[$,]/g, ""));
    expect(Number.isFinite(projected)).toBe(true);
    expect(projected).toBeLessThanOrEqual(Math.round(cap));
  });

  /**
   * The debt rules are stated whether or not the club is in trouble. The
   * alerts above only fire once a penalty is coming, and a rule the player can
   * only read after it has bitten him is one he could never have planned
   * around — which is the whole reason this section exists.
   */
  it("explains the debt rules to a club that is nowhere near them", () => {
    const base = makeLeague(0, 1);
    const html = render(withUserBudget(base, 50_000_000));
    const limit = limitOf(base);

    expect(html).toContain("Borrowing and debt");
    expect(html).toContain("Into the overdraft");
    expect(html).toContain("Transfer embargo");
    expect(html).toContain("Points deduction");

    // The thresholds as money, not as percentages — the point of putting them
    // on this page rather than in the Manual. Rendered with the typographic
    // minus, so this also pins that a balance and a movement can't come out
    // wearing two different dashes in the same column.
    expect(html).toContain(`\u2212${currency.format(limit)}`);
    expect(html).toContain(`\u2212${currency.format(limit * DEBT_EMBARGO_THRESHOLD)}`);
    expect(html).toContain(`\u2212${currency.format(limit * DEBT_DEDUCTION_THRESHOLD)}`);

    // Nothing is in force, so no rung claims to be where the club is.
    expect(stageOf(html, "Into the overdraft")).not.toContain("You are here");
    expect(stageOf(html, "Points deduction")).not.toContain("You are here");
  });

  it("quotes the deduction from the constants rather than a hardcoded 6", () => {
    const html = render(makeLeague(0, 1));
    expect(stageOf(html, "Points deduction"))
      .toContain(`minus ${DEBT_DEDUCTION_POINTS}`);
  });

  /**
   * The rung marker has to follow the balance, or the ladder is decoration.
   * Each case puts the club at a depth the sanction rules read differently and
   * checks the marker lands on that rung and no other.
   */
  it("marks the rung today's balance sits on", () => {
    const base = makeLeague(0, 1);
    const limit = limitOf(base);

    const shallow = render(withUserBudget(base, -limit * 0.1));
    expect(stageOf(shallow, "Into the overdraft")).toContain("You are here");
    expect(stageOf(shallow, "Transfer embargo")).not.toContain("You are here");

    const embargoed = render(withUserBudget(base, -limit * 0.5));
    expect(stageOf(embargoed, "Transfer embargo")).toContain("You are here");
    expect(stageOf(embargoed, "Points deduction")).not.toContain("You are here");

    const docked = render(withUserBudget(base, -limit * 0.9));
    expect(stageOf(docked, "Points deduction")).toContain("You are here");
    expect(stageOf(docked, "Transfer embargo")).not.toContain("You are here");
  });

  it("does not warn about the ceiling when the club is nowhere near it", () => {
    const html = render(withUserBudget(makeLeague(0, 1), 0));
    expect(html).not.toContain("won&#x27;t reach you");
  });
});
