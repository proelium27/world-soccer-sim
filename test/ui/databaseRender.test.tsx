import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { PLAYER_DB_PAGE_SIZE } from "../../src/ui/playerDatabase.js";
import { CLUB_DB_PAGE_SIZE } from "../../src/ui/clubDatabase.js";

/**
 * The database page renders the whole world, so its one real failure mode is
 * DOM weight — this app's only known performance failure, and the one that
 * froze /transfers at 10,684 elements and 2,066 flag images while every
 * JavaScript measurement came back fast (147ms). A cap is what keeps that from
 * happening again, so the cap is what this test pins: the page must render one
 * page of rows out of a 15,000-player world, not fifteen thousand.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    toggleWatchedAction: () => {},
    simming: false,
  }),
}));

const { Database } = await import("../../src/ui/pages/Database.js");

function render(league: LeagueStore, path = "/database/players"): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/database/:tab", element: createElement(Database) }),
      ),
    ),
  );
}

const countOf = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("Database page", () => {
  const league = makeLeague(0, 4);

  it("renders one page of rows out of the whole world", () => {
    const html = render(league);
    // Far more players exist than are drawn.
    expect(league.players.length).toBeGreaterThan(PLAYER_DB_PAGE_SIZE * 10);
    expect(countOf(html, /<tr>/g)).toBeLessThanOrEqual(PLAYER_DB_PAGE_SIZE + 1); // + header
  });

  it("keeps the DOM small enough that layout and paint stay cheap", () => {
    const html = render(league);
    // The real save that froze /transfers rendered 10,684 elements and 2,066
    // flag images. One flag per row and no crest keeps this an order of
    // magnitude below that.
    expect(countOf(html, /<[a-z]/g)).toBeLessThan(4000);
    expect(countOf(html, /<img/g)).toBeLessThanOrEqual(PLAYER_DB_PAGE_SIZE);
  });

  it("keeps the DOM bounded on the WIDEST column set too", () => {
    // Attributes is 14 more numeric cells per row than the overview, which is
    // the view a cap most needs to cover — measuring only the narrow default
    // would leave the widest table unguarded.
    const html = render(league, "/database/players?cols=attributes");
    expect(html).toContain("SPD");
    expect(countOf(html, /<[a-z]/g)).toBeLessThan(5000);
    expect(countOf(html, /<img/g)).toBeLessThanOrEqual(PLAYER_DB_PAGE_SIZE);
  });

  it("shows the whole world's count even though it draws one page of it", () => {
    const html = render(league);
    expect(html).toContain(`of ${league.players.length.toLocaleString()} players`);
  });

  it("renders the clubs tab, one page of the world at a time", () => {
    const html = render(league, "/database/clubs");
    expect(html).toContain("Avg age");
    expect(league.teams.length).toBeGreaterThan(CLUB_DB_PAGE_SIZE);
    expect(countOf(html, /<tr/g)).toBeLessThanOrEqual(CLUB_DB_PAGE_SIZE + 1); // + header
    expect(html).toContain(`of ${league.teams.length.toLocaleString()} clubs`);
  });

  it("keeps the clubs' widest column set bounded too", () => {
    // Season is 16 numeric columns on top of the identity block — the widest
    // table either tab draws, and so the one the budget is really for.
    const html = render(league, "/database/clubs?cols=season");
    expect(html).toContain("xGA");
    expect(countOf(html, /<[a-z]/g)).toBeLessThan(3500);
    // No crest and no flag per row: a club's name is the identity here.
    expect(countOf(html, /<img/g)).toBe(0);
  });

  it("shows the finance columns the money questions need", () => {
    const html = render(league, "/database/clubs?cols=finance");
    expect(html).toContain("Wage bill");
    expect(html).toContain("Budget");
  });

  it("opens on the view a shared link describes", () => {
    // The whole point of the URL state: someone else's filtered, sorted table
    // has to come back the way they left it.
    const html = render(league, "/database/players?pos=GK&ovr=60&sort=speed&dir=asc");
    expect(html).toContain('value="GK"');
    // Every row really is a keeper, so the filter reached the scan rather than
    // just the controls.
    const positions = [...html.matchAll(/<td>(GK|CB|FB|DM|CM|AM|W|ST)<\/td>/g)].map((m) => m[1]);
    expect(positions.length).toBeGreaterThan(0);
    expect(new Set(positions)).toEqual(new Set(["GK"]));
  });

  it("renders the career column set, dropping the stats it can't total", () => {
    const html = render(league, "/database/players?cols=career");
    expect(html).toContain("Apps");
    expect(html).toContain(">G<");
    // Cards are recorded per season and never summed, so a career view showing
    // them would be a column of zeros pretending to be a total.
    expect(html).not.toContain("Yellow cards");
    expect(countOf(html, /<[a-z]/g)).toBeLessThan(5000);
  });

  it("renders the season column set with nothing played yet", () => {
    // A fresh world has no stat lines at all, so the season view is legitimately
    // empty — it must say so rather than throw or print a page of dashes.
    const html = render(league, "/database/players?cols=season");
    expect(html).toContain("No players match these filters.");
  });

  it("renders for a save with no user club", () => {
    // A spectator save browses the world like any other; the page must not
    // assume a user team exists (the potential fog reads as fully unscouted).
    const spectator: LeagueStore = {
      ...league,
      meta: { ...league.meta, userTid: -3 },
    };
    expect(() => render(spectator)).not.toThrow();
  });
});
