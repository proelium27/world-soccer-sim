import { describe, it, expect } from "vitest";
import { seasonAwardNews, awardNewsScope } from "../../src/core/awardNews.js";
import { buildSeasonTimeline } from "../../src/ui/newsFeedTimeline.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";

/*
 * The Americas' own honours in the news: one row per winner and per Team of the
 * Year place, shown to readers whose league is in the Americas.
 */

const entry = (): SeasonHistoryEntry => ({
  season: 4,
  table: [],
  awards: {},
  compsByTid: {},
  championTidByCompId: {},
  world: {
    ballonDOr: [],
    worldTeamOfYear: [],
    americas: {
      ballonDOr: [{ pid: 10, tid: 700, score: 1, league: 1, cup: 0, intl: 0, title: 0 }],
      worldTeamOfYear: [11, null, 12],
      goalkeeperOfYear: [{ pid: 13, tid: 701, score: 1, league: 1, cup: 0, intl: 0, title: 0 }],
      defenderOfYear: [{ pid: 14, tid: 702, score: 1, league: 1, cup: 0, intl: 0, title: 0 }],
    },
  },
} as unknown as SeasonHistoryEntry);

describe("the Americas' honours in the news", () => {
  it("reports each winner and every Team of the Year place, scoped to the Americas", () => {
    const news = seasonAwardNews(entry());
    expect(news.map((n) => n.kind)).toEqual([
      "americasPlayerOfYear", "americasTeamOfYear", "americasTeamOfYear",
      "americasGoalkeeperOfYear", "americasDefenderOfYear",
    ]);
    expect(news.find((n) => n.kind === "americasPlayerOfYear")).toMatchObject({ pid: 10, tid: 700 });
    expect(news.filter((n) => n.kind === "americasTeamOfYear").map((n) => n.slot)).toEqual([0, 2]);
    expect(news.every((n) => awardNewsScope(n) === "americas")).toBe(true);
  });

  it("shows them to a reader whose league is in the Americas and not to one in Europe", () => {
    const awards = seasonAwardNews(entry());
    // The winners' clubs play in a league other than the reader's, so nothing
    // here reaches him as news from his own league.
    const audience = (userRegion: "europe" | "americas") => ({
      userTid: 1, userCompId: 5, compOf: (tid: number) => (tid === 1 ? 5 : 40), userRegion,
    });
    const shown = (region: "europe" | "americas") =>
      buildSeasonTimeline([], [], audience(region), awards).filter((i) => i.kind === "award").length;
    expect(shown("americas")).toBe(awards.length);
    expect(shown("europe")).toBe(0);
  });
});
