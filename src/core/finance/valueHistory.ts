import type { Player, RatingsSnapshot } from "../players/types.js";
import { trueTransferValue } from "./valuation.js";

export interface ValueHistoryPoint {
  /** The season the player *played* with these ratings (see the season-offset note below). */
  season: number;
  /** Estimated market value he carried into that season. */
  value: number;
  ovr: number;
  /** The potential the value was computed from — fogged if the caller passed a perceived one. */
  potential: number;
}

/**
 * A player's career market value, one point per season, reconstructed from
 * `player.hist` — no stored value history and therefore no schema change, so
 * an existing save charts its whole past the moment this ships.
 *
 * Two things worth knowing about how it's derived:
 *
 * **Season offset.** A `RatingsSnapshot` is stamped at the *end* of a season
 * (progression pushes it), so the snapshot labelled season N holds the ratings
 * the player actually carried through season N+1 — the same convention
 * `awards.ts` reads with `hist.find(h => h.season === season - 1)`, and the one
 * the Player Profile's history table spells out in its footnote. We plot each
 * snapshot at `season + 1`, the season it was in force, which also makes the
 * final point exactly the player's value today.
 *
 * **Contract term is held flat.** `trueTransferValue` prices in remaining
 * contract years, but past contracts aren't stored — only the current one. So
 * every point is priced with the player's *present* years-remaining, which
 * makes the contract term a single constant multiplier across the whole chart:
 * the shape stays a pure read on ability, age and potential, and the last point
 * still matches the value quoted in the market today. A retroactive guess at
 * old contract lengths would distort the curve for no gain.
 *
 * `perceivedPotential` lets the UI feed in the user's *fogged* view of
 * potential, so the chart can't be used to back out a hidden exact value.
 *
 * Note the snapshot's `academy` flag is deliberately *not* carried through.
 * Unlike the ratings it sits next to, it describes the season it was stamped in
 * — progression reads whether he was in the academy during the season that just
 * ended — so shifting it forward with the ratings would label a promoted
 * youngster's first senior year as an academy one. Callers resolve it per
 * played season instead.
 */
export function careerValueHistory(
  player: Player,
  /** His WHOLE ratings history (`loadCareer`), not the resident window. */
  hist: readonly RatingsSnapshot[],
  currentSeason: number,
  perceivedPotential: (snap: RatingsSnapshot) => number = (snap) => snap.potential,
): ValueHistoryPoint[] {
  const yearsRemaining = Math.max(0, player.contract.expiresSeason - currentSeason);

  return [...hist]
    .sort((a, b) => a.season - b.season)
    .map((snap) => {
      const season = snap.season + 1;
      const potential = perceivedPotential(snap);
      // trueTransferValue reads ovr / potential / born / contract.expiresSeason.
      // Re-anchoring expiresSeason on each point is what holds years-remaining
      // (and so the contract multiplier) constant across the career.
      const asOf: Player = {
        ...player,
        ovr: snap.ovr,
        potential,
        contract: { ...player.contract, expiresSeason: season + yearsRemaining },
      };
      return {
        season,
        value: Math.round(trueTransferValue(asOf, season)),
        ovr: snap.ovr,
        potential,
      };
    });
}

/** The career-high point, or null for an empty history. Ties resolve to the earliest season. */
export function peakValue(points: ValueHistoryPoint[]): ValueHistoryPoint | null {
  let best: ValueHistoryPoint | null = null;
  for (const p of points) {
    if (best === null || p.value > best.value) best = p;
  }
  return best;
}
