/** Every tunable engine value. Copied verbatim from the validated PoC. */
export const MATCH_SECONDS = 5400; // 90 minutes
export const MIN_DT = 2; // seconds per tick (min)
export const MAX_DT = 10; // seconds per tick (max)

export const BASE_CHANCE = 0.0304; // per-tick prob the team on the ball creates a shot
export const STRENGTH_K = 0.8; // how much attack-vs-defense edge swings chance frequency

export const BLOCK_BASE = 0.28; // shot gets blocked
export const ONTARGET_BASE = 0.47; // unblocked shot is on target
export const SAVE_BASE = 0.68; // on-target shot is saved (else goal)

// simMatchDetailed only: how much the individual finisher's own skill shifts a
// shot's conversion, relative to his TEAM's average finisher (shooting for
// open-play shots, heading for corner headers). Centered on the team average,
// so this redistributes a team's goals toward its best finishers without
// changing league-wide scoring — a standout finisher on a weak side scores
// well above his team's baseline; a poor finisher on a strong side underscores.
// Applied to onTargetP/saveP in resolveShot, never to xG (so goals-vs-xG still
// reveals finishing skill). The fast composite-only simMatch is unaffected.
export const SHOOTER_FINISH_WEIGHT = 0.3;

/**
 * How sharply a player's own rating decides whether HE is the one credited with
 * an event, in the box-score attribution draws (engine/attribution.ts).
 *
 * Each draw weights a candidate by `positionWeight × (rating + 10)`. Linear with
 * a +10 floor is a very weak discriminator: an 80-rated player takes only 1.8×
 * the share of a 40-rated one at the same position, so the box score barely
 * distinguished a great player from a poor one at the same job. This raises the
 * RATING term to a power — the position weight is untouched, so a centre-back
 * still takes a centre-back's share of the tackles. At 2 that pair is 3.2× apart.
 *
 * Measured over a full simmed league season (`scripts/attributionSweep.ts`),
 * correlation between the relevant skill and per-appearance output, linear → 2:
 *
 *     defence (tackles+interceptions)   0.294 → 0.408
 *     creation (assists)                0.307 → 0.451
 *     shooting (shots)                  0.358 → 0.420
 *     finishing (goals)                 0.419 → 0.482
 *
 * Three things bound it, all measured before settling on 2:
 *
 *   - CALIBRATION is what stops it going higher. Concentrating shots on the best
 *     finisher COMPOUNDS with SHOOTER_FINISH_WEIGHT, since he also converts
 *     better — so the top scorer is the number most at risk. Measured: top
 *     scorer 24 → 26 at 2, but 30 at 3, with goals/game 3.021 → 3.029 at 2 and
 *     3.050 at 3. The M3 gate bands the tier-1 top scorer at 18-36, and 3 spends
 *     real headroom in it for a modest further gain.
 *   - REALISM. Total credited events per match is FIXED (by
 *     CREDITED_TURNOVER_PROB and the shot rolls), so this only redistributes
 *     them — push far enough and one man takes his club's whole workload.
 *     The busiest defender's share of his club's actions goes 26.0% → 27.2% at
 *     2 (and 31% at 5, where his workload hits the top of the plausible band).
 *   - IT MUST NOT BECOME A RESTATEMENT OF OVR, or the board says nothing a
 *     rating column doesn't. It goes the other way: the gap between r(skill) and
 *     r(ovr) WIDENS on every axis — defence 0.081 → 0.158, creation 0.115 →
 *     0.291, shooting 0.016 → 0.062 — so each stat becomes more specific to the
 *     skill it names rather than tracking general quality.
 *
 * NOT SCORELINE-INERT: tackles and assists feed computeMatchRating, ratings feed
 * subPriority and the bench-quality gate, so who is credited changes
 * substitutions and therefore results. Small (goals/game +0.26%) but real, and
 * the touchStats baseline hash is rebased for it.
 *
 * Applied to the four CREDIT draws only — shooter, assister, tackler/interceptor,
 * header. Deliberately NOT to pickFouler or pickCarrier: fouls are weighted by
 * tackling, so steepening would make a club's best defender its most-booked
 * player, and pickCarrier picks who LOST the ball. Steepen credit, not blame.
 */
