import type { BoxScore } from "../../engine/attribution.js";
import type { TeamMatchData } from "../league/composites.js";
import type { CupTie } from "../cup/types.js";
import type { IntlGroup } from "./types.js";
import { simMatchDetailed } from "../../engine/matchSim.js";
import { resolveCupTie } from "../cup/simCup.js";
import { mulberry32, hashInts } from "../../engine/rng.js";
import { INTL_QUALIFY_PER_GROUP } from "../constants.js";
import { groupTable, rankAcrossGroups, type GroupRow } from "./groups.js";
import { bestThirdsFor } from "./format.js";
import { seedOrder } from "../cup/cup.js";

/**
 * rng-stream tags for international football. Every international match runs on
 * a stream seeded from (lid, season, tag) and NEVER on the league's shared rng —
 * the sim is seeded and deterministic, so a single extra draw taken from the
 * shared stream would shift every downstream club result in the save. This is
 * the same discipline the Continental Cup follows.
 */
const QUALIFYING_STREAM = 800;
const GROUP_STREAM = 810;
const KNOCKOUT_STREAM = 820;

/** International appearances/goals/assists gathered from a campaign's box scores. */
export type CareerDelta = Map<number, { caps: number; goals: number; assists: number }>;

export function emptyCareerDelta(): CareerDelta {
  return new Map();
}

/**
 * Fold `source` into `target` in place. A staged campaign produces one delta per
 * stage; the bulk path plays every stage into a single delta by merging, so a
 * click-through and a one-pass sim credit exactly the same caps/goals/assists.
 */
export function mergeCareerDelta(target: CareerDelta, source: CareerDelta): void {
  for (const [pid, s] of source) {
    const t = target.get(pid) ?? { caps: 0, goals: 0, assists: 0 };
    target.set(pid, { caps: t.caps + s.caps, goals: t.goals + s.goals, assists: t.assists + s.assists });
  }
}

/**
 * Fold one match's attribution into a career delta. A player has a box-score
 * line only if he actually featured, so a line is exactly one cap — the same
 * rule simThrough uses to count a club appearance.
 */
export function accumulate(delta: CareerDelta, box: BoxScore): void {
  for (const line of [...box.home, ...box.away]) {
    const entry = delta.get(line.pid) ?? { caps: 0, goals: 0, assists: 0 };
    entry.caps++;
    entry.goals += line.goals;
    entry.assists += line.assists;
    delta.set(line.pid, entry);
  }
}

/**
 * Add the pids that picked up an injury in this match to `injured`. Collected
 * only so the injury can be *carried into the club season* at the offseason
 * rollover — it is never stamped on the player mid-campaign, so it can't change
 * which international match a nation's XI plays or any scoreline (the same
 * post-hoc discipline as career caps). Injuries are surfaced as box-score
 * events by the match sim exactly as in a league game.
 */
export function collectInjured(box: BoxScore, injured: Set<number>): void {
  for (const e of box.events) if (e.type === "injury") injured.add(e.pids[0]);
}

/**
 * Play unplayed matches in `groups` on one seeded stream (`seed`), 90' only —
 * group games may end level, no extra time or shootout. When `onlyLeg` is given,
 * only that leg's fixtures are played (the rest wait for their own offseason);
 * this is how qualifying spreads its three legs across the cycle. Callers pass
 * the seed directly so a per-leg stream can be seeded independently, which keeps
 * each leg's results the same whether the campaign is played leg-by-leg or in
 * one pass.
 *
 * `keepBoxScores` controls whether the per-match attribution is retained on the
 * fixture. Qualifying discards it (the career totals folded into `delta` are the
 * lasting record), while a tournament keeps it so its matches stay browsable.
 */
