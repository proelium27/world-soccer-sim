import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { simOffseason } from "../../src/core/offseason.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { IntlTournament, IntlQualifyingCampaign, NationSquad } from "../../src/core/international/types.js";
import {
  initInternationalCampaign, buildSquads, nationMatchData, editableSquad,
  displaySquad, writeSquad, isValidNationSquad, selectSquad, nationPools,
  isEligibleNation, manageableNations, nationPoolStatus,
} from "../../src/core/international/index.js";
import { FORMATIONS } from "../../src/core/lineup/formations.js";
import {
  emptyNationalManagerState, takeNationalJob, leaveNationalJob, judgeCampaign,
  tournamentPlacement, qualifyingPlacement, nationExpectations, fieldExpectation,
  nationalReputation, generateNationOffers, reviewNationalCampaign, currentNationalStint,
  type NationalStint,
} from "../../src/core/nationalManager/index.js";
import {
  NATIONAL_START_CONFIDENCE, NATIONAL_GRACE_CAMPAIGNS, INTL_SQUAD_SIZE,
  NATIONAL_OFFER_LATERAL_BAND, NATIONAL_REP_BASE, MANAGER_REP_BASE,
  NATIONAL_OFFER_CLUB_REP_WEIGHT,
} from "../../src/core/constants.js";
import { AUTOPILOT_TID } from "../../src/core/autopilot.js";

/** A tournament shell with a `size`-nation field and a `koSize` bracket. */
function fakeTournament(size: number, koSize: number): IntlTournament {
  const nations = Array.from({ length: size }, (_, i) => `N${i}`);
  return {
    season: 4,
    name: "World Cup",
    nations,
    squads: nations.map((nation): NationSquad => ({
      nation, pids: [], formation: "4-3-3", rating: 50, starters: null,
    })),
    groups: [],
    bracket: Array.from({ length: koSize }, (_, i) => i),
    ties: [],
    championNid: null,
  };
}

function tie(round: number, home: number, away: number, winner: number) {
  return {
    round, matchday: 0, home, away,
    homeGoals: winner === home ? 1 : 0,
    awayGoals: winner === away ? 1 : 0,
    wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0,
    winner, boxScore: null,
  };
}

