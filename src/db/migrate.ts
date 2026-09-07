import type { LeagueStore } from "../core/leagueState.js";
import { CLUBS, type StoredTeam } from "../core/teams/clubs.js";
import type { Player, SeasonStats, RatingsSnapshot, Position } from "../core/players/types.js";
import type { PlayerMatchLine } from "../engine/attribution.js";
import type { TeamSeasonStats } from "../core/standings.js";
import { computeSeasonAwards, type SeasonAwards } from "../core/awards.js";
import { computeWorldAwards, type WorldAwards } from "../core/worldAwards.js";
import { backfillAwardWinners } from "../core/awardWinners.js";
import {
  HYPE_INITIAL, SCOUTING_SPEND_DEFAULT,
  NUM_TEAMS, DEFAULT_DIFFICULTY,
} from "../core/constants.js";
import { chargeSeasonStart, wageBill, financeScale } from "../core/finance/budget.js";
import { englandCompetitions } from "../core/competitions.js";
import { cullOnLoad } from "../core/players/freeAgentCull.js";
import { summaryOf, ovrLookup } from "../core/players/careerSummary.js";
import { computeOvr } from "../core/players/ovr.js";
import { archiveCup } from "../core/cup/archive.js";
import { archiveDomesticCup } from "../core/domesticCup/archive.js";
import { cupRunSummary } from "../core/cup/cup.js";
import type { ManagerState } from "../core/manager/types.js";
import { emptyNationalManagerState } from "../core/nationalManager/types.js";
import type { IntlStage } from "../core/international/index.js";

/**
 * Map a persisted international stage onto the current IntlStage union. The
 * only change so far: "qf"/"sf"/"final" were three stages naming a fixed
 * three-round bracket, and became one repeating "knockout" when the World Cup
 * grew to eight groups and a round of 16. Anything already valid passes
 * through, and an unrecognised value becomes null — the campaign is then simply
 * not pending, which the next offseason resolves by drawing a fresh one.
 */
function migrateIntlStage(stage: unknown): IntlStage {
  if (stage === "qf" || stage === "sf" || stage === "final") return "knockout";
  if (
    stage === "qualifying" || stage === "groups" || stage === "knockout"
    || stage === "confederation-groups" || stage === "confederation-ko" || stage === "done"
  ) {
    return stage;
  }
  return null;
}

/**
 * A team as it may exist in a save written before M6 added the finance
 * fields, or before the second division / competitions refactor: `compId`
 * didn't exist yet, only the old `division: 0 | 1` field.
 */
type StoredTeamAnyVersion =
  Omit<StoredTeam, "budget" | "hype" | "scoutingSpend" | "nextScoutingSpend" | "academyBase" | "starters" | "formation" | "academyRoster" | "compId" | "divisionConvergence" | "transferListed" | "moreMinutes" | "scoutingObserved"> &
  Partial<Pick<StoredTeam, "budget" | "hype" | "scoutingSpend" | "nextScoutingSpend" | "academyBase" | "starters" | "formation" | "academyRoster" | "compId" | "divisionConvergence" | "transferListed" | "moreMinutes" | "scoutingObserved">> &
  { division?: 0 | 1 };

/**
 * Generation constants frozen at the values active when academyBase was
 * introduced as a field (the M6-era finance work) — NOT live imports from
 * constants.js. A save missing academyBase predates that field entirely, so
 * it was generated under whatever LEAGUE_BASE/TEAM_STRENGTH_SPREAD were in
 * effect at *that* time, not whatever they happen to be today. Importing the
 * live constants here meant every later generation retune (there have
 * already been two: 2026-07-10 and 2026-07-14) silently reshuffled old
 * saves' reconstructed academyBase out from under them on load, breaking the
 * "academyBase is fixed at generation, never touched again" invariant the M4
 * progression-inflation fix depends on. Pinning these avoids that for every
 * future retune; it's still only an approximation for saves old enough to
 * predate the 2026-07-10 rebalance too, which is a pre-existing, unavoidable
 * limitation (no generation-time version marker was ever stored).
 */
const FALLBACK_LEAGUE_BASE = 46;
const FALLBACK_TEAM_STRENGTH_SPREAD = 7;

/**
 * Reconstruct the generation-time strength target for a save written before
 * academyBase existed, using the same evenly-spaced formula generateLeague
 * uses (tid ordering encodes strength: strongest at tid 0).
 */
function fallbackAcademyBase(tid: number): number {
  const frac = tid / (NUM_TEAMS - 1);
  const target = FALLBACK_TEAM_STRENGTH_SPREAD - frac * (2 * FALLBACK_TEAM_STRENGTH_SPREAD);
  return FALLBACK_LEAGUE_BASE + target;
}

