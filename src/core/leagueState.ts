import type { Player } from "./players/types.js";
import type { PlayedMatch, SeasonHistoryEntry } from "./standings.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { ScheduleGame } from "./schedule.js";
import type { CompletedTransfer, TransferNegotiation } from "./transfers/negotiation.js";
import type { TransferClause } from "./transfers/clauses.js";
import type { InboundOffer } from "./transfers/inboundOffers.js";
import type { NewsEvent } from "./newsEvents.js";
import type { ArchivedPlayer } from "./players/archive.js";
import type { PlayerName } from "./players/playerNames.js";
import type { PowerRankingSnapshot } from "./teams/powerRanking.js";
import type { ActiveLoan, LoanListing, LoanRejection } from "./loans.js";
import type { Competition } from "./competitions.js";
import type { CupState } from "./cup/types.js";
import type { DomesticCupState } from "./domesticCup/types.js";
import type { PromotionPlayoff } from "./promotionPlayoff.js";
import type { SuperCupTie } from "./superCup/types.js";
import { buildDomesticCups } from "./domesticCup/cup.js";
import type { InternationalState } from "./international/types.js";
import { emptyInternationalState } from "./international/index.js";
import type { ManagerState } from "./manager/types.js";
import { emptyManagerState } from "./manager/types.js";
import type { NationalManagerState } from "./nationalManager/types.js";
import { emptyNationalManagerState } from "./nationalManager/types.js";
import { generateWorld } from "./league/generate.js";
import { assignIdentities, assignAIFormations } from "./teams/clubs.js";
import { generateSchedule } from "./schedule.js";
import { SEASON_MATCHDAYS } from "./calendar.js";
import { worldCompetitions } from "./competitions.js";
import { reconcileScoutingObserved } from "./scouting/potentialFog.js";
import { DEFAULT_DIFFICULTY, type Difficulty } from "./constants.js";
import { isSpectatorTid } from "./spectator.js";

export type { StoredTeam } from "./teams/clubs.js";
export type { ScheduleGame } from "./schedule.js";

/** One competition's worth of fixtures per competition, concatenated — shared by createLeagueState and any test/tooling code that assembles a LeagueStore from a League + competitions table by hand. */
export function buildCompetitionSchedule(
  teams: Pick<StoredTeam, "tid" | "compId">[],
  competitions: Competition[],
): ScheduleGame[] {
  return competitions.flatMap((comp) => {
    const fixtures = generateSchedule(
      teams.filter((t) => t.compId === comp.id).map((t) => t.tid),
    );
    return spreadOverSeason(fixtures);
  });
}

/**
 * Stretch a competition's rounds across the fixed SEASON_MATCHDAYS grid, so a
 * division of any size still starts near matchday 1 and finishes on the last
 * one, taking blank matchdays in between.
 *
 * A 20-club division plays 38 rounds and maps one-to-one, so **the shipped world
 * is untouched** — round r keeps matchday r. A 16-club division plays 30 rounds
 * and sits them at 1, 3, 4, 5, 6, 8 … 38.
 *
 * Spreading rather than letting a short season simply end early is what keeps
 * the rest of the calendar meaningful for it: the winter window still opens
 * mid-season, deadline day still falls with games left to play, and its run-in
 * still lines up with the continental finals. Blank matchdays are also why
 * injuries and bans have to tick per club that actually played (see
 * simThrough), not once per matchday for everyone.
 */
function spreadOverSeason(fixtures: ScheduleGame[]): ScheduleGame[] {
  const rounds = fixtures.length === 0
    ? 0
    : Math.max(...fixtures.map((g) => g.matchday));
  if (rounds === 0 || rounds === SEASON_MATCHDAYS) return fixtures;
  return fixtures.map((g) => ({
    ...g,
    matchday: Math.round((g.matchday * SEASON_MATCHDAYS) / rounds),
  }));
}

