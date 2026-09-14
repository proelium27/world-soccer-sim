import type {
  InternationalState, IntlGroupTable, IntlTournamentSummary, IntlQualifyingCampaign,
} from "./types.js";
import { groupTableSummary } from "./groups.js";
import {
  INTL_CYCLE_YEARS, INTL_QUAL_LEGS,
  INTL_IMPORTANCE_QUALIFYING, INTL_IMPORTANCE_CONTINENTAL, INTL_IMPORTANCE_CONTINENTAL_LATE,
  INTL_IMPORTANCE_WORLD_CUP, INTL_IMPORTANCE_WORLD_CUP_LATE, INTL_IMPORTANCE_LATE_FROM_FINAL,
  INTL_SHOOTOUT_WIN_POINTS,
  POWER_EXPECTED_POINTS_SLOPE, POWER_GD_WEIGHT, POWER_GD_CAP, POWER_PERFORMANCE_WEIGHT,
} from "../constants.js";

/**
 * How a nation has actually been playing, for the Power column on the national
 * rankings — the international counterpart of `computeTeamForm`, with the parts
 * of FIFA's own ranking formula that carry over.
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
 *
 * **What is taken from FIFA and what is not.** The expectation term and the
 * per-match importance weights are theirs. The running total is not: FIFA's SUM
 * accumulates points forever, so a nation that plays fewer matches simply moves
 * less, whereas this is a per-match average that sits on top of squad rating.
 * That difference is deliberate — confederations here range from ~25 eligible
 * nations to one, so a cumulative score would rank a nation partly on how many
 * fixtures its confederation happens to hand it, which is a known criticism of
 * the real ranking rather than a property worth importing.
 */
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

/**
 * How many seasons of international football the Power column reads.
 *
 * One full cycle, so the window always contains a complete qualifying campaign
 * and whatever tournament has been played, and a World Cup stays in view for
 * the four years until the next one. FIFA's current formula has no window at
 * all, but its PREVIOUS one used exactly this — four years, with the older ones
 * counting for less.
 */
export const INTL_FORM_WINDOW = INTL_CYCLE_YEARS;

/** Points a nation "should" take off an opponent, from the rating gap alone. Mirrors `expectedPoints`. */
function expectedPoints(own: number, opp: number): number {
  const raw = 1.5 + POWER_EXPECTED_POINTS_SLOPE * (own - opp);
  return Math.min(3, Math.max(0, raw));
}

function blank(): NationFormStats {
  return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, performanceBonus: 0 };
}

/**
 * Running totals while accumulating.
 *
 * The bonus is a WEIGHTED average — `weighted / weight`, not `total / played` —
 * so that a World Cup quarter-final counts for more than a qualifying group
 * game without every nation's bonus being multiplied by the size of the weights.
 * With one weight throughout it reduces exactly to the unweighted per-game mean,
 * which is what makes the whole table invariant to scaling the importance
 * constants uniformly.
 */
interface Accumulator extends NationFormStats {
  weighted: number;
  weight: number;
}

function accFor(into: Map<string, Accumulator>, nation: string): Accumulator {
  const existing = into.get(nation);
  if (existing) return existing;
  const fresh: Accumulator = { ...blank(), weighted: 0, weight: 0 };
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
  importance: number,
): void {
  const opponents = group.rows.length - 1;
  if (opponents <= 0) return;

  for (const row of group.rows) {
    if (row.played === 0) continue;
    const acc = accFor(into, row.nation);
    acc.played += row.played;
    acc.won += row.won;
    acc.drawn += row.drawn;
    acc.lost += row.lost;
    acc.gf += row.gf;
    acc.ga += row.ga;
    acc.gd += row.gd;

    const own = ratingOf(row.nation);
    // A group part-way through a campaign has played fewer than a full leg
    // against each opponent, so this is fractional rather than a whole number.
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
    acc.weighted += importance * ((row.points - expected * legs) + POWER_GD_WEIGHT * cappedGd);
    acc.weight += importance * row.played;
  }
}

/**
 * How much a knockout round counts.
 *
 * FIFA steps its weight up from the quarter-finals, so the round is measured
 * backwards from the final rather than forwards from the first round — brackets
 * differ in depth, and a confederation cup's round 0 may be the semi-final where
 * the World Cup's is the round of 16. Reading the depth off the rounds present
 * is only sound because an ARCHIVED tournament is a finished one; do not copy
 * this to a live bracket, which would call its first round the final.
 */
function knockoutImportance(round: number, totalRounds: number, base: number, late: number): number {
  return totalRounds - 1 - round <= INTL_IMPORTANCE_LATE_FROM_FINAL ? late : base;
}

