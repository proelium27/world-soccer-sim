import type { Competition } from "./competitions.js";
import type { CupState } from "./cup/types.js";
import { coefficientSlots } from "./cup/coefficients.js";
import { cupSlotsForCompetition, continentalSlotOverrides } from "./cup/qualification.js";
import type { ContinentalFormats } from "./cup/cupShape.js";
import { CONTINENTAL_CUP_FORMAT } from "./constants.js";

/**
 * A country gaining or losing Continental Cup places, as a News Feed row.
 *
 * **Derived, never persisted as a `NewsEvent`** — the same rule `awardNews.ts`
 * follows, and for the same reason: an accomplishment is written down at sim
 * time only because it *can't* be worked out afterwards. This can. The whole
 * allocation is a function of the archived cups a save already keeps (see
 * cup/coefficients.ts), so deriving it costs nothing in save size, cannot drift
 * from the number the Cup page shows, and means an existing save reports every
 * place it has ever won or lost the moment this ships rather than only the
 * seasons played after it.
 *
 * It also sidesteps a shape problem. A `NewsEvent` is keyed by `pid` and `tid`,
 * and this is news about a *country*: no player did it, and no single club did
 * either. Filing it under an arbitrary club to satisfy the type would be a lie
 * the feed then repeats.
 */
export interface ContinentalNews {
  country: string;
  /** The country's top-flight competition, so the feed can file it under a league. */
  compId: number;
  /** Places before and after; `to > from` is a gain. */
  from: number;
  to: number;
}

/** Cup places per tier-1 competition for a given season, coefficients applied. */
function allocationFor(
  competitions: Competition[],
  teams: readonly { tid: number; compId: number }[],
  histories: readonly CupState[][],
  season: number,
  enabled: boolean,
  formats: ContinentalFormats | undefined,
): Map<number, number> {
  // Through the same combiner the offseason and the Standings projection use,
  // so a resized competition's news reports the places it actually awards.
  const overrides = continentalSlotOverrides(
    competitions,
    formats,
    coefficientSlots(competitions, teams, histories, season, enabled),
  );
  const out = new Map<number, number>();
  for (const comp of competitions) {
    if (comp.tier !== 1) continue;
    out.set(comp.id, cupSlotsForCompetition(comp, CONTINENTAL_CUP_FORMAT, overrides ?? undefined));
  }
  return out;
}

/**
 * Which countries' Cup allocations changed as a result of `season` — that is,
 * the difference between the places they had for `season` and the places they
 * have earned for the season after it.
 *
 * Sorted biggest movers first, then by country, so a feed row order is stable.
 */
export function seasonContinentalNews(
  competitions: Competition[],
  teams: readonly { tid: number; compId: number }[],
  histories: readonly CupState[][],
  season: number,
  enabled: boolean,
  /** The save's continental formats, for their size settings. Absent = every competition at its natural size. */
  formats?: ContinentalFormats,
): ContinentalNews[] {
  // A save with the setting off never reallocates, so there is never anything
  // to report — and the two allocations below would be equal anyway. Bailing
  // here says so plainly rather than leaving it to arithmetic.
  if (!enabled) return [];
  // Nothing to report before a world has any continental history: both sides of
  // the comparison fall back to the shipped allocation and are equal anyway,
  // but bailing early saves walking the archive twice on every render.
  if (season < 1) return [];

  const before = allocationFor(competitions, teams, histories, season, enabled, formats);
  const after = allocationFor(competitions, teams, histories, season + 1, enabled, formats);

  const out: ContinentalNews[] = [];
  for (const comp of competitions) {
    if (comp.tier !== 1) continue;
    const from = before.get(comp.id);
    const to = after.get(comp.id);
    if (from === undefined || to === undefined || from === to) continue;
    out.push({ country: comp.country, compId: comp.id, from, to });
  }
  return out.sort(
    (a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.country.localeCompare(b.country),
  );
}

/**
 * How far the news travels. Every one of these is world news.
 *
 * The relevance tiers exist because the world is hundreds of clubs and a feed
 * that reports all of them equally is mostly noise — but that argument is about
 * VOLUME, and it does not apply here. A place changes hands a fraction of a
 * time per season across the entire world (measured over 20 seasons: 7 seasons
 * with any movement at all on one seed, 2 on another), and when it does it
 * restructures the competition every club in the world plays in. Tiering it
 * down to "only if it's your league" would hide the single most consequential
 * thing that happens between seasons.
 */
export function continentalNewsScope(_news: ContinentalNews): "world" | "league" {
  return "world";
}
