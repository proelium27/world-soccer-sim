import { describe, it, expect } from "vitest";
import { computeWorldAwards, type WorldAwardContext } from "../../src/core/worldAwards.js";
import { emptySeasonStats, type Player, type Position } from "../../src/core/players/types.js";
import type { CupState, CupTie } from "../../src/core/cup/types.js";
import { archiveCup } from "../../src/core/cup/archive.js";
import type { BoxScore, PlayerMatchLine } from "../../src/engine/attribution.js";
import { TOTS_SLOTS } from "../../src/core/awards.js";
import {
  BALLON_DOR_SHORTLIST, AWARD_MIN_APPEARANCES, WORLD_POSITION_AWARD_SHORTLIST,
  WORLD_AWARD_DOMESTIC_CUP_BONUS, WORLD_AWARD_DOMESTIC_CUP_FULL_INVOLVEMENT,
  WORLD_TOTS_TROPHY_MULTIPLIER, WORLD_AWARD_LEAGUE_TITLE_BONUS,
  WORLD_AWARD_TITLE_FULL_SEASON,
} from "../../src/core/constants.js";
import type { DomesticCupState } from "../../src/core/domesticCup/types.js";

const SEASON = 5;

/**
 * Two competitions of deliberately different quality: comp 0 is the strong
 * league (its players are generated at high ovr below), comp 1 the weak one.
 * Every club id below is its own club; compsByTid maps each into a league.
 */
function ctx(overrides: Partial<WorldAwardContext> = {}): WorldAwardContext {
  return {
    compsByTid: { 1: 0, 2: 0, 11: 1, 12: 1 },
    competitions: [
      { id: 0, country: "England", tier: 1, name: "Strong League" },
      { id: 1, country: "France", tier: 1, name: "Weak League" },
    ],
    championTidByCompId: {},
    cup: null,
    worldCupChampion: null,
    ...overrides,
  };
}

interface PlayerSpec {
  pid: number;
  tid: number;
  ovr: number;
  pos?: Position;
  goals?: number;
  assists?: number;
  avgRating?: number;
  appearances?: number;
  nationality?: string;
  intl?: Player["intl"];
  /** The defensive stats the position awards are scored on. */
  saves?: number;
  goalsAgainst?: number;
  tackles?: number;
  interceptions?: number;
}

function player(spec: PlayerSpec): Player {
  const appearances = spec.appearances ?? 30;
  const stats = {
    ...emptySeasonStats(SEASON, spec.tid),
    appearances,
    goals: spec.goals ?? 0,
    assists: spec.assists ?? 0,
    avgRating: spec.avgRating ?? 6.5,
    saves: spec.saves ?? 0,
    goalsAgainst: spec.goalsAgainst ?? 0,
    tackles: spec.tackles ?? 0,
    interceptions: spec.interceptions ?? 0,
    minutesPlayed: appearances * 90,
  };
  return {
    pid: spec.pid,
    name: `Player ${spec.pid}`,
    nationality: spec.nationality ?? "England",
    born: SEASON - 26,
    pos: spec.pos ?? "ST",
    ovr: spec.ovr,
    stats: [stats],
    // ovrDuringSeason reads the hist entry tagged `season - 1`.
    hist: [{ season: SEASON - 1, ovr: spec.ovr, potential: spec.ovr, academy: false, ratings: {} }],
    intl: spec.intl,
  } as unknown as Player;
}

/** A squad of filler players so every Team-of-the-Year slot has candidates. */
function squad(startPid: number, tid: number, ovr: number): Player[] {
  return TOTS_SLOTS.map((pos, i) =>
    player({ pid: startPid + i, tid, ovr, pos, avgRating: 6.4 }),
  );
}

function matchLine(pid: number, over: Partial<PlayerMatchLine> = {}): PlayerMatchLine {
  return {
    pid, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, goalsAgainst: 0, xga: 0,
    saves: 0, tackles: 0, interceptions: 0, passes: 0, passesCompleted: 0, crosses: 0,
    foulsCommitted: 0, yellowCards: 0, redCards: 0, minutesPlayed: 90, rating: 7,
    ...over,
  } as PlayerMatchLine;
}

function box(home: PlayerMatchLine[], away: PlayerMatchLine[]): BoxScore {
  return { home, away, events: [] } as unknown as BoxScore;
}

/**
 * A minimal Swiss-shaped cup: `winnerTid` beats `loserTid` in the final, both
 * having played `lpGames` league-phase matches. Only the fields the award pass
 * reads are filled.
 */