export const ATTRIBUTION_RATING_EXPONENT = 2;

export const TURNOVER_BASE = 0.14; // per-tick prob possession changes hands
// Of every turnover (see TURNOVER_BASE above), the share credited as a
// stat-worthy defensive action at all vs. no credit (a real match has plenty
// of misplaced passes/loose balls no box score attributes to anyone), and of
// that credited share, the split between a tackle and a clean interception.
// These are the two independent tunables; TACKLE_CREDIT_PROB/
// INTERCEPTION_CREDIT_PROB below are derived so matchSim.ts's per-turnover
// roll doesn't need to know about the split. Starting values chosen so a busy
// center-back lands in the real-world plausible ~2-6 tackles and ~2-5
// interceptions per match instead of the pre-fix high-teens blowout —
// pending audit-tuning per the design doc.
export const CREDITED_TURNOVER_PROB = 0.4;
export const INTERCEPTION_SHARE_OF_CREDIT = 0.5;
export const TACKLE_CREDIT_PROB = CREDITED_TURNOVER_PROB * (1 - INTERCEPTION_SHARE_OF_CREDIT);
export const INTERCEPTION_CREDIT_PROB = CREDITED_TURNOVER_PROB * INTERCEPTION_SHARE_OF_CREDIT;
export const REBOUND_PROB = 0.12; // after a saved/blocked shot, attacker keeps it

export const HOME_ATTACK_BONUS = 0.1; // home advantage, applied to home attack composite

// --- Decorative touch attribution (passes / crosses), simMatchDetailed only ---
// Synthesized after the match on a separate rng stream (see attributeTouchStats),
// so they never affect scorelines. Calibrated to real top-flight per-team volumes:
// ~470 passes/team at ~82% completion, ~16 crosses/team. A side plays ~470 ticks.
export const PASSES_PER_TICK = 1.0; // passes attempted per possession tick
export const PASS_ATTEMPT_NOISE = 0.08; // ± fractional noise on a team's pass total
export const PASS_COMPLETION_BASE = 0.82; // league-average completion rate
export const PASS_COMPLETION_CONTROL_K = 0.35; // control composite's pull on completion
export const CROSSES_PER_TICK = 0.034; // crosses attempted per possession tick
export const CROSS_NOISE = 0.15; // ± fractional noise on a team's cross total

// --- Cards (M5) ---
export const FOUL_BASE = 0.016; // per-tick prob the defending side commits a foul
export const FREE_KICK_CHANCE_BASE = 0.05; // bonus shot-chance prob for the fouled side, same tick

// simMatch (composite-only, no player identity): a foul sends the fouling side a man down
// with this flat probability, standing in for straight reds + accumulated second yellows.
//
// Deliberately NOT raised alongside YELLOW_GIVEN_FOUL below (2026-08-16), so the
// two paths no longer imply the same red rate (~0.05 man-down events per match
// here against 0.18 reds in simMatchDetailed). simMatch has no player identity
// and so no box score anyone sees — its only callers are montecarlo.ts,
// scripts/cli.ts and tests — while it *is* what the M1 benchmark bands are
// calibrated against. Moving it would retune spec gates for no player-visible
// gain. If these ever need to agree, re-derive this from the detailed path's
// measured red rate and re-run the M1 benchmarks in the same change.
export const RED_GIVEN_FOUL_SIMPLE = 0.004;

