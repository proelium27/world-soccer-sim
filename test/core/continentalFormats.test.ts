import { describe, it, expect } from "vitest";
import type { Composites } from "../../src/engine/composites.js";
import type { MatchPlayer } from "../../src/engine/attribution.js";
import type { TeamMatchData } from "../../src/core/league/composites.js";
import type { StandingsRow } from "../../src/core/standings.js";
import type { Competition } from "../../src/core/competitions.js";
import type { CupState } from "../../src/core/cup/types.js";
import { worldCompetitions } from "../../src/core/competitions.js";
import {
  buildCupState, playoffDue, dueCupLeg, isCupComplete, koRoundsOf, koLegMatchdays,
} from "../../src/core/cup/cup.js";
import { leaguePhaseDue, groupTable } from "../../src/core/cup/leaguePhase.js";
import { playKnockoutLeg, playPlayoff, playLeaguePhaseRound } from "../../src/core/cup/simCup.js";
import { continentalPrizeIncome } from "../../src/core/finance/prizeIncome.js";
import {
  CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT, DOMESTIC_CUP_MATCHDAYS, type CupFormat,
} from "../../src/core/constants.js";
import { TRANSFER_DEADLINE_MATCHDAY } from "../../src/core/calendar.js";
import {
  DEFAULT_CONTINENTAL_FORMAT, KNOCKOUT_SIZE_OPTIONS, LEAGUE_PHASE_GAME_OPTIONS,
  resolveCupShape, sanitizeContinentalFormat, describeCupShape, isDefaultContinentalFormat,
  type ContinentalFormatSettings,
} from "../../src/core/cup/cupShape.js";

/* Same fixtures cup.test.ts uses: synthetic tables where tid order is finishing
 * order, and minimal match data whose strength tracks the seed. */

function fakeTable(tids: number[]): StandingsRow[] {
  return tids.map((tid, i) => ({
    tid, played: 38, won: 0, drawn: 0, lost: 0, gf: 100 - i, ga: 0, gd: 100 - i, points: 100 - i,
  }));
}

function tablesFor(comps: Competition[], clubsPerLeague = 4): Map<number, StandingsRow[]> {
  const tables = new Map<number, StandingsRow[]>();
  comps.filter((c) => c.tier === 1).forEach((c, li) => {
    tables.set(c.id, fakeTable(Array.from({ length: clubsPerLeague }, (_, r) => li * 100 + r)));
  });
  comps.filter((c) => c.tier > 1).forEach((c) => tables.set(c.id, fakeTable([9000 + c.id])));
  return tables;
}

function fakeMatchData(tid: number, strength: number): TeamMatchData {
  const composites: Composites = {
    name: `T${tid}`, attack: strength, finishing: strength, defense: strength, keeping: strength, control: strength,
  };
  const positions: MatchPlayer["pos"][] = ["GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST"];
  const v = 50 + strength * 40;
  const xi: MatchPlayer[] = positions.map((pos, i) => ({
    pid: tid * 100 + i, pos, slot: pos, secondary: [], ovr: v, shooting: v, dribbling: v,
    tackling: v, keeping: v, positioning: v, heading: v, stamina: 80, interceptions: v, passing: v,
  }));
  return { composites, xi, bench: [], recompute: () => composites };
}

function matchDataFor(cup: CupState): Map<number, TeamMatchData> {
  const md = new Map<number, TeamMatchData>();
  for (const tid of cup.leaguePhase!.teams) md.set(tid, fakeMatchData(tid, 0.3 + 0.4 / cup.seeds[tid]));
  return md;
}

/**
 * Play a whole cup the way simThrough does: one stage per matchday, the opening
 * stage first, then the playoff, then a knockout leg. Returns the finished cup,
 * the prize money credited per club, and the matchday of every stage played.
 */
