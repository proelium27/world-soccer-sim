import type { BoxScore } from "../../engine/attribution.js";
import type { CupPlayerLine } from "./cupStats.js";
import type { CupCompetitionId } from "../constants.js";
import type { ResolvedCupShape, CupCalendar } from "./cupShape.js";

/**
 * One completed knockout tie. Scoreline is regulation + extra time; a shootout
 * only decides the winner and is recorded separately in homePens/awayPens
 * (shootout kicks are NOT counted as goals, matching real-football convention).
 */
export interface CupTie {
  /** Knockout round index. Swiss cup: 0 = QF, 1 = SF, 2 = Final. Legacy cup: 0 = R16 … 3 = Final. */
  round: number;
  /** League matchday this tie was played on (see CUP_KO_ROUND_MATCHDAYS / CUP_ROUND_MATCHDAYS). */
  matchday: number;
  home: number; // tid
  away: number; // tid
  homeGoals: number; // aggregate over both legs, incl. extra time (single-leg ties: just the one match)
  awayGoals: number;
  wentToExtraTime: boolean;
  wentToPens: boolean;
  homePens: number;
  awayPens: number;
  winner: number; // tid
  /**
   * Per-player lines for this tie, or **null once the cup has been archived** —
   * at that point the whole cup's box scores are folded into
   * `CupState.statLines` and dropped, because they were 3.6 MB of an aged save
   * and save size is what freezes the game (see CLAUDE.md's save-size section).
   * Everything displayed — scorelines, aggregate, legs, winner — is stored
   * separately and survives.
   */
  boxScore: BoxScore | null;
  /**
   * Two-legged ties only (twoLegged cups' QF/SF): the two 90' leg scorelines,
   * always from `home`'s perspective. legs[0] = first leg (`home` hosts),
   * legs[1] = second leg (`away` hosts). Absent on single-leg ties (final,
   * playoff, legacy cups, pre-two-leg saves). Extra-time / shootout goals are
   * folded into homeGoals/awayGoals, not into the leg lines.
   */
  legs?: { homeGoals: number; awayGoals: number }[];
  /**
   * The tie finished level on aggregate and went to the better-placed club with
   * no extra time or penalties — the Liguilla's quarter- and semi-final rule
   * (see resolveTwoLeggedTie's `levelGoesTo`). Absent on every other tie.
   */
  decidedByTablePosition?: true;
  /**
   * A best-of-three SERIES rather than a tie: MLS's first round. Each game from
   * `home`'s perspective, `at` the club that hosted it; a level game is decided
   * on penalties. On a series `homeGoals`/`awayGoals` are GAMES WON, not goals.
   * Absent on every other tie.
   */
  series?: SeriesGame[];
}

/** One game of a best-of-three series. See CupTie.series. */
export interface SeriesGame {
  at: number; // tid of the host
  homeGoals: number;
  awayGoals: number;
  homePens?: number;
  awayPens?: number;
}

/**
 * A completed **first leg** of a two-legged knockout tie, held between the two
 * legs' matchdays. The scoreline is 90' only (no extra time — it can end level;
 * the aggregate decides the tie on the second leg), stored from the first-leg
 * host's perspective (`home` hosted leg 1). Once the second leg is played the
 * two are combined into a single aggregate `CupTie` (see resolveTwoLeggedTie)
 * and `CupState.koLegs` is cleared.
 */
export interface KnockoutLeg {
  round: number;
  home: number; // tid — hosted leg 1
  away: number; // tid — hosts leg 2
  homeGoals: number; // leg-1 goals, `home`'s perspective
  awayGoals: number;
  boxScore: BoxScore;
}

/**
 * One league-phase match. Unlike a knockout tie it is 90' only and may end
 * level (no extra time / shootout, no winner), so it carries just the scoreline
 * and box score. `played` flips true and the goals/boxScore fill once its
 * matchday has been simulated.
 */
export interface LeaguePhaseMatch {
  /** 0-based league-phase round (which of the CUP_LEAGUE_PHASE_GAMES rounds). */
  round: number;
  /** League matchday this match is played on (see CUP_LEAGUE_PHASE_MATCHDAYS). */
  matchday: number;
  home: number; // tid
  away: number; // tid
  played: boolean;
  homeGoals: number; // -1 until played
  awayGoals: number; // -1 until played
  boxScore: BoxScore | null;
}

/**
 * The Swiss-style opening stage: all CUP_LEAGUE_PHASE_SIZE qualifiers in one
 * combined table, each playing CUP_LEAGUE_PHASE_GAMES matches (drawn via
 * strength pots). The standings are derived on demand from the played matches
 * (see leaguePhaseTable) — nothing is stored beyond the fixtures themselves.
 * Once every match is played the table is split (top CUP_LP_DIRECT_QF straight
 * to the quarter-finals, next CUP_LP_PLAYOFF_TEAMS into the playoff, the rest
 * out) and the results seed CupState.playoff and CupState.teams.
 */
export interface CupLeaguePhase {
  teams: number[]; // CUP_LEAGUE_PHASE_SIZE tids
  matches: LeaguePhaseMatch[]; // CUP_LEAGUE_PHASE_SIZE * CUP_LEAGUE_PHASE_GAMES / 2 matches
  /**
   * A groups-format cup only (see ContinentalFormatSettings): the groups of four,
   * each in seed-pot order. The opening stage is then a double round robin inside
   * each group, stored in `matches` exactly like Swiss games, so every reader of
   * league-phase matches (stats, prizes, coefficients, archiving, the schedule)
   * handles it with no change. Absent on every Swiss cup.
   *
   * A straight-knockout cup also carries a league phase, with `matches` empty:
   * it is what holds the field, and every reader that asks "who entered" reads
   * `leaguePhase.teams`.
   */
  groups?: number[][];
}

