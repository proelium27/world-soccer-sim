/**
 * Rescaling EA overalls onto soccer-gm's rating band.
 *
 * The two scales are not the same animal. A freshly generated soccer-gm world
 * spans roughly 23-81 OVR (tier-1 p50 62, p95 73, max 81) and only ever reaches
 * 90+ through decades of progression; EA FC's top flights run 47-91 with a
 * couple of dozen players at 88+. Importing EA numbers verbatim would lift the
 * whole world ~10 points, which collides with the fragile anti-inflation
 * equilibrium the sim is tuned around (wages are cubic in ovr, the elite
 * valuation premium keys off 76, the division-2 ceiling off 70).
 *
 * So we rank-match instead of hand-fitting a curve: a player at the Nth
 * percentile of the imported set is assigned the OVR at the Nth percentile of a
 * freshly generated reference world. That reproduces soccer-gm's own
 * distribution exactly, with no tuned constants to drift, and is
 * anti-inflationary by construction — the imported world has the same OVR
 * distribution as a generated one, so nothing downstream sees a world it
 * wasn't tuned for.
 *
 * Ties are mapped through their mid-rank, so every player sharing an EA overall
 * gets the same soccer-gm overall (two 85s must not come out 74 and 75).
 */

/** Percentile of `xs` (sorted ascending) at fraction q, linearly interpolated. */
function quantileAt(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.max(0, Math.min(1, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type Rescaler = (eaOverall: number) => number;

/**
 * Build a rank-matching map from the source (EA) overalls onto the reference
 * (generated soccer-gm) overalls. Values outside the observed source range are
 * clamped to the reference extremes rather than extrapolated.
 */
export function buildRescaler(source: number[], reference: number[]): Rescaler {
  if (source.length === 0 || reference.length === 0) {
    return (x) => x;
  }
  const sortedRef = [...reference].sort((a, b) => a - b);
  const sortedSrc = [...source].sort((a, b) => a - b);

  // Mid-rank percentile per distinct source value, so ties map identically.
  const table = new Map<number, number>();
  let i = 0;
  while (i < sortedSrc.length) {
    const v = sortedSrc[i];
    let j = i;
    while (j < sortedSrc.length && sortedSrc[j] === v) j++;
    // Mid-rank of the tie block, as a fraction of the distribution.
    const midRank = (i + j - 1) / 2;
    const q = sortedSrc.length === 1 ? 0.5 : midRank / (sortedSrc.length - 1);
    table.set(v, quantileAt(sortedRef, q));
    i = j;
  }

  const distinct = [...table.keys()].sort((a, b) => a - b);
  const min = distinct[0];
  const max = distinct[distinct.length - 1];

  return (ea: number) => {
    const exact = table.get(ea);
    if (exact !== undefined) return exact;
    if (ea <= min) return table.get(min)!;
    if (ea >= max) return table.get(max)!;
    // Unseen intermediate value (only reachable for `potential`, which shares
    // the overall scale but not necessarily its exact value set): interpolate
    // between the nearest mapped neighbours.
    let lo = min;
    let hi = max;
    for (const d of distinct) {
      if (d <= ea) lo = d;
      if (d >= ea) { hi = d; break; }
    }
    if (lo === hi) return table.get(lo)!;
    const t = (ea - lo) / (hi - lo);
    return table.get(lo)! + (table.get(hi)! - table.get(lo)!) * t;
  };
}
