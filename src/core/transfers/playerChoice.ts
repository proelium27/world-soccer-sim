/**
 * Whether a player would actually choose the user's club, the same way he
 * chooses between AI clubs (docs/club-reputation.md, user call 2026-09-24).
 *
 *  - **A free agent** signs for the user only if the user's club is at least as
 *    good a fit, by his own view (`clubAppealFor`), as the best AI club that
 *    would want him. "Would want him" follows what AI free agency offers for: a
 *    club short at his position, one he'd start for, or (for a young
 *    high-potential player) a prospect place; it needs roster room, he mustn't
 *    refuse it, and its league's rules must let it register him. A tie goes to
 *    the user.
 *  - **A transfer target** who is Reluctant (his view of the user's club at or
 *    below INTEREST_RELUCTANT) turns the user's bid down.
 *
 * One module read by the signing actions and the screens, so the button and
 * the page cannot disagree. Pure and rng-free; builds the club contexts once,
 * then answers per player.
 */
import type { Player } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { Competition } from "../competitions.js";
import type { PlayedMatch } from "../standings.js";
import { deriveLeagueContexts, type ClubContext } from "../ai/clubContext.js";
import { appealScore, type AppealFrom } from "./clubAppeal.js";
import { freeAgentStature, lastClubTid, refusesFreeAgentSigningWith } from "./playerWill.js";
import { worldRules } from "../foreignRules.js";
import {
  ROSTER_CAP, ROSTER_COMPOSITION, AI_PROSPECT_MAX_AGE, AI_PROSPECT_MIN_POT,
  potentialBar, type ProgressionModel,
} from "../constants.js";

/** Appeal score at or above which a player is keen on a club, and at or below which he is reluctant. */
export const INTEREST_KEEN = 0.15;
export const INTEREST_RELUCTANT = -0.05;

export interface PlayerChoiceWorld {
  teams: StoredTeam[];
  players: Player[];
  competitions: readonly Competition[];
  season: number;
  played?: PlayedMatch[];
  model?: ProgressionModel;
}

export interface PlayerChoice {
  /** The club contexts the answers were built from. */
  contexts: Map<number, ClubContext>;
  /** Every club's stature, and the world's biggest. */
  statures: Map<number, number>;
  worldMax: number;
  /**
   * Where a free agent stands, and his view of the user's club measured from
   * there: the stature he expects, except that he never refuses to rejoin the
   * club he last played for.
   */
  freeAgentFrom(player: Player): AppealFrom;
  /**
   * The AI club a free agent would sign for instead of the user, or null if the
   * user's club is at least as good a fit as every AI club that wants him.
   */
  freeAgentRival(player: Player): { tid: number; score: number } | null;
  /** True if a transfer target at `sellerTid` would turn down the user's club. */
  reluctant(player: Player, sellerTid: number): boolean;
}

export function playerChoice(world: PlayerChoiceWorld, userTid: number): PlayerChoice {
  const contexts = deriveLeagueContexts({
    teams: world.teams, players: world.players, season: world.season,
    played: world.played ?? [], competitions: [...world.competitions],
  });
  const statures = new Map([...contexts].map(([tid, c]) => [tid, c.stature]));
  const worldMax = statures.size > 0 ? Math.max(...statures.values()) : 1;
  const byPid = new Map(world.players.map((p) => [p.pid, p]));
  const rules = worldRules(world.teams, world.competitions, (pid) => byPid.get(pid), world.season);
  const rosterOf = new Map(world.teams.map((t) => [t.tid, t.roster]));
  const prospectPot = potentialBar(AI_PROSPECT_MIN_POT, world.model ?? "random");
  const userCtx = contexts.get(userTid);

  const freeAgentFrom = (player: Player): AppealFrom => {
    const expected = freeAgentStature(player, statures, worldMax);
    return {
      stature: lastClubTid(player) === userTid && userCtx
        ? Math.min(expected, userCtx.stature)
        : expected,
    };
  };

  const wants = (ctx: ClubContext, player: Player): boolean => {
    const roster = rosterOf.get(ctx.tid) ?? [];
    if (roster.length >= ROSTER_CAP) return false;
    const short = ctx.posDepth[player.pos] < ROSTER_COMPOSITION[player.pos];
    const starts = player.ovr > ctx.posWeakestStarterOvr[player.pos];
    const prospect = world.season - player.born <= AI_PROSPECT_MAX_AGE && player.potential >= prospectPot;
    return short || starts || prospect;
  };

  return {
    contexts,
    statures,
    worldMax,
    freeAgentFrom,
    freeAgentRival(player) {
      if (!userCtx) return null;
      const from = freeAgentFrom(player);
      const mine = appealScore(player, userCtx, from);
      const bar = mine.refused ? -Infinity : mine.score;
      let best: { tid: number; score: number } | null = null;
      for (const ctx of contexts.values()) {
        if (ctx.tid === userTid || !wants(ctx, player)) continue;
        // His view of an AI club measured from the stature he expects, as AI
        // free agency measures it.
        const s = appealScore(player, ctx, { stature: freeAgentStature(player, statures, worldMax) });
        if (s.refused || s.score <= bar || (best && s.score <= best.score)) continue;
        // The costlier checks only for a club that would actually beat the user.
        if (refusesFreeAgentSigningWith(player, ctx.stature, statures, ctx.tid, worldMax)) continue;
        if (rules.block(ctx.tid, rosterOf.get(ctx.tid) ?? [], player)) continue;
        best = { tid: ctx.tid, score: s.score };
      }
      return best;
    },
    reluctant(player, sellerTid) {
      const sellerCtx = contexts.get(sellerTid);
      if (!userCtx || !sellerCtx) return false;
      const s = appealScore(player, userCtx, { stature: sellerCtx.stature, club: sellerCtx });
      return !s.refused && s.score <= INTEREST_RELUCTANT;
    },
  };
}
