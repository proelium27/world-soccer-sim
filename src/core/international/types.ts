import type { BoxScore } from "../../engine/attribution.js";
import type { CupTie } from "../cup/types.js";
import type { FormationId } from "../lineup/formations.js";

/**
 * A nation's named squad for one campaign. Within a campaign a nation is
 * identified by its `nid` — its index into that campaign's `nations` array —
 * because the match sim and the knockout code both key teams by number. Nation
 * *names* are what persist across campaigns; nids are only stable inside one.
 */
export interface NationSquad {
  nation: string;
  /** INTL_SQUAD_SIZE pids at most (fewer if the nation's pool is thin). */
  pids: number[];
  formation: FormationId;
  /** Mean OVR of the named squad — seeds the draw, then display only. */
  rating: number;
  /**
   * The eleven the manager picked, or null to auto-select via `selectXI`.
   *
   * The exact counterpart of `StoredTeam.starters`, down to the fallback: an
   * array that no longer resolves (a player retired mid-cycle, or picked up an
   * injury after being named) is silently replaced by the auto-pick rather than
   * fielding ten. Only ever set for the nation the user manages — every other
   * nation, and every nation in a save that manages none, auto-picks, which is
   * what international football did before management existed.
   *
   * Optional so squads named before this field existed need no backfill; absent
   * already means what it should.
   */
  starters?: number[] | null;
}

/**
 * One 90' group match. Group games can end level (no extra time), so unlike a
 * knockout tie this carries only the scoreline. `boxScore` is null for archived
 * campaigns and for qualifying, which is played in bulk and never keeps its
 * per-match attribution (see InternationalState).
 */
export interface IntlGroupMatch {
  group: number;
  round: number;
  /**
   * Which leg of the round-robin this fixture belongs to (0-based). Qualifying
   * plays one leg per offseason across the cycle, so the leg says which offseason
   * a fixture is played in; tournament groups are single-leg (all leg 0).
   * Optional for legacy campaigns saved before legs were tagged (treated as 0).
   */
  leg?: number;
  home: number; // nid
  away: number; // nid
  homeGoals: number;
  awayGoals: number;
  boxScore: BoxScore | null;
}

/** One group: its nations in seed order plus its full single round-robin. */
export interface IntlGroup {
  nids: number[];
  matches: IntlGroupMatch[];
  /** Confederation this group qualifies through; null for tournament groups (mixed by design). */
  confederation: string | null;
}

/**
 * A completed qualifying campaign: every eligible nation, split into
 * confederation groups, playing a single round-robin for the places its
 * confederation was allocated. Played in one pass during an odd season's
 * offseason; `qualified` is what the next tournament is built from.
 */
export interface IntlQualifyingCampaign {
  /** The season whose offseason played this campaign. */
  season: number;
  nations: string[]; // nid → nation name
  squads: NationSquad[]; // parallel to `nations`
  groups: IntlGroup[];
  /** The `fieldSize` qualifiers, strongest first — the next tournament's field. */
  qualified: string[];
  /**
   * How many places this campaign is playing for: the World Cup's size, fixed
   * the moment the campaign is drawn from the save's `worldCupSize` setting.
   * Absent on a campaign drawn before the size could vary, which means
   * INTL_FIELD_SIZE (32) — what every one of them was.
   */
  fieldSize?: number;
  /**
   * Places per confederation, recorded at the draw. Stored rather than
   * recomputed because the rule behind it can change (the per-group floor did,
   * 2026-09-11) and a campaign spans three offseasons: recomputing at the last
   * leg would hand out a different allocation from the one its groups were
   * drawn for. Absent on an older campaign, which replays the rule it was
   * drawn under — see planQualifying.
   */
  places?: Record<string, number>;
  /**
   * The playoffs that decided each confederation's last places, filled when the
   * final leg is played (see qualifyingPlayoff.ts). Optional so a campaign
   * finished before playoffs existed, which filled those places on points,
   * needs no backfill: absent is exactly what happened.
   */
  playoffs?: IntlQualifyingPlayoff[];
}

/**
 * One round of a qualifying playoff. In a `qualifies` round every winner is
 * through; otherwise the winners play on and the losers are out.
 */
export interface IntlQualifyingPlayoffRound {
  qualifies: boolean;
  /** Single-leg ties, better seed at home. `boxScore` is always null, as for every qualifier. */
  ties: CupTie[];
}

/**
 * The playoff between every nation that finished in a confederation's partly
 * qualifying position (the third-placed sides, say) for the places that
 * position was given. Group record only seeds it.
 */
export interface IntlQualifyingPlayoff {
  confederation: string;
  /** Finishing position the entrants shared, 0 = group winners. */
  position: number;
  places: number;
  /** Entrants' nids, best group record first (per-game, see rankAcrossGroups). */
  entrants: number[];
  rounds: IntlQualifyingPlayoffRound[];
  /** Nids that won a place, in the order they won it. */
  qualified: number[];
}

