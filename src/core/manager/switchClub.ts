/**
 * Handing over one club and taking charge of another.
 *
 * Reassigning `meta.userTid` is the easy half: every consumer in the sim reads
 * it live, so the AI immediately starts managing the club you left and stops
 * managing the one you joined. The hard half is the handover — several fields on
 * `StoredTeam` are *user-only* by convention, and an AI club that inherits them
 * populated is a club in a state nothing in the game knows how to unwind.
 *
 * Pure and rng-free: contract terms are deterministic from ovr/pid/season, so a
 * switch cannot perturb the shared rng stream.
 */
import type { LeagueStore } from "../leagueState.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { Player } from "../players/types.js";
import { contractTerms } from "../contracts.js";
import { chooseBestFormation } from "../lineup/formations.js";
import { FREE_AGENT_TID } from "../transfers/negotiation.js";
import { reconcileScoutingObserved } from "../scouting/potentialFog.js";
import { ensureUserRosterSafety } from "../freeAgency.js";
import { MANAGER_START_CONFIDENCE } from "../constants.js";
import { newStint, type ManagerState } from "./types.js";

/**
 * Empty the departing club's youth academy onto its senior roster.
 *
 * **Not optional tidying.** `academyRoster` is a user-only holding pool: AI
 * clubs never promote from it, never field those players and never release
 * them, yet the players in it still draw wages (the offseason's season-start
 * charge sums roster *and* academy) and still count as rostered for the
 * free-agent cull. Left behind, they are permanent zombies — paid, uncullable,
 * and unable to ever play a match again.
 *
 * They graduate rather than being released, on ordinary senior terms: they were
 * the club's players and the squad they join is the one the AI now manages, so
 * the next offseason's `trimRosterSurplus` sorts out any surplus on its own
 * terms.
 */
function dissolveAcademy(
  team: StoredTeam,
  players: Player[],
  season: number,
): { team: StoredTeam; players: Player[] } {
  if (team.academyRoster.length === 0) return { team, players };

  const graduating = new Set(team.academyRoster);
  const updated = players.map((p) => {
    if (!graduating.has(p.pid)) return p;
    const terms = contractTerms(p, season);
    return { ...p, contract: { salary: terms.salary, expiresSeason: terms.expiresSeason } };
  });

  return {
    team: { ...team, roster: [...team.roster, ...team.academyRoster], academyRoster: [] },
    players: updated,
  };
}

/**
 * Strip every user-only field from a club being handed to the AI, and give it a
 * proper AI formation immediately rather than leaving it in whatever shape the
 * departing manager last picked (AI formations are otherwise only refreshed at a
 * transfer-window boundary, which could be a long way off).
 *
 * Only this one club's formation is touched. Re-running `assignAIFormations`
 * over the world would re-pick every AI club's shape at a moment nothing else in
 * the sim does, changing match results for 300-odd clubs as a side effect of the
 * user changing jobs.
 */
function handToAI(team: StoredTeam, players: Player[]): StoredTeam {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const roster = team.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
  return {
    ...team,
    starters: null,
    transferListed: [],
    moreMinutes: [],
    // Dropped rather than graduated, unlike the academy above: a trialist was
    // never signed, holds no contract and sits on no roster, so releasing the
    // pid is all it takes to make him an ordinary free agent anyone can sign.
    //
    // It has to happen HERE or the group is stranded for the life of the save.
    // The offseason only resets the group belonging to the current userTid, and
    // freeAgentPids counts trialists as rostered — so a group left on a club the
    // AI now runs is invisible to every signing path, never plays again, and
    // (being high-potential) escapes the free-agent cull too. Same permanent
    // zombie an unmanaged academyRoster would be, which is why dissolveAcademy
    // exists directly above.
    youthTrialists: [],
    youthTrialSignings: 0,
    // Both scout directions — scoutingRegions and scoutingPositions — are
    // deliberately NOT cleared, though both are just as user-only. Nothing
    // reads them except the intake pass, and only for the club matching
    // userTid — so on a club the AI now runs they are inert rather than
    // zombies, which is the whole distinction: a stranded trial group makes
    // real players invisible to every signing path, a stranded setting makes
    // nothing happen at all. Left in place so a manager who comes back to a
    // club finds the scouting network he set up, and both are visible and
    // editable on Youth Intake either way.
    scoutingObserved: {},
    nextScoutingSpend: team.scoutingSpend,
    formation: roster.length > 0 ? chooseBestFormation(roster) : team.formation,
  };
}

/**
 * Take charge of a club: its squad is fogged as of now, so you arrive knowing
 * these players' ratings but not their ceilings, exactly as if you'd just signed
 * every one of them. That falls out of the existing scouting model rather than
 * being special-cased for switching.
 */
