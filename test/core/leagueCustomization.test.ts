import { describe, expect, it } from "vitest";
import type { Competition } from "../../src/core/competitions.js";
import {
  worldCompetitions, competitionStrengthOffset, competitionAcademyOffset,
  competitionBudgetScale, isWeakLeague, academyBaseCenterOf,
  buildCompetitions, worldLeagueSpecs, countryDivisions, countryClubRanges,
  worldTuningWarnings, suggestedBudgetScale, worldTeamSlots,
  competitionTeamCount, divisionBelow, competitionAbbrev, resolveLeagueSpec,
} from "../../src/core/competitions.js";
import { computeCountrySwaps } from "../../src/core/promotion.js";
import { buildCompetitionSchedule } from "../../src/core/leagueState.js";
import {
  SEASON_MATCHDAYS, MIN_DIVISION_TEAMS, MAX_DIVISION_TEAMS,
} from "../../src/core/calendar.js";
import { applySuspensions } from "../../src/core/suspensions.js";
import type { RosterFile } from "../../src/core/teams/rosterFile.js";
import {
  retargetRosterFile, resolveRosterSlots, ROSTER_FILE_FORMAT,
} from "../../src/core/teams/rosterFile.js";
import {
  COUNTRY_STRENGTH_OFFSET, COUNTRY_BUDGET_SCALE, LEAGUE_BASE, DIVISION_2_OFFSET,
  CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT, NUM_TEAMS, NUM_TEAMS_D2, NUM_TEAMS_D3,
  isValidCupFieldSize, largestValidCupField,
} from "../../src/core/constants.js";
import { CLUBS, shippedClubsFor } from "../../src/core/teams/clubs.js";
import {
  cupSlotsForCompetition, cupOffsetForCompetition, cupSlotRange, cupPlan,
} from "../../src/core/cup/cup.js";
import { generateClubIdentities, abbrevFor } from "../../src/core/teams/clubNames.js";

/**
 * The per-league knobs added so a player can add their own league. The whole
 * design rests on the shipped world reading identically through the new
 * accessors as it did through the old country tables, so that is what most of
 * this file pins.
 */
/**
 * The other half of the same idea: absent is right for STORAGE and useless for a
 * CONTROL, so the world editor needs a resolved reading of a spec — what each
 * absent knob would actually build as — without writing any of it back.
 */
describe("resolveLeagueSpec reads a spec the way the world will build it", () => {
  it("resolves a shipped country to its own table, not to a bare default", () => {
    const france = resolveLeagueSpec(worldLeagueSpecs().find((s) => s.country === "France")!);
    expect(france.strengthOffset).toBe(COUNTRY_STRENGTH_OFFSET.France);
    expect(france.budgetScale).toBe(COUNTRY_BUDGET_SCALE.France);
    // A weak league sends fewer clubs to both continental competitions, so a
    // flat default here would misreport half the world.
    expect(france.cupSlots).toBe(CONTINENTAL_CUP_FORMAT.weakSlots);
    expect(france.shieldSlots).toBe(SHIELD_FORMAT.weakSlots);
  });

  it("gives a big-four league the strong league's places", () => {
    const england = resolveLeagueSpec(worldLeagueSpecs().find((s) => s.country === "England")!);
    expect(england.strengthOffset).toBe(0);
    expect(england.budgetScale).toBe(1);
    expect(england.cupSlots).toBe(CONTINENTAL_CUP_FORMAT.strongSlots);
  });

  it("agrees with the accessors the engine itself reads", () => {
    // Two ways of answering the same question, and they have to match or the
    // editor shows one thing and the world generates another.
    for (const spec of worldLeagueSpecs()) {
      const [d1] = buildCompetitions([spec]);
      const r = resolveLeagueSpec(spec);
      expect(r.strengthOffset).toBe(competitionStrengthOffset(d1));
      expect(r.budgetScale).toBe(competitionBudgetScale(d1));
      expect(r.d1Teams).toBe(competitionTeamCount(d1));
      expect(r.cupSlots).toBe(cupSlotsForCompetition(d1, CONTINENTAL_CUP_FORMAT));
      expect(r.shieldSlots).toBe(cupSlotsForCompetition(d1, SHIELD_FORMAT));
    }
  });

  it("classifies by the resolved offset, so weakening a shipped league moves its places", () => {
    // The player has dragged England down to Turkey's level. It is a weak league
    // now whatever the country table says, and it should send a weak league's
    // clubs to Europe.
    const weakened = resolveLeagueSpec({ country: "England", strengthOffset: 12 });
    expect(weakened.cupSlots).toBe(CONTINENTAL_CUP_FORMAT.weakSlots);
  });

  it("gives a country with no table England's mix, which is what it would draw", () => {
    // Not a friendly-looking invented default: absent really does fall through
    // to England's distribution in pickNationality, so saying anything else here
    // would be a preview that disagrees with the world.
    const invented = resolveLeagueSpec({ country: "Ruritania" });
    expect(invented.strengthOffset).toBe(0);
    expect(invented.nationalities.England).toBeGreaterThan(0);
  });

  it("prefers what the spec sets over every fallback", () => {
    const tuned = resolveLeagueSpec({
      country: "Spain", strengthOffset: 3, budgetScale: 0.9, d1Teams: 16, promotionSpots: 1,
    });
    expect(tuned.strengthOffset).toBe(3);
    expect(tuned.budgetScale).toBe(0.9);
    expect(tuned.d1Teams).toBe(16);
    expect(tuned.promotionSpots).toBe(1);
    // Untouched knobs still follow Spain.
    expect(tuned.nationalities.Spain).toBeGreaterThan(0);
  });
});

