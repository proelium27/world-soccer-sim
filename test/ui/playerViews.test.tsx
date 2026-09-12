import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { emptySeasonStats, type Player } from "../../src/core/players/types.js";
import { setWatched } from "../../src/core/watchlist.js";
import { initInternationalCampaign } from "../../src/core/international/index.js";
import { emptyNationalManagerState } from "../../src/core/nationalManager/index.js";
import { sortRows } from "../../src/ui/components/SortableTable.js";
import {
  PERFORMANCE_COLUMNS, performanceSeason, viewKeepsSort, viewSortAccessors, type PlayerView,
} from "../../src/ui/playerViews.js";

/**
 * The Overview / Attributes / Performance switch on the player tables you shop
 * from (ui/playerViews.tsx).
 *
 * The failure a column switch invites is silent misalignment: a view that adds
 * fifteen header cells and fourteen data cells shifts every number one column
 * left, which renders perfectly and reads as nonsense. So the render half of
 * this file counts, for every page in every view, that each body row has
 * exactly as many cells as the header — the one check that catches it.
 *
 * The view lives in the query string, which is what lets a server render reach
 * the wide views at all (see `usePlayerView`).
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    makeOfferAction: () => {},
    acceptCounterAction: () => {},
    signFreeAgentAction: () => {},
    toggleWatchedAction: () => {},
    setNationalSquadAction: () => {},
    setNationalLineupAction: () => {},
    setNationalFormationAction: () => {},
    autoPickNationalXIAction: () => {},
    simming: false,
  }),
}));

const { Transfers } = await import("../../src/ui/pages/Transfers.js");
const { FreeAgents } = await import("../../src/ui/pages/FreeAgents.js");
const { Watchlist } = await import("../../src/ui/pages/Watchlist.js");
const { NTPlayerPool } = await import("../../src/ui/pages/nationalTeams/PlayerPool.js");
const { NTMySquad } = await import("../../src/ui/pages/nationalTeams/MySquad.js");

/** A season-1 league line with enough in it to tell a number from a dash. */
function withLine(p: Player): Player {
  return {
    ...p,
    stats: [{
      ...emptySeasonStats(1, 0),
      appearances: 10 + (p.pid % 20),
      minutesPlayed: 900,
      goals: p.pid % 7,
      assists: p.pid % 5,
      xg: 1.5,
      tackles: p.pid % 11,
      avgRating: 6 + (p.pid % 30) / 10,
    }],
  };
}

// One world for the whole file: every case only reads it.
const base: LeagueStore = (() => {
  const league = makeLeague(0, 1);
  return { ...league, players: league.players.map(withLine) };
})();

function render(page: ComponentType, league: LeagueStore, view: PlayerView): string {
  leagueRef.current = league;
  const url = view === "overview" ? "/page" : `/page?view=${view}`;
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(page)),
  );
}

/** Header-cell count and each body row's cell count, per table on the page. */
function tableShapes(html: string): { heads: number; rows: number[] }[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(([t]) => {
    const thead = t.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    const tbody = t.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    return {
      heads: (thead.match(/<th[\s>]/g) ?? []).length,
      rows: [...tbody.matchAll(/<tr[\s\S]*?<\/tr>/g)]
        .map(([r]) => (r.match(/<td[\s>]/g) ?? []).length),
    };
  });
}

function staged(league: LeagueStore): LeagueStore {
  const drawn = initInternationalCampaign(
    league.international, league.players, league.season, league.lid,
  );
  return {
    ...league,
    nationalManager: emptyNationalManagerState(drawn.qualifying!.squads[0].nation, 1),
    international: drawn,
  };
}

const rival = base.teams.find((t) => t.tid !== base.meta.userTid)!;
const released = rival.roster[0];
const watched = rival.roster.slice(0, 3);

const PAGES: { name: string; page: ComponentType; league: () => LeagueStore }[] = [
  // The summer window has to be open for the recommended table to render.
  { name: "Transfers", page: Transfers, league: () => ({ ...base, phase: "offseason" }) },
  {
    name: "Free Agents",
    page: FreeAgents,
    // A fresh world may have nobody unsigned, so free one player up.
    league: () => ({
      ...base,
      teams: base.teams.map((t) =>
        t.tid === rival.tid ? { ...t, roster: t.roster.filter((pid) => pid !== released) } : t),
    }),
  },
  {
    name: "Watchlist",
    page: Watchlist,
    league: () => watched.reduce((l, pid) => setWatched(l, pid, true), base),
  },
  { name: "Player Pool", page: NTPlayerPool, league: () => staged(base) },
  { name: "My Squad", page: NTMySquad, league: () => staged(base) },
];

