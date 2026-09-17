import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { StandingsRow } from "../../src/core/standings.js";
import type { CupState } from "../../src/core/cup/types.js";
import type { Composites } from "../../src/engine/composites.js";
import type { MatchPlayer } from "../../src/engine/attribution.js";
import type { TeamMatchData } from "../../src/core/league/composites.js";
import { buildCupState, playoffDue, dueCupLeg } from "../../src/core/cup/cup.js";
import { leaguePhaseDue } from "../../src/core/cup/leaguePhase.js";
import { playKnockoutLeg, playPlayoff, playLeaguePhaseRound } from "../../src/core/cup/simCup.js";
import { CONTINENTAL_CUP_FORMAT } from "../../src/core/constants.js";
import { DEFAULT_CONTINENTAL_FORMAT, type ContinentalFormatSettings } from "../../src/core/cup/cupShape.js";

/**
 * Render harness for the continental cup page in each God Mode format, plus the
 * God Mode tab itself. No DOM env here, so this catches a page-level throw and
 * checks the page names each format's stages the way the format plays them.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };
const setFormat = vi.fn();

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false, godModeSetContinentalFormatAction: setFormat }),
}));

const { Cup } = await import("../../src/ui/pages/Cup.js");
const { ContinentalFormats } = await import("../../src/ui/pages/GodModeContinental.js");

function render(league: LeagueStore, el: Parameters<typeof createElement>[0]): string {
  leagueRef.current = league;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(el)));
}

/** Final tables in tid order, so the draw is deterministic. */
function tables(league: LeagueStore): Map<number, StandingsRow[]> {
  const out = new Map<number, StandingsRow[]>();
  for (const c of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === c.id).map((t) => t.tid);
    out.set(c.id, tids.map((tid, i) => ({
      tid, played: 38, won: 0, drawn: 0, lost: 0, gf: 90 - i, ga: 0, gd: 90 - i, points: 90 - i,
    })));
  }
  return out;
}

function fakeMatchData(tid: number): TeamMatchData {
  const s = 0.45;
  const composites: Composites = { name: `T${tid}`, attack: s, finishing: s, defense: s, keeping: s, control: s };
  const positions: MatchPlayer["pos"][] = ["GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST"];
  const xi: MatchPlayer[] = positions.map((pos, i) => ({
    pid: tid * 100 + i, pos, slot: pos, secondary: [], ovr: 70, shooting: 70, dribbling: 70,
    tackling: 70, keeping: 70, positioning: 70, heading: 70, stamina: 80, interceptions: 70, passing: 70,
  }));
  return { composites, xi, bench: [], recompute: () => composites };
}

/** Play the cup up to and including `lastMatchday`. */
function playTo(cup: CupState, lastMatchday: number): CupState {
  const md = new Map(cup.leaguePhase!.teams.map((tid) => [tid, fakeMatchData(tid)]));
  let c = cup;
  for (let d = 1; d <= lastMatchday; d++) {
    if (c.leaguePhase && leaguePhaseDue(c.leaguePhase, d)) c = playLeaguePhaseRound(c, md, 1, d).cup;
    else if (playoffDue(c, d)) c = playPlayoff(c, md, 1).cup;
    else if (dueCupLeg(c, d)) c = playKnockoutLeg(c, md, 1, d).cup;
  }
  return c;
}

describe("continental cup page in each format", () => {
  const base = makeLeague(0, 1);
  const draw = (settings: ContinentalFormatSettings): CupState =>
    buildCupState(base.competitions, tables(base), base.season, CONTINENTAL_CUP_FORMAT, {}, settings)!;

  it("draws a groups-format cup as group tables, then a Round of 16", () => {
    const cup = draw({ ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups" });
    const drawn = render({ ...base, cup }, Cup);
    expect(drawn).toContain("Group stage");
    expect(drawn).toContain("Group H");
    expect(drawn).toContain("groups of four");

    const midway = render({ ...base, cup: playTo(cup, 26) }, Cup);
    expect(midway).toContain("Round of 16");
    expect(midway).toContain("go through");

    const done = render({ ...base, cup: playTo(cup, 38) }, Cup);
    expect(done).toContain("Champions");
  });

  it("draws a straight knockout with no table and a preliminary round", () => {
    // 32 clubs into a Round of 16: every club plays a preliminary tie.
    const cup = draw({ ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout" });
    const html = render({ ...base, cup }, Cup);
    expect(html).not.toContain("League Phase");
    expect(html).toContain("Preliminary round");
    expect(render({ ...base, cup: playTo(cup, 38) }, Cup)).toContain("Champions");
  });

  it("says how many rounds a longer league phase has", () => {
    const cup = draw({ ...DEFAULT_CONTINENTAL_FORMAT, leaguePhaseGames: 8, knockoutSize: 16 });
    expect(render({ ...base, cup }, Cup)).toContain("the 8 league-phase rounds");
    expect(render({ ...base, cup: playTo(cup, 38) }, Cup)).toContain("Champions");
  });

  it("tells you when next season's format differs from this one", () => {
    const cup = draw({ ...DEFAULT_CONTINENTAL_FORMAT });
    const html = render({
      ...base, cup, continentalFormats: { continental: { ...DEFAULT_CONTINENTAL_FORMAT, twoLegged: false } },
    }, Cup);
    expect(html).toContain("From next season:");
  });

  it("stays quiet when next season plays the same custom format as this one", () => {
    const groups = { ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups" as const };
    const html = render({ ...base, cup: draw(groups), continentalFormats: { continental: groups } }, Cup);
    expect(html).toContain("8 groups of four");
    expect(html).not.toContain("From next season");
  });

  it("says so when a custom cup goes back to the game's own format", () => {
    const cup = draw({ ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout" });
    const html = render({ ...base, cup }, Cup);
    expect(html).toContain("From next season: 32 clubs in one league phase");
  });
});

describe("God Mode cup formats tab", () => {
  const base = makeLeague(0, 1);

  it("lists each competition this world plays with presets and a preview", () => {
    const html = render({ ...base, godMode: true }, ContinentalFormats);
    expect(html).toContain("Continental Cup");
    expect(html).toContain("Continental Shield");
    expect(html).toContain("Groups and a Round of 16");
    expect(html).toContain("Next season:");
    expect(html).not.toContain("Changed");
  });

  it("marks a competition whose format has been changed", () => {
    const html = render({
      ...base, godMode: true,
      continentalFormats: { shield: { ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout" } },
    }, ContinentalFormats);
    expect(html).toContain("Changed");
    expect(html).toContain("Straight knockout:");
  });
});
