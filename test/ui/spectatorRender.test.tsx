import { describe, expect, it, vi } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";

/**
 * Render harness for the club-free surfaces.
 *
 * These pages exist precisely because a spectator save has no `userTeam`, so
 * the failure they have to be proof against is a lookup that assumes one — and
 * that fails as a throw, which no pure-function test would see. A throw here
 * surfaces as a test failure: server rendering does NOT run error boundaries
 * (React re-throws to the caller), so this sees raw throws regardless of the
 * boundaries App and Layout install around the router.
 *
 * Deliberately cheap. It renders an unplayed world rather than a simmed one:
 * every branch these pages have is about the *absence* of a club, and a season
 * of football would cost ~20s to reach the same code.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    simAction: () => {},
    simLiveAction: () => {},
    jumpSeasonsAction: () => {},
    intlStageAction: () => {},
    offseasonAction: async () => {},
    setScoutingSpendAction: () => {},
    simming: false,
  }),
}));

const { Dashboard } = await import("../../src/ui/pages/Dashboard.js");
const { ClubOnly } = await import("../../src/ui/components/ClubOnly.js");
const { Sidebar } = await import("../../src/ui/components/Sidebar.js");

function render(league: LeagueStore, element: React.ReactElement): string {
  leagueRef.current = league;
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function spectatorLeague(): LeagueStore {
  const base = makeLeague(SPECTATOR_TID, 1);
  return base;
}

describe("spectator: rendering without a club", () => {
  it("renders a dashboard rather than 'Team not found'", () => {
    const html = render(spectatorLeague(), createElement(Dashboard));
    expect(html).not.toContain("Team not found");
    expect(html).toContain("Spectating");
    // The controls that move time forward are the point of the page.
    expect(html).toContain("Sim One Matchday");
    expect(html).toContain("Sim to End of Season");
    // Jump ahead is a top-bar control, not a card on this page — see
    // topBarSimMenu.test.tsx.
    expect(html).not.toContain("Jump ahead");
  });

  it("does not offer the live viewer, which needs a club's match", () => {
    const html = render(spectatorLeague(), createElement(Dashboard));
    expect(html).not.toContain("Watch Next Game");
  });

  it("renders the managed dashboard unchanged for a save with a club", () => {
    const html = render(makeLeague(0, 1), createElement(Dashboard));
    expect(html).not.toContain("Team not found");
    // The club half is back, and the spectator badge is not.
    expect(html).toContain("Watch Next Game");
    expect(html).not.toContain(">Spectating<");
  });

  /**
   * The world panels read nothing user-specific, so both dashboards carry them.
   * On the managed one they are appended below everything about your own club,
   * which is why this asserts they coexist with the club half rather than
   * replacing any of it.
   */
  it("carries the world panels on both dashboards", () => {
    for (const league of [spectatorLeague(), makeLeague(0, 1)]) {
      const html = render(league, createElement(Dashboard));
      expect(html).toContain("Power rankings");
      expect(html).toContain("Continental Cup");
      expect(html).toContain("Continental Shield");
    }
  });

  it("explains itself on a club-only route instead of showing an error", () => {
    const html = render(
      spectatorLeague(),
      createElement(ClubOnly, null, createElement("div", null, "the roster")),
    );
    // Matched on a phrase with no apostrophe: renderToStaticMarkup escapes one
    // to &#x27;, so asserting on "You're spectating" passes vacuously in the
    // negative case below and fails in this one.
    expect(html).toContain("no squad to pick");
    expect(html).not.toContain("the roster");
  });

  it("passes a club-only route straight through for a manager", () => {
    const html = render(
      makeLeague(0, 1),
      createElement(ClubOnly, null, createElement("div", null, "the roster")),
    );
    expect(html).toContain("the roster");
    expect(html).not.toContain("no squad to pick");
  });

  it("drops the club navigation but keeps the world's", () => {
    const html = render(
      spectatorLeague(),
      createElement(Sidebar, { open: false, onNavigate: () => {} }),
    );
    for (const gone of ["/roster", "/transfers", "/finance", "/academy", "/loans",
      "/incoming-offers", "/free-agents", "/incoming-talent", "/manager",
      "/national-teams/my-squad", "/national-teams/federation"]) {
      expect(html).not.toContain(`href="${gone}"`);
    }
    for (const kept of ["/standings", "/cup", "/news", "/awards", "/frivolities",
      "/power-rankings", "/national-teams/world-cup", "/schedule"]) {
      expect(html).toContain(`href="${kept}"`);
    }
    // The watchlist survives: it is a note about players anywhere in the world,
    // not an instruction to a club.
    expect(html).toContain('href="/watchlist"');
  });

  it("keeps the full navigation for a manager", () => {
    const html = render(
      makeLeague(0, 1),
      createElement(Sidebar, { open: false, onNavigate: () => {} }),
    );
    for (const kept of ["/roster", "/transfers", "/finance", "/schedule", "/manager",
      "/watchlist", "/national-teams/my-squad"]) {
      expect(html).toContain(`href="${kept}"`);
    }
  });
});
