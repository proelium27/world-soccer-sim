import type { InternationalState, IntlGroupTable, IntlTournamentSummary } from "./types.js";
import {
  INTL_CYCLE_YEARS, INTL_QUAL_LEGS,
  POWER_EXPECTED_POINTS_SLOPE, POWER_GD_WEIGHT, POWER_GD_CAP, POWER_PERFORMANCE_WEIGHT,
} from "../constants.js";

/**
 * How a nation has actually been playing, for the Power column on the national
 * rankings — the international counterpart of `computeTeamForm`.
 *
 * DERIVED FROM THE ARCHIVE, never stored, and that is a requirement rather than
 * a preference. `IntlPowerSnapshot.ranks` is not a display list: its ordering is
 * what `nationExpectations` reads to set the bar a federation judges its manager
 * against, so writing a form-blended number into the snapshot would change who
 * gets sacked. Deriving it at read time leaves that untouched and, because the
 * results have been kept all along, gives every past snapshot a Power column
 * with no persisted field and no migration.
 *
 * **Expectations deliberately stay on squad rating and must not follow Power.**
 * Power contains the manager's own results, so a federation that judged him on
 * it could have its bar lowered by losing on purpose — the same exploit
 * `deriveExpectations` was rebuilt to close on the club side, where the rule is
 * that no decision the manager makes may move the bar he is measured against.
 * Squad strength is the un-gameable reading; this one is not, which is exactly
 * why it belongs on the page and not in the verdict.
 */
/**
 * How many seasons of international football the Power column reads.
 *
 * One full cycle, so the window always contains a complete qualifying campaign
 * and whatever tournament has been played, and a World Cup stays in view for
 * the four years until the next one.
 */
export const INTL_FORM_WINDOW = INTL_CYCLE_YEARS;

export interface NationFormStats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  /** Rating-scale bonus or penalty from recent results; 0 for a nation with no games in the window. */
  performanceBonus: number;
}

/** Points a nation "should" take off an opponent, from the rating gap alone. Mirrors `expectedPoints`. */
function expectedPoints(own: number, opp: number): number {
  const raw = 1.5 + POWER_EXPECTED_POINTS_SLOPE * (own - opp);
  return Math.min(3, Math.max(0, raw));
}

function blank(): NationFormStats {
  return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, performanceBonus: 0 };
}

/** Running totals while accumulating; `performanceBonus` is only meaningful once divided by games. */
interface Accumulator extends NationFormStats {
  performanceTotal: number;
}

function accFor(into: Map<string, Accumulator>, nation: string): Accumulator {
  const existing = into.get(nation);
  if (existing) return existing;
  const fresh: Accumulator = { ...blank(), performanceTotal: 0 };
  into.set(nation, fresh);
  return fresh;
}

/**
 * Fold one group table in.
 *
 * A group table is an AGGREGATE — it records what each nation took out of the
 * group, not who beat whom — so the per-match expectation `computeTeamForm`
 * builds cannot be reproduced directly. It does not need to be: the other rows
 * name every opponent, and in a round robin each nation plays all of them the
 * same number of times, so summing the expected points against each opponent and
 * multiplying by the number of legs gives exactly the same total the per-match
 * walk would have produced. `legs` is recovered from the row's own `played`
 * rather than assumed, since qualifying accumulates INTL_QUAL_LEGS of them into
 * one table while a tournament group is played once.
 */
function foldGroup(
  into: Map<string, Accumulator>,
  group: IntlGroupTable,
  ratingOf: (nation: string) => number,
): void {
  const opponents = group.rows.length - 1;
  if (opponents <= 0) return;

  for (const row of group.rows) {
    const acc = accFor(into, row.nation);
    acc.played += row.played;
    acc.won += row.won;
    acc.drawn += row.drawn;
    acc.lost += row.lost;
    acc.gf += row.gf;
    acc.ga += row.ga;
    acc.gd += row.gd;

    const own = ratingOf(row.nation);
    const legs = row.played / opponents;
    let expected = 0;
    for (const other of group.rows) {
      if (other.nation === row.nation) continue;
      expected += expectedPoints(own, ratingOf(other.nation));
    }
    // Goal difference is capped per GAME, so the cap scales with games played —
    // capping a whole group's aggregate would let a six-game campaign carry the
    // same maximum as a single knockout tie.
    const cappedGd = Math.min(POWER_GD_CAP * row.played, Math.max(-POWER_GD_CAP * row.played, row.gd));
    acc.performanceTotal += (row.points - expected * legs) + POWER_GD_WEIGHT * cappedGd;
  }
}