/**
 * The Swiss cup's single-leg playoff round: league-phase ranks 5..12 fight for
 * the four quarter-final places the top four didn't already claim. `teams` holds
 * the eight participants in tie order — (teams[0] vs teams[1]) feeds bracket
 * slot `slots[0]`, and so on — where each slot is an index into CupState.teams.
 * `ties` is empty until the round is played (on CUP_PLAYOFF_MATCHDAY), then
 * holds the four completed ties whose winners have filled CupState.teams.
 */
export interface CupPlayoff {
  teams: number[]; // 8 tids, tie order
  slots: number[]; // 4 CupState.teams indices the four winners fill
  matchday: number;
  ties: CupTie[]; // 4 once played
}

/**
 * A legacy preliminary play-in round (pre-Swiss saves only): the two weak-league
 * champions and the two weakest big-four qualifiers fight for the last two of
 * the old 16-team bracket's places. See CupPlayoff for the field layout — same
 * slots/teams/ties shape, two ties instead of four.
 */
export interface CupPlayIn {
  teams: number[]; // 4 tids, tie order
  slots: number[]; // 2 CupState.teams indices the two winners fill
  matchday: number;
  ties: CupTie[]; // 2 once played
}

/**
 * One season's Continental Cup.
 *
 * A **Swiss cup** (`leaguePhase !== null`, all new saves) opens with the league
 * phase; once it and the playoff resolve, `teams` holds the eight quarter-final
 * qualifiers in *bracket order* — QF pairings are (teams[0] vs teams[1]),
 * (teams[2] vs teams[3]), … — and `ties` accumulates the QF/SF/Final ties. The
 * four playoff slots in `teams` start as -1 and are filled by the playoff
 * winners; the top four seeds take the other four bracket places directly.
 *
 * A **legacy cup** (`leaguePhase === null`, old mid-season saves) is the old
 * straight 16-team bracket, optionally fed by `playIn`. `teams` holds 16 in
 * bracket order.
 *
 * `seeds` records each club's league-phase / bracket seed for display.
 */
export interface CupState {
  /**
   * Which continental competition this is. Everything that differs between them
   * — qualification slots, prize money, rng streams, display name — is looked
   * up from CUP_FORMATS by this id (see cupFormat in cup.ts). Absent on saves
   * from before the split; migrate stamps those "continental".
   */
  competition: CupCompetitionId;
  /** The season this cup is played during (qualifiers came from season − 1's tables). */
  season: number;
  name: string;
  teams: number[]; // knockout bracket order: 8 (Swiss) or 16 (legacy); -1 in a slot pending a result
  /** tid → 1-based seed (1 = top seed), for display. */
  seeds: Record<number, number>;
  /** The Swiss opening league phase, or null for a legacy straight-bracket cup. */
  leaguePhase: CupLeaguePhase | null;
  /** The Swiss single-leg playoff, or null (legacy cup, or not yet seeded). */
  playoff: CupPlayoff | null;
  /** The legacy preliminary play-in, or null (Swiss cup, or exact-16 legacy bracket). */
  playIn: CupPlayIn | null;
  ties: CupTie[];
  championTid: number | null;
  /**
   * Whether the knockout ties (bar the final) are two-legged, home-and-away,
   * decided on aggregate. True for all newly built cups; false for legacy /
   * pre-two-leg saves and any cup already in progress when this shipped (they
   * finish under the old single-leg rules). The final and the league-phase
   * playoff are always single-leg regardless.
   */
  twoLegged: boolean;
  /**
   * Two-legged cups only: the completed **first legs** of the knockout round
   * currently in progress, held until that round's second-leg matchday combines
   * them into aggregate `ties`. Null whenever no first leg is outstanding (a
   * single-leg cup, between rounds, or a round played atomically). Absent on
   * old saves → treated as null.
   */
  koLegs: KnockoutLeg[] | null;
  /**
   * Per-player cup totals for this season, one line per player who featured in
   * **any** stage — set when the cup is archived, and null while it's the live
   * cup (stats are summed from box scores on demand instead).
   *
   * Archiving folds every stage's box scores into these lines and then drops the
   * box scores: ~8x smaller (431 KB vs 3.6 MB across 13 cups), and save size is
   * what freezes the game. Aggregating across all three stages also fixed a
   * long-standing under-count — `cupStatsForPlayer` used to read only the
   * top-level `ties`, so group-stage and playoff appearances never showed on a
   * profile at all (1857 played vs 199 counted, in one measured season).
   *
   * Null on pre-feature saves until migrate backfills it.
   */
  statLines: CupPlayerLine[] | null;
  /**
   * The format this cup was drawn with, when it isn't the shipped one (see
   * core/cup/cupShape.ts). Absent on every default cup, so a save that never
   * touches the God Mode setting builds exactly the state it always did.
   * Recorded at the draw so a mid-season change to the setting can't reshape a
   * competition already under way.
   */
  shape?: ResolvedCupShape;
  /** Where this cup's stages are played, alongside `shape`. Absent → the shipped constants. */
  calendar?: CupCalendar;
}
