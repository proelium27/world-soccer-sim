import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  deriveExpectations, generateJobOffers, interestReach, clubOfferTarget,
  setClubInterest, clubInterests, switchClub,
} from "../../src/core/manager/index.js";
import {
  nationExpectations, generateNationOffers, setNationInterest, nationInterests, takeNationalJob,
} from "../../src/core/nationalManager/index.js";
import {
  MANAGER_MAX_INTERESTS, MANAGER_OFFER_BAND, MANAGER_REP_BASE, NATIONAL_REP_BASE,
} from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

describe("interestReach", () => {
  it("is full at or below your level and fades to nothing at the top of the band", () => {
    expect(interestReach(0.1, 0.5, 0.2)).toBe(1);
    expect(interestReach(0.5, 0.5, 0.2)).toBe(1);
    expect(interestReach(0.6, 0.5, 0.2)).toBeCloseTo(0.5);
    expect(interestReach(0.7, 0.5, 0.2)).toBe(0);
    expect(interestReach(0.9, 0.5, 0.2)).toBe(0);
  });
});

describe("club job interests", () => {
  const league = makeLeague(0, 11);
  const expectations = deriveExpectations(
    league.teams, league.players, league.competitions, league.seasonHistory,
  );
  const ranked = [...expectations.values()].sort((a, b) => b.prestige - a.prestige);
  const biggest = ranked[0];
  const smallest = ranked[ranked.length - 1];

  const seasonsOffered = (
    currentTid: number, reputation: number, target: number, interests?: number[],
  ): number => {
    let hits = 0;
    for (let season = 1; season <= 12; season++) {
      const offers = generateJobOffers({
        lid: league.lid, season, currentTid, expectations,
        sacked: false, reputation, lastOverperformance: 0, interests,
      });
      if (offers.some((o) => o.tid === target)) hits++;
    }
    return hits;
  };

  it("leaves the offer list untouched when nothing is asked for", () => {
    // Interest rolls live on their own stream, so a save with no interests must
    // draw exactly the list it always did.
    for (let season = 1; season <= 6; season++) {
      const args = {
        lid: league.lid, season, currentTid: ranked[40].tid, expectations,
        sacked: false, reputation: 60, lastOverperformance: 0.3,
      };
      const plain = generateJobOffers(args);
      expect(generateJobOffers({ ...args, interests: [] })).toEqual(plain);
    }
  });

  it("lets a decorated manager at a giant land the smallest club in the world", () => {
    // The ordinary list never offers a step down while you're employed, so the
    // only way this club calls is by asking.
    expect(seasonsOffered(biggest.tid, 100, smallest.tid)).toBe(0);
    expect(seasonsOffered(biggest.tid, 100, smallest.tid, [smallest.tid])).toBeGreaterThan(0);
  });

  it("never reaches a job your record is nowhere near", () => {
    const target = clubOfferTarget(MANAGER_REP_BASE, smallest.prestige, false);
    expect(interestReach(biggest.prestige, target, MANAGER_OFFER_BAND)).toBe(0);
    expect(seasonsOffered(smallest.tid, MANAGER_REP_BASE, biggest.tid, [biggest.tid])).toBe(0);
  });

  it("still gives a sacked manager an asked-for club at their level", () => {
    let hits = 0;
    for (let season = 1; season <= 12; season++) {
      const offers = generateJobOffers({
        lid: league.lid, season, currentTid: biggest.tid, expectations,
        sacked: true, reputation: 100, lastOverperformance: -0.6, interests: [smallest.tid],
      });
      expect(offers.length).toBeGreaterThan(0);
      if (offers.some((o) => o.tid === smallest.tid)) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it("refuses your own club, unknown clubs and a full list", () => {
    const own = league.meta.userTid;
    expect(setClubInterest(league, own, true)).toBeNull();
    expect(setClubInterest(league, 999_999, true)).toBeNull();

    let l: LeagueStore = league;
    const others = league.teams.filter((t) => t.tid !== own).slice(0, MANAGER_MAX_INTERESTS + 1);
    for (const t of others.slice(0, MANAGER_MAX_INTERESTS)) l = setClubInterest(l, t.tid, true)!;
    expect(clubInterests(l.manager)).toHaveLength(MANAGER_MAX_INTERESTS);
    expect(setClubInterest(l, others[MANAGER_MAX_INTERESTS].tid, true)).toBeNull();
    expect(setClubInterest(l, others[0].tid, true)).toBeNull();

    l = setClubInterest(l, others[0].tid, false)!;
    expect(clubInterests(l.manager)).not.toContain(others[0].tid);
  });

  it("drops a club from the list once you take the job there", () => {
    const own = league.meta.userTid;
    const [a, b] = league.teams.filter((t) => t.tid !== own);
    let l = setClubInterest(league, a.tid, true)!;
    l = setClubInterest(l, b.tid, true)!;
    const moved = switchClub(l, a.tid, "left");
    expect(clubInterests(moved.manager)).toEqual([b.tid]);
  });
});

describe("national job interests", () => {
  const ranks = Array.from({ length: 40 }, (_, i) => ({ nation: `N${i}`, rating: 80 - i }));
  const expectations = nationExpectations({ season: 1, ranks });

  const seasonsOffered = (
    currentNation: string | null, reputation: number, target: string, interests?: string[],
  ): number => {
    let hits = 0;
    for (let season = 1; season <= 12; season++) {
      const offers = generateNationOffers({
        lid: 1, season, currentNation, expectations, sacked: false,
        reputation, clubReputation: MANAGER_REP_BASE, lastOverperformance: 0, interests,
      });
      if (offers.some((o) => o.nation === target)) hits++;
    }
    return hits;
  };

  it("leaves the offer list untouched when nothing is asked for", () => {
    const args = {
      lid: 1, season: 5, currentNation: "N10", expectations, sacked: false,
      reputation: 70, clubReputation: 60, lastOverperformance: 0.2,
    };
    expect(generateNationOffers({ ...args, interests: [] })).toEqual(generateNationOffers(args));
  });

  it("lets the strongest nation's manager land a minnow they ask for", () => {
    expect(seasonsOffered("N0", 100, "N39")).toBe(0);
    expect(seasonsOffered("N0", 100, "N39", ["N39"])).toBeGreaterThan(0);
  });

  it("never reaches a country the record is nowhere near", () => {
    expect(seasonsOffered(null, NATIONAL_REP_BASE, "N0", ["N0"])).toBe(0);
  });

  it("validates against the ranked nations and clears the taken job", () => {
    const base = makeLeague(0, 11);
    const league: LeagueStore = {
      ...base,
      international: {
        ...base.international,
        powerRankings: [{ season: 1, ranks } as LeagueStore["international"]["powerRankings"][number]],
      },
    };
    expect(setNationInterest(league, "Nowhere", true)).toBeNull();
    let l = setNationInterest(league, "N3", true)!;
    l = setNationInterest(l, "N7", true)!;
    expect(nationInterests(l.nationalManager)).toEqual(["N3", "N7"]);
    const took = takeNationalJob(l, "N3");
    expect(nationInterests(took.nationalManager)).toEqual(["N7"]);
    expect(setNationInterest(took, "N3", true)).toBeNull();
  });
});
