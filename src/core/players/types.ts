import type { IntlCareer } from "../international/career.js";
// Type-only, so the mutual reference with careerSummary.ts (which needs
// SeasonStats from here) is erased at compile time and never a runtime cycle —
// the same shape as international/career.ts.
import type { CareerSummary } from "./careerSummary.js";

export const POSITIONS = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"] as const;
export type Position = (typeof POSITIONS)[number];

export const SKILL_KEYS = [
  "speed", "strength", "stamina", "jumping",
  "shortPass", "longPass", "crosses",
  "dribbling", "longShot", "finishing",
  "tackling", "interceptions", "positioning", "goalkeeping",
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

export type PlayerRatings = Record<SkillKey, number>;

/** Why a player is banned — drives both the ban length and the wording the UI shows. */
export type SuspensionReason = "red card" | "second yellow" | "yellow cards";

export interface SeasonStats {
  season: number;
  /** Club the player was on as of his most recent appearance that season — not necessarily his club today. */
  tid: number;
  appearances: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  /** Sum of per-shot goal probability across the season; see PlayerMatchLine.xg. */
  xg: number;
  /** Goalkeepers only: total goals conceded across appearances. */
  goalsAgainst: number;
  /** Goalkeepers only: total expected goals against; see PlayerMatchLine.xga. */
  xga: number;
  saves: number;
  tackles: number;
  interceptions: number;
  /** Passes attempted across appearances (decorative; see PlayerMatchLine.passes). */
  passes: number;
  passesCompleted: number;
  crosses: number;
  foulsCommitted: number;
  /** Yellow cards shown across league appearances. A second yellow in one match counts here twice AND as a red. */
  yellowCards: number;
  /** Red cards — straight reds and second-yellow dismissals both. */
  redCards: number;
  minutesPlayed: number;
  /** Sum of per-match ratings across appearances; divide by `appearances` for the average. */
  ratingSum: number;
  /** Kept alongside ratingSum (rather than derived on read) so Leaders.tsx can sort/index it like any other stat. */
  avgRating: number;
}

export function emptySeasonStats(season: number, tid: number = -1): SeasonStats {
  return {
    season, tid, appearances: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, goalsAgainst: 0, xga: 0,
    saves: 0, tackles: 0, interceptions: 0, passes: 0, passesCompleted: 0, crosses: 0, foulsCommitted: 0,
    yellowCards: 0, redCards: 0, minutesPlayed: 0, ratingSum: 0, avgRating: 0,
  };
}

export interface RatingsSnapshot {
  season: number;
  ratings: PlayerRatings;
  ovr: number;
  potential: number;
  /** Was the player in a club's youth academy (not the senior squad) during this season? Only ever true for the user's own youth — AI clubs have no academy. Old saves are migrated to `false` (all-senior). */
  academy: boolean;
  /**
   * The position he carried out of this season — so `ovr` above is his rating
   * AT this position, and a career's worth of snapshots is a record of when he
   * changed (see `changedPosition` in players/positions.ts).
   *
   * Load-bearing rather than decorative: it is what lets the sustained-gap test
   * ask "has he been better elsewhere for N seasons *while listed here*",
   * which is what gives a conversion its cooldown without a second stored
   * field. Old saves backfill to the player's current position, which is exactly
   * right — before this existed nothing ever changed a position, so every
   * historical snapshot really was taken at the one he holds today.
   */
  pos: Position;
}

export interface Player {
  pid: number;
  name: string;
  nationality: string;
  born: number;
  pos: Position;
  heightCm: number;
  ratings: PlayerRatings;
  ovr: number;
  potential: number;
  contract: { salary: number; expiresSeason: number };
  injury: { gamesRemaining: number; type: string } | null;
  /**
   * A ban from league matches, ticking down one per league matchday exactly
   * like an injury (see core/suspensions.ts). Cup and international matches are
   * deliberately unaffected — bans are served in the competition they were
   * earned in, and only league cards are tracked. Absent/null = available.
   */
  suspension?: { matchesRemaining: number; reason: SuspensionReason } | null;
  /**
   * Running league yellow-card tally toward the next accumulation ban. Reset by
   * `SUSPENSION_YELLOW_THRESHOLD` each time one is triggered (not zeroed, so a
   * booking in the same match as the fifth still counts toward the next ban),
   * and wiped clean every offseason. Distinct from `SeasonStats.yellowCards`,
   * which is the season's un-reset total.
   */
  yellowCount?: number;
  stats: SeasonStats[];
  hist: RatingsSnapshot[];
  /**
   * Best ovr this player has ever reached, and the season he reached it.
   *
   * Stored rather than derived, and that is the point: both readers —
   * `careerPeakOvr` (the free-agent cull's quality gate) and `peakOf` (the
   * retiree archive) — used to walk the player's entire `hist` to get one
   * number, once per player per offseason. Maintained by `progressPlayer`,
   * which is already appending the snapshot these were scanning.
   *
   * The reason it matters beyond the saved work: it is what lets the career
   * arrays stop being resident at all (`docs/lazy-career-plan.md`). A cull or
   * an archive-worthiness check that needs `hist` in memory can never be run
   * against a player whose history lives on disk.
   *
   * Optional so old saves load; `migrate.ts` backfills from `hist` and every
   * reader falls back to scanning when it is absent, so a save that has not
   * been migrated yet still gets the right answer.
   */
  peakOvr?: number;
  peakOvrSeason?: number;
  /**
   * His career reduced to what the all-time boards rank on, covering every
   * season he has **finished** — the season in progress is not in it, because
   * it is still moving. Fold the current row in with `withSeason` for a live
   * number; that row is exactly what stays resident.
   *
   * Carried on the player so Frivolities can rank 10,864 careers without
   * reading 10,864 careers once `stats[]` moves to disk
   * (`docs/lazy-career-plan.md`). Measured on the reported season-60 save:
   * 10.4 MB of summaries against the 45.2 MB of per-season history they stand
   * in for, and no board loses anything, because ranking, filtering and sorting
   * all work the same on a summary as on the seasons behind it.
   *
   * Optional so old saves load, and `migrate.ts` backfills it by folding the
   * career one last time.
   */
  career?: CareerSummary;
  /**
   * The season a free-agent signing by the user's club takes effect (set by
   * signFreeAgent). While `league.season <= faSignedSeason` the player can't be
   * sold — a one-season hold that kills the "sign a free agent, flip him for a
   * fee the same window" exploit. Absent for players who were never signed from
   * free agency by the user (and for pre-feature saves — see migrate.ts).
   */
  faSignedSeason?: number;
  /**
   * International career totals (caps, goals, tournaments, titles), accumulated
   * when this player features for his nation — see core/international. Absent
   * until he first makes a squad, and for saves predating the feature. Purely a
   * record: nothing here feeds progression or valuation.
   */
  intl?: IntlCareer;
  /**
   * God Mode: freeze this player's development. While set, `progressPlayer`
   * leaves his ratings, ovr, listed position and potential exactly where they
   * are — no growth, no age decline — for every offseason until it is cleared.
   *
   * It stops *simulated* drift only. A God Mode edit still applies to a locked
   * player (the lock is not a write guard), and everything else about him —
   * contracts, injuries, transfers, retirement — carries on as normal.
   *
   * Absent = unlocked, which is what every player in a save predating this is,
   * so there is nothing for `migrate.ts` to backfill.
   */
  ratingsLocked?: boolean;
}
