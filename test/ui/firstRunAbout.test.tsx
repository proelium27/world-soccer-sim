import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { USER_ACADEMY_ENTRY_AGE } from "../../src/core/constants.js";

/**
 * The homepage's search copy. It only renders on the first-run view (no saves),
 * which is also what a crawler gets, so what this pins is that the block names
 * the game the way people search for it, follows the sport-name choice, and
 * quotes the academy age from constants rather than a typed-in number.
 */
vi.mock("../../src/ui/sportName.js", () => ({
  useSportName: () => ({ brand: "World Soccer Simulator", term: "Soccer", choose: () => {} }),
}));

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    loadLeagueAction: () => {},
    customizeTeamsAction: () => {},
    importJSON: () => {},
  }),
}));

describe("FirstRunAbout", () => {
  it("describes the game in the terms people search for", async () => {
    const { FirstRunAbout } = await import("../../src/ui/pages/Leagues.js");
    const html = renderToStaticMarkup(createElement(FirstRunAbout, { sport: "soccer" }));
    expect(html).toContain("same idea for soccer");
    expect(html).toContain("management sim");
    expect(html).toContain("Basketball GM");
    expect(html).toContain(`academy at ${USER_ACADEMY_ENTRY_AGE}`);
  });

  it("follows the football naming choice", async () => {
    const { FirstRunAbout } = await import("../../src/ui/pages/Leagues.js");
    const html = renderToStaticMarkup(createElement(FirstRunAbout, { sport: "football" }));
    expect(html).toContain("same idea for football");
    expect(html).not.toContain("soccer");
  });

  it("stays off the page until the save list is known to be empty", async () => {
    // Server render: the save list hasn't loaded, so this is neither first run
    // nor a save list, and the pitch must not flash up for returning players.
    const { Leagues } = await import("../../src/ui/pages/Leagues.js");
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/leagues"] }, createElement(Leagues)),
    );
    expect(html).not.toContain("How a season plays");
  });
});
