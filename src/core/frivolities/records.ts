import type { LeagueStore } from "../leagueState.js";
import type { StandingsRow } from "../standings.js";
import { isFreeAgentTid } from "../transfers/negotiation.js";
import { allCareers, topBy, type CareerRow } from "./careers.js";
import type { ContinentalRegion } from "../constants.js";
import { americasTids, careerRegion, inRegion } from "../americasClubs.js";

/** How many rows each record list shows. Long enough to browse, short enough to read. */
export const RECORD_LIST_LIMIT = 25;

/** One club's single season, ranked against every other season ever played. */
export interface TeamSeasonRecord {
  season: number;
  tid: number;
  compId: number;
  tier: number;
  row: StandingsRow;
  /** Points per game — the honest cross-format comparison when league sizes differ. */
  ppg: number;
}

/** One completed transfer, resolved enough to render without further lookups. */
export interface TransferRecord {
  pid: number;
  name: string;
  /**
   * Empty when the player is no longer known to the save (sold years ago, then
   * retired below the archive's quality gate). The row is still a real transfer,
   * so it renders with a placeholder name and no flag rather than vanishing.
   */
  nationality: string;
  fromTid: number;
  toTid: number;
  fee: number;
  season: number;
}

export interface RecordBook {
  /** Best team seasons ever by points per game, best first. */
  bestTeamSeasons: TeamSeasonRecord[];
  /** Worst team seasons ever by points per game, worst first. */
  worstTeamSeasons: TeamSeasonRecord[];
  /** Highest ovr any player ever reached. */
  peakRatings: CareerRow[];
  /** Most league goals in a single season. */
  seasonGoals: CareerRow[];
  /** Most league assists in a single season. */
  seasonAssists: CareerRow[];
  /** All-time career league goals. */
  careerGoals: CareerRow[];
  /** All-time career league appearances. */
  careerAppearances: CareerRow[];
  /** All-time career league assists. */
  careerAssists: CareerRow[];
  /** Longest careers by seasons with an appearance. */
  longestCareers: CareerRow[];
  /** Biggest transfer fees ever paid. */
  biggestTransfers: TransferRecord[];
  /** Whether any archived retirees exist, so the UI can say the lists cover only the seasons this save recorded. */
  hasArchive: boolean;
}

/**
 * Every all-time list, computed in one pass over the save.
 *
 * Pure and read-only — this is a view over `seasonHistory`, `transfers`, the
 * live player pool and the retiree archive, and touches no rng. Nothing here is
 * persisted, so the lists correct themselves if the underlying data is ever
 * migrated or backfilled.
 *
 * The team-season lists rank by **points per game**, not raw points: league
 * sizes differ between competitions and a 2-up/2-down world can change a
 * division's size between seasons, so raw points would quietly rank the biggest
 * league's clubs above better seasons played in smaller ones.
 */
export function computeRecordBook(
  league: LeagueStore,
  limit = RECORD_LIST_LIMIT,
  /**
   * One continent's records: its clubs' seasons, careers spent mostly there,
   * and fees its clubs paid. Absent means the world.
   */
  region?: ContinentalRegion,
): RecordBook {
  const americas = new Set(americasTids(league.teams, league.competitions));
  const clubShown = (tid: number) => region === undefined || inRegion(tid, region, americas);
  const careers = allCareers(league)
    .filter((c) => region === undefined || careerRegion(c.seasons, americas) === region);

  // --- Team seasons -------------------------------------------------------
  const tierByCompId = new Map(league.competitions.map((c) => [c.id, c.tier]));
  const teamSeasons: TeamSeasonRecord[] = [];
  for (const h of league.seasonHistory) {
    for (const row of h.table) {
      if (row.played <= 0 || !clubShown(row.tid)) continue;
      // The season's own compsByTid snapshot, not the club's current
      // competition: promotion and relegation move clubs between tiers, so a
      // live lookup would file a title-winning D2 season under D1.
      const compId = h.compsByTid?.[row.tid] ?? 0;
      teamSeasons.push({
        season: h.season,
        tid: row.tid,
        compId,
        tier: tierByCompId.get(compId) ?? 1,
        row,
        ppg: row.points / row.played,
      });
    }
  }
  const byPpg = (a: TeamSeasonRecord, b: TeamSeasonRecord) =>
    b.ppg - a.ppg || b.row.gd - a.row.gd || a.tid - b.tid;

  // --- Transfers ----------------------------------------------------------
  // Free-agent arrivals carry the FREE_AGENT_TID sentinel and a zero fee, and
  // loan moves/returns aren't purchases — none belong on a "biggest fee" list.
  const careerByPid = new Map(careers.map((c) => [c.pid, c]));
  const biggestTransfers: TransferRecord[] = league.transfers
    .filter((t) => t.fee > 0 && !t.loanSeasons && !t.loanReturn
      && !isFreeAgentTid(t.fromTid) && !isFreeAgentTid(t.toTid)
      // Filed under the continent of the club that paid.
      && clubShown(t.toTid))
    .map((t) => ({
      pid: t.pid,
      // A player sold years ago may have since retired out of the archive; the
      // transfer row is still real, so it shows with a placeholder rather than
      // being dropped and silently shortening the list.
      name: careerByPid.get(t.pid)?.name ?? `Player ${t.pid}`,
      nationality: careerByPid.get(t.pid)?.nationality ?? "",
      fromTid: t.fromTid,
      toTid: t.toTid,
      fee: t.fee,
      season: t.season,
    }))
    .sort((a, b) => b.fee - a.fee || a.pid - b.pid)
    .slice(0, limit);

  return {
    bestTeamSeasons: [...teamSeasons].sort(byPpg).slice(0, limit),
    worstTeamSeasons: [...teamSeasons].sort((a, b) => -byPpg(a, b)).slice(0, limit),
    peakRatings: topBy(careers, (c) => c.peakOvr, limit),
    seasonGoals: topBy(careers, (c) => c.best.goals.value, limit),
    seasonAssists: topBy(careers, (c) => c.best.assists.value, limit),
    careerGoals: topBy(careers, (c) => c.totals.goals, limit),
    careerAppearances: topBy(careers, (c) => c.totals.appearances, limit),
    careerAssists: topBy(careers, (c) => c.totals.assists, limit),
    longestCareers: topBy(careers, (c) => c.seasonsPlayed, limit),
    biggestTransfers,
    hasArchive: (league.retiredPlayers ?? []).length > 0,
  };
}
