/**
 * How players see the user's club, for the screens: one helper built once per
 * league, so every list that shows it (Free Agents, Transfers, the Watchlist,
 * the loan search) reads the same answer the AI decides with.
 * docs/club-reputation.md, A7.
 *
 * Pure; builds the league's club contexts once (through `playerChoice`, which
 * the signing actions read too), then answers per player.
 */
import type { Player } from "../players/types.js";
import type { LeagueStore } from "../leagueState.js";
import { clubAppealFor, type ClubAppeal } from "./clubAppeal.js";
import { worldRules, type RuleStanding } from "../foreignRules.js";
import { playerChoice, INTEREST_KEEN, INTEREST_RELUCTANT } from "./playerChoice.js";

export { INTEREST_KEEN, INTEREST_RELUCTANT };

export type Interest = "Keen" | "Open" | "Reluctant" | "Won't talk";

export function interestOf(appeal: ClubAppeal): Interest {
  if (appeal.refused) return "Won't talk";
  if (appeal.score >= INTEREST_KEEN) return "Keen";
  if (appeal.score <= INTEREST_RELUCTANT) return "Reluctant";
  return "Open";
}

/** "Playing time +0.10 · Home country +0.25", for a tooltip. */
export function appealBreakdown(appeal: ClubAppeal): string {
  if (appeal.lines.length === 0) return "Nothing either way";
  return appeal.lines
    .map((l) => `${l.label} ${l.value >= 0 ? "+" : "−"}${Math.abs(l.value).toFixed(2)}`)
    .join(" · ");
}

export interface UserSigningView {
  appeal: ClubAppeal;
  interest: Interest;
  /** Why the user's league rules would stop the signing, or null. */
  blocked: string | null;
}

export interface UserView {
  /**
   * How `player` sees a move to the user's club. `fromTid` is the club he would
   * leave (a transfer or loan); omit it for a free agent.
   */
  of(player: Player, fromTid?: number, loan?: boolean): UserSigningView | null;
  /**
   * The AI club a free agent would sign for instead of the user, or null when
   * the user's club is at least as good a fit (`playerChoice`).
   */
  freeAgentRival(player: Player): number | null;
  /** Where the user's squad stands against its league's rules; empty if it has none. */
  standings: RuleStanding[];
}

export function userView(league: LeagueStore): UserView {
  const userTid = league.meta.userTid;
  const user = league.teams.find((t) => t.tid === userTid);
  const choice = playerChoice({
    teams: league.teams, players: league.players, competitions: league.competitions,
    season: league.season, played: league.played, model: league.progressionModel,
  }, userTid);
  const userCtx = choice.contexts.get(userTid);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const rules = worldRules(league.teams, league.competitions, (pid) => byPid.get(pid), league.season);
  const squad = rules.forSquad(userTid, user?.roster ?? []);
  return {
    standings: user ? rules.standings(userTid, user.roster) : [],
    of(player, fromTid, loan) {
      if (!userCtx) return null;
      const fromCtx = fromTid === undefined ? undefined : choice.contexts.get(fromTid);
      const from = fromCtx ? { stature: fromCtx.stature, club: fromCtx } : choice.freeAgentFrom(player);
      const appeal = clubAppealFor(player, userCtx, from, { loan });
      return { appeal, interest: interestOf(appeal), blocked: squad.block(player) };
    },
    freeAgentRival(player) {
      return choice.freeAgentRival(player)?.tid ?? null;
    },
  };
}

/** "Foreign players 5 / 6" etc., for a league that has rules. */
export function standingLabel(s: RuleStanding): string {
  switch (s.rule.kind) {
    case "foreignCap":
      return s.rule.basis === "trained" ? `Not trained here ${s.count} / ${s.limit}` : `Foreign players ${s.count} / ${s.limit}`;
    case "nonEuCap":
      return `Non-EU players ${s.count} / ${s.limit}`;
    case "homegrownMin":
      return `Homegrown ${s.count} (at least ${s.limit})`;
    case "nationalMin":
      return `Home nationals ${s.count} (at least ${s.limit})`;
  }
}
