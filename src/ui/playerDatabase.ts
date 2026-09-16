import type { LeagueStore } from "../core/leagueState.js";
import type { Player, SeasonStats, SkillKey } from "../core/players/types.js";
import { SKILL_KEYS } from "../core/players/types.js";
import type { AllTimeStatKey, StatTotals } from "../core/players/careerSummary.js";
import { ALL_TIME_STAT_KEYS } from "../core/players/careerSummary.js";
import { totalsOf } from "../core/frivolities/stats.js";
import type { PlayerFieldFilters } from "../core/players/playerQuery.js";
import { compIdMatchesFilters, playerMatchesFilters } from "../core/players/playerQuery.js";
import { trueTransferValue } from "../core/finance/valuation.js";
import { weeklyWage } from "../core/contracts.js";

/**
 * The player database's row model, kept out of the page component so the
 * filtering, sorting and paging can be tested directly — they are the parts
 * with judgement in them, and a table that quietly drops or mis-ranks rows
 * looks perfectly plausible.
 */

/** Where a player sits in the world. Drives the status filter and the badge. */
export type PlayerStatus = "senior" | "academy" | "free";

export interface PlayerDbRow {
  player: Player;
  /** Club he is on the books of, or null for a free agent. */
  tid: number | null;
  /** That club's competition, or null for a free agent. */
  compId: number | null;
  age: number;
  status: PlayerStatus;
  /**
   * Market value, priced on the band's **midpoint** rather than the true
   * potential — `trueTransferValue` pays a premium for an unfulfilled potential
   * gap, so pricing on the truth would turn the dollar figure into an exact read
   * on a hidden number. Same rule the Player Profile's value chart follows.
   *
   * Deliberately the midpoint and not the `ceiling` the POT column sorts on: a
   * price is an expected value, and pricing every unscouted player at his best
   * case would inflate the column for no reason beyond nobody having scouted
   * him.
   */
  value: number;
  /** Weekly wage, matching the units the wage column shows. */
  wage: number;
  /** Seasons left on his deal, floored at 0. */
  contractYears: number;
  /** Top of the scouting band — what the POT column shows and filters on. */
  scoutedPot: number;
  /**
   * Bottom of the same band, kept only to break ties in the POT sort.
   *
   * The ceiling alone is not a fine enough key: the band is clamped at
   * `RATING_MAX`, so on a real save ~1.5% of the world (151 of 10,106, measured)
   * reads "–99" and a POT-descending sort opens with a block of them ordered
   * arbitrarily — a 33-overall teenager above an 89-overall international. The
   * floor is the other number already printed in the cell, so ordering
   * "88–99" above "86–99" keeps the promise the ceiling was chosen for: both
   * numbers a reader can see count down the column.
   */
  scoutedPotFloor: number;
}

/** Which block of columns the table is showing. See DESIGN.md §6. */
export type PlayerColumnSet = "overview" | "attributes" | "season" | "career";

/** Status filter values; "all" and "contracted" both cover several statuses. */
export type PlayerStatusFilter = "all" | "contracted" | "free" | "academy";

export const PLAYER_DB_PAGE_SIZE = 100;

/**
 * Every player in the world, each tagged with where he sits.
 *
 * Built by walking the clubs rather than the pool, because a player's club is
 * held on the *team* (`roster`/`academyRoster`) and there is no
 * back-pointer on the player. Anyone no club claims is a free agent — the same
 * definition `freeAgentPids` uses, arrived at from the other side so the row
 * carries the club it found him on.
 */
