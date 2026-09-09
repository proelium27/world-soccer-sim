/**
 * A competition is one league a set of clubs plays in — one entry per
 * division per country. Teams point at a competition via StoredTeam.compId.
 * New saves span twelve countries (England, Spain, Italy, Germany, France,
 * Netherlands, Portugal, Belgium, Turkey, Greece, Scotland, Serbia), each a
 * two-division pyramid; England-only saves predating the world expansion keep just
 * competitions 0/1. Everything below the big four is deliberately weaker —
 * see COUNTRY_STRENGTH_OFFSET in constants.ts. Ids are stable forever within a
 * save: an old save's legacy division values (0 = English D1, 1 = English D2)
 * are already valid compIds by construction.
 *
 * **Division sizes are the real ones**, not a uniform 20: England/Spain/Italy
 * 20, Germany/France/Portugal/Turkey/Netherlands 18, Belgium/Serbia 16, Greece
 * 14, Scotland 12, with second tiers to match. A division is capped at
 * MAX_DIVISION_TEAMS (20) because a double round robin of n clubs needs 2(n-1)
 * matchdays and the calendar is a fixed 38-matchday grid — which is why
 * England's real 24-club second tier is 20 here. A smaller division SPREADS its
 * rounds across the same grid rather than finishing early (see
 * buildCompetitionSchedule), so the transfer windows, both continental
 * competitions and the run-in all still line up.
 *
 * Promotion counts scale with the divisions they connect: 3 where both are big,
 * 2 for Portugal/Belgium/Netherlands/Greece/Serbia, 1 for Scotland — 3 up out of
 * a 10-club second tier would churn a third of it every season.
 *
 * The table's ORDER is not the strength ladder — it is generation order, and
 * appending is what keeps every existing country's players byte-identical when
 * a new one is added (see generateWorld). The Netherlands sits above Portugal
 * on the ladder while being appended after Turkey, which is fine and expected.
 *
 * **Keep the country count EVEN.** Both continental fields are derived from it
 * — Continental Cup = 2C + 8, Continental Shield = 2C — and the league-phase
 * draw can only build a field that is a multiple of 4 (two pots, each even, each
 * matched perfectly). An odd C puts both on 4n+2, so both get trimmed and clubs
 * that qualified on league position are cut. At C=11 the Cup wants 30 and gets
 * 28, the Shield wants 22 and gets 20. There is no uniform slot rule that fixes
 * an odd count: it forces weak-league slots to a multiple of 4, i.e. a 44-club
 * Cup. Add countries in pairs.
 */
import {
  COUNTRY_STRENGTH_OFFSET, COUNTRY_BUDGET_SCALE, LEAGUE_BASE, divisionStrengthOffset,
  CUP_STRONG_LEAGUE_SLOTS, CUP_WEAK_LEAGUE_SLOTS, CUP_MIN_FIELD,
  SHIELD_STRONG_LEAGUE_SLOTS, SHIELD_WEAK_LEAGUE_SLOTS, largestValidCupField,
  NUM_TEAMS, NUM_TEAMS_D2, NUM_TEAMS_D3, PROMOTION_RELEGATION_COUNT,
  COUNTRY_PLAYOFF_FORMAT, DEFAULT_PLAYOFF_FORMAT, type PlayoffFormat,
} from "./constants.js";
import {
  LEAGUE_NATIONALITY_WEIGHTS, sanitizeNationalityWeights, type NationalityWeights,
} from "./players/nationalities.js";

