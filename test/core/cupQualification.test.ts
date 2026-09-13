import { describe, it, expect } from "vitest";
import type { StandingsRow } from "../../src/core/standings.js";
import type { Competition } from "../../src/core/competitions.js";
import { worldCompetitions } from "../../src/core/competitions.js";
import {
  allocateContinentalPlaces, qualificationByTid, qualifyCupTeams, domesticCupWinners,
  drawGroupOf,
} from "../../src/core/cup/qualification.js";
import { buildCupState } from "../../src/core/cup/cup.js";
import {
  CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT, CUP_LEAGUE_PHASE_SIZE, SHIELD_LEAGUE_PHASE_SIZE,
} from "../../src/core/constants.js";

/**
 * A synthetic table where the tid encodes the finish: `li * 100 + rank`, with
 * `rank` 0-based. So tid 305 is the 6th-place club of tier-1 league index 3, and
 * `tid % 100` reads back a club's finishing position at a glance. Tier-2 tables
 * use a 9000 block, one club per division, so a domestic cup winner from outside
 * the top flight can be named without pretending to be in a top-flight table.
 */
function fakeTable(tids: number[]): StandingsRow[] {
  return tids.map((tid, i) => ({
    tid, played: 38, won: 0, drawn: 0, lost: 0, gf: 100 - i, ga: 0, gd: 100 - i, points: 100 - i,
  }));
}

function tablesFor(comps: Competition[], clubsPerLeague = 12): Map<number, StandingsRow[]> {
  const tables = new Map<number, StandingsRow[]>();
  comps.filter((c) => c.tier === 1).forEach((c, li) => {
    tables.set(c.id, fakeTable(Array.from({ length: clubsPerLeague }, (_, r) => li * 100 + r)));
  });
  comps.filter((c) => c.tier === 2).forEach((c, li) => {
    tables.set(c.id, fakeTable(Array.from({ length: 4 }, (_, r) => 9000 + li * 10 + r)));
  });
  return tables;
}

/** Tier-1 leagues in world order, so a test can name "the first strong league". */
function tier1(comps: Competition[]): Competition[] {
  return comps.filter((c) => c.tier === 1);
}

describe("continental qualification — the routes in", () => {
  const comps = worldCompetitions();
  const tables = tablesFor(comps);

  it("places every qualifier exactly once across both competitions", () => {
    const places = allocateContinentalPlaces(comps, tables, {
      domesticCupWinners: new Map([[tier1(comps)[0].country, 8]]), // England's 9th
      holders: { continental: 106, shield: 205 },
    });
    const all = [...places.values()].flat().map((e) => e.tid);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps both fields at exactly their shipped size however clubs get in", () => {
    const routes = {
      domesticCupWinners: domesticCupWinners(
        tier1(comps).map((c, li) => ({ country: c.country, championTid: li * 100 + 9 })),
      ),
      holders: { continental: 107, shield: 208 },
    };
    const cup = qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT, routes);
    const shield = qualifyCupTeams(comps, tables, SHIELD_FORMAT, routes);
    expect(cup.field).toHaveLength(CUP_LEAGUE_PHASE_SIZE);
    expect(shield.field).toHaveLength(SHIELD_LEAGUE_PHASE_SIZE);
    expect(shield.field.filter((t) => cup.field.includes(t))).toEqual([]);
  });

  it("with no routes supplied, qualifies exactly as league position alone did", () => {
    // Strong leagues send their top 4, weak leagues their top 2 — so every
    // Continental Cup qualifier finished 4th or better, and the Shield's take
    // the places directly below. This is the pre-change behaviour, and it has
    // to survive untouched: a save whose cups are all still unplayed supplies
    // no routes at all.
    const cup = qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT).field;
    expect(cup).toHaveLength(CUP_LEAGUE_PHASE_SIZE);
    for (const tid of cup) expect(tid % 100).toBeLessThan(4);

    const shield = qualifyCupTeams(comps, tables, SHIELD_FORMAT).field;
    expect(shield).toHaveLength(SHIELD_LEAGUE_PHASE_SIZE);
    // A strong league's 5th/6th, a weak league's 3rd/4th.
    for (const tid of shield) expect([2, 3, 4, 5]).toContain(tid % 100);
  });
});

