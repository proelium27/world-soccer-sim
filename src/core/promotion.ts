import type { StandingsRow } from "./standings.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { Competition } from "./competitions.js";
import {
  promotionLinks, competitionOf, academyBaseCenterOf, effectivePromotionSpots,
} from "./competitions.js";
import type { PlayoffOutcome } from "./promotionPlayoff.js";
import { ACADEMY_BASE_CONVERGENCE_SEASONS } from "./constants.js";

/** One promotion/relegation swap, between an adjacent pair of a country's divisions. */
export interface CompetitionSwap {
  d1CompId: number;
  d2CompId: number;
  /** Tids moving from the lower competition up into the upper one. */
  promoted: number[];
  /** Tids moving from the upper competition down into the lower one. */
  relegated: number[];
}

/**
 * For every adjacent pair of divisions in the world, the bottom N of the upper
 * table swap with the top N of the lower one, where N is that country's own
 * `competitionPromotionSpots` (3 unless the league was added with a different
 * number on the New League screen). Every table in `tablesByCompId` must
 * already be sorted by computeStandings (points, then GD, then GF, then tid).
 *
 * One swap per LINK, not per country: a three-division country produces two
 * independent swaps, and because each reads the final tables rather than the
 * result of the other, a club can only ever move one division per season. That
 * is the intended behaviour and it falls out of the shape — do not "fix" it by
 * chaining the links, which would let a runaway second-tier club skip a level.
 *
 * A one-division country contributes no links at all, so it has no promotion or
 * relegation without needing a special case here.
 *
 * `playoffOutcomes` (lower-division compId -> outcome) is how a promotion
 * playoff reaches the swap. What it does depends on the country's format, which
 * is why it carries counts rather than a bare winner:
 *
 *  - **English** — the top N-1 go up on the table and the playoff winner takes
 *    the last place. Relegation is untouched: N still go down.
 *  - **German** — N-1 go up and N-1 go down on the table, and the tie either
 *    swaps one more pair or moves nobody.
 *
 * **The two lists always come out the same length**, whichever way a tie went,
 * which is the property the whole feature rests on: every division's size is
 * fixed, so one extra club promoted would mean one extra relegated.
 *
 * Absent (a headless caller, a world with no eligible country, a save from
 * before playoffs existed) means the plain top-N slice, which is exactly the old
 * behaviour. A three-division country seats a playoff at BOTH of its links, so
 * both lookups normally hit — but each link is looked up on its own, so a
 * country that can stage only one still settles the other on the table alone.
 * See promotionPlayoffFields.
 */
export function computeCountrySwaps(
  competitions: Competition[],
  tablesByCompId: Map<number, StandingsRow[]>,
  playoffOutcomes?: Map<number, PlayoffOutcome>,
): CompetitionSwap[] {
  const links = promotionLinks(competitions);

  return links.flatMap(({ upper: d1, lower: d2 }) => {
    const d1Table = tablesByCompId.get(d1.id)!;
    const d2Table = tablesByCompId.get(d2.id)!;
    const n = effectivePromotionSpots(
      competitions, d1, d2, d1Table.length, d2Table.length,
    );
    // `slice(-0)` is `slice(0)` — the WHOLE table — so a league set to no
    // promotion or relegation would relegate every club in its division. The
    // early return is the only thing standing between that setting and a world
    // that turns itself inside out every offseason.
    if (n <= 0) return [];
    const outcome = playoffOutcomes?.get(d2.id);
    if (!outcome) {
      return {
        d1CompId: d1.id,
        d2CompId: d2.id,
        promoted: d2Table.slice(0, n).map((r) => r.tid),
        relegated: d1Table.slice(-n).map((r) => r.tid),
      };
    }
    // Both formats hold back one promotion place for the playoff to settle.
    // Only the German one also holds back a relegation place, because its tie
    // decides a place on each side at once.
    //
    // Derived from `n` here rather than read off the outcome: the record was
    // built at the season boundary and is applied now, and deriving is what
    // keeps the two lists the same length even if the two ever disagreed about
    // how many places the country gives out.
    const autoPromoted = n - 1;
    const autoRelegated = outcome.format === "german" ? n - 1 : n;
    // Both playoff entrants come from *outside* the automatic slices by
    // construction (see promotionPlayoffFields), so neither list can end up
    // holding a club twice. The `> 0` guards are the `slice(-0)` trap again:
    // a German playoff in a country promoting one club automates nothing, and
    // `slice(-0)` would relegate the entire division.
    const promoted = autoPromoted > 0
      ? d2Table.slice(0, autoPromoted).map((r) => r.tid)
      : [];
    if (outcome.promotedTid !== null) promoted.push(outcome.promotedTid);
    const relegated = autoRelegated > 0
      ? d1Table.slice(-autoRelegated).map((r) => r.tid)
      : [];
    if (outcome.relegatedTid !== null) relegated.push(outcome.relegatedTid);
    return { d1CompId: d1.id, d2CompId: d2.id, promoted, relegated };
  });
}

/**
 * Move each swapped team into its new competition and start (or restart) its
 * academyBase convergence toward the new competition's strength center.
 * Teams not in any swap are returned unchanged.
 */
export function applyCompetitionSwaps(teams: StoredTeam[], swaps: CompetitionSwap[]): StoredTeam[] {
  const moveTo = new Map<number, number>();
  for (const s of swaps) {
    for (const tid of s.promoted) moveTo.set(tid, s.d1CompId);
    for (const tid of s.relegated) moveTo.set(tid, s.d2CompId);
  }
  return teams.map((t) =>
    moveTo.has(t.tid)
      ? {
          ...t,
          compId: moveTo.get(t.tid)!,
          divisionConvergence: { seasonsRemaining: ACADEMY_BASE_CONVERGENCE_SEASONS },
        }
      : t,
  );
}

/**
 * Move every mid-convergence team's academyBase one season closer to its
 * current competition's tier center, decrementing seasonsRemaining and
 * clearing divisionConvergence once it reaches 0. Teams with no active
 * convergence (divisionConvergence === null) are returned unchanged — this
 * must NEVER pull every team toward the tier average, only ones that
 * actually swapped competitions, or it would erase the intra-competition
 * strength spread generation deliberately creates.
 */
export function stepAcademyBaseConvergence(
  teams: StoredTeam[],
  competitions: Competition[],
): StoredTeam[] {
  return teams.map((t) => {
    if (!t.divisionConvergence) return t;
    const comp = competitionOf(competitions, t.compId);
    const center = academyBaseCenterOf(comp);
    const step = (center - t.academyBase) / t.divisionConvergence.seasonsRemaining;
    const seasonsRemaining = t.divisionConvergence.seasonsRemaining - 1;
    return {
      ...t,
      academyBase: t.academyBase + step,
      divisionConvergence: seasonsRemaining > 0 ? { seasonsRemaining } : null,
    };
  });
}
