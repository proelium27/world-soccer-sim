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

/**
 * The season columns, on a league that has actually played.
 *
 * Every case above runs on a fresh world, where `league.played` is empty — and
 * that is exactly why the page shipped crashing. `computeStandings` asserts
 * every club of every match it is handed is in the ids it was given, so
 * building one division's table from the whole world's matches threw on the
 * first fixture from another division, i.e. on any save with a ball kicked.
 * The matches here are hand-built rather than simmed: a real season is minutes
 * of sim for a fault that needs only two fixtures in two divisions.
 */
describe("buildClubRows with matches played", () => {
  /** A result with an empty box score — the standings only read the score. */
  const match = (home: number, away: number, homeGoals: number, awayGoals: number) => ({
    home,
    away,
    homeGoals,
    awayGoals,
    possessionHome: 0.5,
    matchday: 1,
    boxScore: { home: [], away: [], events: [] },
  });

  const [compA, compB] = league.competitions;
  const a = league.teams.filter((t) => t.compId === compA.id).map((t) => t.tid);
  const b = league.teams.filter((t) => t.compId === compB.id).map((t) => t.tid);
  const played = [match(a[0], a[1], 3, 0), match(b[0], b[1], 1, 1)];
  const withPlay = { ...league, played };

  it("builds a table per division instead of throwing on another division's match", () => {
    // Two competitions, one match each: on the broken version the first
    // division's table hit the second division's fixture and threw.
    const built = buildClubRows(withPlay);
    expect(built).toHaveLength(league.teams.length);
  });

  it("counts only the matches played in the club's own division", () => {
    const built = buildClubRows(withPlay);
    const by = new Map(built.map((r) => [r.team.tid, r]));
    expect(by.get(a[0])!.table).toMatchObject({ played: 1, won: 1, gf: 3, points: 3 });
    expect(by.get(a[1])!.table).toMatchObject({ played: 1, lost: 1, ga: 3, points: 0 });
    expect(by.get(b[0])!.table).toMatchObject({ played: 1, drawn: 1, points: 1 });
    // Everyone else in those divisions played nobody, and the two divisions do
    // not contaminate each other's records.
    expect(by.get(a[2])!.table).toMatchObject({ played: 0, points: 0 });
    expect(by.get(b[2])!.table).toMatchObject({ played: 0, points: 0 });
  });

  it("ranks a division once it has started, and the winner leads it", () => {
    const built = buildClubRows(withPlay);
    const by = new Map(built.map((r) => [r.team.tid, r]));
    expect(by.get(a[0])!.rank).toBe(1);
    // A club in a division with nothing played keeps no position: an unplayed
    // table is array order, not a ranking.
    const quiet = league.competitions[2];
    const quietTid = league.teams.find((t) => t.compId === quiet.id)!.tid;
    expect(by.get(quietTid)!.rank).toBeNull();
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