/** An archived qualifying playoff: the same record keyed by nation name. */
export interface IntlQualifyingPlayoffSummary {
  confederation: string;
  position: number;
  places: number;
  entrants: string[];
  rounds: { qualifies: boolean; results: IntlKnockoutResult[] }[];
  qualified: string[];
}

/**
 * One tournament: groups of four whose top two — plus, at a 24- or 48-nation
 * World Cup, the best third-placed sides (see WORLD_CUP_FORMATS) — feed a
 * power-of-two bracket. The knockout reuses the
 * Continental Cup's `CupTie` and `resolveCupTie` outright — the shape is
 * identical (scoreline after extra time, shootout recorded separately, winner,
 * box score) and `home`/`away` being plain numbers means nids drop straight in.
 * `matchday` on those ties is always 0: international football has no place in
 * the club calendar.
 */
export interface IntlTournament {
  /** The season whose offseason played this tournament. */
  season: number;
  name: string;
  nations: string[]; // nid → nation name
  squads: NationSquad[]; // parallel to `nations`
  groups: IntlGroup[];
  /** The knockout's nids in bracket order (16 at a 32-nation World Cup); empty until the groups complete. */
  bracket: number[];
  ties: CupTie[]; // round 0 = the first knockout round, the last = the final
  championNid: number | null;
}

/**
 * A confederation cup — the Euro, Copa America, AFCON and their siblings
 * (see CONFEDERATION_CUPS). Structurally an IntlTournament and played by
 * the very same functions; what it adds is which confederation it belongs to
 * and how many nations advance from each group, because unlike the World Cup
 * its shape is not fixed. A confederation with two dozen eligible nations plays
 * four groups of four into an eight-nation bracket; one with five plays a single
 * round-robin whose top two contest the final (see format.ts).
 *
 * Several of these are live at once — they are all played in the same offseason
 * — so they sit in an array rather than the single slot the World Cup occupies.
 */
export interface IntlConfederationCup extends IntlTournament {
  confederation: string;
  /** Nations advancing from each group; the rest of the shape follows from `groups`. */
  qualifyPerGroup: number;
}

/**
 * A finished group's final table, self-contained: rows are keyed by nation name
 * rather than nid so an archived campaign needs none of its original squads or
 * fixtures to render. This is the "Light" archival unit — enough to show what
 * happened, without the per-match box scores.
 */
export interface IntlGroupTable {
  /** The confederation this group qualified through; null for tournament groups. */
  confederation: string | null;
  rows: {
    nation: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    gf: number;
    ga: number;
    gd: number;
    points: number;
  }[];
}

/** One archived knockout result (self-contained, nation names not nids). */
export interface IntlKnockoutResult {
  /** 0 = quarter-final, 1 = semi-final, 2 = final. */
  round: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  winner: string;
  /** Shootout score if the tie went to penalties, else null. */
  pens: { home: number; away: number } | null;
  /** True if the tie needed extra time (whether or not it then went to pens). */
  extraTime?: boolean;
}

/**
 * An archived tournament, kept forever. Deliberately far smaller than the
 * tournament itself: per-match box scores and full squads are dropped, because
 * a 30-season dynasty plays 15 tournaments and holding every one's full
 * attribution would bloat the save. What it keeps is the *results* — final group
 * tables and every knockout scoreline — which is enough to redraw the bracket,
 * derive each nation's finish, and browse past editions. Career totals survive
 * on each player (see Player.intl).
 */
export interface IntlTournamentSummary {
  season: number;
  name: string;
  /**
   * Which confederation's cup this was, or absent for the World Cup.
   * Optional so archived World Cups from before confederation cup football existed
   * need no backfill — absent already means what it should.
   */
  confederation?: string;
  champion: string;
  runnerUp: string;
  /** Final scoreline from the champion's perspective, plus shootout if it went there. */
  finalScore: { champion: number; runnerUp: number; pens: { champion: number; runnerUp: number } | null };
  /** The tournament's leading scorer, or null if nobody scored. `name` is kept
   *  so a past edition still shows who it was after the player leaves the pool. */
  topScorer: { pid: number; nation: string; goals: number; name?: string } | null;
  /** The full field, strongest first. */
  field: string[];
  /** Final group tables (INTL_GROUPS of them, confederation null). */
  groups: IntlGroupTable[];
  /** Every knockout result (QF, SF, final), in round order. */
  knockout: IntlKnockoutResult[];
}

/**
 * A compact archived qualifying campaign (Light): the final group tables and the
 * list of qualifiers, no per-match detail. The current campaign is still held in
 * full on `InternationalState.qualifying`; this is what past campaigns collapse
 * to so the Qualifying tab can browse previous years.
 */
