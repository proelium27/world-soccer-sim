import type { PlayedMatch } from "./standings.js";
import type { PlayerMatchLine } from "../engine/attribution.js";
import type { LeagueStore } from "./leagueState.js";
import type { ScheduleGame } from "./schedule.js";
import type { LeagueTeam } from "./league/generate.js";
import type { Player } from "./players/types.js";
import { leagueMatchData } from "./league/composites.js";
import type { TeamMatchData } from "./league/composites.js";
import { teamSeasonFormDelta, applySeasonForm } from "./teamSeasonForm.js";
import {
  TRANSFER_DEADLINE_MATCHDAY, WINTER_WINDOW_OPEN_MATCHDAY,
} from "./calendar.js";
import { simMatchDetailed } from "../engine/matchSim.js";
import { emptySeasonStats } from "./players/types.js";
import { applyInjuries } from "./injuries.js";
import { superCupsPending, playSuperCups } from "./superCup/superCup.js";
import { applySuspensions, isSuspended } from "./suspensions.js";
import { runAITransferMarket } from "./ai/transferMarket.js";
import { protectedStarPids, lastCompletedSeason } from "./transfers/protectedStars.js";
import { runAILoanMarket } from "./loans.js";
import { hashInts, mulberry32 } from "../engine/rng.js";
import type { StoredTeam } from "./teams/clubs.js";
import { assignAIFormations } from "./teams/clubs.js";
import { playerGoalTotals, detectMatchdayNewsEvents } from "./newsEvents.js";
import type { NewsEvent } from "./newsEvents.js";
import { computePowerRankingSnapshot } from "./teams/powerRanking.js";
import type { PowerRankingSnapshot } from "./teams/powerRanking.js";
import type { CupState, CupTie } from "./cup/types.js";
import type { DomesticCupState } from "./domesticCup/types.js";
import {
  domesticRoundDue, domesticFinalists, domesticRoundName, pendingRound,
} from "./domesticCup/cup.js";
import { playDomesticRound } from "./domesticCup/simCup.js";
import { dueCupRound, dueCupLeg, cupFinalists, playInDue, playoffDue, koFinalRound } from "./cup/cup.js";
import { leaguePhaseDue } from "./cup/leaguePhase.js";
import { playKnockoutLeg, playPlayIn, playLeaguePhaseRound, playPlayoff } from "./cup/simCup.js";
import { clampBudget, financeScaleFor, domesticCupScaleFor } from "./finance/budget.js";
import { initInternationalCampaign } from "./international/index.js";
import { reviewSeason, tablesByCompetition } from "./manager/index.js";
import { playPromotionPlayoffs } from "./promotionPlayoff.js";
import { POWER_SNAPSHOT_INTERVAL } from "./constants.js";
import { pointsDeductionMap } from "./finance/debt.js";

/**
 * Salt for the per-league-match rng stream, keeping it clear of every other
 * `hashInts` stream keyed on (lid, season, ...) — notably the cup's, which
 * tags with 30.
 */
const LEAGUE_MATCH_STREAM = 41;

/**
 * The seed for one league match. Each match runs on its own stream rather than
 * sharing the matchday's, which buys two things:
 *
 *  - A result stops depending on fixture order. Previously every match drew
 *    from one stream in schedule order, so a match's outcome was a function of
 *    every match simmed before it that day.
 *  - A single match becomes independently reproducible. That is what lets the
 *    live-match viewer re-run one match (e.g. with a substitution the user made
 *    while watching) without desyncing every other result on the matchday.
 *
 * Exported so any caller that needs to reproduce a match in isolation derives
 * the same seed this loop does, instead of duplicating the recipe.
 */
export function leagueMatchSeed(
  lid: number,
  season: number,
  matchday: number,
  home: number,
  away: number,
): number {
  return hashInts(lid, season, matchday, home, away, LEAGUE_MATCH_STREAM);
}

