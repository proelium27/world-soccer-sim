import type { Position } from "./players/types.js";
import { OVR_WEIGHTS } from "./players/templates.js";

/**
 * League-average base rating; a team's base = LEAGUE_BASE + its strength target.
 * Raised 46→54 (2026-07-14), alongside TEAM_STRENGTH_SPREAD and RATING_NOISE_SD
 * below, after a TOTY bug report traced back to fresh-league generation sitting
 * ~7-10 points below every tier the Manual documents (65 avg starter / 75 best-
 * on-a-team / 80-85 league-wide elite / 90+ rare): a from-scratch generated
 * league measured mean starter ovr ~58 (not 65) and a league-wide max of only
 * 73-76 across 500 players (not 80-85+). Calibrated empirically against a
 * standalone generation harness to land starter mean ~65, best-player-per-team
 * ~73-75, and league max in the low-to-mid 80s with 90+ still rare.
 */
export const LEAGUE_BASE = 54;

/**
 * Half-range of per-team strength targets (pre-normalization magnitude).
 * Widened 7→9 alongside the LEAGUE_BASE/RATING_NOISE_SD retune above — a pure
 * LEAGUE_BASE shift alone raises the whole distribution uniformly but can't
 * close the gap between "average starter" and "a team's best player" (both
 * ends of that gap need real spread, not just a higher floor).
 */
export const TEAM_STRENGTH_SPREAD = 9;

/**
 * Division 1 team count, moved up from its previous location further down
 * this file (2026-07-15) so DIVISION_2_OFFSET below can reference it — a
 * plain literal, safe to relocate since nothing it depends on comes later.
 */
export const NUM_TEAMS = 20;

/**
 * Second division (English Division 2): same team count as Division 1, a
 * strength offset subtracted from the per-team target before generation so
 * D2's strongest teams land meaningfully below D1's own — a budget/prize
 * scale reflecting the real financial gap between top-flight and
 * second-tier football.
 *
 * DIVISION_2_OFFSET is derived from a target D1 rank rather than pinned to
 * a literal (2026-07-15 retune): a 30-season dynasty audit found the
 * original "D2's best ≈ D1's average" target (DIVISION_2_OFFSET =
 * TEAM_STRENGTH_SPREAD) eroded further over a long dynasty — D2's strongest
 * team's average roster OVR ended up *exceeding* D1's average team, and
 * Division 2's Team of the Season came within ~2.6 OVR of Division 1's.
 * D1's per-team strength targets are evenly spaced across
 * [-TEAM_STRENGTH_SPREAD, +TEAM_STRENGTH_SPREAD] over NUM_TEAMS clubs (rank
 * 1 = strongest, rank NUM_TEAMS = weakest); DIVISION_2_TARGET_D1_RANK picks
 * which D1 rank D2's own strongest team's target should land at.
 *
 * Retuned again (2026-07-15) from NUM_TEAMS (D1's own weakest team, the
 * formula's ceiling) down to 16: on reflection with the user, D1's weakest
 * team was a stronger target than ever actually intended — the original
 * design spec explicitly wanted Division 2's strongest team meaningfully
 * above D1's bottom, not equal to it — and rank NUM_TEAMS only got picked in
 * the prior pass as an emergency lever while separately fighting the
 * long-dynasty drift problem (Fix 3, src/core/ai/breakoutRefusal.ts) rather
 * than as a considered restatement of the target. Fix 3 itself doesn't care
 * what the generation-time rank is — it fights drift regardless — so this
 * change needs re-verifying via `scripts/divisionAudit.ts` but shouldn't
 * require retuning Fix 3 or DIVISION_2_BUDGET_SCALE.
 */
export const NUM_TEAMS_D2 = 20;
export const DIVISION_2_TARGET_D1_RANK = 16;
export const DIVISION_2_OFFSET =
  ((DIVISION_2_TARGET_D1_RANK - 1) / (NUM_TEAMS - 1)) * 2 * TEAM_STRENGTH_SPREAD;

/** Third division team count. Only a country that opts into three tiers has one. */
export const NUM_TEAMS_D3 = 20;

/**
 * How far below Division 1 a tier's strength band sits — the number generation
 * subtracts from every club's target, and the number academyBaseCenter walks a
 * promoted or relegated club toward.
 *
 * One step per tier, so the D1/D2 relationship DIVISION_2_OFFSET was tuned for
 * (D2's strongest club lands at D1's rank-16 target) repeats between D2 and D3.
 * Stated as a formula rather than a table because that is what makes a third
 * tier free of a second tuning pass AND keeps tiers 1 and 2 arithmetically
 * identical to what shipped: tier 1 is 0 and tier 2 is exactly
 * DIVISION_2_OFFSET, so no existing world moves by a float.
 *
 * The honest caveat, and it is why the third tier needs its own audit rather
 * than inheriting this one's: at tier 3 the resulting academy anchor lands in
 * the saturated part of YOUTH_BASE_FLOOR's softplus, the same regime the
 * weakest shipped second divisions already sit in. Playable, measured, and
 * flatter than a tier higher up the pyramid.
 */
export function divisionStrengthOffset(tier: number): number {
  return Math.max(0, tier - 1) * DIVISION_2_OFFSET;
}
/**
 * Division 2's money-in scale (2026-07-15 retune): both the income rate
 * (see divisionScale in finance/budget.ts) and, as of the same retune, the
 * budget ceiling itself (see clampBudget) now use this factor, so Division
 * 2 clubs can no longer eventually out-save Division 1 clubs the way a flat
 * MAX_BUDGET previously allowed.
 *
 * Set to 0.6 (unchanged from its pre-retune value), not the user's original
 * 0.4 ask: a dynasty audit found 0.4 produced real AI deficits (as low as
 * -$20M) at the widened DIVISION_2_OFFSET above, and even 0.5 still dipped
 * negative in some seeds. 0.6 was re-verified clean (min budget consistently
 * $6M-$23M+ positive across a 3-seed, 30-season audit) — confirmed with the
 * user that relaxing this back up was preferable to a Division 2 that can't
 * sustain itself. See scripts/divisionAudit.ts and the Second Division
 * section of CLAUDE.md for the full audit history.
 */
export const DIVISION_2_BUDGET_SCALE = 0.6;

/**
 * OVR floor above which a Division 2 player refuses to stay in Division 2
 * (`wouldRefuseExtension`, `src/core/ai/breakoutRefusal.ts`) — simplified
 * 2026-07-15 from a per-club valueToClub/affordability match (find a
 * specific Division 1 club that both values him enough and can afford him)
 * to a flat OVR preference: a "good starter" per the Manual's own 65/70/75
 * scale (`src/ui/pages/Manual.tsx`) just doesn't want to play Division 2
 * football, full stop, regardless of whether any particular Division 1 club
 * happens to want or be able to afford him right now. Starting value; tune
 * via `scripts/divisionAudit.ts` if it turns out too loose (barely reduces
 * the season-30 drift) or too tight (empties Division 2 of anyone decent).
 */
export const DIVISION_2_REFUSAL_OVR_THRESHOLD = 70;

/**
 * The same bar for a pyramid deeper than two, keyed by tier. A third-tier club
 * has to lose its good players to the SECOND division, not straight to the top
 * flight, so the bar has to fall as you go down or the tiers stop meaning
 * anything relative to each other.
 *
 * Tier 2 is DIVISION_2_REFUSAL_OVR_THRESHOLD by reference, not by a copied
 * literal, so the shipped two-division world cannot drift from the constant it
 * was tuned against. Tier 3's 62 is a STARTING VALUE and has not been audited —
 * `scripts/divisionAudit.ts` is what settles it, and the failure modes to watch
 * are the documented pair: too loose barely dents long-dynasty drift, too tight
 * empties the division of anyone worth watching.
 *
 * A tier with no entry falls back to the deepest one listed, so a fourth tier
 * would inherit the third's bar rather than silently keeping everybody.
 */
const DIVISION_REFUSAL_OVR_BY_TIER: Record<number, number> = {
  2: DIVISION_2_REFUSAL_OVR_THRESHOLD,
  3: 62,
};

/**
 * OVR at or above which an AI player refuses to stay in this tier. Tier 1 has
 * no ceiling — there is nothing above it — so it returns Infinity rather than a
 * number, which is what makes every call site's `ovr >= threshold` test
 * correctly false for a top-flight club without needing a tier check of its own.
 */
export function divisionRefusalOvr(tier: number): number {
  if (tier <= 1) return Infinity;
  const listed = DIVISION_REFUSAL_OVR_BY_TIER[tier];
  if (listed !== undefined) return listed;
  const deepest = Math.max(...Object.keys(DIVISION_REFUSAL_OVR_BY_TIER).map(Number));
  return DIVISION_REFUSAL_OVR_BY_TIER[deepest];
}

/**
 * Straight automatic swap each offseason: bottom N of D1 <-> top N of D2.
 *
 * The default only, and what every shipped country plays. A league added in
 * World setup can carry its own `Competition.promotionSpots` instead; this is
 * what that picker starts at and what every league without one falls back to,
 * which is why no save ever needed migrating for it.
 */
export const PROMOTION_RELEGATION_COUNT = 3;

/**
 * How many semi-finals a promotion playoff has, i.e. it is contested by twice
 * this many clubs. Two (a four-club bracket) is the English shape and the only
 * one the code seeds; changing it changes how many places below the automatic
 * ones are worth playing for, and `promotionPlayoffFields` will simply seat
 * that many clubs — but nothing else has been measured at another value.
 */
export const PROMOTION_PLAYOFF_SEMI_FINALS = 2;

/**
 * How a country decides its last promotion place.
 *
 *  - `english` — the top N-1 go up on the table and the four clubs below them
 *    contest two-legged semi-finals and a neutral-ground final for the last
 *    place. Self-contained in tier 2: no top-flight club is at risk.
 *  - `german` — N-1 go up **and** N-1 go down on the table, then tier 2's next
 *    club plays tier 1's lowest safe club over two legs for the remaining
 *    place. A top-flight club can save itself, and when it does, one fewer club
 *    goes up *and* one fewer goes down — so the divisions still balance.
 *  - `none` — the straight top-N/bottom-N swap, which is how the game worked
 *    before playoffs existed.
 */
export type PlayoffFormat = "english" | "german" | "none";

/**
 * What each shipped country plays, absent a per-league override.
 *
 * These are the real systems: the Bundesliga settles its last place with a
 * relegation playoff against 2. Bundesliga's third, while the rest of the
 * shipped world runs the English four-club bracket. Anything not listed falls
 * back to `DEFAULT_PLAYOFF_FORMAT`, which covers every country a player invents.
 *
 * A country promoting fewer than two clubs has no automatic place to sit below,
 * so `english` is not available to it and `promotionPlayoffFields` returns no
 * bracket — Scotland promotes one and is listed as `none` to say so plainly
 * rather than relying on that fallback.
 */
export const COUNTRY_PLAYOFF_FORMAT: Record<string, PlayoffFormat> = {
  Germany: "german",
  Scotland: "none",
};

/** What a country not in COUNTRY_PLAYOFF_FORMAT plays, including invented ones. */
export const DEFAULT_PLAYOFF_FORMAT: PlayoffFormat = "english";

/**
 * The most clubs an added league can be set to promote and relegate. Held below
 * half that league's own division size as well (see WorldSetup), so the ceiling
 * that actually applies is often lower — this is the point past which the number
 * stops meaning much even in a big division.
 */
export const MAX_PROMOTION_SPOTS = 6;

/**
 * A promoted/relegated club's academyBase (its generation-time strength
 * anchor and permanent youth-intake anchor) doesn't snap to its new
 * division's band instantly — it moves a fraction of the remaining
 * distance each offseason, over this many seasons, so a promoted club has
 * to earn its way up rather than get an instant strength boost.
 */
export const ACADEMY_BASE_CONVERGENCE_SEASONS = 3;

/**
 * Per-country strength handicap, subtracted from every team's generation-time
 * strength target (on top of any tier offset) so some countries field weaker
 * leagues than others. The big-four leagues (England/Spain/Italy/Germany) are
 * equal siblings at 0; France, the Netherlands, Portugal, Belgium, Turkey,
 * Greece, Scotland and Serbia are deliberately weaker, with Serbia weakest —
 * anchored on the real UEFA five-year country coefficient ordering (England ≫
 * the pack ≫ France > Netherlands > Portugal > Belgium > Turkey ≫ Greece >
 * Scotland > Serbia; measured Aug 2026 at 101.9 / 67.7 / 64.9 / 63.7 / 57.9 /
 * 47.6, with Greece, Scotland and Serbia several rungs further back around
 * 37.6 / 35.5 / 28.1). The real
 * gaps below France are only a few coefficient points each, so the ladder is
 * deliberately *compressed* rather than mapped literally — a literal mapping
 * puts Belgium near 17 and Turkey near 30, which generates unplayable squads.
 * Each offset point costs roughly 0.94 OVR off a league's starters. Because
 * match composites are
 * z-normalized *within* each competition, this handicap is invisible in a
 * country's own domestic matches (someone still wins Ligue 1) and only bites
 * where leagues meet: transfer valuations (weaker players are cheaper, so they
 * drain upward to richer/stronger leagues) and the Continental Cup (once its
 * composites are normalized against a shared baseline — see simThrough/simCup).
 *
 * Starting values; tune via scripts/divisionAudit.ts — the exact magnitudes
 * matter less than the ordering, and both are wired to be adjusted from here.
 * An unlisted country (the big four) defaults to 0 via countryStrengthOffset().
 */
export const COUNTRY_STRENGTH_OFFSET: Record<string, number> = {
  France: 5,
  Netherlands: 8,
  Portugal: 10,
  Belgium: 11,
  Turkey: 12,
  // The bottom four rungs sit one point apart and are NOT separately resolvable
  // across a dynasty — they converge to within a few tenths by season 20 and
  // their mutual order coin-flips on seed noise. Widening the step does not fix
  // that down here: Scotland shipped at a deliberate TWO-point step below Turkey
  // and still ends level with it (+0.02/+0.37/−1.26/+1.94 over four seeds),
  // because erosion grows with depth. The same two-point step higher up
  // (Netherlands→Portugal) survives on every seed. So these are ordered at
  // generation and converged by season 20, and weakLeaguesAudit.ts gates them
  // that way rather than per-rung. Don't chase the bottom with bigger offsets —
  // it costs squad playability and buys nothing.
  Greece: 13,
  Scotland: 14,
  Serbia: 15,
};
export function countryStrengthOffset(country: string): number {
  return COUNTRY_STRENGTH_OFFSET[country] ?? 0;
}

/**
 * Per-country money scale, multiplied into a competition's finance scale on top
 * of the tier scale (see financeScale in finance/budget.ts). A weaker league is
 * also a poorer one — the weak leagues can't out-bid the big four, which is
 * what turns them into selling leagues that feed talent upward. Kept above the
 * clubs' (lower, because OVR-driven and OVR is lower here) wage bills so the
 * "no AI club runs a deficit" invariant still holds — verify via the audit.
 * Unlisted countries default to 1 via countryBudgetScale().
 *
 * **This scale MUST stay monotonic with COUNTRY_STRENGTH_OFFSET** — a richer
 * league climbs the ladder over a dynasty, so a weaker-but-richer league
 * overtakes a stronger-but-poorer one. That is measured, not theoretical, and
 * it is the single easiest way to break the world (2026-08-08): Belgium and
 * Turkey generate within 0.9 OVR of each other, which makes them a near-matched
 * pair isolating budget from every other factor, and at Belgium 0.35 / Turkey
 * 0.50 the ladder inverted by 2.23 OVR over 20 seasons — Turkey, generated
 * weakest, finished *above* Belgium. Real squad values invert here (Belgian Pro
 * League €0.98B is below Süper Lig €1.27B while Belgium outranks Turkey on the
 * pitch); that inversion is deliberately NOT modelled, because the engine
 * cannot hold "weak but rich" and the strength ladder is the load-bearing
 * design, not the flavour.
 *
 * Beware measuring this across leagues with very different starting OVR (e.g.
 * England vs Portugal): progression's own mean-reversion dominates there and
 * masks the budget signal entirely. Compare near-equal leagues.
 *
 * Verify with scripts/weakLeaguesAudit.ts, which asserts a minimum surviving
 * gap per rung rather than mere rank order.
 */
export const COUNTRY_BUDGET_SCALE: Record<string, number> = {
  France: 0.7,
  Netherlands: 0.6,
  Portugal: 0.5,
  Belgium: 0.45,
  Turkey: 0.4,
  // The bottom three were raised (Greece .38, Scotland .35→.37, Serbia .32→.35)
  // on 2026-08-28 after the 12-country audit put 2 of 4 seeds into deficit where
  // the 10-country one had none (seed 3 Scotland −£5.2M at s20, seed 2 Serbia
  // −£0.2M). The mechanism is the documented one: weak leagues run on transfer
  // receipts, and going from 6 selling leagues to 8 splits the same big-four
  // demand more ways, so each poor league's receipts thin out. Base income has
  // to make up the difference. Still strictly monotonic with the offsets, which
  // is the invariant that actually matters.
  Greece: 0.39,
  Scotland: 0.37,
  Serbia: 0.35,
};
export function countryBudgetScale(country: string): number {
  return COUNTRY_BUDGET_SCALE[country] ?? 1;
}

/**
 * Center strength a club's academyBase converges toward after a promotion/
 * relegation swap — its new tier's band within its own country, so a promoted
 * French club rises toward French D1's (handicapped) level, not England's.
 */
export function academyBaseCenter(country: string, tier: number): number {
  return LEAGUE_BASE - countryStrengthOffset(country) - divisionStrengthOffset(tier);
}

/**
 * Composite normalization coefficient: normalized = 0.5 + NORMALIZE_K * z.
 * THE dial for league spread — after z-scoring, raw magnitudes cancel out, so
 * this (with the target distribution shape) governs both single-game favorite
 * odds and end-of-season table spread. Tuned against the M1 validation gates.
 */
export const NORMALIZE_K = 0.08;

/**
 * Star concentration for the attack/control/defense composite rollups
 * (2026-07-21). `rollupComposites` position-weights each phase (who drives it
 * counts most), then blends the weighted mean toward the group's single best
 * player: `dial = (1 - c) * weightedMean + c * peak`. This lets an elite
 * individual resist being averaged down by weak teammates, so a standout in a
 * key position genuinely carries a thin squad instead of being diluted to the
 * roster mean. 0 = pure weighted mean (no star effect); 1 = the group's best
 * player alone sets the dial. `finishing` is deliberately left on its own
 * shot-share weighting (no peak blend). Higher values swing more of a team's
 * strength onto one player — dynasty-audit title churn before raising it, as
 * the blend interacts with league z-normalization spread.
 */
export const COMPOSITE_STAR_CONCENTRATION = 0.3;

/**
 * Historic team seasons ("extremism", 2026-07-19, user ask): each club, each
 * season, has a small chance of a hidden season-long form swing — a dream
 * season (+TEAM_SEASON_FORM_DELTA on every normalized composite) or a season
 * from hell (−the same), derived deterministically from
 * hash(lid, season, tid) so it needs no schema change, survives any save
 * batching, and re-rolls every season. Applied when simThrough builds each
 * matchday's TeamMatchData (so league matches and cup ties both feel it);
 * ratings, valuations, and wages are untouched — it's purely on-pitch, so
 * standings/hype/prize money respond naturally and there are no market side
 * effects. The user's club is eligible like any other (user call:
 * symmetric). For scale: composites are 0-1 with 0.5 = average and
 * NORMALIZE_K (0.08) per z-score of true squad strength, so a delta of 0.12
 * ≈ ±1.5 z ≈ a mid-table squad playing like a title contender (or a
 * relegation corpse) for one season. Tuned against a 30-season world audit
 * with a form-disabled control on the same seed: 0.06 was a no-op at the
 * table level (5 champions with 90+ points vs the control's organic 3);
 * 0.12 lands 8 with a best of 100 points — a real "invincibles"-tier
 * campaign somewhere in the world every ~4 seasons — while champion churn
 * (14-18 distinct D1 winners/30 seasons) and the OVR equilibrium stay
 * intact. Probability is per direction (so ~3% of club-seasons total are
 * historic; in a 20-club division, one roughly every other season).
 */
export const TEAM_SEASON_FORM_PROB = 0.015;
export const TEAM_SEASON_FORM_DELTA = 0.12;

/**
 * Per-position OVR level correction, in OVR points, added by `computeOvr`.
 *
 * WHAT IT FIXES. A position's OVR weights sit on the very skills its players
 * generate highest — that is what makes them the position's key skills — so the
 * weighting and the generation table amplify each other, and a position with
 * more `star`/`H` tiers under its heavy weights reads several points above the
 * pack for no reason a player could ever act on. Measured on a fresh world
 * before this constant existed: mean OVR ran ST 55.9 down to FB 49.4, and
 * **132 of 320 clubs had a striker as their best player against 1 with a
 * full-back and 6 with a centre-mid** (each expected ~51 at their roster share).
 * Full-back is the one position with no `star` skill at all; striker and winger
 * have two each.
 *
 * WHY A CALIBRATION AND NOT A REWEIGHT. The weight rows say what matters at a
 * position, and they are read by the sim's slot logic, the secondary-position
 * derivation and the position-change check. Flattening them to equalize levels
 * would trade a true statement about football for an arithmetic convenience.
 * The level is a separate question from the shape, so it gets a separate,
 * visible knob — which the GK row was already doing by hand, summing to 92 so
 * keepers landed in the pack (see computeOvr, which now normalizes instead).
 *
 * ZERO-SUM BY CONSTRUCTION. Weighted by ROSTER_COMPOSITION these sum to ~0, so
 * the world's mean OVR is unchanged and every constant calibrated against it
 * still means what it did: LEAGUE_BASE, GROWTH_DAMPING_START (65),
 * DIVISION_2_REFUSAL_OVR_THRESHOLD (70), PROTECTED_STAR_OVR (80), the wage
 * curve and the valuation curve. It moves who is rated highly, never how many.
 *
 * DERIVED, NOT TASTE. `npx tsx scripts/positionOvrCalibrate.ts` measures each
 * position's mean against the world mean over several seeded worlds and prints
 * this table. `test/core/positionOvrBalance.test.ts` fails if any position
 * drifts back off the pack.
 */
export const POSITION_OVR_CALIBRATION: Record<Position, number> = {
  GK: -3.0, CB: 0.2, FB: 3.3, DM: -0.4, CM: 1.4, AM: -0.3, W: -0.8, ST: -2.9,
};

/**
 * Std dev of per-player, per-rating gaussian noise. Widened 6→8 alongside the
 * LEAGUE_BASE/TEAM_STRENGTH_SPREAD retune above, so a real elite (80-85+)
 * outlier tail exists from generation itself instead of only emerging after
 * a decade-plus of progression variance compounding one.
 */
export const RATING_NOISE_SD = 8;

/** Absolute-low pool for position-exclusive stats (independent of base). */
export const ABS_LOW_MIN = 5;
export const ABS_LOW_MAX = 20;

/** Ratings are clamped to this inclusive range. */
export const RATING_MIN = 1;
export const RATING_MAX = 99;

/** Players generated per team, by position (sums to 25). */
export const ROSTER_COMPOSITION: Record<Position, number> = {
  GK: 3, CB: 4, FB: 4, DM: 2, CM: 4, AM: 2, W: 3, ST: 3,
};

/**
 * Per-position multiplier on RATING_NOISE_SD at generation — DERIVED from the
 * OVR weight rows, never hand-tuned.
 *
 * THE SECOND HALF OF POSITION_OVR_CALIBRATION. That constant puts every
 * position on the same mean OVR; this one puts them on the same SPREAD, and
 * without it the mean fix just hands the problem to whichever position bets its
 * rating on fewest attributes. OVR is a weighted mean of independent rating
 * draws, so its noise is `RATING_NOISE_SD * sqrt(sum((w/W)^2))` — a portfolio,
 * where a concentrated row varies more. Keeper is the extreme: goalkeeping is
 * over half his weighting, so his multiplier is 0.58 against 0.34-0.42 for the
 * outfield, and the best of three keepers beat everyone else's best by enough
 * that **103 of 320 clubs had a goalkeeper as their best player** (expected 38)
 * once the levels were equalized. Extreme-value statistics: a 0.7-point edge in
 * spread wins the maximum far more often than 0.7 points suggests.
 *
 * WHY THE NOISE AND NOT THE WEIGHT ROW. The alternative is to flatten a
 * keeper's row until it varies like the rest, and that breaks something real —
 * the sim's `keeping` composite IS his goalkeeping rating (see
 * league/matchPlayers.ts), so an OVR that weights it less becomes a worse
 * prediction of the one thing he does, and the AI prices keepers off OVR. This
 * says the honest thing instead: keepers vary less in raw attributes than
 * strikers do. Match composites are z-normalized within a competition, so a
 * uniform change in a position's raw spread is very nearly invisible to the
 * sim — it moves the rating scale, not the football.
 *
 * The target is the composition-weighted mean multiplier, so the world's OVR
 * spread is held where it was; only its distribution BETWEEN positions moves.
 * Derived at module load from OVR_WEIGHTS, so editing a weight row re-derives
 * this automatically instead of silently reopening the gap.
 */
export const POSITION_RATING_SPREAD: Record<Position, number> = (() => {
  const positions = Object.keys(ROSTER_COMPOSITION) as Position[];
  // Noise multiplier each row implies: sqrt(sum of squared NORMALIZED weights).
  // Height is excluded — computeOvr centres it, so it carries no level and its
  // own spread is a fraction of a point.
  const mult = {} as Record<Position, number>;
  for (const pos of positions) {
    const row = OVR_WEIGHTS[pos];
    const keys = (Object.keys(row) as (keyof typeof row)[]).filter((k) => k !== "height");
    const total = keys.reduce((a, k) => a + row[k]!, 0);
    mult[pos] = Math.sqrt(keys.reduce((a, k) => a + (row[k]! / total) ** 2, 0));
  }
  const slots = positions.reduce((a, p) => a + ROSTER_COMPOSITION[p], 0);
  const target = positions.reduce((a, p) => a + (ROSTER_COMPOSITION[p] / slots) * mult[p], 0);
  const out = {} as Record<Position, number>;
  for (const pos of positions) out[pos] = target / mult[pos];
  return out;
})();

/**
 * Share of a position's players who pick up any one adjacent position as a
 * second job (see players/positions.ts). A player qualifies by being unusually
 * capable there *for a player of his position* — never by one threshold shared
 * across positions, which cannot work at any value: the spread of "how close do
 * I rate at the next position along" is a property of the position PAIR, so a
 * flat gap makes every midfielder a three-position player before any striker is
 * a two-position one (measured: at a 3-point gap, 100% of CMs and 6% of STs).
 * `scripts/secondaryPositionProbe.ts` has the table showing that.
 *
 * Per pair, so a position with three coverable slots ends up more versatile
 * than one with a single slot — which is the intent: a full-back genuinely is a
 * more flexible job than a striker.
 */
export const SECONDARY_POSITION_RATE = 0.15;

/**
 * Per-pair OVR-difference cutoffs implementing SECONDARY_POSITION_RATE, as
 * `primary: { adjacent: minimum (ovrAtAdjacent - ovr) }`. MEASURED, not tuned —
 * regenerate with `npx tsx scripts/secondaryPositionProbe.ts` if the rate, the
 * OVR weights or the adjacency table change, and paste the output here.
 *
 * Baking the percentile into a static table (rather than ranking against the
 * live pool) keeps the derivation a pure function of one player: no population
 * scan on every render, and a player's badge can't change because someone else
 * was transferred.
 *
 * **Calibrated on a FRESH world, and the mature-world alternative was measured
 * and rejected.** Versatility rises over a dynasty and then settles. Rostered
 * players holding any second position: fresh 35.4%, then 45.5 / 51.5 / 53.6 /
 * 54.7 / 54.9 / 54.8 at seasons 5/10/15/20/25/30 — flat from season 20, so this
 * is an equilibrium, not a ratchet, which is the property that matters. Cause is
 * progression flattening rating profiles: every OVR weight row sums to 100, so a
 * *uniform* rating gain cancels out of the position difference exactly, and it
 * is `growthDamping` compressing a player's strongest skills that pulls his
 * adjacent-position ratings toward his own. It is NOT the accumulating
 * free-agent tail — that was the first hypothesis and it is wrong; rostered
 * squads drift the same as the whole pool.
 *
 * Recalibrating against the season-15 plateau (so the mature rate hit the
 * target instead of the season-1 rate) was tried and measured: it leaves a NEW
 * save at **9.3%**, with 3% of wingers and 4% of full-backs holding a second
 * position — no utility players at all in the seasons a new player actually
 * sees. The drift is bounded and reads as players broadening with experience,
 * so the fresh-world calibration ships and the rise is intended behaviour.
 *
 * This matters beyond the badge: a secondary WAIVES the familiarity penalty, so
 * letting the rate run high would quietly dissolve the positional discipline
 * that slot-aware composites exist to enforce. That is the number to watch if
 * these constants are ever retuned.
 *
 * **Re-derived when POSITION_OVR_CALIBRATION shipped (2026-08-23), and this is
 * the reason these bars must never be hand-edited.** They are a percentile of a
 * per-pair GAP, so any change to a position's OVR level shifts every bar that
 * touches it by that amount — the table silently becomes a table of something
 * else. Measured on the old bars under the new formula, "holds any second
 * position" ran CB 93% and DM 93% against FB 1%, i.e. the fixed share the whole
 * design rests on had stopped being fixed. Re-running the calibrator restored
 * it (fresh world, any secondary 34.1%, close to the 35.4% it shipped at). The
 * per-season drift figures above were measured before that and are the one part
 * of this note not yet re-checked; the mechanism causing them is untouched.
 */
export const SECONDARY_POSITION_CUTOFF: Record<Position, Partial<Record<Position, number>>> = {
  GK: {},
  CB: { FB: -1, DM: -2 },
  FB: { CB: -5, W: -6 },
  DM: { CB: 1, FB: 1, CM: 0 },
  CM: { DM: -1, AM: -1 },
  AM: { CM: -1, W: 0, ST: -6 },
  W:  { FB: -2, AM: -2, ST: -7 },
  ST: { W: -3 },
};

