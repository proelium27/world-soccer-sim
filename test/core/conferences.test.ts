import { describe, it, expect } from "vitest";
import {
  worldCompetitions, competitionConferences, competitionTeamCount, competitionTitlePlayoff,
  competitionSeasonGames, type Competition,
} from "../../src/core/competitions.js";
import { buildCompetitionSchedule, conferenceSchedule, type ScheduleGame } from "../../src/core/schedule.js";
import { conferenceMembers, assignConferences, type ConferenceTeam } from "../../src/core/conferences.js";
import {
  titlePlayoffFields, playTitlePlayoffs, titlePlayoffRoundNames, ZONE_ROUND_OF_16_PAIRS,
} from "../../src/core/titlePlayoff.js";
import { buildDomesticCup } from "../../src/core/domesticCup/cup.js";
import { shippedClubsFor } from "../../src/core/teams/clubs.js";
import { SEASON_MATCHDAYS } from "../../src/core/calendar.js";
import { DOMESTIC_CUP_MATCHDAYS } from "../../src/core/constants.js";
import type { StandingsRow } from "../../src/core/standings.js";
import { makeLeague } from "../helpers/league.js";

/** The shipped world's clubs as bare {tid, compId}, in generation order. */
function worldTeams(comps: Competition[]): ConferenceTeam[] {
  const out: ConferenceTeam[] = [];
  for (const c of comps) {
    for (let i = 0; i < competitionTeamCount(c); i++) out.push({ tid: out.length, compId: c.id });
  }
  return out;
}

function tableOf(tids: number[], played: number): StandingsRow[] {
  return tids.map((tid, i) => ({
    tid, played, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 1000 - i,
  }));
}

/** Per club: games, home games, and how many times it met each opponent. */
function tally(games: ScheduleGame[]) {
  const games_ = new Map<number, number>();
  const home = new Map<number, number>();
  const meetings = new Map<string, number>();
  const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const g of games) {
    bump(games_, g.home);
    bump(games_, g.away);
    bump(home, g.home);
    bump(meetings, [g.home, g.away].sort((x, y) => x - y).join("-"));
  }
  const met = (x: number, y: number) => meetings.get([x, y].sort((p, q) => p - q).join("-")) ?? 0;
  return { games: games_, home, met };
}

function noClubTwiceAMatchday(games: ScheduleGame[]) {
  const seen = new Set<string>();
  for (const g of games) {
    for (const tid of [g.home, g.away]) {
      const key = `${g.matchday}:${tid}`;
      expect(seen.has(key), `club ${tid} twice on matchday ${g.matchday}`).toBe(false);
      seen.add(key);
    }
  }
}

describe("the shipped splits", () => {
  const comps = worldCompetitions();

  it("splits exactly the US and Argentine top two divisions, and nothing below them", () => {
    const split = comps.filter((c) => competitionConferences(c));
    expect(split.map((c) => `${c.country}:${c.tier}:${competitionTeamCount(c)}`)).toEqual([
      "Argentina:1:30", "Argentina:2:36", "United States:1:30", "United States:2:30",
    ]);
    const top = (country: string) => split.find((c) => c.country === country && c.tier === 1)!;
    expect(competitionTitlePlayoff(top("Argentina"))).toBe("zones");
    expect(competitionTitlePlayoff(top("United States"))).toBe("conference");
    // A split second division is a promotion race, not a title playoff.
    for (const c of split.filter((d) => d.tier === 2)) expect(competitionTitlePlayoff(c)).toBe("none");
  });

  it("gives each split top flight at least one second-division club per top-flight club", () => {
    for (const country of ["Argentina", "United States"]) {
      const [d1, d2] = [1, 2].map((tier) => comps.find((c) => c.country === country && c.tier === tier)!);
      expect(competitionTeamCount(d2)).toBeGreaterThanOrEqual(competitionTeamCount(d1));
    }
  });

  it("plays Argentina's second division as zones of 18 (34 games) and the US's as conferences of 15 (30)", () => {
    const d2 = (country: string) => comps.find((c) => c.country === country && c.tier === 2)!;
    expect(competitionSeasonGames(d2("Argentina"))).toBe(34);
    expect(competitionSeasonGames(d2("United States"))).toBe(30);
  });

  it("puts the eastern US second-division clubs in the Eastern Conference", () => {
    const teams = worldTeams(comps);
    const us = comps.find((c) => c.country === "United States" && c.tier === 2)!;
    const [east, west] = conferenceMembers(teams, us)!;
    const block = shippedClubsFor("United States")!;
    const blockStart = teams.find((t) => t.compId === comps.find((c) => c.country === "United States" && c.tier === 1)!.id)!.tid;
    const names = (tids: number[]) => tids.map((tid) => block[tid - blockStart].name);
    expect(names(east)).toContain("Charleston Shipwrights");
    expect(names(east)).toContain("Toledo Quarrymen");
    expect(names(west)).toContain("Visalia Growers");
    expect(names(west)).toContain("Anchorage Ironmasters");
  });

  it("plays a split format as a plain bracket in a league that isn't split", () => {
    const mexico = comps.find((c) => c.country === "Mexico" && c.tier === 1)!;
    expect(competitionTitlePlayoff({ ...mexico, titlePlayoff: "conference" })).toBe("single");
  });

  it("puts the fifteen eastern US clubs in the Eastern Conference", () => {
    const teams = worldTeams(comps);
    const us = comps.find((c) => c.country === "United States" && c.tier === 1)!;
    const [east, west] = conferenceMembers(teams, us)!;
    const block = shippedClubsFor("United States")!;
    const first = teams.find((t) => t.compId === us.id)!.tid;
    const names = (tids: number[]) => tids.map((tid) => block[tid - first].name);
    expect(names(east)).toContain("Providence Flatboatmen");
    expect(names(east)).toContain("Chattanooga Smelters");
    expect(names(west)).toContain("Fresno Wheelwrights");
    expect(names(west)).toContain("Des Moines Cordwainers");
  });
});

