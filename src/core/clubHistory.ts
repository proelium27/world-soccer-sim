import type { LeagueStore } from "./leagueState.js";
import type { StandingsRow } from "./standings.js";
import { tierOf } from "./competitions.js";
import { cupRunSummary } from "./cup/cup.js";
import { clubDomesticRun, clubDomesticRunLabel } from "./domesticCup/cup.js";
import { superCupChampion } from "./superCup/types.js";

/** One completed season from a single club's perspective. */
export interface ClubSeasonRecord {
  season: number;
  /** Competition the club played in *that* season (from the season's compsByTid snapshot). */
  compId: number;
  tier: number;
  /** 1-based finishing position within the club's competition that season. */
  position: number;
  teamsInComp: number;
  row: StandingsRow;
  /** Finished 1st in its competition that season. */
  champion: boolean;
  /** Moved up a tier for the *following* season (or, for the latest completed season, vs. the club's current tier). */
  promoted: boolean;
  /** Moved down a tier for the following season. */
  relegated: boolean;
  /** This club's Player of the Season winner that season, if any (0 or 1 pid). */
  playerOfSeasonPid: number | null;
  /** This club's Golden Boot winner that season, if any. */
  goldenBootPid: number | null;
  /** This club's players selected in the season's Team of the Season. */
  teamOfSeasonPids: number[];
  /** This club's Ballon d'Or winner that season, if any — the whole world's best player, not just this league's. */
  ballonDOrPid: number | null;
  /** This club's Goalkeeper of the Year that season, if any — again worldwide, not league by league. */
  goalkeeperOfYearPid: number | null;
  /** This club's Defender of the Year that season, if any. */
  defenderOfYearPid: number | null;
  /** This club's players selected in the season's World Team of the Year. */
  worldTeamOfYearPids: number[];
  /**
   * The club's Continental Cup run this season: a short stage label plus
   * champion / runner-up flags (format-aware for Swiss and legacy cups). Null if
   * it didn't take part or the world fields no cup.
   */
  cupRun: { note: string; isChampion: boolean; isRunnerUp: boolean } | null;
  /** The same, for the Continental Shield. A club plays one competition or the other, never both. */
  shieldRun: { note: string; isChampion: boolean; isRunnerUp: boolean } | null;
  /**
   * The club's domestic cup run this season — same shape as `cupRun`, and null
   * for a season played before the save had domestic cups.
   */
  domesticCupRun: { note: string; isChampion: boolean; isRunnerUp: boolean } | null;
  /**
   * League title, Continental Cup and domestic cup, all in the same season. The
   * thing every club is chasing and almost none of them get.
   */
  treble: boolean;
}

/** An individual honour won by one of the club's players in a given season. */
export interface ClubIndividualHonour {
  season: number;
  compId: number;
  pid: number;
}

