/**
 * `clubAppealFor`: how a player sees a move to a club, as a list of reasons.
 * docs/club-reputation.md, Part A3.
 *
 * One function, two readers. The AI decides on the numbers (`appealScore` is
 * the allocation-free core the markets call in their inner loops); the screens
 * show the same numbers as labelled lines. Because both read one computation,
 * the reason a player gives on screen is the reason he actually decided on.
 *
 * Every line is the player's own view — nothing club-side rides here. A club's
 * foreign-player limit is a registration rule, checked where a signing is made,
 * not a feeling the player has. Every line binds the user exactly as it binds an
 * AI club.
 *
 * Lines, all bounded so no single one can swamp the rest by construction:
 *
 *  - **Level match** — the existing stature rule (`moveAppeal`/`refusesMove`)
 *    expressed as a line. The only line that can refuse.
 *  - **Playing time** — would he start? His rating against the weakest man the
 *    club's shape fields at his position, clamped. Near zero for a star (he
 *    starts anywhere) and decisive for a squad player, which is the real reason
 *    small clubs sign real players.
 *  - **Home country** — the club is in his country: positive arriving, the
 *    same amount negative leaving. Scaled by how domestic his league really is
 *    and by `homeAttachment` (a star or a player who has outgrown his league
 *    feels none of it).
 *  - **Confederation** — the club is outside his confederation. Symmetric.
 *  - **Former club** — he has played for them before. Never a refusal.
 *
 * On a loan the home and confederation lines are scaled by APPEAL_LOAN_FACTOR:
 * a loan is a season, not a career.
 *
 * The score is the sum of the lines; as a valuation multiplier it is
 * `max(0, 1 + score)`, and 0 when refused.
 *
 * Pure and rng-free.
 */
import type { Player } from "../players/types.js";
import type { Position } from "../players/types.js";
import { confederationOf } from "../international/confederations.js";
import { moveAppeal, refusesMove, statureSensitivity } from "./playerWill.js";
import { homeAttachment, type HomeClub } from "./homePull.js";
import {
  APPEAL_HOME, APPEAL_CONFEDERATION, APPEAL_PLAYING_TIME, APPEAL_PLAYING_TIME_LO,
  APPEAL_PLAYING_TIME_HI, APPEAL_FORMER_CLUB, APPEAL_LOAN_FACTOR,
} from "../constants.js";

/** What the appeal reads about a club. `ClubContext` satisfies it. */
export interface AppealClub {
  tid: number;
  stature: number;
  home?: HomeClub;
  /** The weakest man the club's shape fields at each position; 0 where it is short. */
  posWeakestStarterOvr?: Record<Position, number>;
}

/**
 * Where the player is coming from. A transfer or loan names the selling club; a
 * free agent has no club, only the stature he measures offers against
 * (`freeAgentFromStature`).
 */
export interface AppealFrom {
  stature: number;
  club?: AppealClub;
}

export type AppealLineId = "level" | "playingTime" | "home" | "confederation" | "formerClub";

export interface AppealLine {
  id: AppealLineId;
  label: string;
  value: number;
}

export interface ClubAppeal {
  score: number;
  refused: boolean;
  lines: AppealLine[];
}

export interface AppealOptions {
  loan?: boolean;
}

const LABELS: Record<AppealLineId, string> = {
  level: "Level of club",
  playingTime: "Playing time",
  home: "Home country",
  confederation: "Far from home",
  formerClub: "Former club",
};

/** Every club a player has been on the books at, from his career record and recent stats. */
const formerClubsCache = new WeakMap<Player, Set<number>>();
function formerClubs(player: Player): Set<number> {
  let set = formerClubsCache.get(player);
  if (!set) {
    set = new Set<number>();
    for (const s of player.career?.seasons ?? []) set.add(s.tid);
    for (const s of player.stats ?? []) set.add(s.tid);
    formerClubsCache.set(player, set);
  }
  return set;
}

function playingTimeAt(player: Player, club: AppealClub | undefined): number {
  const weakest = club?.posWeakestStarterOvr?.[player.pos];
  if (weakest === undefined) return 0;
  const edge = Math.max(-APPEAL_PLAYING_TIME_LO, Math.min(APPEAL_PLAYING_TIME_HI, player.ovr - weakest));
  return APPEAL_PLAYING_TIME * edge;
}

function homeAt(player: Player, club: AppealClub | undefined): number {
  const home = club?.home;
  if (!home || player.nationality !== home.country) return 0;
  return APPEAL_HOME * home.domesticShare * homeAttachment(player, home);
}

function confederationAt(player: Player, club: AppealClub | undefined, care: number): number {
  const conf = club?.home?.confederation;
  if (!conf) return 0;
  const own = confederationOf(player.nationality);
  if (!own || own === conf) return 0;
  return -APPEAL_CONFEDERATION * (1 - care);
}

/** The five line values, without building the labelled list. */
function lineValues(
  player: Player,
  to: AppealClub,
  from: AppealFrom,
  options: AppealOptions,
): { refused: boolean; level: number; playingTime: number; home: number; confederation: number; formerClub: number } {
  const refused = refusesMove(player.ovr, from.stature, to.stature);
  const level = refused ? -1 : moveAppeal(player.ovr, from.stature, to.stature) - 1;
  const care = statureSensitivity(player.ovr);
  const away = options.loan ? APPEAL_LOAN_FACTOR : 1;
  const playingTime = playingTimeAt(player, to) - (from.club ? playingTimeAt(player, from.club) : 0);
  const home = away * (homeAt(player, to) - homeAt(player, from.club));
  const confederation = away * (confederationAt(player, to, care) - confederationAt(player, from.club, care));
  const formerClub = to.tid !== from.club?.tid && formerClubs(player).has(to.tid) ? APPEAL_FORMER_CLUB : 0;
  return { refused, level, playingTime, home, confederation, formerClub };
}

/** The score alone, for the markets' inner loops. `refused` wins over any score. */
export function appealScore(
  player: Player,
  to: AppealClub,
  from: AppealFrom,
  options: AppealOptions = {},
): { score: number; refused: boolean } {
  const v = lineValues(player, to, from, options);
  return { score: v.level + v.playingTime + v.home + v.confederation + v.formerClub, refused: v.refused };
}

/** The appeal as a multiplier on a buyer's valuation: 0 when refused, else `max(0, 1 + score)`. */
export function appealMultiplier(
  player: Player,
  to: AppealClub,
  from: AppealFrom,
  options: AppealOptions = {},
): number {
  const { score, refused } = appealScore(player, to, from, options);
  return refused ? 0 : Math.max(0, 1 + score);
}

/** The player's full view of a move, line by line, for the screens. */
export function clubAppealFor(
  player: Player,
  to: AppealClub,
  from: AppealFrom,
  options: AppealOptions = {},
): ClubAppeal {
  const v = lineValues(player, to, from, options);
  const ids: AppealLineId[] = ["level", "playingTime", "home", "confederation", "formerClub"];
  const lines = ids.map((id) => ({ id, label: LABELS[id], value: v[id] })).filter((l) => l.value !== 0);
  return {
    score: v.level + v.playingTime + v.home + v.confederation + v.formerClub,
    refused: v.refused,
    lines,
  };
}