/** A league as it may exist in a save written before M6 added the transfer market, or before the competitions refactor. */
type LeagueStoreAnyVersion =
  Omit<LeagueStore, "negotiations" | "inboundOffers" | "transfers" | "winterMarketRunSeason" | "seasonHistory" | "newsEvents" | "competitions" | "activeLoans" | "loanListings" | "loanRejections" | "cup" | "cupHistory" | "domesticCups" | "domesticCupHistory" | "promotionPlayoffs" | "superCups" | "powerRankingHistory" | "godMode" | "international" | "nextPid" | "difficulty" | "aiManagedSeasons" | "manager" | "rollingCoefficients" | "nationalManager" | "watchlist" | "transferClauses"> &
  Partial<Pick<LeagueStore, "negotiations" | "inboundOffers" | "transfers" | "winterMarketRunSeason" | "seasonHistory" | "newsEvents" | "competitions" | "activeLoans" | "loanListings" | "loanRejections" | "cup" | "cupHistory" | "domesticCups" | "domesticCupHistory" | "promotionPlayoffs" | "superCups" | "powerRankingHistory" | "godMode" | "international" | "nextPid" | "difficulty" | "aiManagedSeasons" | "manager" | "rollingCoefficients" | "nationalManager" | "watchlist" | "transferClauses">>;

/** A season-stats entry as it may exist in a save written before Match Rating / xG / xGA / per-season team tracking / cards. */
type SeasonStatsAnyVersion =
  Omit<SeasonStats, "minutesPlayed" | "ratingSum" | "avgRating" | "interceptions" | "xg" | "goalsAgainst" | "xga" | "tid" | "passes" | "passesCompleted" | "crosses" | "foulsCommitted" | "yellowCards" | "redCards"> &
  Partial<Pick<SeasonStats, "minutesPlayed" | "ratingSum" | "avgRating" | "interceptions" | "xg" | "goalsAgainst" | "xga" | "tid" | "passes" | "passesCompleted" | "crosses" | "foulsCommitted" | "yellowCards" | "redCards">>;

/** A team-season-stats row as it may exist in a save written before xG / xGA. */
type TeamSeasonStatsAnyVersion = Omit<TeamSeasonStats, "xg" | "goalsAgainst" | "xga"> &
  Partial<Pick<TeamSeasonStats, "xg" | "goalsAgainst" | "xga">>;

/**
 * A season-history entry as it may exist in a save written before Team Stat
 * Leaders history / xG / awards / the second division / the competitions
 * refactor. `awards` has gone through three shapes over time: a single
 * SeasonAwards (pre-second-division), a [D1, D2] tuple (second division),
 * and a Record<compId, SeasonAwards> (post-competitions-refactor).
 */
type SeasonHistoryEntryAnyVersion =
  Omit<LeagueStore["seasonHistory"][number], "teamStats" | "awards" | "world" | "compsByTid" | "championTidByCompId"> &
  Partial<{
    teamStats: TeamSeasonStatsAnyVersion[];
    world: WorldAwards;
    awards: SeasonAwards | [SeasonAwards, SeasonAwards] | Record<number, SeasonAwards>;
    compsByTid: Record<number, number>;
    divisionsByTid: Record<number, 0 | 1>;
    championTidByCompId: Record<number, number>;
    championTid: number;
  }>;

/** A box-score line as it may exist in a save written before Match Rating / xG / xGA. */
type PlayerMatchLineAnyVersion =
  Omit<PlayerMatchLine, "minutesPlayed" | "rating" | "interceptions" | "xg" | "goalsAgainst" | "xga" | "passes" | "passesCompleted" | "crosses" | "foulsCommitted"> &
  Partial<Pick<PlayerMatchLine, "minutesPlayed" | "rating" | "interceptions" | "xg" | "goalsAgainst" | "xga" | "passes" | "passesCompleted" | "crosses" | "foulsCommitted">>;

/** A played match as it may exist in a save written before M3 added box scores. */
type PlayedMatchAnyVersion = {
  boxScore?: {
    home: PlayerMatchLineAnyVersion[];
    away: PlayerMatchLineAnyVersion[];
    events?: PlayedMatch["boxScore"]["events"];
  };
};

type PlayedMatch = LeagueStore["played"][number];

function migrateLine(line: PlayerMatchLineAnyVersion): PlayerMatchLine {
  return {
    ...line,
    minutesPlayed: line.minutesPlayed ?? 0,
    rating: line.rating ?? 6.0,
    interceptions: line.interceptions ?? 0,
    xg: line.xg ?? 0,
    goalsAgainst: line.goalsAgainst ?? 0,
    xga: line.xga ?? 0,
    passes: line.passes ?? 0,
    passesCompleted: line.passesCompleted ?? 0,
    crosses: line.crosses ?? 0,
    foulsCommitted: line.foulsCommitted ?? 0,
  };
}

/**
 * Career peak ovr, from the ratings history the readers used to scan.
 *
 * Exact, not a guess: this is the same walk `careerPeakOvr` and `peakOf` did
 * inline, so migrating is the last time it has to happen. Seeded from current
 * ovr and replaced only on strictly greater, matching what both readers did —
 * which is why `peakOvrSeason` stays absent when the current rating is already
 * the best: `peakOf` credits its own `fallbackSeason` in that case, and storing
 * a season here would be inventing one.
 */
