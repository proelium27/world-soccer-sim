import { competitionRegion, type Competition } from "./competitions.js";
import type { ContinentalRegion } from "./constants.js";

/** Whether a club plays on `region`'s continent, given the set of clubs in the Americas. */
export function inRegion(tid: number, region: ContinentalRegion, americas: ReadonlySet<number>): boolean {
  return americas.has(tid) === (region === "americas");
}

/**
 * The continent a career belongs to: wherever he made most of his appearances,
 * Europe on a tie. A career with no appearances at all is placed by his last
 * club. Used by the per-continent all-time boards, where a player who started in
 * Brazil and made his name in Spain belongs to Europe's lists.
 */
export function careerRegion(
  seasons: readonly { tid: number; apps: number }[],
  americas: ReadonlySet<number>,
): ContinentalRegion {
  let total = 0;
  let inAmericas = 0;
  for (const s of seasons) {
    total += s.apps;
    if (americas.has(s.tid)) inAmericas += s.apps;
  }
  if (total === 0) {
    const last = seasons[seasons.length - 1]?.tid;
    return last !== undefined && americas.has(last) ? "americas" : "europe";
  }
  return inAmericas * 2 > total ? "americas" : "europe";
}

/**
 * The clubs that play in the Americas, in tid order.
 *
 * A club is placed by its league's region. Promotion and relegation move a club
 * between divisions of its own country and never across a continent, so the
 * answer for any one club never changes — which is what lets a past season be
 * read against today's teams.
 *
 * Returned as an array rather than a Set so it can cross the worker boundary
 * inside `HonourSources` as plain data.
 */
export function americasTids(
  teams: readonly { tid: number; compId: number }[],
  competitions: readonly Competition[],
): number[] {
  const americasComps = new Set(
    competitions.filter((c) => competitionRegion(c) === "americas").map((c) => c.id),
  );
  return teams.filter((t) => americasComps.has(t.compId)).map((t) => t.tid).sort((a, b) => a - b);
}
