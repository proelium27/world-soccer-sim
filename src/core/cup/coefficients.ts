import type { Competition } from "../competitions.js";
import type { CupState } from "./types.js";
import type { CupCompetitionId } from "../constants.js";
import {
  COEFFICIENT_WINDOW, COEFFICIENT_WIN_POINTS, COEFFICIENT_DRAW_POINTS,
  COEFFICIENT_TIE_WIN_POINTS, COEFFICIENT_ROUND_BONUS, COEFFICIENT_TITLE_BONUS,
  COEFFICIENT_MIN_CUP_SLOTS, COEFFICIENT_MIN_SEASONS, CONTINENTAL_CUP_FORMAT,
} from "../constants.js";
import { cupSlotsForCompetition } from "./qualification.js";
import { competitionRegion } from "../competitions.js";

/**
 * The top flights the coefficient ranks: the Continental Cup's region only.
 *
 * The coefficient is a European mechanic — it redistributes the Continental
 * Cup's places — and a league outside that region holds none of them. Counting
 * one would put a zero on the ladder, and a zero anywhere switches off the
 * one-place floor for every league (see reallocateCupSlots), so it has to be
 * filtered out rather than merely scored last.
 */
function coefficientLeagues(competitions: Competition[]): Competition[] {
  return competitions.filter(
    (c) => c.tier === 1 && competitionRegion(c) === CONTINENTAL_CUP_FORMAT.region,
  );
}

/* ── Country coefficients ────────────────────────────────────────────────────
 *
 * How many clubs a country sends to the Continental Cup used to be fixed
 * forever by its hardcoded strength class: the big four sent 4, everyone else
 * 2, and twenty seasons of Portuguese dominance changed nothing. Real football
 * moves those places around every year on a rolling association coefficient,
 * which is the one part of qualification a country can actually *earn*.
 *
 * Two properties make this safe to add, and both are load-bearing:
 *
 * ZERO-SUM. The places are redistributed, never created or destroyed. The
 * ladder is the multiset of slot counts the world already had, re-sorted onto
 * countries by coefficient rank, so the world total is arithmetically identical
 * whatever the coefficients say. That matters beyond tidiness: the league-phase
 * draw only accepts certain field sizes (isValidCupFieldSize — in practice
 * multiples of four), so a reallocation that changed the total would fail in
 * the *draw*, seasons later and far from its cause. Reusing the world's own
 * multiset also means a custom world with hand-set `continentalSlots` keeps
 * exactly the shape its author chose, just handed out on merit.
 *
 * DERIVED, NOT STORED. The coefficient is computed from the archived cups a
 * save already keeps (scorelines survive archiving; only box scores are
 * dropped), so there is no new persisted field, no migration, and an existing
 * save gets a real coefficient off its own history the moment it loads.
 *
 * Everything here is pure and takes no rng of any kind.
 * ──────────────────────────────────────────────────────────────────────── */

/** One country's continental record over the rolling window. */
export interface CountryCoefficient {
  country: string;
  /** Points per club entered, averaged over the seasons in the window. */
  coefficient: number;
  /** Seasons that contributed — fewer than the window early in a save. */
  seasons: number;
  points: number;
  clubsEntered: number;
}

/** Country of each club, for attributing a continental result. */
function countryOfTid(
  competitions: Competition[],
  teams: readonly { tid: number; compId: number }[],
): Map<number, string> {
  const countryOfComp = new Map(competitions.map((c) => [c.id, c.country]));
  const out = new Map<number, string>();
  for (const t of teams) {
    const country = countryOfComp.get(t.compId);
    // A club's COUNTRY never changes — promotion and relegation move him
    // between his country's own divisions — so the present-day map is correct
    // for every past season too, and no history lookup is needed.
    if (country !== undefined) out.set(t.tid, country);
  }
  return out;
}

/**
 * One archived competition's points and entries per country.
 *
 * Modelled on the real thing: league-phase results are worth match points, each
 * knockout tie won is worth more, and reaching each further round pays a bonus.
 * The divisor is clubs *entered*, which is what stops a country with four
 * qualifiers out-scoring one with two simply by playing more matches.
 */