/**
 * How many OVR points better a player must be at another position before it
 * becomes the one he is *listed* at — a career position change, as distinct
 * from the second job `SECONDARY_POSITION_CUTOFF` grants him.
 *
 * A conversion is not cosmetic. `ovr` is position-relative by construction, so
 * relisting a player where he rates higher RAISES his OVR, and wages are cubic
 * in it while transfer value is steeper still. That makes this constant an
 * inflation control first and a flavour knob second.
 *
 * Measured on a generated world (`scripts/positionChangeProbe.ts`), the share of
 * players who have some better position at all, and what the move would pay:
 *
 *     margin | fresh world | after 10 seasons | mean gain
 *     -------+-------------+------------------+----------
 *          0 |        9.7% |            22.9% |      2.45
 *          2 |        3.9% |            14.3% |      3.32
 *          3 |        1.3% |             8.4% |      4.24
 *          4 |        0.3% |             4.7% |      5.21
 *          6 |        0.0% |             1.3% |      7.34
 *
 * A fresh world is already correctly listed — generation picks a position and
 * then rolls ratings for it — so nothing fires on a new save, which is right.
 * The backlog builds over a career instead, and the cause is development rather
 * than aging: mean best-position gain by age runs 0.37 / 0.70 / 0.74 / 0.60 /
 * 0.51 across <=20 / 21-24 / 25-28 / 29-32 / 33+, peaking in the mid-20s and
 * FALLING for the oldest players. Decline barely moves it, because a uniform
 * rating loss cancels exactly (every OVR weight row sums to 100); what tilts a
 * profile is `growthDamping` compressing a player's strongest skills during his
 * growth years — the same mechanism that raises versatility over a dynasty.
 */
export const POSITION_CHANGE_MARGIN = 4;

/**
 * How many consecutive seasons the margin above must hold before the position
 * actually changes.
 *
 * This, not the margin, is what makes the feature viable. Measured, **5.9% to
 * 8.0% of rostered players change which position they rate highest at EVERY
 * SEASON** — so an instantaneous "play where you rate best" rule would relabel
 * roughly 600 players a year, and a badge would mean nothing. Requiring the gap
 * to survive several seasons filters for a real change in profile rather than a
 * lucky noise draw.
 *
 * It is also the inflation control that matters, for the same reason. Taking a
 * player's best-of-N positions is a maximum over noisy quantities, which sits
 * systematically above any single fixed pick; demanding the same winner N
 * seasons running strips out most of that selection bias, leaving the genuine
 * profile drift behind it.
 *
 * The window is counted over snapshots taken *while he was listed at his
 * current position* (`RatingsSnapshot.pos`), which hands the mechanic a
 * cooldown for free: right after a conversion his history at the new position
 * is empty, so he cannot move again until he has accumulated a fresh window.
 * That is what stops a borderline player oscillating between two positions and
 * collecting an OVR bump on each leg.
 */
export const POSITION_CHANGE_SEASONS = 3;

/**
 * Most secondary positions a player can hold. Two (so at most a three-position
 * player) because the adjacency table gives outfielders only 2-3 candidates
 * anyway, and an unbounded list would print a badge nobody can read.
 */
export const MAX_SECONDARY_POSITIONS = 2;

/** Matchday bench size: the best remaining roster players (by ovr) after the starting XI. */
export const BENCH_SIZE = 7;

/**
 * Team OVR/POT rating (Standings, Roster header): a weighted average across
 * the starting XI and bench, not a straight mean of the whole roster —
 * modeled on how BBGM/Football GM derive team ratings from a top-N,
 * depth-weighted slice of the roster rather than every rostered player.
 * Starters all weigh TEAM_RATING_STARTER_WEIGHT (1); each bench player past
 * them weighs less, decaying geometrically by TEAM_RATING_BENCH_DECAY per
 * depth slot off a TEAM_RATING_BENCH_BASE_WEIGHT starting point, so a strong
 * bench lifts the rating while deep fringe players barely move it.
 */
export const TEAM_RATING_STARTER_WEIGHT = 1;
export const TEAM_RATING_BENCH_BASE_WEIGHT = 0.5;
export const TEAM_RATING_BENCH_DECAY = 0.75;

/**
 * Power Rankings (src/core/teams/powerRanking.ts): squad OVR alone is only
 * half the picture, so a team's current-season results are layered on top as
 * a bonus/penalty on the same OVR scale. Each played match is scored against
 * an Elo-style expectation derived from the OVR gap to that specific
 * opponent (POWER_EXPECTED_POINTS_SLOPE — extra expected points-per-game per
 * 1 OVR point of advantage, off a 1.5 baseline for an even match, clamped to
 * the real 0-3 a match can pay out), so beating a strong side is worth more
 * than beating a weak one and vice versa for losses. Goal difference
 * (capped at POWER_GD_CAP so one blowout can't swing things) is added in at
 * POWER_GD_WEIGHT per goal. The per-game average of all that is scaled by
 * POWER_PERFORMANCE_WEIGHT onto the OVR axis for the final bonus.
 */
export const POWER_EXPECTED_POINTS_SLOPE = 0.08;
export const POWER_GD_WEIGHT = 0.15;
export const POWER_GD_CAP = 4;
export const POWER_PERFORMANCE_WEIGHT = 4;

/**
 * Power-rankings history: a full snapshot of the rankings is persisted after
 * every POWER_SNAPSHOT_INTERVAL-th matchday (10, 20, 30) plus the season's
 * final matchday, so past rankings stay browsable — they can't be rebuilt
 * retroactively, since rosters change mid-season and `played` is wiped every
 * offseason. See LeagueStore.powerRankingHistory.
 *
 * **This is a save-size constant as much as a UI one.** A snapshot is a row per
 * club for the whole world (320 rows), and the history is never pruned, so the
 * cadence sets a permanent per-season tax on every save. It was 5 (8 snapshots
 * a season, counting the finale); measured on a simmed season-56 save that had
 * grown to 448 snapshots / 143,360 club-rows / 18.2 MB — the largest single
 * non-player field, and 18% of a 101 MB save. At 10 a season stores 4, which
 * still reads as a quarterly progression through the season on the Power
 * Rankings dropdown. Raising the snapshot count again is not free; price it in
 * MB per 50 seasons before changing it.
 */
export const POWER_SNAPSHOT_INTERVAL = 10;

/**
 * Hard squad-size limit enforced on player-adding actions (free-agent
 * signings, transfer buys). Set comfortably above ROSTER_COMPOSITION's 25 so
 * clubs have real squad depth, matching typical real-world first-team limits.
 * Youth intake and AI free agency aren't gated by this (AI is trimmed back
 * to ROSTER_COMPOSITION every offseason anyway); it only blocks actions that
 * could otherwise let a roster grow without bound.
 */
export const ROSTER_CAP = 30;

/**
 * Emergency call-up floor for the user's own senior roster (offseason.ts's
 * ensureUserRosterSafety): unlike AI, the user's roster is never
 * auto-trimmed OR auto-replenished (free agency/youth intake skip them by
 * design so the user manages manually) — but nothing else automatically
 * refills it either, so an inattentive user's roster can otherwise shrink
 * toward unfieldable purely from contract expiry/retirement over several
 * unmanaged offseasons (a real, empirically observed risk, not
 * hypothetical: a 25-man squad dropped to 13 by season 4 in one seeded
 * multi-season audit with zero manual signings). Fielding fewer than 11
 * crashes the match engine and bricks the save (see CLAUDE.md's known-gaps
 * note), so each offseason the user's best academy prospects are
 * automatically promoted — GK first if the roster has none, then by ovr —
 * until the roster reaches this floor or the academy runs out. This never
 * fires for an attentively-managed roster; it's a backstop, not a normal
 * source of squad growth.
 */
export const ROSTER_SAFETY_FLOOR = 18;

/**
 * Free-agent pool cull (see core/players/freeAgentCull.ts).
 *
 * Nothing ever removed unsigned free agents, so the pool grew without bound: a
 * 14-season save held 9245 of them against 5996 rostered players, and 96% had
 * never peaked above ovr 55 — washed-out youth intake nobody would ever sign.
 * That pool was ~27% of the whole save, and save size is what makes the game
 * freeze (every mutation writes the entire league to IndexedDB, every sim
 * structuredClones it to the worker; both block the main thread and both scale
 * with total size).
 *
 * A player is culled only if he is on NO roster (senior or academy) AND all
 * three of these hold. The age and potential gates are what protect the youth
 * pipeline: a 17-year-old at ovr 45 with potential 80 has a career *peak* of 45,
 * so culling on peak alone would delete this season's prospects before the user
 * ever saw them on /incoming-talent.
 */
export const FREE_AGENT_CULL_MIN_AGE = 24;
/** Career-peak ovr (best across his ratings history) at or below which he goes. */
export const FREE_AGENT_CULL_MAX_PEAK_OVR = 65;
/** Potential at or below which he's judged never going to become useful. */
export const FREE_AGENT_CULL_MAX_POT = 65;

/**
 * Unsigned free agents above which a save is treated as bloated, and gets culled
 * at **load** rather than waiting for its next offseason.
 *
 * The load-time cull exists for saves that are already frozen: their owner can't
 * reach an offseason to have the pool cleaned up. But culling on every load makes
 * deletions immediate mid-season — release a player by mistake, reload, and he's
 * gone rather than re-signable from /free-agents. Gating on pool size keeps that
 * out of normal play: a pool the ongoing offseason cull is keeping bounded sits
 * around 5.3k, while the un-culled 14-season save that prompted this held 9245.
 */
export const FREE_AGENT_CULL_LOAD_THRESHOLD = 7000;

/**
 * Cap on the "Completed This Window" list on /transfers.
 *
 * This list was uncapped, and it is what froze the page. A 240-club world moves
 * thousands of players per summer window: a real 5-season save rendered **2056
 * rows, 2066 flag images and 10684 DOM elements**, pulling ~1 MB of SVG flag art
 * (single flags run 150-240 KB of coat-of-arms detail, drawn at 13px tall). The
 * JS was never the problem — that render is 147ms — which is exactly why it
 * never showed up in any profiling of the page's logic. The cost is layout,
 * image decode and paint, and it is why /transfers froze when no other page did.
 *
 * The user's own deals always show; this bounds the rest.
 */
export const WINDOW_TRANSFER_LIMIT = 50;

/**
 * Cap on the rows one season renders on /news, for exactly the reason above.
 *
 * The News Feed inherited the uncapped-list problem the moment the transfer
 * list lost it, and it is the worse of the two because `newsEvents` is
 * append-only and persisted, so a season's feed never shrinks and the page
 * grows for the life of the save. Measured on a real 3-season save: **956 rows,
 * 15,903 DOM elements, 1,932 flag images and a 34,345px page** — already half
 * again past the element count that froze /transfers, three seasons in.
 *
 * Deliberately higher than WINDOW_TRANSFER_LIMIT: this is the page you go to in
 * order to read a season, where /transfers' list is a footnote under the thing
 * you actually came for. 150 rows keeps a season readable while holding the
 * element count near where a single-window transfer list sits.
 *
 * The user's own club's news always shows; this bounds the rest.
 */
export const NEWS_FEED_SEASON_LIMIT = 150;

/** In-match injuries (M5): games missed once hurt, uniform between these inclusive bounds. */
export const INJURY_GAMES_MIN = 1;
export const INJURY_GAMES_MAX = 6;

/**
 * Suspensions (core/suspensions.ts). Cards were simulated per match long before
 * they carried any consequence past the final whistle; these turn them into
 * league bans, on the real game's standard tariff.
 *
 * League matches only, by design rather than omission: a ban is served in the
 * competition it was earned in, and the engine only tracks league bookings
 * (cup cards are aggregated onto the cup's own stat lines, and international
 * football is watch-only). So a banned player still turns out in the cup, which
 * is what actually happens.
 *
 * Ban lengths are deliberately *not* stacked: a player who is sent off in the
 * same match that his fifth yellow lands serves the longer of the two, not the
 * sum. Stacking is more realistic but reads as a pile-on for an outcome the
 * manager has no lever over, and the difference is a single match.
 */
export const SUSPENSION_YELLOW_THRESHOLD = 5;
export const SUSPENSION_YELLOW_MATCHES = 1;
export const SUSPENSION_SECOND_YELLOW_MATCHES = 1;
export const SUSPENSION_RED_MATCHES = 3;

/** Generation-offset tier → additive offset (Table A). */
export const TIER_OFFSET = { star: 18, H: 10, M: 2, L: -12, VL: -25 } as const;

/** Initial league generation: uniform age range for starting rosters. */
export const INITIAL_AGE_MIN = 18;
export const INITIAL_AGE_MAX = 33;

/** Youth intake players are always generated at this age. */
export const YOUTH_AGE = 16;

/** Youth intake: min/max generated players per club per season. */
export const YOUTH_INTAKE_MIN = 3;
export const YOUTH_INTAKE_MAX = 5;

/**
 * Youth are raw: generated `base` this many points below the club's fixed
 * academyBase anchor. Raised 20→25 (2026-07-15) after a root-cause dynasty
 * audit found the whole league's rostered OVR climbing ~4-5 points over a
 * generation's worth of turnover (~20-25 seasons) even with progression's
 * per-player age-curve constants themselves net-flat-to-declining over a
 * realistic career: `generatePlayer`'s rating rolls don't depend on age at
 * all, so a 16-year-old was generated at the *same* quality distribution as
 * a mature adult and then still got 8-10 more years of normal age-curve
 * growth on top before reaching maturity — every generation of rookies
 * entered stronger than intended and grew further, so the league's average
 * crept up purely from turnover as older (correctly-generated, at the old
 * standard) players retired and were replaced. Empirically swept
 * (isolated single-division sim: generation + progression + retirement +
 * youth intake + roster trimming, no transfers) to find the offset that
 * holds a 40-season final mean flat against the season-1 generation mean —
 * 20 overshot to +4.5, 30 undershot to -4, 25 landed within ~0.3.
 *
 * Re-swept 25→34 (2026-07-15, same day) after PROGRESSION_FORM_SD_YOUNG/OLD
 * and PROGRESSION_BIAS_SD_YOUNG were widened for more dramatic season-to-season
 * swings — wider variance interacting with growthDamping's asymmetry (only
 * the positive side is damped) and the RATING_MAX clamp shifted the
 * equilibrium this offset needs to hit, so it needed re-verifying rather
 * than assuming the old value still held. Re-swept the same way: 25
 * (previous value) now overshot to +8.5, 30 to +2, 35 undershot to -1.2,
 * 34 landed within ~0.2.
 */
export const YOUTH_BASE_OFFSET = 34;

/**
 * Soft floor under the youth-generation base (see `youthGenerationBase` in
 * players/youth.ts), fixing a rating **underflow** at weak clubs.
 *
 * `academyBase - YOUTH_BASE_OFFSET` is a *flat* subtraction, but `academyBase`
 * spans **18.8 to 63.0** across the 16-competition world, so for **73 of 320
 * clubs** it comes out negative — as low as **-15.2**. Every rating is then
 * generated below zero and clamped to `RATING_MIN` (1), which does not produce
 * a weak player, it produces a destroyed one: an ST with speed/passing/
 * dribbling/positioning all at 1 and a couple of survivors where a lucky roll
 * or the position-independent "ABS" tier landed above the floor. Measured on a
 * fresh world, one offseason: **472 of 1,268 new youth (37%) arrived at OVR
 * 0-15, and 98% of those were released to free agency the same offseason**.
 * A real user save surfaced one as a 16-year-old striker at **OVR 9**.
 *
 * **Why a soft floor and not a hard one, and not a proportional offset:**
 * - The intended gap is ~33 OVR (measured: 32.0/32.3/33.8/33.3/31.8/33.8/32.9
 *   across the healthy range), and `YOUTH_BASE_OFFSET` was swept to hold a
 *   40-season mean flat (see above). It is an **anti-inflation constant**, so
 *   healthy clubs must come out bit-identical. A proportional offset changes
 *   every club and would need that whole sweep redone.
 * - A *hard* floor (`Math.max`) makes every club below the cut generate
 *   **identical** youth, erasing the academy gradient exactly where the country
 *   strength ladder is most fragile (see COUNTRY_STRENGTH_OFFSET).
 * - A ~33 OVR gap is simply unavailable to a club whose seniors average 29.4 —
 *   the scale bottoms out — so the gap *has* to compress down there. Softplus
 *   compresses it smoothly while staying strictly monotonic, so a weaker
 *   academy still produces weaker youth than a stronger one.
 *
 * `YOUTH_BASE_SOFTNESS` sets how wide the bend is. **Both are deliberately
 * tiny, and that is the whole point — this must be surgery, not a rescale.**
 * Only **73 of 320** clubs are actually broken (raw base < 0), but 275 sit
 * below raw base 20, so a bend wide enough to "look smooth" quietly lifts most
 * of the world. Measured at a first attempt of FLOOR=4/SOFTNESS=5: **295 of
 * 320 clubs lifted, mean +3.67 rating points world-wide**, which raised
 * end-of-dynasty OVR by 1.3-3.1 in *every* league (the big four included, via
 * their own tier 2 and the upward drain) and pushed the weak-league solvency
 * audit from 1 failing seed to 4. At FLOOR=1/SOFTNESS=1 the lift at raw base
 * 6.3 and 11.3 is **0.00** and only 110 clubs move at all.
 *
 * Why 1 is enough: counting how many of a 16-year-old's 14 ratings pin at
 * RATING_MIN, base -15.2 pins **10.5** (the position-relevant ones die, which
 * is the bug), base 1 pins **5.0**, and a perfectly healthy base of 11 still
 * pins **2.4** — some pinning is normal, since a striker's tackling is
 * generated 25 below his base. Going further to base 4 only moves 5.0 -> 4.1
 * pinned and mean OVR 15.1 -> 17.6, buying almost nothing for several times
 * the world-wide lift. The target is "the position-relevant ratings survive",
 * not "no rating ever pins".
 *
 * Measured on a fresh 320-club world at the shipped values: strictly monotonic
 * across every club, no club left below a raw base of 0, and the weakest club
 * in the world goes from youth OVR min/mean/max **1/4.1/9 to 5/13.5/25** against seniors
 * averaging 29.4.
 *
 * **Known cost, accepted:** any floor flattens the very bottom, so the weakest
 * clubs generate near-identical youth and ACADEMY_FORM_SWING (added to
 * academyBase *before* this transform) has less bite down there. Monotonicity
 * is preserved, just compressed.
 */
export const YOUTH_BASE_FLOOR = 1;
export const YOUTH_BASE_SOFTNESS = 1;

/**
 * Dynamic academy attraction: a club's youth-intake quality gets a bonus or
 * penalty based on its league finishes over the last ACADEMY_FORM_SEASONS
 * completed seasons — better young players are drawn to clubs that have been
 * playing well, and shun clubs scrapping at the bottom. The modifier is
 * derived from *normalized finishing rank within the club's own competition
 * each season* (champion = +1, bottom = -1, mid-table = 0, averaged across
 * the window and scaled by ACADEMY_FORM_SWING points), which makes it
 * zero-sum within each division by construction: one club's stronger intake
 * is exactly offset by a rival's weaker one, so — unlike the old
 * anchor-to-current-roster-average design that YOUTH_BASE_OFFSET's comment
 * above describes tearing out — sustained success can't ratchet the *league's*
 * intake quality upward, only redistribute it toward the successful.
 */
export const ACADEMY_FORM_SEASONS = 3;
export const ACADEMY_FORM_SWING = 5;

/**
 * BBGM-style progression (see src/core/players/progression.ts for the full
 * model). Base age curve is defined around a canonical peak of ~26
 * ("25-27: around peak" per design brief); PHYSICAL and SKILL rating groups
 * each shift the age they read from that curve so physical ratings peak
 * earlier and decline first, while skill ratings peak later and decline
 * slower. GKs get an additional shift on top (peak later still, career-long
 * keepers).
 */
export const BASE_AGE_CURVE_PEAK = 26;
/** [age - peak, expected mean rating delta] control points; linearly interpolated between. */
export const BASE_AGE_CURVE: readonly [number, number][] = [
  [-8, 3], [-7, 2.7], [-6, 2.2], [-5, 1.7], [-4, 1.3], [-3, 1], [-2, 0.65], [-1, 0.3],
  [0, 0.1], [1, 0], [2, -0.5], [3, -1], [4, -1.75], [5, -2.25], [6, -2.75], [7, -3.25],
  [8, -3.75], [9, -4.25], [10, -4.75],
];

/**
 * Physical ratings (speed, strength, stamina, jumping) read the curve this
 * many years "older". Skill ratings (technical/mental + goalkeeping) read it
 * this many years "younger", and GKs get an extra shift on top of that.
 * Calibrated so each rating group's survival-weighted (retirement-aware)
 * expected lifetime delta is ~0 or slightly negative for every position —
 * a career should average out flat-to-declining, not net growth, or a
 * dynasty's rostered population inflates without bound over decades (a
 * bought-and-verified-empirically failure mode with the previous ±3/-3
 * values, worst for skill-heavy positions like GK/CM/AM/DM).
 */
export const PHYSICAL_AGE_SHIFT = 3;
export const SKILL_AGE_SHIFT = -1.5;
/** Extra "younger" shift applied to every rating group for goalkeepers (mild career-long-keeper edge). */
export const GK_AGE_SHIFT = -0.5;

/** Minutes played is a minor nudge on growth-phase deltas only, not the previous 0.3-1.0x multiplier. */
export const MINUTES_FACTOR_MIN = 0.85;
export const MINUTES_FACTOR_MAX = 1.15;
/** Appearances considered a "full" season of minutes for the minutes nudge. */
export const FULL_SEASON_APPEARANCES = 30;

/** Per-rating noise std dev at age 18 and at age 33+, linearly interpolated by age (variance narrows with age). */
export const PROGRESSION_NOISE_SD_YOUNG = 3.5;
export const PROGRESSION_NOISE_SD_OLD = 1.5;

/**
 * "Form" noise: one shared gaussian roll per rating group (physical, skill)
 * per player per season, added on top of each rating's independent noise
 * above. Per-rating noise alone averages out across the ~10-14 ratings that
 * feed a weighted-average ovr (central limit theorem), so a season's real
 * ovr movement was almost entirely the deterministic age-curve mean — no
 * player ever had a real breakout or bust year. This shared roll moves every
 * rating in a group together, so it survives the ovr average and produces
 * real season-to-season ovr swings, matching BBGM's approach of layering
 * shared variance on top of per-rating noise. Zero-mean like the per-rating
 * noise, so it doesn't shift long-run league equilibrium on its own — though
 * combined with `growthDamping` (which only suppresses the positive side),
 * widening this does pull the equilibrium down slightly, since a wider
 * negative tail passes through undamped while a wider positive tail gets
 * cut; re-verified via dynasty audit and `YOUTH_BASE_OFFSET` retuned
 * alongside this change to hold the league flat regardless.
 *
 * Raised 3→6 (young) / 0.75→2 (old), 2026-07-15, per explicit user request
 * for more dramatic season-to-season swings ("more +5, -5") — a prior pass
 * had deliberately tightened this from an original 5/1 specifically because
 * a young player losing 10 ovr in one season felt too extreme at the time.
 * Swept empirically (age 20/22/26/30 samples) to a value where a ±5 swing
 * is a regular, noticeable occurrence rather than a rare tail event (~28-36%
 * of young players see one in a given season, was ~5-16%), while ≥10
 * swings stay a minority outcome (2-4%, not routine) rather than common.
 */
export const PROGRESSION_FORM_SD_YOUNG = 6;
export const PROGRESSION_FORM_SD_OLD = 2;

/**
 * Development "personality": a fixed-per-player gaussian bias (derived
 * deterministically from pid, not drawn from the shared rng stream — see
 * `developmentBias` in progression.ts) applied every season on top of the
 * per-season form roll above, but only through peak age (tapers to exactly
 * 0 by `BASE_AGE_CURVE_PEAK` — see `biasSdAt`, not the shared young/old
 * `sdAt` helper). This is what makes some prospects consistent clean
 * developers (every growth-age season trends up) and others consistent
 * busts (every growth-age season trends down). It must taper to zero well
 * before retirement age, not just narrow like the other noise terms: a
 * persistent nonzero contribution surviving into decline years would give a
 * lucky player's expected *lifetime* rating delta a nonzero value over a
 * 15+-season career, reopening the exact unbounded-inflation failure mode
 * `SKILL_AGE_SHIFT`/`GK_AGE_SHIFT` were tuned to close (see their comment) —
 * confirmed empirically the first time this constant was added (tapering to
 * `RETIREMENT_START_AGE` instead of peak age let 90+ players climb to 17.7%
 * of the AI pool by season 25 in a dynasty audit, instead of staying near 0%).
 *
 * Raised 1.5→3, 2026-07-15, alongside PROGRESSION_FORM_SD_* above — same
 * "more dramatic swings" request.
 */
export const PROGRESSION_BIAS_SD_YOUNG = 3;

/**
 * Growth resistance: as a player's *current* ovr climbs through this range,
 * the positive part of a season's development (age-curve growth + bias +
 * form roll, combined, before per-rating noise) is scaled down toward
 * `GROWTH_DAMPING_FLOOR` — a big breakout jump should get rarer the closer a
 * player already is to elite, on top of (not instead of) the age curve
 * already slowing growth down. Declines are never damped by this: a bust
 * trending down should decline just as easily whether they're rated 55 or
 * 75 — real resistance to being *good* isn't resistance to getting worse.
 * Purely rating-driven, independent of age, so it also acts as a soft
 * ceiling beneath the hard `RATING_MAX` clamp.
 *
 * `GROWTH_DAMPING_END`/`GROWTH_DAMPING_FLOOR` retuned 90→80 / 0.25→0.02
 * (2026-07-15), same day as the `PROGRESSION_FORM_SD_*`/`PROGRESSION_BIAS_SD_YOUNG`
 * widening above — bigger swings alone pushed Division 1's 80+ OVR
 * population from ~15-20 (the user's explicit target) up to 60-80 (12-16%
 * of the pool). A wider swing distribution needs the elite end throttled
 * harder to land the same target population, not just a proportional bump.
 * Swept empirically against a 30-season × 3-seed dynasty audit (real
 * `simThrough`/`simOffseason`, Division 1's ~500 players): 0.25 (unchanged)
 * gave 61-78, 0.05 gave 39-56, 0.02 with `GROWTH_DAMPING_END` also pulled in
 * from 90→80 landed **8-16** — back in the intended range. Re-verified via a
 * 100-season audit that Division 1's own mean still holds flat (61-64.5
 * throughout, no further compounding drift from tightening this).
 */
export const GROWTH_DAMPING_START = 65;
export const GROWTH_DAMPING_END = 80;
export const GROWTH_DAMPING_FLOOR = 0.02;

/**
 * Generational talents ("extremism", 2026-07-19, user ask): the damping above
 * deliberately makes 90+ OVR unreachable — stable, but it means the game can
 * never produce a Messi/Haaland-tier legend. A tiny fraction of players are
 * flagged *generational*, derived deterministically from pid via a salted
 * hash (the developmentBias pattern — consumes zero shared rng, no schema
 * change, no migration): for them growth damping relaxes to the
 * GENERATIONAL_DAMPING_* curve (still damped, just with real headroom to
 * ~90+), and their development bias z-score is floored at
 * GENERATIONAL_BIAS_MIN_Z so a generational kid is always at least a decent
 * developer — though form rolls still vary season to season, so the arc is a
 * story, not a script. GENERATIONAL_CHANCE is per player ever generated;
 * youth intake runs ~500-650 players/season world-wide, so 1/2500 ≈ one new
 * generational talent somewhere in the world every ~4-5 seasons. Tuned
 * empirically (200-trial career sims per template kid): announced kids peak
 * at a median ~80 OVR, ~30% reach 85+, ~13% reach 90+ (max observed 96) —
 * so a genuine 90+ legend emerges roughly once every ~30 seasons, while an
 * identical kid without the flag never passed 79 in the same trials. Rare
 * enough that the league-wide OVR equilibrium (audited at length above) is
 * undisturbed; his arrival is announced on the News Feed.
 */
export const GENERATIONAL_CHANCE = 1 / 2500;
export const GENERATIONAL_DAMPING_END = 95;
export const GENERATIONAL_DAMPING_FLOOR = 0.6;
export const GENERATIONAL_BIAS_MIN_Z = 1.5;

/**
 * Potential (BBGM-style): a scout's *estimate*, not a growth driver. It plays
 * no part in progressPlayer's math — actual development is driven only by
 * age/rating-group and noise (per the BBGM manual: progression depends on
 * current ratings, age, and coaching, never potential). Potential is instead
 * computed by simulating a player's future career arc forward
 * POTENTIAL_SIM_TRIALS times (same age-curve model, independent noise per
 * trial) and reading off the POTENTIAL_SIM_PERCENTILE of each trial's peak
 * ovr — so on average a player exceeds their listed potential about
 * (1 - POTENTIAL_SIM_PERCENTILE) of the time, matching "most players never
 * reach their potential, but some do and some exceed it."
 */
export const POTENTIAL_SIM_TRIALS = 16;
/** Simulated trajectories run forward (in seasons) up to this age. */
export const POTENTIAL_SIM_MAX_AGE = 40;
export const POTENTIAL_SIM_PERCENTILE = 0.75;

