import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorldSetup, LeagueSettings, defaultWorldEntries, includedSpecs, leagueRosterFiles,
  strengthDial, strengthOffsetFromDial, type WorldEntry,
} from "../../src/ui/components/WorldSetup.js";
import {
  buildCompetitions, countriesOf, worldCompetitions, competitionStrengthOffset,
} from "../../src/core/competitions.js";
import { PROMOTION_RELEGATION_COUNT } from "../../src/core/constants.js";
import type { RosterFile } from "../../src/core/teams/rosterFile.js";
import { ROSTER_FILE_FORMAT } from "../../src/core/teams/rosterFile.js";

/** A roster file naming one competition with `clubs` clubs in it. */
function rosterFile(match: string, clubs: number): RosterFile {
  return {
    format: ROSTER_FILE_FORMAT,
    formatVersion: 1,
    competitions: [{
      match,
      clubs: Array.from({ length: clubs }, (_, i) => ({
        name: `Club ${i + 1}`,
        abbrev: `C${i + 1}`,
        colors: ["#101010", "#f0f0f0"] as [string, string],
      })),
    }],
  };
}

/**
 * Render harness for the world editor. Typecheck can't reach a render path, and
 * this component is the one place a player shapes a world before it exists, so a
 * throw here would take out the New League screen entirely.
 *
 * Server rendering does NOT run error boundaries (React re-throws to the
 * caller), so a raw throw surfaces as a failure regardless of the boundaries
 * App and Layout install.
 */
// Opened, because every test below is about what the editor CONTAINS. The card
// ships collapsed on the New League page (the club picker is what that page is
// for), and a closed card renders only its summary header — so rendering shut
// would assert nothing about the controls these tests exist to pin. The
// "the card can be collapsed" block at the bottom covers the shut state itself.
function render(entries: WorldEntry[]): string {
  return renderToStaticMarkup(
    createElement(WorldSetup, { entries, onChange: () => {}, defaultOpen: true }),
  );
}

/** The shipped countries plus one added league, expanded (its sliders shown). */
function withAddedLeague(): WorldEntry[] {
  return [
    ...defaultWorldEntries(),
    {
      id: "added:test",
      spec: {
        country: "Neverland",
        strengthOffset: 8,
        budgetScale: 0.6,
        cupSlots: 2,
        shieldSlots: 2,
      },
      included: true,
      shipped: false,
      linkMoney: true,
    },
  ];
}

