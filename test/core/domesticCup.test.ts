import { describe, it, expect } from "vitest";
import type { StandingsRow } from "../../src/core/standings.js";
import { worldCompetitions, countriesOf } from "../../src/core/competitions.js";
import {
  buildDomesticCup, buildDomesticCups, domesticCupField, totalRoundsFor, prelimTieCount,
  domesticRoundName, domesticRoundDue, pendingRound, advanceDomesticCup, domesticFinalists,
  clubDomesticRun, clubDomesticRunLabel, drawPairings, roundsFromFinal, domesticPrizeForRound,
} from "../../src/core/domesticCup/cup.js";
import { archiveDomesticCup } from "../../src/core/domesticCup/archive.js";
import { domesticStatsForPlayer } from "../../src/core/domesticCup/stats.js";
import type { CupTie } from "../../src/core/cup/types.js";
import type { DomesticCupState } from "../../src/core/domesticCup/types.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  DOMESTIC_CUP_MATCHDAYS, DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL,
  CUP_LEAGUE_PHASE_MATCHDAYS, CUP_PLAYOFF_MATCHDAY, CUP_KO_LEG_MATCHDAYS,
  NUM_TEAMS, NUM_TEAMS_D2,
} from "../../src/core/constants.js";

const comps = worldCompetitions();

/** A world's worth of club slots, laid out the way generateWorld assigns tids. */
function worldTeams(): { tid: number; compId: number }[] {
  const teams: { tid: number; compId: number }[] = [];
  let tid = 0;
  for (const c of comps.filter((x) => x.tier === 1)) {
    const d2 = comps.find((x) => x.country === c.country && x.tier === 2)!;
    for (let i = 0; i < NUM_TEAMS; i++) teams.push({ tid: tid++, compId: c.id });
    for (let i = 0; i < NUM_TEAMS_D2; i++) teams.push({ tid: tid++, compId: d2.id });
  }
  return teams;
}

/** Play out a drawn round by letting the home side win every tie. */
function homeWinsRound(cup: DomesticCupState): DomesticCupState {
  const round = pendingRound(cup)!;
  const ties: CupTie[] = round.pairings.map((p) => ({
    round: round.round, matchday: round.matchday, home: p.home, away: p.away,
    homeGoals: 1, awayGoals: 0, wentToExtraTime: false, wentToPens: false,
    homePens: 0, awayPens: 0, winner: p.home, boxScore: null,
  }));
  return advanceDomesticCup(cup, comps, ties);
}

