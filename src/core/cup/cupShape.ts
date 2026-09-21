import {
  CUP_LEAGUE_PHASE_GAMES, CUP_LEAGUE_PHASE_MATCHDAYS, CUP_LEAGUE_PHASE_POTS,
  CUP_LP_MAX_ADVANCE_BRACKETS, CUP_MIN_FIELD,
  DOMESTIC_CUP_MATCHDAYS, cupKnockoutPlan, type CupCompetitionId, type CupKnockoutPlan,
} from "../constants.js";
import { TRANSFER_DEADLINE_MATCHDAY } from "../calendar.js";

/* ── Continental competition formats (God Mode) ──────────────────────────────
 * Every club continental competition ships one shape: a six-game Swiss league
 * phase, a playoff round, two-legged quarter- and semi-finals and a one-off
 * final. This module is what lets a save pick another one, per competition.
 *
 * Three rules hold it together, and each is load-bearing:
 *
 *  1. **The default is the shipped format, and a default cup is built byte for
 *     byte as it always was.** `buildCupState` only attaches the new optional
 *     fields (`CupState.shape`, `calendar`, `split`, `CupLeaguePhase.groups`)
 *     when the settings differ from DEFAULT_CONTINENTAL_FORMAT, so every
 *     existing save and every shipped-world audit plays exactly what it did.
 *
 *  2. **A cup records its own shape when it is drawn.** Settings are read once,
 *     at the offseason draw; the resolved shape, split and calendar ride on the
 *     CupState. Changing the setting mid-season therefore can never reshape a
 *     competition that has already kicked off — it takes effect at the next
 *     draw, the same arrangement World Cup size uses.
 *
 *  3. **The calendar is derived, never hand-listed, and it keeps clear of the
 *     domestic cups.** `buildCupCalendar` walks backwards from the final on
 *     matchday 37 and skips every domestic cup matchday and transfer deadline
 *     day, because a club can be in both competitions and a shared matchday
 *     would ask him to play twice in one week.
 * ──────────────────────────────────────────────────────────────────────── */

/** How the competition opens. */
export type CupOpeningStage = "league" | "groups" | "knockout";

/** Where the knockout bracket starts: a Round of 16, the quarter-finals or the semi-finals. */
export type CupKnockoutSize = "auto" | 4 | 8 | 16;

export interface ContinentalFormatSettings {
  /** Swiss league phase (shipped), groups of four, or straight into the knockout. */
  opening: CupOpeningStage;
  /** Games per club in a Swiss league phase. Ignored by the other openings (a group of four is always six). */
  leaguePhaseGames: 4 | 6 | 8;
  /** Bracket size. "auto" sizes it off the field, exactly as the shipped format does. */
  knockoutSize: CupKnockoutSize;
  /** Swiss only: whether a playoff round decides the last bracket places. */
  playoffRound: boolean;
  /** Whether the knockout ties before the final are two-legged. The final is always one match. */
  twoLegged: boolean;
  /**
   * Whether a two-legged tie level on aggregate is decided on away goals — the
   * real pre-2021 UEFA rule, extra time included. Ignored by a single-leg
   * format, which has no away leg to count. See resolveTwoLeggedTie.
   */
  awayGoals: boolean;
  /**
   * How many clubs contest it. "auto" = however many the leagues send, which is
   * what every save played before this existed.
   *
   * A number is a TARGET, not a cap: the places are rescaled across the
   * competition's leagues to reach it (see continentalSlotOverrides), so a
   * bigger competition digs deeper into every table and a smaller one is the
   * best clubs only. Snapped to a size the draw can build — see
   * snapFieldSize — and capped by how many clubs the leagues actually have.
   */
  fieldSize: "auto" | number;
}

/** The shipped format. Every save that has never touched the setting plays this. */
export const DEFAULT_CONTINENTAL_FORMAT: Readonly<ContinentalFormatSettings> = Object.freeze({
  opening: "league",
  leaguePhaseGames: CUP_LEAGUE_PHASE_GAMES as 6,
  knockoutSize: "auto",
  playoffRound: true,
  twoLegged: true,
  awayGoals: false,
  fieldSize: "auto",
});

