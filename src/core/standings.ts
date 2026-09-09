import type { BoxScore, PlayerMatchLine } from "../engine/attribution.js";
import type { SeasonAwards } from "./awards.js";
import type { WorldAwards } from "./worldAwards.js";
import type { RetirementSummary } from "./players/retirements.js";
import type { AwardWinner } from "./awardWinners.js";
import type { PromotionPlayoff } from "./promotionPlayoff.js";
import type { SuperCupTie } from "./superCup/types.js";

export interface MatchScore {
  home: number;
  away: number;
  homeGoals: number;
  awayGoals: number;
}

export interface PlayedMatch extends MatchScore {
  possessionHome: number;
  matchday: number;
  boxScore: BoxScore;
}

export interface StandingsRow {
  tid: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  /**
   * Points docked from this club by a sanction, as a positive number, already
   * subtracted from `points`.
   *
   * Present only on a club that was actually docked, so it is absent on every
   * row of every ordinary table and on every table stored before sanctions
   * existed. It has to be carried rather than left implicit: a table whose
   * points column does not reconcile with its own W/D/L reads as a bug, so
   * every surface that renders a table needs to be able to say why.
   */
  deducted?: number;
}

/** A club's aggregated box-score totals for one season, for the Team Stat Leaders history. */
export interface TeamSeasonStats {
  tid: number;
  played: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  /** Total goals conceded across the season; see PlayerMatchLine.goalsAgainst (only nonzero on the match's GK line). */
  goalsAgainst: number;
  /** Total expected goals against; see PlayerMatchLine.xga. */
  xga: number;
  saves: number;
  tackles: number;
  /** Average possession share (0-100) across the team's matches. */
  possessionPct: number;
  /** Average match rating across every appearance with minutes played. */
  avgRating: number;
}

/** A completed season's final table, snapshotted at offseason rollover before `played` is cleared. */
export interface SeasonHistoryEntry {
  season: number;
  table: StandingsRow[];
  teamStats: TeamSeasonStats[];
  /** Player of the Season / Golden Boot / Team of the Season, per competition, keyed by compId. */
  awards: Record<number, SeasonAwards>;
  /** Ballon d'Or ranking + World Team of the Year — the whole world judged as one field, not league by league. */
  world: WorldAwards;
  /** Each team's competition *during this season* (snapshotted before any promotion/relegation swap), so a past season's table/awards can still be labeled correctly after later swaps. */
  compsByTid: Record<number, number>;
  /** Each tier-1 competition's champion, keyed by compId. */
  championTidByCompId: Record<number, number>;
  /**
   * Who retired in the offseason that followed this season — a count plus the
   * notable names, snapshotted because retirement deletes the players.
   *
   * Optional and never backfilled: a save written before the record existed has
   * no way to reconstruct who left (they were deleted without a trace), so
   * those seasons show nothing rather than a fabricated list. See
   * core/players/retirements.ts.
   */
  retirements?: RetirementSummary;
  /**
   * Who this season's award winners were — name, country, position, the rating
   * and club he had that season — copied off the pool that won them.
   *
   * Awards themselves are stored as bare pids, which stops resolving once
   * retirement deletes the player and the capped retiree archive drops him: at
   * 100 seasons that is 74% of league Players of the Season. See
   * core/awardWinners.ts for the measurements and why a copy beats exempting
   * winners from the archive prune.
   *
   * Optional because saves predating it have none. migrate.ts backfills what a
   * save can still resolve, which is everything for a young save and only the
   * survivors for an old one — nothing can bring back a player already deleted.
   */
  awardWinners?: AwardWinner[];
  /**
   * The promotion playoffs this season's tier-2 tables sent to (one per country
   * that holds one), played in the offseason that followed it.
   *
   * Scorelines only — no box scores are ever stored, because the world plays 36
   * of these ties a season and history is kept forever. Optional and never
   * backfilled: a season played before playoffs existed was decided on the table
   * alone, so absent is the truth about it rather than a gap.
   */
  promotionPlayoffs?: PromotionPlayoff[];
  /**
   * The super cups played in the preseason that **opened** this season — the
   * one place they differ from every other record here, which describes the
   * football that closed it.
   *
   * Filed this way because that is when they were played: the contestants were
   * decided by season − 1, but the match belongs to the season it kicks off,
   * the way a real Community Shield is a fixture of the new campaign. Copied
   * here at the next rollover, off `LeagueStore.superCups`.
   *
   * Scorelines only — no box scores, for the reason `promotionPlayoffs` gives.
   * Optional and never backfilled: a season that opened before the competition
   * existed had no super cup, so absent is the truth about it rather than a gap.
   */
  superCups?: SuperCupTie[];
}

