import type { LeagueStore } from "./leagueState.js";
import type { StoredTeam } from "./teams/clubs.js";
import { computeOvr } from "./players/ovr.js";
import type { Player, PlayerRatings, Position } from "./players/types.js";
import { emptyCareerSummary } from "./players/careerSummary.js";

/**
 * God Mode sandbox helpers. Every function here is pure — it returns new
 * arrays/objects and never mutates its inputs — and deliberately bypasses the
 * realism guardrails (fees, budget, ROSTER_CAP, depth floors) that the normal
 * transfer/free-agency paths enforce. Nothing here should be reachable unless
 * LeagueStore.godMode is true (the UI gates on it).
 */

/**
 * Remove a player from every club's roster/academy and scrub all transient
 * per-window and lineup state that references him, so a God Mode move or
 * release leaves no dangling pid for the match engine or any UI list. A
 * detached player who isn't re-added anywhere is, by definition, a free agent.
 */
export function detachPlayer(league: LeagueStore, pid: number): LeagueStore {
  const teams: StoredTeam[] = league.teams.map((t) => {
    const inRoster = t.roster.includes(pid);
    const inAcademy = t.academyRoster.includes(pid);
    const inList = t.transferListed.includes(pid);
    const wasStarter = t.starters?.includes(pid) ?? false;
    if (!inRoster && !inAcademy && !inList && !wasStarter) return t;
    return {
      ...t,
      roster: inRoster ? t.roster.filter((p) => p !== pid) : t.roster,
      academyRoster: inAcademy ? t.academyRoster.filter((p) => p !== pid) : t.academyRoster,
      transferListed: inList ? t.transferListed.filter((p) => p !== pid) : t.transferListed,
      // A stale starter pid would make resolveXI fall back anyway, but null it
      // explicitly so the XI re-auto-picks cleanly.
      starters: wasStarter ? null : t.starters,
    };
  });

  return {
    ...league,
    teams,
    negotiations: league.negotiations.filter((n) => n.pid !== pid),
    inboundOffers: league.inboundOffers.filter((o) => o.pid !== pid),
    loanListings: league.loanListings.filter((l) => l.pid !== pid),
    activeLoans: league.activeLoans.filter((l) => l.pid !== pid),
    loanRejections: league.loanRejections.filter((r) => r.pid !== pid),
  };
}

/**
 * God Mode: assign a player to a club's senior roster instantly — no fee, no
 * budget check, no ROSTER_CAP, no depth floor. Detaches him from wherever he
 * currently is first (via detachPlayer), so transient state stays consistent.
 * No-op if the target club doesn't exist or he's already on its roster.
 */
export function movePlayerToClub(league: LeagueStore, pid: number, tid: number): LeagueStore {
  const target = league.teams.find((t) => t.tid === tid);
  if (!target) return league;
  if (target.roster.includes(pid)) return league;

  const detached = detachPlayer(league, pid);
  return {
    ...detached,
    teams: detached.teams.map((t) =>
      t.tid === tid ? { ...t, roster: [...t.roster, pid] } : t,
    ),
  };
}

export interface PlayerEdit {
  name?: string;
  nationality?: string;
  pos?: Position;
  heightCm?: number;
  /** Player age in whole years; stored as born = season - age. */
  age?: number;
  ratings?: Partial<PlayerRatings>;
  potential?: number;
  contract?: { salary?: number; expiresSeason?: number };
  clearInjury?: boolean;
  /** Lift a league ban outright, along with the yellow tally behind it. */
  clearSuspension?: boolean;
  /**
   * Freeze (true) or resume (false) this player's development — see
   * `Player.ratingsLocked`. Omitted leaves the current setting alone, so an
   * edit that says nothing about the lock can't clear one.
   */
  ratingsLocked?: boolean;
}

/**
 * God Mode: apply an edit to one player, recomputing OVR whenever ratings,
 * position, or height change. Fields not present in `edit` are left as-is.
 * Immutable — returns a new array with a new Player object for the edited pid.
 */
