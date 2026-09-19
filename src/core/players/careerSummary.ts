import type { SeasonStats } from "./types.js";

/**
 * One season a player was on a senior roster: the club, the rating he played it
 * at, and how many games he got.
 *
 * Lives here rather than in `archive.ts` because a living player's summary and
 * an `ArchivedPlayer` both carry it and the two must be the same shape — the
 * all-time boards fold them into one `CareerRow` and could not otherwise agree.
 * `archive.ts` re-exports it.
 *
 * Deliberately includes a season with no appearance: a stats row is the game's
 * only per-season squad-membership record, and a league title is credited on it.
 * That is the opposite of the totals/best rule below, which skips them.
 */
export interface ArchivedSeason {
  season: number;
  /** Club he was at as of his most recent matchday that season (SeasonStats.tid). */
  tid: number;
  /** The rating he played that season at. */
  ovr: number;
  /** Appearances that season; 0 means he was in the squad but never played. */
  apps: number;
}

/**
 * A player's career, reduced to what the all-time boards actually rank on.
 *
 * **Why this exists.** A save holds every player's whole per-season history from
 * the moment it loads: measured on the reported season-60 save, 45.2 MB of
 * `stats[]` + `hist[]` against 4.5 MB of actual identity. `docs/lazy-career-plan.md`
 * moves that to disk, which immediately raises the question of how Frivolities
 * ranks 10,864 careers without reading 10,864 careers. The answer is that it
 * never needed the seasons, only the totals and the bests — so those are carried
 * on the player and the seasons stay on disk. Measured: **10.4 MB against the
 * 45.2 MB it replaces, a net 34.8 MB off resident memory**, with no board losing
 * anything, since a per-player summary still ranks, filters and sorts exactly
 * like the full data would.
 *
 * Deliberately per-player rather than a precomputed global leaderboard: a
 * top-N table would be smaller still, but it fixes the question in advance —
 * change a qualifier, add a filter or sort by something else and it has to be
 * rebuilt. This keeps every board derivable.
 *
 * **The contract, and it is the part to get right: a stored summary covers
 * every season the player has FINISHED.** The season in progress is not in it,
 * because it is still moving. Anything wanting live numbers folds the current
 * season's row in with `withSeason` — which is cheap and always available, since
 * the current row is exactly what the resident window keeps. Folding once per
 * offseason rather than maintaining a running total on every matchday is the
 * whole reason this is testable: one function, one call site, and a test that
 * pins it against the very functions it replaces.
 */

/** The stats an all-time board can rank. Order is display order. */
export const ALL_TIME_STAT_KEYS = [
  "goals", "assists", "shots", "shotsOnTarget", "xg", "saves", "tackles",
  "interceptions", "passes", "crosses", "foulsCommitted", "minutesPlayed",
  "appearances", "avgRating",
] as const;

export type AllTimeStatKey = (typeof ALL_TIME_STAT_KEYS)[number];

/** Career totals, one number per ranked stat. `avgRating` is a per-appearance mean, not a sum. */
export type StatTotals = Record<AllTimeStatKey, number>;

/**
 * A player's best single season in one stat.
 *
 * `appearances` rides along because the rate stats (`avgRating`) need a
 * qualification floor, and a retiree's per-season lines are deleted with him —
 * without this the UI could not apply the same floor to the living and the
 * retired, and a one-game cameo from 40 seasons ago would top the board forever.
 */
export interface BestSeasonLine {
  value: number;
  season: number;
  appearances: number;
}

export type BestSeasons = Record<AllTimeStatKey, BestSeasonLine>;

/**
 * Everything an all-time board needs about one career, minus the seasons.
 *
 * `ratingSum` is carried because `avgRating` is a mean: two summaries cannot be
 * added together without the numerator, and folding a season in needs it too.
 * It is not a ranked stat, which is why it sits beside the totals rather than
 * inside them.
 */
export interface CareerSummary {
  totals: StatTotals;
  best: BestSeasons;
  ratingSum: number;
  /**
   * A line per season he was on a roster, in season order.
   *
   * Cheap for what it unlocks: measured on the reported season-60 save it is
   * **2.7 MB** across 73,808 lines — four small numbers each, against the ~550
   * bytes a `SeasonStats` row plus its `RatingsSnapshot` cost. Carrying it is
   * what makes a whole `CareerRow` derivable without the seasons behind it, so
   * the GOAT board's prime curve and the club-per-season a league title is
   * attributed on keep working with the career itself on disk.
   */
  seasons: ArchivedSeason[];
}

export function emptyTotals(): StatTotals {
  return Object.fromEntries(ALL_TIME_STAT_KEYS.map((k) => [k, 0])) as StatTotals;
}

export function emptyBestSeasons(): BestSeasons {
  return Object.fromEntries(
    ALL_TIME_STAT_KEYS.map((k) => [k, { value: 0, season: 0, appearances: 0 }]),
  ) as BestSeasons;
}

export function emptyCareerSummary(): CareerSummary {
  return { totals: emptyTotals(), best: emptyBestSeasons(), ratingSum: 0, seasons: [] };
}

/** One season's value for a ranked stat. */
function valueOf(s: SeasonStats, key: AllTimeStatKey): number {
  return s[key];
}