describe("domestic cup winners", () => {
  const comps = worldCompetitions();
  const tables = tablesFor(comps);
  const england = tier1(comps)[0];

  it("takes a Shield place from mid-table, displacing that league's lowest qualifier", () => {
    const routes = { domesticCupWinners: new Map([[england.country, 8]]) }; // 9th in England
    const shield = qualifyCupTeams(comps, tables, SHIELD_FORMAT, routes);
    const english = shield.field.filter((t) => t < 100);
    // Normally 5th and 6th (tids 4, 5). The cup winner takes one place, so 5th
    // stays and 6th makes way — the lowest league-position qualifier, not the
    // highest.
    expect(english.sort((a, b) => a - b)).toEqual([4, 8]);
  });

  it("changes nothing when the cup winner already qualified for the Cup", () => {
    const withWinner = qualifyCupTeams(comps, tables, SHIELD_FORMAT, {
      domesticCupWinners: new Map([[england.country, 2]]), // 3rd — already in the Cup
    }).field;
    const without = qualifyCupTeams(comps, tables, SHIELD_FORMAT).field;
    expect(withWinner).toEqual(without);
  });

  it("lets a second-division winner in, and seeds him below every top-flight club", () => {
    const secondTier = comps.find((c) => c.tier === 2 && c.country === england.country)!;
    const winner = tables.get(secondTier.id)![0].tid;
    const shield = qualifyCupTeams(comps, tables, SHIELD_FORMAT, {
      domesticCupWinners: new Map([[england.country, winner]]),
    });
    expect(shield.field).toContain(winner);
    // Last seed: a tier-2 club's league finish doesn't compare to a top-flight
    // one, so he goes in the bottom pot rather than being seeded on raw rank.
    expect(shield.field[shield.field.length - 1]).toBe(winner);
  });

  it("keeps a second-division entrant apart from his own country in the draw", () => {
    const secondTier = comps.find((c) => c.tier === 2 && c.country === england.country)!;
    const winner = tables.get(secondTier.id)![0].tid;
    const { entrants, drawGroups, compOf } = qualifyCupTeams(comps, tables, SHIELD_FORMAT, {
      domesticCupWinners: new Map([[england.country, winner]]),
    });
    const englishTopFlight = entrants.find((e) => e.compId === england.id)!;
    // His own division is a different competition — which is exactly why the
    // draw can't key on compId any more.
    expect(compOf.get(winner)).toBe(secondTier.id);
    expect(compOf.get(winner)).not.toBe(compOf.get(englishTopFlight.tid));
    expect(drawGroups.get(winner)).toBe(drawGroups.get(englishTopFlight.tid));
  });

  it("reads a country's champion off its finished cup, and ignores an unfinished one", () => {
    const winners = domesticCupWinners([
      { country: "England", championTid: 7 },
      { country: "Spain", championTid: null },
    ]);
    expect(winners.get("England")).toBe(7);
    expect(winners.has("Spain")).toBe(false);
  });
});

