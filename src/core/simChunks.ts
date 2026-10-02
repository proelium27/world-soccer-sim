import type { SimThrough } from "./simThrough.js";

/**
 * How many matchdays one worker round trip plays when a sim is split.
 *
 * **Why a long sim is split at all: memory, on phones.** The worker returns the
 * new matches with their full box scores (~21 KB each, ~280 a matchday on the
 * shipped world), and the main thread only drops them from memory once they
 * are saved (`elideWrittenDetail`). So one "sim to end of season" held a whole
 * season of box scores in the worker, then again in the clone it sent back,
 * before anything could be let go. Measured in headless Chrome on the shipped
 * world: **1.4 GB of JS heap** (822 MB page + 1,023 MB worker at their peaks),
 * against a single-game sim's ~200 MB. Phones kill the tab long before that,
 * and the mobile funnel showed it: a third of new mobile leagues never got a
 * sim to finish. Split, each round trip carries only this many matchdays, and
 * each is saved and elided before the next starts.
 *
 * The cost is one extra save and clone per chunk, so this is a trade: smaller
 * is a lower peak and a slower season. Four keeps the in-flight box scores near
 * a single-game sim's (see docs/ledger/save-size-and-storage.md).
 */
export const SIM_CHUNK_MATCHDAYS = 4;

/**
 * The worker calls a sim is made of, in order: zero or more intermediate
 * `{ matchday }` stops, then the user's own `through` unchanged.
 *
 * Ending on the original target is what keeps a split sim's END identical to
 * an unsplit one — whatever `"season"` does once the schedule runs out happens
 * in the last call, exactly as before. The intermediate stops only ever cut
 * BETWEEN matchdays the sim was going to play anyway, and the rng stream and
 * the batch's starting matchday are carried across them (see the worker's
 * `rngState` / `batchStartMatchday`), so the matches are identical too;
 * `test/core/simChunks.test.ts` holds that to deep equality.
 *
 * `"game"` is a single matchday and is never split.
 */
export function simChunkTargets(
  schedule: readonly { matchday: number }[],
  through: SimThrough,
  size: number = SIM_CHUNK_MATCHDAYS,
): SimThrough[] {
  if (through === "game" || schedule.length === 0) return [through];
  // Mirrors simThrough's own reading of the target ("season" plays to 38).
  const target = through === "season" ? 38 : Math.floor(through.matchday);
  if (!Number.isFinite(target)) return [through];
  const matchdays = [...new Set(schedule.map((g) => g.matchday))]
    .filter((m) => m <= target)
    .sort((a, b) => a - b);
  const stops: SimThrough[] = [];
  for (let i = size - 1; i < matchdays.length - 1; i += size) {
    stops.push({ matchday: matchdays[i] });
  }
  return [...stops, through];
}

/** How many matchdays a sim to `through` will play, for the overlay's progress bar. */
export function simMatchdayCount(
  schedule: readonly { matchday: number }[],
  through: SimThrough,
): number {
  if (schedule.length === 0) return 0;
  if (through === "game") return 1;
  const target = through === "season" ? 38 : Math.floor(through.matchday);
  return new Set(schedule.map((g) => g.matchday).filter((m) => m <= target)).size;
}
