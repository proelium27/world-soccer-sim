import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { initInternationalCampaign } from "../../src/core/international/index.js";
import { emptyNationalManagerState } from "../../src/core/nationalManager/index.js";

/**
 * Render harness for the two national-team management pages.
 *
 * These pages have states a pure-function test can't reach: no country at all,
 * a country with nothing to pick for, a live campaign with a squad and a pitch,
 * a dismissal, and an offer list. Each is a distinct render path and a throw in
 * any of them blanks the page.
 *
 * Server rendering does NOT run error boundaries — React re-throws to the
 * caller — so a throw here surfaces as a test failure regardless of the
 * boundaries App/Layout install around the router. Same harness pattern as
 * `transfersRender.test.tsx`; see the note there.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    setNationalSquadAction: () => {},
    setNationalLineupAction: () => {},
    setNationalFormationAction: () => {},
    autoPickNationalXIAction: () => {},
    takeNationalJobAction: () => {},
    leaveNationalJobAction: () => {},
    declineNationalOffersAction: () => {},
    setNationalSackingEnabledAction: () => {},
    simming: false,
  }),
}));

const { NTMySquad } = await import("../../src/ui/pages/nationalTeams/MySquad.js");
const { NTFederation } = await import("../../src/ui/pages/nationalTeams/Federation.js");
const { NTPlayerPool } = await import("../../src/ui/pages/nationalTeams/PlayerPool.js");

function render(page: () => ReactElement, league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(page)),
  );
}

/** A league parked with this offseason's campaign drawn but unplayed. */
function staged(nation: string | null): LeagueStore {
  const league = makeLeague(0, 1);
  return {
    ...league,
    nationalManager: emptyNationalManagerState(nation, 1),
    international: initInternationalCampaign(
      league.international, league.players, league.season, league.lid,
    ),
  };
}

const someNation = (): string => {
  const league = makeLeague(0, 1);
  const drawn = initInternationalCampaign(
    league.international, league.players, league.season, league.lid,
  );
  return drawn.qualifying!.squads[0].nation;
};

describe("My Squad page", () => {
  it("explains itself when the user manages no country", () => {
    const html = render(NTMySquad, staged(null));
    expect(html).toContain("don&#x27;t manage a national team");
    expect(html).toContain("/national-teams/federation");
  });

  it("renders the pitch and both squad tables for a live campaign", () => {
    const nation = someNation();
    const html = render(NTMySquad, staged(nation));
    expect(html).toContain("pitch-field");
    // Eleven chips, each carrying the player's position the way the club
    // Roster page's chips do. Counted on the name, which appears exactly once
    // per chip — `pitch-chip-pos` would double-count a man out of position,
    // whose marker reads `pitch-chip-pos pitch-chip-pos--misfit`.
    expect(html.match(/pitch-chip-name/g)?.length).toBe(11);
    expect(html).toContain("pitch-chip-pos");
    expect(html).toContain("Starting XI");
    expect(html).toContain("Substitutes");
    expect(html).toContain("Best XI");
    expect(html).toContain("called up");
  });

  /**
   * The club half of PitchField must not follow it here: a national manager has
   * no contracts to extend, no transfer list and nobody to release. Those props
   * are optional and simply are not passed (see PitchFieldProps).
   */
  it("carries none of the club-only chip controls", () => {
    const nation = someNation();
    const html = render(NTMySquad, staged(nation));
    expect(html).not.toContain("pitch-chip-contract-flag");
    expect(html).not.toContain("pitch-chip-listed-flag");
    expect(html).not.toContain("Release");
  });

  /**
   * Naming the squad is a search across hundreds of players; picking the eleven
   * is a team sheet of 23. Together on one page the search drowned the team
   * sheet, so they are two pages and this one links across.
   */
  it("sends calling players up to its own page", () => {
    const nation = someNation();
    const html = render(NTMySquad, staged(nation));
    expect(html).toContain("/national-teams/player-pool");
    expect(html).not.toContain("Search eligible players");
  });

  /** The same Club column Player Pool carries, so the two can't disagree. */
  it("marks each club with the division it plays in", () => {
    const html = render(NTMySquad, staged(someNation()));
    expect(html).toMatch(/division-badge--d[12]/);
  });

  /**
   * Between campaigns the page is read-only rather than blank: arranging an
   * eleven that will never be fielded is worse than showing the last one.
   */
  it("shows the last squad read-only when nothing is pending", () => {
    const base = staged(someNation());
    const html = render(NTMySquad, {
      ...base,
      international: { ...base.international, stage: "done" },
    });
    expect(html).toContain("Nothing to pick for right now");
    expect(html).not.toContain("Best XI");
  });

  it("copes with a country that never named a squad", () => {
    const league = makeLeague(0, 1);
    const html = render(NTMySquad, {
      ...league,
      nationalManager: emptyNationalManagerState("Nowhere at all", 1),
    });
    expect(html).toContain("haven&#x27;t named a squad yet");
  });
});