describe("per-league tuning falls back to the shipped country tables", () => {
  const comps = worldCompetitions();

  it("resolves every shipped competition to its country's table value", () => {
    for (const comp of comps) {
      expect(competitionStrengthOffset(comp)).toBe(COUNTRY_STRENGTH_OFFSET[comp.country] ?? 0);
      expect(competitionBudgetScale(comp)).toBe(COUNTRY_BUDGET_SCALE[comp.country] ?? 1);
    }
  });

  it("classifies the big four as strong and the rest as weak, as before", () => {
    const weak = comps.filter((c) => c.tier === 1 && isWeakLeague(c)).map((c) => c.country);
    expect(weak).toEqual([
      "France", "Portugal", "Belgium", "Turkey", "Netherlands", "Scotland", "Greece", "Serbia",
      "Brazil", "Argentina", "Mexico", "United States",
    ]);
  });

  it("academy offset defaults to the strength offset — one number doing both jobs", () => {
    for (const comp of comps) {
      expect(competitionAcademyOffset(comp)).toBe(competitionStrengthOffset(comp));
    }
  });

  it("a competition's own values win over its country's", () => {
    const custom: Competition = {
      id: 99, country: "France", tier: 1, name: "Custom",
      strengthOffset: 3, budgetScale: 0.9,
    };
    expect(competitionStrengthOffset(custom)).toBe(3);
    expect(competitionBudgetScale(custom)).toBe(0.9);
    // Academy still tracks the league's OWN strength, not France's table entry.
    expect(competitionAcademyOffset(custom)).toBe(3);
  });

  it("a country absent from every table resolves to neutral defaults", () => {
    const added: Competition = { id: 99, country: "Neverland", tier: 1, name: "Added" };
    expect(competitionStrengthOffset(added)).toBe(0);
    expect(competitionBudgetScale(added)).toBe(1);
    expect(isWeakLeague(added)).toBe(false);
  });
});

describe("academy anchor can be set apart from current strength", () => {
  it("a declining league anchors below its generated strength", () => {
    const declining: Competition = {
      id: 99, country: "Added", tier: 1, name: "Declining",
      strengthOffset: 0, academyOffset: 8,
    };
    expect(competitionAcademyOffset(declining)).toBe(8);
    expect(academyBaseCenterOf(declining)).toBe(LEAGUE_BASE - 8);
  });

  it("a rising league anchors above it", () => {
    const rising: Competition = {
      id: 99, country: "Added", tier: 1, name: "Rising",
      strengthOffset: 10, academyOffset: 2,
    };
    expect(academyBaseCenterOf(rising)).toBe(LEAGUE_BASE - 2);
  });

  it("tier 2 takes the division offset on top, in its own league's band", () => {
    const d2: Competition = {
      id: 99, country: "Added", tier: 2, name: "Added D2", strengthOffset: 6,
    };
    expect(academyBaseCenterOf(d2)).toBe(LEAGUE_BASE - 6 - DIVISION_2_OFFSET);
  });
});

