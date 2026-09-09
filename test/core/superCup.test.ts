import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import {
  buildSuperCups, playSuperCups, superCupsPending, superCupName,
  CONTINENTAL_SUPER_CUP_NAME,
} from "../../src/core/superCup/superCup.js";
import { superCupChampion } from "../../src/core/superCup/types.js";
import type { SuperCupSeed } from "../../src/core/superCup/superCup.js";
import type { SuperCupTie } from "../../src/core/superCup/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { StandingsRow } from "../../src/core/standings.js";
import type { DomesticCupState } from "../../src/core/domesticCup/types.js";
import type { CupState } from "../../src/core/cup/types.js";
import { worldCompetitions, countryDivisions } from "../../src/core/competitions.js";

/** A minimal standings table: just tids in finishing order. */
function table(tids: number[]): StandingsRow[] {
  return tids.map((tid) => ({
    tid, played: 38, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0,
  }));
}

function domesticCup(country: string, championTid: number | null): DomesticCupState {
  return {
    season: 1, country, name: `${country} Cup`, teams: [], rounds: [],
    totalRounds: 0, championTid, statLines: null,
  };
}

function continentalCup(championTid: number | null): CupState {
  return {
    competition: "continental", season: 1, name: "Continental Cup", teams: [], seeds: {},
    leaguePhase: null, playoff: null, playIn: null, ties: [],
    championTid, twoLegged: true, koLegs: null, statLines: null,
  };
}

/**
 * A seed for one country's super cup. The world's real competition table is
 * used so compIds and country names line up with everything else.
 */
function seedFor(opts: {
  championTid: number;
  cupWinnerTid: number | null;
  order?: number[];
  cup?: number | null;
  shield?: number | null;
}): SuperCupSeed {
  const competitions = worldCompetitions();
  const d1 = countryDivisions(competitions)[0].divisions[0];
  return {
    competitions: competitions.filter((c) => c.country === d1.country),
    tablesByCompId: new Map([[d1.id, table(opts.order ?? [opts.championTid, 999])]]),
    championTidByCompId: { [d1.id]: opts.championTid },
    domesticCups: opts.cupWinnerTid === null ? [] : [domesticCup(d1.country, opts.cupWinnerTid)],
    cup: opts.cup === undefined ? null : continentalCup(opts.cup),
    shield: opts.shield === undefined ? null : continentalCup(opts.shield),
    season: 2,
  };
}

describe("buildSuperCups", () => {
  it("pairs the league champion with the domestic cup winner", () => {
    const cups = buildSuperCups(seedFor({ championTid: 3, cupWinnerTid: 7 }));
    expect(cups).toHaveLength(1);
    expect(cups[0].competition).toBe("domestic");
    expect(cups[0].teams).toEqual([3, 7]);
    expect(cups[0].routes).toEqual(["league-champions", "cup-winners"]);
    // Seeded for the season it opens, not the one that decided it.
    expect(cups[0].season).toBe(2);
    expect(cups[0].tie).toBeNull();
  });

  it("brings in the league runner-up when one club won the double", () => {
    // Same club at the top of the table and holding the cup: without the double
    // rule this fixture would field a club against itself.
    const cups = buildSuperCups(seedFor({
      championTid: 3, cupWinnerTid: 3, order: [3, 11, 12],
    }));
    expect(cups).toHaveLength(1);
    expect(cups[0].teams).toEqual([3, 11]);
    expect(cups[0].routes).toEqual(["league-champions", "league-runners-up"]);
  });

  it("holds no super cup for a country whose domestic cup has no winner yet", () => {
    // Season 1's cups are still being played when the first super cups are
    // seeded, so there is nothing to contest and no match is invented.
    expect(buildSuperCups(seedFor({ championTid: 3, cupWinnerTid: null }))).toEqual([]);
  });

  it("pairs the Continental Cup and Shield winners", () => {
    const cups = buildSuperCups(seedFor({
      championTid: 3, cupWinnerTid: 7, cup: 20, shield: 41,
    }));
    const continental = cups.find((c) => c.competition === "continental");
    expect(continental).toBeDefined();
    expect(continental!.teams).toEqual([20, 41]);
    expect(continental!.name).toBe(CONTINENTAL_SUPER_CUP_NAME);
    // It belongs to no league, so it carries no compId to be filed under one.
    expect(continental!.compId).toBeUndefined();
  });

  it("holds no continental super cup until both competitions have a winner", () => {
    const cups = buildSuperCups(seedFor({
      championTid: 3, cupWinnerTid: 7, cup: 20, shield: null,
    }));
    expect(cups.some((c) => c.competition === "continental")).toBe(false);
  });

  it("names a country's super cup after it", () => {
    expect(superCupName("England")).toBe("English Champions Cup");
    expect(superCupName("Netherlands")).toBe("Dutch Champions Cup");
    // A country with no adjective on file still gets a readable name rather
    // than an empty one.
    expect(superCupName("Atlantis")).toBe("Atlantis Champions Cup");
  });
});

