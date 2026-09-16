/**
 * Manager career state: which club you're at, how safe your job is, and who
 * else wants you.
 *
 * The user has always been "whoever owns `meta.userTid`" and nothing else —
 * there was no manager entity at all. This adds one, so a save can express a
 * career that spans clubs rather than a single permanent appointment.
 */
import { MANAGER_START_CONFIDENCE } from "../constants.js";
import { isSpectatorTid } from "../spectator.js";
import type { SeasonVerdict } from "./confidence.js";

/**
 * One spell in charge of one club, oldest first. Raw results, not a derived
 * score: reputation is computed from these (see `managerReputation`) so the
 * formula can be retuned without rewriting anyone's career.
 *
 * Deliberately self-contained — the same "light archival" trade the
 * international summaries make. Deriving a stint's record from `seasonHistory`
 * would work for completed seasons, but the board judges you at the *end of the
 * season just played*, before that season is appended to history, so the
 * derivation would need a special case for exactly the moment it matters most.
 */
export interface ManagerStint {
  tid: number;
  /** The season you took the job (you manage it from this season on). */
  startSeason: number;
  /** The season you left, or null while this is your current job. */
  endSeason: number | null;
  /** Seasons you saw through to the end here. */
  seasons: number;
  /** League titles won here (tier 1 or tier 2 — a division-winning season counts). */
  titles: number;
  /** Every other trophy won here: domestic cups, the shield, the Continental Cup. */
  trophies: number;
  /**
   * Sum of each season's finish-versus-expectation, where 1.0 is finishing a
   * whole division's worth of places above where the squad said you should.
   * Negative means you underachieved on balance.
   */
  overperformance: number;
  /** How the spell ended — null while it's still running. */
  ending: "sacked" | "left" | null;
}

/** A club willing to hand you the job, offered at an offseason boundary. */
export interface JobOffer {
  tid: number;
  /**
   * The competition the club will play in **next** season, after promotion and
   * relegation are applied.
   *
   * Load-bearing rather than cosmetic: offers are made at the end of a season
   * but the swaps only happen during the offseason that follows, so a club's
   * live `compId` at offer time is the division it is *leaving*. Quoting that
   * would advertise a just-relegated club as a top-flight job, which is exactly
   * the fact a manager would weigh most.
   */
  compId: number;
  /** Whether this club is going up or down on the way into that competition. */
  moving: "promoted" | "relegated" | null;
  /**
   * How big a job this is, [0,1] — the same prestige scale offers are matched
   * against. Stored so the UI can rank and describe offers without recomputing a
   * world-wide normalization it has no other reason to know about.
   */
  prestige: number;
  /** Where this club's squad ranks in its own competition, 1 = strongest. */
  expectedRank: number;
  /** How many clubs are in that competition, so the rank reads as "3rd of 20". */
  clubs: number;
}

/**
 * The board's verdict on one season, kept so the UI can explain why confidence
 * moved rather than just showing it move.
 *
 * A bar that jumps with no account of itself is exactly the "the sacking came
 * out of nowhere" feeling a visible meter is supposed to prevent, and every term
 * behind the number is already computed — it was simply being thrown away.
 */
export interface ManagerVerdictRecord extends SeasonVerdict {
  /** The season judged. */
  season: number;
  /** Confidence before this verdict, so the UI can show the move, not just the result. */
  previousConfidence: number;
}

export interface ManagerState {
  /**
   * The board's confidence in you at your current club, 0-100. Falls when you
   * finish below what the squad justifies, rises when you beat it. Hitting 0
   * gets you sacked (unless `sackingEnabled` is false).
   */
  confidence: number;
  /** Your career, oldest first. The last entry is always your current job. */
  stints: ManagerStint[];
  /**
   * Jobs on the table right now. Generated at the moment a season ends and
   * cleared once you've answered them, so they survive a reload while you're
   * deciding.
   */
  offers: JobOffer[];
  /**
   * You've been dismissed and must accept one of `offers` before the save can go
   * on. `offers` is guaranteed non-empty whenever this is true — a *managed*
   * save has no unemployed state, by design: every club page assumes you have a
   * club, so the career can never strand you between two of them.
   *
   * A spectator save (`meta.userTid === SPECTATOR_TID`) is the separate case
   * where nobody manages anything, and it is never reached from here — it is
   * chosen at creation and never changes. `stints` is empty there, so this can
   * never become true. See `core/spectator.ts`.
   */
  sacked: boolean;
  /**
   * Save-level switch. When false the board never sacks you, however badly it
   * goes; job offers still arrive, so you keep the ability to move clubs without
   * the risk of being moved for you.
   */
  sackingEnabled: boolean;
  /**
   * The board's verdict on the most recent season it judged. Null on a new save
   * and on any save whose seasons all predate the board.
   */
  lastVerdict: ManagerVerdictRecord | null;
  /**
   * Clubs the user has said they'd like to manage (tids, at most
   * `MANAGER_MAX_INTERESTS`). Each gets its own extra roll when offers are drawn,
   * if the user is good enough for it — it never creates a job out of nothing.
   *
   * Optional, absent meaning none, so no save needed migrating: nobody had asked
   * for anything before this existed. Read through `clubInterests`.
   */
  interests?: number[];
}

/**
 * The manager state a brand-new save starts with: one open-ended stint, full
 * honeymoon.
 *
 * A spectator save gets **no stint at all**, the same shape
 * `emptyNationalManagerState` produces for a declined country — there is no
 * club, so there is no job to have started. That is what keeps the rest of the
 * career machinery quiet without a single extra branch: `currentStint` returns
 * undefined, so `reviewSeason` takes the early out it already has, no
 * confidence moves, no verdict is recorded and no offer is ever drawn.
 */
export function emptyManagerState(
  userTid: number,
  season: number,
  sackingEnabled = true,
): ManagerState {
  return {
    confidence: MANAGER_START_CONFIDENCE,
    stints: isSpectatorTid(userTid) ? [] : [newStint(userTid, season)],
    offers: [],
    sacked: false,
    sackingEnabled,
    lastVerdict: null,
  };
}

export function newStint(tid: number, startSeason: number): ManagerStint {
  return {
    tid,
    startSeason,
    endSeason: null,
    seasons: 0,
    titles: 0,
    trophies: 0,
    overperformance: 0,
    ending: null,
  };
}

/** Your current job — the open stint, which is always the last one. */
export function currentStint(manager: ManagerState): ManagerStint | undefined {
  return manager.stints[manager.stints.length - 1];
}
