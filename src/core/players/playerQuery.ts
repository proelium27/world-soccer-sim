import type { Player } from "./types.js";
import type { StoredTeam } from "../teams/clubs.js";
import { weeklyWage } from "../contracts.js";

/**
 * The per-player field constraints every "find me players" surface shares —
 * the transfer searches (`core/transfers/recommendations.ts`) and the player
 * database (`ui/pages/Database.tsx`).
 *
 * Extracted here rather than left on the transfer search, because two surfaces
 * answering "does this player match?" differently for the same player is what a
 * second copy of these comparisons drifts into — the same argument that put
 * `saleGateFor` in one place.
 *
 * Every field is optional and a null/undefined/"" value means "no constraint".
 *
 * These are *hard* constraints applied to the candidate pool before ranking —
 * they change which players a search considers, not just which of a fixed list
 * are shown. Everything in here is a plain field comparison, deliberately: the
 * callers walk every roster in the world on the user's keystroke path, so this
 * first pass has to stay cheap. Anything that needs a valuation, a sale gate or
 * a scouting fog belongs in the caller's second pass instead.
 */
export interface PlayerFieldFilters {
  position?: string;
  /** Exact match on Player.nationality (a country name, e.g. "Portugal"). */
  nationality?: string;
  /** Restrict to clubs currently playing in this competition (see core/competitions.ts). */
  compId?: number | null;
  /**
   * Restrict to clubs in any of these competitions — the set form of `compId`,
   * for a scope covering several at once ("top divisions", "the five strongest
   * countries"). Null means no constraint. Applied alongside `compId`, so a
   * caller may set either or both.
   */
  compIds?: ReadonlySet<number> | null;
  minOvr?: number | null;
  maxOvr?: number | null;
  minPot?: number | null;
  maxPot?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  /**
   * Weekly wage ceiling — weekly rather than per-season because that is the
   * figure the wage column shows, so the filter reads in the same units as the
   * number the user is looking at.
   */
  maxWeeklyWage?: number | null;
  /**
   * Seasons left on the contract, at most: 0 keeps only players whose deal
   * expires at the end of this season, 1 adds next season's expiries, and so on.
   */
  maxContractYears?: number | null;
}

/** True when at least one field constraint is set. */
export function hasFieldConstraint(f: PlayerFieldFilters): boolean {
  return (
    !!f.position || !!f.nationality
    || f.compId != null || f.compIds != null
    || f.minOvr != null || f.maxOvr != null
    || f.minPot != null || f.maxPot != null
    || f.minAge != null || f.maxAge != null
    || f.maxWeeklyWage != null || f.maxContractYears != null
  );
}

/**
 * The competition half of the filters, against a bare compId — for a caller
 * that has already resolved which competition a player is in (the database's
 * rows carry it) rather than the club he is in.
 */
export function compIdMatchesFilters(compId: number, f: PlayerFieldFilters): boolean {
  if (f.compId != null && compId !== f.compId) return false;
  if (f.compIds != null && !f.compIds.has(compId)) return false;
  return true;
}

/**
 * Club-level half of the field filters. Checked once per club rather than once
 * per player so a competition filter skips 20-odd rosters whole.
 */
export function teamMatchesFilters(team: StoredTeam, f: PlayerFieldFilters): boolean {
  return compIdMatchesFilters(team.compId, f);
}

/**
 * Player-level half of the field filters. `season` dates ages and contracts.
 *
 * `potentialOf` is what the potential range is tested against, and it exists so
 * a surface that *displays* a scouting estimate can *filter* on the same
 * estimate. Defaults to the true value, which is what the transfer searches have
 * always used; the player database passes its fogged reading instead, so its
 * POT filter agrees with its POT column (see `ui/potentialView.ts`).
 */
export function playerMatchesFilters(
  player: Player,
  f: PlayerFieldFilters,
  season: number,
  potentialOf: (p: Player) => number = (p) => p.potential,
): boolean {
  if (f.position && player.pos !== f.position) return false;
  if (f.nationality && player.nationality !== f.nationality) return false;
  if (f.minOvr != null && player.ovr < f.minOvr) return false;
  if (f.maxOvr != null && player.ovr > f.maxOvr) return false;
  if (f.minPot != null || f.maxPot != null) {
    const pot = potentialOf(player);
    if (f.minPot != null && pot < f.minPot) return false;
    if (f.maxPot != null && pot > f.maxPot) return false;
  }
  const age = season - player.born;
  if (f.minAge != null && age < f.minAge) return false;
  if (f.maxAge != null && age > f.maxAge) return false;
  if (f.maxWeeklyWage != null && weeklyWage(player.contract.salary) > f.maxWeeklyWage) return false;
  if (f.maxContractYears != null && player.contract.expiresSeason - season > f.maxContractYears) {
    return false;
  }
  return true;
}