/** Fold a tournament's knockout ties in. These carry per-match detail, so the club formula applies directly. */
function foldKnockout(
  into: Map<string, Accumulator>,
  tournament: Pick<IntlTournamentSummary, "knockout">,
  ratingOf: (nation: string) => number,
  base: number,
  late: number,
): void {
  const totalRounds = tournament.knockout.reduce((max, t) => Math.max(max, t.round + 1), 0);

  for (const tie of tournament.knockout) {
    const importance = knockoutImportance(tie.round, totalRounds, base, late);
    for (const [nation, opponent, own, against] of [
      [tie.home, tie.away, tie.homeGoals, tie.awayGoals] as const,
      [tie.away, tie.home, tie.awayGoals, tie.homeGoals] as const,
    ]) {
      const acc = accFor(into, nation);
      acc.played += 1;
      acc.gf += own;
      acc.ga += against;
      acc.gd += own - against;
      // Level after extra time is a DRAW in the record, which is what football
      // records — the shootout decides who goes through, not the result.
      if (own > against) acc.won += 1;
      else if (own === against) acc.drawn += 1;
      else acc.lost += 1;

      // The shootout does count toward the rating, though, the way FIFA counts
      // it: the winner lands halfway between a draw and a win and the loser
      // keeps a draw. Scoring it as a flat draw for both ignores a real result;
      // scoring it as a win overpays a coin flip.
      const wonShootout = tie.pens !== null && tie.winner === nation;
      const points = wonShootout
        ? INTL_SHOOTOUT_WIN_POINTS
        : own > against ? 3 : own === against ? 1 : 0;
      const cappedGd = Math.min(POWER_GD_CAP, Math.max(-POWER_GD_CAP, own - against));
      acc.weighted += importance
        * ((points - expectedPoints(ratingOf(nation), ratingOf(opponent))) + POWER_GD_WEIGHT * cappedGd);
      acc.weight += importance;
    }
  }
}

/** A qualifying campaign is only in `qualifyingHistory` once its last leg has locked in the qualifiers. */
function isArchived(campaign: IntlQualifyingCampaign): boolean {
  return campaign.qualified.length > 0;
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
    for (const group of qualifying.groups) {
      foldGroup(acc, group, ratingOf, INTL_IMPORTANCE_QUALIFYING);
    }
    // Playoff ties count as qualifiers, at qualifying's own weight.
    for (const playoff of qualifying.playoffs ?? []) {
      const knockout = playoff.rounds.flatMap((r) => r.results);
      foldKnockout(acc, { knockout }, ratingOf, INTL_IMPORTANCE_QUALIFYING, INTL_IMPORTANCE_QUALIFYING);
    }
  }

  // The campaign still being played, which is NOT in the history above: a
  // summary is only appended when the last leg locks in the qualifiers, so
  // without this up to two of a cycle's three legs would be invisible for the
  // two years they are the most recent football anyone has played. The live
  // campaign is kept on the state after archiving too, hence the guard — the
  // alternative is counting a finished campaign twice.
  const live = intl.qualifying;
  if (live && !isArchived(live) && live.season > oldest && live.season <= season) {
    for (const group of live.groups) {
      foldGroup(acc, groupTableSummary(group, live.nations), ratingOf, INTL_IMPORTANCE_QUALIFYING);
    }
  }

  for (const tournament of intl.history) {
    if (tournament.season <= oldest || tournament.season > season) continue;
    for (const group of tournament.groups) {
      foldGroup(acc, group, ratingOf, INTL_IMPORTANCE_WORLD_CUP);
    }
    foldKnockout(acc, tournament, ratingOf, INTL_IMPORTANCE_WORLD_CUP, INTL_IMPORTANCE_WORLD_CUP_LATE);
  }

  for (const cup of intl.confederationCupHistory) {
    if (cup.season <= oldest || cup.season > season) continue;
    for (const group of cup.groups) {
      foldGroup(acc, group, ratingOf, INTL_IMPORTANCE_CONTINENTAL);
    }
    foldKnockout(acc, cup, ratingOf, INTL_IMPORTANCE_CONTINENTAL, INTL_IMPORTANCE_CONTINENTAL_LATE);
  }

  const out = new Map<string, NationFormStats>();
  for (const [nation, a] of acc) {
    const { weighted, weight, ...stats } = a;
    out.set(nation, {
      ...stats,
      performanceBonus: weight > 0 ? (weighted / weight) * POWER_PERFORMANCE_WEIGHT : 0,
    });
  }
  return out;
}

/** The blank record a nation with no games in the window reads as. */
export function noNationForm(): NationFormStats {
  return blank();
}
