import type { LeagueStore } from "../leagueState.js";
import { emptyTotals, emptyBestSeasons } from "../players/careerSummary.js";
import { allCareers, type CareerRow } from "./careers.js";
import {
  computeHonours, honourSourcesOf, scorePlayer, emptyHonours,
  type GoatComponent, type PlayerHonours,
} from "./goat.js";

/** How many names a club's board shows. */
export const CLUB_GOAT_LIMIT = 10;

/**
 * The parts of the score a club board can actually award, in scoring order.
 *
 * `scorePlayer` always returns six components, and on a club board "production"
 * is empty for **every** player by construction: `clubStint` zeroes goals,
 * assists and caps because a per-club figure is not recoverable for a retiree
 * (see below). A column of nothing but zeroes reads as a bug rather than as a
 * fact, so the board leaves that one out.
 *
 * Stated here rather than inferred in the UI from "which parts happen to be
 * non-empty on this board", which was the first cut and is worse: it is the
 * same rule `GoatBreakdown` applies per row, but lifted to a board it makes a
 * young club's table structurally different from an old club's, and a Trophies
 * column reading 0 is genuinely informative where an Extras one is not.
 *
 * `clubGoat.test.ts` pins both halves — that every key here is really scored,
 * and that the omitted one really scores nothing — so making production
 * sliceable one day fails a test rather than silently leaving a column out.
 */
export const CLUB_GOAT_PARTS: readonly GoatComponent["key"][] = [
  "peak", "prime", "longevity", "awards", "trophies",
];

/**
 * One player's case for being a club's greatest, scored on his time there.
 *
 * `career` is the whole man — it carries his name, nationality and whether he
 * is still playing. `stint` is the same career narrowed to the seasons he spent
 * at this club, and it is the *only* thing the score is computed from.
 */
export interface ClubGoatRow {
  career: CareerRow;
  stint: CareerRow;
  honours: PlayerHonours;
  /** Exactly the sum of `components`. */
  score: number;
  components: GoatComponent[];
}

/**
 * One career narrowed to a single club, or null if he never played there.
 *
 * **This is the whole feature.** Ranking a club's alumni by their *career*
 * scores is the obvious implementation and it is wrong in a way anyone would
 * spot on the first render: a man who spent one season here and eleven at a
 * big-four club would top the board. So the board scores the stint instead, and
 * `CareerRow.seasons` is what makes that possible for free — it already carries
 * `{season, tid, ovr, apps}` for the living and the archived alike.
 *
 * Two deliberate asymmetries:
 *
 * - **Included on an appearance, scored on membership.** He needs one game for
 *   this club to be on its board at all, but `seasons` keeps every season he
 *   was on its books, appearances or not, because that is the squad-membership
 *   record `computeHonours` credits league titles on and a title won from the
 *   bench is still a title won here.
 * - **Production and match rating are dropped, not sliced.** `StatTotals` is a
 *   career aggregate and `ArchivedSeason` records only `{season, tid, ovr,
 *   apps}` — so a retiree's goals, assists and ratings *at one club* are not
 *   recoverable from anything the save keeps, and a retiree is exactly who a
 *   club's all-time board is about. Rather than let the board mean one thing
 *   for the living and another for the dead, it means the same thing for both:
 *   `emptyTotals()` zeroes those terms and `component()` then drops them, so
 *   the breakdown shows the case that was actually made. Making them sliceable
 *   is a schema change (~24 B per season line, ~+10 MB at a full archive) and
 *   its own decision.
 */
export function clubStint(career: CareerRow, tid: number): CareerRow | null {
  const seasons = career.seasons.filter((s) => s.tid === tid);
  const played = seasons.filter((s) => s.apps > 0);
  if (played.length === 0) return null;

  let peakOvr = played[0].ovr;
  let peakSeason = played[0].season;
  for (const s of played) {
    if (s.ovr > peakOvr) { peakOvr = s.ovr; peakSeason = s.season; }
  }

  return {
    ...career,
    tid,
    seasonsPlayed: played.length,
    firstSeason: played[0].season,
    lastSeason: played[played.length - 1].season,
    peakOvr,
    peakSeason,
    // Appearances survive because `ArchivedSeason.apps` does; everything else
    // in a StatTotals is career-wide and would be a lie at club scope.
    totals: { ...emptyTotals(), appearances: played.reduce((n, s) => n + s.apps, 0) },
    best: emptyBestSeasons(),
    // A cap and a World Cup are his country's, not this club's.
    caps: 0,
    intlGoals: 0,
    intlTitles: 0,
    clubs: [tid],
    seasons,
  };
}

/**
 * One club's greatest players, best first.
 *
 * Pure and derived, like every other board here: no persisted field, no
 * migration, and it reads correctly on a save made before it existed. Reuses
 * `scorePlayer` rather than defining its own arithmetic so a club board and the
 * world board can never disagree about what a league title is worth.
 *
 * The known gap is the archive, not this function: a retiree below
 * `isArchiveWorthy` is gone from the save entirely, so a long dynasty's board
 * thins out the further back it reaches. The page says so.
 */
export function clubGoatRanking(
  league: LeagueStore,
  tid: number,
  limit = CLUB_GOAT_LIMIT,
): ClubGoatRow[] {
  const stints: { career: CareerRow; stint: CareerRow }[] = [];
  // Seasons he was on this club's books, so an award won elsewhere in a year he
  // was not here cannot follow him onto this board.
  const hereIn = new Map<number, Set<number>>();
  for (const career of allCareers(league)) {
    const stint = clubStint(career, tid);
    if (!stint) continue;
    stints.push({ career, stint });
    hereIn.set(career.pid, new Set(stint.seasons.map((s) => s.season)));
  }

  const sources = honourSourcesOf(league);
  const honours = computeHonours(
    sources,
    stints.map((s) => s.stint),
    (pid, season) => hereIn.get(pid)?.has(season) === true,
  );
  // The world board's discount applies here too, so a club board and the world
  // board still agree about what the same season was worth. On a club in the
  // Americas it scales every stint alike, so the order of its board is its own.
  const americas = new Set(sources.americasTids ?? []);

  return stints
    .map(({ career, stint }) => {
      const scored = scorePlayer(stint, honours.get(stint.pid) ?? emptyHonours(), americas);
      return { career, stint, honours: scored.honours, score: scored.score, components: scored.components };
    })
    .sort((a, b) => b.score - a.score || a.career.pid - b.career.pid)
    .slice(0, limit);
}