function accumulateStats(
  players: Player[],
  season: number,
  homeTid: number,
  awayTid: number,
  homeLines: PlayerMatchLine[],
  awayLines: PlayerMatchLine[],
  teams: { tid: number; roster: number[] }[],
): void {
  const homeRoster = new Set(teams.find((t) => t.tid === homeTid)!.roster);
  const awayRoster = new Set(teams.find((t) => t.tid === awayTid)!.roster);
  const allLines = [...homeLines, ...awayLines];
  const relevantPids = new Set([...homeRoster, ...awayRoster]);

  for (const p of players) {
    if (!relevantPids.has(p.pid)) continue;
    const tid = homeRoster.has(p.pid) ? homeTid : awayTid;

    let ss = p.stats.find((s) => s.season === season);
    if (!ss) {
      ss = emptySeasonStats(season, tid);
      p.stats.push(ss);
    } else {
      ss.tid = tid;
    }

    const line = allLines.find((l) => l.pid === p.pid);
    if (line) {
      ss.appearances++;
      ss.goals += line.goals;
      ss.assists += line.assists;
      ss.shots += line.shots;
      ss.shotsOnTarget += line.shotsOnTarget;
      ss.xg += line.xg;
      ss.goalsAgainst += line.goalsAgainst;
      ss.xga += line.xga;
      ss.saves += line.saves;
      ss.tackles += line.tackles;
      ss.interceptions += line.interceptions;
      ss.passes += line.passes;
      ss.passesCompleted += line.passesCompleted;
      ss.crosses += line.crosses;
      ss.foulsCommitted += line.foulsCommitted;
      ss.yellowCards += line.yellowCards;
      ss.redCards += line.redCards;
      ss.minutesPlayed += line.minutesPlayed;
      ss.ratingSum += line.rating;
      ss.avgRating = ss.ratingSum / ss.appearances;
    }
  }
}

/**
 * One domestic cup tie played on a matchday, with the labels the ticker needs.
 * The name and round come along with the tie because a `CupTie` carries only a
 * round *index*, and the same index means different things in different cups.
 */
export interface DomesticTieResult {
  tie: CupTie;
  cupName: string;
  roundName: string;
  /**
   * Whether this tie belongs to the **user's own country's** cup.
   *
   * Every country plays its cup rounds on the same matchdays, so a cup matchday
   * reports eight cups' worth of ties. A consumer that wants "the cup that
   * matters to this user" must not just take the first one: they arrive in
   * competition-table order, so the first is always England's, and a German
   * save was shown "English Cup" whenever the user's own club wasn't playing a
   * tie that day (knocked out, or given a bye).
   */
  isUserCountry: boolean;
}

export type MatchdayProgress = (
  matchday: number,
  matchdayIndex: number,
  totalMatchdays: number,
  results: PlayedMatch[],
  cupTies: CupTie[],
  domesticTies: DomesticTieResult[],
) => void;

/**
 * How far a sim runs. `{ matchday }` is the general form — play everything up
 * to and including that matchday — and the two named cases are the endpoints
 * the UI offers without asking for a number.
 *
 * A target already in the past is a no-op (the league is returned unchanged),
 * so a stale number in the UI can never quietly play a matchday.
 */
export type SimThrough = "game" | "season" | { matchday: number };