describe("national manager: placement", () => {
  // A 32-nation field with a 16-nation bracket — four knockout rounds — is the
  // shipped World Cup, and every band below is read off its own depth rather
  // than named, so the same function has to give a 16-nation confederation cup
  // the right answer too (checked separately below).
  it("bands a tournament finish by the round the nation went out in", () => {
    const t = fakeTournament(32, 16);
    // Round 0 = round of 16, 1 = QF, 2 = SF, 3 = final.
    t.ties = [
      tie(0, 0, 1, 0),   // N1 out in the round of 16
      tie(1, 0, 2, 0),   // N2 out in the quarters
      tie(2, 0, 3, 0),   // N3 out in the semis
      tie(3, 0, 4, 0),   // N4 beaten finalist, N0 champion
    ];
    t.championNid = 0;

    expect(tournamentPlacement(t, "N0")).toBe(1);      // champions
    expect(tournamentPlacement(t, "N4")).toBe(2);      // runners-up
    expect(tournamentPlacement(t, "N3")).toBe(3.5);    // 3rd-4th
    expect(tournamentPlacement(t, "N2")).toBe(6.5);    // 5th-8th
    expect(tournamentPlacement(t, "N1")).toBe(12.5);   // 9th-16th
    // Never reached the bracket: the band below everyone who did, 17th-32nd.
    expect(tournamentPlacement(t, "N20")).toBe(24.5);
    expect(tournamentPlacement(t, "Nowhere")).toBeNull();
  });

  it("reads the bands off a shallower bracket, not off fixed round names", () => {
    // 16 nations, an 8-nation bracket: three rounds, so round 0 is the quarters.
    const t = fakeTournament(16, 8);
    t.ties = [tie(0, 0, 1, 0), tie(1, 0, 2, 0), tie(2, 0, 3, 0)];
    t.championNid = 0;
    expect(tournamentPlacement(t, "N3")).toBe(2);     // beaten finalist
    expect(tournamentPlacement(t, "N2")).toBe(3.5);   // beaten semi-finalist
    expect(tournamentPlacement(t, "N1")).toBe(6.5);   // beaten quarter-finalist
    expect(tournamentPlacement(t, "N9")).toBe(12.5);  // group stage, 9th-16th
  });

  it("returns null mid-bracket, so nothing is judged on a half-played tournament", () => {
    const t = fakeTournament(32, 16);
    t.ties = [tie(0, 0, 1, 0)];
    expect(tournamentPlacement(t, "N0")).toBeNull();
  });

  /**
   * The clamping rule, which is the whole reason qualifying has its own
   * placement function: it has no granularity, so an unclamped midpoint would
   * read a favourite's routine qualification as a collapse.
   */
  describe("qualifying placement clamps toward expectation", () => {
    const campaign = (qualified: string[]): IntlQualifyingCampaign => ({
      season: 1,
      nations: Array.from({ length: 44 }, (_, i) => `N${i}`),
      squads: [],
      groups: [],
      qualified,
    });
    const qualifiers = Array.from({ length: 32 }, (_, i) => `N${i}`);

    it("a favourite who qualifies has met expectations exactly", () => {
      // Expected 3rd of 44, qualified: placement equals expectation, so the
      // overperformance term is zero and only the flat qualification bonus applies.
      expect(qualifyingPlacement(campaign(qualifiers), "N2", 3)).toBe(3);
    });

    it("a favourite who misses out is judged on the failure band", () => {
      const missed = qualifyingPlacement(campaign(qualifiers.filter((n) => n !== "N2")), "N2", 3);
      expect(missed).toBeGreaterThan(30);
    });

    it("an outsider who qualifies is credited for it", () => {
      // Expected 40th, qualified: pulled up to the middle of the 32-place
      // qualifying band, which is a long way better than expected.
      const withOutsider = [...qualifiers.slice(0, 31), "N39"];
      expect(qualifyingPlacement(campaign(withOutsider), "N39", 40)).toBe(16.5);
    });

    it("an outsider who misses out has met expectations exactly", () => {
      expect(qualifyingPlacement(campaign(qualifiers), "N39", 40)).toBe(40);
    });
  });
});

describe("national manager: the federation's verdict", () => {
  const facts = (over: Partial<Parameters<typeof judgeCampaign>[0]> = {}) => ({
    kind: "tournament" as const,
    competition: "World Cup",
    placement: 12.5,
    expectedRank: 12,
    nations: 32,
    demand: 0.5,
    titles: 0,
    continentalTitles: 0,
    qualified: null,
    ...over,
  });

  it("winning the World Cup is worth a lot of goodwill", () => {
    const v = judgeCampaign(facts({ placement: 1, titles: 1 }), 50, 3, true, 1);
    expect(v.confidence).toBeGreaterThan(80);
    expect(v.sacked).toBe(false);
  });

  it("a favourite going out early costs the job", () => {
    const v = judgeCampaign(facts({ placement: 24.5, expectedRank: 1 }), 20, 5, true, 1);
    expect(v.confidence).toBeLessThan(20);
    expect(v.overperformance).toBeLessThan(0);
  });

  it("missing out on the finals is the worst outcome available", () => {
    const missed = judgeCampaign(
      facts({ kind: "qualifying", placement: 38, expectedRank: 3, qualified: false }), 60, 4, true, 1,
    );
    const made = judgeCampaign(
      facts({ kind: "qualifying", placement: 3, expectedRank: 3, qualified: true }), 60, 4, true, 1,
    );
    expect(missed.confidence).toBeLessThan(made.confidence - 30);
  });

  /**
   * The grace window is counted in campaigns *survived*, so a manager appointed
   * last summer cannot be dismissed on their first tournament however badly it
   * goes. Without it a new appointment could be ended before ever picking a
   * team for a competitive match.
   */
  it("cannot sack a manager inside the grace window", () => {
    const disaster = facts({ placement: 30, expectedRank: 1 });
    expect(judgeCampaign(disaster, 1, NATIONAL_GRACE_CAMPAIGNS - 1, true, 1).sacked).toBe(false);
    expect(judgeCampaign(disaster, 1, NATIONAL_GRACE_CAMPAIGNS, true, 1).sacked).toBe(true);
  });

  it("never sacks anyone when sackings are switched off", () => {
    expect(judgeCampaign(facts({ placement: 30, expectedRank: 1 }), 1, 9, false, 1).sacked).toBe(false);
  });

  it("scales the whole verdict by the save's board patience", () => {
    const bad = facts({ placement: 24.5, expectedRank: 4 });
    const forgiving = judgeCampaign(bad, 60, 4, true, 1.7).confidence;
    const brutal = judgeCampaign(bad, 60, 4, true, 0.55).confidence;
    expect(forgiving).toBeGreaterThan(brutal);
  });
});

