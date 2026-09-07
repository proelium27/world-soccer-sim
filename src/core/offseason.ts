import type { LeagueStore } from "./leagueState.js";
import type { Player } from "./players/types.js";
import type { StoredTeam } from "./teams/clubs.js";
import { assignAIFormations } from "./teams/clubs.js";
import type { Competition } from "./competitions.js";
import { progressPlayer, rollRetirement } from "./players/progression.js";
import { packPositionChange, type NewsEvent } from "./newsEvents.js";
import { generateYouthIntake } from "./players/youth.js";
import { computeAcademyFormModifiers } from "./players/academyForm.js";
import { academyFacilitiesBonus } from "./players/academyFacilities.js";
import { scoutDirectionsOf, scoutedNationalityWeights } from "./scouting/scoutDirections.js";
import { pickNationality, LEAGUE_NATIONALITY_WEIGHTS } from "./players/nationalities.js";
import { generateName } from "./players/names.js";
import { cullFreeAgentPoolReporting } from "./players/freeAgentCull.js";
import { summarizeRetirements } from "./players/retirements.js";
import { honourSourcesOf, type HonourSources } from "./frivolities/goat.js";
import { clearSuspension } from "./suspensions.js";
import { extendRetireeArchive } from "./players/archive.js";
import { withSeason, summaryOf, ovrLookup } from "./players/careerSummary.js";
import { extendPlayerNames } from "./players/playerNames.js";
import { archiveCup } from "./cup/archive.js";
import {
  releaseExpiredContracts, runAIFreeAgency, freeAgencySigningOrder, trimRosterSurplus,
  ensureUserRosterSafety,
  freeAgentPids,
} from "./freeAgency.js";
import { runAITransferMarket } from "./ai/transferMarket.js";
import { FREE_AGENT_TID, isFreeAgentTid } from "./transfers/negotiation.js";
import { transferWindowState } from "./transfers/window.js";
import { protectedStarPids } from "./transfers/protectedStars.js";
import { runAIContractRenewals } from "./ai/renewals.js";
import { enforceDivisionCeilings } from "./ai/divisionCeiling.js";
import { reconcileScoutingObserved } from "./scouting/potentialFog.js";
import { processLoanReturns, runAILoanMarket } from "./loans.js";
import { computeStandings, computeTeamSeasonStats, type SeasonHistoryEntry, type StandingsRow, type TeamSeasonStats } from "./standings.js";
import { computeSeasonAwards, type SeasonAwards } from "./awards.js";
import { computeWorldAwards } from "./worldAwards.js";
import { snapshotAwardWinners } from "./awardWinners.js";
import { buildCupState } from "./cup/cup.js";
import type { QualificationContext } from "./cup/qualification.js";
import { domesticCupWinners, qualificationByTid } from "./cup/qualification.js";
import { coefficientSlots } from "./cup/coefficients.js";
import { buildDomesticCups } from "./domesticCup/cup.js";
import { archiveDomesticCup } from "./domesticCup/archive.js";
import { buildSuperCups } from "./superCup/superCup.js";
import { computeCountrySwaps, applyCompetitionSwaps, stepAcademyBaseConvergence } from "./promotion.js";
import {
  playPromotionPlayoffs, playoffOutcomes, playoffsForSeason,
} from "./promotionPlayoff.js";
import { generateSchedule } from "./schedule.js";
import { updateHype } from "./finance/hype.js";
import {
  settleSeasonEnd, chargeSeasonStart, wageBill, financeScaleFor, clampBudget,
} from "./finance/budget.js";
import { clampScoutingSpend } from "./finance/scouting.js";
import { competitionOf, competitionTeamCount, competitionNationalities, tierOf } from "./competitions.js";
import type { TransferClause } from "./transfers/clauses.js";
import {
  settleBonuses, payoutDeltas, expireClauses, scrubClausesForPids,
} from "./transfers/clauses.js";
import { simThroughInternational, confederationCupChampions } from "./international/index.js";
import { reviewNationalCampaign } from "./nationalManager/index.js";
import { carryIntlInjuries } from "./injuries.js";
import { hashInts, mulberry32 } from "../engine/rng.js";
import {
  NEWS_POSITION_CHANGE_OVR, CONTINENTAL_CUP_FORMAT, SHIELD_FORMAT, difficultyProfile,
  YOUTH_TRIAL_GROUP_MIN, YOUTH_TRIAL_GROUP_MAX, YOUTH_TRIAL_STREAM,
} from "./constants.js";

/** rng-stream tag for rolling carried-over international injury durations. */
const INTL_INJURY_STREAM = 840;

/** Awards for the season that just ended, computed separately per competition from players' current club membership. */
function awardsByCompetition(
  players: Player[],
  teams: StoredTeam[],
  competitions: Competition[],
  season: number,
): Record<number, SeasonAwards> {
  const result: Record<number, SeasonAwards> = {};
  for (const comp of competitions) {
    const roster = new Set(teams.filter((t) => t.compId === comp.id).flatMap((t) => t.roster));
    result[comp.id] = computeSeasonAwards(players.filter((p) => roster.has(p.pid)), season);
  }
  return result;
}

/**
 * Run one full offseason: contract expiry, progression, retirement, AI free
 * agency, youth intake, promotion/relegation, then a fresh schedule for the
 * new season. Only callable when the league is in the "offseason" phase
 * (all 38 matchdays played in both divisions). The user's team is left
 * untouched by free agency/youth so the UI can offer those as manual
 * actions later; youth intake still applies to every club per spec (no
 * draft mechanic).
 */
/**
 * What the caller has already worked out on the offseason's behalf.
 *
 * Both entries exist for the same reason and are the same trade: the offseason
 * reads exactly two things it did not itself produce this run — the season's box
 * scores, and the append-only history — and both are enormous. Handing the
 * answers in is what lets `core/simArchive.ts` keep the inputs off the worker.
 * Every field is optional and defaulted, so the ~60 callers across tests and
 * scripts are unaffected.
 */
export interface OffseasonInputs {
  /**
   * This season's team stat totals. `computeTeamSeasonStats` is the **only**
   * place the sim reads a box score belonging to a matchday it did not just
   * play, and box scores are the heaviest thing in a save. See `detachPlayed`.
   */
  teamStats?: TeamSeasonStats[];
  /**
   * Every pid the save's surviving history still points at, for
   * `extendPlayerNames`. That walk covers `newsEvents` and the cup `statLines`,
   * which is the only reason those have to reach the worker. See `detachNews`.
   */
  referencedPids?: Set<number>;
  /**
   * Who won each past Continental Cup, Shield and domestic cup — the two
   * numbers per cup that `computeHonours` needs to credit a retiring player's
   * trophies on the farewell list.
   *
   * Precomputed by the caller for the same reason `referencedPids` is: the
   * worker is handed empty cup histories (`detachNews`), so reading them here
   * would rank a five-time Continental Cup winner as if he had won nothing —
   * silently, since an empty history is not an error. Absent means "read them
   * off the league", which is right for every direct caller (tests, scripts,
   * and `jump`, which is exempt from detaching).
   */
  cupChampions?: Pick<HonourSources, "cup" | "shield" | "domestic">;
}