function peakFromHist(p: Player): { peakOvr: number; peakOvrSeason?: number } {
  if (p.peakOvr != null) {
    return p.peakOvrSeason == null
      ? { peakOvr: p.peakOvr }
      : { peakOvr: p.peakOvr, peakOvrSeason: p.peakOvrSeason };
  }
  let peakOvr = p.ovr;
  let peakOvrSeason: number | undefined;
  for (const h of p.hist ?? []) {
    if (h.ovr > peakOvr) {
      peakOvr = h.ovr;
      peakOvrSeason = h.season;
    }
  }
  return peakOvrSeason == null ? { peakOvr } : { peakOvr, peakOvrSeason };
}

/**
 * `fallbackTid` is the player's *current* club — the best guess available for
 * a save old enough to predate per-season team tracking, since no historical
 * roster-membership data survives to reconstruct which club he was actually
 * on in a past season (same irreconstructable-history situation as the
 * minutes/rating defaults below).
 */
function migratePlayer(p: Player, fallbackTid: number, currentSeason: number): Player {
  // OVR is re-derived from stored ratings, not carried over (position-OVR
  // balance, 2026-08-23). It has to be: progression recomputes `ovr` from
  // scratch each offseason, so an old save left alone would show its full backs
  // and central midfielders jump a few points at the next rollover with no
  // explanation. Doing it at load makes the change arrive with the change.
  //
  // Exact, not a guess — the ratings the number is computed from are all stored,
  // and every past snapshot carries its own. Potential is clamped up to it
  // because potential is a scout's estimate of a PEAK and so can never sit below
  // the rating a player already holds; a position whose OVR rose could otherwise
  // land above its own stored estimate.
  //
  // What this can NOT do is re-roll how much a position's players vary
  // (POSITION_RATING_SPREAD applies at generation), so an old save keeps its
  // original spread and only new leagues get that half.
  const ovr = computeOvr(p.pos, p.ratings, p.heightCm);
  const hist = (p.hist as (RatingsSnapshot & { academy?: boolean; pos?: Position })[]).map((h) => {
    const pos = h.pos ?? p.pos;
    const histOvr = computeOvr(pos, h.ratings, p.heightCm);
    return {
      ...h,
      // Pre-academy-tracking saves have no per-season academy flag on their
      // rating snapshots; there's no way to reconstruct which past seasons a
      // player spent in the academy, so they default to senior (false) and only
      // future seasons record the real value.
      academy: h.academy ?? false,
      // Pre-position-change saves stamp no position on a rating snapshot. The
      // backfill is exact rather than a guess: nothing could change a player's
      // position before that feature existed, so every past snapshot was taken
      // at the position he still holds. (Contrast the academy flag above, which
      // genuinely can't be reconstructed.)
      pos,
      // Re-derived on the same rule as the live rating above, so a career OVR
      // chart reads as one continuous scale instead of stepping at the season
      // this shipped.
      ovr: histOvr,
      potential: Math.max(h.potential, histOvr),
    };
  });

  // Peak and the career summary are derived from the RE-DERIVED ratings above,
  // never from the stored ones. Both are stored from here on and are then
  // treated as authoritative (`careerPeakOvr`, `peakOf`, every all-time board),
  // so seeding them from numbers this same function has just replaced would
  // freeze a stale peak into the save permanently.
  const rederived: Player = { ...p, ovr, hist };
  const peak = peakFromHist(rederived);

  return {
    ...p,
    ovr,
    potential: Math.max(p.potential, ovr),
    stats: (p.stats as SeasonStatsAnyVersion[]).map((s) => ({
      ...s,
      tid: s.tid ?? fallbackTid,
      minutesPlayed: s.minutesPlayed ?? 0,
      ratingSum: s.ratingSum ?? 0,
      avgRating: s.avgRating ?? 0,
      interceptions: s.interceptions ?? 0,
      xg: s.xg ?? 0,
      goalsAgainst: s.goalsAgainst ?? 0,
      xga: s.xga ?? 0,
      passes: s.passes ?? 0,
      passesCompleted: s.passesCompleted ?? 0,
      crosses: s.crosses ?? 0,
      foulsCommitted: s.foulsCommitted ?? 0,
      // Cards were simulated per match long before they were totalled per
      // season, so a past season's real card count is sitting in box scores
      // that archived cups have since discarded. Backfilling from what survives
      // would under-count some seasons and not others, which reads worse than
      // an honest zero — past seasons start blank and future ones are exact.
      yellowCards: s.yellowCards ?? 0,
      redCards: s.redCards ?? 0,
    })),
    hist,
    // Per-campaign international lines (added 2026-07-25). Saves from before
    // them keep their career totals, which stay the authoritative record; the
    // breakdown can't be reconstructed (archived campaigns hold no box scores),
    // so it starts empty and fills from the next campaign on. `p.intl` itself
    // absent still means "never capped" and is left absent.
    intl: p.intl
      ? {
          ...p.intl,
          seasons: p.intl.seasons ?? [],
          // Confederation cup counters (added with the tournaments
          // themselves). Nobody can have played one before they existed, so 0
          // is exact rather than a guess.
          confederationCups: p.intl.confederationCups ?? 0,
          confederationCupTitles: p.intl.confederationCupTitles ?? 0,
        }
      : p.intl,
    // Career summary, backfilled by folding his seasons one last time. Covers
    // finished seasons only, matching the contract — the season in progress is
    // excluded, because a live reader adds the current row itself.
    career: p.career ?? summaryOf(
      (p.stats ?? []).filter((s) => s.season !== currentSeason),
      // Peak as the fallback rating, matching what the boards did inline; `born`
      // is a season number too and would read as a real-looking wrong year.
      ovrLookup(hist, peak.peakOvr),
    ),
    // Career peak ovr, backfilled by the scan the readers used to do inline.
    // Exact rather than a guess: `hist` is the same data `careerPeakOvr` and
    // `peakOf` were walking, so this is the last time it ever has to be walked.
    // Seeded from current ovr, and ties keep the *earlier* season, matching the
    // strictly-greater comparison both readers used.
    ...peak,
    // faSignedSeason (the free-agent transfer hold) is intentionally left
    // absent on pre-feature saves: there's no way to know which past free-agent
    // signings would still be inside their hold, and "absent" is the correct
    // default — it means "not held," so nobody is retroactively locked. Only
    // free agents signed after this feature shipped carry the field.
    //
    // `suspension` / `yellowCount` are likewise left absent by design rather
    // than backfilled. Both are optional and their absent state is already the
    // correct one — nobody banned, nobody carrying bookings — so a pre-feature
    // save simply starts the rest of its season with a clean disciplinary
    // record instead of inventing bans out of box scores nobody was charged for.
  };
}

