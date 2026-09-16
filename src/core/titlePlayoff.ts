import type { StandingsRow } from "./standings.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { Player } from "./players/types.js";
import type { Competition } from "./competitions.js";
import type { TeamMatchData } from "./league/composites.js";
import type { CupTie, SeriesGame } from "./cup/types.js";
import { competitionTitlePlayoff, competitionConferences } from "./competitions.js";
import { conferenceMembers, type ConferenceTeam } from "./conferences.js";
import { playFirstLeg, resolveTwoLeggedTie, resolveCupTie } from "./cup/simCup.js";
import { playoffMatchData } from "./playoffMatchData.js";
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
 * **Played a round at a time.** A bracket is drawn when the season ends
 * (`drawTitlePlayoffs`) and each call to `playTitlePlayoffRound` plays its next
 * round — the game stages those rounds as separate sim blocks (see
 * playoffStages.ts). Every tie draws its own stream off
 * (lid, season, competition, round, tie index), never the shared `rng`, so a
 * round played on its own click is the same round `playTitlePlayoff` plays in a
 * single pass, and adding this cannot move a single league scoreline. Box scores
 * are never kept; the offseason copies the finished bracket onto the season's
 * history.
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
   * Every tie played so far, in round order (see `titlePlayoffRoundNames` for
   * what each round index is called) and bracket order within a round — a
   * round's ties pair off two by two into the next. Two-legged ties carry both
   * legs, best-of-three series carry each game. `boxScore` is always null.
   * Empty on a bracket drawn but not yet played.
   */
  ties: CupTie[];
  /** The champion, or null while the final is still to play. */
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

/** How many rounds a format's bracket has. */
export function titlePlayoffRoundCount(format: PlayedTitlePlayoffFormat): number {
  return titlePlayoffRoundNames(format).length;
}

/** Rounds played so far. A round's ties are appended together, so this is one past the highest on record. */
function roundsPlayed(playoff: TitlePlayoff): number {
  let n = 0;
  for (const t of playoff.ties) n = Math.max(n, t.round + 1);
  return n;
}

/** Rounds still to play; 0 once there is a champion. */
export function titlePlayoffRoundsLeft(playoff: TitlePlayoff): number {
  if (playoff.winnerTid !== null) return 0;
  return Math.max(0, titlePlayoffRoundCount(playoff.format) - roundsPlayed(playoff));
}

/** What the next round is called, or null once the playoff is decided. */
export function titlePlayoffNextRoundName(playoff: TitlePlayoff): string | null {
  if (titlePlayoffRoundsLeft(playoff) === 0) return null;
  return titlePlayoffRoundNames(playoff.format)[roundsPlayed(playoff)] ?? null;
}

/**
 * The clubs that play in the next round. Round one of MLS's playoff is the
 * seven seeds the wild card skipped plus its two winners; every other round
 * after the first is whoever won the round before.
 */
export function titlePlayoffNextEntrants(playoff: TitlePlayoff): Set<number> {
  if (titlePlayoffRoundsLeft(playoff) === 0) return new Set();
  const round = roundsPlayed(playoff);
  const previousWinners = playoff.ties.filter((t) => t.round === round - 1).map((t) => t.winner);
  if (playoff.format === "conference" && playoff.conferences) {
    const halves = playoff.conferences;
    if (round === 0) return new Set(halves.flatMap((c) => [c[7], c[8]]));
    if (round === 1) return new Set([...halves.flatMap((c) => c.slice(0, 7)), ...previousWinners]);
  }
  return new Set(round === 0 ? playoff.teams : previousWinners);
}