export function playGroups(
  groups: IntlGroup[],
  matchData: Map<number, TeamMatchData>,
  seed: number,
  keepBoxScores: boolean,
  delta: CareerDelta,
  injured: Set<number>,
  onlyLeg?: number,
): IntlGroup[] {
  const rng = mulberry32(seed);
  return groups.map((group) => ({
    ...group,
    matches: group.matches.map((m) => {
      if (m.homeGoals >= 0) return m;
      if (onlyLeg !== undefined && (m.leg ?? 0) !== onlyLeg) return m; // not this leg's fixture
      const hd = matchData.get(m.home);
      const ad = matchData.get(m.away);
      if (!hd || !ad) return m; // defensive: every entrant should be in matchData
      const result = simMatchDetailed(rng, hd.composites, ad.composites, hd.xi, ad.xi, hd.bench, ad.bench, {
        recompute: { home: hd.recompute, away: ad.recompute },
      });
      accumulate(delta, result.boxScore);
      collectInjured(result.boxScore, injured);
      return {
        ...m,
        homeGoals: result.home,
        awayGoals: result.away,
        boxScore: keepBoxScores ? result.boxScore : null,
      };
    }),
  }));
}

export const QUALIFYING_GROUP_STREAM = QUALIFYING_STREAM;
export const TOURNAMENT_GROUP_STREAM = GROUP_STREAM;
export const TOURNAMENT_KNOCKOUT_STREAM = KNOCKOUT_STREAM;

/**
 * Seed the knockout bracket from completed tournament groups: each group's top
 * `qualifyPerGroup` advance, paired so a group winner always meets a runner-up
 * from its partner group (0↔1, 2↔3, …) and the two nations out of any one group
 * land in opposite halves of the draw, so they can only meet again in the final.
 * Returns the advancing nids in bracket order — consecutive pairs are ties. The
 * group count comes from `groups` rather than a constant, because a
 * confederation cup's shape varies with its confederation's size.
 *
 * The half split is what the two accumulators are for, and it is load-bearing
 * rather than tidiness. Emitting each partner pair's two ties adjacently — the
 * shape this had before the field grew to 32 — puts them together in the *next*
 * round, so A1 and A2 met in the semi-final of a four-group tournament and in
 * the quarter-final of an eight-group one. That contradicted what this function
 * documented, and at eight groups it would have had a third of the round of 16
 * replaying group fixtures two rounds later. Every mirror tie now goes into the
 * back half instead, which is also how a real World Cup bracket is laid out.
 * Note this changes results for existing four-group tournaments too (the World
 * Cup's old shape, and the confederation cups' largest) — international matches
 * take no draw from the shared rng, so no club result moves.
 */
export function seedBracket(
  groups: IntlGroup[],
  qualifyPerGroup: number = INTL_QUALIFY_PER_GROUP,
  bestThirds: number = bestThirdsFor(groups.length, qualifyPerGroup),
): number[] {
  if (bestThirds > 0) return seedWithBestThirds(groups, bestThirds);
  const advancing = groups.map((g) => groupTable(g).slice(0, qualifyPerGroup).map((r) => r.nid));
  const winner = (g: number): number => advancing[g][0];
  const runnerUp = (g: number): number => advancing[g][1];
  // A one-group tournament (the smallest confederation cup shape) has no partner
  // group to cross with: its top two simply meet in the final.
  if (groups.length === 1) return advancing[0].slice(0, 2);
  const top: number[] = [];
  const bottom: number[] = [];
  for (let pair = 0; pair < Math.floor(groups.length / 2); pair++) {
    const a = pair * 2;
    const b = a + 1;
    top.push(winner(a), runnerUp(b));
    bottom.push(winner(b), runnerUp(a));
  }
  return [...top, ...bottom];
}

/** A qualifier out of the group stage, and the group it came out of. */
interface Qualifier {
  nid: number;
  group: number;
}

