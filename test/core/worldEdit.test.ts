import { describe, expect, it } from "vitest";
import {
  buildCompetitions, countriesOf, divisionsOf, worldCompetitions,
  type Competition, type LeagueSpec,
} from "../../src/core/competitions.js";
import {
  applyPendingCompetitions, discardCountryEdit, editedCountries, leagueSpecFromDivisions,
  queueCountryEdit, rebuildCountry,
} from "../../src/core/worldEdit.js";
import { competitionForeignRules, competitionForeignRules as rulesOf } from "../../src/core/foreignRules.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";
import { mulberry32 } from "../../src/engine/rng.js";

const WORLD = worldCompetitions();

describe("leagueSpecFromDivisions", () => {
  it("round-trips every shipped country through buildCompetitions", () => {
    for (const country of countriesOf(WORLD)) {
      const divs = divisionsOf(WORLD, country);
      const rebuilt = buildCompetitions([leagueSpecFromDivisions(divs)])
        .map((c, i) => ({ ...c, id: divs[i].id }));
      expect(rebuilt, country).toEqual(divs);
    }
  });

  it("round-trips a custom three-division league with every knob set", () => {
    const spec: LeagueSpec = {
      country: "Freedonia", divisions: 3, abbrev: "FRE",
      d1Teams: 24, d2Teams: 18, d3Teams: 16,
      d1Conferences: { names: ["East", "West"], crossRounds: 1 }, d2Conferences: null,
      d1Name: "Premier", d2Name: "Second", d3Name: "Third",
      strengthOffset: 8, academyOffset: 9, budgetScale: 0.6,
      cupSlots: 2, shieldSlots: 1, promotionSpots: 3, playoffFormat: "english",
      d3PromotionSpots: 0, d3PlayoffFormat: "none",
      nationalities: { Freedonia: 80, Brazil: 20 }, region: "europe", titlePlayoff: "single",
    };
    const built = buildCompetitions([spec]);
    expect(buildCompetitions([leagueSpecFromDivisions(built)])).toEqual(built);
  });
});

describe("rebuildCountry", () => {
  it("returns the same divisions for an unedited spec", () => {
    for (const country of countriesOf(WORLD)) {
      const divs = divisionsOf(WORLD, country);
      expect(rebuildCountry(divs, leagueSpecFromDivisions(divs)), country).toEqual(divs);
    }
  });

  it("applies editable knobs and keeps ids", () => {
    const divs = divisionsOf(WORLD, "England");
    const spec = { ...leagueSpecFromDivisions(divs), budgetScale: 0.7, promotionSpots: 2, d1Name: "First Division" };
    const out = rebuildCountry(divs, spec)!;
    expect(out.map((c) => c.id)).toEqual(divs.map((c) => c.id));
    expect(out[0].name).toBe("First Division");
    expect(out.every((c) => c.budgetScale === 0.7 && c.promotionSpots === 2)).toBe(true);
  });

  it("ignores edits to locked structure", () => {
    const divs = divisionsOf(WORLD, "England");
    const spec: LeagueSpec = {
      ...leagueSpecFromDivisions(divs), divisions: 1, d1Teams: 12, strengthOffset: 9, region: "americas",
    };
    expect(rebuildCountry(divs, spec)).toEqual(divs);
  });

  it("refuses a split that the division's size can't lose", () => {
    const custom = buildCompetitions([{
      country: "Freedonia", d1Teams: 30, d1Conferences: { names: ["A", "B"], crossRounds: 0 },
    }]);
    const spec = { ...leagueSpecFromDivisions(custom), d1Conferences: null };
    expect(rebuildCountry(custom, spec)).toBeNull();
  });

  it("keeps a shipped league's foreign rules when its nationality mix is edited", () => {
    const divs = divisionsOf(WORLD, "Spain");
    const before = divs.map(rulesOf);
    expect(before[0].length).toBeGreaterThan(0);
    const spec = { ...leagueSpecFromDivisions(divs), nationalities: { Spain: 90, Brazil: 10 } };
    const out = rebuildCountry(divs, spec)!;
    expect(out.map(competitionForeignRules)).toEqual(before);
  });

  it("replaces every division's rules when given a new set", () => {
    const divs = divisionsOf(WORLD, "France");
    const rules = [{ kind: "foreignCap" as const, max: 3, basis: "nationality" as const }];
    const out = rebuildCountry(divs, leagueSpecFromDivisions(divs), rules)!;
    expect(out.map(competitionForeignRules)).toEqual(divs.map(() => rules));
  });
});

