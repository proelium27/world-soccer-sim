import { describe, it, expect } from "vitest";
import {
  computeHonours, emptyHonours, scorePlayer, type HonourSources,
} from "../../src/core/frivolities/goat.js";
import type { CareerRow } from "../../src/core/frivolities/careers.js";
import { emptyTotals, emptyBestSeasons } from "../../src/core/players/careerSummary.js";
import { AMERICAS_ACCOMPLISHMENT_SCALE } from "../../src/core/constants.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";

/*
 * The GOAT board prices anything done at a club in the Americas at
 * AMERICAS_ACCOMPLISHMENT_SCALE of the same thing done in Europe.
 */

const EUROPE_TID = 1;
const AMERICAS_TID = 700;
const AMERICAS = new Set([AMERICAS_TID]);

/** A long, great career: ten seasons at 88, a 90 peak, 200 goals, a World Cup. */
function career(pid: number, tidOf: (season: number) => number): CareerRow {
  const seasons = Array.from({ length: 10 }, (_, i) => ({
    season: i + 1, tid: tidOf(i + 1), ovr: 88, apps: 30,
  }));
  return {
    pid,
    name: `Player ${pid}`,
    nationality: "Brazil",
    pos: "ST",
    active: false,
    born: -20,
    tid: tidOf(10),
    seasonsPlayed: 10,
    firstSeason: 1,
    lastSeason: 10,
    peakOvr: 90,
    peakSeason: 5,
    totals: { ...emptyTotals(), appearances: 300, goals: 200, assists: 60, avgRating: 7.4 },
    best: emptyBestSeasons(),
    caps: 50,
    intlGoals: 20,
    intlTitles: 1,
    clubs: [...new Set(seasons.map((s) => s.tid))],
    seasons,
  };
}

function honoursWith(over: Partial<ReturnType<typeof emptyHonours>>) {
  return { ...emptyHonours(), ...over };
}

describe("GOAT scoring of a career in the Americas", () => {
  it("scores a European career exactly as before, whatever clubs are in the Americas", () => {
    const c = career(1, () => EUROPE_TID);
    const h = honoursWith({ leagueTitles: 3, playerOfSeason: 2, worldCups: 1 });
    expect(scorePlayer(c, h, AMERICAS)).toEqual(scorePlayer(c, h));
  });

  it("discounts the identical career spent in the Americas to about the scale", () => {
    const h = honoursWith({ leagueTitles: 3, playerOfSeason: 2, worldCups: 1 });
    const hAm = honoursWith({
      leagueTitles: 3, playerOfSeason: 2, worldCups: 1,
      inAmericas: { playerOfSeason: 2, goldenBoot: 0, teamOfSeason: 0, leagueTitles: 3, domesticCupTitles: 0 },
    });
    const europe = scorePlayer(career(1, () => EUROPE_TID), h, AMERICAS).score;
    const americas = scorePlayer(career(2, () => AMERICAS_TID), hAm, AMERICAS).score;
    // Every term is scaled; each component is rounded once, so allow a point or two.
    expect(americas).toBeGreaterThan(0);
    expect(Math.abs(americas - europe * AMERICAS_ACCOMPLISHMENT_SCALE)).toBeLessThanOrEqual(3);
  });

  it("scores a career split between the two in between, and names where the points came from", () => {
    const h = emptyHonours();
    const europe = scorePlayer(career(1, () => EUROPE_TID), h, AMERICAS);
    const americas = scorePlayer(career(2, () => AMERICAS_TID), h, AMERICAS);
    const split = scorePlayer(career(3, (s) => (s <= 5 ? AMERICAS_TID : EUROPE_TID)), h, AMERICAS);
    expect(split.score).toBeLessThan(europe.score);
    expect(split.score).toBeGreaterThan(americas.score);
    const keys = split.components.flatMap((c) => c.terms.map((t) => t.key));
    expect(keys).toContain("primeOvrAmericas");
    expect(keys).toContain("seasonsAmericas");
    expect(keys).toContain("primeOvr");
  });

  it("counts honours won in the Americas as a part of the whole, and the Americas' own awards", () => {
    const pid = 9;
    const entry = {
      season: 3,
      table: [],
      awards: { 1: { playerOfSeasonPid: pid, goldenBootPid: null, teamOfSeason: [] } },
      compsByTid: { [AMERICAS_TID]: 1 },
      championTidByCompId: { 1: AMERICAS_TID },
      world: {
        ballonDOr: [],
        worldTeamOfYear: [],
        americas: {
          ballonDOr: [{ pid, tid: AMERICAS_TID, score: 1, league: 1, cup: 0, intl: 0, title: 0 }],
          worldTeamOfYear: [pid],
        },
      },
    } as unknown as SeasonHistoryEntry;
    const sources: HonourSources = {
      seasonHistory: [entry], cup: [], shield: [], domestic: [], americasTids: [AMERICAS_TID],
    };
    const h = computeHonours(sources, [career(pid, () => AMERICAS_TID)]).get(pid)!;
    expect(h.leagueTitles).toBe(1);
    expect(h.inAmericas.leagueTitles).toBe(1);
    expect(h.playerOfSeason).toBe(1);
    expect(h.inAmericas.playerOfSeason).toBe(1);
    expect(h.americasPlayerOfYear).toBe(1);
    expect(h.americasTeamOfYear).toBe(1);

    const terms = scorePlayer(career(pid, () => AMERICAS_TID), h, AMERICAS)
      .components.flatMap((c) => c.terms.map((t) => t.key));
    expect(terms).toContain("leagueTitlesAmericas");
    expect(terms).toContain("playerOfSeasonAmericas");
    expect(terms).toContain("americasPlayerOfYear");
    expect(terms).not.toContain("leagueTitles");
    expect(terms).not.toContain("playerOfSeason");
  });
});