/**
 * Seed a bracket that takes the best third-placed sides as well as every
 * group's top two — the 24- and 48-nation World Cups (see WORLD_CUP_FORMATS).
 * Partner groups can't work here, because six or twelve winners don't pair off
 * against the same number of runners-up once thirds join, so the pairings are
 * made on group-stage record instead, which is what rewards winning a group:
 *
 *  - the best winners, one per qualifying third, draw a third-placed side, the
 *    best winner getting the weakest third;
 *  - the other winners draw the weakest runners-up;
 *  - that leaves the strongest runners-up, who play each other, best v worst.
 *
 * No first-round tie is ever a group rematch (every one of those pairings is a
 * matching over at least two sides a piece, where one forbidden opponent each
 * always leaves one to take). Ties are then split into halves greedily, trying
 * to put a group's winner and runner-up apart, and within a half the strongest
 * ties are spread so they meet as late as possible. The split is best-effort,
 * not a guarantee: measured over 20 draws each, a group's top two still share a
 * half 32% of the time at 24 nations and 25% at 48 (against ~50% by chance),
 * because a third from the same group is often through too and the halves must
 * stay equal. Zero first-round rematches in the same runs.
 *
 * Every rank here comes off rankAcrossGroups, the per-game comparison qualifying
 * already uses across groups; it needs no rng, so the bracket is fully fixed by
 * the group results.
 */
function seedWithBestThirds(groups: IntlGroup[], bestThirds: number): number[] {
  const tables = groups.map((g) => groupTable(g));
  const groupOf = new Map<number, number>();
  tables.forEach((table, g) => table.forEach((row) => groupOf.set(row.nid, g)));
  const ranked = (rows: (GroupRow | undefined)[]): Qualifier[] =>
    rankAcrossGroups(rows.filter((r): r is GroupRow => r !== undefined))
      .map((r) => ({ nid: r.nid, group: groupOf.get(r.nid)! }));

  const winners = ranked(tables.map((t) => t[0]));
  const runnersUp = ranked(tables.map((t) => t[1]));
  const thirds = ranked(tables.map((t) => t[2])).slice(0, bestThirds);

  const facingThirds = winners.slice(0, thirds.length);
  const facingRunners = winners.slice(thirds.length);
  const weakRunners = runnersUp.slice(runnersUp.length - facingRunners.length);
  const strongRunners = runnersUp.slice(0, runnersUp.length - facingRunners.length);

  const ties: [Qualifier, Qualifier][] = [
    ...matchAvoidingGroup(facingThirds, [...thirds].reverse()),
    ...matchAvoidingGroup(facingRunners, [...weakRunners].reverse()),
  ];
  for (let i = 0; i < Math.floor(strongRunners.length / 2); i++) {
    ties.push([strongRunners[i], strongRunners[strongRunners.length - 1 - i]]);
  }

  // Split into halves, strongest tie first. A tie goes to whichever half it
  // shares fewer groups with, a winner-and-runner-up clash counting double —
  // those are the two most likely to be the same group's best sides.
  const halfSize = ties.length / 2;
  const halves: [Qualifier, Qualifier][][] = [[], []];
  const clash = (tie: [Qualifier, Qualifier], half: [Qualifier, Qualifier][]): number => {
    let cost = 0;
    for (const placed of half) {
      for (const a of tie) {
        for (const b of placed) {
          if (a.group !== b.group) continue;
          cost += isTopTwo(a, winners, runnersUp) && isTopTwo(b, winners, runnersUp) ? 2 : 1;
        }
      }
    }
    return cost;
  };
  ties.forEach((tie, i) => {
    const open = [0, 1].filter((h) => halves[h].length < halfSize);
    const [first, second] = i % 2 === 0 ? [0, 1] : [1, 0];
    const pick = open.length === 1
      ? open[0]
      : clash(tie, halves[second]) < clash(tie, halves[first]) ? second : first;
    halves[pick].push(tie);
  });

  // Within each half, standard seeding over its ties (already strongest first).
  const order = seedOrder(halfSize);
  return halves.flatMap((half) => order.flatMap((seed) => half[seed - 1].map((q) => q.nid)));
}

