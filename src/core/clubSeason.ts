import type { LeagueStore } from "./leagueState.js";
import type { Position, SeasonStats } from "./players/types.js";
import type { StandingsRow } from "./standings.js";
import { computeStandings } from "./standings.js";
import { tierOf } from "./competitions.js";
import { computeClubHistory, type ClubSeasonRecord } from "./clubHistory.js";
import { cupRunSummary } from "./cup/cup.js";
import { clubDomesticRun, clubDomesticRunLabel } from "./domesticCup/cup.js";
import { computeTeamRating } from "./teams/teamRating.js";
import { teamSlots } from "./lineup/formations.js";
import { pointsDeductionMap } from "./finance/debt.js";

/** A cup or shield run, exactly as ClubSeasonRecord carries it. */
export type ClubRun = { note: string; isChampion: boolean; isRunnerUp: boolean } | null;

/**
 * One man in a club's squad for one season.
 *
 * Deliberately flat rather than a `Player` reference: half of a long dynasty's
 * historic squads are retirees, who no longer exist in `league.players` at all
 * and are known only from the compact archive. Both sources fill the same shape
 * so the page never has to ask which kind it is holding.
 */
export interface ClubSeasonPlayer {
  pid: number;
  name: string;
  nationality: string;
  pos: Position;
  /** The rating he played *that* season at, not his rating today. */
  ovr: number;
  /** His age during that season. */
  age: number;
  appearances: number;
  /**
   * His league stat line for the season, or null for a player known only from
   * the retiree archive — that keeps career totals and a best-season figure per
   * stat, but not a row per season, so his goals and assists that year are
   * genuinely gone rather than merely unfetched.
   */
  stats: SeasonStats | null;
  /** He is gone from the live pool and this row was rebuilt from the retiree archive. */
  fromArchive: boolean;
}

/** Where a club stood in the Power Rankings at the end of a season. */
export interface ClubSeasonPower {
  /** Rank among every club in the world by Power score. */
  worldRank: number;
  worldTotal: number;
  /** Rank within the club's own competition. */
  divisionRank: number;
  divisionTotal: number;
  powerScore: number;
  ovr: number;
  pot: number;
  /** The matchday the snapshot was taken after — the season finale for a completed season. */
  matchday: number;
}

/** Everything one club did in one season, gathered for the club-season page. */
export interface ClubSeason {
  tid: number;
  season: number;
  /** This is the season currently being played, so nothing here is final. */
  live: boolean;
  /**
   * The season's football is over but the offseason hasn't rolled it into
   * history yet. The table and the cup runs are final; promotion, relegation
   * and the awards are not, because they are decided in the offseason.
   */
  awaitingRollover: boolean;
  compId: number;
  tier: number;
  /** 1-based finishing position in the club's own competition; the live table's order mid-season. */
  position: number;
  teamsInComp: number;
  row: StandingsRow;
  champion: boolean;
  promoted: boolean;
  relegated: boolean;
  cupRun: ClubRun;
  shieldRun: ClubRun;
  domesticCupRun: ClubRun;
  treble: boolean;
  /** Individual honours won by this club's players that season; empty for a live season, which has none yet. */
  playerOfSeasonPid: number | null;
  goldenBootPid: number | null;
  teamOfSeasonPids: number[];
  ballonDOrPid: number | null;
  worldTeamOfYearPids: number[];
  squad: ClubSeasonPlayer[];
  /** How many of the squad had to be rebuilt from the retiree archive. */
  fromArchiveCount: number;
  power: ClubSeasonPower | null;
  /**
   * The squad's rating right now, for the season being played.
   *
   * The Power Rankings only snapshot every few matchdays, so at kickoff there is
   * nothing to read and the rating card would sit empty on exactly the season a
   * reader is most likely to open. Null for a completed season, where the
   * snapshot taken at the finale is the real answer and this would report
   * today's squad instead.
   */
  liveRating: { ovr: number; pot: number } | null;
}