describe("continental slots are per league, and the fields stay disjoint", () => {
  const comps = worldCompetitions();
  const england = comps.find((c) => c.country === "England" && c.tier === 1)!;
  const france = comps.find((c) => c.country === "France" && c.tier === 1)!;

  it("keeps the shipped allocation: strong 1-4 then 5-6, weak 1-2 then 3-4", () => {
    expect(cupSlotRange(england, CONTINENTAL_CUP_FORMAT)).toEqual([1, 4]);
    expect(cupSlotRange(england, SHIELD_FORMAT)).toEqual([5, 6]);
    expect(cupSlotRange(france, CONTINENTAL_CUP_FORMAT)).toEqual([1, 2]);
    expect(cupSlotRange(france, SHIELD_FORMAT)).toEqual([3, 4]);
  });

  it("a league's own slot count moves the Shield's start to match", () => {
    // The bug this guards: the Shield's start used to be a constant copied from
    // the Cup's slot count, so a league with a custom Cup allocation would have
    // put the same club in both competitions (or skipped a place entirely).
    const custom: Competition = {
      id: 99, country: "Added", tier: 1, name: "Added D1",
      continentalSlots: { continental: 1, shield: 3 },
    };
    expect(cupSlotsForCompetition(custom, CONTINENTAL_CUP_FORMAT)).toBe(1);
    expect(cupOffsetForCompetition(custom, CONTINENTAL_CUP_FORMAT)).toBe(0);
    expect(cupOffsetForCompetition(custom, SHIELD_FORMAT)).toBe(1);
    expect(cupSlotRange(custom, CONTINENTAL_CUP_FORMAT)).toEqual([1, 1]);
    expect(cupSlotRange(custom, SHIELD_FORMAT)).toEqual([2, 4]);
  });

  it("a league sending nobody to the Cup starts the Shield at its champion", () => {
    const shieldOnly: Competition = {
      id: 99, country: "Added", tier: 1, name: "Added D1",
      continentalSlots: { continental: 0, shield: 2 },
    };
    expect(cupOffsetForCompetition(shieldOnly, SHIELD_FORMAT)).toBe(0);
    expect(cupSlotRange(shieldOnly, SHIELD_FORMAT)).toEqual([1, 2]);
  });

  it("never lets the two competitions claim the same finishing place", () => {
    const cases: Competition[] = [
      england, france,
      { id: 99, country: "A", tier: 1, name: "A", continentalSlots: { continental: 3, shield: 1 } },
      { id: 98, country: "B", tier: 1, name: "B", continentalSlots: { continental: 0, shield: 4 } },
      { id: 97, country: "C", tier: 1, name: "C", strengthOffset: 9 },
    ];
    for (const comp of cases) {
      const [, cupLast] = cupSlotRange(comp, CONTINENTAL_CUP_FORMAT);
      const [shieldFirst] = cupSlotRange(comp, SHIELD_FORMAT);
      expect(shieldFirst).toBe(cupLast + 1);
    }
  });
});