describe("WorldSetup renders", () => {
  it("renders the shipped world with every country listed and no warnings", () => {
    const html = render(defaultWorldEntries());
    for (const country of ["England", "Spain", "Italy", "Germany", "France", "Portugal", "Belgium", "Turkey"]) {
      expect(html).toContain(country);
    }
    expect(html).toContain("16 countries, 48 divisions, 872 clubs");
    expect(html).not.toContain("alert-warning");
  });

  it("renders an added league's settings", () => {
    const html = render(withAddedLeague());
    expect(html).toContain("Neverland");
    expect(html).toContain("Strength");
    expect(html).toContain("Money");
    expect(html).toContain("Continental Cup places");
    expect(html).toContain("Continental Shield places");
    expect(html).toContain("17 countries, 50 divisions, 912 clubs");
  });

  it("keeps the shipped rows collapsed, so eight panels don't bury the checkboxes", () => {
    // Shipped leagues have the same settings as added ones, but behind a button:
    // the list is mostly used to switch countries on and off, and eight open
    // panels would push those off the screen.
    const html = render(defaultWorldEntries());
    expect(html).not.toContain("Clubs promoted and relegated each season");
    // The added league's panel is open on sight, so exactly one picker shows.
    expect(render(withAddedLeague()).match(/Clubs promoted and relegated each season/g))
      .toHaveLength(1);
  });

  it("starts the picker at the count every shipped country plays", () => {
    const html = render(withAddedLeague());
    expect(html).toContain(`<option value="${PROMOTION_RELEGATION_COUNT}" selected="">`);
    expect(html).toContain("3 up, 3 down");
    expect(html).toContain("None");
  });

  it("caps the picker at half the league's own divisions", () => {
    const entries = withAddedLeague();
    const last = entries.length - 1;
    entries[last] = {
      ...entries[last],
      spec: { ...entries[last].spec, d1Teams: 8, d2Teams: 8, promotionSpots: 6 },
    };
    const html = render(entries);
    expect(html).toContain("4 up, 4 down");
    expect(html).not.toContain("5 up, 5 down");
    // A count the divisions can no longer carry shows as the one they can, so
    // the picker never reads back a number the world wouldn't build.
    expect(html).toContain('<option value="4" selected="">');
  });

  it("hides the picker on a one-division league, which has nothing to swap with", () => {
    const entries = withAddedLeague();
    const last = entries.length - 1;
    entries[last] = { ...entries[last], spec: { ...entries[last].spec, divisions: 1 } };
    expect(render(entries)).not.toContain("Clubs promoted and relegated each season");
  });

  it("renders the warning when money and strength disagree", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      linkMoney: false,
      spec: { ...entries[entries.length - 1].spec, budgetScale: 1.2 },
    };
    const html = render(entries);
    expect(html).toContain("alert-warning");
    expect(html).toContain("richer");
  });

  it("renders a world with countries switched off", () => {
    const entries = defaultWorldEntries().map((e, i) => ({ ...e, included: i < 2 }));
    const html = render(entries);
    expect(html).toContain("2 countries, 6 divisions, 120 clubs");
    // Two countries can't field the Continental Cup, and it says so.
    expect(html).toContain("Continental Cup");
  });

  it("renders an empty world without throwing", () => {
    const html = render(defaultWorldEntries().map((e) => ({ ...e, included: false })));
    expect(html).toContain("0 countries, 0 divisions, 0 clubs");
    expect(html).toContain("at least one league");
  });

  it("offers a roster import on each open panel", () => {
    const html = render(withAddedLeague());
    expect(html).toContain("Import roster");
    // One picker: the added league's panel is the only one open.
    expect(html.match(/Import roster/g)).toHaveLength(1);
  });

  it("offers a three-letter code box, suggesting one from the country name", () => {
    const html = render(withAddedLeague());
    expect(html).toContain('aria-label="Three-letter code"');
    // Neverland has no code set, so the box suggests NEV rather than pre-filling it.
    expect(html).toContain('placeholder="NEV"');
    expect(html).toContain('value=""');
  });

  it("keeps a code the player typed", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      spec: { ...entries[entries.length - 1].spec, abbrev: "NVL" },
    };
    expect(render(entries)).toContain('value="NVL"');
  });

  it("points at manual editing beside the roster import", () => {
    // Two ways to get your own clubs in, and the file picker is the one people
    // find first, so it says what the other one is.
    const html = render(withAddedLeague());
    expect(html).toContain("Name the clubs");
    expect(html).toContain("yourself");
  });

  it("collects the explanations under the controls rather than between them", () => {
    const html = render(withAddedLeague());
    const money = html.indexOf('aria-label="Money"');
    const cupPlaces = html.indexOf("Continental Cup places");
    // The paragraph explaining strength, money and up-and-down used to be the
    // thing sampled here. It was removed (2026-08-26, user call): the controls
    // say what they do in their own labels and options, and the Manual carries
    // the full explanation, so a paragraph restating them was noise in the most
    // cramped part of the panel. The layout guarantee it was pinning is still
    // real, so this now samples prose that exists — the sections that DO explain
    // themselves sit below every numeric control rather than in between them.
    const nationalityProse = html.indexOf("Who this league produces");
    expect(money).toBeGreaterThan(-1);
    expect(cupPlaces).toBeGreaterThan(-1);
    expect(cupPlaces).toBeGreaterThan(money);
    expect(nationalityProse).toBeGreaterThan(cupPlaces);
  });

  it("names the loaded files and counts their clubs", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      rosterSources: [{ name: "neverland.json", file: rosterFile("Top Flight", 3) }],
    };
    const html = render(entries);
    expect(html).toContain("neverland.json");
    expect(html).toContain("3 clubs");
    expect(html).toContain("Add another file");
  });

  it("offers to customize each shipped league", () => {
    // The shipped eight used to be editable in name only — you could rename
    // their divisions and nothing else — even though every knob is an optional
    // field whose absence means "use the country table", so writing one has
    // always been safe.
    //
    // The count is derived rather than written down: it was pinned at 8 and
    // failed the moment the world grew to twelve countries.
    const entries = defaultWorldEntries();
    expect(entries.length).toBeGreaterThan(1);
    expect(render(entries).match(/>Customize</g)).toHaveLength(entries.length);
  });

  it("doesn't offer to customize a league that's switched off", () => {
    const entries = defaultWorldEntries().map((e, i) => ({ ...e, included: i === 0 }));
    expect(render(entries).match(/>Customize</g)).toHaveLength(1);
  });

  it("gives an added league its division-name boxes, defaults as placeholders", () => {
    const html = render(withAddedLeague());
    expect(html).toContain('aria-label="Top division name"');
    expect(html).toContain('aria-label="Second division name"');
    // Absent rather than pre-filled, so a name keeps following the country
    // while it's untouched.
    expect(html).toContain('placeholder="Neverland Division 1"');
    expect(html).toContain('placeholder="Neverland Division 2"');
  });

  it("gives a three-division league a box for every tier", () => {
    // The shipped world runs three divisions in every country, so a control
    // that only ever drew two left the third unnameable — and mislabelled the
    // first as "League name", the wording meant for a country with one.
    const entries = withAddedLeague();
    const last = entries.length - 1;
    entries[last] = { ...entries[last], spec: { ...entries[last].spec, divisions: 3 } };
    const html = render(entries);
    expect(html).toContain('aria-label="Top division name"');
    expect(html).toContain('aria-label="Second division name"');
    expect(html).toContain('aria-label="Third division name"');
    expect(html).toContain('placeholder="Neverland Division 3"');
    expect(html).not.toContain('aria-label="League name"');
  });

  it("still asks how a three-division league settles its top promotion place", () => {
    // promotionPlayoffFields seats a playoff at the TOP link whatever the
    // pyramid's depth, so hiding the picker past two divisions hid a control
    // for a mechanic that runs regardless.
    const entries = withAddedLeague();
    const last = entries.length - 1;
    entries[last] = { ...entries[last], spec: { ...entries[last].spec, divisions: 3 } };
    const html = render(entries);
    expect(html).toContain('aria-label="How the last promotion place is decided"');
  });

  it("shows a name the player set", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      spec: { ...entries[entries.length - 1].spec, d1Name: "Eredivisie" },
    };
    expect(render(entries)).toContain('value="Eredivisie"');
  });

  it("asks for one name on a one-division league", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      spec: { ...entries[entries.length - 1].spec, divisions: 1 },
    };
    const html = render(entries);
    expect(html).toContain('aria-label="League name"');
    expect(html).not.toContain('aria-label="Second division name"');
  });
});