export const LEAGUE_PHASE_GAME_OPTIONS = [4, 6, 8] as const;
export const KNOCKOUT_SIZE_OPTIONS: readonly CupKnockoutSize[] = ["auto", 4, 8, 16];

/**
 * The field sizes offered. Every one is a multiple of four at or above
 * CUP_MIN_FIELD, which is exactly what isValidCupFieldSize accepts, so a chosen
 * size survives cupPlan's trim untouched rather than being silently reduced by
 * it. 64 is the ceiling because a straight knockout can't hold more than two
 * Round-of-16 brackets anyway and the deeper openings stop being drawable well
 * before the leagues run out of clubs.
 */
export const FIELD_SIZE_OPTIONS: readonly (number)[] = [12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64];

/** A save's per-competition formats. Absent key = the shipped format. */
export type ContinentalFormats = Partial<Record<CupCompetitionId, ContinentalFormatSettings>>;

/**
 * Coerce anything (a save file, a half-filled form) into a valid settings
 * object, field by field. Lenient on purpose: a hand-edited save must never
 * stop a season from being drawn.
 */
export function sanitizeContinentalFormat(raw: unknown): ContinentalFormatSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ContinentalFormatSettings, unknown>>;
  const d = DEFAULT_CONTINENTAL_FORMAT;
  const opening = r.opening === "groups" || r.opening === "knockout" || r.opening === "league" ? r.opening : d.opening;
  const leaguePhaseGames = (LEAGUE_PHASE_GAME_OPTIONS as readonly unknown[]).includes(r.leaguePhaseGames)
    ? (r.leaguePhaseGames as 4 | 6 | 8) : d.leaguePhaseGames;
  const knockoutSize = (KNOCKOUT_SIZE_OPTIONS as readonly unknown[]).includes(r.knockoutSize)
    ? (r.knockoutSize as CupKnockoutSize) : d.knockoutSize;
  // A hand-edited size is snapped rather than rejected, so "40ish" still gets a
  // competition. Anything that isn't a usable number falls back to "auto".
  const rawSize = r.fieldSize;
  const fieldSize: "auto" | number = typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize >= CUP_MIN_FIELD
    ? snapFieldSize(rawSize)
    : d.fieldSize;
  return {
    opening,
    leaguePhaseGames,
    knockoutSize,
    playoffRound: typeof r.playoffRound === "boolean" ? r.playoffRound : d.playoffRound,
    twoLegged: typeof r.twoLegged === "boolean" ? r.twoLegged : d.twoLegged,
    awayGoals: typeof r.awayGoals === "boolean" ? r.awayGoals : d.awayGoals,
    fieldSize,
  };
}

/**
 * The largest size at or below `n` that the draw can build: a multiple of
 * CUP_LEAGUE_PHASE_POTS × 2 (so both pots are even), at or above CUP_MIN_FIELD.
 * Returns CUP_MIN_FIELD for anything smaller, since a competition below the
 * floor is not one.
 */
export function snapFieldSize(n: number): number {
  const step = CUP_LEAGUE_PHASE_POTS * 2;
  const snapped = Math.floor(n / step) * step;
  return Math.max(CUP_MIN_FIELD, snapped);
}

/** Whether these settings play the shipped format (absent counts as shipped). */
export function isDefaultContinentalFormat(s: ContinentalFormatSettings | undefined): boolean {
  if (!s) return true;
  const d = DEFAULT_CONTINENTAL_FORMAT;
  return s.opening === d.opening
    && s.leaguePhaseGames === d.leaguePhaseGames
    && s.knockoutSize === d.knockoutSize
    && s.playoffRound === d.playoffRound
    && s.twoLegged === d.twoLegged
    && s.awayGoals === d.awayGoals
    && s.fieldSize === d.fieldSize;
}

