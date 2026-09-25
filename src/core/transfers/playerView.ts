/**
 * How one player sees every club in the world, for the Player Profile's "How he
 * sees clubs" card (docs/club-reputation.md, Stage 3). The sibling of
 * `userView`: that one answers "how does everybody see the user's club", this
 * one "how does this player see everybody".
 *
 * It reads the same `clubAppealFor` the markets decide with, measured from where
 * the player stands (his club; his parent club while he is out on loan; the
 * stature he expects as a free agent), so the card shows the reasons he would
 * actually act on. Pure and rng-free; the club contexts are built once per
 * league object and shared by every profile opened against it.
 */
import type { Player } from "../players/types.js";
import type { LeagueStore } from "../leagueState.js";
import { clubAppealFor, type AppealFrom, type ClubAppeal } from "./clubAppeal.js";
import { playerChoice, type PlayerChoice } from "./playerChoice.js";
import { freeAgentStature } from "./playerWill.js";
import { interestOf, type Interest } from "./userView.js";

/** How many clubs each list shows. */
export const PLAYER_VIEW_LIST = 5;

export interface ClubInView {
  tid: number;
  appeal: ClubAppeal;
  interest: Interest;
}

export interface PlayerClubView {
  /** His view of the user's club, or null when he is already there or there is no user club. */
  yourClub: ClubInView | null;
  /** The clubs he would most like to join, best first. */
  favourites: ClubInView[];
  /** The best clubs where he would get games (playing time not against him), best first. */
  wouldPlay: ClubInView[];
  /** How many clubs he would refuse outright. */
  refusedCount: number;
  /** How many clubs were considered (every club but his own). */
  clubCount: number;
}

const choiceCache = new WeakMap<LeagueStore, PlayerChoice>();

function choiceFor(league: LeagueStore): PlayerChoice {
  let choice = choiceCache.get(league);
  if (!choice) {
    choice = playerChoice({
      teams: league.teams, players: league.players, competitions: league.competitions,
      season: league.season, played: league.played, model: league.progressionModel,
    }, league.meta.userTid);
    choiceCache.set(league, choice);
  }
  return choice;
}

/** The club a player belongs to: his roster or academy club, or his parent while he is out on loan. */
export function owningClub(league: LeagueStore, pid: number): number | null {
  const loan = (league.activeLoans ?? []).find((l) => l.pid === pid);
  if (loan) return loan.parentTid;
  const team = league.teams.find((t) => t.roster.includes(pid) || t.academyRoster.includes(pid));
  return team ? team.tid : null;
}

export function playerClubView(league: LeagueStore, player: Player): PlayerClubView {
  const choice = choiceFor(league);
  const userTid = league.meta.userTid;
  const ownTid = owningClub(league, player.pid);
  const ownCtx = ownTid === null ? undefined : choice.contexts.get(ownTid);
  // A free agent measures AI clubs against the stature he expects, as AI free
  // agency does; the user's club goes through freeAgentFrom, which knows he
  // never refuses to rejoin the club he last played for.
  const aiFrom: AppealFrom = ownCtx
    ? { stature: ownCtx.stature, club: ownCtx }
    : { stature: freeAgentStature(player, choice.statures, choice.worldMax) };
  const userFrom: AppealFrom = ownCtx ? aiFrom : choice.freeAgentFrom(player);

  const all: ClubInView[] = [];
  let refusedCount = 0;
  let yourClub: ClubInView | null = null;
  for (const ctx of choice.contexts.values()) {
    if (ctx.tid === ownTid) continue;
    const appeal = clubAppealFor(player, ctx, ctx.tid === userTid ? userFrom : aiFrom);
    const entry = { tid: ctx.tid, appeal, interest: interestOf(appeal) };
    if (ctx.tid === userTid) yourClub = entry;
    if (appeal.refused) refusedCount++;
    else all.push(entry);
  }
  all.sort((a, b) => b.appeal.score - a.appeal.score || a.tid - b.tid);
  const playing = (c: ClubInView) => (c.appeal.lines.find((l) => l.id === "playingTime")?.value ?? 0) >= 0;
  return {
    yourClub,
    favourites: all.slice(0, PLAYER_VIEW_LIST),
    wouldPlay: all.filter(playing).slice(0, PLAYER_VIEW_LIST),
    refusedCount,
    clubCount: all.length + refusedCount,
  };
}

/** The line that counts most either way, for a one-line reason ("Home country"). */
export function mainReason(appeal: ClubAppeal): string | null {
  let best: { label: string; value: number } | null = null;
  for (const l of appeal.lines) if (!best || Math.abs(l.value) > Math.abs(best.value)) best = l;
  return best ? best.label : null;
}