export function simThrough(
  league: LeagueStore,
  through: SimThrough,
  rng: () => number,
  onMatchday?: MatchdayProgress,
): LeagueStore {
  if (league.phase !== "regular" || league.schedule.length === 0) {
    return league;
  }

  // The preseason super cups, if the user advanced straight past them. Played
  // *lazily* here rather than blocking, which is the same arrangement the
  // promotion playoff uses and it exists for the same reason: a hard gate would
  // stall every caller that never sees the UI — autopilot's multi-season jump,
  // the headless audits, the test harnesses — with no way to clear itself.
  //
  // Eager and lazy are the same match: the seed is derived from
  // (lid, season, compId), not from when it is played. They can differ in
  // *personnel*, because the summer window is open either side of a super cup
  // and a user who signs someone first fields him. That is football rather than
  // a determinism hole — the Community Shield is played mid-window too — and it
  // is why nothing downstream may assume a super cup was played on any
  // particular squad.
  const superCups = superCupsPending(league.superCups ?? [])
    ? playSuperCups(league.superCups, league.competitions, league.teams, league.players, league.lid)
    : (league.superCups ?? []);

  const currentMatchday = Math.min(...league.schedule.map((g) => g.matchday));

  let targetMatchday: number;
  if (typeof through === "object") {
    targetMatchday = Math.floor(through.matchday);
    if (!Number.isFinite(targetMatchday) || targetMatchday < currentMatchday) {
      return league;
    }
  } else if (through === "game") {
    targetMatchday = currentMatchday;
  } else {
    targetMatchday = 38;
  }

  const toLeagueTeams = (ts: StoredTeam[]): LeagueTeam[] =>
    ts.map((t) => ({
      tid: t.tid,
      name: t.name,
      roster: t.roster,
      avgOvr: 0,
      academyBase: t.academyBase,
      compId: t.compId,
      starters: t.starters,
      formation: t.formation,
      moreMinutes: t.moreMinutes,
    }));

  // Team state can change mid-batch (the winter transfer market moves players
  // between clubs), so it's threaded through the matchday loop rather than
  // snapshotted once up front.
  let currentTeams: StoredTeam[] = league.teams;
  let transfers = league.transfers;
  let clauses = league.transferClauses ?? [];
  let activeLoans = league.activeLoans;
  let winterMarketRunSeason = league.winterMarketRunSeason;
  // Continental Cup for this season (null before season 2, and always set for
  // the current season by simOffseason). Knockout rounds fire on fixed league
  // matchdays inside the loop below; the state advances round by round and is
  // returned with the rest of the league.
  let cup: CupState | null = league.cup;
  // The Continental Shield runs on the same matchdays as the Cup against a
  // disjoint field (see CUP_FORMATS), so it is advanced through the very same
  // path — just with its own state, baseline and rng streams.
  let shield: CupState | null = league.shield;
  // This season's domestic cups (one per country), advanced round by round on
  // their own matchdays exactly like the Continental Cup above.
  let domesticCups: DomesticCupState[] = league.domesticCups ?? [];
  const newEvents: NewsEvent[] = [];
  const newSnapshots: PowerRankingSnapshot[] = [];

  const toSim: ScheduleGame[] = [];
  const remaining: ScheduleGame[] = [];
  for (const game of league.schedule) {
    if (game.matchday <= targetMatchday) {
      toSim.push(game);
    } else {
      remaining.push(game);
    }
  }

  let currentPlayers = league.players.map((p) => ({
    ...p,
    stats: [...p.stats.map((s) => ({ ...s }))],
  }));

  // All games share one RNG stream, so sim order defines the results:
  // ascending matchday, then schedule order within each matchday.
  const matchdays = [...new Set(toSim.map((g) => g.matchday))].sort(
    (a, b) => a - b,
  );

  const newResults: PlayedMatch[] = [];
  // When set, the batch stopped before this matchday (the user's Continental
  // Cup final): every game from here on is pushed back to `remaining` so the
  // user regains control and can sim the final deliberately.
  let stoppedBeforeMatchday: number | null = null;
  for (let index = 0; index < matchdays.length; index++) {
    const matchday = matchdays[index];

    // Stop-before-final: if the user's club has reached the cup final (known
    // once the semi-finals are played) and the final is still ahead of where
    // this batch began, halt here rather than auto-simming through the final.
    // `matchday > currentMatchday` is what lets a *resumed* batch — which
    // starts exactly on the final's matchday — actually play it instead of
    // stopping forever.
    const userFinalDue = (c: CupState | null): boolean =>
      !!c &&
      dueCupRound(c, matchday) === koFinalRound(c) &&
      cupFinalists(c).includes(league.meta.userTid);
    if (
      matchday > currentMatchday &&
      (userFinalDue(cup) || userFinalDue(shield))
    ) {
      stoppedBeforeMatchday = matchday;
      break;
    }

    // Same courtesy for the user's domestic cup final: it's drawn as soon as
    // the semi-finals are played, so hand control back rather than simming
    // through the biggest one-off game of his season.
    if (
      matchday > currentMatchday
      && domesticCups.some((c) => (
        domesticRoundDue(c, matchday) && domesticFinalists(c).includes(league.meta.userTid)
      ))
    ) {
      stoppedBeforeMatchday = matchday;
      break;
    }

    // Winter transfer window: the first time this batch reaches the window's
    // opening matchday, run the AI↔AI market once (guarded per season so it
    // can't re-fire however the user chops up the sim). Trades here change
    // the rosters every subsequent matchday is played with. User excluded.
    if (
      winterMarketRunSeason !== league.season &&
      matchday >= WINTER_WINDOW_OPEN_MATCHDAY &&
      matchday <= TRANSFER_DEADLINE_MATCHDAY
    ) {
      const market = runAITransferMarket(
        currentTeams, currentPlayers, activeLoans, transfers, league.season,
        [...league.played, ...newResults], "winter", "regular",
        league.meta.userTid, hashInts(league.lid, league.season, 8), league.competitions,
        protectedStarPids(
          lastCompletedSeason(league), currentTeams, currentPlayers,
          league.competitions, league.meta.userTid,
        ),
        { clauses, difficulty: league.difficulty },
      );
      currentTeams = market.teams;
      transfers = market.transfers;
      // A sell-on the user is owed fires when the AI club he sold to moves the
      // player on again, which is exactly what this window does.
      clauses = market.clauses;

      const loanMarket = runAILoanMarket(
        currentTeams, currentPlayers, activeLoans, transfers, league.season,
        [...league.played, ...newResults], "winter", league.meta.userTid,
        hashInts(league.lid, league.season, 12), league.competitions,
      );
      currentTeams = loanMarket.teams;
      activeLoans = loanMarket.activeLoans;
      transfers = loanMarket.transfers;

      // End of the winter window: each AI club re-picks the formation that
      // fields its strongest XI now that it has its new signings (mirrors the
      // summer-window refresh done in simOffseason). The user's choice is left
      // untouched. Flows into the leagueMatchData recompute below.
      currentTeams = assignAIFormations(currentTeams, currentPlayers, league.meta.userTid);

      winterMarketRunSeason = league.season;
    }

    // Recomputed every matchday (not once for the whole batch) so that
    // injuries picked up on one matchday correctly sideline a player, and
    // recoveries bring them back, for the next.
    // Historic team seasons: a rare hidden season-long form swing shifts a
    // club's composites all season (dream season up, season from hell down) —
    // wrapped around recompute too so subs/red cards don't wash it out, and
    // shared with cup ties. See teamSeasonForm.ts.
    const withSeasonForm = (tid: number, d: TeamMatchData): TeamMatchData => {
      const formDelta = teamSeasonFormDelta(league.lid, league.season, tid);
      return formDelta === 0 ? d : {
        ...d,
        composites: applySeasonForm(d.composites, formDelta),
        recompute: (onPitch) => applySeasonForm(d.recompute(onPitch), formDelta),
      };
    };

    const matchData = new Map<number, TeamMatchData>();
    for (const comp of league.competitions) {
      const compTeams = currentTeams.filter((t) => t.compId === comp.id);
      // Suspended players are filtered out here and nowhere else: the ban is a
      // *league* ban, so the cup baseline below deliberately doesn't pass it.
      const compMatchData = leagueMatchData(
        { teams: toLeagueTeams(compTeams), players: currentPlayers },
        { unavailable: isSuspended },
      );
      compTeams.forEach((t, i) => matchData.set(t.tid, withSeasonForm(t.tid, compMatchData[i])));
    }

    const creditPrizes = (prizes: Map<number, number>): void => {
      if (prizes.size === 0) return;
      currentTeams = currentTeams.map((t) => {
        const prize = prizes.get(t.tid);
        return prize
          ? {
              ...t,
              budget: clampBudget(
                t.budget + prize,
                financeScaleFor(league.competitions, t.compId, t.tid, league.meta.userTid, league.difficulty),
                t.hype,
              ),
            }
          : t;
      });
    };

    /**
     * Advance one continental competition (Cup or Shield) through whatever
     * stage falls on this matchday, crediting prize money and returning the
     * ties to show on the ticker. Both competitions run through here on the
     * same matchdays — their fields are disjoint, so a club is only ever in one
     * of them, and each carries its own rng streams (see CUP_FORMATS).
     *
     * Composites use a SHARED normalization baseline across the competition's
     * whole field rather than each team's own league — otherwise the
     * per-competition z-scoring above would erase the cross-league strength gap
     * and a weak-league club would play a big-four club as an equal. Built only
     * on a matchday one of its stages is actually due, and separately per
     * competition: pooling the two fields together would measure the Shield's
     * clubs against the Cup's, which is precisely the comparison neither
     * competition makes.
     *
     * Cup matches use their own seeded rng, so they don't perturb the league
     * stream; cup stats stay out of SeasonStats (they live on the tie box score).
     */
    const advanceCompetition = (
      c: CupState | null,
    ): { cup: CupState | null; ties: CupTie[] } => {
      if (!c) return { cup: c, ties: [] };
      const lpDue = c.leaguePhase ? leaguePhaseDue(c.leaguePhase, matchday) : false;
      const active = lpDue || playoffDue(c, matchday) || playInDue(c, matchday) || dueCupLeg(c, matchday) !== null;
      if (!active) return { cup: c, ties: [] };

      // Pool every club that could feature: the whole league-phase field
      // (Swiss), the knockout bracket, and any playoff / play-in entrants.
      const tids = new Set<number>([
        ...(c.leaguePhase?.teams ?? []),
        ...c.teams.filter((t) => t >= 0),
        ...(c.playoff?.teams ?? []),
        ...(c.playIn?.teams ?? []),
      ]);
      const cupTeams = currentTeams.filter((t) => tids.has(t.tid));
      const cupData = leagueMatchData({ teams: toLeagueTeams(cupTeams), players: currentPlayers });
      const cupMatchData = new Map<number, TeamMatchData>();
      cupTeams.forEach((t, i) => cupMatchData.set(t.tid, withSeasonForm(t.tid, cupData[i])));

      if (lpDue) {
        // Swiss league-phase matchday: play its matches (not knockout ties, so
        // the ticker shows no cup ties here) and seed the bracket when it ends.
        const { cup: advanced, prizes } = playLeaguePhaseRound(c, cupMatchData, league.lid, matchday);
        creditPrizes(prizes);
        return { cup: advanced, ties: [] };
      }
      if (playoffDue(c, matchday)) {
        const { cup: advanced, prizes } = playPlayoff(c, cupMatchData, league.lid);
        creditPrizes(prizes);
        return { cup: advanced, ties: advanced.playoff?.ties ?? [] };
      }
      if (playInDue(c, matchday)) {
        const { cup: advanced, prizes } = playPlayIn(c, cupMatchData, league.lid);
        creditPrizes(prizes);
        return { cup: advanced, ties: advanced.playIn?.ties ?? [] };
      }
      const priorTieCount = c.ties.length;
      const { cup: advanced, prizes } = playKnockoutLeg(c, cupMatchData, league.lid, matchday);
      creditPrizes(prizes);
      // First-leg matchdays finalize no ties (results held in koLegs); the
      // aggregate tie surfaces on the second-leg matchday. slice() → [] then.
      return { cup: advanced, ties: advanced.ties.slice(priorTieCount) };
    };

    const cupAdvance = advanceCompetition(cup);
    cup = cupAdvance.cup;
    const shieldAdvance = advanceCompetition(shield);
    shield = shieldAdvance.cup;
    const mdCupTies: CupTie[] = [...cupAdvance.ties, ...shieldAdvance.ties];

    // Domestic cups: each country's cup plays its due round here, on its own
    // seeded stream. The composites baseline pools the WHOLE country — both
    // divisions together — for the same reason the Continental Cup pools its
    // field: composites are z-normalized within a competition, so a tier-2 club
    // measured against its own division reads as an average side and would face
    // a top-flight club as an equal. Pooling is what makes a giant-killing an
    // upset rather than a coin flip.
    const mdDomesticTies: DomesticTieResult[] = [];
    if (domesticCups.some((c) => domesticRoundDue(c, matchday))) {
      // Which country the user manages in, so each reported tie can say whether
      // it belongs to his own cup — see DomesticTieResult.isUserCountry.
      const userCompId = currentTeams.find((t) => t.tid === league.meta.userTid)?.compId;
      const userCountry = league.competitions.find((c) => c.id === userCompId)?.country;
      const advanced: DomesticCupState[] = [];
      for (const dc of domesticCups) {
        if (!domesticRoundDue(dc, matchday)) {
          advanced.push(dc);
          continue;
        }
        const compIds = new Set(
          league.competitions.filter((c) => c.country === dc.country).map((c) => c.id),
        );
        const countryTeams = currentTeams.filter((t) => compIds.has(t.compId));
        const countryData = leagueMatchData({
          teams: toLeagueTeams(countryTeams), players: currentPlayers,
        });
        const dcMatchData = new Map<number, TeamMatchData>();
        countryTeams.forEach((t, i) => dcMatchData.set(t.tid, withSeasonForm(t.tid, countryData[i])));

        // Same scale the prize is then clamped against (creditPrizes), so the
        // user's difficulty multiplier applies to a cup run exactly as it does
        // to every other way his budget can grow.
        // domesticCupScaleFor, NOT financeScaleFor: a domestic cup pays by
        // country but flat across divisions, so a second-division run is worth
        // what a top-flight one is. See its doc comment.
        const scaleByTid = new Map(
          countryTeams.map((t) => [
            t.tid,
            domesticCupScaleFor(
              league.competitions, t.compId, t.tid, league.meta.userTid, league.difficulty,
            ),
          ]),
        );
        // Which division each club is in, for the glamour-tie gate receipts.
        const tierByTid = new Map(
          countryTeams.map((t) => [
            t.tid,
            league.competitions.find((c) => c.id === t.compId)?.tier ?? 1,
          ]),
        );
        const roundName = domesticRoundName(dc, pendingRound(dc)!.round);
        const played = playDomesticRound(
          dc, league.competitions, dcMatchData, league.lid,
          (tid) => scaleByTid.get(tid) ?? 1,
          (tid) => tierByTid.get(tid) ?? 1,
        );
        advanced.push(played.cup);
        creditPrizes(played.prizes);
        for (const tie of played.ties) {
          mdDomesticTies.push({
            tie, cupName: dc.name, roundName, isUserCountry: dc.country === userCountry,
          });
        }
      }
      domesticCups = advanced;
    }

    const goalTotalsBefore = playerGoalTotals(currentPlayers, league.season);

    const gamesThisMatchday = toSim.filter((g) => g.matchday === matchday);
    const mdResults = gamesThisMatchday.map((game): PlayedMatch => {
      const hd = matchData.get(game.home)!;
      const ad = matchData.get(game.away)!;
      const result = simMatchDetailed(
        mulberry32(leagueMatchSeed(league.lid, league.season, game.matchday, game.home, game.away)),
        hd.composites,
        ad.composites,
        hd.xi,
        ad.xi,
        hd.bench,
        ad.bench,
        { recompute: { home: hd.recompute, away: ad.recompute } },
      );

      accumulateStats(
        currentPlayers,
        league.season,
        game.home,
        game.away,
        result.boxScore.home,
        result.boxScore.away,
        currentTeams,
      );

      return {
        home: game.home,
        away: game.away,
        homeGoals: result.home,
        awayGoals: result.away,
        possessionHome: result.possessionHome,
        matchday: game.matchday,
        boxScore: result.boxScore,
      };
    });

    // Injuries and bans are both counted in MATCHES, so they may only tick for a
    // club that actually had one. Divisions can be different sizes and spread
    // their rounds across the season grid, so a club can sit out a matchday the
    // rest of the world plays (see buildCompetitionSchedule).
    //
    // Framed as "who did NOT play" on purpose: that leaves free agents, who are
    // on no roster and have no fixtures to attach to, ticking down on the global
    // clock exactly as they always have. On the shipped 20-club world every club
    // plays every matchday, so this set is empty and nothing changes.
    const playedTids = new Set(mdResults.flatMap((m) => [m.home, m.away]));
    const idlePids = new Set<number>();
    for (const t of currentTeams) {
      if (playedTids.has(t.tid)) continue;
      for (const pid of t.roster) idlePids.add(pid);
      for (const pid of t.academyRoster) idlePids.add(pid);
    }
    const hadAMatch = (pid: number): boolean => !idlePids.has(pid);

    currentPlayers = applyInjuries(rng, currentPlayers, mdResults, hadAMatch);
    // Bans from this matchday's cards, and a match served off every ban already
    // running. rng-free, so it can't perturb the shared stream.
    currentPlayers = applySuspensions(currentPlayers, mdResults, hadAMatch);

    const goalTotalsAfter = playerGoalTotals(currentPlayers, league.season);
    newEvents.push(
      ...detectMatchdayNewsEvents(mdResults, league.season, matchday, goalTotalsBefore, goalTotalsAfter),
    );

    newResults.push(...mdResults);

    // Persist a power-rankings snapshot at fixed points through the season
    // (every POWER_SNAPSHOT_INTERVAL matchdays, plus the finale — 38 matching
    // the "season" target above). Each matchday is simmed exactly once per
    // season, so no duplicate guard is needed however the user batches sims.
    // The interval is a save-size lever: each snapshot is a row per club for
    // the whole world and the history is never pruned. See the constant.
    if (matchday % POWER_SNAPSHOT_INTERVAL === 0 || matchday === 38) {
      newSnapshots.push(
        computePowerRankingSnapshot(
          currentTeams, currentPlayers, [...league.played, ...newResults],
          league.season, matchday,
        ),
      );
    }

    onMatchday?.(matchday, index, matchdays.length, mdResults, mdCupTies, mdDomesticTies);
  }

  // A stop-before-final break leaves this matchday and every later one
  // unplayed — fold them back into `remaining` so the batch ends cleanly with
  // the league still in its regular phase.
  const finalRemaining =
    stoppedBeforeMatchday === null
      ? remaining
      : [...toSim.filter((g) => g.matchday >= stoppedBeforeMatchday), ...remaining];

  // Entering the offseason: draw this offseason's international campaign (if any)
  // so its fixtures exist, unplayed, before the user is offered the stage
  // buttons. Purely a draw on end-of-season ratings — no player is touched and
  // no shared-stream rng is drawn — so it can't perturb club results.
  const enteringOffseason = finalRemaining.length === 0;
  const international = enteringOffseason
    ? initInternationalCampaign(league.international, currentPlayers, league.season, league.lid)
    : league.international;

  // Same boundary: the promotion playoffs are the last act of the season, so
  // they are played here — on end-of-season squads, before progression ages
  // anyone and before retirement takes a veteran out of his club's final. It
  // has to happen *before* the board review below, because where a country
  // holds a playoff "did we go up" is not a question the table can answer.
  // Every tie runs on its own seeded stream (see promotionPlayoff.ts), so no
  // league scoreline moves; `simOffseason` replays this itself if it is handed
  // a league that never came through here, which is how headless callers get
  // the same world the game does.
  const allPlayed = [...league.played, ...newResults];
  const promotionPlayoffs = enteringOffseason
    ? playPromotionPlayoffs(
      league.competitions, currentTeams, currentPlayers,
      tablesByCompetition(
        currentTeams, league.competitions, allPlayed,
        pointsDeductionMap(league.debtSanctions, league.season),
      ),
      league.lid, league.season,
    )
    : league.promotionPlayoffs;

  // Same boundary, same reasoning: the board reviews the season the moment it
  // ends, so a sacking or a job offer is answered *before* the offseason runs
  // and a manager who moves manages his new club's summer, not his old one's.
  // Pure state — no player is touched and no shared-stream rng is drawn.
  const manager = enteringOffseason
    ? reviewSeason({
      league,
      teams: currentTeams,
      players: currentPlayers,
      played: allPlayed,
      cup,
      shield,
      domesticCups,
      promotionPlayoffs,
    }).manager
    : league.manager;

  return {
    ...league,
    teams: currentTeams,
    players: currentPlayers,
    phase: enteringOffseason ? "offseason" : "regular",
    international,
    schedule: finalRemaining,
    manager,
    played: allPlayed,
    transfers,
    transferClauses: clauses,
    activeLoans,
    winterMarketRunSeason,
    newsEvents: [...league.newsEvents, ...newEvents],
    powerRankingHistory: [...league.powerRankingHistory, ...newSnapshots],
    cup,
    shield,
    domesticCups,
    promotionPlayoffs,
    superCups,
  };
}
