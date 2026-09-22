import type { Competition } from "../competitions.js";
import type { StandingsRow } from "../standings.js";
import type { CupCompetitionId, CupFormat } from "../constants.js";
import {
  CUP_FORMATS, CONTINENTAL_CUP_FORMAT, CONTINENTAL_ORDER, largestValidCupField,
} from "../constants.js";
import { isWeakLeague, competitionRegion, competitionTeamCount } from "../competitions.js";
import { continentalFormatFor, type ContinentalFormats } from "./cupShape.js";

/* ── Continental qualification ───────────────────────────────────────────────
 *
 * Who plays in which continental competition next season. There are three ways
 * in, and they are taken in this order:
 *
 *   1. TITLE HOLDER — the Continental Cup's winner keeps his place in it, and
 *      the Shield's winner is promoted into the Cup. Real since 2015, and the
 *      reason a second competition is worth winning.
 *   2. DOMESTIC CUP WINNER — a country's cup champion takes one of that
 *      country's Shield places. He may be a SECOND-DIVISION club: the domestic
 *      cups are contested by both tiers, and a lower-division winner reaching
 *      Europe is real (see `drawGroupOf` for the one thing that depends on it).
 *   3. LEAGUE POSITION — everything left over, from the top of each tier-1
 *      table down.
 *
 * This used to be rule 3 alone, implemented as "slice each league's table at an
 * offset derived by summing the slots of every competition above this one". The
 * derived offset was what guaranteed the fields were disjoint and left no place
 * unused. Routes 1 and 2 break that: a club can now enter from ninth, so the
 * qualifying places are no longer a contiguous band and no offset describes
 * them.
 *
 * So the offset stops being the MECHANISM and becomes an OUTPUT. All
 * competitions are allocated together in one pass down CONTINENTAL_ORDER, and a
 * club is placed exactly once — in the best competition he qualifies for —
 * which makes disjointness structural rather than arithmetic. The slot COUNTS
 * per league are still the source of truth and are untouched, so field sizes
 * cannot move: a club entering by cup or holder route displaces his own
 * league's lowest league-position qualifier, who cascades down to the next
 * competition (and its lowest qualifier drops out). That matters more than it
 * looks — the league-phase draw only accepts certain field sizes, so a route
 * that grew a field would break the draw rather than the qualification.
 * ──────────────────────────────────────────────────────────────────────── */

/** The Swiss cup's structural plan for a world, or null if it can't field one. */
export interface CupPlan {
  strong: Competition[];
  weak: Competition[];
  total: number; // league-phase field size
}

/**
 * The Swiss cup plan for a world: which tier-1 leagues are strong/weak and the
 * resulting field size. Valid only when the field can seed the whole structure —
 * enough clubs for the top-4 + eight-team playoff, an even split into the draw's
 * pots, and enough per pot for the games each club plays. England-only legacy
 * worlds (one tier-1 league) and other undersized worlds return null (no cup).
 *
 * A world can field one competition and not another (a two-league world has
 * enough clubs for the Continental Cup's field but not for the Shield's), so
 * this is asked per format rather than once for the world.
 */
export function cupPlan(
  competitions: Competition[],
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  /**
   * This season's per-league slot counts (coefficients, and any size setting).
   * **Must be the same map the allocation is given**, or the plan promises a
   * field size the qualifying pass doesn't produce and `buildCupState` answers
   * a mismatch by building no competition at all.
   */
  overrides?: SlotOverrides,
): CupPlan | null {
  // Only this competition's own continent: a league elsewhere earns no places
  // in it, so it must not count toward the plan's strong/weak split either.
  const tier1 = competitions.filter((c) => c.tier === 1 && competitionRegion(c) === format.region);
  const strong = tier1.filter((c) => !isWeakLeague(c));
  const weak = tier1.filter((c) => isWeakLeague(c));
  // Summed per league rather than counted by class, because a league can carry
  // its own slot count (Competition.continentalSlots) that differs from the
  // strong/weak default its class would give it.
  const qualified = tier1.reduce((n, c) => n + cupSlotsForCompetition(c, format, overrides), 0);
  // Trim to a size the league-phase draw can actually build (see
  // isValidCupFieldSize). The shipped world lands exactly on one — 32 for the
  // Cup, 24 for the Shield — so this changes nothing there; a world whose
  // leagues send an awkward total now gets the largest valid field rather than
  // crashing the offseason on the draw.
  const total = largestValidCupField(qualified);
  if (total === 0) return null;
  return { strong, weak, total };
}