export interface Competition {
  id: number;
  country: string;
  /**
   * Depth in this country's pyramid: 1 is the top flight, 2 the division below
   * it, and so on. A plain number rather than a union, because the pyramid's
   * depth is a per-country choice (see LeagueSpec.divisions) and the sim's
   * tier-keyed values are formulas over it rather than a two-entry table.
   *
   * Only ever compare tiers WITHIN a country. Across countries it says nothing:
   * a tier-1 club in the weakest league is far below a tier-2 club in England.
   */
  tier: number;
  name: string;
  /* ── Per-league tuning ─────────────────────────────────────────────────────
   * Every knob below is OPTIONAL and falls back to the per-country tables in
   * constants.ts when absent. That fallback is the whole point: every shipped
   * competition leaves them unset, so the default world and every existing save
   * behave exactly as before and need no migration. They exist so a league the
   * player adds — which has no entry in those country tables — can carry its
   * own settings, and so the new-league screen can override a shipped league's.
   *
   * Resolve them through the accessors below (competitionStrengthOffset etc.)
   * rather than reading the fields directly, or a custom league silently gets
   * the shipped default. */
  /**
   * OVR handicap applied to every player generated into this league, in the
   * same units as COUNTRY_STRENGTH_OFFSET (roughly 0.94 OVR per point). Higher
   * = weaker. Absent → the country's shipped offset, or 0 for a country with
   * no entry.
   */
  strengthOffset?: number;
  /**
   * The league's youth-intake anchor, as an offset in the same units. Separate
   * from strengthOffset because the two answer different questions — how good
   * this league is *now* versus what it keeps regenerating toward — so a league
   * can be set up to decline (strong squads, weak academies) or to rise. Absent
   * → strengthOffset, which is the shipped behaviour: one number doing both.
   */
  academyOffset?: number;
  /**
   * Money multiplier for every club in this league, on top of the tier scale.
   * Absent → the country's COUNTRY_BUDGET_SCALE entry, or 1.
   *
   * Keep this monotonic with strengthOffset: a weaker-but-richer league climbs
   * the ladder over a dynasty and overtakes a stronger-but-poorer one, which is
   * measured (see the constant's own comment) and is the single easiest way to
   * break a world.
   */
  budgetScale?: number;
  /**
   * How many clubs this league sends to each continental competition, keyed by
   * CupCompetitionId ("continental" | "shield"). Absent (or an absent entry) →
   * the competition format's strong/weak default for this league.
   *
   * Only the slot COUNTS live here. Where each competition starts in the table
   * is always derived from the counts above it (see cupOffsetForCompetition),
   * so the fields cannot overlap or leave a gap whatever these are set to.
   */
  continentalSlots?: Partial<Record<string, number>>;
  /**
   * How many clubs play in this division. Absent → the shipped default for the
   * tier (NUM_TEAMS / NUM_TEAMS_D2).
   *
   * Must be EVEN, because the fixture generator builds a double round robin by
   * the circle method and an odd field leaves a club unpaired every round. It is
   * also capped: a division of n clubs plays 2(n-1) matchdays and the season
   * calendar is a fixed grid (see MAX_DIVISION_TEAMS), so a bigger division has
   * nowhere to put its fixtures.
   */
  teamCount?: number;
  /**
   * How many clubs swap with the division below (or above) at the end of each
   * season. Absent → PROMOTION_RELEGATION_COUNT, which is what every shipped
   * country plays and what a save made before the knob existed keeps.
   *
   * Written to BOTH divisions of a country, because buildCompetitions builds
   * the pair from one spec and they cannot drift; either one answers the
   * question. Meaningless on a one-division country, which has no partner to
   * swap with — promotionLinks emits no link for it, so this is never read.
   *
   * Resolve through competitionPromotionSpots, never the field: it also holds
   * the number inside what the divisions can supply.
   */
  promotionSpots?: number;
  /**
   * How this country settles its last promotion place — see `PlayoffFormat`.
   * Absent → `COUNTRY_PLAYOFF_FORMAT` for a shipped country, else
   * `DEFAULT_PLAYOFF_FORMAT`, so no existing save carries this field and none
   * needed migrating for it.
   *
   * Written to both divisions like `promotionSpots`, and for the same reason.
   * Resolve through `competitionPlayoffFormat`, never the field.
   */
  playoffFormat?: PlayoffFormat;
  /**
   * Three-letter code for the country, used wherever a flag would go and there
   * is no flag to draw. The game ships flag art keyed by country name, so a
   * country the player invented has none and would otherwise render an empty
   * grey swatch. Absent → derived from the country name.
   */
  abbrev?: string;
  /**
   * This league's own nationality distribution, as relative weights (see
   * NationalityWeights). Absent → the shipped per-country table, or England's
   * for a country that has none.
   *
   * That fallback is the reason this exists. A league the player adds has an
   * invented country name, which matches no shipped table, so every player it
   * generated — and every youth prospect it generates *forever*, since intake
   * draws from the same table each offseason — came out of England's
   * distribution. Naming a league "Netherlands" produced a squad that was 38%
   * English, with English names to match, and nothing said so.
   *
   * Held per COMPETITION rather than per country because that is what every
   * generation path already has in hand, and a country's two divisions always
   * receive the same table from buildCompetitions, so the duplication cannot
   * disagree with itself.
   */
  nationalities?: NationalityWeights;
}

/* ── Per-league tuning accessors ─────────────────────────────────────────────
 * One place each knob is resolved: the competition's own value if it carries
 * one, else the shipped per-country table. Every reader in the codebase goes
 * through these, so adding a league is a matter of setting fields rather than
 * hunting down each lookup. */

/** This league's OVR handicap — higher is weaker. See Competition.strengthOffset. */
export function competitionStrengthOffset(comp: Competition): number {
  return comp.strengthOffset ?? COUNTRY_STRENGTH_OFFSET[comp.country] ?? 0;
}

/**
 * This league's youth-intake anchor offset. Falls back to its *strength* offset
 * rather than to the country table directly, so a league that customises only
 * its current strength keeps academies in step with it — which is the shipped
 * behaviour, where one number does both jobs.
 */
export function competitionAcademyOffset(comp: Competition): number {
  return comp.academyOffset ?? competitionStrengthOffset(comp);
}

/**
 * The country's three-letter code: its own if it set one, else the first three
 * letters of its name. Always returns something, so a caller can use it as the
 * stand-in wherever a flag is missing without checking first.
 */
export function competitionAbbrev(comp: Competition): string {
  const own = comp.abbrev?.trim();
  if (own) return own.toUpperCase().slice(0, 3);
  return comp.country.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
}

/** How many clubs play in this division. See Competition.teamCount. */
export function competitionTeamCount(comp: Competition): number {
  if (comp.teamCount !== undefined) return comp.teamCount;
  if (comp.tier === 1) return NUM_TEAMS;
  return comp.tier === 2 ? NUM_TEAMS_D2 : NUM_TEAMS_D3;
}

/**
 * How many clubs this league promotes and relegates each season, held to
 * something both divisions can supply.
 *
 * The clamp is load-bearing rather than defensive: divisions can be different
 * sizes (see teamCount), so a 6-up-6-down setting on a league whose second tier
 * holds 8 clubs would swap most of it, and asking for more clubs than a division
 * holds would trade the two divisions wholesale. Takes the partner's size
 * because the swap needs both ends of it.
 */