// simMatchDetailed (player identity available): distinguish yellow/red so bookings persist
// per player and a second yellow becomes a red, per spec.
//
// Raised 0.11 -> 0.18 on 2026-08-16, once suspensions gave cards a consequence
// worth measuring (`scripts/cardRateSweep.ts`). At 0.11 the engine booked 1.42
// players per match against a real top flight's ~3.5-4.5; this lands ~2.3,
// closing about half the gap. Three things make this a tuning knob rather than
// a free one, all measured in the sweep:
//
//   - REDS RISE FASTER THAN YELLOWS, roughly with the square of this number: a
//     second yellow needs two bookings to land on one player. Straight reds are
//     therefore left alone at 0.003 — total reds reach the real ~0.15-0.25 band
//     on second yellows alone, and raising both would overshoot it.
//   - CARDS COST GOALS, indirectly. Every card calls bumpEvent(), and stoppage
//     time is STOPPAGE_SECONDS_PER_EVENT per event, so a busier card sheet makes
//     matches marginally longer. Small (the M1 goals/game bands hold) but real,
//     and it is the channel that would break a benchmark if this went much higher.
//   - MORE REDS MEANS MORE MAN-DOWN COMPOSITES, which is a genuine on-pitch
//     effect, not bookkeeping.
//
// Going the rest of the way to a real booking rate would need FOUL_BASE raised
// too — at 13.0 fouls per match the engine already books a higher share of fouls
// than referees do, so the shortfall is in fouls, not in cards per foul.
export const YELLOW_GIVEN_FOUL = 0.18;
export const RED_STRAIGHT_GIVEN_FOUL = 0.003;

// Red card man-down penalty: recompute the short side's composites once, per spec §5.
export const RED_CARD_ATTACK_DELTA = -0.06;
export const RED_CARD_DEFENSE_DELTA = -0.06;
export const RED_CARD_CONTROL_DELTA = -0.04;

// --- Fatigue + substitutions (M5), simMatchDetailed only (needs player identity) ---
// Energy 1 -> ~0.6 over a full match for an average-stamina (50) player, per spec §5/§6.
export const ENERGY_START = 1;
export const ENERGY_FLOOR = 0.6;
export const ENERGY_DECAY_PER_SECOND = (ENERGY_START - ENERGY_FLOOR) / MATCH_SECONDS;
// How much a player's stamina rating (0..99, 50 = average) speeds/slows their own decay.
export const STAMINA_DECAY_SPREAD = 0.5;

// How much a side's average on-pitch energy deficit drags down its composites.
// Physical composites (attack/defense/control) feel fatigue more than technique.
export const FATIGUE_PHYSICAL_WEIGHT = 0.25;
export const FATIGUE_TECHNICAL_WEIGHT = 0.1;

// AI subs: 5 per side, made across a limited number of substitution WINDOWS —
// the real law, and the reason this is a window model rather than a list of
// moments. A manager may bring on several players at once, and doing so costs
// him one opportunity rather than one per player; half-time is an extra
// opportunity that doesn't count against the three.
//
// MAX_SUBS has been 5 since M5 and was unreachable until windows landed: there
// were exactly two checkpoints (60' and 75') and each made at most ONE sub, so
// the ceiling was 2. Measured on a full season of the 626-club world before the
// change: 1.58 subs per team per match, 12% of team-matches making none at all,
// and the minute histogram showing 13,368 subs at exactly 60' and 13,499 at
// exactly 75' against a scatter of ~40/minute elsewhere (those are the
// injury-forced ones). Real top-flight football runs ~4.5.
export const MAX_SUBS = 5;

// Candidate moments (elapsed seconds) at which a side may open an in-play
// window. Deliberately MORE moments than SUB_WINDOWS_IN_PLAY allows, so the
// budget actually binds and sides diverge in when they use it — with exactly
// three moments for three windows the constraint would be inert and every club
// in the world would sub at the same three minutes, which is the artefact this
// replaces. Half-time is handled separately (SUB_WINDOW_HALFTIME_ELAPSED).
export const SUB_WINDOW_MOMENTS_ELAPSED = [3600, 4200, 4680, 5100] as const;

// Half-time. A free opportunity under the laws, and it stays free here. It
// fires rarely on its own merits, which is correct: nobody is gassed at 45', so
// only a genuine quality upgrade or the user's "more minutes" flag clears the
// gate — matching real half-time subs being tactical rather than fitness-driven.
export const SUB_WINDOW_HALFTIME_ELAPSED = 2700;

// How many in-play opportunities a side gets. Half-time is additional.
export const SUB_WINDOWS_IN_PLAY = 3;