/**
 * Whether this world can field the given competition. Used by the UI to decide
 * whether to show the qualification zone / competition page for a given world.
 */
export function worldHasCup(
  competitions: Competition[],
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  overrides?: SlotOverrides,
): boolean {
  return cupPlan(competitions, format, overrides) !== null;
}

/**
 * Per-league slot counts for a single season, overriding both a league's own
 * `continentalSlots` and the strong/weak default. Keyed by compId.
 *
 * This is how the country coefficient moves places between countries (see
 * cup/coefficients.ts) WITHOUT writing to `Competition.continentalSlots`, which
 * belongs to whoever authored the league and would be destroyed by a season's
 * reallocation. A season's allocation is a fact about that season, not about
 * the league, so it is passed in rather than stored.
 */
export type SlotOverrides = ReadonlyMap<number, Partial<Record<CupCompetitionId, number>>>;

/* ── Competition size (God Mode) ─────────────────────────────────────────────
 *
 * `ContinentalFormatSettings.fieldSize` says how many clubs contest a
 * competition. It is applied HERE, as a SlotOverrides map, rather than by
 * trimming the field at the draw — and that choice is the whole design:
 *
 *  - `cupSlotsForCompetition` is the single thing every other qualification
 *    question is asked through, so rescaling the slots reaches `cupPlan`, the
 *    allocation, `cupOffsetForCompetition`, `cupSlotRange`, the Standings
 *    shading and the Cup page legend for free, and none of them can disagree.
 *  - It is the mechanism the country coefficients already use, so the two
 *    compose: coefficients re-sort the places between countries, then the size
 *    scales that allocation to the target.
 *  - Trimming at the draw could only ever make a competition SMALLER. Scaling
 *    the slots makes a bigger one real — each league simply sends more of its
 *    table — and the competitions below it slide down underneath, because their
 *    offset is derived from the slots above them rather than stored.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Rescale each league's places so a competition fields `target` clubs, by
 * largest remainder over the allocation it would otherwise have.
 *
 * Proportional rather than flat, deliberately: the ladder of places (a big-four
 * league's four against a weak league's two, and whatever the coefficients have
 * since done to that) is the shape the world was tuned with, and scaling keeps
 * it. A flat "+1 each" would hand the smallest leagues the same gain as the
 * biggest and flatten the ladder every time the size moved.
 *
 * `capOf` bounds a league's places by the clubs it actually has left after the
 * competitions above it have taken theirs. Without it a target larger than the
 * leagues can fill produces a field shorter than `cupPlan` promised, and
 * `buildCupState` answers a short field with **null** — no competition at all,
 * silently. Anything the caps make unreachable is simply not allocated, so the
 * competition comes out as big as the world can make it.
 */
function rescaleSlots(
  base: Map<number, number>,
  target: number,
  capOf: (compId: number) => number,
): Map<number, number> {
  const ids = [...base.keys()];
  const total = [...base.values()].reduce((a, b) => a + b, 0);
  const out = new Map<number, number>();
  if (total <= 0 || ids.length === 0) return out;

  const exact = new Map<number, number>();
  for (const id of ids) exact.set(id, ((base.get(id) ?? 0) * target) / total);
  // Floor everyone, then hand the remaining places out to the largest
  // fractional parts. Ties break on compId so the result is order-free — two
  // leagues with identical claims must not swap places because the map was
  // built in a different order.
  let handed = 0;
  for (const id of ids) {
    const n = Math.min(Math.floor(exact.get(id) ?? 0), capOf(id));
    out.set(id, n);
    handed += n;
  }
  const byRemainder = [...ids].sort((a, b) => {
    const ra = (exact.get(a) ?? 0) - Math.floor(exact.get(a) ?? 0);
    const rb = (exact.get(b) ?? 0) - Math.floor(exact.get(b) ?? 0);
    return rb - ra || a - b;
  });
  // Several passes, because a league that hits its cap passes its share on to
  // the next in line rather than leaving the competition short.
  for (let pass = 0; handed < target && pass <= ids.length; pass++) {
    let moved = false;
    for (const id of byRemainder) {
      if (handed >= target) break;
      if ((out.get(id) ?? 0) >= capOf(id)) continue;
      out.set(id, (out.get(id) ?? 0) + 1);
      handed++;
      moved = true;
    }
    if (!moved) break; // every league is at its cap
  }
  return out;
}