describe("building a world's competitions table", () => {
  it("rebuilds the shipped world exactly from its own specs", () => {
    // The guard that keeps "start from the shipped world and change nothing"
    // from quietly producing a different world: every knob must stay ABSENT,
    // not be written out as its current table value.
    expect(buildCompetitions(worldLeagueSpecs())).toEqual(worldCompetitions());
  });

  it("hands out ids sequentially in table order, D1 then D2 per country", () => {
    const table = buildCompetitions([{ country: "Neverland" }, { country: "Ruritania" }]);
    expect(table.map((c) => [c.id, c.country, c.tier])).toEqual([
      [0, "Neverland", 1], [1, "Neverland", 2],
      [2, "Ruritania", 1], [3, "Ruritania", 2],
    ]);
    expect(table[0].name).toBe("Neverland Division 1");
  });

  it("carries a spec's knobs onto both of its divisions", () => {
    const [d1, d2] = buildCompetitions([{
      country: "Neverland", strengthOffset: 7, academyOffset: 2,
      budgetScale: 0.6, cupSlots: 1, shieldSlots: 3,
    }]);
    for (const comp of [d1, d2]) {
      expect(comp.strengthOffset).toBe(7);
      expect(comp.academyOffset).toBe(2);
      expect(comp.budgetScale).toBe(0.6);
      expect(comp.continentalSlots).toEqual({ continental: 1, shield: 3 });
    }
  });

  it("leaves an untouched knob absent rather than writing a default", () => {
    const [d1] = buildCompetitions([{ country: "Neverland", budgetScale: 0.6 }]);
    expect(d1.budgetScale).toBe(0.6);
    expect("strengthOffset" in d1).toBe(false);
    expect("continentalSlots" in d1).toBe(false);
  });

  it("a table with a country left out still chains every remaining country", () => {
    const table = buildCompetitions(worldLeagueSpecs().filter((s) => s.country !== "England"));
    const chains = countryDivisions(table);
    expect(chains).toHaveLength(15);
    for (const { country, divisions } of chains) {
      expect(divisions.map((d) => d.tier)).toEqual([1, 2, 3]);
      expect(divisions.every((d) => d.country === country)).toBe(true);
    }
  });
});

describe("continental field size is trimmed to something the draw can build", () => {
  it("accepts the shipped field sizes", () => {
    expect(isValidCupFieldSize(32)).toBe(true); // Continental Cup
    expect(isValidCupFieldSize(24)).toBe(true); // Continental Shield
  });

  it("rejects sizes the league-phase draw cannot pair", () => {
    expect(isValidCupFieldSize(23)).toBe(false); // odd
    expect(isValidCupFieldSize(22)).toBe(false); // pots of 11 — an odd pot can't be matched
    expect(isValidCupFieldSize(8)).toBe(false); // too few to seed the QF + playoff split
  });

  it("trims down to the nearest buildable size", () => {
    expect(largestValidCupField(24)).toBe(24);
    expect(largestValidCupField(23)).toBe(20);
    expect(largestValidCupField(22)).toBe(20);
    expect(largestValidCupField(11)).toBe(0);
  });

  it("leaves the shipped world's fields exactly as they were", () => {
    const comps = worldCompetitions();
    // 4 strong x 4 + 8 weak x 2 = 32; the Shield takes 2 from all twelve = 24.
    expect(cupPlan(comps, CONTINENTAL_CUP_FORMAT)!.total).toBe(32);
    expect(cupPlan(comps, SHIELD_FORMAT)!.total).toBe(24);
  });

  it("gives an awkward world a smaller field instead of no competition", () => {
    // Eleven leagues (England off) x 3 = 33 for the Cup, trimmed to 32; the
    // Shield's 11 x 1 = 11 is odd and unbuildable at any size, so it gets no
    // competition at all. An odd country count is what makes a world "awkward".
    const comps = buildCompetitions(
      worldLeagueSpecs()
        .filter((s) => s.country !== "England")
        .map((s) => ({ ...s, cupSlots: 3, shieldSlots: 1 })),
    );
    expect(cupPlan(comps, CONTINENTAL_CUP_FORMAT)!.total).toBe(32);
    expect(cupPlan(comps, SHIELD_FORMAT)).toBeNull();
  });

  it("trims a field that would otherwise crash the draw", () => {
    const comps = buildCompetitions([
      ...worldLeagueSpecs(),
      { country: "Extra", cupSlots: 3, shieldSlots: 0 },
    ]);
    // 32 + 3 = 35 qualifiers, trimmed to 32.
    expect(cupPlan(comps, CONTINENTAL_CUP_FORMAT)!.total).toBe(32);
  });
});