function playSeason(start: CupState): { cup: CupState; prizes: Map<number, number>; days: number[] } {
  let cup = start;
  const prizes = new Map<number, number>();
  const days: number[] = [];
  const md = matchDataFor(cup);
  const credit = (p: Map<number, number>): void => {
    for (const [tid, v] of p) prizes.set(tid, (prizes.get(tid) ?? 0) + v);
  };
  for (let matchday = 1; matchday <= 38; matchday++) {
    if (cup.leaguePhase && leaguePhaseDue(cup.leaguePhase, matchday)) {
      const r = playLeaguePhaseRound(cup, md, 7, matchday);
      cup = r.cup; credit(r.prizes); days.push(matchday);
    } else if (playoffDue(cup, matchday)) {
      const r = playPlayoff(cup, md, 7);
      cup = r.cup; credit(r.prizes); days.push(matchday);
    } else if (dueCupLeg(cup, matchday)) {
      const r = playKnockoutLeg(cup, md, 7, matchday);
      cup = r.cup; credit(r.prizes); days.push(matchday);
    }
  }
  return { cup, prizes, days };
}

/** Every distinct format: settings an opening ignores are not varied for it. */
function allFormats(): ContinentalFormatSettings[] {
  const out: ContinentalFormatSettings[] = [];
  for (const twoLegged of [true, false]) {
    for (const knockoutSize of KNOCKOUT_SIZE_OPTIONS) {
      for (const leaguePhaseGames of LEAGUE_PHASE_GAME_OPTIONS) {
        for (const playoffRound of [true, false]) {
          out.push({ opening: "league", leaguePhaseGames, knockoutSize, playoffRound, twoLegged });
        }
      }
      out.push({ ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups", knockoutSize, twoLegged });
      out.push({ ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout", knockoutSize, twoLegged });
    }
  }
  // The shipped format carries no stored shape by design; its own test covers it.
  return out.filter((s) => !isDefaultContinentalFormat(s));
}

const WORLD = worldCompetitions();
const label = (s: ContinentalFormatSettings): string =>
  `${s.opening}/${s.leaguePhaseGames}g/ko ${s.knockoutSize}/${s.playoffRound ? "playoff" : "no playoff"}/${s.twoLegged ? "2 legs" : "1 leg"}`;

/** A hand-built field of `size` clubs: the big four sending size/4 each. */
function smallWorld(size: number): { comps: Competition[]; format: CupFormat } {
  const comps = WORLD.filter((c) => ["England", "Spain", "Italy", "Germany"].includes(c.country));
  return { comps, format: { ...CONTINENTAL_CUP_FORMAT, strongSlots: size / 4, weakSlots: size / 4 } };
}

describe("continental formats: the default is the shipped cup", () => {
  it("builds exactly the state it always did when the settings are the default", () => {
    const tables = tablesFor(WORLD);
    const plain = buildCupState(WORLD, tables, 3, CONTINENTAL_CUP_FORMAT);
    const withDefault = buildCupState(WORLD, tables, 3, CONTINENTAL_CUP_FORMAT, {}, { ...DEFAULT_CONTINENTAL_FORMAT });
    expect(withDefault).toEqual(plain);
    expect(plain!.shape).toBeUndefined();
    expect(plain!.calendar).toBeUndefined();
  });

  it("reads a hand-edited or partial setting as the default wherever a field is missing or wrong", () => {
    expect(sanitizeContinentalFormat({})).toEqual(DEFAULT_CONTINENTAL_FORMAT);
    expect(sanitizeContinentalFormat({ opening: "swiss", knockoutSize: 12, twoLegged: "yes" })).toEqual(DEFAULT_CONTINENTAL_FORMAT);
    expect(isDefaultContinentalFormat(sanitizeContinentalFormat({ opening: "groups" }))).toBe(false);
  });
});

describe("continental formats: every format plays a whole season", () => {
  const cases: { field: number; settings: ContinentalFormatSettings }[] = [
    ...allFormats().map((settings) => ({ field: 32, settings })),
    ...[12, 16, 24].flatMap((field) => allFormats()
      .filter((s) => s.twoLegged && s.leaguePhaseGames !== 4)
      .map((settings) => ({ field, settings }))),
  ];

  it.each(cases.map((c) => [`${c.field} clubs, ${label(c.settings)}`, c] as const))("%s", (_, { field, settings }) => {
    const { comps, format } = field === 32
      ? { comps: WORLD, format: CONTINENTAL_CUP_FORMAT }
      : field === 24
        ? { comps: WORLD, format: SHIELD_FORMAT } // the real 24-club competition
        : smallWorld(field);
    const built = buildCupState(comps, tablesFor(comps, 8), 3, format, {}, settings)!;
    expect(built).not.toBeNull();
    const shape = built.shape!;
    expect(shape).toEqual(resolveCupShape(built.leaguePhase!.teams.length, settings));

    // The calendar: inside the season, clear of the domestic cups and deadline
    // day, and every stage strictly after the one before it.
    const cal = built.calendar!;
    const ordered = [...cal.opening, ...(cal.playoff !== null ? [cal.playoff] : []), ...cal.ko.flat()];
    for (const d of ordered) {
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(37);
      expect((DOMESTIC_CUP_MATCHDAYS as readonly number[]).includes(d)).toBe(false);
      expect(d).not.toBe(TRANSFER_DEADLINE_MATCHDAY);
    }
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    expect(cal.ko[cal.ko.length - 1]).toEqual([37]);
    expect(koLegMatchdays(built)).toEqual(cal.ko);

    const { cup, prizes, days } = playSeason(built);
    expect(isCupComplete(cup)).toBe(true);
    expect(days).toEqual(ordered);

    // Opening stage: every club plays the games its format promises.
    const lp = cup.leaguePhase!;
    for (const tid of lp.teams) {
      const games = lp.matches.filter((m) => m.home === tid || m.away === tid).length;
      expect(games).toBe(shape.openingGames);
    }
    if (shape.opening === "groups") {
      expect(lp.groups).toHaveLength(shape.groups);
      for (const g of lp.groups!) expect(groupTable(lp, g, cup.seeds).every((r) => r.played === 6)).toBe(true);
    }

    // Knockout: the bracket halves each round down to one final.
    const rounds = koRoundsOf(cup);
    expect(2 ** rounds).toBe(shape.koSize);
    for (let r = 0; r < rounds; r++) {
      expect(cup.ties.filter((t) => t.round === r)).toHaveLength(shape.koSize / 2 ** (r + 1));
      const twoLeg = shape.twoLegged && r < rounds - 1;
      expect(cup.ties.filter((t) => t.round === r).every((t) => !!t.legs === twoLeg)).toBe(true);
    }

    // A groups bracket never opens with a rematch from the same group.
    if (shape.opening === "groups") {
      const groupOf = new Map<number, number>();
      lp.groups!.forEach((g, i) => g.forEach((tid) => groupOf.set(tid, i)));
      for (const t of cup.ties.filter((x) => x.round === 0)) {
        expect(groupOf.get(t.home)).not.toBe(groupOf.get(t.away));
      }
    }

    // The money the sim credited is the money the Finance page reports.
    for (const tid of lp.teams) {
      expect(continentalPrizeIncome(cup, tid)?.total ?? 0).toBe(prizes.get(tid) ?? 0);
    }
    // Everyone who entered was paid for entering.
    for (const tid of lp.teams) expect(prizes.get(tid) ?? 0).toBeGreaterThan(0);

    // The preview sentence names the bracket it built.
    expect(describeCupShape(shape, lp.teams.length).length).toBeGreaterThan(20);
  });
});

describe("continental formats: shapes", () => {
  it("groups of 32 is eight groups into a Round of 16", () => {
    const s = resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups" });
    expect(s).toMatchObject({ groups: 8, koSize: 16, openingGames: 6 });
  });
  it("groups of 24 takes the best third-placed sides into a Round of 16, like Euro 2016", () => {
    expect(resolveCupShape(24, { ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups" }).koSize).toBe(16);
  });
  it("a straight knockout of 24 gives the top eight a bye", () => {
    expect(resolveCupShape(24, { ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout" }))
      .toMatchObject({ koSize: 16, directQF: 8, playoffTeams: 16 });
  });
  it("a Swiss phase with no playoff sends exactly a bracket through", () => {
    expect(resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT, playoffRound: false }))
      .toMatchObject({ koSize: 8, directQF: 8, playoffTeams: 0 });
  });
  it("a Swiss phase into a Round of 16 with a playoff is the real Champions League split", () => {
    expect(resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT, knockoutSize: 16 }))
      .toMatchObject({ koSize: 16, directQF: 8, playoffTeams: 16 });
  });
});
