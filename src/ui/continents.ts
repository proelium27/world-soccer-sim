import type { ContinentalRegion } from "../core/constants.js";
import { competitionRegion, type Competition } from "../core/competitions.js";

/*
 * Grouping the New League screen by continent. World setup and the club picker
 * both list every country the world has, and since the Americas were added that
 * list runs to sixteen — so both split it under a heading per continent.
 *
 * The continent is always the LEAGUE's region (`competitionRegion` /
 * `resolveLeagueSpec`), never a guess from the country's name, so it is the
 * same answer that decides which continental competition the league feeds, and
 * a league the player adds lands wherever its own region says.
 */

/** Display order: the continent a world is built around first. */
export const REGION_ORDER: readonly ContinentalRegion[] = ["europe", "americas"];

export const REGION_LABELS: Readonly<Record<ContinentalRegion, string>> = {
  europe: "Europe",
  americas: "Americas",
};

export interface RegionGroup<T> {
  region: ContinentalRegion;
  items: T[];
}

/**
 * Split `items` by continent, in `REGION_ORDER`, keeping each group in the
 * order the items came in. A continent with nothing in it is left out, so a
 * world with every American league removed shows no empty Americas heading.
 */
export function groupByRegion<T>(
  items: readonly T[],
  regionOf: (item: T) => ContinentalRegion,
): RegionGroup<T>[] {
  return REGION_ORDER
    .map((region) => ({ region, items: items.filter((item) => regionOf(item) === region) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The world's countries by continent, for the club picker. A country's region
 * is read off its first competition — every division of a country is built from
 * one spec, so they cannot disagree.
 */
export function countriesByRegion(
  competitions: readonly Competition[],
  countries: readonly string[],
): RegionGroup<string>[] {
  const regionOf = (country: string): ContinentalRegion => {
    const comp = competitions.find((c) => c.country === country);
    return comp ? competitionRegion(comp) : REGION_ORDER[0];
  };
  return groupByRegion(countries, regionOf);
}