describe("world tuning warnings", () => {
  it("says nothing about the shipped world", () => {
    expect(worldTuningWarnings(worldLeagueSpecs())).toEqual([]);
  });

  it("flags a weaker-but-richer league, the inversion that breaks a ladder", () => {
    const specs = [
      ...worldLeagueSpecs(),
      { country: "Rich And Weak", strengthOffset: 15, budgetScale: 1 },
    ];
    const warnings = worldTuningWarnings(specs);
    expect(warnings.some((w) => w.includes("Rich And Weak") && w.includes("richer"))).toBe(true);
  });

  it("passes a weaker-and-poorer league", () => {
    const specs = [
      ...worldLeagueSpecs(),
      { country: "Weak And Poor", strengthOffset: 15, budgetScale: 0.3 },
    ];
    // Scoped to the money check on purpose: a ninth league also shifts both
    // continental totals off a buildable size, which is a separate warning with
    // its own tests below.
    expect(worldTuningWarnings(specs).some((w) => w.includes("richer"))).toBe(false);
  });

  it("flags a world too small to field the Continental Cup", () => {
    const specs = worldLeagueSpecs().slice(0, 2);
    expect(worldTuningWarnings(specs).some((w) => w.includes("Continental Cup"))).toBe(true);
  });

  it("counts custom slot allocations toward the cup field, not the country count", () => {
    // Two countries, but each sending six — enough to seed the field.
    const specs = worldLeagueSpecs().slice(0, 2).map((s) => ({ ...s, cupSlots: 6, shieldSlots: 6 }));
    expect(worldTuningWarnings(specs).some((w) => w.includes("Continental Cup"))).toBe(false);
  });

  it("warns when a total would be trimmed, and names what it costs", () => {
    // The trap: adding one league taking 2 asks for 34, which the Cup can't
    // draw, so two clubs are cut from leagues that had nothing to do with it.
    const specs = [...worldLeagueSpecs(), { country: "Neverland", cupSlots: 2, shieldSlots: 2 }];
    const warnings = worldTuningWarnings(specs);
    const cup = warnings.find((w) => w.includes("Continental Cup"))!;
    expect(cup).toContain("34");
    expect(cup).toContain("32");
    expect(cup).toContain("miss out");
  });

  it("warns about the Shield's own total separately from the Cup's", () => {
    // 4 Cup places lands the Cup on 36 (fine) while the Shield still goes to 26.
    const specs = [...worldLeagueSpecs(), { country: "Neverland", cupSlots: 4, shieldSlots: 2 }];
    const warnings = worldTuningWarnings(specs);
    expect(warnings.some((w) => w.includes("Continental Cup"))).toBe(false);
    expect(warnings.some((w) => w.includes("Continental Shield"))).toBe(true);
  });

  it("says nothing when both totals land on a size the draw can build", () => {
    // One country off and an added league taking 4 keeps the Cup at 32, and
    // both leagues at 2 Shield places keeps the Shield at 24.
    const specs = [
      ...worldLeagueSpecs().filter((s) => s.country !== "England"),
      { country: "Neverland", cupSlots: 4, shieldSlots: 2 },
    ];
    expect(worldTuningWarnings(specs)).toEqual([]);
  });

  it("flags duplicate country names and an empty world", () => {
    expect(worldTuningWarnings([{ country: "A" }, { country: "a" }]).some((w) => w.includes("different countries"))).toBe(true);
    expect(worldTuningWarnings([])).toEqual(["A world needs at least one league."]);
  });

  it("suggests money that tracks strength, matching the shipped ladder", () => {
    expect(suggestedBudgetScale(0)).toBe(1);
    expect(suggestedBudgetScale(10)).toBe(0.5);
    expect(suggestedBudgetScale(12)).toBe(0.4);
    // Monotonic and floored, so a slider can't produce a free-money league.
    expect(suggestedBudgetScale(40)).toBe(0.25);
    expect(suggestedBudgetScale(5)).toBeGreaterThan(suggestedBudgetScale(9));
  });
});

