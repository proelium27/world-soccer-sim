import type { Player } from "../players/types.js";
import type { LeagueStore } from "../leagueState.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { Competition } from "../competitions.js";
import { trueTransferValue } from "../finance/valuation.js";
import {
  tierOf, competitionTeamCount, competitionPromotionSpots, divisionAbove, competitionSeasonGames,
} from "../competitions.js";
import { cupSlotsForCompetition } from "../cup/qualification.js";
import { SEASON_MATCHDAYS } from "../calendar.js";
import { deriveLeagueContexts } from "../ai/clubContext.js";
import {
  VALUATION_POTENTIAL_WEIGHT_PEAK_AGE, CUP_FORMATS, CONTINENTAL_ORDER,
  SELL_ON_CLAUSE_SEASONS, SELL_ON_MAX_SHARE, SELL_ON_RESALE_PROBABILITY,
  SELL_ON_PRICING_HORIZON, SELL_ON_PROFIT_REALIZATION,
  BONUS_CLAUSE_SEASONS, BONUS_MAX_TOTAL_FRACTION,
  BONUS_APPEARANCE_THRESHOLD, BONUS_GOAL_THRESHOLD,
  BONUS_STARTER_OVR_SWING, BONUS_TEAM_TRIGGER_REALIZATION,
  BONUS_APPEARANCE_SHARE_FLOOR, BONUS_APPEARANCE_SHARE_CEILING,
  BONUS_APPEARANCE_EDGE_CENTRE, BONUS_APPEARANCE_SD_SHARE,
  BONUS_GOAL_RATE_BY_POS, BONUS_GOAL_OVR_SLOPE, BONUS_GOAL_OVR_REFERENCE,
  BONUS_SUGGESTION_TARGET_P, BONUS_SUGGESTION_MIN_GOALS, BONUS_SUGGESTED_FRACTION,
  BONUS_EXPECTED_SEASONS_AT_CLUB,
} from "../constants.js";

/**
 * Contingent money attached to a transfer: a sell-on share of the buying
 * club's profit if they move the player on, and one-off bonuses that pay when
 * a stated thing happens.
 *
 * ## Why this is its own LeagueStore field and not a field on CompletedTransfer
 *
 * The transfer log looks like the natural home and is the wrong one, in a way
 * that fails silently rather than loudly. `detachTransfers` (core/simArchive.ts)
 * windows `league.transfers` to the last PLAYER_SETTLED_SEASONS seasons before
 * the league crosses to the worker, because the only thing the sim reads it for
 * is `settledMultiplier`, which is provably inert beyond that horizon. The
 * offseason — where a bonus settles, and where an AI resale would trigger a
 * sell-on — runs inside that worker. A clause agreed in season 3 and triggered
 * in season 9 would therefore be read as absent: no crash, no type error, the
 * beneficiary simply never gets paid. That is the exact "plausible wrong
 * answer" failure mode simArchive.ts warns about, and it is why clauses live in
 * their own array which is never detached.
 *
 * The second reason is shape: the transfer log is append-only history, and an
 * obligation is live state that has to be *deleted* when it resolves, expires,
 * or its player leaves the world.
 *
 * ## Bounded by construction
 *
 * There is deliberately no cap on the array, and none is needed. A clause is
 * dropped when it pays out, when its expiry season passes, when the obligor
 * sells the player (sell-ons pay and die; bonuses die unpaid, because the
 * condition was about *this* club), when the player is released to free
 * agency, and when he retires or is culled — the same scrub sites the watchlist
 * already goes through. Nothing can accumulate them.
 *
 * ## User-only, deliberately
 *
 * Only deals the user negotiates carry clauses. AI↔AI transfers are untouched,
 * so world money flow is byte-identical to a save without this feature and no
 * dynasty audit is involved — the same property every difficulty lever has, and
 * for the same reason (see DIFFICULTIES in constants.ts). If AI clubs are ever
 * given clauses of their own, that changes receipts into the weak leagues and
 * needs scripts/weakLeaguesAudit.ts run on both sides.
 */

