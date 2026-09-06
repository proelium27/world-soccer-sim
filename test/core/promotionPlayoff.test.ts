import { describe, it, expect } from "vitest";
import {
  promotionPlayoffFields, semiFinalPairings, playoffOutcomes,
  playoffsForSeason, type PromotionPlayoff, type PlayedPlayoffFormat,
} from "../../src/core/promotionPlayoff.js";
import { computeCountrySwaps } from "../../src/core/promotion.js";
import {
  englandCompetitions, buildCompetitions, competitionPlayoffFormat, worldCompetitions,
  countryDivisions, competitionTeamCount,
} from "../../src/core/competitions.js";
import type { StandingsRow } from "../../src/core/standings.js";
import type { CupTie } from "../../src/core/cup/types.js";

const COMPS = englandCompetitions();

function row(tid: number, points: number): StandingsRow {
  return { tid, played: 38, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points };
}

/** A descending table of `n` clubs starting at tid `base`. */
function table(base: number, n: number): StandingsRow[] {
  return Array.from({ length: n }, (_, i) => row(base + i, 100 - i));
}

const D1 = table(0, 20);
const D2 = table(100, 20);
const TABLES = new Map([[0, D1], [1, D2]]);

/** A two-division country with an explicit format, plus its tables. */
function country(format: PlayedPlayoffFormat | "none", spots = 3, d1 = 20, d2 = 20) {
  const comps = buildCompetitions([{
    country: "Anywhere", d1Teams: d1, d2Teams: d2, promotionSpots: spots, playoffFormat: format,
  }]);
  const tables = new Map([[comps[0].id, table(0, d1)], [comps[1].id, table(100, d2)]]);
  return { comps, tables };
}

describe("competitionPlayoffFormat", () => {
  it("gives each shipped country its own real system", () => {
    const byCountry = new Map(
      countryDivisions(worldCompetitions())
        .map(({ country, divisions }) => [country, competitionPlayoffFormat(divisions[0], divisions[1] ?? null)]),
    );
    // The Bundesliga settles its last place against 2. Bundesliga's third.
    expect(byCountry.get("Germany")).toBe("german");
    // Scotland promotes one club, so there is no spare place to play for.
    expect(byCountry.get("Scotland")).toBe("none");
    for (const c of ["England", "Spain", "Italy", "France", "Portugal", "Serbia"]) {
      expect(byCountry.get(c)).toBe("english");
    }
  });

  it("lets a league override its country's default, from either division", () => {
    const { comps } = country("german");
    expect(competitionPlayoffFormat(comps[0], comps[1])).toBe("german");
    // Written to both divisions, so either one answers.
    expect(competitionPlayoffFormat(comps[1], comps[0])).toBe("german");
  });

  it("falls back to the default for a country nobody has a table for", () => {
    const comps = buildCompetitions([{ country: "Atlantis" }]);
    expect(competitionPlayoffFormat(comps[0], comps[1])).toBe("english");
  });
});

describe("promotionPlayoffFields — English", () => {
  it("seats the four clubs below the automatic places, best finish first", () => {
    const [field] = promotionPlayoffFields(COMPS, TABLES);
    // England gives 3 promotion places, so 2 go up automatically and the
    // playoff is contested by 3rd through 6th.
    expect(field.format).toBe("english");
    expect(field.autoPromoted).toBe(2);
    // Relegation is untouched by an English playoff: three still go down.
    expect(field.autoRelegated).toBe(3);
    expect(field.positions).toEqual([3, 4, 5, 6]);
    expect(field.teams).toEqual([102, 103, 104, 105]);
    expect(field.tiers).toEqual([2, 2, 2, 2]);
  });

  it("holds no playoff where only one club goes up", () => {
    // With a single promotion place there are no automatic places to sit below,
    // so the only bracket available would be positions 1-4 — which takes
    // promotion off the champion rather than deciding a spare place.
    const { comps, tables } = country("english", 1, 12, 12);
    expect(promotionPlayoffFields(comps, tables)).toEqual([]);
  });

  it("holds no playoff where the division cannot seat all four entrants", () => {
    // 3 places means 2 automatic, so the bracket needs positions 3-6 to exist.
    const { comps, tables } = country("english", 3, 8, 8);
    expect(promotionPlayoffFields(comps, tables.set(comps[1].id, table(100, 5)))).toEqual([]);
  });
});