describe("every page lines its cells up with its headers in every view", () => {
  for (const { name, page, league } of PAGES) {
    for (const view of ["overview", "attributes", "performance"] as const) {
      it(`${name}, ${view}`, () => {
        const shapes = tableShapes(render(page, league(), view));
        const withRows = shapes.filter((s) => s.rows.length > 0);
        // Vacuity guard: a page that rendered no table would pass trivially.
        expect(withRows.length, `${name} rendered no populated table`).toBeGreaterThan(0);
        for (const { heads, rows } of withRows) {
          for (const cells of rows) expect(cells).toBe(heads);
        }
      });
    }
  }
});

describe("what each view shows", () => {
  it("the attributes view swaps the money for the ratings", () => {
    const html = render(Transfers, { ...base, phase: "offseason" }, "attributes");
    expect(html).toContain('<abbr title="Speed">SPD</abbr>');
    expect(html).toContain('<abbr title="Goalkeeping">GK</abbr>');
    // Asked of the table only: the filter bar above it has its own "Scout
    // value" range, which stays whatever the view.
    const table = html.match(/<table[\s\S]*?<\/table>/)![0];
    expect(table).not.toContain(">Wage<");
    expect(table).not.toContain("Scout value");
    // The action column stays: you can still bid from any view.
    expect(html).toContain(">Offer<");
  });

  it("the overview is the page as it was", () => {
    const html = render(Transfers, { ...base, phase: "offseason" }, "overview");
    expect(html).toContain(">Wage<");
    expect(html).not.toContain('<abbr title="Speed">');
  });

  it("the performance view shows the season's numbers, not dashes", () => {
    const l = watched.reduce((acc, pid) => setWatched(acc, pid, true), base);
    const html = render(Watchlist, l, "performance");
    for (const col of PERFORMANCE_COLUMNS) expect(html).toContain(`>${col.label}</abbr>`);
    const p = l.players.find((x) => x.pid === watched[0])!;
    expect(html).toContain(`>${p.stats[0].avgRating.toFixed(2)}<`);
    expect(html).toContain("league stats");
  });

  it("an unrecognised view in the URL falls back to the overview", () => {
    leagueRef.current = { ...base, phase: "offseason" };
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/page?view=nonsense"] },
        createElement(Transfers),
      ),
    );
    expect(html).toContain(">Wage<");
  });
});

describe("viewKeepsSort", () => {
  const overviewOnly = ["wage", "value", "pot"];

  it("keeps a sort whose column the new view still shows", () => {
    expect(viewKeepsSort("name", "attributes", overviewOnly)).toBe(true);
    expect(viewKeepsSort("ovr", "performance", overviewOnly)).toBe(true);
    expect(viewKeepsSort("speed", "attributes", overviewOnly)).toBe(true);
    expect(viewKeepsSort("stat_goals", "performance", overviewOnly)).toBe(true);
    expect(viewKeepsSort("wage", "overview", overviewOnly)).toBe(true);
  });

  it("drops one that would leave the table sorted by a hidden column", () => {
    expect(viewKeepsSort("wage", "attributes", overviewOnly)).toBe(false);
    expect(viewKeepsSort("speed", "performance", overviewOnly)).toBe(false);
    expect(viewKeepsSort("stat_goals", "overview", overviewOnly)).toBe(false);
    // `interceptions` is an attribute; the stat is namespaced, so the two can't
    // be mistaken for each other.
    expect(viewKeepsSort("interceptions", "performance", overviewOnly)).toBe(false);
    expect(viewKeepsSort("stat_interceptions", "attributes", overviewOnly)).toBe(false);
  });
});

describe("performanceSeason", () => {
  it("opens on the season being played once it has any stats", () => {
    const l = { ...base, season: 3, players: base.players.map((p) => ({
      ...p, stats: [emptySeasonStats(2), emptySeasonStats(3)],
    })) };
    expect(performanceSeason(l)).toBe(3);
  });

  it("falls back to last season at the top of a new one", () => {
    const l = { ...base, season: 3, players: base.players.map((p) => ({
      ...p, stats: [emptySeasonStats(2)],
    })) };
    expect(performanceSeason(l)).toBe(2);
  });
});

describe("sorting by match rating", () => {
  const [a, b, c] = base.players;
  const line = (apps: number, rating: number) => ({
    ...emptySeasonStats(1), appearances: apps, avgRating: rating,
  });
  const regular = { ...a, stats: [line(30, 6.8)] };
  const cameo = { ...b, stats: [line(2, 8.9)] };
  const unused = { ...c, stats: [] };
  const rows = [cameo, unused, regular];
  const acc = viewSortAccessors((p: Player) => p, 1, rows);

  it("puts a regular above a one-off cameo, and a player with no line last", () => {
    const sorted = sortRows(rows, { key: "stat_avgRating", dir: "desc" }, acc);
    expect(sorted.map((p) => p.pid)).toEqual([regular.pid, cameo.pid, unused.pid]);
  });

  it("still ranks counting stats straight, with no line below zero", () => {
    const goals = viewSortAccessors((p: Player) => p, 1, rows).stat_appearances;
    expect(goals(regular)).toBe(30);
    expect(goals(unused)).toBeLessThan(0);
  });
});