/** What a bonus pays out for. */
export type BonusTrigger =
  /** The player makes BONUS_APPEARANCE_THRESHOLD league appearances in one season. */
  | "appearances"
  /** The player scores BONUS_GOAL_THRESHOLD league goals in one season. */
  | "goals"
  /** The obligor qualifies for either continental competition. */
  | "continental"
  /** The obligor wins promotion out of its division. */
  | "promotion";

interface ClauseBase {
  /** The player the clause is about. */
  pid: number;
  /** Club owed the money — whoever inserted the clause when they sold/bought. */
  beneficiaryTid: number;
  /** Club that owes it. The clause dies if the player leaves them. */
  obligorTid: number;
  /** Season the deal was struck. */
  season: number;
  /** Last season this can still pay out; dropped once the league passes it. */
  expires: number;
}

export interface SellOnClause extends ClauseBase {
  kind: "sellOn";
  /**
   * The cash fee the obligor paid. Profit is measured above this, so a resale
   * at or below it pays nothing — that is the whole point of pricing the
   * clause on profit rather than on the gross fee.
   */
  baseFee: number;
  /** Share of the profit, 0..SELL_ON_MAX_SHARE. */
  share: number;
}

export interface BonusClause extends ClauseBase {
  kind: "bonus";
  trigger: BonusTrigger;
  /** Flat payout, obligor → beneficiary, once. */
  amount: number;
  /**
   * How many games or goals it takes, for the two counting triggers. Absent on
   * the two team triggers, which have nothing to count.
   *
   * Stored per clause rather than read from a global constant, because a
   * threshold that is the same for everyone is not a suggestion: 25 games is a
   * routine season for a first-choice player and out of reach for a squad man.
   * The pricing model responds to it (see `triggerProbability`), which it has
   * to — a 5-goal bonus priced like a 15-goal one would be free money.
   */
  threshold?: number;
}

export type TransferClause = SellOnClause | BonusClause;

/** A clause the user is proposing but has not yet agreed — no tids resolved yet. */
export type ProposedClause =
  | { kind: "sellOn"; share: number }
  | { kind: "bonus"; trigger: BonusTrigger; amount: number; threshold?: number };

/**
 * Project a player's transfer value `horizon` seasons out.
 *
 * Deliberately built on the shipped `trueTransferValue` rather than a second
 * value model: a clause has to be priced on the same curve the resale will
 * actually be priced on, or the two disagree and the user is systematically
 * over- or under-paid.
 *
 * Two modelling choices worth knowing:
 *
 * - **Ovr moves toward potential, linearly, arriving at peak age.** Potential
 *   *is* the projected peak (see estimatePotential), and
 *   VALUATION_POTENTIAL_WEIGHT_PEAK_AGE is already the age the valuation curve
 *   treats as that peak — so this reuses the existing constant instead of
 *   introducing a growth model. Decline after the peak needs no special case:
 *   VALUATION_AGE_CURVE inside trueTransferValue handles it.
 * - **Contract years remaining are held flat**, exactly as
 *   `careerValueHistory` holds them for the same reason. Old contract terms
 *   aren't stored and future ones can't be known, so letting the term run down
 *   would price in an expiry the club would in reality have renewed away, and
 *   turn the projection into a read on paperwork rather than on ability.
 */
export function projectedValue(player: Player, season: number, horizon: number): number {
  const age = season - player.born;
  const gap = Math.max(0, player.potential - player.ovr);
  const seasonsToPeak = Math.max(1, VALUATION_POTENTIAL_WEIGHT_PEAK_AGE - age);
  const realized = gap * Math.min(1, Math.max(0, horizon / seasonsToPeak));
  const futureSeason = season + horizon;
  const yearsRemaining = Math.max(0, player.contract.expiresSeason - season);
  const projected: Player = {
    ...player,
    ovr: Math.round(player.ovr + realized),
    contract: { ...player.contract, expiresSeason: futureSeason + yearsRemaining },
  };
  return trueTransferValue(projected, futureSeason);
}

/**
 * P(X >= k) for a normal with this mean and sd, with a continuity correction.
 *
 * Used for appearances, which are a count out of a fixed number of games. A
 * normal is the right shape here rather than a binomial: real appearance
 * records are far more spread out than repeated coin flips, because a player
 * either holds a place or does not, so the sd is measured rather than derived
 * from the mean (see BONUS_APPEARANCE_SD_SHARE).
 */