function cup(
  winnerTid: number,
  loserTid: number,
  lines: { tid: number; pid: number; goals?: number; rating?: number }[],
  lpGames = 6,
): CupState {
  const linesFor = (tid: number) =>
    lines.filter((l) => l.tid === tid).map((l) => matchLine(l.pid, { goals: l.goals ?? 0, rating: l.rating ?? 7 }));
  const finalTie: CupTie = {
    round: 2, matchday: 37, home: winnerTid, away: loserTid,
    homeGoals: 1, awayGoals: 0, wentToExtraTime: false, wentToPens: false,
    homePens: 0, awayPens: 0, winner: winnerTid,
    boxScore: box(linesFor(winnerTid), linesFor(loserTid)),
  };
  return {
    competition: "continental",
    season: SEASON,
    name: "Continental Cup",
    teams: [winnerTid, loserTid],
    seeds: {},
    statLines: null,
    leaguePhase: {
      teams: [winnerTid, loserTid],
      matches: Array.from({ length: lpGames }, (_, round) => ({
        round, matchday: 3 + round * 4, home: winnerTid, away: loserTid,
        played: true, homeGoals: 1, awayGoals: 0,
        boxScore: box(linesFor(winnerTid), linesFor(loserTid)),
      })),
    },
    playoff: null,
    playIn: null,
    ties: [finalTie],
    championTid: winnerTid,
    twoLegged: false,
    koLegs: null,
  };
}

describe("computeWorldAwards — league strength correction", () => {
  it("ranks the strong league's player above an identical season in a weak league", () => {
    // Same stat line, same ovr, different leagues. The weak league's supporting
    // cast is 10 ovr worse, so its ratings are inflated by z-normalization —
    // which is exactly what the correction has to undo.
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 25, avgRating: 7.5 }),
      player({ pid: 2, tid: 11, ovr: 80, goals: 25, avgRating: 7.5 }),
      ...squad(100, 2, 70),
      ...squad(200, 12, 60),
    ];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx());
    expect(ballonDOr[0].pid).toBe(1);
    expect(ballonDOr[0].league).toBeGreaterThan(ballonDOr.find((e) => e.pid === 2)!.league);
  });

  it("does not let the correction outweigh a genuinely better player", () => {
    // A weak-league star who is 12 ovr better and scored far more still wins:
    // the correction is a unit conversion, not a blanket penalty on his league.
    const players = [
      player({ pid: 1, tid: 1, ovr: 72, goals: 12, avgRating: 6.9 }),
      player({ pid: 2, tid: 11, ovr: 84, goals: 30, avgRating: 7.8 }),
      ...squad(100, 2, 74),
      ...squad(200, 12, 62),
    ];
    expect(computeWorldAwards(players, SEASON, ctx()).ballonDOr[0].pid).toBe(2);
  });

  it("lets a clearly better player beat a bigger statline in the same league", () => {
    // WORLD_AWARD_OVR_WEIGHT exists so the world award leans harder on raw
    // quality than the per-league POTY does. Same league, same supporting cast:
    // the 86-ovr player scored 8 fewer goals and still wins, which under the
    // per-league formula alone (AWARD_OVR_WEIGHT 0.06) he would not.
    const players = [
      player({ pid: 1, tid: 1, ovr: 72, goals: 28, avgRating: 7.1 }),
      player({ pid: 2, tid: 2, ovr: 86, goals: 20, avgRating: 7.1 }),
      ...squad(100, 1, 70),
      ...squad(200, 2, 70),
    ];
    expect(computeWorldAwards(players, SEASON, ctx()).ballonDOr[0].pid).toBe(2);
  });

  it("still lets a big enough statline beat a slightly better player", () => {
    // The counterweight must not become an ovr ranking: 3 ovr of quality does
    // not survive a 22-goal gap. If this flips, WORLD_AWARD_OVR_WEIGHT is too high.
    const players = [
      player({ pid: 1, tid: 1, ovr: 75, goals: 34, avgRating: 7.6 }),
      player({ pid: 2, tid: 2, ovr: 78, goals: 12, avgRating: 6.9 }),
      ...squad(100, 1, 70),
      ...squad(200, 2, 70),
    ];
    expect(computeWorldAwards(players, SEASON, ctx()).ballonDOr[0].pid).toBe(1);
  });
});