/**
 * Retirement (reworked 2026-07-28 — was age-only). Two inputs: **age** sets
 * the shape of the curve, **whether a club rostered him last season** sets its
 * scale. Nothing else — not ovr, not potential, not minutes. Roster status is
 * deliberately the whole quality signal, because the AI market already sorts
 * wanted from unwanted every offseason (renewals, free agency, quality
 * poaching, `trimRosterSurplus`), so "good enough to still be playing at 39"
 * falls out of it without a second quality term to tune or to drift.
 *
 * The age curve is unchanged: nothing below `RETIREMENT_START_AGE`, then
 * `RETIREMENT_BASE_PROB` climbing by `RETIREMENT_PROB_PER_YEAR` each year.
 * From there:
 *
 * - **Rostered** last season → the age curve scaled by
 *   `RETIREMENT_ROSTERED_DAMPING`. Damped, never zeroed: age still dominates,
 *   so even a wanted 39-year-old has a real chance of hanging them up. At 0.6
 *   a continuously-rostered player's median retirement lands ~37 and ~12% are
 *   still going at 40 (vs ~1% past 39 under the old age-only curve).
 * - **Unrostered** last season → `RETIREMENT_UNROSTERED_BASE` at *any* age,
 *   plus the undamped age curve on top. This is the half of the rework that
 *   matters most: before it, a player nobody ever signed sat in the free-agent
 *   pool from 16 until he hit 33 and only then began rolling, so every
 *   season's youth-intake surplus accumulated there permanently. Now he drifts
 *   out of the game instead.
 * - **Unrostered but still a prospect** (*under*
 *   `RETIREMENT_PROSPECT_MAX_AGE` **and** potential above
 *   `RETIREMENT_PROSPECT_POT_THRESHOLD`) → treated as wanted, i.e. back onto
 *   the damped curve. Without this, a 17-year-old at ovr 45 with a ceiling of
 *   80 washes out at the same rate as a journeyman nobody will ever sign,
 *   which throws away exactly the players `/incoming-talent` exists to surface.
 *   It is the *one* place quality enters retirement directly rather than
 *   through roster status.
 *
 *   **The age bound is load-bearing, not decoration.** `estimatePotential`
 *   seeds its simulated peak at the player's current ovr and only ever raises
 *   it, so `potential >= ovr` *always* holds. Without an age gate the
 *   exemption therefore catches every unrostered player above ovr 65 — a
 *   released 37-year-old on ovr 70 included — and hands him the *damped*
 *   curve, which at 37 is 0.318 against 0.53 on the old age-only model. That
 *   is backwards: it would make good unsigned veterans retire ~40% *less* than
 *   before the rework, and leave the ovr-66+ slice of the pool as the one
 *   population nothing removes (the cull spares it too, on
 *   `FREE_AGENT_CULL_MAX_PEAK_OVR`). The bound keeps the exemption meaning
 *   "prospect", which is all it was ever for.
 *
 *   Both bounds are pinned to the pool cull's own constants rather than given
 *   their own numbers, so the two mechanics can't drift apart on either axis.
 *   They are **not** fully complementary even so: the cull additionally spares
 *   career peak > `FREE_AGENT_CULL_MAX_PEAK_OVR`, which retirement ignores on
 *   purpose — an unsigned ex-good 30-year-old *should* retire. Note this reads
 *   the stored scout estimate, same as the cull does (the fog on `/roster` is a
 *   UI layer, not a different number), *after* step 2 has recomputed it.
 *
 * "Rostered" means **last season**, not the live roster at the moment of the
 * roll — retirement is offseason step 3, but step 1 has already dumped every
 * expired contract into the free pool and AI free agency doesn't re-sign
 * anyone until step 4, so a live read would retire a crowd of players who were
 * about to be re-signed. `simOffseason` snapshots roster membership before
 * step 1 (see there). A useful side effect: a player whose contract just
 * expired gets one full offseason of grace to find a club before the unrostered
 * rate applies to him.
 *
 * No "seasons out of the game" counter — one roll per season compounds on its
 * own (survive unsigned, roll again next year), so washing out is emergent
 * with no persisted field and no migration.
 *
 * `RETIREMENT_UNROSTERED_BASE` is the pool-size lever: raise it and the
 * free-agent bargain bin thins out (and AI clubs have less to sign from at
 * step 4 — audit roster fill, not just pool size, before moving it).
 */
export const RETIREMENT_START_AGE = 33;
export const RETIREMENT_PROB_PER_YEAR = 0.12;
export const RETIREMENT_BASE_PROB = 0.05;
export const RETIREMENT_ROSTERED_DAMPING = 0.6;
export const RETIREMENT_UNROSTERED_BASE = 0.35;
export const RETIREMENT_MAX_PROB = 0.95;
/**
 * Unrostered players *under* `RETIREMENT_PROSPECT_MAX_AGE` with potential
 * *above* `RETIREMENT_PROSPECT_POT_THRESHOLD` are spared the unrostered rate
 * and fall back to the damped curve. Both are pinned to the pool cull's own
 * constants on purpose — see the discussion above before changing either, and
 * note the age bound is what stops the exemption swallowing every unsigned
 * veteran above ovr 65.
 */
export const RETIREMENT_PROSPECT_POT_THRESHOLD = FREE_AGENT_CULL_MAX_POT;
export const RETIREMENT_PROSPECT_MAX_AGE = FREE_AGENT_CULL_MIN_AGE;

/**
 * How many retirees the Season Preview names (`RetirementSummary.notable`).
 *
 * Both a display cap and a save-size cap, because the list is persisted on the
 * season-history entry — the players themselves are deleted, so a snapshot is
 * the only record left. Thousands of unsigned players now leave the game every
 * offseason, and storing all of them would grow the save forever and put an
 * unbounded table on the page: the two failure modes behind the 88 MB save and
 * the `/transfers` freeze respectively. The headline `total` carries the real
 * number, so nothing is misreported by keeping this small.
 */
export const RETIREMENT_NOTABLE_LIMIT = 15;

/**
 * Who gets a permanent record in the retiree archive (`LeagueStore.retiredPlayers`,
 * see players/archive.ts), and how large that archive is ever allowed to get.
 *
 * The archive exists so the all-time frivolities lists don't forget a legend
 * the season he retires — retirement deletes the player outright. It is
 * therefore the same save-size hazard `RETIREMENT_NOTABLE_LIMIT` above guards
 * against, only permanent, so it gets two defences rather than one:
 *
 * 1. **A quality gate.** He must have made a senior league appearance, and then
 *    either reached `MIN_PEAK_OVR` (70 ≈ a good starter, the standard at which
 *    a player is plausibly the answer to *any* all-time question) or lasted
 *    `MIN_APPEARANCES` (≈ four full seasons) so the longevity lists have a
 *    field. The great majority of each offseason's retirees are unsigned
 *    players who never played a senior minute; they fail on the first clause.
 * 2. **A hard cap.** However long the dynasty runs, the archive cannot exceed
 *    `LIMIT` rows — overflow drops the *weakest careers*, not the oldest, so a
 *    100-season save keeps its season-3 legends and loses its season-97
 *    journeymen. At the measured retirement rates this is many decades of
 *    headroom; the cap is the guarantee, not the expected steady state.
 *    `LIMIT` came down from 4000 when the row widened to carry full career
 *    totals plus a best-season line per ranked stat (needed so the all-time
 *    leaderboards cover retirees for *every* stat, not just goals and assists)
 *    — roughly 3x the width, so a lower row count holds the same budget. It
 *    came down again (2500 -> 2000) when the per-season club/rating line was
 *    added for the GOAT rankings.
 *
 * Every list the archive feeds is a leaderboard (the top N of something), so a
 * career that clears neither bar costs save size and buys nothing.
 *
 * Measured over a 6-season dynasty (seed 7, 240 clubs) to set these:
 * **661 players retire per offseason**, of whom only 351 ever made a senior
 * appearance and just 16.5 ever peaked at ovr 70. Ungated that is ~66,000 rows
 * per 100 seasons — the 88 MB shape again. At `MIN_PEAK_OVR` 70 it is ~1,650
 * per 100 seasons, and the appearance clause adds the low-rated long-servers
 * the longevity lists exist for, landing comfortably inside `LIMIT`. Re-measure
 * (a script like scripts/retirementAudit.ts) before loosening either bar: the
 * retirement rate is itself tuned and moves these projections.
 */
export const RETIREE_ARCHIVE_MIN_PEAK_OVR = 70;
export const RETIREE_ARCHIVE_MIN_APPEARANCES = 200;
/**
 * Raised 2,000 -> 20,000 on 2026-08-22, once splitting the archive into its own
 * IndexedDB store (`DB_VERSION` 3) removed the reason it had to be small.
 *
 * **The old cap was bounding write latency, not disk.** `saveLeague` rewrites
 * the whole non-player league record on every mutation, and the archive rode
 * along, so it was re-serialised on every lineup change and signing. Measured at
 * 2,204 bytes a row (`scripts/archiveWriteCost.ts`): 11ms per save at 2,000
 * rows, 46ms at 10,000, 91ms at 20,000, before mobile's documented 5-10x. That
 * is the budget PR #210 spent months of work to reclaim. With the archive in its
 * own store only the rows that changed are written, which for an offseason is
 * the few hundred just added, so the cap costs nothing per action and the
 * remaining question is only disk.
 *
 * **Sized against the rate that feeds it, not a round number.**
 * `scripts/archiveGateProbe.ts` (22 seasons, 320 clubs) measures the quality
 * gate above admitting ~**270 retirees a season** at maturity — the early
 * seasons are far lower (5 in season 3, 184 by season 11) because careers have
 * to lengthen before anyone clears 200 appearances, so a short probe badly
 * under-reads it. 20,000 rows is therefore ~75 mature seasons of full coverage,
 * against ~7 at the old cap, and 44 MB on disk at the measured row width.
 *
 * **The failure mode past it is now soft.** `LeagueStore.playerNames` keeps an
 * 82-byte identity row for every referenced retiree with no cap at all, so a
 * career dropped here still has a name everywhere it appears; it just has no
 * career page. Before that existed, overflowing this cap meant the save forgot
 * the player entirely — at season 101 the prune bar had risen to peak ovr 79 and
 * 78% of historical references resolved to nobody.
 *
 * Re-measure both scripts before moving it again, and note the gate above is the
 * *other* half: a retiree who clears neither bar gets no row at any cap.
 */
export const RETIREE_ARCHIVE_LIMIT = 20_000;

/**
 * Wages (2026-07-11 rework, replacing the flat 20k-per-ovr placeholder;
 * rescaled 2026-07-13 alongside the BASE_SEASON_BUDGET cut below — same
 * cubic shape, coefficients scaled by ~BASE_SEASON_BUDGET's 50M/95M ratio so
 * the AI-solvency invariant in budget.test.ts still holds with a comparable
 * margin):
 * weekly wage = WAGE_WEEKLY_MIN + WAGE_WEEKLY_COEFF * (ovr - WAGE_OVR_FLOOR)^3,
 * times a deterministic per-signing variation of ±WAGE_VARIATION, rounded to
 * the nearest 100 and stored as a per-season total (weekly × 52). The cubic
 * matches the real Premier League's superstar wage escalation on the
 * post-rebalance ovr scale (65 = average starter … 90+ = rare outlier):
 * ovr 50 ≈ 2.3k/wk, 60 ≈ 11.4k, 65 ≈ 21.3k, 70 ≈ 36.1k, 75 ≈ 56.7k,
 * 80 ≈ 84.2k, 85 ≈ 119.5k, 90 ≈ 163.5k, 99 ≈ 268k.
 */
export const WAGE_WEEKLY_MIN = 1_000;
export const WAGE_OVR_FLOOR = 40;
export const WAGE_WEEKLY_COEFF = 1.3;
/** Per-signing wage spread: two same-ovr players can differ by up to ±15%. */
export const WAGE_VARIATION = 0.15;
export const CONTRACT_LENGTH_MIN = 1;
export const CONTRACT_LENGTH_MAX = 3;
export const YOUTH_CONTRACT_LENGTH = 2;

/**
 * Academy (holding pool for the user's own youth intake — see clubs.ts's
 * StoredTeam.academyRoster): players there aren't yet competing for senior
 * wages, so they draw a cheap flat weekly stipend instead of the normal
 * OVR-cubic formula (seasonSalaryForOvr) — otherwise a raw 16-year-old could
 * already cost real money before ever playing a match, and clubs would have
 * no wage-based reason to ever promote a prospect out of the academy. Reuses
 * YOUTH_CONTRACT_LENGTH for the academy contract length too.
 */
export const ACADEMY_STIPEND_WEEKLY = 500;
/**
 * Hard ceiling on the academy pool, mirroring ROSTER_CAP's role for the
 * senior roster — bounds how many prospects a player can sign into the
 * academy via Incoming Talent (youth intake itself isn't gated by this, same
 * convention as ROSTER_CAP/youth intake).
 */
export const ACADEMY_ROSTER_CAP = 10;
/** Free agents at or under this age show up on Incoming Talent (prospects) instead of Free Agents. */
export const PROSPECT_AGE_MAX = 21;

/**
 * M6 finance (see docs/finance-design.md): every club gets an equal base
 * allocation each season; the only spread comes from domestic success
 * payouts plus a heavily damped hype→revenue channel, so famous/successful
 * clubs don't snowball. Wages are paid UP FRONT at each season's start
 * (league creation included): the base allocation arrives and the squad's
 * season wages come straight out of it, so in-season cash is genuinely
 * spendable. Players acquired mid-season (transfer buys, free-agent
 * signings during the regular phase) charge their full season salary at
 * acquisition; offseason additions are covered by the next season-start
 * charge.
 *
 * Scale invariant (tested in budget.test.ts): the base allocation alone must
 * exceed the wage bill of WAGE_SAFE_SQUAD on worst-case (+WAGE_VARIATION)
 * deals — a benchmark squad shaped like the strongest AI club observed in
 * 25-season dynasty audits of the cubic wage rework (max AI wage bill ~86M
 * across 3 seeds × 25 seasons × 19 clubs; actual settlement margins never
 * dropped below +32M because big-wage squads reliably earn prize/hype
 * revenue on top). AI clubs never spend on scouting, so the AI invariant
 * excludes it. The pre-rework theoretical ceiling (25 players at 99 ovr) is
 * no longer coverable: only a user deliberately hoarding a ROSTER_CAP squad
 * of elite players can outspend the base (a documented, user-controlled
 * gap — the Finance page projects the shortfall).
 *
 * Cut 95M → 50M on 2026-07-13 per user direction (a bottom-table club was
 * banking $163M+ over a few frugal seasons off the old, more generous
 * allocation — the running-balance/compounding design itself was kept
 * as-is, only the per-season inflow was reduced). Wages below were rescaled
 * in tandem to preserve the AI-solvency invariant.
 *
 * Raised 50M → 110M on 2026-07-14 alongside the LEAGUE_BASE/TEAM_STRENGTH_SPREAD/
 * RATING_NOISE_SD generation retune above: that retune raises league-wide OVR
 * (and thus wages, which scale cubically with ovr), so the old 50M base broke
 * AI solvency outright (a 20-season × 3-seed dynasty audit under the new
 * generation numbers hit a -26M AI budget and a 79M+ single-club wage bill,
 * both impossible under the old squad-strength assumptions WAGE_SAFE_SQUAD
 * below was benchmarked against). MAX_BUDGET's existing cap already bounds
 * long-run compounding independently of this value, so raising it doesn't
 * reopen the accumulation problem the 2026-07-13 cut was solving.
 *
 * Cut 110M → 88M on 2026-07-21 per user direction, to reduce AI cash-hoarding:
 * a 15-season dynasty audit found AI clubs sitting on ~$110M median with 90%+
 * banking a >$50M war chest, because the base inflow so far outruns wages that
 * the surplus compounds every season (the AI-to-AI market can't drain it — see
 * the AI_NEED_BUY note). This is a deliberate, across-the-board tightening (D1
 * and D2 both, via the shared tier/country scale, and the user's own club too —
 * a small difficulty bump). Wages are intentionally left UNCHANGED (lowering
 * them would shrink the wage sink and increase hoarding, the opposite of the
 * goal).
 *
 * The floor is hard: the WAGE_SAFE_SQUAD invariant test requires base to strictly
 * exceed the *worst-case* AI wage bill — the strongest AI-reachable squad at the
 * top of the ±WAGE_VARIATION band — which is ≈ $85.92M (a first pass to 85M dipped
 * $0.9M below it and CI's budget.test.ts caught it, even though 15/12-season
 * empirical audits never hit that tail). So 88M is the deepest sensible cut that
 * keeps "AI deficits never exist," clearing the worst case by ~$2M. Empirically
 * (audited at the slightly lower 85M) it drops the median AI hoard to ~$92-95M
 * (from ~$110M) with zero deficits over two seeds; 88M lands marginally above
 * that. MAX_BUDGET is untouched.
 */
export const BASE_SEASON_BUDGET = 88_000_000;
/**
 * Hard ceiling on a club's running budget balance, added 2026-07-13: since
 * budget compounds season over season by design (never resets to the base
 * allocation), a frugal club could otherwise bank an unbounded amount over a
 * long dynasty (observed reaching $1B+ by season 20 in audits). Applied
 * everywhere a club's budget can increase (season-start/end settlement,
 * transfer-fee receipts) via `clampBudget` in `finance/budget.ts` — a club
 * can still spend below this line freely, it just can't bank above it.
 *
 * MAX_BUDGET is the ceiling for a maximally *famous* club; the actual cap
 * scales with a club's hype between MAX_BUDGET_FLOOR (a nobody club) and
 * MAX_BUDGET (see budgetCap in finance/budget.ts), so wealth tracks success —
 * a big club banks/spends a bigger war chest than a struggling one. Raised to
 * $400M (from $300M, 2026-07-18) for more spending headroom, then made the top
 * of the hype scale the same day. Comfortably clear of the transfer-valuation
 * scale either way: `trueTransferValue`'s base curve alone prices a 90-ovr
 * player at ~$201M before age/potential/contract multipliers stack on top, so
 * a top club can still afford the league's most elite players. (The cap only
 * bounds *banking*; it can't cause a deficit, so AI solvency is unaffected.)
 */
export const MAX_BUDGET = 400_000_000;
/**
 * Floor of the hype-scaled savings ceiling (see budgetCap): the cap for a
 * club at zero hype. A club at HYPE_INITIAL (50) sits at the midpoint
 * (~$300M at tier 1); a maximally famous club reaches MAX_BUDGET. Set so an
 * elite club can bank/spend roughly 2x a struggling one, before tier scaling.
 */
export const MAX_BUDGET_FLOOR = 200_000_000;
/**
 * Benchmark "dominant AI squad" the base allocation must out-fund on
 * worst-case wage deals (see the invariant note above): [count, ovr] rows,
 * matching the strongest squad shape AI free agency + progression produced
 * in dynasty audits. Retuned 2026-07-14 alongside the generation retune above
 * (an 80-ovr starting XI is beyond equilibrium AI strength under the new,
 * higher-ceiling generation numbers — the prior [73, 66, 56] benchmark was
 * calibrated to the old, lower OVR distribution).
 */
export const WAGE_SAFE_SQUAD: readonly [count: number, ovr: number][] = [
  [11, 80], [7, 74], [7, 65],
];

/**
 * Prize money by final domestic league position, paid on top of the equal
 * base allocation. Three exclusive tiers: winning the league, finishing in
 * the top 5 (2nd-5th), and finishing in the top 10 (6th-10th). Everyone
 * else gets the base allocation only.
 */
export const PRIZE_CHAMPION = 40_000_000;
export const PRIZE_TOP_5 = 20_000_000;
export const PRIZE_TOP_10 = 10_000_000;
/** Last league position included in each prize tier. */
export const PRIZE_TOP_5_CUTOFF = 5;
export const PRIZE_TOP_10_CUTOFF = 10;

/** Hype is tracked on a 0-100 scale. */
export const HYPE_MIN = 0;
export const HYPE_MAX = 100;

/**
 * Hype moves toward a season-performance target (derived from points-per-
 * game and final rank) rather than snapping to it, so a single great/poor
 * season doesn't swing a club's fame instantly.
 */
export const HYPE_SMOOTHING = 0.35;
export const HYPE_INITIAL = 50;

/**
 * Damped hype→revenue channel: revenue per hype point, scaled down hard so
 * this stays a secondary channel behind success payouts (per design: "don't
 * make profit from jersey sales contribute TOO much to budget"). Bumped
 * 500k → 750k on 2026-07-13 alongside the BASE_SEASON_BUDGET cut, per user
 * request to make hype revenue a bit more impactful now that the base
 * allocation is smaller (max hype revenue: 20M → 30M).
 */
export const HYPE_REVENUE_PER_POINT = 750_000;
export const HYPE_REVENUE_DAMPING = 0.4;

/** Scouting: a single per-season spend slider (0 = no scouts) that lowers valuation noise. */
export const SCOUTING_SPEND_MIN = 0;
export const SCOUTING_SPEND_MAX = 20_000_000;
/**
 * Default per-season spend a new club starts with, and that the slider
 * resets to each offseason. Resetting to SCOUTING_SPEND_MIN (0) silently
 * maxed out valuation noise for anyone who didn't re-raise it every
 * season; 25% of max buys a modest noise reduction out of the box
 * without committing much budget on the user's behalf.
 */
export const SCOUTING_SPEND_DEFAULT = SCOUTING_SPEND_MAX * 0.25;
/** Perceived-valuation noise (std dev, as a fraction of true value) at zero spend and at max spend. */
export const SCOUTING_NOISE_SD_MIN_SPEND = 0.35;
export const SCOUTING_NOISE_SD_MAX_SPEND = 0.05;

/**
 * Scouting fog-of-war on potential (the USER's view only — AI clubs have
 * their own perceivedValueToClub noise, see src/core/ai/evaluate.ts). A
 * player's true POT is never shown outright to the user; instead they see a
 * low–high estimate band (src/core/scouting/potentialFog.ts) that narrows on
 * two independent axes:
 *   - Scouting spend: a bigger scouting budget narrows the band immediately
 *     (HALFWIDTH_MAX at zero spend → HALFWIDTH_MIN at SCOUTING_SPEND_MAX) and
 *     also speeds clearing (CLEAR_SEASONS_MAX → _MIN).
 *   - Tenure: how many seasons a player has been on the user's *senior*
 *     roster (tracked as StoredTeam.scoutingObserved). Prospects, free
 *     agents, academy players, and rival clubs' players are never on the
 *     senior roster, so they always read as tenure 0 (maximum fog for the
 *     current spend). Owned players clear to the exact number over
 *     CLEAR_SEASONS.
 * The band always brackets the true value; only its center is jittered
 * (deterministically per player/season) up to ±halfWidth × SHIFT_FRACTION so
 * the midpoint isn't trivially the truth. Ties to BBGM, which likewise
 * sharpens scouted ratings over ~3 seasons.
 */
export const SCOUT_POT_FOG_HALFWIDTH_MAX = 8;
export const SCOUT_POT_FOG_HALFWIDTH_MIN = 2;
export const SCOUT_POT_CLEAR_SEASONS_MAX = 3;
export const SCOUT_POT_CLEAR_SEASONS_MIN = 2;
export const SCOUT_POT_FOG_SHIFT_FRACTION = 0.5;

/**
 * Transfer valuation formula: a "current ability" base value that climbs
 * steeply with ovr above a floor (replacement-level players are worth
 * little), multiplied by a potential premium (VALUATION_POTENTIAL_*, priced
 * on top rather than blended into ovr — soccer transfer fees pay for
 * resale/ceiling on top of today's ability, not instead of it), an age
 * curve (VALUATION_AGE_CURVE — youth is a premium in soccer's transfer
 * market, not a discount: clubs are buying years of control and resale
 * value), and a bonus for remaining contract length (longer deals are
 * harder/pricier to pry a player out of).
 *
 * Recalibrated 2026-07-11 to the post-rebalance ovr scale (65 = average
 * starter, 70 = good starter, 75 = a team's best player, 80-85 = league-wide
 * elite, 90+ = rare outlier — see the M1 milestone note in CLAUDE.md; the
 * original constants below were tuned against the older, more inflated
 * scale where 65-70 was merely a decent squad player) and pinned to real
 * transfer-market data (2025-ish Premier League, matching the
 * BASE_SEASON_BUDGET calibration note above): an average starter runs
 * 35-45M, a title-contender's best player 65-80M+, and a generational
 * outlier like Haaland tops 200M. Base ("current ability") value with no
 * potential gap, before age/potential/contract multipliers:
 * 65 ~= 35M, 70 ~= 57M, 75 ~= 84M, 80 ~= 117M, 85 ~= 156M, 90 ~= 201M.
 */
export const VALUATION_OVR_FLOOR = 45;
/**
 * Rescaled 56_000 -> 32_000 on 2026-08-08 (see the elite constants below for
 * the matching change at the top of the curve).
 *
 * The old numbers were pinned to real 2025 Premier League *fees*, which read
 * correctly in isolation but not against this game's own economy: a club's base
 * season allocation is BASE_SEASON_BUDGET ($88M), where a real PL club turns
 * over several times that. So a "realistic" $120M fee was ~1.4 seasons of a
 * club's entire income, against roughly 0.2 for the real deal it was copied
 * from — every transfer was proportionally about eight times more expensive
 * than the real market it was modelled on. A 12-season audit measured 42 fees
 * of $100M+ per season across the world, which is more nine-figure transfers
 * every year than football has had in its history.
 *
 * Values are now proportionate to what clubs actually earn here. Base ("current
 * ability") value, before the age/potential/contract multipliers:
 *   65 ~= $21M   70 ~= $32M   75 ~= $48M   78 ~= $59M
 *   80 ~= $86M   83 ~= $134M  85 ~= $186M  87 ~= $241M
 * so a nine-figure fee once again means a genuinely elite player, rather than
 * being the going rate for a decent 22-year-old.
 */
export const VALUATION_OVR_COEFF = 32_000;
export const VALUATION_OVR_EXPONENT = 2.15;
export const VALUATION_CONTRACT_YEAR_BONUS = 0.08;
export const VALUATION_CONTRACT_YEAR_BONUS_CAP = 0.4;

/**
 * Elite "star" premium. The base curve above is deliberately flat at the top,
 * so without this a club could buy even the league's very best players at a
 * pedestrian price. This adds a steep premium for every OVR point above
 * VALUATION_ELITE_THRESHOLD, added to the base before the age/potential/contract
 * multipliers. Bonus = COEFF × max(0, ovr − THRESHOLD)^EXPONENT.
 *
 * The threshold of 76 (≈ the genuine top of a league) makes the real
 * difference-makers expensive: ≤76 stays freely payable, 78 is pricey (~2x a
 * 76), and 80+ climbs into the top bracket. Note a global player-quality nerf
 * can NOT substitute for pricing the market this way — match composites
 * z-normalize league-wide quality away (measured: it left title-win rates
 * unchanged), whereas making elite talent expensive bites.
 *
 * The premium no longer runs off to infinity: the final value is clamped at
 * MAX_TRANSFER_VALUE so no asking price is ever absurd. "You can't buy a
 * champion" is now enforced *directly and realistically* rather than through a
 * fake billion-dollar price tag — the genuinely elite players on genuinely
 * successful clubs are simply not for sale (see protectedStars.ts / the
 * PROTECTED_STAR_* constants below), the way a top club would never sell its
 * best player at any price.
 */
export const VALUATION_ELITE_THRESHOLD = 76;
/**
 * Softened 2026-08-08 (was COEFF 11_000_000 / EXPONENT 2.5). The old curve was
 * so steep it *saturated*: at ovr 80 the elite term alone was $352M, so every
 * single player at 80 or above priced at the MAX_TRANSFER_VALUE clamp and the
 * top of the market went completely flat — an 80 and an 87 cost the same $350M,
 * and since AI_MARKET_FEE_FLOOR_FRACTION floors a fee at half of market value,
 * *every* elite deal opened at $175M. A 12-season audit measured 42 fees of
 * $100M+ per season, which is roughly the number football has seen in total.
 *
 * These values restore a gradient across the elite band instead (base + elite,
 * before the age/potential/contract multipliers — the totals quoted in
 * VALUATION_OVR_COEFF above already include this term):
 *   76 -> ~$53M   78 -> ~$59M   80 -> ~$86M   83 -> ~$134M   85 -> ~$186M
 * so the clamp now binds only for the genuinely once-in-a-generation player,
 * which is the case it was written for. "You can't buy a champion" is enforced
 * by the not-for-sale gates (protectedStars.ts) and by the player himself
 * refusing a step down (playerWill.ts) — never by a fake price tag.
 */
export const VALUATION_ELITE_COEFF = 1_200_000;
export const VALUATION_ELITE_EXPONENT = 2.0;

/**
 * Hard ceiling on any player's transfer value / asking price (trueTransferValue,
 * reservation prices, scouted valuations, and negotiation counters all clamp to
 * it). Keeps quoted fees believable — no club ever asks a fantasy number.
 * Sits above the ~$400M top-club budget cap only slightly below it, so a
 * maximally rich club *can* in principle afford the priciest for-sale player;
 * "unbuyable" is expressed by the not-for-sale gate, not by an unpayable price.
 */
export const MAX_TRANSFER_VALUE = 350_000_000;

/**
 * "Protected star" not-for-sale gate (see core/transfers/protectedStars.ts).
 * An AI club's player is withheld from the market entirely — no asking price at
 * all — when he was one of the best in the world last season AND his club had a
 * big season, mirroring how a top club simply won't sell its star at any price.
 *
 * - PROTECTED_STAR_OVR: an OVR at/above this counts as "best in the world"
 *   on its own (an individual honor last season — POTY / Golden Boot / Team of
 *   the Season — also qualifies, regardless of rating).
 * - PROTECTED_STAR_TOP_FINISH: "big season" = finishing this many places or
 *   better in a tier-1 league last season (a strong second-division finish
 *   doesn't take a player off the market).
 */
export const PROTECTED_STAR_OVR = 80;
export const PROTECTED_STAR_TOP_FINISH = 4;

/**
 * Difficulty (chosen on the New League screen, fixed for the save's lifetime).
 *
 * EVERY lever here applies to the USER'S CLUB ALONE. That is a hard design
 * constraint, not a convenience: AI↔AI trading, the country strength ladder and
 * the anti-inflation equilibrium are a single tuned system, and difficulty must
 * not perturb it. Concretely, the tempting version of `protectedStarOvr` —
 * widening the not-for-sale gate world-wide on the hard levels — would cut
 * AI↔AI deal volume, and the weak leagues are documented to run on transfer
 * receipts (Belgium's 20 clubs take ~£1.1bn in a single window against ~£800M
 * of base income for the whole league across a season; the last change that
 * reduced deal flow put 2 of 4 audited seeds into deficit while every strength
 * check stayed green). Because every lever is user-only, the world economy runs
 * identically on all four levels and no dynasty audit is required to change one.
 *
 * `normal` is EXACTLY the shipped game — every field is the identity value or
 * the shipped constant — so old saves migrate onto it and nothing changes for a
 * dynasty in progress. A test pins that.
 *
 * The levers, and where each one bites:
 *  - budgetScale: multiplies the user's `financeScale`, i.e. BOTH his income
 *    (base allocation, prize money, hype revenue) and his savings ceiling
 *    (budgetCap). Both halves are load-bearing: raising income without raising
 *    the ceiling would see Easy's bonus silently destroyed by clampBudget.
 *    Wages are NOT scaled (they're country-independent), so a hard level's
 *    squeeze is a genuine income-vs-wage-bill gap the user has to trade out of.
 *  - academyOffset: OVR points added to the user's youth-intake anchor at
 *    intake time. Applied as a modifier alongside academyFormModifiers, NEVER
 *    written into the stored `academyBase` — that field is also read by
 *    promotion convergence and roster-import realignment, which would drag a
 *    baked-in offset back toward the competition centre or permute it onto
 *    another club.
 *  - buyPriceScale: multiplies what the user pays for a player (his asking
 *    price and the displayed buy-side valuation). Sale proceeds, his own
 *    squad's valuations and every AI↔AI price are untouched.
 *  - protectedStarOvr / protectedStarTopFinish: the not-for-sale bar as the
 *    USER sees it. The AI market keeps using PROTECTED_STAR_* above, so on a
 *    hard level a player can be unbuyable by the user while still moving
 *    between AI clubs. That asymmetry is deliberate (see the paragraph above);
 *    the UI copy says "not available to you" rather than claiming the club
 *    won't sell, so the game doesn't tell the user something untrue.
 *  - fogScale: multiplies the potential fog's half-width AND its clearing time
 *    (scouting/potentialFog.ts). Purely informational — no sim effect, no rng
 *    draw — which makes it the cheapest lever here and the one that changes how
 *    the game *feels* rather than what it costs.
 *
 * Calibrated with scripts/difficultyProbe.ts; re-run it after touching any
 * value, in particular the protected-star bars (how many players a level
 * removes from the user's market is not eyeballable).
 */
