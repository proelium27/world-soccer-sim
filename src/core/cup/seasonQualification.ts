import type { LeagueStore } from "../leagueState.js";
import type { StandingsRow } from "../standings.js";
import { computeStandings } from "../standings.js";
import type { CupCompetitionId } from "../constants.js";
import type { QualificationRoute, QualificationContext } from "./qualification.js";
import { qualificationByTid, domesticCupWinners } from "./qualification.js";
import { coefficientSlots } from "./coefficients.js";
import { pointsDeductionMap } from "../finance/debt.js";

/**
 * Who qualified for what, off one season's league tables — the answer the
 * Standings page shades its rows with.
 *
 * It is computed rather than read off a stored field because there is nothing
 * to read: qualification is decided at the offseason, so mid-season there is no
 * answer yet, only the one the table currently implies. That makes this the
 * live projection, and it moves as the season does — including when a domestic
 * cup final lands and hands a mid-table club a Shield place he did not have the
 * week before.
 *
 * A club's shading therefore means "this is where you would go if the season
 * ended now", which is what a qualification zone has always meant.
 */
export interface SeasonQualification {
  byTid: Map<number, { competition: CupCompetitionId; route: QualificationRoute }>;
  /** Whether every route feeding this projection has actually been decided. */
  settled: boolean;
}

/** Tables for every competition in a season, keyed by compId. */
function tablesForCurrentSeason(league: LeagueStore): Map<number, StandingsRow[]> {
  // One pass over the season's matches rather than a filter per competition:
  // a full world plays ~6,000 league matches a season and this runs on render.
  const compOfTid = new Map(league.teams.map((t) => [t.tid, t.compId]));
  const matchesByComp = new Map<number, typeof league.played>();
  for (const m of league.played) {
    const compId = compOfTid.get(m.home);
    if (compId === undefined) continue;
    const bucket = matchesByComp.get(compId);
    if (bucket) bucket.push(m);
    else matchesByComp.set(compId, [m]);
  }
  const deductions = pointsDeductionMap(league.debtSanctions, league.season);
  const tables = new Map<number, StandingsRow[]>();
  for (const comp of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    tables.set(comp.id, computeStandings(
      tids, matchesByComp.get(comp.id) ?? [], deductions,
    ));
  }
  return tables;
}

/**
 * Tables for a completed season, rebuilt from its history entry.
 *
 * Split by the entry's own `compsByTid` snapshot rather than each club's
 * current competition, or a promotion since would file a club's season under a
 * division he wasn't in — the same rule every other historical surface follows.
 */
function tablesForPastSeason(league: LeagueStore, season: number): Map<number, StandingsRow[]> | null {
  const entry = league.seasonHistory.find((h) => h.season === season);
  if (!entry) return null;
  const tables = new Map<number, StandingsRow[]>();
  for (const row of entry.table) {
    const compId = entry.compsByTid[row.tid];
    if (compId === undefined) continue;
    const bucket = tables.get(compId);
    if (bucket) bucket.push(row);
    else tables.set(compId, [row]);
  }
  return tables;
}

/**
 * The season's finished cups, as qualification routes into the season after it,
 * plus that season's coefficient-based slot allocation.
 *
 * The coefficient window ends with `season`, because the places being worked
 * out here are the ones for `season + 1`. A competition counts toward it only
 * once it has a champion: a half-played cup would have the shading drift every
 * few matchdays on partial results, where waiting means it moves once, when the
 * final is played, exactly like the domestic cup route beside it.
 */
function routesFor(league: LeagueStore, season: number, current: boolean): QualificationContext {
  const cup = current ? league.cup : league.cupHistory.find((c) => c.season === season);
  const shield = current ? league.shield : (league.shieldHistory ?? []).find((c) => c.season === season);
  const domestic = current
    ? (league.domesticCups ?? [])
    : (league.domesticCupHistory ?? []).filter((c) => c.season === season);
  const live = [league.cup, league.shield].filter(
    (c): c is NonNullable<typeof c> => !!c && c.championTid !== null,
  );
  return {
    domesticCupWinners: domesticCupWinners(domestic),
    holders: {
      continental: cup?.championTid ?? undefined,
      shield: shield?.championTid ?? undefined,
    },
    slots: coefficientSlots(
      league.competitions,
      league.teams,
      [league.cupHistory ?? [], league.shieldHistory ?? [], live],
      season + 1,
      league.rollingCoefficients ?? true,
    ) ?? undefined,
  };
}

/**
 * The qualification places a season's tables currently award. `season` is the
 * season being viewed; pass "current" for the one in progress.
 */
export function seasonQualification(
  league: LeagueStore,
  season: number | "current",
): SeasonQualification {
  const current = season === "current";
  const tables = current
    ? tablesForCurrentSeason(league)
    : tablesForPastSeason(league, season as number);
  if (!tables) return { byTid: new Map(), settled: false };

  const routes = routesFor(league, current ? league.season : (season as number), current);
  // Every country's domestic cup decided, and the continental competitions too
  // — until then a mid-table club's Shield place may still be coming.
  const countries = new Set(league.competitions.map((c) => c.country));
  const settled = (routes.domesticCupWinners?.size ?? 0) >= countries.size;
  return { byTid: qualificationByTid(league.competitions, tables, routes), settled };
}