describe("computeWorldAwards — cross-league competitions", () => {
  it("still credits the cup after the cup has been archived", () => {
    // archiveCup folds box scores into statLines and deletes them (save size).
    // computeWorldAwards must read the stored lines, or every past season's cup
    // silently scores zero — which is exactly what migrate.ts's backfill hits.
    const base = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, avgRating: 7.4 }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, avgRating: 7.4 }),
      ...squad(100, 1, 74),
      ...squad(200, 2, 74),
    ];
    const live = cup(2, 1, [{ tid: 2, pid: 2, goals: 4, rating: 8 }]);
    const archived = archiveCup(live);
    // Precondition: archiving really did drop the box scores it aggregated.
    expect(archived.statLines).not.toBeNull();
    expect(archived.ties.every((t) => t.boxScore === null)).toBe(true);

    const fromLive = computeWorldAwards(base, SEASON, ctx({ cup: live }));
    const fromArchive = computeWorldAwards(base, SEASON, ctx({ cup: archived }));
    const cupOf = (r: typeof fromLive, pid: number) => r.ballonDOr.find((e) => e.pid === pid)!.cup;
    expect(cupOf(fromArchive, 2)).toBeGreaterThan(0);
    expect(cupOf(fromArchive, 2)).toBeCloseTo(cupOf(fromLive, 2), 10);
    expect(fromArchive.ballonDOr[0].pid).toBe(fromLive.ballonDOr[0].pid);
  });

  it("a winning cup run breaks a tie between two identical league seasons", () => {
    const base = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, avgRating: 7.4 }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, avgRating: 7.4 }),
      ...squad(100, 1, 74),
      ...squad(200, 2, 74),
    ];
    const noCup = computeWorldAwards(base, SEASON, ctx());
    // Without a cup they're separated only by the pid tiebreak.
    expect(noCup.ballonDOr[0].pid).toBe(1);
    expect(noCup.ballonDOr[0].cup).toBe(0);

    // Give #2's club the trophy and him the goals in it.
    const withCup = computeWorldAwards(
      base,
      SEASON,
      ctx({ cup: cup(2, 1, [{ tid: 2, pid: 2, goals: 2, rating: 8 }, { tid: 1, pid: 1, rating: 6 }]) }),
    );
    expect(withCup.ballonDOr[0].pid).toBe(2);
    expect(withCup.ballonDOr[0].cup).toBeGreaterThan(0);
  });

  it("counts the Swiss league phase, not just the knockout ties", () => {
    const players = [player({ pid: 1, tid: 1, ovr: 80, goals: 20 }), ...squad(100, 2, 74)];
    // Identical cups except for how many league-phase games were played.
    const short = computeWorldAwards(players, SEASON, ctx({ cup: cup(1, 2, [{ tid: 1, pid: 1, goals: 1 }], 0) }));
    const long = computeWorldAwards(players, SEASON, ctx({ cup: cup(1, 2, [{ tid: 1, pid: 1, goals: 1 }], 6) }));
    expect(long.ballonDOr[0].cup).toBeGreaterThan(short.ballonDOr[0].cup);
  });

  it("credits a World Cup campaign, and the winner's bonus only to the winning nation", () => {
    const line = { season: SEASON, kind: "tournament" as const, caps: 7, goals: 5, assists: 2 };
    const career = { caps: 7, goals: 5, assists: 2, tournaments: 1, titles: 1, seasons: [line] };
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, nationality: "Brazil", intl: career }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, nationality: "Wales", intl: career }),
      ...squad(100, 1, 74),
    ];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx({ worldCupChampion: "Brazil" }));
    const brazil = ballonDOr.find((e) => e.pid === 1)!;
    const wales = ballonDOr.find((e) => e.pid === 2)!;
    expect(brazil.intl).toBeGreaterThan(wales.intl);
    expect(wales.intl).toBeGreaterThan(0); // still credited for playing the tournament
    expect(ballonDOr[0].pid).toBe(1);
  });

  it("weights a tournament campaign above an identical qualifying one", () => {
    const stats = { caps: 6, goals: 4, assists: 1 };
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, intl: { caps: 6, goals: 4, assists: 1, tournaments: 1, titles: 0, seasons: [{ season: SEASON, kind: "tournament", ...stats }] } }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, intl: { caps: 6, goals: 4, assists: 1, tournaments: 0, titles: 0, seasons: [{ season: SEASON, kind: "qualifying", ...stats }] } }),
      ...squad(100, 1, 74),
    ];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx());
    expect(ballonDOr.find((e) => e.pid === 1)!.intl)
      .toBeGreaterThan(ballonDOr.find((e) => e.pid === 2)!.intl);
  });

  it("weights a confederation cup between qualifying and a World Cup", () => {
    const stats = { caps: 6, goals: 4, assists: 1 };
    const career = (kind: "tournament" | "confederation" | "qualifying") =>
      ({ caps: 6, goals: 4, assists: 1, tournaments: 0, titles: 0, seasons: [{ season: SEASON, kind, ...stats }] });
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, intl: career("tournament") }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, intl: career("confederation") }),
      player({ pid: 3, tid: 2, ovr: 80, goals: 20, intl: career("qualifying") }),
      ...squad(100, 1, 74),
    ];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx());
    const intlOf = (pid: number) => ballonDOr.find((e) => e.pid === pid)!.intl;
    expect(intlOf(1)).toBeGreaterThan(intlOf(2));
    expect(intlOf(2)).toBeGreaterThan(intlOf(3));
  });

  it("pays a confederation cup winner's medal, and only to a nation that won one", () => {
    const line = { season: SEASON, kind: "confederation" as const, caps: 5, goals: 3, assists: 1 };
    const career = { caps: 5, goals: 3, assists: 1, tournaments: 0, titles: 0, seasons: [line] };
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, nationality: "Italy", intl: career }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, nationality: "Wales", intl: career }),
      ...squad(100, 1, 74),
    ];
    const { ballonDOr } = computeWorldAwards(
      players, SEASON, ctx({ confederationCupChampions: new Set(["Italy"]) }),
    );
    expect(ballonDOr.find((e) => e.pid === 1)!.intl)
      .toBeGreaterThan(ballonDOr.find((e) => e.pid === 2)!.intl);
    expect(ballonDOr.find((e) => e.pid === 2)!.intl).toBeGreaterThan(0);
  });

  it("sums every campaign a player played that offseason, not just the first", () => {
    // The offseason that stages the confederation cups also plays a
    // World Cup qualifying leg, so a player holds two lines for one season.
    // Reading only the first would silently drop one of them.
    const both = {
      caps: 11, goals: 7, assists: 3, tournaments: 0, titles: 0,
      seasons: [
        { season: SEASON, kind: "qualifying" as const, caps: 6, goals: 4, assists: 2 },
        { season: SEASON, kind: "confederation" as const, caps: 5, goals: 3, assists: 1 },
      ],
    };
    const qualifyingOnly = {
      caps: 6, goals: 4, assists: 2, tournaments: 0, titles: 0,
      seasons: [{ season: SEASON, kind: "qualifying" as const, caps: 6, goals: 4, assists: 2 }],
    };
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20, intl: both }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20, intl: qualifyingOnly }),
      ...squad(100, 1, 74),
    ];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx());
    expect(ballonDOr.find((e) => e.pid === 1)!.intl)
      .toBeGreaterThan(ballonDOr.find((e) => e.pid === 2)!.intl);
  });

  it("credits winning your own league, pro-rated by appearances", () => {
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20 }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20 }),
      // Same champion club, but he only played a handful of games.
      player({ pid: 3, tid: 1, ovr: 80, goals: 20, appearances: AWARD_MIN_APPEARANCES }),
      ...squad(100, 2, 74),
    ];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx({ championTidByCompId: { 0: 1 } }));
    const champion = ballonDOr.find((e) => e.pid === 1)!;
    const runnerUp = ballonDOr.find((e) => e.pid === 2)!;
    const squadPlayer = ballonDOr.find((e) => e.pid === 3)!;
    expect(champion.title).toBeGreaterThan(0);
    expect(runnerUp.title).toBe(0);
    expect(squadPlayer.title).toBeGreaterThan(0);
    expect(squadPlayer.title).toBeLessThan(champion.title);
  });
});

