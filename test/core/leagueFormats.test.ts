import { describe, it, expect } from "vitest";
import {
  worldCompetitions, buildCompetitions, competitionSeasonFormat, competitionSplit,
  competitionTeamCount, competitionSeasonGames, seasonFormatRounds, worldLeagueSpecs,
  type Competition,
} from "../../src/core/competitions.js";
import { roundRobin, buildCompetitionSchedule, splitSecondPhaseFixtures, type ScheduleGame } from "../../src/core/schedule.js";
import { computeStandings, compareStandingsRows, type MatchScore, type StandingsRow } from "../../src/core/standings.js";
import {
  promotionPlayoffFields, playPromotionPlayoffRound, drawPromotionPlayoff, promotionPlayoffRoundsLeft,
  promotionPlayoffMatchData, playoffOutcomes, promotionPlayoffDecider,
} from "../../src/core/promotionPlayoff.js";
import { computeCountrySwaps } from "../../src/core/promotion.js";
import { titlePlayoffFields, playTitlePlayoffs, titlePlayoffRoundNames } from "../../src/core/titlePlayoff.js";
import { SEASON_MATCHDAYS } from "../../src/core/calendar.js";
import { makeLeague } from "../helpers/league.js";

const WORLD = worldCompetitions();
const comp = (country: string, tier: number): Competition =>
  WORLD.find((c) => c.country === country && c.tier === tier)!;

function gamesPerClub(games: ScheduleGame[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const g of games) {
    out.set(g.home, (out.get(g.home) ?? 0) + 1);
    out.set(g.away, (out.get(g.away) ?? 0) + 1);
  }
  return out;
}