describe("Player Pool page", () => {
  it("lists the squad and the eligible pool, capped and searchable", () => {
    const nation = someNation();
    const html = render(NTPlayerPool, staged(nation));
    expect(html).toContain("Your squad");
    expect(html).toContain("Everyone else eligible");
    expect(html).toContain("Search eligible players");
    expect(html).toContain("Call up");
    // The cap note names the sort rather than "the best", because the column
    // the pool is ranked on is now the reader's choice.
    expect(html).toContain("Showing the top");
  });

  /**
   * A national squad is drawn from the whole world, so unlike a club roster the
   * reader cannot otherwise tell a big-four regular from someone in another
   * country's second division. Same marker Power Rankings uses, out of the same
   * component, which is the point of it being a component.
   */
  it("marks each club with the division it plays in", () => {
    const html = render(NTPlayerPool, staged(someNation()));
    expect(html).toMatch(/division-badge--d[12]/);
  });

  it("points back at the team sheet", () => {
    const html = render(NTPlayerPool, staged(someNation()));
    expect(html).toContain("/national-teams/my-squad");
  });

  it("explains itself when the user manages no country", () => {
    const html = render(NTPlayerPool, staged(null));
    expect(html).toContain("don&#x27;t manage a national team");
  });

  /** No campaign drawn means no squad to name, so there is nothing to do here. */
  it("says so when there is no campaign to name a squad for", () => {
    const base = staged(someNation());
    const html = render(NTPlayerPool, {
      ...base,
      international: { ...base.international, stage: "done" },
    });
    expect(html).toContain("no campaign to name a squad for");
  });
});

describe("Federation page", () => {
  it("invites a manager with no country rather than showing an empty meter", () => {
    const html = render(NTFederation, staged(null));
    expect(html).toContain("You don&#x27;t manage a country");
    expect(html).toContain("Nobody&#x27;s been in touch");
  });

  it("shows the confidence bar and career table for a manager in a job", () => {
    const nation = someNation();
    const html = render(NTFederation, staged(nation));
    expect(html).toContain("progress-bar");
    expect(html).toContain("Career");
    expect(html).toContain("World Cups");
    expect(html).toContain("Step down");
  });

  it("renders an offer list", () => {
    const base = staged(null);
    const html = render(NTFederation, {
      ...base,
      nationalManager: {
        ...base.nationalManager,
        offers: [{ nation: "Brazil", confederation: "South America", rank: 1, nations: 44, prestige: 1 }],
      },
    });
    expect(html).toContain("Brazil");
    expect(html).toContain("Take the job");
    expect(html).toContain("Turn them all down");
  });

  it("leads with the dismissal when a federation has just let you go", () => {
    const base = staged(null);
    const html = render(NTFederation, {
      ...base,
      nationalManager: { ...base.nationalManager, sacked: true },
    });
    expect(html).toContain("alert-danger");
    expect(html).toContain("back to club football only");
  });

  /**
   * The verdict panel has its own branch per campaign kind, and a qualifying
   * verdict reads "Qualified"/"Missed out" where a tournament reads a placement.
   */
  it("explains the last campaign's verdict", () => {
    const base = staged("Brazil");
    const html = render(NTFederation, {
      ...base,
      nationalManager: {
        ...base.nationalManager,
        lastVerdict: {
          kind: "qualifying",
          competition: "World Cup qualifying",
          placement: 38,
          expectedRank: 3,
          nations: 44,
          overperformance: -0.8,
          titles: 0,
          continentalTitles: 0,
          qualified: false,
          demand: 0.9,
          delta: -40,
          confidence: 20,
          sacked: false,
          season: 3,
          nation: "Brazil",
          previousConfidence: 60,
        },
      },
    });
    expect(html).toContain("World Cup qualifying");
    expect(html).toContain("Missed out");
    expect(html).toContain("60");
    expect(html).toContain("they noticed");
  });
});