describe("national manager: expectations", () => {
  const snapshot = {
    season: 1,
    ranks: [
      { nation: "Brazil", rating: 80 },
      { nation: "England", rating: 75 },
      { nation: "Wales", rating: 55 },
    ],
  };

  it("ranks nations strongest first and hands the best the highest demand", () => {
    const e = nationExpectations(snapshot);
    expect(e.get("Brazil")!.rank).toBe(1);
    expect(e.get("Wales")!.rank).toBe(3);
    expect(e.get("Brazil")!.demand).toBeGreaterThan(e.get("Wales")!.demand);
  });

  it("has nothing to say about a world with no international football", () => {
    expect(nationExpectations(null).size).toBe(0);
  });

  /**
   * A campaign is not the whole world, so "you were the best team here" has to
   * be ranked inside the field that actually played.
   */
  it("ranks within the campaign's own field, not the world", () => {
    const inField = fieldExpectation(["England", "Wales"], "England", snapshot);
    expect(inField).toEqual({ rank: 1, nations: 2 });
    expect(fieldExpectation(["Brazil"], "England", snapshot)).toBeNull();
  });

  /**
   * The whole safety argument for reading expectation off the power snapshot:
   * it is built from each nation's *best available* eleven, so naming a weak
   * squad cannot lower your own bar. This is the national counterpart of the
   * club board's teardown test.
   */
  it("cannot be lowered by naming a weaker squad", () => {
    const before = nationExpectations(snapshot).get("Brazil")!;
    // Whatever the manager does to the named squad, the snapshot is unchanged —
    // it is not derived from it.
    const after = nationExpectations(snapshot).get("Brazil")!;
    expect(after.rank).toBe(before.rank);
    expect(after.demand).toBe(before.demand);
  });
});

