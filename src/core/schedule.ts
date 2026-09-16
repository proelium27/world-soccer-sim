import type { Competition } from "./competitions.js";
import {
  competitionConferences, competitionSeasonFormat, seasonFormatRounds, roundToMatchday,
  competitionSplit, competitionTeamCount,
} from "./competitions.js";
import { conferenceMembers, type ConferenceTeam } from "./conferences.js";
import { SEASON_MATCHDAYS } from "./calendar.js";
import type { MatchScore } from "./standings.js";
import { computeStandings } from "./standings.js";

/** Flat fixture kept for backward compatibility with existing tests and season.ts. */
export interface Fixture {
  home: number; // tid
  away: number; // tid
}

/** Matchday-aware fixture produced by the new scheduler. */
export interface ScheduleGame {
  matchday: number; // 1–38
  home: number; // tid
  away: number; // tid
}

/**
 * Double round-robin: every distinct ordered pair of team ids plays once, so
 * each pair meets twice (home and away). Order within the list is deterministic.
 *
 * @deprecated Use {@link generateSchedule} for matchday-grouped fixtures.
 */
export function doubleRoundRobin(teamIds: number[]): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const home of teamIds)
    for (const away of teamIds)
      if (home !== away) fixtures.push({ home, away });
  return fixtures;
}

/**
 * Generate a full double round-robin schedule with matchday grouping using the
 * circle method (polygon scheduling algorithm).
 *
 * For n teams (must be even):
 *   - Fix team 0 in position 0; rotate the rest through positions 1..(n-1).
 *   - Each round: pair pos 0 vs pos n-1, pos 1 vs pos n-2, etc.
 *   - Alternate home/away per round so no team always hosts or always visits.
 *   - Second half mirrors the first half with home/away reversed.
 *
 * Result: n-1 rounds per half * 2 halves = 2*(n-1) matchdays, n/2 games each.
 * For 20 teams: 38 matchdays, 10 games per matchday, 380 games total.
 */
export function generateSchedule(teamIds: number[]): ScheduleGame[] {
  const n = teamIds.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(
      `generateSchedule requires an even number of teams >= 2, got ${n}`,
    );
  }

  const roundsPerHalf = n - 1;
  const gamesPerRound = n / 2;

  // Build the rotating array: fix teamIds[0] at position 0, rotate the rest.
  const fixed = teamIds[0];
  const rotating = teamIds.slice(1); // length = n - 1

  const schedule: ScheduleGame[] = [];

  for (let half = 0; half < 2; half++) {
    // Take a fresh copy of the rotating array for each half so the second
    // half mirrors the first.
    const rot = [...rotating];

    for (let round = 0; round < roundsPerHalf; round++) {
      const matchday = half * roundsPerHalf + round + 1; // 1-indexed

      // Build the current round's positions: [fixed, rot[0], rot[1], ..., rot[n-2]]
      const positions = [fixed, ...rot];

      for (let i = 0; i < gamesPerRound; i++) {
        const teamA = positions[i];
        const teamB = positions[n - 1 - i];

        let home: number;
        let away: number;

        if (half === 0) {
          // First half: alternate home/away by round parity so no team is
          // always home or always away when seated in position 0.
          if (round % 2 === 0) {
            home = teamA;
            away = teamB;
          } else {
            home = teamB;
            away = teamA;
          }
        } else {
          // Second half: reverse home/away relative to the corresponding
          // first-half round.
          if (round % 2 === 0) {
            home = teamB;
            away = teamA;
          } else {
            home = teamA;
            away = teamB;
          }
        }

        schedule.push({ matchday, home, away });
      }

      // Rotate: move last element to front of the rotating array.
      rot.unshift(rot.pop()!);
    }
  }

  return schedule;
}

/** Stand-in for "no opponent" when a conference has an odd number of clubs. */
const BYE = -1;

/**
 * Every club meets every other `legs` times, one round per `matchday` (1-based,
 * before any spreading across the season grid).
 *
 * An odd field takes a bye each round: a stand-in club is added and its games
 * dropped, so a division of 17 plays 34 rounds and each club sits out two.
 *
 * Legs alternate the two halves of the circle-method double round robin, so an
 * even number of legs gives every club the same home games and an odd number
 * leaves each within one of level. **A double round robin of an even field is
 * exactly `generateSchedule`**, which is what keeps every existing division's
 * fixtures byte-identical.
 */