export function competitionPromotionSpots(comp: Competition, partner: Competition | null): number {
  if (!partner) return 0;
  const want = comp.promotionSpots ?? partner.promotionSpots ?? PROMOTION_RELEGATION_COUNT;
  // A non-finite value would survive the clamp as NaN, which `slice(-NaN)` then
  // reads as slicing the whole table. Treat it as no swap rather than every swap.
  if (!Number.isFinite(want)) return 0;
  return Math.max(0, Math.min(
    Math.floor(want), competitionTeamCount(comp), competitionTeamCount(partner),
  ));
}

/**
 * How this country settles its last promotion place.
 *
 * Reads either division's override (they are written together), else the
 * shipped country table, else the default. Does **not** check that the country
 * can actually stage the format — a division may be too short to seat an
 * English bracket, and that is decided by `promotionPlayoffFields` against the
 * real tables, which this accessor has never seen.
 */
export function competitionPlayoffFormat(
  d1: Competition,
  d2: Competition | null,
): PlayoffFormat {
  const set = d1.playoffFormat ?? d2?.playoffFormat;
  if (set) return set;
  return COUNTRY_PLAYOFF_FORMAT[d1.country] ?? DEFAULT_PLAYOFF_FORMAT;
}

/**
 * The most clubs a division can send in ONE direction without the two ends of
 * its own table overlapping.
 *
 * Only a MIDDLE division is ever at risk, and only once a pyramid is three
 * deep: it is promoted out of at the top and relegated out of at the bottom in
 * the same season, so a count past half its size puts one club in both slices,
 * and applyCompetitionSwaps silently keeps whichever it wrote last. A top
 * flight only goes down and a bottom division only goes up, so neither has
 * anything to overlap and both take Infinity — which is what keeps a
 * two-division country reading exactly as it did before pyramids went N deep.
 */
function swapLimitOf(competitions: Competition[], comp: Competition | null): number {
  if (!comp) return Infinity;
  const chain = divisionsOf(competitions, comp.country);
  const i = chain.findIndex((c) => c.id === comp.id);
  const isMiddle = i > 0 && i < chain.length - 1;
  return isMiddle ? Math.floor(competitionTeamCount(comp) / 2) : Infinity;
}

/**
 * How many clubs actually swap between these two divisions, once the requested
 * count is clamped to what the two tables can supply and to what a middle
 * division can give up at both ends at once.
 *
 * Split out because the promotion playoff and the swap itself must agree on N
 * to the club: the playoff seats the four clubs below the automatic places, and
 * "the automatic places" is N-1. If they read different Ns the bracket and the
 * table slice overlap and a club is promoted twice.
 *
 * That is also exactly why the middle-division clamp belongs HERE rather than
 * in computeCountrySwaps, where it was first written: a clamp only the swap can
 * see IS the disagreement this function exists to prevent. It cannot bite in
 * the shipped world (the smallest middle division is 10 clubs against at most 3
 * places) but a hand-built one can reach it — MIN_DIVISION_TEAMS is 8 and
 * MAX_PROMOTION_SPOTS is 6.
 */
export function effectivePromotionSpots(
  competitions: Competition[],
  d1: Competition,
  d2: Competition | null,
  d1TableLength: number,
  d2TableLength: number,
): number {
  return Math.min(
    competitionPromotionSpots(d1, d2), d1TableLength, d2TableLength,
    swapLimitOf(competitions, d1), swapLimitOf(competitions, d2),
  );
}

/** This league's money multiplier, before the tier scale. See Competition.budgetScale. */
export function competitionBudgetScale(comp: Competition): number {
  return comp.budgetScale ?? COUNTRY_BUDGET_SCALE[comp.country] ?? 1;
}

/**
 * This league's nationality distribution, or null to mean "use the shipped
 * behaviour" (the country's own table, else England's).
 *
 * Sanitized on the way out rather than at the boundary, because a table can
 * reach a save from a hand-edited roster file or a hand-edited save as well as
 * from the world editor, and a nation with no name pool would otherwise
 * generate players with synthesized nonsense names and no flag.
 */
export function competitionNationalities(comp: Competition): NationalityWeights | null {
  return sanitizeNationalityWeights(comp.nationalities);
}

/**
 * Whether this league gets the "weak league" share of continental places, and
 * whatever else keys off league strength. Derived from the resolved offset, so
 * a custom league is classified by what it actually is rather than by whether
 * its country happens to appear in a table.
 */
export function isWeakLeague(comp: Competition): boolean {
  return competitionStrengthOffset(comp) > 0;
}

/**
 * Center strength a club's academyBase converges toward after a promotion/
 * relegation swap — its new tier's band within its own league, so a promoted
 * French club rises toward French D1's (handicapped) level, not England's.
 */
export function academyBaseCenterOf(comp: Competition): number {
  return LEAGUE_BASE - competitionAcademyOffset(comp) - divisionStrengthOffset(comp.tier);
}

export function englandCompetitions(): Competition[] {
  return [
    { id: 0, country: "England", tier: 1, name: "English Division 1" },
    { id: 1, country: "England", tier: 2, name: "English Division 2" },
  ];
}

