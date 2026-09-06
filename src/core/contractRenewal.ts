/**
 * "Extend all" — re-signing every one of your players whose deal is up, in one
 * click, instead of one button press per row.
 *
 * The selection lives here rather than in the pages so the button's label and
 * the action that runs can't disagree about who is included: `renewalsDue`
 * answers "who, and what does it cost", `extendAllContracts` re-signs exactly
 * that set. A page reading its own list to build the label and then calling a
 * differently-scoped action is the bug this shape exists to prevent.
 *
 * Scoped by GROUP, one per surface that lists players, because each surface
 * shows a different set of your players and a button should only ever do what
 * the list beside it shows:
 *   - "senior"    the Roster page: the players on your senior roster.
 *   - "academy"   the Academy page: prospects, on the flat stipend.
 *   - "loanedOut" the Loans page: players you own who are away on loan. They
 *                 are NOT on your roster (a loan moves the pid, which is how
 *                 the wage handoff works), so the Roster group misses them and
 *                 this is the only surface they appear on at all.
 */
import type { LeagueStore } from "./leagueState.js";
import type { Player } from "./players/types.js";
import type { StoredTeam } from "./teams/clubs.js";
import {
  canExtend, contractTerms, academyContractTerms, extendContracts, extendAcademyContracts,
} from "./contracts.js";
import { wouldRefuseExtension } from "./ai/breakoutRefusal.js";

export type RenewalGroup = "senior" | "academy" | "loanedOut";

export interface RenewalsDue {
  /** Players in their final year who would be re-signed, in roster order. */
  pids: number[];
  /**
   * Players in their final year who won't sign a new deal here — a Division 2
   * squad's breakout stars (see ai/breakoutRefusal.ts). Reported separately so
   * a page can say why the button doesn't cover everyone wearing a "Final
   * year" badge. Always empty for the academy group, which has no such gate.
   */
  refusingPids: number[];
  /** Combined per-season wage bill of the new deals (the UI presents it weekly). */
  totalSalary: number;
}

/** The pids this group covers, whatever their contract status. */
function groupPids(league: LeagueStore, team: StoredTeam, group: RenewalGroup): number[] {
  if (group === "academy") return team.academyRoster;
  if (group === "senior") {
    // The senior roster lists who plays here, not who is owned here: a player
    // in on loan sits on it while his contract belongs to his parent club, so
    // extending him would be re-signing another club's player. The mirror of
    // the "loanedOut" group below, which covers exactly the opposite set.
    const borrowed = new Set(
      league.activeLoans
        .filter((l) => l.loaneeTid === team.tid && l.parentTid !== team.tid)
        .map((l) => l.pid),
    );
    return team.roster.filter((pid) => !borrowed.has(pid));
  }
  return league.activeLoans.filter((l) => l.parentTid === team.tid).map((l) => l.pid);
}

/**
 * Who on this surface is out of contract, and what re-signing them all costs.
 * Terms are each player's age-based default — the same deal the per-row Extend
 * button offers before you touch its length dropdown.
 */
export function renewalsDue(league: LeagueStore, group: RenewalGroup): RenewalsDue {
  const pids: number[] = [];
  const refusingPids: number[] = [];
  let totalSalary = 0;

  const team = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!team) return { pids, refusingPids, totalSalary };
  const candidates = groupPids(league, team, group);

  // Index only this group's players — a few dozen — rather than every player
  // in the world. Still one pass over the pool, but it doesn't allocate a
  // 6000-entry map on each of the three pages that asks.
  const wanted = new Set(candidates);
  const byPid = new Map<number, Player>();
  for (const p of league.players) if (wanted.has(p.pid)) byPid.set(p.pid, p);

  const stipend = academyContractTerms(league.season).salary;

  for (const pid of candidates) {
    const p = byPid.get(pid);
    if (!p || !canExtend(p, league.season)) continue;
    if (group === "academy") {
      pids.push(pid);
      totalSalary += stipend;
      continue;
    }
    // A loaned-out player's refusal is about the club that OWNS him, which is
    // the user's — the same reason extendContractAction resolves the parent
    // rather than whichever roster currently holds the pid.
    if (wouldRefuseExtension(p, team, league.competitions)) {
      refusingPids.push(pid);
      continue;
    }
    pids.push(pid);
    totalSalary += contractTerms(p, league.season).salary;
  }

  return { pids, refusingPids, totalSalary };
}

/**
 * Re-sign every player `renewalsDue` names for this group. Returns the league
 * unchanged (by reference, so the caller can skip the save) when there's
 * nobody to re-sign.
 */
export function extendAllContracts(league: LeagueStore, group: RenewalGroup): LeagueStore {
  const { pids } = renewalsDue(league, group);
  if (pids.length === 0) return league;
  const players = group === "academy"
    ? extendAcademyContracts(league.players, pids, league.season)
    : extendContracts(league.players, pids, league.season);
  return { ...league, players };
}