export function buildPlayerRows(
  league: LeagueStore,
  /**
   * The scouting band the POT column shows. Its top is what the column sorts
   * and filters on; its bottom only breaks ties (see `scoutedPotFloor`).
   */
  bandOf: (p: Player) => { low: number; high: number },
  /** Middle of the band — the expected value a price is worked out from. */
  pricedPotOf: (p: Player) => number,
): PlayerDbRow[] {
  const season = league.season;
  const rows: PlayerDbRow[] = [];
  const claimed = new Set<number>();
  const byPid = new Map(league.players.map((p) => [p.pid, p]));

  const push = (player: Player, tid: number | null, compId: number | null, status: PlayerStatus) => {
    const band = bandOf(player);
    rows.push({
      player,
      tid,
      compId,
      age: season - player.born,
      status,
      value: Math.round(trueTransferValue({ ...player, potential: pricedPotOf(player) }, season)),
      wage: weeklyWage(player.contract.salary),
      contractYears: Math.max(0, player.contract.expiresSeason - season),
      scoutedPot: band.high,
      scoutedPotFloor: band.low,
    });
  };

  for (const team of league.teams) {
    const add = (pids: readonly number[], status: PlayerStatus) => {
      for (const pid of pids) {
        const player = byPid.get(pid);
        // A pid on a roster with no player behind it is a save-integrity
        // problem, not this table's to report — skip rather than throw.
        if (!player || claimed.has(pid)) continue;
        claimed.add(pid);
        push(player, team.tid, team.compId, status);
      }
    };
    add(team.roster, "senior");
    add(team.academyRoster, "academy");
  }

  for (const player of league.players) {
    if (claimed.has(player.pid)) continue;
    push(player, null, null, "free");
  }
  return rows;
}

/** Whether a row's status passes the status filter. */
export function matchesStatus(row: PlayerDbRow, filter: PlayerStatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    // "Contracted" is anyone on a club's books, senior or youth — the question
    // it answers is "does somebody own him", not "is he in the first team".
    case "contracted": return row.status !== "free";
    case "free": return row.status === "free";
    case "academy": return row.status === "academy";
  }
}

export interface PlayerDbFilters {
  fields: PlayerFieldFilters;
  minValue: number | null;
  maxValue: number | null;
  status: PlayerStatusFilter;
  /** Case-insensitive substring match on the player's name. */
  name: string;
}

/**
 * Apply every constraint to the whole world.
 *
 * A **hard constraint on the candidate set**, never a filter over rendered
 * rows: the table pages at PLAYER_DB_PAGE_SIZE, so filtering after the slice
 * would show "the first hundred of whatever ranked globally", which looks
 * plausible and is wrong. Filter, then sort, then slice.
 *
 * A free agent is on no club, so a competition scope necessarily excludes him —
 * that is the honest reading of "players in the Spanish top flight", and it is
 * why the status filter and the scope are separate controls.
 */
export function filterPlayerRows(
  rows: readonly PlayerDbRow[],
  filters: PlayerDbFilters,
  season: number,
): PlayerDbRow[] {
  const name = filters.name.trim().toLowerCase();
  const { fields } = filters;
  const scoped = fields.compId != null || fields.compIds != null;
  return rows.filter((row) => {
    if (!matchesStatus(row, filters.status)) return false;
    if (name && !row.player.name.toLowerCase().includes(name)) return false;
    if (scoped) {
      if (row.compId === null) return false;
      if (!compIdMatchesFilters(row.compId, fields)) return false;
    }
    // The POT range is tested against the *scouted* estimate, so the filter
    // agrees with the column beside it (see ui/potentialView.ts).
    if (!playerMatchesFilters(row.player, fields, season, () => row.scoutedPot)) return false;
    if (filters.minValue != null && row.value < filters.minValue) return false;
    if (filters.maxValue != null && row.value > filters.maxValue) return false;
    return true;
  });
}

/** Every season any player has a stat line for, newest first. */
export function seasonsWithStats(players: readonly Player[]): number[] {
  const seen = new Set<number>();
  for (const p of players) for (const s of p.stats) seen.add(s.season);
  return [...seen].sort((a, b) => b - a);
}

/**
 * One season's stat line per player.
 *
 * `accumulateStats` opens a row for every player on a matchday squad, appearance
 * or not, so *having a line* is the game's record of having been in the squad
 * that season — which is what the season view filters on. Whether he got a game
 * is the `appearances` column's business.
 */
export function seasonStatsIndex(
  players: readonly Player[],
  season: number,
): Map<number, SeasonStats> {
  const index = new Map<number, SeasonStats>();
  for (const p of players) {
    const line = p.stats.find((s) => s.season === season);
    if (line) index.set(p.pid, line);
  }
  return index;
}