describe("a country's three-letter code", () => {
  it("derives one from the name when none was typed", () => {
    const [d1] = buildCompetitions([{ country: "Neverland" }]);
    expect(competitionAbbrev(d1)).toBe("NEV");
  });

  it("uses the one that was typed, upper-cased and clipped to three", () => {
    const [d1] = buildCompetitions([{ country: "Neverland", abbrev: "nvl" }]);
    expect(competitionAbbrev(d1)).toBe("NVL");
    const [other] = buildCompetitions([{ country: "Neverland", abbrev: "TOOLONG" }]);
    expect(competitionAbbrev(other)).toBe("TOO");
  });

  it("ignores spaces and punctuation in a derived code", () => {
    const [d1] = buildCompetitions([{ country: "Côte d'Or" }]);
    expect(competitionAbbrev(d1)).toBe("CTE");
  });

  it("carries the code onto both divisions", () => {
    const [d1, d2] = buildCompetitions([{ country: "Neverland", abbrev: "NVL" }]);
    expect(d1.abbrev).toBe("NVL");
    expect(d2.abbrev).toBe("NVL");
  });

  it("leaves every shipped competition without one", () => {
    // They have real flag art, so the stand-in never shows for them, and the
    // rebuild-the-shipped-world test depends on untouched knobs staying absent.
    for (const comp of worldCompetitions()) expect("abbrev" in comp).toBe(false);
  });
});

describe("division count and size", () => {
  it("defaults to two divisions at the shipped sizes", () => {
    const table = buildCompetitions([{ country: "Neverland" }]);
    expect(table).toHaveLength(2);
    expect(competitionTeamCount(table[0])).toBe(NUM_TEAMS);
    expect(competitionTeamCount(table[1])).toBe(NUM_TEAMS_D2);
  });

  it("builds a one-division country with no second tier at all", () => {
    const table = buildCompetitions([{ country: "Neverland", divisions: 1 }]);
    expect(table).toHaveLength(1);
    expect(table[0].tier).toBe(1);
    expect(countryDivisions(table)[0].divisions).toHaveLength(1);
    expect(divisionBelow(table, 0)).toBeNull();
  });

  it("builds a three-division country, top flight first", () => {
    const table = buildCompetitions([{ country: "Neverland", divisions: 3 }]);
    expect(table.map((c) => c.tier)).toEqual([1, 2, 3]);
    expect(table.map((c) => c.name)).toEqual([
      "Neverland Division 1", "Neverland Division 2", "Neverland Division 3",
    ]);
    expect(competitionTeamCount(table[2])).toBe(NUM_TEAMS_D3);
    expect(divisionBelow(table, table[2].id)).toBeNull();
  });

  it("carries the third division's own name and size", () => {
    const table = buildCompetitions([
      { country: "Neverland", divisions: 3, d3Teams: 14, d3Name: "Neverland League Two" },
    ]);
    expect(table[2].name).toBe("Neverland League Two");
    expect(competitionTeamCount(table[2])).toBe(14);
  });

  it("ignores d3 fields on a country that did not ask for a third division", () => {
    const table = buildCompetitions([
      { country: "Neverland", d3Teams: 14, d3Name: "Neverland League Two" },
    ]);
    expect(table).toHaveLength(2);
  });

  it("carries per-division team counts", () => {
    const table = buildCompetitions([{ country: "Neverland", d1Teams: 12, d2Teams: 16 }]);
    expect(competitionTeamCount(table[0])).toBe(12);
    expect(competitionTeamCount(table[1])).toBe(16);
  });

  it("lays out slots and country ranges from the actual sizes", () => {
    const table = buildCompetitions([
      { country: "Small", divisions: 1, d1Teams: 10 },
      { country: "Big", d1Teams: 20, d2Teams: 20 },
    ]);
    const slots = worldTeamSlots(table);
    expect(slots).toHaveLength(50);
    // The one-division country takes the first 10 tids and nothing more.
    expect(slots.filter((s) => s.compId === table[0].id)).toHaveLength(10);
    expect(countryClubRanges(table)).toEqual([
      { country: "Small", start: 0, end: 10 },
      { country: "Big", start: 10, end: 50 },
    ]);
  });

  it("gives a one-division country no promotion or relegation", () => {
    const table = buildCompetitions([
      { country: "Solo", divisions: 1 },
      { country: "Pair" },
    ]);
    const tables = new Map(table.map((c) => [
      c.id,
      Array.from({ length: competitionTeamCount(c) }, (_, i) => ({
        tid: c.id * 100 + i, played: 38, won: 0, drawn: 0, lost: 0,
        gf: 0, ga: 0, gd: 0, points: 90 - i,
      })),
    ]));
    const swaps = computeCountrySwaps(table, tables as never);
    expect(swaps.map((s) => s.d1CompId)).toEqual([table[1].id]);
  });
});

