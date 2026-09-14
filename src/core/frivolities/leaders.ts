import type { LeagueStore } from "../leagueState.js";
import {
  RATING_LEADER_MIN_CAREER_APPEARANCES, RATING_LEADER_MIN_SEASON_APPEARANCES,
} from "../constants.js";
import { allCareers, type CareerRow } from "./careers.js";
import { ALL_TIME_STAT_KEYS, type AllTimeStatKey } from "./stats.js";
import type { ContinentalRegion } from "../constants.js";
import { americasTids, careerRegion } from "../americasClubs.js";

/** How many rows one stat's full board shows. */
export const ALL_TIME_LEADER_LIMIT = 30;

/**
 * How many rows each stat gets on the summary grid.
 *
 * Ten is the point of that grid: every stat visible at once, none of them in
 * full. The full board is one click away, which is what `ALL_TIME_LEADER_LIMIT`
 * is for.
 */
export const ALL_TIME_OVERVIEW_LIMIT = 10;

/**
 * Career totals, or best individual seasons.
 *
 * **"single" ranks one row per player — his own best season in that stat.** The
 * per-season Stat Leaders page's old all-seasons view instead listed every
 * season as its own row, letting one man hold several places at once. That
 * can't be reproduced here and shouldn't be faked: a retiree's per-season lines
 * are deleted with him, and keeping them all is precisely the save-size blowup
 * the archive exists to avoid (see players/archive.ts). One row per player is
 * the version that reads the same for the living and the retired — and for an
 * all-time board it's arguably the better list anyway, since a single dominant
 * career can't crowd out everyone else.
 */
export type LeaderScope = "career" | "single";

export interface AllTimeLeaderRow {
  career: CareerRow;
  value: number;
  /** The season this row's figure comes from; null for a career aggregate. */
  season: number | null;
  /** Appearances behind the figure, used for the rate-stat qualification floor. */
  appearances: number;
}

/**
 * Whether a row has enough games behind it to be ranked.
 *
 * Only the rate stat needs this: `avgRating` is a mean, so without a floor a
 * single hot cameo tops the board forever. Counting stats are self-limiting.
 *
 * The career floor matches the one the per-season Stat Leaders page uses for
 * its own career aggregate. The single-season floor has to be a flat count
 * rather than Leaders' fraction-of-games-played: these boards span completed
 * seasons from any competition, and a retiree carries his appearance count but
 * no record of how many matches his league played that year.
 */
function qualifies(stat: AllTimeStatKey, scope: LeaderScope, appearances: number): boolean {
  if (stat !== "avgRating") return true;
  return appearances >= (scope === "career"
    ? RATING_LEADER_MIN_CAREER_APPEARANCES
    : RATING_LEADER_MIN_SEASON_APPEARANCES);
}

/**
 * The all-time leaderboard for every ranked stat, keyed by stat.
 *
 * **World-wide, not per-competition**, unlike the per-season Stat Leaders page.
 * That is a deliberate difference: a career spans promotions, relegations and
 * transfers between countries, so there is no single competition a career
 * belongs to — and a retiree keeps no competition history at all. Ranking the
 * whole world is the only answer that stays true as clubs move between tiers.
 *
 * Covers active players and archived retirees alike (see careers.ts), so the
 * boards don't quietly mean "all-time among whoever is still playing".
 *
 * **All the boards at once, from one pass over the careers**, because the page
 * shows all fourteen as a grid of top-ten cards. Gathering `allCareers` — a
 * walk over every living player and every archived retiree — separately per
 * board would pay for that walk fourteen times. The card and the full board it
 * opens are slices of the same result, so they can't disagree about who leads.
 *
 * Pure and rng-free.
 */
export function allTimeLeaderBoards(
  league: LeagueStore,
  scope: LeaderScope,
  limit = ALL_TIME_LEADER_LIMIT,
  /** Careers spent mostly on one continent (see `careerRegion`). Absent means the world. */
  region?: ContinentalRegion,
): Record<AllTimeStatKey, AllTimeLeaderRow[]> {
  const americas = new Set(americasTids(league.teams, league.competitions));
  const careers = allCareers(league)
    .filter((c) => region === undefined || careerRegion(c.seasons, americas) === region);
  return Object.fromEntries(
    ALL_TIME_STAT_KEYS.map((stat) => [stat, rankCareers(careers, stat, scope, limit)]),
  ) as Record<AllTimeStatKey, AllTimeLeaderRow[]>;
}

/** Rank an already-gathered set of careers by one stat. */
function rankCareers(
  careers: readonly CareerRow[],
  stat: AllTimeStatKey,
  scope: LeaderScope,
  limit: number,
): AllTimeLeaderRow[] {
  const rows: AllTimeLeaderRow[] = [];

  for (const career of careers) {
    if (scope === "career") {
      const value = career.totals[stat];
      if (value > 0 && qualifies(stat, scope, career.totals.appearances)) {
        rows.push({ career, value, season: null, appearances: career.totals.appearances });
      }
    } else {
      const best = career.best[stat];
      if (best.value > 0 && qualifies(stat, scope, best.appearances)) {
        rows.push({
          career, value: best.value, season: best.season, appearances: best.appearances,
        });
      }
    }
  }

  return rows
    .sort((a, b) => b.value - a.value || (b.season ?? 0) - (a.season ?? 0)
      || a.career.pid - b.career.pid)
    .slice(0, limit);
}