function normalAtLeast(k: number, mean: number, sd: number): number {
  if (sd <= 0) return mean >= k ? 1 : 0;
  const z = (k - 0.5 - mean) / sd;
  // Abramowitz & Stegun 7.1.26 for the error function, which is plenty for a
  // price quote and avoids pulling in a stats dependency.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const upper = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? upper : 1 - upper;
}

/** P(X >= k) for a Poisson with this mean. Goals in a season are near enough. */
function poissonAtLeast(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  // Sum the lower tail term by term; k is small (a goal target), so this is
  // cheap and avoids the precision loss of a closed form.
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

/**
 * How much of his league season a player at this quality edge actually plays,
 * as a share of the club's games.
 *
 * The one signal both counting triggers rest on. `starterOvr` is the weakest
 * man the buyer's shape already fields in his position, so the edge is how much
 * better he is than the player he has to displace; an unknown incumbent falls
 * back to an even match.
 */
function appearanceShare(playerOvr: number, starterOvr: number | null): number {
  const edge = starterOvr === null ? 0 : playerOvr - starterOvr;
  const p = 1 / (1 + Math.exp(-(edge - BONUS_APPEARANCE_EDGE_CENTRE) / BONUS_STARTER_OVR_SWING));
  const span = BONUS_APPEARANCE_SHARE_CEILING - BONUS_APPEARANCE_SHARE_FLOOR;
  return Math.min(1, Math.max(0, BONUS_APPEARANCE_SHARE_FLOOR + span * p));
}

/**
 * League games the club plays in a season. Through `competitionSeasonGames`, not
 * 2(n-1): a split division (MLS, Argentina) plays 34 or 30, and reading it as a
 * 30-club double round robin (58) made an appearance target look far easier to
 * reach than it is.
 */
function leagueGames(obligor: StoredTeam, competitions: Competition[]): number {
  const comp = competitions.find((c) => c.id === obligor.compId);
  return comp ? competitionSeasonGames(comp) : SEASON_MATCHDAYS;
}

/**
 * P(he makes `threshold` league appearances) in ONE season.
 *
 * Exported because the suggestion logic searches over thresholds with it, and
 * because it is the thing the probe checks across a grid of thresholds rather
 * than at one shipped value.
 */
export function appearanceProbability(
  player: Player,
  obligor: StoredTeam,
  competitions: Competition[],
  starterOvr: number | null,
  threshold: number,
): number {
  const games = leagueGames(obligor, competitions);
  const mean = games * appearanceShare(player.ovr, starterOvr);
  return Math.min(1, Math.max(0, normalAtLeast(threshold, mean, games * BONUS_APPEARANCE_SD_SHARE)));
}

/**
 * P(he scores `threshold` league goals) in ONE season.
 *
 * Goals are appearances times a scoring rate, and the rate is a property of the
 * position far more than of the player: a good centre-back does not become a
 * goalscorer. `BONUS_GOAL_RATE_BY_POS` carries the measured per-appearance
 * rate, nudged by how far above a replacement-level player he is.
 */
export function goalProbability(
  player: Player,
  obligor: StoredTeam,
  competitions: Competition[],
  starterOvr: number | null,
  threshold: number,
): number {
  const games = leagueGames(obligor, competitions);
  const apps = games * appearanceShare(player.ovr, starterOvr);
  const rate = (BONUS_GOAL_RATE_BY_POS[player.pos] ?? 0)
    * (1 + BONUS_GOAL_OVR_SLOPE * (player.ovr - BONUS_GOAL_OVR_REFERENCE));
  return poissonAtLeast(threshold, Math.max(0, apps * rate));
}

/**
 * How likely a bonus trigger is to fire before the clause expires, in [0, 1].
 *
 * These are coarse by design. The point is not to predict the season — it is
 * that the buyer discounts its cash offer by something defensible, so a clause
 * converts price from cash into contingency instead of conjuring money. What
 * matters is that the same function prices both sides of the table (see
 * `clauseValue`'s note on symmetry), and that it is honest enough that neither
 * party is systematically robbed — which `scripts/clausePricingProbe.ts`
 * measures against what actually pays out.
 */
export function triggerProbability(
  trigger: BonusTrigger,
  player: Player,
  obligor: StoredTeam,
  competitions: Competition[],
  starterOvr: number | null,
  seasons: number,
  /** Games or goals asked for. Ignored by the two team triggers. */
  threshold?: number,
): number {
  switch (trigger) {
    case "appearances":
    case "goals": {
      const perSeason = trigger === "appearances"
        ? appearanceProbability(
            player, obligor, competitions, starterOvr,
            threshold ?? BONUS_APPEARANCE_THRESHOLD,
          )
        : goalProbability(
            player, obligor, competitions, starterOvr,
            threshold ?? BONUS_GOAL_THRESHOLD,
          );
      // At most one payout, over the seasons he is REALISTICALLY still there —
      // which is about one of the three the clause runs for, not three. A bonus
      // dies when he leaves, so the window length is an upper bound on the
      // number of chances rather than the number itself.
      const chances = Math.min(seasons, BONUS_EXPECTED_SEASONS_AT_CLUB);
      return 1 - (1 - Math.min(1, perSeason)) ** chances;
    }
    case "continental":
    case "promotion": {
      const comp = competitions.find((c) => c.id === obligor.compId);
      if (!comp) return 0;
      const tier = tierOf(competitions, obligor.compId);
      // Promotion is meaningless for a top-flight club and continental
      // qualification unreachable from below it, so each is simply impossible
      // in the other's half of the pyramid. A clause that cannot fire is
      // refused at proposal time rather than priced at zero here.
      if (trigger === "promotion" && tier === 1) return 0;
      if (trigger === "continental" && tier !== 1) return 0;
      const slots = trigger === "promotion"
        ? competitionPromotionSpots(comp, divisionAbove(competitions, comp.id))
        // "Continental" means either competition — a Shield place is still a
        // European night — so this is the league's whole allocation. Slot counts
        // move between countries every season on the rolling coefficient, and
        // that is deliberately not modelled here: the clause is priced when it
        // is agreed, off the allocation the league has now.
        : CONTINENTAL_ORDER.reduce(
            (n, id) => n + cupSlotsForCompetition(comp, CUP_FORMATS[id]), 0,
          );
      const size = competitionTeamCount(comp);
      if (size <= 0 || slots <= 0) return 0;
      // Slots over clubs is the base rate for an average club. It is a coarse
      // read — it says nothing about whether THIS club is any good — and that is
      // the honest limit of pricing a team achievement without simulating the
      // league. The probe measures how far off it lands.
      const perSeason = Math.min(1, slots / size);
      // Scaled by what a team trigger really delivers: the raw rate assumes he
      // is still at the club for every season of the window, and he usually is
      // not. See BONUS_TEAM_TRIGGER_REALIZATION for the measurement, and for why
      // the two performance triggers above take no equivalent factor.
      return (1 - (1 - perSeason) ** seasons) * BONUS_TEAM_TRIGGER_REALIZATION;
    }
  }
}

/** One bonus the panel offers for this particular player and this particular buyer. */
export interface BonusSuggestion {
  trigger: BonusTrigger;
  /** Games or goals asked for; absent on the two team triggers. */
  threshold?: number;
  /** A starting amount the user can overwrite. */
  amount: number;
}

/**
 * The threshold nearest to `BONUS_SUGGESTION_TARGET_P` for this player.
 *
 * Searches the candidate range rather than solving, because the probability
 * functions are not analytically invertible and the range is tiny. Returns null
 * when nothing in range gets close, which is the honest answer for a bonus that
 * would be either a formality or an impossibility.
 */
function thresholdNearestTarget(
  candidates: number[],
  probabilityAt: (t: number) => number,
): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const t of candidates) {
    const gap = Math.abs(probabilityAt(t) - BONUS_SUGGESTION_TARGET_P);
    if (gap < bestGap) { bestGap = gap; best = t; }
  }
  return best;
}