describe("domestic cup structure", () => {
  it("sizes a 40-club field as a preliminary round plus five straight rounds", () => {
    expect(totalRoundsFor(40)).toBe(6);
    expect(prelimTieCount(40)).toBe(8); // 16 clubs play, 24 sit out -> 32 remain
    expect(prelimTieCount(32)).toBe(0); // a power of two needs no preliminary round
    expect(totalRoundsFor(32)).toBe(5);
  });

  it("never asks a club to play a domestic tie on a Continental Cup matchday", () => {
    const continental = new Set<number>([
      ...CUP_LEAGUE_PHASE_MATCHDAYS,
      CUP_PLAYOFF_MATCHDAY,
      ...CUP_KO_LEG_MATCHDAYS.flat(),
    ]);
    for (const md of DOMESTIC_CUP_MATCHDAYS) expect(continental.has(md)).toBe(false);
  });

  it("puts the lowest finishers into the preliminary round and gives the rest byes", () => {
    const teams = worldTeams();
    const cup = buildDomesticCup("England", comps, teams, new Map(), 1)!;
    const round = pendingRound(cup)!;

    expect(cup.teams).toHaveLength(NUM_TEAMS + NUM_TEAMS_D2);
    expect(round.pairings).toHaveLength(8);
    expect(round.byes).toHaveLength(24);

    // With no tables the field falls back to tid order, which is the tier-1
    // block then the tier-2 block — so every preliminary entrant is second tier.
    const d2 = comps.find((c) => c.country === "England" && c.tier === 2)!;
    const d2Tids = new Set(teams.filter((t) => t.compId === d2.id).map((t) => t.tid));
    for (const p of round.pairings) {
      expect(d2Tids.has(p.home)).toBe(true);
      expect(d2Tids.has(p.away)).toBe(true);
    }
  });

  it("ranks a relegated club above clubs that were already in the second tier", () => {
    const teams = worldTeams();
    const d1 = comps.find((c) => c.country === "England" && c.tier === 1)!;
    const d2 = comps.find((c) => c.country === "England" && c.tier === 2)!;
    const d1Tids = teams.filter((t) => t.compId === d1.id).map((t) => t.tid);
    const d2Tids = teams.filter((t) => t.compId === d2.id).map((t) => t.tid);

    // Last season this club was 20th in the top flight; it now sits in tier 2.
    const relegated = d2Tids[d2Tids.length - 1];
    const table = (tids: number[]): StandingsRow[] => tids.map((tid, i) => ({
      tid, played: 38, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 100 - i,
    }));
    const tables = new Map<number, StandingsRow[]>([
      [d1.id, table([...d1Tids.slice(0, 19), relegated])],
      [d2.id, table([...d2Tids.slice(0, d2Tids.length - 1), d1Tids[19]])],
    ]);

    const field = domesticCupField("England", comps, teams, tables);
    // Every club that played in tier 1 last season outranks every tier-2 one.
    expect(field.slice(0, 20)).toContain(relegated);
    const cup = buildDomesticCup("England", comps, teams, tables, 2)!;
    const playing = pendingRound(cup)!.pairings.flatMap((p) => [p.home, p.away]);
    expect(playing).not.toContain(relegated);
  });

  it("names rounds by distance from the final, not by index", () => {
    const cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;
    expect(domesticRoundName(cup, 0)).toBe("Preliminary round");
    expect(domesticRoundName(cup, 1)).toBe("Round of 32");
    expect(domesticRoundName(cup, 2)).toBe("Round of 16");
    expect(domesticRoundName(cup, 3)).toBe("Quarter-final");
    expect(domesticRoundName(cup, 4)).toBe("Semi-final");
    expect(domesticRoundName(cup, 5)).toBe("Final");
  });

  it("prices a round from the final backwards so the preliminary round is the cheapest", () => {
    const cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;
    expect(roundsFromFinal(cup, 5)).toBe(0);
    expect(domesticPrizeForRound(cup, 5)).toBe(DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL[0]);
    expect(domesticPrizeForRound(cup, 0)).toBe(DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL[5]);
  });
});

