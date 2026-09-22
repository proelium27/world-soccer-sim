/**
 * What a board expects, and how big a job it is.
 *
 * **Expectations are set by the club's standing, never by the squad the manager
 * assembled** — and that is the whole point of this file, not an implementation
 * detail. Grading a manager on current squad quality grades them on the one
 * variable they completely control, so tearing the team down lowers the bar with
 * it and a wrecked squad finishing next-to-last reads as *beating expectations*.
 * The board would be rewarding sabotage.
 *
 * So standing is built only from things a transfer window cannot touch: where
 * the club has recently finished (dominant) and how famous it is. Sell every
 * star, or release them for nothing, and the bar does not move; you simply miss
 * it. Money is deliberately absent — see the note by the weights in constants.ts
 * for the two versions of that term that had to be removed. Sustained
 * success raises the bar over years, which is the "victim of your own success"
 * dynamic real managers live with, and a genuinely declining club sees it fall
 * slowly rather than in one window.
 *
 * Deliberately *not* built on `deriveLeagueContexts`'s `stature`. That is the
 * transfer AI's view of a club and carries ambition/frugality machinery this has
 * no use for; coupling the board to it would mean a transfer-market retune
 * silently changing who gets sacked. Pure, rng-free.
 */
import type { Player } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { Competition } from "../competitions.js";
import type { StandingsRow, SeasonHistoryEntry } from "../standings.js";
import { computeTeamRating } from "../teams/teamRating.js";
import { teamSlots } from "../lineup/formations.js";
import {
  HYPE_MAX,
  MANAGER_DEMAND_W_CLUB,
  MANAGER_DEMAND_W_LEAGUE,
  MANAGER_EXPECTATION_HISTORY_SEASONS,
  MANAGER_EXPECTATION_W_HISTORY,
  MANAGER_EXPECTATION_W_HYPE,
  MANAGER_EXPECTATION_SEASON_DECAY,
  MANAGER_EXPECTATION_TIER_SEAM,
} from "../constants.js";
import { boardPlayoffGoal } from "./playoffExpectation.js";

export interface ClubExpectation {
  tid: number;
  compId: number;
  /**
   * The club's standing, [0,1] — recent finishes blended with fame, which is
   * what the board's expectation is read off. Higher is a bigger club.
   */
  standing: number;
  /** Where that standing ranks inside this club's own competition, 1 = biggest. */
  expectedRank: number;
  /** How many clubs share that competition. */
  clubs: number;
  /**
   * How much of `standing` came from real finishing history rather than the
   * squad fallback, [0,1]. 0 in season 1 (nothing has been played yet), 1 once
   * the club has a full window of seasons behind it. Surfaced so the UI can be
   * honest that an early-save expectation is still reading the starting squad.
   */
  historyCoverage: number;
  /** Squad rating (XI + decayed bench). Not an input to `standing` except as the season-1 fallback. */
  rating: number;
  /**
   * How big a job this is in *world* terms, [0,1] — squad rating blended with
   * fame, normalized across every club in the save. Drives which clubs come
   * calling, so it has to be comparable across countries and tiers: a mid-table
   * English club is a bigger job than the best club in a second division.
   *
   * Squad quality belongs here, unlike in `standing`: this answers "how good a
   * job is this", and a club with a strong squad genuinely is a better job.
   * Nobody can game it, because it is read off *other* clubs.
   */
  prestige: number;
  /**
   * How much the board demands, [0,1]. Blends how big this club is inside its
   * own league with how strong that league is in world terms, so the same finish
   * costs a superclub manager far more than it costs a minnow's.
   */
  demand: number;
  /** The club's league crowns its champion in a playoff (MLS, Liga MX, Argentina). */
  playoffLeague: boolean;
  /**
   * In a playoff league, the stage the board expects ("reach the final"), or
   * null when it expects the club to finish outside the playoff places and
   * judges it on the table instead. Always null in a table league.
   */
  playoffGoal: string | null;
}

