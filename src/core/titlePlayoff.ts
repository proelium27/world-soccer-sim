import type { StandingsRow } from "./standings.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { Player } from "./players/types.js";
import type { Competition } from "./competitions.js";
import type { TeamMatchData } from "./league/composites.js";
import type { CupTie } from "./cup/types.js";
import { competitionTitlePlayoff } from "./competitions.js";
import { leagueMatchData } from "./league/composites.js";
import { playFirstLeg, resolveTwoLeggedTie, resolveCupTie } from "./cup/simCup.js";
import { teamSeasonFormDelta, applySeasonForm } from "./teamSeasonForm.js";
import { mulberry32, hashInts } from "../engine/rng.js";
import { TITLE_PLAYOFF_TEAMS } from "./constants.js";

/* ── Title playoffs ──────────────────────────────────────────────────────────
 *
 * Some leagues do not crown whoever tops the table. MLS plays MLS Cup, Mexico
 * plays the Liguilla, Argentina closes each tournament with a knockout. This is
 * that: the top TITLE_PLAYOFF_TEAMS of a top flight play a seeded bracket after
 * the last matchday and the winner is the season's champion.
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

/** Round indices within `TitlePlayoff.ties`. */
export const TITLE_ROUND_QF = 0;
export const TITLE_ROUND_SF = 1;
export const TITLE_ROUND_FINAL = 2;

export type PlayedTitlePlayoffFormat = "single" | "two-legged";

/** One top flight's title playoff for one season. */
export interface TitlePlayoff {
  /** The season just finished — whose table seeded it and whose title it decides. */
  season: number;
  country: string;
  compId: number;
  format: PlayedTitlePlayoffFormat;
  /** The entrants in seed order: the regular-season table's top clubs, best first. */
  teams: number[];
  /**
   * Quarter-finals (round 0), semi-finals (1), final (2), in bracket order within
   * each round. Two-legged ties carry both legs' aggregate the way a Continental
   * Cup tie does. `boxScore` is always null.
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
}

/**
 * Every title playoff the season's tables seat.
 *
 * A league too short to seat the full bracket holds none and keeps the table's
 * champion — a smaller bracket would change what finishing high is worth, which
 * is a different competition rather than the same one trimmed.
 */
export function titlePlayoffFields(
  competitions: Competition[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
): TitlePlayoffField[] {
  const out: TitlePlayoffField[] = [];
  for (const comp of competitions) {
    const format = competitionTitlePlayoff(comp);
    if (format === "none") continue;
    const table = tablesByCompId.get(comp.id);
    if (!table || table.length < TITLE_PLAYOFF_TEAMS) continue;
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

function tieRng(lid: number, season: number, compId: number, round: number, tie: number) {
  return mulberry32(hashInts(lid, season, compId, round, tie, TITLE_PLAYOFF_STREAM));
}

/**
 * Play one tie between two seeds. The better seed is `high`.
 *
 * Single-leg: the better seed hosts, which is what finishing higher buys you in
 * MLS and Argentina. Two-legged: the lower seed hosts the first leg and the
 * better seed the second, as the Liguilla does. Level ties go to extra time and
 * penalties either way — the Liguilla's own rule sends a level tie to the better
 * seed, which is deliberately not modelled so the two formats share one
 * resolver with the cups.
 */
function playTie(
  format: PlayedTitlePlayoffFormat,
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
    return { ...resolveTwoLeggedTie(rng, leg1, matchData.get(low)!, matchData.get(high)!, 0), boxScore: null };
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
    ties: [],
    winnerTid: null,
  };
  // A club that cannot be fielded (left the division between the table and
  // here — unreachable in a real save) would leave a tie undecided, so the
  // table's champion keeps the title instead.
  if (!field.teams.every((tid) => matchData.has(tid))) {
    return { ...base, winnerTid: field.teams[0] };
  }

  const seedOf = new Map(field.teams.map((tid, i) => [tid, i]));
  const better = (a: number, b: number): [number, number] =>
    (seedOf.get(a)! <= seedOf.get(b)! ? [a, b] : [b, a]);

  const ties: CupTie[] = [];
  const playRound = (pairs: [number, number][], round: number): number[] =>
    pairs.map(([a, b], i) => {
      const [high, low] = better(a, b);
      const tie = playTie(field.format, high, low, matchData, lid, season, field.compId, round, i);
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
  const fields = titlePlayoffFields(competitions, tablesByCompId);
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
