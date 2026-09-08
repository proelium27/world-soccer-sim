import type { Player, Position } from "../players/types.js";
import { POSITIONS } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import { teamSlots } from "../lineup/formations.js";
import type { PlayedMatch } from "../standings.js";
import type { Competition } from "../competitions.js";
import { computeStandings } from "../standings.js";
import {
  AI_SQUAD_STRENGTH_COUNT,
  AI_AMBITION_W_STRENGTH, AI_AMBITION_W_WEALTH, AI_AMBITION_W_FAME, AI_AMBITION_W_FORM,
  AI_AMBITION_HIGH, AI_AMBITION_LOW, AI_YOUNG_SQUAD_AGE,
  STATURE_STRENGTH_LO, STATURE_STRENGTH_HI, STATURE_W_STRENGTH, STATURE_W_HYPE,
  HYPE_MAX,
} from "../constants.js";

/**
 * A human-readable summary of where a club sits strategically. These labels
 * are derived (not stored) from a club's ambition axis, form, and age
 * profile, purely for UI/debugging/tests — the evaluation math keys off the
 * numeric `ambition`/`frugality` scalars, never the label.
 */
export type StrategicDirection =
  | "Title Contender"
  | "Ambitious"
  | "Midtable Stability"
  | "Rebuilding"
  | "Relegation Battle";

/**
 * Everything the evaluation core needs to know about a club to value players
 * for it — all derived from current league state, so it shifts season to
 * season as a club rises, falls, ages, or spends.
 */
export interface ClubContext {
  tid: number;
  season: number;
  budget: number;
  /** Mean ovr of the club's best AI_SQUAD_STRENGTH_COUNT players. */
  squadStrength: number;
  /** Mean age across the whole roster. */
  squadAvgAge: number;
  /** Roster head-count at each position. */
  posDepth: Record<Position, number>;
  /** Best (highest) ovr the club currently has at each position, 0 if none. */
  posBestOvr: Record<Position, number>;
  /**
   * Second-best ovr at each position, 0 if the club has fewer than two there.
   * Read only by keep-side valuation: to price the club's *own* best player at
   * a position you must ask "how far would we fall back without him", which is
   * the gap to this man — comparing him to himself (posBestOvr) says zero and
   * is what made clubs undervalue their own stars.
   */
  posSecondBestOvr: Record<Position, number>;
  /**
   * The ovr of the weakest man who'd actually START at each position, given the
   * shape the club plays: its 2nd-best centre-back in a back four, its 3rd-best
   * midfielder in a midfield three, its best keeper. 0 when it hasn't the bodies
   * to fill the slots; the club's best when its shape fields none there.
   *
   * Read by BUY-side valuation, and it is the counterpart to posSecondBestOvr on
   * the keep side. Both exist because "how good are they here" is the wrong
   * question in both directions and needs a counterfactual instead: keep-side
   * asks who'd step up if he left, buy-side asks who he'd displace.
   *
   * Measuring a signing against posBestOvr assumed one starter per position, so
   * a club with one excellent centre-back and three poor ones read as stocked —
   * a 60-rated centre-back "downgraded" a 73-rated best and the club neither
   * registered the hole nor valued the man who'd fill it. Formations field two
   * centre-backs and full-backs and two or three midfielders, so that was wrong
   * for most of the pitch: measured, first-division clubs sat on nine-figure
   * budgets starting 16-year-olds at centre-back.
   */
  posWeakestStarterOvr: Record<Position, number>;
  /** Fame/popularity, 0-100, straight off the club. */
  hype: number;
  /**
   * How big this club is in *world* terms, [0,1] — squad quality blended with
   * fame, measured against absolute bands rather than league-relative ones.
   *
   * Deliberately NOT normalized within a competition, unlike ambition and
   * frugality. Those answer "how does this club compare to its rivals", which
   * should be league-scoped. Stature answers "would a world-class player
   * consider this a step up", and that comparison is global: the biggest club
   * in a weak league is still a smaller club than a mid-table side in a strong
   * one. Using absolute bands also keeps it stable season to season instead of
   * drifting with whatever the league's current extremes happen to be.
   */
  stature: number;
  /**
   * Win-now pressure, [0,1]. High for rich, famous, strong, in-form clubs;
   * low for poor, weak, struggling ones. Tilts value toward prime-age
   * readiness (high) or youth/upside (low).
   */
  ambition: number;
  /**
   * Financial caution, [0,1]. High for cash-poor clubs (steep penalty on
   * expensive deals), ~0 for the wealthiest (can absorb mistakes).
   */
  frugality: number;
  /** Derived flavor label — see StrategicDirection. */
  direction: StrategicDirection;
}

