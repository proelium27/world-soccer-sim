import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportChecklist } from "../../src/ui/components/ImportChecklist.js";
import { DEFAULT_IMPORT_SELECTION, type RosterFileContents } from "../../src/core/teams/leagueFile.js";

const contents = (squads: number, logos: number): RosterFileContents => ({
  competitions: [
    { key: "english division 1", match: "English Division 1", clubs: 20, squads, logos },
    { key: "eredivisie plus", match: "Eredivisie Plus", clubs: 18, squads: 0, logos: 0 },
  ],
  clubs: 38,
  squads,
  logos,
});

const render = (c: RosterFileContents, excluded: string[] = []) =>
  renderToStaticMarkup(
    <ImportChecklist
      contents={c}
      selection={{ ...DEFAULT_IMPORT_SELECTION, excluded: new Set(excluded) }}
      unplaceable={new Set(["eredivisie plus"])}
      onChange={() => {}}
    />,
  );

describe("ImportChecklist", () => {
  it("only offers the kinds of thing the file holds", () => {
    const bare = render(contents(0, 0));
    expect(bare).toContain("Club names and abbreviations");
    expect(bare).toContain("Club colors");
    expect(bare).not.toContain("import-squads");
    expect(bare).not.toContain("import-logos");

    const full = render(contents(20, 20));
    expect(full).toContain("Squads (20 clubs)");
    expect(full).toContain("Badges (20 clubs)");
  });

  it("lists every league, and a league this world lacks can't be ticked", () => {
    const html = render(contents(20, 0));
    expect(html).toMatch(/id="import-league-english division 1" checked=""/);
    expect(html).toMatch(/id="import-league-eredivisie plus" disabled=""/);
    expect(html).toContain("(not in this world)");
  });

  it("shows an unticked league as unticked", () => {
    const html = render(contents(20, 0), ["english division 1"]);
    expect(html).not.toMatch(/id="import-league-english division 1" checked=""/);
  });
});
