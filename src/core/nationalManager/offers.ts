/**
 * International reputation, and which countries come calling because of it.
 *
 * Offers are drawn on their own seeded stream (`hashInts` off lid + season +
 * NATIONAL_OFFER_STREAM), never the shared `rng` and never the club side's
 * stream — the same rule every post-hoc system in the sim follows. A shared
 * draw here would shift every downstream roll in the world according to whether
 * a federation happened to approach the user, which is exactly the class of bug
 * the rule exists to prevent.
 */
import { mulberry32, hashInts } from "../../engine/rng.js";
import {
  NATIONAL_MAX_OFFERS,
  NATIONAL_OFFER_BAND,
  NATIONAL_OFFER_LATERAL_BAND,
  NATIONAL_OFFER_CLUB_REP_WEIGHT,
  NATIONAL_OFFER_BASE_CHANCE,
  NATIONAL_OFFER_UNEMPLOYED_CHANCE,
  NATIONAL_OFFER_FORM_WEIGHT,
  NATIONAL_OFFER_MAX_CHANCE,
  NATIONAL_SACKED_PRESTIGE_PENALTY,
  NATIONAL_INTEREST_CHANCE,
  NATIONAL_INTEREST_MAX_CHANCE,
  NATIONAL_REP_BASE,
  NATIONAL_REP_TITLE_WEIGHT,
  NATIONAL_REP_CONTINENTAL_WEIGHT,
  NATIONAL_REP_QUALIFICATION_WEIGHT,
  NATIONAL_REP_OVERPERFORMANCE_WEIGHT,
  NATIONAL_REP_CAMPAIGN_WEIGHT,
  NATIONAL_REP_CAMPAIGN_CAP,
  NATIONAL_REP_SACKING_PENALTY,
} from "../constants.js";
import { interestReach } from "../manager/jobOffers.js";
import type { NationExpectation } from "./expectation.js";
import type { NationOffer, NationalStint } from "./types.js";

/** Distinct from MANAGER_OFFER_STREAM (970), so the two offer lists can't correlate. */
const NATIONAL_OFFER_STREAM = 971;
/** Rolls for countries the user asked about; the club side's 972 reasoning, one stream along. */
const NATIONAL_INTEREST_STREAM = 973;

