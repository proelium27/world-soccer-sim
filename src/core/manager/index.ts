/**
 * The board's end-of-season review: judge the season just played, then decide
 * whether the manager keeps the job and who else wants them.
 *
 * Runs at the offseason *transition* (in `simThrough`, where the international
 * campaign is drawn) rather than inside `simOffseason`, for three reasons. It
 * judges the season just finished, so it wants that season's final table and
 * nothing that happens afterwards. It has to be answerable by the user before
 * the offseason runs, so a manager who changes clubs manages the *new* club's
 * summer rather than the old one's. And that boundary is already the game's
 * established "the season is over, here is what happened" moment.
 *
 * Pure and rng-free with respect to the shared stream — offers draw on their own
 * seeded stream (see jobOffers.ts), and nothing here touches a player rating, a
 * valuation or a club's money.
 */
import type { LeagueStore } from "../leagueState.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { Player } from "../players/types.js";
import type { Competition } from "../competitions.js";
import type { CupState } from "../cup/types.js";
import type { DomesticCupState } from "../domesticCup/types.js";
import type { PlayedMatch, StandingsRow } from "../standings.js";
import { computeStandings } from "../standings.js";
import { difficultyProfile } from "../constants.js";
import { computeCountrySwaps } from "../promotion.js";
import { playoffOutcomes, type PromotionPlayoff } from "../promotionPlayoff.js";
import { cupRunSummary } from "../cup/cup.js";
import { deriveExpectations, actualFinish } from "./expectation.js";
import { judgeSeason, type SeasonVerdict } from "./confidence.js";
import { generateJobOffers, managerReputation, type OfferMoves } from "./jobOffers.js";
import { currentStint, type ManagerState } from "./types.js";
import { pointsDeductionMap } from "../finance/debt.js";

export * from "./types.js";
export * from "./expectation.js";
export * from "./confidence.js";
export * from "./jobOffers.js";
export * from "./interests.js";
export { switchClub } from "./switchClub.js";

/** Final tables for every competition, keyed by compId. */
export function tablesByCompetition(
  teams: Pick<StoredTeam, "tid" | "compId">[],
  competitions: Competition[],
  played: PlayedMatch[],
  deductions?: ReadonlyMap<number, number>,
): Map<number, StandingsRow[]> {
  const out = new Map<number, StandingsRow[]>();
  for (const comp of competitions) {
    const tids = teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const tidSet = new Set(tids);
    out.set(comp.id, computeStandings(tids, played.filter((m) => tidSet.has(m.home)), deductions));
  }
  return out;
}

export interface ReviewInput {
  league: LeagueStore;
  teams: StoredTeam[];
  players: Player[];
  played: PlayedMatch[];
  cup: CupState | null;
  shield: CupState | null;
  domesticCups: DomesticCupState[];
  /**
   * This season's promotion playoffs, already played.
   *
   * The board reviews the season the moment it ends, and where a country holds
   * a playoff "did we go up" is not answerable from the table alone — so the
   * playoff is settled first (see simThrough's offseason transition) and the
   * result comes in here. Omitted by a caller with none, which reads as the
   * plain top-N promotion the swap then applies.
   */
  promotionPlayoffs?: PromotionPlayoff[];
}

export interface ManagerReview {
  manager: ManagerState;
  /** What the board made of the season, or null if there was no season to judge. */
  verdict: SeasonVerdict | null;
}

/**
 * Run the board's review of the completed season and return the manager state it
 * leaves behind. Never switches clubs on its own — a sacking sets `sacked` and
 * puts offers on the table; the user chooses which one to accept.
 */