/** The settings a competition plays under in a save. */
export function continentalFormatFor(
  formats: ContinentalFormats | undefined,
  competition: CupCompetitionId,
): ContinentalFormatSettings {
  const s = formats?.[competition];
  return s ? sanitizeContinentalFormat(s) : { ...DEFAULT_CONTINENTAL_FORMAT };
}

/* ── Field-size rules per opening ────────────────────────────────────────── */

/**
 * Whether a Swiss league phase of `games` rounds can be drawn for a field of
 * `size`. Same three conditions as isValidCupFieldSize, with the game count as a
 * parameter: two pots, each even (the intra-pot rounds are perfect matchings),
 * and each big enough to supply `games / 2` opponents from within itself.
 */
export function isValidLeaguePhaseField(size: number, games: number): boolean {
  const perPot = games / CUP_LEAGUE_PHASE_POTS;
  const potSize = size / CUP_LEAGUE_PHASE_POTS;
  return Number.isInteger(perPot) && Number.isInteger(potSize) && potSize % 2 === 0
    && potSize - 1 >= perPot && size >= CUP_MIN_FIELD;
}

/**
 * Deepest bracket a custom format may open with: a Round of 16, which needs two
 * more matchdays of legs than the shipped cap (CUP_KO_MAX_SIZE) and still fits
 * the calendar (see buildCupCalendar). A straight knockout therefore holds at
 * most 32 clubs, and a bigger qualified field is trimmed to that at the draw.
 */
export const CUP_KO_MAX_SIZE_CUSTOM = 16;

const pow2Floor = (n: number): number => 2 ** Math.floor(Math.log2(Math.max(1, n)));

/* ── The resolved shape ──────────────────────────────────────────────────── */

/**
 * What a competition will actually play for a given field: the opening, the
 * bracket, and (Swiss) how the table splits. Stored on the CupState as it is
 * drawn. Pure; the God Mode preview calls it with the live field size so the
 * sentence it prints is the format the next draw will build.
 */
export interface ResolvedCupShape {
  opening: CupOpeningStage;
  /** Swiss rounds, or 6 for groups (a double round robin of four), or 0 for a straight knockout. */
  openingGames: number;
  koSize: number;
  twoLegged: boolean;
  /** Whether a level two-legged tie is decided on away goals. Always false for a single-leg format. */
  awayGoals: boolean;
  /** Swiss: straight into the bracket / into the playoff. Knockout opening: byes / preliminary-round entrants. Groups: all 0. */
  directQF: number;
  playoffTeams: number;
  /** Groups only: number of groups of four. */
  groups: number;
}