/**
 * The per-league slot counts a save actually plays, combining the country
 * coefficients (`base`, which is zero-sum and moves places between countries)
 * with each competition's size setting (which changes how many there are).
 *
 * **Every caller that asks who qualifies must go through this**, or the
 * Standings shading promises a place the offseason then doesn't award. There
 * are three: the offseason draw, the live Standings projection and the
 * continental news feed.
 *
 * Returns `base` untouched when no competition sets a size, so a save that has
 * never opened the setting is byte-identical.
 */
export function continentalSlotOverrides(
  competitions: Competition[],
  formats: ContinentalFormats | undefined,
  base: SlotOverrides | null,
): SlotOverrides | null {
  const anySized = CONTINENTAL_ORDER.some(
    (id) => continentalFormatFor(formats, id).fieldSize !== "auto",
  );
  if (!anySized) return base;

  const tier1 = competitions.filter((c) => c.tier === 1);
  const out = new Map<number, Partial<Record<CupCompetitionId, number>>>();
  for (const [compId, slots] of base ?? []) out.set(compId, { ...slots });
  // Places already committed to competitions higher up the order, per league.
  const used = new Map<number, number>();

  const slotsNow = (comp: Competition, id: CupCompetitionId): number =>
    cupSlotsForCompetition(comp, CUP_FORMATS[id], out);

  for (const id of CONTINENTAL_ORDER) {
    const format = CUP_FORMATS[id];
    const inRegion = tier1.filter((c) => competitionRegion(c) === format.region);
    const setting = continentalFormatFor(formats, id).fieldSize;

    if (setting !== "auto") {
      const current = new Map<number, number>();
      for (const c of inRegion) current.set(c.id, slotsNow(c, id));
      const capOf = (compId: number): number => {
        const comp = inRegion.find((c) => c.id === compId);
        if (!comp) return 0;
        return Math.max(0, competitionTeamCount(comp) - (used.get(compId) ?? 0));
      };
      for (const [compId, n] of rescaleSlots(current, setting, capOf)) {
        out.set(compId, { ...out.get(compId), [id]: n });
      }
    }
    for (const c of inRegion) used.set(c.id, (used.get(c.id) ?? 0) + slotsNow(c, id));
  }
  return out;
}

/** How many league-phase places a tier-1 competition earns in this competition. */
export function cupSlotsForCompetition(
  comp: Competition,
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  overrides?: SlotOverrides,
): number {
  // Checked before every override, including a league's own continentalSlots:
  // a region is a hard boundary, not a default. Without it a hand-set slot count
  // could put a Brazilian club in the Continental Cup.
  if (competitionRegion(comp) !== format.region) return 0;
  const override = overrides?.get(comp.id)?.[format.id];
  if (override !== undefined) return Math.max(0, Math.floor(override));
  const own = comp.continentalSlots?.[format.id];
  if (own !== undefined) return Math.max(0, Math.floor(own));
  return isWeakLeague(comp) ? format.weakSlots : format.strongSlots;
}

/**
 * How many places down this competition would start in a given league's table
 * if league position were the only way in (0 = the champion).
 *
 * This is now a DESCRIPTION rather than the mechanism — allocation places each
 * club by walking CONTINENTAL_ORDER (see allocateContinentalPlaces), so a cup
 * winner or holder entering from mid-table shifts the real places around. It
 * survives as the honest answer to "where does this competition normally start
 * in this league", which is what the Standings legend and the Manual describe.
 */
