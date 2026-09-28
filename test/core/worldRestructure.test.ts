import { describe, expect, it } from "vitest";
import { buildCompetitions, divisionsOf, type Competition } from "../../src/core/competitions.js";
import {
  leagueSpecFromDivisions, queueAddCountry, queueCountryEdit, queueRemoveCountry, discardCountryEdit,
  editedCountries,
} from "../../src/core/worldEdit.js";
import { createLeagueState, type LeagueStore } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { mulberry32 } from "../../src/engine/rng.js";

/** Two small countries, two divisions of ten each. */
const WORLD = buildCompetitions([
  { country: "Atlantis", d1Teams: 10, d2Teams: 10 },
  { country: "Lemuria", d1Teams: 10, d2Teams: 10, strengthOffset: 6 },
]);

function queue(league: LeagueStore, next: Competition[] | undefined | null): LeagueStore {
  expect(next).toBeTruthy();
  return { ...league, pendingCompetitions: next! };
}

/** Every roster pid exists, no pid is on two clubs, and every club is in a live competition. */
function expectConsistent(league: LeagueStore) {
  const pids = new Set(league.players.map((p) => p.pid));
  const seen = new Set<number>();
  const compIds = new Set(league.competitions.map((c) => c.id));
  for (const t of league.teams) {
    expect(compIds.has(t.compId), `club ${t.tid} in a live competition`).toBe(true);
    for (const pid of [...t.roster, ...t.academyRoster]) {
      expect(pids.has(pid), `pid ${pid} exists`).toBe(true);
      expect(seen.has(pid), `pid ${pid} on one club`).toBe(false);
      seen.add(pid);
    }
  }
  for (const c of league.competitions) {
    const n = league.teams.filter((t) => t.compId === c.id).length;
    expect(n, `${c.name} club count`).toBe(c.teamCount ?? n);
  }
  const liveTids = new Set(league.teams.map((t) => t.tid));
  for (const g of league.schedule) {
    expect(liveTids.has(g.home) && liveTids.has(g.away)).toBe(true);
  }
  for (const l of league.activeLoans) {
    expect(liveTids.has(l.parentTid) && liveTids.has(l.loaneeTid)).toBe(true);
  }
}