/** Min-max normalize a value into [0,1] against a league range; 0.5 if the range is flat. */
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

/** Mean of an array, or 0 when empty. */
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** A club's squad strength: mean ovr of its best AI_SQUAD_STRENGTH_COUNT players. */
function squadStrength(roster: Player[]): number {
  const top = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, AI_SQUAD_STRENGTH_COUNT);
  return mean(top.map((p) => p.ovr));
}

function positionalDepthAndBest(
  roster: Player[],
  slots: readonly Position[],
): {
  depth: Record<Position, number>;
  best: Record<Position, number>;
  secondBest: Record<Position, number>;
  weakestStarter: Record<Position, number>;
} {
  const depth = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  const best = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  const secondBest = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  const byPos = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Position, number[]>;
  for (const p of roster) {
    depth[p.pos]++;
    byPos[p.pos].push(p.ovr);
    if (p.ovr > best[p.pos]) {
      secondBest[p.pos] = best[p.pos];
      best[p.pos] = p.ovr;
    } else if (p.ovr > secondBest[p.pos]) {
      secondBest[p.pos] = p.ovr;
    }
  }

  // How many of each position the club's shape actually fields. A formation is
  // a multiset of slots, so this is just a tally of it.
  const fielded = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  for (const slot of slots) fielded[slot]++;

  const weakestStarter = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  for (const pos of POSITIONS) {
    const n = fielded[pos];
    // A position the shape doesn't field has no starting slot to be weak in, so
    // it keeps the old reading (the club's best) rather than inventing a hole.
    if (n === 0) {
      weakestStarter[pos] = best[pos];
      continue;
    }
    const ranked = [...byPos[pos]].sort((a, b) => b - a);
    // Short of bodies for the slots on offer: one of them is literally empty,
    // which reads as 0 and is the strongest possible signal of a hole.
    weakestStarter[pos] = ranked.length >= n ? ranked[n - 1] : 0;
  }

  return { depth, best, secondBest, weakestStarter };
}

/**
 * A club's world stature, [0,1]: squad quality against an absolute band,
 * blended with fame. See ClubContext.stature for why this one normalization is
 * global rather than per-competition.
 */
function statureOf(strength: number, hype: number): number {
  const strengthNorm = clamp01(
    (strength - STATURE_STRENGTH_LO) / (STATURE_STRENGTH_HI - STATURE_STRENGTH_LO),
  );
  const hypeNorm = clamp01(hype / HYPE_MAX);
  return STATURE_W_STRENGTH * strengthNorm + STATURE_W_HYPE * hypeNorm;
}

/** Clamp into [0,1]. */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * A single club's world stature without deriving every league context — for
 * one-off checks (a single user transfer offer) where building the full
 * league-wide context map would be wasteful. Identical result to the `stature`
 * field on that club's ClubContext.
 */
export function clubStature(roster: Player[], hype: number): number {
  return statureOf(squadStrength(roster), hype);
}

/**
 * Every club's stature in one pass, keyed by tid.
 *
 * Use this instead of calling `clubStature`/`refusesMoveToClub` per player:
 * those rebuild a league-wide player index on each call, so a per-player loop
 * over every club in the world is quadratic (~36M operations on a 240-club
 * save). The transfer pages are INP-sensitive — precompute once, look up per
 * row.
 */
export function clubStatures(teams: StoredTeam[], players: Player[]): Map<number, number> {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const out = new Map<number, number>();
  for (const t of teams) {
    const roster = t.roster
      .map((pid) => byPid.get(pid))
      .filter((p): p is Player => p != null);
    out.set(t.tid, clubStature(roster, t.hype));
  }
  return out;
}

/**
 * Label a club's strategic direction from its ambition, form (league rank,
 * 1 = top), and squad age. Only used for display/tests.
 */
function label(ambition: number, formNorm: number, squadAvgAge: number): StrategicDirection {
  if (ambition >= AI_AMBITION_HIGH) {
    return formNorm >= 0.7 ? "Title Contender" : "Ambitious";
  }
  if (ambition <= AI_AMBITION_LOW) {
    // A struggling club with a young squad is building; an old one is fighting to survive.
    return squadAvgAge <= AI_YOUNG_SQUAD_AGE ? "Rebuilding" : "Relegation Battle";
  }
  return "Midtable Stability";
}

/**
 * Just the league fields the evaluation core reads. A full LeagueStore
 * satisfies this, but the AI transfer market also passes it a forward-looking
 * `season` (e.g. next season, for offseason valuations) that needn't match
 * any stored season.
 */
