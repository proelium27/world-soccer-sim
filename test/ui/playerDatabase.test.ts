import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  PLAYER_DB_PAGE_SIZE, STAT_COLUMNS, buildPlayerRows, careerTotalsIndex, filterPlayerRows,
  filterToSeason, matchesStatus, pageCount, pageOf, playerSortAccessors, seasonStatsIndex,
  seasonsWithStats, sortKeysFor,
  type PlayerDbFilters,
} from "../../src/ui/playerDatabase.js";
import { scopeCompIds, worldCompetitions } from "../../src/core/competitions.js";
import { emptySeasonStats, type Player, type SeasonStats } from "../../src/core/players/types.js";
import { totalsOf } from "../../src/core/frivolities/stats.js";

const league = makeLeague(0, 4);
/** The database's default view: no fog (this is the pure layer), no filters. */
const truePot = (p: Player) => p.potential;
const rows = buildPlayerRows(league, truePot);

function filters(patch: Partial<PlayerDbFilters> = {}): PlayerDbFilters {
  return {
    fields: {},
    minValue: null,
    maxValue: null,
    status: "all",
    name: "",
    ...patch,
  };
}

describe("buildPlayerRows", () => {
  it("covers every player in the pool exactly once", () => {
    expect(rows).toHaveLength(league.players.length);
    expect(new Set(rows.map((r) => r.player.pid)).size).toBe(league.players.length);
  });

  it("tags a rostered player with his club and competition, a free agent with neither", () => {
    const team = league.teams[3];
    const rostered = rows.find((r) => r.player.pid === team.roster[0])!;
    expect(rostered.tid).toBe(team.tid);
    expect(rostered.compId).toBe(team.compId);
    expect(rostered.status).toBe("senior");

    // A *freshly generated* world has no free agents at all — every player is
    // generated onto a roster, and the unsigned pool only opens up once
    // contracts start expiring. So the free-agent case is built rather than
    // looked for: release one and he must fall through to "on nobody's books".
    const orphan = team.roster[1];
    const released = {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === team.tid ? { ...t, roster: t.roster.filter((pid) => pid !== orphan) } : t,
      ),
    };
    const free = buildPlayerRows(released, truePot).find((r) => r.player.pid === orphan)!;
    expect(free.status).toBe("free");
    expect(free.tid).toBeNull();
    expect(free.compId).toBeNull();
  });

  it("dates age and contract length against the league's current season", () => {
    const row = rows[0];
    expect(row.age).toBe(league.season - row.player.born);
    expect(row.contractYears)
      .toBe(Math.max(0, row.player.contract.expiresSeason - league.season));
  });

  it("prices value on the potential it is handed, not on the true one", () => {
    // The page hands in the *scouted* estimate, so a pessimistic scout must
    // produce a lower valuation — that is the whole reason the accessor exists.
    const pessimistic = buildPlayerRows(league, (p) => Math.max(1, p.potential - 20));
    const byPid = new Map(pessimistic.map((r) => [r.player.pid, r]));
    // Somebody in the world has unfulfilled potential to be priced for.
    const moved = rows.filter((r) => byPid.get(r.player.pid)!.value < r.value);
    expect(moved.length).toBeGreaterThan(0);
  });
});

describe("matchesStatus", () => {
  it("puts academy and trial players under 'at a club' as well as 'youth'", () => {
    const academy = { status: "academy" } as never;
    expect(matchesStatus(academy, "contracted")).toBe(true);
    expect(matchesStatus(academy, "academy")).toBe(true);
    expect(matchesStatus(academy, "free")).toBe(false);
    expect(matchesStatus({ status: "free" } as never, "contracted")).toBe(false);
  });
});