export interface ClubHistory {
  tid: number;
  seasonsPlayed: number;
  /** Seasons (ending-season numbers) the club won a tier-1 title, newest first. */
  leagueTitles: number[];
  /** Seasons the club won a tier-2 title, newest first. */
  secondTierTitles: number[];
  /** Seasons at the end of which the club was promoted, newest first. */
  promotions: number[];
  /** Seasons at the end of which the club was relegated, newest first. */
  relegations: number[];
  /** Seasons the club won the Continental Cup, newest first. */
  cupTitles: number[];
  /** Seasons the club won its domestic cup, newest first. */
  domesticCupTitles: number[];
  /** Seasons the club won its league, the Continental Cup and its domestic cup. */
  trebles: number[];
  /** Seasons the club reached the Continental Cup final but lost it, newest first. */
  cupFinals: number[];
  /** Seasons the club won the Continental Shield, newest first. */
  shieldTitles: number[];
  /** Seasons the club reached the Continental Shield final but lost it, newest first. */
  shieldFinals: number[];
  /**
   * Seasons the club won a super cup, newest first — its country's, the
   * continental one, or both.
   *
   * **A season can legitimately appear twice**, which is why this is a list of
   * seasons rather than a set: the two competitions are separate trophies and a
   * club that is both league champion and Continental Cup holder contests them
   * both in the same preseason. Deduplicating would undercount the cabinet.
   *
   * Unlike every other honour here this is read off the super-cup records
   * directly rather than off a `ClubSeasonRecord`, because a super cup opens a
   * season rather than closing one — it belongs to no season's *table*, so
   * there is no per-season row for it to hang from.
   */
  superCupTitles: number[];
  playerOfSeason: ClubIndividualHonour[];
  goldenBoots: ClubIndividualHonour[];
  teamOfSeasonSelections: ClubIndividualHonour[];
  /** Seasons one of the club's players won the Ballon d'Or, newest first. */
  ballonDOrWinners: ClubIndividualHonour[];
  /** Seasons one of the club's players was the world's best goalkeeper, newest first. */
  goalkeeperOfYearWinners: ClubIndividualHonour[];
  /** Seasons one of the club's players was the world's best defender, newest first. */
  defenderOfYearWinners: ClubIndividualHonour[];
  /** World Team of the Year places won by the club's players, newest first. */
  worldTeamOfYearSelections: ClubIndividualHonour[];
  /** All-time aggregate record across every completed season. */
  totals: { played: number; won: number; drawn: number; lost: number; gf: number; ga: number };
  /** Best (lowest-numbered) finishing position ever, preferring a tier-1 finish; null if no seasons. */
  bestFinish: { season: number; position: number; tier: number } | null;
  mostPoints: { season: number; points: number } | null;
  mostWins: { season: number; won: number } | null;
  /** Every completed season, newest first. */
  seasons: ClubSeasonRecord[];
}

/**
 * Reconstruct a single club's honours and season-by-season record purely from
 * the append-only `seasonHistory` (final tables + per-competition awards) plus
 * the live player pool for award attribution. No schema change: everything
 * here is derived, matching the read-only nature of `awards.ts`.
 */
