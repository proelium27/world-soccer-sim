import type { LeagueStore } from "../leagueState.js";
import { isFreeAgentTid } from "../transfers/negotiation.js";
import { trebleCountByTid } from "./trebles.js";
import type { ContinentalRegion } from "../constants.js";
import { americasTids, inRegion } from "../americasClubs.js";


/** How many rows each club list shows. */
export const CLUB_LIST_LIMIT = 25;

/** One club's all-time record, aggregated across every completed season. */
export interface ClubRecordRow {
  tid: number;
  /** Seasons with at least one match played. */
  seasons: number;
  /** Seasons spent in a tier-1 competition. */
  topFlightSeasons: number;
  leagueTitles: number;
  secondTierTitles: number;
  cupTitles: number;
  shieldTitles: number;
  /** Americas Cup wins. */
  americasTitles: number;
  /** Domestic cup wins. Counted separately from the Continental Cup — a treble needs both. */
  domesticCupTitles: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  /** Points per game across every season ever played. */
  ppg: number;
  /** Every trophy of any kind — the column the table leads with, so it's also what it sorts by. */
  totalTrophies: number;
  /**
   * Seasons the club won its tier-1 league, the Continental Cup and its
   * domestic cup all at once.
   *
   * Deliberately **not** part of `totalTrophies`: a treble is a coincidence of
   * three trophies already counted there, not a fourth one, so adding it would
   * count the same three wins twice and reorder the table the total sorts by.
   */
  trebles: number;
  /** Season of the club's most recent tier-1 title, or null if it has never won one. */
  lastTitleSeason: number | null;
  /**
   * Completed seasons since the last tier-1 title. For a club that has never
   * won one this counts every season it has played, which is the honest answer
   * to "how long have they been waiting".
   */
  titleDrought: number;
}

/** All-time transfer spending for one club. */
export interface ClubSpendRow {
  tid: number;
  spent: number;
  received: number;
  net: number;
  signings: number;
  sales: number;
}

export interface ClubTrivia {
  /** All-time records, most league titles first. */
  records: ClubRecordRow[];
  /** Longest wait for a tier-1 title, longest first; clubs that have played no seasons are excluded. */
  droughts: ClubRecordRow[];
  /** Biggest all-time gross transfer spend, most first. */
  biggestSpenders: ClubSpendRow[];
  /** Biggest all-time transfer *profit* (received minus spent), most first. */
  biggestSellers: ClubSpendRow[];
  /** How many completed seasons the save has on record. */
  seasonsRecorded: number;
}

/**
 * Club-level all-time trivia, derived in one pass over `seasonHistory`,
 * `cupHistory` and `transfers`.
 *
 * Everything here comes from persisted, append-only records, which is the whole
 * selection criterion: a stat that can't be reconstructed for old seasons would
 * silently read as a trend rather than an artefact. That ruled out roster
 * continuity ("how much of last year's squad is still here") — no per-season
 * roster is stored, and reconstructing it from `Player.stats` would count every
 * retired player as a departure, making the past look permanently more
 * turbulent than the present.
 */