/**
 * What add-ons to offer for THIS player joining THIS club.
 *
 * The whole point is that a suggestion which is identical for everyone is not a
 * suggestion. Two things vary, and neither needs a per-position table:
 *
 * - **Which bonuses appear.** A trigger that cannot fire is not offered, and
 *   that falls out of the pricing rather than from a hardcoded list of who is
 *   allowed to score: a keeper's chance of reaching any sensible goal tally is
 *   nil, so no goal bonus is suggested for him. Promotion is dropped for a
 *   top-flight buyer and a continental place for anyone below it, for the same
 *   structural reason `triggerProbability` scores them zero.
 * - **The threshold.** Each is set where the payout is about as likely as any
 *   other suggestion (`BONUS_SUGGESTION_TARGET_P`), so a fringe signing is
 *   offered a modest games target and a first-choice one a demanding target.
 *   Equal ambition; different numbers.
 *
 * The amount is a flat share of the fee, because how much to stake is the one
 * part that is genuinely the user's call rather than a property of the player.
 */
export function suggestedBonuses(
  player: Player,
  obligor: StoredTeam,
  competitions: Competition[],
  starterOvr: number | null,
  baseFee: number,
): BonusSuggestion[] {
  const amount = Math.max(100_000, Math.round(baseFee * BONUS_SUGGESTED_FRACTION));
  const out: BonusSuggestion[] = [];

  const games = leagueGames(obligor, competitions);
  const appTarget = thresholdNearestTarget(
    // Whole games from a token handful up to the full season.
    Array.from({ length: games - 4 }, (_, i) => i + 5),
    (t) => appearanceProbability(player, obligor, competitions, starterOvr, t),
  );
  if (appTarget !== null) out.push({ trigger: "appearances", threshold: appTarget, amount });

  const goalTarget = thresholdNearestTarget(
    Array.from({ length: 40 }, (_, i) => i + 1),
    (t) => goalProbability(player, obligor, competitions, starterOvr, t),
  );
  // Below the floor it stops being a goalscoring bonus and starts being a bet
  // that a defender gets on the end of a corner once.
  if (goalTarget !== null && goalTarget >= BONUS_SUGGESTION_MIN_GOALS) {
    out.push({ trigger: "goals", threshold: goalTarget, amount });
  }

  const tier = tierOf(competitions, obligor.compId);
  if (tier === 1) out.push({ trigger: "continental", amount });
  else out.push({ trigger: "promotion", amount });

  return out;
}