export function applyPlayerEdit(
  players: Player[], pid: number, season: number, edit: PlayerEdit,
): Player[] {
  return players.map((p) => {
    if (p.pid !== pid) return p;
    const ratings = edit.ratings ? { ...p.ratings, ...edit.ratings } : p.ratings;
    const pos = edit.pos ?? p.pos;
    const heightCm = edit.heightCm ?? p.heightCm;
    const ratingsChanged =
      edit.ratings !== undefined || edit.pos !== undefined || edit.heightCm !== undefined;
    return {
      ...p,
      name: edit.name ?? p.name,
      nationality: edit.nationality ?? p.nationality,
      pos,
      heightCm,
      born: edit.age !== undefined ? season - edit.age : p.born,
      ratings,
      ovr: ratingsChanged ? computeOvr(pos, ratings, heightCm) : p.ovr,
      potential: edit.potential ?? p.potential,
      contract: edit.contract
        ? {
            salary: edit.contract.salary ?? p.contract.salary,
            expiresSeason: edit.contract.expiresSeason ?? p.contract.expiresSeason,
          }
        : p.contract,
      injury: edit.clearInjury ? null : p.injury,
      suspension: edit.clearSuspension ? null : p.suspension,
      yellowCount: edit.clearSuspension ? 0 : p.yellowCount,
      // Normalized to true-or-absent rather than stored as `false`, so "absent
      // means unlocked" stays literally true of every player in the save and
      // not just of the ones nobody has edited.
      ratingsLocked: (edit.ratingsLocked ?? p.ratingsLocked) ? true : undefined,
    };
  });
}

export interface NewPlayerSpec {
  name: string;
  nationality: string;
  pos: Position;
  heightCm: number;
  age: number;
  ratings: PlayerRatings;
  potential: number;
  contract: { salary: number; expiresSeason: number };
  /** Club to place the new player on, or null to leave him a free agent. */
  tid: number | null;
}

/**
 * God Mode: build a brand-new player from a full spec and add him to the
 * league. Allocates a fresh pid (max existing + 1), computes OVR from the
 * given ratings, and seeds a single baseline hist snapshot at season - 1
 * (mirroring generatePlayer, so the OVR-history chart/table have a start
 * point). Places him on `spec.tid`'s roster, or leaves him a free agent when
 * tid is null. Returns the updated league and the new pid.
 */
export function createCustomPlayer(
  league: LeagueStore, spec: NewPlayerSpec,
): { league: LeagueStore; pid: number } {
  // Take the stored monotonic cursor, not max(pid) + 1: players get removed
  // (retirement, the free-agent cull), and a derived cursor would reissue a
  // removed player's pid to this new one, handing him that player's transfer,
  // news and cup history. See LeagueStore.nextPid.
  // The `?? 0` is not decoration: a league object built outside migrate (a test
  // fixture, a hand-rolled import) has no cursor, and Math.max(undefined, n) is
  // NaN — which would sail straight into a player's pid.
  const pid = Math.max(
    Number.isFinite(league.nextPid) ? league.nextPid : 0,
    league.players.reduce((max, p) => Math.max(max, p.pid), 0) + 1,
  );
  const ovr = computeOvr(spec.pos, spec.ratings, spec.heightCm);
  const player: Player = {
    pid,
    name: spec.name,
    nationality: spec.nationality,
    born: league.season - spec.age,
    pos: spec.pos,
    heightCm: spec.heightCm,
    ratings: spec.ratings,
    ovr,
    potential: spec.potential,
    contract: { ...spec.contract },
    injury: null,
    stats: [],
    hist: [
      { season: league.season - 1, ratings: spec.ratings, ovr, potential: spec.potential, academy: false, pos: spec.pos },
    ],
    // Set alongside `hist` for the same reason as every other construction
    // site: `peakOvr` is authoritative once present, so a player carrying a
    // history and a stale peak would read as worse than he ever was, and the
    // fallback that would catch it goes away when `hist` stops being resident
    // (docs/lazy-career-plan.md).
    peakOvr: ovr,
    peakOvrSeason: league.season - 1,
    career: emptyCareerSummary(),
  };
  // Advance the cursor so this pid can never be handed out again.
  const withPlayer: LeagueStore = {
    ...league,
    players: [...league.players, player],
    nextPid: pid + 1,
  };
  return {
    league: spec.tid === null ? withPlayer : movePlayerToClub(withPlayer, pid, spec.tid),
    pid,
  };
}

/**
 * God Mode: set a club's budget and hype directly. Hype is clamped to its
 * valid 0..100 range; budget is left unclamped (any value allowed, including
 * negative, for sandbox/debug use). No-op for an unknown tid.
 */
export function setClubFinances(
  teams: StoredTeam[], tid: number, budget: number, hype: number,
): StoredTeam[] {
  if (!teams.some((t) => t.tid === tid)) return teams;
  const clampedHype = Math.max(0, Math.min(100, hype));
  return teams.map((t) => (t.tid === tid ? { ...t, budget, hype: clampedHype } : t));
}