export function resolveCupShape(fieldSize: number, s: ContinentalFormatSettings): ResolvedCupShape {
  const twoLegged = s.twoLegged;
  // A one-off tie has no away leg to count, so the rule is recorded as off
  // rather than stored and quietly ignored — the cup page and the tie renderer
  // both read the shape, and a format that claims a rule it can't apply reads
  // as a bug.
  const awayGoals = twoLegged && s.awayGoals;
  if (s.opening === "groups") {
    const groups = Math.floor(fieldSize / 4);
    // Top two of every group is the natural bracket; round to the nearest power
    // of two (ties go up: 12 → 16, filled by the best third-placed sides, the
    // Euro 2016 shape). An explicit size is honoured as long as the groups can
    // fill it — no more than every club finishing top three.
    const natural = 2 * groups;
    const down = pow2Floor(natural);
    const up = down === natural ? down : down * 2;
    const auto = natural - down < up - natural ? down : up;
    let koSize = s.knockoutSize === "auto" ? auto : s.knockoutSize;
    koSize = Math.min(koSize, CUP_KO_MAX_SIZE_CUSTOM, pow2Floor(3 * groups));
    return { opening: "groups", openingGames: 6, koSize: Math.max(2, koSize), twoLegged, awayGoals, directQF: 0, playoffTeams: 0, groups };
  }

  if (s.opening === "knockout") {
    // The bracket must hold at least half the field (the preliminary round can
    // only halve it), and at most the whole field.
    const wanted = s.knockoutSize === "auto" ? pow2Floor(fieldSize) : s.knockoutSize;
    const koSize = Math.min(CUP_KO_MAX_SIZE_CUSTOM, pow2Floor(fieldSize), Math.max(wanted, pow2Ceil(fieldSize / 2)));
    const prelim = Math.max(0, fieldSize - koSize); // clubs who must win a preliminary tie
    return {
      opening: "knockout", openingGames: 0, koSize, twoLegged, awayGoals,
      directQF: koSize - prelim, playoffTeams: 2 * prelim, groups: 0,
    };
  }

  // Swiss league phase.
  if (s.knockoutSize === "auto" && s.playoffRound) {
    const plan = cupKnockoutPlan(fieldSize);
    return { opening: "league", openingGames: s.leaguePhaseGames, twoLegged, awayGoals, groups: 0, ...plan };
  }
  const koSize = s.knockoutSize === "auto"
    ? cupKnockoutPlan(fieldSize).koSize
    : Math.min(s.knockoutSize, CUP_KO_MAX_SIZE_CUSTOM, pow2Floor(fieldSize));
  const advancing = s.playoffRound
    ? Math.min(CUP_LP_MAX_ADVANCE_BRACKETS * koSize, fieldSize - (fieldSize % 2))
    : koSize;
  return {
    opening: "league", openingGames: s.leaguePhaseGames, koSize, twoLegged, awayGoals, groups: 0,
    directQF: 2 * koSize - advancing, playoffTeams: 2 * (advancing - koSize),
  };
}

