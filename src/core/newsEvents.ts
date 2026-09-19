import type { Player, Position } from "./players/types.js";
import { POSITIONS } from "./players/types.js";
import type { PlayedMatch } from "./standings.js";
import {
  NEWS_STANDOUT_RATING_FLOOR,
  NEWS_CAREER_GOAL_FIRST,
  NEWS_CAREER_GOAL_STEP,
  NEWS_SEASON_GOAL_FIRST,
  NEWS_SEASON_GOAL_STEP,
  NEWS_WORLD_CAREER_GOALS,
  NEWS_WORLD_SEASON_GOALS,
  NEWS_WORLD_HATTRICK_GOALS,
} from "./constants.js";

export type NewsEventType =
  | "hattrick"
  | "standoutRating"
  | "goalMilestoneSeason"
  | "goalMilestoneCareer"
  | "positionChange";

/**
 * A player accomplishment surfaced on the News Feed, interleaved there with
 * transfers. Unlike per-match box scores (wiped every offseason), these are
 * detected once at match-sim time and persisted forever — see simThrough.ts.
 */
export interface NewsEvent {
  type: NewsEventType;
  pid: number;
  tid: number;
  season: number;
  matchday: number;
  /**
   * Interpreted per `type`: hattrick = goals scored this match;
   * standoutRating = rating × 10 (integer); goalMilestoneSeason /
   * goalMilestoneCareer = the milestone crossed (25, 30, 35... / 50, 100...);
   * positionChange = both positions packed by `packPositionChange` (matchday
   * 0 — it happens in the offseason, with progression).
   */
  detail: number;
}

/**
 * Pack a position change into the single `detail` number the event carries.
 *
 * Both ends have to be stored. Reading the "to" off the player's current
 * position instead would be right only until his next move, at which point
 * every older entry in the feed would silently rewrite itself to claim he
 * converted to wherever he ended up.
 */
export function packPositionChange(from: Position, to: Position): number {
  return POSITIONS.indexOf(from) * POSITIONS.length + POSITIONS.indexOf(to);
}

/** Inverse of `packPositionChange`. */
export function unpackPositionChange(detail: number): { from: Position; to: Position } {
  return {
    from: POSITIONS[Math.floor(detail / POSITIONS.length)],
    to: POSITIONS[detail % POSITIONS.length],
  };
}

/** Each player's season-to-date and all-time (career) goal totals, as of a point in time. */
export function playerGoalTotals(
  players: Player[],
  season: number,
): Map<number, { season: number; career: number }> {
  const map = new Map<number, { season: number; career: number }>();
  for (const p of players) {
    const seasonGoals = p.recentStats.find((s) => s.season === season)?.goals ?? 0;
    // Finished seasons come off the stored summary rather than by summing his
    // stat lines, and the current season is added on top — the summary covers
    // finished seasons only (see players/careerSummary.ts).
    //
    // This is the goal-milestone detector, and it was the last thing in the sim
    // that walked a whole career. Windowing careers at the worker boundary left
    // it silently under-counting, so a player crossed 100 career goals twice:
    // once for real, and again years later once the window had moved past the
    // first hundred. Caught by the deep-equality gate in
    // test/core/simArchive.test.ts, not by reading the code.
    const career = p.career
      ? p.career.totals.goals + seasonGoals
      : p.recentStats.reduce((sum, s) => sum + s.goals, 0);
    map.set(p.pid, { season: seasonGoals, career });
  }
  return map;
}

interface AttributedLine {
  pid: number;
  tid: number;
  goals: number;
  rating: number;
}

function attributedLines(mdResults: PlayedMatch[]): AttributedLine[] {
  const out: AttributedLine[] = [];
  for (const m of mdResults) {
    for (const line of m.boxScore.home) {
      out.push({ pid: line.pid, tid: m.home, goals: line.goals, rating: line.rating });
    }
    for (const line of m.boxScore.away) {
      out.push({ pid: line.pid, tid: m.away, goals: line.goals, rating: line.rating });
    }
  }
  return out;
}

/**
 * Detects hat-tricks, the matchday's standout rating, and goal-milestone
 * crossings from one matchday's completed matches. Pure — the caller
 * (simThrough.ts) supplies goal totals captured immediately before and after
 * this matchday's stats were folded into SeasonStats.
 */
