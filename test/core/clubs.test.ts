import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generateLeague } from "../../src/core/league/generate.js";
import { makeLeague } from "../helpers/league.js";
import { CLUBS, assignIdentities } from "../../src/core/teams/clubs.js";
import { englandCompetitions } from "../../src/core/competitions.js";

describe("CLUBS", () => {
  it("has exactly 884 entries", () => {
    expect(CLUBS).toHaveLength(884);
  });

  it("has all unique abbreviations that are exactly 3 characters", () => {
    const abbrevs = CLUBS.map((c) => c.abbrev);
    expect(new Set(abbrevs).size).toBe(884);
    for (const a of abbrevs) {
      expect(a).toHaveLength(3);
    }
  });

  it("has all unique names", () => {
    const names = CLUBS.map((c) => c.name);
    expect(new Set(names).size).toBe(884);
  });

  it("has exactly one entry per tid generateWorld() actually produces (regression guard against CLUBS/tid-layout drift)", () => {
    // CLUBS' array order and generateWorld()'s tid assignment are two
    // independently-edited files kept in sync only by convention (see the
    // "tids 40-79"/"tids 80-119" comments in clubs.ts) — this proves they
    // still agree, so a future reorder of either file fails loudly here
    // instead of silently zipping a mismatched name/colors onto a team.
    // The cached fixture rather than a fresh generateWorld: makeLeague runs the
    // same generator, and its cache key is a content hash of all of src/core, so
    // a change to either clubs.ts or the tid layout rebuilds the world this
    // reads. Same guard, ~15s cheaper.
    const worldTids = makeLeague(0, 1).teams.map((t) => t.tid).sort((a, b) => a - b);
    expect(worldTids).toEqual(CLUBS.map((_, i) => i));
  });
});

describe("assignIdentities", () => {
  const league = generateLeague(mulberry32(42));
  const stored = assignIdentities(league, englandCompetitions());

  it("maps tids correctly (tid N gets CLUBS[N])", () => {
    for (const st of stored) {
      const club = CLUBS[st.tid];
      expect(st.name).toBe(club.name);
      expect(st.abbrev).toBe(club.abbrev);
      expect(st.colors).toEqual(club.colors);
    }
  });

  it("preserves the roster from the original LeagueTeam", () => {
    for (const st of stored) {
      const original = league.teams.find((t) => t.tid === st.tid)!;
      expect(st.roster).toEqual(original.roster);
    }
  });
});