/**
 * Rebuild a club's squad for a past season.
 *
 * No per-season roster is persisted, so this reads the two records that survive.
 * `Player.stats` opens a row for every player on the matchday squad, appearance
 * or not (see accumulateStats in simThrough.ts), which makes it the game's only
 * squad-membership record; `ArchivedPlayer.seasons` is the same line kept for a
 * retiree after the player object is deleted.
 *
 * Two limits are inherent and are stated on the page rather than papered over.
 * `SeasonStats.tid` is the club he *finished* the season at (open decision #4),
 * so a winter signing appears only at his new club and a winter departure only
 * at his old one — this is the end-of-season squad. And the retiree archive is
 * quality-gated and hard-capped, so a squad from the distant past is missing
 * whoever fell out of it.
 */
function historicSquad(league: LeagueStore, tid: number, season: number): ClubSeasonPlayer[] {
  const squad: ClubSeasonPlayer[] = [];

  for (const p of league.players) {
    const stats = p.stats.find((s) => s.season === season && s.tid === tid);
    if (!stats) continue;
    squad.push({
      pid: p.pid,
      name: p.name,
      nationality: p.nationality,
      pos: p.pos,
      // The snapshot stamped at the end of season N-1 is the rating he carried
      // through N — the same offset ovrDuringSeason and ArchivedSeason use.
      ovr: p.hist.find((h) => h.season === season - 1)?.ovr ?? p.ovr,
      age: season - p.born,
      appearances: stats.appearances,
      stats,
      fromArchive: false,
    });
  }

  for (const a of league.retiredPlayers ?? []) {
    const line = a.seasons.find((s) => s.season === season && s.tid === tid);
    if (!line) continue;
    squad.push({
      pid: a.pid,
      name: a.name,
      nationality: a.nationality,
      pos: a.pos,
      ovr: line.ovr,
      age: season - a.born,
      appearances: line.apps,
      stats: null,
      fromArchive: true,
    });
  }

  return squad;
}

/** The club's current senior squad, for the season still being played. */
function liveSquad(league: LeagueStore, tid: number, season: number): ClubSeasonPlayer[] {
  const team = league.teams.find((t) => t.tid === tid);
  if (!team) return [];
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const squad: ClubSeasonPlayer[] = [];
  for (const pid of team.roster) {
    const p = byPid.get(pid);
    if (!p) continue;
    const stats = p.stats.find((s) => s.season === season) ?? null;
    squad.push({
      pid: p.pid,
      name: p.name,
      nationality: p.nationality,
      pos: p.pos,
      // Mid-season his live ovr *is* the rating he is playing at — ratings only
      // move in the offseason.
      ovr: p.ovr,
      age: season - p.born,
      appearances: stats?.appearances ?? 0,
      stats,
      fromArchive: false,
    });
  }
  return squad;
}

/** Where the club sat in the last Power Rankings snapshot taken during a season. */
function powerFor(league: LeagueStore, tid: number, season: number): ClubSeasonPower | null {
  let latest: (typeof league.powerRankingHistory)[number] | undefined;
  for (const s of league.powerRankingHistory ?? []) {
    if (s.season !== season) continue;
    if (!latest || s.matchday > latest.matchday) latest = s;
  }
  if (!latest) return null;

  const worldIndex = latest.rows.findIndex((r) => r.tid === tid);
  if (worldIndex < 0) return null;
  const row = latest.rows[worldIndex];
  // Rows arrive already sorted by Power score across the whole world, so
  // filtering to one competition preserves that order and the index is the
  // divisional rank — the same derivation the Power Rankings page makes.
  const divisionRows = latest.rows.filter((r) => r.compId === row.compId);

  return {
    worldRank: worldIndex + 1,
    worldTotal: latest.rows.length,
    divisionRank: divisionRows.findIndex((r) => r.tid === tid) + 1,
    divisionTotal: divisionRows.length,
    powerScore: row.powerScore,
    ovr: row.ovr,
    pot: row.pot,
    matchday: latest.matchday,
  };
}

/** The club's run in a live (unfinished) domestic cup, in the same shape a completed one takes. */
function liveDomesticRun(league: LeagueStore, tid: number): ClubRun {
  const cup = (league.domesticCups ?? []).find((c) => c.teams.includes(tid));
  if (!cup) return null;
  const round = clubDomesticRun(cup, tid);
  if (round === null) return null;
  const label = clubDomesticRunLabel(cup, tid);
  if (label === null) return null;
  return {
    note: label,
    isChampion: cup.championTid === tid,
    isRunnerUp:
      round === cup.totalRounds - 1 && cup.championTid !== null && cup.championTid !== tid,
  };
}