/**
 * Career totals per player, summed the same way Frivolities' all-time boards
 * sum them — `totalsOf` over the seasons he actually appeared in, so the two
 * can't disagree about what a career total is.
 *
 * Built on demand rather than folded into `buildPlayerRows`, because it walks
 * every season line of every player in the world and only one column set reads
 * it. On a long dynasty that is the difference between a page that opens
 * instantly and one that pauses first.
 */
export function careerTotalsIndex(players: readonly Player[]): Map<number, StatTotals> {
  const index = new Map<number, StatTotals>();
  for (const p of players) {
    index.set(p.pid, totalsOf(p.stats.filter((s) => s.appearances > 0)));
  }
  return index;
}

/**
 * Stat sort keys are namespaced, and that is a correctness requirement rather
 * than tidiness: `crosses` and `interceptions` are the names of both an
 * *attribute* and a *counted stat*, so one flat key space would let a column
 * header sort by the other one — silently, and only on two columns of sixteen.
 */
export type StatSortKey = `stat_${AllTimeStatKey}` | "stat_yellowCards" | "stat_redCards";

/**
 * Keep only players the chosen season has a record of — the season view's own
 * constraint, applied after the shared filters.
 *
 * Separate from `filterPlayerRows` because it is the *view* narrowing the world
 * rather than the user: a column set that shows one season's numbers has
 * nothing to say about a player who wasn't there, and a table of dashes would
 * be a worse answer than a shorter table.
 */
export function filterToSeason(
  rows: readonly PlayerDbRow[],
  index: Map<number, SeasonStats>,
): PlayerDbRow[] {
  return rows.filter((row) => index.has(row.player.pid));
}

/** Sort keys across every column set — see `playerSortAccessors`. */
export type PlayerSortKey =
  | "name" | "pos" | "age" | "club" | "league" | "ovr" | "pot" | "value" | "wage" | "contract"
  | SkillKey
  | StatSortKey;

/**
 * The stat columns the season and career views share, in display order.
 *
 * `career` marks the ones a career total exists for: cards are recorded per
 * season and never summed into `StatTotals`, so the career view drops them
 * rather than showing a column of zeros.
 */
export const STAT_COLUMNS: {
  key: StatSortKey;
  label: string;
  title: string;
  /** How many decimals to show; 0 for a count. */
  decimals?: number;
  /**
   * Show a dash instead of 0. True only where zero means "no reading" rather
   * than a real zero: a match rating of 0 is a player who was never rated,
   * where 0 shots or 0.0 xG is a fact about a player who did play.
   */
  dashOnZero?: boolean;
  career: boolean;
}[] = [
  { key: "stat_appearances", label: "Apps", title: "Appearances", career: true },
  { key: "stat_minutesPlayed", label: "Min", title: "Minutes played", career: true },
  { key: "stat_goals", label: "G", title: "Goals", career: true },
  { key: "stat_assists", label: "A", title: "Assists", career: true },
  { key: "stat_shots", label: "Sh", title: "Shots", career: true },
  { key: "stat_shotsOnTarget", label: "SoT", title: "Shots on target", career: true },
  { key: "stat_xg", label: "xG", title: "Expected goals", decimals: 1, career: true },
  { key: "stat_tackles", label: "Tkl", title: "Tackles", career: true },
  { key: "stat_interceptions", label: "Int", title: "Interceptions", career: true },
  { key: "stat_saves", label: "Sv", title: "Saves", career: true },
  { key: "stat_passes", label: "Pass", title: "Passes attempted", career: true },
  { key: "stat_crosses", label: "Crs", title: "Crosses", career: true },
  { key: "stat_foulsCommitted", label: "Fls", title: "Fouls committed", career: true },
  { key: "stat_yellowCards", label: "YC", title: "Yellow cards", career: false },
  { key: "stat_redCards", label: "RC", title: "Red cards", career: false },
  {
    key: "stat_avgRating", label: "Rtg", title: "Average match rating",
    decimals: 2, dashOnZero: true, career: true,
  },
];