/** A title playoff drawn from its field, with nothing played. */
export function drawTitlePlayoff(field: TitlePlayoffField, season: number): TitlePlayoff {
  return {
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
}

/** Every title playoff the season's tables seat, drawn and unplayed. */
export function drawTitlePlayoffs(
  competitions: Competition[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  teams: readonly ConferenceTeam[],
  season: number,
): TitlePlayoff[] {
  return titlePlayoffFields(competitions, tablesByCompId, teams).map((f) => drawTitlePlayoff(f, season));
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

/**
 * Play the next round of one title playoff on prepared match data, returning
 * the playoff with that round's ties appended (and its champion, if the round
 * was the final). A no-op once there is a champion.
 *
 * Tie indices count up within the round in the same order the single-pass
 * bracket always played them, which is what keeps each tie on the same seeded
 * stream however the rounds are split up.
 */
export function playTitlePlayoffRound(
  playoff: TitlePlayoff,
  matchData: Map<number, TeamMatchData>,
  lid: number,
): TitlePlayoff {
  if (titlePlayoffRoundsLeft(playoff) === 0) return playoff;
  // A club that cannot be fielded (left the division between the table and
  // here — unreachable in a real save) would leave a tie undecided, so the
  // table's champion keeps the title instead.
  if (!playoff.teams.every((tid) => matchData.has(tid))) {
    return { ...playoff, winnerTid: playoff.teams[0] };
  }

  const season = playoff.season;
  const round = roundsPlayed(playoff);
  const lastRound = titlePlayoffRoundCount(playoff.format) - 1;
  // Better = higher in the OVERALL table. Within one half that is the same as
  // the half's own seeding, and between the halves it is what decides who hosts
  // MLS's final.
  const rank = new Map(playoff.teams.map((tid, i) => [tid, i]));
  const better = (a: number, b: number): [number, number] =>
    (rank.get(a)! <= rank.get(b)! ? [a, b] : [b, a]);
  const md = (tid: number) => matchData.get(tid)!;
  const previous = playoff.ties.filter((t) => t.round === round - 1).map((t) => t.winner);
  const pairUp = (winners: number[]): [number, number][] =>
    Array.from({ length: winners.length / 2 }, (_, i) => [winners[2 * i], winners[2 * i + 1]]);

  const ties: CupTie[] = [];
  let index = 0;

  /** A one-off game at the better club's ground (or neutral), extra time optional. */
  const single = (a: number, b: number, opts: { extraTime: boolean; neutral?: boolean }): void => {
    const [high, low] = better(a, b);
    const rng = tieRng(lid, season, playoff.compId, round, index++);
    ties.push({
      ...resolveCupTie(rng, high, low, md(high), md(low), round, 0, opts.neutral ?? false, opts.extraTime),
      boxScore: null,
    });
  };

  /**
   * MLS's best-of-three: game one and a decider at the better club's ground,
   * game two at the other's, every level game straight to penalties.
   */
  const series = (a: number, b: number): void => {
    const [high, low] = better(a, b);
    const rng = tieRng(lid, season, playoff.compId, round, index++);
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
    ties.push({
      round, matchday: 0, home: high, away: low, homeGoals: highWins, awayGoals: lowWins,
      wentToExtraTime: false, wentToPens: false, homePens: 0, awayPens: 0,
      winner: highWins > lowWins ? high : low, boxScore: null, series: games,
    });
  };

  if (playoff.format === "conference") {
    const halves = playoff.conferences!;
    if (round === 0) {
      // Wild card: 8th v 9th in each conference, straight to penalties.
      halves.forEach((c) => single(c[7], c[8], { extraTime: false }));
    } else if (round === 1) {
      // Round one, best of three: 1 v wild card and 4 v 5 in one half of the
      // bracket, 2 v 7 and 3 v 6 in the other.
      halves.forEach((c, ci) => {
        series(c[0], previous[ci]);
        series(c[3], c[4]);
        series(c[1], c[6]);
        series(c[2], c[5]);
      });
    } else {
      // Conference semi-finals and finals pair each conference's winners, first
      // conference first; the final pairs the two conference champions.
      pairUp(previous).forEach(([a, b]) => single(a, b, { extraTime: true }));
    }
  } else if (playoff.format === "zones") {
    if (round === 0) {
      const [zoneA, zoneB] = playoff.conferences!;
      const interleaved = zoneA.flatMap((tid, i) => [tid, zoneB[i]]);
      ZONE_ROUND_OF_16_PAIRS.forEach(([x, y]) =>
        single(interleaved[x], interleaved[y], { extraTime: false }));
    } else if (round < lastRound) {
      pairUp(previous).forEach(([a, b]) => single(a, b, { extraTime: false }));
    } else {
      single(previous[0], previous[1], { extraTime: true, neutral: true });
    }
  } else {
    const format = playoff.format;
    const pairs: [number, number][] = round === 0
      ? TITLE_PLAYOFF_QF_PAIRS.map(([a, b]) => [playoff.teams[a], playoff.teams[b]])
      : pairUp(previous);
    pairs.forEach(([a, b]) => {
      const [high, low] = better(a, b);
      ties.push(playTie(format, high, low, matchData, lid, season, playoff.compId, round, index++));
    });
  }

  return {
    ...playoff,
    ties: [...playoff.ties, ...ties],
    winnerTid: round === lastRound ? ties[ties.length - 1].winner : null,
  };
}

/** Play one title playoff start to finish on prepared match data. Pure apart from its own seeded streams. */
export function playTitlePlayoff(
  field: TitlePlayoffField,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  season: number,
): TitlePlayoff {
  let playoff = drawTitlePlayoff(field, season);
  for (let guard = 0; titlePlayoffRoundsLeft(playoff) > 0 && guard < 8; guard++) {
    playoff = playTitlePlayoffRound(playoff, matchData, lid);
  }
  return playoff;
}

/**
 * The match data a title playoff is played on: its own competition's clubs,
 * which is right for the reason it is right for an English promotion bracket —
 * every entrant comes from that one division, so normalizing against it is
 * measuring them against each other.
 */
export function titlePlayoffMatchData(
  playoff: { compId: number; season: number },
  teams: readonly StoredTeam[],
  players: Player[],
  lid: number,
): Map<number, TeamMatchData> {
  return playoffMatchData(teams, players, new Set([playoff.compId]), lid, playoff.season);
}

/** Play every round the given title playoffs have left. Decided ones come back untouched. */
export function completeTitlePlayoffs(
  playoffs: TitlePlayoff[],
  teams: readonly StoredTeam[],
  players: Player[],
  lid: number,
): TitlePlayoff[] {
  return playoffs.map((p) => {
    if (titlePlayoffRoundsLeft(p) === 0) return p;
    const matchData = titlePlayoffMatchData(p, teams, players, lid);
    let playoff = p;
    for (let guard = 0; titlePlayoffRoundsLeft(playoff) > 0 && guard < 8; guard++) {
      playoff = playTitlePlayoffRound(playoff, matchData, lid);
    }
    return playoff;
  });
}

/** Play every title playoff for the season that just finished, start to finish. */
export function playTitlePlayoffs(
  competitions: Competition[],
  teams: StoredTeam[],
  players: Player[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  lid: number,
  season: number,
): TitlePlayoff[] {
  return completeTitlePlayoffs(drawTitlePlayoffs(competitions, tablesByCompId, teams, season), teams, players, lid);
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
