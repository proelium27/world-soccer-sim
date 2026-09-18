import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

/**
 * Render harness for the download link on the Import Custom League screen.
 *
 * `rosterDownload.ts` is unit-tested separately for what it makes of the
 * environment value; what this pins is the half that can't be checked there —
 * that the screen actually renders an anchor pointing at the URL when one is
 * configured, and renders nothing at all when one isn't.
 *
 * The two directions matter for different reasons. A missing link when the URL
 * is set is a dead feature nobody notices. A rendered link when the URL is
 * unset is a 404 behind a "Download" button, which is worse, and it is the
 * failure a careless refactor of the `&&` would produce.
 *
 * `ROSTER_DOWNLOAD_URL` is a module-load constant, so each case resets the
 * module registry and re-imports the page underneath it.
 */
// The real provider reads localStorage on mount, which this node test env
// doesn't have. Only `brand` is read by the page under test.
vi.mock("../../src/ui/sportName.js", () => ({
  useSportName: () => ({ brand: "World Soccer Simulator", term: "soccer", choose: () => {} }),
}));

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: null,
    leagues: [],
    createLeagueAction: () => {},
    customizeTeamsAction: () => {},
    importJSON: () => {},
    refresh: () => {},
    simming: false,
  }),
}));

async function renderLeaguesPage(url?: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv("VITE_ROSTER_DOWNLOAD_URL", url ?? "");
  const { Leagues } = await import("../../src/ui/pages/Leagues.js");
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/leagues"] }, createElement(Leagues)),
  );
}

async function renderImportScreen(url?: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv("VITE_ROSTER_DOWNLOAD_URL", url ?? "");
  const { NewLeague } = await import("../../src/ui/pages/NewLeague.js");
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/new-league?roster=1"] },
      createElement(NewLeague),
    ),
  );
}

/**
 * The Leagues page is the placement that matters: its Import button is a file
 * picker, so anyone who still needs a file is standing here rather than on the
 * import screen (which is only reached once a file has been parsed). A missing
 * link here is the whole feature missing, which is why it gets its own cases.
 */
describe("Roster files section on the Leagues page", () => {
  const URL_ = "https://example.com/rel/real-clubs-and-players.json";

  it("offers all three files, the two extras as siblings of the configured URL", async () => {
    const html = await renderLeaguesPage(URL_);
    expect(html).toContain("Roster files");
    expect(html).toContain('href="https://example.com/rel/real-clubs-and-players.json"');
    expect(html).toContain('href="https://example.com/rel/real-club-names.json"');
    expect(html).toContain('href="https://example.com/rel/real-club-badges.json"');
    for (const title of ["Real clubs and players", "Real club names", "Real club badges"]) {
      expect(html).toContain(title);
    }
  });

  it("opens each download in a new tab without handing the opener over", async () => {
    const html = await renderLeaguesPage(URL_);
    expect(html.match(/target="_blank"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("noopener");
  });

  // A section of buttons that 404 is worse than no section: a build with no
  // URL (CrazyGames) must render none of it.
  it("renders no section at all when the build has no URL", async () => {
    const html = await renderLeaguesPage();
    expect(html).not.toContain("Roster files");
    expect(html).not.toContain("real-club-badges.json");
    expect(html).not.toContain("Real clubs and players");
  });

  it("keeps the Import button either way", async () => {
    expect(await renderLeaguesPage()).toContain("Import");
    expect(await renderLeaguesPage(URL_)).toContain("Import");
  });
});

describe("roster download link on the import screen", () => {
  it("renders an anchor to the configured URL", async () => {
    const html = await renderImportScreen("https://example.com/real-players-teams.json");
    expect(html).toContain('href="https://example.com/real-players-teams.json"');
    expect(html).toContain("Download roster file");
  });

  it("opens in a new tab without handing the opener over", async () => {
    const html = await renderImportScreen("https://example.com/real-players-teams.json");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("renders no link at all when the build has no URL", async () => {
    const html = await renderImportScreen();
    expect(html).not.toContain("Download roster file");
    expect(html).not.toContain("Don't have one yet?");
    expect(html).not.toContain("Updated for EA FC 27");
  });

  it("carries the same note as the Leagues page when there is a URL", async () => {
    expect(await renderImportScreen("https://example.com/r.json")).toContain(
      "Updated for EA FC 27",
    );
  });

  it("still offers the file picker either way", async () => {
    expect(await renderImportScreen()).toContain("Choose Roster Files");
    expect(await renderImportScreen("https://example.com/r.json")).toContain(
      "Choose Roster Files",
    );
  });
});
