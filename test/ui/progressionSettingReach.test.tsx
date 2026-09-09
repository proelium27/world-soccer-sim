import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * The development-model setting has to be reachable from two places, and the
 * second one is the point of the feature rather than a convenience.
 *
 * New League is where it is chosen. God Mode is where it can be *changed*, which
 * is the whole reason it is modelled as safe-to-flip state instead of a
 * creation-time decision like `difficulty` and `rollingCoefficients` beside it:
 * somebody twenty seasons into a dynasty who wants the other model should not
 * have to start over. A God Mode tab that quietly stopped rendering would leave
 * that promise broken with nothing failing, since every other route to the
 * field still works.
 *
 * Matched on the control's `id`, not on its label text. Both screens carry
 * paragraphs of prose describing the setting, and every phrase in the label
 * appears in that prose too, so a substring check on the words would pass
 * against a screen whose switch had been deleted.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    crests: new Map(),
    simming: false,
    godModeSetProgressionModelAction: () => {},
    godModeSwitchClubAction: () => {},
    godModeTakeNationalJobAction: () => {},
    leaveNationalJobAction: () => {},
    movePlayerToClubAction: () => {},
    releasePlayerGodModeAction: () => {},
    setClubFinancesAction: () => {},
    createPlayerAction: () => {},
    applyPlayerEditAction: () => {},
    setLeague: () => {},
  }),
}));

vi.mock("../../src/ui/sportName.js", () => ({
  useSportName: () => ({ choice: "football", term: "Football", brand: "World Football Simulator" }),
}));

const { GodMode, Development } = await import("../../src/ui/pages/GodMode.js");

describe("the development setting is reachable", () => {
  /**
   * God Mode renders nothing at all unless the sandbox is switched on, so the
   * flag is half of what this stands up. Server rendering cannot click a tab,
   * so the page-level check is that the tab is offered and the panel is checked
   * on its own below.
   */
  it("offers a Development tab on a save already in progress", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(GodMode)),
    );
    expect(html).toContain("Development");
  });

  it("puts the switch on that panel, reflecting the save's current model", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true, progressionModel: "random" };
    const off = renderToStaticMarkup(createElement(Development));
    expect(off).toContain("god-steady-progression");
    expect(off).not.toContain("checked=\"\"");

    leagueRef.current = { ...makeLeague(0, 1), godMode: true, progressionModel: "steady" };
    const on = renderToStaticMarkup(createElement(Development));
    expect(on).toContain("checked=\"\"");
  });

  /**
   * The one claim on this panel a user acts on: it is safe to flip mid-dynasty.
   * If that copy ever goes, the setting reads as something that might rewrite
   * the save's history, which is exactly what it does not do.
   */
  it("says when the change takes effect", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    const html = renderToStaticMarkup(createElement(Development));
    expect(html).toContain("next offseason");
  });
});