/**
 * Backfill fields added to the schema since a league was saved. Every league
 * coming out of IndexedDB or a JSON import passes through here, so the rest
 * of the app can rely on the LeagueStore type telling the truth.
 *
 * Pre-M6 saves lack the finance fields on teams and the transfer-market
 * lists on the league; they get launch defaults. Pre-Match-Rating saves lack
 * minutes/rating on season stats and historical box scores — those can't be
 * reconstructed after the fact (no clock data survives), so they default to
 * 0 minutes / a neutral 6.0 rating rather than being left undefined.
 *
 * Club identities (name/abbrev/colors) are user-customizable per save, so
 * they are only backfilled from CLUBS when a stored team lacks them — never
 * re-stamped, or a rename made in the Customize Teams editor (or a save from
 * the real-club-names era) would be silently reverted on the next load.
 */
export function migrateLeague(league: LeagueStore): LeagueStore {
  return cullOnLoad(migrateFields(league));
}

/**
 * Field-by-field backfill. Split out from migrateLeague so the free-agent cull
 * runs on a fully-formed LeagueStore.
 *
 * The cull is applied here, at load, rather than waiting for the next offseason:
 * an aged save is frozen *now* (save size is what blocks the main thread), and a
 * player who can't get the game to respond can't reach an offseason to have it
 * cleaned up. The ongoing offseason cull then keeps it bounded from there.
 *
 * `cullOnLoad` only fires on a pool past FREE_AGENT_CULL_LOAD_THRESHOLD, so
 * normal mid-season play never has players deleted out from under it (a released
 * player stays re-signable until the next offseason).
 */