describe("filterPlayerRows", () => {
  it("applies a competition scope to the whole world, not to a page of it", () => {
    const comps = worldCompetitions();
    const compIds = scopeCompIds(comps, { kind: "tier", tier: 1 })!;
    const out = filterPlayerRows(rows, filters({ fields: { compIds } }), league.season);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(rows.length);
    for (const r of out) expect(compIds.has(r.compId!)).toBe(true);
  });

  it("drops free agents from any competition scope, since they are in none", () => {
    const compIds = scopeCompIds(worldCompetitions(), { kind: "tier", tier: 1 })!;
    const out = filterPlayerRows(rows, filters({ fields: { compIds } }), league.season);
    expect(out.some((r) => r.status === "free")).toBe(false);
  });

  it("tests the potential range against the SCOUTED estimate, not the truth", () => {
    // A view that reports everyone at 99 must let everyone through a min-99
    // filter, however low their real potential — otherwise the column and the
    // filter beside it would be answering different questions.
    const optimistic = buildPlayerRows(league, () => 99);
    const out = filterPlayerRows(optimistic, filters({ fields: { minPot: 99 } }), league.season);
    expect(out).toHaveLength(optimistic.length);

    const strict = filterPlayerRows(rows, filters({ fields: { minPot: 99 } }), league.season);
    expect(strict.length).toBeLessThan(rows.length);
  });

  it("matches names case-insensitively on a substring", () => {
    const target = rows[10].player.name;
    const out = filterPlayerRows(rows, filters({ name: target.toUpperCase() }), league.season);
    expect(out.some((r) => r.player.name === target)).toBe(true);
    for (const r of out) expect(r.player.name.toLowerCase()).toContain(target.toLowerCase());
  });

  it("combines constraints rather than taking the last one set", () => {
    const out = filterPlayerRows(
      rows,
      filters({ fields: { position: "GK", minOvr: 60 } }),
      league.season,
    );
    for (const r of out) {
      expect(r.player.pos).toBe("GK");
      expect(r.player.ovr).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("season and career views", () => {
  // Two players given a line for season 3, so the season view has something to
  // read without paying for a simulated season.
  const scorer = league.players[0];
  const other = league.players[1];
  const line = (goals: number): SeasonStats => ({
    ...emptySeasonStats(3, 0),
    appearances: 20,
    goals,
    yellowCards: goals,
    crosses: goals * 2,
    interceptions: goals * 3,
  });
  const withStats = {
    ...league,
    players: league.players.map((p) =>
      p.pid === scorer.pid ? { ...p, stats: [line(12)] }
        : p.pid === other.pid ? { ...p, stats: [line(3)] }
        : p),
  };
  const statsRows = buildPlayerRows(withStats, truePot);
  const index = seasonStatsIndex(withStats.players, 3);

  it("lists the seasons anyone has a line for, newest first", () => {
    expect(seasonsWithStats(withStats.players)).toEqual([3]);
  });

  it("narrows the table to players the season has a record of", () => {
    const inSeason = filterToSeason(statsRows, index);
    expect(inSeason).toHaveLength(2);
    expect(inSeason.map((r) => r.player.pid).sort()).toEqual([scorer.pid, other.pid].sort());
  });

  it("sorts a season column by that season's line", () => {
    const accessors = playerSortAccessors(() => "", () => "", index);
    const rowOf = (pid: number) => statsRows.find((r) => r.player.pid === pid)!;
    expect(accessors.stat_goals(rowOf(scorer.pid))).toBe(12);
    expect(accessors.stat_goals(rowOf(other.pid))).toBe(3);
    // A player with no line for the season sorts as 0 rather than being dropped
    // — dropping here would make a sort silently change which rows exist.
    expect(accessors.stat_goals(statsRows.find((r) => r.player.pid === league.players[5].pid)!))
      .toBe(0);
  });

  it("keeps the ATTRIBUTE and the STAT apart for the two names that collide", () => {
    // `crosses` and `interceptions` name both an attribute and a counted stat.
    // One flat key space would let a header sort by the other one, silently and
    // on only two columns of sixteen.
    const accessors = playerSortAccessors(() => "", () => "", index);
    const row = statsRows.find((r) => r.player.pid === scorer.pid)!;
    expect(accessors.crosses(row)).toBe(row.player.ratings.crosses);
    expect(accessors.stat_crosses(row)).toBe(24);
    expect(accessors.interceptions(row)).toBe(row.player.ratings.interceptions);
    expect(accessors.stat_interceptions(row)).toBe(36);
  });

  it("sorts a career column by career totals, summed the way Frivolities sums them", () => {
    const totals = careerTotalsIndex(withStats.players);
    const accessors = playerSortAccessors(() => "", () => "", undefined, totals);
    const row = statsRows.find((r) => r.player.pid === scorer.pid)!;
    expect(accessors.stat_goals(row)).toBe(12);
    expect(totals.get(scorer.pid)!.goals)
      .toBe(totalsOf(withStats.players.find((p) => p.pid === scorer.pid)!.stats).goals);
  });

  it("drops the card columns from the career view, which has no total for them", () => {
    const careerColumns = STAT_COLUMNS.filter((c) => c.career).map((c) => c.key);
    expect(careerColumns).not.toContain("stat_yellowCards");
    expect(careerColumns).not.toContain("stat_redCards");
    expect(careerColumns).toContain("stat_goals");
  });
});

describe("sorting and paging", () => {
  const accessors = playerSortAccessors(() => "", () => "");

  it("offers an accessor for every sortable column", () => {
    // Every key in the table must have one, or a header sorts by nothing while
    // looking like it sorted.
    for (const key of Object.keys(accessors)) {
      expect(typeof accessors[key as keyof typeof accessors]).toBe("function");
    }
    expect(accessors.pot(rows[0])).toBe(rows[0].scoutedPot);
    expect(accessors.speed(rows[0])).toBe(rows[0].player.ratings.speed);
  });

  it("gives every key a view offers a header for a working accessor", () => {
    // The two lists are maintained separately (one drives the headers, one the
    // sorting), so this is what catches a column added to a view and forgotten
    // in the accessor table — which sorts by nothing while looking like it did.
    const sets = ["overview", "attributes", "season", "career"] as const;
    for (const set of sets) {
      for (const key of sortKeysFor(set)) {
        expect(accessors[key], `${set} offers ${key}`).toBeTypeOf("function");
      }
    }
  });

  it("keeps the attribute and stat views' key sets apart", () => {
    // The proof that namespacing worked: the two names that exist in both
    // vocabularies land in different sets.
    expect(sortKeysFor("attributes").has("crosses")).toBe(true);
    expect(sortKeysFor("attributes").has("stat_crosses")).toBe(false);
    expect(sortKeysFor("season").has("stat_crosses")).toBe(true);
    expect(sortKeysFor("season").has("crosses")).toBe(false);
  });

  it("pages without dropping or repeating a row", () => {
    const total = rows.length;
    const pages = pageCount(total);
    const seen = new Set<number>();
    for (let i = 0; i < pages; i++) {
      for (const r of pageOf(rows, i)) seen.add(r.player.pid);
    }
    expect(seen.size).toBe(total);
    expect(pageOf(rows, 0)).toHaveLength(PLAYER_DB_PAGE_SIZE);
  });

  it("clamps an out-of-range page onto the last one instead of showing nothing", () => {
    const last = pageOf(rows, 9999);
    expect(last.length).toBeGreaterThan(0);
    expect(last).toEqual(pageOf(rows, pageCount(rows.length) - 1));
  });

  it("reports one page for an empty result, so the footer still reads sanely", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageOf([], 0)).toEqual([]);
  });
});
