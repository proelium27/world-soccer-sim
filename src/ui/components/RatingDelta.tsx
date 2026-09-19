import type { Player } from "../../core/players/types.js";

/**
 * Renders a rating value with a colored season-over-season delta, e.g.
 * "67 (+6)" in green or "61 (-2)" in red. Delta is omitted when the player
 * hasn't progressed at least twice (not enough history to diff against).
 */
export function RatingDelta({ value, previous }: { value: number; previous: number | null }) {
  if (previous === null) return <>{value}</>;
  const delta = value - previous;
  if (delta === 0) return <>{value}</>;
  const color = delta > 0 ? "#198754" : "#dc3545";
  return (
    <>
      {value} <span style={{ color }}>({delta > 0 ? "+" : ""}{delta})</span>
    </>
  );
}

/** Ovr/potential from the second-to-last hist entry, or null if not enough history. */
export function previousRatings(p: Player): { ovr: number; potential: number } | null {
  if (p.recentHist.length < 2) return null;
  const prev = p.recentHist[p.recentHist.length - 2];
  return { ovr: prev.ovr, potential: prev.potential };
}
