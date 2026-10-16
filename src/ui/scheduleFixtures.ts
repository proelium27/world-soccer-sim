/**
 * The fixture lists behind the Schedule page: the user's own club across every
 * competition it plays in, or one whole competition (a league, a continental
 * cup, a domestic cup) a matchday at a time.
 *
 * Pure and free of React so the four shapes a continental cup stores a match in
 * can be tested without mounting the page. Every list is built off a match
 * filter, which is all that separates "my club" from "this competition".
 */
import type { LeagueStore } from "../core/leagueState.js";
import type { CupState } from "../core/cup/types.js";
import { cupRoundName, koRoundsOf, koLegMatchdays, openingStageName } from "../core/cup/cup.js";
import type { CupCompetitionId } from "../core/constants.js";
import type { DomesticCupState } from "../core/domesticCup/types.js";
import { domesticRoundName } from "../core/domesticCup/cup.js";

export interface FixtureRow {
  matchday: number;
  home: number;
  away: number;
  result: { homeGoals: number; awayGoals: number; possessionHome: number } | null;
  /** Index into league.played for the box-score link (league games only). */
  playedIndex: number | null;
  /**
   * "league" fixtures link to their box score; "cup" and "domestic" fixtures
   * link to their own cup page. Doubles as the live viewer's candidate key, so
   * a Watch button can say which of a club's two matches that day it means.
   */
  kind: "league" | "cup" | "domestic";
  /**
   * Continental rows only: which of the continental competitions it is.
   * "domestic" rows don't carry it, since a country has exactly one cup.
   */
  competition?: CupCompetitionId;
  /** Cup rows only: the stage label, e.g. "League phase" or "Quarter-final (1st leg)". */
  label?: string;
}

/** What the Schedule page is showing. */
export type FixtureSource =
  | { kind: "club"; tid: number }
  | { kind: "league"; compId: number }
  | { kind: "continental"; competition: CupCompetitionId }
  | { kind: "domestic"; country: string };

type Keep = (home: number, away: number) => boolean;

/** One domestic cup's fixtures that pass `keep`, played and drawn-but-unplayed alike. */
function domesticRows(cup: DomesticCupState, keep: Keep): FixtureRow[] {
  const rows: FixtureRow[] = [];
  for (const round of cup.rounds) {
    const label = domesticRoundName(cup, round.round);
    if (round.ties.length > 0) {
      for (const t of round.ties) {
        if (!keep(t.home, t.away)) continue;
        rows.push({
          matchday: round.matchday, home: t.home, away: t.away,
          result: { homeGoals: t.homeGoals, awayGoals: t.awayGoals, possessionHome: 0 },
          playedIndex: null, kind: "domestic", label,
        });
      }
      continue;
    }
    // Drawn but not yet played: the next opponent is known in advance, which
    // is half the point of a cup draw.
    for (const p of round.pairings) {
      if (!keep(p.home, p.away)) continue;
      rows.push({
        matchday: round.matchday, home: p.home, away: p.away,
        result: null, playedIndex: null, kind: "domestic", label,
      });
    }
  }
  return rows;
}

/**
 * One continental competition's fixtures that pass `keep`: league phase,
 * playoff and knockout legs. A knockout round only shows once it is drawn,
 * which for the rounds after the first is when the round before it is played.
 */
function cupRows(cup: CupState | null, keep: Keep): FixtureRow[] {
  if (!cup) return [];
  const competition = cup.competition;
  const rows: FixtureRow[] = [];
  const push = (
    matchday: number,
    home: number,
    away: number,
    score: { homeGoals: number; awayGoals: number } | null,
    label: string,
  ): void => {
    rows.push({
      matchday, home, away,
      result: score ? { ...score, possessionHome: 0.5 } : null,
      playedIndex: null, kind: "cup", competition, label,
    });
  };

  // League phase.
  for (const m of cup.leaguePhase?.matches ?? []) {
    if (!keep(m.home, m.away)) continue;
    push(m.matchday, m.home, m.away, m.played ? { homeGoals: m.homeGoals, awayGoals: m.awayGoals } : null, openingStageName(cup));
  }

  // Single-leg playoff (Swiss): played ties once resolved, else the known pairings.
  if (cup.playoff) {
    const po = cup.playoff;
    const poName = cup.shape?.opening === "knockout" ? "Preliminary round" : "Playoff";
    if (po.ties.length > 0) {
      for (const t of po.ties) {
        if (keep(t.home, t.away)) push(po.matchday, t.home, t.away, { homeGoals: t.homeGoals, awayGoals: t.awayGoals }, poName);
      }
    } else {
      for (let i = 0; i + 1 < po.teams.length; i += 2) {
        if (keep(po.teams[i], po.teams[i + 1])) push(po.matchday, po.teams[i], po.teams[i + 1], null, poName);
      }
    }
  }

  const legMds = koLegMatchdays(cup);
  const roundName = (round: number): string => cupRoundName(round, koRoundsOf(cup));

  // Completed knockout ties. Two-legged ties show one row per leg (the second
  // leg with the host order swapped); single-leg ties show one row.
  for (const t of cup.ties) {
    if (!keep(t.home, t.away)) continue;
    if (t.legs && t.legs.length === 2) {
      push(legMds[t.round][0], t.home, t.away, { homeGoals: t.legs[0].homeGoals, awayGoals: t.legs[0].awayGoals }, `${roundName(t.round)} (1st leg)`);
      push(legMds[t.round][1], t.away, t.home, { homeGoals: t.legs[1].awayGoals, awayGoals: t.legs[1].homeGoals }, `${roundName(t.round)} (2nd leg)`);
    } else {
      push(t.matchday, t.home, t.away, { homeGoals: t.homeGoals, awayGoals: t.awayGoals }, roundName(t.round));
    }
  }

  // A two-legged round in progress: first leg played, second leg still to come.
  for (const l of cup.koLegs ?? []) {
    if (!keep(l.home, l.away)) continue;
    push(legMds[l.round][0], l.home, l.away, { homeGoals: l.homeGoals, awayGoals: l.awayGoals }, `${roundName(l.round)} (1st leg)`);
    push(legMds[l.round][1], l.away, l.home, null, `${roundName(l.round)} (2nd leg)`);
  }

  return rows;
}