describe("national manager: reputation and offers", () => {
  const stint = (over: Partial<NationalStint> = {}): NationalStint => ({
    nation: "Wales", startSeason: 1, endSeason: 4, campaigns: 3,
    titles: 0, continentalTitles: 0, qualifications: 1, overperformance: 0,
    ending: "left", ...over,
  });

  it("rates a World Cup winner above a journeyman", () => {
    expect(nationalReputation([stint({ titles: 1 })]))
      .toBeGreaterThan(nationalReputation([stint()]));
  });

  it("docks a manager for being sacked", () => {
    expect(nationalReputation([stint({ ending: "sacked" })]))
      .toBeLessThan(nationalReputation([stint()]));
  });

  const expectations = nationExpectations({
    season: 1,
    ranks: Array.from({ length: 40 }, (_, i) => ({ nation: `N${i}`, rating: 80 - i })),
  });

  /**
   * "Worse" means meaningfully worse: an offer may sit up to
   * NATIONAL_OFFER_LATERAL_BAND below your current job, which is what lets the
   * strongest nation in the world be approached at all. A strict `>=` is
   * unsatisfiable at prestige 1.000, and pinning it here is what let that ship.
   */
  it("offers nothing more than a lateral move below your current job", () => {
    const offers = generateNationOffers({
      lid: 1, season: 5, currentNation: "N10", expectations,
      sacked: false, reputation: 75, clubReputation: MANAGER_REP_BASE, lastOverperformance: 0.2,
    });
    const mine = expectations.get("N10")!.prestige;
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.prestige).toBeGreaterThanOrEqual(mine - NATIONAL_OFFER_LATERAL_BAND);
    }
  });

  /**
   * The bug this whole pair of bands exists to prevent: the band is an absolute
   * window in prestige while the step-up filter is relative to the job you hold,
   * so centring the band on reputation alone left them with no overlap the
   * moment you managed a country stronger than your reputation. The strongest
   * nation's manager was approached by nobody at any reputation.
   */
  it("still approaches the manager of the strongest nation in the world", () => {
    const strongest = [...expectations.values()].sort((a, b) => a.rank - b.rank)[0];
    expect(strongest.prestige).toBe(1);
    const seen = new Set<string>();
    for (let season = 1; season <= 12; season++) {
      for (const o of generateNationOffers({
        lid: 1, season, currentNation: strongest.nation, expectations,
        sacked: false, reputation: 100, clubReputation: MANAGER_REP_BASE, lastOverperformance: 0,
      })) seen.add(o.nation);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  /**
   * The other half of the same bug, and the one a *new* manager hits: handed a
   * strong country on the base reputation, the band used to top out below their
   * own nation and the pool came out empty.
   */
  it("approaches a low-reputation manager handed a strong nation", () => {
    const seen = new Set<string>();
    for (let season = 1; season <= 12; season++) {
      for (const o of generateNationOffers({
        lid: 1, season, currentNation: "N2", expectations,
        sacked: false, reputation: NATIONAL_REP_BASE,
        clubReputation: MANAGER_REP_BASE, lastOverperformance: 0,
      })) seen.add(o.nation);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  /**
   * The one asymmetry with the club side: with no country there is no "step up"
   * to insist on, and being approached is the only route back into the feature,
   * so an unemployed manager is approached far more readily.
   */
  it("approaches an unemployed manager readily", () => {
    const offers = generateNationOffers({
      lid: 1, season: 5, currentNation: null, expectations,
      sacked: false, reputation: 55, clubReputation: MANAGER_REP_BASE, lastOverperformance: 0,
    });
    expect(offers.length).toBeGreaterThan(0);
  });

  /**
   * International reputation cannot rise without holding a national job, so a
   * club manager who has never held one sits on NATIONAL_REP_BASE forever. On
   * the real 70-nation world that left rank 33 as the best country the band
   * could ever reach, and 100 club reputation changed it by nothing: federations
   * could not see a club career at all.
   */
  describe("federations can see a discounted slice of the club career", () => {
    const bestRankOffered = (clubReputation: number): number => {
      let best = Infinity;
      for (let season = 1; season <= 20; season++) {
        for (const o of generateNationOffers({
          lid: 1, season, currentNation: null, expectations,
          sacked: false, reputation: NATIONAL_REP_BASE, clubReputation,
          lastOverperformance: 0,
        })) best = Math.min(best, o.rank);
      }
      return best;
    };

    it("offers a decorated club manager better countries than an unproven one", () => {
      expect(bestRankOffered(100)).toBeLessThan(bestRankOffered(MANAGER_REP_BASE));
    });

    it("is inert for an unproven manager, who is on the base club reputation", () => {
      // MANAGER_REP_BASE * WEIGHT lands under NATIONAL_REP_BASE / 100, so the
      // `max` ignores it entirely and this path is exactly what it always was.
      expect((MANAGER_REP_BASE / 100) * NATIONAL_OFFER_CLUB_REP_WEIGHT)
        .toBeLessThan(NATIONAL_REP_BASE / 100);
      expect(bestRankOffered(MANAGER_REP_BASE)).toBe(bestRankOffered(0));
    });

    /**
     * The ladder this must not let anyone skip. A club career buys a good
     * country, never an elite one: the strongest nations stay behind a national
     * reputation that can only be earned in the job.
     */
    it("does not put the strongest nations in reach on a club career alone", () => {
      const nations = [...expectations.values()].length;
      expect(bestRankOffered(100)).toBeGreaterThan(nations * 0.1);
    });
  });

  it("is stable for the same save and season", () => {
    const args = {
      lid: 3, season: 7, currentNation: null, expectations,
      sacked: false, reputation: 60, clubReputation: MANAGER_REP_BASE, lastOverperformance: 0,
    };
    expect(generateNationOffers(args)).toEqual(generateNationOffers(args));
  });
});

describe("national manager: taking and leaving a job", () => {
  function withNation(nation: string | null): LeagueStore {
    const league = makeLeague(0, 1);
    return { ...league, nationalManager: emptyNationalManagerState(nation, 1) };
  }

  it("starts a save with no country by default", () => {
    const league = makeLeague(0, 1);
    expect(league.nationalManager.nation).toBeNull();
    expect(league.nationalManager.stints).toEqual([]);
  });

  it("opens a stint when a country is chosen at creation", () => {
    const league = withNation("England");
    expect(currentNationalStint(league.nationalManager)?.nation).toBe("England");
  });

  it("only lets you take a country that actually approached", () => {
    // The guard lives in the action layer; core takeNationalJob is the mechanism.
    const league = takeNationalJob(withNation(null), "England");
    expect(league.nationalManager.nation).toBe("England");
    expect(league.nationalManager.stints).toHaveLength(1);
  });

  it("closes the old stint when moving country", () => {
    const league = takeNationalJob(withNation("England"), "Wales");
    expect(league.nationalManager.stints).toHaveLength(2);
    expect(league.nationalManager.stints[0].ending).toBe("left");
    expect(league.nationalManager.stints[1].nation).toBe("Wales");
    expect(league.nationalManager.confidence).toBe(NATIONAL_START_CONFIDENCE);
  });

  it("leaves the save in an ordinary, playable state with no country", () => {
    const league = leaveNationalJob(withNation("England"), "left");
    expect(league.nationalManager.nation).toBeNull();
    expect(league.nationalManager.stints[0].ending).toBe("left");
  });

  /**
   * The one piece of state a departing national manager leaves behind. An
   * AI-run nation must auto-pick, so the manual eleven goes with the manager —
   * the named 23 deliberately stays, since a successor inherits a squad.
   */
  it("hands the chosen eleven back when you leave", () => {
    const base = withNation("England");
    const drawn = initInternationalCampaign(
      base.international, base.players, base.season, base.lid,
    );
    const nation = drawn.qualifying!.squads[0].nation;
    const withStarters = {
      ...base,
      nationalManager: emptyNationalManagerState(nation, 1),
      international: {
        ...drawn,
        qualifying: {
          ...drawn.qualifying!,
          squads: drawn.qualifying!.squads.map((s) =>
            (s.nation === nation ? { ...s, starters: s.pids.slice(0, 11) } : s)),
        },
      },
    };
    const after = leaveNationalJob(withStarters, "left");
    const squad = after.international.qualifying!.squads.find((s) => s.nation === nation)!;
    expect(squad.starters).toBeNull();
    // The squad itself is untouched — a successor picks a team from it.
    expect(squad.pids.length).toBeGreaterThan(0);
  });
});

/**
 * You can manage a country before it has the players to enter international
 * football. It sits out every campaign until it does, and then joins the next
 * one drawn with you still in charge.
 */
describe("national manager: a country that can't field a team yet", () => {
  const DORMANT = "Bhutan";

  it("reports how far off a country is, by the same rule the sim uses", () => {
    const league = makeLeague(0, 1);
    for (const nation of ["England", DORMANT]) {
      const status = nationPoolStatus(nation, league.players);
      const pool = league.players.filter((p) => p.nationality === nation);
      expect(status.eligible).toBe(isEligibleNation(nation, pool));
      expect(status.players).toBe(pool.length);
      expect(status.keepers).toBe(pool.filter((p) => p.pos === "GK").length);
    }
    expect(nationPoolStatus(DORMANT, league.players).eligible).toBe(false);
  });

  it("keeps the job through a review with nothing to judge", () => {
    const base = makeLeague(0, 1);
    const league: LeagueStore = {
      ...base,
      nationalManager: emptyNationalManagerState(DORMANT, 1),
      international: initInternationalCampaign(base.international, base.players, base.season, base.lid),
    };
    expect(league.international.qualifying!.squads.some((s) => s.nation === DORMANT)).toBe(false);
    const after = reviewNationalCampaign(league).nationalManager;
    expect(after.nation).toBe(DORMANT);
    expect(after.confidence).toBe(NATIONAL_START_CONFIDENCE);
    expect(currentNationalStint(after)?.campaigns).toBe(0);
  });

  it("joins the next campaign once it has the players, with you in charge", () => {
    const base = makeLeague(0, 1);
    // Hand the country a keeper and enough outfielders, as an academy full of
    // its kids eventually would.
    const keeper = base.players.find((p) => p.pos === "GK")!;
    const outfield = base.players.filter((p) => p.pos !== "GK").slice(0, 25);
    const recruits = new Set([keeper.pid, ...outfield.map((p) => p.pid)]);
    const players = base.players.map((p) => (recruits.has(p.pid) ? { ...p, nationality: DORMANT } : p));
    const league: LeagueStore = {
      ...base,
      players,
      nationalManager: emptyNationalManagerState(DORMANT, 1),
      international: initInternationalCampaign(base.international, players, base.season, base.lid),
    };
    expect(nationPoolStatus(DORMANT, players).eligible).toBe(true);
    expect(league.international.qualifying!.squads.some((s) => s.nation === DORMANT)).toBe(true);
    expect(league.nationalManager.nation).toBe(DORMANT);
  });
});

/**
 * The countries this world can field a team for. God Mode's Switch Country tab
 * uses it to mark which listed countries are ready; the list itself is every
 * appointable country, since one without the players is still a job you can
 * hold.
 */
describe("manageableNations", () => {
  const league = makeLeague(0, 1);
  const nations = manageableNations(league.players);

  it("names every country this world can field a team for, and only those", () => {
    const pools = nationPools(league.players);
    for (const [nation, pool] of pools) {
      expect(nations.includes(nation)).toBe(isEligibleNation(nation, pool));
    }
    expect(nations.length).toBeGreaterThan(0);
  });

  it("agrees with the field the sim itself draws", () => {
    // buildSquads qualifies nations by the identical rule, so every country the
    // picker offers is one that really turns up in a campaign.
    const drawn = buildSquads(league.players).map((s) => s.nation).sort();
    expect([...nations].sort()).toEqual(drawn);
  });

  it("is alphabetical and free of duplicates", () => {
    expect(nations).toEqual([...nations].sort((a, b) => a.localeCompare(b)));
    expect(new Set(nations).size).toBe(nations.length);
  });
});

describe("national manager: the squad and the eleven", () => {
  const league = makeLeague(0, 1);
  const drawn = initInternationalCampaign(
    league.international, league.players, league.season, league.lid,
  );
  const nation = drawn.qualifying!.squads[0].nation;

  it("points squad editing at whichever campaign the pending stage belongs to", () => {
    expect(drawn.stage).toBe("qualifying");
    const found = editableSquad(drawn, nation);
    expect(found?.slot).toEqual({ kind: "qualifying" });
    expect(found?.squad.nation).toBe(nation);
  });

  it("offers nothing to edit when no campaign is pending", () => {
    expect(editableSquad({ ...drawn, stage: "done" }, nation)).toBeNull();
    expect(editableSquad(drawn, null)).toBeNull();
  });

  it("still has a squad to show between campaigns", () => {
    expect(displaySquad({ ...drawn, stage: "done" }, nation)?.squad.nation).toBe(nation);
  });

  it("writes one nation's squad without disturbing any other", () => {
    const before = drawn.qualifying!.squads;
    const target = before.find((s) => s.nation === nation)!;
    const after = writeSquad(
      drawn, { kind: "qualifying" }, nation, { ...target, starters: target.pids.slice(0, 11) },
    );
    const squads = after.qualifying!.squads;
    expect(squads.find((s) => s.nation === nation)!.starters).toHaveLength(11);
    for (const s of squads) {
      if (s.nation !== nation) expect(s).toBe(before.find((b) => b.nation === s.nation));
    }
  });

  describe("squad validation", () => {
    const pool = nationPools(league.players).get(nation)!;
    const picked = selectSquad(pool)!;

    it("accepts the squad the game picked for itself", () => {
      expect(isValidNationSquad(picked.pids, pool)).toBe(true);
    });

    it("refuses a squad with no goalkeeper", () => {
      const byPid = new Map(pool.map((p) => [p.pid, p]));
      const outfield = picked.pids.filter((pid) => byPid.get(pid)!.pos !== "GK");
      expect(isValidNationSquad(outfield, pool)).toBe(false);
    });

    it("refuses a squad that is too small, too big, or full of strangers", () => {
      expect(isValidNationSquad(picked.pids.slice(0, 10), pool)).toBe(false);
      expect(isValidNationSquad(
        [...picked.pids, ...pool.slice(0, INTL_SQUAD_SIZE).map((p) => p.pid)], pool,
      )).toBe(false);
      expect(isValidNationSquad([...picked.pids.slice(0, 22), -999], pool)).toBe(false);
      // A duplicated pid is eleven men on paper and ten on the pitch.
      expect(isValidNationSquad(
        [...picked.pids.slice(0, 22), picked.pids[0]], pool,
      )).toBe(false);
    });
  });

  /**
   * The whole point of storing `starters`: the match layer has to field the
   * eleven the manager picked. `nationMatchData` is the single seam, and it
   * hands `resolveXI` the same argument a club's `starters` gets.
   */
  it("fields the eleven the manager picked", () => {
    const squads = drawn.qualifying!.squads;
    const idx = squads.findIndex((s) => s.nation === nation);
    const squad = squads[idx];
    const byPid = new Map(league.players.map((p) => [p.pid, p]));
    const slots = FORMATIONS[squad.formation];
    // A legal but deliberately unusual eleven: the keeper the auto-pick would
    // choose, then the *worst* outfielders in the squad, so it can't coincide
    // with selectXI's answer.
    const keeper = squad.pids.find((pid) => byPid.get(pid)!.pos === "GK")!;
    const outfield = squad.pids
      .filter((pid) => byPid.get(pid)!.pos !== "GK")
      .sort((a, b) => byPid.get(a)!.ovr - byPid.get(b)!.ovr)
      .slice(0, slots.length - 1);
    const chosen = [keeper, ...outfield];

    const edited = squads.map((s, i) => (i === idx ? { ...s, starters: chosen } : s));
    const withPick = nationMatchData(edited, league.players);
    const auto = nationMatchData(squads, league.players);

    expect(withPick.get(idx)!.xi.map((p) => p.pid).sort()).toEqual([...chosen].sort());
    expect(auto.get(idx)!.xi.map((p) => p.pid).sort()).not.toEqual([...chosen].sort());
  });

  /**
   * The graceful-degradation half of the same contract. A qualifying campaign
   * runs across three offseasons, so a named eleven really does go stale.
   */
  it("falls back to the auto-pick rather than fielding ten", () => {
    const squads = drawn.qualifying!.squads;
    const idx = squads.findIndex((s) => s.nation === nation);
    const broken = squads.map((s, i) => (i === idx ? { ...s, starters: [-1, -2, -3] } : s));
    const data = nationMatchData(broken, league.players);
    expect(data.get(idx)!.xi).toHaveLength(FORMATIONS[squads[idx].formation].length);
  });

  it("leaves every other nation auto-picking", () => {
    const found = editableSquad(drawn, "Nowhere at all");
    expect(found).toBeNull();
    for (const s of drawn.qualifying!.squads) expect(s.starters ?? null).toBeNull();
  });
});

describe("national manager: the offseason review", () => {
  /**
   * A league parked at the offseason boundary with this offseason's campaign
   * drawn but unplayed — exactly the state `simThrough` hands over, built
   * directly so the test costs one offseason rather than a whole season.
   */
  function stagedOffseason(nation: string | null): LeagueStore {
    const league = makeLeague(0, 1);
    return {
      ...league,
      phase: "offseason",
      nationalManager: emptyNationalManagerState(nation, 1),
      international: initInternationalCampaign(
        league.international, league.players, league.season, league.lid,
      ),
    };
  }

  it("puts countries on the table for a manager with none", () => {
    const after = simOffseason(stagedOffseason(null), mulberry32(7));
    expect(after.nationalManager.nation).toBeNull();
    expect(after.nationalManager.offers.length).toBeGreaterThan(0);
  });

  /**
   * The load-bearing invariant for the whole feature. International football
   * runs on its own seeded streams and the federation's review draws on
   * another, so managing a country must not move a single club result — if it
   * did, every dynasty audit in `scripts/` would be measuring two different
   * games depending on whether the user had a national job.
   */
  it("cannot change a single thing about the club game", () => {
    const nation = buildSquads(makeLeague(0, 1).players)[0].nation;
    const without = simOffseason(stagedOffseason(null), mulberry32(11));
    const with_ = simOffseason(stagedOffseason(nation), mulberry32(11));

    expect(with_.players).toEqual(without.players);
    expect(with_.teams).toEqual(without.teams);
    expect(with_.transfers).toEqual(without.transfers);
    expect(with_.seasonHistory).toEqual(without.seasonHistory);
    expect(with_.international).toEqual(without.international);
    // The only difference is the manager's own career.
    expect(with_.nationalManager.nation).toBe(nation);
  });

  it("counts a completed qualifying campaign as one campaign managed", () => {
    // Qualifying concludes in the offseason INTL_QUAL_LEGS - 1 seasons after it
    // is drawn, so a campaign drawn at season 1 is judged in season 3's.
    const base = makeLeague(0, 1);
    const drawn = initInternationalCampaign(
      base.international, base.players, base.season, base.lid,
    );
    const nation = drawn.qualifying!.squads[0].nation;
    const concluded: LeagueStore = {
      ...base,
      season: drawn.qualifying!.season + 2,
      phase: "offseason",
      nationalManager: emptyNationalManagerState(nation, 1),
      international: {
        ...drawn,
        stage: "done",
        // Stand the campaign up as finished with this nation among the
        // qualifiers, which is what the third leg completing produces.
        qualifying: { ...drawn.qualifying!, qualified: [nation] },
      },
    };
    const after = reviewNationalCampaign(concluded);
    const stint = currentNationalStint(after.nationalManager)!;
    expect(stint.campaigns).toBe(1);
    expect(stint.qualifications).toBe(1);
    expect(after.nationalManager.lastVerdict?.qualified).toBe(true);
    expect(after.nationalManager.lastVerdict?.nation).toBe(nation);
  });

  it("judges a campaign once, however many times the review runs", () => {
    const base = makeLeague(0, 1);
    const drawn = initInternationalCampaign(
      base.international, base.players, base.season, base.lid,
    );
    const nation = drawn.qualifying!.squads[0].nation;
    const concluded: LeagueStore = {
      ...base,
      season: drawn.qualifying!.season + 2,
      phase: "offseason",
      nationalManager: emptyNationalManagerState(nation, 1),
      international: {
        ...drawn, stage: "done",
        qualifying: { ...drawn.qualifying!, qualified: [nation] },
      },
    };
    const once = reviewNationalCampaign(concluded);
    const twice = reviewNationalCampaign(once);
    expect(currentNationalStint(twice.nationalManager)!.campaigns).toBe(1);
    expect(twice.nationalManager.confidence).toBe(once.nationalManager.confidence);
  });

  /**
   * A jump hands the save to the AI, so the federation sits it out for the same
   * reason the club board does — and, just as importantly, so a jump can't end
   * with the user's country gone over campaigns they never picked a team for.
   */
  it("sits out a multi-season jump", () => {
    const base = makeLeague(0, 1);
    const drawn = initInternationalCampaign(
      base.international, base.players, base.season, base.lid,
    );
    const nation = drawn.qualifying!.squads[0].nation;
    const jumping: LeagueStore = {
      ...base,
      season: drawn.qualifying!.season + 2,
      phase: "offseason",
      meta: { ...base.meta, userTid: AUTOPILOT_TID },
      nationalManager: emptyNationalManagerState(nation, 1),
      international: {
        ...drawn, stage: "done",
        qualifying: { ...drawn.qualifying!, qualified: [] },
      },
    };
    const after = reviewNationalCampaign(jumping);
    expect(after.nationalManager).toBe(jumping.nationalManager);
  });

  /**
   * `sacked` is a headline about one offseason, not a lasting condition — the
   * Federation page leads with a red banner on it, and left set it would still
   * be announcing the dismissal several seasons later.
   */
  it("stops announcing a dismissal once the offseason it happened in has passed", () => {
    const base = stagedOffseason(null);
    const sacked: LeagueStore = {
      ...base,
      nationalManager: { ...base.nationalManager, sacked: true },
    };
    expect(reviewNationalCampaign(sacked).nationalManager.sacked).toBe(false);
  });

  it("has nothing to judge in an offseason where no campaign of yours concluded", () => {
    const nation = buildSquads(makeLeague(0, 1).players)[0].nation;
    const after = reviewNationalCampaign(stagedOffseason(nation));
    expect(currentNationalStint(after.nationalManager)!.campaigns).toBe(0);
    expect(after.nationalManager.lastVerdict).toBeNull();
  });
});