export interface LeagueStore {
  lid: number;
  meta: {
    name: string;
    created: number;
    userTid: number;
    /**
     * The real-world year this save's season 1 is displayed as, chosen when
     * the league was created. **Cosmetic only** — seasons stay a 1-based
     * counter everywhere in the sim, and nothing reads this but the UI's
     * `seasonYear` formatter. Optional, and deliberately not backfilled: a
     * save written before the picker existed has no answer, and absent
     * already means the 2026 those saves have always displayed.
     */
    startYear?: number;
  };
  /** The leagues in this save's world, one entry per division per country (see competitions.ts). */
  competitions: Competition[];
  teams: StoredTeam[];
  players: Player[];
  season: number;
  phase: "regular" | "offseason";
  schedule: ScheduleGame[];
  played: PlayedMatch[];
  /** User↔club transfer talks for the current window (pruned when a new window's talks start). */
  negotiations: TransferNegotiation[];
  /** AI clubs' offers for the user's own players, current window (see transfers/inboundOffers.ts). */
  inboundOffers: InboundOffer[];
  /** Completed transfers, all seasons (newest last). */
  transfers: CompletedTransfer[];
  /**
   * Live contingent money attached to deals the user negotiated: sell-on shares
   * and bonuses (see transfers/clauses.ts).
   *
   * Its own field rather than a column on `CompletedTransfer`, and that is a
   * correctness requirement rather than tidiness. `detachTransfers` windows the
   * transfer log to the last PLAYER_SETTLED_SEASONS seasons before it crosses to
   * the worker — and a bonus settles, and a resale triggers a sell-on, *inside*
   * that worker. A clause older than the window would be read as absent and
   * silently pay nobody. It is also live state that gets deleted when it
   * resolves, where the log is append-only history.
   *
   * Bounded without a cap: a clause dies on payout, on expiry, when the player
   * leaves the club that owes it, and when he leaves the world (scrubbed
   * alongside the watchlist at both retirement and the free-agent cull).
   */
  transferClauses: TransferClause[];
  /**
   * The season whose winter AI transfer market has already run, so it fires
   * exactly once per season no matter how the user batches matchdays. null =
   * hasn't run this season (reset every offseason rollover). The summer
   * market runs inside simOffseason and needs no such flag.
   */
  winterMarketRunSeason: number | null;
  /** Final league table for every completed season, oldest first. */
  seasonHistory: SeasonHistoryEntry[];
  /** Player accomplishments (hat-tricks, standout ratings, goal milestones), all seasons, oldest first. */
  newsEvents: NewsEvent[];
  /**
   * Permanent career records for retirees good enough to stay on the all-time
   * lists (`/frivolities`). Retirement deletes the player from `players`
   * outright, so without this a legend vanishes the season he hangs up.
   *
   * Quality-gated and hard-capped — see players/archive.ts and the
   * `RETIREE_ARCHIVE_*` block in constants.ts — because a 240-club world retires
   * hundreds of players every offseason and an ungated list is exactly the bug
   * that produced the 88 MB save. Old saves backfill to empty and fill from
   * their next offseason on: the players already deleted left no trace to
   * reconstruct.
   */
  retiredPlayers: ArchivedPlayer[];
  /**
   * Who every *other* deleted player was: five fields, no career.
   *
   * The companion to `retiredPlayers` and deliberately not the same list. That
   * one is a leaderboard and is capped for it; this one exists so the records
   * still pointing at a deleted player can name him, which is a question about
   * every referenced pid rather than about the best 2,000 careers. Without it a
   * long save forgets its own history — measured at season 101, the archive's
   * prune bar sits at peak ovr 79 and 78% of historical pid references resolve
   * to nobody.
   *
   * Written only for retirees, and only for pids the history actually
   * references, so it is bounded by the records that need it rather than by a
   * cap (see players/playerNames.ts). ~102 bytes a row.
   *
   * Old saves backfill to empty and fill from their next offseason on. Anyone
   * already deleted stays nameless: this is the same one-way door
   * `awardWinners` documents, and no migration can reopen it.
   */
  playerNames: PlayerName[];
  /**
   * Power-rankings snapshots taken at fixed points during every season (every
   * POWER_SNAPSHOT_INTERVAL matchdays plus the finale — see simThrough),
   * oldest first. Persisted because past rankings can't be recomputed: rosters
   * change mid-season and `played` is wiped at every offseason rollover.
   */
  powerRankingHistory: PowerRankingSnapshot[];
  /** Loans currently in effect (parent club still owns the contract, loanee club fields him and pays wages). */
  activeLoans: ActiveLoan[];
  /** The user's own senior-roster players listed for an outgoing loan, awaiting an AI club's offer. */
  loanListings: LoanListing[];
  /** Incoming loan offers the user has turned down this window (see loans.ts's loanOfferCandidates). */
  loanRejections: LoanRejection[];
  /**
   * Players the user has starred to keep an eye on — a shortlist, in the order
   * they were added. Read by `/watchlist`; see core/watchlist.ts.
   *
   * Stored as bare pids because everything else about a watched player (club,
   * rating, price, whether he's buyable) is a question about the world *now*,
   * not about the day he was starred, so it is all derived on read.
   *
   * The other league-level user lists beside it here are their club's business
   * and are dropped when the user takes a new job; this one deliberately isn't
   * (see manager/switchClub.ts) — it's the manager's own notebook, not the
   * club's. Scrubbed when a watched player retires or is culled, since a pid
   * that names nobody can never be un-starred through the UI.
   *
   * Migrated to `[]`, which is what every save written before it means.
   */
  watchlist: number[];
  /**
   * The Continental Cup being played during the current season, or null when
   * none runs (season 1 always — no prior-season table to qualify from — and
   * any world that can't field a full 16-team bracket). Seeded each offseason
   * from the just-finished tier-1 tables; see core/cup.
   */
  cup: CupState | null;
  /** Every completed Continental Cup, oldest first (archived at offseason rollover). */
  cupHistory: CupState[];
  /**
   * The Continental Shield being played during the current season, or null when
   * none runs (season 1, a world too small to field one, or a save from before
   * the Shield existed — those pick one up at their next offseason).
   *
   * Held as its own field rather than folded into a list of cups: `cup` has
   * some thirty readers across the sim and the UI, and a list would turn every
   * one of them into a lookup. The two share everything structural — see
   * CUP_FORMATS for the handful of numbers that differ.
   */
  shield: CupState | null;
  /** Every completed Continental Shield, oldest first (archived at offseason rollover). */
  shieldHistory: CupState[];
  /**
   * This season's domestic cups, one per country — a straight knockout across
   * both of a country's divisions, drawn open round by round. Unlike the
   * Continental Cup these run from season 1 (nothing has to qualify), so the
   * list is only empty on a world too small to field one. See core/domesticCup.
   */
  domesticCups: DomesticCupState[];
  /** Every completed domestic cup, oldest first (archived at offseason rollover). */
  domesticCupHistory: DomesticCupState[];
  /**
   * The promotion playoffs decided by the season that just ended, one per
   * country that holds one.
   *
   * **Transient, not history.** Filled the moment the season ends (in
   * simThrough, before the board reviews it, so a manager who goes up is told
   * so) and emptied again by the offseason that consumes it — which copies the
   * same records onto that season's `seasonHistory` entry, where they live
   * permanently. So it is non-empty only while the user is sitting in the
   * offseason looking at the result, and the page reads both places for the
   * same reason the Cup page reads `cup` and `cupHistory`.
   *
   * Old saves backfill to empty and pick playoffs up at their next season end.
   * See core/promotionPlayoff.ts.
   */
  promotionPlayoffs: PromotionPlayoff[];
  /**
   * This preseason's super cups — one per country between its league champions
   * and its domestic cup winners, plus the one worldwide match between the
   * Continental Cup and Shield winners.
   *
   * Seeded during the offseason roll, when every winner that contests them has
   * just been decided, and played before the season's first matchday on the
   * squads that will actually start it. They then sit here unchanged for the
   * rest of the season so the page has something to show, and are copied onto
   * the season's `seasonHistory` entry at the next rollover.
   *
   * `tie === null` on any of them is the preseason gate: `simThrough` will not
   * start the season while one is unplayed. That is *derived* rather than a new
   * `phase` value on purpose — a third phase would need migrating into every
   * save and read by everything that switches on the field, for a state that
   * lasts one click.
   *
   * Old saves backfill to empty and pick super cups up at their next rollover.
   * See core/superCup.
   */
  superCups: SuperCupTie[];
  /**
   * National-team football, played entirely inside the offseason on a two-year
   * cycle (odd seasons qualify, even seasons play the tournament). Starts empty
   * on a new save and fills from the first offseason onward; see
   * src/core/international.
   */
  international: InternationalState;
  /**
   * God Mode sandbox toggle for this save. When true, guardrail-free editing
   * is unlocked (see src/core/godMode.ts) and potential is shown un-fogged
   * everywhere. Purely a save-scoped switch; migrated to false for old saves.
   */
  godMode: boolean;
  /**
   * How hard this save is (see the DIFFICULTIES block in constants.ts).
   * Chosen on the New League screen and fixed for the save's lifetime — every
   * lever it drives is user-club-only, so the world economy is identical on all
   * four levels. Migrated to "normal" for old saves, which is exactly the
   * shipped tuning, so no dynasty in progress changes behaviour.
   */
  difficulty: Difficulty;
  /**
   * Monotonic pid allocator: the next pid a generated player will take.
   *
   * **Must never go backwards.** This used to be derived as
   * `max(players.pid) + 1` at each use, which is only safe while players are
   * never removed — and they are: retirement deletes them (simOffseason step 3)
   * and so does the free-agent cull. If the highest-pid player is removed, a
   * derived allocator hands his pid to a brand-new player, who then silently
   * inherits his transfer history, news events and cup box-score lines (pids
   * are the only link). Storing the cursor makes reuse impossible.
   *
   * Backfilled for old saves as `max(pid) + 1` (see migrate.ts), which is
   * exactly what the derived version would have returned, so no save changes
   * behavior on upgrade.
   */
  nextPid: number;
  /**
   * The user's managerial career: board confidence at the current club, the
   * clubs managed so far, and any job offers on the table.
   *
   * `meta.userTid` remains the single source of truth for *which* club the user
   * owns — this is the career around it, and the reason that field can now
   * change mid-save. Backfilled for old saves at full confidence with one open
   * stint, so upgrading can't get anyone sacked for seasons the board never saw.
   */
  manager: ManagerState;
  /**
   * The user's *international* career, run alongside the club one: which
   * country they manage (if any), how the federation rates them, and which
   * other countries have come calling.
   *
   * A sibling of `manager` rather than a field on it, because the two jobs are
   * held at the same time and judged by different people on different things.
   * Unlike the club career, having no job here is an ordinary permanent state —
   * `nation` null is what every save was before this existed, and is what an
   * old save is backfilled to.
   */
  nationalManager: NationalManagerState;
  /**
   * Seasons the AI managed the user's club, because they jumped forward past
   * them (see core/autopilot.ts). Oldest first, normally empty.
   *
   * Stored rather than derived because nothing else in the save records it: a
   * jumped season looks like any other season afterwards, and "I didn't pick
   * that squad" is the one piece of context the club's own history can't
   * reconstruct. Migrated to `[]`, which is what every dynasty played by hand
   * means anyway.
   */
  aiManagedSeasons: number[];
  /**
   * Whether Continental Cup places are re-earned each season on a rolling
   * country coefficient (see cup/coefficients.ts), or stay fixed at whatever
   * allocation the world was built with.
   *
   * Chosen on the New League screen and fixed for the save's lifetime, like
   * `difficulty`, because it changes how qualification is read: a player who
   * turned it off should never see a shaded row move for a reason the game no
   * longer models. Off, every one of the coefficient's consumers falls back to
   * `Competition.continentalSlots` / the shipped strength-class allocation —
   * which is exactly what the game did before coefficients existed.
   *
   * Migrated to `true` for old saves, which is the behaviour they already had,
   * so no dynasty in progress changes.
   */
  rollingCoefficients: boolean;
}

