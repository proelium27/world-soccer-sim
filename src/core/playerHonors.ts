import { squadTidInSeason } from "./players/careerSummary.js";
import type { Player } from "./players/types.js";
import type { ArchivedPlayer } from "./players/archive.js";
import type { SeasonHistoryEntry } from "./standings.js";
import type { CupState } from "./cup/types.js";
import type { DomesticCupState } from "./domesticCup/types.js";

/**
 * The completed cups a career is measured against. Passed in rather than read
 * off a LeagueStore so this file stays a pure derivation over history — and so
 * a caller that has neither (an old save, a test) can pass nothing.
 */
export interface HonorCups {
  cupHistory?: CupState[];
  shieldHistory?: CupState[];
  americasCupHistory?: CupState[];
  domesticCupHistory?: DomesticCupState[];
}

/** A player's career honours, each a list of the seasons he won it. */
export interface PlayerHonors {
  ballonDOr: number[];
  worldTeamOfYear: number[];
  /** Seasons he was named the best goalkeeper in the world. */
  goalkeeperOfYear: number[];
  /** Seasons he was named the best defender in the world. */
  defenderOfYear: number[];
  /** Seasons he won the Americas' own Player of the Year. */
  americasPlayerOfYear: number[];
  /** Seasons he made the Americas Team of the Year. */
  americasTeamOfYear: number[];
  /** Seasons he was the Americas Goalkeeper of the Year. */
  americasGoalkeeperOfYear: number[];
  /** Seasons he was the Americas Defender of the Year. */
  americasDefenderOfYear: number[];
  playerOfSeason: number[];
  goldenBoot: number[];
  teamOfSeason: number[];
  /** Seasons his club won its league *while he was in the squad*. */
  leagueTitles: number[];
  /** Seasons his club won the Continental Cup while he was in the squad. */
  continentalCups: number[];
  /** Seasons his club won the Continental Shield while he was in the squad. */
  shields: number[];
  /** Seasons his club won the Americas Cup while he was in the squad. */
  americasCups: number[];
  /** Seasons his club won its domestic cup while he was in the squad. */
  domesticCups: number[];
  hasAny: boolean;
}

/**
 * Which club a player was in the squad of during `season`, or undefined if
 * there's no record of him being on a senior roster at all that season.
 *
 * `SeasonStats` is the only per-season roster evidence the game keeps:
 * `accumulateStats` (simThrough.ts) opens a row for *every* player on either
 * club's roster on each matchday, so a squad member gets one even if he never
 * appears (verified on a simmed season: no roster player was missing a row, and
 * several had zero appearances). Its `tid` is the club he was on as of his most
 * recent matchday that season, which is also how `clubHistory.ts` attributes an
 * award to the club a player actually played for.
 *
 * Deliberately NOT reconstructed from transfer history (`teamForSeason` in
 * PlayerProfile): that walk has to guess at seasons before a player's first
 * recorded move, and its fallback is his present-day club — which would hand
 * every new arrival the club's entire back catalogue of titles, including ones
 * won before he was generated.
 */
function squadTidForSeason(player: Player, season: number): number | undefined {
  return squadTidInSeason(player, season);
}

/**
 * Derive a player's career honours from the completed seasons in
 * `seasonHistory`. Pure and re-runnable — nothing here is persisted.
 *
 * Individual awards (Ballon d'Or / World XI / POTY / Golden Boot / Team of the
 * Season) are stored by pid so they need no attribution. A league title is a
 * *team* honour, and is only credited for a season the player was actually in
 * the champion's squad.
 *
 * Mid-season transfers keep the existing whole-season attribution (see the
 * "mid-season transfer stat attribution" note in CLAUDE.md): a winter arrival
 * at the champions is credited, a winter departure is not.
 */
export function computePlayerHonors(
  player: Player,
  seasonHistory: SeasonHistoryEntry[],
  cups: HonorCups = {},
): PlayerHonors {
  return honorsOf(player.pid, (season) => squadTidForSeason(player, season), seasonHistory, cups);
}

/**
 * The same honours, for a player retirement has already deleted from the pool.
 *
 * `ArchivedPlayer.seasons` is the archive's stand-in for `Player.stats` — it
 * keeps one `{season, tid}` line per season he was in a squad, precisely so
 * this stays derivable. Routing both through `honorsOf` is what stops a
 * retiree's honours from drifting away from what his profile showed the season
 * before he retired (the same pairing `frivolities/goat.ts` maintains).
 */
export function computeArchivedHonors(
  archived: ArchivedPlayer,
  seasonHistory: SeasonHistoryEntry[],
  cups: HonorCups = {},
): PlayerHonors {
  const tidBySeason = new Map(archived.seasons.map((s) => [s.season, s.tid]));
  return honorsOf(archived.pid, (season) => tidBySeason.get(season), seasonHistory, cups);
}

/**
 * The shared walk over `seasonHistory`, parameterised only by how the caller
 * answers "which squad was he in that season" — the one thing a living player
 * and an archived retiree store differently.
 */