export function worldCompetitions(): Competition[] {
  return [
    ...englandCompetitions(),
    // EVERY country runs three divisions, and the symmetry is load-bearing
    // rather than cosmetic. Giving a third tier to only some countries makes
    // those countries STRONGER over a dynasty — more clubs means more talent
    // generated and developed there, and enforceDivisionCeilings pumps the best
    // of it upward, so a three-tier country drains 60 clubs where a two-tier one
    // drains 40. Measured: with only the big four three deep, their top flights
    // ended a 20-season dynasty ~2.7 OVR stronger and BIG4->France widened from
    // +2.74 to +7.35 against a design target of ~+3.4, which dried up the weak
    // leagues' transfer receipts and put 3 of 4 audit seeds into deficit.
    //
    // The big four's third tiers take NUM_TEAMS_D3 (20) by omission — the real
    // size of a German 3. Liga even though the two divisions above it hold 18,
    // and the cap for England/Spain/Italy, whose real third tiers are bigger
    // than the 38-matchday calendar can seat (see MAX_DIVISION_TEAMS).
    { id: 2, country: "England", tier: 3, name: "English Division 3" },
    { id: 3, country: "Spain", tier: 1, name: "Spanish Division 1" },
    { id: 4, country: "Spain", tier: 2, name: "Spanish Division 2" },
    { id: 5, country: "Spain", tier: 3, name: "Spanish Division 3" },
    { id: 6, country: "Italy", tier: 1, name: "Italian Division 1" },
    { id: 7, country: "Italy", tier: 2, name: "Italian Division 2" },
    { id: 8, country: "Italy", tier: 3, name: "Italian Division 3" },
    { id: 9, country: "Germany", tier: 1, name: "German Division 1", teamCount: 18 },
    { id: 10, country: "Germany", tier: 2, name: "German Division 2", teamCount: 18 },
    { id: 11, country: "Germany", tier: 3, name: "German Division 3" },
    { id: 12, country: "France", tier: 1, name: "French Division 1", teamCount: 18 },
    { id: 13, country: "France", tier: 2, name: "French Division 2", teamCount: 18 },
    { id: 14, country: "France", tier: 3, name: "French Division 3", teamCount: 18 },
    { id: 15, country: "Portugal", tier: 1, name: "Portuguese Division 1", teamCount: 18, promotionSpots: 2 },
    { id: 16, country: "Portugal", tier: 2, name: "Portuguese Division 2", teamCount: 18, promotionSpots: 2 },
    { id: 17, country: "Portugal", tier: 3, name: "Portuguese Division 3", teamCount: 18, promotionSpots: 2 },
    { id: 18, country: "Belgium", tier: 1, name: "Belgian Division 1", teamCount: 16, promotionSpots: 2 },
    { id: 19, country: "Belgium", tier: 2, name: "Belgian Division 2", teamCount: 16, promotionSpots: 2 },
    { id: 20, country: "Belgium", tier: 3, name: "Belgian Division 3", teamCount: 16, promotionSpots: 2 },
    { id: 21, country: "Turkey", tier: 1, name: "Turkish Division 1", teamCount: 18 },
    { id: 22, country: "Turkey", tier: 2, name: "Turkish Division 2" },
    { id: 23, country: "Turkey", tier: 3, name: "Turkish Division 3", teamCount: 18 },
    { id: 24, country: "Netherlands", tier: 1, name: "Dutch Division 1", teamCount: 18, promotionSpots: 2 },
    { id: 25, country: "Netherlands", tier: 2, name: "Dutch Division 2", promotionSpots: 2 },
    { id: 26, country: "Netherlands", tier: 3, name: "Dutch Division 3", teamCount: 18, promotionSpots: 2 },
    { id: 27, country: "Scotland", tier: 1, name: "Scottish Division 1", teamCount: 12, promotionSpots: 1 },
    { id: 28, country: "Scotland", tier: 2, name: "Scottish Division 2", teamCount: 10, promotionSpots: 1 },
    { id: 29, country: "Scotland", tier: 3, name: "Scottish Division 3", teamCount: 10, promotionSpots: 1 },
    { id: 30, country: "Greece", tier: 1, name: "Greek Division 1", teamCount: 14, promotionSpots: 2 },
    { id: 31, country: "Greece", tier: 2, name: "Greek Division 2", teamCount: 16, promotionSpots: 2 },
    { id: 32, country: "Greece", tier: 3, name: "Greek Division 3", teamCount: 12, promotionSpots: 2 },
    { id: 33, country: "Serbia", tier: 1, name: "Serbian Division 1", teamCount: 16, promotionSpots: 2 },
    { id: 34, country: "Serbia", tier: 2, name: "Serbian Division 2", teamCount: 16, promotionSpots: 2 },
    { id: 35, country: "Serbia", tier: 3, name: "Serbian Division 3", teamCount: 16, promotionSpots: 2 },
  ];
}

/* ── Building a world's table ────────────────────────────────────────────────
 * A save's competitions table is fixed at creation and never regenerated, so
 * this is the only place a world's shape is decided. The new-league screen
 * assembles a list of these and hands the result to createLeagueState. */

/**
 * One country in a world: its two divisions and the knobs they carry. A country
 * is always a two-division pyramid — promotion/relegation pairs a tier-1
 * competition with exactly one tier-2 partner (see partnerOf), and a one-tier
 * country would have nothing to be relegated into.
 *
 * Every knob is optional, and leaving one out is meaningfully different from
 * setting it: absent means "fall back to the shipped country table", which is
 * what keeps a world built from the shipped countries identical to
 * worldCompetitions().
 */