export type Difficulty = "easy" | "normal" | "hard" | "brutal";

export interface DifficultyProfile {
  id: Difficulty;
  /** Player-facing name. */
  label: string;
  /** One-line description for the New League picker. */
  blurb: string;
  budgetScale: number;
  academyOffset: number;
  buyPriceScale: number;
  protectedStarOvr: number;
  protectedStarTopFinish: number;
  fogScale: number;
  /**
   * How patient the board is, as a multiplier on manager confidence movement
   * (see core/manager/confidence.ts): good seasons are credited x this, bad
   * seasons charged / this. Above 1 is forgiving, below 1 impatient.
   *
   * The only lever here with no effect on the world — it changes how long you
   * keep your job, not what your club can buy — so it needs no difficultyProbe
   * recalibration when it moves.
   */
  boardPatience: number;
}

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

/** Every difficulty, in presentation order (easiest first). */
export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "normal", "hard", "brutal"];

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    id: "easy",
    label: "Easy",
    blurb: "More money, a stronger academy, cheaper signings, and you can buy almost anyone.",
    budgetScale: 1.35,
    academyOffset: 4,
    buyPriceScale: 0.85,
    protectedStarOvr: 85,
    protectedStarTopFinish: 1,
    fogScale: 0.5,
    boardPatience: 1.7,
  },
  normal: {
    id: "normal",
    label: "Normal",
    blurb: "The game as it's tuned. Your club plays by the same rules as everyone else.",
    budgetScale: 1,
    academyOffset: 0,
    buyPriceScale: 1,
    protectedStarOvr: PROTECTED_STAR_OVR,
    protectedStarTopFinish: PROTECTED_STAR_TOP_FINISH,
    fogScale: 1,
    boardPatience: 1,
  },
  hard: {
    id: "hard",
    label: "Hard",
    blurb: "Less money, a weaker academy, and the best clubs won't sell to you.",
    budgetScale: 0.8,
    academyOffset: -3,
    buyPriceScale: 1.3,
    protectedStarOvr: 78,
    protectedStarTopFinish: 5,
    fogScale: 1.25,
    boardPatience: 0.75,
  },
  brutal: {
    id: "brutal",
    label: "Brutal",
    blurb: "You will run out of money. Build from the academy or don't build at all.",
    budgetScale: 0.6,
    academyOffset: -6,
    buyPriceScale: 1.6,
    protectedStarOvr: 76,
    protectedStarTopFinish: 6,
    fogScale: 1.5,
    boardPatience: 0.55,
  },
};

/** The profile for a save's difficulty, falling back to normal for anything unrecognised. */
export function difficultyProfile(difficulty: Difficulty | undefined): DifficultyProfile {
  return DIFFICULTIES[difficulty ?? DEFAULT_DIFFICULTY] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}

/**
 * Age's effect on transfer value, as a straight multiplier — [age,
 * multiplier] control points, linearly interpolated, clamped at the ends.
 * Unlike a player's on-field ability curve, transfer value peaks in the
 * late teens and falls off through the late 20s/30s: a young player is an
 * asset (years of control, resale value, room to grow) independent of
 * their potential gap, which is priced separately (VALUATION_POTENTIAL_*).
 */
export const VALUATION_AGE_CURVE: readonly [number, number][] = [
  [16, 1.25], [17, 1.35], [18, 1.40], [19, 1.35], [20, 1.30], [21, 1.20],
  [22, 1.10], [23, 1.00], [27, 1.00], [28, 0.90], [30, 0.75], [32, 0.55],
];

/**
 * Potential premium: soccer transfer fees pay aggressively for ceiling, not
 * just proven ability (a 17-year-old Bellingham went for ~25M on potential
 * alone). Priced as a percentage bump on the base value, per point of
 * (potential - ovr), scaled by an age weight — full weight through
 * VALUATION_POTENTIAL_WEIGHT_PEAK_AGE, linearly decaying to zero by
 * VALUATION_POTENTIAL_WEIGHT_ZERO_AGE (an older player's remaining
 * "potential" isn't worth paying extra for — they won't live in it long).
 * At full weight, VALUATION_POTENTIAL_PCT_PER_POINT * 20 = +70%, i.e. a
 * 20-point gap at peak age roughly matches the Bellingham-style premium.
 */
export const VALUATION_POTENTIAL_PCT_PER_POINT = 0.035;
export const VALUATION_POTENTIAL_WEIGHT_PEAK_AGE = 21;
export const VALUATION_POTENTIAL_WEIGHT_ZERO_AGE = 30;

/**
 * M6 transfer market (phases 3-7, see docs/finance-design.md). A club's
 * hidden reservation price — the fee it will actually accept — is its
 * player's true transfer value times a factor rolled once per transfer
 * window, so probing offers within one window can't reroll the price.
 */
export const RESERVATION_FACTOR_MIN = 0.95;
export const RESERVATION_FACTOR_MAX = 1.2;

/** An offer below this fraction of the reservation price ends talks outright ("way off"). */
export const NEGOTIATION_LOWBALL_FACTOR = 0.6;

/**
 * Counter-offers open this far above the reservation price and the padding
 * decays geometrically each round, so haggling converges on the reservation
 * price but never reveals it exactly.
 */
export const COUNTER_PADDING_START = 0.15;
export const COUNTER_PADDING_DECAY = 0.5;

/** Clubs walk away after this many user offers without an agreement. */
export const NEGOTIATION_MAX_ROUNDS = 5;

/**
 * Incoming Offers scout commentary: the scout's read on a buyer's offer
 * relative to the player's (scouting-noised) value to the user's own club.
 * At/above GOOD_RATIO the offer clears our valuation outright ("take it");
 * below BAD_RATIO it's dismissed as a lowball; in between, the scout
 * suggests countering up to the perceived valuation.
 */
export const SCOUT_COMMENTARY_GOOD_RATIO = 0.95;
export const SCOUT_COMMENTARY_BAD_RATIO = 0.6;

/**
 * Recommended Transfers page: 5-10 players of similar overall level to the
 * user's team (relative to the starting XI average ovr) and within budget.
 * The band skews upward — recommendations should mostly be improvements.
 */
export const RECOMMENDED_TRANSFERS_MIN = 5;
export const RECOMMENDED_TRANSFERS_MAX = 10;
export const RECOMMENDED_OVR_BELOW = 2;
export const RECOMMENDED_OVR_ABOVE = 8;
/** If the band holds fewer than the minimum, widen it by this many ovr points and retry. */
export const RECOMMENDED_BAND_WIDEN = 6;
/**
 * Weight of potential headroom (potential - ovr) in the recommendation score.
 * Kept as a tiebreaker rather than a dominant factor: at 0.15, a young player
 * with ~15 points of headroom ranks only ~2.25 ovr-points ahead of an
 * equal-ovr veteran, so prime-ready players aren't crowded out of the list by
 * upside alone (was 0.3, which skewed recommendations heavily toward youth).
 */
export const RECOMMENDED_UPSIDE_WEIGHT = 0.15;
/**
 * Scouting noise (a fraction of value, 0.35 → 0.05 by spend) rescaled into
 * ovr-points of ranking noise: bad scouts shuffle the list by ~3.5 points,
 * great scouts by ~0.5, so spend buys genuinely better targets.
 */
export const RECOMMENDED_NOISE_OVR_SCALE = 10;
/** Keep the list varied: no more than this many recommendations at one position. */
export const RECOMMENDED_MAX_PER_POSITION = 2;

/**
 * One-button contract terms (design: contracts are never negotiated — one
 * "extend"/"sign" button shows the weekly wage and length). Length is
 * deterministic by age so the button can state exactly what it does.
 */
export const EXTENSION_LENGTH_YOUNG = 3;
export const EXTENSION_LENGTH_MID = 2;
export const EXTENSION_LENGTH_OLD = 1;
/** Age cutoffs: below MID → young terms, below OLD → mid terms, else old terms. */
export const EXTENSION_AGE_MID = 30;
export const EXTENSION_AGE_OLD = 33;
/** The user's own extend UI lets them pick any length in this range instead of the age default. */
export const EXTENSION_LENGTH_USER_MIN = 1;
export const EXTENSION_LENGTH_USER_MAX = 4;

/* ─────────────────────────────────────────────────────────────────────────
 * AI evaluation core (see docs — "AI General Manager Philosophy")
 *
 * The brain behind evaluation-driven (not rule-scripted) club decisions. A
 * club's strategic direction and how it values any given player both EMERGE
 * from its current state — wealth, fame, squad strength, form, age profile,
 * positional depth — rather than from hand-authored per-club scripts. Two
 * clubs presented with the same player therefore value him differently.
 *
 * Phase 1 (this batch) ships only the scoring functions + tests; nothing in
 * the sim consumes them yet, so these constants change no observable
 * behavior. They're expected to be retuned once AI buying/selling actually
 * runs on top of them.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * How many of a club's best players (by ovr) define its "squad strength" —
 * roughly a matchday squad (XI + 5-deep bench), so a couple of weak fringe
 * players don't drag a strong club's strength down.
 */
export const AI_SQUAD_STRENGTH_COUNT = 16;

/**
 * Ambition = win-now pressure, a [0,1] blend of four league-normalized
 * signals. Weights sum to 1. Wealth and squad strength dominate (a rich,
 * strong club feels pressure to win now); fame and recent form nudge it.
 */
export const AI_AMBITION_W_STRENGTH = 0.35;
export const AI_AMBITION_W_WEALTH = 0.3;
export const AI_AMBITION_W_FAME = 0.2;
export const AI_AMBITION_W_FORM = 0.15;

/** Direction-label thresholds on the ambition axis (labels are for UI/tests, not math). */
export const AI_AMBITION_HIGH = 0.62;
export const AI_AMBITION_LOW = 0.34;
/** A squad this young (mean age) reads as "rebuilding" rather than "relegation battle" when ambition is low. */
export const AI_YOUNG_SQUAD_AGE = 24.5;

/**
 * Positional-need multiplier. Below target depth (ROSTER_COMPOSITION) scales
 * value up (scarcity); above it scales value down (surplus). Separately, a
 * player who clearly upgrades the club's best at that position is worth more,
 * a clear downgrade less. Product is clamped to [MIN, MAX].
 */
export const AI_NEED_SCARCITY = 0.7;
export const AI_NEED_SURPLUS = 0.6;
export const AI_NEED_UPGRADE_SLOPE = 0.03;
export const AI_NEED_UPGRADE_MIN = 0.5;
export const AI_NEED_UPGRADE_MAX = 1.5;
export const AI_NEED_MIN = 0.35;
export const AI_NEED_MAX = 1.8;

/**
 * Club stature, [0,1] — "how big a club is this in world terms". Squad quality
 * measured against an ABSOLUTE band, blended with fame. See ClubContext.stature
 * for why this is the one normalization that isn't scoped to a competition.
 *
 * The band is set so a bottom-of-a-weak-league squad sits near 0 and a genuine
 * superclub near 1, with typical top-flight sides spread across the middle.
 */
export const STATURE_STRENGTH_LO = 55;
export const STATURE_STRENGTH_HI = 78;
export const STATURE_W_STRENGTH = 0.65;
export const STATURE_W_HYPE = 0.35;

/**
 * Player will: how much a player's own preference gates where he'll move
 * (core/transfers/playerWill.ts). Added 2026-08-08 to fix the single worst
 * transfer-realism bug in the game.
 *
 * The problem it solves: valuation is driven by how much a player would UPGRADE
 * the buyer, so the worse a club is, the more it values a star. Measured on a
 * real world, the five highest bidders for the best player alive were among the
 * weakest clubs in it — one with a squad-strength of 51.9 valued an 85-ovr
 * player at $538M while his own (squad 75.0) club valued him at $132M. That is
 * exactly how a Mbappe ends up at a Sociedad. Football has no salary cap to
 * explain such a move (unlike basketball, where cap space genuinely can send a
 * star to a small market), so nothing in the sim was pushing back.
 *
 * The fix is the missing half of a transfer: the player has to want it. Appeal
 * scales the buyer's valuation down when the buyer is a smaller club than the
 * one he's leaving, and a *good* player weighs that far more heavily than a
 * squad filler — a 62-ovr backup will go wherever the work is, a 80-ovr star
 * will not drop down. Big enough a step down and he refuses outright.
 */
/** Below this ovr a player is indifferent to club size — he just wants to play. */
export const PLAYER_WILL_CARE_FLOOR = 62;
/** At/above this ovr he weighs club stature at full strength. */
export const PLAYER_WILL_CARE_CEILING = 78;
/**
 * How hard a step down bites. A fully-caring player looking at a club a full
 * 1.0 of stature below his own has the buyer's valuation scaled by
 * 1 − this, i.e. effectively nothing — he simply won't entertain it.
 */
export const PLAYER_WILL_DROP_STRENGTH = 1.6;
/**
 * Stature drop a fully-caring player refuses outright, no matter the money.
 * Below this the move is merely unattractive (scaled down), not impossible.
 */
export const PLAYER_WILL_REFUSAL_DROP = 0.18;
/**
 * A genuine step *up* is its own draw: a fully-caring player moving to a club
 * this much bigger gives the buyer this much of a valuation bonus per 1.0 of
 * stature gained. Deliberately far weaker than the drop penalty — ambition
 * nudges a move along, it doesn't manufacture one out of nothing.
 */
export const PLAYER_WILL_RISE_BONUS = 0.35;

/**
 * Settling-in friction: a player who has only just joined is much harder to
 * prise away again, scaling his club's keep-value up by this much in his first
 * season and decaying to nothing over PLAYER_SETTLED_SEASONS.
 *
 * Without it the market has no memory at all, and the audit showed exactly what
 * that produces: the median gap between one move and a player's next move was a
 * single season, so squads had no identity from year to year.
 */
export const PLAYER_SETTLED_BONUS = 0.6;
export const PLAYER_SETTLED_SEASONS = 3;

/* ---------------------------------------------------------------------------
 * Transfer clauses — sell-on shares and bonuses (core/transfers/clauses.ts).
 *
 * These price CONTINGENT money on a deal the user negotiates. A clause never
 * adds money to a transfer: the other club's total willingness to pay is
 * unchanged and the clause converts part of it from cash into contingency, so
 * every one of these constants moves what the up-front cash price is discounted
 * by. That is the whole exploit surface — under-price a clause and the user
 * keeps nearly the full cash fee AND the upside — so re-run
 * `scripts/clausePricingProbe.ts` (priced expected value against what actually
 * pays out) after touching any of them.
 *
 * User-only, so none of this reaches the AI↔AI market and no dynasty audit is
 * involved. See the header of clauses.ts.
 * ------------------------------------------------------------------------- */

/** How many seasons a sell-on share stays live before it lapses. */
export const SELL_ON_CLAUSE_SEASONS = 5;

/**
 * The most of a player's future profit one club may retain. Real sell-on
 * clauses top out around 40%; past that a club has sold the player while
 * keeping most of what he is worth, which is not a transfer.
 */
export const SELL_ON_MAX_SHARE = 0.4;

/**
 * P(the buying club moves him on again at all before the clause lapses), and
 * how many seasons ahead his resale value is projected. Both are measured —
 * see the probe — rather than guessed: they are the difference between a
 * clause being a fair trade and being free money.
 */
export const SELL_ON_RESALE_PROBABILITY = 0.45;
export const SELL_ON_PRICING_HORIZON = 2;

/**
 * How much of the modelled profit a resale actually delivers.
 *
 * **This is the constant the probe existed to find, and without it the clause
 * was over-priced by nearly half.** Measured over 24,394 club-to-club sales
 * across 10 seasons: the first two constants above landed almost exactly right
 * (46.5% of players really are resold inside the window, at a mean 1.88 seasons)
 * and the pricing was still `realized / priced = 0.556`, i.e. the user was
 * handing over roughly twice the cash a sell-on was worth.
 *
 * The gap is not in *whether* he is resold but in **what for**: only 40.1% of
 * resales are at a profit at all, and `projectedValue` is a straight-line march
 * toward potential that ignores `growthDamping` throttling exactly the players
 * a clause gets attached to. Rather than bend that projection — it is honest
 * about what the valuation curve says he'd be worth — this scales the profit
 * term by what the market really pays out.
 *
 * Re-derive it from the probe's `realized / priced` ratio, which reads 1.0 when
 * this is right. It is a market-wide average over a large sample, so a single
 * deal still lands anywhere: 4.2% of them pay more than three times what they
 * were priced at, which is the point of a clause.
 */
export const SELL_ON_PROFIT_REALIZATION = 0.55;

/** How many seasons a bonus can still be triggered before it lapses. */
export const BONUS_CLAUSE_SEASONS = 3;

/**
 * How many of those seasons a bought player is actually still at the club.
 *
 * **Measured 1.03, against a window of 3**, over 25,087 player-seasons spread
 * across 24,394 transfers — most players simply do not stay. A bonus dies when
 * he leaves, so the number of chances it really gets is this, not the window
 * length, and pricing it over three full seasons over-states every counting
 * trigger by roughly double: measured 0.512 and 0.426 for appearances and goals
 * before this existed.
 *
 * The two TEAM triggers deliberately do not use it. Their per-season rate is
 * `slots / size`, which is crude in its own right, and
 * `BONUS_TEAM_TRIGGER_REALIZATION` was fit on top of the full window — so it is
 * already absorbing both effects at once and measures correctly there (0.919
 * and 0.980). Splitting them apart would need that constant re-fit for no gain.
 */
export const BONUS_EXPECTED_SEASONS_AT_CLUB = 1.03;

/**
 * Total bonus money as a fraction of the cash fee. Caps how far the up-front
 * price can be discounted, which keeps a deliberately coarse pricing model from
 * being leaned on harder than it deserves — and keeps a transfer a transfer
 * rather than a nominal fee plus a lottery ticket.
 */
export const BONUS_MAX_TOTAL_FRACTION = 0.5;

/** What the two player-performance bonuses ask for, in one league season. */
export const BONUS_APPEARANCE_THRESHOLD = 25;
export const BONUS_GOAL_THRESHOLD = 10;

/**
 * Share of his club's league games a player takes, as a saturating curve on how
 * far his ovr sits above the incumbent starter's, plus the spread around it.
 *
 * **Saturating, not a plain logistic, because that is what the data does.**
 * Measured over 25,087 player-seasons at the club that bought them, share by
 * ovr edge runs 0.336 / 0.398 / 0.497 / 0.766 / 0.680 / 0.725 across the
 * buckets below -10, -10..-5, -5..0, 0..5, 5..10 and 10+. Being *much* better
 * than the man you displace buys you very little over being somewhat better —
 * there are only so many games — so an unbounded curve badly over-predicts the
 * top end, which is where most signings sit (64% of those observations are in
 * the 10+ bucket).
 *
 * The spread is measured rather than derived from a binomial, and is very wide
 * (sd 12.7-15 games against a ~38 game season) because appearance records are
 * closer to bimodal than to a bell: a player either holds a place or does not.
 * A normal still under-states the lump at zero, so it over-predicts low
 * thresholds; that residual is measured at the thresholds actually suggested,
 * which is the only place the model is asked a question (see
 * BONUS_SUGGESTION_TARGET_P).
 */
export const BONUS_APPEARANCE_SHARE_FLOOR = 0.32;
export const BONUS_APPEARANCE_SHARE_CEILING = 0.76;
export const BONUS_APPEARANCE_EDGE_CENTRE = -1;
export const BONUS_APPEARANCE_SD_SHARE = 0.35;

/**
 * Goals per APPEARANCE by position, measured over 25,087 player-seasons, and
 * how much being better than a replacement-level player lifts it.
 *
 * Scoring is a property of the position far more than of the player: a good
 * centre-back does not become a goalscorer, he becomes a good centre-back. The
 * spread across positions is a factor of 24 from centre-back to striker, which
 * dwarfs anything ovr does within a position, so the ovr slope is deliberately
 * gentle. Together with expected appearances these give the Poisson mean a goal
 * target is priced off, which is what lets a 5-goal bonus and a 15-goal bonus
 * cost different money.
 *
 * Real goal counts are over-dispersed relative to a Poisson (the same lump at
 * zero that widens the appearance spread), so the tail is over-predicted at low
 * thresholds and under-predicted at high ones. That is tolerable *only* because
 * thresholds are suggested rather than typed: every one the game offers sits
 * near BONUS_SUGGESTION_TARGET_P, in the middle of the distribution where the
 * fit is good, and the probe checks it there. Letting a user name an arbitrary
 * threshold would need a negative binomial first.
 */
export const BONUS_GOAL_RATE_BY_POS: Record<string, number> = {
  GK: 0, CB: 0.023, FB: 0.037, DM: 0.075, CM: 0.156, AM: 0.279, W: 0.274, ST: 0.550,
};
export const BONUS_GOAL_OVR_SLOPE = 0.004;
export const BONUS_GOAL_OVR_REFERENCE = 65;

/**
 * How likely a SUGGESTED bonus should be to pay out.
 *
 * This is what makes a suggestion differ per player without any per-position
 * table: rather than offering everyone the same 25 games, the panel offers each
 * player the threshold that lands nearest this probability, so a fringe man is
 * suggested a low target and a first-choice player a demanding one. Both
 * suggestions are equally ambitious, and the NUMBER differs because the players
 * do.
 *
 * Set below a coin flip so a bonus reads as a stretch rather than a formality,
 * which is also what keeps its price a sensible fraction of its amount.
 */
export const BONUS_SUGGESTION_TARGET_P = 0.35;

/**
 * Never suggest a goal bonus below this, however the arithmetic falls.
 *
 * Without it a centre-back gets offered "if he scores 1 league goal", which is
 * priceable but silly. If the threshold that hits the target probability is
 * under this, no goal bonus is suggested for him at all — which is how keepers
 * and defenders drop off the menu without a hardcoded list of who may score.
 */
export const BONUS_SUGGESTION_MIN_GOALS = 3;

/** What a suggested bonus is worth, as a share of the cash fee. */
export const BONUS_SUGGESTED_FRACTION = 0.1;

/**
 * How much of a modelled TEAM-trigger rate actually materialises.
 *
 * `triggerProbability` prices "they qualify for Europe" and "they win
 * promotion" off the league's own slot counts over its own size, which is the
 * right shape (it varies correctly by country and division) and is
 * systematically too high, because it assumes the player is still there for
 * every season of the window. He usually isn't, and the bonus dies when he
 * leaves.
 *
 * Measured over 24,394 transfers: a continental bonus fires for **23.8%** of
 * top-flight buyers within the window against a modelled **60.7%** (ratio
 * 0.392), and a promotion bonus for **14.7%** of buyers below the top flight
 * against a modelled **36.2%** (ratio 0.406). The two landing on the same
 * number is what identifies the cause as the shared one, tenure, rather than
 * anything specific to either trigger.
 *
 * The two PERFORMANCE triggers take their own tenure correction instead, via
 * `BONUS_EXPECTED_SEASONS_AT_CLUB`, because their per-season model is a good one
 * and needs only that. This factor is doing two jobs at once for the team
 * triggers — tenure AND the crudeness of slots-over-size — which is why it is
 * bigger than tenure alone would explain, and why the two are not shared.
 *
 * Worth knowing how this went wrong once: an earlier version exempted the
 * performance triggers on the grounds that their base rates already had
 * attrition baked in, which was true of the model at the time and stopped being
 * true when that model was replaced wholesale. The justification outlived its
 * premise, and the probe caught it as a 2x over-price.
 */
export const BONUS_TEAM_TRIGGER_REALIZATION = 0.4;

/**
 * Ovr points of gap over the incumbent starter worth one logistic unit — i.e.
 * how sharply "will he play" responds to how much better than the incumbent he
 * is. Large enough that a couple of rating points is not decisive.
 */
export const BONUS_STARTER_OVR_SWING = 5;

/**
 * Timeline multiplier: how age fits the club's ambition. Win-now clubs (high
 * ambition) pay a premium for prime-age readiness and discount teenage
 * projects; developer clubs (low ambition) do the reverse. The two "neutral"
 * references keep a typical mid-20s player near a 1.0 multiplier.
 */
export const AI_TIMELINE_STRENGTH = 0.35;
export const AI_PRIME_NEUTRAL = 0.5;
export const AI_YOUTH_NEUTRAL = 0.35;

/**
 * Affordability multiplier. A deal (fee proxy + first-year wage) costing more
 * than AI_AFFORD_FREE_FRACTION of the club's budget starts to be penalized,
 * steeper the more frugal (poorer) the club — encoding "big clubs absorb
 * mistakes, small clubs can't." Rich clubs (frugality ~0) barely feel it.
 */
export const AI_AFFORD_FREE_FRACTION = 0.35;
export const AI_AFFORD_SLOPE = 1.5;
/** Budget floor for the ratio so a near-broke club doesn't divide by ~0. */
export const AI_AFFORD_BUDGET_FLOOR = 5_000_000;

/* ─────────────────────────────────────────────────────────────────────────
 * AI↔AI transfer market (phase 2 of the AI GM effort — see CLAUDE.md)
 *
 * Evaluation-driven trading between AI clubs (the user is excluded — inbound
 * offers for the user's players are phase 3). Runs once per window: the
 * summer window during the offseason, the winter window when the sim first
 * crosses matchday WINTER_WINDOW_OPEN_MATCHDAY.
 *
 * The whole thing keys off the phase-1 valueToClub: a player's "keep value"
 * to his current club is the club's reservation price; a player moves when
 * another club values him MORE than his own club does (and can afford him).
 * Surplus, sell-at-peak, and needs-based buying all emerge from that single
 * comparison rather than from scripted rules.
 * ──────────────────────────────────────────────────────────────────────── */

/** A player isn't worth an AI club's time to trade below this market value. */
export const AI_MARKET_MIN_VALUE = 1_000_000;

/**
 * A buyer bothers only when its valueToClub for the player clears the
 * seller's reservation (the seller's own keep-value) by at least this margin
 * — the player must be meaningfully more useful to the buyer than the seller.
 *
 * **In practice this governs a minority of deals, and that is load-bearing
 * rather than a bug (measured 2026-08-12).** The need-buy path below drops the
 * margin to AI_NEED_BUY_MIN_SURPLUS whenever the buyer has a positional gap, and
 * `hasPositionalGap` fires for **92-93% of executed deals** — so the market
 * mostly runs at a 0% margin bar and this 15% one is close to vestigial. That
 * looks like a loose predicate and it was tightened two different ways to check:
 * one broke weak-league solvency outright (2 of 4 audit seeds into deficit), the
 * other was inert. The volume the need-buy path carries is what funds the
 * selling leagues — Belgium's transfer receipts exceed its whole league's base
 * income for a season — so **do not "restore" this constant to being the rule.**
 * Full measurements: docs/transfer-mobility.md, scripts/needBuyMarginProbe.ts.
 */
export const AI_MARKET_MIN_SURPLUS = 0.15;

/**
 * The fee lands this fraction of the way from the seller's reservation up to
 * the buyer's valuation — both sides share the surplus. 0.5 = split it evenly.
 *
 * Tried raising this to 0.7 alongside AI_MARKET_FEE_FLOOR_FRACTION below
 * (2026-07-16, chasing the same lowball-sale report) but reverted: on top of
 * the floor, the extra fee-share bump pushed enough additional cash through
 * the market to saturate some clubs' MAX_BUDGET cap mid-season and to shift
 * the competitive-balance sim gates (test/core/simThrough.test.ts's champion
 * points spread). The floor alone already closes the reported gap (a lowball
 * deal can no longer clear far below true value); this dial was unnecessary
 * on top of it.
 */
export const AI_MARKET_FEE_SHARE = 0.5;

/**
 * A deal only executes if the buyer's own valuation clears this fraction of
 * the player's true (club-agnostic) market value, and the fee is floored at
 * this same fraction — added alongside the AI_MARKET_FEE_SHARE raise above,
 * 2026-07-16, to close the same lowball-sale gap from the other side: a
 * crushed seller reservation could still produce a very low fee even at a
 * high fee share if the buyer's own valuation was also modest. This directly
 * bounds how far below true value any AI↔AI fee can land, without touching
 * the need/timeline/affordability multipliers other AI decisions rely on.
 */
export const AI_MARKET_FEE_FLOOR_FRACTION = 0.5;

/** Most buys / sells any one AI club will make in a single window. */
export const AI_MARKET_MAX_BUYS = 3;
export const AI_MARKET_MAX_SELLS = 3;

/* ── "Need buy": cash-rich clubs fill real gaps without holding out for a bargain ──
 *
 * The AI_MARKET_MIN_SURPLUS gate above means a normal deal only fires when the
 * player is a *bargain* for the buyer (worth 15% more to it than to the seller).
 * That left clubs sitting on cash while a position went unaddressed, because the
 * players who'd fill the hole are rarely a 15%-margin steal. A human GM with
 * money and a hole just pays a fair price to fill it. So when a club has a
 * genuine positional gap (below its ROSTER_COMPOSITION target there, or a weak
 * startable hole this player would upgrade — see hasPositionalGap), the required
 * surplus margin drops to AI_NEED_BUY_MIN_SURPLUS for that buyer/player pair, and
 * it digs a bit deeper into its cash reserve. Everything else is untouched: the
 * player must still be available (seller willing to sell), clear the fee floor,
 * and fit the reserve — and elites stay unbuyable (the priceless-star premium is
 * in valuation, not here), so this only routes affordable, already-for-sale
 * squad players to the clubs that actually need them. Total league quality is
 * conserved (a move, never a creation), so it can't reopen the inflation ratchet.
 */

