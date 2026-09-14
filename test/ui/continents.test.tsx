import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorldSetup, defaultWorldEntries, entryRegion, includedSpecs, setRegionIncluded, type WorldEntry,
} from "../../src/ui/components/WorldSetup.js";
import { countriesByRegion, groupByRegion } from "../../src/ui/continents.js";
import { buildCompetitions, countriesOf, worldCompetitions } from "../../src/core/competitions.js";

const AMERICAS = ["Brazil", "Argentina", "Mexico", "United States"];

function render(entries: WorldEntry[]): string {
  return renderToStaticMarkup(
    createElement(WorldSetup, { entries, onChange: () => {}, defaultOpen: true }),
  );
}

describe("grouping countries by continent", () => {
  it("puts the four American leagues under the Americas and the rest under Europe", () => {
    const comps = worldCompetitions();
    const groups = countriesByRegion(comps, countriesOf(comps));
    expect(groups.map((g) => g.region)).toEqual(["europe", "americas"]);
    expect(groups[1].items).toEqual(AMERICAS);
    expect(groups[0].items).toHaveLength(12);
    expect(groups[0].items).toContain("England");
  });

  it("leaves out a continent with nothing in it", () => {
    expect(groupByRegion(["a"], () => "americas").map((g) => g.region)).toEqual(["americas"]);
  });

  it("files an added league with no region under Europe, where it would play", () => {
    const added: WorldEntry = {
      id: "added:1", spec: { country: "Neverland" }, included: true, shipped: false, linkMoney: true,
    };
    expect(entryRegion(added)).toBe("europe");
  });
});

describe("switching a whole continent in World setup", () => {
  it("turns every American league off and leaves Europe untouched", () => {
    const entries = defaultWorldEntries();
    const next = setRegionIncluded(entries, "americas", false);
    const off = next.filter((e) => !e.included).map((e) => e.spec.country);
    expect(off).toEqual(AMERICAS);
    // Untouched rows come back by reference, so nothing else re-renders as changed.
    next.forEach((e, i) => {
      if (!AMERICAS.includes(e.spec.country)) expect(e).toBe(entries[i]);
    });
    expect(countriesOf(buildCompetitions(includedSpecs(next)))).not.toContain("Brazil");
  });

  it("turns a continent back on, including a league that was switched off on its own", () => {
    const partly = defaultWorldEntries().map((e) =>
      e.spec.country === "Mexico" ? { ...e, included: false } : e,
    );
    const next = setRegionIncluded(partly, "americas", true);
    expect(next.every((e) => e.included)).toBe(true);
  });

  it("shows a heading with a checkbox for each continent, ticked while all are on", () => {
    const html = render(defaultWorldEntries());
    expect(html).toContain('id="region-on-europe"');
    expect(html).toContain('id="region-on-americas"');
    expect(html.indexOf(">Europe<")).toBeLessThan(html.indexOf(">England<"));
    expect(html.indexOf(">Americas<")).toBeGreaterThan(html.indexOf(">Serbia<"));
    expect(html.indexOf(">Americas<")).toBeLessThan(html.indexOf(">Brazil<"));
    expect(html).toContain("12 of 12");
    expect(html).toContain("4 of 4");
  });

  it("unticks the heading when a continent is only partly on", () => {
    const partly = defaultWorldEntries().map((e) =>
      e.spec.country === "Mexico" ? { ...e, included: false } : e,
    );
    const html = render(partly);
    expect(html).toContain("3 of 4");
    const box = html.slice(html.indexOf('id="region-on-americas"') - 120, html.indexOf('id="region-on-americas"') + 40);
    expect(box).not.toContain("checked");
  });
});
