import type { LeagueStore } from "../core/leagueState.js";
import type { Player } from "../core/players/types.js";
import type { StoredTeam } from "../core/teams/clubs.js";
import type { StandingsRow, TeamSeasonStats } from "../core/standings.js";
import { computeStandings, computeTeamSeasonStats } from "../core/standings.js";
import { computePowerRankingSnapshot } from "../core/teams/powerRanking.js";
import { budgetCap, financeScaleFor, wageBill } from "../core/finance/budget.js";
import { isFreeAgentTid } from "../core/transfers/negotiation.js";
import type { CompetitionScope } from "../core/competitions.js";
import { scopeCompIds } from "../core/competitions.js";

/**
 * The club database's row model — the world's 626 clubs with their strength,
 * their money and their season, kept out of the page so the derivations can be
 * tested directly.
 *
 * Strength comes from `computePowerRankingSnapshot` rather than a fresh call to
 * `computeTeamRating`, deliberately: it is the same number the Power Rankings
 * page shows, and two pages disagreeing about how good a club is reads as a bug.
 * It also brings form and this season's record along with it, so one pass over
 * the world covers three columns.
 */

export interface ClubDbRow {
  team: StoredTeam;
  compId: number;
  country: string;
  tier: number;
  leagueName: string;
  /** Squad rating: XI plus a depth-weighted bench, as Standings shows it. */
  ovr: number;
  pot: number;
  /** Squad rating blended with current-season form — the Power Rankings score. */
  powerScore: number;
  squadSize: number;
  /** Mean age of the senior squad, or 0 for an empty roster. */
  avgAge: number;
  budget: number;
  /** Season wage bill across the senior squad and the academy, as Finance shows it. */
  wages: number;
  hype: number;
  /** How full the club's savings ceiling is, 0-1 — see budgetCap. */
  capUsed: number;
  /** Fees paid out and taken in this season; loans and free moves are not fees. */
  spent: number;
  received: number;
  /** This season's league record, or null before a ball is kicked. */
  table: StandingsRow | null;
  /** Position within its own division, 1-based; null before anything is played. */
  rank: number | null;
  /** Box-score totals for the season — goals, shots, xG and the rest. */
  stats: TeamSeasonStats | null;
}

export type ClubColumnSet = "overview" | "finance" | "season";

export const CLUB_DB_PAGE_SIZE = 100;

/**
 * Every club in the world.
 *
 * Cost lives almost entirely in the two world-wide passes — the power-ranking
 * snapshot (a team rating per club) and `computeTeamSeasonStats` (every box
 * score of the season) — so callers must memoize this on the league object
 * rather than run it per keystroke.
 */
export function buildClubRows(league: LeagueStore): ClubDbRow[] {
  const season = league.season;
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const salaries = new Map(league.players.map((p) => [p.pid, p.contract.salary]));
  const compById = new Map(league.competitions.map((c) => [c.id, c]));

  const snapshot = computePowerRankingSnapshot(
    league.teams, league.players, league.played, season, league.played.length,
  );
  const powerByTid = new Map(snapshot.rows.map((r) => [r.tid, r]));

  // Standings are per competition — a league position only means anything
  // inside the division that produced it.
  const rankByTid = new Map<number, { row: StandingsRow; rank: number }>();
  for (const comp of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const rows = computeStandings(tids, league.played);
    // A table with nothing played is array order, not a ranking — see Finance,
    // which gates its "1st of 20" line on the same thing.
    const started = rows.some((r) => r.played > 0);
    rows.forEach((row, i) => rankByTid.set(row.tid, { row, rank: started ? i + 1 : 0 }));
  }

  const statsByTid = new Map(
    computeTeamSeasonStats(league.teams.map((t) => t.tid), league.played).map((s) => [s.tid, s]),
  );

  const spent = new Map<number, number>();
  const received = new Map<number, number>();
  for (const t of league.transfers) {
    // Only this season, and only real fees: a loan is not a purchase and a free
    // move has no fee to count. Same rule the Frivolities transfer boards use.
    if (t.season !== season || t.fee <= 0) continue;
    if (t.loanSeasons !== undefined || t.loanReturn) continue;
    if (isFreeAgentTid(t.fromTid) || isFreeAgentTid(t.toTid)) continue;
    spent.set(t.toTid, (spent.get(t.toTid) ?? 0) + t.fee);
    received.set(t.fromTid, (received.get(t.fromTid) ?? 0) + t.fee);
  }

  return league.teams.map((team): ClubDbRow => {
    const comp = compById.get(team.compId);
    const power = powerByTid.get(team.tid);
    const entry = rankByTid.get(team.tid);
    const roster = team.roster
      .map((pid) => byPid.get(pid))
      .filter((p): p is Player => p !== undefined);
    const scale = financeScaleFor(
      league.competitions, team.compId, team.tid, league.meta.userTid, league.difficulty,
    );
    const cap = budgetCap(scale, team.hype);
    return {
      team,
      compId: team.compId,
      country: comp?.country ?? "",
      tier: comp?.tier ?? 0,
      leagueName: comp?.name ?? "",
      ovr: power?.ovr ?? 0,
      pot: power?.pot ?? 0,
      powerScore: power?.powerScore ?? 0,
      squadSize: team.roster.length,
      avgAge: roster.length > 0
        ? roster.reduce((sum, p) => sum + (season - p.born), 0) / roster.length
        : 0,
      budget: team.budget,
      wages: wageBill([...team.roster, ...team.academyRoster], salaries),
      hype: team.hype,
      capUsed: cap > 0 ? Math.max(0, team.budget) / cap : 0,
      spent: spent.get(team.tid) ?? 0,
      received: received.get(team.tid) ?? 0,
      table: entry?.row ?? null,
      rank: entry && entry.rank > 0 ? entry.rank : null,
      stats: statsByTid.get(team.tid) ?? null,
    };
  });
}