describe("computeWorldAwards — shape and determinism", () => {
  it("fills every World Team of the Year slot with the right position and no repeats", () => {
    const players = [...squad(100, 1, 78), ...squad(200, 2, 74), ...squad(300, 11, 66)];
    const { worldTeamOfYear } = computeWorldAwards(players, SEASON, ctx());
    const byPid = new Map(players.map((p) => [p.pid, p]));
    expect(worldTeamOfYear).toHaveLength(11);
    worldTeamOfYear.forEach((pid, i) => {
      expect(pid).not.toBeNull();
      expect(byPid.get(pid!)!.pos).toBe(TOTS_SLOTS[i]);
    });
    expect(new Set(worldTeamOfYear).size).toBe(11);
  });

  it("picks the World XI from the strong league when the leagues are otherwise alike", () => {
    // Same ratings everywhere; only squad quality (and so league strength) differs.
    const players = [...squad(100, 1, 78), ...squad(300, 11, 62)];
    const { worldTeamOfYear } = computeWorldAwards(players, SEASON, ctx());
    expect(worldTeamOfYear.every((pid) => pid !== null && pid < 200)).toBe(true);
  });

  it("caps the shortlist and is stable across repeated runs", () => {
    const players = Array.from({ length: 40 }, (_, i) =>
      player({ pid: i + 1, tid: i % 2 === 0 ? 1 : 2, ovr: 60 + (i % 20), goals: i % 15 }),
    );
    const first = computeWorldAwards(players, SEASON, ctx());
    const second = computeWorldAwards(players, SEASON, ctx());
    expect(first.ballonDOr).toHaveLength(BALLON_DOR_SHORTLIST);
    expect(first).toEqual(second);
  });

  it("returns empty honors when nobody played that season", () => {
    const { ballonDOr, worldTeamOfYear } = computeWorldAwards([], SEASON, ctx());
    expect(ballonDOr).toEqual([]);
    expect(worldTeamOfYear).toHaveLength(11);
    expect(worldTeamOfYear.every((p) => p === null)).toBe(true);
  });

  it("skips players whose club has no competition recorded for that season", () => {
    const players = [player({ pid: 1, tid: 99, ovr: 90, goals: 40 }), ...squad(100, 1, 70)];
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx());
    expect(ballonDOr.some((e) => e.pid === 1)).toBe(false);
  });
});

/**
 * A domestic cup won by club `tid`, with `lines` giving each player's
 * appearances in it. Archived shape (statLines set, no box scores), which is
 * what a season being judged actually holds by the time awards run.
 */
function domesticCup(tid: number, lines: Record<number, number>): DomesticCupState {
  return {
    season: SEASON,
    country: "England",
    name: "English Cup",
    teams: [tid],
    rounds: [],
    totalRounds: 6,
    championTid: tid,
    statLines: Object.entries(lines).map(([pid, appearances]) => ({
      pid: Number(pid),
      season: SEASON,
      appearances,
      goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, saves: 0, goalsAgainst: 0,
      tackles: 0, interceptions: 0, minutesPlayed: appearances * 90,
      ratingSum: appearances * 8, ratedAppearances: appearances,
    })),
  };
}