/** A group winner or runner-up — the pair seeding most wants kept apart. */
function isTopTwo(q: Qualifier, winners: Qualifier[], runnersUp: Qualifier[]): boolean {
  return winners.some((w) => w.nid === q.nid) || runnersUp.some((r) => r.nid === q.nid);
}

/**
 * Pair each of `firsts` (in order) with one of `seconds`, taking the earliest
 * available opponent from a different group and backtracking if a later side
 * would be left only with its own group. Falls back to plain order if no such
 * pairing exists at all, which cannot happen at the sizes seedWithBestThirds
 * passes (two or more a side).
 */
function matchAvoidingGroup(firsts: Qualifier[], seconds: Qualifier[]): [Qualifier, Qualifier][] {
  const used = new Set<number>();
  const picked: number[] = [];
  const place = (i: number): boolean => {
    if (i === firsts.length) return true;
    for (let j = 0; j < seconds.length; j++) {
      if (used.has(j) || seconds[j].group === firsts[i].group) continue;
      used.add(j);
      picked.push(j);
      if (place(i + 1)) return true;
      used.delete(j);
      picked.pop();
    }
    return false;
  };
  if (!place(0)) return firsts.map((f, i) => [f, seconds[i]]);
  return firsts.map((f, i) => [f, seconds[picked[i]]]);
}

/**
 * Play exactly one knockout round — every tie between consecutive pairs of the
 * current `field` — and return the round's ties plus the nids that advanced.
 * `round` picks the seeded stream (`streamBase + round`, the World Cup's by
 * default), so a round plays
 * identically whether it is reached in one bulk pass or one user click at a
 * time: the staged offseason and the bulk `playKnockout` share this function and
 * therefore always agree. Each tie is decided by the Continental Cup's own
 * `resolveCupTie` — 90', extra time if level, shootout if still level.
 * `matchday` is 0 on every tie: international football sits outside the club
 * calendar entirely.
 */
export function playKnockoutRound(
  field: number[],
  matchData: Map<number, TeamMatchData>,
  lid: number,
  season: number,
  round: number,
  delta: CareerDelta,
  injured: Set<number>,
  streamBase: number = KNOCKOUT_STREAM,
): { ties: CupTie[]; winners: number[] } {
  const rng = mulberry32(hashInts(lid, season, streamBase + round, 30));
  const ties: CupTie[] = [];
  const winners: number[] = [];
  for (let i = 0; i + 1 < field.length; i += 2) {
    const home = field[i];
    const away = field[i + 1];
    const hd = matchData.get(home);
    const ad = matchData.get(away);
    if (!hd || !ad) continue; // defensive
    const tie = resolveCupTie(rng, home, away, hd, ad, round, 0);
    // Always set on a tie that was just played; CupTie.boxScore is nullable only
    // because archiving drops it (see cup/archive.ts).
    if (tie.boxScore) {
      accumulate(delta, tie.boxScore);
      collectInjured(tie.boxScore, injured);
    }
    ties.push(tie);
    winners.push(tie.winner);
  }
  return { ties, winners };
}

/**
 * Play the whole knockout from a seeded bracket in one pass: quarter-finals,
 * semi-finals, final. A thin loop over `playKnockoutRound`, so a bulk sim and a
 * click-through of the same bracket produce byte-identical results.
 */
export function playKnockout(
  bracket: number[],
  matchData: Map<number, TeamMatchData>,
  lid: number,
  season: number,
  delta: CareerDelta,
  injured: Set<number>,
): { ties: CupTie[]; championNid: number | null } {
  const ties: CupTie[] = [];
  let field = [...bracket];
  let round = 0;
  let championNid: number | null = null;

  while (field.length > 1) {
    const { ties: roundTies, winners } = playKnockoutRound(field, matchData, lid, season, round, delta, injured);
    if (winners.length === 0) break; // defensive: nothing playable
    ties.push(...roundTies);
    if (winners.length === 1) championNid = winners[0];
    field = winners;
    round++;
  }

  return { ties, championNid };
}