export interface LeagueSpec {
  country: string;
  /**
   * How deep this country's pyramid runs. Two is the default and the shape the
   * shipped world uses; one is a country with a single professional league and
   * therefore no promotion or relegation of its own; three adds a link below.
   *
   * Depth is genuinely per-country rather than a world-wide setting, because the
   * knob that makes a third tier worth having — a real lower-league climb — is
   * only wanted where the country has the clubs to fill it.
   */
  divisions?: 1 | 2 | 3;
  /** Three-letter country code, used where a flag would go. See Competition.abbrev. */
  abbrev?: string;
  /** Clubs per division. Even, and at most MAX_DIVISION_TEAMS. */
  d1Teams?: number;
  d2Teams?: number;
  /** Ignored unless `divisions` is 3. */
  d3Teams?: number;
  /** Defaults to "<country> Division 1" / "... 2" / "... 3". */
  d1Name?: string;
  d2Name?: string;
  /** Ignored unless `divisions` is 3. */
  d3Name?: string;
  strengthOffset?: number;
  academyOffset?: number;
  budgetScale?: number;
  /** Places sent to the Continental Cup / Shield. Absent → the format default. */
  cupSlots?: number;
  shieldSlots?: number;
  /**
   * Clubs promoted and relegated between the two divisions each season. Absent
   * → PROMOTION_RELEGATION_COUNT, which is what the shipped countries play.
   * Ignored by a one-division league, which has nothing to swap with.
   */
  promotionSpots?: number;
  /**
   * How the league settles its last promotion place. Absent → the country's own
   * system for a shipped country, else the default. See PlayoffFormat.
   */
  playoffFormat?: PlayoffFormat;
  /**
   * The league's nationality mix, as relative weights. Absent → the shipped
   * country table, or England's for an invented country. Both of a country's
   * divisions get the same one.
   */
  nationalities?: NationalityWeights;
}

/**
 * The deepest pyramid a country can be built with — the upper bound on both
 * `LeagueSpec.divisions` and any `Competition.tier`. Exported so the roster
 * file's tier validation reads the same bound the world builder enforces
 * instead of carrying its own copy of the number.
 */
export const MAX_DIVISIONS = 3;

/** Drop keys whose value is undefined, so an untouched knob stays *absent*. */
function withDefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Build a competitions table from a list of countries, in the order given. Ids
 * are handed out sequentially in table order, which is also the order
 * generateWorld walks countries in, so a country's position here decides its
 * clubs' tids.
 */
export function buildCompetitions(specs: LeagueSpec[]): Competition[] {
  const out: Competition[] = [];
  for (const spec of specs) {
    const slots = withDefined({ continental: spec.cupSlots, shield: spec.shieldSlots });
    const shared = withDefined({
      abbrev: spec.abbrev,
      strengthOffset: spec.strengthOffset,
      academyOffset: spec.academyOffset,
      budgetScale: spec.budgetScale,
      promotionSpots: spec.promotionSpots,
      playoffFormat: spec.playoffFormat,
      nationalities: spec.nationalities,
      continentalSlots: Object.keys(slots).length > 0 ? slots : undefined,
    });
    // One competition per tier the country asked for, top flight first — which
    // is also the order generateWorld hands out tids in, so a country's clubs
    // occupy one contiguous block with its divisions in pyramid order inside it.
    //
    // A country with fewer divisions simply emits fewer competitions. Everything
    // that walks "each country's divisions" goes through countryDivisions, which
    // returns however many there are rather than assuming a pair.
    const names = [spec.d1Name, spec.d2Name, spec.d3Name];
    const counts = [spec.d1Teams, spec.d2Teams, spec.d3Teams];
    for (let tier = 1; tier <= (spec.divisions ?? 2); tier++) {
      out.push({
        id: out.length,
        country: spec.country,
        tier,
        // Trimmed, and an all-whitespace name counts as none: the name box is a
        // free-text field the player can empty, and a blank league name reads as
        // a broken game rather than as a choice.
        name: names[tier - 1]?.trim() || `${spec.country} Division ${tier}`,
        ...shared,
        ...withDefined({ teamCount: counts[tier - 1] }),
      });
    }
  }
  return out;
}

/**
 * What a spec's absent knobs actually resolve to when the world gets built.
 *
 * Every knob on a LeagueSpec is optional, and absent means "whatever the shipped
 * country table says" — which is what keeps a world of untouched shipped
 * countries identical to worldCompetitions(). That is exactly right for storage
 * and useless for a CONTROL: a slider has to show a number, and showing 0 for a
 * league that really sits at France's handicap is a lie the player then acts on.
 *
 * So the world editor displays these and writes a field only when the player
 * moves something. Absence survives being looked at, which is the property the
 * byte-identical-world test rests on.
 *
 * Shared with worldTuningWarnings rather than duplicated, because a warning that
 * resolves a default differently from the control beside it fires on the wrong
 * worlds.
 */
export interface ResolvedLeagueSpec {
  divisions: 1 | 2 | 3;
  strengthOffset: number;
  budgetScale: number;
  d1Teams: number;
  d2Teams: number;
  d3Teams: number;
  promotionSpots: number;
  playoffFormat: PlayoffFormat;
  cupSlots: number;
  shieldSlots: number;
  nationalities: NationalityWeights;
}