/**
 * Surplus margin a need buy must clear (vs AI_MARKET_MIN_SURPLUS for a normal
 * deal). 0 = the buyer will pay the seller's full reservation with no discount —
 * a fair price to fill a real hole, not a bargain. The fee floor and affordability
 * checks still apply, so this never funds a genuinely bad or unaffordable deal.
 */
export const AI_NEED_BUY_MIN_SURPLUS = 0;

/**
 * How far below its own squad strength (in ovr) a club's best player at a
 * position must be to count as a "startable hole" worth a need buy. A club whose
 * best CB is this many points under its general level has a real weak spot there.
 */
export const AI_NEED_BUY_WEAK_STARTER_GAP = 3;

/**
 * How much of the frugality-driven part of a club's cash reserve a need buy
 * frees up (0 = no relief, normal reserve; 1 = spend down to the MIN reserve like
 * the richest clubs). A club filling a real gap digs deeper into its cash, but
 * AI_MARKET_RESERVE_FRACTION_MIN is always kept back, so no club empties its vault
 * or risks a deficit.
 */
export const AI_NEED_BUY_RESERVE_RELIEF = 0.5;

/**
 * Cash reserve a club holds back from transfers — it spends only the surplus
 * above `reserveFraction × budget`, so it never blows its whole budget on
 * fees. The fraction scales with frugality: the wealthiest, least cautious
 * clubs keep MIN back and spend freely, the poorest keep MAX (a bigger
 * relative war chest for wages/contingencies). A club can still fund a deal
 * by selling first, since the reserve is measured against its live budget.
 */
export const AI_MARKET_RESERVE_FRACTION_MIN = 0.15;
export const AI_MARKET_RESERVE_FRACTION_MAX = 0.5;

/* ────────────────────────────────────────────────────────────────────────
 * AI GM phase 4: proactive contract renewals. Reuses valueToClub as-is — the
 * only new tuning knob is the margin below, a "is he still worth the money"
 * bar applied the season before a player's contract would otherwise expire.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * An AI club renews a player entering his contract's final season only if
 * valueToClub(player, ctx) clears his new-terms wage by at least this
 * multiple. >1 requires a real margin, not just break-even — valueToClub
 * already discounts for a club's affordability, so this is a second,
 * smaller safety margin on top, not a duplicate budget check.
 */
export const AI_RENEWAL_MARGIN = 1.1;

/* ────────────────────────────────────────────────────────────────────────
 * AI GM phase 3: inbound offers for the user's players. Reuses the same
 * valueToClub primitive and the AI_MARKET_MIN_SURPLUS / AI_MARKET_FEE_SHARE
 * constants above (a buyer's interest threshold and fee split work
 * identically whether the seller is an AI club or the user) — only the
 * offer-count cap and negotiation-response tuning below are new.
 * ──────────────────────────────────────────────────────────────────────── */

/** Most inbound offers shown for the user's roster in a single window. */
export const INBOUND_OFFERS_MAX = 4;

/**
 * A player the user has explicitly listed for transfer (StoredTeam.
 * transferListed) needs only this much surplus — instead of the normal
 * AI_MARKET_MIN_SURPLUS — to attract a buyer, and is prioritized within
 * INBOUND_OFFERS_MAX. Listing signals real willingness to sell, so a buyer
 * doesn't need as decisive an upgrade to bother; it's not a guarantee, since
 * a buyer still has to value him at or above what he's worth to the user.
 */
export const LISTED_FOR_TRANSFER_MIN_SURPLUS = 0.02;

/* ────────────────────────────────────────────────────────────────────────
 * AI GM phase 5: imperfect/scouting-noised decisions. Every AI valuation
 * (buying, selling, renewing) now runs through perceivedValueToClub instead
 * of the raw valueToClub — a deterministic ± jitter scaled by the club's own
 * frugality (wealth stands in for scouting investment, same as the M6 user-
 * facing valuation noise). Replaces the old flat AI_MARKET_VALUE_JITTER /
 * INBOUND_OFFER_VALUE_JITTER (both 0.04 for every club regardless of wealth).
 * ──────────────────────────────────────────────────────────────────────── */

/** Scouting noise (± fraction of value) for the wealthiest club in the league (frugality 0). */
export const AI_SCOUT_NOISE_MIN = 0.02;
/** Scouting noise (± fraction of value) for the poorest club in the league (frugality 1). */
export const AI_SCOUT_NOISE_MAX = 0.08;

/* ────────────────────────────────────────────────────────────────────────
 * Loans: a player moves to another club's roster for a fixed 1-3 season
 * commitment instead of a permanent sale — the parent club banks a flat fee
 * up front and the loanee club takes on his wages for the duration (this
 * falls out for free: roster membership, not contract ownership, drives
 * wage charging, same as every other roster-move in the codebase). Real
 * football loan fees run far below permanent transfer fees (a few percent
 * of the player's market value even for a rare season-long marquee loan,
 * see the design notes) — LOAN_FEE_RATE is calibrated to that, not to
 * trueTransferValue's own scale.
 * ──────────────────────────────────────────────────────────────────────── */

/** Loan fee = trueTransferValue × this fraction × a duration multiplier (see LOAN_DURATION_MULTIPLIER). */
export const LOAN_FEE_RATE = 0.08;

/**
 * A longer loan costs more but at a diminishing rate (real loan fees don't
 * scale linearly with duration): 1 season = the base rate, 2 = 1.5x, 3 = 1.9x.
 */
export const LOAN_DURATION_MULTIPLIER: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 1.5,
  3: 1.9,
};

/** Longest loan the user (or an AI club) can arrange in one deal. */
export const LOAN_MAX_SEASONS = 3;

/**
 * An AI club only loans out its own player if he's this age or younger — the
 * feature's whole premise is developmental (a young player buried behind a
 * better starter goes elsewhere for minutes), so AI-initiated loans (both
 * offering to take one of the user's listed players, and AI↔AI loans) are
 * scoped to prospects, not established stars. The user's own outgoing
 * listings have no such restriction — it's their squad, their call.
 */
export const LOAN_AI_MAX_AGE = 23;

/*
 * LOAN_AVAILABILITY was deleted on 2026-08-13, for the same reason
 * AI_MARKET_AVAILABILITY was deleted on 2026-08-11: it screened a loan out
 * unless the parent's keep-value for the player was under 0.95 × his market
 * value, which compares a club-relative quantity against a club-blind one.
 *
 * It was kept when the market's copy went, deliberately, to avoid changing two
 * markets in one PR — with a comment conceding that the argument for keeping it
 * ("loan candidates are already buried under-24s, so the screen is rarely the
 * binding constraint") was reasoning rather than measurement. Measured
 * afterwards (scripts/loanAvailabilityProbe.ts): it excluded **~71% of clubs'
 * best loan-eligible players**, median keep/market 1.30. Binding, not rare.
 *
 * Loans are now protected by price alone: LOAN_MIN_SURPLUS requires the borrower
 * to value the player above what he is worth to his parent.
 */

/**
 * A prospective loanee club bothers only if the player would be meaningfully
 * more useful there than at his current club — looser than
 * AI_MARKET_MIN_SURPLUS (0.15) since a loan is cheap and reversible, so the
 * bar for "worth taking a flier on" is lower than for a permanent buy.
 */
export const LOAN_MIN_SURPLUS = 0.05;

/** Most incoming loan offers shown for the user's listed players in a single window. */
export const LOAN_OFFERS_MAX = 5;

/** Most loans any one AI club will send out / take on in a single window (mirrors AI_MARKET_MAX_BUYS/SELLS). */
export const AI_LOAN_MAX_MOVES = 2;

/* ────────────────────────────────────────────────────────────────────────
 * End-of-season awards (Player of the Season, Golden Boot, Team of the
 * Season). Scoring layers explicit per-season goal/assist/defensive-stat
 * weights on top of avgRating (itself already a per-match, position-weighted
 * blend of these same stats via computeMatchRating in matchRating.ts) so a
 * season of end product counts for more than the match-by-match average
 * alone would credit. Weights are season-total analogs of matchRating's
 * per-match weights, scaled down since they're summed over ~30+ appearances
 * instead of one game.
 * ──────────────────────────────────────────────────────────────────────── */

/** Appearances needed in a season to qualify for Player of the Season / Team of the Season (of 38 matchdays). */
export const AWARD_MIN_APPEARANCES = 19;

/**
 * Award scoring is otherwise built entirely from in-match performance stats (avgRating +
 * goals/assists/tackles/etc), with no sense of how good the player actually is — a mediocre
 * player on a struggling team can rack up huge tackle/interception counts just from facing more
 * attacks, and out-score a genuinely elite player who had a quieter statistical season. This term
 * pulls awards back toward "best players" rather than "best statlines" by adding
 * `(ovr - AWARD_OVR_BASELINE) * AWARD_OVR_WEIGHT` to both formulas. Baseline is the Manual's
 * "average starter" line; weight is tuned so a modest ovr gap (~10) is worth meaningfully less
 * than a strong stat season and can still be edged out by one, while a large gap (~25+) can't be
 * fully offset by stats alone.
 *
 * Retuned 0.15 → 0.06 on 2026-07-14, in the same PR as the LEAGUE_BASE/TEAM_STRENGTH_SPREAD/
 * RATING_NOISE_SD generation retune above: 0.15 was picked when the league still generated a
 * 7-10-point-short OVR distribution (max ~73-76), so it never got exercised against real elite
 * (80-90) players. Once generation was fixed to actually reach that range, the math didn't hold:
 * a 90-ovr player's bonus at 0.15 is (90-65)*0.15 = 3.75, worth ~47 goals at FWD's 0.08
 * POTY_GOAL_WEIGHT — far beyond a realistic season's output (the M3 §8 gate pins top scorers at
 * 18-32 goals) — making awards a near-pure ovr leaderboard for any real elite player, the opposite
 * of "a big statistical season can still edge out" the term was meant to allow. At 0.06, the same
 * 25-ovr gap is worth 1.5, ~18-19 goals equivalent — close to a realistic season's floor rather
 * than dwarfing it.
 */
export const AWARD_OVR_BASELINE = 65;
export const AWARD_OVR_WEIGHT = 0.06;

/**
 * Player of the Season: avgRating plus goals/assists weighted heavier than the match-rating baseline already does.
 *
 * Which column a position reads is `positionGroup` in `core/awards.ts` — note
 * that **AM reads FWD here, not MID**, because an attacking midfielder's
 * measured output in this engine is a winger's, not a central midfielder's.
 * The reasoning and the numbers are on that function; don't retune these values
 * to compensate for a position sitting in the column you didn't expect.
 */
export const POTY_GOAL_WEIGHT: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  FWD: 0.08, MID: 0.1, DEF: 0.14, GK: 0.22,
};
export const POTY_ASSIST_WEIGHT: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  FWD: 0.05, MID: 0.07, DEF: 0.09, GK: 0.16,
};

/** Team of the Season: avgRating plus every position-relevant season stat, not just goals/assists. */
export const TOTS_GOAL_WEIGHT: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  FWD: 0.06, MID: 0.08, DEF: 0.11, GK: 0.3,
};
export const TOTS_ASSIST_WEIGHT: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  FWD: 0.04, MID: 0.055, DEF: 0.07, GK: 0.2,
};
export const TOTS_TACKLE_WEIGHT: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  FWD: 0.01, MID: 0.02, DEF: 0.03, GK: 0,
};
export const TOTS_INTERCEPTION_WEIGHT = TOTS_TACKLE_WEIGHT;
/** Goalkeepers only. */
export const TOTS_SAVE_WEIGHT = 0.035;
/** Penalty per goal conceded across the season, heaviest for GK/DEF. */
export const TOTS_GOALS_AGAINST_PENALTY: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  FWD: 0, MID: 0.006, DEF: 0.02, GK: 0.03,
};

/* ────────────────────────────────────────────────────────────────────────
 * Worldwide awards — Ballon d'Or and World Team of the Year (core/worldAwards.ts)
 *
 * The per-competition awards above rank players *inside one league*. These rank
 * the whole world against itself, which needs two things that a within-league
 * award never does:
 *
 *  1. A league-strength correction. Match ratings are z-normalized within each
 *     competition (see CLAUDE.md), so a 7.6 average in Portugal and a 7.6 in
 *     England are NOT the same performance — each is measured against its own
 *     league's mean. Comparing them at face value would hand the Ballon d'Or to
 *     whoever plays in the weakest league, since dominating weak opposition is
 *     easier. The fix is an additive offset in rating units, proportional to how
 *     far a competition's own quality sits from the world's.
 *  2. Credit for the two cross-league competitions. The Continental Cup and the
 *     World Cup are the only places players from different leagues actually meet,
 *     so they carry weight out of proportion to their game count — which is also
 *     how the real award is voted.
 * ──────────────────────────────────────────────────────────────────────── */

/** How many players the Ballon d'Or ranking keeps (the winner plus the rest of the shortlist). */
export const BALLON_DOR_SHORTLIST = 10;

/**
 * How many players the Goalkeeper of the Year and Defender of the Year
 * rankings keep — the winner plus the rest of his shortlist.
 *
 * Shorter than the Ballon d'Or's ten because each is drawn from one position
 * group rather than the whole world: `TOTS_SLOTS` fields one keeper and four
 * defenders, so a ten-deep keeper shortlist would be reaching well past the
 * players anyone would call the best in the world that season.
 */
export const WORLD_POSITION_AWARD_SHORTLIST = 5;

/**
 * How much more everything *outside* a player's own league season counts in the
 * awards scored on `totsScore` — the World Team of the Year, the Goalkeeper of
 * the Year and the Defender of the Year.
 *
 * Scales all four non-league parts of the score together: the Continental Cup,
 * the international campaign, the league title and the domestic cup. The
 * domestic league component is the one thing left alone, because it is the one
 * part measured entirely inside a single competition.
 *
 * **Belongs to the `totsScore` base, not to any one award.** That is why it is
 * applied inside `worldTotsParts` rather than at the three call sites: all
 * three awards inherit the same inflated base and so need the same correction,
 * and applying it to only some of them makes them disagree about the same
 * player (it did — see the history note at the bottom). The Ballon d'Or is
 * built on `potyScore` instead and is deliberately untouched by this.
 *
 * **The problem it solves is dilution, not a missing term.** Trophies were
 * already in these awards at full Ballon d'Or weight, via the shared
 * `worldAwardParts`. They were simply being drowned: `totsScore` pays a
 * defender 0.03 per tackle and 0.03 per interception, and a season's 200 of
 * each is 12 points on a score of about 21. Against that, a league title's 0.8
 * is under 4%. The same 0.8 on a striker's Ballon d'Or lands on a ~14-point
 * score where his 26 league goals are worth 2.08, so it is proportionally about
 * twice as loud. The multiplier restores that proportion and then some.
 *
 * **Why it also moves winners into stronger leagues.** Measured before this:
 * the *keeper* award already landed like the Ballon d'Or (12 of 16 winners in
 * the big four, against the Ballon d'Or's own 12 of 16), while the defender
 * award put 7 of 16 in the weakest leagues.
 *
 * The mechanism is narrower than it looks, and an earlier version of this
 * comment got it wrong, so be precise about it. The multiplier does **not**
 * touch ovr or the league-strength correction: both live inside `league`, which
 * is exactly the part left alone. If anything it makes them a *smaller* share
 * of the total. The whole effect comes from the two multiplied terms that are
 * cross-league-meaningful on their own — the **Continental Cup** run, which a
 * weak league's clubs rarely go deep in, and the **international** campaign,
 * which weak nations rarely win. The other two multiplied terms, the league
 * title and the domestic cup, are league-relative and contribute nothing here.
 *
 * The corollary is the cost recorded below: diluting ovr is *why* the keeper's
 * median ovr rank slipped from 3 to about 8. Same lever, both effects.
 *
 * **So scaling one trophy would not have worked.** A league title is
 * *league-relative*: Belgium's champion wins Belgium as surely as England's
 * wins England. Scaling the whole non-league block is what gets the trophy
 * effect and the league-strength effect together, which is why this is one
 * multiplier over four parts rather than a knob per trophy.
 *
 * **Measured at 3, two seeds x 6 seasons (`scripts/positionAwardAudit.ts`),
 * against the same runs' Ballon d'Or at 10 of 12 winners from the big four:**
 *
 * | | before | after |
 * |---|---|---|
 * | keeper winners from the big four | 12/16 | 11/12 |
 * | defender winners from the big four | 9/16 | 9/12 |
 * | defender winners from Belgium/Turkey | 5/16 | 1/12 |
 * | defender score from tackles + interceptions | 50% | 37% |
 * | defender's worst ovr rank | 112 | 25 |
 *
 * **Proportion check, measured on the same runs (2 seeds x 6 seasons):** share
 * of the winning score coming from beyond the player's own league — Ballon d'Or
 * **16% / 15%**, defender **20% / 18%**, keeper **29% / 24%**. So against the
 * yardstick the defender award runs about 1.2x and the keeper award about 1.7x. So the defender award now sits just above the
 * yardstick and the keeper award well above it, because a keeper's `totsScore`
 * carries far less volume than a defender's (saves at 0.035 against tackles
 * *and* interceptions at 0.03 each), leaving the same tripled trophies landing
 * on a smaller base — a ~16-point score against ~24. If that ever wants
 * evening up, the honest fix is a per-group multiplier, not a smaller shared
 * one.
 *
 * The cost, and it is the same trade the Ballon d'Or's own team bonuses make
 * (see WORLD_AWARD_OVR_WEIGHT's sweep): the winner is less reliably the single
 * best player at his position. The keeper's median ovr rank among keepers went
 * 3 -> about 8, which lands it on the Ballon d'Or's own standard (median 8)
 * rather than anywhere unusual. Raising this further buys league strength at
 * the cost of that rank, and the two cannot both be maximised.
 *
 * **History, because the shape of the mistake generalises (2026-08-24).** This
 * shipped for a few hours applied to the two position awards only, leaving the
 * World XI on the plain score. That looked like the conservative choice — don't
 * retune a shipped award — and it was the wrong one: the XI slot then went to
 * the best performer while the award went to the best performer who also won
 * things, so the Goalkeeper of the Year stopped being the XI's keeper about two
 * thirds of the time (17% and 50% agreement measured), on two panels of the
 * same page. **A correction that belongs to a shared base has to be applied at
 * the base, or the things built on it quietly stop agreeing.**
 */
export const WORLD_TOTS_TROPHY_MULTIPLIER = 3;

/**
 * How much a league title and a domestic cup are scaled by how strong the
 * league that awarded them is.
 *
 * `scale = clamp(1 + (competition mean ovr - world mean ovr) * this, FLOOR, CAP)`
 *
 * **Why only these two trophies.** Every other term in a worldwide award is
 * already comparable across leagues, or corrected to be. Match ratings get
 * `leagueStrengthOffsets`. The Continental Cup and the international campaign
 * are played *between* leagues, so their difficulty is inherent — winning the
 * Continental Cup is exactly as hard whoever you are. A league title and a
 * domestic cup are the only trophies that are **league-relative**: Belgium's
 * champion wins Belgium as surely as England's wins England, and until now
 * both were worth an identical 0.8. That is the one place the award said two
 * plainly different achievements were the same.
 *
 * **Sized by taste, not by measurement**, like the trophy bonuses it scales.
 * At 0.06, against the shipped world's tier-1 spread (England ~63.3 down to
 * Turkey ~55.6, world mean ~55), an English title comes out about 1.5x and a
 * Turkish one about 1.03x — so roughly a 1.45x gap between the strongest and
 * weakest top flight. Deliberately not larger: a title is already pro-rated by
 * appearances and multiplied by WORLD_TOTS_TROPHY_MULTIPLIER, so it compounds.
 *
 * **The floor is load-bearing, and not for tier 1.** A tier-2 league title
 * scores nothing anyway (`championTidByCompId` holds tier-1 champions only),
 * but a **tier-2 club really can win its domestic cup**, and a second division
 * sits far enough below the world mean to drive this negative — which would
 * turn winning a cup into a penalty. The floor keeps it a reduced reward
 * instead of an inverted one.
 *
 * The cap exists for a custom world: the shipped one tops out around 1.5, but
 * nothing stops a player building a league far above the world mean, and an
 * unbounded scale would let one league's title outweigh a World Cup.
 */
export const WORLD_AWARD_TROPHY_STRENGTH_WEIGHT = 0.06;
export const WORLD_AWARD_TROPHY_STRENGTH_FLOOR = 0.25;
export const WORLD_AWARD_TROPHY_STRENGTH_CAP = 2;

/* ────────────────────────────────────────────────────────────────────────
 * Goalkeeper of the Year and Defender of the Year (core/worldAwards.ts)
 *
 * Why these exist at all: the Ballon d'Or is built on `potyScore`, which
 * carries **no defensive statistics whatsoever** — no tackles, no
 * interceptions, no saves, no goals conceded. A centre-back's entire case is
 * his match rating plus the two ovr terms, and the higher per-goal weights
 * defenders get (0.14 against a striker's 0.08) cannot compensate, because
 * they multiply a stat defenders barely accumulate: a striker's 26 goals are
 * worth 2.08 points while average match ratings across the whole winner pool
 * span about 6.75 to 7.49. Measured over eight seasons of a 240-club world,
 * the Ballon d'Or top ten was 45% ST / 30% AM / 20% W / 5% FB, with no
 * centre-back, holding midfielder or goalkeeper ever reaching it.
 *
 * That is a property of the formula, not a tuning accident, and it is also how
 * the real award behaves — one defender has won it in sixty-odd years, which
 * is why the real ceremony hands out a separate keeper's trophy instead of
 * trying to make the main one positionally fair.
 *
 * So these two awards are scored on `totsScore` — the *defensive-aware*
 * formula, which does credit tackles, interceptions, saves and goals conceded
 * — carrying the same worldwide adjustments the Ballon d'Or uses (league
 * strength, the extra ovr weight, the Continental Cup, the international
 * campaign, a league title, a domestic cup). That is deliberately the exact
 * number the World Team of the Year already picks its slots with, so the
 * Goalkeeper of the Year and the World XI's keeper agree by construction
 * rather than by coincidence, and a player never has to explain why he was the
 * best keeper alive but not the best keeper in the XI.
 *
 * The known limitation, inherited from `totsScore` and documented on
 * `TOTS_SLOTS`: it is a *within-position* statistic. Comparing a centre-back
 * against a winger with it is meaningless, which is exactly why these awards
 * only ever compare a group against itself. The Defender of the Year does
 * compare centre-backs against full-backs, who at least read the same weight
 * column — watch the CB/FB split on `scripts/positionAwardAudit.ts` if that
 * ever looks lopsided.
 *
 * A refinement deliberately NOT taken: `SeasonStats` carries `xga` as well as
 * `goalsAgainst`, so a keeper's shot-stopping could be scored as goals
 * prevented against expectation rather than as raw saves minus concessions.
 * It is the better keeper metric and it is left for later on purpose — it
 * needs its own tuning pass, and it would split the Goalkeeper of the Year
 * away from the World XI keeper, losing the agreement described above.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Rating points added per point of ovr that a player's competition sits above the
 * world average (negative below it) — the correction described above.
 *
 * Set from the empirical slope of avgRating against ovr *inside* one league:
 * roughly a point of season average rating per 20 points of ovr. Because
 * z-normalization rescales every league onto that same slope, a league whose
 * players average N ovr below the world hands out ratings about N × this much
 * too generously, and subtracting it back off is what puts the leagues on one
 * scale. Do NOT think of this as a "weak leagues are worth less" penalty knob —
 * it's a unit conversion, and inflating it past the real slope would over-correct
 * and make a strong league's mid-table player outrank a weak league's best.
 */
export const WORLD_AWARD_LEAGUE_STRENGTH_WEIGHT = 0.05;

/**
 * Continental Cup goals/assists are worth this much more than league ones.
 *
 * **Measured at 1.0 — a cup goal is worth exactly a league goal.** The tempting
 * intuition is that cup goals are rarer and so should count for more, and this
 * shipped at 1.5 on exactly that reasoning. `scripts/worldAwardsAudit.ts` showed
 * the intuition is false here: only elite attackers on the best 20 clubs in the
 * world play the cup, so its per-game scoring rate *matches* the league's (the
 * same player putting up 13 goals in 8 cup games and 25 in 38 league games).
 * Paying a premium on top of that double-counts, and it handed two Ballon d'Ors
 * in eight seasons to players who'd had a below-6.8-average league season and
 * won on the cup alone. The cup still counts for plenty — it just counts once.
 */
export const WORLD_AWARD_CUP_MULTIPLIER = 1;

/**
 * Weight on (cup average rating − RATING_BASELINE). Applied with no league-
 * strength correction, deliberately: cup ratings already normalize against the
 * whole pooled field, making them the one directly cross-league performance
 * number the sim produces.
 *
 * Kept small for the same reason the multiplier is 1.0: nine cup games must not
 * out-swing thirty-eight league ones. The cup component as a whole is meant to
 * span roughly 0 to 1.7, against a league component spanning about 2.4 — enough
 * to decide a close race, never enough to overturn a clearly better season.
 */
export const WORLD_AWARD_CUP_RATING_WEIGHT = 0.2;

/**
 * Cup appearances needed before a player takes full credit for his club's cup
 * run (and full weight on his cup rating). Below it, credit is pro-rated — a
 * fourth-choice keeper who played one league-phase game doesn't get a winner's
 * medal's worth of Ballon d'Or points.
 */
export const WORLD_AWARD_CUP_FULL_INVOLVEMENT = 6;

/**
 * EXTRA weight on (ovr − AWARD_OVR_BASELINE), applied by the worldwide awards
 * only, *on top of* the AWARD_OVR_WEIGHT term already inside potyScore/totsScore.
 * Effective world-award weight is therefore AWARD_OVR_WEIGHT + this.
 *
 * Why a second constant instead of just raising AWARD_OVR_WEIGHT: that one is
 * shared with the per-competition Player of the Season, Golden Boot and Team of
 * the Season, which are separately tuned and player-visible. Raising it would
 * silently re-tune three existing awards to fix a fourth.
 *
 * There is also a real reason a *worldwide* award should lean on ovr harder
 * than a within-league one. Every other input has been z-normalized inside its
 * own competition; ovr is the only player number that means the same thing
 * everywhere, which is exactly why it powers leagueStrengthOffsets too. Leaning
 * on it across leagues is better-founded than leaning on it within one.
 *
 * This is the direct counterweight to the goal-scoring term. It trades "a big
 * statline can beat a better player" (the per-league POTY's deliberate trade)
 * for "the best player in the world usually wins the world award". Tune against
 * the winner's world ovr rank in scripts/worldAwardsAudit.ts, and watch that the
 * shortlist doesn't collapse into a pure ovr ranking — if the winner is the
 * highest-ovr eligible player nearly every season, this is too high.
 *
 * Measured sweep, 20 seasons (2 seeds × 10). Rank is the winner's ovr rank
 * among the ~4,300 players who appeared, at the team bonuses set below:
 *
 *   weight   median   mean / worst   won league   won cup   ST share
 *   0        108      210 / 882      65%          40%       75%
 *   0.06     56       120 / 618      70%          25%       70%
 *   0.14     8        31 / 150       65%          15%       45%
 *
 * It trades directly against team achievement, and **the trade cannot be
 * escaped by raising both.** Scaling the team bonuses up ~1.8x alongside 0.14
 * (to 1.4 / [1.8,1,0.55,0.27] / 2.5) did restore trophies (league 80%, cup
 * 25%) but put the ovr rank straight back to median 61 — both levers reorder
 * the same ranking, so raising them together just cancels. Pick a point on the
 * curve rather than trying to have both ends of it.
 *
 * 0.14 is chosen deliberately at the quality end. Welcome side effect: it's the
 * only setting that meaningfully dents the striker monopoly (ST share 75%->45%,
 * with AM/W/CM winning and a fullback taking one), because a high-ovr defender
 * finally scores for being good instead of needing goals potyScore will never
 * give him. That's a partial mitigation of the structural issue documented in
 * CLAUDE.md, not a fix for it.
 */
export const WORLD_AWARD_OVR_WEIGHT = 0.14;

/* ── Team achievement (2026-07-27) ────────────────────────────────────────
 * The three constants below (cup run, league title, World Cup win) are the
 * *team* side of the Ballon d'Or, as opposed to a player's own end product.
 * They were all raised sharply on 2026-07-27 after an audit showed team
 * success was very nearly decorative: over 20 winners the mean score split was
 * league 10.58 / cup 0.76 / intl 0.45 / title 0.16, i.e. winning your league
 * moved the needle less than scoring four extra goals.
 *
 * The useful way to size these is an exchange rate against the thing that
 * dominates the score. A striker's league goal is worth POTY_GOAL_WEIGHT.FWD
 * (0.08), so the values below read as: a league title ≈ 10 goals, winning the
 * Continental Cup ≈ 12 goals, winning the World Cup ≈ 17 goals. That ordering
 * (World Cup > Continental Cup > domestic league) is the intended hierarchy.
 *
 * Raising *these* is much safer than raising the cup's individual-production
 * weights (WORLD_AWARD_CUP_MULTIPLIER, which is 1.0 for measured reasons —
 * see its comment). A run bonus is uniform across a squad, so it can only move
 * the award *between* clubs; it can't inflate one player above a better
 * team-mate. The failure mode to watch when tuning is therefore not "a weak
 * player beat his own team-mate" but "the award became a prize for being on
 * the best team" — check the winner's world ovr rank and the share of winners
 * coming from champion clubs in scripts/worldAwardsAudit.ts.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Bonus for how far a player's club went in the Continental Cup, indexed by
 * rounds from the final: [0] won it, [1] lost the final, [2] out in the semis,
 * [3] out in the quarters. Anything earlier is worth nothing beyond the
 * per-match stats already counted. Pro-rated by involvement, so a bit-part
 * player on the winner does not collect the full 1.0.
 */
export const WORLD_AWARD_CUP_RUN_BONUS: readonly number[] = [1, 0.55, 0.3, 0.15];

/** Bonus for winning your own (tier-1) league, pro-rated by appearances up to WORLD_AWARD_TITLE_FULL_SEASON. */
export const WORLD_AWARD_LEAGUE_TITLE_BONUS = 0.8;

