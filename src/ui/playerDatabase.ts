import type { LeagueStore } from "../core/leagueState.js";
import type { Player, SkillKey } from "../core/players/types.js";
import { SKILL_KEYS } from "../core/players/types.js";
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
export type PlayerStatus = "senior" | "academy" | "trial" | "free";

export interface PlayerDbRow {
  player: Player;
  /** Club he is on the books of, or null for a free agent. */
  tid: number | null;
  /** That club's competition, or null for a free agent. */
  compId: number | null;
  age: number;
  status: PlayerStatus;
  /**
   * Market value, priced on the *scouted* potential rather than the true one —
   * `trueTransferValue` pays a premium for an unfulfilled potential gap, so
   * pricing on the truth would turn the dollar figure into an exact read on a
   * hidden number. Same rule the Player Profile's value chart follows.
   */
  value: number;
  /** Weekly wage, matching the units the wage column shows. */
  wage: number;
  /** Seasons left on his deal, floored at 0. */
  contractYears: number;
  /** The scouting estimate of his potential — what the POT column sorts on. */
  scoutedPot: number;
}

/** Which block of columns the table is showing. See DESIGN.md §6. */
export type PlayerColumnSet = "overview" | "attributes";

/** Status filter values; "all" and "contracted" both cover several statuses. */
export type PlayerStatusFilter = "all" | "contracted" | "free" | "academy";

export const PLAYER_DB_PAGE_SIZE = 100;

/**
 * Every player in the world, each tagged with where he sits.
 *
 * Built by walking the clubs rather than the pool, because a player's club is
 * held on the *team* (`roster`/`academyRoster`/`youthTrialists`) and there is no
 * back-pointer on the player. Anyone no club claims is a free agent — the same
 * definition `freeAgentPids` uses, arrived at from the other side so the row
 * carries the club it found him on.
 */
export function buildPlayerRows(
  league: LeagueStore,
  scoutedPotOf: (p: Player) => number,
): PlayerDbRow[] {
  const season = league.season;
  const rows: PlayerDbRow[] = [];
  const claimed = new Set<number>();
  const byPid = new Map(league.players.map((p) => [p.pid, p]));

  const push = (player: Player, tid: number | null, compId: number | null, status: PlayerStatus) => {
    const scoutedPot = scoutedPotOf(player);
    rows.push({
      player,
      tid,
      compId,
      age: season - player.born,
      status,
      value: Math.round(trueTransferValue({ ...player, potential: scoutedPot }, season)),
      wage: weeklyWage(player.contract.salary),
      contractYears: Math.max(0, player.contract.expiresSeason - season),
      scoutedPot,
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
    add(team.youthTrialists ?? [], "trial");
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
    case "academy": return row.status === "academy" || row.status === "trial";
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

/** Sort keys the overview column set offers, plus the ones shared with it. */
export type PlayerSortKey =
  | "name" | "pos" | "age" | "club" | "league" | "ovr" | "pot" | "value" | "wage" | "contract"
  | SkillKey;

/**
 * Accessors for every sortable column, in one table so a column added to the
 * header and forgotten here fails to sort rather than sorting by something else.
 */
export function playerSortAccessors(
  clubName: (tid: number | null) => string,
  leagueName: (compId: number | null) => string,
): Record<PlayerSortKey, (row: PlayerDbRow) => number | string> {
  const skills = Object.fromEntries(
    SKILL_KEYS.map((k) => [k, (row: PlayerDbRow) => row.player.ratings[k]]),
  ) as Record<SkillKey, (row: PlayerDbRow) => number>;
  return {
    ...skills,
    name: (r) => r.player.name,
    pos: (r) => r.player.pos,
    age: (r) => r.age,
    club: (r) => clubName(r.tid),
    league: (r) => leagueName(r.compId),
    ovr: (r) => r.player.ovr,
    pot: (r) => r.scoutedPot,
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
