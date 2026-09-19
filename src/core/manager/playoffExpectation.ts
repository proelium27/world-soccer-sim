/**
 * How the board judges a club in a league whose champion comes out of a title
 * playoff (MLS, Liga MX, Argentina).
 *
 * In those leagues the table is not the prize, so a board does not care much
 * whether you finished 2nd or 4th. What it cares about is the playoffs: making
 * them is the minimum it asks of anyone, and a contender is judged on how deep
 * it goes. So both halves of the verdict are moved onto a playoff scale:
 *
 * - **Expectation.** A club the board expects to finish inside the playoff
 *   places is given a playoff *stage* instead of a table place: the favourite is
 *   expected to win it, the next one to reach the final, the next two the
 *   semi-finals, and so on down the bracket. A club expected to finish outside
 *   the places keeps its table expectation, because for a small club getting to
 *   a certain level of the table is a fair thing to be judged on.
 * - **Result.** A club that made the playoffs is scored on the round it went out
 *   in, not its table place. A club that missed them keeps its table finish, and
 *   is never scored better than the worst playoff exit.
 *
 * Both sides become a "place" on the same 1..N scale the ordinary verdict uses
 * (a round's place is the middle of the places its losers share: going out when
 * eight are left is worth 6.5, the average of 5th to 8th), so `judgeSeason`'s
 * arithmetic, the board's demand and the difficulty's patience all apply
 * unchanged. Missing the playoffs then costs a flat extra on top, for every club,
 * which is the "bare minimum" half of the rule.
 *
 * Pure, rng-free, reads nothing but the playoff record and the format.
 */
import type { Competition } from "../competitions.js";
import { competitionTitlePlayoff } from "../competitions.js";
import {
  CONFERENCE_PLAYOFF_TEAMS,
  CONFERENCE_SINGLE_PLAYOFF_TEAMS,
  TITLE_PLAYOFF_TEAMS,
  ZONE_PLAYOFF_TEAMS,
} from "../constants.js";
import {
  titlePlayoffRoundNames,
  type PlayedTitlePlayoffFormat,
  type TitlePlayoff,
} from "../titlePlayoff.js";

/** One way a playoff run can end. */
export interface PlayoffStage {
  /** Round the club went out in, or null for the champion. */
  round: number | null;
  /** The round's name ("Conference finals"), or "Champion". */
  name: string;
  /** Clubs still in when this round started (1 for the champion). */
  remaining: number;
  /** Best and worst place this exit shares, and their average. */
  placeHi: number;
  placeLo: number;
  place: number;
}

/** How many clubs a format seats. */
export function playoffEntrants(format: PlayedTitlePlayoffFormat): number {
  switch (format) {
    case "conference": return 2 * CONFERENCE_PLAYOFF_TEAMS;
    case "conference-single": return 2 * CONFERENCE_SINGLE_PLAYOFF_TEAMS;
    case "zones": return 2 * ZONE_PLAYOFF_TEAMS;
    default: return TITLE_PLAYOFF_TEAMS;
  }
}

/**
 * Every exit from a format's bracket, deepest first: champion, lost the final,
 * lost the semis, … down to the first round.
 *
 * Built from the round count and the entrant count alone: every round but the
 * first halves the field, and the first knocks out whatever is left over (MLS's
 * wild card knocks out two of eighteen; everyone else's first round halves it
 * too). That is exactly what the brackets in titlePlayoff.ts play.
 */
export function playoffStages(format: PlayedTitlePlayoffFormat): PlayoffStage[] {
  const names = titlePlayoffRoundNames(format);
  const rounds = names.length;
  const entrants = playoffEntrants(format);
  const stages: PlayoffStage[] = [
    { round: null, name: "Champion", remaining: 1, placeHi: 1, placeLo: 1, place: 1 },
  ];
  // Round r (counting from the final at rounds - 1) starts with 2^(rounds - r)
  // clubs, except the first round, which starts with everyone.
  for (let r = rounds - 1; r >= 0; r--) {
    const remaining = r === 0 ? entrants : 2 ** (rounds - r);
    const survivors = r === rounds - 1 ? 1 : 2 ** (rounds - r - 1);
    const placeHi = survivors + 1;
    const placeLo = remaining;
    if (placeLo < placeHi) continue;
    stages.push({ round: r, name: names[r], remaining, placeHi, placeLo, place: (placeHi + placeLo) / 2 });
  }
  return stages;
}

