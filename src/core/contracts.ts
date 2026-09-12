import type { Player } from "./players/types.js";
import { mulberry32, hashInts } from "../engine/rng.js";
import {
  WAGE_WEEKLY_MIN, WAGE_OVR_FLOOR, WAGE_WEEKLY_COEFF, WAGE_VARIATION,
  EXTENSION_LENGTH_YOUNG, EXTENSION_LENGTH_MID, EXTENSION_LENGTH_OLD,
  EXTENSION_AGE_MID, EXTENSION_AGE_OLD, ACADEMY_STIPEND_WEEKLY, YOUTH_CONTRACT_LENGTH,
  ACADEMY_SCHOLARSHIP_AGE, ACADEMY_GRADUATION_AGE,
} from "./constants.js";

/** Stored salaries are per-season totals; the UI presents them weekly. */
export const WEEKS_PER_SEASON = 52;

export function weeklyWage(seasonSalary: number): number {
  return Math.round(seasonSalary / WEEKS_PER_SEASON);
}

/**
 * The per-season salary a contract signed in `seasonSigned` pays a player of
 * this ovr: a cubic weekly wage above WAGE_OVR_FLOOR (see the WAGE_* constants
 * for the Premier League calibration) times a ±WAGE_VARIATION factor that is
 * deterministic per (pid, seasonSigned) — the one-button contract UI shows
 * terms before signing, so the roll can't differ between preview and deal,
 * but the same player re-signing in a different season lands a new deal.
 */
export function seasonSalaryForOvr(ovr: number, pid: number, seasonSigned: number): number {
  const merit = WAGE_WEEKLY_COEFF * Math.max(0, ovr - WAGE_OVR_FLOOR) ** 3;
  const factor = 1 - WAGE_VARIATION + 2 * WAGE_VARIATION * mulberry32(hashInts(pid, seasonSigned))();
  const weekly = Math.round((WAGE_WEEKLY_MIN + merit * factor) / 100) * 100;
  return weekly * WEEKS_PER_SEASON;
}

export interface ContractTerms {
  /** Per-season total (presented weekly in the UI). */
  salary: number;
  lengthSeasons: number;
  expiresSeason: number;
}

/**
 * The one-button contract terms (design: contracts are never negotiated).
 * Salary is the standard rate for the player's current ovr; length is
 * deterministic by age — long deals for the young, short for the old —
 * unless the caller overrides it (the user's own extend UI lets them pick
 * 1-4 seasons directly; AI callers never pass an override).
 */
export function contractTerms(
  player: Player, season: number, lengthOverride?: number,
): ContractTerms {
  const age = season - player.born;
  const lengthSeasons = lengthOverride ?? (
    age < EXTENSION_AGE_MID ? EXTENSION_LENGTH_YOUNG
    : age < EXTENSION_AGE_OLD ? EXTENSION_LENGTH_MID
    : EXTENSION_LENGTH_OLD
  );
  return {
    salary: seasonSalaryForOvr(player.ovr, player.pid, season),
    lengthSeasons,
    expiresSeason: season + lengthSeasons,
  };
}

/** A contract "needs extending" once the player is in its final season. */
export function canExtend(player: Player, season: number): boolean {
  return player.contract.expiresSeason <= season;
}

/** Stamp fresh terms onto a player's contract, effective immediately. */
function applyContractTerms(players: Player[], pid: number, terms: ContractTerms): Player[] {
  return players.map((p) => {
    if (p.pid !== pid) return p;
    return { ...p, contract: { salary: terms.salary, expiresSeason: terms.expiresSeason } };
  });
}

/**
 * Re-sign a player to fresh one-button terms, effective immediately.
 * `lengthOverride` lets the user pick 1-4 seasons directly instead of the
 * default age-based length.
 */
export function extendContract(
  players: Player[], pid: number, season: number, lengthOverride?: number,
): Player[] {
  const p = players.find((q) => q.pid === pid);
  if (!p) return players;
  return applyContractTerms(players, pid, contractTerms(p, season, lengthOverride));
}

/**
 * The last season an academy deal covers for a kid born in `born`: the season
 * before his next checkpoint. The checkpoints are decisions (see
 * core/academyPipeline.ts), and making the deal run out exactly there is what
 * puts every kid in front of one on the right rollover — the offseason resolves
 * them instead of letting the deal lapse. Null once he is past the professional
 * cut, where an ordinary academy deal applies.
 */
export function academyCheckpointExpiry(born: number, season: number): number | null {
  const age = season - born;
  if (age < ACADEMY_SCHOLARSHIP_AGE) return born + ACADEMY_SCHOLARSHIP_AGE - 1;
  if (age < ACADEMY_GRADUATION_AGE) return born + ACADEMY_GRADUATION_AGE - 1;
  return null;
}

/**
 * Academy contract terms: a flat stipend regardless of ovr (see
 * ACADEMY_STIPEND_WEEKLY), not the normal ovr-cubic formula — an academy
 * prospect isn't yet competing for a senior wage.
 *
 * Length runs to the kid's next checkpoint when `born` is given and he is still
 * short of the professional cut; otherwise YOUTH_CONTRACT_LENGTH, which is what
 * an older prospect signed out of free agency gets.
 */
export function academyContractTerms(season: number, born?: number): ContractTerms {
  const checkpoint = born === undefined ? null : academyCheckpointExpiry(born, season);
  const expiresSeason = checkpoint ?? season + YOUTH_CONTRACT_LENGTH;
  return {
    salary: ACADEMY_STIPEND_WEEKLY * WEEKS_PER_SEASON,
    lengthSeasons: expiresSeason - season,
    expiresSeason,
  };
}

/** Re-sign an academy player to fresh flat-stipend terms, effective immediately. */
export function extendAcademyContract(players: Player[], pid: number, season: number): Player[] {
  const p = players.find((q) => q.pid === pid);
  if (!p) return players;
  return applyContractTerms(players, pid, academyContractTerms(season, p.born));
}

/**
 * Re-sign many players at once, each on his own age-based default terms.
 *
 * One pass over the pool rather than one per pid: `extendContract` maps the
 * whole array to change a single player, so re-signing a dozen would walk
 * ~6000 players a dozen times. It also keeps every untouched player by
 * REFERENCE, which the save layer's dirty-set diff depends on (see
 * test/db/playerIdentity.test.ts) — a copy of an unchanged player would be
 * written to disk for nothing.
 */
export function extendContracts(
  players: Player[], pids: Iterable<number>, season: number,
): Player[] {
  const set = new Set(pids);
  if (set.size === 0) return players;
  return players.map((p) => {
    if (!set.has(p.pid)) return p;
    const terms = contractTerms(p, season);
    return { ...p, contract: { salary: terms.salary, expiresSeason: terms.expiresSeason } };
  });
}

/** `extendContracts` for academy prospects: the flat stipend, same for everyone. */
export function extendAcademyContracts(
  players: Player[], pids: Iterable<number>, season: number,
): Player[] {
  const set = new Set(pids);
  if (set.size === 0) return players;
  return players.map((p) => {
    if (!set.has(p.pid)) return p;
    const terms = academyContractTerms(season, p.born);
    return { ...p, contract: { salary: terms.salary, expiresSeason: terms.expiresSeason } };
  });
}
