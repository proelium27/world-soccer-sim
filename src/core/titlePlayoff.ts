import type { StandingsRow } from "./standings.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { Player } from "./players/types.js";
import type { Competition } from "./competitions.js";
import type { TeamMatchData } from "./league/composites.js";
import type { CupTie, SeriesGame } from "./cup/types.js";
import { competitionTitlePlayoff, competitionConferences } from "./competitions.js";
import { conferenceMembers, type ConferenceTeam } from "./conferences.js";
import { leagueMatchData } from "./league/composites.js";
import { playFirstLeg, resolveTwoLeggedTie, resolveCupTie } from "./cup/simCup.js";
import { teamSeasonFormDelta, applySeasonForm } from "./teamSeasonForm.js";
import { mulberry32, hashInts } from "../engine/rng.js";
import {
  TITLE_PLAYOFF_TEAMS, CONFERENCE_PLAYOFF_TEAMS, ZONE_PLAYOFF_TEAMS,
} from "./constants.js";

/* ── Title playoffs ──────────────────────────────────────────────────────────
 *
 * Some leagues do not crown whoever tops the table. MLS plays MLS Cup, Mexico
 * plays the Liguilla, Argentina closes each tournament with a knockout. This is
 * that: after the last matchday the league's best clubs play a seeded bracket
 * and the winner is the season's champion.
 *
 * Four shapes (see TitlePlayoffFormat): a top-eight bracket over single games
 * or two legs, MLS's per-conference playoff and Argentina's cross-zone round of
 * sixteen.
 *
 * Everything else still reads the regular-season TABLE — prize money, hype,
 * continental places, relegation, the board's expectations — which is also how
 * the real leagues with playoffs work (topping MLS's table is a trophy of its
 * own and a Champions Cup place). What moves is exactly one fact: whose name
 * goes on `SeasonHistoryEntry.championTidByCompId`. Every honours surface reads
 * that record, so the title follows it without anything else knowing playoffs
 * exist.
 *
 * Shaped exactly like the promotion playoff, which is the precedent for all of
 * it: played at the season boundary in `simThrough` on end-of-season squads,
 * replayed by `simOffseason` for any caller that never came through there, held
 * on `LeagueStore.titlePlayoffs` only until the offseason copies it onto the
 * season's history, and never storing a box score. Every tie draws its own
 * stream off the league's content, never the shared `rng`, so adding this
 * cannot move a single league scoreline and both paths land on one result.
 * ──────────────────────────────────────────────────────────────────────── */

/** rng-stream tag, clear of every other competition's (see promotionPlayoff.ts for the list). */
export const TITLE_PLAYOFF_STREAM = 0x7171;

/** Round indices within `TitlePlayoff.ties` for the eight-club formats. */
export const TITLE_ROUND_QF = 0;
export const TITLE_ROUND_SF = 1;
export const TITLE_ROUND_FINAL = 2;

export type PlayedTitlePlayoffFormat = "single" | "two-legged" | "conference" | "zones";

/** One top flight's title playoff for one season. */
export interface TitlePlayoff {
  /** The season just finished — whose table seeded it and whose title it decides. */
  season: number;
  country: string;
  compId: number;
  format: PlayedTitlePlayoffFormat;
  /** The entrants in overall-table order, best first. */
  teams: number[];
  /**
   * The split formats only: each half's entrants in seed order, and the halves'
   * names. Absent on the eight-club formats.
   */
  conferences?: [number[], number[]];
  conferenceNames?: [string, string];
  /**
   * Every tie, in round order (see `titlePlayoffRoundNames` for what each round
   * index is called) and bracket order within a round. Two-legged ties carry
   * both legs, best-of-three series carry each game. `boxScore` is always null.
   */
  ties: CupTie[];
  /** The champion, or null while unplayed. */
  winnerTid: number | null;
}

/** Who plays in a top flight's title playoff, before a ball is kicked. */
export interface TitlePlayoffField {
  country: string;
  compId: number;
  format: PlayedTitlePlayoffFormat;
  teams: number[];
  conferences?: [number[], number[]];
  conferenceNames?: [string, string];
}

/** What each round of a format is called, by round index. The last is the final. */
export function titlePlayoffRoundNames(format: PlayedTitlePlayoffFormat): string[] {
  if (format === "conference") {
    return ["Wild card", "Round one", "Conference semi-finals", "Conference finals", "Final"];
  }
  if (format === "zones") return ["Round of 16", "Quarter-finals", "Semi-finals", "Final"];
  return ["Quarter-finals", "Semi-finals", "Final"];
}

