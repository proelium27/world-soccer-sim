import { describe, expect, it } from "vitest";
import {
  buildCompetitions, competitionConferences, competitionSeasonGames, competitionTitlePlayoff,
  maxCrossRounds, maxDivisionTeams, normalizeLeagueSpec, resolveLeagueSpec, worldCompetitions,
  worldLeagueSpecs, competitionTeamCount, type LeagueSpec,
} from "../../src/core/competitions.js";
import { MAX_DIVISION_TEAMS, SEASON_MATCHDAYS } from "../../src/core/calendar.js";
import { buildCompetitionSchedule } from "../../src/core/schedule.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";
import { mulberry32 } from "../../src/engine/rng.js";

/**
 * The shapes the Americas brought in — divisions past 20 clubs split into two
 * halves, closed pyramids, per-half title playoffs, a continent — as things a
 * player can build in World setup rather than only things the shipped table has.
 */

/** A spec in the shape of the shipped MLS/Argentina leagues, made from scratch. */
const ATLANTIS: LeagueSpec = {
  country: "Atlantis",
  region: "americas",
  divisions: 3,
  d1Teams: 36,
  d1Conferences: { names: ["North", "South"], crossRounds: 2 },
  d2Teams: 40,
  d2Conferences: { names: ["East", "West"], crossRounds: 0 },
  d3Teams: 20,
  promotionSpots: 0,
  titlePlayoff: "conference",
};

/** Clubs standing in for a world's teams, enough to build a schedule. */
function clubsOf(specs: LeagueSpec[]) {
  let tid = 0;
  return buildCompetitions(specs).flatMap((c) =>
    Array.from({ length: competitionTeamCount(c) }, () => ({ tid: tid++, compId: c.id })),
  );
}

describe("division size limits come from the calendar", () => {
  it("lets a split division run past the single-table ceiling, as far as the calendar fits", () => {
    expect(maxDivisionTeams(false)).toBe(MAX_DIVISION_TEAMS);
    // Halves of 20 play 38 rounds; halves of 21 would need 42.
    expect(maxDivisionTeams(true)).toBe(40);
  });

  it("never offers more cross-over games than fit the season", () => {
    for (let n = 8; n <= maxDivisionTeams(true); n += 2) {
      const comp = buildCompetitions([{
        country: "X", divisions: 1, d1Teams: n,
        d1Conferences: { names: ["A", "B"], crossRounds: maxCrossRounds(n) },
      }])[0];
      expect(competitionSeasonGames(comp)).toBeLessThanOrEqual(SEASON_MATCHDAYS);
    }
    // The shipped MLS: halves of 15 play 30 with the rival, leaving 8.
    expect(maxCrossRounds(30)).toBe(8);
  });

  it("takes odd sizes: byes in a table, unequal halves (and no cross games) when split", () => {
    expect(maxCrossRounds(39)).toBe(0);
    for (const [n, split] of [[19, false], [39, true], [25, true]] as const) {
      const spec: LeagueSpec = {
        country: "X", divisions: 1, d1Teams: n,
        d1Conferences: split ? { names: ["A", "B"], crossRounds: 0 } : null,
      };
      expect(normalizeLeagueSpec(spec).d1Teams).toBe(n);
      const games = buildCompetitionSchedule(clubsOf([spec]), buildCompetitions([spec]));
      expect(Math.max(...games.map((g) => g.matchday))).toBeLessThanOrEqual(SEASON_MATCHDAYS);
    }
  });
});

