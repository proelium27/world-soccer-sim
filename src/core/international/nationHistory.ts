import type { IntlTournamentSummary } from "./types.js";

/**
 * Per-nation records derived from archived tournaments (Light summaries). Pure
 * functions of `history` — nothing extra is stored, because a summary's field,
 * champion/runner-up and knockout scorelines already say how far each nation
 * got.
 */

/** How far a nation got, weakest to strongest, for ranking a "best finish". */
export const FINISH_ORDER = [
  "Did not qualify",
  "Group stage",
  "Round of 32",
  "Round of 16",
  "Quarter-finals",
  "Semi-finals",
  "Runners-up",
  "Champions",
] as const;
export type Finish = (typeof FINISH_ORDER)[number];

/** Knockout exits by rounds from the final: index 1 = lost a semi, 2 = a quarter, and so on. */
const EXIT_BY_ROUNDS_FROM_FINAL: Finish[] = [
  "Runners-up", "Semi-finals", "Quarter-finals", "Round of 16", "Round of 32",
];

/**
 * A nation's finish in one archived tournament, or null if it wasn't in the
 * field. Champion and runner-up come straight off the summary; otherwise the
 * deepest knockout round the nation appears in tells the story, named by how
 * far that round was from the final (lost in the SF → "Semi-finals", never
 * reached the knockout → "Group stage").
 *
 * Counted BACKWARDS, because bracket depth varies with the World Cup's size:
 * three rounds at 16 nations, four at 24 or 32, five at 48. This used to count
 * forwards from a three-round bracket, so once the World Cup grew to 32 a
 * nation beaten in the round of 16 was recorded as a quarter-finalist and a
 * beaten quarter-finalist as a semi-finalist — which also inflated the History
 * page's semi-final counts. Reading depth off the rounds present is sound here
 * only because an archived tournament is a finished one.
 */
export function finishOf(summary: IntlTournamentSummary, nation: string): Finish | null {
  if (!summary.field.includes(nation)) return null;
  if (summary.champion === nation) return "Champions";
  if (summary.runnerUp === nation) return "Runners-up";
  const totalRounds = summary.knockout.reduce((max, k) => Math.max(max, k.round + 1), 0);
  let deepest = -1;
  for (const k of summary.knockout) {
    if (k.home === nation || k.away === nation) deepest = Math.max(deepest, k.round);
  }
  if (deepest < 0) return "Group stage";
  return EXIT_BY_ROUNDS_FROM_FINAL[totalRounds - 1 - deepest] ?? "Round of 32";
}

export interface NationRecord {
  nation: string;
  /** Tournaments the nation was in the field for. */
  tournaments: number;
  titles: number;
  /** Times it reached the final (won or lost). */
  finals: number;
  /** Times it reached the semi-finals or better. */
  semis: number;
  bestFinish: Finish;
}

/**
 * Roll every archived tournament up into one record per nation, ranked by
 * honours (titles, then finals, then semis, then appearances). Nations that
 * never qualified for any archived tournament simply don't appear.
 */
export function nationRecords(history: IntlTournamentSummary[]): NationRecord[] {
  const map = new Map<string, NationRecord>();
  const get = (nation: string): NationRecord => {
    let r = map.get(nation);
    if (!r) {
      r = { nation, tournaments: 0, titles: 0, finals: 0, semis: 0, bestFinish: "Group stage" };
      map.set(nation, r);
    }
    return r;
  };

  for (const s of history) {
    for (const nation of s.field) {
      const r = get(nation);
      r.tournaments++;
      const f = finishOf(s, nation);
      if (f === "Champions") {
        r.titles++;
        r.finals++;
        r.semis++;
      } else if (f === "Runners-up") {
        r.finals++;
        r.semis++;
      } else if (f === "Semi-finals") {
        r.semis++;
      }
      if (f && FINISH_ORDER.indexOf(f) > FINISH_ORDER.indexOf(r.bestFinish)) r.bestFinish = f;
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      b.titles - a.titles ||
      b.finals - a.finals ||
      b.semis - a.semis ||
      b.tournaments - a.tournaments ||
      a.nation.localeCompare(b.nation),
  );
}