describe("computeWorldAwards — domestic cup", () => {
  it("credits a winner's squad, pro-rated by ties played", () => {
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20 }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20 }),
      ...squad(100, 1, 60),
      ...squad(200, 2, 60),
    ];
    const full = domesticCup(1, { 1: WORLD_AWARD_DOMESTIC_CUP_FULL_INVOLVEMENT });
    const withCup = computeWorldAwards(players, SEASON, ctx({ domesticCups: [full] }));
    const without = computeWorldAwards(players, SEASON, ctx());

    const cupWinner = withCup.ballonDOr.find((e) => e.pid === 1)!;
    const baseline = without.ballonDOr.find((e) => e.pid === 1)!;
    expect(cupWinner.domesticCup).toBeCloseTo(WORLD_AWARD_DOMESTIC_CUP_BONUS, 6);
    expect(cupWinner.score - baseline.score).toBeCloseTo(WORLD_AWARD_DOMESTIC_CUP_BONUS, 6);

    // A team-mate who played one tie gets a fraction, not the lot.
    const oneTie = computeWorldAwards(players, SEASON, ctx({ domesticCups: [domesticCup(1, { 1: 1 })] }));
    expect(oneTie.ballonDOr.find((e) => e.pid === 1)!.domesticCup)
      .toBeCloseTo(WORLD_AWARD_DOMESTIC_CUP_BONUS / WORLD_AWARD_DOMESTIC_CUP_FULL_INVOLVEMENT, 6);
  });

  it("pays nothing to a player at a club that didn't win it, or who never played a tie", () => {
    const players = [
      player({ pid: 1, tid: 1, ovr: 80, goals: 20 }),
      player({ pid: 2, tid: 2, ovr: 80, goals: 20 }),
      ...squad(100, 1, 60),
    ];
    // Club 1 won, but pid 1 never featured; pid 2 is at a club that didn't win.
    const cup = domesticCup(1, { 999: 6 });
    const { ballonDOr } = computeWorldAwards(players, SEASON, ctx({ domesticCups: [cup] }));
    expect(ballonDOr.find((e) => e.pid === 1)!.domesticCup).toBe(0);
    expect(ballonDOr.find((e) => e.pid === 2)!.domesticCup).toBe(0);
  });

  it("is a team bonus only: cup goals never enter the award", () => {
    const players = [player({ pid: 1, tid: 1, ovr: 80, goals: 10 }), ...squad(100, 1, 60)];
    const quiet = domesticCup(1, { 1: 6 });
    const prolific: DomesticCupState = {
      ...quiet,
      statLines: quiet.statLines!.map((l) => ({ ...l, goals: 25, assists: 15 })),
    };
    const a = computeWorldAwards(players, SEASON, ctx({ domesticCups: [quiet] }));
    const b = computeWorldAwards(players, SEASON, ctx({ domesticCups: [prolific] }));
    expect(b.ballonDOr.find((e) => e.pid === 1)!.score)
      .toBeCloseTo(a.ballonDOr.find((e) => e.pid === 1)!.score, 6);
  });

  it("scores a season with no domestic cups exactly as before the competition existed", () => {
    const players = [player({ pid: 1, tid: 1, ovr: 80, goals: 20 }), ...squad(100, 1, 60)];
    expect(computeWorldAwards(players, SEASON, ctx({ domesticCups: [] })))
      .toEqual(computeWorldAwards(players, SEASON, ctx()));
  });
});

/**
 * Goalkeeper of the Year and Defender of the Year.
 *
 * These exist because `potyScore` — and therefore the Ballon d'Or — carries
 * no defensive statistics at all, so the tests that matter most are the ones
 * showing these awards are decided by the stats that award ignores.
 */
