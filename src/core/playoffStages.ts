import type { LeagueStore } from "./leagueState.js";
import {
  titlePlayoffsForSeason, titlePlayoffRoundsLeft, titlePlayoffRoundCount, titlePlayoffNextRoundName,
  titlePlayoffNextEntrants, playTitlePlayoffRound, titlePlayoffMatchData,
} from "./titlePlayoff.js";
import {
  playoffsForSeason, promotionPlayoffRoundsLeft, promotionPlayoffRoundCount,
  promotionPlayoffNextRoundName, promotionPlayoffNextEntrants, playPromotionPlayoffRound,
  promotionPlayoffMatchData,
} from "./promotionPlayoff.js";
import { reviewSeason } from "./manager/index.js";

/* ── Staged playoffs ─────────────────────────────────────────────────────────
 *
 * The game draws every title and promotion playoff the moment the league season
 * ends (`simThrough` with `stagePlayoffs`) and plays them a round per sim block,
 * the way the World Cup is played a stage at a time.
 *
 * **One block plays a round in every playoff with the most rounds left**, so
 * the blocks line up on the finals: MLS's wild cards go first, the brackets
 * with fewer rounds join as they come level, and every final is on the last
 * block. That is the same alignment the confederation cups use, and for the
 * same reason — the season should end on one click, not trail off league by
 * league.
 *
 * **The board's verdict waits for the finals.** Where a title or a promotion
 * place is played for, "did we win the league" and "did we go up" are not
 * questions the table can answer, so `reviewSeason` runs on the block that
 * decides the last of them, not when the season ends.
 *
 * Every tie keeps its own seeded stream (see titlePlayoff.ts and
 * promotionPlayoff.ts), and each block builds its match data from the squads
 * as they stand, so playing the rounds one by one lands on exactly what a single
 * pass plays on the same squads — which is what lets `simOffseason` finish any
 * rounds a caller left unplayed, and every headless caller keep the old
 * all-at-once path. The one thing staging adds is that a lineup the user sets
 * between blocks is the one his club plays with.
 * ──────────────────────────────────────────────────────────────────────── */

/** One playoff that plays a round in the next block. */
export interface PlayoffStageEntry {
  kind: "title" | "promotion";
  country: string;
  /** The division the place is played for: the top flight for a title, the division above for promotion. */
  compId: number;
  /** What the round is called ("Round one", "Semi-finals", "Playoff"). */
  roundName: string;
  /** Whether the user's club plays in this round. */
  includesUser: boolean;
}

function seasonPlayoffs(league: LeagueStore) {
  return {
    title: titlePlayoffsForSeason(league.titlePlayoffs, league.season),
    promotion: playoffsForSeason(league.promotionPlayoffs, league.season),
  };
}

/** The most rounds any of this season's playoffs has left — the depth the next block plays at. */
function topRoundsLeft(league: LeagueStore): number {
  const { title, promotion } = seasonPlayoffs(league);
  return Math.max(0, ...title.map(titlePlayoffRoundsLeft), ...promotion.map(promotionPlayoffRoundsLeft));
}

/** True while the season's playoffs have a round left to play (so the offseason waits). */
export function playoffsPending(league: LeagueStore): boolean {
  return league.phase === "offseason" && topRoundsLeft(league) > 0;
}

/** Which block comes next, out of how many this season's playoffs take. */
export function playoffStageProgress(league: LeagueStore): { stage: number; stages: number } {
  const { title, promotion } = seasonPlayoffs(league);
  const stages = Math.max(
    0,
    ...title.map((p) => titlePlayoffRoundCount(p.format)),
    ...promotion.map(promotionPlayoffRoundCount),
  );
  return { stage: stages - topRoundsLeft(league) + 1, stages };
}

/** Every playoff that plays a round in the next block. Empty when none is pending. */
export function nextPlayoffStage(league: LeagueStore): PlayoffStageEntry[] {
  const top = topRoundsLeft(league);
  if (top === 0) return [];
  const userTid = league.meta.userTid;
  const { title, promotion } = seasonPlayoffs(league);
  return [
    ...title.filter((p) => titlePlayoffRoundsLeft(p) === top).map((p): PlayoffStageEntry => ({
      kind: "title",
      country: p.country,
      compId: p.compId,
      roundName: titlePlayoffNextRoundName(p) ?? "",
      includesUser: titlePlayoffNextEntrants(p).has(userTid),
    })),
    ...promotion.filter((p) => promotionPlayoffRoundsLeft(p) === top).map((p): PlayoffStageEntry => ({
      kind: "promotion",
      country: p.country,
      compId: p.d1CompId,
      roundName: promotionPlayoffNextRoundName(p) ?? "",
      includesUser: promotionPlayoffNextEntrants(p).has(userTid),
    })),
  ];
}

/**
 * Play one block: the next round of every playoff with the most rounds left.
 * On the block that decides the last of them, the board reviews the season.
 * A no-op when nothing is pending.
 */
export function playPlayoffStage(league: LeagueStore): LeagueStore {
  if (league.phase !== "offseason") return league;
  const top = topRoundsLeft(league);
  if (top === 0) return league;
  const { title, promotion } = seasonPlayoffs(league);

  const titleNext = title.map((p) => (titlePlayoffRoundsLeft(p) === top
    ? playTitlePlayoffRound(p, titlePlayoffMatchData(p, league.teams, league.players, league.lid), league.lid)
    : p));
  const promotionNext = promotion.map((p) => (promotionPlayoffRoundsLeft(p) === top
    ? playPromotionPlayoffRound(p, promotionPlayoffMatchData(p, league.teams, league.players, league.lid), league.lid)
    : p));

  let next: LeagueStore = {
    ...league,
    titlePlayoffs: [...(league.titlePlayoffs ?? []).filter((p) => p.season !== league.season), ...titleNext],
    promotionPlayoffs: [...league.promotionPlayoffs.filter((p) => p.season !== league.season), ...promotionNext],
  };

  if (!playoffsPending(next)) {
    // The season is settled: the same review `simThrough` runs when a season
    // with no playoffs ends, now that it can say who won and who went up.
    next = {
      ...next,
      manager: reviewSeason({
        league: next,
        teams: next.teams,
        players: next.players,
        played: next.played,
        cup: next.cup,
        shield: next.shield,
        americasCup: next.americasCup,
        domesticCups: next.domesticCups,
        promotionPlayoffs: promotionNext,
        titlePlayoffs: titleNext,
      }).manager,
    };
  }
  return next;
}

/**
 * Play block after block until the playoffs are done — or, with
 * `stopBeforeUserRound`, until the next block is one the user's club plays in,
 * so he can set his lineup first. Always plays at least one block, so pressing
 * it on a round his club is in plays that round.
 */
export function simThroughPlayoffs(
  league: LeagueStore,
  options: { stopBeforeUserRound?: boolean } = {},
): LeagueStore {
  let current = league;
  for (let played = 0; playoffsPending(current) && played < 16; played++) {
    if (options.stopBeforeUserRound && played > 0 && nextPlayoffStage(current).some((e) => e.includesUser)) {
      break;
    }
    current = playPlayoffStage(current);
  }
  return current;
}