// Every moment a window may open at, ascending — half-time first. Derived so
// the two lists above cannot drift out of order; the match loop fires a moment
// the first tick that reaches it, so ascending order is what keeps half-time
// from being considered after the hour.
export const SUB_WINDOW_ALL_MOMENTS = [
  SUB_WINDOW_HALFTIME_ELAPSED,
  ...SUB_WINDOW_MOMENTS_ELAPSED,
] as const;

// Most subs a side will make in a single window. The laws impose no such cap —
// this is a behaviour bound, not a rule: a triple change is a real and fairly
// common move, emptying the entire bench in one go is not, and without a cap a
// side with a strong bench would make all five at the first window and have
// nothing left to respond with. Injury replacements are not affected (they fire
// immediately, outside the window system entirely).
export const SUB_MAX_PER_WINDOW = 3;

// How much a player's live match rating (see engine/matchRating.ts) sways who gets
// subbed off, alongside fatigue: a below-baseline rating (deficit/10, roughly -0.4..0.6)
// is added to the player's energy deficit (0..0.4) when ranking sub candidates, so a
// tired player having a great game is less likely to be pulled than an equally tired
// one having a poor game, and vice versa. Kept smaller than the energy deficit's own
// range so fatigue stays the primary driver and rating only nudges the choice.
export const SUB_RATING_INFLUENCE = 0.5;

// A substitution is only made when the fresh bench player is actually worth
// bringing on. Bringing on fresh legs is worth a small quality cost, but not a
// big one — and the more gassed the outgoing starter, the bigger the downgrade
// we'll accept to rest him. Concretely, we allow the replacement's ovr to fall
// short of the starter's ovr by up to:
//   SUB_FRESHNESS_BONUS + SUB_QUALITY_MARGIN + SUB_FATIGUE_RELIEF × fatigue
// where fatigue is the starter's energy deficit normalized to 0..1 (0 fresh, 1
// exhausted). Below that we sub; a larger drop-off keeps the tired starter on.
// Net effect: strong benches rotate freely (their replacements aren't a big
// downgrade), weak benches hold their starters on rather than gut their quality,
// and a genuinely exhausted player comes off even for a lesser sub. Tuned so
// roughly one sub in ten is now held back vs the old always-sub behavior.
//
// SUB_QUALITY_MARGIN was 1 when the gate landed, which held back ~1 sub in 5 —
// about twice the intended rate — and cost the champion enough late-game quality
// to push the M1 standings gate (champion 78-94 pts) under its floor. Measured
// over 15 seeded seasons: margin 1 → 78.7 champion pts, margin 2.5 → 80.8 (the
// old always-sub behavior was 79.8). 2.5 restores the documented ~1-in-10 rate
// and leaves the gate comfortably inside its band instead of on the boundary.
export const SUB_FRESHNESS_BONUS = 1.5;
export const SUB_QUALITY_MARGIN = 2.5;
export const SUB_FATIGUE_RELIEF = 2.5;

// How much extra downgrade a side will accept purely because the match is
// nearly over, scaled by the fraction of the match already gone:
//   SUB_LATE_MARGIN × elapsedFraction
// This is the gate learning something true rather than a fudge to raise the
// sub count. The gate above prices a downgrade as though the replacement will
// play the rest of the match; a substitute brought on at 85' degrades five
// minutes of composites, not forty-five, so the real cost of the swap shrinks
// with the clock. Pricing it correctly is what produces the familiar late
// change for a fringe player, and it is self-limiting — the tolerance is
// largest exactly when what it buys is smallest.
//
// It only ever LOOSENS the gate (the term is 0..1 and is added to the
// allowance), so an early-window sub is judged on exactly the terms it was
// before this existed.
export const SUB_LATE_MARGIN = 10;

