import type { SeasonStatLine } from "../core/players/types.js";
import { RATING_LEADER_QUALIFY_FRACTION } from "../core/constants.js";
import { per90, per90QualifyingMinutes, PER90_STAT_KEYS } from "../core/stats/per90.js";

/**
 * The Stat Leaders board's ranking rules, kept out of the page component so the
 * qualifiers can be tested directly — they are the part with actual judgement in
 * them, and a rate board with a broken qualifier looks perfectly plausible.
 */

export type StatKey =
  | "goals"
  | "assists"
  | "shots"
  | "shotsOnTarget"
  | "xg"
  | "saves"
  | "tackles"
  | "interceptions"
  | "passes"
  | "crosses"
  | "foulsCommitted"
  | "yellowCards"
  | "redCards"
  | "avgRating"
  | "minutesPlayed";

export const STAT_OPTIONS: { key: StatKey; label: string }[] = [
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "shots", label: "Shots" },
  { key: "shotsOnTarget", label: "Shots on Target" },
  { key: "xg", label: "xG" },
  { key: "saves", label: "Saves" },
  { key: "tackles", label: "Tackles" },
  { key: "interceptions", label: "Interceptions" },
  { key: "passes", label: "Passes" },
  { key: "crosses", label: "Crosses" },
  { key: "foulsCommitted", label: "Fouls" },
  { key: "yellowCards", label: "Yellow Cards" },
  { key: "redCards", label: "Red Cards" },
  { key: "avgRating", label: "Match Rating" },
  { key: "minutesPlayed", label: "Minutes" },
];

/** Totals, or the same stats divided by 90-minute matches played. */
export type LeaderMode = "totals" | "per90";

/** How many rows the board shows. */
export const LEADER_ROW_LIMIT = 30;

/**
 * Whether a per-90 rate means anything for this stat. False for `avgRating`
 * (already an average) and `minutesPlayed` (the denominator), which stay on
 * their totals rendering even while the board is in per-90 mode.
 */
export function supportsPer90(stat: StatKey): boolean {
  return (PER90_STAT_KEYS as readonly string[]).includes(stat);
}

/**
 * The number this board sorts and displays for one player, or `null` when a
 * rate is asked for and no minutes are recorded.
 */
export function leaderValue(
  stats: SeasonStatLine,
  stat: StatKey,
  mode: LeaderMode,
): number | null {
  const total = stats[stat];
  if (mode === "totals" || !supportsPer90(stat)) return total;
  return per90(total, stats.minutesPlayed);
}

/**
 * Match Rating's own qualifier: a fraction of the games played *so far*, so a
 * player with one hot cameo can't top the board. Predates per-90 mode and is
 * unchanged by it — the two gates apply to different stats and never overlap.
 */
function ratingQualifyingAppearances(matchesPlayed: number): number {
  return Math.max(1, Math.ceil(RATING_LEADER_QUALIFY_FRACTION * matchesPlayed));
}

function qualifies(
  stats: SeasonStatLine,
  stat: StatKey,
  mode: LeaderMode,
  matchesPlayed: number,
): boolean {
  if (stat === "avgRating") {
    return stats.appearances >= ratingQualifyingAppearances(matchesPlayed);
  }
  if (mode === "per90" && supportsPer90(stat)) {
    return stats.minutesPlayed >= per90QualifyingMinutes(matchesPlayed);
  }
  // A total needs no playing-time gate: it is its own evidence of playing time.
  return true;
}

export interface RankLeadersOptions {
  stat: StatKey;
  mode: LeaderMode;
  /** Matches this competition has played so far in the season being ranked. */
  matchesPlayed: number;
  limit?: number;
}

/**
 * The board's top rows: qualified players, ranked by `leaderValue` descending,
 * ties broken by pid so the order is stable across renders.
 */
export function rankLeaders<T extends { player: { pid: number }; stats: SeasonStatLine }>(
  rows: readonly T[],
  { stat, mode, matchesPlayed, limit = LEADER_ROW_LIMIT }: RankLeadersOptions,
): T[] {
  return rows
    .filter((r) => qualifies(r.stats, stat, mode, matchesPlayed))
    .sort(
      (a, b) =>
        (leaderValue(b.stats, stat, mode) ?? 0) - (leaderValue(a.stats, stat, mode) ?? 0) ||
        a.player.pid - b.player.pid,
    )
    .slice(0, limit);
}
