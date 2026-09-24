/**
 * The opening value of club reputation (docs/club-reputation.md, Stage 2).
 *
 * A seed, not a reconstruction of history: each club starts on the finish
 * score it would earn by finishing where its squad ranks in its division. That
 * puts the seed on the same scale as the yearly target in reputation.ts, so the
 * first offseason moves clubs only by what they actually did rather than by a
 * gap between two different scales.
 *
 * Separate from reputation.ts because it needs `squadStrength` from
 * ai/clubContext.ts, which in turn reads reputation.ts.
 */
import type { Player } from "../players/types.js";
import type { Competition } from "../competitions.js";
import type { StoredTeam } from "./clubs.js";
import { squadStrength } from "../ai/clubContext.js";
import { finishScore } from "./reputation.js";

/**
 * Give every team without a `reputation` its seed. With `force`, every team is
 * reseeded (a roster import replaces the squads the first seed was read off).
 * Teams that already carry a value are returned by reference.
 */
export function seedReputations(
  teams: StoredTeam[],
  competitions: Competition[],
  players: Player[],
  force = false,
): StoredTeam[] {
  if (!force && teams.every((t) => t.reputation !== undefined)) return teams;
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const strength = new Map<number, number>();
  for (const t of teams) {
    const roster = t.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
    strength.set(t.tid, squadStrength(roster));
  }
  const seed = new Map<number, number>();
  for (const comp of competitions) {
    // Strongest first; ties by tid so the seed is order-free.
    const group = teams
      .filter((t) => t.compId === comp.id)
      .sort((a, b) => (strength.get(b.tid)! - strength.get(a.tid)!) || a.tid - b.tid);
    group.forEach((t, i) => seed.set(t.tid, finishScore(comp, i + 1, group.length)));
  }
  return teams.map((t) => {
    if (!force && t.reputation !== undefined) return t;
    const value = seed.get(t.tid);
    return value === undefined ? t : { ...t, reputation: value };
  });
}