// The late margin is applied as elapsedFraction ** SUB_LATE_MARGIN_EXPONENT,
// i.e. it stays near zero for most of the match and climbs sharply at the end,
// rather than growing linearly. Linear is the wrong shape and would show up at
// half-time first: at 45' it would hand out half the full tolerance (~3 ovr on
// top of the ~5 the base gate already allows), which is more than the gap
// between a starter and a typical bench player, so nearly every side in the
// world would make a half-time change. Real half-time subs are tactical and
// uncommon. A cubic keeps 45' worth ~0.75 ovr, 75' ~3.5 and 85' ~5.1, which is
// the shape the reasoning above actually implies — the swap only becomes cheap
// once there is genuinely little match left to play.
export const SUB_LATE_MARGIN_EXPONENT = 3;

// The whole allowance at half-time, standing in for the quality margin, the
// fatigue relief and the late margin together (none of which applies at the
// break). Small on purpose: a half-time change should be a genuine upgrade on
// someone who has had a poor half, not a routine rest, which is what real
// half-time substitutions are.
export const SUB_HALFTIME_MARGIN = 1.5;

// How far either side of its nominal minute a side's in-play window may fall.
// Managers pick their own moments; without a jitter every club in the world
// changes its team at the same four minutes, which is glaring in the live match
// viewer and was the most visible artefact of the old fixed checkpoints (13,368
// substitutions at exactly the 60th minute in one measured season, against a
// scatter of ~40 a minute everywhere else). Kept under half the smallest gap
// between two moments so a jittered pair cannot cross and reorder.
export const SUB_WINDOW_JITTER_SECONDS = 180;

// Stream tag for that jitter. It is drawn off match intrinsics rather than the
// shared rng, so it perturbs no other outcome — the rule cup rounds and touch
// attribution already follow.
export const SUB_WINDOW_STREAM = 87;

// How much the outgoing starter's live match rating (see engine/matchRating.ts)
// shifts the worth-it gate above, on top of his ovr and fatigue: a player above
// the 6.0 baseline is currently "worth more" than his ovr (harder to justify
// pulling), one below it is worth less (easier). Applied as
//   SUB_GATE_RATING_INFLUENCE × (liveRating − RATING_BASELINE) / 10
// added to the tired starter's value, so a stormer (rating ~9) protects himself
// by ~1.5 ovr and a poor game (rating ~4.5) makes him ~0.75 ovr easier to sub.
// Deliberately smaller than the fatigue relief so fitness/quality stay primary
// and form only nudges — mirrors how rating nudges the who-comes-off pick.
export const SUB_GATE_RATING_INFLUENCE = 5;

// "Give more minutes": a bench player the user has flagged is credited this many
// extra ovr points in the sub decision (both when choosing who to bring on and
// when clearing the worth-it gate above), so he's subbed in more readily — even
// slightly ahead of a marginally better un-flagged option. Deliberately modest:
// it tips close calls, it doesn't force a clearly-worse player onto the pitch.
export const SUB_MINUTES_BOOST = 6;

// --- Set pieces + penalties (M5) ---
// Fraction of blocked/off-target run-of-play shots that earn a corner (one bonus
// shot, heading-weighted attribution). Resolved via the normal off/def composites
// so it stays correlated with team quality (unlike the flat-rate free-kick bug
// from step 1 that compressed the table-spread gate).
export const CORNER_FROM_MISS_PROB = 0.008;

// Fraction of fouls that are "in the box" -> penalty instead of an ordinary free
// kick. Edge-scaled by the same attack-vs-defense edge as the main chance gate,
// for the same reason as above.
export const PENALTY_GIVEN_FOUL = 0.005;
export const PENALTY_CONVERSION = 0.76; // baseline penalty goal probability, per spec
// Of missed penalties, the share the keeper saves (rest fly off target). Only a
// saved penalty counts as a shot on target and credits the GK a save.
export const PENALTY_MISS_SAVED_PROB = 0.65;

// --- Injuries (M5), simMatchDetailed only (needs player identity + a bench to sub into) ---
// Small probability the tackled ball carrier gets hurt on a given turnover, per spec
// ("small per-tick probability, weighted to tackled players" — modeled as conditional on
// the tackle itself, since that's the sim's only notion of player-on-player contact).
export const INJURY_PROB_ON_TACKLE = 0.003;

