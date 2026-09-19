import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { emptySeasonStats } from "../../src/core/players/types.js";

/**
 * Every table on the Player Profile puts as many cells in a row as it has
 * headers.
 *
 * This exists because exactly that broke and nobody noticed: the season-stats
 * table carried a `Sv` header with no matching `<td>`, so every column from
 * saves rightward rendered under the *previous* column's heading — tackles
 * appeared as saves, interceptions as goals against, and so on down the row.
 * It is invisible to a type checker (JSX doesn't count columns) and invisible
 * to every other test here, which assert on substrings rather than structure,
 * and it survived at least one release. Adding a column is the operation that
 * causes it, and the card exists to have columns added to it.
 *
 * Counts `<th>` against `<td>` in the first body row of each table, from the
 * static markup — no DOM env needed.
 *
 * KNOWN GAP: only the tab that is open renders at all, and the open tab is
 * component state with no DOM env here to click it, so this covers the league
 * table and nothing else. The Cup and National Team tables are unreachable
 * from this harness whatever stats the fixture is given (an earlier version of
 * this note blamed empty tables, and adding cup lines to the fixture did not
 * help — the markup simply isn't there).
 *
 * What covers the cup table instead: it now generates its headers and its
 * cells from one column list, shared with the league table (see
 * ui/playerStatColumns.ts and its unit tests), so a header without a cell is
 * no longer expressible. This test stays because that guarantee is a property
 * of the current render, not of the file, and the failure was silent.
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

/** Each `<table>` in the markup, as its own chunk of html. */
function tablesIn(html: string): string[] {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
}

function countTags(html: string, tag: "th" | "td"): number {
  return [...html.matchAll(new RegExp(`<${tag}\\b`, "g"))].length;
}

/** Header count, and the cell count of the first body row. */
function columnCounts(table: string): { headers: number; cells: number } {
  const head = /<thead\b[\s\S]*?<\/thead>/.exec(table)?.[0] ?? "";
  const body = /<tbody\b[\s\S]*?<\/tbody>/.exec(table)?.[0] ?? "";
  const firstRow = /<tr\b[\s\S]*?<\/tr>/.exec(body)?.[0] ?? "";
  return { headers: countTags(head, "th"), cells: countTags(firstRow, "td") };
}

function profileWithStats(): { league: LeagueStore; pid: number } {
  const league = makeLeague(0, 3);
  const player = league.players[0];
  const tid = league.teams[0].tid;
  player.recentStats = [
    {
      ...emptySeasonStats(league.season, tid),
      appearances: 30, minutesPlayed: 2600, goals: 12, assists: 5,
      shots: 60, shotsOnTarget: 25, saves: 0, tackles: 40, interceptions: 33,
      yellowCards: 6, redCards: 1, avgRating: 7.1,
    },
  ];
  return { league, pid: player.pid };
}

describe("player profile table columns", () => {
  it("gives every table exactly as many cells as it has headers", () => {
    const { league, pid } = profileWithStats();
    const tables = tablesIn(render(league, pid));
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const { headers, cells } = columnCounts(table);
      if (cells === 0) continue; // an empty table has no row to compare
      expect(cells).toBe(headers);
    }
  });

  it("keeps the season-stats row aligned specifically, cards included", () => {
    const { league, pid } = profileWithStats();
    const stats = tablesIn(render(league, pid)).find(
      (t) => t.includes(">Apps<") && t.includes(">Rtg<"),
    );
    expect(stats).toBeDefined();
    const { headers, cells } = columnCounts(stats!);
    expect(headers).toBeGreaterThanOrEqual(16); // Season..Rtg, YC and RC among them
    expect(cells).toBe(headers);
    expect(stats).toContain(">YC<");
    expect(stats).toContain(">RC<");
  });

  it("gives a multi-season career row the same width as a season row", () => {
    const { league, pid } = profileWithStats();
    const player = league.players.find((p) => p.pid === pid)!;
    player.recentStats = [
      { ...player.recentStats[0] },
      { ...player.recentStats[0], season: league.season - 1 },
    ];
    const stats = tablesIn(render(league, pid)).find(
      (t) => t.includes(">Apps<") && t.includes(">Rtg<"),
    );
    const foot = /<tfoot\b[\s\S]*?<\/tfoot>/.exec(stats!)?.[0] ?? "";
    expect(foot).toContain(">Career<");
    expect(countTags(foot, "td")).toBe(columnCounts(stats!).headers);
  });
});
