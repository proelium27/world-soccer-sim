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
 * **`ceiling` is the load-bearing addition.** Ordering a table by the *true*
 * potential while displaying a band leaks the hidden number silently — no
 * error, just a ranked list that answers the question the fog exists to keep
 * open. Every POT sort and filter in the game goes through it, so the rule is
 * one line: **sort by a number the reader can see.** The band is deterministic
 * per (pid, season), so the order is stable across renders.
 */
export interface PotentialView {
  /**
   * The band for an arbitrary (potential, season) pair — a historical ratings
   * snapshot, say. Null means show the exact number: fully scouted, or God Mode.
   */
  fogFor(potential: number, pid: number, season: number): PotentialFog | null;
  /** The band for a player's current potential this season; null = exact. */
  fogOf(player: Player): PotentialFog | null;
  /**
   * The estimate as a single number, for **pricing**: the middle of the band,
   * which is the expected value. Not what a column sorts on — see `ceiling`.
   */
  midpoint(potential: number, pid: number, season: number): number;
  /**
   * What a POT column sorts and filters on: the **top** of the band, or the
   * exact value once it is known.
   *
   * The top rather than the middle for one reason — it is the number on screen.
   * The cell reads "70–86", so a reader tracking the right-hand number down a
   * column sees it descend and the order explains itself; sorting on a midpoint
   * nobody can see leaves a column that looks unsorted. Measured, it costs
   * nothing in ordering where every row is equally scouted (the band is
   * `potential + shift ± a half-width that is the same for everyone`, so top,
   * middle and bottom are the same sort shifted by a constant).
   *
   * Where tenure differs it does reorder, and honestly: an unscouted player
   * gains ~6 rating points on a scouted one, because he genuinely might be that
   * good and the cell says so.
   */
  ceiling(player: Player): number;
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
      ceiling: (p) => fogFor(p.potential, p.pid, season)?.high ?? p.potential,
    };
    // `league` is in the deps because a commit replaces the object; the fields
    // pulled off it above are what actually feed the fog.
  }, [league, godMode, season, difficulty, observed, spend]);
}
