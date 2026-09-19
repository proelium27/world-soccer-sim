import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { emptySeasonStats } from "../../src/core/players/types.js";

/**
 * The Totals / Per 90 control on a living player's season-stats card.
 *
 * The mode is component state and there's no DOM test env here, so this sees
 * only the default (Totals) render. What it guards is that the control is
 * actually present and that the card — whose header markup was restructured to
 * hold it next to the League/Cup tabs — still draws its table.
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

/** A league whose first player has two seasons of league stats on record. */
function leagueWithPlayedSeasons(): { league: LeagueStore; pid: number } {
  const league = makeLeague(0, 3);
  const player = league.players[0];
  const tid = league.teams[0].tid;
  player.recentStats = [
    { ...emptySeasonStats(league.season - 1, tid), appearances: 30, minutesPlayed: 2600, goals: 12, assists: 5, avgRating: 7.1 },
    { ...emptySeasonStats(league.season, tid), appearances: 18, minutesPlayed: 900, goals: 9, assists: 2, avgRating: 7.4 },
  ];
  return { league, pid: player.pid };
}

describe("player profile per-90 control", () => {
  it("renders both modes of the toggle", () => {
    const { league, pid } = leagueWithPlayedSeasons();
    const html = render(league, pid);
    expect(html).toContain("Per 90");
    expect(html).toContain("Totals");
  });

  it("defaults to totals, so no column is labelled as a rate", () => {
    const { league, pid } = leagueWithPlayedSeasons();
    expect(render(league, pid)).not.toContain("/90<");
  });

  it("still draws the season stats table", () => {
    const { league, pid } = leagueWithPlayedSeasons();
    const html = render(league, pid);
    expect(html).toContain("Season Stats");
    expect(html).toContain("<tbody>");
  });
});
