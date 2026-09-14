import type { LeagueStore } from "./leagueState.js";
import type { Player } from "./players/types.js";
import { computeSeasonAwards, statsFor, type SeasonAwards } from "./awards.js";
import { computeWorldAwards, type WorldAwards } from "./worldAwards.js";
import { confederationCupChampions } from "./international/confederationCup.js";
import type { AwardFormula } from "./awardFormula.js";

/** One completed season's awards, scored on a given formula. */
export interface ScoredSeason {
  season: number;
  /** Per-competition awards, keyed by the compId each club played in that season. */
  awards: Record<number, SeasonAwards>;
  world: WorldAwards;
}

/** The most recent season that has finished and been recorded, or null on a save still in its first season. */
export function lastCompletedSeason(league: LeagueStore): number | null {
  const history = league.seasonHistory;
  return history.length > 0 ? history[history.length - 1].season : null;
}

/**
 * Re-score a finished season's awards on any formula, for God Mode's "who would
 * have won" preview.
 *
 * A preview, not a record: nothing here is stored, and it is judged on the
 * players still in the pool (retirees have been deleted), the same caveat
 * `migrate.ts`'s award backfill carries. That is why the editor compares a draft
 * against THIS function run on the save's current formula, rather than against
 * the winners stored on the season: both sides then see the same players, so a
 * difference is the formula and never a retirement.
 *
 * Everything else a season's awards need is already snapshotted: which league
 * each club played in (`compsByTid`), who won each title, the archived cups and
 * the international results of the offseason after it. Pure and rng-free.
 */
export function scoreSeasonAwards(
  league: LeagueStore,
  season: number,
  formula: AwardFormula,
): ScoredSeason | null {
  const entry = league.seasonHistory.find((h) => h.season === season);
  if (!entry) return null;

  // Filed by the competition his club was in that season, which is what the
  // offseason's own per-competition pass reads (through that season's rosters).
  const byComp = new Map<number, Player[]>();
  for (const p of league.players) {
    const s = statsFor(p, season);
    if (!s || s.appearances === 0) continue;
    const compId = entry.compsByTid[s.tid];
    if (compId === undefined) continue;
    const list = byComp.get(compId);
    if (list) list.push(p);
    else byComp.set(compId, [p]);
  }
  const awards: Record<number, SeasonAwards> = {};
  for (const [compId, players] of byComp) awards[compId] = computeSeasonAwards(players, season, formula);

  const cups = [...league.cupHistory, ...(league.cup ? [league.cup] : [])];
  const world = computeWorldAwards(league.players, season, {
    compsByTid: entry.compsByTid,
    competitions: league.competitions,
    championTidByCompId: entry.championTidByCompId,
    cup: cups.find((c) => c.season === season) ?? null,
    domesticCups: [...league.domesticCupHistory, ...league.domesticCups].filter((c) => c.season === season),
    worldCupChampion: league.international.history.find((h) => h.season === season)?.champion ?? null,
    confederationCupChampions: confederationCupChampions(league.international.confederationCupHistory, season),
  }, formula);

  return { season, awards, world };
}