/** The stage a club expected to finish `rank` in the table is expected to reach, or null if outside the places. */
export function expectedPlayoffStage(format: PlayedTitlePlayoffFormat, rank: number): PlayoffStage | null {
  for (const stage of playoffStages(format)) {
    if (rank >= stage.placeHi && rank <= stage.placeLo) return stage;
  }
  return null;
}

/** How far a club got in a decided playoff: its exit stage, or null if it wasn't in it. */
export function playoffResult(playoff: TitlePlayoff, tid: number): PlayoffStage | null {
  if (!playoff.teams.includes(tid)) return null;
  const stages = playoffStages(playoff.format);
  if (playoff.winnerTid === tid) return stages[0];
  const lost = playoff.ties.find((t) => (t.home === tid || t.away === tid) && t.winner !== tid);
  if (!lost) return null;
  return stages.find((s) => s.round === lost.round) ?? null;
}

/** "the conference finals", "round one", "the wild card round". */
function roundPhrase(name: string): string {
  if (/^round one$/i.test(name)) return "round one";
  if (/^wild card$/i.test(name)) return "the wild card round";
  return `the ${name.toLowerCase()}`;
}

/** What the board wants, in words: "win the title", "reach the final", "make the playoffs". */
export function playoffGoalLabel(stage: PlayoffStage): string {
  if (stage.round === null) return "win the title";
  if (stage.remaining === 2) return "reach the final";
  // The early rounds are where most of the field goes out; getting in is the ask.
  if (stage.round === 0 || stage.remaining > 8) return "make the playoffs";
  return `reach ${roundPhrase(stage.name)}`;
}

/** What the club did, in words: "won the title", "lost the final", "went out in the semi-finals". */
export function playoffResultLabel(stage: PlayoffStage | null): string {
  if (stage === null) return "missed the playoffs";
  if (stage.round === null) return "won the title";
  if (stage.remaining === 2) return "lost the final";
  return `went out in ${roundPhrase(stage.name)}`;
}

/** The playoff format a competition decides its title with, or null for a table league. */
export function titlePlayoffFormatOf(comp: Competition | undefined): PlayedTitlePlayoffFormat | null {
  if (!comp) return null;
  const format = competitionTitlePlayoff(comp);
  return format === "none" ? null : format;
}

/** What the board's verdict records about the playoffs. */
export interface PlayoffJudgement {
  /** Expected stage in words, or null if the board judged the club on the table. */
  goal: string | null;
  /** What happened, in words. */
  result: string;
  missed: boolean;
  /** The two places `judgeSeason` compares. */
  expectedPlace: number;
  actualPlace: number;
}

/**
 * Put a season in a playoff league on the board's scale.
 *
 * `expectedRank` and `finish` are the ordinary table numbers; `playoff` must be
 * decided (the review runs after the last round).
 */
export function judgePlayoffSeason(
  playoff: TitlePlayoff,
  tid: number,
  expectedRank: number,
  finish: number,
): PlayoffJudgement {
  const expected = expectedPlayoffStage(playoff.format, expectedRank);
  const result = playoffResult(playoff, tid);
  const entrants = playoffEntrants(playoff.format);
  return {
    goal: expected ? playoffGoalLabel(expected) : null,
    result: playoffResultLabel(result),
    missed: result === null,
    expectedPlace: expected ? expected.place : expectedRank,
    // A club that missed out is never scored better than the worst exit, even
    // one that finished high in the overall table and lost out on its half.
    actualPlace: result ? result.place : Math.max(finish, entrants),
  };
}

/**
 * What a board in `comp` wants from a club it expects to finish `expectedRank`,
 * for the UI. `playoffLeague` false means an ordinary table league; `goal` null
 * inside a playoff league means the club is expected to finish outside the
 * places and is judged on the table, with a playoff place as the minimum.
 */
export function boardPlayoffGoal(
  comp: Competition | undefined,
  expectedRank: number,
): { playoffLeague: boolean; goal: string | null } {
  const format = titlePlayoffFormatOf(comp);
  if (!format) return { playoffLeague: false, goal: null };
  const stage = expectedPlayoffStage(format, expectedRank);
  return { playoffLeague: true, goal: stage ? playoffGoalLabel(stage) : null };
}
