import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { DEFAULT_AWARD_FORMULA, type AwardFormula } from "../../src/core/awardFormula.js";

/**
 * The award formula editor is only reachable through God Mode, so a tab that
 * quietly stopped rendering would leave the feature gone with nothing else
 * failing. Server rendering can't click a tab, so the page check is that the tab
 * is offered and the panel is rendered on its own below (the same split
 * `progressionSettingReach.test.tsx` makes). Matched on control ids, not prose.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    crests: new Map(),
    simming: false,
    godModeSetAwardFormulaAction: () => {},
    godModeSetProgressionModelAction: () => {},
    godModeSwitchClubAction: () => {},
    godModeTakeNationalJobAction: () => {},
    leaveNationalJobAction: () => {},
    movePlayerToClubAction: () => {},
    releasePlayerGodModeAction: () => {},
    setClubFinancesAction: () => {},
    createPlayerAction: () => {},
    setLeague: () => {},
  }),
}));

vi.mock("../../src/ui/sportName.js", () => ({
  useSportName: () => ({ choice: "football", term: "Football", brand: "World Football Simulator" }),
}));

const { GodMode } = await import("../../src/ui/pages/GodMode.js");
const { AwardFormulas } = await import("../../src/ui/pages/GodModeAwards.js");

const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, el));

describe("the award formula editor is reachable", () => {
  it("offers an Awards tab in God Mode", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    expect(render(createElement(GodMode))).toMatch(/<button[^>]*>Awards<\/button>/);
  });

  it("opens on the shipped formula for a save that never edited it", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    const html = render(createElement(AwardFormulas));
    expect(html).toContain(`id="award-minAppearances"`);
    expect(html).toContain(`value="${DEFAULT_AWARD_FORMULA.minAppearances}"`);
    expect(html).toContain(`id="award-work-CB"`);
    expect(html).toContain(`id="award-world-leagueTitleBonus"`);
    expect(html).toContain("shipped award formulas");
  });

  it("loads a stored edit and says the save is custom", () => {
    const awardFormula = structuredClone(DEFAULT_AWARD_FORMULA) as AwardFormula;
    awardFormula.minAppearances = 7;
    leagueRef.current = { ...makeLeague(0, 1), godMode: true, awardFormula };
    const html = render(createElement(AwardFormulas));
    expect(html).toMatch(/id="award-minAppearances"[^>]*value="7"|value="7"[^>]*id="award-minAppearances"/);
    expect(html).toContain("custom award formulas");
  });
});