describe("a division's fixtures spread across the season grid", () => {
  function scheduleFor(teamCount: number) {
    const competitions = buildCompetitions([
      { country: "Solo", divisions: 1, d1Teams: teamCount },
    ]);
    const teams = worldTeamSlots(competitions).map((s) => ({ tid: s.tid, compId: s.compId }));
    return buildCompetitionSchedule(teams, competitions);
  }

  it("leaves a full-size division exactly as it was — one round per matchday", () => {
    const games = scheduleFor(NUM_TEAMS);
    const matchdays = [...new Set(games.map((g) => g.matchday))].sort((a, b) => a - b);
    expect(matchdays).toEqual(Array.from({ length: SEASON_MATCHDAYS }, (_, i) => i + 1));
  });

  it("spreads a smaller division over the same season, finishing on the last matchday", () => {
    const games = scheduleFor(12);
    const matchdays = [...new Set(games.map((g) => g.matchday))].sort((a, b) => a - b);
    // 12 clubs play a double round robin of 22 rounds.
    expect(matchdays).toHaveLength(22);
    expect(matchdays[matchdays.length - 1]).toBe(SEASON_MATCHDAYS);
    expect(matchdays[0]).toBeGreaterThanOrEqual(1);
    // Strictly increasing, so no two rounds collide on one matchday.
    for (let i = 1; i < matchdays.length; i++) {
      expect(matchdays[i]).toBeGreaterThan(matchdays[i - 1]);
    }
  });

  it("never runs past the end of the calendar, at any allowed size", () => {
    for (let n = MIN_DIVISION_TEAMS; n <= MAX_DIVISION_TEAMS; n += 2) {
      const games = scheduleFor(n);
      expect(games).toHaveLength(n * (n - 1));
      expect(Math.max(...games.map((g) => g.matchday))).toBe(SEASON_MATCHDAYS);
    }
  });
});

describe("injuries and bans only tick for a club that played", () => {
  const banned = {
    pid: 1, suspension: { matchesRemaining: 2, reason: "red card" as const }, yellowCount: 0,
  } as never as Parameters<typeof applySuspensions>[0][number];

  it("serves a match when the club played", () => {
    const [after] = applySuspensions([banned], [], () => true);
    expect(after.suspension?.matchesRemaining).toBe(1);
  });

  it("serves nothing on a blank matchday", () => {
    const [after] = applySuspensions([banned], [], () => false);
    expect(after.suspension?.matchesRemaining).toBe(2);
  });

  it("defaults to serving, which is what the shipped world does", () => {
    const [after] = applySuspensions([banned], []);
    expect(after.suspension?.matchesRemaining).toBe(1);
  });
});

describe("club identities are anchored to a country, not to a tid", () => {
  it("gives the shipped world exactly the shipped club blocks", () => {
    // Pins the refactor from CLUBS[tid] to per-country indexing: for the shipped
    // world the two must agree club for club, or every save renames its clubs.
    const ranges = countryClubRanges(worldCompetitions());
    for (const range of ranges) {
      const block = shippedClubsFor(range.country);
      expect(block).not.toBeNull();
      expect(block).toEqual(CLUBS.slice(range.start, range.end));
    }
  });

  it("has no shipped block for a country the player added", () => {
    expect(shippedClubsFor("Neverland")).toBeNull();
  });
});