/**
 * Every title playoff the season's tables seat.
 *
 * `teams` is only needed for the split formats, to know which half each club
 * plays in; without it a club is seated by `conferenceMembers`' tid-order rule,
 * which is the answer for any club that has never been given a half.
 *
 * A league too short to seat the full bracket holds none and keeps the table's
 * champion — a smaller bracket would change what finishing high is worth, which
 * is a different competition rather than the same one trimmed.
 */
export function titlePlayoffFields(
  competitions: Competition[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  teams?: readonly ConferenceTeam[],
): TitlePlayoffField[] {
  const out: TitlePlayoffField[] = [];
  for (const comp of competitions) {
    const format = competitionTitlePlayoff(comp);
    if (format === "none") continue;
    const table = tablesByCompId.get(comp.id);
    if (!table) continue;

    if (format === "conference" || format === "zones") {
      const split = competitionConferences(comp)!;
      const halves = conferenceMembers(
        teams ?? table.map((r) => ({ tid: r.tid, compId: comp.id })),
        comp,
      );
      if (!halves) continue;
      const perHalf = format === "conference" ? CONFERENCE_PLAYOFF_TEAMS : ZONE_PLAYOFF_TEAMS;
      const seeded = halves.map((half) => {
        const inHalf = new Set(half);
        return table.filter((r) => inHalf.has(r.tid)).slice(0, perHalf).map((r) => r.tid);
      }) as [number[], number[]];
      if (seeded[0].length < perHalf || seeded[1].length < perHalf) continue;
      const entered = new Set([...seeded[0], ...seeded[1]]);
      out.push({
        country: comp.country,
        compId: comp.id,
        format,
        teams: table.filter((r) => entered.has(r.tid)).map((r) => r.tid),
        conferences: seeded,
        conferenceNames: [split.names[0], split.names[1]],
      });
      continue;
    }

    if (table.length < TITLE_PLAYOFF_TEAMS) continue;
    out.push({
      country: comp.country,
      compId: comp.id,
      format,
      teams: table.slice(0, TITLE_PLAYOFF_TEAMS).map((r) => r.tid),
    });
  }
  return out;
}

/**
 * The quarter-final pairings, as seed indices into `teams`: 1v8 and 4v5 in the
 * top half, 2v7 and 3v6 in the bottom. The halves are what keep the top two
 * seeds apart until the final, the way every seeded bracket is drawn.
 */
export const TITLE_PLAYOFF_QF_PAIRS: readonly (readonly [number, number])[] = [
  [0, 7], [3, 4], [1, 6], [2, 5],
];

/**
 * Argentina's round of 16, as indices into the zones interleaved A1, B1, A2,
 * B2 … A8, B8. Every pairing is 1st in one zone against 8th in the other, 2nd
 * against 7th and so on (an even index always meets an odd one), and in bracket
 * order the two zone winners are in opposite halves, so they can only meet in
 * the final.
 */
export const ZONE_ROUND_OF_16_PAIRS: readonly (readonly [number, number])[] = [
  [0, 15], [7, 8], [4, 11], [3, 12], [2, 13], [5, 10], [6, 9], [1, 14],
];

function tieRng(lid: number, season: number, compId: number, round: number, tie: number) {
  return mulberry32(hashInts(lid, season, compId, round, tie, TITLE_PLAYOFF_STREAM));
}

/**
 * Play one tie of the eight-club formats. The better seed is `high`.
 *
 * Single-leg: the better seed hosts, and a level game goes to extra time and
 * penalties.
 *
 * Two-legged is the Liguilla, rule for rule: the lower seed hosts the first leg
 * and the better seed the second, and in the quarter-finals and semi-finals a
 * tie level on aggregate goes straight to the better-placed club — no extra
 * time, no penalties, no away goals. Only the final goes to extra time and
 * penalties, and there table position no longer counts. That is why the regular
 * season matters so much in Mexico: finishing higher is a real tiebreaker, not
 * just a home second leg.
 */
function playTie(
  format: "single" | "two-legged",
  high: number,
  low: number,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  season: number,
  compId: number,
  round: number,
  index: number,
): CupTie {
  const rng = tieRng(lid, season, compId, round, index);
  if (format === "two-legged") {
    const leg1 = playFirstLeg(rng, low, high, matchData.get(low)!, matchData.get(high)!, round);
    // The better seed takes a level tie everywhere but the final.
    const levelGoesTo = round === TITLE_ROUND_FINAL ? undefined : high;
    return {
      ...resolveTwoLeggedTie(rng, leg1, matchData.get(low)!, matchData.get(high)!, 0, levelGoesTo),
      boxScore: null,
    };
  }
  return {
    ...resolveCupTie(rng, high, low, matchData.get(high)!, matchData.get(low)!, round, 0),
    boxScore: null,
  };
}

/** Play one title playoff on prepared match data. Pure apart from its own seeded streams. */
export function playTitlePlayoff(
  field: TitlePlayoffField,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  season: number,
): TitlePlayoff {
  const base: TitlePlayoff = {
    season,
    country: field.country,
    compId: field.compId,
    format: field.format,
    teams: field.teams,
    ...(field.conferences ? { conferences: field.conferences } : {}),
    ...(field.conferenceNames ? { conferenceNames: field.conferenceNames } : {}),
    ties: [],
    winnerTid: null,
  };
  // A club that cannot be fielded (left the division between the table and
  // here — unreachable in a real save) would leave a tie undecided, so the
  // table's champion keeps the title instead.
  if (!field.teams.every((tid) => matchData.has(tid))) {
    return { ...base, winnerTid: field.teams[0] };
  }

  // Better = higher in the OVERALL table. Within one half that is the same as
  // the half's own seeding, and between the halves it is what decides who hosts
  // MLS's final.
  const rank = new Map(field.teams.map((tid, i) => [tid, i]));
  const better = (a: number, b: number): [number, number] =>
    (rank.get(a)! <= rank.get(b)! ? [a, b] : [b, a]);
  const md = (tid: number) => matchData.get(tid)!;

  const ties: CupTie[] = [];
  const counters = new Map<number, number>();
  const nextIndex = (round: number) => {
    const i = counters.get(round) ?? 0;
    counters.set(round, i + 1);
    return i;
  };

  /** A one-off game at the better club's ground (or neutral), extra time optional. */
  const single = (a: number, b: number, round: number, opts: { extraTime: boolean; neutral?: boolean }): number => {
    const [high, low] = better(a, b);
    const rng = tieRng(lid, season, field.compId, round, nextIndex(round));
    const tie: CupTie = {
      ...resolveCupTie(rng, high, low, md(high), md(low), round, 0, opts.neutral ?? false, opts.extraTime),
      boxScore: null,
    };
    ties.push(tie);
    return tie.winner;
  };

  /**
   * MLS's best-of-three: game one and a decider at the better club's ground,
   * game two at the other's, every level game straight to penalties.
   */
  const series = (a: number, b: number, round: number): number => {
    const [high, low] = better(a, b);
    const rng = tieRng(lid, season, field.compId, round, nextIndex(round));
    const games: SeriesGame[] = [];
    let highWins = 0;
    let lowWins = 0;
    while (highWins < 2 && lowWins < 2) {
      const host = games.length === 1 ? low : high;
      const guest = host === high ? low : high;
      const g = resolveCupTie(rng, host, guest, md(host), md(guest), round, 0, false, false);
      const hostIsHigh = host === high;
      games.push({
        at: host,
        homeGoals: hostIsHigh ? g.homeGoals : g.awayGoals,
        awayGoals: hostIsHigh ? g.awayGoals : g.homeGoals,
        ...(g.wentToPens
          ? {
            homePens: hostIsHigh ? g.homePens : g.awayPens,
            awayPens: hostIsHigh ? g.awayPens : g.homePens,
          }
          : {}),
      });
      if (g.winner === high) highWins++;
      else lowWins++;
    }
    const winner = highWins > lowWins ? high : low;
    ties.push({
      round, matchday: 0, home: high, away: low, homeGoals: highWins, awayGoals: lowWins,
      wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0,
      winner, boxScore: null, series: games,
    });
    return winner;
  };

  const pairUp = (winners: number[]): [number, number][] =>
    Array.from({ length: winners.length / 2 }, (_, i) => [winners[2 * i], winners[2 * i + 1]]);

  if (field.format === "conference") {
    const halves = field.conferences!;
    // Wild card: 8th v 9th in each conference, straight to penalties.
    const wildCard = halves.map((c) => single(c[7], c[8], 0, { extraTime: false }));
    // Round one, best of three: 1 v wild card and 4 v 5 in one half of the
    // bracket, 2 v 7 and 3 v 6 in the other.
    const roundOne = halves.map((c, ci) => [
      series(c[0], wildCard[ci], 1),
      series(c[3], c[4], 1),
      series(c[1], c[6], 1),
      series(c[2], c[5], 1),
    ]);
    const semis = roundOne.map((w) => pairUp(w).map(([a, b]) => single(a, b, 2, { extraTime: true })));
    const finals = semis.map(([a, b]) => single(a, b, 3, { extraTime: true }));
    const champion = single(finals[0], finals[1], 4, { extraTime: true });
    return { ...base, ties, winnerTid: champion };
  }

  if (field.format === "zones") {
    const [zoneA, zoneB] = field.conferences!;
    const interleaved = zoneA.flatMap((tid, i) => [tid, zoneB[i]]);
    let winners = ZONE_ROUND_OF_16_PAIRS.map(([x, y]) =>
      single(interleaved[x], interleaved[y], 0, { extraTime: false }));
    for (let round = 1; round <= 2; round++) {
      winners = pairUp(winners).map(([a, b]) => single(a, b, round, { extraTime: false }));
    }
    const champion = single(winners[0], winners[1], 3, { extraTime: true, neutral: true });
    return { ...base, ties, winnerTid: champion };
  }

  const format = field.format;
  const playRound = (pairs: [number, number][], round: number): number[] =>
    pairs.map(([a, b], i) => {
      const [high, low] = better(a, b);
      const tie = playTie(format, high, low, matchData, lid, season, field.compId, round, i);
      ties.push(tie);
      return tie.winner;
    });

  const qfWinners = playRound(
    TITLE_PLAYOFF_QF_PAIRS.map(([a, b]) => [field.teams[a], field.teams[b]]),
    TITLE_ROUND_QF,
  );
  const sfWinners = playRound(
    [[qfWinners[0], qfWinners[1]], [qfWinners[2], qfWinners[3]]],
    TITLE_ROUND_SF,
  );
  const [champion] = playRound([[sfWinners[0], sfWinners[1]]], TITLE_ROUND_FINAL);
  return { ...base, ties, winnerTid: champion };
}

/**
 * Play every title playoff for the season that just finished.
 *
 * The pool is the competition's own clubs, which is right for the reason it is
 * right for an English promotion bracket: every entrant comes from that one
 * division, so normalizing against it is measuring them against each other.
 * Season form applies (this is the season's last act); injuries are honoured by
 * `leagueMatchData`; suspensions are not carried in, the same call every cup
 * makes.
 */
export function playTitlePlayoffs(
  competitions: Competition[],
  teams: StoredTeam[],
  players: Player[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  lid: number,
  season: number,
): TitlePlayoff[] {
  const fields = titlePlayoffFields(competitions, tablesByCompId, teams);
  return fields.map((field) => {
    const poolTeams = teams.filter((t) => t.compId === field.compId);
    const data = leagueMatchData({
      teams: poolTeams.map((t) => ({
        tid: t.tid,
        name: t.name,
        roster: t.roster,
        avgOvr: 0,
        academyBase: t.academyBase,
        compId: t.compId,
        starters: t.starters,
        formation: t.formation,
        moreMinutes: t.moreMinutes,
      })),
      players,
    });
    const matchData = new Map<number, TeamMatchData>();
    poolTeams.forEach((t, i) => {
      const delta = teamSeasonFormDelta(lid, season, t.tid);
      const d = data[i];
      matchData.set(t.tid, delta === 0 ? d : {
        ...d,
        composites: applySeasonForm(d.composites, delta),
        recompute: (onPitch) => applySeasonForm(d.recompute(onPitch), delta),
      });
    });
    return playTitlePlayoff(field, matchData, lid, season);
  });
}

/** The title playoffs held for `season`, or [] if none were. */
export function titlePlayoffsForSeason(
  playoffs: TitlePlayoff[] | undefined,
  season: number,
): TitlePlayoff[] {
  return (playoffs ?? []).filter((p) => p.season === season);
}

/** Each decided title playoff's champion, keyed by compId. */
export function titleChampions(playoffs: readonly TitlePlayoff[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of playoffs) if (p.winnerTid !== null) out.set(p.compId, p.winnerTid);
  return out;
}
