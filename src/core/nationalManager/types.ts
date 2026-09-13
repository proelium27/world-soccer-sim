/**
 * Managing a country as well as a club.
 *
 * The shape deliberately mirrors `core/manager` — a confidence balance, a list
 * of stints, a list of offers — because it is the same relationship seen from a
 * different chair, and two different-looking career screens for two jobs the
 * user holds at once would read as two different features.
 *
 * The one structural difference is that **having no nation is a legal state**.
 * A sacked club manager has to take another job before the save can move, since
 * every page in the game assumes a club; a manager with no country is simply
 * someone who only manages a club, which is what every save was before this
 * existed. That is why `nation` is nullable and why nothing here ever blocks
 * the offseason.
 */
import { NATIONAL_START_CONFIDENCE } from "../constants.js";
import type { CampaignVerdict } from "./confidence.js";

/**
 * One spell in charge of one country, oldest first. Raw results rather than a
 * derived score, for the same reason `ManagerStint` keeps raw results: the
 * reputation formula can then be retuned without rewriting anyone's career.
 */
export interface NationalStint {
  nation: string;
  /** The season you took the job (you manage its campaigns from this season's offseason on). */
  startSeason: number;
  /** The season you left, or null while this is your current job. */
  endSeason: number | null;
  /**
   * Campaigns seen through: qualifying campaigns, World Cups and confederation
   * cups all count one apiece. Counted rather than derived from seasons because
   * the cadence is uneven — a nation that misses out plays no tournament that
   * cycle, so seasons in charge says nothing about how often you were judged.
   */
  campaigns: number;
  /** World Cups won. */
  titles: number;
  /** Confederation championships won. */
  continentalTitles: number;
  /** Qualifying campaigns that ended with your nation reaching the finals. */
  qualifications: number;
  /**
   * Sum of each campaign's finish-versus-expectation, where 1.0 is finishing a
   * whole field's worth of places above where the nation's players said you
   * should. Negative means you underachieved on balance.
   */
  overperformance: number;
  /** How the spell ended — null while it's still running. */
  ending: "sacked" | "left" | null;
}

/** A federation willing to hand you its national team. */
export interface NationOffer {
  nation: string;
  confederation: string;
  /** Where this nation's players rank in the world, 1 = strongest. */
  rank: number;
  /** How many nations were ranked, so the rank reads as "8th of 44". */
  nations: number;
  /** How big a job this is, [0,1] — the scale offers are matched against. */
  prestige: number;
}

/**
 * The federation's verdict on one campaign, kept so the UI can explain why
 * confidence moved rather than only showing it move — the same argument
 * `ManagerVerdictRecord` makes.
 */
export interface NationalVerdictRecord extends CampaignVerdict {
  /** The season whose offseason played this campaign. */
  season: number;
  /** The nation judged, so an old verdict can't be read as the new job's. */
  nation: string;
  /** Confidence before this verdict, so the UI can show the move. */
  previousConfidence: number;
}

export interface NationalManagerState {
  /**
   * The country you manage, or null if you don't manage one. Null is an
   * ordinary, permanent, perfectly playable state — not a gap to be filled.
   */
  nation: string | null;
  /** The federation's confidence in you, 0-100. Meaningless while `nation` is null. */
  confidence: number;
  /** Your international career, oldest first. The last entry is the current job, if any. */
  stints: NationalStint[];
  /**
   * Countries on the table right now. Unlike club offers these are not cleared
   * by the offseason advancing — an international approach stands until you
   * answer it, because there is no boundary that forces an answer.
   */
  offers: NationOffer[];
  /**
   * The federation has dismissed you. Purely informational: `nation` is already
   * null by the time the user sees this, and it exists only so the Federation
   * page can lead with what happened instead of an empty room.
   */
  sacked: boolean;
  /** Save-level switch: when false the federation never dismisses you. */
  sackingEnabled: boolean;
  /** The federation's verdict on the most recent campaign it judged. */
  lastVerdict: NationalVerdictRecord | null;
  /**
   * Countries the user has said they'd like to manage (at most
   * `NATIONAL_MAX_INTERESTS`). The national twin of `ManagerState.interests`, and
   * optional for the same reason. Read through `nationInterests`.
   */
  interests?: string[];
}

/**
 * The national-manager state a save starts with. `nation` null is the default
 * and means "club football only", which is exactly what every save did before
 * this feature.
 */
export function emptyNationalManagerState(
  nation: string | null = null,
  season = 1,
  sackingEnabled = true,
): NationalManagerState {
  return {
    nation,
    confidence: NATIONAL_START_CONFIDENCE,
    stints: nation ? [newNationalStint(nation, season)] : [],
    offers: [],
    sacked: false,
    sackingEnabled,
    lastVerdict: null,
  };
}

export function newNationalStint(nation: string, startSeason: number): NationalStint {
  return {
    nation,
    startSeason,
    endSeason: null,
    campaigns: 0,
    titles: 0,
    continentalTitles: 0,
    qualifications: 0,
    overperformance: 0,
    ending: null,
  };
}

/** Your current international job — the open stint, if there is one. */
export function currentNationalStint(state: NationalManagerState): NationalStint | undefined {
  const last = state.stints[state.stints.length - 1];
  return last && last.endSeason === null ? last : undefined;
}