describe("playSuperCups", () => {
  const league = makeLeague(0, 1);
  const [a, b] = league.teams.map((t) => t.tid);

  function pending(): SuperCupTie[] {
    return [{
      competition: "domestic",
      season: 2,
      country: league.competitions[0].country,
      compId: league.competitions[0].id,
      name: "Test Champions Cup",
      teams: [a, b],
      routes: ["league-champions", "cup-winners"],
      tie: null,
    }];
  }

  it("always produces a winner, and never keeps a box score", () => {
    const played = playSuperCups(
      pending(), league.competitions, league.teams, league.players, league.lid,
    );
    expect(superCupsPending(played)).toBe(false);
    const tie = played[0].tie!;
    // One match, so it cannot end level: extra time and then penalties settle it.
    expect([a, b]).toContain(tie.winner);
    expect(superCupChampion(played[0])).toBe(tie.winner);
    // Scorelines are the record; the world plays one of these per country every
    // season and a save keeps its history forever.
    expect(tie.boxScore).toBeNull();
  });

  it("is reproducible from the league's content alone", () => {
    const first = playSuperCups(
      pending(), league.competitions, league.teams, league.players, league.lid,
    );
    const second = playSuperCups(
      pending(), league.competitions, league.teams, league.players, league.lid,
    );
    expect(second[0].tie).toEqual(first[0].tie);
  });

  it("leaves an already-played tie untouched", () => {
    const once = playSuperCups(
      pending(), league.competitions, league.teams, league.players, league.lid,
    );
    const twice = playSuperCups(
      once, league.competitions, league.teams, league.players, league.lid,
    );
    expect(twice).toBe(once);
  });
});

describe("the offseason seeds, plays and archives them", () => {
  /**
   * The pipeline end to end, against a real world rather than a hand-built
   * fixture.
   *
   * `makeLeague` is load-bearing here rather than incidental: it goes through
   * `createLeagueState`, which builds each country's domestic cup. A league
   * assembled field by field with `domesticCups: []` crowns no cup winners, so
   * there is nothing for a super cup to be contested between and
   * `buildSuperCups` correctly returns none — which looks exactly like the
   * feature being broken. That is how this test failed the first time it ran.
   *
   * `finishSeason` matters for the same reason, and it produced the identical
   * symptom a second time. `simThrough` HALTS BEFORE THE USER'S CUP FINAL, a
   * courtesy to the live player; headlessly that leaves the phase "regular", and
   * `simOffseason` silently returns the league unchanged on any phase but
   * "offseason". So one `simThrough` finishes the season only on seeds where the
   * unmanaged user club happens not to reach a final, and a world change is
   * enough to flip that — which is exactly what happened when generation gained
   * an age model: on this seed tid 0 started reaching its domestic cup final, the
   * offseason quietly never ran, and `superCups` came back empty. Same trap
   * `scripts/weakLeaguesAudit.ts` carries this same guard for.
   */
  const finishSeason = (l: LeagueStore, rng: () => number): LeagueStore => {
    let out = simThrough(l, "season", rng);
    for (let resumes = 0; (out.phase as string) !== "offseason"; resumes++) {
      if (resumes >= 3) throw new Error(`season ${out.season} refuses to finish (phase ${out.phase})`);
      out = simThrough(out, "season", rng);
    }
    return out;
  };

  it("seeds one per country, plays it on the next advance, and files it", () => {
    const rng = mulberry32(103);
    let league = makeLeague(0, 5);
    // Season 1 decides the league champions and domestic cup winners who
    // contest the first super cups. There is no continental one yet: the Cup
    // and the Shield both need a prior season's table to qualify from, so
    // neither has been played, let alone won.
    league = finishSeason(league, rng);
    league = simOffseason(league, rng);

    const seeded = league.superCups;
    const countries = new Set(league.competitions.map((c) => c.country));
    expect(seeded).toHaveLength(countries.size);
    expect(seeded.every((sc) => sc.competition === "domestic")).toBe(true);
    expect(superCupsPending(seeded)).toBe(true);
    for (const sc of seeded) {
      // Stamped with the season it opens, not the one that decided it.
      expect(sc.season).toBe(league.season);
      // Two different clubs, which is the double rule doing its job.
      expect(sc.teams[0]).not.toBe(sc.teams[1]);
    }

    // Advancing plays them on the way into the season without the user ever
    // visiting the page — the lazy path, against a real world.
    league = finishSeason(league, rng);
    expect(superCupsPending(league.superCups)).toBe(false);
    for (const sc of league.superCups) {
      expect(sc.teams).toContain(superCupChampion(sc));
    }

    // And the next rollover moves them onto the season they opened, clearing
    // the live field for the set it seeds in the same breath.
    const played = league.superCups;
    league = simOffseason(league, rng);
    const archived = league.seasonHistory.find((h) => h.season === played[0].season)?.superCups;
    expect(archived).toEqual(played);
    expect(league.superCups.every((sc) => sc.season === league.season)).toBe(true);
  });
});

describe("super cups are inert", () => {
  /**
   * The load-bearing test of the whole feature.
   *
   * Super cups pay no prize money, carry no injury or card out of the match and
   * draw only on their own seeded stream, so a season played with them must be
   * indistinguishable from one played without. That is the same property that
   * made shipping the domestic cups safe, and it is the thing a future change
   * here is most likely to break silently — a prize credit would shift every
   * downstream AI market decision, and nothing else in the suite would notice.
   */
  it("does not move a single league result", () => {
    const base = makeLeague(0, 1);
    const [a, b] = base.teams.map((t) => t.tid);
    const withCup: LeagueStore = {
      ...base,
      superCups: [{
        competition: "domestic",
        season: base.season,
        country: base.competitions[0].country,
        compId: base.competitions[0].id,
        name: "Test Champions Cup",
        teams: [a, b],
        routes: ["league-champions", "cup-winners"],
        tie: null,
      }],
    };

    const without = simThrough({ ...base, superCups: [] }, { matchday: 6 }, mulberry32(9));
    const with_ = simThrough(withCup, { matchday: 6 }, mulberry32(9));

    // The super cup really was played, so this is not passing by doing nothing.
    expect(superCupsPending(with_.superCups)).toBe(false);
    expect(with_.superCups[0].tie).not.toBeNull();

    // And everything else about the league is untouched by it.
    const { superCups: _a, ...restWith } = with_;
    const { superCups: _b, ...restWithout } = without;
    expect(restWith).toEqual(restWithout);
  });
});
