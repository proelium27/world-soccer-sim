import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ROSTER_FILE_FORMAT, type RosterFile } from "../../src/core/teams/rosterFile.js";
import { setPendingRoster } from "../../src/ui/pendingRoster.js";
import { NewLeague } from "../../src/ui/pages/NewLeague.js";
import { clubIdentitiesFor } from "../../src/core/teams/clubs.js";
import { worldCompetitions, competitionTeamCount } from "../../src/core/competitions.js";

/**
 * The world editor has to be reachable from the roster-import flow, not just the
 * plain one.
 *
 * It used to be hidden there on purpose, and the reason was real: the page held
 * the file's clubs already *resolved* onto slots, so reshaping the world under a
 * loaded file left that resolution pointing at the wrong clubs. The fix was to
 * hold only the files and resolve against the world as it currently stands, and
 * this pins the visible half of that — because the thing a player most needs to
 * do with a file the world doesn't fit is add the league it was written for, and
 * that control was on the one screen they couldn't reach.
 *
 * Server rendering does not run error boundaries (React re-throws to the
 * caller), so a throw on this page surfaces here as a failure.
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
    setLeague: () => {},
    importJSON: () => {},
    refresh: () => {},
    simming: false,
  }),
}));

/** A roster file naming one competition — by default one this world hasn't got. */
function rosterFile(match = "Eredivisie"): RosterFile {
  return {
    format: ROSTER_FILE_FORMAT,
    formatVersion: 1,
    competitions: [{
      match,
      clubs: [
        { name: "Amsterdam XI", abbrev: "AMS", colors: ["#e74c3c", "#ffffff"] },
        { name: "Rotterdam Port", abbrev: "ROT", colors: ["#1b4f72", "#f4d03f"] },
      ],
    }],
  };
}

/**
 * Imported once rather than re-imported per case behind vi.resetModules(): the
 * handoff is a module variable, and a reset can hand the page a *different*
 * instance of that module from the one the test just wrote to, which made this
 * file fail on some runs and pass on others. Nothing leaks between cases —
 * takePendingRoster clears as it reads, and every case sets its own.
 */
function renderNewLeague(
  url: string,
  handoff?: { name: string; file: RosterFile }[],
): string {
  if (handoff) setPendingRoster({ files: handoff });
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(NewLeague)),
  );
}

/**
 * Lives here rather than in a file of its own so it can reuse the harness and
 * the two module mocks above — a third copy of those would be a worse trade than
 * a second describe block.
 */
describe("the club picker shows one division at a time", () => {
  // The same lookup the page uses. England's slots are its divisions in tier
  // order, so index 0 is a first-division club, index 20 a second, and the
  // last entry a third — sized off the real table rather than a literal, which
  // is what let this fixture keep passing while a whole division went missing.
  const england = clubIdentitiesFor(
    "England",
    worldCompetitions()
      .filter((c) => c.country === "England")
      .reduce((n, c) => n + competitionTeamCount(c), 0),
  );

  it("lists the first division and not the second", () => {
    const html = renderNewLeague("/new-league");
    expect(html).toContain(england[0].name);
    // Forty club rows buried everything under the picker, and the two divisions
    // are alternatives rather than one list to read end to end.
    expect(html).not.toContain(england[20].name);
  });

  it("offers every division as a tab, so the others are reachable", () => {
    const html = renderNewLeague("/new-league");
    expect(html).toContain('aria-label="Choose a division"');
    // One tab per division the COUNTRY runs, derived from its clubs rather than
    // from a fixed pair. The third division was invisible here when this was
    // hardcoded to two: its clubs exist, and no tab reached them.
    for (const comp of worldCompetitions().filter((c) => c.country === "England")) {
      expect(html).toContain(comp.name);
    }
  });

  it("draws one tab per division, not a fixed two", () => {
    // The count is the assertion. Three names could all appear while only two
    // were clickable — which is exactly the state this was in, since the tabs
    // were a literal [1, 2] and the third division's clubs were filtered out
    // of the list with no way to reach them. There is no DOM here to click a
    // tab with, so the tab COUNT is what stands in for reachability.
    const html = renderNewLeague("/new-league");
    // Scoped to the division group: the page carries aria-pressed buttons for
    // the country tabs and the difficulty picker too, and counting all of them
    // reads 19 rather than 3.
    const group = html.slice(
      html.indexOf('aria-label="Choose a division"'),
      html.indexOf("list-group picker-columns"),
    );
    const tabs = (group.match(/aria-pressed=/g) ?? []).length;
    const divisions = worldCompetitions().filter((c) => c.country === "England").length;
    expect(divisions).toBe(3);
    expect(tabs).toBe(divisions);
  });
});

describe("the New League screen offers the world editor", () => {
  it("shows it once a roster file has been imported", () => {
    const html = renderNewLeague("/new-league?roster=1", [
      { name: "netherlands.json", file: rosterFile() },
    ]);
    expect(html).toContain("netherlands.json");
    expect(html).toContain("World setup");
    expect(html).toContain("Add a league");
  });

  it("says what to do about a league the world hasn't got", () => {
    const html = renderNewLeague("/new-league?roster=1", [
      { name: "netherlands.json", file: rosterFile() },
    ]);
    // The file names a competition this world has no equivalent of, so every
    // club in it is skipped — and the fix (rename a league, or add one) is on
    // this same screen.
    expect(html).toContain("Eredivisie");
    expect(html).toContain("skipped");
    expect(html).toContain("World setup");
  });

  it("shows it on the plain New League screen too", () => {
    const html = renderNewLeague("/new-league");
    expect(html).toContain("World setup");
    // Offered, but shut: the editor is a tall block and this page is for
    // picking a club. What has to be present is the way in, plus the summary
    // that says what world you would get without opening it.
    expect(html).toContain('aria-controls="world-setup-body"');
    expect(html).toContain("16 countries, 48 divisions, 872 clubs");
    expect(html).not.toContain("Add a league");
  });

  it("opens the editor for a roster import, since that is where the fix lives", () => {
    // A file naming a league this world hasn't got is skipped entirely, and
    // adding or renaming a league in the editor is the only thing that makes it
    // apply — so collapsing it here would hide the cure behind a card the
    // warning merely points at.
    const html = renderNewLeague("/new-league?roster=1", [
      { name: "netherlands.json", file: rosterFile() },
    ]);
    expect(html).toContain("Add a league");
  });

  it("offers roster files from the plain screen, so both ways in do the same things", () => {
    const html = renderNewLeague("/new-league");
    expect(html).toContain("Load roster files");
  });

  it("still shows the file picker first when roster mode starts empty", () => {
    const html = renderNewLeague("/new-league?roster=1");
    expect(html).toContain("Choose Roster Files");
    // The explainer screen, not the club picker: the world editor comes with the
    // step that has a world to show.
    expect(html).not.toContain("World setup");
  });

  it("resolves a file against the world rather than a fixed one", () => {
    // A file aimed at a league the world DOES have lands on its clubs, which is
    // the same resolution path the reshaped-world case relies on.
    const html = renderNewLeague("/new-league?roster=1", [
      { name: "england.json", file: rosterFile("English Division 1") },
    ]);
    expect(html).toContain("Amsterdam XI");
    // The clubs landed, so no unmatched-competition warning — as distinct from
    // the standing hint, which explains what skipping means and always shows.
    expect(html).not.toContain("No competition named");
  });
});