function noClubTwiceAMatchday(games: ScheduleGame[]): void {
  const seen = new Set<string>();
  for (const g of games) {
    for (const tid of [g.home, g.away]) {
      const key = `${g.matchday}:${tid}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  }
}

/** Every pairing played the right number of times, whatever the order. */
function meetings(games: ScheduleGame[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of games) {
    const key = [g.home, g.away].sort((a, b) => a - b).join("-");
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

describe("roundRobin", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("is the plain double round robin for an even field", async () => {
    const { generateSchedule } = await import("../../src/core/schedule.js");
    expect(roundRobin(ids(20), 2)).toEqual(generateSchedule(ids(20)));
  });

  it("plays every pairing exactly `legs` times, one game a club a round", () => {
    for (const [n, legs] of [[10, 4], [12, 3], [6, 1], [17, 2], [13, 2], [5, 3]] as const) {
      const games = roundRobin(ids(n), legs);
      noClubTwiceAMatchday(games);
      const met = meetings(games);
      expect(met.size, `${n}x${legs}`).toBe((n * (n - 1)) / 2);
      for (const count of met.values()) expect(count, `${n}x${legs}`).toBe(legs);
      // n-1 rounds a leg, or n with a bye.
      expect(Math.max(...games.map((g) => g.matchday))).toBe(legs * (n % 2 === 1 ? n : n - 1));
    }
  });

  it("gives every club the same home games over an even number of legs", () => {
    for (const [n, legs] of [[10, 4], [18, 2], [17, 2], [12, 4]] as const) {
      const home = new Map<number, number>();
      for (const g of roundRobin(ids(n), legs)) home.set(g.home, (home.get(g.home) ?? 0) + 1);
      const values = ids(n).map((t) => home.get(t) ?? 0);
      expect(Math.max(...values) - Math.min(...values), `${n}x${legs}`).toBe(0);
    }
  });
});

describe("the shipped season formats", () => {
  it("plays Scotland's top flight as 33 then a split into two sixes, 38 in all", () => {
    const scotland = comp("Scotland", 1);
    const format = competitionSeasonFormat(scotland);
    expect(format.legs).toBe(3);
    expect(format.split!.groups).toEqual([6, 6]);
    expect(seasonFormatRounds(format, 12)).toEqual({ first: 33, second: 5, total: SEASON_MATCHDAYS });
    expect(competitionSeasonGames(scotland)).toBe(38);
    expect(competitionSplit(scotland)!.lastFirstPhaseMatchday).toBe(33);
  });

  it("plays Scotland's lower divisions four times over (36 games)", () => {
    for (const tier of [2, 3]) {
      expect(competitionSeasonFormat(comp("Scotland", tier))).toEqual({ legs: 4 });
      expect(competitionSeasonGames(comp("Scotland", tier))).toBe(36);
    }
  });

  it("splits Greece's top flight three ways after 26: fours play six more, the six ten", () => {
    const greece = comp("Greece", 1);
    const split = competitionSplit(greece)!;
    expect(split.groups).toEqual([4, 4, 6]);
    expect(split.firstPhaseMatches).toBe(182);
    expect(competitionSeasonGames(greece)).toBe(36);
  });

  it("falls back to a double round robin when a format cannot run", () => {
    const base = comp("Scotland", 1);
    // Groups that do not add up to the division.
    expect(competitionSeasonFormat({ ...base, teamCount: 14 })).toEqual({ legs: 2 });
    // A season longer than the calendar.
    expect(competitionSeasonFormat({ ...base, teamCount: 20, seasonFormat: { legs: 3 } })).toEqual({ legs: 2 });
  });

  it("still round-trips the shipped world through its specs, per-link rules included", () => {
    expect(buildCompetitions(worldLeagueSpecs())).toEqual(WORLD);
  });
});

describe("a split table", () => {
  // Six clubs, groups of three, a single first phase of 15 matches on matchdays 1-5.
  const tids = [1, 2, 3, 4, 5, 6];
  const split = { groups: [3, 3], lastFirstPhaseMatchday: 5, firstPhaseMatches: 15 };
  const firstPhase: MatchScore[] = roundRobin(tids, 1).map((g) => ({
    home: g.home, away: g.away, matchday: g.matchday,
    // The lower tid always wins, so the first-phase table reads 1..6.
    homeGoals: g.home < g.away ? 1 : 0, awayGoals: g.home < g.away ? 0 : 1,
  }));

  it("is one table until the first phase is complete", () => {
    const partial = computeStandings(tids, firstPhase.slice(0, 10), undefined, split);
    expect(partial.every((r) => r.group === undefined)).toBe(true);
  });

  it("keeps each club inside its group whatever its points", () => {
    // Club 4 wins every second-phase game and passes club 3 on points.
    const secondPhase: MatchScore[] = [
      { home: 4, away: 5, homeGoals: 9, awayGoals: 0, matchday: 6 },
      { home: 4, away: 6, homeGoals: 9, awayGoals: 0, matchday: 7 },
      { home: 5, away: 4, homeGoals: 0, awayGoals: 9, matchday: 8 },
    ];
    const table = computeStandings(tids, [...firstPhase, ...secondPhase], undefined, split);
    const byTid = new Map(table.map((r) => [r.tid, r]));
    expect(byTid.get(4)!.points).toBeGreaterThan(byTid.get(3)!.points);
    expect(table.map((r) => r.tid).slice(0, 3)).toEqual([1, 2, 3]);
    expect(table.map((r) => r.group)).toEqual([0, 0, 0, 1, 1, 1]);
    // Re-sorting a stored table ranks it the way it was decided.
    expect([...table].reverse().sort(compareStandingsRows).map((r) => r.tid)).toEqual(table.map((r) => r.tid));
  });
});

describe("splitSecondPhaseFixtures", () => {
  const scotland = comp("Scotland", 1);
  const teams = Array.from({ length: 12 }, (_, i) => ({ tid: 500 + i, compId: scotland.id }));
  const tids = teams.map((t) => t.tid);
  const firstPhase = buildCompetitionSchedule(teams, [scotland]);
  const played: MatchScore[] = firstPhase.map((g) => ({
    home: g.home, away: g.away, matchday: g.matchday, homeGoals: g.home < g.away ? 2 : 0, awayGoals: 0,
  }));

  it("lays out only the first phase at the start of the season", () => {
    expect(firstPhase).toHaveLength(198);
    expect(Math.max(...firstPhase.map((g) => g.matchday))).toBe(33);
  });

  it("adds nothing until the first phase has been played", () => {
    expect(splitSecondPhaseFixtures(teams, [scotland], played.slice(0, 197), [], undefined)).toEqual([]);
    expect(splitSecondPhaseFixtures(teams, [scotland], played, firstPhase.slice(-1), undefined)).toEqual([]);
  });

  it("builds each group's round robin on the matchdays after the split, once", () => {
    const second = splitSecondPhaseFixtures(teams, [scotland], played, [], undefined);
    expect(second).toHaveLength(30);
    noClubTwiceAMatchday(second);
    expect(Math.min(...second.map((g) => g.matchday))).toBe(34);
    expect(Math.max(...second.map((g) => g.matchday))).toBe(SEASON_MATCHDAYS);
    // The lower tids won everything, so they are the top six and never meet the bottom six.
    const top = new Set(tids.slice(0, 6));
    for (const g of second) expect(top.has(g.home)).toBe(top.has(g.away));
    for (const count of gamesPerClub(second).values()) expect(count).toBe(5);
    // With the second phase on the schedule, nothing more is added.
    expect(splitSecondPhaseFixtures(teams, [scotland], played, second, undefined)).toEqual([]);
  });

  it("spreads a shorter group across the longer one's window (Greece)", () => {
    const greece = comp("Greece", 1);
    const gTeams = Array.from({ length: 14 }, (_, i) => ({ tid: 700 + i, compId: greece.id }));
    const gFirst = buildCompetitionSchedule(gTeams, [greece]);
    const gPlayed: MatchScore[] = gFirst.map((g) => ({
      home: g.home, away: g.away, matchday: g.matchday, homeGoals: g.home < g.away ? 1 : 0, awayGoals: 0,
    }));
    const second = splitSecondPhaseFixtures(gTeams, [greece], gPlayed, [], undefined);
    noClubTwiceAMatchday([...gFirst, ...second]);
    const counts = gamesPerClub(second);
    for (let i = 0; i < 8; i++) expect(counts.get(700 + i)).toBe(6);
    for (let i = 8; i < 14; i++) expect(counts.get(700 + i)).toBe(10);
    expect(Math.max(...second.map((g) => g.matchday))).toBe(SEASON_MATCHDAYS);
  });
});

describe("the French promotion ladder", () => {
  const row = (tid: number, points: number): StandingsRow => ({
    tid, played: 34, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points,
  });
  const comps = buildCompetitions([{
    country: "Anywhere", d1Teams: 18, d2Teams: 18, promotionSpots: 3, playoffFormat: "french",
  }]);
  const tables = new Map([
    [comps[0].id, Array.from({ length: 18 }, (_, i) => row(i, 100 - i))],
    [comps[1].id, Array.from({ length: 18 }, (_, i) => row(100 + i, 100 - i))],
  ]);

  it("seats the top flight's 16th and the second tier's 3rd, 4th and 5th", () => {
    const [field] = promotionPlayoffFields(comps, tables);
    expect(field.format).toBe("french");
    expect(field.teams).toEqual([15, 102, 103, 104]);
    expect(field.positions).toEqual([16, 3, 4, 5]);
    expect([field.autoPromoted, field.autoRelegated]).toEqual([2, 2]);
  });

  it("plays 4v5, then 3 v the winner, then two legs against the club above, and balances the swap", () => {
    const league = makeLeague(0, 1);
    // Borrow two real divisions' clubs so there is match data to play on.
    const d1 = league.competitions.find((c) => c.country === "France" && c.tier === 1)!;
    const d2 = league.competitions.find((c) => c.country === "France" && c.tier === 2)!;
    const d1Tids = league.teams.filter((t) => t.compId === d1.id).map((t) => t.tid);
    const d2Tids = league.teams.filter((t) => t.compId === d2.id).map((t) => t.tid);
    const realTables = new Map([
      [d1.id, d1Tids.map((tid, i) => row(tid, 100 - i))],
      [d2.id, d2Tids.map((tid, i) => row(tid, 100 - i))],
    ]);
    const franceOnly = league.competitions.filter((c) => c.country === "France" && c.tier <= 2);
    const [field] = promotionPlayoffFields(franceOnly, realTables);
    let playoff = drawPromotionPlayoff(field, league.season);
    const matchData = promotionPlayoffMatchData(playoff, league.teams, league.players, league.lid);
    expect(promotionPlayoffRoundsLeft(playoff)).toBe(3);
    playoff = playPromotionPlayoffRound(playoff, matchData, league.lid);
    expect(playoff.ties[0].home).toBe(field.teams[2]);
    expect(playoff.ties[0].away).toBe(field.teams[3]);
    playoff = playPromotionPlayoffRound(playoff, matchData, league.lid);
    expect(playoff.ties[1].home).toBe(field.teams[1]);
    expect(playoff.ties[1].away).toBe(playoff.ties[0].winner);
    playoff = playPromotionPlayoffRound(playoff, matchData, league.lid);
    expect(promotionPlayoffRoundsLeft(playoff)).toBe(0);
    const decider = promotionPlayoffDecider(playoff)!;
    expect(decider.legs).toHaveLength(2);
    expect([decider.home, decider.away]).toContain(field.teams[0]);

    const [swap] = computeCountrySwaps(franceOnly, realTables, playoffOutcomes([playoff]));
    expect(swap.promoted.length).toBe(swap.relegated.length);
    const challengerWon = playoff.winnerTid !== field.teams[0];
    expect(swap.promoted.length).toBe(challengerWon ? 3 : 2);
  });
});

describe("the USL's lower-division title playoffs", () => {
  const league = makeLeague(0, 1);
  const us2 = league.competitions.find((c) => c.country === "United States" && c.tier === 2)!;
  const us3 = league.competitions.find((c) => c.country === "United States" && c.tier === 3)!;
  const tables = new Map(league.competitions.map((c) => [
    c.id,
    league.teams.filter((t) => t.compId === c.id).map((t, i): StandingsRow => ({
      tid: t.tid, played: 30, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 100 - i,
    })),
  ]));

  it("sizes the US second and third divisions at 24 and 17", () => {
    // 24 rather than an odd 25 so its conferences are equal halves, which is
    // what lets them play each other at all (see conferences.test.ts).
    expect(competitionTeamCount(us2)).toBe(24);
    expect(competitionTeamCount(us3)).toBe(17);
  });

  it("seats eight a conference in the second division and a top eight in the third", () => {
    const fields = titlePlayoffFields(league.competitions, tables, league.teams);
    const f2 = fields.find((f) => f.compId === us2.id)!;
    const f3 = fields.find((f) => f.compId === us3.id)!;
    expect(f2.format).toBe("conference-single");
    expect(f2.conferences!.map((h) => h.length)).toEqual([8, 8]);
    expect(f3.format).toBe("single");
    expect(f3.teams).toHaveLength(8);
    // No other lower division holds one.
    expect(fields.filter((f) => league.competitions.find((c) => c.id === f.compId)!.tier > 1))
      .toHaveLength(2);
  });

  it("plays each conference to a winner, then a final between the two", () => {
    const playoffs = playTitlePlayoffs(league.competitions, league.teams, league.players, tables, league.lid, 1);
    const p = playoffs.find((x) => x.compId === us2.id)!;
    const perRound = titlePlayoffRoundNames("conference-single").map((_, r) => p.ties.filter((t) => t.round === r));
    expect(perRound.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    const [east] = p.conferences!;
    const [final] = perRound[3];
    expect(east.includes(final.home) !== east.includes(final.away)).toBe(true);
    expect(p.winnerTid).toBe(final.winner);
  });
});