describe("the open draw", () => {
  it("pairs every club exactly once and is deterministic for a seed", () => {
    const tids = Array.from({ length: 32 }, (_, i) => i);
    const a = drawPairings(tids, mulberry32(7));
    const b = drawPairings(tids, mulberry32(7));
    expect(a).toEqual(b);
    expect(a).toHaveLength(16);
    expect([...a.flatMap((p) => [p.home, p.away])].sort((x, y) => x - y)).toEqual(tids);
  });

  it("redraws from the survivors each round rather than following a fixed bracket", () => {
    let cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;

    const seen: number[][] = [];
    for (let r = 0; r < cup.totalRounds; r++) {
      const round = pendingRound(cup)!;
      expect(round.round).toBe(r);
      // A cup takes the LAST totalRounds matchdays, so the final always lands together.
      expect(round.matchday).toBe(DOMESTIC_CUP_MATCHDAYS.slice(-cup.totalRounds)[r]);
      seen.push(round.pairings.flatMap((p) => [p.home, p.away]));
      cup = homeWinsRound(cup);
    }

    // Sizes step down cleanly: 16 -> 32 -> 16 -> 8 -> 4 -> 2 clubs involved.
    expect(seen.map((s) => s.length)).toEqual([16, 32, 16, 8, 4, 2]);
    // Nobody plays twice in a round.
    for (const s of seen) expect(new Set(s).size).toBe(s.length);
    expect(cup.championTid).not.toBeNull();
    expect(pendingRound(cup)).toBeNull();
  });

  it("knows its finalists once the final is drawn, and not before", () => {
    let cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;
    for (let r = 0; r < cup.totalRounds - 1; r++) {
      expect(domesticFinalists(cup)).toHaveLength(0);
      cup = homeWinsRound(cup);
    }
    const finalists = domesticFinalists(cup);
    expect(finalists).toHaveLength(2);

    cup = homeWinsRound(cup);
    expect(finalists).toContain(cup.championTid!);
    expect(clubDomesticRunLabel(cup, cup.championTid!)).toBe("Winners");
    const loser = finalists.find((t) => t !== cup.championTid)!;
    expect(clubDomesticRunLabel(cup, loser)).toBe("Final");
  });

  it("counts a bye as taking part in that round", () => {
    const cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;
    const bye = pendingRound(cup)!.byes[0];
    expect(clubDomesticRun(cup, bye)).toBe(0);
    expect(clubDomesticRun(cup, -99)).toBeNull();
  });

  it("only reports a round due once its matchday arrives", () => {
    const cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;
    const first = DOMESTIC_CUP_MATCHDAYS.slice(-cup.totalRounds)[0];
    expect(domesticRoundDue(cup, first - 1)).toBe(false);
    expect(domesticRoundDue(cup, first)).toBe(true);
  });
});

describe("every country gets a cup", () => {
  it("builds one per country, each contested by both of its divisions", () => {
    const teams = worldTeams();
    const cups = buildDomesticCups(comps, teams, new Map(), 1);
    expect(cups.map((c) => c.country)).toEqual(countriesOf(comps));

    for (const cup of cups) {
      const compIds = new Set(comps.filter((c) => c.country === cup.country).map((c) => c.id));
      const countryTids = new Set(teams.filter((t) => compIds.has(t.compId)).map((t) => t.tid));
      expect(cup.teams).toHaveLength(countryTids.size);
      for (const tid of cup.teams) expect(countryTids.has(tid)).toBe(true);
      expect(cup.name).toContain("Cup");
    }
  });
});

describe("archiving", () => {
  it("keeps the stat lines and drops the box scores", () => {
    let cup = buildDomesticCup("England", comps, worldTeams(), new Map(), 1)!;
    const round = pendingRound(cup)!;
    const pid = 4321;
    const line = {
      pid, rating: 7.5, goals: 2, assists: 1, shots: 4, shotsOnTarget: 3, xg: 1.2,
      goalsAgainst: 0, xga: 0, saves: 0, tackles: 1, interceptions: 1, passes: 30,
      passesCompleted: 25, crosses: 2, foulsCommitted: 0, yellowCards: 0, redCards: 0,
      minutesPlayed: 90,
    };
    const ties: CupTie[] = round.pairings.map((p, i) => ({
      round: round.round, matchday: round.matchday, home: p.home, away: p.away,
      homeGoals: 2, awayGoals: 0, wentToExtraTime: false, wentToPens: false,
      homePens: 0, awayPens: 0, winner: p.home,
      boxScore: i === 0 ? { home: [line], away: [], events: [] } : null,
    }));
    cup = advanceDomesticCup(cup, comps, ties);

    // Live: summed from the box scores.
    expect(domesticStatsForPlayer(cup, pid).goals).toBe(2);

    const archived = archiveDomesticCup(cup);
    expect(archived.rounds[0].ties.every((t) => t.boxScore === null)).toBe(true);
    expect(domesticStatsForPlayer(archived, pid).goals).toBe(2);
    expect(domesticStatsForPlayer(archived, pid).appearances).toBe(1);
    // Idempotent — migrate re-runs this on every archived cup.
    expect(archiveDomesticCup(archived)).toEqual(archived);
    // A player who never featured reads as an empty line, not a crash.
    expect(domesticStatsForPlayer(archived, 999999).appearances).toBe(0);
  });
});