/** Sum each club's box-score lines across a season's played matches. */
export function computeTeamSeasonStats(teamIds: number[], matches: PlayedMatch[]): TeamSeasonStats[] {
  const rows = new Map<number, TeamSeasonStats>();
  for (const tid of teamIds) {
    rows.set(tid, {
      tid, played: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xg: 0, goalsAgainst: 0, xga: 0,
      saves: 0, tackles: 0, possessionPct: 0, avgRating: 0,
    });
  }

  const ratingSum = new Map<number, number>();
  const ratingCount = new Map<number, number>();
  const possessionSum = new Map<number, number>();

  const addLines = (tid: number, lines: PlayerMatchLine[]): void => {
    const r = rows.get(tid);
    if (!r) return;
    r.played++;
    for (const l of lines) {
      r.goals += l.goals;
      r.assists += l.assists;
      r.shots += l.shots;
      r.shotsOnTarget += l.shotsOnTarget;
      r.xg += l.xg;
      r.goalsAgainst += l.goalsAgainst;
      r.xga += l.xga;
      r.saves += l.saves;
      r.tackles += l.tackles;
      if (l.minutesPlayed > 0) {
        ratingSum.set(tid, (ratingSum.get(tid) ?? 0) + l.rating);
        ratingCount.set(tid, (ratingCount.get(tid) ?? 0) + 1);
      }
    }
  };

  for (const m of matches) {
    addLines(m.home, m.boxScore.home);
    addLines(m.away, m.boxScore.away);
    possessionSum.set(m.home, (possessionSum.get(m.home) ?? 0) + m.possessionHome * 100);
    possessionSum.set(m.away, (possessionSum.get(m.away) ?? 0) + (1 - m.possessionHome) * 100);
  }

  for (const r of rows.values()) {
    const count = ratingCount.get(r.tid) ?? 0;
    r.avgRating = count > 0 ? (ratingSum.get(r.tid) ?? 0) / count : 0;
    r.possessionPct = r.played > 0 ? (possessionSum.get(r.tid) ?? 0) / r.played : 0;
  }

  return [...rows.values()];
}

/** Build a league table (3/1/0), sorted by points, then GD, then GF, then tid. */
export function computeStandings(
  teamIds: number[],
  matches: MatchScore[],
  deductions?: ReadonlyMap<number, number>,
): StandingsRow[] {
  const rows = new Map<number, StandingsRow>();
  for (const tid of teamIds)
    rows.set(tid, { tid, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });

  const record = (tid: number, gf: number, ga: number): void => {
    const r = rows.get(tid)!;
    r.played++;
    r.gf += gf;
    r.ga += ga;
    r.gd = r.gf - r.ga;
    if (gf > ga) { r.won++; r.points += 3; }
    else if (gf === ga) { r.drawn++; r.points += 1; }
    else { r.lost++; }
  };

  for (const m of matches) {
    record(m.home, m.homeGoals, m.awayGoals);
    record(m.away, m.awayGoals, m.homeGoals);
  }

  // Sanctions come off AFTER every match is counted and BEFORE the sort, so a
  // docked club really does sit where its docked total puts it — in the table
  // the user reads, in the final table that decides promotion, prize money and
  // European places, and in the finish the board judges. Omitting `deductions`
  // leaves every row untouched, so all 24 existing call sites are unchanged.
  if (deductions) {
    for (const [tid, points] of deductions) {
      const r = rows.get(tid);
      if (!r || !(points > 0)) continue;
      r.points -= points;
      r.deducted = points;
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.tid - b.tid,
  );
}