export function reviewSeason(input: ReviewInput): ManagerReview {
  const { league, teams, players, played } = input;
  const manager = league.manager;
  const userTid = league.meta.userTid;

  // `league.seasonHistory` deliberately does NOT yet contain the season being
  // judged — it is appended during the offseason that follows — so the bar is
  // set by what the club had already done before it played. That is the whole
  // point: a manager must not be able to move their own target.
  // Judge each season exactly once. `enteringOffseason` in simThrough is true
  // whenever the schedule is empty, which includes a league already sitting in
  // the offseason, so a second call would decay confidence twice, apply the same
  // delta twice and count one season as two. The winter market next door guards
  // itself the same way with `winterMarketRunSeason`.
  if (manager.lastVerdict?.season === league.season) return { manager, verdict: null };

  const expectations = deriveExpectations(
    teams, players, league.competitions, league.seasonHistory,
  );
  const mine = expectations.get(userTid);
  const stint = currentStint(manager);
  // No club to judge. This is the load-bearing case for a **multi-season jump**:
  // `beginAutopilot` parks `meta.userTid` at `AUTOPILOT_TID` (-2, never a real
  // tid) for the duration, so the board reviews nothing and the manager state
  // comes out of a jump untouched. That is the behaviour we want — you weren't
  // picking the team, so you can't be sacked for it — and it is also what stops
  // a jump ending with `sacked` set and no way to answer it, since the offers
  // would belong to a season the user is no longer in. Pinned by a test.
  if (!mine || !stint) return { manager, verdict: null };

  // With the deduction applied, so the board judges the finish the club
  // actually recorded. That is the whole reason a sanction is sporting rather
  // than a direct hit on confidence: it reaches the board through the finish,
  // and `deriveExpectations` — which must stay unmovable by any transfer
  // decision — needs no knowledge of it at all.
  const tables = tablesByCompetition(
    teams, league.competitions, played,
    pointsDeductionMap(league.debtSanctions, league.season),
  );
  const table = tables.get(mine.compId);
  const finish = table ? actualFinish(table, userTid) : null;
  // No matches played (a save advanced straight through, or a world with an
  // empty competition): there is nothing to judge, so the board stays put.
  if (finish === null) return { manager, verdict: null };

  const swaps = computeCountrySwaps(
    league.competitions, tables, playoffOutcomes(input.promotionPlayoffs ?? []),
  );
  const promoted = swaps.some((s) => s.promoted.includes(userTid));
  const relegated = swaps.some((s) => s.relegated.includes(userTid));

  // Where every club ends up once the offseason applies these swaps, so an offer
  // names the division the club will actually play in rather than the one it is
  // leaving. See JobOffer.compId.
  const moves: OfferMoves = {
    promoted: new Set(swaps.flatMap((x) => x.promoted)),
    relegated: new Set(swaps.flatMap((x) => x.relegated)),
    nextCompId: new Map([
      ...swaps.flatMap((x) => x.promoted.map((tid): [number, number] => [tid, x.d1CompId])),
      ...swaps.flatMap((x) => x.relegated.map((tid): [number, number] => [tid, x.d2CompId])),
    ]),
  };

  let trophies = 0;
  if (input.cup && cupRunSummary(input.cup, userTid)?.isChampion) trophies++;
  if (input.shield && cupRunSummary(input.shield, userTid)?.isChampion) trophies++;
  if (input.domesticCups.some((c) => c.championTid === userTid)) trophies++;

  const titles = finish === 1 ? 1 : 0;
  const verdict = judgeSeason(
    {
      finish,
      expectedRank: mine.expectedRank,
      clubs: mine.clubs,
      demand: mine.demand,
      titles,
      trophies,
      promoted,
      relegated,
    },
    manager.confidence,
    stint.seasons,
    manager.sackingEnabled,
    difficultyProfile(league.difficulty).boardPatience,
  );

  const updatedStint = {
    ...stint,
    seasons: stint.seasons + 1,
    titles: stint.titles + titles,
    trophies: stint.trophies + trophies,
    overperformance: stint.overperformance + verdict.overperformance,
  };
  const stints = [...manager.stints.slice(0, -1), updatedStint];

  const offers = generateJobOffers({
    lid: league.lid,
    season: league.season,
    currentTid: userTid,
    expectations,
    sacked: verdict.sacked,
    // Judge reputation on the record including the season just played, so a
    // title-winning season opens doors that same summer.
    reputation: managerReputation(stints),
    lastOverperformance: verdict.overperformance,
    moves,
    interests: manager.interests,
  });

  // `ManagerState.sacked` promises a non-empty offer list, because there is no
  // unemployed state for the save to fall back on. `generateJobOffers` drops its
  // filters rather than return nothing, but a world with no other club at all
  // (reachable through the custom world editor) can still leave it empty — and a
  // sacking there would strand the save with no way forward. Keeping the job is
  // the only safe resolution.
  const stranded = verdict.sacked && offers.length === 0;
  const sacked = verdict.sacked && !stranded;

  return {
    manager: {
      ...manager,
      confidence: verdict.confidence,
      stints,
      offers,
      sacked,
      lastVerdict: {
        ...verdict, sacked, season: league.season, previousConfidence: manager.confidence,
      },
    },
    verdict: { ...verdict, sacked },
  };
}

/** The user has an unanswered decision blocking the offseason. */
export function isManagerDecisionPending(manager: ManagerState): boolean {
  return manager.sacked;
}