/**
 * The expected value of a proposed clause, in money.
 *
 * **This is the load-bearing function, and there is exactly one of it on
 * purpose.** A clause does not add money to a deal — the buyer's total
 * willingness to pay is whatever it was, and a clause converts part of it from
 * cash into contingency. So both directions subtract this same number from the
 * cash price: selling, it comes off the buyer's cash ceiling; buying, it comes
 * off the seller's cash reservation. If buy and sell ever priced a clause
 * differently, one of them would be free money, which is the whole exploit
 * surface this feature has. Same argument as `saleGateFor` being extracted
 * rather than copied.
 *
 * Rounded to whole money, and never negative.
 */
export function clauseValue(
  clause: ProposedClause,
  player: Player,
  season: number,
  baseFee: number,
  obligor: StoredTeam,
  competitions: Competition[],
  starterOvr: number | null,
): number {
  if (clause.kind === "sellOn") {
    const future = projectedValue(player, season, SELL_ON_PRICING_HORIZON);
    // The projection is what the valuation curve says he'd be worth; the market
    // pays out rather less than that on a resale, because most resales are not
    // at a profit at all. SELL_ON_PROFIT_REALIZATION is the measured gap — see
    // its note, and scripts/clausePricingProbe.ts, which reads 1.0 when the two
    // agree.
    const profit = Math.max(0, future - baseFee) * SELL_ON_PROFIT_REALIZATION;
    return Math.max(0, Math.round(SELL_ON_RESALE_PROBABILITY * profit * clause.share));
  }
  const p = triggerProbability(
    clause.trigger, player, obligor, competitions, starterOvr, BONUS_CLAUSE_SEASONS,
    clause.threshold,
  );
  return Math.max(0, Math.round(p * clause.amount));
}