function scoreCup(
  cup: CupState,
  countryOf: ReadonlyMap<number, string>,
  points: Map<string, number>,
  entries: Map<string, number>,
): void {
  const add = (tid: number, n: number): void => {
    const country = countryOf.get(tid);
    if (country === undefined) return;
    points.set(country, (points.get(country) ?? 0) + n);
  };

  for (const tid of cup.leaguePhase?.teams ?? []) {
    const country = countryOf.get(tid);
    if (country !== undefined) entries.set(country, (entries.get(country) ?? 0) + 1);
  }

  for (const m of cup.leaguePhase?.matches ?? []) {
    if (!m.played) continue;
    if (m.homeGoals > m.awayGoals) add(m.home, COEFFICIENT_WIN_POINTS);
    else if (m.awayGoals > m.homeGoals) add(m.away, COEFFICIENT_WIN_POINTS);
    else {
      add(m.home, COEFFICIENT_DRAW_POINTS);
      add(m.away, COEFFICIENT_DRAW_POINTS);
    }
  }

  for (const tie of cup.playoff?.ties ?? []) add(tie.winner, COEFFICIENT_TIE_WIN_POINTS);

  // Knockout ties, plus a bonus for each round a club reached. `round` is 0 for
  // the quarter-finals, so a club appearing in round r reached r rounds past
  // the bracket's start, and its winner goes on to the next.
  for (const tie of cup.ties ?? []) {
    add(tie.winner, COEFFICIENT_TIE_WIN_POINTS);
    // Both sides of a tie reached that round, so both take its bonus. Winning
    // the competition pays its own bonus on top, kept separate so a finalist
    // and a champion are not accidentally scored the same.
    const bonus = COEFFICIENT_ROUND_BONUS[tie.round] ?? 0;
    add(tie.home, bonus);
    add(tie.away, bonus);
  }
  if (cup.championTid !== null && cup.championTid >= 0) add(cup.championTid, COEFFICIENT_TITLE_BONUS);
}

/**
 * Each country's rolling coefficient, best first, from the archived
 * competitions of the last COEFFICIENT_WINDOW seasons.
 *
 * `histories` is every archived competition (Cup and Shield together, exactly
 * as UEFA pools its competitions); `season` is the season being allocated FOR,
 * so the window is the seasons strictly before it.
 */
export function countryCoefficients(
  competitions: Competition[],
  teams: readonly { tid: number; compId: number }[],
  histories: readonly CupState[][],
  season: number,
): CountryCoefficient[] {
  const countryOf = countryOfTid(competitions, teams);
  const cups = histories
    .flat()
    .filter((c) => c.season < season && c.season >= season - COEFFICIENT_WINDOW);

  const points = new Map<string, number>();
  const entries = new Map<string, number>();
  const seasonsSeen = new Set<number>();
  for (const cup of cups) {
    scoreCup(cup, countryOf, points, entries);
    seasonsSeen.add(cup.season);
  }

  const countries = [...new Set(coefficientLeagues(competitions).map((c) => c.country))];
  return countries
    .map((country) => {
      const p = points.get(country) ?? 0;
      const e = entries.get(country) ?? 0;
      return {
        country,
        // Points per club entered. A country with no entries at all scores 0
        // rather than dividing by zero, which is also the right answer: it has
        // no continental record to rank on.
        coefficient: e > 0 ? p / e : 0,
        seasons: seasonsSeen.size,
        points: p,
        clubsEntered: e,
      };
    })
    .sort((a, b) => b.coefficient - a.coefficient || a.country.localeCompare(b.country));
}

/**
 * How many Continental Cup places each tier-1 league gets, given the
 * coefficients — the world's own ladder of slot counts, handed out by merit.
 *
 * Returns null while there is too little record to rank on (a new save's first
 * seasons — see COEFFICIENT_MIN_SEASONS), so the caller falls back to the
 * shipped strength-class allocation rather than shuffling places on the
 * strength of one noisy season.
 */