describe("position awards", () => {
  /** A keeper who did keeper things, so the defensive formula has something to read. */
  function keeper(pid: number, tid: number, ovr: number, over: Partial<{ saves: number; goalsAgainst: number; avgRating: number; appearances: number }> = {}) {
    return player({
      pid, tid, ovr, pos: "GK",
      saves: over.saves ?? 100,
      goalsAgainst: over.goalsAgainst ?? 40,
      avgRating: over.avgRating ?? 6.8,
      ...(over.appearances !== undefined ? { appearances: over.appearances } : {}),
    });
  }

  function defender(pid: number, tid: number, ovr: number, over: Partial<{ tackles: number; interceptions: number; avgRating: number; pos: Position }> = {}) {
    return player({
      pid, tid, ovr, pos: over.pos ?? "CB",
      tackles: over.tackles ?? 100,
      interceptions: over.interceptions ?? 100,
      avgRating: over.avgRating ?? 6.8,
    });
  }

  it("gives the keeper's award to a keeper and the defender's to a defender", () => {
    const players = [
      // A striker who would win any award open to him.
      player({ pid: 1, tid: 1, ovr: 90, goals: 40, assists: 20, avgRating: 8 }),
      keeper(2, 1, 78),
      defender(3, 1, 78),
      ...squad(100, 2, 60),
    ];
    const { goalkeeperOfYear, defenderOfYear, ballonDOr } = computeWorldAwards(players, SEASON, ctx());
    expect(goalkeeperOfYear![0].pid).toBe(2);
    expect(defenderOfYear![0].pid).toBe(3);
    // ...and the striker still wins the award that is open to everyone.
    expect(ballonDOr[0].pid).toBe(1);
  });

  it("never shortlists a player from outside the position group", () => {
    const players = [
      player({ pid: 1, tid: 1, ovr: 90, goals: 40, avgRating: 8 }),
      player({ pid: 2, tid: 1, ovr: 88, pos: "DM", tackles: 300, interceptions: 300, avgRating: 8 }),
      player({ pid: 3, tid: 1, ovr: 88, pos: "CM", tackles: 300, interceptions: 300, avgRating: 8 }),
      keeper(4, 1, 60),
      defender(5, 1, 60),
      ...squad(100, 2, 55),
    ];
    const { goalkeeperOfYear, defenderOfYear } = computeWorldAwards(players, SEASON, ctx());
    // A holding midfielder out-tackles every defender here and still can't
    // appear: DM and CM are the MID group, not DEF.
    const keeperPos = goalkeeperOfYear!.map((e) => players.find((p) => p.pid === e.pid)!.pos);
    const defPos = defenderOfYear!.map((e) => players.find((p) => p.pid === e.pid)!.pos);
    expect(new Set(keeperPos)).toEqual(new Set(["GK"]));
    expect(defPos.every((pos) => pos === "CB" || pos === "FB")).toBe(true);
  });

  it("full-backs are eligible alongside centre-backs", () => {
    const players = [
      defender(1, 1, 70, { pos: "FB", tackles: 250, interceptions: 250, avgRating: 7.5 }),
      defender(2, 1, 70, { pos: "CB", tackles: 60, interceptions: 60, avgRating: 6.2 }),
      ...squad(100, 2, 55),
    ];
    const { defenderOfYear } = computeWorldAwards(players, SEASON, ctx());
    expect(defenderOfYear![0].pid).toBe(1);
  });

  it("is decided by defensive work, which the Ballon d'Or cannot see", () => {
    const busy = defender(1, 1, 70, { tackles: 300, interceptions: 300 });
    const quiet = defender(2, 1, 70, { tackles: 10, interceptions: 10 });
    const players = [busy, quiet, ...squad(100, 2, 55)];
    const { defenderOfYear, ballonDOr } = computeWorldAwards(players, SEASON, ctx());

    expect(defenderOfYear![0].pid).toBe(1);
    // The same two players are indistinguishable to the Ballon d'Or, which is
    // the entire reason this award exists: potyScore has no tackle term, so
    // their league scores are identical and only the pid tiebreak separates them.
    const a = ballonDOr.find((e) => e.pid === 1)!;
    const b = ballonDOr.find((e) => e.pid === 2)!;
    expect(a.score).toBeCloseTo(b.score, 6);
  });

  it("pays a keeper for saves and charges him for goals conceded", () => {
    const players = [
      keeper(1, 1, 70, { saves: 200, goalsAgainst: 20 }),
      keeper(2, 1, 70, { saves: 20, goalsAgainst: 80 }),
      ...squad(100, 2, 55),
    ];
    const { goalkeeperOfYear } = computeWorldAwards(players, SEASON, ctx());
    expect(goalkeeperOfYear![0].pid).toBe(1);
    expect(goalkeeperOfYear![1].pid).toBe(2);
  });

  it("agrees with the World XI's keeper, which is the point of sharing one score", () => {
    // Both are picked off `worldTotsParts`, trophy multiplier included, so they
    // cannot disagree. That is the reason the multiplier lives at the shared
    // base rather than at the award — see WORLD_TOTS_TROPHY_MULTIPLIER.
    const players = [
      keeper(1, 1, 82, { saves: 180, goalsAgainst: 25 }),
      keeper(2, 2, 80, { saves: 90, goalsAgainst: 55 }),
      keeper(3, 11, 76, { saves: 140, goalsAgainst: 60 }),
      ...squad(100, 1, 65),
      ...squad(200, 2, 62),
    ];
    const { goalkeeperOfYear, worldTeamOfYear } = computeWorldAwards(players, SEASON, ctx());
    // Slot 0 of TOTS_SLOTS is the keeper's.
    expect(TOTS_SLOTS[0]).toBe("GK");
    expect(worldTeamOfYear[0]).toBe(goalkeeperOfYear![0].pid);
  });

  it("puts the Defender of the Year in the World XI's back four, by construction", () => {
    // Same argument as the keeper: `positionAward` takes the best score in the
    // DEF group and `pickWorldTeam` takes the best score among candidates for
    // each back-four slot, off the same map, applying the qualified-first rule
    // identically. So the winner cannot be absent from the back four.
    const players = [
      defender(1, 1, 80, { pos: "CB", tackles: 240, interceptions: 220, avgRating: 7.3 }),
      defender(2, 2, 76, { pos: "CB", tackles: 120, interceptions: 110, avgRating: 6.9 }),
      defender(3, 1, 78, { pos: "FB", tackles: 200, interceptions: 150, avgRating: 7.1 }),
      defender(4, 11, 72, { pos: "FB", tackles: 90, interceptions: 80, avgRating: 6.6 }),
      ...squad(100, 1, 65),
      ...squad(200, 2, 62),
    ];
    const { defenderOfYear, worldTeamOfYear } = computeWorldAwards(players, SEASON, ctx());
    // Slots 1-4 of TOTS_SLOTS are the back four.
    expect(TOTS_SLOTS.slice(1, 5)).toEqual(["CB", "CB", "FB", "FB"]);
    expect(worldTeamOfYear.slice(1, 5)).toContain(defenderOfYear![0].pid);
  });

  it("keeps a shortlist no longer than WORLD_POSITION_AWARD_SHORTLIST", () => {
    const keepers = Array.from({ length: WORLD_POSITION_AWARD_SHORTLIST + 6 }, (_, i) =>
      keeper(500 + i, 1, 70, { saves: 100 + i }),
    );
    const { goalkeeperOfYear } = computeWorldAwards([...keepers, ...squad(100, 2, 55)], SEASON, ctx());
    expect(goalkeeperOfYear).toHaveLength(WORLD_POSITION_AWARD_SHORTLIST);
    // Best first.
    const scores = goalkeeperOfYear!.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("falls back below the appearance bar rather than leaving the award vacant", () => {
    // Nobody in the world played a full season, exactly like the Ballon d'Or's
    // own fallback.
    const players = [
      keeper(1, 1, 70, { saves: 40 }),
      defender(2, 1, 70, { tackles: 40 }),
    ].map((p) => ({
      ...p,
      stats: [{ ...p.stats[0], appearances: AWARD_MIN_APPEARANCES - 1 }],
    })) as unknown as Player[];
    const { goalkeeperOfYear, defenderOfYear } = computeWorldAwards(players, SEASON, ctx());
    expect(goalkeeperOfYear![0].pid).toBe(1);
    expect(defenderOfYear![0].pid).toBe(2);
  });

  it("prefers a qualified player over an unqualified one who scored higher", () => {
    // Keepers are scored on goals conceded per game, so the full-timer needs a
    // believable season to beat the squad keepers below, who concede nothing.
    const parttime = keeper(1, 1, 90, { saves: 500, goalsAgainst: 0 });
    const fulltime = keeper(2, 1, 70, { saves: 50, goalsAgainst: 30, avgRating: 7.0 });
    const players = [
      { ...parttime, stats: [{ ...parttime.stats[0], appearances: AWARD_MIN_APPEARANCES - 1 }] },
      fulltime,
      ...squad(100, 2, 55),
    ] as unknown as Player[];
    const { goalkeeperOfYear } = computeWorldAwards(players, SEASON, ctx());
    expect(goalkeeperOfYear![0].pid).toBe(2);
    expect(goalkeeperOfYear!.map((e) => e.pid)).not.toContain(1);
  });

  it("returns empty awards rather than throwing when nobody played", () => {
    const { goalkeeperOfYear, defenderOfYear } = computeWorldAwards([], SEASON, ctx());
    expect(goalkeeperOfYear).toEqual([]);
    expect(defenderOfYear).toEqual([]);
  });

  it("weights a trophy WORLD_TOTS_TROPHY_MULTIPLIER times what the Ballon d'Or does", () => {
    const players = [keeper(1, 1, 78), keeper(2, 2, 78), ...squad(100, 11, 55)];
    const champion = ctx({ championTidByCompId: { 0: 1 } });
    const plain = computeWorldAwards(players, SEASON, ctx());
    const won = computeWorldAwards(players, SEASON, champion);

    expect(plain.goalkeeperOfYear![0].title).toBe(0);
    // Asserted as a ratio against the Ballon d'Or's own credit for the same
    // title rather than against the raw constant: the bonus is pro-rated by
    // appearances, and the point being pinned is the multiplier, not the
    // pro-rating.
    const positionTitle = won.goalkeeperOfYear!.find((e) => e.pid === 1)!.title;
    const ballonTitle = won.ballonDOr.find((e) => e.pid === 1)!.title;
    expect(ballonTitle).toBeGreaterThan(0);
    expect(positionTitle / ballonTitle).toBeCloseTo(WORLD_TOTS_TROPHY_MULTIPLIER, 6);
  });

  it("leaves the domestic league season unmultiplied, and the Ballon d'Or on its own trophy weighting", () => {
    const players = [keeper(1, 1, 78), keeper(2, 2, 78), ...squad(100, 11, 55)];
    const champion = ctx({ championTidByCompId: { 0: 1 } });
    const { goalkeeperOfYear, worldTeamOfYear, ballonDOr } =
      computeWorldAwards(players, SEASON, champion);

    // `league` is the one part measured wholly inside one competition, so it is
    // the one part the multiplier must not touch.
    const beforeMultiplier = computeWorldAwards(players, SEASON, ctx());
    expect(goalkeeperOfYear![0].league)
      .toBeCloseTo(beforeMultiplier.goalkeeperOfYear![0].league, 6);

    // The World XI shares the multiplied score (that is the point of putting
    // the multiplier on the shared base), so its keeper is the award winner.
    expect(worldTeamOfYear[0]).toBe(goalkeeperOfYear![0].pid);
    // The Ballon d'Or takes the league-strength scale on its trophies like
    // everything else — that scale belongs to the trophy, not to one award —
    // but NOT the tots trophy multiplier, so it stays strictly the smaller.
    const ballonTitle = ballonDOr.find((e) => e.pid === 1)!.title;
    expect(ballonTitle).toBeGreaterThan(0);
    expect(goalkeeperOfYear![0].title).toBeGreaterThan(ballonTitle);
  });

  it("applies the multiplier to the World XI as well, not just the two awards", () => {
    // The keeper with the better raw season is at a club that won nothing; the
    // slightly worse one won his league. Both the award and the XI must move to
    // him together — a version that multiplied only the awards left the XI
    // picking the other man about two thirds of the time.
    const apps = WORLD_AWARD_TITLE_FULL_SEASON;
    const players = [
      keeper(1, 2, 78, { saves: 180, goalsAgainst: 28, avgRating: 7.3, appearances: apps }),
      keeper(2, 1, 78, { saves: 130, goalsAgainst: 34, avgRating: 7.0, appearances: apps }),
      ...squad(100, 11, 55),
    ];
    const champion = computeWorldAwards(players, SEASON, ctx({ championTidByCompId: { 0: 1 } }));
    expect(champion.goalkeeperOfYear![0].pid).toBe(2);
    expect(champion.worldTeamOfYear[0]).toBe(2);
  });

  it("pays more for a title in a strong league than the same title in a weak one", () => {
    // Two champions, one in each competition. comp 0 is stacked with high-ovr
    // players and comp 1 with low ones, so comp 0 sits well above the world
    // mean ovr and comp 1 well below it.
    const players = [
      keeper(1, 1, 78, { appearances: WORLD_AWARD_TITLE_FULL_SEASON }),
      keeper(2, 11, 78, { appearances: WORLD_AWARD_TITLE_FULL_SEASON }),
      ...squad(100, 1, 82), ...squad(200, 2, 80),
      ...squad(300, 11, 50), ...squad(400, 12, 48),
    ];
    const { goalkeeperOfYear } = computeWorldAwards(
      players, SEASON, ctx({ championTidByCompId: { 0: 1, 1: 11 } }),
    );
    const strong = goalkeeperOfYear!.find((e) => e.pid === 1)!;
    const weak = goalkeeperOfYear!.find((e) => e.pid === 2)!;

    // Same trophy, same appearances, same ovr — only the league differs.
    expect(strong.title).toBeGreaterThan(weak.title);
    // And the weak league's title is still a reward, never a penalty: the
    // floor is what guarantees that (a tier-2 domestic cup winner is the case
    // that would otherwise go negative).
    expect(weak.title).toBeGreaterThan(0);
  });

  it("never turns a trophy into a penalty, however far below the world a league sits", () => {
    // One tiny, very weak competition against a huge strong one, so the weak
    // side's ovr delta is far past where the raw scale would go negative.
    const players = [
      keeper(1, 11, 40, { appearances: WORLD_AWARD_TITLE_FULL_SEASON }),
      ...squad(100, 1, 95), ...squad(200, 2, 95),
      ...squad(300, 11, 20),
    ];
    const { goalkeeperOfYear } = computeWorldAwards(
      players, SEASON, ctx({ championTidByCompId: { 1: 11 } }),
    );
    expect(goalkeeperOfYear!.find((e) => e.pid === 1)!.title).toBeGreaterThan(0);
  });

  it("lets a title overturn a league season the title bonus alone could not", () => {
    // The better keeper is at a club that won nothing; the slightly worse one
    // won his league. Both play a full season so the bonus isn't pro-rated.
    // Keepers are judged on goals conceded per game, so the gap between them is
    // built from rating and goals conceded; it has to stay wider than an
    // unmultiplied title for this test to mean anything (asserted below).
    const apps = WORLD_AWARD_TITLE_FULL_SEASON;
    const players = [
      keeper(1, 2, 78, { saves: 180, goalsAgainst: 26, avgRating: 7.6, appearances: apps }),
      keeper(2, 1, 78, { saves: 130, goalsAgainst: 36, avgRating: 7.0, appearances: apps }),
      ...squad(100, 11, 55),
    ];
    const noTrophies = computeWorldAwards(players, SEASON, ctx());
    expect(noTrophies.goalkeeperOfYear![0].pid).toBe(1);

    // How far ahead the better keeper is on league play alone.
    const gap = noTrophies.goalkeeperOfYear!.find((e) => e.pid === 1)!.league
      - noTrophies.goalkeeperOfYear!.find((e) => e.pid === 2)!.league;

    // The gap is wider than an unmultiplied title, so at Ballon d'Or weight the
    // trophy would NOT have been enough. That is the whole reason the
    // multiplier exists, and pinning it is what stops the fixture drifting into
    // a gap so small the test would pass without any multiplier at all.
    expect(gap).toBeGreaterThan(WORLD_AWARD_LEAGUE_TITLE_BONUS);

    const champion = computeWorldAwards(players, SEASON, ctx({ championTidByCompId: { 0: 1 } }));
    expect(champion.goalkeeperOfYear!.find((e) => e.pid === 2)!.title).toBeGreaterThan(gap);
    expect(champion.goalkeeperOfYear![0].pid).toBe(2);
  });
});
