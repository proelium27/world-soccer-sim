import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { buildCupState } from "../../src/core/cup/cup.js";
import { computeStandings } from "../../src/core/standings.js";
import {
  SHIELD_FORMAT, CONTINENTAL_CUP_FORMAT, CUP_STRONG_LEAGUE_SLOTS,
} from "../../src/core/constants.js";

/**
 * Render harness for the competition pages, covering the Shield's paths: the
 * empty state, a drawn-but-unplayed league phase, and the Standings page's two
 * stacked qualification bands.
 *
 * A throw here surfaces as a test failure. Server rendering does NOT run error
 * boundaries — React re-throws to the caller — so this sees raw throws
 * regardless of the boundaries App/Layout install around the router.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    simming: false,
  }),
}));

const { Cup, Shield } = await import("../../src/ui/pages/Cup.js");
const { Standings } = await import("../../src/ui/pages/Standings.js");

function render(league: LeagueStore, page: ComponentType): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(page)),
  );
}

/** A fresh world with both competitions seeded off a synthetic set of final tables. */
function withCompetitions(): LeagueStore {
  const league = makeLeague(0, 1);
  // Synthetic final tables: every tier-1 club, ordered by tid, so qualification
  // is deterministic without paying for a simmed season.
  const tables = new Map<number, ReturnType<typeof computeStandings>>();
  for (const comp of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    tables.set(comp.id, computeStandings(tids, []));
  }
  // Standings renders nothing at all until a match has been played, so give it
  // one. The table's order comes from computeStandings either way.
  const firstComp = league.competitions.find((c) => c.tier === 1)!;
  const [homeTid, awayTid] = league.teams
    .filter((t) => t.compId === firstComp.id)
    .map((t) => t.tid);
  return {
    ...league,
    season: league.season + 1,
    played: [{
      home: homeTid, away: awayTid, homeGoals: 1, awayGoals: 0,
      possessionHome: 0.5, matchday: 1,
      boxScore: { home: [], away: [], events: [] },
    }],
    cup: buildCupState(league.competitions, tables, league.season + 1, CONTINENTAL_CUP_FORMAT),
    shield: buildCupState(league.competitions, tables, league.season + 1, SHIELD_FORMAT),
  };
}

describe("Shield page", () => {
  it("renders its own empty state, naming the Shield rather than the Cup", () => {
    const league = makeLeague(0, 1);
    const html = render(league, Shield);
    expect(html).toContain("Continental Shield");
    // The Cup's empty state must not leak into the Shield's page.
    expect(html).not.toContain("top four clubs of each of the four strongest leagues");
  });

  it("renders a drawn league phase with all 16 clubs and no crash", () => {
    const league = withCompetitions();
    expect(league.shield).not.toBeNull();
    const html = render(league, Shield);
    expect(html).toContain("Continental Shield");
    expect(html).toContain("League Phase");
    for (const tid of league.shield!.leaguePhase!.teams) {
      const name = league.teams.find((t) => t.tid === tid)!.name;
      expect(html).toContain(name);
    }
  });

  it("keeps the Cup page on the Cup's own state", () => {
    const league = withCompetitions();
    const html = render(league, Cup);
    expect(html).toContain("Continental Cup");
    expect(html).not.toContain("Continental Shield");
    // Cup and Shield fields are disjoint, so no Shield club appears here.
    const shieldOnly = league.shield!.leaguePhase!.teams.filter(
      (t) => !league.cup!.leaguePhase!.teams.includes(t),
    );
    expect(shieldOnly.length).toBeGreaterThan(0);
  });
});

describe("Standings qualification bars", () => {
  it("bars the Cup places and the Shield places directly below them", () => {
    const league = withCompetitions();
    const html = render(league, Standings);
    expect(html).toContain("qual-bar-cup");
    expect(html).toContain("qual-bar-shield");
    expect(html).toContain("to the Continental Cup");
    expect(html).toContain("to the Continental Shield");
  });

  it("bars exactly the qualifying rows and leaves the rest unmarked", () => {
    const league = withCompetitions();
    const html = render(league, Standings);
    // Bounded to the tbody: the legend sits after the table and carries one
    // swatch of each, which would otherwise be counted as rows.
    const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    // England is a strong league: 4 Cup places, 2 Shield places, nothing else.
    expect(body.split("qual-bar-cup").length - 1).toBe(CUP_STRONG_LEAGUE_SLOTS);
    expect(body.split("qual-bar-shield").length - 1).toBe(2);
  });

  it("keeps qualification out of the row background", () => {
    // Row background carries win/loss, your club and the champion. Putting the
    // zone there meant the champion's gold overrode it and the top of the zone
    // never showed, so the bar is an edge element instead.
    const league = withCompetitions();
    const html = render(league, Standings);
    expect(html).not.toContain("cup-qualification");
    expect(html).not.toContain("shield-qualification");
    expect(html).toContain("Continental Cup place");
    expect(html).toContain("Continental Shield place");
  });
});

