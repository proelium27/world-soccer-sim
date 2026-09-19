import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import type { WorldAwardEntry } from "../../src/core/worldAwards.js";
import { emptyTotals, emptyBestSeasons } from "../../src/core/frivolities/stats.js";

/**
 * Render harness for Frivolities' Awards tab.
 *
 * The boards' arithmetic is covered by `test/core/frivolities.test.ts`; what
 * this catches is the render tree — a placeholder row for a pid the save has
 * forgotten, a retiree with no live player behind him, and the expandable
 * score breakdown. Server rendering does NOT run error boundaries (React
 * re-throws to the caller), so a throw here surfaces as a test failure.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { AwardsTab } = await import("../../src/ui/pages/Frivolities.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AwardsTab)),
  );
}

function bdo(pid: number, tid: number, score: number): WorldAwardEntry {
  return { pid, tid, score, league: score - 1, cup: 0.7, intl: 0.2, title: 0.1 };
}

function archived(pid: number, name: string): ArchivedPlayer {
  return {
    pid, name, nationality: "esp", pos: "ST", born: 1994, heightCm: 183,
    retiredSeason: 2031, retiredAge: 37, firstSeason: 2016, seasonsPlayed: 15,
    peakOvr: 88, peakSeason: 2024, finalOvr: 70, clubs: [1],
    seasons: [{ season: 2028, tid: 1, ovr: 88, apps: 38 }],
    totals: { ...emptyTotals(), appearances: 400, goals: 250 },
    best: emptyBestSeasons(),
    caps: 90, intlGoals: 40, intlTitles: 1,
  } as ArchivedPlayer;
}

function history(season: number, shortlist: WorldAwardEntry[], extra: {
  worldXI?: (number | null)[];
  poty?: number;
  goldenBoot?: number;
  tots?: (number | null)[];
} = {}): SeasonHistoryEntry {
  return {
    season, table: [], teamStats: [], compsByTid: {}, championTidByCompId: {},
    awards: {
      0: {
        playerOfSeasonPid: extra.poty ?? null,
        goldenBootPid: extra.goldenBoot ?? null,
        teamOfSeason: extra.tots ?? [],
      },
    },
    world: { ballonDOr: shortlist, worldTeamOfYear: extra.worldXI ?? [] },
  } as unknown as SeasonHistoryEntry;
}

describe("Frivolities awards tab", () => {
  it("says there's nothing to show before a season has been completed", () => {
    const html = render(makeLeague(0, 1));
    expect(html).toContain("No awards have been handed out yet");
  });

  it("renders every board, including a retiree and a player the save has forgotten", () => {
    const league = makeLeague(0, 1);
    const winner = league.players[0];
    league.retiredPlayers = [archived(999999, "Old Hand")];
    league.seasonHistory = [
      // The retiree wins one, a live player wins another, and pid 123456 —
      // in neither the pool nor the archive — takes a shortlist place.
      history(2028, [bdo(999999, 1, 9.4), bdo(winner.pid, 2, 9.1)], {
        poty: 999999, tots: [winner.pid], worldXI: [999999],
      }),
      history(2029, [bdo(winner.pid, 2, 8.8), bdo(123456, 3, 8.2)], {
        goldenBoot: winner.pid,
      }),
    ] as SeasonHistoryEntry[];
    // A career row only exists for a player with an appearance on record. He
    // sits at the user's club so the all-time XI panel, which opens on it,
    // renders a real pick as well as its empty slots.
    winner.recentStats = [{
      season: 2028, tid: league.meta.userTid, appearances: 38, goals: 30, assists: 8,
    }] as typeof winner.recentStats;
    // The boards read the career summary, which a real save keeps in step with
    // the lines; with none stored, the fallback folds the line above.
    winner.career = undefined;

    const html = render(league);
    expect(html).toContain("Most decorated careers");
    expect(html).toContain("Most dominant seasons");
    expect(html).toContain("Ballon d&#x27;Or record");
    expect(html).toContain("Ballon d&#x27;Or roll of honour");
    expect(html).toContain("Youngest and oldest winners");
    expect(html).toContain("A club&#x27;s all-time award XI");
    expect(html).toContain("Awards by club");
    expect(html).toContain("Awards by country");
    // The XI renders as a pitch: the user's club has one selection (a Team of
    // the Season place at the keeper slot), and the other ten slots are empty.
    expect(html).toContain("pitch-field");
    expect(html).toContain("1 x Team of the Season");
    expect(html).toContain(winner.name.split(" ").at(-1));
    // The forgotten pid still gets a row, under a placeholder name.
    expect(html).toContain("Player 123456");
    expect(html).toContain("Old Hand");
    expect(html).toContain("Retired");
    // Scores render to two decimals, and the winner's row is marked as a win.
    expect(html).toContain("9.40");
    expect(html).toContain("Won it");
  });
});
