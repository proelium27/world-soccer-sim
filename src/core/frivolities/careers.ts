import type { LeagueStore } from "../leagueState.js";
import type { Player, Position } from "../players/types.js";
import type { ArchivedPlayer, ArchivedSeason } from "../players/archive.js";
import type { AllTimeStatKey, StatTotals, BestSeasons } from "./stats.js";
import { liveCareer } from "../players/careerSummary.js";

/**
 * One career, whether or not the player is still playing.
 *
 * Every all-time list needs the same answer to "who has the most X" from two
 * differently-shaped sources: live `Player`s (full per-season stat lines) and
 * `ArchivedPlayer`s (career totals only, because the season lines were deleted
 * with them). Flattening both to this row once means each list below is a plain
 * sort rather than a two-branch merge, and — the part that actually matters —
 * makes it impossible for a list to quietly cover only the living.
 */
export interface CareerRow {
  pid: number;
  name: string;
  nationality: string;
  pos: Position;
  /** Still in the world, i.e. not retired. */
  active: boolean;
  /** The season he was born in — his age in any season is that season minus this. */
  born: number;
  /** Club he's at now (active) or last played for (retired); null if neither. */
  tid: number | null;
  seasonsPlayed: number;
  firstSeason: number;
  lastSeason: number;
  peakOvr: number;
  peakSeason: number;
  /** League career totals, one number per ranked stat (see frivolities/stats.ts). */
  totals: StatTotals;
  /** Best individual season in each ranked stat, with the season it happened in. */
  best: BestSeasons;
  caps: number;
  intlGoals: number;
  /** World Cups won with his nation. */
  intlTitles: number;
  /** Distinct clubs he made league appearances for. */
  clubs: number[];
  /**
   * Every season he was on a senior roster, with the club, rating and
   * appearances. Includes seasons he never played — a stats row is the game's
   * squad-membership record, and league titles are credited on it.
   */
  seasons: ArchivedSeason[];
}

/** Shorthand for the two numbers nearly every caller wants off a row. */
export function statOf(row: CareerRow, key: AllTimeStatKey): number {
  return row.totals[key];
}

/**
 * One archived career as a `CareerRow`.
 *
 * Exported because the farewell list ranks a player the *instant* he retires,
 * before he is anywhere the boards can see him: `archivePlayer` already reduces
 * a live retiree to exactly this shape off his stored career summary, so
 * composing the two is how a retiree gets scored without walking his seasons —
 * which by then may be a worker-side window rather than his whole career (see
 * players/careerSummary.ts).
 */
export function rowFromArchived(a: ArchivedPlayer): CareerRow {
  return {
    pid: a.pid,
    name: a.name,
    nationality: a.nationality,
    pos: a.pos,
    active: false,
    born: a.born,
    tid: a.clubs.length ? a.clubs[a.clubs.length - 1] : null,
    seasonsPlayed: a.seasonsPlayed,
    firstSeason: a.firstSeason,
    lastSeason: a.retiredSeason,
    peakOvr: a.peakOvr,
    peakSeason: a.peakSeason,
    totals: a.totals,
    best: a.best,
    caps: a.caps,
    intlGoals: a.intlGoals,
    intlTitles: a.intlTitles ?? 0,
    clubs: a.clubs,
    seasons: a.seasons ?? [],
  };
}

function rowFromPlayer(
  p: Player,
  tidOf: (pid: number) => number | null,
  currentSeason: number,
): CareerRow {
  // From his stored summary plus the season in progress — never by walking his
  // seasons, which are not in memory (docs/lazy-career-plan.md).
  const career = liveCareer(p, currentSeason);
  const played = career.seasons.filter((s) => s.apps > 0);

  // Current ovr leads and a stored peak replaces it only when strictly higher —
  // the rule `peakOf` (players/archive.ts) and the history scan this replaced
  // both used. A player in his very first season has no peak behind him yet, so
  // the fallback season is the CURRENT one, never `p.born`: born is a season
  // number too, and would render as a real-looking but wrong year.
  let peakOvr = p.ovr;
  let peakSeason = currentSeason;
  if (p.peakOvr != null) {
    if (p.peakOvr > peakOvr) {
      peakOvr = p.peakOvr;
      peakSeason = p.peakOvrSeason ?? currentSeason;
    }
  } else {
    // A hand-built player with no stored peak, as `peakOf` allows for too. Every
    // real one has the field (construction sites and migration set it), so this
    // scan only ever sees what little history is resident.
    for (const h of p.recentHist) {
      if (h.ovr > peakOvr) { peakOvr = h.ovr; peakSeason = h.season; }
    }
  }

  const clubs: number[] = [];
  for (const s of played) {
    if (s.tid >= 0 && !clubs.includes(s.tid)) clubs.push(s.tid);
  }

  return {
    pid: p.pid,
    name: p.name,
    nationality: p.nationality,
    pos: p.pos,
    active: true,
    born: p.born,
    tid: tidOf(p.pid),
    seasonsPlayed: played.length,
    firstSeason: played.length ? played[0].season : 0,
    lastSeason: played.length ? played[played.length - 1].season : 0,
    peakOvr,
    peakSeason,
    totals: career.totals,
    best: career.best,
    caps: p.intl?.caps ?? 0,
    intlGoals: p.intl?.goals ?? 0,
    intlTitles: p.intl?.titles ?? 0,
    clubs,
    // Every season he was on a roster, appearances or not — the same line the
    // archive keeps, so a living and a retired player's seasons mean the same.
    seasons: career.seasons,
  };
}

/**
 * Every career the save still knows about: active players plus archived
 * retirees.
 *
 * Only players with at least one senior appearance are included, so the lists
 * aren't padded with academy kids and unsigned free agents who never played.
 * Retirees who missed the archive's quality gate are simply gone — see
 * players/archive.ts for why that trade is deliberate, and note it means these
 * lists are complete for the top of every leaderboard but not a census.
 */
export function allCareers(league: LeagueStore): CareerRow[] {
  const tidByPid = new Map<number, number>();
  for (const t of league.teams) {
    for (const pid of t.roster) tidByPid.set(pid, t.tid);
    for (const pid of t.academyRoster) tidByPid.set(pid, t.tid);
  }
  const tidOf = (pid: number) => tidByPid.get(pid) ?? null;

  const living = league.players
    .map((p) => rowFromPlayer(p, tidOf, league.season))
    .filter((r) => r.totals.appearances > 0);
  const retired = (league.retiredPlayers ?? []).map(rowFromArchived);
  return [...living, ...retired];
}

/**
 * Top `limit` rows by `pick`, descending, with pid as a stable tiebreak so the
 * order can't shuffle between renders. Rows scoring 0 are dropped — a list of
 * players with no goals is noise, not a record.
 */
export function topBy<T>(rows: T[], pick: (r: T) => number, limit: number): T[] {
  return rows
    .filter((r) => pick(r) > 0)
    .sort((a, b) => pick(b) - pick(a) || (a as { pid: number }).pid - (b as { pid: number }).pid)
    .slice(0, limit);
}