export function detectMatchdayNewsEvents(
  mdResults: PlayedMatch[],
  season: number,
  matchday: number,
  goalTotalsBefore: Map<number, { season: number; career: number }>,
  goalTotalsAfter: Map<number, { season: number; career: number }>,
): NewsEvent[] {
  const lines = attributedLines(mdResults);
  const events: NewsEvent[] = [];

  for (const line of lines) {
    if (line.goals >= 3) {
      events.push({ type: "hattrick", pid: line.pid, tid: line.tid, season, matchday, detail: line.goals });
    }
  }

  let best: AttributedLine | null = null;
  for (const line of lines) {
    if (best === null || line.rating > best.rating) best = line;
  }
  if (best !== null && best.rating >= NEWS_STANDOUT_RATING_FLOOR) {
    events.push({
      type: "standoutRating", pid: best.pid, tid: best.tid, season, matchday,
      detail: Math.round(best.rating * 10),
    });
  }

  for (const line of lines) {
    if (line.goals <= 0) continue;
    const before = goalTotalsBefore.get(line.pid);
    const after = goalTotalsAfter.get(line.pid);
    if (!before || !after) continue;

    const careerMilestone = milestoneCrossed(
      before.career, after.career, NEWS_CAREER_GOAL_FIRST, NEWS_CAREER_GOAL_STEP,
    );
    const seasonMilestone = milestoneCrossed(
      before.season, after.season, NEWS_SEASON_GOAL_FIRST, NEWS_SEASON_GOAL_STEP,
    );

    // One goal can cross both ladders at once, and reporting both puts two rows
    // on the same matchday for the same player, each quoting a bare goal count
    // — which reads as a duplicate even when the numbers differ. In a league's
    // first season the two totals are *identical*, so before this every career
    // milestone was an exact restatement of a season one (measured: 747 of
    // 747). Report the better story only: the higher tier, and on a tie the
    // career number, which climbs the rarer ladder.
    const careerEvent: NewsEvent | null = careerMilestone === null ? null : {
      type: "goalMilestoneCareer", pid: line.pid, tid: line.tid, season, matchday,
      detail: careerMilestone,
    };
    const seasonEvent: NewsEvent | null = seasonMilestone === null ? null : {
      type: "goalMilestoneSeason", pid: line.pid, tid: line.tid, season, matchday,
      detail: seasonMilestone,
    };
    if (careerEvent && seasonEvent) {
      const seasonOutranks =
        newsEventScope(seasonEvent) === "world" && newsEventScope(careerEvent) !== "world";
      events.push(seasonOutranks ? seasonEvent : careerEvent);
    } else if (careerEvent) {
      events.push(careerEvent);
    } else if (seasonEvent) {
      events.push(seasonEvent);
    }
  }

  return events;
}

/**
 * The highest milestone a total crossed in going from `before` to `after`, or
 * null if it crossed none. Milestones are `first`, then every `step` above it
 * (50, 100, 150... / 25, 30, 35...), which requires `first` to be a whole
 * multiple of `step` — both pairs in constants.ts are.
 */
function milestoneCrossed(
  before: number, after: number, first: number, step: number,
): number | null {
  const reached = (total: number) => (total < first ? 0 : Math.floor(total / step) * step);
  const now = reached(after);
  return now > reached(before) ? now : null;
}

/**
 * How far an accomplishment travels: "world" is worth reading about wherever
 * you play, "league" only matters inside the competition it happened in.
 *
 * The world is 320 clubs across 16 competitions, so a feed that reports every
 * competition equally is ~90% news about countries the user has no stake in —
 * which is the whole reason this exists. See the relevance-tier block in
 * constants.ts for why the tier is derived from the event rather than stored on
 * it (deriving it applies the tiers retroactively to events older builds wrote,
 * with no new persisted field and no migration).
 */
export function newsEventScope(e: NewsEvent): "world" | "league" {
  switch (e.type) {
    case "hattrick":
      return e.detail >= NEWS_WORLD_HATTRICK_GOALS ? "world" : "league";
    case "goalMilestoneCareer":
      return e.detail >= NEWS_WORLD_CAREER_GOALS ? "world" : "league";
    case "goalMilestoneSeason":
      return e.detail >= NEWS_WORLD_SEASON_GOALS ? "world" : "league";
    // Already at most one a matchday across the entire world, and floored at a
    // rating hardly anyone reaches — it is the definition of world news.
    case "standoutRating":
      return "world";
    // Never world news: NEWS_POSITION_CHANGE_OVR (72) is an established starter
    // rather than an elite, and the constant's own note is that a squad player
    // converting in another country isn't news. The OVR gate keeps the volume
    // down; this keeps what survives it in the leagues that care.
    case "positionChange":
      return "league";
  }
}

/**
 * Whether an event clears the bar the detector now applies, independent of who
 * is reading. Saves written by earlier builds are full of milestones off a flat
 * every-10 ladder (a career total of 10, a season total of 20), which would
 * otherwise keep crowding an existing save's feed forever. Re-applying the
 * floor at render retires them with no migration and no data loss.
 */
export function isNewsworthy(e: NewsEvent): boolean {
  switch (e.type) {
    case "goalMilestoneCareer":
      return e.detail >= NEWS_CAREER_GOAL_FIRST;
    case "goalMilestoneSeason":
      return e.detail >= NEWS_SEASON_GOAL_FIRST;
    case "hattrick":
    case "standoutRating":
    case "positionChange":
      return true;
  }
}