describe("changing the world's shape at the rollover", () => {
  it("grows, shrinks, removes and adds leagues, and the world keeps playing", () => {
    const userTid = 0;
    let league = createLeagueState(userTid, mulberry32(11), 11, "normal", WORLD);
    league = simThrough(league, "season", mulberry32(12));

    const [a1, a2] = divisionsOf(league.competitions, "Atlantis");
    const retired = league.retiredCompetitions ?? [];
    const atlantis = { ...leagueSpecFromDivisions([a1, a2]), d1Teams: 12, d2Teams: 8 };
    let pending = queueCountryEdit(league.competitions, undefined, "Atlantis", atlantis, null, retired);
    pending = queueRemoveCountry(league.competitions, pending, "Lemuria");
    pending = queueAddCountry(league.competitions, pending, retired, {
      country: "Mu", divisions: 1, d1Teams: 10, strengthOffset: 10, nationalities: { Brazil: 100 },
    });
    league = queue(league, pending);
    expect([...editedCountries(league.competitions, league.pendingCompetitions)].sort())
      .toEqual(["Atlantis", "Lemuria", "Mu"]);

    // Who finished bottom of Atlantis's second division and stayed in it.
    const before = league;
    const lemuriaTids = new Set(before.teams
      .filter((t) => divisionsOf(before.competitions, "Lemuria").some((c) => c.id === t.compId))
      .map((t) => t.tid));

    league = simOffseason(league, mulberry32(13));
    expect(league.pendingCompetitions).toBeUndefined();

    // Shape.
    const count = (country: string, tier: number) => {
      const comp = league.competitions.find((c) => c.country === country && c.tier === tier)!;
      return league.teams.filter((t) => t.compId === comp.id).length;
    };
    expect(count("Atlantis", 1)).toBe(12);
    expect(count("Atlantis", 2)).toBe(8);
    expect(count("Mu", 1)).toBe(10);
    expect(league.competitions.some((c) => c.country === "Lemuria")).toBe(false);
    expect(league.retiredCompetitions?.map((c) => c.country)).toEqual(["Lemuria", "Lemuria"]);

    // All 20 Lemurian clubs folded, plus two Atlantis clubs; all remembered.
    const defunct = league.defunctTeams ?? [];
    expect(defunct).toHaveLength(22);
    for (const tid of lemuriaTids) expect(defunct.some((d) => d.tid === tid)).toBe(true);
    // The two Atlantis clubs that folded are the two that finished bottom of the
    // second division (the bottom division, so nobody was relegated out of it).
    const last = league.seasonHistory.at(-1)!;
    const d2Table = last.table.filter((r) => last.compsByTid[r.tid] === a2.id).map((r) => r.tid);
    expect(defunct.filter((d) => !lemuriaTids.has(d.tid)).map((d) => d.tid).sort())
      .toEqual(d2Table.slice(-2).sort());
    expect(league.teams.some((t) => t.tid === userTid)).toBe(true);

    // New clubs: fresh tids, distinct names, a squad each, from their league's mix.
    const oldTids = new Set(before.teams.map((t) => t.tid));
    const created = league.teams.filter((t) => !oldTids.has(t.tid));
    expect(created).toHaveLength(12);
    expect(new Set(league.teams.map((t) => t.name)).size).toBe(league.teams.length);
    const mu = league.competitions.find((c) => c.country === "Mu")!;
    const muPlayers = league.teams.filter((t) => t.compId === mu.id).flatMap((t) => t.roster)
      .map((pid) => league.players.find((p) => p.pid === pid)!);
    expect(muPlayers.length).toBeGreaterThan(150);
    expect(muPlayers.filter((p) => p.nationality === "Brazil").length / muPlayers.length).toBeGreaterThan(0.6);

    expectConsistent(league);

    // And it plays on: a whole season and another rollover.
    league = simThrough(league, "season", mulberry32(14));
    league = simOffseason(league, mulberry32(15));
    expectConsistent(league);
    expect(league.teams.length).toBe(30);
  }, 300_000);

  it("never folds the user's club: a removed division drops it into the one above", () => {
    let league = createLeagueState(15, mulberry32(21), 21, "normal", WORLD);
    league = simThrough(league, "season", mulberry32(22));
    const [a1, a2] = divisionsOf(league.competitions, "Atlantis");
    const spec = { ...leagueSpecFromDivisions([a1, a2]), divisions: 1 as const };
    league = queue(league, queueCountryEdit(league.competitions, undefined, "Atlantis", spec, null, []));
    league = simOffseason(league, mulberry32(23));

    const user = league.teams.find((t) => t.tid === 15)!;
    expect(user).toBeDefined();
    expect(user.compId).toBe(a1.id);
    expect(league.teams.filter((t) => t.compId === a1.id)).toHaveLength(11);
    expect(league.retiredCompetitions?.map((c) => c.id)).toEqual([a2.id]);
    expectConsistent(league);
  }, 300_000);
});

describe("queue bookkeeping", () => {
  it("undoing a removal or an addition empties the queue", () => {
    const retired: Competition[] = [];
    const removed = queueRemoveCountry(WORLD, undefined, "Lemuria");
    expect(discardCountryEdit(WORLD, removed, "Lemuria")).toBeUndefined();
    const added = queueAddCountry(WORLD, undefined, retired, { country: "Mu", divisions: 1, d1Teams: 10 });
    expect(added?.at(-1)?.id).toBe(4);
    expect(discardCountryEdit(WORLD, added!, "Mu")).toBeUndefined();
    // A name already in the world can't be added twice.
    expect(queueAddCountry(WORLD, undefined, retired, { country: "atlantis " })).toBeNull();
  });

  it("gives an added division a fresh id, never a retired one", () => {
    const retired = [{ ...WORLD[0], id: 9, country: "Gone" }];
    const [a1, a2] = divisionsOf(WORLD, "Atlantis");
    const spec = { ...leagueSpecFromDivisions([a1, a2]), divisions: 3 as const, d3Teams: 10 };
    const next = queueCountryEdit(WORLD, undefined, "Atlantis", spec, null, retired)!;
    const d3 = next.find((c) => c.country === "Atlantis" && c.tier === 3)!;
    expect(d3.id).toBe(10);
    // Placed with its country, not at the end of the table.
    expect(next.findIndex((c) => c.id === 10)).toBe(2);
  });
});