describe("title holders", () => {
  const comps = worldCompetitions();
  const tables = tablesFor(comps);

  it("keeps the Cup holder in the Cup from outside the qualifying places", () => {
    const cup = qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT, {
      holders: { continental: 7 }, // England's 8th
    });
    expect(cup.field).toContain(7);
    const english = cup.field.filter((t) => t < 100).sort((a, b) => a - b);
    expect(english).toEqual([0, 1, 2, 7]); // 4th makes way for the holder
  });

  it("promotes the Shield holder into the Cup", () => {
    const routes = { holders: { shield: 105 } }; // 6th of the second league — a Shield place
    const cup = qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT, routes).field;
    const shield = qualifyCupTeams(comps, tables, SHIELD_FORMAT, routes).field;
    expect(cup).toContain(105);
    expect(shield).not.toContain(105);
  });

  it("cascades the club it displaced down into the Shield", () => {
    const routes = { holders: { continental: 7 } };
    const shield = qualifyCupTeams(comps, tables, SHIELD_FORMAT, routes).field;
    // England's 4th lost his Cup place to the holder, so he drops into the
    // Shield — and the Shield's own lowest (6th) drops out of Europe entirely.
    // Without the holder these two places are 5th and 6th (tids 4, 5).
    const english = shield.filter((t) => t < 100).sort((a, b) => a - b);
    expect(english).toEqual([3, 4]);
  });

  it("calls it a league place, not a holder's, when he won his league too", () => {
    // The holder is claimed before the table is read, so without this the label
    // follows the claim and a first-placed champion's row reads "as holders".
    // He is in on merit and his league keeps all its places; the route only
    // exists to explain a place a finish doesn't.
    const byTid = qualificationByTid(comps, tables, { holders: { continental: 0 } });
    expect(byTid.get(0)).toEqual({ competition: "continental", route: "table" });
  });

  it("credits a club pushed down by a holder to the league, not to a route", () => {
    const byTid = qualificationByTid(comps, tables, { holders: { continental: 7 } });
    expect(byTid.get(7)).toEqual({ competition: "continental", route: "holder" });
    // England's 4th lost his Cup place and landed in the Shield. He got there on
    // his finish, so that is what it should say.
    expect(byTid.get(3)).toEqual({ competition: "shield", route: "table" });
  });

  it("changes nothing when the holder qualified through his league anyway", () => {
    const withHolder = qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT, {
      holders: { continental: 1 }, // 2nd — in on merit
    }).field;
    expect(withHolder).toEqual(qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT).field);
  });

  it("ignores a holder who has no league table to enter from", () => {
    const cup = qualifyCupTeams(comps, tables, CONTINENTAL_CUP_FORMAT, {
      holders: { continental: 999_999 },
    });
    expect(cup.field).toHaveLength(CUP_LEAGUE_PHASE_SIZE);
    expect(cup.field).not.toContain(999_999);
  });
});

describe("qualificationByTid", () => {
  it("names the competition and the route for every qualified club", () => {
    const comps = worldCompetitions();
    const tables = tablesFor(comps);
    const byTid = qualificationByTid(comps, tables, {
      domesticCupWinners: new Map([[tier1(comps)[0].country, 8]]),
      holders: { continental: 7 },
    });
    expect(byTid.get(0)).toEqual({ competition: "continental", route: "table" });
    expect(byTid.get(7)).toEqual({ competition: "continental", route: "holder" });
    expect(byTid.get(8)).toEqual({ competition: "shield", route: "domestic-cup" });
    expect(byTid.has(11)).toBe(false); // 12th qualifies for nothing
    // Plus the Americas Cup's 16, which the same one-pass allocation fills from
    // the American top flights alongside the two European competitions.
    expect(byTid.size).toBe(CUP_LEAGUE_PHASE_SIZE + SHIELD_LEAGUE_PHASE_SIZE + 16);
  });
});

describe("the draw still builds with the new routes", () => {
  it("seeds a Cup and a Shield whose fields both draw legally", () => {
    const comps = worldCompetitions();
    const tables = tablesFor(comps);
    const secondTier = comps.find((c) => c.tier === 2)!;
    const routes = {
      domesticCupWinners: domesticCupWinners([
        { country: secondTier.country, championTid: tables.get(secondTier.id)![0].tid },
      ]),
      holders: { continental: 7, shield: 205 },
    };
    const cup = buildCupState(comps, tables, 5, CONTINENTAL_CUP_FORMAT, routes);
    const shield = buildCupState(comps, tables, 5, SHIELD_FORMAT, routes);
    expect(cup?.leaguePhase?.teams).toHaveLength(CUP_LEAGUE_PHASE_SIZE);
    expect(shield?.leaguePhase?.teams).toHaveLength(SHIELD_LEAGUE_PHASE_SIZE);

    // No club meets his own country in the league phase — the constraint the
    // draw keys on drawGroups for.
    const groups = drawGroupOf(qualifyCupTeams(comps, tables, SHIELD_FORMAT, routes).entrants);
    for (const m of shield!.leaguePhase!.matches) {
      expect(groups.get(m.home)).not.toBe(groups.get(m.away));
    }
  });
});