/**
 * Appearances that count as having played a whole title-winning season — a full
 * league campaign, every club home and away. Pro-rating against *this* rather
 * than the AWARD_MIN_APPEARANCES eligibility bar is what makes the title bonus
 * discriminate at all: everyone eligible for the award has already cleared that
 * bar, so dividing by it would hand every last squad member full credit.
 */
export const WORLD_AWARD_TITLE_FULL_SEASON = 2 * (NUM_TEAMS - 1);

/**
 * Bonus for winning your own domestic cup, pro-rated by how many of its ties you
 * actually played.
 *
 * Sized off the same exchange rate the other team bonuses use, against
 * POTY_GOAL_WEIGHT.FWD (0.08): a league title (0.8) is worth ~10 striker goals,
 * a Continental Cup run bonus (1.0) ~12, a World Cup (1.4) ~17. A domestic cup
 * at 0.25 is worth ~3 goals — about a third of a league title, which is the
 * intended hierarchy: it is the easiest of the four trophies to win, six games
 * and some luck, and it should read that way against a whole league campaign.
 *
 * Why it exists at all: the Ballon d'Or already pays for winning your league, so
 * without this a player who won the double got credited for one trophy and not
 * the other. It is deliberately a **team-achievement** term and NOT a
 * production term — no domestic cup goals, assists or ratings enter the award.
 * Those ratings are z-normalized within a single country, so they are not
 * comparable across leagues the way Continental Cup ratings are (which is the
 * whole reason WORLD_AWARD_LEAGUE_STRENGTH_WEIGHT exists), and feeding them in
 * would quietly favour whoever plays in the weakest country. A uniform squad
 * bonus carries no such bias: it can move the award *between* clubs but never
 * lift a player above a better team-mate.
 *
 * **Measured** (`scripts/worldAwardsAudit.ts`, 3 seeds x 12 seasons = 36 award
 * seasons, against the same script with the term removed — world awards feed
 * nothing in the sim, so both runs play identical dynasties and only the
 * ranking can differ):
 *
 *                        baseline   with bonus
 *   winner won his league  72%        72%
 *   won the Continental    28%        25%
 *   won the World Cup      11%        11%
 *   winner ovr rank median 69         68
 *   winner ovr rank mean   129.5      135.6
 *   ST share of winners    69%        69%
 *   mean score split       league 12.45 / cup 0.95 / title 0.55 / intl 0.55
 *                          plus dcup 0.04 with the bonus on
 *
 * So it is a **tie-breaker-scale** term by design: 0.25 paid on the 17% of
 * seasons where the winner's club won its domestic cup averages 0.04 against a
 * ~14.5 total, and it flipped one or two winners in 36 seasons. The guarded
 * metrics held — median ovr rank flat, striker share identical, big-four
 * dominance and the occasional weak-league winner both intact. Note 36 seasons
 * is a small sample and a one-winner difference is inside the noise on the
 * *mean* rank; the median is the number to read (see WORLD_AWARD_OVR_WEIGHT).
 */
export const WORLD_AWARD_DOMESTIC_CUP_BONUS = 0.25;

/**
 * Domestic cup ties that count as having played the whole run. A winner plays
 * five or six ties depending on whether it entered at the preliminary round, so
 * four is "he was in the side for it" while a one-tie cameo collects a fifth of
 * the bonus. Same idea as WORLD_AWARD_CUP_FULL_INVOLVEMENT for the Continental
 * run bonus, and the same reason: a bit-part player shouldn't take a winner's
 * share.
 */
export const WORLD_AWARD_DOMESTIC_CUP_FULL_INVOLVEMENT = 4;

/**
 * International football, from the campaign played in the offseason directly
 * after the season being judged. Weights are per goal / assist / cap, and the
 * multiplier applies to a World Cup campaign over a qualifying one — a goal at
 * the tournament counts double a goal in qualifying.
 */
export const WORLD_AWARD_INTL_GOAL_WEIGHT = 0.09;
export const WORLD_AWARD_INTL_ASSIST_WEIGHT = 0.06;
export const WORLD_AWARD_INTL_CAP_WEIGHT = 0.02;
export const WORLD_AWARD_INTL_TOURNAMENT_MULTIPLIER = 2;

/**
 * Bonus for being in the squad that won the World Cup that offseason — the
 * single biggest team achievement available, and the rarest (a tournament only
 * comes round every INTL_CYCLE_YEARS seasons, so three winners in four never
 * get the chance). See the team-achievement note above for how it was sized.
 */
export const WORLD_AWARD_WORLD_CUP_BONUS = 1.4;

/**
 * A confederation cup (the Euro, Copa America, AFCON — see
 * CONFEDERATION_CUPS) is worth less than a World Cup on both axes: its
 * matches count 1.5x a qualifying game rather than 2x, and winning it pays
 * roughly half a World Cup.
 *
 * Sized on the same exchange rate as the rest of the team-achievement block (a
 * striker's league goal is POTY_GOAL_WEIGHT.FWD, 0.08): a confederation cup title is
 * about 9 goals, against the domestic cup's 3, a league title's 10, the club
 * Continental Cup's 12 and the World Cup's 17 — second-smallest of the five,
 * above only the domestic cup. Two reasons to keep it low, and they pull the
 * same way: a confederation cup field is a *subset* of the world (Copa America is
 * contested by a handful of nations, so its winner has beaten far less of the
 * planet than a World Cup winner has), and it lands in the same offseason as a
 * World Cup qualifying leg, so a player collecting it is already being paid for
 * that campaign's caps and goals.
 *
 * The multiplier sits between qualifying and a World Cup for the same reason —
 * knockout football against your continent's best is worth more than a
 * qualifier, less than the world's showpiece — and it is applied uniformly
 * whether the tournament had 25 entrants or 5. That evenness is a known,
 * accepted simplification: scaling it by field size would make a South American
 * player's Copa worth less than a European's Euro on top of the smaller pool
 * already making it easier to win, i.e. it would punish twice.
 *
 * Gate for changing either: scripts/worldAwardsAudit.ts, watching the winner's
 * world ovr rank — the whole team-achievement block trades against it and
 * raising these alongside the others just cancels (see the note above).
 */
export const WORLD_AWARD_INTL_CONFEDERATION_CUP_MULTIPLIER = 1.5;
export const WORLD_AWARD_CONFEDERATION_CUP_BONUS = 0.7;

/* ────────────────────────────────────────────────────────────────────────
 * News Feed accomplishments
 * ──────────────────────────────────────────────────────────────────────── */

/** Minimum single-match rating (see engine/matchRating.ts) to qualify as a matchday's "standout performance" news item. At most one per matchday, world-wide. */
export const NEWS_STANDOUT_RATING_FLOOR = 8.0;

/*
 * Goal milestones — the ladder a total has to climb to be worth a headline.
 *
 * These are ABSOLUTE bars, applied at detection time, and they are the reason
 * the feed is affordable: a news event is persisted forever (LeagueStore
 * .newsEvents is append-only), so anything the bar lets through is paid for in
 * every save from then on. Measured on a 16-competition world before this
 * existed, a single flat step of 10 fired 1,661 career-milestone events a
 * season by season 4 and rising — one for every journeyman crossing 60 — which
 * is both the bulk of the feed's rows and a permanent save cost.
 *
 * FIRST must be a whole multiple of STEP; `goalMilestoneReached` relies on it.
 */
/** A career total is news at 50, then every 50 (100, 150, 200...). */
export const NEWS_CAREER_GOAL_FIRST = 50;
export const NEWS_CAREER_GOAL_STEP = 50;
/**
 * A season total is news at 25, then every 5. The mean tier-1 Golden Boot sits
 * at ~28 (see test/validation/m3-top-scorer.test.ts), so 25 is roughly "having
 * a Golden Boot season" and the rungs above it are genuinely rare.
 */
export const NEWS_SEASON_GOAL_FIRST = 25;
export const NEWS_SEASON_GOAL_STEP = 5;

/*
 * Relevance tiers — the bars an event has to clear to be worth reading about
 * when it happened somewhere you don't play.
 *
 * The world is 16 competitions and 320 clubs, so ~90% of everything detected
 * happens in a country the user has no stake in. `newsEventScope` sorts an
 * event into "league" (interesting inside its own competition) or "world"
 * (interesting anywhere), and the feed shows foreign "league" events to nobody.
 *
 * Deliberately derived from the event's own type and detail rather than stored
 * on it: no new persisted field, no migration, and the tiers apply to events
 * that were already written by older builds.
 */
/** Career goals that make a milestone world news rather than league news. */
export const NEWS_WORLD_CAREER_GOALS = 100;
/** Season goals that make a milestone world news rather than league news. */
export const NEWS_WORLD_SEASON_GOALS = 35;
/** Goals in one match that make a haul world news rather than league news. */
export const NEWS_WORLD_HATTRICK_GOALS = 4;
/**
 * Fee that makes a transfer between two clubs you have no stake in worth a
 * headline. Against the shipped value curve (80 ovr ~ $86M, 83 ~ $134M) this
 * is a genuine first-team signing rather than squad filler; measured, it keeps
 * the top ~5% of the world's paid deals.
 */
export const NEWS_WORLD_TRANSFER_FEE = 40_000_000;

/**
 * How far down the Ballon d'Or shortlist counts as winning something.
 *
 * The shortlist is `BALLON_DOR_SHORTLIST` long and the whole of it is stored,
 * but a ninth place is a ranking rather than an honour, and reporting all of it
 * would put up to ten rows a season on the feed for one award. The podium is
 * what a player carries on his profile.
 */
export const NEWS_BALLON_DOR_PLACINGS = 3;

/**
 * Minimum OVR for a career position change at an AI club to reach the News
 * Feed. The user's own players are always reported regardless.
 *
 * Position changes are common enough across 320 clubs that reporting all of
 * them would bury the feed, the same reason AI free-agent churn is kept out of
 * it. A squad player quietly becoming a full-back in another country is not
 * news; an established starter changing what he is, is.
 */
export const NEWS_POSITION_CHANGE_OVR = 72;

/* ────────────────────────────────────────────────────────────────────────
 * Continental Cup (cross-country knockout tournament)
 *
 * A 16-team single-leg knockout played *alongside* the league season: the top
 * CUP_TEAMS_PER_LEAGUE clubs of every tier-1 league's *previous-season* final
 * table qualify (4 leagues × 4 = 16). Season 1 has no cup (no prior table);
 * the first cup is season 2. Rounds fire on fixed league matchdays inside
 * simThrough, and cup matches use their own seeded rng so league results stay
 * bit-identical. Cup stats are tracked separately from league SeasonStats.
 * ──────────────────────────────────────────────────────────────────────── */

export const CUP_NAME = "Continental Cup";

/**
 * Cup slots per tier-1 league, by league strength. A "strong" league (a big-
 * four league — countryStrengthOffset 0) sends its top CUP_STRONG_LEAGUE_SLOTS;
 * a "weak" league (everything with a countryStrengthOffset — France, the
 * Netherlands, Portugal, Belgium, Turkey, Greece, Scotland, Serbia) sends its
 * top CUP_WEAK_LEAGUE_SLOTS. With 4 strong × 4 + 8 weak × 2 = 32 qualifiers, the
 * cup opens with a Swiss-style league phase (see CUP_LEAGUE_PHASE_* below)
 * rather than a straight bracket. CUP_TEAMS_PER_LEAGUE is kept as the strong
 * default for any code/tests that predate the weak-league split.
 */
export const CUP_STRONG_LEAGUE_SLOTS = 4;
export const CUP_WEAK_LEAGUE_SLOTS = 2;
export const CUP_TEAMS_PER_LEAGUE = CUP_STRONG_LEAGUE_SLOTS;

/* ── Swiss league phase ──────────────────────────────────────────────────────
 * The modern-UCL-style opening stage: all CUP_LEAGUE_PHASE_SIZE qualifiers sit
 * in one combined table and each plays CUP_LEAGUE_PHASE_GAMES matches against
 * different opponents (drawn via strength pots — see drawLeaguePhase). The final
 * table then splits three ways (cupKnockoutPlan, sized off the field): the top
 * few go straight to the knockout, the next few contest a single-leg playoff for
 * the bracket slots left over, and the rest are eliminated. */
/**
 * Field size, derived from the world: 4 strong leagues × CUP_STRONG_LEAGUE_SLOTS
 * + 8 weak × CUP_WEAK_LEAGUE_SLOTS = 32. Nothing in src/ reads this (the draw
 * and the split both work off the actual field length, so both are field-size
 * agnostic) — it documents the expected size and anchors the cup tests. Raised
 * 20 → 24 when Belgium and Turkey joined, 24 → 28 for the Netherlands and
 * Scotland, 28 → 32 for Greece and Serbia.
 *
 * **A valid field is a multiple of 4**, because it must be even AND split into
 * CUP_LEAGUE_PHASE_POTS pots that are themselves even (the draw builds each
 * round as a perfect matching within a pot). 32 → two pots of 16 ✓. A 22- or
 * 30-team field is NOT valid: pots of 11/15 are odd and cannot be paired.
 * Since this size is 2 × countries + 8, **the world's country count must stay
 * even** or the field is trimmed and clubs that qualified on league position
 * get cut. See the note in competitions.ts.
 */
export const CUP_LEAGUE_PHASE_SIZE = 32;
export const CUP_LEAGUE_PHASE_GAMES = 6;
/**
 * Number of strength pots the league-phase field is split into for the draw.
 * Each club plays CUP_LEAGUE_PHASE_GAMES / CUP_LEAGUE_PHASE_POTS opponents from
 * each pot, guaranteeing a balanced spread of tough and winnable games. Must
 * divide the field evenly (32 / 2 = 16 per pot) and divide the game count
 * evenly (6 / 2 = 3 per pot). Note a 22-club field would be invalid: pots of 11
 * are odd, and the draw builds each round as a perfect matching within pots.
 */
export const CUP_LEAGUE_PHASE_POTS = 2;

/** League matchdays the six league-phase rounds are played on (before the knockout). */
export const CUP_LEAGUE_PHASE_MATCHDAYS = [3, 7, 11, 15, 19, 23] as const;

/**
 * The share of the league-phase field that survives it. Half, which is what a
 * 24-club Continental Cup has always played (4 direct + 8 in the playoff = 12
 * of 24), so the shipped world's split is unchanged by cupKnockoutPlan below.
 *
 * It has to be a share rather than a fixed count because the field is no longer
 * a fixed size: the Shield is 16, and a player-built world can produce anything
 * from 12 upward. Fixed at 4 + 8, a 16-club Shield advanced TWELVE of its
 * sixteen entrants — the league phase eliminated four clubs in six rounds and
 * decided almost nothing.
 */
export const CUP_LP_ADVANCE_FRACTION = 0.5;

/**
 * And no more than this many brackets' worth, whatever the field. 1.5 is the
 * shape the Cup has always played and the shape the real competition plays: a
 * bracket of direct qualifiers plus a playoff for the other half of it (4 + 8 =
 * 12 = 1.5 x 8 here; UEFA's 36-club field sends 24 = 1.5 x 16).
 *
 * The cap is what keeps BOTH shipped competitions untouched, which matters more
 * than it looks: the Cup's field is 32 and the Shield's is 24, so no single
 * fraction leaves both alone (half of 32 is 16, half of 24 is 12). Capped, both
 * land on 4 / 8 / 8 exactly as before, so no scoreline moves and no prize money
 * moves either -- the failure mode a format change reaches first.
 *
 * It is also the better format at the top end. Uncapped, a 32-club field
 * advances 16, a full two brackets, which means ZERO direct qualifiers and a
 * league phase whose winner earns nothing but a seeding.
 */
export const CUP_LP_MAX_ADVANCE_BRACKETS = 1.5;

/**
 * Bracket-size bounds for the knockout the league phase feeds. The ceiling is
 * NOT a taste call -- it is the depth of CUP_KO_LEG_MATCHDAYS, which allots two
 * matchdays each to the quarter-final and semi-final plus one to the final. A
 * 16-slot bracket would need a whole round of legs the league calendar has no
 * room for.
 */
export const CUP_KO_MAX_SIZE = 8;
export const CUP_KO_MIN_SIZE = 4;

/** How a league-phase field of a given size splits into the knockout. */
export interface CupKnockoutPlan {
  /** Bracket slots (a power of two): 8 opens at the quarter-finals, 4 at the semis. */
  koSize: number;
  /** Top N of the table skip the playoff and take a bracket slot outright. */
  directQF: number;
  /** The next N contest the single-leg playoff for the bracket slots left over. */
  playoffTeams: number;
}

/**
 * How a league phase of `size` clubs splits three ways: CUP_LP_ADVANCE_FRACTION
 * of the field goes through, capped at CUP_LP_MAX_ADVANCE_BRACKETS brackets'
 * worth. The bracket is the biggest power of two inside that (capped at
 * CUP_KO_MAX_SIZE), and whatever the direct places don't fill is played for in
 * the playoff, two clubs per remaining slot -- so
 * `directQF = 2*koSize - advancing` and `playoffTeams = 2*(advancing - koSize)`.
 *
 * This replaced two fixed constants (4 direct, 8 playoff) applied to every field
 * whatever its size. Right for 24 and 32, and badly wrong below that: they put
 * TWELVE of a 16-club field through, six league-phase rounds to eliminate four
 * clubs. Both shipped competitions are unchanged (see the cap), so this is felt
 * only by a world someone builds themselves.
 *
 * Note BOTH ends are reachable and both are legal formats -- a field of 16
 * advances exactly a bracket's worth and plays no playoff at all. Callers must
 * handle a zero on either side; seedKnockoutFromLeaguePhase leaves `playoff`
 * null rather than building an empty round.
 *
 * Worked examples:
 *   12 -> SF bracket, 2 direct + 4 playoff =  6 of 12
 *   16 -> QF bracket, 8 direct + 0 playoff =  8 of 16
 *   20 -> QF bracket, 6 direct + 4 playoff = 10 of 20
 *   24 -> QF bracket, 4 direct + 8 playoff = 12 of 24   (the Shield, as shipped)
 *   32 -> QF bracket, 4 direct + 8 playoff = 12 of 32   (the Cup, as shipped)
 *   40 -> QF bracket, 4 direct + 8 playoff = 12 of 40
 */
export function cupKnockoutPlan(size: number): CupKnockoutPlan {
  // Rounded down to an even number: the playoff pairs its entrants off, so an
  // odd count can't be seeded, and every valid field size is a multiple of four
  // anyway (see isValidCupFieldSize) so the rounding never actually bites.
  const half = Math.floor(size * CUP_LP_ADVANCE_FRACTION);
  const wanted = Math.max(CUP_KO_MIN_SIZE, half - (half % 2));
  const koSize = Math.min(CUP_KO_MAX_SIZE, 2 ** Math.floor(Math.log2(wanted)));
  const advancing = Math.min(wanted, CUP_LP_MAX_ADVANCE_BRACKETS * koSize);
  return { koSize, directQF: 2 * koSize - advancing, playoffTeams: 2 * (advancing - koSize) };
}

/**
 * Smallest league-phase field worth running. Not a structural bound -- the draw
 * and cupKnockoutPlan both cope with 8 -- but a competition that eliminates two
 * clubs over six rounds isn't one, and holding the floor where it has always
 * been keeps which worlds get a cup at all unchanged.
 */
export const CUP_MIN_FIELD = 12;

/**
 * Whether the league-phase draw can actually build a schedule for a field of
 * this size. Three conditions, all structural rather than stylistic:
 *   - the field splits evenly into CUP_LEAGUE_PHASE_POTS pots;
 *   - each pot is itself even, because the intra-pot rounds are perfect
 *     matchings *within* a pot and an odd pot leaves a club unpaired;
 *   - a pot is big enough to supply the intra-pot opponents each club needs.
 * Plus CUP_MIN_FIELD clubs, so the competition is worth playing.
 *
 * The shipped world always produced 24 (and the Shield 16), so nothing ever
 * exercised this and drawLeaguePhase's own guard quietly omitted the even-pot
 * condition. Once a player can set a league's slot count, any total is
 * reachable — a 23-club field crashed the offseason outright.
 */
export function isValidCupFieldSize(size: number): boolean {
  const perPot = CUP_LEAGUE_PHASE_GAMES / CUP_LEAGUE_PHASE_POTS;
  const potSize = size / CUP_LEAGUE_PHASE_POTS;
  return (
    Number.isInteger(perPot)
    && Number.isInteger(potSize)
    && potSize % 2 === 0
    && potSize - 1 >= perPot
    && size >= CUP_MIN_FIELD
  );
}

/**
 * The biggest field the draw can build that is no larger than `total`, or 0 if
 * there aren't enough qualifiers for one at all. Qualifying trims to this by
 * dropping its lowest seeds, so a world that produces an awkward number of
 * qualifiers still gets a competition — just a slightly smaller one — instead
 * of throwing.
 */
export function largestValidCupField(total: number): number {
  for (let size = Math.floor(total); size >= 0; size--) {
    if (isValidCupFieldSize(size)) return size;
  }
  return 0;
}
/**
 * The knockout bracket a 24-club field feeds, kept as the name older code and
 * tests reach for. Derive a real cup's bracket with cupKnockoutPlan instead —
 * a smaller field gets a smaller one.
 */
export const CUP_KO_SIZE = cupKnockoutPlan(CUP_LEAGUE_PHASE_SIZE).koSize;

/** League matchday the single-leg playoff round is played on (before the quarter-finals). */
export const CUP_PLAYOFF_MATCHDAY = 27;

/** Prize for winning a playoff tie and reaching the quarter-finals. */
export const CUP_PRIZE_WIN_PLAYOFF = 3_000_000;

/**
 * Swiss-cup knockout matchdays for a **single-leg** cup (a pre-two-leg save
 * finishing under the old rules), indexed by knockout round
 * (0 = Quarter-final, 1 = Semi-final, 2 = Final). One matchday per round.
 */
export const CUP_KO_ROUND_MATCHDAYS = [31, 34, 37] as const;

/**
 * Swiss-cup knockout matchdays for a **two-legged** cup (all newly built cups),
 * indexed by knockout round then by leg. The quarter-final and semi-final are
 * two legs on separate matchdays (each club hosts once, decided on aggregate);
 * the final is a single leg. Second-leg matchdays line up with the single-leg
 * schedule above (31 / —, 37) so the run-in feels the same; the first legs slot
 * in ahead of them (QF 29→31, SF 33→35, Final 37).
 */
export const CUP_KO_LEG_MATCHDAYS: readonly (readonly number[])[] = [
  [29, 31], // Quarter-final: leg 1, leg 2
  [33, 35], // Semi-final: leg 1, leg 2
  [37],     // Final: single leg
];

/* ── Legacy straight-bracket cup (pre-Swiss saves only) ───────────────────────
 * Kept so a save that is mid-season with an old play-in/16-team cup finishes
 * cleanly. New cups built at the offseason use the Swiss format above. */

/** Legacy: league matchday the preliminary play-in round is played on. */
export const CUP_PLAYIN_MATCHDAY = 4;

/** Prize for winning a legacy play-in tie and reaching the main bracket. */
export const CUP_PRIZE_WIN_PLAYIN = 1_500_000;

/**
 * Legacy: league matchday each knockout round is played on, indexed by round
 * (0 = Round of 16, 1 = Quarter-final, 2 = Semi-final, 3 = Final). Spread
 * across the 38-matchday season so rounds don't crowd the run-in.
 */
export const CUP_ROUND_MATCHDAYS = [8, 16, 26, 34] as const;

/** Legacy number of knockout rounds (R16 → QF → SF → Final). */
export const CUP_ROUNDS = CUP_ROUND_MATCHDAYS.length;

/** Round index of the final — the round the user's sim halts before if their club is a finalist. */
export const CUP_FINAL_ROUND = CUP_ROUNDS - 1;

/* Prize money (£), credited to a club's budget as each stage is played and
 * clamped to MAX_BUDGET like any other income.
 *
 * **Qualifying is the biggest single payment, and that is the shape real
 * continental football has (2026-08-31).** These shipped "title-ish" — a
 * participation fee of £2M against £30M for lifting the trophy — which made a
 * six-game league-phase campaign against the best clubs in the world worth a
 * *tenth* of finishing fifth in your own division (PRIZE_TOP_5, £20M), and made
 * the whole competition a lottery ticket rather than the thing a club builds a
 * season around. Real football is the other way up: UEFA's starting fee is
 * roughly what reaching the final pays, so simply being there is transformative
 * and going deep is a bonus on top. So participation carries the weight, the
 * league phase pays per result, and the trophy prize comes down to meet them.
 *
 * **The champion's total is almost unchanged, and that is the point.** A club
 * that wins it from the playoff round banks ~£46M against the ~£48M the old
 * tiers paid — the money moved to the front rather than out of the competition.
 * What moved is the ratio that actually matters, participation against the
 * league's own prize tiers: a club that qualifies and goes out in the league
 * phase now banks £10.5-14.5M against PRIZE_TOP_5's £20M, real money for a season's
 * work, where £2M was a rounding error.
 *
 * **Deliberately NOT scaled by financeScale** (user call): UEFA pays a Belgian
 * club exactly what it pays an English one, and that flatness is the whole
 * reason European qualification matters more to a small club than a big one.
 * It is also the risk — a rich weak-league club climbing the strength ladder is
 * the documented tripwire — so any retune here must be measured with
 * scripts/weakLeaguesAudit.ts against the same script run on the merge base. */
export const CUP_PRIZE_PARTICIPATION = 10_000_000; // qualify for the league phase
export const CUP_PRIZE_LP_WIN = 1_500_000; // per league-phase win
export const CUP_PRIZE_LP_DRAW = 500_000; // per league-phase draw
export const CUP_PRIZE_WIN_R16 = 3_000_000; // advance to the quarter-final
export const CUP_PRIZE_WIN_QF = 6_000_000; // advance to the semi-final
export const CUP_PRIZE_WIN_SF = 9_000_000; // advance to the final
export const CUP_PRIZE_WIN_FINAL = 14_000_000; // lift the trophy
export const CUP_PRIZE_RUNNER_UP = 5_000_000; // lose the final

/** Legacy per-round prize for winning a tie in that round, indexed like CUP_ROUND_MATCHDAYS. */
export const CUP_PRIZE_WIN_BY_ROUND = [
  CUP_PRIZE_WIN_R16, CUP_PRIZE_WIN_QF, CUP_PRIZE_WIN_SF, CUP_PRIZE_WIN_FINAL,
] as const;

/**
 * Swiss-cup per-win prize, indexed by knockout round (0 = QF, 1 = SF, 2 = Final).
 * The Swiss knockout starts at the quarter-finals, so it reuses the QF/SF/Final
 * tiers; league-phase participation + playoff prizes are collected before it.
 */
export const CUP_KO_PRIZE_WIN_BY_ROUND = [
  CUP_PRIZE_WIN_QF, CUP_PRIZE_WIN_SF, CUP_PRIZE_WIN_FINAL,
] as const;

/* ── Competition formats ─────────────────────────────────────────────────────
 * Everything that differs between the continental competitions lives in one
 * table; every cup helper reads its numbers off the format its CupState names.
 * The structure (Swiss league phase → playoff → two-legged knockout), the
 * calendar and the draw are shared, because the fields are disjoint by
 * construction — a club qualifies for one competition or the other, never both,
 * so they can play on the same matchdays exactly as the real midweek calendar
 * does.
 * ──────────────────────────────────────────────────────────────────────── */

/** Which continental competition a cup is. Saves from before the split have none → "continental". */
export type CupCompetitionId = "continental" | "shield";

/** Prize money for one competition, in £, credited as each stage is played. */
export interface CupPrizes {
  /** Paid once, on entry to the league phase (or the legacy bracket). */
  participation: number;
  /** Per league-phase win. Zero on the legacy bracket, which has no league phase. */
  leaguePhaseWin: number;
  /** Per league-phase draw, to BOTH clubs. */
  leaguePhaseDraw: number;
  /** Winning a league-phase playoff tie and reaching the knockout. */
  playoffWin: number;
  /** Legacy format only: winning a preliminary play-in tie. */
  playInWin: number;
  /** Losing the final. */
  runnerUp: number;
  /** Swiss knockout per-win prize, indexed by round (0 = QF, 1 = SF, 2 = Final). */
  koByRound: readonly number[];
  /** Legacy bracket per-win prize, indexed by round (0 = R16 … 3 = Final). */
  legacyKoByRound: readonly number[];
}

export interface CupFormat {
  id: CupCompetitionId;
  /** Display name, stored on each CupState as it is built. */
  name: string;
  /** Places a strong (big-four, countryStrengthOffset 0) league earns. */
  strongSlots: number;
  /** Places a weak (offset > 0) league earns. */
  weakSlots: number;
  /**
   * Expected league-phase field size on the shipped 8-country world. Nothing in
   * src/ reads it (the draw and the split both work off the actual field
   * length) — it documents the expected size and anchors the cup tests. Must be
   * even and split into CUP_LEAGUE_PHASE_POTS pots of even size that each
   * exceed CUP_LEAGUE_PHASE_GAMES / CUP_LEAGUE_PHASE_POTS.
   */
  fieldSize: number;
  /**
   * Tag mixed into every one of this competition's rng streams. **Must be
   * unique per competition**: two cups played in the same season would
   * otherwise draw from identical streams round for round. The continental tag
   * is 30 because that is the literal its streams shipped with — changing it
   * would move every existing save's cup results.
   */
  streamTag: number;
  /** Seed for the league-phase draw. Unique per competition, for the same reason as streamTag. */
  drawSeed: number;
  prizes: CupPrizes;
}

/* ── Continental Shield (the second-tier continental competition) ────────────
 * Same structure and the same matchdays as the Continental Cup, one rung down
 * the league tables: a strong league's 5th and 6th, a weak league's 3rd and
 * 4th — 12 leagues × 2 = 24 clubs. Sharing the calendar is safe *because* the
 * fields are disjoint, and it is what the real midweek schedule does anyway.
 *
 * Unlike the Cup, the Shield takes the SAME number from every tier-1 league, so
 * its field is simply `countries × 2` and grows with every country added — 16
 * on the 8-country world, 20 on the 10-country one, 24 on the 12-country one.
 * That doubles the reason the country count must stay even: `2 × countries` is
 * only a multiple of 4 when it is.
 *
 * A 24-club field is legal in the shared draw and split: two pots of 12 (even,
 * and each larger than the 3 games per pot), and cupKnockoutPlan splits it 4
 * straight to the quarter-finals, 8 into the playoff and 12 out. So the Shield
 * needs no change to leaguePhase.ts at all.
 *
 * At 16 it would have split 4 / 8 / 4 — TWELVE of sixteen advancing, six rounds
 * to eliminate four clubs — which is what a field-blind split gets you and why
 * cupKnockoutPlan sizes the cut off the field. A world shrunk back below 12
 * countries now gets a cut in proportion instead.
 * ──────────────────────────────────────────────────────────────────────── */

