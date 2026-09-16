/**
 * Taking a national job and leaving one.
 *
 * Far lighter than `switchClub`, and for a structural reason worth stating: a
 * national team owns nothing. It has no budget, no contracts, no academy and no
 * roster of its own — a squad is a list of pids borrowed from clubs for one
 * campaign. So there is no handover to unwind, no wages to settle and no state
 * that an AI-run nation would be unable to cope with. The only thing the user
 * leaves behind is a hand-picked starting eleven, and that is cleared.
 *
 * Pure and rng-free.
 */
import type { LeagueStore } from "../leagueState.js";
import type { InternationalState, NationSquad } from "../international/types.js";
import { NATIONAL_START_CONFIDENCE } from "../constants.js";
import { newNationalStint, type NationalManagerState } from "./types.js";

/** Apply `fn` to every live squad belonging to `nation`, across all three campaign kinds. */
export function mapNationSquads(
  intl: InternationalState,
  nation: string,
  fn: (squad: NationSquad) => NationSquad,
): InternationalState {
  const mapSquads = (squads: NationSquad[]): NationSquad[] =>
    squads.map((s) => (s.nation === nation ? fn(s) : s));
  return {
    ...intl,
    qualifying: intl.qualifying ? { ...intl.qualifying, squads: mapSquads(intl.qualifying.squads) } : null,
    tournament: intl.tournament ? { ...intl.tournament, squads: mapSquads(intl.tournament.squads) } : null,
    confederationCups: intl.confederationCups.map((c) => ({ ...c, squads: mapSquads(c.squads) })),
  };
}

/**
 * Hand a nation back to the AI: drop the manual eleven so every remaining match
 * auto-picks again.
 *
 * The named 23 is deliberately *kept*. It was already named — by the AI at the
 * draw, or by the user afterwards — and re-naming it in the middle of a campaign
 * would be a bigger intervention than a change of manager warrants; a real
 * successor inherits the squad and picks a team from it, which is exactly what
 * clearing `starters` alone leaves the sim doing.
 */
function releaseNation(intl: InternationalState, nation: string): InternationalState {
  return mapNationSquads(intl, nation, (s) => (s.starters === null ? s : { ...s, starters: null }));
}

/**
 * Leave the national job, if there is one. `ending` records whether you walked
 * or were dismissed. A no-op when the user manages no nation.
 */
export function leaveNationalJob(league: LeagueStore, ending: "sacked" | "left"): LeagueStore {
  const state = league.nationalManager;
  const nation = state.nation;
  if (!nation) return league;

  const stints = state.stints.map((s, i) =>
    i === state.stints.length - 1 && s.endSeason === null
      ? { ...s, endSeason: league.season, ending }
      : s,
  );

  return {
    ...league,
    international: releaseNation(league.international, nation),
    nationalManager: {
      ...state,
      nation: null,
      stints,
      confidence: NATIONAL_START_CONFIDENCE,
      sacked: ending === "sacked",
      // Belongs to the country just left. Kept, it renders beside a fresh bar as
      // a verdict the next federation never delivered.
      lastVerdict: ending === "sacked" ? state.lastVerdict : null,
    },
  };
}

/**
 * Take charge of `nation`, leaving whatever national job you held first.
 *
 * Accepted at any point in the season, unlike a club switch, because none of
 * `switchClub`'s reasons to wait for the offseason apply: no wages have been
 * charged, no stint is dated a year into the future, and a campaign in progress
 * is simply inherited — which is what happens when a country changes manager
 * mid-cycle in reality.
 */
export function takeNationalJob(league: LeagueStore, nation: string): LeagueStore {
  if (league.nationalManager.nation === nation) return league;
  const left = leaveNationalJob(league, "left");
  const state: NationalManagerState = left.nationalManager;
  return {
    ...left,
    nationalManager: {
      ...state,
      nation,
      confidence: NATIONAL_START_CONFIDENCE,
      stints: [...state.stints, newNationalStint(nation, league.season)],
      offers: [],
      sacked: false,
      lastVerdict: null,
      // Taken, so no longer asked for; the club side's `switchClub` does the same.
      ...(state.interests ? { interests: state.interests.filter((n) => n !== nation) } : {}),
    },
  };
}
