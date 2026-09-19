import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import type { WorldAwardEntry } from "../../src/core/worldAwards.js";
import { emptySeasonStats } from "../../src/core/players/types.js";

/**
 * The Goalkeeper and Defender of the Year sections on the Awards page. Two
 * things are worth pinning: that each award shows the stat it is decided on and
 * a breakdown of the winner's points against the runner-up's, and that every
 * table's header and body carry the same number of cells. A branch that emits
 * one cell fewer shifts every number a column left and renders perfectly.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, crests: new Map() }),
}));

const { Awards } = await import("../../src/ui/pages/Awards.js");

const SEASON = 1;

function entry(pid: number, tid: number, score: number, withBreakdown: boolean): WorldAwardEntry {
  const league = score - 1;
  return {
    pid, tid, score, league, cup: 0.25, intl: 0.25, title: 0.5, domesticCup: 0,
    ...(withBreakdown
      ? { breakdown: { rating: 6.8, scoring: 0.2, work: 0.4, quality: league - 7.4 } }
      : {}),
  };
}

/** A save with one finished season whose position awards name real players. */
function leagueWithAwards(withBreakdown: boolean): LeagueStore {
  const base = makeLeague(0, 1);
  const keepers = base.players.filter((p) => p.pos === "GK").slice(0, 2);
  const defenders = base.players.filter((p) => p.pos === "CB").slice(0, 2);
  const tidOf = new Map(base.teams.flatMap((t) => t.roster.map((pid) => [pid, t.tid] as const)));
  const statted = new Set([...keepers, ...defenders].map((p) => p.pid));
  const players = base.players.map((p) =>
    statted.has(p.pid)
      ? {
          ...p,
          recentStats: [{
            ...emptySeasonStats(SEASON, tidOf.get(p.pid)!),
            appearances: 30, avgRating: 6.9, saves: 90, goalsAgainst: 25, tackles: 60, interceptions: 55,
          }],
        }
      : p,
  );
  const mk = (ps: typeof keepers, top: number) =>
    ps.map((p, i) => entry(p.pid, tidOf.get(p.pid)!, top - i, withBreakdown));
  const compsByTid = Object.fromEntries(base.teams.map((t) => [t.tid, t.compId]));
  const history: SeasonHistoryEntry = {
    season: SEASON,
    table: [],
    teamStats: [],
    awards: Object.fromEntries(
      base.competitions.map((c) => [c.id, { playerOfSeasonPid: null, goldenBootPid: null, teamOfSeason: [] }]),
    ),
    world: {
      ballonDOr: mk(defenders, 20),
      worldTeamOfYear: [],
      goalkeeperOfYear: mk(keepers, 12),
      defenderOfYear: mk(defenders, 14),
    },
    compsByTid,
    championTidByCompId: {},
  };
  return { ...base, players, seasonHistory: [history] };
}

const render = () =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Awards)));

/** Every table in the page: header cell count against each body and footer row's. */
function assertAligned(html: string) {
  const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  expect(tables.length).toBeGreaterThan(0);
  for (const t of tables) {
    const head = t.match(/<thead>[\s\S]*?<\/thead>/)![0];
    const width = (head.match(/<th[ >]/g) ?? []).length;
    const rows = t.match(/<tr>[\s\S]*?<\/tr>|<tr [\s\S]*?<\/tr>/g)!.slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect((r.match(/<t[dh][ >]/g) ?? []).length).toBe(width);
  }
}

describe("the Goalkeeper and Defender of the Year sections", () => {
  it("shows what each award is decided on, and where the winner's points came from", () => {
    leagueRef.current = leagueWithAwards(true);
    const html = render();
    expect(html).toContain("Goalkeeper of the Year");
    expect(html).toContain("Defender of the Year");
    // The stat each award is decided on: 90 saves from 115 shots faced.
    expect(html).toContain("78.3%");
    expect(html).toContain("Tkl + Int / game");
    // The winner's points, broken down and set against the runner-up's.
    expect(html).toContain("Shot-stopping");
    expect(html).toContain("Defending");
    expect(html).toContain("vs 2nd");
    // Nobody may be told the award counts something its formula doesn't.
    expect(html).not.toContain("goals kept out");
    assertAligned(html);
  });

  it("falls back to the coarse split for a season recorded before breakdowns existed", () => {
    leagueRef.current = leagueWithAwards(false);
    const html = render();
    expect(html).toContain("League season");
    expect(html).not.toContain("Shot-stopping");
    assertAligned(html);
  });
});
