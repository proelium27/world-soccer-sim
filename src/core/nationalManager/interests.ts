/**
 * Saying which national jobs you'd like — the twin of `manager/interests.ts`.
 *
 * Validated against the countries federations actually rank (the latest power
 * snapshot), because that is the only set an offer can ever be drawn from: a
 * country outside it could sit on the list forever and never call.
 */
import type { LeagueStore } from "../leagueState.js";
import { NATIONAL_MAX_INTERESTS } from "../constants.js";
import type { NationalManagerState } from "./types.js";

export function nationInterests(state: NationalManagerState): string[] {
  return state.interests ?? [];
}

/** The countries an interest can name: every nation in the latest power ranking. */
export function rankedNations(league: LeagueStore): string[] {
  const snapshot = league.international.powerRankings[league.international.powerRankings.length - 1];
  return snapshot ? snapshot.ranks.map((r) => r.nation) : [];
}

/** Add or remove a country. Null when nothing changes, as `setClubInterest`. */
export function setNationInterest(league: LeagueStore, nation: string, on: boolean): LeagueStore | null {
  const state = league.nationalManager;
  const current = nationInterests(state);
  let next: string[];
  if (on) {
    if (current.includes(nation)) return null;
    if (nation === state.nation) return null;
    if (!rankedNations(league).includes(nation)) return null;
    if (current.length >= NATIONAL_MAX_INTERESTS) return null;
    next = [...current, nation];
  } else {
    if (!current.includes(nation)) return null;
    next = current.filter((n) => n !== nation);
  }
  return { ...league, nationalManager: { ...state, interests: next } };
}