export function resolveLeagueSpec(spec: LeagueSpec): ResolvedLeagueSpec {
  const strengthOffset = spec.strengthOffset ?? COUNTRY_STRENGTH_OFFSET[spec.country] ?? 0;
  // The same test isWeakLeague applies to a built competition, and kept on the
  // RESOLVED offset rather than on whether the country appears in a table — so a
  // shipped league the player has weakened takes the weak league's places, which
  // is what the world will actually do with it.
  const weak = strengthOffset > 0;
  return {
    divisions: spec.divisions ?? 2,
    strengthOffset,
    budgetScale: spec.budgetScale ?? COUNTRY_BUDGET_SCALE[spec.country] ?? 1,
    d1Teams: spec.d1Teams ?? NUM_TEAMS,
    d2Teams: spec.d2Teams ?? NUM_TEAMS_D2,
    d3Teams: spec.d3Teams ?? NUM_TEAMS_D3,
    promotionSpots: spec.promotionSpots ?? PROMOTION_RELEGATION_COUNT,
    playoffFormat: spec.playoffFormat
      ?? COUNTRY_PLAYOFF_FORMAT[spec.country] ?? DEFAULT_PLAYOFF_FORMAT,
    cupSlots: spec.cupSlots ?? (weak ? CUP_WEAK_LEAGUE_SLOTS : CUP_STRONG_LEAGUE_SLOTS),
    shieldSlots: spec.shieldSlots ?? (weak ? SHIELD_WEAK_LEAGUE_SLOTS : SHIELD_STRONG_LEAGUE_SLOTS),
    // England's table is the honest answer for a country with no table of its
    // own, because England's is what pickNationality would actually draw from.
    nationalities: spec.nationalities
      ?? LEAGUE_NATIONALITY_WEIGHTS[spec.country]
      ?? LEAGUE_NATIONALITY_WEIGHTS.England,
  };
}

/**
 * The money scale that keeps a league of this strength in step with the shipped
 * ladder. Fitted to the shipped pairs (offset 0 → 1.0, 10 → 0.5, 12 → 0.4), and
 * used as the default when a player adds a league so the common case lands on a
 * world that behaves.
 */
export function suggestedBudgetScale(strengthOffset: number): number {
  const scale = 1 - 0.05 * strengthOffset;
  return Math.round(Math.min(1, Math.max(0.25, scale)) * 100) / 100;
}

/**
 * Problems with a world's tuning that the player should see before generating
 * it. Advisory, never blocking — it is their world — but these are failure modes
 * that take a dynasty to show up and read as bugs when they do, so they are
 * worth saying out loud at the one moment they can still be changed.
 *
 * The money-versus-strength check is the important one and is measured, not
 * theoretical: a weaker-but-richer league climbs the ladder over 20 seasons and
 * overtakes a stronger-but-poorer one (see COUNTRY_BUDGET_SCALE's comment for
 * the 2.23-OVR inversion this describes).
 */
export function worldTuningWarnings(specs: LeagueSpec[]): string[] {
  const out: string[] = [];
  if (specs.length === 0) return ["A world needs at least one league."];

  const resolved = specs.map(resolveLeagueSpec);
  const named = specs.map((s, i) => ({
    country: s.country,
    strength: resolved[i].strengthOffset,
    money: resolved[i].budgetScale,
  }));
  for (const a of named) {
    for (const b of named) {
      // a is the weaker league (higher offset) but has the bigger budget.
      if (a.strength > b.strength && a.money > b.money) {
        out.push(
          `${a.country} is weaker than ${b.country} but richer. Over a long save the`
          + ` richer league climbs, so ${a.country} will likely end up above`
          + ` ${b.country} rather than below it.`,
        );
      }
    }
  }

  const duplicates = specs
    .map((s) => s.country.trim().toLowerCase())
    .filter((c, i, all) => all.indexOf(c) !== i);
  for (const dupe of new Set(duplicates)) {
    out.push(`Two leagues are both called "${dupe}". Give them different countries.`);
  }

  // Division names are the player's to set, and a roster file finds the
  // competition it fills BY NAME — so two divisions sharing one name means a
  // file aimed at that name silently fills only one of them. Checked across the
  // whole world rather than within a country, since a rename can collide with
  // any other league's name, not just its own partner's.
  // Reported as the player typed it, not folded to the key used to compare —
  // a warning that quotes a name back in different letters reads like it is
  // talking about something else.
  const seenNames = new Map<string, string>();
  const dupeNames = new Map<string, string>();
  for (const comp of buildCompetitions(specs)) {
    const key = comp.name.trim().toLowerCase();
    if (seenNames.has(key)) dupeNames.set(key, seenNames.get(key)!);
    else seenNames.set(key, comp.name.trim());
  }
  for (const dupe of dupeNames.values()) {
    out.push(
      `Two divisions are both called "${dupe}". A roster file aimed at that name can`
      + ` only fill one of them, so give them different names.`,
    );
  }

  // Each continental competition needs a field it can actually build (see
  // isValidCupFieldSize): big enough to seed the whole structure, and a size the
  // league-phase draw can pair. Counted the same way cupPlan counts it, defaults
  // included, rather than guessed from the number of countries.
  //
  // Both failures are worth saying out loud, and the second is the one players
  // won't see coming: places are NOT redistributed, so adding a league grows the
  // field — but only up to the next size the draw can build. Land on an awkward
  // total and the lowest-placed qualifiers in the WORLD are cut, which quietly
  // costs a different league a place it thought it had.
  const fields: [string, number][] = [
    ["Continental Cup", resolved.reduce((total, r) => total + r.cupSlots, 0)],
    ["Continental Shield", resolved.reduce((total, r) => total + r.shieldSlots, 0)],
  ];

  for (const [name, asked] of fields) {
    const played = largestValidCupField(asked);
    if (played === 0) {
      out.push(
        `Only ${asked} clubs would qualify for the ${name}, and it needs`
        + ` ${CUP_MIN_FIELD}. Add more leagues or more places`
        + ` per league, or it won't run.`,
      );
    } else if (played < asked) {
      out.push(
        `${asked} clubs would qualify for the ${name} but it can only field ${played},`
        + ` so the ${asked - played} lowest-placed of them would miss out every season —`
        + ` taking the place off whichever league finished worst, not off the one that`
        + ` added them. Field sizes go up in fours.`,
      );
    }
  }
  return [...new Set(out)];
}