describe("promotionPlayoffFields — German", () => {
  it("pairs the lowest safe top-flight club with the club below the automatic places", () => {
    const { comps, tables } = country("german", 3, 18, 18);
    const [field] = promotionPlayoffFields(comps, tables);
    expect(field.format).toBe("german");
    // 2 up and 2 down on the table; the tie settles the third place each way.
    expect(field.autoPromoted).toBe(2);
    expect(field.autoRelegated).toBe(2);
    // 18 clubs, 3 places: 17th and 18th go down automatically, 16th plays off.
    expect(field.positions).toEqual([16, 3]);
    expect(field.tiers).toEqual([1, 2]);
    expect(field.teams[0]).toBe(tables.get(comps[0].id)![15].tid);
    expect(field.teams[1]).toBe(tables.get(comps[1].id)![2].tid);
  });

  it("works where only one club goes up, unlike the English format", () => {
    // Nothing is automatic at one place, so the bottom club plays the champion
    // of the division below for the single place.
    const { comps, tables } = country("german", 1, 12, 10);
    const [field] = promotionPlayoffFields(comps, tables);
    expect(field.autoPromoted).toBe(0);
    expect(field.autoRelegated).toBe(0);
    expect(field.positions).toEqual([12, 1]);
  });

  it("never puts an already-relegated club in the tie", () => {
    // The tier-1 entrant sits exactly above the automatic drop zone, so the two
    // sets cannot overlap however many places the country gives out.
    for (const spots of [1, 2, 3, 4]) {
      const { comps, tables } = country("german", spots, 18, 18);
      const [field] = promotionPlayoffFields(comps, tables);
      const d1Table = tables.get(comps[0].id)!;
      // `slice(-0)` is the whole table, so one place has to be spelled out —
      // the same trap computeCountrySwaps guards, met here while writing the
      // test that checks for it.
      const autoDown = spots > 1 ? d1Table.slice(-(spots - 1)).map((r) => r.tid) : [];
      expect(autoDown).not.toContain(field.teams[0]);
    }
  });
});

/** A three-division country with an explicit format, plus its tables. */
function pyramid(
  format: PlayedPlayoffFormat | "none",
  spots = 3,
  sizes: [number, number, number] = [20, 20, 20],
) {
  const [d1, d2, d3] = sizes;
  const comps = buildCompetitions([{
    country: "Anywhere", divisions: 3, d1Teams: d1, d2Teams: d2, d3Teams: d3,
    promotionSpots: spots, playoffFormat: format,
  }]);
  const tables = new Map([
    [comps[0].id, table(0, d1)],
    [comps[1].id, table(100, d2)],
    [comps[2].id, table(200, d3)],
  ]);
  return { comps, tables };
}

