/**
 * A season split by club.
 *
 * `Player.stats` holds one row per season, and that row is the player's whole
 * season: awards, progression's minutes nudge, milestones and career totals all
 * read it, and all of them are right to. What it cannot say on its own is which
 * club each part of it was played for, so a player sold in January used to have
 * his entire season, goals scored against his new club included, credited to
 * the club he finished at.
 *
 * The answer is `SeasonStats.stints`: when a player turns out for a second club
 * in one season, the row gains a line per spell, each a full stat line of its
 * own. The row itself stays the season total with `tid` the latest club, so
 * nothing that wants the season has to change. Anything that wants ONE CLUB'S
 * share of it goes through {@link statsAtClub} or {@link clubLines}.
 *
 * Absent means he played for one club all season, which is every row written
 * before this existed. That is exact rather than a guess for a player who never
 * moved and, for one who did, is the old behaviour: the whole season at the
 * club he finished at. Nothing to migrate either way.
 */

import { emptySeasonStats, type Player, type SeasonStatLine, type SeasonStats } from "./types.js";
import type { PlayerMatchLine } from "../../engine/attribution.js";

/** The stat fields a match line adds to, in one place so a stint and the season total can't drift. */
export function addMatchLine(ss: SeasonStatLine, line: PlayerMatchLine): void {
  ss.appearances++;
  ss.goals += line.goals;
  ss.assists += line.assists;
  ss.shots += line.shots;
  ss.shotsOnTarget += line.shotsOnTarget;
  ss.xg += line.xg;
  ss.goalsAgainst += line.goalsAgainst;
  ss.xga += line.xga;
  ss.saves += line.saves;
  ss.tackles += line.tackles;
  ss.interceptions += line.interceptions;
  ss.passes += line.passes;
  ss.passesCompleted += line.passesCompleted;
  ss.crosses += line.crosses;
  ss.foulsCommitted += line.foulsCommitted;
  ss.yellowCards += line.yellowCards;
  ss.redCards += line.redCards;
  ss.minutesPlayed += line.minutesPlayed;
  ss.ratingSum += line.rating;
  ss.avgRating = ss.ratingSum / ss.appearances;
}

/** A season row without its breakdown: what a stint is, and what a single-club row already is. */
function lineOf(ss: SeasonStats): SeasonStatLine {
  const { stints: _stints, ...line } = ss;
  return { ...line };
}

/**
 * Point a season row at the club he is playing for now, opening a new spell
 * if that is a change of club. Mutates `ss`, whose `stints` array (if any) the
 * caller must already own — `simThrough` copies both before a sim.
 *
 * The first switch snapshots everything recorded so far as the first spell,
 * since until then the row itself was the only spell.
 */
export function moveSeasonRowTo(ss: SeasonStats, tid: number): void {
  if (ss.tid === tid) return;
  if (!ss.stints) ss.stints = [lineOf(ss)];
  ss.stints.push(emptySeasonStats(ss.season, tid));
  ss.tid = tid;
}

/** Credit one match to the season total and, when the season is split, to the current spell. */
export function addMatchToSeasonRow(ss: SeasonStats, line: PlayerMatchLine): void {
  addMatchLine(ss, line);
  const current = ss.stints?.[ss.stints.length - 1];
  if (current) addMatchLine(current, line);
}

/** Copy a season row deeply enough that it can be edited in place without touching the original. */
export function copySeasonRow(ss: SeasonStats): SeasonStats {
  return ss.stints ? { ...ss, stints: ss.stints.map((s) => ({ ...s })) } : { ...ss };
}

/** Sum several lines for one season into one. `tid` is the last line's. */
export function mergeLines(lines: SeasonStatLine[]): SeasonStatLine {
  const out = { ...emptySeasonStats(lines[0].season, lines[lines.length - 1].tid) };
  delete (out as SeasonStats).stints;
  for (const l of lines) {
    out.appearances += l.appearances;
    out.goals += l.goals;
    out.assists += l.assists;
    out.shots += l.shots;
    out.shotsOnTarget += l.shotsOnTarget;
    out.xg += l.xg;
    out.goalsAgainst += l.goalsAgainst;
    out.xga += l.xga;
    out.saves += l.saves;
    out.tackles += l.tackles;
    out.interceptions += l.interceptions;
    out.passes += l.passes;
    out.passesCompleted += l.passesCompleted;
    out.crosses += l.crosses;
    out.foulsCommitted += l.foulsCommitted;
    out.yellowCards += l.yellowCards;
    out.redCards += l.redCards;
    out.minutesPlayed += l.minutesPlayed;
    out.ratingSum += l.ratingSum;
  }
  out.avgRating = out.appearances > 0 ? out.ratingSum / out.appearances : 0;
  return out;
}

/**
 * A season as one line per club, in the order he played for them. A club he
 * left and came back to in the same season (a loan and its return) is one line.
 * A single-club season is just the row.
 */
export function clubLines(ss: SeasonStats): SeasonStatLine[] {
  if (!ss.stints || ss.stints.length === 0) return [lineOf(ss)];
  const order: number[] = [];
  const byTid = new Map<number, SeasonStatLine[]>();
  for (const s of ss.stints) {
    if (!byTid.has(s.tid)) {
      byTid.set(s.tid, []);
      order.push(s.tid);
    }
    byTid.get(s.tid)!.push(s);
  }
  return order.map((tid) => {
    const lines = byTid.get(tid)!;
    return lines.length === 1 ? { ...lines[0] } : mergeLines(lines);
  });
}

/** What a player did for one club in one season, or undefined if he never played for it that season. */
export function statsAtClub(p: Pick<Player, "stats">, season: number, tid: number): SeasonStatLine | undefined {
  const ss = p.stats.find((s) => s.season === season);
  if (!ss) return undefined;
  return clubLines(ss).find((l) => l.tid === tid);
}

/**
 * What a player did for any of a set of clubs in one season, summed — the line
 * a per-league board wants, since a move within one league keeps every goal in
 * it while a move between leagues splits them. Undefined if none of the clubs
 * had him that season. `tid` is the latest of those clubs.
 */
export function statsAtClubs(
  p: Pick<Player, "stats">,
  season: number,
  inScope: (tid: number) => boolean,
): SeasonStatLine | undefined {
  const ss = p.stats.find((s) => s.season === season);
  if (!ss) return undefined;
  const lines = clubLines(ss).filter((l) => inScope(l.tid));
  if (lines.length === 0) return undefined;
  return lines.length === 1 ? lines[0] : mergeLines(lines);
}
