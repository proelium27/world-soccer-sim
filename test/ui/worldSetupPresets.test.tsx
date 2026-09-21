import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeagueSettings, defaultWorldEntries, type WorldEntry } from "../../src/ui/components/WorldSetup.js";
import { LEAGUE_PRESETS } from "../../src/core/worldPresets.js";

/**
 * The world editor leads with presets and a preview, with the raw controls
 * behind a Fine-tune disclosure — the shape God Mode's Awards tab settled on.
 * These pin the three things that shape can silently lose: a shipped country
 * reading as hand-tuned, the disclosure defaulting the wrong way, and the raw
 * fields disappearing rather than merely being collapsed.
 */
function renderLeague(entry: WorldEntry): string {
  return renderToStaticMarkup(
    createElement(LeagueSettings, { entry, onEntry: () => {}, onSpec: () => {} }),
  );
}

const england = (): WorldEntry => defaultWorldEntries().find((e) => e.spec.country === "England")!;

const added = (spec: Partial<WorldEntry["spec"]> = {}): WorldEntry => ({
  id: "added:test",
  spec: { country: "Neverland", ...spec },
  included: true,
  shipped: false,
  linkMoney: true,
});

describe("the world editor's presets", () => {
  it("offers every preset on a shipped country", () => {
    const html = renderLeague(england());
    for (const p of LEAGUE_PRESETS) {
      expect(html, p.id).toContain(`id="league-preset-shipped:England-${p.id}"`);
      expect(html, p.id).toContain(p.name);
    }
  });

  it("opens an untouched shipped country on 'As shipped', not on custom", () => {
    const html = renderLeague(england());
    expect(html).toMatch(/id="league-preset-shipped:England-shipped"[^>]*checked/);
    expect(html).not.toContain("Custom: your own shape");
  });

  it("offers no 'As shipped' on a league the player invented", () => {
    // There is no shipped shape to go back to, so the option would be a lie.
    const html = renderLeague(added());
    expect(html).not.toContain("league-preset-added:test-shipped");
    expect(html).toContain("league-preset-added:test-big-four");
  });

  it("keeps the raw controls in the page, behind a closed disclosure", () => {
    const html = renderLeague(england());
    expect(html).toContain("Fine-tune this league");
    // Closed emits no `open` attribute at all — the same contract the Awards
    // tab's test relies on.
    expect(html).toMatch(/<details class="gm-panel mb-3">/);
    // ...and every control is still rendered inside it.
    expect(html).toContain("Strength");
    expect(html).toContain("Continent");
    expect(html).toContain("Top division name");
  });

  it("opens the disclosure for a league no preset describes", () => {
    const html = renderLeague(added({ strengthOffset: 7, d1Teams: 14, divisions: 2 }));
    expect(html).toMatch(/<details class="gm-panel mb-3" open/);
    expect(html).toContain("Custom: your own shape");
  });

  it("describes what the league builds, in football rather than in slider points", () => {
    const html = renderLeague(england());
    expect(html).toContain("What this builds");
    expect(html).toContain("rate around 87");
    expect(html).toContain("Three divisions");
    expect(html).toContain("Continental Cup");
    // The preview quotes a rating rather than the slider's own number. (The
    // string "Strength 20" does appear further down, in the reference table
    // inside Fine-tune, which is exactly where a raw number belongs.)
    const preview = html.slice(html.indexOf("What this builds"), html.indexOf("Fine-tune this league"));
    expect(preview).not.toMatch(/Strength \d/);
    expect(preview).toContain("rate around");
  });

  it("describes a closed league in the Americas correctly", () => {
    const html = renderLeague(added({
      country: "Neverland",
      divisions: 2,
      d1Teams: 30,
      d2Teams: 20,
      d1Conferences: { names: ["East", "West"], crossRounds: 4 },
      promotionSpots: 0,
      titlePlayoff: "conference",
      region: "americas",
    }));
    expect(html).toContain("Closed: nobody is promoted or relegated.");
    expect(html).toContain("decided in playoffs");
    expect(html).toContain("Americas Cup");
    expect(html).toContain("two halves");
  });
});