export interface ClubDbFilters {
  scope: CompetitionScope;
  /** Case-insensitive substring match on the club's name or abbreviation. */
  name: string;
}

/**
 * Narrow the world before anything is ranked — the same rule the player table
 * follows, and for the same reason: the table pages, so filtering after the
 * slice would show the first hundred of a ranking nobody asked for.
 */
export function filterClubRows(
  rows: readonly ClubDbRow[],
  filters: ClubDbFilters,
  competitions: LeagueStore["competitions"],
): ClubDbRow[] {
  const compIds = scopeCompIds(competitions, filters.scope);
  const name = filters.name.trim().toLowerCase();
  return rows.filter((row) => {
    if (compIds && !compIds.has(row.compId)) return false;
    if (name) {
      const haystack = `${row.team.name} ${row.team.abbrev}`.toLowerCase();
      if (!haystack.includes(name)) return false;
    }
    return true;
  });
}

export type ClubSortKey =
  | "club" | "league" | "rank" | "ovr" | "pot" | "power" | "squad" | "age"
  | "budget" | "wages" | "hype" | "cap" | "spent" | "received" | "net"
  | "played" | "won" | "drawn" | "lost" | "points" | "gf" | "ga" | "gd"
  | "shots" | "sot" | "xg" | "xga" | "saves" | "tackles" | "possession" | "rating";

/**
 * Accessors for every sortable column, in one table so a header added without
 * one fails to sort rather than sorting by something else.
 *
 * A club with nothing played sorts as 0 rather than being dropped: the row is
 * still real, and hiding it because the season has not started would be a
 * stranger answer than showing a table of zeros.
 */
export function clubSortAccessors(): Record<ClubSortKey, (row: ClubDbRow) => number | string> {
  const table = (pick: (t: StandingsRow) => number) => (row: ClubDbRow) =>
    row.table ? pick(row.table) : 0;
  const stat = (pick: (s: TeamSeasonStats) => number) => (row: ClubDbRow) =>
    row.stats ? pick(row.stats) : 0;
  return {
    club: (r) => r.team.name,
    league: (r) => r.leagueName,
    // Unranked clubs sort last on an ascending "position" sort, which is where
    // "no position yet" belongs.
    rank: (r) => r.rank ?? Number.MAX_SAFE_INTEGER,
    ovr: (r) => r.ovr,
    pot: (r) => r.pot,
    power: (r) => r.powerScore,
    squad: (r) => r.squadSize,
    age: (r) => r.avgAge,
    budget: (r) => r.budget,
    wages: (r) => r.wages,
    hype: (r) => r.hype,
    cap: (r) => r.capUsed,
    spent: (r) => r.spent,
    received: (r) => r.received,
    net: (r) => r.received - r.spent,
    played: table((t) => t.played),
    won: table((t) => t.won),
    drawn: table((t) => t.drawn),
    lost: table((t) => t.lost),
    points: table((t) => t.points),
    gf: table((t) => t.gf),
    ga: table((t) => t.ga),
    gd: table((t) => t.gd),
    shots: stat((s) => s.shots),
    sot: stat((s) => s.shotsOnTarget),
    xg: stat((s) => s.xg),
    xga: stat((s) => s.xga),
    saves: stat((s) => s.saves),
    tackles: stat((s) => s.tackles),
    possession: stat((s) => s.possessionPct),
    rating: stat((s) => s.avgRating),
  };
}
