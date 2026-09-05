import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { CupState } from "../../src/core/cup/types.js";
import type { DomesticCupState } from "../../src/core/domesticCup/types.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";

/**
 * Render harness for the Season History page.
 *
 * Built on hand-made records rather than a simmed dynasty: the page is a pure
 * read over champions the save already holds, so twenty simmed seasons would
 * add minutes to buy nothing. A throw here surfaces as a test failure — server
 * rendering does not run error boundaries, so this sees raw throws.
 *
 * `makeLeague(0, 1)` is the seed the other UI render tests use; it is loaded
 * once for the whole file, since every case only reads it.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { SeasonHistory } = await import("../../src/ui/pages/SeasonHistory.js");

const base = makeLeague(0, 1);

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(SeasonHistory)),
  );
}

/** A season-history entry carrying nothing but its champions — all this page reads. */
function entry(season: number, championTidByCompId: Record<number, number>): SeasonHistoryEntry {
  return { season, championTidByCompId } as unknown as SeasonHistoryEntry;
}

function cup(over: Partial<CupState> & { season: number }): CupState {
  return {
    competition: "continental",
    name: "Continental Cup",
    teams: [],
    seeds: {},
    leaguePhase: null,
    playoff: null,
    playIn: null,
    ties: [],
    championTid: null,
    twoLegged: true,
    koLegs: null,
    statLines: null,
    ...over,
  } as unknown as CupState;
}

function domestic(
  over: Partial<DomesticCupState> & { season: number; country: string },
): DomesticCupState {
  return {
    name: `${over.country} Cup`,
    teams: [],
    rounds: [],
    totalRounds: 4,
    championTid: null,
    statLines: null,
    ...over,
  } as DomesticCupState;
}

/**
 * The link a champion cell renders, matched exactly rather than by name or code.
 *
 * A club's abbreviation is three letters and `competitionAbbrev` produces
 * three-letter country codes from the same alphabet, so a substring check for
 * "ENG" can be satisfied by a column header rather than by the cell under test.
 * The href carries the tid, which nothing else on the page does.
 */
const linkTo = (tid: number, season: number): string => `/club/${tid}/${season}`;

describe("Season History page", () => {
  it("shows an empty state on a save that has decided nothing", () => {
    const html = render({ ...base, seasonHistory: [], cup: null, shield: null });
    expect(html).toContain("empty-state");
    expect(html).toContain("No season has been decided yet.");
    // A save with nothing to list must not also render an empty table.
    expect(html).not.toContain("<table");
  });

  it("lists a line per season, newest first, with every top flight's champion", () => {
    const d1 = base.competitions.filter((c) => c.tier === 1);
    const champions = (offset: number) =>
      Object.fromEntries(d1.map((c, i) => [c.id, base.teams.find((t) => t.compId === c.id)!.tid + (i % 2) * offset]));
    const html = render({
      ...base,
      cup: null,
      shield: null,
      seasonHistory: [entry(1, champions(0)), entry(2, champions(1))],
    });

    // The header row is one column per top flight plus Season / Cup / Shield /
    // International; every body row then adds its own <th> for the season.
    const seasons = [...html.matchAll(/<th scope="row" class="sh-season">(\d+)/g)]
      .map((m) => Number(m[1]));
    expect(seasons).toHaveLength(2);
    expect(html.match(/<th\b/g)).toHaveLength(4 + d1.length + seasons.length);

    expect(seasons).toEqual([...seasons].sort((a, b) => b - a));

    // Every champion of the newer season is linked from its own column.
    for (const tid of Object.values(champions(1))) expect(html).toContain(linkTo(tid, 2));
  });

  it("shows the season in progress as soon as its continental finals are played", () => {
    // Both finals land before the offseason, so the season has no history entry
    // and no league champions yet. Holding the row back would hide them.
    const html = render({
      ...base,
      seasonHistory: [entry(1, {})],
      cup: cup({ season: 2, championTid: 3 }),
      shield: cup({ season: 2, championTid: 9, competition: "shield", name: "Continental Shield" }),
    });
    expect(html).toContain(base.teams.find((t) => t.tid === 3)!.name);
    expect(html).toContain(base.teams.find((t) => t.tid === 9)!.name);
    // The marker saying the season isn't settled yet.
    expect(html).toContain("(now)");
  });

  it("defaults to league champions and offers the domestic cup view", () => {
    // Render tests can only reach the open tab (tab state, no DOM env), so the
    // cup view's own correctness rests on core/seasonSummary.ts. What has to
    // hold here is that the control exists and the default is the leagues.
    const d1 = base.competitions.filter((c) => c.tier === 1)[0];
    const leagueChampion = base.teams.find((t) => t.compId === d1.id)!.tid;
    const cupWinner = base.teams.find((t) => t.compId === d1.id && t.tid !== leagueChampion)!.tid;
    const html = render({
      ...base,
      cup: null,
      shield: null,
      seasonHistory: [entry(1, { [d1.id]: leagueChampion })],
      domesticCups: [domestic({ season: 1, country: d1.country, championTid: cupWinner })],
    });
    expect(html).toContain(linkTo(leagueChampion, 1));
    expect(html).not.toContain(linkTo(cupWinner, 1));
    expect(html).toContain("Domestic cup winners");
  });

  it("names each confederation champion of one offseason with its own code", () => {
    // Several are decided at once and shown side by side, so the cell has to
    // say which is which — three unlabelled flags would be unreadable.
    const html = render({
      ...base,
      cup: null,
      shield: null,
      seasonHistory: [entry(6, {})],
      international: {
        ...base.international,
        confederationCupHistory: [
          {
            season: 6, name: "European Championship", confederation: "Europe",
            champion: "Spain", runnerUp: "Italy",
            finalScore: { champion: 2, runnerUp: 1, pens: null },
            topScorer: null, field: [], groups: [], knockout: [],
          },
          {
            season: 6, name: "Africa Cup of Nations", confederation: "Africa",
            champion: "Ghana", runnerUp: "Senegal",
            finalScore: { champion: 1, runnerUp: 0, pens: null },
            topScorer: null, field: [], groups: [], knockout: [],
          },
        ],
      },
    });
    expect(html).toContain(">EUR<");
    expect(html).toContain(">AFR<");
    expect(html).toContain("Spain");
    expect(html).toContain("Ghana");
    // The full name and the final score live in the cell's title.
    expect(html).toContain("Africa Cup of Nations: Ghana beat Senegal 1-0");
  });

  it("renders for a spectator save, which has no club to mark", () => {
    // The route is deliberately not ClubOnly: this is a record of the whole
    // world, which a save with nobody in charge has as much of as a managed
    // one. userTid is a sentinel no club holds, so nothing gets highlighted.
    const d1 = base.competitions.filter((c) => c.tier === 1)[0];
    const champion = base.teams.find((t) => t.compId === d1.id)!.tid;
    const html = render({
      ...base,
      meta: { ...base.meta, userTid: SPECTATOR_TID },
      cup: null,
      shield: null,
      seasonHistory: [entry(1, { [d1.id]: champion })],
    });
    expect(html).toContain(linkTo(champion, 1));
    expect(html).not.toContain("sh-own");
  });

  it("marks a title won by your own club", () => {
    const d1 = base.competitions.filter((c) => c.tier === 1)[0];
    const html = render({
      ...base,
      cup: null,
      shield: null,
      seasonHistory: [entry(1, { [d1.id]: base.meta.userTid })],
    });
    expect(html).toContain("sh-own");
  });
});