export interface LeagueSnapshot {
  teams: StoredTeam[];
  players: Player[];
  season: number;
  played: PlayedMatch[];
  competitions: Competition[];
}

/**
 * Derive a ClubContext for every team, computing the league-wide
 * normalizations (strength/wealth/fame/form ranges) once so ambition and
 * frugality are genuinely relative to the rest of the league.
 *
 * Form uses the current standings if any matches have been played this
 * season, otherwise a neutral 0.5 for every club (pre-season, no signal).
 */
export function deriveLeagueContexts(league: LeagueSnapshot): Map<number, ClubContext> {
  const playerById = new Map(league.players.map((p) => [p.pid, p]));
  const rosterOf = (t: StoredTeam): Player[] =>
    t.roster.map((pid) => playerById.get(pid)).filter((p): p is Player => p != null);

  const raw = league.teams.map((t) => {
    const roster = rosterOf(t);
    const { depth, best, secondBest, weakestStarter } =
      positionalDepthAndBest(roster, teamSlots(t));
    return {
      tid: t.tid,
      compId: t.compId,
      budget: t.budget,
      hype: t.hype,
      strength: squadStrength(roster),
      avgAge: mean(roster.map((p) => league.season - p.born)),
      depth,
      best,
      secondBest,
      weakestStarter,
    };
  });

  const contexts = new Map<number, ClubContext>();

  // Every normalization (wealth/hype/strength min-max, form rank) is scoped
  // to the club's own competition: tier 2 is structurally poorer by design
  // (DIVISION_2_BUDGET_SCALE), so pooling every competition into one range
  // would read every tier-2 club as permanently near-max frugality
  // regardless of how it's actually doing relative to its own competition.
  for (const comp of league.competitions) {
    const group = raw.filter((r) => r.compId === comp.id);
    if (group.length === 0) continue;
    const groupTids = group.map((r) => r.tid);
    const groupTidSet = new Set(groupTids);
    const groupPlayed = league.played.filter(
      (m) => groupTidSet.has(m.home) && groupTidSet.has(m.away),
    );

    const hasPlayed = groupPlayed.length > 0;
    const rankByTid = new Map<number, number>();
    if (hasPlayed) {
      // Deliberately NOT passed a points-deduction map, unlike every other
      // table in the game. This one is a *form* proxy feeding the AI's own
      // strength/ambition model, and a financial sanction has not made the
      // club's football any worse — docking it here would quietly make a fined
      // club's players cheaper and the club itself less attractive to join,
      // which is a second-order effect nobody asked for. It would also mean
      // widening LeagueSnapshot, which is kept minimal on purpose. Every table
      // a human reads, and every table that decides something, does take them.
      const groupStandings = computeStandings(groupTids, groupPlayed);
      groupStandings.forEach((row, i) => rankByTid.set(row.tid, i + 1));
    }
    const groupSize = group.length;
    const formNorm = (tid: number): number =>
      hasPlayed
        ? normalize(groupSize - (rankByTid.get(tid) ?? groupSize), 0, groupSize - 1)
        : 0.5;

    const budgets = group.map((r) => r.budget);
    const hypes = group.map((r) => r.hype);
    const strengths = group.map((r) => r.strength);
    const [bMin, bMax] = [Math.min(...budgets), Math.max(...budgets)];
    const [hMin, hMax] = [Math.min(...hypes), Math.max(...hypes)];
    const [sMin, sMax] = [Math.min(...strengths), Math.max(...strengths)];

    for (const r of group) {
      const wealthNorm = normalize(r.budget, bMin, bMax);
      const fameNorm = normalize(r.hype, hMin, hMax);
      const strengthNorm = normalize(r.strength, sMin, sMax);
      const form = formNorm(r.tid);

      const ambition =
        AI_AMBITION_W_STRENGTH * strengthNorm +
        AI_AMBITION_W_WEALTH * wealthNorm +
        AI_AMBITION_W_FAME * fameNorm +
        AI_AMBITION_W_FORM * form;

      // Frugality is the inverse of relative wealth: the poorest club in the
      // division is maximally cautious, the richest barely constrained.
      const frugality = 1 - wealthNorm;

      contexts.set(r.tid, {
        tid: r.tid,
        season: league.season,
        budget: r.budget,
        squadStrength: r.strength,
        squadAvgAge: r.avgAge,
        posDepth: r.depth,
        posBestOvr: r.best,
        posSecondBestOvr: r.secondBest,
        posWeakestStarterOvr: r.weakestStarter,
        hype: r.hype,
        stature: statureOf(r.strength, r.hype),
        ambition,
        frugality,
        direction: label(ambition, form, r.avgAge),
      });
    }
  }

  return contexts;
}