describe("retargeting a roster file onto an added league", () => {
  const club = (name: string) => ({ name, abbrev: name.slice(0, 3).toUpperCase(), colors: ["#000", "#fff"] as [string, string] });
  const file = (...matches: string[]): RosterFile => ({
    format: ROSTER_FILE_FORMAT,
    formatVersion: 1,
    competitions: matches.map((match, i) => ({ match, clubs: [club(`${match} club ${i}`)] })),
  });

  it("points the file's competitions at this league's divisions, in order", () => {
    const { file: out, warnings } = retargetRosterFile(
      file("English Division 1", "English Division 2"),
      ["Neverland Division 1", "Neverland Division 2"],
    );
    expect(out.competitions.map((c) => c.match)).toEqual([
      "Neverland Division 1", "Neverland Division 2",
    ]);
    expect(warnings).toEqual([]);
  });

  it("keeps the clubs untouched — only the target changes", () => {
    const source = file("Whatever");
    const { file: out } = retargetRosterFile(source, ["Neverland Division 1"]);
    expect(out.competitions[0].clubs).toEqual(source.competitions[0].clubs);
  });

  it("fills the top division from a single-competition file", () => {
    const { file: out } = retargetRosterFile(file("Anything"), ["N D1", "N D2"]);
    expect(out.competitions).toHaveLength(1);
    expect(out.competitions[0].match).toBe("N D1");
  });

  it("drops what won't fit and says so, rather than silently overwriting", () => {
    const { file: out, warnings } = retargetRosterFile(
      file("One", "Two", "Three"),
      ["N D1", "N D2"],
    );
    expect(out.competitions.map((c) => c.match)).toEqual(["N D1", "N D2"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Three");
  });

  it("does not mutate the file it was given", () => {
    const source = file("English Division 1");
    retargetRosterFile(source, ["Neverland Division 1"]);
    expect(source.competitions[0].match).toBe("English Division 1");
  });

  it("resolves onto real slots once retargeted, where the original would not", () => {
    const competitions = buildCompetitions([
      ...worldLeagueSpecs(),
      { country: "Neverland" },
    ]);
    const world = {
      competitions,
      teams: worldTeamSlots(competitions),
    };
    const source = file("Some Other League");
    // As authored, nothing in the world is called that.
    expect(resolveRosterSlots(world, source).slots).toHaveLength(0);

    const { file: retargeted } = retargetRosterFile(source, ["Neverland Division 1"]);
    const resolved = resolveRosterSlots(world, retargeted);
    expect(resolved.slots).toHaveLength(1);
    // And it lands in Neverland, not in someone else's division.
    const neverlandD1 = competitions.find((c) => c.country === "Neverland" && c.tier === 1)!;
    const slotTid = resolved.slots[0].tid;
    expect(world.teams.find((t) => t.tid === slotTid)!.compId).toBe(neverlandD1.id);
  });
});

describe("generated club identities for an added league", () => {
  it("is deterministic for a given country and size", () => {
    expect(generateClubIdentities("Neverland", 40)).toEqual(generateClubIdentities("Neverland", 40));
  });

  it("gives different countries different clubs", () => {
    const a = generateClubIdentities("Neverland", 20).map((c) => c.name);
    const b = generateClubIdentities("Ruritania", 20).map((c) => c.name);
    expect(a).not.toEqual(b);
  });

  it("produces unique names and unique abbrevs across a two-division country", () => {
    const clubs = generateClubIdentities("Neverland", 40);
    expect(new Set(clubs.map((c) => c.name)).size).toBe(40);
    expect(new Set(clubs.map((c) => c.abbrev)).size).toBe(40);
  });

  it("emits three-letter uppercase abbrevs and a two-tone kit", () => {
    for (const club of generateClubIdentities("Neverland", 40)) {
      expect(club.abbrev).toMatch(/^[A-Z0-9]{3}$/);
      expect(club.colors).toHaveLength(2);
      expect(club.name.length).toBeGreaterThan(2);
    }
  });

  it("abbrevFor walks the name on collision rather than falling back to a counter", () => {
    const taken = new Set(["THO"]);
    expect(abbrevFor("Thornbury", taken)).toBe("HOR");
  });
});