/**
 * The shipped world expressed as specs, so the new-league screen can start from
 * it and let the player toggle countries off, retune one, or append their own.
 * Every knob is left absent, so building these back returns exactly
 * worldCompetitions() — pinned by a test.
 */
export function worldLeagueSpecs(): LeagueSpec[] {
  return countryDivisions(worldCompetitions()).map(({ country, divisions }) => {
    const [d1, d2, d3] = divisions;
    return {
      country,
      d1Name: d1.name,
      // Only carried when actually set, so a country on the shipped defaults still
      // round-trips to a competition with the field absent rather than spelled out.
      ...(d1.teamCount === undefined ? {} : { d1Teams: d1.teamCount }),
      ...(d2?.teamCount === undefined ? {} : { d2Teams: d2.teamCount }),
      ...(d3?.teamCount === undefined ? {} : { d3Teams: d3.teamCount }),
      ...(d1.promotionSpots === undefined ? {} : { promotionSpots: d1.promotionSpots }),
      ...(d1.playoffFormat === undefined ? {} : { playoffFormat: d1.playoffFormat }),
      ...(d2 ? { d2Name: d2.name } : {}),
      ...(d3 ? { d3Name: d3.name } : {}),
      // Two is the default, so only a country that differs spells it out — which
      // is what keeps buildCompetitions(worldLeagueSpecs()) byte-identical to
      // worldCompetitions() for every shipped country.
      ...(divisions.length === 2 ? {} : { divisions: divisions.length as 1 | 2 | 3 }),
    };
  });
}

export function competitionOf(competitions: Competition[], compId: number): Competition {
  const comp = competitions.find((c) => c.id === compId);
  if (!comp) throw new Error(`Unknown compId ${compId}`);
  return comp;
}

export function tierOf(competitions: Competition[], compId: number): number {
  return competitionOf(competitions, compId).tier;
}

/**
 * One country's divisions, top flight first.
 *
 * THE primitive for anything that walks a pyramid, and it replaced a
 * `partnerOrNull` that asked for "the other competition in this country". That
 * question has no answer past two divisions — the old implementation returned
 * whichever same-country competition came first in the table, which is right by
 * luck in a two-tier world and silently wrong in a three-tier one. Ask for the
 * chain, or for the specific neighbour you mean (divisionAbove/divisionBelow).
 */
export function divisionsOf(competitions: Competition[], country: string): Competition[] {
  return competitions
    .filter((c) => c.country === country)
    .sort((a, b) => a.tier - b.tier || a.id - b.id);
}

/**
 * The division a club is promoted INTO, or null when it is already in the top
 * flight. Adjacent by tier rather than "the other one", so the middle division
 * of a three-tier country resolves upward correctly.
 */
export function divisionAbove(
  competitions: Competition[],
  compId: number,
): Competition | null {
  const comp = competitionOf(competitions, compId);
  const chain = divisionsOf(competitions, comp.country);
  const i = chain.findIndex((c) => c.id === comp.id);
  return i > 0 ? chain[i - 1] : null;
}

/** The division a club is relegated INTO, or null when it is already the bottom one. */
export function divisionBelow(
  competitions: Competition[],
  compId: number,
): Competition | null {
  const comp = competitionOf(competitions, compId);
  const chain = divisionsOf(competitions, comp.country);
  const i = chain.findIndex((c) => c.id === comp.id);
  return i >= 0 && i < chain.length - 1 ? chain[i + 1] : null;
}

/** Every country's divisions, top flight first, in the table's tier-1 order. */
export interface CountryDivisions {
  country: string;
  /** At least one, top flight first. A one-division country has exactly one. */
  divisions: Competition[];
}

/**
 * Every country's division chain, derived from the table rather than assumed
 * from array position — shared by every caller that walks "each country's
 * divisions" (world generation, tid layout, promotion and relegation) so the
 * ordering rule has exactly one implementation to keep correct.
 */
export function countryDivisions(competitions: Competition[]): CountryDivisions[] {
  return competitions
    .filter((c) => c.tier === 1)
    .map((d1) => ({ country: d1.country, divisions: divisionsOf(competitions, d1.country) }));
}

/** One promotion and relegation link: clubs swap between these two divisions. */
export interface PromotionLink {
  upper: Competition;
  lower: Competition;
}

/**
 * Every adjacent pair of divisions in the world, top-down within each country.
 *
 * A one-division country contributes none, which is what gives it no promotion
 * or relegation for free. A three-division country contributes two, and the
 * top-down order matters to callers that apply them in sequence.
 */
export function promotionLinks(competitions: Competition[]): PromotionLink[] {
  return countryDivisions(competitions).flatMap(({ divisions }) =>
    divisions.slice(0, -1).map((upper, i) => ({ upper, lower: divisions[i + 1] })),
  );
}

/** Unique country names, in table order. */
export function countriesOf(competitions: Competition[]): string[] {
  return [...new Set(competitions.map((c) => c.country))];
}

/**
 * How many countries "the top leagues" preset covers. Five because that is what
 * people mean by it, and in the shipped world it lands exactly on the big four
 * plus France — but it is applied to whatever the world's own strength ladder
 * says, never to a list of country names (see `strongestCountries`).
 */
export const TOP_LEAGUE_COUNTRY_COUNT = 5;

/**
 * The `count` strongest countries, by the strength offset of their top flight.
 *
 * Derived rather than listed, and that is load-bearing: the world is editable
 * (leagues can be added, renamed and retuned in World setup), so a hardcoded
 * ["England", "Spain", ...] would go on claiming to be the strongest leagues in
 * a world where it is not, silently. Ties keep table order, so the shipped big
 * four — all at offset 0 — come out in the order they are generated in.
 */