export function reallocateCupSlots(
  competitions: Competition[],
  coefficients: readonly CountryCoefficient[],
): Map<number, number> | null {
  if (coefficients.every((c) => c.clubsEntered === 0)) return null;
  // Too little history to rank on. See COEFFICIENT_MIN_SEASONS: a world's first
  // cups are its noisiest data, and reallocating on one season of it moves
  // places for reasons nobody can see.
  if ((coefficients[0]?.seasons ?? 0) < COEFFICIENT_MIN_SEASONS) return null;

  const tier1 = coefficientLeagues(competitions);
  // The ladder IS the world's current multiset of slot counts, so the total
  // cannot move. See this file's header on why that is a correctness
  // requirement and not just tidiness.
  const ladder = tier1
    .map((c) => cupSlotsForCompetition(c, CONTINENTAL_CUP_FORMAT))
    .sort((a, b) => b - a);

  const rank = new Map(coefficients.map((c, i) => [c.country, i]));
  const ordered = [...tier1].sort((a, b) => {
    const ra = rank.get(a.country) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.country) ?? Number.MAX_SAFE_INTEGER;
    // Ties break on the league's own id, never on anything derived, so the
    // allocation is stable from one season to the next.
    return ra - rb || a.id - b.id;
  });

  const out = new Map<number, number>();
  ordered.forEach((comp, i) => out.set(comp.id, ladder[i] ?? 0));

  // Nobody is left with nothing: a league that sends no one has no way to earn a
  // coefficient, so it has no way back up the ladder — a trapdoor rather than a
  // demotion. The place is taken from the top, which by construction has the
  // most to give, so the total still holds.
  //
  // Skipped entirely when the world's OWN ladder already puts a league below
  // the floor. That means a league was authored with no continental place at
  // all (`continentalSlots`), which is a deliberate choice about the world
  // rather than something the reordering did, and forcing it into the Cup would
  // overrule its author.
  if (ladder.every((n) => n >= COEFFICIENT_MIN_CUP_SLOTS)) {
    for (const comp of ordered) {
      const have = out.get(comp.id) ?? 0;
      if (have >= COEFFICIENT_MIN_CUP_SLOTS) continue;
      const donor = ordered.find((c) => (out.get(c.id) ?? 0) > COEFFICIENT_MIN_CUP_SLOTS);
      if (!donor) break;
      out.set(donor.id, (out.get(donor.id) ?? 0) - 1);
      out.set(comp.id, have + 1);
    }
  }
  return out;
}

/**
 * The per-competition slot overrides for a season, or null to use the defaults.
 *
 * `enabled` is `LeagueStore.rollingCoefficients` — the save-scoped setting for
 * whether places are re-earned at all. It is a REQUIRED parameter rather than a
 * defaulted one on purpose: this is the single choke point every consumer of
 * the allocation goes through (the offseason, the Standings projection and the
 * News Feed), and a default would let a new caller silently opt a save that
 * turned the feature off back into it. Off, returning null puts every one of
 * them back on `Competition.continentalSlots` / the shipped strength classes,
 * which is the same fallback a save too young to have a coefficient takes.
 */
export function coefficientSlots(
  competitions: Competition[],
  teams: readonly { tid: number; compId: number }[],
  histories: readonly CupState[][],
  season: number,
  enabled: boolean,
): Map<number, Partial<Record<CupCompetitionId, number>>> | null {
  if (!enabled) return null;
  const coefficients = countryCoefficients(competitions, teams, histories, season);
  const cupSlots = reallocateCupSlots(competitions, coefficients);
  if (!cupSlots) return null;
  const out = new Map<number, Partial<Record<CupCompetitionId, number>>>();
  for (const [compId, slots] of cupSlots) {
    // Only the Cup's places move. The Shield hands every league the same number
    // (two), so ranking them would reallocate nothing.
    out.set(compId, { continental: slots });
  }
  return out;
}