export function computeClubHistory(league: LeagueStore, tid: number): ClubHistory {
  const { seasonHistory, competitions, players } = league;
  // Oldest → newest so we can look at the *following* season for promotion.
  const ordered = [...seasonHistory].sort((a, b) => a.season - b.season);

  // Season → this club's stat tid for each player, so an award pid can be
  // attributed to the club the player actually played for that season.
  //
  // The live pool alone is not enough: retirement deletes a player from
  // `league.players`, so every award a retiree won here used to vanish from the
  // club's history the offseason he retired. Two records outlive him, and both
  // were copied from the same `SeasonStats.tid` read below, so they cannot
  // disagree with it: the retiree archive's per-season line (every season he
  // played, if his career cleared `isArchiveWorthy`) and the season's own
  // award snapshot (every winner, archived or not — see core/awardWinners.ts).
  const livePlayer = new Map(players.map((p) => [p.pid, p]));
  const archived = new Map((league.retiredPlayers ?? []).map((r) => [r.pid, r]));
  const snapshotTid = new Map<string, number>();
  for (const h of seasonHistory) {
    for (const w of h.awardWinners ?? []) {
      if (w.tid !== undefined) snapshotTid.set(`${w.pid}:${h.season}`, w.tid);
    }
  }
  const playerSeasonTid = new Map<string, number | undefined>();
  const seasonTidOf = (pid: number, season: number): number | undefined => {
    const key = `${pid}:${season}`;
    if (!playerSeasonTid.has(key)) {
      playerSeasonTid.set(
        key,
        livePlayer.get(pid)?.stats.find((s) => s.season === season)?.tid
          ?? archived.get(pid)?.seasons.find((s) => s.season === season)?.tid
          ?? snapshotTid.get(key),
      );
    }
    return playerSeasonTid.get(key);
  };

  const currentTeam = league.teams.find((t) => t.tid === tid);
  const currentTier = currentTeam ? tierOf(competitions, currentTeam.compId) : undefined;

  // Completed seasons' Continental Cups all live in cupHistory (the live
  // `league.cup` is always the current, not-yet-completed season's cup), so a
  // club's per-season cup run is a lookup keyed by season. Guard for old saves
  // and worlds that field no cup — both leave this empty.
  const cupBySeason = new Map((league.cupHistory ?? []).map((c) => [c.season, c]));
  const shieldBySeason = new Map((league.shieldHistory ?? []).map((c) => [c.season, c]));
  // A club only ever plays its own country's domestic cup, so one entry per
  // season is enough here even though eight cups run at once.
  const domesticBySeason = new Map(
    (league.domesticCupHistory ?? [])
      .filter((c) => c.teams.includes(tid))
      .map((c) => [c.season, c]),
  );

  // Super cups, read straight off their own records for the reason
  // ClubHistory.superCupTitles gives: one is played *before* a season rather
  // than during it, so no per-season table row describes it. The live field and
  // the archive are both read, exactly as the Cup page reads both — a season
  // appears in one or the other, never both.
  const superCupTitles = [
    ...(league.superCups ?? []),
    ...league.seasonHistory.flatMap((h) => h.superCups ?? []),
  ]
    .filter((sc) => superCupChampion(sc) === tid)
    .map((sc) => sc.season)
    .sort((a, b) => b - a);

  const records: ClubSeasonRecord[] = ordered.map((entry, i) => {
    const compId = entry.compsByTid[tid];
    const tier = tierOf(competitions, compId);
    // The stored table concatenates each competition's already-sorted rows, so
    // filtering to this club's competition preserves finishing order.
    const compRows = entry.table.filter((r) => entry.compsByTid[r.tid] === compId);
    const idx = compRows.findIndex((r) => r.tid === tid);
    const row = compRows[idx];
    const position = idx + 1;

    const nextTier =
      i + 1 < ordered.length
        ? tierOf(competitions, ordered[i + 1].compsByTid[tid])
        : currentTier;
    const promoted = nextTier !== undefined && nextTier < tier;
    const relegated = nextTier !== undefined && nextTier > tier;

    const awards = entry.awards[compId];
    const belongs = (pid: number | null): boolean =>
      pid !== null && seasonTidOf(pid, entry.season) === tid;

    const playerOfSeasonPid = awards && belongs(awards.playerOfSeasonPid) ? awards.playerOfSeasonPid : null;
    const goldenBootPid = awards && belongs(awards.goldenBootPid) ? awards.goldenBootPid : null;
    const teamOfSeasonPids = awards
      ? awards.teamOfSeason.filter((pid): pid is number => belongs(pid))
      : [];

    // Worldwide honours are stored once per season, not per competition, so
    // they're filtered to this club the same way: by who was here that season.
    const world = entry.world;
    const ballonDOrPid = world && belongs(world.ballonDOr[0]?.pid ?? null) ? world.ballonDOr[0].pid : null;
    // Optional on top of `world` itself being optional: a season played before
    // these two awards existed simply has no winner to credit (see WorldAwards).
    const bestKeeper = world?.goalkeeperOfYear?.[0]?.pid ?? null;
    const goalkeeperOfYearPid = belongs(bestKeeper) ? bestKeeper : null;
    const bestDefender = world?.defenderOfYear?.[0]?.pid ?? null;
    const defenderOfYearPid = belongs(bestDefender) ? bestDefender : null;
    const worldTeamOfYearPids = world
      ? world.worldTeamOfYear.filter((pid): pid is number => belongs(pid))
      : [];

    const cup = cupBySeason.get(entry.season);
    const cupRun = cup ? cupRunSummary(cup, tid) : null;
    const shield = shieldBySeason.get(entry.season);
    const shieldRun = shield ? cupRunSummary(shield, tid) : null;

    const domesticCup = domesticBySeason.get(entry.season);
    const domesticRound = domesticCup ? clubDomesticRun(domesticCup, tid) : null;
    const domesticCupRun = domesticCup && domesticRound !== null
      ? {
          note: clubDomesticRunLabel(domesticCup, tid)!,
          isChampion: domesticCup.championTid === tid,
          // Runner-up = went out in the last round of a cup that has a winner.
          isRunnerUp: domesticRound === domesticCup.totalRounds - 1
            && domesticCup.championTid !== null
            && domesticCup.championTid !== tid,
        }
      : null;

    return {
      season: entry.season,
      compId,
      tier,
      position,
      teamsInComp: compRows.length,
      row,
      champion: position === 1,
      promoted,
      relegated,
      playerOfSeasonPid,
      goldenBootPid,
      teamOfSeasonPids,
      ballonDOrPid,
      goalkeeperOfYearPid,
      defenderOfYearPid,
      worldTeamOfYearPids,
      cupRun,
      shieldRun,
      domesticCupRun,
      treble: position === 1 && tier === 1
        && cupRun?.isChampion === true
        && domesticCupRun?.isChampion === true,
    };
  });

  const totals = records.reduce(
    (acc, r) => ({
      played: acc.played + r.row.played,
      won: acc.won + r.row.won,
      drawn: acc.drawn + r.row.drawn,
      lost: acc.lost + r.row.lost,
      gf: acc.gf + r.row.gf,
      ga: acc.ga + r.row.ga,
    }),
    { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 },
  );

  // Best finish: a tier-1 finish always beats a tier-2 one; within a tier,
  // the lower position number wins; ties broken by the more recent season.
  let bestFinish: ClubHistory["bestFinish"] = null;
  for (const r of records) {
    if (
      bestFinish === null ||
      r.tier < bestFinish.tier ||
      (r.tier === bestFinish.tier && r.position < bestFinish.position)
    ) {
      bestFinish = { season: r.season, position: r.position, tier: r.tier };
    }
  }

  let mostPoints: ClubHistory["mostPoints"] = null;
  let mostWins: ClubHistory["mostWins"] = null;
  for (const r of records) {
    if (mostPoints === null || r.row.points > mostPoints.points) {
      mostPoints = { season: r.season, points: r.row.points };
    }
    if (mostWins === null || r.row.won > mostWins.won) {
      mostWins = { season: r.season, won: r.row.won };
    }
  }

  const newest = [...records].reverse();

  return {
    tid,
    seasonsPlayed: records.length,
    leagueTitles: newest.filter((r) => r.champion && r.tier === 1).map((r) => r.season),
    secondTierTitles: newest.filter((r) => r.champion && r.tier === 2).map((r) => r.season),
    promotions: newest.filter((r) => r.promoted).map((r) => r.season),
    relegations: newest.filter((r) => r.relegated).map((r) => r.season),
    cupTitles: newest
      .filter((r) => r.cupRun?.isChampion)
      .map((r) => r.season),
    cupFinals: newest
      .filter((r) => r.cupRun?.isRunnerUp)
      .map((r) => r.season),
    shieldTitles: newest
      .filter((r) => r.shieldRun?.isChampion)
      .map((r) => r.season),
    shieldFinals: newest
      .filter((r) => r.shieldRun?.isRunnerUp)
      .map((r) => r.season),
    superCupTitles,
    domesticCupTitles: newest
      .filter((r) => r.domesticCupRun?.isChampion)
      .map((r) => r.season),
    trebles: newest.filter((r) => r.treble).map((r) => r.season),
    playerOfSeason: newest
      .filter((r) => r.playerOfSeasonPid !== null)
      .map((r) => ({ season: r.season, compId: r.compId, pid: r.playerOfSeasonPid! })),
    goldenBoots: newest
      .filter((r) => r.goldenBootPid !== null)
      .map((r) => ({ season: r.season, compId: r.compId, pid: r.goldenBootPid! })),
    ballonDOrWinners: newest
      .filter((r) => r.ballonDOrPid !== null)
      .map((r) => ({ season: r.season, compId: r.compId, pid: r.ballonDOrPid! })),
    goalkeeperOfYearWinners: newest
      .filter((r) => r.goalkeeperOfYearPid !== null)
      .map((r) => ({ season: r.season, compId: r.compId, pid: r.goalkeeperOfYearPid! })),
    defenderOfYearWinners: newest
      .filter((r) => r.defenderOfYearPid !== null)
      .map((r) => ({ season: r.season, compId: r.compId, pid: r.defenderOfYearPid! })),
    worldTeamOfYearSelections: newest.flatMap((r) =>
      r.worldTeamOfYearPids.map((pid) => ({ season: r.season, compId: r.compId, pid })),
    ),
    teamOfSeasonSelections: newest.flatMap((r) =>
      r.teamOfSeasonPids.map((pid) => ({ season: r.season, compId: r.compId, pid })),
    ),
    totals,
    bestFinish,
    mostPoints,
    mostWins,
    seasons: newest,
  };
}
