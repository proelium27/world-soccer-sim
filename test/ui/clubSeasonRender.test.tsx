import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry, StandingsRow } from "../../src/core/standings.js";

/**
 * Render harness for the club-season page. There is no DOM test env here, so
 * this is the cheapest thing that catches a page-level throw — and server
 * rendering does NOT run error boundaries (React re-throws to the caller), so a
 * crash surfaces as a failure rather than as a fallback.
 *
 * The states worth pinning are the three the page branches on: the season being
 * played (live squad, live table), a completed season out of history, and a
 * season the club has no record of.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { ClubSeason } = await import("../../src/ui/pages/ClubSeason.js");

function render(league: LeagueStore, tid: number, season: number): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/club/${tid}/${season}`] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/club/:tid/:season", element: createElement(ClubSeason) }),
      ),
    ),
  );
}

/** A finished season built from the league's real clubs, in their real competitions. */
function historyEntry(league: LeagueStore, season: number): SeasonHistoryEntry {
  const table: StandingsRow[] = [];
  const compsByTid: Record<number, number> = {};
  const championTidByCompId: Record<number, number> = {};
  for (const comp of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    tids.forEach((tid, i) => {
      const won = tids.length - i;
      table.push({
        tid, played: 38, won, drawn: 0, lost: 38 - won,
        gf: won * 2, ga: 38 - won, gd: won * 2 - (38 - won), points: won * 3,
      });
      compsByTid[tid] = comp.id;
    });
    championTidByCompId[comp.id] = tids[0];
  }
  return {
    season, table, teamStats: [], awards: {}, compsByTid, championTidByCompId,
    world: { ballonDOr: [], worldTeamOfYear: [] },
  };
}

describe("Club season page render", () => {
  const base = makeLeague(0, 1);
  const tid = base.teams[0].tid;

  it("renders the season being played from the live squad", () => {
    const html = render(base, tid, base.season);
    expect(html).toContain(base.teams[0].name);
    expect(html).toContain("In progress");
    expect(html).toContain("Squad");
    // The live squad is the roster, so every man on it has a row.
    expect(html).toContain("mid-season");
  });

  it("renders a completed season out of history, with the three cup lines", () => {
    // Give every player a stats row for the season so the squad rebuilds.
    const season = base.season;
    const roster = new Set(base.teams[0].roster);
    const league: LeagueStore = {
      ...base,
      season: season + 1,
      seasonHistory: [historyEntry(base, season)],
      players: base.players.map((p) =>
        roster.has(p.pid)
          ? { ...p, stats: [...p.stats, {
              season, tid, appearances: 30, goals: 4, assists: 3, shots: 40,
              shotsOnTarget: 15, xg: 4.4, goalsAgainst: 0, xga: 0, saves: 0,
              tackles: 20, interceptions: 12, passes: 900, passesCompleted: 700,
              crosses: 30, foulsCommitted: 20, yellowCards: 3, redCards: 0,
              minutesPlayed: 2600, ratingSum: 200, avgRating: 6.9,
            } as (typeof p.stats)[number]] }
          : p,
      ),
    };

    const html = render(league, tid, season);
    expect(html).toContain("Domestic cup");
    expect(html).toContain("Continental Cup");
    expect(html).toContain("Continental Shield");
    // How the squad was built (everyone in it that season, a mid-season mover
    // at both clubs) has to be on the page, not just in the code.
    expect(html).toContain("shows up at both clubs");
    expect(html).not.toContain("In progress");
  });

  it("says so plainly when the club has no record of that season", () => {
    const html = render(base, tid, base.season + 5);
    expect(html).toContain("No record of");
  });

  it("does not throw on a tid the save has never heard of", () => {
    const html = render(base, 99999, base.season);
    expect(html).toContain("No record of");
  });
});