function pow2Ceil(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

/** The split a Swiss table or a knockout opening uses, in cupKnockoutPlan's shape. */
export function splitOf(shape: ResolvedCupShape): CupKnockoutPlan {
  return { koSize: shape.koSize, directQF: shape.directQF, playoffTeams: shape.playoffTeams };
}

/* ── The calendar ────────────────────────────────────────────────────────── */

/** Where every stage of a custom-format cup is played. */
export interface CupCalendar {
  /** One matchday per opening round (Swiss or group), empty for a straight knockout. */
  opening: number[];
  /** Matchday of the playoff / preliminary round, or null when there isn't one. */
  playoff: number | null;
  /** Knockout matchdays, by round then leg (two for a two-legged round, one otherwise). */
  ko: number[][];
}

const FINAL_MATCHDAY = 37;
const FIRST_OPENING_MATCHDAY = 3;

/** Matchdays a continental fixture may not use: the domestic cups, deadline day and the finale. */
function blocked(md: number): boolean {
  return (DOMESTIC_CUP_MATCHDAYS as readonly number[]).includes(md)
    || md === TRANSFER_DEADLINE_MATCHDAY || md >= 38 || md < 2;
}

/** The latest free matchday at or before `md`. */
function latestFree(md: number): number {
  let m = md;
  while (m > 1 && blocked(m)) m--;
  return m;
}

/**
 * Build a cup's calendar backwards from a final on matchday 37.
 *
 * Two-legged rounds sit two matchdays apart and single-leg rounds three, which
 * is exactly the shipped spacing (QF 29/31, SF 33/35, final 37; single-leg
 * 31/34/37), so a custom format that only changes the opening keeps the
 * knockout on the days players already know. The playoff is two matchdays
 * before the first knockout leg, and the opening rounds spread evenly over
 * whatever free matchdays are left before that.
 */
export function buildCupCalendar(shape: ResolvedCupShape, hasPlayoff: boolean): CupCalendar {
  const rounds = Math.max(1, Math.round(Math.log2(shape.koSize)));
  const ko: number[][] = [];
  let cursor = FINAL_MATCHDAY;
  ko.unshift([cursor]);
  for (let r = rounds - 2; r >= 0; r--) {
    if (shape.twoLegged) {
      const leg2 = latestFree(cursor - 2);
      const leg1 = latestFree(leg2 - 2);
      ko.unshift([leg1, leg2]);
      cursor = leg1;
    } else {
      const md = latestFree(cursor - 3);
      ko.unshift([md]);
      cursor = md;
    }
  }
  let playoff: number | null = null;
  if (hasPlayoff) {
    playoff = latestFree(cursor - 2);
    cursor = playoff;
  }
  const lastOpening = latestFree(cursor - 2);
  return { opening: spreadOpening(shape.openingGames, lastOpening), playoff, ko };
}

/**
 * `n` opening matchdays spread across the free days up to `last`. Six rounds
 * that fit use the shipped league-phase days, so a groups format or a Swiss
 * phase in front of a single-leg knockout plays on the familiar dates.
 */
function spreadOpening(n: number, last: number): number[] {
  if (n <= 0) return [];
  const shipped = CUP_LEAGUE_PHASE_MATCHDAYS as readonly number[];
  if (n === shipped.length && shipped[shipped.length - 1] <= last) return [...shipped];
  const free: number[] = [];
  for (let md = FIRST_OPENING_MATCHDAY; md <= last; md++) if (!blocked(md)) free.push(md);
  if (free.length < n) {
    // Unreachable with the option ranges offered (the tightest case, eight
    // Swiss rounds before a two-legged Round of 16 and a playoff, still has
    // sixteen free days), but never return a short calendar.
    throw new Error(`cup calendar: ${n} opening rounds don't fit before matchday ${last}`);
  }
  if (n === 1) return [free[0]];
  return Array.from({ length: n }, (_, i) => free[Math.round((i * (free.length - 1)) / (n - 1))]);
}

/** Plain-language summary of a format for a given field, for the God Mode preview and the cup page. */
export function describeCupShape(shape: ResolvedCupShape, fieldSize: number): string {
  const bracket = bracketName(shape.koSize);
  const away = shape.awayGoals ? ", away goals breaking a level tie" : "";
  const legs = shape.koSize > 2
    ? (shape.twoLegged ? `two-legged ties up to a one-off final${away}` : "one match per tie, final included")
    : "a one-off final";
  if (shape.opening === "groups") {
    const top = shape.koSize === 2 * shape.groups ? "the top two in each group go through"
      : shape.koSize < 2 * shape.groups
        ? (shape.koSize <= shape.groups ? `the best ${shape.koSize} group winners go through` : `every group winner and the best ${shape.koSize - shape.groups} runners-up go through`)
        : `the top two in each group and the best ${shape.koSize - 2 * shape.groups} third-placed sides go through`;
    return `${fieldSize} clubs in ${shape.groups} groups of four, playing each other home and away; ${top} to the ${bracket}, then ${legs}.`;
  }
  if (shape.opening === "knockout") {
    const prelim = shape.playoffTeams > 0
      ? (shape.directQF > 0
        ? `the top ${shape.directQF} seeds get a bye and the other ${shape.playoffTeams} play a preliminary round for the ${bracket}`
        : `all ${fieldSize} play a preliminary round for the ${bracket}`)
      : `all ${fieldSize} go straight into the ${bracket}`;
    return `Straight knockout: ${prelim}, then ${legs}.`;
  }
  const split = shape.playoffTeams === 0 && shape.directQF >= fieldSize
    ? `everyone goes through to the ${bracket}, so the table only decides the seeding`
    : shape.playoffTeams === 0
    ? `the top ${shape.directQF} go to the ${bracket}`
    : shape.directQF === 0
      ? `the top ${shape.playoffTeams} play a playoff round for the ${bracket}`
      : `the top ${shape.directQF} go straight to the ${bracket} and the next ${shape.playoffTeams} play a playoff round`;
  return `${fieldSize} clubs in one league phase of ${shape.openingGames} games each; ${split}, then ${legs}.`;
}

export function bracketName(koSize: number): string {
  if (koSize <= 2) return "final";
  if (koSize === 4) return "semi-finals";
  if (koSize === 8) return "quarter-finals";
  return `round of ${koSize}`;
}

