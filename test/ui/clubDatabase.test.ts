import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  CLUB_DB_PAGE_SIZE, buildClubRows, clubSortAccessors, filterClubRows,
} from "../../src/ui/clubDatabase.js";
import { pageCount, pageOf } from "../../src/ui/playerDatabase.js";
import { ALL_COMPETITIONS, scopeCompIds } from "../../src/core/competitions.js";
import { computePowerRankingSnapshot } from "../../src/core/teams/powerRanking.js";
import { wageBill } from "../../src/core/finance/budget.js";

const league = makeLeague(0, 4);
const rows = buildClubRows(league);

describe("buildClubRows", () => {
  it("covers every club in the world exactly once", () => {
    expect(rows).toHaveLength(league.teams.length);
    expect(new Set(rows.map((r) => r.team.tid)).size).toBe(league.teams.length);
  });

  it("reads strength off the same snapshot the Power Rankings page draws", () => {
    // Not a fresh computeTeamRating call: two pages disagreeing about how good
    // a club is reads as a bug, so this pins them to one source.
    const snapshot = computePowerRankingSnapshot(
      league.teams, league.players, league.played, league.season, league.played.length,
    );
    const byTid = new Map(snapshot.rows.map((r) => [r.tid, r]));
    for (const row of rows) {
      const power = byTid.get(row.team.tid)!;
      expect(row.ovr).toBe(power.ovr);
      expect(row.pot).toBe(power.pot);
      expect(row.powerScore).toBeCloseTo(power.powerScore, 10);
    }
  });

  it("reads the wage bill the way Finance does — senior squad plus academy", () => {
    const salaries = new Map(league.players.map((p) => [p.pid, p.contract.salary]));
    for (const row of rows.slice(0, 20)) {
      expect(row.wages)
        .toBe(wageBill([...row.team.roster, ...row.team.academyRoster], salaries));
    }
  });

  it("carries the club's competition, country and tier", () => {
    for (const row of rows) {
      const comp = league.competitions.find((c) => c.id === row.compId)!;
      expect(row.country).toBe(comp.country);
      expect(row.tier).toBe(comp.tier);
      expect(row.leagueName).toBe(comp.name);
    }
  });

  it("leaves the league position null before a ball is kicked", () => {
    // A standings table over no matches is array order, not a ranking, so
    // quoting a position from it would be inventing one.
    expect(league.played).toHaveLength(0);
    for (const row of rows) expect(row.rank).toBeNull();
  });

  it("averages squad age over the senior roster", () => {
    const byPid = new Map(league.players.map((p) => [p.pid, p]));
    const row = rows.find((r) => r.team.roster.length > 0)!;
    const ages = row.team.roster.map((pid) => league.season - byPid.get(pid)!.born);
    expect(row.avgAge).toBeCloseTo(ages.reduce((a, b) => a + b, 0) / ages.length, 10);
  });
});

describe("filterClubRows", () => {
  const comps = league.competitions;

  it("passes everything through on the default scope", () => {
    expect(filterClubRows(rows, { scope: ALL_COMPETITIONS, name: "" }, comps))
      .toHaveLength(rows.length);
  });

  it("narrows to a scope's competitions and nothing else", () => {
    const scope = { kind: "tier", tier: 1 } as const;
    const ids = scopeCompIds(comps, scope)!;
    const out = filterClubRows(rows, { scope, name: "" }, comps);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(rows.length);
    for (const r of out) expect(ids.has(r.compId)).toBe(true);
  });

  it("matches a club by name or by abbreviation, case-insensitively", () => {
    const target = rows[0].team;
    expect(
      filterClubRows(rows, { scope: ALL_COMPETITIONS, name: target.name.toUpperCase() }, comps)
        .some((r) => r.team.tid === target.tid),
    ).toBe(true);
    expect(
      filterClubRows(rows, { scope: ALL_COMPETITIONS, name: target.abbrev.toLowerCase() }, comps)
        .some((r) => r.team.tid === target.tid),
    ).toBe(true);
  });
});

describe("sorting and paging", () => {
  const accessors = clubSortAccessors();

  it("sorts an unplayed season's record columns as zero rather than dropping rows", () => {
    // The row is real even before the season starts; hiding it would be a
    // stranger answer than a table of zeros.
    for (const row of rows.slice(0, 5)) {
      expect(accessors.points(row)).toBe(0);
      expect(accessors.gf(row)).toBe(0);
      expect(accessors.xg(row)).toBe(0);
    }
  });

  it("sorts a club with no league position last on an ascending position sort", () => {
    for (const row of rows.slice(0, 5)) {
      expect(accessors.rank(row)).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("nets transfer spending the way the column reads", () => {
    const row = rows[0];
    expect(accessors.net(row)).toBe(row.received - row.spent);
  });

  it("pages the whole world without dropping or repeating a club", () => {
    const pages = pageCount(rows.length, CLUB_DB_PAGE_SIZE);
    const seen = new Set<number>();
    for (let i = 0; i < pages; i++) {
      for (const r of pageOf(rows, i, CLUB_DB_PAGE_SIZE)) seen.add(r.team.tid);
    }
    expect(seen.size).toBe(rows.length);
  });
});