export function createLeagueState(
  /**
   * The club the user manages, or `SPECTATOR_TID` for a save nobody manages.
   *
   * A spectator tid needs no special handling in here: it matches no club, so
   * the identity/formation passes skip it exactly as they already skip an
   * unmatched tid, the fog-of-war stamp is guarded on finding a team, and
   * `emptyManagerState` opens no stint. See `core/spectator.ts`.
   */
  userTid: number,
  rng: () => number,
  seed = 0,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
  competitions: Competition[] = worldCompetitions(),
  rollingCoefficients = true,
  /**
   * The national team the user takes charge of, or null for club football only.
   * Takes no rng draw and touches nothing in generation — the world is built
   * first and the appointment is simply recorded against it, so two saves that
   * differ only in this are the same world.
   */
  userNation: string | null = null,
): LeagueStore {
  const league = generateWorld(rng, seed, competitions);
  // Each AI club lines up in the formation that fields its strongest XI; the
  // user's club keeps the neutral 4-3-3 default and picks its own on the Roster page.
  const teams = assignAIFormations(
    assignIdentities(league, competitions, userTid, difficulty), league.players, userTid,
  );
  const schedule = buildCompetitionSchedule(teams, competitions);

  // Fog-of-war: stamp the user's initial senior roster as first-observed in
  // season 1 so their potential estimates clear over the first few seasons,
  // same as any later signing (see src/core/scouting/potentialFog.ts).
  const userTeam = teams.find((t) => t.tid === userTid);
  if (userTeam) {
    userTeam.scoutingObserved = reconcileScoutingObserved({}, userTeam.roster, 1);
  }

  return {
    lid: 0,
    meta: {
      name: "My League",
      created: Date.now(),
      userTid,
    },
    competitions,
    teams,
    players: league.players,
    season: 1,
    phase: "regular",
    schedule,
    played: [],
    negotiations: [],
    inboundOffers: [],
    transfers: [],
    transferClauses: [],
    winterMarketRunSeason: null,
    seasonHistory: [],
    newsEvents: [],
    retiredPlayers: [],
    playerNames: [],
    powerRankingHistory: [],
    activeLoans: [],
    loanListings: [],
    loanRejections: [],
    watchlist: [],
    // No cup in season 1: it's seeded from the previous season's final tables,
    // and there is none yet. The first Continental Cup runs in season 2.
    cup: null,
    cupHistory: [],
    // Same for the Shield — both are seeded together at the first offseason.
    shield: null,
    shieldHistory: [],
    // Domestic cups need no qualification, so unlike the Continental Cup they
    // run from season 1. Drawn with no tables to rank on, which the field
    // builder handles by falling back to tid order.
    domesticCups: buildDomesticCups(competitions, teams, new Map(), 1),
    domesticCupHistory: [],
    promotionPlayoffs: [],
    // Season 1 has no super cups: nothing has been won yet to contest one.
    superCups: [],
    international: emptyInternationalState(),
    godMode: false,
    manager: emptyManagerState(userTid, 1),
    // Chosen on the New League screen, and legitimately null: managing a country
    // is opt-in, and declining is not a lesser save. Forced null when nobody
    // manages a club, so the invariant "a spectator manages nothing" holds
    // against every caller rather than only against the one screen that offers
    // the choice.
    nationalManager: emptyNationalManagerState(
      isSpectatorTid(userTid) ? null : userNation, 1,
    ),
    difficulty,
    // Same value the old derived `max(pid) + 1` produced at first use, so a
    // fresh world generates identically to before.
    nextPid: Math.max(0, ...league.players.map((p) => p.pid)) + 1,
    aiManagedSeasons: [],
    rollingCoefficients,
  };
}