export function computeClubTrivia(
  league: LeagueStore,
  limit = CLUB_LIST_LIMIT,
  /** One continent's clubs. Absent means the world. */
  region?: ContinentalRegion,
): ClubTrivia {
  const americas = new Set(americasTids(league.teams, league.competitions));
  const clubShown = (tid: number) => region === undefined || inRegion(tid, region, americas);
  const tierByCompId = new Map(league.competitions.map((c) => [c.id, c.tier]));
  const latestSeason = league.seasonHistory.reduce((max, h) => Math.max(max, h.season), 0);

  const rows = new Map<number, ClubRecordRow>();

  const treblesByTid = trebleCountByTid(league);

  const rowFor = (tid: number): ClubRecordRow => {
    let r = rows.get(tid);
    if (!r) {
      r = {
        tid, seasons: 0, topFlightSeasons: 0, leagueTitles: 0, secondTierTitles: 0, cupTitles: 0,
        shieldTitles: 0, americasTitles: 0, domesticCupTitles: 0, totalTrophies: 0, trebles: 0,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, ppg: 0,
        lastTitleSeason: null, titleDrought: 0,
      };
      rows.set(tid, r);
    }
    return r;
  };

  for (const h of league.seasonHistory) {
    // Rank within the season's own table decides a title, per competition —
    // `championTidByCompId` only covers tier 1, and a tier-2 title is still a
    // trophy worth counting.
    const byComp = new Map<number, typeof h.table>();
    for (const row of h.table) {
      if (row.played <= 0) continue;
      const compId = h.compsByTid?.[row.tid] ?? 0;
      const list = byComp.get(compId);
      if (list) list.push(row); else byComp.set(compId, [row]);
    }

    for (const [compId, table] of byComp) {
      const tier = tierByCompId.get(compId) ?? 1;
      // Same ordering the standings page uses: points, then goal difference,
      // then goals scored.
      const sorted = [...table].sort(
        (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.tid - b.tid,
      );
      // The recorded champion wins a top flight, not the table leader, because a
      // title playoff can crown a club that finished lower.
      const recordedChampion = tier === 1 ? h.championTidByCompId?.[compId] : undefined;
      sorted.forEach((row, i) => {
        const r = rowFor(row.tid);
        r.seasons += 1;
        if (tier === 1) r.topFlightSeasons += 1;
        r.played += row.played;
        r.won += row.won;
        r.drawn += row.drawn;
        r.lost += row.lost;
        r.gf += row.gf;
        r.ga += row.ga;
        r.points += row.points;
        const wonIt = recordedChampion !== undefined ? recordedChampion === row.tid : i === 0;
        if (wonIt) {
          if (tier === 1) {
            r.leagueTitles += 1;
            r.lastTitleSeason = Math.max(r.lastTitleSeason ?? 0, h.season);
          } else {
            r.secondTierTitles += 1;
          }
        }
      });
    }
  }

  for (const cup of league.cupHistory ?? []) {
    if (cup.championTid != null) rowFor(cup.championTid).cupTitles += 1;
  }
  for (const shield of league.shieldHistory ?? []) {
    if (shield.championTid != null) rowFor(shield.championTid).shieldTitles += 1;
  }
  for (const cup of league.americasCupHistory ?? []) {
    if (cup.championTid != null) rowFor(cup.championTid).americasTitles += 1;
  }

  for (const cup of league.domesticCupHistory ?? []) {
    if (cup.championTid != null) rowFor(cup.championTid).domesticCupTitles += 1;
  }

  for (const r of rows.values()) {
    // Every trophy the cabinet counts. Trebles are deliberately absent: a
    // treble is not a fourth trophy, it's the three already counted here.
    r.totalTrophies = r.leagueTitles + r.cupTitles + r.shieldTitles + r.americasTitles
      + r.domesticCupTitles + r.secondTierTitles;
    r.trebles = treblesByTid.get(r.tid) ?? 0;
    r.ppg = r.played > 0 ? r.points / r.played : 0;
    // A club that has never won counts its whole recorded history as the wait.
    r.titleDrought = r.lastTitleSeason == null
      ? r.seasons
      : latestSeason - r.lastTitleSeason;
  }
  const all = [...rows.values()].filter((r) => clubShown(r.tid));

  // --- Transfer spend -----------------------------------------------------
  const spend = new Map<number, ClubSpendRow>();
  const spendFor = (tid: number): ClubSpendRow => {
    let s = spend.get(tid);
    if (!s) { s = { tid, spent: 0, received: 0, net: 0, signings: 0, sales: 0 }; spend.set(tid, s); }
    return s;
  };
  for (const t of league.transfers) {
    // Loans and free moves shift players without a fee changing hands between
    // two clubs; only real purchases belong in a spending table. A free-agent
    // move has the FREE_AGENT_TID sentinel on one side and so has no
    // counterparty at all — skipped whole, the same rule the biggest-fees list
    // in records.ts applies, so the two surfaces can never disagree about what
    // counts as a transfer.
    if (t.loanSeasons || t.loanReturn || t.fee <= 0) continue;
    if (isFreeAgentTid(t.fromTid) || isFreeAgentTid(t.toTid)) continue;

    const buyer = spendFor(t.toTid);
    buyer.spent += t.fee;
    buyer.signings += 1;

    const seller = spendFor(t.fromTid);
    seller.received += t.fee;
    seller.sales += 1;
  }
  for (const s of spend.values()) s.net = s.received - s.spent;
  const spendRows = [...spend.values()].filter((s) => clubShown(s.tid));

  return {
    // Sorted by the column the table leads with. Ranking by league titles while
    // displaying a total first would put a club with fewer trophies above one
    // with more, which reads as a bug.
    records: [...all].sort(
      (a, b) => b.totalTrophies - a.totalTrophies || b.leagueTitles - a.leagueTitles
        || b.cupTitles - a.cupTitles || a.tid - b.tid,
    ).slice(0, limit),
    droughts: all
      .filter((r) => r.seasons > 0)
      .sort((a, b) => b.titleDrought - a.titleDrought || a.tid - b.tid)
      .slice(0, limit),
    biggestSpenders: [...spendRows].sort((a, b) => b.spent - a.spent || a.tid - b.tid).slice(0, limit),
    biggestSellers: [...spendRows].sort((a, b) => b.net - a.net || a.tid - b.tid).slice(0, limit),
    seasonsRecorded: league.seasonHistory.length,
  };
}