/** The combined cash discount a set of proposed clauses buys. */
export function clausesValue(
  clauses: ProposedClause[],
  player: Player,
  season: number,
  baseFee: number,
  obligor: StoredTeam,
  competitions: Competition[],
  starterOvr: number | null,
): number {
  return clauses.reduce(
    (sum, c) => sum + clauseValue(c, player, season, baseFee, obligor, competitions, starterOvr),
    0,
  );
}

/**
 * Whether a proposed set of clauses is legal on a deal of this size.
 *
 * Two limits, both about keeping a transfer a transfer: the sell-on share is
 * capped so a club can't sell a player while keeping most of his future, and
 * total bonus money is capped as a fraction of the base fee so a deal can't be
 * turned into a lottery ticket with a nominal cash component. Both also bound
 * how far the cash price can be discounted, which keeps the pricing model —
 * coarse by construction — from being leaned on harder than it deserves.
 */
export function clausesAreValid(clauses: ProposedClause[], baseFee: number): boolean {
  let share = 0;
  let bonusTotal = 0;
  const triggers = new Set<BonusTrigger>();
  for (const c of clauses) {
    if (c.kind === "sellOn") {
      if (!Number.isFinite(c.share) || c.share <= 0) return false;
      share += c.share;
    } else {
      if (!Number.isFinite(c.amount) || c.amount <= 0) return false;
      // One bonus per trigger — two "10 goals" add-ons on one deal is a way of
      // writing one bigger bonus, and it makes the ledger unreadable.
      if (triggers.has(c.trigger)) return false;
      triggers.add(c.trigger);
      bonusTotal += c.amount;
    }
  }
  if (share > SELL_ON_MAX_SHARE) return false;
  if (bonusTotal > BONUS_MAX_TOTAL_FRACTION * baseFee) return false;
  return true;
}

/** Turn proposals into live obligations once a deal actually executes. */
export function materializeClauses(
  clauses: ProposedClause[],
  pid: number,
  beneficiaryTid: number,
  obligorTid: number,
  season: number,
  baseFee: number,
): TransferClause[] {
  return clauses.map((c) =>
    c.kind === "sellOn"
      ? {
          kind: "sellOn" as const,
          pid, beneficiaryTid, obligorTid, season,
          expires: season + SELL_ON_CLAUSE_SEASONS,
          baseFee, share: c.share,
        }
      : {
          kind: "bonus" as const,
          pid, beneficiaryTid, obligorTid, season,
          expires: season + BONUS_CLAUSE_SEASONS,
          trigger: c.trigger, amount: c.amount, threshold: c.threshold,
        },
  );
}

/**
 * What a set of proposed clauses is WORTH to the club receiving them, from the
 * live league.
 *
 * Add-ons sit **on top** of the cash, exactly as a real transfer is reported
 * ("£20m rising to £25m"): the cash you name is the cash that changes hands,
 * and this is the extra the other club counts alongside it when deciding
 * whether the deal clears their number. Which is what makes add-ons useful —
 * they close a deal your budget could not reach in cash alone.
 *
 * The single entry point both directions of the market use, and the reason the
 * feature can't be farmed: buying, this is added to your offer before the
 * seller judges it; selling, it is added to your ask before the buyer judges
 * it. Same function, same number, opposite side of the table. **Under-price it
 * and you clear a reservation too cheaply**, which is why the calibration
 * behind it matters as much as it ever did.
 *
 * `obligorTid` is whoever will owe the money, i.e. always the buying club.
 * Returns 0 for an empty proposal without deriving anything, which keeps the
 * ordinary no-clause path exactly as cheap as it was: `deriveLeagueContexts`
 * walks every squad in the world and this runs on a user's click.
 */
export function clauseExpectedValue(
  league: LeagueStore,
  pid: number,
  obligorTid: number,
  baseFee: number,
  clauses: ProposedClause[],
): number {
  if (clauses.length === 0) return 0;
  const player = league.players.find((p) => p.pid === pid);
  const obligor = league.teams.find((t) => t.tid === obligorTid);
  if (!player || !obligor) return 0;
  const contexts = deriveLeagueContexts({
    teams: league.teams, players: league.players, season: league.season,
    played: league.played, competitions: league.competitions,
  });
  // The weakest man the buyer's shape actually fields in his position — the
  // buy-side counterfactual the transfer AI already reasons with, and the right
  // read on "will he play" for an appearance or goal bonus.
  const starterOvr = contexts.get(obligorTid)?.posWeakestStarterOvr[player.pos] ?? null;
  return clausesValue(
    clauses, player, league.season, baseFee, obligor, league.competitions, starterOvr,
  );
}