describe("Standings qualification bars — the routes that aren't a league finish", () => {
  /** England's table as the page computes it, so a rank can be named by tid. */
  function englishTable(league: LeagueStore) {
    const comp = league.competitions.find((c) => c.tier === 1)!;
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const compTids = new Set(tids);
    return computeStandings(tids, league.played.filter((m) => compTids.has(m.home)));
  }

  /** The chunk of rendered tbody belonging to one club's row. */
  function rowFor(html: string, name: string): string {
    const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    const row = body.split("<tr").find((r) => r.includes(name));
    expect(row).toBeDefined();
    return row!;
  }

  function withDomesticCupWinner(league: LeagueStore, tid: number): LeagueStore {
    const comp = league.competitions.find((c) => c.tier === 1)!;
    return {
      ...league,
      domesticCups: [{
        season: league.season,
        country: comp.country,
        name: `${comp.country} Cup`,
        teams: [tid],
        rounds: [],
        totalRounds: 1,
        championTid: tid,
        statLines: null,
      }],
    };
  }

  it("bars a mid-table domestic cup winner, and unbars the place he took", () => {
    const league = withCompetitions();
    const table = englishTable(league);
    // Ninth: comfortably below every qualifying place, so a bar on his row can
    // only have come from the cup route.
    const winner = table[8].tid;
    const displaced = table[5].tid; // 6th — the lowest Shield place, which he takes
    const nameOf = (tid: number) => league.teams.find((t) => t.tid === tid)!.name;

    const before = render(league, Standings);
    expect(rowFor(before, nameOf(winner))).not.toContain("qual-bar");
    expect(rowFor(before, nameOf(displaced))).toContain("qual-bar-shield");

    const after = render(withDomesticCupWinner(league, winner), Standings);
    expect(rowFor(after, nameOf(winner))).toContain("qual-bar-shield");
    expect(rowFor(after, nameOf(displaced))).not.toContain("qual-bar");
  });

  it("keeps the number of qualifying places the same, wherever they come from", () => {
    const league = withCompetitions();
    const winner = englishTable(league)[8].tid;
    const html = render(withDomesticCupWinner(league, winner), Standings);
    const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    expect(body.split("qual-bar-cup").length - 1).toBe(CUP_STRONG_LEAGUE_SLOTS);
    expect(body.split("qual-bar-shield").length - 1).toBe(2);
  });

  it("says how a club got in when it wasn't through the league", () => {
    const league = withCompetitions();
    const winner = englishTable(league)[8].tid;
    const html = render(withDomesticCupWinner(league, winner), Standings);
    expect(html).toContain("as domestic cup winners");
  });
});

describe("Country coefficients on the Cup page", () => {
  /** A finished Continental Cup in history, so there is a record to rank on. */
  function withCupHistory(league: LeagueStore): LeagueStore {
    const tier1 = league.competitions.filter((c) => c.tier === 1);
    const one = (comp: { id: number }) =>
      league.teams.find((t) => t.compId === comp.id)!.tid;
    const entrants = tier1.map(one);
    return {
      ...league,
      cupHistory: [{
        competition: "continental" as const,
        season: league.season - 1,
        name: "Continental Cup",
        teams: [],
        seeds: {},
        leaguePhase: {
          teams: entrants,
          matches: [{
            round: 0, matchday: 3, home: entrants[0], away: entrants[1],
            played: true, homeGoals: 2, awayGoals: 0, boxScore: null,
          }],
        },
        playoff: null,
        playIn: null,
        ties: [],
        championTid: entrants[0],
        twoLegged: true,
        koLegs: null,
        statLines: null,
      }],
    };
  }

  it("says nothing at all before there is a continental record to rank on", () => {
    const html = render(withCompetitions(), Cup);
    expect(html).not.toContain("Country coefficients");
  });

  it("shows each country's coefficient and how many places it earned", () => {
    const league = withCupHistory(withCompetitions());
    const html = render(league, Cup);
    expect(html).toContain("Country coefficients");
    // Europe's top flights only — the coefficient ranks the countries that hold
    // Continental Cup places, and no American league does.
    const AMERICAS = ["Brazil", "Argentina", "Mexico", "United States"];
    for (const comp of league.competitions.filter((c) => c.tier === 1 && !AMERICAS.includes(c.country))) {
      expect(html).toContain(comp.country);
    }
  });

  it("stays off the Shield's page, whose places don't move", () => {
    const html = render(withCupHistory(withCompetitions()), Shield);
    expect(html).not.toContain("Country coefficients");
  });
});