/** Fold a completed season's ClubSeasonRecord into the page's shape. */
function fromRecord(
  league: LeagueStore,
  tid: number,
  record: ClubSeasonRecord,
): ClubSeason {
  const squad = historicSquad(league, tid, record.season);
  return {
    tid,
    season: record.season,
    live: false,
    compId: record.compId,
    tier: record.tier,
    position: record.position,
    teamsInComp: record.teamsInComp,
    row: record.row,
    champion: record.champion,
    promoted: record.promoted,
    relegated: record.relegated,
    cupRun: record.cupRun,
    shieldRun: record.shieldRun,
    domesticCupRun: record.domesticCupRun,
    treble: record.treble,
    awaitingRollover: false,
    liveRating: null,
    playerOfSeasonPid: record.playerOfSeasonPid,
    goldenBootPid: record.goldenBootPid,
    teamOfSeasonPids: record.teamOfSeasonPids,
    ballonDOrPid: record.ballonDOrPid,
    worldTeamOfYearPids: record.worldTeamOfYearPids,
    squad,
    fromArchiveCount: squad.filter((p) => p.fromArchive).length,
    power: powerFor(league, tid, record.season),
  };
}

/** The season currently being played, assembled from live state rather than history. */
function currentSeason(league: LeagueStore, tid: number): ClubSeason | null {
  const team = league.teams.find((t) => t.tid === tid);
  if (!team) return null;
  const season = league.season;
  const compId = team.compId;

  const compTids = league.teams.filter((t) => t.compId === compId).map((t) => t.tid);
  const compTidSet = new Set(compTids);
  const table = computeStandings(
    compTids,
    league.played.filter((m) => compTidSet.has(m.home)),
    pointsDeductionMap(league.debtSanctions, season),
  );
  const index = table.findIndex((r) => r.tid === tid);

  const squad = liveSquad(league, tid, season);

  return {
    tid,
    season,
    live: true,
    awaitingRollover: league.phase === "offseason",
    compId,
    tier: tierOf(league.competitions, compId),
    position: index + 1,
    teamsInComp: table.length,
    row: table[index],
    // Nothing is won until the season ends, so a club top of the table in
    // February is not the champion.
    champion: false,
    promoted: false,
    relegated: false,
    cupRun: league.cup ? cupRunSummary(league.cup, tid) : null,
    shieldRun: league.shield ? cupRunSummary(league.shield, tid) : null,
    domesticCupRun: liveDomesticRun(league, tid),
    treble: false,
    playerOfSeasonPid: null,
    goldenBootPid: null,
    teamOfSeasonPids: [],
    ballonDOrPid: null,
    worldTeamOfYearPids: [],
    squad,
    fromArchiveCount: 0,
    power: powerFor(league, tid, season),
    liveRating: computeTeamRating(
      league.players.filter((p) => team.roster.includes(p.pid)),
      team.starters,
      teamSlots(team),
    ),
  };
}

/**
 * Whether the save has any record of a season at all — the one being played, or
 * one that finished and left a `seasonHistory` entry.
 *
 * Worth exporting rather than leaving to `computeClubSeason` returning null,
 * because the caller that needs it most is a *link*: a player's ratings history
 * carries a baseline snapshot stamped at league creation, labelled season 0,
 * which is a season nobody ever played. Linking it lands the reader on a page
 * that can only say it has no record, so the label stays plain text instead.
 */
export function hasClubSeason(league: LeagueStore, season: number): boolean {
  return season === league.season || league.seasonHistory.some((h) => h.season === season);
}

/**
 * Everything one club did in one season: where it finished, how its three cup
 * runs went, where the Power Rankings had it, and who was in the squad.
 *
 * Pure and derived — no schema change, so every save can open any season of any
 * club it has history for. Returns null for a season the club has no record of.
 *
 * The completed-season path goes through `computeClubHistory` rather than
 * re-deriving the finish and the cup runs, so this page and the Club History
 * page can never disagree about the same season.
 */
export function computeClubSeason(
  league: LeagueStore,
  tid: number,
  season: number,
): ClubSeason | null {
  if (season === league.season) return currentSeason(league, tid);
  const record = computeClubHistory(league, tid).seasons.find((s) => s.season === season);
  return record ? fromRecord(league, tid, record) : null;
}