describe("promotionPlayoffFields — a deeper pyramid", () => {
  it("seats a bracket at EVERY step, each out of its own division", () => {
    const { comps, tables } = pyramid("english");
    const fields = promotionPlayoffFields(comps, tables);
    expect(fields.map((f) => [f.d1CompId, f.d2CompId]))
      .toEqual([[comps[0].id, comps[1].id], [comps[1].id, comps[2].id]]);
    // 3rd through 6th of each lower division, and the tier they really are —
    // the deeper bracket must not report itself as tier 2.
    expect(fields[0].teams).toEqual([102, 103, 104, 105]);
    expect(fields[0].tiers).toEqual([2, 2, 2, 2]);
    expect(fields[1].teams).toEqual([202, 203, 204, 205]);
    expect(fields[1].tiers).toEqual([3, 3, 3, 3]);
    expect(fields[1].positions).toEqual([3, 4, 5, 6]);
  });

  it("plays the German tie at every step too, across the right pair", () => {
    const { comps, tables } = pyramid("german");
    const fields = promotionPlayoffFields(comps, tables);
    expect(fields).toHaveLength(2);
    // 20 clubs, 3 places: 18th and 19th go down, 17th plays the 3rd-placed
    // club below. Once for each boundary.
    expect(fields[0].teams).toEqual([17, 102]);
    expect(fields[0].tiers).toEqual([1, 2]);
    expect(fields[1].teams).toEqual([117, 202]);
    expect(fields[1].tiers).toEqual([2, 3]);
    expect(fields[1].positions).toEqual([18, 3]);
  });

  it("gives no two playoffs a club in common", () => {
    for (const format of ["english", "german"] as const) {
      const { comps, tables } = pyramid(format);
      const all = promotionPlayoffFields(comps, tables).flatMap((f) => f.teams);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("yields to the swap where a club would otherwise be moved twice", () => {
    // A 10-club middle division giving out 5 places: the bracket wants 5th
    // through 8th, and 6th through 10th are already being relegated to the
    // third tier. The automatic swap is not optional, so the playoff is what
    // gives — the top place is settled on the table and only the deeper
    // bracket, whose entrants come from an untouched division, is seated.
    const { comps, tables } = pyramid("english", 5, [20, 10, 20]);
    const fields = promotionPlayoffFields(comps, tables);
    expect(fields.map((f) => f.d2CompId)).toEqual([comps[2].id]);
    expect(fields[0].teams).toEqual([204, 205, 206, 207]);
  });

  it("holds a playoff at both of every shipped country's steps, bar the one that promotes one club", () => {
    const world = worldCompetitions();
    const tables = new Map(world.map((c, i) => [c.id, table(i * 100, competitionTeamCount(c))]));
    const held = new Map<string, number>();
    for (const f of promotionPlayoffFields(world, tables)) {
      held.set(f.country, (held.get(f.country) ?? 0) + 1);
    }
    for (const { country, divisions } of countryDivisions(world)) {
      // Scotland gives out one place, so there is no spare one to play for and
      // it holds none at either step.
      const want = competitionPlayoffFormat(divisions[0], divisions[1]) === "none"
        ? 0
        : divisions.length - 1;
      expect([country, held.get(country) ?? 0]).toEqual([country, want]);
    }
  });
});

describe("semiFinalPairings", () => {
  it("draws best against worst and second against third", () => {
    // Indices into the field, which is in finishing order. `home` hosts the
    // first leg, so the better-placed club (the lower index) is `away` and
    // gets the second leg.
    expect(semiFinalPairings(4)).toEqual([
      { home: 3, away: 0 },
      { home: 2, away: 1 },
    ]);
  });
});

function tie(round: number, home: number, away: number, winner: number): CupTie {
  return {
    round, matchday: 0, home, away, homeGoals: winner === home ? 1 : 0,
    awayGoals: winner === away ? 1 : 0, wentToExtraTime: false, wentToPens: false,
    homePens: 0, awayPens: 0, winner, boxScore: null,
  };
}

/** A finished English playoff whose winner is `winnerTid`. */
function english(season: number, d2CompId: number, winnerTid: number): PromotionPlayoff {
  return {
    season, country: "England", d1CompId: 0, d2CompId, format: "english",
    teams: [102, 103, 104, 105], positions: [3, 4, 5, 6], tiers: [2, 2, 2, 2],
    autoPromoted: 2, autoRelegated: 3,
    ties: [tie(0, 105, 102, winnerTid), tie(0, 104, 103, 103), tie(1, winnerTid, 103, winnerTid)],
    winnerTid,
  };
}

/** A finished German tie. `winnerTid` is 3 (the incumbent) or 102 (the challenger). */
function german(winnerTid: number): PromotionPlayoff {
  return {
    season: 4, country: "Anywhere", d1CompId: 0, d2CompId: 1, format: "german",
    teams: [3, 102], positions: [17, 3], tiers: [1, 2],
    autoPromoted: 2, autoRelegated: 2,
    ties: [tie(1, 102, 3, winnerTid)],
    winnerTid,
  };
}

describe("computeCountrySwaps with a playoff", () => {
  it("English: promotes the automatic places plus the winner, and relegates as usual", () => {
    const swaps = computeCountrySwaps(COMPS, TABLES, playoffOutcomes([english(4, 1, 105)]));
    // 3 up and 3 down either way. 104 finished 3rd and does not go up; 105
    // finished 6th and does.
    expect(swaps[0].promoted).toEqual([100, 101, 105]);
    expect(swaps[0].relegated).toEqual([17, 18, 19]);
    expect(new Set(swaps[0].promoted).size).toBe(3);
  });

  it("German: swaps the pair when the challenger wins", () => {
    const swaps = computeCountrySwaps(COMPS, TABLES, playoffOutcomes([german(102)]));
    expect(swaps[0].promoted).toEqual([100, 101, 102]);
    expect(swaps[0].relegated).toEqual([18, 19, 3]);
    expect(swaps[0].promoted).toHaveLength(swaps[0].relegated.length);
  });

  it("German: moves one fewer each way when the top-flight club holds on", () => {
    // The property the whole format rests on — the incumbent surviving costs
    // the division below a promotion, so the two sides still balance.
    const swaps = computeCountrySwaps(COMPS, TABLES, playoffOutcomes([german(3)]));
    expect(swaps[0].promoted).toEqual([100, 101]);
    expect(swaps[0].relegated).toEqual([18, 19]);
    expect(swaps[0].promoted).toHaveLength(swaps[0].relegated.length);
  });

  it("German with nothing automatic does not relegate the entire division", () => {
    // slice(-0) is slice(0), i.e. the whole table. A one-place country running
    // the German format automates nothing, so this is the live case for it.
    const { comps, tables } = country("german", 1, 12, 10);
    const [field] = promotionPlayoffFields(comps, tables);
    const held: PromotionPlayoff = {
      season: 1, country: "Anywhere", d1CompId: comps[0].id, d2CompId: comps[1].id,
      format: "german", teams: field.teams, positions: field.positions, tiers: field.tiers,
      autoPromoted: 0, autoRelegated: 0, ties: [], winnerTid: field.teams[0],
    };
    const swaps = computeCountrySwaps(comps, tables, playoffOutcomes([held]));
    expect(swaps[0].promoted).toEqual([]);
    expect(swaps[0].relegated).toEqual([]);
  });

  it("derives its own counts, so a record built for a different N cannot unbalance the swap", () => {
    // The record is built at the season boundary and applied during the
    // offseason. A caller that changes promotionSpots in between (tests do; a
    // save cannot) would hand the swap counts that disagree with the tables —
    // and the swap would move different numbers of clubs each way, which
    // changes the division sizes everything rests on. Found by
    // offseason.test.ts moving 58 clubs where it expected 24.
    const oneSpot = buildCompetitions([{
      country: "England", d1Teams: 20, d2Teams: 20, promotionSpots: 1,
    }]);
    // This record still says two go up automatically and three go down.
    const stale = english(4, oneSpot[1].id, 105);
    expect(stale.autoPromoted).toBe(2);
    const swaps = computeCountrySwaps(
      oneSpot,
      new Map([[oneSpot[0].id, D1], [oneSpot[1].id, D2]]),
      playoffOutcomes([stale]),
    );
    // One place means nothing automatic and the winner takes it, one down.
    expect(swaps[0].promoted).toEqual([105]);
    expect(swaps[0].relegated).toEqual([19]);
  });

  it("falls back to the plain table slice when no playoff was held", () => {
    // The regression that matters: a headless caller, a world with no eligible
    // country, and every save written before playoffs existed take this path
    // and must behave exactly as they always did.
    expect(computeCountrySwaps(COMPS, TABLES, new Map()))
      .toEqual(computeCountrySwaps(COMPS, TABLES));
    expect(computeCountrySwaps(COMPS, TABLES)[0].promoted).toEqual([100, 101, 102]);
  });
});

describe("playoffOutcomes", () => {
  it("reads an English winner as a promotion and nothing else", () => {
    expect(playoffOutcomes([english(4, 1, 105)]).get(1)).toEqual({
      format: "english", promotedTid: 105, relegatedTid: null,
    });
  });

  it("reads a German tie as a swap or as nobody moving", () => {
    expect(playoffOutcomes([german(102)]).get(1)).toEqual({
      format: "german", promotedTid: 102, relegatedTid: 3,
    });
    expect(playoffOutcomes([german(3)]).get(1)).toEqual({
      format: "german", promotedTid: null, relegatedTid: null,
    });
  });

  it("skips a playoff with no winner yet, so the swap falls back to the table", () => {
    const pending = { ...english(4, 1, 105), winnerTid: null };
    expect(playoffOutcomes([pending]).size).toBe(0);
  });
});

describe("playoffsForSeason", () => {
  it("returns only the season asked for, and tolerates a save that has none", () => {
    const held = [english(4, 1, 105), english(5, 1, 103)];
    expect(playoffsForSeason(held, 5)).toEqual([held[1]]);
    expect(playoffsForSeason(undefined, 5)).toEqual([]);
  });
});
