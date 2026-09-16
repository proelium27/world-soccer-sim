import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { cachedExpectations } from "../../src/core/manager/expectation.js";

/**
 * Render harness for the Manager page's "Jobs you'd like" card. Server
 * rendering re-throws, so a crash in the panel (a missing expectation, an
 * unranked country) fails here rather than blanking the page.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    acceptJobOfferAction: async () => {},
    declineJobOffersAction: async () => {},
    setSackingEnabledAction: async () => {},
    setClubInterestAction: async () => {},
    setNationInterestAction: async () => {},
    simming: false,
  }),
}));

const { Manager } = await import("../../src/ui/pages/Manager.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Manager)));
}

describe("Jobs you'd like panel", () => {
  const base = makeLeague(0, 11);
  const ranked = [...cachedExpectations(base).values()].sort((a, b) => b.prestige - a.prestige);
  const smallest = ranked[ranked.length - 1];
  const biggest = ranked.find((e) => e.tid !== base.meta.userTid)!;

  it("says countries can't be picked before federations have ranked anyone", () => {
    const html = render(base);
    expect(html).toContain("Jobs you&#x27;d like");
    expect(html).toContain("haven&#x27;t ranked anyone yet");
  });

  it("lists picked clubs and countries with how realistic each is", () => {
    const ranks = Array.from({ length: 10 }, (_, i) => ({ nation: `N${i}`, rating: 80 - i }));
    const league: LeagueStore = {
      ...base,
      manager: { ...base.manager, interests: [smallest.tid, biggest.tid] },
      nationalManager: { ...base.nationalManager, interests: ["N9", "Gone"] },
      international: {
        ...base.international,
        powerRankings: [{ season: 1, ranks } as LeagueStore["international"]["powerRankings"][number]],
      },
    };
    const html = render(league);
    const name = (tid: number) => league.teams.find((t) => t.tid === tid)!.name;
    expect(html).toContain(name(smallest.tid));
    expect(html).toContain(name(biggest.tid));
    expect(html).toContain("Within reach");
    expect(html).toContain("Not ranked right now");
    expect(html).toContain("N9");
  });
});