/** League games (played and still to play) that pass `keep`. */
function leagueRows(league: LeagueStore, keep: Keep): FixtureRow[] {
  const rows: FixtureRow[] = [];
  league.played.forEach((m, mi) => {
    if (!keep(m.home, m.away)) return;
    rows.push({
      matchday: m.matchday, home: m.home, away: m.away,
      result: { homeGoals: m.homeGoals, awayGoals: m.awayGoals, possessionHome: m.possessionHome },
      playedIndex: mi, kind: "league",
    });
  });
  for (const g of league.schedule) {
    if (!keep(g.home, g.away)) continue;
    rows.push({
      matchday: g.matchday, home: g.home, away: g.away,
      result: null, playedIndex: null, kind: "league",
    });
  }
  return rows;
}

export function continentalCupOf(league: LeagueStore, competition: CupCompetitionId): CupState | null {
  return competition === "shield" ? league.shield
    : competition === "americas" ? league.americasCup ?? null
      : league.cup;
}

/**
 * Every fixture `source` covers this season, in matchday order. Within a
 * matchday a cup tie comes before the league game, the order the engine plays
 * them in.
 */
export function fixturesFor(league: LeagueStore, source: FixtureSource): FixtureRow[] {
  let rows: FixtureRow[];
  switch (source.kind) {
    case "club": {
      const mine: Keep = (h, a) => h === source.tid || a === source.tid;
      rows = [
        ...leagueRows(league, mine),
        ...cupRows(league.cup, mine),
        ...cupRows(league.shield, mine),
        ...cupRows(league.americasCup ?? null, mine),
        ...(league.domesticCups ?? []).flatMap((c) => domesticRows(c, mine)),
      ];
      break;
    }
    case "league": {
      const inComp = new Set(league.teams.filter((t) => t.compId === source.compId).map((t) => t.tid));
      rows = leagueRows(league, (h) => inComp.has(h));
      break;
    }
    case "continental":
      rows = cupRows(continentalCupOf(league, source.competition), () => true);
      break;
    case "domestic": {
      const cup = (league.domesticCups ?? []).find((c) => c.country === source.country);
      rows = cup ? domesticRows(cup, () => true) : [];
      break;
    }
  }
  const order = { cup: 0, domestic: 1, league: 2 } as const;
  return rows.sort((a, b) => a.matchday - b.matchday || order[a.kind] - order[b.kind]);
}

/**
 * The matchday the next sim plays, or null when there is nothing left to play
 * on a matchday (the offseason, or the season's playoffs).
 */
export function currentMatchdayOf(league: LeagueStore): number | null {
  if (league.phase !== "regular" || league.schedule.length === 0) return null;
  return Math.min(...league.schedule.map((g) => g.matchday));
}

/** What a fixture row lets you do from the Schedule page. */
export type FixtureAction =
  /** Played and a league game: its box score, and watching it back. */
  | { kind: "replay"; playedIndex: number }
  /** Played cup tie: its cup page has the result. */
  | { kind: "cupPage" }
  /** On the matchday about to be played: play it and watch this match. */
  | { kind: "watch" }
  /** Further ahead: play everything before it, then stop. */
  | { kind: "simTo"; throughMatchday: number }
  | { kind: "none" };

export function fixtureAction(row: FixtureRow, currentMatchday: number | null): FixtureAction {
  if (row.result) {
    return row.kind === "league" && row.playedIndex !== null
      ? { kind: "replay", playedIndex: row.playedIndex }
      : { kind: "cupPage" };
  }
  if (currentMatchday === null) return { kind: "none" };
  if (row.matchday === currentMatchday) return { kind: "watch" };
  if (row.matchday > currentMatchday) return { kind: "simTo", throughMatchday: row.matchday - 1 };
  return { kind: "none" };
}

/** The cup page a cup row links to. */
export function cupPagePath(row: FixtureRow): string {
  if (row.kind === "domestic") return "/domestic-cup";
  return row.competition === "shield" ? "/shield"
    : row.competition === "americas" ? "/americas-cup" : "/cup";
}

/** The matchday a competition view should open on: the next one to be played, else its last. */
export function openingMatchday(rows: FixtureRow[], currentMatchday: number | null): number | null {
  if (rows.length === 0) return null;
  const mds = [...new Set(rows.map((r) => r.matchday))];
  if (currentMatchday !== null) {
    const ahead = mds.filter((md) => md >= currentMatchday);
    if (ahead.length > 0) return Math.min(...ahead);
  }
  return Math.max(...mds);
}
