import { compareStandingsRows } from "../standings.js";
import type { LeagueStore } from "../leagueState.js";

/**
 * How many trebles each club has won, keyed by tid.
 *
 * A treble is a tier-1 league title, the Continental Cup and a domestic cup in
 * the **same** season. That "same season" is the whole difficulty: no running
 * total of the three trophies can answer it, so this collects the seasons each
 * was won in and intersects them.
 *
 * Shared because three surfaces ask this question now (the Frivolities trophy
 * cabinet, the GOAT club board, and `clubHistory`'s per-club page) and a club
 * page disagreeing with a leaderboard about the same season reads as a bug.
 * `clubHistory` still derives it separately, for one club off its own
 * per-season walk, because calling it per club would be quadratic over a long
 * dynasty; `frivolities.test.ts` pins the two together.
 */
export function trebleCountByTid(league: LeagueStore): Map<number, number> {
  const tierByCompId = new Map(league.competitions.map((c) => [c.id, c.tier]));

  const tier1Titles = new Map<number, Set<number>>();
  const continentalWins = new Map<number, Set<number>>();
  const domesticWins = new Map<number, Set<number>>();
  const markWin = (into: Map<number, Set<number>>, tid: number, season: number): void => {
    let seasons = into.get(tid);
    if (!seasons) { seasons = new Set(); into.set(tid, seasons); }
    seasons.add(season);
  };

  for (const h of league.seasonHistory) {
    // Grouped per competition, because `championTidByCompId` covers tier 1 only
    // and the winner of each table is whoever tops it on the standings order.
    const byComp = new Map<number, typeof h.table>();
    for (const row of h.table) {
      if (row.played <= 0) continue;
      const compId = h.compsByTid?.[row.tid] ?? 0;
      const list = byComp.get(compId);
      if (list) list.push(row); else byComp.set(compId, [row]);
    }

    for (const [compId, table] of byComp) {
      if ((tierByCompId.get(compId) ?? 1) !== 1) continue;
      // The recorded champion where there is one — a title playoff can crown a
      // club that did not top the table — else the table leader.
      const recorded = h.championTidByCompId?.[compId];
      const winner = recorded ?? [...table].sort(
        compareStandingsRows,
      )[0]?.tid;
      if (winner !== undefined) markWin(tier1Titles, winner, h.season);
    }
  }

  // A club's continental leg is its own continent's top competition, so an
  // Americas Cup counts where a Continental Cup would. The two fields never
  // share a club, so the same season cannot be counted twice.
  for (const cup of [...(league.cupHistory ?? []), ...(league.americasCupHistory ?? [])]) {
    if (cup.championTid != null) markWin(continentalWins, cup.championTid, cup.season);
  }
  for (const cup of league.domesticCupHistory ?? []) {
    if (cup.championTid != null) markWin(domesticWins, cup.championTid, cup.season);
  }

  const out = new Map<number, number>();
  for (const [tid, titles] of tier1Titles) {
    const continental = continentalWins.get(tid);
    const domestic = domesticWins.get(tid);
    if (!continental || !domestic) continue;
    const count = [...titles].filter((s) => continental.has(s) && domestic.has(s)).length;
    if (count > 0) out.set(tid, count);
  }
  return out;
}
