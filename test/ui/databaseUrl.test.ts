import { describe, expect, it } from "vitest";
import { defaultView, viewFromParams, viewToParams } from "../../src/ui/databaseUrl.js";
import { EMPTY_PLAYER_FILTERS } from "../../src/ui/components/PlayerFilterBar.js";
import { encodeScope } from "../../src/core/competitions.js";

const base = defaultView("ovr", "desc");
const params = (s = "") => new URLSearchParams(s);

describe("viewToParams", () => {
  it("writes nothing at all for an untouched view", () => {
    // A URL carrying a dozen empty parameters makes "did I filter this?"
    // unanswerable at a glance, which is the thing the page is for.
    expect(viewToParams(base, base, params()).toString()).toBe("");
  });

  it("writes only the fields that differ from the default", () => {
    const out = viewToParams(
      { ...base, filters: { ...EMPTY_PLAYER_FILTERS, position: "ST", minOvr: "80" } },
      base,
      params(),
    );
    expect(out.get("pos")).toBe("ST");
    expect(out.get("ovr")).toBe("80");
    expect(out.get("nat")).toBeNull();
    expect(out.get("sort")).toBeNull();
  });

  it("clears a parameter when its field goes back to the default", () => {
    const withPos = viewToParams(
      { ...base, filters: { ...EMPTY_PLAYER_FILTERS, position: "ST" } }, base, params(),
    );
    expect(viewToParams(base, base, withPos).get("pos")).toBeNull();
  });

  it("preserves parameters it does not own", () => {
    // The column set is written by its own hook; clobbering it here would reset
    // the table's columns every time a filter changed.
    const out = viewToParams(base, base, params("cols=attributes"));
    expect(out.get("cols")).toBe("attributes");
  });

  it("round-trips a fully specified view", () => {
    const view = {
      filters: {
        ...EMPTY_PLAYER_FILTERS,
        position: "CB",
        nationality: "Spain",
        scope: encodeScope({ kind: "tier", tier: 1 }),
        minOvr: "70",
        maxAge: "24",
        maxWage: "200k",
      },
      name: "garcia",
      status: "free" as const,
      sortKey: "speed",
      sortDir: "asc" as const,
      season: 7,
    };
    expect(viewFromParams(viewToParams(view, base, params()), base)).toEqual(view);
  });
});

describe("viewFromParams", () => {
  it("falls back field by field rather than refusing a malformed URL", () => {
    const view = viewFromParams(params("status=nonsense&dir=sideways&season=abc"), base);
    expect(view.status).toBe("all");
    expect(view.sortDir).toBe("desc");
    expect(view.season).toBeNull();
    expect(view.filters).toEqual(EMPTY_PLAYER_FILTERS);
  });

  it("reads a season of 0 as a season rather than as absent", () => {
    expect(viewFromParams(params("season=0"), base).season).toBe(0);
  });

  it("keeps an unknown sort key, so a link to a column this build renames still opens", () => {
    // Sorting by a key with no accessor leaves the natural order, which is a
    // better outcome than dropping the rest of the shared view on the floor.
    expect(viewFromParams(params("sort=whatever"), base).sortKey).toBe("whatever");
  });
});