function takeCharge(team: StoredTeam, season: number): StoredTeam {
  return {
    ...team,
    starters: null,
    transferListed: [],
    moreMinutes: [],
    scoutingObserved: reconcileScoutingObserved({}, team.roster, season),
    nextScoutingSpend: team.scoutingSpend,
  };
}

/**
 * Move the user from their current club to `newTid`, closing the current stint
 * and opening a new one.
 *
 * The club keeps its own money: you inherit the new club's budget, hype and
 * locked-in scouting spend, and nothing is pro-rated or refunded. Wages for the
 * season in progress were already charged to both clubs at season start, so a
 * switch at the offseason boundary settles cleanly with no double charge.
 */
export function switchClub(
  league: LeagueStore,
  newTid: number,
  ending: "sacked" | "left",
  /**
   * The season the new stint opens on. Defaults to the season after the one
   * just finished, which is what an offseason switch means: job offers are made
   * at a boundary, so your first season at the new club is the next one.
   *
   * The parameter exists for God Mode, which can hand you a club in the middle
   * of a season. There the new spell starts *now* — you manage the rest of this
   * season at the new club, and dating the stint a year forward would leave the
   * career table claiming you were nowhere while you were playing matches.
   */
  startSeason: number = league.season + 1,
): LeagueStore {
  const oldTid = league.meta.userTid;
  if (newTid === oldTid) return league;
  if (!league.teams.some((t) => t.tid === newTid)) return league;

  // Backstop the club being handed over: `ensureUserRosterSafety` only ever
  // protects `userTid`, so a squad left thin (or without a keeper) would have
  // nothing rebuilding it until the next offseason's AI free agency.
  const safe = ensureUserRosterSafety(
    league.teams,
    league.players,
    oldTid,
    league.season,
    league.activeLoans,
  );
  let players = safe.players;

  let teams = safe.teams;
  const old = teams.find((t) => t.tid === oldTid);
  if (old) {
    const dissolved = dissolveAcademy(old, players, league.season);
    players = dissolved.players;
    teams = teams.map((t) => (t.tid === oldTid ? handToAI(dissolved.team, players) : t));
  }
  teams = teams.map((t) => (t.tid === newTid ? takeCharge(t, league.season) : t));

  const stints = league.manager.stints.map((s, i) =>
    i === league.manager.stints.length - 1 && s.endSeason === null
      ? { ...s, endSeason: league.season, ending }
      : s,
  );

  const manager: ManagerState = {
    ...league.manager,
    confidence: MANAGER_START_CONFIDENCE,
    // Normally the season after the one just finished (the switch happens at
    // the offseason boundary), but God Mode can start it today — see the
    // `startSeason` parameter.
    stints: [...stints, newStint(newTid, startSeason)],
    offers: [],
    sacked: false,
    // You got the job, so it's no longer one you're asking for. The rest of the
    // list stays: wanting Barcelona is about the manager, not the club he's at.
    ...(league.manager.interests
      ? { interests: league.manager.interests.filter((t) => t !== newTid) }
      : {}),
    // Belongs to the club just left. Kept, it renders beside the new club's
    // fresh bar as "confidence went 12 -> 0" with no club named, which reads as
    // the new board's verdict on a season it never saw.
    lastVerdict: null,
  };

  return {
    ...league,
    meta: { ...league.meta, userTid: newTid },
    teams,
    players,
    manager,
    // The safety backstop above can call a player up off the open market, which
    // is a real arrival and needs the same fee-0 sentinel record an ordinary
    // free signing gets — club-by-season history is rebuilt from the transfer
    // log alone, so without it he keeps showing his previous club.
    transfers: [
      ...league.transfers,
      ...safe.marketSignings.map((pid) => ({
        pid, fromTid: FREE_AGENT_TID, toTid: oldTid, fee: 0,
        season: league.season, window: "summer" as const,
      })),
    ],
    // Every one of these is implicitly "the user's": talks the old club was
    // holding, bids for the old club's players, and loan business the old club
    // had open. Carried over they'd read as the new club's, and acting on one
    // would move a player between two clubs the user no longer connects.
    negotiations: [],
    inboundOffers: [],
    loanListings: [],
    loanRejections: [],
    // `transferClauses` is deliberately NOT cleared, for the same reason
    // `activeLoans` above survives: a sell-on or bonus is a contract between two
    // CLUBS, not an instruction from the manager. The club he left keeps what it
    // is owed and keeps owing what it owes, whoever is picking its team now, and
    // a club he has just joined may already carry clauses of its own.
  };
}