function migrateFields(league: LeagueStore): LeagueStore {
  const anyVersion = league as LeagueStoreAnyVersion;
  // Pre-competitions-refactor saves have no competitions table at all — they
  // were always England-only, so the 2-entry table backfills mechanically
  // (their legacy `division` values 0/1 are already valid compIds).
  const competitions = anyVersion.competitions ?? englandCompetitions();
  // Pre-M6 backfill only: seed the budget the way a season start would —
  // base allocation in, the save's current wage bill out.
  const salaryMap = new Map(league.players.map((p) => [p.pid, p.contract.salary]));
  const tidByPid = new Map<number, number>();
  for (const t of league.teams) {
    for (const pid of t.roster) tidByPid.set(pid, t.tid);
    for (const pid of t.academyRoster ?? []) tidByPid.set(pid, t.tid);
  }
  const migratedPlayers = league.players.map((p) => migratePlayer(p, tidByPid.get(p.pid) ?? -1, league.season));
  return {
    ...league,
    competitions,
    teams: (league.teams as StoredTeamAnyVersion[]).map((t) => {
      const compId = t.compId ?? t.division ?? 0;
      return {
        ...t,
        name: t.name ?? CLUBS[t.tid]?.name,
        abbrev: t.abbrev ?? CLUBS[t.tid]?.abbrev,
        colors: t.colors ?? CLUBS[t.tid]?.colors,
        budget: t.budget ?? chargeSeasonStart(0, wageBill(t.roster, salaryMap), financeScale(competitions, compId), t.hype ?? HYPE_INITIAL),
        hype: t.hype ?? HYPE_INITIAL,
        scoutingSpend: t.scoutingSpend ?? SCOUTING_SPEND_DEFAULT,
        // nextScoutingSpend (added with the season-lock, 2026-07-18): old saves
        // seed it from the current spend, so nothing changes until the user
        // adjusts it in an offseason window.
        nextScoutingSpend: t.nextScoutingSpend ?? t.scoutingSpend ?? SCOUTING_SPEND_DEFAULT,
        academyBase: t.academyBase ?? fallbackAcademyBase(t.tid),
        starters: t.starters ?? null,
        // Formation (added 2026-07-19). Old saves default to 4-3-3, the shape
        // every team fielded before formations were selectable.
        formation: t.formation ?? "4-3-3",
        academyRoster: t.academyRoster ?? [],
        // Youth trial group (added 2026-08-31). Empty on every old save, which
        // is exact rather than a guess: the intake those saves already ran
        // signed itself straight into the academy, so there is no pending
        // decision to reconstruct. The next offseason lays out a real group.
        youthTrialists: t.youthTrialists ?? [],
        youthTrialSignings: t.youthTrialSignings ?? 0,
        // Scout directions (added 2026-09-01). Empty is exact rather than a
        // guess: an old save's scouts had nothing to go on, so they looked
        // close to home for whoever the academy happened to turn up — which is
        // precisely what an empty set of directions still produces.
        scoutingRegions: t.scoutingRegions ?? [],
        scoutingPositions: t.scoutingPositions ?? [],
        compId,
        divisionConvergence: t.divisionConvergence ?? null,
        transferListed: t.transferListed ?? [],
        // "Give more minutes" flags (added 2026-07-22). Old saves start with none
        // flagged — subs behave exactly as before until the user flags someone.
        moreMinutes: t.moreMinutes ?? [],
        // Fog-of-war observation map (added 2026-07-18). Old saves get an
        // empty map: the user's existing senior roster reads as tenure 0
        // (fully fogged) and then clears over the next few seasons as the
        // offseason reconcile stamps first-observed seasons — same as a
        // fresh save's initial squad, an accepted one-time re-fog on load.
        scoutingObserved: t.scoutingObserved ?? {},
      };
    }),
    players: migratedPlayers,
    played: league.played.map((m) => {
      const boxScore = (m as PlayedMatchAnyVersion).boxScore;
      return {
        ...m,
        // Pre-M3 saves have played matches with no boxScore at all; an empty
        // one degrades to "No events recorded" instead of failing to load.
        boxScore: boxScore
          ? {
              events: boxScore.events ?? [],
              home: boxScore.home.map(migrateLine),
              away: boxScore.away.map(migrateLine),
            }
          : { home: [], away: [], events: [] },
      };
    }),
    negotiations: anyVersion.negotiations ?? [],
    inboundOffers: anyVersion.inboundOffers ?? [],
    transfers: anyVersion.transfers ?? [],
    winterMarketRunSeason: anyVersion.winterMarketRunSeason ?? null,
    // Same permanent-loss story as `retirements` below: everyone who retired
    // before the archive existed was deleted without a trace, so there is
    // nothing to reconstruct. An old save starts empty and fills from its next
    // offseason onward — the all-time lists are honest about covering only the
    // seasons the save has actually recorded.
    retiredPlayers: anyVersion.retiredPlayers ?? [],
    // Same one-way door, and there is genuinely nothing to backfill from. The
    // sources that could name an old retiree — the live pool, the archive, the
    // farewell lists, the award snapshots — are all read directly by the UI
    // already, so copying them in here would duplicate rows that resolve
    // anyway and still name nobody new. An old save starts empty and stops
    // losing names from its next offseason on.
    playerNames: anyVersion.playerNames ?? [],
    // Older saves have no record of past seasons' final tables; they simply
    // start accumulating history from this point forward. Saves from before
    // Team Stat Leaders history has team totals per completed season either:
    // their per-match box scores were already cleared at that rollover, so
    // there's nothing to backfill from — those seasons just show no team
    // stats rather than reconstructing false zeros.
    //
    // `retirements` is the same story but permanently: retirement deletes the
    // player, so a season that ran before the record existed has no trace of
    // who left. It stays absent (the field is optional, and the `...h` spread
    // below carries it through where it exists) and the Season Preview says so
    // rather than inventing a list. Its rows' `goat` score is absent for the
    // same reason one layer down: an older list names players who are long
    // gone, so there is no career left to score, and the column shows nothing
    // for them.
    seasonHistory: ((anyVersion.seasonHistory ?? []) as SeasonHistoryEntryAnyVersion[]).map((h) => {
      // Pre-second-division saves were always single-division: every team
      // that season was Division 1 (compId 0). Post-second-division,
      // pre-competitions-refactor saves already have the right shape under
      // the old field name.
      const compsByTid: Record<number, number> = h.compsByTid
        ?? h.divisionsByTid
        ?? Object.fromEntries(league.teams.map((t) => [t.tid, 0]));
      // Player.stats is append-only and never pruned, so unlike teamStats
      // above, past seasons' awards CAN be reconstructed after the fact.
      // Detect which of the three historical shapes this entry has: a
      // Record already (post-refactor, nothing to do), a [D1, D2] tuple
      // (second-division era), or a single SeasonAwards object
      // (pre-second-division, single competition), or missing entirely.
      const rawAwards = h.awards;
      const awards: Record<number, SeasonAwards> = Array.isArray(rawAwards)
        ? { 0: rawAwards[0], 1: rawAwards[1] }
        : rawAwards && "playerOfSeasonPid" in rawAwards
          ? { 0: rawAwards }
          : rawAwards
            ? rawAwards
            : { 0: computeSeasonAwards(migratedPlayers, h.season) };
      const championTidByCompId: Record<number, number> = h.championTidByCompId
        ?? (h.championTid !== undefined ? { 0: h.championTid } : { 0: h.table[0]?.tid ?? 0 });
      // Worldwide honors reconstruct from the same append-only records, so a
      // save that predates them gets its whole history backfilled rather than
      // only picking them up from the next offseason. Same caveat as the
      // per-competition awards above: players who have since retired are no
      // longer in the pool, so a very old season is judged on the survivors.
      const seasonCup = [...(anyVersion.cupHistory ?? []), ...(anyVersion.cup ? [anyVersion.cup] : [])]
        .find((c) => c.season === h.season) ?? null;
      const world: WorldAwards = h.world ?? computeWorldAwards(migratedPlayers, h.season, {
        compsByTid,
        competitions,
        championTidByCompId,
        // statLines must be carried through: on a save archiveCup has already run
        // over, the box scores are gone and the stored lines are the only cup
        // record left, so dropping them here would score every past season's
        // cup as zero without failing.
        cup: seasonCup ? { ...seasonCup, competition: seasonCup.competition ?? "continental", leaguePhase: seasonCup.leaguePhase ?? null, playoff: seasonCup.playoff ?? null, playIn: seasonCup.playIn ?? null, twoLegged: seasonCup.twoLegged ?? false, koLegs: seasonCup.koLegs ?? null, statLines: seasonCup.statLines ?? null } : null,
        // Same idea for the domestic cups of that season. A save from before
        // they existed has none, so the term is simply absent and the season
        // scores exactly as it did — which is also why the whole backfill stays
        // stable rather than re-ranking old seasons on a trophy nobody played
        // for. `statLines` is what an archived cup keeps, and domesticStatsByPid
        // reads it.
        domesticCups: [
          ...(anyVersion.domesticCupHistory ?? []),
          ...(anyVersion.domesticCups ?? []),
        ].filter((c) => c.season === h.season),
        worldCupChampion:
          anyVersion.international?.history?.find((t) => t.season === h.season)?.champion ?? null,
        // Confederation cups from that offseason. A save old enough to
        // be backfilled here played none, so this is empty for every past
        // season and only fills going forward — the same honest-blank rule the
        // rest of this backfill follows.
        confederationCupChampions: new Set(
          (anyVersion.international?.confederationCupHistory ?? [])
            .filter((t) => t.season === h.season)
            .map((t) => t.champion),
        ),
      });
      // Names for the pids above. Unlike the awards themselves this can NOT be
      // reconstructed later — a winner who has retired and fallen out of the
      // capped archive is gone from the save entirely — so the backfill records
      // whoever is still resolvable today and stops the bleed there. An old
      // save keeps the winners it can still name and leaves the rest blank
      // rather than inventing them. See core/awardWinners.ts.
      const awardWinners = backfillAwardWinners(
        { ...h, awards, world }, h.season, migratedPlayers, anyVersion.retiredPlayers ?? [],
      );
      return {
        ...h,
        teamStats: (h.teamStats ?? []).map((t) => ({
          ...t, xg: t.xg ?? 0, goalsAgainst: t.goalsAgainst ?? 0, xga: t.xga ?? 0,
        })),
        awards,
        world,
        compsByTid,
        championTidByCompId,
        ...(awardWinners ? { awardWinners } : {}),
      };
    }),
    // Generational-talent arrivals used to be announced on the News Feed. The
    // trait is hidden by design, so the announcement was giving away a number
    // the player is meant to infer from a scout's potential estimate — and it
    // is dropped from saves in progress too, not just new ones, or an existing
    // save keeps leaking it forever. The type no longer exists, so these would
    // otherwise render as a blank label.
    newsEvents: (anyVersion.newsEvents ?? []).filter(
      (e: { type: string }) => e.type !== "generationalTalent",
    ),
    activeLoans: anyVersion.activeLoans ?? [],
    loanListings: anyVersion.loanListings ?? [],
    loanRejections: anyVersion.loanRejections ?? [],
    // A save written before the watchlist existed had no shortlist, so empty is
    // exact rather than a guess.
    watchlist: anyVersion.watchlist ?? [],
    // Contingent transfer money (sell-on shares, bonuses). A save written
    // before clauses existed agreed none, so empty is exact rather than a
    // guess — there is nothing to reconstruct and nothing was lost.
    transferClauses: anyVersion.transferClauses ?? [],
    // Pre-cup saves have no Continental Cup; they start with none and get one
    // seeded at their next offseason from that season's final tables (so an
    // existing save picks the cup up from the following season onward). Backfill
    // the optional stage fields so old cups typecheck and their format is read
    // correctly: a cup with no `leaguePhase` is a legacy straight bracket (its
    // retained code finishes it), and `playIn`/`playoff` default to null. An
    // in-progress legacy cup keeps finishing under the old format; the next
    // offseason builds a Swiss cup.
    // `twoLegged` defaults false so any cup already in progress finishes under
    // the old single-leg knockout rules; the next offseason builds a two-legged
    // one. (Archived cups in cupHistory are done, so the flag is cosmetic there.)
    cup: anyVersion.cup
      ? { ...anyVersion.cup, competition: anyVersion.cup.competition ?? "continental", leaguePhase: anyVersion.cup.leaguePhase ?? null, playoff: anyVersion.cup.playoff ?? null, playIn: anyVersion.cup.playIn ?? null, twoLegged: anyVersion.cup.twoLegged ?? false, koLegs: anyVersion.cup.koLegs ?? null, statLines: anyVersion.cup.statLines ?? null }
      : null,
    // Archived cups collapse to per-player stat lines and drop their box scores
    // (see archiveCup) -- 18 MB of an aged save, and size is what freezes the
    // game. archiveCup aggregates BEFORE dropping, so an old save's group-stage
    // and playoff appearances are captured on the way out rather than lost;
    // that is the only chance to do it, since the box scores are then gone.
    cupHistory: (anyVersion.cupHistory ?? []).map((c) => archiveCup({
      ...c, competition: c.competition ?? "continental", leaguePhase: c.leaguePhase ?? null, playoff: c.playoff ?? null, playIn: c.playIn ?? null, twoLegged: c.twoLegged ?? false, koLegs: c.koLegs ?? null, statLines: c.statLines ?? null,
    })),
    // Saves from before the Continental Shield have none, and one can't be
    // invented for a season already played (it would need that season's final
    // tables *and* its matches). They start empty and pick a Shield up at the
    // next offseason, exactly as pre-cup saves did for the Continental Cup.
    shield: anyVersion.shield ?? null,
    shieldHistory: (anyVersion.shieldHistory ?? []).map((c) => archiveCup(c)),
    // Pre-domestic-cup saves start with none rather than having one drawn
    // mid-season: a cup drawn in, say, February would have to cram its rounds
    // into the matchdays that are left, and half of them are already gone. The
    // next offseason builds a full one, so an existing save picks domestic cups
    // up from the following season onward — the same deal the Continental Cup
    // gave saves that predated it.
    domesticCups: anyVersion.domesticCups ?? [],
    // Archived domestic cups collapse to per-player lines and drop their box
    // scores, same as the Continental Cup's (see archiveDomesticCup). Only
    // reachable for a save written by an earlier build of this feature.
    domesticCupHistory: (anyVersion.domesticCupHistory ?? []).map((c) => archiveDomesticCup({
      ...c, statLines: c.statLines ?? null,
    })),
    // The playoffs a just-finished season sent to, held only until the
    // offseason consumes them. Empty for any save that isn't sitting in exactly
    // that window, and deliberately never reconstructed for past seasons: those
    // promotions really were decided on the table, so inventing a bracket for
    // them would be inventing results. A save mid-season picks its first
    // playoff up when that season ends. See core/promotionPlayoff.ts.
    promotionPlayoffs: anyVersion.promotionPlayoffs ?? [],
    // Same one-way reasoning as the playoffs above: a season that opened before
    // super cups existed did not play one, so an old save picks its first up at
    // its next rollover rather than having one invented for a preseason that is
    // already behind it. Empty also means "no gate", so a save loaded
    // mid-preseason can never be stuck waiting on a match it cannot play.
    superCups: anyVersion.superCups ?? [],
    // Pre-feature saves start with no power-rankings history; snapshots can't
    // be reconstructed retroactively (past rosters/matches are gone), so they
    // simply accrue from the next simmed matchdays onward.
    powerRankingHistory: anyVersion.powerRankingHistory ?? [],
    // Pre-feature saves have no international football. They start with an
    // empty state and join the two-year cycle at their next *odd* season's
    // offseason (an even one has no qualifying campaign on file to play a
    // tournament from), so at worst a save waits one extra season for its
    // first World Cup. Saves from before staged play get `stage: null` (no
    // campaign pending), so their next offseason draws and stages one fresh.
    // See core/international.
    international: anyVersion.international
      ? {
          ...anyVersion.international,
          // The three named knockout stages ("qf"/"sf"/"final") collapsed into
          // one repeating "knockout" when the World Cup field grew to 32 and
          // its bracket gained a round. A save caught mid-knockout maps onto
          // it: the round actually played is read off the tournament's own
          // fixtures (roundsRemaining), never off the stage name, so an
          // in-progress bracket finishes at whatever size it was drawn at.
          stage: migrateIntlStage(anyVersion.international.stage),
          // Light archival added later: past qualifying + power-ranking history
          // start empty and fill from the next campaign on; old tournament
          // summaries predate stored group tables / knockout scorelines, so
          // backfill those to empty (their champion/field still render).
          qualifyingHistory: anyVersion.international.qualifyingHistory ?? [],
          powerRankings: anyVersion.international.powerRankings ?? [],
          stageInjuries: anyVersion.international.stageInjuries ?? [],
          // Confederation cups (the Euro / Copa America / AFCON) start
          // empty on a save that predates them and are drawn the next time the
          // cycle's middle qualifying offseason comes round — at worst a save
          // waits three seasons for its first one. Past editions can't be
          // invented: they were never played.
          confederationCups: anyVersion.international.confederationCups ?? [],
          confederationCupHistory: anyVersion.international.confederationCupHistory ?? [],
          history: (anyVersion.international.history ?? []).map((h) => ({
            ...h,
            groups: h.groups ?? [],
            knockout: h.knockout ?? [],
          })),
        }
      : {
          qualifying: null, tournament: null, confederationCups: [], history: [],
          qualifyingHistory: [], confederationCupHistory: [], powerRankings: [],
          stage: null, stageInjuries: [],
        },
    // Managing a country is opt-in and chosen at league creation, so a save
    // that predates it has declined by default — `nation: null` is the state
    // every save was in before this shipped, not a gap to be filled. Nothing is
    // reconstructed: past campaigns were played with nobody in charge of any
    // nation, and inventing a career for them would credit the user with
    // tournaments they never picked a squad for. An existing dynasty can take a
    // national job the next time one is offered, which is the following
    // offseason at the latest.
    nationalManager: anyVersion.nationalManager ?? emptyNationalManagerState(),
    // God Mode sandbox editing defaults off for any save that predates it.
    godMode: anyVersion.godMode ?? false,
    // Difficulty is fixed at league creation, so a save that predates it was
    // played on the shipped tuning — which is exactly what "normal" is (every
    // lever in its profile is the identity value or the shipped constant). So
    // this backfill changes nothing about a dynasty in progress.
    difficulty: anyVersion.difficulty ?? DEFAULT_DIFFICULTY,
    // The pid allocator used to be derived as max(pid) + 1 at each use, so
    // seeding the stored cursor with exactly that value keeps every existing
    // save generating the same pids it would have anyway. From here it only
    // ever moves forward, which is what makes removing players safe.
    nextPid:
      anyVersion.nextPid
      ?? Math.max(0, ...(anyVersion.players ?? []).map((p) => p.pid)) + 1,
    // Nothing to reconstruct: a save that predates the jump-forward feature was
    // managed by hand every season it played.
    aiManagedSeasons: anyVersion.aiManagedSeasons ?? [],
    // Cup places have been re-earned on a rolling coefficient since the feature
    // shipped, and every save that predates the SETTING was played that way, so
    // `true` is the behaviour they already had rather than a default being
    // imposed on them. (Saves older than the coefficient itself get it too —
    // it is derived from their own archived cups, so it reads their history
    // correctly from the moment they load.)
    rollingCoefficients: anyVersion.rollingCoefficients ?? true,
    manager: anyVersion.manager ?? backfillManager(anyVersion),
  };
}

