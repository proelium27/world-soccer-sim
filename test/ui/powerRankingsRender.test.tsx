import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { competitionTeamCount } from "../../src/core/competitions.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";

/**
 * Power Rankings ranks every club in the world, so its one real failure mode is
 * DOM weight — this app's only known performance failure, and the one that froze
 * /transfers at 10,684 elements while every JavaScript measurement came back
 * fast. Measured on the shipped world, the unpaged page rendered 12,242
 * elements and 696 crest images, i.e. past the size that froze Transfers. Two
 * things keep it down and both are pinned here: the page opens on your own
 * division, and whatever you filter to is drawn one page at a time.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { PowerRankings, POWER_RANKING_PAGE_SIZE } = await import(
  "../../src/ui/pages/PowerRankings.js"
);

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PowerRankings)),
  );
}

const countOf = (html: string, re: RegExp) => (html.match(re) ?? []).length;
/** Body rows only: the movement cell is one per club row and appears nowhere else. */
const clubRows = (html: string) => countOf(html, /<td class="text-center small">/g);

describe("Power Rankings page", () => {
  const league = makeLeague(0, 4);

  it("opens on the user's own division rather than the whole world", () => {
    const userTeam = league.teams.find((t) => t.tid === league.meta.userTid)!;
    const comp = league.competitions.find((c) => c.id === userTeam.compId)!;
    const size = competitionTeamCount(comp);

    // The world is far larger than the division being shown.
    expect(league.teams.length).toBeGreaterThan(size * 10);
    expect(clubRows(render(league))).toBe(size);
  });

  it("pages the list when there is no club to open on", () => {
    // A spectator save has no division of its own, so it opens on everything —
    // which is exactly the case a cap has to cover.
    const spectator: LeagueStore = {
      ...league,
      meta: { ...league.meta, userTid: SPECTATOR_TID },
    };
    const html = render(spectator);
    expect(clubRows(html)).toBeLessThanOrEqual(POWER_RANKING_PAGE_SIZE);
    // ...and says how many it is holding back, rather than silently dropping them.
    const shown = html.match(/of ([\d,]+) clubs/);
    expect(shown).not.toBeNull();
    expect(Number(shown![1].replace(/,/g, ""))).toBeGreaterThan(POWER_RANKING_PAGE_SIZE);
  });

  it("keeps the DOM small enough that layout and paint stay cheap", () => {
    const html = render(league);
    expect(countOf(html, /<[a-z]/g)).toBeLessThan(4000);
    expect(countOf(html, /<img/g)).toBeLessThanOrEqual(POWER_RANKING_PAGE_SIZE);
  });
});