describe("the strength dial reads the way a player expects", () => {
  it("counts up toward stronger, opposite the engine's handicap", () => {
    // The engine stores a handicap: 0 is the top of the game, higher is weaker.
    // The control shows the reverse.
    expect(strengthDial(0)).toBe(20);
    expect(strengthDial(20)).toBe(0);
    expect(strengthDial(5)).toBe(15);
  });

  it("round-trips, so moving the slider can't drift the stored value", () => {
    for (let dial = 0; dial <= 20; dial++) {
      expect(strengthDial(strengthOffsetFromDial(dial))).toBe(dial);
    }
  });

  it("puts the shipped leagues where the table says they are", () => {
    const byCountry = new Map(
      worldCompetitions().filter((c) => c.tier === 1).map((c) => [c.country, c]),
    );
    expect(strengthDial(competitionStrengthOffset(byCountry.get("England")!))).toBe(20);
    expect(strengthDial(competitionStrengthOffset(byCountry.get("France")!))).toBe(15);
    expect(strengthDial(competitionStrengthOffset(byCountry.get("Portugal")!))).toBe(10);
    expect(strengthDial(competitionStrengthOffset(byCountry.get("Turkey")!))).toBe(8);
  });

  it("shows the baseline table beside the sliders it calibrates", () => {
    const html = render(withAddedLeague());
    expect(html).toContain("Where the leagues already in the game sit");
    // Every shipped country, with its dial value and its money scale.
    for (const country of ["England", "France", "Portugal", "Turkey"]) {
      expect(html).toContain(country);
    }
    expect(html).toContain("0.40");
    expect(html).toContain("1.00");
  });

  it("doesn't show it when there is no league being set up", () => {
    // It belongs to the per-league editor, so a world of shipped countries only
    // — none of which are editable — has nothing to calibrate against.
    expect(render(defaultWorldEntries())).not.toContain("Where the leagues already in the game sit");
  });
});

