import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  PLAYER_DB_PAGE_SIZE, buildPlayerRows, filterPlayerRows, matchesStatus, pageCount, pageOf,
  playerSortAccessors,
  type PlayerDbFilters,
} from "../../src/ui/playerDatabase.js";
import { scopeCompIds, worldCompetitions } from "../../src/core/competitions.js";
import type { Player } from "../../src/core/players/types.js";

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
