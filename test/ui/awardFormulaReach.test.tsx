import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { AWARD_PRESETS, DEFAULT_AWARD_FORMULA, type AwardFormula } from "../../src/core/awardFormula.js";

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
const { AwardFormulas, inForwardGoals } = await import("../../src/ui/pages/GodModeAwards.js");

const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, el));

describe("the award formula editor is reachable", () => {
  it("offers an Awards tab in God Mode", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    expect(render(createElement(GodMode))).toMatch(/<button[^>]*>Awards<\/button>/);
  });

  it("opens on the shipped style, with every preset offered and the numbers folded away", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    const html = render(createElement(AwardFormulas));
    for (const p of AWARD_PRESETS) expect(html).toContain(`id="award-preset-${p.id}"`);
    expect(html).toMatch(/id="award-preset-shipped"[^>]*checked=""/);
    // Fine-tune starts closed when a style describes the save.
    expect(html).toMatch(/<details class="gm-panel mb-3">/);
    // The numbers are still in the page, behind the disclosure.
    expect(html).toContain(`id="award-minAppearances"`);
    expect(html).toContain(`value="${DEFAULT_AWARD_FORMULA.minAppearances}"`);
    expect(html).toContain(`id="award-world-leagueTitleBonus"`);
    expect(html).toMatch(/Using the game.{1,6}s own formula/);
  });

  it("says a save with no finished season has nothing to preview yet", () => {
    leagueRef.current = { ...makeLeague(0, 1), godMode: true };
    expect(render(createElement(AwardFormulas))).toContain("Once a season has finished");
  });

  it("loads a hand-tuned formula as custom, with the numbers open", () => {
    const awardFormula = structuredClone(DEFAULT_AWARD_FORMULA) as AwardFormula;
    awardFormula.minAppearances = 7;
    leagueRef.current = { ...makeLeague(0, 1), godMode: true, awardFormula };
    const html = render(createElement(AwardFormulas));
    expect(html).toMatch(/id="award-minAppearances"[^>]*value="7"|value="7"[^>]*id="award-minAppearances"/);
    expect(html).toMatch(/<details class="gm-panel mb-3" open="">/);
    expect(html).toContain("Custom: your own numbers");
    expect(html).toContain("Using your custom formula.");
  });

  it("recognises a saved preset rather than calling it custom", () => {
    const goals = AWARD_PRESETS.find((p) => p.id === "goals")!;
    leagueRef.current = { ...makeLeague(0, 1), godMode: true, awardFormula: structuredClone(goals.formula) as AwardFormula };
    const html = render(createElement(AwardFormulas));
    expect(html).toMatch(/id="award-preset-goals"[^>]*checked=""/);
    expect(html).not.toContain("Custom: your own numbers");
  });
});

describe("explaining a weight in forward goals", () => {
  it("reads a league title against a forward's goal", () => {
    expect(inForwardGoals(0.8, DEFAULT_AWARD_FORMULA)).toBe("about 10 goals by a forward");
    expect(inForwardGoals(0.08, DEFAULT_AWARD_FORMULA)).toBe("about 1 goal by a forward");
  });

  it("falls back to award points when forwards' goals are worth nothing", () => {
    const f = structuredClone(DEFAULT_AWARD_FORMULA) as AwardFormula;
    f.goalWeight.FWD = 0;
    expect(inForwardGoals(0.8, f)).toBe("0.8 award points");
  });
});
