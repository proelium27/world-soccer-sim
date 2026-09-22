import { describe, expect, it } from "vitest";
import {
  LEAGUE_PRESETS, leaguePresetsFor, matchingLeaguePreset, applyLeaguePreset,
  describeStrength, STRENGTH_ANCHORS,
} from "../../src/core/worldPresets.js";
import {
  buildCompetitions, worldLeagueSpecs, worldCompetitions, normalizeLeagueSpec,
  resolveLeagueSpec,
} from "../../src/core/competitions.js";

/**
 * The presets are what the New League world editor leads with, so the property
 * that matters is that picking one and going back leaves the world the game
 * ships — the same round trip `buildCompetitions(worldLeagueSpecs())` is
 * already pinned on, reached through the UI's own path.
 */
const shippedSpecs = new Map(worldLeagueSpecs().map((s) => [s.country, s]));
const preset = (id: string) => LEAGUE_PRESETS.find((p) => p.id === id)!;

describe("league presets", () => {
  it("reads an untouched shipped country as shipped, not as custom", () => {
    // A shipped spec is NOT knob-free — it carries its sizes and promotion
    // counts — so "no knobs set" is the wrong test and was the first bug here.
    for (const spec of worldLeagueSpecs()) {
      expect(matchingLeaguePreset(spec, spec)?.id, spec.country).toBe("shipped");
    }
  });

  it("puts a country back exactly as it ships, after any preset", () => {
    // Every country, not a sample: a country's own defaults (the US second
    // division's conference split) are exactly what a preset can fail to clear.
    for (const [country, shipped] of shippedSpecs) {
      for (const p of LEAGUE_PRESETS) {
        if (!p.shape) continue;
        const changed = normalizeLeagueSpec(applyLeaguePreset(shipped, p, shipped));
        expect(matchingLeaguePreset(changed, shipped)?.id, `${country} → ${p.id}`).toBe(p.id);
        const back = normalizeLeagueSpec(applyLeaguePreset(changed, preset("shipped"), shipped));
        expect(back, `${country} → ${p.id} → shipped`).toEqual(shipped);
      }
    }
  });

  it("keeps the shipped world byte-identical when every country is restored", () => {
    // The round trip through the editor's own apply path, not just through
    // worldLeagueSpecs: a restore that drifted would rebuild the world.
    const restored = worldLeagueSpecs().map((spec) =>
      normalizeLeagueSpec(applyLeaguePreset(spec, preset("shipped"), spec)),
    );
    expect(buildCompetitions(restored)).toEqual(worldCompetitions());
  });

  it("leaves a preset's own knobs alone and the rest of the spec untouched", () => {
    const shipped = shippedSpecs.get("England")!;
    const withExtras = { ...shipped, d1Name: "Premier League", cupSlots: 5 };
    const applied = applyLeaguePreset(withExtras, preset("small-europe"), shipped);
    // A preset speaks for shape, never for identity or continental places.
    expect(applied.d1Name).toBe("Premier League");
    expect(applied.cupSlots).toBe(5);
    expect(applied.d1Teams).toBe(12);
  });

  it("gives every shape its own money, so the editor never has to guess one", () => {
    // The editor used to overwrite a preset's money with suggestedBudgetScale
    // when "keep money in step" was on. That left the league matching no preset
    // (Mid-tier's 0.65 became 0.70) and the radio just clicked came back empty.
    // Picking a preset now keeps its money as written, which is only correct
    // while every shape states one.
    for (const p of LEAGUE_PRESETS) {
      if (!p.shape) continue;
      expect(p.shape.budgetScale, p.id).toBeTypeOf("number");
      const shipped = shippedSpecs.get("England")!;
      const applied = normalizeLeagueSpec(applyLeaguePreset(shipped, p, shipped));
      expect(applied.budgetScale, p.id).toBe(p.shape.budgetScale);
      expect(matchingLeaguePreset(applied, shipped)?.id, p.id).toBe(p.id);
    }
  });

  it("offers 'As shipped' only where there is something to go back to", () => {
    expect(leaguePresetsFor(shippedSpecs.get("England")).some((p) => p.id === "shipped")).toBe(true);
    expect(leaguePresetsFor(undefined).some((p) => p.id === "shipped")).toBe(false);
  });

  it("builds a world the engine accepts out of every preset", () => {
    // A preset that cannot be built is worse than no preset: it fails at Start,
    // long after the click. normalizeLeagueSpec is the same guard the editor
    // runs on every edit, so a preset it has to correct is a preset that lies.
    for (const p of LEAGUE_PRESETS) {
      if (!p.shape) continue;
      const spec = { country: "Neverland", ...p.shape };
      expect(normalizeLeagueSpec(spec), p.id).toEqual(spec);
      expect(() => buildCompetitions([spec]), p.id).not.toThrow();
    }
  });

  it("describes a country without comparing it to itself", () => {
    // "About as strong as England" on England's own panel is true and useless.
    expect(describeStrength(0, "England")).not.toContain("as strong as England");
    expect(describeStrength(0, "England")).toContain("87");
    expect(describeStrength(0, "Neverland")).toContain("England");
  });

  it("quotes a rating for every rung the slider can reach", () => {
    for (let offset = 0; offset <= 20; offset++) {
      expect(describeStrength(offset), String(offset)).toMatch(/rate around \d+\./);
    }
    // The anchors are measured, so they must stay ordered: weaker never rates higher.
    const sorted = [...STRENGTH_ANCHORS].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].bestClub).toBeLessThanOrEqual(sorted[i - 1].bestClub);
    }
  });

  it("names shapes the engine really plays", () => {
    // Each preset claims a real arrangement in its blurb; resolve it and check
    // the claim, so a reworded blurb can't drift from what it builds.
    const resolve = (id: string) => resolveLeagueSpec({ country: "Neverland", ...preset(id).shape });
    expect(resolve("closed").promotionSpots).toBe(0);
    expect(resolve("closed").titlePlayoff).toBe("conference");
    expect(resolve("closed").region).toBe("americas");
    expect(resolve("south-america").promotionSpots).toBe(4);
    expect(resolve("big-four").playoffFormat).toBe("english");
    expect(resolve("small-europe").d1Teams).toBe(12);
  });
});
