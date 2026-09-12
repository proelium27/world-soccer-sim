import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import {
  SCOUTING_REGION_MAX, SCOUT_POSITION_MAX, ACADEMY_GRADUATION_AGE,
} from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * Render harness for the Academy page, which took over the Youth Intake
 * screen's job (and its Scout directions panel).
 *
 * There is no DOM test env here, so this covers what the core tests can't: that
 * the page renders in each of its states without throwing, and that what it
 * says will happen at the rollover is on the page at all. Server rendering does
 * not run error boundaries (React re-throws to the caller), so a throw here is a
 * test failure rather than a fallback render.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  // Every action the page and its children might reach for is a no-op; reading
  // the league and `simming` is all a render needs.
  useLeague: () => new Proxy(
    { league: leagueRef.current, simming: false } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => {}) },
  ),
}));

const { Academy } = await import("../../src/ui/pages/Academy.js");

function withUserTeam(
  edit: (league: LeagueStore) => LeagueStore,
): LeagueStore {
  return edit(makeLeague(0, 5));
}

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Academy)));
}

function directions(d: { scoutingRegions?: string[]; scoutingPositions?: string[] }) {
  return (league: LeagueStore): LeagueStore => ({
    ...league,
    teams: league.teams.map((t) => (t.tid === league.meta.userTid ? { ...t, ...d } as typeof t : t)),
  });
}

describe("Academy page", () => {
  it("renders its empty state without pointing at a retired page", () => {
    const html = render(withUserTeam((l) => l));
    expect(html).toContain("Nobody in the academy yet.");
    expect(html).not.toContain("incoming-talent");
    expect(html).not.toContain("youth-intake");
  });

  it("previews a kid reaching the professional cut", () => {
    // Take one of the user's own seniors, make him a 17-year-old academy kid
    // whose deal ends this season, and leave room in the senior squad: the
    // rollover promotes him, so the page must say so.
    const html = render(withUserTeam((league) => {
      const tid = league.meta.userTid;
      const team = league.teams.find((t) => t.tid === tid)!;
      const pid = team.roster[0];
      return {
        ...league,
        teams: league.teams.map((t) =>
          t.tid === tid ? { ...t, roster: t.roster.slice(1), academyRoster: [pid] } : t),
        players: league.players.map((p) =>
          p.pid === pid
            ? {
                ...p,
                born: league.season - (ACADEMY_GRADUATION_AGE - 1),
                contract: { salary: 26_000, expiresSeason: league.season },
              }
            : p),
      };
    }));
    expect(html).toContain("reaches a cut at the next");
    expect(html).toContain("Joins the first team");
  });
});

describe("Scout directions panel on the Academy page", () => {
  it("renders both rows with nothing set", () => {
    const html = render(withUserTeam(directions({})));
    expect(html).toContain("Scout directions");
    expect(html).toContain("Countries");
    expect(html).toContain("Positions");
    // The empty states read as a default rather than as a missing value.
    expect(html).toContain("anywhere close to home");
    expect(html).toContain("whoever they turn up");
  });

  it("shows what has been picked, and stops offering more at the caps", () => {
    const regions = ["Brazil", "Argentina", "France"];
    const positions = ["GK", "CB", "ST"];
    expect(regions).toHaveLength(SCOUTING_REGION_MAX);
    expect(positions).toHaveLength(SCOUT_POSITION_MAX);

    const html = render(withUserTeam(directions({
      scoutingRegions: regions,
      scoutingPositions: positions,
    })));
    for (const c of regions) expect(html).toContain(c);
    // At the cap the "add another" pickers are gone, so the cap is visible
    // rather than enforced only on click.
    expect(html).not.toContain("Add a country...");
    expect(html).not.toContain("Add a position...");
  });

  it("survives stored junk instead of rendering it", () => {
    const html = render(withUserTeam(directions({
      scoutingRegions: ["Atlantis", "Brazil"],
      scoutingPositions: ["Striker", "ST"],
    })));
    expect(html).toContain("Brazil");
    expect(html).not.toContain("Atlantis");
    expect(html).not.toContain("Striker");
  });
});