function honorsOf(
  pid: number,
  squadTid: (season: number) => number | undefined,
  seasonHistory: SeasonHistoryEntry[],
  cups: HonorCups,
): PlayerHonors {
  const ballonDOr: number[] = [];
  const worldTeamOfYear: number[] = [];
  const goalkeeperOfYear: number[] = [];
  const defenderOfYear: number[] = [];
  const americasPlayerOfYear: number[] = [];
  const americasTeamOfYear: number[] = [];
  const americasGoalkeeperOfYear: number[] = [];
  const americasDefenderOfYear: number[] = [];
  const playerOfSeason: number[] = [];
  const goldenBoot: number[] = [];
  const teamOfSeason: number[] = [];
  const leagueTitles: number[] = [];
  const continentalCups: number[] = [];
  const shields: number[] = [];
  const americasCups: number[] = [];
  const domesticCups: number[] = [];

  // Cup wins are team honours attributed exactly like a league title: the club
  // he was in the squad of that season. Both lists are keyed by season and
  // walked here rather than inside the seasonHistory loop, because a cup can
  // exist for a season that has no history entry yet.
  for (const cup of cups.cupHistory ?? []) {
    if (cup.championTid != null && squadTid(cup.season) === cup.championTid) {
      continentalCups.push(cup.season);
    }
  }
  for (const cup of cups.shieldHistory ?? []) {
    if (cup.championTid != null && squadTid(cup.season) === cup.championTid) {
      shields.push(cup.season);
    }
  }
  for (const cup of cups.americasCupHistory ?? []) {
    if (cup.championTid != null && squadTid(cup.season) === cup.championTid) {
      americasCups.push(cup.season);
    }
  }
  for (const cup of cups.domesticCupHistory ?? []) {
    if (cup.championTid != null && squadTid(cup.season) === cup.championTid) {
      domesticCups.push(cup.season);
    }
  }

  for (const entry of seasonHistory) {
    for (const compAwards of Object.values(entry.awards)) {
      if (compAwards.playerOfSeasonPid === pid) playerOfSeason.push(entry.season);
      if (compAwards.goldenBootPid === pid) goldenBoot.push(entry.season);
      if (compAwards.teamOfSeason.includes(pid)) teamOfSeason.push(entry.season);
    }
    // Optional-chained because a save written before worldwide awards only gets
    // `world` once migrateLeague has run over it.
    if (entry.world?.ballonDOr[0]?.pid === pid) ballonDOr.push(entry.season);
    if (entry.world?.worldTeamOfYear.includes(pid)) worldTeamOfYear.push(entry.season);
    // Only the winner of each, never the rest of the shortlist: these are pills
    // that say what he won. Both lists are optional on top of `world` already
    // being optional, because a season played before these awards existed has
    // no record of them and is never rescored (see WorldAwards).
    if (entry.world?.goalkeeperOfYear?.[0]?.pid === pid) goalkeeperOfYear.push(entry.season);
    if (entry.world?.defenderOfYear?.[0]?.pid === pid) defenderOfYear.push(entry.season);
    // The Americas' own set, on the same terms: winners only, absent before it existed.
    const americas = entry.world?.americas;
    if (americas?.ballonDOr[0]?.pid === pid) americasPlayerOfYear.push(entry.season);
    if (americas?.worldTeamOfYear.includes(pid)) americasTeamOfYear.push(entry.season);
    if (americas?.goalkeeperOfYear?.[0]?.pid === pid) americasGoalkeeperOfYear.push(entry.season);
    if (americas?.defenderOfYear?.[0]?.pid === pid) americasDefenderOfYear.push(entry.season);

    const tid = squadTid(entry.season);
    if (tid !== undefined && Object.values(entry.championTidByCompId).includes(tid)) {
      leagueTitles.push(entry.season);
    }
  }

  return {
    ballonDOr,
    worldTeamOfYear,
    goalkeeperOfYear,
    defenderOfYear,
    americasPlayerOfYear,
    americasTeamOfYear,
    americasGoalkeeperOfYear,
    americasDefenderOfYear,
    playerOfSeason,
    goldenBoot,
    teamOfSeason,
    leagueTitles,
    continentalCups,
    shields,
    americasCups,
    domesticCups,
    hasAny:
      ballonDOr.length > 0 ||
      worldTeamOfYear.length > 0 ||
      goalkeeperOfYear.length > 0 ||
      defenderOfYear.length > 0 ||
      americasPlayerOfYear.length > 0 ||
      americasTeamOfYear.length > 0 ||
      americasGoalkeeperOfYear.length > 0 ||
      americasDefenderOfYear.length > 0 ||
      playerOfSeason.length > 0 ||
      goldenBoot.length > 0 ||
      teamOfSeason.length > 0 ||
      leagueTitles.length > 0 ||
      continentalCups.length > 0 ||
      shields.length > 0 ||
      americasCups.length > 0 ||
      domesticCups.length > 0,
  };
}