export const SHIELD_NAME = "Continental Shield";

/** Places per tier-1 league — the two directly below that league's Continental Cup places. */
export const SHIELD_STRONG_LEAGUE_SLOTS = 2;
export const SHIELD_WEAK_LEAGUE_SLOTS = 2;

/** Field size on the shipped 12-country world: 12 tier-1 leagues × 2 = 24. See CupFormat.fieldSize. */
export const SHIELD_LEAGUE_PHASE_SIZE = 24;

/* Prize money (£). Sized at roughly 40% of the Continental Cup's, so a Shield
 * run is worth chasing without rivalling the Cup, and reshaped alongside it
 * (2026-08-31) so that qualifying — not the trophy — is the biggest single
 * payment here too. A champion nets ~£19M against the Cup's ~£47M.
 *
 * The relationship these were sized to hold is that finishing 5th and winning
 * the Shield must not out-earn finishing 4th and going out of the Cup's league
 * phase. **That was false as shipped and is merely closer now**: the Shield
 * champion took ~£21M against the Cup league-phase exit's £2M, because the
 * exit paid almost nothing. Front-loading both competitions narrows it to ~£20M
 * against ~£14M — still inverted, but a Shield title is now a deep run in a real
 * competition rather than a way to out-earn the Cup by losing six games in it.
 * Closing it completely would mean paying a Cup league-phase exit more than a
 * Shield champion, which is a separate call about how far apart the two
 * competitions should sit. */
export const SHIELD_PRIZE_PARTICIPATION = 4_000_000;
export const SHIELD_PRIZE_LP_WIN = 600_000;
export const SHIELD_PRIZE_LP_DRAW = 200_000;
export const SHIELD_PRIZE_WIN_PLAYOFF = 1_500_000;
export const SHIELD_PRIZE_WIN_QF = 2_500_000;
export const SHIELD_PRIZE_WIN_SF = 3_500_000;
export const SHIELD_PRIZE_WIN_FINAL = 5_500_000;
export const SHIELD_PRIZE_RUNNER_UP = 2_000_000;

/** Shield per-win knockout prize, indexed by round (0 = QF, 1 = SF, 2 = Final). */
export const SHIELD_KO_PRIZE_WIN_BY_ROUND = [
  SHIELD_PRIZE_WIN_QF, SHIELD_PRIZE_WIN_SF, SHIELD_PRIZE_WIN_FINAL,
] as const;

export const CUP_FORMATS: Record<CupCompetitionId, CupFormat> = {
  continental: {
    id: "continental",
    name: CUP_NAME,
    strongSlots: CUP_STRONG_LEAGUE_SLOTS,
    weakSlots: CUP_WEAK_LEAGUE_SLOTS,
    fieldSize: CUP_LEAGUE_PHASE_SIZE,
    streamTag: 30,
    drawSeed: 0x51533,
    prizes: {
      participation: CUP_PRIZE_PARTICIPATION,
      leaguePhaseWin: CUP_PRIZE_LP_WIN,
      leaguePhaseDraw: CUP_PRIZE_LP_DRAW,
      playoffWin: CUP_PRIZE_WIN_PLAYOFF,
      playInWin: CUP_PRIZE_WIN_PLAYIN,
      runnerUp: CUP_PRIZE_RUNNER_UP,
      koByRound: CUP_KO_PRIZE_WIN_BY_ROUND,
      legacyKoByRound: CUP_PRIZE_WIN_BY_ROUND,
    },
  },
  shield: {
    id: "shield",
    name: SHIELD_NAME,
    strongSlots: SHIELD_STRONG_LEAGUE_SLOTS,
    weakSlots: SHIELD_WEAK_LEAGUE_SLOTS,
    fieldSize: SHIELD_LEAGUE_PHASE_SIZE,
    // Distinct from the Cup's 30 / 0x51533: both competitions run in the same
    // season on the same matchdays, so shared streams would have the Shield
    // replaying the Cup's draws round for round.
    streamTag: 70,
    drawSeed: 0x5348_4C44, // "SHLD"
    prizes: {
      participation: SHIELD_PRIZE_PARTICIPATION,
      leaguePhaseWin: SHIELD_PRIZE_LP_WIN,
      leaguePhaseDraw: SHIELD_PRIZE_LP_DRAW,
      playoffWin: SHIELD_PRIZE_WIN_PLAYOFF,
      runnerUp: SHIELD_PRIZE_RUNNER_UP,
      koByRound: SHIELD_KO_PRIZE_WIN_BY_ROUND,
      // The legacy straight-bracket format predates the Shield, so no Shield
      // can ever be in one; these exist only to satisfy the shared shape.
      playInWin: SHIELD_PRIZE_WIN_PLAYOFF,
      legacyKoByRound: SHIELD_KO_PRIZE_WIN_BY_ROUND,
    },
  },
};

/**
 * The continental competitions in qualification order, best first. Each league's
 * places are handed down this list: the Continental Cup takes from the top of
 * every table, and the Shield starts exactly where the Cup stopped *in that same
 * league*.
 *
 * A competition's starting place is DERIVED by summing the slots of everything
 * above it (see cupOffsetForCompetition), rather than stored as a constant per
 * format. That is what makes the fields provably disjoint now that a league can
 * set its own slot counts (Competition.continentalSlots): a fixed offset would
 * silently overlap the two fields, or leave a gap, the moment a league's Cup
 * allocation differed from the shipped default. Insert a new competition here
 * and everything below it shifts down on its own.
 */
export const CONTINENTAL_ORDER: readonly CupCompetitionId[] = ["continental", "shield"];

/* ── Country coefficients ────────────────────────────────────────────────────
 * How many clubs a country sends to the Continental Cup is earned, not fixed:
 * each season the Cup's places are handed out in order of a rolling record of
 * how that country's clubs have actually done in Europe, exactly as UEFA's
 * association coefficient works. See core/cup/coefficients.ts.
 *
 * The reallocation is ZERO-SUM — it re-sorts the world's own multiset of slot
 * counts rather than choosing new ones — so none of these values can change how
 * many clubs the competition fields. That is a hard requirement, not a
 * nicety: the league-phase draw only accepts certain field sizes, so a
 * reallocation that changed the total would fail in the draw rather than here.
 * Tuning these therefore only ever changes WHICH countries sit where on the
 * ladder, which is the safe half of the problem.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Seasons of continental results that count toward a country's coefficient.
 *
 * Five, matching UEFA, and the length is the main thing keeping this stable: a
 * place should take years of sustained results to move, so one freak season
 * can't restructure the competition. Shortening it makes the ladder jumpy and
 * the weak leagues' finances lumpy along with it (their continental prize money
 * is a real share of their income — see the transfer-mobility notes).
 */
export const COEFFICIENT_WINDOW = 5;

/**
 * Seasons of continental results required before the coefficient is allowed to
 * move any places at all. Below this, the shipped strength-class allocation
 * stands.
 *
 * Measured, not guessed: with no floor, season 3 of a fresh save reallocated on
 * a SINGLE season of results and handed Belgium four places while dropping
 * Germany to two, which then reverted. A world's first cups are the noisiest
 * data it will ever have, and a place changing hands in year three for reasons
 * the player cannot see or predict reads as a bug rather than a mechanic.
 */
export const COEFFICIENT_MIN_SEASONS = 3;

/** League-phase result points, per club. */
export const COEFFICIENT_WIN_POINTS = 2;
export const COEFFICIENT_DRAW_POINTS = 1;

/** Points for winning a knockout or playoff tie. */
export const COEFFICIENT_TIE_WIN_POINTS = 2;

/**
 * Bonus for REACHING a knockout round, indexed by round (0 = quarter-final,
 * 1 = semi-final, 2 = final). Paid to both sides of the tie, since both got
 * there. Winning the competition pays COEFFICIENT_TITLE_BONUS on top.
 */
export const COEFFICIENT_ROUND_BONUS = [1, 1, 1] as const;

/** Bonus for actually winning the competition, so a champion outscores a runner-up. */
export const COEFFICIENT_TITLE_BONUS = 2;

/**
 * The fewest Continental Cup places any tier-1 league can be left with.
 *
 * A league reduced to zero places has no way to earn a coefficient and so no
 * way back up the ladder — a trapdoor rather than a demotion, and the sort of
 * one-way ratchet the rest of the sim is carefully built to avoid.
 */
export const COEFFICIENT_MIN_CUP_SLOTS = 1;



/** The Continental Cup's format — the default for every cup helper and every pre-split save. */
export const CONTINENTAL_CUP_FORMAT = CUP_FORMATS.continental;
/** The Continental Shield's format. */
export const SHIELD_FORMAT = CUP_FORMATS.shield;

/**
 * Extra time: a level tie after 90' plays this many shot-chances per side
 * (resolved with the same block→save→goal cascade as regulation) before a
 * penalty shootout decides a still-level tie.
 */
export const CUP_ET_CHANCES_PER_SIDE = 6;

/** Penalty shootout: standard best-of-CUP_PEN_BEST_OF, then sudden death. */
export const CUP_PEN_BEST_OF = 5;
/** Base per-kick conversion probability, nudged by taker finishing vs keeper. */
export const CUP_PEN_BASE_CONVERSION = 0.75;

/* ── Domestic cups ───────────────────────────────────────────────────────────
 * Every country runs its own knockout cup alongside its league, contested by
 * BOTH its divisions — so a tier-2 club can knock out a champion, and a tier-1
 * club can win a treble (league + domestic cup + Continental Cup).
 *
 * The field (40 clubs on a standard world) isn't a power of two, so the lowest
 * ranked clubs play a preliminary round to cut it to one: 16 of the 20 tier-2
 * clubs meet in eight preliminary ties, and the eight winners join the other 24
 * for a round of 32. Rounds are drawn OPEN — after each round the survivors go
 * back in the hat and the home side is drawn at random — which is what makes a
 * domestic cup a domestic cup, and is why the bracket can't be shown in advance.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * League matchdays the domestic cup rounds are played on, final last. A cup with
 * fewer rounds than this (a smaller world) takes the LAST n, so the final always
 * lands on the same matchday whatever the field size.
 *
 * Every one of these is clear of CUP_LEAGUE_PHASE_MATCHDAYS / CUP_PLAYOFF_MATCHDAY /
 * CUP_KO_LEG_MATCHDAYS, so no club is ever asked to play two cup ties on one
 * matchday, and clear of TRANSFER_DEADLINE_MATCHDAY and the season finale (38).
 * The final sits on 36, a matchday before the Continental Cup final on 37.
 */
export const DOMESTIC_CUP_MATCHDAYS = [5, 9, 13, 21, 26, 36] as const;

/**
 * Prize for winning a tie, indexed by how many rounds remain INCLUDING the one
 * won: [0] = lifting the trophy, [1] = winning a semi-final, and so on. Indexed
 * from the final backwards (never from round 0) so the same table is correct
 * whether a country's cup opens with a preliminary round or not — the same
 * reason cupRoundsFromFinal exists for the Continental Cup's run bonus.
 *
 * **All zero, deliberately, and this is a measured decision rather than a
 * placeholder.** The domestic cup shipped with real prize money first
 * (12M/4M/2M/1M/0.5M/0.25M, runner-up 3M, each multiplied by the club's
 * financeScale so a weak league could not out-earn a strong one). Measured with
 * `scripts/weakLeaguesAudit.ts`, 4 seeds x 20 seasons, against the same script
 * run on the merge base:
 *
 *   - the strength ladder held everywhere (per seed and on the 4-seed mean),
 *     so the financeScale scaling did its job;
 *   - but **2 of 4 seeds went into deficit** (Belgium -£0.5M season 20, Turkey
 *     -£1.4M season 19) where the baseline is solvent on all four.
 *
 * That is the exact result that got the need-buy tightening rejected (see
 * CLAUDE.md), and it is the documented failure shape: the finance column fails
 * first, not the ladder. Two mechanisms could produce it and this audit cannot
 * separate them — a one-off prize converted into a permanent wage liability
 * (both deficits land late, seasons 19-20), or plain stream shift, since
 * crediting a prize before the winter window moves every downstream AI market
 * decision and the weak leagues already run within ~£0.01M of zero at their
 * thinnest point.
 *
 * At zero the cup pays nothing, `creditPrizes` is never called, no club's budget
 * is touched, and a dynasty is therefore **bit-identical** to one without
 * domestic cups at all — which is what made shipping the competition itself
 * provably safe.
 *
 * ── Re-enabled 2026-08-31, at roughly a FIFTH of the numbers above ──────────
 *
 * **A real domestic cup is small money, and the rejected attempt was not.** The
 * whole FA Cup prize fund is ~£16M and winning the thing pays ~£3.9M, against a
 * Premier League title's merit payment of ~£60M — so a cup win is ~6% of a
 * league title, not the ~30% the old table's £12M implied against PRIZE_CHAMPION.
 * Sized on that ratio instead: a winner's run is **~£3.3M** and a country's whole
 * pot is **~£11.7M** before scaling, against the old ~£62M. The shape roughly
 * doubles per round, which is also the FA Cup's (£41k → £67.5k → £105k → £120k →
 * £225k → £450k → £1M → £2M).
 *
 * **What actually makes a cup run valuable here is NOT this table**, and that is
 * true to life: the winner takes a Continental Shield place (see
 * `allocateContinentalPlaces`), which is worth `SHIELD_PRIZE_PARTICIPATION` plus
 * a run at more — comfortably more than the trophy's own cheque. The prize money
 * is a supporting detail, so it is sized like one; anyone re-tuning it upward
 * should ask whether they actually want the *place* to be worth less by
 * comparison.
 *
 * **Scaled by COUNTRY but deliberately flat across TIERS** — see
 * `domesticCupScaleFor`, which is why this needs its own scale function rather
 * than `financeScaleFor`. A domestic cup is sold by domestic broadcasters, so
 * England's paying more than Serbia's is both realistic and the direction that
 * keeps the strength ladder safe (it is what the old attempt already got right).
 * But the FA Cup pays a fourth-tier club exactly what it pays Manchester City
 * for the same round, and that flatness is the entire financial romance of the
 * competition: this cup fields both divisions, so a second-division run is the
 * real-world case, and taxing it by `DIVISION_2_BUDGET_SCALE` would delete the
 * one thing worth modelling. Safe because `clampBudget` still caps a tier-2
 * club's savings at the full tier-scaled ceiling, so the money can be spent but
 * not hoarded, and `enforceDivision2Ceiling` sweeps a strong tier-2 squad
 * regardless of how it was paid for.
 */
export const DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL: readonly number[] = [
  1_500_000, // lift the trophy
  800_000, // win a semi-final
  500_000, // win a quarter-final
  300_000, // win a round-of-16 tie
  175_000, // win a round-of-32 tie
  90_000, // win a preliminary tie
];

/**
 * **Paid to the SMALLER club in any tie between the two divisions, win or lose
 * (2026-08-31, user call).** The prize table above is what a cup pays; this is
 * what a cup run is actually *worth* to a second-division club, and without it
 * the competition is a lottery — measured before it existed, the median tier-2
 * club that won anything took **0.3% of its season**, while the one or two who
 * won their cup outright took 20-27% via the Continental Shield place it earns.
 * One jackpot a year is not the same thing as lower-division clubs being able to
 * make money, which is what this competition is for.
 *
 * Modelled on the one real mechanism that does it: **gate receipts from a
 * glamour tie.** A lower-league club's cup payday in real football is not the
 * prize, it is drawing a giant — a full house, the television cameras, and it
 * pays whether they win or lose, which is why this is credited to both sides of
 * the result rather than to the winner.
 *
 * **Only the smaller club is paid, and that is deliberate rather than a
 * simplification.** A cup gate is a rounding error to a top-flight club, so
 * paying both sides would double the money entering the world to buy no
 * gameplay at all — and this world already runs its poorest leagues within
 * ~£0.01M of zero (see `DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL`'s audit note).
 * Targeting the payment is what lets it be large enough to matter.
 *
 * **Multiplied by how many divisions separate the two clubs**, which is the
 * whole reason it is a per-gap constant rather than a flat cheque (2026-09-01,
 * when the world gained a third division). A third-tier club drawing a top-flight
 * giant is the single most romantic tie the competition can produce, and paying
 * it the same as a second-tier club drawing the division immediately above would
 * price those two identically. A gap of one pays this; a gap of two pays double.
 * It also lands the money where it is worth most: `tierScale` is
 * `DIVISION_2_BUDGET_SCALE ** (tier - 1)`, so a third-tier club earns 36% of a
 * top-flight one, and the same cheque is proportionally about twice the season
 * to it that it is to a second-tier club.
 *
 * Country-scaled and tier-flat like every other domestic cup payment (see
 * `domesticCupScaleFor`). **A caveat worth keeping:** this game's lower divisions
 * earn 60% and 36% of their top flight where real football's third tier earns
 * ~1%, so a realistic cup cheque can never mean to these clubs what it means to a
 * real one. This lifts a decent run from ~0.3% of a season into the low single
 * digits — a signing, not a revolution — and going much beyond that starts
 * pricing the cup above the league places it sits beside.
 *
 * **Halved 600k -> 300k on 2026-09-02 because the first version FAILED the
 * ladder audit**: `Turkey→Greece` inverted on the 4-seed mean (-1.71 against a
 * -1 gate) where the baseline passes, negative on all four seeds, i.e. the
 * weaker-but-richer tripwire tripped by this feature's own money. Two candidate
 * mechanisms were measured and neither held (see CLAUDE.md), so magnitude is the
 * only lever established by evidence rather than by story. If a retune ever
 * wants this number back up, the thing to measure first is *why* one weak league
 * climbs and not another — not whether a bigger cheque still passes.
 *
 * **The halving cost the feature its headline result, which is the trade to know
 * before touching this again.** At 600k the money per earning club ran tier 1
 * 0.54M / tier 2 0.60M / tier 3 0.66M — the third division genuinely out-earned
 * the top flight. At 300k it reverses to roughly 0.50M / 0.39M / 0.37M. The
 * prize table rewards going deep (top-flight clubs) and this bonus rewards being
 * small; halving it handed the balance back to the prize table. So the shipped
 * state buys breadth — ~300 lower-division clubs earning something instead of one
 * lottery winner — but not tilt. Recovering the tilt means a *smaller prize
 * table at this glamour*, which is untested and needs its own 4-seed audit.
 */
export const DOMESTIC_CUP_GLAMOUR_TIE_BONUS = 300_000;

/**
 * The beaten finalist's cheque — the only losing side that is paid, matching the
 * Continental Cup. Below the trophy but above a semi-final win, so reaching the
 * final and losing it still beats going out one round earlier.
 */
export const DOMESTIC_CUP_PRIZE_RUNNER_UP = 700_000;

/**
 * Country -> the adjective its cup is named with ("England" -> "English Cup").
 * A country with no entry here falls back to "<Country> Cup", so a world with a
 * new country still names its cup sensibly without touching this table.
 */
export const COUNTRY_CUP_ADJECTIVE: Readonly<Record<string, string>> = {
  England: "English",
  Spain: "Spanish",
  Italy: "Italian",
  Germany: "German",
  France: "French",
  Portugal: "Portuguese",
  Belgium: "Belgian",
  Turkey: "Turkish",
  Netherlands: "Dutch",
  Greece: "Greek",
  Scotland: "Scottish",
  Serbia: "Serbian",
};

/**
 * Match Rating (average) leaderboard qualifier. An average over one or two
 * games is noise — a single standout cameo would otherwise top the chart — so
 * a player must have appeared in at least this fraction of the games *played so
 * far* to show up. Scaling to games-played (not a flat count) keeps the board
 * honest ten games into a season as well as at the end of a full 38-match one.
 * Counting/total stats (goals, assists, etc.) have no such gate.
 */
export const RATING_LEADER_QUALIFY_FRACTION = 1 / 2;
/**
 * Flat appearance floor for the *career-aggregate* Match Rating board (the
 * "All Seasons → Career" scope), which spans many seasons and has no single
 * games-played denominator to take a fraction of.
 */
export const RATING_LEADER_MIN_CAREER_APPEARANCES = 10;
/**
 * Flat appearance floor for the *single-season* Match Rating board on
 * Frivolities' all-time leaders (see core/frivolities/leaders.ts).
 *
 * A flat count rather than `RATING_LEADER_QUALIFY_FRACTION` of games played,
 * because those boards rank completed seasons from every competition at once
 * and an archived retiree carries his appearance count but no record of how
 * many matches his league played that year. Set at roughly half a typical
 * 38-match season, matching what the fraction would give on a full one.
 */
export const RATING_LEADER_MIN_SEASON_APPEARANCES = 19;
/**
 * Minutes floor for the Stat Leaders board's **Per 90** mode, as a fraction of
 * the minutes available across the matches played so far (fraction × 90 ×
 * matches played).
 *
 * Same purpose as `RATING_LEADER_QUALIFY_FRACTION` and a sharper case of it: a
 * rate stat lets a tiny sample top the board forever (a substitute who scores
 * in a 12-minute cameo reads 7.5 goals/90 and is unbeatable), so a per-90 board
 * is only meaningful behind a playing-time gate. Keyed off *minutes* rather
 * than appearances because minutes are exactly what the rate divides by — an
 * appearance floor would still admit a player with twenty of them off the bench.
 *
 * 0.3 follows the usual convention for real-world rate leaderboards (roughly
 * 30% of a side's available minutes) and is deliberately looser than the Match
 * Rating gate's 1/2, since a squad player's rate is a legitimate thing to rank
 * where his season average is not.
 */
export const PER90_QUALIFY_FRACTION = 0.3;

/* ── International football ───────────────────────────────────────────────────
 * A national-team competition run entirely inside the offseason, on a two-year
 * cycle: every odd season's offseason plays a qualifying campaign, and every
 * even season's offseason plays the tournament its qualifiers earned a place in.
 * Nothing here touches the club calendar — see src/core/international/.
 */

/** Display name of the international tournament. */
export const INTL_TOURNAMENT_NAME = "World Cup";

/**
 * The World Cup runs on a four-year cycle: three qualifying offseasons then the
 * tournament. `INTL_QUAL_LEGS` (below) legs of the qualifying round-robin map
 * one-to-one onto those three offseasons, and the cycle length is one more than
 * that (the extra year being the tournament). A tournament offseason is every
 * `INTL_CYCLE_YEARS`th season; the three seasons before it each play one leg.
 */
export const INTL_CYCLE_YEARS = 4;

/** True in the offseason that stages the World Cup (every fourth season). */
export function isTournamentSeason(season: number): boolean {
  return season % INTL_CYCLE_YEARS === 0;
}

/**
 * Which qualifying leg (0-based) a season's offseason plays, or -1 if that
 * offseason stages the tournament instead. Over the cycle: season%4 ==
 * 1 → leg 0 (a fresh campaign starts), 2 → leg 1, 3 → leg 2 (the campaign
 * finishes and its INTL_FIELD_SIZE qualifiers are locked in), 0 → the
 * tournament.
 */
export function qualifyingLeg(season: number): number {
  return isTournamentSeason(season) ? -1 : (season % INTL_CYCLE_YEARS) - 1;
}

/** True in any of the three qualifying offseasons of the cycle. */
export function isQualifyingSeason(season: number): boolean {
  return qualifyingLeg(season) >= 0;
}

/**
 * How many nations reach the tournament. 32 splits into INTL_GROUPS groups of
 * INTL_GROUP_SIZE, whose top INTL_QUALIFY_PER_GROUP feed a sixteen-nation
 * bracket (round of 16, quarters, semis, final) built out of the Continental
 * Cup's seedOrder/resolveCupTie machinery, which is size-agnostic.
 *
 * Raised from 16 on 2026-08-23, once the world reached 16 competitions. The
 * binding constraint is nationality depth, not club count: 44 of the 78
 * nationalities present clear INTL_MIN_POOL on a fresh world (measured, stable
 * across seeds), and squad rating runs ~76 at the strongest nation, ~70 at
 * #16, ~64 at #32 and then falls off a cliff to ~56 by #40. So 32 is close to
 * the largest field this world can fill with nations that are actually worth
 * watching — a 40-team field would be padded with makeweights.
 *
 * The cost, accepted deliberately: qualifying has far less at stake. At a
 * 16-place field 28 of the 44 eligible nations could miss out; at 32 just 12
 * can. South America (4 eligible), Asia (1) and North America (1) now qualify
 * their whole membership automatically, joining Asia and North America which
 * already did at 16 — a confederation with no more nations than places plays no
 * qualifying matches at all (see initQualifying). Only Europe (19 of 26) and
 * Africa (7 of 12) contest anything. Deepening that tail means more league
 * countries feeding more nationality pools, not a lower INTL_MIN_POOL: dropping
 * the floor to 15 adds only about five nations and all of them rate below 56.
 */
export const INTL_FIELD_SIZE = 32;
export const INTL_GROUPS = 8;
export const INTL_GROUP_SIZE = 4;
export const INTL_QUALIFY_PER_GROUP = 2;
export const INTL_KO_SIZE = INTL_GROUPS * INTL_QUALIFY_PER_GROUP;

/** Squad size a nation names for a campaign (senior players only — no academy call-ups). */
export const INTL_SQUAD_SIZE = 23;

/**
 * A nation enters qualifying only if the world contains at least this many of
 * its players, including at least INTL_MIN_KEEPERS goalkeeper. The keeper floor
 * is not cosmetic: selectXI fills a GK slot with an outfielder when no keeper is
 * available, which leaves the keeping composite at its neutral default while
 * still counting the player as an attacker — a silently corrupted match sim.
 * At the shipped world size (320 clubs, 8000 players) 44 of the 78 nations
 * present clear this bar — measured, identical on three seeds — which fills
 * INTL_FIELD_SIZE's 32 places with twelve to spare. Lowering the floor is a
 * poor way to widen the field: the nations just under it hold 15-18 players
 * and rate below 56, well beneath the ~64 of the current #32.
 */
export const INTL_MIN_POOL = 18;
export const INTL_MIN_KEEPERS = 1;

/**
 * Target nations per qualifying group. Group counts are derived from this
 * (see planQualifying) rather than fixed, because a confederation's eligible
 * count moves with the save's generated nationality spread.
 */
export const INTL_QUAL_GROUP_TARGET = 5;

/**
 * Legs of the qualifying round-robin — now three, one played in each of the
 * cycle's three qualifying offseasons (see INTL_CYCLE_YEARS). A single
 * round-robin left a five-nation group turning on four games, noisy enough that
 * strong nations regularly missed out; spreading three legs across three
 * offseasons gives a long, low-variance campaign (each pair meets three times)
 * that reads like real World Cup qualifying. The tournament's own groups stay
 * single-leg — that variance is the point of a tournament.
 */
export const INTL_QUAL_LEGS = 3;

/**
 * How many games of recovery an international injury is credited for having
 * already served over the summer break, before the new club season starts. A
 * tournament is played weeks ahead of kickoff, so a short knock heals in time
 * (it never carries) and only a more serious injury still sidelines the player
 * into the new season, at a reduced remaining spell. Subtracted from the rolled
 * INJURY_GAMES duration; if it lands at zero or below, the player is fit by the
 * opening day. Tunable — raise it to make carried injuries rarer/shorter.
 */
export const INTL_INJURY_OFFSEASON_RECOVERY = 2;

/**
 * Confederation cups (the Euro, Copa America, AFCON and their unlisted
 * siblings — see core/international/confederations.ts).
 *
 * Cadence: they are played in the offseason of the cycle's *middle* qualifying
 * season, which is exactly the real Euro/Copa offset from a World Cup — two
 * years either side of it. That offseason therefore plays a qualifying leg
 * *and* a confederation cup, rather than the tournament replacing the leg.
 * That was deliberate: dropping INTL_QUAL_LEGS from 3 to 2 to make room would
 * reopen the qualifying variance those three legs exist to damp (see
 * INTL_QUAL_LEGS), and adding a whole second qualifying campaign for the
 * confederation cups would roughly double the ~280 fixtures qualifying already plays.
 */
export function isConfederationCupSeason(season: number): boolean {
  return qualifyingLeg(season) === CONFEDERATION_CUP_QUALIFYING_LEG;
}

/**
 * Which qualifying leg the confederation cups share their offseason
 * with. Leg 1 of 3 is the middle of the cycle: with a World Cup at season%4==0,
 * the confederation cups land on season%4==2.
 */
export const CONFEDERATION_CUP_QUALIFYING_LEG = 1;

/**
 * Fewest nations a confederation needs before it holds a championship at all.
 * Below four there is no tournament worth the name — the smallest supported
 * format is a single round-robin whose top two contest a final.
 *
 * This gate is why the feature ships six tournaments but a default world only
 * *plays* three. Every player is generated from the nationality table of one of
 * the eight European leagues, so non-European nations exist only as imports:
 * measured on a fresh world, Europe fields 25 eligible nations and Africa 12,
 * but South America manages 5, and Asia, North America and Oceania one or none
 * between them. The Asian Cup, Gold Cup and OFC Nations Cup are therefore
 * defined and dark, and light up on their own if a world ever supports them —
 * an imported roster, or a non-European league added to worldCompetitions.
 */
export const CONFEDERATION_CUP_MIN_NATIONS = 4;