/** Money a clause has come due for, ready to be moved between two budgets. */
/**
 * The add-ons worth offering for this deal, from the live league.
 *
 * The read-side companion to `clauseCashDiscount`, and it derives the same club
 * contexts, so a caller should ask for it only when the panel is actually open.
 * Returns an empty list rather than throwing when the pid or tid has gone stale.
 */
export function clauseSuggestions(
  league: LeagueStore,
  pid: number,
  obligorTid: number,
  baseFee: number,
): BonusSuggestion[] {
  const player = league.players.find((p) => p.pid === pid);
  const obligor = league.teams.find((t) => t.tid === obligorTid);
  if (!player || !obligor || !(baseFee > 0)) return [];
  const contexts = deriveLeagueContexts({
    teams: league.teams, players: league.players, season: league.season,
    played: league.played, competitions: league.competitions,
  });
  const starterOvr = contexts.get(obligorTid)?.posWeakestStarterOvr[player.pos] ?? null;
  return suggestedBonuses(player, obligor, league.competitions, starterOvr, baseFee);
}

export interface ClausePayout {
  /** The club that owes it. */
  fromTid: number;
  /** The club owed it. */
  toTid: number;
  amount: number;
  pid: number;
  /** What produced it, for the news feed and the finance ledger. */
  reason: "sellOn" | BonusTrigger;
}

/**
 * Settle every clause a sale triggers, and drop the ones that sale kills.
 *
 * Called from the single shared fee path (`settleFee` in negotiation.ts), so
 * both the user's own deals and the AI↔AI market — which credits budgets inline
 * rather than going through `executeTransfer` — honour a sell-on identically.
 * Two copies of "who gets paid" would drift, which is the same argument that
 * put `saleGateFor` in one place.
 *
 * Both kinds of clause die when the player leaves the club that owed them, and
 * only one of them pays on the way out:
 *
 * - A **sell-on** is exactly about this moment. It pays a share of the profit
 *   over what the obligor originally paid — so a club that sells at a loss owes
 *   nothing, which is what pricing on profit rather than on the gross fee buys.
 * - A **bonus** was a bet on what he would do *at that club*, so it lapses
 *   unpaid. Carrying it to the new club would be paying the old obligor's debt
 *   out of a stranger's budget.
 *
 * Pure: returns what to credit and what survives, and touches no budgets
 * itself. No rng draw.
 */
export function settleClausesOnSale(
  clauses: TransferClause[],
  pid: number,
  sellerTid: number,
  fee: number,
  season: number,
): { payouts: ClausePayout[]; remaining: TransferClause[] } {
  const payouts: ClausePayout[] = [];
  const remaining: TransferClause[] = [];
  for (const c of clauses) {
    if (c.pid !== pid || c.obligorTid !== sellerTid) {
      remaining.push(c);
      continue;
    }
    if (c.kind === "sellOn" && season <= c.expires) {
      const profit = Math.max(0, fee - c.baseFee);
      const amount = Math.round(profit * c.share);
      if (amount > 0) {
        payouts.push({
          fromTid: c.obligorTid, toTid: c.beneficiaryTid, amount, pid, reason: "sellOn",
        });
      }
    }
    // Either way it does not survive the move.
  }
  return { payouts, remaining };
}

/**
 * Whether a bonus's condition was met in the season just played.
 *
 * `stats` is the player's league line for that season and may be absent (he
 * never appeared). The team triggers are answered by the caller, which has the
 * final tables — this only knows what a player did.
 */
export function bonusTriggered(
  clause: BonusClause,
  stats: { appearances: number; goals: number } | undefined,
  teamAchieved: boolean,
): boolean {
  switch (clause.trigger) {
    case "appearances":
      return (stats?.appearances ?? 0) >= (clause.threshold ?? BONUS_APPEARANCE_THRESHOLD);
    case "goals":
      return (stats?.goals ?? 0) >= (clause.threshold ?? BONUS_GOAL_THRESHOLD);
    case "continental":
    case "promotion":
      return teamAchieved;
  }
}

