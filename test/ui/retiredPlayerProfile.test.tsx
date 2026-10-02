import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import { emptyTotals, emptyBestSeasons } from "../../src/core/frivolities/stats.js";

/**
 * The career page a retiree gets once retirement has deleted him from the pool.
 *
 * The point of the page is that every link pointing at a retired player used to
 * dead-end — either on "Player not found" or on a name with no link at all — so
 * these tests are mostly about the fallback firing and the archive being the
 * only source it reads.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    simming: false,
    movePlayerToClubAction: () => {},
    releasePlayerGodModeAction: () => {},
  }),
}));

const { PlayerProfile } = await import("../../src/ui/pages/PlayerProfile.js");

function archived(over: Partial<ArchivedPlayer> & { pid: number }): ArchivedPlayer {
  return {
    name: `Archived ${over.pid}`,
    nationality: "eng",
    pos: "ST",
    born: 1,
    heightCm: 183,
    retiredSeason: 12,
    retiredAge: 36,
    firstSeason: 2,
    seasonsPlayed: 10,
    peakOvr: 84,
    peakSeason: 8,
    finalOvr: 71,
    clubs: [],
    seasons: [],
    totals: emptyTotals(),
    best: emptyBestSeasons(),
    caps: 0,
    intlGoals: 0,
    intlTitles: 0,
    ...over,
  };
}

function render(league: LeagueStore, pid: number): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/player/${pid}`] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/player/:pid", element: createElement(PlayerProfile) }),
      ),
    ),
  );
}

describe("retired player profile", () => {
  it("renders the archived career instead of 'Player not found'", () => {
    const league = makeLeague(0, 1);
    const club = league.teams[0];
    league.retiredPlayers = [archived({
      pid: 999001,
      name: "Old Striker",
      clubs: [club.tid],
      seasons: [
        { season: 10, tid: club.tid, ovr: 80, apps: 30 },
        { season: 11, tid: club.tid, ovr: 76, apps: 21 },
      ],
      totals: { ...emptyTotals(), goals: 143, appearances: 300 },
    })];

    const html = render(league, 999001);

    expect(html).not.toContain("Player not found");
    expect(html).toContain("Old Striker");
    expect(html).toContain("Retired");
    // Career totals come off the archive, not a stat line that no longer exists.
    expect(html).toContain("143");
    expect(html).toContain(club.name);
  });

  it("still shows 'Player not found' for a pid nothing in the save knows", () => {
    const league = makeLeague(0, 1);
    league.retiredPlayers = [];
    expect(render(league, 999002)).toContain("Player not found");
  });

  it("offers Un-retire only in God Mode", () => {
    const league = makeLeague(0, 1);
    league.retiredPlayers = [archived({ pid: 999004 })];
    league.godMode = false;
    expect(render(league, 999004)).not.toContain("Un-retire");
    league.godMode = true;
    expect(render(league, 999004)).toContain("Un-retire");
  });

  it("credits honours the same way a living player's profile does", () => {
    const league = makeLeague(0, 1);
    const club = league.teams[0];
    league.retiredPlayers = [archived({
      pid: 999003,
      name: "Decorated Man",
      seasons: [{ season: 5, tid: club.tid, ovr: 82, apps: 34 }],
    })];
    league.seasonHistory = [{
      season: 5,
      table: [],
      teamStats: [],
      awards: { 0: { playerOfSeasonPid: 999003, goldenBootPid: null, teamOfSeason: [] } },
      world: { ballonDOr: [{ pid: 999003, tid: club.tid, score: 1, league: 1, title: 0, cup: 0, intl: 0 }], worldTeamOfYear: [] },
      compsByTid: {},
      // A league title he was in the squad for — the team honour that needs the
      // archived club-per-season line to be attributable at all.
      championTidByCompId: { 0: club.tid },
    } as unknown as SeasonHistoryEntry];

    const html = render(league, 999003);

    expect(html).toContain("Player of the Season");
    // Apostrophe comes back HTML-escaped from renderToStaticMarkup.
    expect(html).toContain("Ballon d&#x27;Or");
    expect(html).toContain("League Champion");
  });

  it("prefers the live player when a pid is somehow in both", () => {
    const league = makeLeague(0, 1);
    const live = league.players[0];
    league.retiredPlayers = [archived({ pid: live.pid, name: "Should Not Show" })];

    const html = render(league, live.pid);

    expect(html).toContain(live.name);
    expect(html).not.toContain("Should Not Show");
  });
});