/** A stable integer for a nation name, so its interest roll is keyed by nation rather than list order. */
function nationKey(nation: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < nation.length; i++) {
    h = Math.imul(h ^ nation.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

/**
 * The prestige a manager is matched against by federations: the biggest of
 * international reputation, the discounted club reputation and the current
 * nation, a rung lower after a dismissal. Exported so the UI can quote how
 * realistic an interest is off the same number.
 */
export function nationOfferTarget(
  reputation: number,
  clubReputation: number,
  currentPrestige: number,
  sacked: boolean,
): number {
  return Math.min(
    1,
    Math.max(
      0,
      Math.max(
        reputation / 100,
        (clubReputation / 100) * NATIONAL_OFFER_CLUB_REP_WEIGHT,
        currentPrestige,
      )
      - (sacked ? NATIONAL_SACKED_PRESTIGE_PENALTY : 0),
    ),
  );
}

/**
 * A manager's standing in the international game, 0-100 — derived from the
 * stint record, never stored, so the formula can be retuned without rewriting
 * anyone's career.
 *
 * Experience is capped for the same reason it is on the club side: seeing a
 * small nation through twelve campaigns is a career, but it shouldn't out-argue
 * a manager who actually won something.
 */
export function nationalReputation(stints: NationalStint[]): number {
  let score = NATIONAL_REP_BASE;
  let campaigns = 0;
  let sackings = 0;
  for (const s of stints) {
    score += s.titles * NATIONAL_REP_TITLE_WEIGHT;
    score += s.continentalTitles * NATIONAL_REP_CONTINENTAL_WEIGHT;
    score += s.qualifications * NATIONAL_REP_QUALIFICATION_WEIGHT;
    score += s.overperformance * NATIONAL_REP_OVERPERFORMANCE_WEIGHT;
    campaigns += s.campaigns;
    if (s.ending === "sacked") sackings++;
  }
  score += Math.min(campaigns, NATIONAL_REP_CAMPAIGN_CAP) * NATIONAL_REP_CAMPAIGN_WEIGHT;
  score -= sackings * NATIONAL_REP_SACKING_PENALTY;
  return Math.min(100, Math.max(0, score));
}

/** Fisher-Yates on a seeded stream, so an offer list is stable across reloads. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const toOffer = (e: NationExpectation): NationOffer => ({
  nation: e.nation,
  confederation: e.confederation ?? "",
  rank: e.rank,
  nations: e.nations,
  prestige: e.prestige,
});

export interface NationOfferInputs {
  lid: number;
  season: number;
  /** The nation currently managed, or null when the user manages none. */
  currentNation: string | null;
  expectations: Map<string, NationExpectation>;
  /** The federation dismissed you this offseason, so the nations that will take you are a rung down. */
  sacked: boolean;
  reputation: number;
  /**
   * The manager's *club* reputation, which federations can see a discounted
   * fraction of (`NATIONAL_OFFER_CLUB_REP_WEIGHT`). It reaches the offer target
   * and nothing else — never confidence, never a sacking, never the
   * international reputation shown to the player.
   */
  clubReputation: number;
  /** Last campaign's placement-versus-expectation — a good tournament gets you noticed. */
  lastOverperformance: number;
  /** Countries the user has asked about (`NationalManagerState.interests`). */
  interests?: string[];
}

/**
 * Which countries want you this offseason.
 *
 * While you already hold an international job the list is restricted to nations
 * at least as strong as yours, on the same reasoning the club side uses: an
 * approach from a weaker country is not an opportunity, and a list full of them
 * buries the real ones. With no job the filter lifts entirely — every job is a
 * step up from no job — and the per-nation chance rises sharply, because being
 * approached is the only route back into the feature and a manager who is never
 * asked has simply lost it.
 *
 * Unlike a sacked club manager, an empty list is a perfectly good answer here:
 * there is no unemployed state to rescue, so nothing is forced.
 *
 * **The band is centred on the bigger of your reputation and your current
 * nation**, for the reason `generateJobOffers` spells out at length: the band is
 * an absolute window in prestige while the step-up filter is relative to the job
 * you hold, so centring on reputation alone left the two with no overlap the
 * moment you managed a country stronger than your reputation. Measured on a
 * 44-nation field, mean offers per offseason while employed: the strongest
 * nation's manager got **0.00 at every reputation from 30 to 100**, the third
 * strongest 0.33.
 *
 * **A discounted slice of the CLUB reputation is folded into the same target**,
 * which is what the unemployed case needed — the `max` above is inert with no
 * job (`currentPrestige` is 0), and international reputation cannot rise without
 * holding a national job, so a manager who has never held one sits on
 * `NATIONAL_REP_BASE` forever. Measured on a real 70-nation world, the best
 * country that band could reach was **rank 33**, every offseason, whatever the
 * club career. See `NATIONAL_OFFER_CLUB_REP_WEIGHT` for why it is discounted
 * rather than counted in full.
 */
export function generateNationOffers(input: NationOfferInputs): NationOffer[] {
  const { expectations, currentNation, sacked } = input;
  const current = currentNation ? expectations.get(currentNation) : undefined;
  const currentPrestige = current?.prestige ?? 0;
  const employed = currentNation !== null;

  const target = nationOfferTarget(
    input.reputation, input.clubReputation, currentPrestige, sacked,
  );

  // Countries the user asked about roll first, on their own stream, and ignore
  // the step-up filter: wanting a smaller country is exactly the ask the
  // ordinary list can never answer. See the club side's `interestedClubs`.
  const interestChance = Math.min(
    NATIONAL_INTEREST_MAX_CHANCE,
    NATIONAL_INTEREST_CHANCE + Math.max(0, input.lastOverperformance) * NATIONAL_OFFER_FORM_WEIGHT,
  );
  const interested: NationExpectation[] = [];
  for (const name of new Set(input.interests ?? [])) {
    if (name === currentNation) continue;
    const e = expectations.get(name);
    if (!e) continue;
    const reach = interestReach(e.prestige, target, NATIONAL_OFFER_BAND);
    if (reach <= 0) continue;
    const roll = mulberry32(
      hashInts(input.lid, input.season, NATIONAL_INTEREST_STREAM, nationKey(name)),
    )();
    if (roll < interestChance * reach) interested.push(e);
  }

  const others = [...expectations.values()].filter((e) => e.nation !== currentNation);
  const byCloseness = (a: NationExpectation, b: NationExpectation): number =>
    Math.abs(a.prestige - target) - Math.abs(b.prestige - target);

  const pool = others
    .filter((e) => Math.abs(e.prestige - target) <= NATIONAL_OFFER_BAND)
    // Only a manager already in a job insists on a step up. Sacked or
    // unemployed, anything within the band is worth hearing. The lateral
    // allowance is what lets the world's strongest nation hear from its peers,
    // since a strict `>=` is unsatisfiable at prestige 1.000.
    .filter((e) => (employed && !sacked
      ? e.prestige >= currentPrestige - NATIONAL_OFFER_LATERAL_BAND
      : true))
    .sort(byCloseness);

  const rng = mulberry32(hashInts(input.lid, input.season, NATIONAL_OFFER_STREAM));
  const base = employed ? NATIONAL_OFFER_BASE_CHANCE : NATIONAL_OFFER_UNEMPLOYED_CHANCE;
  const chance = Math.min(
    NATIONAL_OFFER_MAX_CHANCE,
    Math.max(0, base + input.lastOverperformance * NATIONAL_OFFER_FORM_WEIGHT),
  );

  const offers: NationExpectation[] = [];
  for (const nation of shuffled(pool.slice(0, NATIONAL_MAX_OFFERS * 4), rng)) {
    if (offers.length >= NATIONAL_MAX_OFFERS) break;
    if (rng() < chance) offers.push(nation);
  }
  const taken = new Set(interested.map((e) => e.nation));
  return [...interested, ...offers.filter((e) => !taken.has(e.nation))]
    .slice(0, Math.max(NATIONAL_MAX_OFFERS, interested.length))
    .sort((a, b) => a.rank - b.rank)
    .map(toOffer);
}
