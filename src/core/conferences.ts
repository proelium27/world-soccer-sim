import type { Competition } from "./competitions.js";
import { competitionConferences } from "./competitions.js";

/* ── Conferences and zones ───────────────────────────────────────────────────
 *
 * MLS's Eastern and Western Conferences and Argentina's two zones: a top flight
 * whose clubs play their schedule in two halves (see ConferenceFormat).
 *
 * A club's half is kept on `StoredTeam.conference` so it is STICKY: a promoted
 * Argentine club takes the zone a relegated one left rather than reshuffling
 * everyone. The field is optional and `conferenceMembers` never needs it — a
 * club without one is simply seated in whichever half has room, in tid order —
 * so a hand-built fixture, an old save or a freshly promoted club all resolve to
 * the same two halves without a migration.
 *
 * For the shipped United States that tid order IS the geography: its club block
 * lists the fifteen eastern cities first.
 * ──────────────────────────────────────────────────────────────────────── */

export interface ConferenceTeam {
  tid: number;
  compId: number;
  conference?: number;
}

/**
 * The two halves of a split division, each in tid order, or null when the
 * division plays one table.
 *
 * Clubs that already carry a half keep it while it has room; everyone else
 * fills whichever half is shorter, the first half winning a tie. The halves
 * therefore always differ in size by at most one, whatever the stored values
 * say — a stale value can never unbalance a schedule.
 */
export function conferenceMembers(
  teams: readonly ConferenceTeam[],
  comp: Competition,
): [number[], number[]] | null {
  if (!competitionConferences(comp)) return null;
  const members = teams.filter((t) => t.compId === comp.id).sort((a, b) => a.tid - b.tid);
  const capacity = [Math.ceil(members.length / 2), Math.floor(members.length / 2)];
  const halves: [number[], number[]] = [[], []];
  const unplaced: number[] = [];
  for (const t of members) {
    const c = t.conference;
    if ((c === 0 || c === 1) && halves[c].length < capacity[c]) halves[c].push(t.tid);
    else unplaced.push(t.tid);
  }
  for (const tid of unplaced) {
    const into = halves[0].length - capacity[0] <= halves[1].length - capacity[1] ? 0 : 1;
    halves[into].push(tid);
  }
  halves[0].sort((a, b) => a - b);
  halves[1].sort((a, b) => a - b);
  return halves;
}

/**
 * Write every club's half onto it: set for a club in a split division, removed
 * from any club that is not (a relegated club carries nothing into a single
 * table). Returns clubs whose value did not change by reference.
 *
 * Run wherever clubs change division — world creation and the offseason's
 * promotion step — so a club keeps its half from one season to the next.
 */
export function assignConferences<T extends ConferenceTeam>(
  teams: readonly T[],
  competitions: readonly Competition[],
): T[] {
  const halfOf = new Map<number, number>();
  for (const comp of competitions) {
    const halves = conferenceMembers(teams, comp);
    if (!halves) continue;
    halves.forEach((tids, c) => tids.forEach((tid) => halfOf.set(tid, c)));
  }
  return teams.map((t) => {
    const want = halfOf.get(t.tid);
    if (want === t.conference) return t;
    if (want === undefined) {
      const { conference: _dropped, ...rest } = t;
      return rest as T;
    }
    return { ...t, conference: want };
  });
}