// --- Stoppage time (M5; halves became real periods 2026-09-10) ---
// Each half now ends with its OWN stoppage, played where it belongs, so the
// timeline reads 45+n and 90+n the way a real one does.
//
// This replaced a model that computed both halves' stoppage from their own
// event counts and then played the whole lot at the end of the second half.
// That was defended as "statistically equivalent, since every per-tick roll is
// memoryless" — true of the SCORELINE, and false of everything a viewer reads:
// there was no half-time in the clock at all, so first-half stoppage did not
// exist as a passage of play, no event could ever be stamped 45+1, and a
// first-half injury bought three minutes that were handed to the 93rd.
//
// A half's stoppage is a floor plus the time the half actually lost:
//   STOPPAGE_MIN + STOPPAGE_SECONDS_PER_EVENT * (notable events)
//                + (clock genuinely consumed by goal celebrations)
// The first term is the referee's standing allowance, the second a flat stand-in
// for the time a card, injury, penalty or substitution eats, and the third is
// real: GOAL_RESTART lets a goal consume clock, and this hands that time back.
// See simMatchDetailed's celebration note for why those two must stay paired.
export const HALF_SECONDS = MATCH_SECONDS / 2;
export const STOPPAGE_MIN_SECONDS_PER_HALF = 60; // 1 minute floor, per spec
// 8 minutes. Was 5 ("per spec"), and on its own that raise is very nearly inert:
// at 20s an event a half needs 12+ notable events to have reached the old cap,
// which is rare. It was raised FOR the celebration credit above, which routinely
// adds two minutes to a half that saw two goals and would otherwise be clipped —
// and a clipped credit is not a cosmetic loss, it is playing time deleted from
// exactly the halves that were most eventful, i.e. a quiet negative feedback on
// scoring. Modern top-flight halves genuinely run this long.
export const STOPPAGE_MAX_SECONDS_PER_HALF = 480;
export const STOPPAGE_SECONDS_PER_EVENT = 20;

// How long the ball is out of play after a goal: the celebration, the walk back,
// the restart. Drawn per goal on the MAIN rng, because it is a real quantity
// that changes how much football is left, not decoration.
//
// It exists because goals used to cost nothing: `dt` is 2-10 seconds, so two
// goals could — and did — land in the same displayed minute, including straight
// after a kickoff. A minimum of a minute makes that arithmetically impossible.
//
// Every second spent here is credited back to the half's stoppage (above), so
// the amount of football played in a match is unchanged. That pairing is the
// whole reason this could ship without a rebalance: consuming clock WITHOUT the
// credit deletes ~2 minutes of play per match, which is a scoring change wearing
// a presentation change's clothes.
export const GOAL_RESTART_MIN_SECONDS = 55;
export const GOAL_RESTART_MAX_SECONDS = 95;

// --- Out-of-position familiarity (slot-aware composites) ---
// The cost, in raw rating points (the same 0-100 scale as a player's skills), of
// fielding a player somewhere other than his own position. Composites bucket the
// XI by the SLOT each player occupies, not by his natural position, and each
// player's contribution to his slot's phase is docked by one of these.
//
// Calibrated against the OVR scale (65 average starter, 70 good, 75 a team's
// best): a good player one position off should read roughly like an average
// player in his own position, and a foreign-position emergency should be a
// visible downgrade without being unplayable.
//
// The same penalty feeds the substitution decision (see pickReplacement /
// worthSub in matchSim), which is what stops the bench logic from answering a
// tired centre-back with its best available striker. Those two uses must stay
// on one number: if the sub logic is cheaper about position than the rollup is,
// the sim talks itself into swaps it then punishes.
export const POSITION_ADJACENT_PENALTY = 6;
export const POSITION_FOREIGN_PENALTY = 16;
// An outfielder in goal (or a keeper stranded outfield) is categorically worse
// than any outfield mismatch — the keeping composite is nearly all goalkeeping
// rating, which an outfielder simply does not have. Only reachable when a side
// runs out of fit keepers (an injured GK with no keeper on the bench).
export const POSITION_KEEPER_PENALTY = 35;