/**
 * GOAT rankings (`core/frivolities/goat.ts`) — a **first-draft** formula, and
 * explicitly a matter of taste rather than a measured quantity. Every weight
 * here is meant to be argued with; none of it feeds the sim.
 *
 * Scaled so a genuinely all-time career lands around 1200-1400 and a good
 * top-flight regular around 100-200, which keeps the numbers readable without
 * needing a normalization pass.
 *
 * The shape of the argument:
 * - **Peak** says how good you were at your best, **prime** how long you stayed
 *   there. Prime is weighted to out-earn peak over a long career, because the
 *   thing that separates a GOAT from a one-season wonder is duration at a
 *   level, not the single highest number he ever hit.
 * - **Honours carry roughly half the score.** They're the game's own verdict on
 *   a season, already blending production, rating and team success.
 * - **Production (goals/assists) is weighted deliberately low.** It's the main
 *   source of positional bias and it double-counts with the awards it wins.
 *
 * **Known bias, partly addressed:** the Ballon d'Or and POTY are structurally
 * striker awards (see the world-awards notes above — `potyScore` carries no
 * defensive stats at all), so a GOAT list built on them tilts toward attackers.
 * The position-fair counterweights are the Team of the Season and World Team of
 * the Year terms, which are selected into fixed positional slots, which is why
 * they're weighted more generously per selection than their rarity alone
 * justifies — and, since 2026-08-24, the Goalkeeper of the Year and Defender of
 * the Year weights below, which are the first honours on this board a keeper or
 * a centre-back can win outright rather than take a slot in.
 *
 * What that does NOT do is make the board positionally *equal*, and it should
 * not: a forward can still win the Ballon d'Or on top of everything a defender
 * can win, so the ceiling stays higher for attackers. The claim is only that a
 * great keeper now has a case at all, where before he had a maximum annual
 * haul of a World XI slot plus a Team of the Season slot.
 */
export const GOAT_OVR_BASELINE = 70;
export const GOAT_PEAK_WEIGHT = 6;
export const GOAT_PRIME_WEIGHT = 1.5;
export const GOAT_LONGEVITY_WEIGHT = 4;
/** Sustained match rating above the 6.0 baseline, damped until he has a real sample. */
export const GOAT_RATING_WEIGHT = 40;
export const GOAT_RATING_FULL_SAMPLE = 150;
export const GOAT_BALLON_DOR_WEIGHT = 60;
export const GOAT_WORLD_XI_WEIGHT = 22;
export const GOAT_POTY_WEIGHT = 25;
export const GOAT_GOLDEN_BOOT_WEIGHT = 15;
export const GOAT_TOTS_WEIGHT = 10;
/**
 * Goalkeeper of the Year / Defender of the Year — one worldwide winner each per
 * season, scored on the defensive-aware formula (see the block above).
 *
 * Priced between the Player of the Season (25) and the Ballon d'Or (60), and
 * the reasoning for landing there rather than either side of it:
 *
 * - **Above POTY and the World XI**, because it is a *worldwide* honour with
 *   exactly one winner a season, where a Player of the Season is handed out
 *   once per competition (sixteen a season) and a World XI place is one of
 *   eleven.
 * - **Below the Ballon d'Or**, because that award is open to the entire world
 *   and these are drawn from one position group. Winning the field is a bigger
 *   claim than winning your corner of it, and pricing them level would say a
 *   dominant keeper had the same season as the best player alive.
 *
 * Note these overlap heavily with the World XI term by construction: both are
 * scored on the same number, so the Goalkeeper of the Year is nearly always
 * also the XI's keeper and collects both. That double-count is intentional —
 * it is the same double-count a Ballon d'Or winner already gets for taking a
 * World XI slot on top of the main award.
 */
export const GOAT_GOALKEEPER_AWARD_WEIGHT = 40;
export const GOAT_DEFENDER_AWARD_WEIGHT = 40;
export const GOAT_LEAGUE_TITLE_WEIGHT = 12;
export const GOAT_CUP_TITLE_WEIGHT = 25;
/**
 * A Continental Shield title, worth well under a Continental Cup one and under
 * a league title too — it is the trophy you win by not being good enough for
 * the Cup, so it should round out a case rather than make one.
 */
export const GOAT_SHIELD_TITLE_WEIGHT = 8;
/**
 * A domestic cup, deliberately the cheapest trophy on the board: it's a knockout
 * a club can win in six games without being any good over a season, which is
 * exactly what makes it fun and exactly why it shouldn't build a GOAT case.
 * Below a league title (12) for that reason.
 */
export const GOAT_DOMESTIC_CUP_TITLE_WEIGHT = 6;
export const GOAT_WORLD_CUP_WEIGHT = 50;
export const GOAT_CAP_WEIGHT = 0.3;
export const GOAT_GOAL_WEIGHT = 0.15;
export const GOAT_ASSIST_WEIGHT = 0.1;

/**
 * Club GOAT weights. Same first-draft caveat as the player formula above.
 *
 * Trophies dominate, because a club's case really is its cabinet. The
 * points-per-game term is what separates two clubs on equal trophy counts: it
 * rewards being *consistently* strong rather than winning a title and vanishing,
 * and it's measured against a mid-table baseline so ordinary seasons contribute
 * nothing either way. Second-tier seasons count for less on that term (and a
 * second-tier title counts for much less than a top-flight one) so a club can't
 * build a GOAT case by dominating a division it shouldn't be in.
 */
export const GOAT_TEAM_LEAGUE_TITLE_WEIGHT = 100;
export const GOAT_TEAM_CUP_TITLE_WEIGHT = 150;
/**
 * A Shield title on a club's board: above a second-tier title, well below a
 * league title, and nowhere near a Continental Cup. Same reasoning as the
 * second-tier weight — a club shouldn't build a GOAT case out of a competition
 * it only entered by missing out on the better one.
 */
export const GOAT_TEAM_SHIELD_TITLE_WEIGHT = 40;
/** Same reasoning as the player weight: a fine trophy, a weak argument. */
export const GOAT_TEAM_DOMESTIC_CUP_TITLE_WEIGHT = 40;
/**
 * A treble, on top of the three trophies that make it up.
 *
 * Those already score 100 + 150 + 40 = 290 on their own, so this is a **bonus
 * for doing all three at once**, not the value of the achievement — sized to
 * match the most valuable single trophy in the game, which makes a treble
 * season worth about 1.5x the sum of its parts. Big enough that one changes a
 * club's case, not so big that it out-argues the trophies it is built from.
 *
 * Being a bonus is the difference from the Frivolities trophy cabinet, where
 * trebles are deliberately kept out of the total-trophies column: that column
 * counts trophies, and a treble is not a fourth one. This is a score, and
 * scoring a rare combination above its parts is the whole point of a GOAT
 * formula.
 */
export const GOAT_TEAM_TREBLE_WEIGHT = 150;
export const GOAT_TEAM_SECOND_TIER_TITLE_WEIGHT = 20;
export const GOAT_TEAM_TOP_FINISH_WEIGHT = 15;
/** A finishing position this good or better counts as contending. */
export const GOAT_TEAM_TOP_FINISH_POSITION = 4;
export const GOAT_TEAM_SEASON_WEIGHT = 3;
export const GOAT_TEAM_PPG_BASELINE = 1.4;
export const GOAT_TEAM_PPG_WEIGHT = 20;
/** Tier-2 seasons contribute this fraction of their points-per-game surplus. */
export const GOAT_TEAM_SECOND_TIER_SCALE = 0.5;

// ---------------------------------------------------------------------------
// Manager career: board confidence, sackings, and job offers
// (see src/core/manager/). All of this is offseason-only and touches no player
// ratings, valuations or rng draws — it decides *which club the user owns*, not
// anything about the world the clubs live in.
// ---------------------------------------------------------------------------

/**
 * Board confidence a manager starts a new job on, 0-100. A honeymoon rather
 * than a neutral 50: a board that has just appointed you believes in you, which
 * is what buys a first-season rebuild the room it needs.
 */
export const MANAGER_START_CONFIDENCE = 65;
/**
 * Confidence swing for finishing a *whole division's worth* of places away from
 * where the squad said you should.
 *
 * **Sized against measured variance, not intuition** (`scripts/managerTenureProbe.ts`,
 * 2552 club-seasons). An ordinary season lands within ±0.158 of a division
 * (p25-p75, so about ±3 places in a 20-club league) and a bad one around -0.368
 * (p10). At the first-guess 130 a single p10 season cost ~68 confidence against a
 * starting 65, i.e. one bottom-decile year very nearly ended a career, and normal
 * difficulty sacked a manager every 8 seasons. At 70 it takes two p10 seasons
 * back to back, or about six straight below-median ones, which is the intent.
 */
export const MANAGER_CONFIDENCE_SWING = 70;
/**
 * How far confidence drifts back toward `MANAGER_START_CONFIDENCE` each season,
 * as a fraction of the gap, applied before the season's verdict.
 *
 * Boards forget. Without this, confidence only ever moves on over- or
 * underperformance, so a manager sitting at 20 who then finishes *exactly* to
 * expectation every year stays at 20 forever, permanently one bad season from
 * the sack with no way back. It cuts both ways deliberately: a long-banked 100
 * also decays, so a title six years ago stops being a shield.
 */
export const MANAGER_CONFIDENCE_RECOVERY = 0.12;
/** Winning your division, on top of whatever the finish itself was worth. */
export const MANAGER_TITLE_CONFIDENCE = 30;
/** Any other trophy: a domestic cup, the shield, the Continental Cup. */
export const MANAGER_TROPHY_CONFIDENCE = 12;
/**
 * Relegation, on top of the finish. Deliberately brutal and deliberately *not*
 * an automatic sacking: a manager who went down having overachieved all the way
 * to the drop can still have banked enough goodwill to get another year, which
 * is the kind of judgement call a flat "relegated = fired" rule can't make.
 */
export const MANAGER_RELEGATION_CONFIDENCE = -35;
/** Promotion, on top of the finish (and on top of the tier-2 title, if you won it). */
export const MANAGER_PROMOTION_CONFIDENCE = 20;
/**
 * How much more harshly the most demanding board punishes a bad season: a
 * demand of 1.0 multiplies the drop by 1 + this. The reward side is damped
 * instead (below), because the asymmetry *is* the difficulty — a superclub
 * board treats winning as the baseline and losing as a crisis.
 */
export const MANAGER_DEMAND_PENALTY_SCALE = 0.85;
/** How much of a good season's credit the most demanding board withholds. */
export const MANAGER_DEMAND_REWARD_DAMPING = 0.45;
/**
 * How board demand splits between "how big is this club within its own league"
 * and "how strong is that league in world terms". Both matter and neither alone
 * is right: the biggest club in Turkey's second tier is a demanding job in its
 * own small world, but it is not the Bernabéu.
 */
export const MANAGER_DEMAND_W_CLUB = 0.6;
export const MANAGER_DEMAND_W_LEAGUE = 0.4;
/**
 * Seasons at a club before the board will sack you. One: you always get a full
 * second season, so inheriting a mess in the summer can't end your job before
 * you've had a transfer window of your own.
 */
export const MANAGER_GRACE_SEASONS = 1;

/**
 * How the board's expectation of a club is built — see core/manager/expectation.ts.
 *
 * **Squad quality is deliberately absent.** Grading a manager on the squad they
 * assembled grades them on the one variable they fully control: tear the team
 * down and the bar drops with it, so finishing next-to-last with a wrecked squad
 * scores as beating expectations. Standing is therefore read off what a transfer
 * window cannot touch — where the club has recently finished, how famous it is,
 * and how much money it holds. Squad rating survives only as the season-1
 * fallback, weighted out as real results accumulate, and that is the squad the
 * manager was handed rather than one they built.
 */
/** How many recent seasons of finishes feed the expectation. */
export const MANAGER_EXPECTATION_HISTORY_SEASONS = 3;
/** Weight of each older season relative to the one after it. */
export const MANAGER_EXPECTATION_SEASON_DECAY = 0.6;
/**
 * Recent finishes dominate: they are the most direct statement of what this club
 * is, and unlike fame or cash they cannot be moved at all by a transfer window.
 */
export const MANAGER_EXPECTATION_W_HISTORY = 0.7;
/**
 * Fame is the only other input, and it is here because it is the one measure of
 * club size that **no transfer can move at all**. It follows results and moves
 * slowly, so it captures "this is a big club" without ever handing the manager a
 * lever on their own target.
 */
export const MANAGER_EXPECTATION_W_HYPE = 0.3;
/*
 * There is deliberately **no money term**, and two attempts at one are why.
 *
 * Bank balance alone is actively backwards: spending the transfer kitty is the
 * normal thing a manager does, and emptying the balance *lowered* the bar,
 * measured at six places easier on a mid-table top-flight club while fielding a
 * stronger squad for it. Balance plus wage bill fixes buying and selling (each
 * just moves value between the two halves) but not releasing: let players go for
 * nothing and the wage bill falls with no fee arriving, so a determined teardown
 * still drags the target down. That one is self-harming rather than free, but
 * self-harming is not the same as impossible, and this model exists precisely so
 * that no sequence of transfer decisions can move the bar.
 *
 * Recent finishes and fame have no such channel, so they carry the whole weight.
 * The cost is that a suddenly-rich club is not expected to improve until it
 * actually does, which is the right way round for a board that judges results.
 */
/**
 * Where the two divisions meet on one world-comparable scale: a second-division
 * title and a last-place top-flight finish are both worth exactly this.
 *
 * That seam is the point, and getting it one-directional was a real bug. Scaling
 * tier 2 down while leaving tier 1 untouched puts a bottom-of-the-top-flight
 * percentile (~0) *below* a mid-table second-division one (0.5 x 0.35), so a
 * club relegated after years of struggle was expected to finish 16th of 20 in
 * the division it dropped into — and banked confidence for finishing mid-table
 * with a squad that should have walked it. Tier 1 now spans [seam, 1] and tier 2
 * spans [0, seam], which is what makes promotion and relegation continuous.
 */
export const MANAGER_EXPECTATION_TIER_SEAM = 0.35;

/** Confidence at or below this and you're gone. */
export const MANAGER_SACK_THRESHOLD = 0;

/**
 * Confidence below this reads as "on thin ice" in the UI — purely a label
 * boundary, the sacking rule is the threshold above.
 */
export const MANAGER_CONFIDENCE_DANGER = 25;
/** Confidence below this reads as "under pressure". */
export const MANAGER_CONFIDENCE_UNEASY = 50;

/** Most job offers on the table at once. */
export const MANAGER_MAX_OFFERS = 4;
/**
 * How far from the job your reputation says you deserve a club can be and still
 * come calling, on the [0,1] prestige scale. Wide enough that a good season at a
 * mid-table club opens real doors, narrow enough that Europe's biggest club
 * doesn't ring an unproven manager.
 */
export const MANAGER_OFFER_BAND = 0.2;
/**
 * How far *below* your current club a job can be and still count as a step
 * worth hearing about, on the same [0,1] prestige scale.
 *
 * Without it the step-up filter is `prestige >= currentPrestige`, which exactly
 * one club in the world can never satisfy — prestige is min-max normalized, so
 * the biggest club sits at 1.000 and its manager is offered nothing, forever,
 * however decorated they are. A small allowance turns that into "your peers can
 * come calling", which is how the top of real football works. Sized to reach
 * roughly the top dozen clubs from the summit; wider and a superclub manager
 * starts being offered mid-table jobs.
 */
export const MANAGER_OFFER_LATERAL_BAND = 0.05;
/** Chance a matching club comes calling after an ordinary season. */
export const MANAGER_OFFER_BASE_CHANCE = 0.22;
/** How much a season spent beating expectation raises that chance. */
export const MANAGER_OFFER_FORM_WEIGHT = 0.9;
export const MANAGER_OFFER_MAX_CHANCE = 0.8;
/**
 * How far down the prestige scale a sacking knocks you. Applied to the band
 * offers are drawn from when you're dismissed, so the clubs that will take you
 * are a step below the one that just let you go.
 */
export const MANAGER_SACKED_PRESTIGE_PENALTY = 0.18;

/** Reputation a manager starts a career on, before any results, 0-100. */
export const MANAGER_REP_BASE = 30;
export const MANAGER_REP_TITLE_WEIGHT = 13;
export const MANAGER_REP_TROPHY_WEIGHT = 6;
/** Per unit of cumulative finish-versus-expectation across the whole career. */
export const MANAGER_REP_OVERPERFORMANCE_WEIGHT = 9;
export const MANAGER_REP_SEASON_WEIGHT = 0.8;
/** Seasons past this stop adding experience credit — longevity isn't a career on its own. */
export const MANAGER_REP_SEASON_CAP = 15;
export const MANAGER_REP_SACKING_PENALTY = 8;

// --- National team management -------------------------------------------
//
// The federation's counterpart to the club board above. Deliberately a second
// set of constants rather than a reuse of the MANAGER_* block: the two jobs are
// judged on different things at different cadences (a club board rules once a
// season, a federation once per campaign, which is three times in a four-year
// cycle at most), and folding them together would mean a club-side retune
// silently moving who gets sacked by their country. Same argument, and the same
// answer, as WORLD_AWARD_OVR_WEIGHT next to AWARD_OVR_WEIGHT.

/** Federation confidence a new appointment starts on, 0-100. */
export const NATIONAL_START_CONFIDENCE = 65;

/**
 * How far confidence moves for a whole field's worth of over- or
 * underachievement — the national twin of MANAGER_CONFIDENCE_SWING.
 *
 * Lower than the club figure (70) on purpose. A federation judges roughly three
 * times per four-year cycle where a board judges four times, but the *spread* of
 * a tournament result is far wider than a league finish: a 32-nation field means
 * one bad draw can cost a favourite two thirds of the field in placement terms,
 * where a league season regresses to the squad over 38 games. At the club swing
 * a single group-stage exit would end most reigns outright.
 */
export const NATIONAL_CONFIDENCE_SWING = 46;

/** Confidence drifts this far back toward NATIONAL_START_CONFIDENCE per verdict. */
export const NATIONAL_CONFIDENCE_RECOVERY = 0.1;

/** Winning the World Cup. The one unambiguous triumph in international football. */
export const NATIONAL_TITLE_CONFIDENCE = 40;
/** Winning your confederation's championship (the Euro, Copa América, AFCON…). */
export const NATIONAL_CONTINENTAL_CONFIDENCE = 22;
/**
 * Reaching the World Cup finals at all. Flat, not scaled by demand: qualifying
 * is the job for most of the world, and damping it toward nothing for a strong
 * nation would leave the campaign that decides your whole cycle worth nothing.
 */
export const NATIONAL_QUALIFICATION_CONFIDENCE = 14;
/** Missing out. The single worst thing that can happen to an international manager. */
export const NATIONAL_MISSED_QUALIFICATION_CONFIDENCE = -22;

/** A demanding federation amplifies failure and damps success, exactly as a big club's board does. */
export const NATIONAL_DEMAND_PENALTY_SCALE = 0.8;
export const NATIONAL_DEMAND_REWARD_DAMPING = 0.45;

/**
 * Campaigns you must have seen through before the federation can dismiss you.
 * Two rather than the club board's one: a cycle's first campaign is qualifying,
 * and being sacked before you have managed a single tournament is no test at all.
 */
export const NATIONAL_GRACE_CAMPAIGNS = 2;
/** Confidence at or below this ends the appointment. */
export const NATIONAL_SACK_THRESHOLD = 0;

/** How many nations will approach you at once. */
export const NATIONAL_MAX_OFFERS = 4;
/** How far from your reputation a nation can sit and still come calling, [0,1]. */
export const NATIONAL_OFFER_BAND = 0.25;
/**
 * How far below your current nation a job can sit and still be worth hearing
 * about, [0,1]. The club side's `MANAGER_OFFER_LATERAL_BAND` word for word, and
 * for the same reason: the strongest nation in the world sits at prestige 1.000
 * and a strict step-up filter leaves its manager permanently unapproached.
 *
 * Wider than the club value because national prestige is read off *rank* rather
 * than rating, so it is spread evenly over ~44 nations — a step of one place is
 * about 0.023, and 0.05 would reach barely two of them.
 */
export const NATIONAL_OFFER_LATERAL_BAND = 0.08;
/**
 * How much of a manager's CLUB reputation federations can see, as a fraction.
 *
 * International reputation starts at `NATIONAL_REP_BASE` and the only way to
 * raise it is to hold a national job, so without this a manager who has never
 * held one is pinned at 30 forever — and on a real 70-nation world the best
 * country the band could then reach was **rank 33**. The top five were
 * structurally unreachable no matter how decorated the club career, which is
 * not how the crossover works in real football.
 *
 * Swept against what is ACTUALLY OFFERED on the real 70-nation world rather
 * than against the band arithmetic, because the two disagree and the arithmetic
 * is the optimistic one: the band's ceiling at a target of `t` is `t + BAND`,
 * but `pool.slice(0, NATIONAL_MAX_OFFERS * 4)` then keeps only the 16 nations
 * *closest to the target*, so the top of the band is truncated away. At weight
 * 0.5 the band reaches rank 18 and the best country ever offered over 20
 * seasons is **rank 28**. Quote the offered number, not the reachable one.
 *
 * Best nation offered at club reputation 100, by weight, measured:
 * 0.50 -> #28, 0.55 -> #25, 0.60 -> #21, **0.65 -> #18 (Wales)**, 0.70 -> #14,
 * 0.75 -> #11 (Brazil). 0.65 is a good country and not an elite one; the top
 * five are all still out of reach, and getting Spain still needs a national
 * reputation near 75 earned in the job. The discount is what keeps the
 * international ladder a ladder rather than something a domestic treble skips.
 *
 * It only bites above club reputation 47, because below that it lands under
 * `NATIONAL_REP_BASE` and the `max` ignores it: an unproven manager is
 * unaffected (base club reputation is 30), and roughly one league title is what
 * starts opening it. A reward for a real club career rather than a freebie.
 *
 * Deliberately feeds the OFFER TARGET ONLY, never `nationalReputation` itself —
 * that number is displayed to the player as their international standing and
 * must keep meaning what it says, and it also drives nothing else. Confidence
 * and sackings stay strictly on the national record, so a club-side retune can
 * never change who a federation dismisses.
 */
export const NATIONAL_OFFER_CLUB_REP_WEIGHT = 0.65;
/**
 * Per-nation chance of an approach in any given offseason while you already
 * hold a national job. Deliberately low: international jobs turn over slowly,
 * and a fresh list every summer would make the appointment feel weightless.
 */
export const NATIONAL_OFFER_BASE_CHANCE = 0.14;
/**
 * The same chance for a manager with no nation. Much higher, because this is the
 * only route back in — an unemployed international manager who is never
 * approached has simply lost the feature.
 */
export const NATIONAL_OFFER_UNEMPLOYED_CHANCE = 0.55;
/** How much last campaign's over-performance moves that chance. */
export const NATIONAL_OFFER_FORM_WEIGHT = 0.7;
export const NATIONAL_OFFER_MAX_CHANCE = 0.85;
/** Losing a job drops the calibre of nation that will take you next. */
export const NATIONAL_SACKED_PRESTIGE_PENALTY = 0.2;

/** Reputation as an international manager, 0-100, derived from the stint record. */
export const NATIONAL_REP_BASE = 30;
export const NATIONAL_REP_TITLE_WEIGHT = 22;
export const NATIONAL_REP_CONTINENTAL_WEIGHT = 11;
export const NATIONAL_REP_QUALIFICATION_WEIGHT = 3;
export const NATIONAL_REP_OVERPERFORMANCE_WEIGHT = 8;
export const NATIONAL_REP_CAMPAIGN_WEIGHT = 1.2;
/** Campaigns past this stop adding experience credit. */
export const NATIONAL_REP_CAMPAIGN_CAP = 12;
export const NATIONAL_REP_SACKING_PENALTY = 9;

/**
 * How many young high-potential players an AI club retains beyond its
 * ROSTER_COMPOSITION depth chart — its academy, in effect.
 *
 * **This exists because AI clubs used to throw away their entire youth intake.**
 * `trimRosterSurplus` cuts each position to ROSTER_COMPOSITION ranked on
 * *current* ovr, and a 16-year-old is always bottom of his depth chart, so
 * measured on a fresh world **84-86% of every AI club's youth intake was
 * released into free agency in the same offseason it arrived** — 220 of the 275
 * POT>=70 prospects among them, every year. Neither pass of `runAIFreeAgency`
 * ranked on potential either (the word appeared nowhere in the file), so nobody
 * picked them back up: the unsigned under-22 pool grew 1,485 -> 3,072 between
 * seasons 2 and 7 and the user was the only actor in the world that valued
 * youth. Ten free prospects taken in season 2 read 84/83/82/79/79/79/71/71 by
 * season 11, against a tier-1 XI mean of 66.
 *
 * **Retention is ADDITIVE to the depth chart, never a reweighting of it, and
 * that is the load-bearing part.** Blending potential into the trim ranking is
 * the obvious implementation and it trades starters for prospects: a club that
 * keeps a 30-ovr 16-year-old *instead of* a 55-ovr squad player fields a worse
 * XI, which moves match quality, the M1 benchmark gates and the country ladder
 * all at once. Protecting prospects in slots of their own leaves `selectXI`'s
 * input untouched — who plays is decided on the same depth chart as before —
 * so the change is a squad-size and wage-bill question rather than a football
 * one. Wages are cubic in ovr, so the marginal prospect is close to free.
 *
 * Sized against ACADEMY_ROSTER_CAP (10), which is the equivalent allowance the
 * user's club gets, discounted because an AI club carries its prospects on the
 * senior roster (they count toward ROSTER_CAP and can be picked in an injury
 * crisis) rather than in a separate pool. Raising it costs roster slots and a
 * little wage bill; the thing to watch is weak-league solvency, which is the
 * column that fails first here (see docs/transfer-mobility.md).
 */
export const AI_PROSPECT_SLOTS = 5;

/**
 * Bars a young player must clear to take one of an AI club's AI_PROSPECT_SLOTS.
 *
 * The age bar is PROSPECT_AGE_MAX by reference rather than a copy: it is the
 * same "still a prospect" line Incoming Talent draws, and the two drifting
 * apart would mean the AI stops protecting players the user is still shown as
 * prospects. The potential bar is deliberately well above the ~62 median intake
 * potential — this protects genuine wonderkids, not every teenager, or a club
 * would spend all five slots on filler and still bin the player worth keeping.
 */
export const AI_PROSPECT_MAX_AGE = PROSPECT_AGE_MAX;
export const AI_PROSPECT_MIN_POT = 70;

/**
 * The user's youth intake is a TRIAL GROUP he chooses from, not a squad handed
 * to him — the Youth Intake screen (formerly Incoming Talent).
 *
 * Sized against the decision it is meant to be. A club's ordinary intake is
 * YOUTH_INTAKE_MIN..MAX (3-5) against an ACADEMY_ROSTER_CAP of 10, so "pick
 * from your intake" over that group is a confirmation dialog rather than a
 * choice — you would keep nearly all of them nearly every year. A group of
 * ~10-12 against YOUTH_TRIAL_SIGN_LIMIT is a real call with a real cost to
 * getting it wrong, and the potential fog is what stops it being obvious.
 *
 * **USER'S CLUB ONLY, and that keeps it out of the equilibrium entirely.** AI
 * clubs keep their existing 3-5 intake straight onto the senior roster. The
 * extra trialists are generated on their own seeded stream and their pids are
 * allocated after every club's ordinary intake, so the shared rng draw count
 * and every other club's pid assignment are untouched — one club's academy
 * cannot shift the world's generation. Same containment principle the
 * difficulty levers rest on.
 */
export const YOUTH_TRIAL_GROUP_MIN = 10;
export const YOUTH_TRIAL_GROUP_MAX = 12;
/** How many of the trial group can be signed to the academy. The rest leave. */
export const YOUTH_TRIAL_SIGN_LIMIT = 5;
/** Seeded-stream tag for the extra trialists (never the shared rng). */
export const YOUTH_TRIAL_STREAM = 88;

/**
 * How far a well-run academy moves the quality of the user's trial group,
 * in ovr points added to his academy anchor at intake time.
 *
 * Two inputs, both things the manager actually controls and neither of which
 * fed youth intake before: **scouting spend** (a scouting network is what finds
 * young players, and the spend was otherwise purely a fog-of-war lever) and
 * **hype** (a club people are excited about attracts them). Each is normalized
 * to 0..1 over its own range and contributes half the swing, so a club at full
 * spend and maximum hype gets the whole of it and one at neither gets nothing.
 *
 * **A BONUS ONLY, never a penalty, and that asymmetry is deliberate.** The
 * anchor already carries the club's standing and ACADEMY_FORM_SWING already
 * pushes both ways on results; making a third lever subtract as well would
 * stack three penalties on a struggling club's one route out. It is also what
 * lets this ship without a dynasty audit: a bonus reaching one club in a world
 * of 420 cannot drag a league's mean, and nothing here touches an AI academy.
 *
 * NEVER written back into StoredTeam.academyBase — that field is the
 * anti-inflation anchor and is also read by promotion convergence and
 * roster-import realignment, so a baked-in offset would leak into both. Applied
 * as an intake-time modifier beside academyFormModifiers, exactly as the
 * difficulty academy lever is.
 */
export const YOUTH_TRIAL_SCOUTING_SWING = 3;
export const YOUTH_TRIAL_HYPE_SWING = 3;

/**
 * "Send your scouts here": how many countries the user can point his youth
 * scouting at, and how much of the trial group they supply between them.
 *
 * **Rating-neutral by construction**, so this is flavour and a national-team
 * hook rather than a balance lever: nationality feeds `generateName` and
 * international eligibility and nothing else, and ratings are drawn
 * independently of it (CLAUDE.md verifies this by regenerating a world after
 * changing the nationality tables — every country's starter mean OVR identical
 * to the decimal). The hook is that a player's nationality decides who can cap
 * him, so scouting a country deepens that nation's pool.
 *
 * 0.6 is a blend, not an override: the home mix keeps a real share, so the
 * group still reads as the club's own and no setting can manufacture a
 * single-nationality academy. Three targets is enough to express a plan
 * ("South America") without the share per country thinning to nothing.
 */
export const SCOUTING_REGION_MAX = 3;
export const SCOUTING_REGION_SHARE = 0.6;

/**
 * How many positions the user can tell his scouts to look for, and how much of
 * the SCOUTED part of the trial group they take between them.
 *
 * **The share is higher than SCOUTING_REGION_SHARE on purpose, and the reason
 * is a hard constraint rather than a taste call.** A country is re-drawn
 * post-hoc over the whole group, because nationality is rating-neutral and the
 * relabel costs no rng draw. A position cannot be: ratings are rolled from that
 * position's own tier row, so changing it means generating a different player —
 * and the user's ORDINARY intake is generated on the shared `rng`, where
 * `rollRating` spends one draw for an `ABS` tier and two for every other, so a
 * keeper costs 23 rating draws against an outfielder's 27. Re-weighting that
 * draw would shift the shared stream by four and re-roll every club generated
 * after his. So positions reach only the extras, which are drawn on the trial
 * stream — and the share is raised so the skew the user actually SEES across
 * the whole group lands in the same place a country's does.
 */
export const SCOUT_POSITION_MAX = 3;
export const SCOUT_POSITION_SHARE = 0.75;