function ratingOf(team: StoredTeam, byPid: Map<number, Player>): number {
  const roster = team.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
  if (roster.length === 0) return 0;
  return computeTeamRating(roster, team.starters, teamSlots(team)).ovr;
}

/** Normalize `value` onto [0,1] against a range, flat 0.5 if the range is empty. */
function normalize(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 0.5;
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

/** Normalize each entry of `raw` against the spread of its own competition. */
function normalizeWithinComp(
  raw: Map<number, number>,
  compOf: Map<number, number>,
): Map<number, number> {
  const byComp = new Map<number, number[]>();
  for (const [tid, v] of raw) {
    const comp = compOf.get(tid);
    if (comp === undefined) continue;
    const list = byComp.get(comp) ?? [];
    list.push(v);
    byComp.set(comp, list);
  }
  const bounds = new Map<number, [number, number]>();
  for (const [comp, list] of byComp) bounds.set(comp, [Math.min(...list), Math.max(...list)]);

  const out = new Map<number, number>();
  for (const [tid, v] of raw) {
    const b = bounds.get(compOf.get(tid) ?? -1);
    out.set(tid, b ? normalize(v, b[0], b[1]) : 0.5);
  }
  return out;
}

/**
 * How well a club did in one past season, on a world-comparable [0,1] scale.
 *
 * A finishing position only means something next to the division it was achieved
 * in, so it is converted to a percentile and then scaled by tier. Without that,
 * a promoted second-division champion carries a "1st" into the top flight and
 * the board expects them to win it.
 */
function seasonStanding(
  entry: SeasonHistoryEntry,
  tid: number,
  competitions: Competition[],
): number | null {
  const compId = entry.compsByTid?.[tid];
  if (compId === undefined) return null;
  const rows = entry.table.filter((r) => entry.compsByTid[r.tid] === compId);
  const index = rows.findIndex((r) => r.tid === tid);
  if (index === -1 || rows.length < 2) return null;

  const percentile = 1 - index / (rows.length - 1);
  const tier = competitions.find((c) => c.id === compId)?.tier ?? 1;
  // One continuous world scale with the divisions meeting at the seams: tier 1
  // occupies [seam, 1] and every tier below it takes a band of width `seam`
  // under that, so tier 2 is [0, seam], tier 3 is [-seam, 0], and so on. A
  // second-division title and a last-place top-flight finish come out equal,
  // and so do a third-division title and a last-place second-division finish.
  // Scaling only tier 2 (the first version) left tier-1 strugglers *below*
  // mid-table tier-2 clubs, which had relegated sides expected to finish near
  // the bottom of the division they had just dropped into.
  //
  // **Going negative is fine, and that is the whole reason a third division
  // needs no retune of the two above it.** The only consumer of this number
  // feeds it through normalizeWithinComp, which min-max rescales each
  // competition against its own observed range — so nothing reads the absolute
  // value and the scale is not bounded to [0, 1]. Tiers 1 and 2 keep exactly
  // the numbers they had; the deeper bands are simply appended below.
  //
  // The bug this replaces: `tier === 2 ? low : high` sent EVERY other tier into
  // the top-flight band, so winning the third division scored 1.000 — identical
  // to winning the top flight — and finishing bottom of it outscored mid-table
  // in the second. A third-division manager was judged on top-flight standards.
  if (tier <= 1) {
    return MANAGER_EXPECTATION_TIER_SEAM
      + percentile * (1 - MANAGER_EXPECTATION_TIER_SEAM);
  }
  const bandTop = MANAGER_EXPECTATION_TIER_SEAM * (3 - tier);
  return bandTop - (1 - percentile) * MANAGER_EXPECTATION_TIER_SEAM;
}

/**
 * Every club's expectation and prestige, keyed by tid.
 *
 * One pass over the world — the caller runs this once per season end, not per
 * club, because rank, prestige and league strength are all relative and cannot
 * be computed for a club in isolation.
 *
 * `seasonHistory` must NOT include the season being judged: the bar is set by
 * what the club had already done *before* it played. `reviewSeason` gets this
 * for free, since a season is appended to history during the offseason that
 * follows it.
 */
export function deriveExpectations(
  teams: StoredTeam[],
  players: Player[],
  competitions: Competition[],
  seasonHistory: SeasonHistoryEntry[] = [],
): Map<number, ClubExpectation> {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const rating = new Map(teams.map((t) => [t.tid, ratingOf(t, byPid)]));
  const compOf = new Map(teams.map((t) => [t.tid, t.compId]));

  // Most recent first, so the newest season carries the most weight.
  const recent = seasonHistory.slice(-MANAGER_EXPECTATION_HISTORY_SEASONS).reverse();

  const historyScore = new Map<number, number>();
  const coverage = new Map<number, number>();
  for (const team of teams) {
    let weighted = 0;
    let weight = 0;
    let seen = 0;
    recent.forEach((entry, i) => {
      const s = seasonStanding(entry, team.tid, competitions);
      if (s === null) return;
      const w = MANAGER_EXPECTATION_SEASON_DECAY ** i;
      weighted += s * w;
      weight += w;
      seen++;
    });
    historyScore.set(team.tid, weight > 0 ? weighted / weight : 0);
    coverage.set(team.tid, Math.min(1, seen / MANAGER_EXPECTATION_HISTORY_SEASONS));
  }

  const squadPct = normalizeWithinComp(rating, compOf);
  const hypePct = normalizeWithinComp(new Map(teams.map((t) => [t.tid, t.hype])), compOf);
  const historyPct = normalizeWithinComp(historyScore, compOf);

  // Standing: recent results dominate, fame fills in. Neither can be moved by any
  // transfer, which is the property the whole model turns on. Squad quality
  // appears only as the season-1 fallback, weighted out as real results
  // accumulate — and that squad is the one the manager was handed, not built.
  const standing = new Map<number, number>();
  for (const team of teams) {
    const cov = coverage.get(team.tid) ?? 0;
    const historyTerm =
      cov * (historyPct.get(team.tid) ?? 0.5) + (1 - cov) * (squadPct.get(team.tid) ?? 0.5);
    standing.set(
      team.tid,
      MANAGER_EXPECTATION_W_HISTORY * historyTerm
      + MANAGER_EXPECTATION_W_HYPE * (hypePct.get(team.tid) ?? 0.5),
    );
  }

  // Rank within each competition, and each competition's mean squad strength
  // (the latter measures how strong a *league* is, which squad ratings are the
  // right yardstick for — nobody can game the strength of a whole division).
  const rankByTid = new Map<number, { rank: number; clubs: number }>();
  const compMean = new Map<number, number>();
  for (const comp of competitions) {
    const members = teams.filter((t) => t.compId === comp.id);
    if (members.length === 0) continue;
    const sorted = [...members].sort(
      (a, b) => (standing.get(b.tid) ?? 0) - (standing.get(a.tid) ?? 0),
    );
    sorted.forEach((t, i) => rankByTid.set(t.tid, { rank: i + 1, clubs: sorted.length }));
    compMean.set(
      comp.id,
      members.reduce((sum, t) => sum + (rating.get(t.tid) ?? 0), 0) / members.length,
    );
  }

  const means = [...compMean.values()];
  const leagueLo = Math.min(...means);
  const leagueHi = Math.max(...means);

  const prestigeRaw = new Map(
    teams.map((t) => [t.tid, (rating.get(t.tid) ?? 0) + (t.hype / HYPE_MAX) * PRESTIGE_HYPE_POINTS]),
  );
  const raw = [...prestigeRaw.values()];
  const prestigeLo = Math.min(...raw);
  const prestigeHi = Math.max(...raw);

  const out = new Map<number, ClubExpectation>();
  for (const team of teams) {
    const placing = rankByTid.get(team.tid);
    if (!placing) continue;
    // 1 for the biggest club in its league, 0 for the smallest.
    const clubWeight = placing.clubs > 1 ? 1 - (placing.rank - 1) / (placing.clubs - 1) : 1;
    const leagueWeight = normalize(compMean.get(team.compId) ?? 0, leagueLo, leagueHi);
    const { playoffLeague, goal } = boardPlayoffGoal(
      competitions.find((c) => c.id === team.compId), placing.rank,
    );
    out.set(team.tid, {
      tid: team.tid,
      compId: team.compId,
      standing: standing.get(team.tid) ?? 0.5,
      expectedRank: placing.rank,
      clubs: placing.clubs,
      historyCoverage: coverage.get(team.tid) ?? 0,
      rating: rating.get(team.tid) ?? 0,
      prestige: normalize(prestigeRaw.get(team.tid) ?? 0, prestigeLo, prestigeHi),
      demand: MANAGER_DEMAND_W_CLUB * clubWeight + MANAGER_DEMAND_W_LEAGUE * leagueWeight,
      playoffLeague,
      playoffGoal: goal,
    });
  }
  return out;
}

/**
 * How much fame is worth against squad rating when sizing up a job, in rating
 * points. Kept local rather than in constants.ts: it exists only to put two
 * scales on speaking terms inside this file, and nothing else can read it
 * without also owning this normalization.
 */
const PRESTIGE_HYPE_POINTS = 8;

/**
 * The board's live expectation for one club, or null if it has no competition.
 *
 * A convenience over `deriveExpectations` for the UI, which wants one club but
 * cannot get it without the world-wide pass: rank is relative to a competition
 * and prestige is normalized across every club in the save, so neither can be
 * computed for a club in isolation.
 */
export function expectationFor(
  tid: number,
  teams: StoredTeam[],
  players: Player[],
  competitions: Competition[],
  seasonHistory: SeasonHistoryEntry[] = [],
): ClubExpectation | null {
  return deriveExpectations(teams, players, competitions, seasonHistory).get(tid) ?? null;
}

/** How demanding a board is, in words. */
export function demandLabel(demand: number): string {
  if (demand >= 0.75) return "Demanding";
  if (demand >= 0.5) return "Ambitious";
  if (demand >= 0.25) return "Realistic";
  return "Patient";
}

/**
 * Where a club actually finished in its competition, 1 = champions.
 * Returns null if the club played no matches (so the caller can skip judging a
 * season that didn't happen).
 */
export function actualFinish(table: StandingsRow[], tid: number): number | null {
  const index = table.findIndex((row) => row.tid === tid);
  if (index === -1) return null;
  return table[index].played === 0 ? null : index + 1;
}

/**
 * Finish versus expectation, as a fraction of the division: +1.0 means
 * finishing a whole league's worth of places above where the board had them,
 * -1.0 the reverse. Zero means finishing exactly where expected.
 */
export function overperformance(expectedRank: number, finish: number, clubs: number): number {
  if (clubs <= 1) return 0;
  return (expectedRank - finish) / (clubs - 1);
}

/**
 * `expectationFor`, cached per `LeagueStore` object.
 *
 * The underlying pass walks every club in the world (a `computeTeamRating` per
 * squad, plus a pid map over the whole pool), and the Dashboard renders it on
 * the app's landing page. `useMemo` is not enough on its own: the league context
 * hands out a fresh object on every commit, so a per-component memo re-runs the
 * whole pass on every action, and the Dashboard and Manager page would each pay
 * for their own. Keying a WeakMap on the store object gives both one shared
 * pass per commit and lets it be collected with the league — the same reason
 * `usePlayerRefs` is cached this way rather than with `useMemo`.
 */
const EXPECTATION_CACHE = new WeakMap<object, Map<number, ClubExpectation>>();

export function cachedExpectations(league: {
  teams: StoredTeam[];
  players: Player[];
  competitions: Competition[];
  seasonHistory: SeasonHistoryEntry[];
}): Map<number, ClubExpectation> {
  const hit = EXPECTATION_CACHE.get(league);
  if (hit) return hit;
  const built = deriveExpectations(
    league.teams, league.players, league.competitions, league.seasonHistory,
  );
  EXPECTATION_CACHE.set(league, built);
  return built;
}