/**
 * Reconstruct a manager career for a save written before the board existed.
 *
 * Two deliberate choices. Confidence starts at the **maximum**, not the usual
 * appointment level: the board never watched any of these seasons, and a save
 * that upgrades mid-dynasty must not be one bad year away from a sacking for
 * results nobody was judging at the time. And the honours *are* reconstructed
 * from `seasonHistory` rather than zeroed, because a fifteen-season dynasty
 * arriving with a blank reputation would be offered nothing but minnow jobs.
 *
 * `overperformance` is the one thing left at 0 — it needs each past season's
 * squad rating, which no save stores. That understates an old career's
 * reputation slightly, which is the safe direction to be wrong in.
 */
function backfillManager(anyVersion: LeagueStoreAnyVersion): ManagerState {
  const userTid = anyVersion.meta.userTid;
  const history = anyVersion.seasonHistory ?? [];

  let titles = 0;
  for (const entry of history) {
    const compId = entry.compsByTid?.[userTid];
    if (compId === undefined) continue;
    const table = entry.table.filter((row) => entry.compsByTid[row.tid] === compId);
    if (table[0]?.tid === userTid) titles++;
  }

  const cupTitles = (anyVersion.cupHistory ?? []).filter(
    (c) => cupRunSummary(c, userTid)?.isChampion,
  ).length;
  const shieldTitles = (anyVersion.shieldHistory ?? []).filter(
    (c) => cupRunSummary(c, userTid)?.isChampion,
  ).length;
  const domesticTitles = (anyVersion.domesticCupHistory ?? []).filter(
    (c) => c.championTid === userTid,
  ).length;

  return {
    confidence: 100,
    stints: [{
      tid: userTid,
      startSeason: history[0]?.season ?? 1,
      endSeason: null,
      seasons: history.length,
      titles,
      trophies: cupTitles + shieldTitles + domesticTitles,
      overperformance: 0,
      ending: null,
    }],
    offers: [],
    sacked: false,
    sackingEnabled: true,
    // Nothing to reconstruct: the board never judged any of these seasons, so
    // there is no verdict to explain. Fills in from the next season on.
    lastVerdict: null,
  };
}