export function roundRobin(teamIds: number[], legs: number): ScheduleGame[] {
  if (teamIds.length < 2) return [];
  const odd = teamIds.length % 2 === 1;
  const base = generateSchedule(odd ? [...teamIds, BYE] : teamIds);
  if (legs === 2) return base.filter((g) => g.home !== BYE && g.away !== BYE);
  const perLeg = (odd ? teamIds.length + 1 : teamIds.length) - 1;
  const out: ScheduleGame[] = [];
  for (let leg = 0; leg < legs; leg++) {
    const half = leg % 2;
    for (const g of base) {
      if (g.home === BYE || g.away === BYE) continue;
      const inHalf = half === 0 ? g.matchday <= perLeg : g.matchday > perLeg;
      if (!inHalf) continue;
      const round = half === 0 ? g.matchday : g.matchday - perLeg;
      out.push({ matchday: leg * perLeg + round, home: g.home, away: g.away });
    }
  }
  return out;
}

/**
 * Two halves of different sizes (an odd division split in two, like the USL
 * Championship's 13 and 12): each plays its own half twice, and the shorter
 * half's rounds are spread across the longer half's so both finish together.
 * No cross-half games — there is no way to pair unequal halves off round by
 * round without some clubs playing more than others.
 */
function unequalConferenceSchedule(halves: [number[], number[]]): ScheduleGame[] {
  const [a, b] = [roundRobin(halves[0], 2), roundRobin(halves[1], 2)];
  const rounds = (games: ScheduleGame[]) => Math.max(0, ...games.map((g) => g.matchday));
  const total = Math.max(rounds(a), rounds(b));
  const stretch = (games: ScheduleGame[]) => {
    const r = rounds(games);
    return r === total ? games : games.map((g) => ({ ...g, matchday: Math.round((g.matchday * total) / r) }));
  };
  return [...stretch(a), ...stretch(b)];
}

/**
 * A split division's season (see ConferenceFormat): every club plays its own
 * half twice, and games across the divide on top.
 *
 * With an odd half, the circle method leaves one club over every round. The two
 * halves are built from identical positional schedules, so the club left over
 * in one half sits at the same index as the one left over in the other — and
 * pairing them hands every club a home-and-away RIVAL across the divide (the
 * first meeting in the first half of the season, the return in the second) at
 * no cost to the calendar.
 *
 * `crossRounds` more rounds then pair the halves off by rotating offset, each
 * against a different opponent from the rival, and are spread evenly through
 * the season rather than bolted on at the end. Home and away alternate by
 * round, so every club finishes level on home games.
 */
export function conferenceSchedule(halves: [number[], number[]], crossRounds: number): ScheduleGame[] {
  const [a, b] = halves;
  if (a.length !== b.length || a.length < 2) {
    throw new Error(`conferenceSchedule needs two equal halves of 2+, got ${a.length} and ${b.length}`);
  }
  const m = a.length;
  const odd = m % 2 === 1;
  const confRounds = odd ? 2 * m : 2 * (m - 1);
  const conference: { home: number; away: number }[][] = Array.from({ length: confRounds }, () => []);
  const byeOf: [number[], number[]] = [[], []];
  [a, b].forEach((ids, half) => {
    for (const g of generateSchedule(odd ? [...ids, BYE] : ids)) {
      if (g.home === BYE) byeOf[half][g.matchday - 1] = g.away;
      else if (g.away === BYE) byeOf[half][g.matchday - 1] = g.home;
      else conference[g.matchday - 1].push({ home: g.home, away: g.away });
    }
  });
  if (odd) {
    for (let r = 0; r < confRounds; r++) {
      const firstHalfOfSeason = r < confRounds / 2;
      conference[r].push(firstHalfOfSeason
        ? { home: byeOf[0][r], away: byeOf[1][r] }
        : { home: byeOf[1][r], away: byeOf[0][r] });
    }
  }

  // An odd half already used offset 0 for the rivals; each further round needs a
  // distinct offset, so there are at most m - (odd ? 1 : 0) of them.
  const firstOffset = odd ? 1 : 0;
  const extra = Math.max(0, Math.min(crossRounds, m - firstOffset));
  const cross = Array.from({ length: extra }, (_, j) => {
    const k = firstOffset + j;
    return a.map((tid, i) => (j % 2 === 0
      ? { home: tid, away: b[(i + k) % m] }
      : { home: b[(i + k) % m], away: tid }));
  });

  const total = confRounds + extra;
  const crossAt = new Set(cross.map((_, j) => Math.floor(((j + 0.5) * total) / extra)));
  const out: ScheduleGame[] = [];
  let nextConf = 0;
  let nextCross = 0;
  for (let r = 0; r < total; r++) {
    const round = crossAt.has(r) ? cross[nextCross++] : conference[nextConf++];
    for (const g of round) out.push({ matchday: r + 1, home: g.home, away: g.away });
  }
  return out;
}