describe("queue and apply", () => {
  const live: Competition[] = WORLD;

  it("queues, reports and discards per country", () => {
    const spec = { ...leagueSpecFromDivisions(divisionsOf(live, "Italy")), budgetScale: 0.5 };
    const pending = queueCountryEdit(live, undefined, "Italy", spec)!;
    expect(pending).toBeDefined();
    expect([...editedCountries(live, pending)]).toEqual(["Italy"]);
    // Queuing the live spec again empties the queue.
    expect(queueCountryEdit(live, pending, "Italy", leagueSpecFromDivisions(divisionsOf(live, "Italy"))))
      .toBeUndefined();
    expect(discardCountryEdit(live, pending, "Italy")).toBeUndefined();
  });

  it("applies a queued table that lines up, and refuses one that doesn't", () => {
    const spec = { ...leagueSpecFromDivisions(divisionsOf(live, "Italy")), promotionSpots: 4 };
    const pending = queueCountryEdit(live, undefined, "Italy", spec)!;
    expect(applyPendingCompetitions(live, pending)).toEqual(pending);
    expect(applyPendingCompetitions(live, undefined)).toBe(live);
    const broken = pending.map((c) => (c.country === "Italy" && c.tier === 1 ? { ...c, teamCount: 12 } : c));
    expect(applyPendingCompetitions(live, broken)).toBe(live);
  });
});

describe("a queued edit takes over at the season rollover", () => {
  it("settles the finished season under the old rules, then plays the new ones", () => {
    const comps = buildCompetitions([{ country: "Atlantis", d1Teams: 12, d2Teams: 12, promotionSpots: 3 }]);
    let league = createLeagueState(SPECTATOR_TID, mulberry32(3), 3, "normal", comps);
    const spec: LeagueSpec = {
      ...leagueSpecFromDivisions(comps),
      d1Name: "Atlantis Premier",
      promotionSpots: 1,
      d1Conferences: { names: ["North", "South"], crossRounds: 0 },
      nationalities: { Brazil: 100 },
    };
    league = { ...league, pendingCompetitions: queueCountryEdit(league.competitions, undefined, "Atlantis", spec)! };

    league = simThrough(league, "season", mulberry32(4));
    const before = new Map(league.teams.map((t) => [t.tid, t.compId]));
    const existing = new Set(league.players.map((p) => p.pid));
    league = simOffseason(league, mulberry32(5));

    // The old rule (3 up, 3 down) decided the season that was played.
    expect(league.teams.filter((t) => t.compId !== before.get(t.tid))).toHaveLength(6);
    // The new table is live and nothing is left queued.
    expect(league.pendingCompetitions).toBeUndefined();
    expect(league.competitions[0].name).toBe("Atlantis Premier");
    expect(league.competitions[0].promotionSpots).toBe(1);
    // The top flight is now split, and every club in it was seated in a half.
    for (const t of league.teams) {
      expect(t.conference !== undefined).toBe(t.compId === comps[0].id);
    }
    // The summer's youth intake drew from the new mix.
    const intake = league.players.filter((p) => !existing.has(p.pid));
    expect(intake.length).toBeGreaterThan(0);
    expect(intake.filter((p) => p.nationality === "Brazil").length / intake.length).toBeGreaterThan(0.9);
  }, 240_000);
});
