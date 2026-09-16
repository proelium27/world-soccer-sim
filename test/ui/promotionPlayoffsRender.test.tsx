import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { PromotionPlayoff } from "../../src/core/promotionPlayoff.js";
import type { CupTie } from "../../src/core/cup/types.js";

/**
 * Render harness for the Promotion Playoffs page.
 *
 * Deliberately built on hand-made playoff records rather than a simmed season:
 * the page is a pure read over `promotionPlayoffs`, so a sim would add ~20s to
 * buy nothing. A throw here surfaces as a test failure — server rendering does
 * not run error boundaries, so this sees raw throws.
 *
 * The three states that matter are the empty save (a dynasty that predates
 * playoffs, or one that has not finished a season), the live set sitting on the
 * league between the final whistle and the advance, and an archived set on a
 * season-history entry. The page has to read the last two out of two different
 * fields and show the same thing.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { PromotionPlayoffs } = await import("../../src/ui/pages/PromotionPlayoffs.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PromotionPlayoffs)),
  );
}

function tie(
  round: number,
  home: number,
  away: number,
  winner: number,
  extra: Partial<CupTie> = {},
): CupTie {
  return {
    round,
    matchday: 0,
    home,
    away,
    homeGoals: winner === home ? 2 : 1,
    awayGoals: winner === away ? 2 : 1,
    wentToExtraTime: false,
    wentToPens: false,
    homePens: 0,
    awayPens: 0,
    winner,
    boxScore: null,
    ...extra,
  };
}

/** A finished playoff among four real clubs of `league`'s first tier-2 division. */
function playoff(league: LeagueStore, season: number): PromotionPlayoff {
  const d2 = league.competitions.find((c) => c.tier === 2)!;
  const d1 = league.competitions.find((c) => c.country === d2.country && c.tier === 1)!;
  const teams = league.teams.filter((t) => t.compId === d2.id).slice(0, 4).map((t) => t.tid);
  return {
    season,
    country: d2.country,
    d1CompId: d1.id,
    d2CompId: d2.id,
    format: "english",
    teams,
    positions: [3, 4, 5, 6],
    tiers: [2, 2, 2, 2],
    autoPromoted: 2,
    autoRelegated: 3,
    ties: [
      // Both semis carry legs, and one goes to a shootout — the two branches
      // the tie renderer has beyond a plain scoreline.
      tie(0, teams[3], teams[0], teams[0], {
        legs: [{ homeGoals: 1, awayGoals: 0 }, { homeGoals: 0, awayGoals: 2 }],
      }),
      tie(0, teams[2], teams[1], teams[2], {
        legs: [{ homeGoals: 1, awayGoals: 1 }, { homeGoals: 1, awayGoals: 1 }],
        wentToExtraTime: true,
        wentToPens: true,
        homePens: 4,
        awayPens: 3,
      }),
      tie(1, teams[0], teams[2], teams[2]),
    ],
    winnerTid: teams[2],
  };
}

/** A finished German tie. `incumbentWins` decides which way it went. */
function germanPlayoff(league: LeagueStore, incumbentWins: boolean): PromotionPlayoff {
  const d2 = league.competitions.find((c) => c.tier === 2)!;
  const d1 = league.competitions.find((c) => c.country === d2.country && c.tier === 1)!;
  const topFlight = league.teams.find((t) => t.compId === d1.id)!.tid;
  const challenger = league.teams.find((t) => t.compId === d2.id)!.tid;
  const winner = incumbentWins ? topFlight : challenger;
  return {
    season: league.season,
    country: d2.country,
    d1CompId: d1.id,
    d2CompId: d2.id,
    format: "german",
    teams: [topFlight, challenger],
    positions: [16, 3],
    tiers: [1, 2],
    autoPromoted: 2,
    autoRelegated: 2,
    ties: [tie(1, challenger, topFlight, winner, {
      legs: [{ homeGoals: 1, awayGoals: 1 }, { homeGoals: 0, awayGoals: 1 }],
    })],
    winnerTid: winner,
  };
}

describe("Promotion Playoffs page", () => {
  it("renders the empty state for a save with nothing on file", () => {
    const league = makeLeague(0, 1);
    const html = render({ ...league, promotionPlayoffs: [] });
    expect(html).toContain("Promotion Playoffs");
    // The shaped panel, not the exact wording — see championsCupsRender for why.
    expect(html).toContain("empty-state");
    expect(html).toContain("No playoffs have been decided yet");
    // And it explains when they are played, rather than only that there are none.
    // They stopped being played in one go when staging shipped, so this tracks
    // the page's own wording rather than the old "the moment the season ends".
    expect(html).toContain("played a round at a time once the season ends");
  });

  it("renders the live set the season just decided, still on the league", () => {
    const league = makeLeague(0, 1);
    const p = playoff(league, league.season);
    const html = render({ ...league, promotionPlayoffs: [p] });
    expect(html).toContain("Promoted");
    expect(html).toContain("Semi-finals");
    expect(html).toContain("Final");
    // The legs and the shootout both reach the page.
    expect(html).toContain("1st leg");
    expect(html).toContain("on pens");
    // Every entrant is listed with the position he finished in.
    const winner = league.teams.find((t) => t.tid === p.winnerTid)!;
    expect(html).toContain(winner.name);
  });

  it("says the challenger went up when a German tie is won from below", () => {
    const league = makeLeague(0, 1);
    const html = render({ ...league, promotionPlayoffs: [germanPlayoff(league, false)] });
    expect(html).toContain("Promoted");
    expect(html).not.toContain("Stayed up");
    // One tie, so no semi-final column and no neutral-ground marker.
    expect(html).toContain("Playoff");
    expect(html).not.toContain("Semi-finals");
  });

  it("says the incumbent stayed up when a German tie is won from above", () => {
    // The result an English bracket cannot produce: the winner is a top-flight
    // club and nobody moves.
    const league = makeLeague(0, 1);
    const html = render({ ...league, promotionPlayoffs: [germanPlayoff(league, true)] });
    expect(html).toContain("Stayed up");
  });

  it("renders an archived set off a season-history entry", () => {
    const league = makeLeague(0, 1);
    const p = playoff(league, 3);
    const html = render({
      ...league,
      promotionPlayoffs: [],
      seasonHistory: [
        // Only the field this page reads has to be real; the rest of the entry
        // is never touched, so a cast keeps the fixture to the point.
        { season: 3, promotionPlayoffs: [p] } as LeagueStore["seasonHistory"][number],
      ],
    });
    expect(html).toContain("Semi-finals");
    expect(html).not.toContain("Nothing on file yet");
  });
});