/** Fold a tournament's knockout ties in. These carry per-match detail, so the club formula applies directly. */
function foldKnockout(
  into: Map<string, Accumulator>,
  tournament: IntlTournamentSummary,
  ratingOf: (nation: string) => number,
): void {
  for (const tie of tournament.knockout) {
    for (const [nation, opponent, own, against] of [
      [tie.home, tie.away, tie.homeGoals, tie.awayGoals] as const,
      [tie.away, tie.home, tie.awayGoals, tie.homeGoals] as const,
    ]) {
      const acc = accFor(into, nation);
      acc.played += 1;
      acc.gf += own;
      acc.ga += against;
      acc.gd += own - against;
      // A tie level after extra time is settled on penalties, and the shootout
      // decides who goes through rather than the result. Scored as the draw it
      // was, so a nation is not punished for losing a coin flip.
      if (own > against) acc.won += 1;
      else if (own === against) acc.drawn += 1;
      else acc.lost += 1;

      const points = own > against ? 3 : own === against ? 1 : 0;
      const cappedGd = Math.min(POWER_GD_CAP, Math.max(-POWER_GD_CAP, own - against));
      acc.performanceTotal +=
        (points - expectedPoints(ratingOf(nation), ratingOf(opponent))) + POWER_GD_WEIGHT * cappedGd;
    }
  }
}

/**
 * Every nation's form over the `INTL_FORM_WINDOW` seasons up to `season`.
 *
 * **A rolling window rather than the club page's per-season reset**, and the
 * reason is sample size. A club plays 38 league games a year, so a season is
 * plenty to read form off and resetting it is clean. A nation plays a handful,
 * and the cycle's biggest event — the tournament — falls in its LAST offseason,
 * so a per-cycle reset would discard the World Cup at the very next snapshot,
 * which is the one moment everyone would look at it.
 *
 * `ratings` supplies each nation's strength for the expectation term, the way
 * `computeTeamForm` is handed current OVRs: pass the snapshot being displayed.
 * A nation missing from it (no longer eligible) is scored against its own
 * rating, which makes its expectation exactly average and so contributes
 * nothing either way.
 */
export function nationForm(
  intl: InternationalState,
  season: number,
  ratings: Map<string, number>,
): Map<string, NationFormStats> {
  const acc = new Map<string, Accumulator>();
  const oldest = season - INTL_FORM_WINDOW;
  const ratingOf = (nation: string): number => ratings.get(nation) ?? 0;

  for (const qualifying of intl.qualifyingHistory) {
    // A qualifying campaign is stamped with the season it was DRAWN and plays
    // one leg per offseason, so it is only in the window once it has finished.
    const concluded = qualifying.season + INTL_QUAL_LEGS - 1;
    if (concluded <= oldest || concluded > season) continue;
    for (const group of qualifying.groups) foldGroup(acc, group, ratingOf);
  }

  for (const tournament of [...intl.history, ...intl.confederationCupHistory]) {
    if (tournament.season <= oldest || tournament.season > season) continue;
    for (const group of tournament.groups) foldGroup(acc, group, ratingOf);
    foldKnockout(acc, tournament, ratingOf);
  }

  const out = new Map<string, NationFormStats>();
  for (const [nation, a] of acc) {
    const { performanceTotal, ...stats } = a;
    out.set(nation, {
      ...stats,
      performanceBonus: a.played > 0 ? (performanceTotal / a.played) * POWER_PERFORMANCE_WEIGHT : 0,
    });
  }
  return out;
}

/** The blank record a nation with no games in the window reads as. */
export function noNationForm(): NationFormStats {
  return blank();
}