/**
 * Everything a completed season's bonuses come due for.
 *
 * Pure, and deliberately separated from the offseason step that calls it: the
 * step's job is to *answer* the four questions below off the season's tables and
 * stats, which only it can do; deciding who then gets paid is ordinary logic
 * that should be testable without simming a season to reach it.
 *
 * A bonus only counts while the player is still at the club that agreed it —
 * the same rule that makes a sale kill it. It pays once and is gone.
 */
export interface BonusSettlementInputs {
  /** Which club each player is on right now. Absent = nobody's. */
  rosterOf: ReadonlyMap<number, number>;
  /** Each player's league line for the season just played. */
  statsByPid: ReadonlyMap<number, { appearances: number; goals: number } | undefined>;
  /** Clubs in a continental competition off that season. */
  qualifiedTids: ReadonlySet<number>;
  /** Clubs promoted at this rollover. */
  promotedTids: ReadonlySet<number>;
}

export function settleBonuses(
  clauses: TransferClause[],
  inputs: BonusSettlementInputs,
): { payouts: ClausePayout[]; remaining: TransferClause[] } {
  const payouts: ClausePayout[] = [];
  const remaining: TransferClause[] = [];
  for (const c of clauses) {
    if (c.kind !== "bonus") { remaining.push(c); continue; }
    const stillThere = inputs.rosterOf.get(c.pid) === c.obligorTid;
    const teamAchieved =
      c.trigger === "continental" ? inputs.qualifiedTids.has(c.obligorTid)
      : c.trigger === "promotion" ? inputs.promotedTids.has(c.obligorTid)
      : false;
    if (stillThere && bonusTriggered(c, inputs.statsByPid.get(c.pid), teamAchieved)) {
      payouts.push({
        fromTid: c.obligorTid, toTid: c.beneficiaryTid,
        amount: c.amount, pid: c.pid, reason: c.trigger,
      });
      continue;
    }
    remaining.push(c);
  }
  return { payouts, remaining };
}

/**
 * Net effect of a set of payouts on each club, as tid → delta.
 *
 * Both sides always move, so the total is exactly zero — money changes hands
 * and none is created. Callers apply it to budgets themselves because only they
 * know the right money scale (and whether to clamp).
 */
export function payoutDeltas(payouts: ClausePayout[]): Map<number, number> {
  const delta = new Map<number, number>();
  const add = (tid: number, amount: number) =>
    delta.set(tid, (delta.get(tid) ?? 0) + amount);
  for (const p of payouts) {
    add(p.fromTid, -p.amount);
    add(p.toTid, p.amount);
  }
  return delta;
}

/** Clauses the given club is owed money by someone else on. */
export function clausesOwedTo(league: LeagueStore, tid: number): TransferClause[] {
  return (league.transferClauses ?? []).filter((c) => c.beneficiaryTid === tid);
}

/** Clauses the given club owes money on. */
export function clausesOwedBy(league: LeagueStore, tid: number): TransferClause[] {
  return (league.transferClauses ?? []).filter((c) => c.obligorTid === tid);
}

/** Every live clause attached to one player. */
export function clausesForPlayer(league: LeagueStore, pid: number): TransferClause[] {
  return (league.transferClauses ?? []).filter((c) => c.pid === pid);
}

/**
 * Drop clauses whose expiry season has passed. Called once per offseason,
 * after the season's bonuses have had their chance to settle.
 */
export function expireClauses(clauses: TransferClause[], season: number): TransferClause[] {
  return clauses.filter((c) => c.expires >= season);
}

/**
 * Drop every clause naming any of these pids.
 *
 * Called from the same places the watchlist is scrubbed — retirement and the
 * free-agent cull — plus release to free agency. A clause pointing at a deleted
 * player can never fire and can never be seen, so leaving it would be a slow
 * leak of unreadable rows into every save.
 */
export function scrubClausesForPids(
  clauses: TransferClause[],
  pids: ReadonlySet<number>,
): TransferClause[] {
  return clauses.filter((c) => !pids.has(c.pid));
}