export function cupOffsetForCompetition(
  comp: Competition,
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  overrides?: SlotOverrides,
): number {
  let offset = 0;
  for (const id of CONTINENTAL_ORDER) {
    if (id === format.id) break;
    offset += cupSlotsForCompetition(comp, CUP_FORMATS[id], overrides);
  }
  return offset;
}

/**
 * The finishing positions a tier-1 league's clubs normally qualify from, as
 * 1-based ranks: `[first, last]` inclusive. The Continental Cup's strong-league
 * range is [1, 4], the Shield's [5, 6]. See cupOffsetForCompetition on why this
 * is the usual case rather than the rule.
 */
export function cupSlotRange(
  comp: Competition,
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  overrides?: SlotOverrides,
): [number, number] {
  const from = cupOffsetForCompetition(comp, format, overrides);
  return [from + 1, from + cupSlotsForCompetition(comp, format, overrides)];
}

/** How a club got in. Surfaced so the UI can say *why* a mid-table club qualified. */
export type QualificationRoute = "table" | "domestic-cup" | "holder";

/** One qualified club, before seeding. */
export interface Entrant {
  tid: number;
  /** The competition whose table he came from — his own division, which for a domestic cup winner may be tier 2. */
  compId: number;
  country: string;
  /** 1-based finish in his own division's table (0 if he appears in no table at all). */
  rank: number;
  route: QualificationRoute;
  /**
   * What the field is seeded by: his league finish for a top-flight club, and a
   * value below every top-flight place for a second-division one. A tier-2 club
   * finishing 5th of his division is not the 5th-best club in his country, so
   * seeding him on raw rank would put him above top-flight clubs; real draws
   * put a lower-division cup winner in the bottom pot, which is what this does.
   */
  seedRank: number;
  points: number;
  gd: number;
  gf: number;
}

/**
 * The non-league routes into next season's competitions, read off the season
 * that just finished. Every field is optional and a missing one simply means
 * that route is closed — which is what an unfinished cup (`championTid` still
 * null), a world with no domestic cups, or a save's very first season all look
 * like.
 */
export interface QualificationContext {
  /** Each country's domestic cup champion — `DomesticCupState.championTid`, by country. */
  domesticCupWinners?: ReadonlyMap<string, number>;
  /** The reigning champion of each continental competition, by competition id. */
  holders?: Partial<Record<CupCompetitionId, number>>;
  /**
   * This season's per-league slot counts, from the country coefficients. Absent
   * → each league's own setting, or its strength class. Always zero-sum against
   * the defaults, so it moves places between countries without changing how
   * many the competition fields (see cup/coefficients.ts).
   */
  slots?: SlotOverrides;
}

/** Seeding is below every top-flight place; see Entrant.seedRank. */
const LOWER_DIVISION_SEED_BASE = 1000;

/**
 * A lower-division qualifier's seed: one whole band per tier below the top, so
 * a second-division club always seeds above a third-division one and neither
 * can outrank a top-flight club.
 *
 * The bands must not overlap, which is why this multiplies rather than adding a
 * flat base: with one shared base, a third-division winner and a second-division
 * one would land in the same range and the draw would rank them by league
 * position alone — treating 3rd in the third tier as better than 8th in the
 * second, which is exactly backwards.
 */
function lowerDivisionSeed(tier: number, rank: number): number {
  return LOWER_DIVISION_SEED_BASE * (tier - 1) + rank;
}

/**
 * The domestic cup route's input: each country's cup champion, from the cups of
 * the season that just finished. A cup with no champion yet (still being
 * played, or abandoned mid-save) contributes nothing, which closes the route
 * for that country rather than guessing at a winner.
 */
export function domesticCupWinners(
  cups: readonly { country: string; championTid: number | null }[] = [],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const cup of cups) {
    if (cup.championTid !== null && cup.championTid >= 0) out.set(cup.country, cup.championTid);
  }
  return out;
}