/**
 * Add one finished season to a summary.
 *
 * A season with no appearance is skipped, matching `summaryOf`: a line of all
 * zeros is a season he did not play, and counting it would drag `avgRating`
 * toward nothing.
 *
 * Pure — returns a new summary — so it composes and cannot corrupt the input if
 * it is called twice by mistake.
 */
export function withSeason(summary: CareerSummary, s: SeasonStats, ovr: number): CareerSummary {
  // The season line goes in either way — it is squad membership, and a title is
  // credited on it whether or not he got a game. Only the ranked stats below
  // skip a season with no appearance.
  const seasons = [...summary.seasons, { season: s.season, tid: s.tid, ovr, apps: s.appearances }];
  if (s.appearances <= 0) return { ...summary, seasons };

  const totals = { ...summary.totals };
  for (const k of ALL_TIME_STAT_KEYS) {
    if (k === "avgRating") continue;
    totals[k] += valueOf(s, k);
  }
  const ratingSum = summary.ratingSum + s.ratingSum;
  totals.avgRating = totals.appearances > 0 ? ratingSum / totals.appearances : 0;

  const best = { ...summary.best };
  for (const k of ALL_TIME_STAT_KEYS) {
    const v = valueOf(s, k);
    // Strictly greater, so an earlier season keeps a tie — exactly what walking
    // the array in order does.
    if (v > best[k].value) best[k] = { value: v, season: s.season, appearances: s.appearances };
  }

  return { totals, best, ratingSum, seasons };
}

/**
 * Build a summary from a whole career.
 *
 * The reference implementation: `withSeason` folded over every season, and what
 * the migration backfill and the tests both use. Equivalent to the `totalsOf` /
 * `bestSeasonsOf` pair it replaces, which is pinned by test rather than assumed.
 */
export function summaryOf(
  stats: readonly SeasonStats[],
  ovrForSeason: (season: number) => number,
): CareerSummary {
  let summary = emptyCareerSummary();
  for (const s of stats) summary = withSeason(summary, s, ovrForSeason(s.season));
  return summary;
}

/**
 * The rating a player played a given season at, from his ratings history.
 *
 * A snapshot stamped N is what he carried through season N + 1 — the convention
 * `progressPlayer` writes and `awards.ovrDuringSeason` reads — so season N asks
 * for the one stamped N − 1. `fallback` covers a season with no snapshot behind
 * it, i.e. his first; callers pass his peak rather than `born`, which is a
 * season number too and would render as a real-looking but wrong year.
 */
/**
 * A player's career summary, computing it from his seasons if he has none yet.
 *
 * The fallback folds only the resident window, so it would under-count a real
 * career — and that is acceptable only because nothing can reach it: every
 * construction site seeds the field, the offseason maintains it, and
 * `migrateLeague` backfills it from the WHOLE career before a save's history is
 * ever split onto disk. It stays so a hand-built fixture still reads sensibly.
 */
export function careerOf(player: {
  career?: CareerSummary;
  recentStats: readonly SeasonStats[];
  recentHist: readonly { season: number; ovr: number }[];
  ovr: number;
  peakOvr?: number;
}): CareerSummary {
  return player.career ?? summaryOf(player.recentStats, ovrLookup(player.recentHist, player.peakOvr ?? player.ovr));
}

export function ovrLookup(
  hist: readonly { season: number; ovr: number }[],
  fallback: number,
): (season: number) => number {
  const bySeason = new Map(hist.map((h) => [h.season, h.ovr]));
  return (season) => bySeason.get(season - 1) ?? fallback;
}

/**
 * The club a player was on in one season, or undefined if he was on no squad.
 *
 * Answered from memory, without his history on disk: the resident window holds
 * the season in progress (and the one before), and the summary's `seasons` line
 * holds every season he has FINISHED — including ones where he never got a game,
 * which is the same squad-membership rule a stat line carries (`accumulateStats`
 * opens one for every squad member). So this is exactly what reading his
 * `SeasonStats.tid` for that season used to be.
 */
export function squadTidInSeason(
  player: { recentStats: readonly SeasonStats[]; career?: CareerSummary },
  season: number,
): number | undefined {
  return player.recentStats.find((s) => s.season === season)?.tid
    ?? player.career?.seasons.find((s) => s.season === season)?.tid;
}

/**
 * A player's career INCLUDING the season in progress, from memory alone.
 *
 * The stored summary covers the seasons he has finished; the one being played
 * is still moving, so it is folded in here from the resident window — the fold
 * the offseason will do for good. The guard is for a hand-built player with no
 * stored summary, whose fallback (`careerOf`) has already folded every line he
 * holds, the current one included.
 */
export function liveCareer(
  player: {
    career?: CareerSummary;
    recentStats: readonly SeasonStats[];
    recentHist: readonly { season: number; ovr: number }[];
    ovr: number;
    peakOvr?: number;
  },
  currentSeason: number,
): CareerSummary {
  const career = careerOf(player);
  const live = player.recentStats.find((s) => s.season === currentSeason);
  if (!live || career.seasons.some((s) => s.season === currentSeason)) return career;
  return withSeason(career, live, ovrLookup(player.recentHist, player.peakOvr ?? player.ovr)(currentSeason));
}