export function strongestCountries(competitions: Competition[], count: number): string[] {
  const offsetOf = (country: string): number => {
    const divisions = divisionsOf(competitions, country);
    // A country always has a tier-1 division; fall back rather than throw so a
    // half-built custom world sorts to the bottom instead of breaking the page.
    return divisions.length > 0 ? competitionStrengthOffset(divisions[0]) : Infinity;
  };
  return countriesOf(competitions)
    .map((country, i) => ({ country, offset: offsetOf(country), i }))
    .sort((a, b) => a.offset - b.offset || a.i - b.i)
    .slice(0, Math.max(0, count))
    .map((e) => e.country);
}

/**
 * Which competitions a "where to look" control is pointing at. One control
 * rather than a country picker beside a tier picker beside a competition
 * picker: the questions people actually ask ("the top divisions", "the big
 * five", "the Spanish second tier") are each one choice, and three dropdowns to
 * express one thought is what makes a filter bar unreadable.
 */
export type CompetitionScope =
  | { kind: "all" }
  /** Every country's division at this tier — tier 1 is "top flights only". */
  | { kind: "tier"; tier: number }
  /** The top flights of the N strongest countries; see `strongestCountries`. */
  | { kind: "topLeagues"; countries: number }
  /** Every division of one country. */
  | { kind: "country"; country: string }
  | { kind: "competition"; compId: number };

export const ALL_COMPETITIONS: CompetitionScope = { kind: "all" };

/**
 * The competition ids a scope covers, or **null for "everything"** — null
 * rather than a set holding every id, so a caller can skip the membership test
 * altogether on the common case, which is the one that walks 626 rosters.
 */
export function scopeCompIds(
  competitions: Competition[],
  scope: CompetitionScope,
): Set<number> | null {
  switch (scope.kind) {
    case "all":
      return null;
    case "tier":
      return new Set(competitions.filter((c) => c.tier === scope.tier).map((c) => c.id));
    case "topLeagues": {
      const countries = new Set(strongestCountries(competitions, scope.countries));
      return new Set(
        competitions.filter((c) => c.tier === 1 && countries.has(c.country)).map((c) => c.id),
      );
    }
    case "country":
      return new Set(competitions.filter((c) => c.country === scope.country).map((c) => c.id));
    case "competition":
      return new Set([scope.compId]);
  }
}

/**
 * A scope as a single string, so it round-trips through a `<select>` value and
 * a URL query parameter without needing a second encoding for each.
 */
export function encodeScope(scope: CompetitionScope): string {
  switch (scope.kind) {
    case "all": return "all";
    case "tier": return `tier:${scope.tier}`;
    case "topLeagues": return `top:${scope.countries}`;
    case "country": return `country:${scope.country}`;
    case "competition": return `comp:${scope.compId}`;
  }
}

/** Parse `encodeScope`'s output. Anything unrecognised reads as "everything". */
export function decodeScope(value: string): CompetitionScope {
  const sep = value.indexOf(":");
  if (sep < 0) return ALL_COMPETITIONS;
  const kind = value.slice(0, sep);
  const rest = value.slice(sep + 1);
  const n = Number(rest);
  if (kind === "tier" && Number.isFinite(n)) return { kind: "tier", tier: n };
  if (kind === "top" && Number.isFinite(n)) return { kind: "topLeagues", countries: n };
  if (kind === "comp" && Number.isFinite(n)) return { kind: "competition", compId: n };
  if (kind === "country" && rest !== "") return { kind: "country", country: rest };
  return ALL_COMPETITIONS;
}

export interface CountryClubRange {
  country: string;
  /** Inclusive start tid (== CLUBS index) for this country's block. */
  start: number;
  /** Exclusive end tid (== CLUBS index) for this country's block. */
  end: number;
}

/** One club slot in a freshly generated world: which competition a tid lands in. */
export interface TeamSlot {
  tid: number;
  compId: number;
}

/**
 * Every club slot a fresh world will have, tid -> competition, laid out exactly
 * the way generateWorld() assigns tids (countryDivisions() order, and within a
 * country its divisions top flight first). Lets a caller reason about the slot structure
 * of a save that doesn't exist yet — the new-league roster-file preview needs
 * to know which competition each tid belongs to before paying the cost of
 * generating 6000 players.
 */
export function worldTeamSlots(competitions: Competition[]): TeamSlot[] {
  const slots: TeamSlot[] = [];
  let tid = 0;
  for (const { divisions } of countryDivisions(competitions)) {
    for (const comp of divisions) {
      for (let i = 0; i < competitionTeamCount(comp); i++) {
        slots.push({ tid: tid++, compId: comp.id });
      }
    }
  }
  return slots;
}

/**
 * The tid/CLUBS-index range each country occupies, derived the same way
 * generateWorld() assigns tids (countryDivisions() order, each country's
 * divisions top flight first) rather than a hardcoded "40 per country" literal
 * — so a country added to the table, one with a single division, one with a
 * third, or one with a different number of clubs is all picked up automatically.
 */
export function countryClubRanges(competitions: Competition[]): CountryClubRange[] {
  const ranges: CountryClubRange[] = [];
  let cursor = 0;
  for (const { country, divisions } of countryDivisions(competitions)) {
    const count = divisions.reduce((sum, c) => sum + competitionTeamCount(c), 0);
    ranges.push({ country, start: cursor, end: cursor + count });
    cursor += count;
  }
  return ranges;
}

