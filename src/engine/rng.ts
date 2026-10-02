/** Seeded RNG — mulberry32. Returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  return mulberry32Resumable(seed).next;
}

/**
 * The same mulberry32 stream with its state readable, so it can be stopped and
 * picked up again somewhere else: `mulberry32(r.state())` continues exactly
 * where `r` left off. Its whole state is one 32-bit integer, which is what lets
 * a long sim be split into chunks across the worker boundary and still draw the
 * identical sequence a single call would have (see core/simChunks.ts).
 */
export function mulberry32Resumable(seed: number): { next: () => number; state: () => number } {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state: () => a >>> 0,
  };
}

/** Standard-normal sample via Box-Muller from the seeded stream. */
export function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Deterministically mixes an arbitrary list of integers into a single uint32
 * seed — for deriving independent sub-streams (e.g. a per-player identity
 * rng) from existing identifiers without consuming the caller's rng stream.
 */
export function hashInts(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p + 1), 2654435761);
    h = (h ^ (h >>> 15)) >>> 0;
  }
  return h;
}