/**
 * Stretch a competition's rounds across the fixed SEASON_MATCHDAYS grid, so a
 * division of any size still starts near matchday 1 and finishes on the last
 * one, taking blank matchdays in between.
 *
 * A 20-club division plays 38 rounds and maps one-to-one, so **the shipped world
 * is untouched** — round r keeps matchday r. A 16-club division plays 30 rounds
 * and sits them at 1, 3, 4, 5, 6, 8 … 38.
 *
 * Spreading rather than letting a short season simply end early is what keeps
 * the rest of the calendar meaningful for it: the winter window still opens
 * mid-season, deadline day still falls with games left to play, and its run-in
 * still lines up with the continental finals. Blank matchdays are also why
 * injuries and bans have to tick per club that actually played (see
 * simThrough), not once per matchday for everyone.
 */
function spreadOverSeason(fixtures: ScheduleGame[]): ScheduleGame[] {
  const rounds = fixtures.length === 0
    ? 0
    : Math.max(...fixtures.map((g) => g.matchday));
  if (rounds === 0 || rounds === SEASON_MATCHDAYS) return fixtures;
  // More rounds than matchdays would put two rounds on one matchday, i.e. clubs
  // playing twice in a day. Only an unsplit division past 20 clubs gets here.
  if (rounds > SEASON_MATCHDAYS) {
    throw new Error(`a season of ${rounds} rounds does not fit ${SEASON_MATCHDAYS} matchdays`);
  }
  return fixtures.map((g) => ({
    ...g,
    matchday: Math.round((g.matchday * SEASON_MATCHDAYS) / rounds),
  }));
}

/**
 * Every competition's season, concatenated: a double round robin for a single
 * table, a conference schedule for a split one, each spread across the
 * calendar. THE one place a season's fixtures are built — world creation and
 * the offseason both come through here, so a season 2 cannot be shaped
 * differently from a season 1.
 */
export function buildCompetitionSchedule(
  teams: readonly ConferenceTeam[],
  competitions: readonly Competition[],
): ScheduleGame[] {
  return competitions.flatMap((comp) => {
    const tids = teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const conferences = competitionConferences(comp);
    const halves = conferences ? conferenceMembers(teams, comp) : null;
    if (conferences && halves && halves[1].length >= 2) {
      return spreadOverSeason(halves[0].length === halves[1].length
        ? conferenceSchedule(halves, conferences.crossRounds)
        : unequalConferenceSchedule(halves));
    }
    // A season format lays its first phase out against the WHOLE season's
    // length, second phase included, so the split lands where it belongs on the
    // grid and the second phase (built later, see splitSecondPhaseFixtures) fills
    // the matchdays after it.
    const format = competitionSeasonFormat(comp);
    if (format.legs !== 2 || format.split) {
      const total = seasonFormatRounds(format, tids.length).total;
      return roundRobin(tids, format.legs).map((g) => ({
        ...g, matchday: roundToMatchday(g.matchday, total),
      }));
    }
    return spreadOverSeason(roundRobin(tids, 2));
  });
}

/**
 * The second phase of every split division whose first phase has just been
 * completed, to be appended to the season's schedule.
 *
 * Derived rather than recorded: a division needs its second phase exactly when
 * it has played every first-phase match and has nothing left on the schedule.
 * Once added those fixtures are on the schedule, and once played the division
 * has more matches than its first phase holds — so the same league can never
 * be handed the same second phase twice, whoever calls this and however often.
 *
 * The groups come from the first-phase table (deductions included), and each
 * group's rounds spread across the second phase's matchdays, so a group of four
 * playing six games shares the window with a group of six playing ten.
 */
export function splitSecondPhaseFixtures(
  teams: readonly { tid: number; compId: number }[],
  competitions: readonly Competition[],
  played: readonly MatchScore[],
  schedule: readonly ScheduleGame[],
  deductions?: ReadonlyMap<number, number>,
): ScheduleGame[] {
  const out: ScheduleGame[] = [];
  for (const comp of competitions) {
    const split = competitionSplit(comp);
    if (!split) continue;
    const tids = teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    if (tids.length !== split.groups.reduce((a, b) => a + b, 0)) continue;
    const members = new Set(tids);
    if (schedule.some((g) => members.has(g.home))) continue;
    const compPlayed = played.filter((m) => members.has(m.home));
    if (compPlayed.length !== split.firstPhaseMatches) continue;

    const format = competitionSeasonFormat(comp);
    const rounds = seasonFormatRounds(format, competitionTeamCount(comp));
    const seeding = computeStandings(tids, compPlayed, deductions);
    let cursor = 0;
    split.groups.forEach((size, g) => {
      const group = seeding.slice(cursor, cursor + size).map((r) => r.tid);
      cursor += size;
      const games = roundRobin(group, format.split!.legs[g]);
      const groupRounds = Math.max(...games.map((x) => x.matchday));
      for (const game of games) {
        const round = rounds.first + Math.round((game.matchday * rounds.second) / groupRounds);
        out.push({ ...game, matchday: roundToMatchday(round, rounds.total) });
      }
    });
  }
  return out;
}