describe("conferenceSchedule", () => {
  const east = Array.from({ length: 15 }, (_, i) => i);
  const west = Array.from({ length: 15 }, (_, i) => 100 + i);

  it("gives MLS its 34: own conference twice, a rival twice and four more across", () => {
    const games = conferenceSchedule([east, west], 4);
    noClubTwiceAMatchday(games);
    const { games: count, home, met } = tally(games);
    for (const [mine, theirs] of [[east, west], [west, east]]) {
      for (const tid of mine) {
        expect(count.get(tid)).toBe(34);
        expect(home.get(tid)).toBe(17);
        for (const other of mine) if (other !== tid) expect(met(tid, other)).toBe(2);
        const across = theirs.map((o) => met(tid, o));
        expect(across.filter((n) => n === 2)).toHaveLength(1);
        expect(across.filter((n) => n === 1)).toHaveLength(4);
      }
    }
  });

  it("gives Argentina its 30: own zone twice and the inter-zone derby home and away", () => {
    const games = conferenceSchedule([east, west], 0);
    noClubTwiceAMatchday(games);
    const { games: count, home, met } = tally(games);
    for (const tid of east) {
      expect(count.get(tid)).toBe(30);
      expect(home.get(tid)).toBe(15);
      expect(west.filter((o) => met(tid, o) === 2)).toHaveLength(1);
    }
  });

  it("spreads the cross-conference rounds through the season", () => {
    const games = conferenceSchedule([east, west], 4);
    const crossRounds = [...new Set(games
      .filter((g) => (g.home < 100) !== (g.away < 100))
      .filter((g, _, all) => all.filter((x) => x.matchday === g.matchday).length === 15)
      .map((g) => g.matchday))];
    expect(crossRounds).toHaveLength(4);
    expect(Math.min(...crossRounds)).toBeGreaterThan(1);
    expect(Math.max(...crossRounds)).toBeLessThan(34);
  });
});

describe("buildCompetitionSchedule on the shipped world", () => {
  const comps = worldCompetitions();
  const teams = worldTeams(comps);
  const schedule = buildCompetitionSchedule(teams, comps);

  it("plays exactly the season length competitionSeasonGames reports, in every division", () => {
    for (const c of comps) {
      const games = schedule.filter((g) => teams.find((t) => t.tid === g.home)!.compId === c.id);
      expect(games.length * 2, c.name).toBe(competitionTeamCount(c) * competitionSeasonGames(c));
    }
    const us = comps.find((c) => c.country === "United States" && c.tier === 1)!;
    const arg = comps.find((c) => c.country === "Argentina" && c.tier === 1)!;
    expect(competitionSeasonGames(us)).toBe(34);
    expect(competitionSeasonGames(arg)).toBe(30);
  });

  it("fits every division inside the calendar, finishing on the last matchday", () => {
    for (const c of comps) {
      const games = schedule.filter((g) => teams.find((t) => t.tid === g.home)!.compId === c.id);
      noClubTwiceAMatchday(games);
      expect(Math.max(...games.map((g) => g.matchday)), c.name).toBe(SEASON_MATCHDAYS);
      const n = competitionTeamCount(c);
      expect(games).toHaveLength((n * competitionSeasonGames(c)) / 2);
    }
  });
});

