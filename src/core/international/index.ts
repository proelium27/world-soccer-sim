import type { InternationalState } from "./types.js";

export type {
  InternationalState, IntlStage, IntlCareer, IntlSeasonLine, IntlTournament, IntlTournamentSummary,
  IntlQualifyingCampaign, IntlQualifyingSummary, IntlQualifyingPlayoff, IntlQualifyingPlayoffSummary, IntlGroup, IntlGroupMatch, IntlGroupTable,
  IntlKnockoutResult, IntlPowerSnapshot, NationSquad, IntlConfederationCup,
} from "./types.js";
export { emptyIntlCareer } from "./types.js";
export { groupTable, groupTableSummary, rankAcrossGroups, type GroupRow } from "./groups.js";
export {
  confederationOf, CONFEDERATIONS, CONFEDERATION_OF,
  CONFEDERATION_CUPS, confederationCupSpec, type ConfederationCupSpec,
} from "./confederations.js";
export {
  initConfederationCups, confederationCupGroupsPending, confederationCupKnockoutPending,
  summarizeConfederationCups, confederationCupChampions,
} from "./confederationCup.js";
export { formatFor, knockoutRounds, type TournamentFormat } from "./format.js";
export {
  nationForm, noNationForm, INTL_FORM_WINDOW, type NationFormStats,
} from "./nationForm.js";
export { qualifyingPlan, placesByPosition, playoffShape, type ConfederationQualifyingPlan } from "./qualifying.js";
export { runPlayoff } from "./qualifyingPlayoff.js";
export {
  buildSquads, selectSquad, isEligibleNation, manageableNations, nationPools,
  buildPowerSnapshot, squadRating, nationMatchData,
} from "./squads.js";
export {
  editableSquad, displaySquad, writeSquad, isValidNationSquad,
  type CampaignSlot, type FoundSquad,
} from "./userSquad.js";
export { finalTie, tournamentGoals, roundsRemaining, summarize, summarizeQualifying } from "./tournament.js";
export { nationRecords, finishOf, type NationRecord } from "./nationHistory.js";
export {
  isIntlStagePending, initInternationalCampaign, playIntlStage, simThroughInternational,
  applyCareerDelta,
} from "./staging.js";

export function emptyInternationalState(): InternationalState {
  return {
    qualifying: null, tournament: null, confederationCups: [], history: [],
    qualifyingHistory: [], confederationCupHistory: [], powerRankings: [],
    stage: null, stageInjuries: [],
  };
}
