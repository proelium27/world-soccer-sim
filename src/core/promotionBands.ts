import type { Competition } from "./competitions.js";
import {
  competitionPlayoffFormat, competitionTeamCount, divisionAbove, divisionBelow,
  effectivePromotionSpots,
} from "./competitions.js";
import { PROMOTION_PLAYOFF_SEMI_FINALS } from "./constants.js";

/**
 * Which finishing POSITIONS a division promotes, relegates and plays off for.
 *
 * The table has never said any of this, so a reader had no way to know where
 * the relegation line sits — and it is not a fixed three: it is per link (Spain
 * sends three up from its second tier and four from its third), it depends on
 * the country's playoff format, and the Dutch and Belgian third tiers are
 * closed, so nothing goes down into them at all.
 *
 * This answers in positions rather than clubs deliberately, because that is
 * what a table can shade mid-season: who occupies 18th changes every matchday,
 * that 18th goes down does not. It therefore needs only the neighbouring
 * division's SIZE, never its table, which is what keeps it usable on a page
 * that has computed one division's standings.
 *
 * The arithmetic mirrors `seatField` in promotionPlayoff.ts and the plain
 * slices in `computeCountrySwaps` — including their fallbacks, since a division
 * too short to seat its playoff promotes on the table instead. `bands.test.ts`
 * pins it against what those two actually do, rather than trusting this to
 * stay in step by inspection.
 *
 * One known over-claim, unreachable in the shipped world: a playoff whose
 * entrants are already being moved by an adjacent link's automatic slice is not
 * seated at all (see `promotionPlayoffFields`), which needs a pyramid tight
 * enough for the two ends of a middle division to meet. Bands would still show
 * it. The shipped world's tightest country needs six clubs of a twelve-club
 * second tier before that can happen.
 */
export interface PromotionBands {
  /** 1-based positions promoted on the table alone. */
  promoted: number[];
  /** 1-based positions contesting a playoff for one more promotion place. */
  promotionPlayoff: number[];
  /**
   * The one 1-based position defending its place in a cross-division tie
   * (the German and French formats). Empty otherwise.
   */
  relegationPlayoff: number[];
  /** 1-based positions relegated on the table alone. */
  relegated: number[];
}

const range = (from: number, count: number): number[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => from + i);

export function promotionBands(
  competitions: Competition[],
  comp: Competition,
  tableLength: number,
): PromotionBands {
  const bands: PromotionBands = {
    promoted: [], promotionPlayoff: [], relegationPlayoff: [], relegated: [],
  };

  // Going up: this division is the LOWER half of the link above it.
  const up = divisionAbove(competitions, comp.id);
  if (up) {
    const spots = effectivePromotionSpots(
      competitions, up, comp, competitionTeamCount(up), tableLength,
    );
    if (spots > 0) {
      const format = competitionPlayoffFormat(up, comp);
      const auto = spots - 1;
      const upIndex = competitionTeamCount(up) - spots;
      const size = PROMOTION_PLAYOFF_SEMI_FINALS * 2;
      if (format === "english" && spots >= 2 && tableLength >= auto + size) {
        bands.promoted = range(1, auto);
        bands.promotionPlayoff = range(auto + 1, size);
      } else if (format === "french" && upIndex >= 0 && tableLength >= auto + 3) {
        bands.promoted = range(1, auto);
        bands.promotionPlayoff = range(auto + 1, 3);
      } else if (format === "german" && upIndex >= 0 && auto < tableLength) {
        bands.promoted = range(1, auto);
        bands.promotionPlayoff = [auto + 1];
      } else {
        // No playoff, or a division too short to seat one: the plain top N.
        bands.promoted = range(1, spots);
      }
    }
  }

  // Going down: this division is the UPPER half of the link below it.
  const down = divisionBelow(competitions, comp.id);
  if (down) {
    const spots = effectivePromotionSpots(
      competitions, comp, down, tableLength, competitionTeamCount(down),
    );
    if (spots > 0) {
      const format = competitionPlayoffFormat(comp, down);
      const auto = spots - 1;
      const ownIndex = tableLength - spots;
      const lowerLength = competitionTeamCount(down);
      // Only the German and French formats put a top-flight club in the tie;
      // an English playoff is contested entirely below, so relegation is the
      // plain bottom N. Both conditions are seatField's own.
      const seated = ownIndex >= 0
        && ((format === "french" && lowerLength >= auto + 3)
          || (format === "german" && auto < lowerLength));
      if (seated) {
        bands.relegated = range(tableLength - auto + 1, auto);
        bands.relegationPlayoff = [ownIndex + 1];
      } else {
        bands.relegated = range(tableLength - spots + 1, spots);
      }
    }
  }

  return bands;
}