/** What the offseason did that the caller cannot work out from the league alone. */
export interface OffseasonReport {
  /**
   * Players the free-agent cull deleted.
   *
   * The cull scrubs their rows out of `newsEvents` and the cup histories so a
   * deleted nobody leaves nothing dangling. Once those arrays stay on the main
   * thread, the worker can no longer do that scrub — so it reports who went and
   * the main thread applies it. **Retirees are deliberately not here:** unlike a
   * culled nobody, a retiree had a real career and his rows are kept on purpose.
   */
  culledPids: Set<number>;
}

export function simOffseason(
  league: LeagueStore,
  rng: () => number,
  inputs?: OffseasonInputs,
): LeagueStore {
  return simOffseasonReporting(league, rng, inputs).league;
}

/**
 * `simOffseason`, plus what it did that the caller has to know about.
 *
 * A separate entry point rather than a changed return type, because
 * `simOffseason` has ~60 call sites across tests and scripts and none of them
 * should have to care. Only the worker uses this one.
 */
export function simOffseasonReporting(
  league: LeagueStore,
  rng: () => number,
  inputs: OffseasonInputs = {},
): { league: LeagueStore; report: OffseasonReport } {
  const {
    teamStats: precomputedTeamStats,
    referencedPids: precomputedReferenced,
    cupChampions: precomputedChampions,
  } = inputs;
  if (league.phase !== "offseason") {
    return { league, report: { culledPids: new Set<number>() } };
  }

  // International football (drawn the instant the season ended, see simThrough)
  // is played out *before* anything else in the advance, so squads read
  // end-of-season ratings and the whole thing lands before progression and
  // retirement (a retiring veteran gets one last campaign). The UI plays it in
  // stages the user watches and only enables "Advance" once it's done, so this
  // is normally a no-op; here it also completes any stages the user didn't play
  // by hand, keeping the advance self-contained. No shared-`rng` draw — every
  // international match runs on its own seeded stream (see simIntl.ts).
  const intl = simThroughInternational(league.international, league.players, league.lid, league.season);
  league = { ...league, international: intl.international, players: intl.players };

  // The federation's review of whatever campaign just concluded, plus this
  // summer's approaches from other countries. It has to sit *here* rather than
  // at the season boundary where the club board's review sits: the campaign is
  // drawn at that boundary but played during this advance, so at the boundary
  // there is nothing to judge yet. Touches only `nationalManager` (and, on a
  // dismissal, the departed nation's chosen eleven) and draws on its own seeded
  // stream, so a save managing no country is unaffected but for its offer list.
  league = reviewNationalCampaign(league);

  const endingSeason = league.season;
  const nextSeason = endingSeason + 1;

  // Per-competition final tables. Computed here rather than down at step 3.5
  // where they are spent, because the promotion playoff immediately below needs
  // them and must run before anything touches a squad. Nothing between here and
  // there moves a club between competitions or adds one, so this is the same
  // map step 3.5 used to build for itself.
  const tablesByCompId = new Map<number, StandingsRow[]>();
  for (const comp of league.competitions) {
    const compTids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const compTidSet = new Set(compTids);
    tablesByCompId.set(
      comp.id,
      computeStandings(compTids, league.played.filter((m) => compTidSet.has(m.home))),
    );
  }

  // Promotion playoffs for the season just finished. Normally already played —
  // `simThrough` settles them the moment the season ends, so the board could
  // review a promotion — and this replays them only for a caller that never
  // came through there (every test and audit script that drives `simOffseason`
  // directly). Both paths land on the same result: every tie's stream is
  // derived from the league's own content, and both read end-of-season squads,
  // which is why this sits above contract renewals rather than beside the swap
  // it feeds at step 3.6. No shared-`rng` draw, so no league scoreline moves.
  const playedPlayoffs = playoffsForSeason(league.promotionPlayoffs, endingSeason);
  const promotionPlayoffs = playedPlayoffs.length > 0
    ? playedPlayoffs
    : playPromotionPlayoffs(
      league.competitions, league.teams, league.players, tablesByCompId,
      league.lid, endingSeason,
    );

  // Snapshotted before any roster/competition change below, from
  // league.players (not the `players` variable mutated further down) so a
  // player who retires this offseason still gets credit for the season he
  // just finished, and competition membership reflects who actually played
  // where.
  const compsByTid: Record<number, number> = {};
  for (const t of league.teams) compsByTid[t.tid] = t.compId;

  // Who a club actually rostered *last season*, snapshotted here because it is
  // the quality signal retirement reads at step 3 — and by then step 1 has
  // released every expired contract into the free pool while step 4 hasn't
  // re-signed anyone yet, so a live read would retire a crowd of players who
  // were about to be picked back up. Taken from the pre-step-1 `league.teams`
  // and `league.activeLoans`, and via `freeAgentPids` so academy players and
  // players out on loan count as rostered (they are, just not by their parent
  // club). Grace is deliberate: a contract expiring at the end of last season
  // still leaves him "rostered" for this offseason's roll, so he gets one full
  // free agency to find a club before the unrostered rate starts applying.
  const unrosteredLastSeason = freeAgentPids(league.teams, league.players, league.activeLoans);
  // Which club, for the same reason and off the same pre-step-1 rosters: a
  // retiring player's last club is what the Season Preview names him under, and
  // reading it after step 1 would file a fifteen-year club legend whose contract
  // just ran out as a free agent on his way out the door. A player out on loan
  // maps to the club that fielded him last season (wages key off roster
  // membership, so that is where he was), not his parent club.
  const tidLastSeason = new Map<number, number>();
  for (const t of league.teams) {
    for (const pid of [...t.roster, ...t.academyRoster]) tidLastSeason.set(pid, t.tid);
  }
  const awards = awardsByCompetition(league.players, league.teams, league.competitions, endingSeason);

  // 0. Proactive AI contract renewals (cross-division: a club's own player,
  //    regardless of which division that club plays in). "Own" means owns, not
  //    rosters — a club out on loan still decides its own player's contract,
  //    and the club borrowing him does not.
  const renewals = runAIContractRenewals(
    league.teams, league.players, nextSeason, league.meta.userTid, league.played,
    hashInts(league.lid, nextSeason, 9), league.competitions, league.activeLoans,
  );

  // 1. Loan returns due this rollover: any player whose loan ends before
  //    nextSeason begins goes back to his parent club now — early enough that
  //    free agency below can still fill any hole this creates, and before
  //    season-start wages are charged so they land on the right club.
  //
  //    This runs BEFORE contract expiry, and the order is load-bearing. A
  //    loaned player is physically on the loanee's roster, so releasing first
  //    handed the loanee's club an expiry decision about somebody else's
  //    player and sent him home on an already-dead contract a season later
  //    (or, on a multi-season loan, stranded him on no roster at all). Now he
  //    lands back at his parent first and his contract is settled there: if it
  //    has run out he is released into free agency in the same rollover, in
  //    time for step 4 to sign him.
  const loanReturns = processLoanReturns(
    renewals.teams, league.activeLoans, league.transfers, nextSeason,
  );
  let activeLoans = loanReturns.activeLoans;

  // 1.25. A loan can't outlive the deal it was agreed under. If the player's
  //       contract has run out while he was away, the loan ends here instead of
  //       running on: his parent's contract with him is over, so there is
  //       nothing left to send home, and he goes into free agency below like
  //       anyone else whose deal expired. New loans can no longer be agreed
  //       past the contract's length (maxLoanSeasons), so this only fires on
  //       saves made before that cap — but it must fire, or he sits out the
  //       rest of the loan on a dead contract.
  const contractByPid = new Map(renewals.players.map((p) => [p.pid, p.contract]));
  activeLoans = activeLoans.filter(
    (l) => (contractByPid.get(l.pid)?.expiresSeason ?? Infinity) > endingSeason,
  );

  // 1.5. Release expired contracts to the free agent pool — skipping anyone
  //      still out on loan, whose contract is his parent club's business and
  //      is settled when he comes home (see releaseExpiredContracts).
  let teams: StoredTeam[] = releaseExpiredContracts(
    loanReturns.teams, renewals.players, endingSeason,
    new Set(activeLoans.map((l) => l.pid)),
  );

  // 1.7. International football (qualifying campaigns and World Cups) is no
  //      longer played here. It runs *before* the offseason advances, drawn the
  //      instant the club season ends and then played in stages the user clicks
  //      through (see core/international/staging.ts); its results and the caps it
  //      credits are already on `league.players`/`league.international` by the
  //      time this advance runs. Because it happens before this whole function,
  //      it is naturally before progression and retirement — a player injured in
  //      May still misses the tournament, one about to retire gets one last
  //      campaign — exactly as before, only now watchable.

  // 2. Progress every remaining player's ratings; heal any lingering injury and
  //    wipe every suspension and yellow-card tally (bans don't cross seasons).
  //    Academy players have no senior appearances to read minutes from (they
  //    don't play senior matches), so they're assumed to play a full season
  //    rather than being penalized with the worst-case minutesFactor.
  //    A season's development can also change what position a player is listed
  //    at (see players/positions.ts). That is decided inside progressPlayer off
  //    his attributes; detecting it here is just a before/after comparison, and
  //    it is where the club he was at is still known.
  const academyPids = new Set(teams.flatMap((t) => t.academyRoster));
  const positionChangeEvents: NewsEvent[] = [];
  let players: Player[] = renewals.players.map((p) => {
    // Fold the season that just finished into his career summary, before
    // progression replaces the object. This is the one place it happens: the
    // summary covers finished seasons only, so exactly one fold per player per
    // season, and anything wanting a live number adds the current row itself
    // (see players/careerSummary.ts). Pure and rng-free.
    const finished = p.stats.find((s) => s.season === endingSeason);
    // Always set, even for a youth-intake player who has finished nothing: every
    // player carrying the field is what lets readers drop the "or compute it
    // from his seasons" fallback, which stops being possible at all once the
    // seasons live on disk.
    const ovrFor = ovrLookup(p.hist, p.peakOvr ?? p.ovr);
    const base = p.career ?? summaryOf(p.stats.filter((s) => s.season !== endingSeason), ovrFor);
    p = { ...p, career: finished ? withSeason(base, finished, ovrFor(endingSeason)) : base };
    const progressed = progressPlayer(
      rng, p, endingSeason, academyPids.has(p.pid), league.progressionModel,
    );
    const tid = tidLastSeason.get(p.pid);
    // Only rostered players, and away from the user's own club only the ones
    // good enough to be news. Every conversion in the world would bury the feed
    // the same way AI free-agent churn would — the user's squad is always worth
    // telling him about, a mid-table reserve in another country is not.
    if (progressed.pos !== p.pos && tid !== undefined
      && (tid === league.meta.userTid || progressed.ovr >= NEWS_POSITION_CHANGE_OVR)) {
      positionChangeEvents.push({
        type: "positionChange", pid: p.pid, tid,
        season: nextSeason, matchday: 0,
        detail: packPositionChange(p.pos, progressed.pos),
      });
    }
    // Bans and yellow tallies expire with the season, alongside the injury heal.
    return clearSuspension(progressed.injury ? { ...progressed, injury: null } : progressed);
  });

  // 3. Roll retirement; drop retirees from rosters and the player pool. Age
  //    sets the odds, last season's roster status scales them: a player a club
  //    wanted retires slowly, one nobody rostered drifts out of the game at any
  //    age (see the RETIREMENT_* block in constants.ts). One rng draw per
  //    player either way, so the shared stream's draw count is unchanged.
  //    The retirees are captured (not just their pids) because they are about to
  //    be deleted from the save entirely: the Season Preview's farewell list is
  //    built from this snapshot, since nothing can be looked up afterwards.
  const retirees = players.filter((p) =>
    rollRetirement(
      rng, p, endingSeason, !unrosteredLastSeason.has(p.pid), league.progressionModel,
    ));
  const retiredPids = new Set(retirees.map((p) => p.pid));
  // The farewell notice itself is built at step 3.66, once this season's awards
  // and champions exist to rank the retirees by — see there. What is kept here
  // is `retirees` itself, because these players are about to be deleted from
  // the save entirely and nothing can be looked up afterwards.
  //
  // The permanent half of that snapshot. The farewell notice is a capped
  // per-season list; this is the career record the all-time frivolities lists
  // read, quality-gated and hard-capped so it can't grow the save forever (see
  // players/archive.ts). Pure — consumes no rng.
  // `?? []` for saves and hand-built stores predating the field; migrate.ts
  // backfills it, but simOffseason is also called directly by tests and tooling.
  const retiredPlayers = extendRetireeArchive(
    league.retiredPlayers ?? [], retirees, endingSeason,
  );
  players = players.filter((p) => !retiredPids.has(p.pid));
  teams = teams.map((t) => ({
    ...t,
    roster: t.roster.filter((pid) => !retiredPids.has(pid)),
    academyRoster: t.academyRoster.filter((pid) => !retiredPids.has(pid)),
  }));
  // Retirement deletes the player outright, so any *live* state still pointing
  // at him is now referring to somebody who doesn't exist: an open negotiation,
  // an inbound offer to buy him, a loan listing, or an active loan whose return
  // would otherwise hand a dead pid back to its parent club next rollover
  // (`processLoanReturns` appends it blindly and logs a phantom transfer). The
  // pool cull scrubs exactly this set for the players it deletes; retirement
  // needs it too, and needs it more now that it can fire below 33.
  //
  // Historical records (`transfers`, `newsEvents`, cup box scores) are
  // deliberately NOT scrubbed: unlike a culled nobody, a retiree had a real
  // career and his transfer history is the record of it. That does leave those
  // rows rendering as "Player <pid>" once he's gone, which is pre-existing
  // behaviour on main rather than something this change introduces — see the
  // retirement section of CLAUDE.md.
  activeLoans = activeLoans.filter((l) => !retiredPids.has(l.pid));
  const liveRefsScrubbed = {
    negotiations: league.negotiations.filter((n) => !retiredPids.has(n.pid)),
    inboundOffers: league.inboundOffers.filter((o) => !retiredPids.has(o.pid)),
    loanListings: league.loanListings.filter((l) => !retiredPids.has(l.pid)),
    loanRejections: league.loanRejections.filter((l) => !retiredPids.has(l.pid)),
    // The watchlist is a shortlist of players to sign, and a retiree has
    // stopped being one. Dropping him is also the only way he *can* leave it:
    // his profile page goes with him, and that is where the star lives.
    watchlist: league.watchlist.filter((pid) => !retiredPids.has(pid)),
    // A clause about a player who no longer exists can never fire and can never
    // be read, so it would sit in the save forever. Same reasoning as the
    // watchlist above, and the same pair of scrub sites (here and the cull).
    transferClauses: scrubClausesForPids(league.transferClauses ?? [], retiredPids),
  };
  league = { ...league, ...liveRefsScrubbed };
  // Live contingent money from here on: the summer market settles any sell-on
  // it triggers (6.4), step 6.7 pays the season's bonuses, and what survives
  // rolls over. Read after the retirement scrub above, never before it.
  let clauses = league.transferClauses;

  // 3.05. Carry any injuries picked up at the summer's internationals into the
  //       new club season — a World Cup injury genuinely sidelines a player for
  //       its opening weeks. Applied here, *after* progression healed everyone's
  //       club-season knocks (step 2), so only the fresh international injury
  //       lingers. Rolled on a dedicated seeded stream (never the shared `rng`),
  //       and international never stamped these mid-campaign, so no club or
  //       international match result moves.
  players = carryIntlInjuries(
    players,
    league.international.stageInjuries,
    mulberry32(hashInts(league.lid, endingSeason, INTL_INJURY_STREAM)),
  );

  // 3.5. Rank-based settlement and hype update, off the tables computed at the
  //      top of this function. Each competition's own table is computed
  //      independently — pooling multiple competitions into one table would
  //      misapply prize-tier rank cutoffs (PRIZE_TOP_5_CUTOFF etc. assume a
  //      single competition's table size) and the hype curve to a league
  //      neither was tuned for.
  const standings = league.competitions.flatMap((comp) => tablesByCompId.get(comp.id)!);
  const teamStats =
    precomputedTeamStats ?? computeTeamSeasonStats(teams.map((t) => t.tid), league.played);
  const championTidByCompId: Record<number, number> = Object.fromEntries(
    league.competitions.filter((c) => c.tier === 1).map((c) => [c.id, tablesByCompId.get(c.id)![0].tid]),
  );

  // 3.6. Worldwide honors — the Ballon d'Or ranking and the World Team of the
  //      Year — scored across every competition at once. Computed here rather
  //      than up with the per-competition awards because it needs the tables
  //      (who won their league) as well as the players; like those, it reads
  //      `league.players`, untouched by the progression above, so it judges the
  //      season on the ratings it was actually played with. It also needs the
  //      cup that ran *during* this season (archived a few steps below) and the
  //      international campaign already played at the top of this function.
  const world = computeWorldAwards(league.players, endingSeason, {
    compsByTid,
    competitions: league.competitions,
    championTidByCompId,
    cup: league.cup,
    // The domestic cups that ran during this season, read before the archive a
    // few steps below folds their box scores away. Archiving keeps the champion
    // and the per-player lines this needs, so the order isn't load-bearing, but
    // reading the live ones keeps it obvious which season is being judged.
    domesticCups: league.domesticCups,
    worldCupChampion:
      league.international.history.find((h) => h.season === endingSeason)?.champion ?? null,
    // The Euro / Copa America / AFCON winners from the same offseason, if it
    // staged them (see core/international/confederationCup.ts).
    confederationCupChampions: confederationCupChampions(league.international.confederationCupHistory, endingSeason),
  });

  // 3.65. Who those winners actually were. Every award above is stored as a
  //       bare pid, and a pid stops resolving the moment retirement deletes the
  //       player and the capped retiree archive declines to keep him — 74% of
  //       league Players of the Season on a century-long save. Copied here
  //       rather than at the history push below because `league.players` is
  //       still the pool both award passes scored, before progression and
  //       retirement have touched anyone. Pure, no rng. See awardWinners.ts.
  const awardWinners = snapshotAwardWinners(league.players, endingSeason, { awards, world });

  // 3.66. The season's record, assembled once and pushed onto `seasonHistory`
  //       at the bottom of this function. Built here rather than there because
  //       the farewell list below has to be *scored against it*: a retiree's
  //       GOAT score counts the honours on `seasonHistory` and the cup
  //       histories, and this season has reached neither yet — so ranking the
  //       year's retirees against the raw league would dock every one of them
  //       exactly the trophies he went out on. Assembling the entry once is
  //       also what stops the scored view and the stored one drifting apart.
  const seasonEntry: Omit<SeasonHistoryEntry, "retirements"> = {
    season: endingSeason,
    table: standings,
    teamStats,
    awards,
    world,
    compsByTid,
    championTidByCompId,
    // An award winner outlives his own record by decades, so his name travels
    // with the award (step 3.65 above).
    awardWinners,
    // The playoffs this season's tier-2 tables sent to. Left absent when a
    // world holds none, so a save that never plays one carries no empty arrays
    // through its whole history.
    promotionPlayoffs: promotionPlayoffs.length > 0 ? promotionPlayoffs : undefined,
    // The super cups that *opened* this season, moved off the live field now
    // that it is about to be reseeded for the next one. Unlike every other
    // record on this entry these describe the season's first day rather than
    // its last — see SeasonHistoryEntry.superCups. Read here rather than at the
    // return below because the entry is assembled once; `league` is not
    // reassigned after this point, so the two read the same thing.
    superCups: (league.superCups ?? []).length > 0 ? league.superCups : undefined,
  };

  //       The retirees, ranked by how big a career each of them was rather than
  //       by the rating he happened to leave on — a great player retires
  //       *declining*, so his final rating is the number that says least about
  //       him. The cups are appended live: this season's are archived further
  //       down, and an archived cup keeps its champion, so either form answers
  //       the only question asked of it here.
  const pastChampions = precomputedChampions ?? honourSourcesOf(league);
  const champion = (cup: { season: number; championTid: number | null } | null | undefined) =>
    cup ? [{ season: cup.season, championTid: cup.championTid }] : [];
  const retirements = summarizeRetirements(
    retirees, endingSeason, tidLastSeason, league.meta.userTid,
    {
      seasonHistory: [...league.seasonHistory, seasonEntry],
      // This season's cups are still live here — they are archived further
      // down — and they are attached in the worker, so they are appended
      // directly rather than coming through the precomputed past.
      cup: [...pastChampions.cup, ...champion(league.cup)],
      shield: [...pastChampions.shield, ...champion(league.shield)],
      domestic: [
        ...pastChampions.domestic,
        ...(league.domesticCups ?? []).map((c) => ({ season: c.season, championTid: c.championTid })),
      ],
    },
  );

  const settle = (rows: StandingsRow[], compId: number): void => {
    const defaultRank = rows.length;
    const rankByTid = new Map(rows.map((row, i) => [row.tid, i + 1]));
    const rowByTid = new Map(rows.map((row) => [row.tid, row]));
    teams = teams.map((t) => {
      if (t.compId !== compId) return t;
      // Difficulty scales the user's prize money, hype revenue and savings
      // ceiling; every AI club takes the plain competition scale.
      const scale = financeScaleFor(
        league.competitions, compId, t.tid, league.meta.userTid, league.difficulty,
      );
      const rank = rankByTid.get(t.tid) ?? defaultRank;
      const row = rowByTid.get(t.tid);
      // Both prize money and hype key off the club's finishing position, so
      // both need the size of the division that position is out of — a 3rd of
      // 12 is not a 3rd of 20.
      const divisionSize = competitionTeamCount(competitionOf(league.competitions, compId));
      const budget = settleSeasonEnd(t.budget, rank, t.hype, t.scoutingSpend, scale, divisionSize);
      const hype = row ? updateHype(t.hype, row, rank, divisionSize) : t.hype;
      // The scouting spend the club committed to during the offseason window
      // (nextScoutingSpend) now locks in for the coming season. AI teams never
      // touch it, so it stays at the default they were created with.
      const scoutingSpend = clampScoutingSpend(t.nextScoutingSpend, budget);
      return { ...t, budget, hype, scoutingSpend, nextScoutingSpend: scoutingSpend };
    });
  };
  for (const comp of league.competitions) settle(tablesByCompId.get(comp.id)!, comp.id);

  // 3.6. Promotion/relegation: per country, bottom PROMOTION_RELEGATION_COUNT
  //      of its tier-1 table swap with top PROMOTION_RELEGATION_COUNT of its
  //      tier-2 table, using the tables just computed above (the season that
  //      actually just played out). Then every mid-convergence team's
  //      academyBase moves one step closer to its current competition's
  //      strength band.
  //      Where a country held a promotion playoff, its last promotion place
  //      goes to the playoff winner instead of to the club that finished there
  //      — same number up, decided on the pitch.
  // Which division each club was in BEFORE the swap, so step 6.7 can answer
  // "was this club promoted" by comparing tiers. Nothing records a promotion
  // as an event, and after the swap a club's compId is simply its new one.
  const compIdBeforeSwaps = new Map(teams.map((t) => [t.tid, t.compId]));
  const swaps = computeCountrySwaps(
    league.competitions, tablesByCompId, playoffOutcomes(promotionPlayoffs),
  );
  teams = applyCompetitionSwaps(teams, swaps);
  teams = stepAcademyBaseConvergence(teams, league.competitions);

  // 3.7. Guaranteed ceiling on Division 2 quality, first pass: any
  //      AI-controlled player at or above DIVISION_2_REFUSAL_OVR_THRESHOLD
  //      (most commonly a just-relegated club's existing squad) is moved to
  //      whichever (non-user) Division 1 club needs him most, no
  //      market/affordability chance involved — see enforceDivisionCeilings
  //      for why a soft nudge isn't enough. Run here, before free agency, so
  //      a club that loses a player this way still gets a chance to backfill
  //      the hole below; run again after the summer market (step 6.45) to
  //      also catch a player sold *into* Division 2 as ordinary market
  //      surplus this same offseason (idempotent — a no-op if nothing
  //      qualifies either time).
  let ceilingTransfers = loanReturns.transfers;
  ({ teams, transfers: ceilingTransfers } = enforceDivisionCeilings(
    teams, players, activeLoans, ceilingTransfers, nextSeason, league.meta.userTid, league.competitions,
  ));

  // 4. AI free agency fills roster holes (worst team picks first, the whole
  //    world as one queue ranked by points per game — see
  //    freeAgencySigningOrder for why not raw points), skipping the user's
  //    club. Cross-division buying happens later, in the transfer market step.
  const signingOrder = freeAgencySigningOrder(standings);
  let faSignings: { pid: number; toTid: number }[];
  ({ teams, players, signings: faSignings } = runAIFreeAgency(
    teams, players, nextSeason, rng, league.meta.userTid, signingOrder, activeLoans,
    league.progressionModel,
  ));
  // Log each free-agent arrival as a fee-0 transfer FROM the sentinel so the
  // player's club-by-season history registers the move (an unrecorded free
  // signing was otherwise attributed to his last paid club — see
  // FREE_AGENT_TID). The window identity comes from transferWindowState rather
  // than being spelled out here, so these records can't drift from what every
  // other transfer logged during the offseason is keyed to.
  const faWindow = transferWindowState(league);
  ceilingTransfers = [
    ...ceilingTransfers,
    ...faSignings.map((s) => ({
      pid: s.pid, fromTid: FREE_AGENT_TID, toTid: s.toTid, fee: 0,
      season: faWindow.season ?? nextSeason,
      window: faWindow.window ?? ("summer" as const),
    })),
  ];

  // 5. Youth intake for every club, anchored to each club's fixed
  //    generation-time strength (academyBase — see promotion.ts for how it
  //    moves after a division swap) plus a recent-form modifier: prospects
  //    are drawn toward clubs that have finished well over the last few
  //    seasons and away from strugglers. The modifier is zero-sum within
  //    each division (see academyForm.ts), so it can't reopen the
  //    league-wide intake inflation the fixed anchor exists to prevent.
  const academyFormModifiers = computeAcademyFormModifiers(
    tablesByCompId.values(), league.seasonHistory,
  );
  const academyOffset = difficultyProfile(league.difficulty).academyOffset;
  // The user's intake is held back from the loop below and assembled into a
  // trial group afterwards (step 5.2), so it can't shift any other club's pids.
  // Not `Player[] | null`: the assignment happens inside the teams.map callback
  // below, which TS's control-flow analysis can't see, so it would narrow this
  // to `never` at the point of use.
  let userYouth: Player[] = [];
  // Monotonic, read from the store rather than derived from max(pid): players
  // get removed (retirement above, the free-agent cull below), and a derived
  // cursor would hand a removed player's pid to a new player, who'd inherit his
  // transfer/news/cup history. The max() term keeps it correct if anything ever
  // adds a player without advancing the cursor.
  // `?? 0` guards a league built outside migrate (test fixture, hand-rolled
  // import): Math.max(undefined, n) is NaN, which would poison every new pid.
  let nextPid = Math.max(
    Number.isFinite(league.nextPid) ? league.nextPid : 0,
    Math.max(0, ...players.map((p) => p.pid)) + 1,
  );
  teams = teams.map((t) => {
    const genSeed = hashInts(league.lid, nextSeason, t.tid, 2);
    const comp = competitionOf(league.competitions, t.compId);
    const homeCountry = comp.country;
    // The league's own nationality mix, so a league the player added keeps
    // producing its own kind of prospect for the life of the save rather than
    // drifting to England's distribution one intake at a time.
    const nationalities = competitionNationalities(comp);
    const { players: youth, nextPid: updatedNextPid } = generateYouthIntake(
      rng,
      t.academyBase
        + (academyFormModifiers.get(t.tid) ?? 0)
        // Difficulty's academy lever, user's club only. Applied here as a
        // modifier and NEVER written back into t.academyBase: that field is
        // also read by promotion convergence (which would drag a baked-in
        // offset toward the competition centre) and by roster-import
        // realignment (which permutes anchors between clubs), so storing it
        // would leak difficulty into two unrelated systems.
        // Difficulty's academy lever plus the club's own scouting/hype bonus,
        // both user's club only and both applied the same way and for the same
        // reason: as intake-time modifiers, never written back into
        // academyBase (see academyFacilities.ts).
        + (t.tid === league.meta.userTid ? academyOffset + academyFacilitiesBonus(t) : 0),
      nextSeason, nextPid, genSeed, homeCountry, nationalities,
      undefined, undefined, league.progressionModel,
    );
    nextPid = updatedNextPid;
    // Note: a generational talent's arrival is deliberately NOT announced.
    // The trait is meant to be hidden — a scout can infer it from an unusually
    // high potential estimate, which is the only intended tell. See the
    // generational-talent entry in CLAUDE.md.
    if (t.tid === league.meta.userTid) {
      // The user's intake is a trial group he chooses from, not a squad handed
      // to him — it is held on the team unsigned until the Youth Intake screen
      // resolves it (see StoredTeam.youthTrialists). The contract and the
      // academy stamp are applied at signing, not here, because a trialist who
      // is never signed was never an academy player.
      userYouth = youth;
      // Held back: pids are attached below, once the extra trialists have been
      // generated. Nothing is pushed to `players` here for the same reason.
      return t;
    }
    players.push(...youth);
    return { ...t, roster: [...t.roster, ...youth.map((p) => p.pid)] };
  });

  // 5.2. Top the user's intake up into a trial group he actually chooses from.
  //
  // THREE THINGS KEEP THIS OUT OF THE WORLD'S GENERATION, and all three are
  // required — any one of them missing and one club's academy silently
  // re-rolls all 420 clubs' youth:
  //   (a) it runs AFTER the loop above, so every other club's players keep the
  //       pids they would have had. Pids are not just labels — developmentBias
  //       and isGenerational are hashed off them, so shifting pid assignment
  //       changes who is a wonderkid world-wide.
  //   (b) the extras are drawn on their own seeded stream, never the shared
  //       `rng`, so the shared draw count is identical either way.
  //   (c) the user's ordinary intake was drawn inside the loop exactly as
  //       before, so even his own club's first few prospects are unchanged.
  // The result is a world bit-identical to one without this feature, apart
  // from the extra players on the user's own trial list.
  if (userYouth.length > 0) {
    const userTeam = teams.find((t) => t.tid === league.meta.userTid);
    const trialRng = mulberry32(
      hashInts(league.lid, nextSeason, league.meta.userTid, YOUTH_TRIAL_STREAM),
    );
    const groupSize = YOUTH_TRIAL_GROUP_MIN
      + Math.floor(trialRng() * (YOUTH_TRIAL_GROUP_MAX - YOUTH_TRIAL_GROUP_MIN + 1));
    const extras = Math.max(0, groupSize - userYouth.length);
    const directions = scoutDirectionsOf(userTeam);
    if (userTeam && extras > 0) {
      const comp = competitionOf(league.competitions, userTeam.compId);
      const { players: extraYouth, nextPid: afterExtras } = generateYouthIntake(
        trialRng,
        userTeam.academyBase
          + (academyFormModifiers.get(userTeam.tid) ?? 0)
          + academyOffset
          + academyFacilitiesBonus(userTeam),
        nextSeason, nextPid, hashInts(league.lid, nextSeason, YOUTH_TRIAL_STREAM),
        comp.country, competitionNationalities(comp),
        extras,
        // The positions reach ONLY these extras, and only because they are
        // drawn on the trial stream. The user's ordinary intake above came off
        // the shared `rng`, where a position decides which tier row the ratings
        // are rolled from and `rollRating` spends one draw for an ABS tier
        // against two for every other — so a keeper costs 23 rating draws and
        // an outfielder 27. Steering that draw would shift the shared stream
        // and re-roll every club generated after his.
        { positions: directions.positions },
        league.progressionModel,
      );
      nextPid = afterExtras;
      userYouth = [...userYouth, ...extraYouth];
    }

    // 5.3. Send the scouts where the user told them to look.
    //
    // Applied POST-HOC, re-drawing each trialist's nationality and name on the
    // trial stream rather than handing a different table to generateYouthIntake,
    // and that is a requirement rather than a style choice. The user's ordinary
    // intake is generated inside the loop above on the SHARED rng, and
    // `drawFrom` spends one draw normally but two when the roll lands in the
    // rest-of-world bucket — so a different table there would change the shared
    // draw count and shift every club's generation after it. Re-drawing
    // afterwards on our own stream cannot.
    //
    // Sound because nationality is rating-neutral: it feeds the name and
    // international eligibility and nothing else, so a player re-nationalised
    // here is the same footballer with a different passport. It covers the
    // whole group, ordinary intake included, because "my scouts are in Brazil"
    // should describe everyone they turned up, not just the last few.
    const regions = directions.regions;
    if (userTeam && regions.length > 0) {
      const comp = competitionOf(league.competitions, userTeam.compId);
      const table = scoutedNationalityWeights(
        competitionNationalities(comp) ?? LEAGUE_NATIONALITY_WEIGHTS[comp.country]
          ?? LEAGUE_NATIONALITY_WEIGHTS.England,
        regions,
      );
      userYouth = userYouth.map((p) => {
        const nationality = pickNationality(trialRng, comp.country, table);
        return { ...p, nationality, name: generateName(trialRng, nationality) };
      });
    }

    players.push(...userYouth);
  }
  // Assigned unconditionally, and it REPLACES rather than appends: last year's
  // group is resolved by this line whether or not the user ever opened the
  // screen, and the ones he didn't sign simply stop being held — they own no
  // contract and sit on no roster, so dropping the pid makes them free agents
  // and nothing has to release them. That is what stops a trial group becoming
  // the kind of permanent zombie an unmanaged academyRoster would.
  const trialPids = userYouth.map((p) => p.pid);
  teams = teams.map((t) =>
    t.tid === league.meta.userTid
      ? { ...t, youthTrialists: trialPids, youthTrialSignings: 0 }
      : t,
  );

  // 5.5. Emergency call-up for the user's own roster. Anyone taken off the open
  //      market is logged as a fee-0 arrival from the sentinel, exactly as an AI
  //      free signing is at step 4 — club-by-season history is rebuilt from the
  //      transfer log alone, so an unrecorded arrival keeps showing his old club.
  let safetySignings: number[];
  ({ teams, players, marketSignings: safetySignings } = ensureUserRosterSafety(
    teams, players, league.meta.userTid, nextSeason, activeLoans,
  ));
  ceilingTransfers = [
    ...ceilingTransfers,
    ...safetySignings.map((pid) => ({
      pid, fromTid: FREE_AGENT_TID, toTid: league.meta.userTid, fee: 0,
      season: faWindow.season ?? nextSeason,
      window: faWindow.window ?? ("summer" as const),
    })),
  ];

  // 6. Trim AI squads back down to target composition. Loaned-in players are
  //    left in place (owned by their parent — see trimRosterSurplus) so
  //    trimming can't orphan a live loan into a duplicate.
  teams = trimRosterSurplus(
    teams, players, league.meta.userTid, nextSeason, activeLoans, league.progressionModel,
  );

  // 6.4. AI<->AI transfer market (summer window, cross-division by design —
  //      no division filtering here, see design doc).
  const marketSeed = hashInts(league.lid, nextSeason, 7);
  // The season that just ended isn't in seasonHistory yet (that entry is
  // appended below), so protect stars off its freshly-computed standings/awards.
  const justEndedRecord = { table: standings, awards, compsByTid };
  const summerProtectedPids = protectedStarPids(
    justEndedRecord, teams, players, league.competitions, league.meta.userTid,
  );
  const summerMarket = runAITransferMarket(
    teams, players, activeLoans, ceilingTransfers, nextSeason, league.played,
    "summer", "offseason", league.meta.userTid, marketSeed, league.competitions,
    summerProtectedPids,
    { clauses, difficulty: league.difficulty },
  );
  teams = summerMarket.teams;
  // A sell-on fires when the club that bought the player moves him on — which,
  // the user's own club aside, is always a deal made right here.
  clauses = summerMarket.clauses;

  // 6.45. Guaranteed ceiling on Division 2 quality, run *after* the market
  //      above (not before) — a Division 1 club can still sell a genuinely
  //      elite player down to Division 2 as ordinary surplus, and this must
  //      catch that in the same offseason it happens, not wait a full cycle.
  //      Any AI-controlled player at or above DIVISION_2_REFUSAL_OVR_THRESHOLD
  //      is moved to whichever (non-user) Division 1 club needs him most, no
  //      market/affordability chance involved (see enforceDivisionCeilings
  //      for why a soft nudge isn't enough — the dominant drift driver is
  //      relegated clubs simply keeping their existing strong rosters, not
  //      anything a market mechanic alone can fix).
  const { teams: ceilingTeams, transfers: postCeilingTransfers } = enforceDivisionCeilings(
    teams, players, activeLoans, summerMarket.transfers, nextSeason, league.meta.userTid, league.competitions,
  );
  teams = ceilingTeams;

  // 6.46. AI<->AI loan market (summer window): young, buried AI players loan
  //       out to needier AI clubs — see loans.ts's runAILoanMarket. The
  //       user's club never participates here; loaning the user's own
  //       players in/out is a manual action via the Loans page.
  const loanMarketSeed = hashInts(league.lid, nextSeason, 11);
  const loanMarket = runAILoanMarket(
    teams, players, activeLoans, postCeilingTransfers, nextSeason, league.played,
    "summer", league.meta.userTid, loanMarketSeed, league.competitions,
  );
  teams = loanMarket.teams;
  activeLoans = loanMarket.activeLoans;

  // 6.47. Drop any free-agent signing this same offseason silently undid. Step
  //       4 logs every AI arrival from the free pool, but nothing later in the
  //       offseason records a *departure* into it (see FREE_AGENT_TID) — so a
  //       club that signs a free agent and then cuts him below, via
  //       trimRosterSurplus or a youth intake out-rating him, would leave his
  //       profile permanently claiming a club he never played for. A signing
  //       the player was moved on from by a *recorded* deal (sold, loaned out)
  //       is genuine history and stays; only the silent drops go.
  const holderByPid = new Map<number, number>();
  for (const t of teams) {
    for (const pid of t.roster) holderByPid.set(pid, t.tid);
    for (const pid of t.academyRoster) holderByPid.set(pid, t.tid);
  }
  const lastRecordIndex = new Map<number, number>();
  loanMarket.transfers.forEach((t, i) => lastRecordIndex.set(t.pid, i));
  const finalTransfers = loanMarket.transfers.filter((t, i) => {
    if (!isFreeAgentTid(t.fromTid) || t.season !== nextSeason) return true;
    if (holderByPid.get(t.pid) === t.toTid) return true;
    return (lastRecordIndex.get(t.pid) ?? i) > i;
  });

  // 6.5. Season-start finances on the finalized new-season rosters, scaled
  //      by each club's (possibly just-changed) competition tier — and, for the
  //      user's club only, by his difficulty. This is where a hard level really
  //      bites: the base allocation shrinks while the wage bill doesn't, so an
  //      expensive squad runs at a loss until the user sells his way out of it.
  const salaryMap = new Map(players.map((p) => [p.pid, p.contract.salary]));
  teams = teams.map((t) => ({
    ...t,
    budget: chargeSeasonStart(
      t.budget,
      wageBill([...t.roster, ...t.academyRoster], salaryMap),
      financeScaleFor(league.competitions, t.compId, t.tid, league.meta.userTid, league.difficulty),
      t.hype,
    ),
  }));

  // 6.6. AI formation selection: each AI club lines up in whichever shape
  //      fields its strongest XI given the just-settled roster (youth, transfers,
  //      loans all applied). The user's chosen formation is left untouched.
  teams = assignAIFormations(teams, players, league.meta.userTid);

  // 7. New per-competition schedules, new season, back to regular play.
  const schedule = league.competitions.flatMap((comp) =>
    generateSchedule(teams.filter((t) => t.compId === comp.id).map((t) => t.tid)),
  );

  // Drop any listing for a player no longer on the user's senior roster
  // (sold, released, retired, or just loaned out this offseason) — a stale
  // listing is otherwise inert (loanOfferCandidates already requires roster
  // membership) but there's no reason to let it accumulate.
  const userRosterAfter = new Set(teams.find((t) => t.tid === league.meta.userTid)?.roster ?? []);
  const loanListings = league.loanListings.filter((l) => userRosterAfter.has(l.pid));

  // Fog-of-war: record any player newly on the user's senior roster as
  // first-observed this new season, and drop those who left, so potential
  // estimates sharpen with tenure (see src/core/scouting/potentialFog.ts).
  teams = teams.map((t) =>
    t.tid === league.meta.userTid
      ? { ...t, scoutingObserved: reconcileScoutingObserved(t.scoutingObserved, t.roster, nextSeason) }
      : t,
  );

  // Everything next season's continental competitions need that isn't a league
  // table: who holds each trophy, who won each domestic cup, and how many
  // places each country has earned. All of it reads off `league` rather than
  // the rolled-over state, because these are the cups that have just been
  // decided and `rolled` replaces them with next season's empty ones. A cup
  // still holding a null champion (abandoned mid-save) simply closes its route.
  const cupRoutes: QualificationContext = {
    domesticCupWinners: domesticCupWinners(league.domesticCups ?? []),
    holders: {
      continental: league.cup?.championTid ?? undefined,
      shield: league.shield?.championTid ?? undefined,
    },
    // How many places each country gets, off its rolling continental record.
    // The season that just ended counts, so its competitions are passed in
    // alongside the archive — they are archived a few lines below this, not
    // before it. Zero-sum against the defaults, so the fields stay the size
    // they were (see cup/coefficients.ts); null before there is any record,
    // which leaves the shipped strength-class allocation in place.
    slots: coefficientSlots(
      league.competitions,
      teams,
      [
        league.cupHistory ?? [],
        league.shieldHistory ?? [],
        // Only a competition with a champion counts, the same rule the live
        // Standings projection uses (see cup/seasonQualification). Here they
        // always have one, since the season is over; keeping the two callers on
        // one rule is what stops them disagreeing about a country's record.
        [league.cup, league.shield].filter(
          (c): c is NonNullable<typeof c> => !!c && c.championTid !== null,
        ),
      ],
      nextSeason,
      league.rollingCoefficients ?? true,
    ) ?? undefined,
  };

  // 6.7. Settle transfer bonuses earned by the season just played, then expire
  //      or release anything that has run out of road.
  //
  //      Placed here rather than beside the other finance work at step 6.5
  //      because two of the four triggers are only answerable this late:
  //      promotion is decided at 3.6, and continental qualification needs
  //      `cupRoutes` just above. The consequence is that bonus money lands
  //      *after* the new season's wages are charged, which is the right way
  //      round anyway — an add-on for last season's achievements is banked
  //      going into the next one, not retrospectively spent on it.
  //
  //      This step's job is to ANSWER the four questions; who then gets paid is
  //      `settleBonuses`, which is pure and tested on its own.
  //
  //      Pure and rng-free either way: it reads stats and tables that already
  //      exist and moves money between two budgets. No shared-`rng` draw, so no
  //      scoreline anywhere moves.
  const rosterOf = new Map<number, number>();
  for (const t of teams) for (const pid of t.roster) rosterOf.set(pid, t.tid);
  const promotedTids = new Set(
    teams
      .filter((t) => {
        const before = compIdBeforeSwaps.get(t.tid);
        return before !== undefined
          && tierOf(league.competitions, before) > tierOf(league.competitions, t.compId);
      })
      .map((t) => t.tid),
  );
  const bonusSettlement = settleBonuses(clauses, {
    rosterOf,
    statsByPid: new Map(
      players.map((p) => [p.pid, p.stats.find((st) => st.season === league.season)]),
    ),
    qualifiedTids: new Set(
      qualificationByTid(league.competitions, tablesByCompId, cupRoutes).keys(),
    ),
    promotedTids,
  });
  const bonusDeltas = payoutDeltas(bonusSettlement.payouts);
  if (bonusDeltas.size > 0) {
    teams = teams.map((t) => {
      const d = bonusDeltas.get(t.tid);
      if (d === undefined || d === 0) return t;
      // Clamp only a club that ends up better off, matching every other credit
      // in the game (see clampBudget).
      const budget = d > 0
        ? clampBudget(
            t.budget + d,
            financeScaleFor(league.competitions, t.compId, t.tid, league.meta.userTid, league.difficulty),
            t.hype,
          )
        : t.budget + d;
      return { ...t, budget };
    });
  }

  //      Then drop anything whose player is no longer OWNED by the club that
  //      owes it. A sale settles and removes its own clauses on the spot; this
  //      is the catch-all for every other way he can leave — released, contract
  //      expired, swept up by the division ceiling — so those sites need no
  //      clause code of their own. Once a season is enough because a departed
  //      player's clause is inert in the meantime: a sell-on only fires on a
  //      sale BY the obligor, and he has none to make.
  //
  //      A player out on loan sits on the loanee's roster while still belonging
  //      to his parent, so roster membership alone would wrongly kill every
  //      clause on a loaned-out player.
  const loanedFrom = new Map(activeLoans.map((l) => [l.pid, l.parentTid]));
  const stillOwned = (c: TransferClause) =>
    rosterOf.get(c.pid) === c.obligorTid || loanedFrom.get(c.pid) === c.obligorTid;
  clauses = expireClauses(bonusSettlement.remaining.filter(stillOwned), nextSeason);

  const rolled: LeagueStore = {
    ...league,
    teams,
    transferClauses: clauses,
    players,
    season: nextSeason,
    phase: "regular",
    schedule,
    played: [],
    transfers: finalTransfers,
    activeLoans,
    loanListings,
    // A player can convert at step 2 and then retire at step 3. Announcing a
    // career move by someone who has just retired reads as a bug, and his pid is
    // about to be deleted, so those events are dropped rather than kept.
    newsEvents: [
      ...league.newsEvents,
      ...positionChangeEvents.filter((e) => !retiredPids.has(e.pid)),
    ],
    winterMarketRunSeason: null,
    // Archive the season's completed continental competitions and seed next
    // season's from the tables just decided above, plus the two routes in that
    // aren't a league finish: the reigning champions (the Cup keeps its winner
    // and takes the Shield's) and each country's domestic cup winner, who takes
    // one of his country's Shield places. Both formats are allocated in one
    // pass, so a club is placed in exactly one of them — see cup/qualification.
    // buildCupState returns null if that format's field can't be filled.
    cup: buildCupState(league.competitions, tablesByCompId, nextSeason, CONTINENTAL_CUP_FORMAT, cupRoutes),
    shield: buildCupState(league.competitions, tablesByCompId, nextSeason, SHIELD_FORMAT, cupRoutes),
    // International football already played out (in stages) before this advance;
    // carry its state forward, resetting the per-offseason stage marker (and the
    // just-consumed injury carry-over list) so the new season starts clean.
    international: { ...league.international, stage: null, stageInjuries: [] },
    // A finished cup's box scores fold into per-player stat lines as it's
    // archived (see archiveCup): ~8x smaller, nothing displayed is lost, and it
    // fixes the under-count where only knockout appearances ever counted.
    cupHistory: league.cup
      ? [...league.cupHistory, archiveCup(league.cup)]
      : league.cupHistory,
    shieldHistory: league.shield
      ? [...league.shieldHistory, archiveCup(league.shield)]
      : league.shieldHistory,
    // Domestic cups roll over the same way. Note `teams` here is the post-
    // promotion/relegation roster of clubs, so a promoted club enters next
    // season's cup as a top-flight one, while the ranking that decides who has
    // to enter at the preliminary round comes from the tables just decided.
    domesticCups: buildDomesticCups(league.competitions, teams, tablesByCompId, nextSeason),
    // Next preseason's super cups, seeded from everything the season just
    // finished decided. Built here rather than at the season boundary because
    // this is the last moment all four winners are readable at once — the cups
    // that carry them are archived immediately below — and played later, before
    // the new season's first matchday, so the match is contested by the squads
    // that will actually start it. Pure and rng-free.
    superCups: buildSuperCups({
      competitions: league.competitions,
      tablesByCompId,
      championTidByCompId,
      domesticCups: league.domesticCups ?? [],
      cup: league.cup,
      shield: league.shield,
      season: nextSeason,
    }),
    domesticCupHistory: [
      ...(league.domesticCupHistory ?? []),
      ...(league.domesticCups ?? []).map(archiveDomesticCup),
    ],
    // Emptied, not archived: the same records were just written onto this
    // season's history entry below, which is where they live from here on.
    // Holding both would keep a second copy of every scoreline for a whole
    // season and mean two places the page could read a different answer from.
    promotionPlayoffs: [],
    nextPid,
    retiredPlayers,
    // Assembled at step 3.66, where the farewell list is also scored against
    // it. `retirements` names players who no longer exist by the time anything
    // renders this, which is why it is a snapshot rather than a list of pids.
    seasonHistory: [...league.seasonHistory, { ...seasonEntry, retirements }],
  };

  // Dead last, deliberately. The cull consumes no rng, but it removes entries
  // from `players`, and any rng draw that iterated the pool after this point
  // would shift — breaking the seeded-stream invariant. Ages are judged against
  // the new season, which is what `rolled` already carries.
  const cullResult = cullFreeAgentPoolReporting(rolled);
  const culled = cullResult.league;

  // Keep the name of every retiree the save still points at. This runs *after*
  // the cull for two reasons: the cull deletes its own victims' transfers and
  // news events, so waiting means `referencedPids` counts only references that
  // actually survive; and this offseason's own records (the summer window's
  // transfers, the awards, the archived cups) all exist by now, so a retiree
  // is judged against the finished history rather than a half-written one.
  // Pure and rng-free — nothing below draws.
  return {
    league: {
      ...culled,
      playerNames: extendPlayerNames(
        culled.playerNames ?? [], retirees, culled, precomputedReferenced,
      ),
    },
    report: { culledPids: cullResult.culled },
  };
}