describe("per-league roster files are retargeted onto their own league", () => {
  it("points a file at the divisions of the league it was attached to", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      rosterSources: [{ name: "a.json", file: rosterFile("Whatever It Was Called", 2) }],
    };
    const competitions = buildCompetitions(includedSpecs(entries));
    const { files } = leagueRosterFiles(entries, competitions);

    expect(files).toHaveLength(1);
    expect(files[0].file.competitions[0].match).toBe("Neverland Division 1");
    expect(files[0].name).toContain("Neverland");
  });

  it("follows the league's current name, so renaming after loading still works", () => {
    const entries = withAddedLeague();
    const last = entries.length - 1;
    entries[last] = {
      ...entries[last],
      spec: { ...entries[last].spec, country: "Ruritania" },
      rosterSources: [{ name: "a.json", file: rosterFile("Anything", 1) }],
    };
    const competitions = buildCompetitions(includedSpecs(entries));
    const { files } = leagueRosterFiles(entries, competitions);
    expect(files[0].file.competitions[0].match).toBe("Ruritania Division 1");
  });

  it("ignores a file on a league that has been switched off", () => {
    const entries = withAddedLeague();
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      included: false,
      rosterSources: [{ name: "a.json", file: rosterFile("Anything", 1) }],
    };
    const competitions = buildCompetitions(includedSpecs(entries));
    expect(leagueRosterFiles(entries, competitions).files).toHaveLength(0);
  });

  it("returns nothing when no league carries a file", () => {
    const entries = withAddedLeague();
    const competitions = buildCompetitions(includedSpecs(entries));
    expect(leagueRosterFiles(entries, competitions).files).toHaveLength(0);
  });
});

describe("WorldSetup wiring", () => {
  it("keeps the entries it renders in step with the world they build", () => {
    const entries = withAddedLeague();
    const countries = countriesOf(buildCompetitions(includedSpecs(entries)));
    expect(countries).toHaveLength(17);
    expect(countries[countries.length - 1]).toBe("Neverland");
  });
});

/**
 * The settings panel is rendered directly here rather than through WorldSetup,
 * because on a shipped league it sits behind a button and component state is out
 * of reach of a static render.
 */