describe("a spec can say how every division is played", () => {
  it("builds the split onto the right divisions and leaves the rest one table", () => {
    const comps = buildCompetitions([ATLANTIS]);
    expect(comps.map((c) => competitionConferences(c)?.names ?? null)).toEqual([
      ["North", "South"], ["East", "West"], null,
    ]);
    expect(competitionTitlePlayoff(comps[0])).toBe("conference");
  });

  it("schedules a 36- and a 40-club division inside the calendar", () => {
    const comps = buildCompetitions([ATLANTIS]);
    const games = buildCompetitionSchedule(clubsOf([ATLANTIS]), comps);
    expect(Math.max(...games.map((g) => g.matchday))).toBeLessThanOrEqual(SEASON_MATCHDAYS);
    for (const comp of comps) {
      const played = new Map<number, number>();
      const tids = new Set(clubsOf([ATLANTIS]).filter((t) => t.compId === comp.id).map((t) => t.tid));
      for (const g of games) {
        if (!tids.has(g.home)) continue;
        played.set(g.home, (played.get(g.home) ?? 0) + 1);
        played.set(g.away, (played.get(g.away) ?? 0) + 1);
      }
      for (const n of played.values()) expect(n).toBe(competitionSeasonGames(comp));
    }
  });

  it("can switch a shipped split off with null", () => {
    const us = worldLeagueSpecs().find((s) => s.country === "United States")!;
    expect(resolveLeagueSpec(us).conferences[0]).not.toBeNull();
    const flat = resolveLeagueSpec({ ...us, d1Teams: 20, d1Conferences: null });
    expect(flat.conferences[0]).toBeNull();
    // With no halves to seed, the conference playoff plays a plain bracket.
    expect(flat.titlePlayoff).toBe("single");
  });

  it("leaves the shipped world byte-identical", () => {
    expect(buildCompetitions(worldLeagueSpecs())).toEqual(worldCompetitions());
    for (const spec of worldLeagueSpecs()) expect(normalizeLeagueSpec(spec)).toEqual(spec);
  });
});

describe("normalizeLeagueSpec keeps the editor inside what the engine can build", () => {
  it("brings a division back to 20 when its split is switched off", () => {
    const out = normalizeLeagueSpec({ ...ATLANTIS, d1Conferences: null });
    expect(out.d1Teams).toBe(20);
    // And the conference playoff has nothing to seed from, so it steps down.
    expect(out.titlePlayoff).toBe("single");
  });

  it("clamps cross-over games to what the division can seat", () => {
    const out = normalizeLeagueSpec({
      country: "X", divisions: 1, d1Teams: 40, d1Conferences: { names: ["A", "B"], crossRounds: 9 },
    });
    expect(out.d1Conferences!.crossRounds).toBe(maxCrossRounds(40));
    expect(maxCrossRounds(40)).toBe(0);
  });

  it("steps a per-half playoff down when the halves are too small for it", () => {
    const out = normalizeLeagueSpec({
      country: "X", divisions: 1, d1Teams: 16,
      d1Conferences: { names: ["A", "B"], crossRounds: 0 }, titlePlayoff: "conference",
    });
    expect(out.titlePlayoff).toBe("single");
    // Zones seat eight a half, so a 16-club split keeps them.
    const zones = normalizeLeagueSpec({
      country: "X", divisions: 1, d1Teams: 16,
      d1Conferences: { names: ["A", "B"], crossRounds: 0 }, titlePlayoff: "zones",
    });
    expect(zones.titlePlayoff).toBe("zones");
  });
});

describe("a world built from a player's Americas-shaped league plays", () => {
  it("runs a season and an offseason: halves, a conference playoff, nobody moving division", () => {
    const comps = buildCompetitions([ATLANTIS]);
    let league = createLeagueState(SPECTATOR_TID, mulberry32(3), 3, "normal", comps);
    const before = new Map(league.teams.map((t) => [t.tid, t.compId]));
    // Every club in a split division carries a half.
    for (const t of league.teams) {
      expect(t.conference !== undefined).toBe(t.compId !== comps[2].id);
    }
    league = simThrough(league, "season", mulberry32(4));
    const playoff = league.titlePlayoffs?.find((p) => p.compId === comps[0].id);
    expect(playoff?.format).toBe("conference");
    expect(playoff?.winnerTid).not.toBeNull();

    league = simOffseason(league, mulberry32(5));
    // Closed: nobody promoted or relegated.
    for (const t of league.teams) expect(t.compId).toBe(before.get(t.tid));
  }, 240_000);
});
