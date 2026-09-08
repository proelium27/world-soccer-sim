import { useMemo } from "react";
import type { Player } from "../core/players/types.js";
import { potentialFog, type PotentialFog } from "../core/scouting/potentialFog.js";
import { useLeague } from "./context/LeagueContext.js";

/**
 * The user's view of a player's potential, in one place.
 *
 * Three surfaces need the same answer and each used to work it out for itself:
 * `PotDisplay` (the band, everywhere a POT is shown), `PlayerProfile` (both the
 * per-season band in the ratings table and the *priced* midpoint its value chart
 * must use, or the dollar figure becomes an exact read on a hidden number), and
 * now the player database's POT column, sort and filter. Four copies of "God
 * Mode first, then the user's scouting tenure" is three chances to disagree
 * about what the user is allowed to know.
 *
 * **`sortValue` is the load-bearing addition.** Ordering a table by the *true*
 * potential while displaying a band would leak the hidden number silently — no
 * error, just a ranked list that answers the question the fog exists to keep
 * open. Sorting on the band's midpoint is the honest reading, and the band is
 * deterministic per (pid, season), so the order is stable across renders.
 */
export interface PotentialView {
  /**
   * The band for an arbitrary (potential, season) pair — a historical ratings
   * snapshot, say. Null means show the exact number: fully scouted, or God Mode.
   */
  fogFor(potential: number, pid: number, season: number): PotentialFog | null;
  /** The band for a player's current potential this season; null = exact. */
  fogOf(player: Player): PotentialFog | null;
  /** The estimate as a single number, for pricing, sorting and filtering. */
  midpoint(potential: number, pid: number, season: number): number;
  /** What a POT column sorts and filters on — the estimate, never the truth. */
  sortValue(player: Player): number;
}

export function usePotentialView(): PotentialView {
  const { league } = useLeague();
  const godMode = league?.godMode ?? false;
  const season = league?.season ?? 0;
  const difficulty = league?.difficulty;
  const userTeam = league?.teams.find((t) => t.tid === league.meta.userTid);
  const observed = userTeam?.scoutingObserved;
  const spend = userTeam?.scoutingSpend ?? 0;

  return useMemo(() => {
    // God Mode is a sandbox — no reason to hide information, so show the truth
    // everywhere, exactly as PotDisplay always has.
    const exact = !league || godMode;
    const fogFor = (potential: number, pid: number, at: number): PotentialFog | null => {
      if (exact) return null;
      const fog = potentialFog(potential, pid, at, observed?.[pid] ?? null, spend, difficulty);
      return fog.known ? null : fog;
    };
    const midpoint = (potential: number, pid: number, at: number): number => {
      const fog = fogFor(potential, pid, at);
      // Rounded so it reads as a rating rather than a decimal wherever it is
      // shown, and so ties break the same way on every render.
      return fog ? Math.round((fog.low + fog.high) / 2) : potential;
    };
    return {
      fogFor,
      fogOf: (p) => fogFor(p.potential, p.pid, season),
      midpoint,
      sortValue: (p) => midpoint(p.potential, p.pid, season),
    };
    // `league` is in the deps because a commit replaces the object; the fields
    // pulled off it above are what actually feed the fog.
  }, [league, godMode, season, difficulty, observed, spend]);
}