describe("conference membership", () => {
  const comps = worldCompetitions();
  const argentina = comps.find((c) => c.country === "Argentina" && c.tier === 1)!;
  const second = comps.find((c) => c.country === "Argentina" && c.tier === 2)!;

  it("keeps every club in its half across promotion, and seats the promoted where there is room", () => {
    const teams = assignConferences(worldTeams(comps), comps);
    const [zoneA] = conferenceMembers(teams, argentina)!;
    const [down1, down2] = zoneA;
    const up = teams.filter((t) => t.compId === second.id).slice(0, 2).map((t) => t.tid);
    const swapped = teams.map((t) =>
      t.tid === down1 || t.tid === down2 ? { ...t, compId: second.id }
        : up.includes(t.tid) ? { ...t, compId: argentina.id }
          : t);
    const after = assignConferences(swapped, comps);
    const [newA, newB] = conferenceMembers(after, argentina)!;
    expect(newA).toHaveLength(15);
    expect(newB).toHaveLength(15);
    for (const tid of up) expect(newA).toContain(tid);
    for (const tid of zoneA.filter((x) => x !== down1 && x !== down2)) expect(newA).toContain(tid);
    // Argentina's second division is split too, so a relegated club is seated in
    // a zone there rather than dropping the field: the promoted pair left two
    // gaps in its zone A, and the relegated pair fills them.
    expect(after.find((t) => t.tid === down1)!.conference).toBe(0);
    expect(after.find((t) => t.tid === down2)!.conference).toBe(0);
  });
});

describe("the split title playoffs", () => {
  const league = makeLeague(0, 1);
  const tables = new Map(league.competitions.map((c) => [
    c.id,
    tableOf(league.teams.filter((t) => t.compId === c.id).map((t) => t.tid), 30),
  ]));
  const playoffs = playTitlePlayoffs(league.competitions, league.teams, league.players, tables, league.lid, 1);
  const us = playoffs.find((p) => p.country === "United States")!;
  const arg = playoffs.find((p) => p.country === "Argentina")!;

  it("seats nine per US conference and eight per Argentine zone", () => {
    const fields = titlePlayoffFields(league.competitions, tables, league.teams);
    expect(fields.find((f) => f.country === "United States")!.conferences!.map((h) => h.length)).toEqual([9, 9]);
    expect(fields.find((f) => f.country === "Argentina")!.conferences!.map((h) => h.length)).toEqual([8, 8]);
  });

  it("plays MLS's shape: wild cards, best-of-three series, then one-off games to a final", () => {
    const perRound = titlePlayoffRoundNames("conference").map((_, r) => us.ties.filter((t) => t.round === r));
    expect(perRound.map((r) => r.length)).toEqual([2, 8, 4, 2, 1]);
    for (const t of perRound[0]) expect(t.wentToExtraTime).toBe(false);
    for (const t of perRound[1]) {
      expect(t.series!.length).toBeGreaterThanOrEqual(2);
      expect(t.series!.length).toBeLessThanOrEqual(3);
      expect(Math.max(t.homeGoals, t.awayGoals)).toBe(2);
      expect(t.series!.map((g) => g.at)[0]).toBe(t.home);
    }
    const [final] = perRound[4];
    const [east, west] = us.conferences!;
    expect(east.includes(final.home) !== east.includes(final.away)).toBe(true);
    expect(west.includes(final.home) || west.includes(final.away)).toBe(true);
    expect([final.home, final.away]).toContain(us.winnerTid);
  });

  it("plays Argentina's shape: a cross-zone round of 16, no extra time until the final", () => {
    const perRound = titlePlayoffRoundNames("zones").map((_, r) => arg.ties.filter((t) => t.round === r));
    expect(perRound.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    const [zoneA] = arg.conferences!;
    for (const t of perRound[0]) expect(zoneA.includes(t.home) !== zoneA.includes(t.away)).toBe(true);
    for (const t of [...perRound[0], ...perRound[1], ...perRound[2]]) expect(t.wentToExtraTime).toBe(false);
    // Even index against odd index, i.e. always one club from each zone.
    for (const [x, y] of ZONE_ROUND_OF_16_PAIRS) expect((x + y) % 2).toBe(1);
  });

  it("is reproducible from the league's content alone", () => {
    const again = playTitlePlayoffs(league.competitions, league.teams, league.players, tables, league.lid, 1);
    expect(again).toEqual(playoffs);
  });
});

describe("domestic cups for the 30-club pyramids", () => {
  it("gives Argentina's 70 clubs a seven-round cup that starts on matchday 1, and leaves a 60-club cup alone", () => {
    const comps = worldCompetitions();
    const teams = worldTeams(comps);
    const argentina = buildDomesticCup("Argentina", comps, teams, new Map(), 1)!;
    expect(argentina.totalRounds).toBe(7);
    expect(argentina.rounds[0].matchday).toBe(DOMESTIC_CUP_MATCHDAYS[0]);
    const england = buildDomesticCup("England", comps, teams, new Map(), 1)!;
    expect(england.totalRounds).toBe(6);
    expect(england.rounds[0].matchday).toBe(5);
  });
});
