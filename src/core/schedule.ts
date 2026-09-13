import type { Competition } from "./competitions.js";
import { competitionConferences } from "./competitions.js";
import { conferenceMembers, type ConferenceTeam } from "./conferences.js";
import { SEASON_MATCHDAYS } from "./calendar.js";

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
    const format = competitionConferences(comp);
    const halves = format ? conferenceMembers(teams, comp) : null;
    const fixtures = format && halves && halves[0].length === halves[1].length && halves[0].length >= 2
      ? conferenceSchedule(halves, format.crossRounds)
      : generateSchedule(teams.filter((t) => t.compId === comp.id).map((t) => t.tid));
    return spreadOverSeason(fixtures);
  });
}