describe("a shipped league's settings panel", () => {
  function panel(country: string): string {
    const entry = defaultWorldEntries().find((e) => e.spec.country === country)!;
    return renderToStaticMarkup(
      createElement(LeagueSettings, { entry, onEntry: () => {}, onSpec: () => {} }),
    );
  }

  /** The value a `<select>`/`<input>` in this panel is showing. */
  function shown(html: string, label: string): string {
    const select = new RegExp(`<select[^>]*aria-label="${label}"[^>]*>(.*?)</select>`, "s")
      .exec(html);
    if (select) return /<option value="([^"]*)" selected="">/.exec(select[1])?.[1] ?? "";
    return new RegExp(`<input[^>]*aria-label="${label}"[^>]*value="([^"]*)"`).exec(html)?.[1]
      ?? new RegExp(`value="([^"]*)"[^>]*aria-label="${label}"`).exec(html)?.[1] ?? "";
  }

  it("gives a shipped country every control an added league has", () => {
    const html = panel("England");
    expect(html).toContain("Strength");
    expect(html).toContain("Money");
    expect(html).toContain("Clubs promoted and relegated each season");
    expect(html).toContain("Continental Cup places");
    expect(html).toContain("Continental Shield places");
    expect(html).toContain("Who this league produces");
    expect(html).toContain("Import roster");
  });

  it("opens on the values that country actually ships with, not on zero", () => {
    // The failure this pins is silent and would be acted on: reading the raw
    // optional field showed France's handicap as absent, i.e. strength 20 and
    // money 1.00 — the strongest, richest setting in the game — for a league
    // that is really neither.
    expect(shown(panel("France"), "Money")).toBe("0.7");
    expect(shown(panel("England"), "Money")).toBe("1");
    expect(panel("France")).toContain('aria-label="Strength" value="15"');
    expect(panel("England")).toContain('aria-label="Strength" value="20"');
  });

  it("shows each league's own continental places, which are not all the same", () => {
    // A big-four league sends four to the Cup and a weak one sends two, so a
    // flat default of 2 would have quietly offered to halve England's places.
    expect(shown(panel("England"), "Continental Cup places")).toBe("4");
    expect(shown(panel("Turkey"), "Continental Cup places")).toBe("2");
    expect(shown(panel("England"), "Continental Shield places")).toBe("2");
  });

  it("shows the shape every shipped country plays", () => {
    // Every shipped country runs three divisions; they differ in size, so the
    // picker still has to read each country's own numbers rather than a single
    // shipped default.
    const spain = panel("Spain");
    expect(shown(spain, "Divisions")).toBe("3");
    expect(shown(spain, "Clubs per division")).toBe("20");
    expect(shown(spain, "Clubs promoted and relegated each season"))
      .toBe(String(PROMOTION_RELEGATION_COUNT));

    const turkey = panel("Turkey");
    expect(shown(turkey, "Divisions")).toBe("3");
    expect(shown(turkey, "Clubs per division")).toBe("18");
  });

  it("shows the country's own nationality mix rather than the rest-of-world bucket", () => {
    // Spain generates Spaniards. Showing an added league's blank default here
    // would be a preview that disagrees with the world it is previewing.
    const html = panel("Spain");
    expect(html).toContain("Spain");
    expect(html).toContain("Argentina");
    expect(panel("Turkey")).toContain("Turkey");
  });

  it("leaves every knob absent until something is moved", () => {
    // Rendering the panel must not write the resolved values back. If it did,
    // every shipped league would carry explicit knobs and a default world would
    // stop being the one the game has always generated.
    const specs = defaultWorldEntries().map((e) => e.spec);
    for (const spec of specs) {
      expect(spec.strengthOffset).toBeUndefined();
      expect(spec.budgetScale).toBeUndefined();
      expect(spec.cupSlots).toBeUndefined();
      expect(spec.nationalities).toBeUndefined();
    }
    expect(buildCompetitions(includedSpecs(defaultWorldEntries()))).toEqual(worldCompetitions());
  });
});

describe("the card can be collapsed", () => {
  /** Shut, which is how the New League page ships it. */
  function renderShut(entries: WorldEntry[]): string {
    return renderToStaticMarkup(
      createElement(WorldSetup, { entries, onChange: () => {} }),
    );
  }

  it("shows the world it would build without being opened", () => {
    // The whole case for collapsing rests on this line. Without it the player
    // has to open a twelve-row card to find out what they are about to get.
    const html = renderShut(defaultWorldEntries());
    expect(html).toContain("16 countries, 48 divisions, 872 clubs");
    expect(html).toContain("World setup");
  });

  it("keeps its controls out of the page until it is opened", () => {
    const html = renderShut(defaultWorldEntries());
    expect(html).not.toContain("Add a league");
    expect(html).not.toContain("Pick which countries your world has");
    expect(html).toContain('aria-expanded="false"');
  });

  it("counts a tuning warning on the header, so shutting the card can't hide one", () => {
    // worldTuningWarnings is advisory and renders inside the body. Collapsed,
    // that body is gone — so the count is what stops the advice disappearing
    // with it.
    const entries = withAddedLeague();
    const added = entries[entries.length - 1];
    // Weaker than every shipped league while being richer than all of them:
    // the inversion the warning exists to report.
    added.spec = { ...added.spec, strengthOffset: 20, budgetScale: 2 };
    const html = renderShut(entries);
    expect(html).toContain("badge text-bg-warning");
  });

  it("says nothing about warnings when there are none", () => {
    expect(renderShut(defaultWorldEntries())).not.toContain("badge text-bg-warning");
  });
});