/**
 * The columns a view actually offers a header for.
 *
 * Needed because the sort survives a column-set switch: sort by Speed on the
 * Attributes view, switch to Overview, and that key has no header there — so
 * `sortRows` leaves the natural order and the table silently reads as unsorted.
 * The page falls back to its default sort instead, which is a visible answer
 * rather than an invisible one.
 */
export function sortKeysFor(columns: PlayerColumnSet): Set<PlayerSortKey> {
  const shared: PlayerSortKey[] = ["name", "pos", "age", "club"];
  switch (columns) {
    case "overview":
      return new Set([...shared, "league", "ovr", "pot", "value", "wage", "contract"]);
    case "attributes":
      return new Set<PlayerSortKey>([...shared, "ovr", ...SKILL_KEYS]);
    case "season":
      return new Set<PlayerSortKey>([...shared, ...STAT_COLUMNS.map((c) => c.key)]);
    case "career":
      return new Set<PlayerSortKey>([
        ...shared,
        ...STAT_COLUMNS.filter((c) => c.career).map((c) => c.key),
      ]);
  }
}

/**
 * Accessors for every sortable column, in one table so a column added to the
 * header and forgotten here fails to sort rather than sorting by something else.
 *
 * The stat lookups are passed in because they depend on which season is being
 * shown, and because the career one is expensive enough to build only when a
 * column reads it. A row with no line for the chosen season sorts as 0 rather
 * than being dropped — the season view already filters those out, and dropping
 * them here as well would make a sort silently change which rows exist.
 */
export function playerSortAccessors(
  clubName: (tid: number | null) => string,
  leagueName: (compId: number | null) => string,
  seasonStats?: Map<number, SeasonStats>,
  careerTotals?: Map<number, StatTotals>,
): Record<PlayerSortKey, (row: PlayerDbRow) => number | string> {
  const skills = Object.fromEntries(
    SKILL_KEYS.map((k) => [k, (row: PlayerDbRow) => row.player.ratings[k]]),
  ) as Record<SkillKey, (row: PlayerDbRow) => number>;
  // A career view has no season line and a season view has no career totals, so
  // whichever map is present is the one the stat columns are reading.
  const stat = (key: AllTimeStatKey) => (row: PlayerDbRow): number => {
    if (careerTotals) return careerTotals.get(row.player.pid)?.[key] ?? 0;
    const line = seasonStats?.get(row.player.pid);
    return line ? line[key] : 0;
  };
  const stats = Object.fromEntries(
    ALL_TIME_STAT_KEYS.map((k) => [`stat_${k}`, stat(k)]),
  ) as Record<StatSortKey, (row: PlayerDbRow) => number>;
  const line = (pick: (s: SeasonStats) => number) => (row: PlayerDbRow): number => {
    const s = seasonStats?.get(row.player.pid);
    return s ? pick(s) : 0;
  };
  return {
    ...skills,
    ...stats,
    // Cards are recorded per season only — `StatTotals` has no entry for them,
    // so they read off the season line whichever view is showing.
    stat_yellowCards: line((s) => s.yellowCards),
    stat_redCards: line((s) => s.redCards),
    name: (r) => r.player.name,
    pos: (r) => r.player.pos,
    age: (r) => r.age,
    club: (r) => clubName(r.tid),
    league: (r) => leagueName(r.compId),
    ovr: (r) => r.player.ovr,
    // Ceiling first, floor to break the tie. The floor is < 100, so dividing it
    // in orders strictly by (high, low) without a second comparator — and both
    // halves are numbers printed in the cell, so the column still reads as
    // sorted rather than ranking on anything hidden. See `scoutedPotFloor`.
    pot: (r) => r.scoutedPot + r.scoutedPotFloor / 100,
    value: (r) => r.value,
    wage: (r) => r.wage,
    contract: (r) => r.contractYears,
  };
}

/** One page of rows, clamped so an out-of-range page shows the last one. */
export function pageOf<T>(rows: readonly T[], page: number, size = PLAYER_DB_PAGE_SIZE): T[] {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(0, page), pages - 1);
  return rows.slice(clamped * size, clamped * size + size);
}

/** How many pages `rows` needs — at least 1, so the footer always reads sanely. */
export function pageCount(total: number, size = PLAYER_DB_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}