export interface IntlQualifyingSummary {
  season: number;
  /** How many nations entered qualifying this cycle. */
  entered: number;
  groups: IntlGroupTable[];
  qualified: string[];
  /** Absent on a campaign that finished before qualifying playoffs existed. */
  playoffs?: IntlQualifyingPlayoffSummary[];
}

/**
 * A national-team strength ranking, taken the moment a campaign is drawn (so it
 * reads end-of-season squads). Every eligible nation, strongest first — the raw
 * material for the Power Rankings tab and its year-on-year movement.
 */
export interface IntlPowerSnapshot {
  season: number;
  ranks: { nation: string; rating: number }[];
}

/**
 * How far this offseason's staged international campaign has progressed, so the
 * offseason can pause between stages and let the user play them one click at a
 * time (see core/international/staging.ts). `null` means there is nothing to
 * play this offseason — an even year with no qualifiers on file, a world too
 * small to field INTL_FIELD_SIZE nations, or simply a save still mid-club-season
 * — and the offseason's "Advance" is available immediately. Otherwise "Advance"
 * is withheld until the stage reaches "done".
 *  - "qualifying": qualifying groups are drawn but unplayed
 *  - "groups": tournament groups are drawn but unplayed
 *  - "knockout": the tournament's next knockout round is the one to play. A
 *    single stage that repeats rather than one per round, because how many
 *    rounds a bracket has is a function of the field (four at INTL_FIELD_SIZE
 *    32, three when it was 16, and a confederation cup's can be shorter still).
 *    roundsRemaining reads it off the fixtures, which is also what names the
 *    round in the UI. Old saves' "qf"/"sf"/"final" migrate onto this.
 *  - "confederation-groups": every confederation cup's group stage is next
 *  - "confederation-ko": the next knockout round of every cup that has
 *    one left, played across all of them at once (see confederationCup.ts for why
 *    that is a single stage rather than one per tournament)
 *  - "done": the campaign is finished for this offseason
 *
 * The confederation cup stages follow a "qualifying" stage rather than replacing it:
 * the middle qualifying offseason of the cycle plays its leg and then the
 * cups (see isConfederationCupSeason).
 */
export type IntlStage =
  | "qualifying" | "groups" | "knockout"
  | "confederation-groups" | "confederation-ko"
  | "done" | null;

/**
 * All international state for a save.
 *
 * Only the *current* qualifying campaign and the *current* tournament are held
 * in full; everything older collapses into `history`. The cycle alternates:
 * an odd season's offseason writes `qualifying` (and clears `tournament`), the
 * following even season's offseason consumes it to play `tournament`.
 */
export interface InternationalState {
  /** The most recent qualifying campaign, whose `qualified` field seeds the next tournament. */
  qualifying: IntlQualifyingCampaign | null;
  /** The most recently played tournament, in full. */
  tournament: IntlTournament | null;
  /**
   * The most recent confederation cups, in full — one per confederation
   * that could field a tournament, all played in the same offseason. Replaced
   * wholesale the next time they come round; empty on a world that supports
   * none (see CONFEDERATION_CUP_MIN_NATIONS).
   */
  confederationCups: IntlConfederationCup[];
  /** Every completed tournament, oldest first. */
  history: IntlTournamentSummary[];
  /** Every completed qualifying campaign (Light summaries), oldest first. */
  qualifyingHistory: IntlQualifyingSummary[];
  /**
   * Every completed confederation cup (the same Light summary a World
   * Cup collapses to, plus its confederation), oldest first. Kept separate from
   * `history` so the World Cup record — which nationHistory, the Ballon d'Or
   * and the History page all read — keeps meaning exactly what it always did.
   */
  confederationCupHistory: IntlTournamentSummary[];
  /** A national-team power-ranking snapshot per campaign drawn, oldest first. */
  powerRankings: IntlPowerSnapshot[];
  /** Progress of the current offseason's staged campaign; see IntlStage. */
  stage: IntlStage;
  /**
   * Pids injured during this offseason's international matches, awaiting carry
   * into the new club season (see offseason.ts). Populated as stages are played,
   * consumed and cleared at the season rollover, reset when a new campaign is
   * drawn. Never stamped on the player mid-campaign — see collectInjured.
   */
  stageInjuries: number[];
}

/**
 * A player's international career is accumulated at sim time and kept on the
 * player (rather than derived from box scores) because qualifying keeps no
 * attribution and archived tournaments drop theirs — those totals are the only
 * lasting record. It lives in ./career.js to stay import-cycle-free; see there.
 */
export type { IntlCareer, IntlSeasonLine } from "./career.js";
export { emptyIntlCareer } from "./career.js";