/**
 * Which competition each qualified club plays in next season, and how he got
 * there — the single primitive every other qualification question is asked
 * through (the fields themselves, and the Standings page's shading).
 *
 * Deterministic and pure: a function of the final tables plus the routes, with
 * no rng of any kind. The order clubs are considered in cannot affect the
 * result either, because a league only ever draws from its own country's clubs.
 */
export function allocateContinentalPlaces(
  competitions: Competition[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  routes: QualificationContext = {},
): Map<CupCompetitionId, Entrant[]> {
  const tier1 = competitions.filter((c) => c.tier === 1);
  // Where a club sits in the world: his own division's table (which for a
  // domestic cup winner may be a second division), so a non-table route can
  // still be seeded and displayed like any other entrant.
  const rowOf = new Map<number, { comp: Competition; rank: number; row: StandingsRow }>();
  for (const comp of competitions) {
    const table = tablesByCompId.get(comp.id) ?? [];
    table.forEach((row, i) => rowOf.set(row.tid, { comp, rank: i + 1, row }));
  }

  const entrantOf = (tid: number, route: QualificationRoute): Entrant | null => {
    const found = rowOf.get(tid);
    // A club with no table row played no league season we know about — a
    // holder whose club has since been removed, or a hand-edited save. He is
    // dropped rather than entered with invented numbers.
    if (!found) return null;
    const { comp, rank, row } = found;
    return {
      tid,
      compId: comp.id,
      country: comp.country,
      rank,
      route,
      seedRank: comp.tier === 1 ? rank : lowerDivisionSeed(comp.tier, rank),
      points: row.points,
      gd: row.gd,
      gf: row.gf,
    };
  };

  const result = new Map<CupCompetitionId, Entrant[]>();
  // A club is placed at most once, in the best competition he reaches. This set
  // is what makes the fields disjoint, and it is why the competitions have to
  // be allocated together rather than one at a time.
  const placed = new Set<number>();

  for (const id of CONTINENTAL_ORDER) {
    const format = CUP_FORMATS[id];
    const entrants: Entrant[] = [];

    for (const league of tier1) {
      const slots = cupSlotsForCompetition(league, format, routes.slots);
      if (slots <= 0) continue;
      const table = tablesByCompId.get(league.id) ?? [];
      const taken: Entrant[] = [];

      // Who this league would have sent on league position alone, worked out
      // BEFORE any special route is claimed: the top `slots` clubs not already
      // placed in a better competition.
      //
      // It exists to label the route honestly rather than to decide the field.
      // A holder who won his league is in on merit, and calling his place a
      // holder's place would put "as holders" on a first-placed row and read as
      // a bug. Note this correctly counts a club pushed down BY a holder as a
      // league qualifier of the competition he lands in, because the holder is
      // in `placed` by the time that competition is allocated.
      const onMerit = new Set<number>();
      for (const row of table) {
        if (onMerit.size >= slots) break;
        if (!placed.has(row.tid)) onMerit.add(row.tid);
      }

      const claim = (tid: number | undefined, route: QualificationRoute): void => {
        if (tid === undefined || taken.length >= slots || placed.has(tid)) return;
        const entrant = entrantOf(tid, onMerit.has(tid) ? "table" : route);
        if (!entrant || entrant.country !== league.country) return;
        taken.push(entrant);
        placed.add(tid);
      };

      // 1. Title holders. The Cup keeps its own winner and takes the Shield's.
      //    A holder who would have qualified on merit still gets claimed here,
      //    but he is in `onMerit` so he is labelled a league qualifier and he
      //    occupies the place he was going to occupy anyway — his league's
      //    field comes out identical, which is what "the place passes back down
      //    the league" means. Both holders are offered to every league; the
      //    country check inside `claim` is what keeps each to his own.
      if (id === "continental") {
        claim(routes.holders?.continental, "holder");
        claim(routes.holders?.shield, "holder");
      }
      // 2. The domestic cup winner's Shield place.
      if (id === "shield") claim(routes.domesticCupWinners?.get(league.country), "domestic-cup");
      // The Americas have a single competition, so it takes both routes the
      // European pair splits between them: its holder keeps his place, and a
      // country's cup winner takes one — the way the Copa do Brasil and Copa
      // Argentina winners go to the Libertadores.
      if (id === "americas") {
        claim(routes.holders?.americas, "holder");
        claim(routes.domesticCupWinners?.get(league.country), "domestic-cup");
      }

      // 3. League position fills whatever is left, skipping anyone already
      //    placed — in this competition or in a better one.
      for (let i = 0; i < table.length && taken.length < slots; i++) {
        const { tid } = table[i];
        if (placed.has(tid)) continue;
        const entrant = entrantOf(tid, "table");
        if (!entrant) continue;
        taken.push(entrant);
        placed.add(tid);
      }

      entrants.push(...taken);
    }

    result.set(id, entrants);
  }

  return result;
}

/**
 * Every qualified club in the world mapped to the competition he qualified for,
 * with the route that got him there. What the Standings page shades rows from,
 * so what it shows is the real allocation rather than a fixed band of finishing
 * places that a cup winner or holder can falsify.
 */
export function qualificationByTid(
  competitions: Competition[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  routes: QualificationContext = {},
): Map<number, { competition: CupCompetitionId; route: QualificationRoute }> {
  const out = new Map<number, { competition: CupCompetitionId; route: QualificationRoute }>();
  for (const [competition, entrants] of allocateContinentalPlaces(competitions, tablesByCompId, routes)) {
    for (const e of entrants) out.set(e.tid, { competition, route: e.route });
  }
  return out;
}

/** Seed order: league finish first (every champion outranks every runner-up), then points, GD, GF, tid. */
function seedSort(a: Entrant, b: Entrant): number {
  return a.seedRank - b.seedRank || b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.tid - b.tid;
}

/**
 * One competition's league-phase field, in seed order (strongest first).
 *
 * `compOf` is each qualifier's own competition — the league he came out of, for
 * display. `drawGroups` is what the league-phase draw keeps clubs apart by, and
 * is deliberately NOT the same map: see drawGroupOf.
 */
export function qualifyCupTeams(
  competitions: Competition[],
  tablesByCompId: ReadonlyMap<number, StandingsRow[]>,
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  routes: QualificationContext = {},
): { field: number[]; compOf: Map<number, number>; drawGroups: Map<number, number>; entrants: Entrant[] } {
  const plan = cupPlan(competitions, format, routes.slots);
  const all = allocateContinentalPlaces(competitions, tablesByCompId, routes).get(format.id) ?? [];
  const seeded = [...all].sort(seedSort);
  // Trimmed AFTER seeding, so what gets dropped is the weakest qualifiers in
  // the world rather than whichever league happened to be collected last.
  const entrants = plan ? seeded.slice(0, plan.total) : seeded;
  return {
    field: entrants.map((e) => e.tid),
    compOf: new Map(entrants.map((e) => [e.tid, e.compId])),
    drawGroups: drawGroupOf(entrants),
    entrants,
  };
}

/**
 * A stable per-country key for every entrant, for the league-phase draw's
 * "no two clubs from the same country meet" constraint.
 *
 * The draw used to be handed each club's compId, which was the same thing back
 * when every entrant was a top-flight club — one tier-1 competition per
 * country, so compId and country were interchangeable. A second-division
 * domestic cup winner breaks that: his compId is his own division, so he would
 * read as a different "league" from his country's top flight and could be drawn
 * against the clubs he plays every week. The draw only ever compares these keys
 * for equality, so keying on country is the same relation for an all-top-flight
 * field and the right one for a mixed field.
 */
export function drawGroupOf(entrants: Entrant[]): Map<number, number> {
  const index = new Map<string, number>();
  const out = new Map<number, number>();
  for (const e of entrants) {
    let key = index.get(e.country);
    if (key === undefined) {
      key = index.size;
      index.set(e.country, key);
    }
    out.set(e.tid, key);
  }
  return out;
}
