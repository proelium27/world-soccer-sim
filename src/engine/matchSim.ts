import {
  MATCH_SECONDS,
  MIN_DT,
  MAX_DT,
  BASE_CHANCE,
  STRENGTH_K,
  BLOCK_BASE,
  ONTARGET_BASE,
  SHOOTER_FINISH_WEIGHT,
  SAVE_BASE,
  TURNOVER_BASE,
  TACKLE_CREDIT_PROB,
  INTERCEPTION_CREDIT_PROB,
  REBOUND_PROB,
  HOME_ATTACK_BONUS,
  FOUL_BASE,
  FREE_KICK_CHANCE_BASE,
  RED_GIVEN_FOUL_SIMPLE,
  YELLOW_GIVEN_FOUL,
  RED_STRAIGHT_GIVEN_FOUL,
  RED_CARD_ATTACK_DELTA,
  RED_CARD_DEFENSE_DELTA,
  RED_CARD_CONTROL_DELTA,
  ENERGY_START,
  ENERGY_FLOOR,
  ENERGY_DECAY_PER_SECOND,
  STAMINA_DECAY_SPREAD,
  FATIGUE_PHYSICAL_WEIGHT,
  FATIGUE_TECHNICAL_WEIGHT,
  MAX_SUBS,
  SUB_WINDOW_MOMENTS_ELAPSED,
  SUB_WINDOW_HALFTIME_ELAPSED,
  SUB_WINDOWS_IN_PLAY,
  SUB_MAX_PER_WINDOW,
  SUB_LATE_MARGIN,
  SUB_LATE_MARGIN_EXPONENT,
  SUB_HALFTIME_MARGIN,
  SUB_WINDOW_JITTER_SECONDS,
  SUB_WINDOW_STREAM,
  SUB_RATING_INFLUENCE,
  SUB_FRESHNESS_BONUS,
  SUB_QUALITY_MARGIN,
  SUB_FATIGUE_RELIEF,
  SUB_GATE_RATING_INFLUENCE,
  SUB_MINUTES_BOOST,
  CORNER_FROM_MISS_PROB,
  PENALTY_GIVEN_FOUL,
  PENALTY_CONVERSION,
  PENALTY_MISS_SAVED_PROB,
  INJURY_PROB_ON_TACKLE,
  HALF_SECONDS,
  STOPPAGE_MIN_SECONDS_PER_HALF,
  STOPPAGE_MAX_SECONDS_PER_HALF,
  STOPPAGE_SECONDS_PER_EVENT,
  GOAL_RESTART_MIN_SECONDS,
  GOAL_RESTART_MAX_SECONDS,
} from "./constants.js";
import type { Composites } from "./composites.js";
import { familiarityPenalty } from "./positionFit.js";
import { matchMinutesBetween } from "./matchTime.js";
import type { MatchPlayer, MatchPosition, MatchEvent, BoxScore, PlayerMatchLine, TouchSide } from "./attribution.js";
import {
  pickShooter,
  pickAssister,
  pickTackler,
  pickInterceptor,
  pickFouler,
  pickHeader,
  pickCarrier,
  eventTypeFromShot,
  emptyLine,
  attributeTouchStats,
} from "./attribution.js";
import { hashInts, mulberry32 } from "./rng.js";
import { computeMatchRating, RATING_BASELINE } from "./matchRating.js";

type Side = "home" | "away";

/** Recompute a side's composites after it goes down a man, per spec §5. Applied once. */
function applyManDown(c: Composites): Composites {
  return {
    ...c,
    attack: clamp(c.attack + RED_CARD_ATTACK_DELTA),
    defense: clamp(c.defense + RED_CARD_DEFENSE_DELTA),
    control: clamp(c.control + RED_CARD_CONTROL_DELTA),
  };
}

/** Per-second energy decay for a player, faster for low-stamina players, slower for high. */
function decayPerSecond(stamina: number): number {
  return ENERGY_DECAY_PER_SECOND * (1 + STAMINA_DECAY_SPREAD * ((50 - stamina) / 50));
}

/** Scale a side's composites down by its on-pitch XI's average energy deficit. */
function applyFatigue(c: Composites, avgEnergy: number): Composites {
  const deficit = ENERGY_START - avgEnergy; // 0 fresh .. ~0.4 exhausted
  const physical = 1 - FATIGUE_PHYSICAL_WEIGHT * deficit;
  const technical = 1 - FATIGUE_TECHNICAL_WEIGHT * deficit;
  return {
    ...c,
    attack: clamp(c.attack * physical),
    defense: clamp(c.defense * physical),
    control: clamp(c.control * physical),
    finishing: clamp(c.finishing * technical),
    keeping: clamp(c.keeping * technical),
  };
}

export const clamp = (x: number, lo = 0, hi = 1): number =>
  Math.max(lo, Math.min(hi, x));

/**
 * How long a half's stoppage runs: a floor, plus a flat allowance per notable
 * event, plus the clock genuinely consumed by goal celebrations in that half.
 *
 * `secondsLost` defaults to 0 so the composite-only `simMatch` — which has no
 * player identity, no celebrations and no box score anyone reads — keeps
 * calling this exactly as it did. It is the M1 benchmark path, and moving it
 * would retune spec gates for no player-visible gain (same call
 * RED_GIVEN_FOUL_SIMPLE already makes).
 */
export function computeStoppageSeconds(eventCount: number, secondsLost = 0): number {
  const raw = clamp(
    STOPPAGE_MIN_SECONDS_PER_HALF + eventCount * STOPPAGE_SECONDS_PER_EVENT + secondsLost,
    STOPPAGE_MIN_SECONDS_PER_HALF,
    STOPPAGE_MAX_SECONDS_PER_HALF,
  );
  // WHOLE MINUTES, because a fourth official holds up a board with an integer on
  // it — and because the display depends on it. The playback timeline is indexed
  // by minute, so a half ending 2.5 minutes into stoppage would leave the second
  // half's minutes straddling the break and nothing could label 45+3 or 46
  // exactly. Both bounds are already whole minutes, so rounding cannot leave the
  // clamped range.
  return Math.round(raw / 60) * 60;
}

export interface TeamMatchStat {
  goals: number;
  shots: number;
  sot: number;
  ticks: number;
}

export interface MatchResult {
  home: number; // home goals
  away: number; // away goals
  possessionHome: number; // 0..1, home ticks / total ticks
  stat: { home: TeamMatchStat; away: TeamMatchStat };
}

export type ShotOutcome = "blocked" | "off_target" | "saved" | "goal";

export interface ShotResult {
  outcome: ShotOutcome;
  /**
   * The chance's quality, independent of who's taking it: what an
   * average-finishing attacker would be expected to score against this same
   * defense. Deliberately excludes `off.finishing` (see xgOnTargetP/xgSaveP
   * below) — an elite finisher's shots must NOT score higher xG just because
   * he's an elite finisher, or "goals vs xG" could never reveal finishing
   * skill (his actual conversion rate would just track his own inflated
   * baseline). blockP/saveP still reflect the actual defense/keeper faced,
   * since that's genuine chance difficulty, not shooter identity.
   */
  xg: number;
}

/** Shot resolution cascade: block -> off target -> save -> goal. (PoC lines 57-73) */
export function resolveShot(
  rng: () => number,
  off: Composites,
  def: Composites,
  /**
   * Individual finisher adjustment (simMatchDetailed only): the on-pitch
   * shooter/header's own skill relative to his team's average finisher, already
   * scaled by SHOOTER_FINISH_WEIGHT. Added to the team finishing composite when
   * deciding the REAL outcome (onTargetP/saveP) so a great finisher converts
   * above his team's baseline. Default 0 leaves the composite-only sim, corners
   * in the fast path, and every existing caller/test bit-identical. Never enters
   * xG below (xG stays the "average attacker" baseline on purpose).
   */
  finishAdj: number = 0,
): ShotResult {
  const effFinishing = clamp(off.finishing + finishAdj, 0.05, 0.95);
  const blockP = clamp(BLOCK_BASE * (1 + 0.6 * (def.defense - 0.5)), 0.05, 0.6);
  const onTargetP = clamp(
    ONTARGET_BASE * (1 + 0.5 * (effFinishing - 0.5)),
    0.1,
    0.9,
  );
  const saveP = clamp(
    SAVE_BASE * (1 + 0.5 * (def.keeping - 0.5)) - 0.3 * (effFinishing - 0.5),
    0.2,
    0.95,
  );

  // xG-only probabilities: same cascade, but with the shooter's finishing
  // held at a neutral 0.5 (the "average attacker" baseline every composite
  // is centered on elsewhere in this file). These never drive the RNG rolls
  // below — only the real onTargetP/saveP (which do include off.finishing)
  // decide the actual outcome, so match balance/tuning is untouched.
  const xgOnTargetP = clamp(ONTARGET_BASE, 0.1, 0.9);
  const xgSaveP = clamp(SAVE_BASE * (1 + 0.5 * (def.keeping - 0.5)), 0.2, 0.95);
  const xg = (1 - blockP) * xgOnTargetP * (1 - xgSaveP);

  if (rng() < blockP) return { outcome: "blocked", xg };
  if (rng() >= onTargetP) return { outcome: "off_target", xg };
  if (rng() < saveP) return { outcome: "saved", xg };
  return { outcome: "goal", xg };
}

/**
 * The individual-finisher adjustment to feed resolveShot: how much better/worse
 * the finisher is at `key` (shooting for shots, heading for corner headers) than
 * his own team's average outfielder, scaled by SHOOTER_FINISH_WEIGHT and put on
 * the composite's 0..1 scale. Centered on the team average, so it redistributes
 * a team's goals toward its best finishers without shifting league-wide scoring.
 */
export function finisherAdj(
  finisher: MatchPlayer,
  onPitch: MatchPlayer[],
  key: "shooting" | "heading",
): number {
  const outfield = onPitch.filter((p) => p.slot !== "GK");
  if (outfield.length === 0) return 0;
  const avg = outfield.reduce((a, p) => a + p[key], 0) / outfield.length;
  return SHOOTER_FINISH_WEIGHT * ((finisher[key] - avg) / 100);
}

/** Simulate one match. (PoC lines 76-141) */
export function simMatch(
  rng: () => number,
  home: Composites,
  away: Composites,
): MatchResult {
  const homeEff: Composites = {
    ...home,
    attack: clamp(home.attack + HOME_ATTACK_BONUS),
  };
  const teams: Record<Side, Composites> = { home: homeEff, away };
  const manDown = { home: false, away: false };

  const stat = {
    home: { goals: 0, shots: 0, sot: 0, ticks: 0 } as TeamMatchStat,
    away: { goals: 0, shots: 0, sot: 0, ticks: 0 } as TeamMatchStat,
  };

  let clock = MATCH_SECONDS;
  let poss: Side = rng() < 0.5 ? "home" : "away";
  let half1Events = 0;
  let half2Events = 0;
  let stoppageApplied = false;
  let stoppageBudget = 0;
  const bumpEvent = () => {
    if (clock > HALF_SECONDS) half1Events++;
    else half2Events++;
  };

  for (;;) {
    const dt = MIN_DT + rng() * (MAX_DT - MIN_DT);
    clock -= dt;

    if (!stoppageApplied && clock <= 0) {
      stoppageBudget = computeStoppageSeconds(half1Events) + computeStoppageSeconds(half2Events);
      stoppageApplied = true;
    }
    if (stoppageApplied && clock <= -stoppageBudget) break;

    const off = teams[poss];
    const defSide: Side = poss === "home" ? "away" : "home";
    const def = teams[defSide];
    stat[poss].ticks++;

    const turnoverP = clamp(
      TURNOVER_BASE * (1 + 0.6 * (def.defense - off.control)),
      0.02,
      0.5,
    );
    if (rng() < turnoverP) {
      poss = defSide;
      continue;
    }

    if (rng() < FOUL_BASE) {
      // defending side commits a foul; no player identity here, so a foul either goes
      // unpunished, or (rarely) sends the fouling side a man down for the rest of the match.
      if (!manDown[defSide] && rng() < RED_GIVEN_FOUL_SIMPLE) {
        manDown[defSide] = true;
        teams[defSide] = applyManDown(teams[defSide]);
        bumpEvent();
      }
      // Edge-scaled so a fraction of fouls happen "in the box" (penalty) vs the
      // open-play free kick below — same edge scaling as the free kick itself,
      // to avoid the flat-rate gate-compression bug from step 1.
      const freeKickEdge = teams[poss].attack - teams[defSide].defense;
      const penaltyP = clamp(
        PENALTY_GIVEN_FOUL * (1 + STRENGTH_K * freeKickEdge),
        0.001,
        0.08,
      );
      if (rng() < penaltyP) {
        // Penalty: unopposed shot, no block stage. A miss is either saved (on
        // target) or off target, so SoT isn't unconditionally inflated.
        bumpEvent();
        stat[poss].shots++;
        const goalP = clamp(
          PENALTY_CONVERSION *
            (1 + 0.15 * (teams[poss].finishing - 0.5) - 0.15 * (teams[defSide].keeping - 0.5)),
          0.55,
          0.9,
        );
        if (rng() < goalP) {
          stat[poss].sot++;
          stat[poss].goals++;
          poss = defSide;
        } else if (rng() < PENALTY_MISS_SAVED_PROB) {
          stat[poss].sot++;
        }
        continue;
      }

      // free kick: bonus shot chance for the fouled (attacking) side, same tick.
      // Scaled by the same attack-vs-defense edge as the main chance gate, so it
      // doesn't dilute skill-driven spread by handing weak sides "free" chances.
      const freeKickP = clamp(
        FREE_KICK_CHANCE_BASE * (1 + STRENGTH_K * freeKickEdge),
        0.01,
        0.3,
      );
      if (rng() < freeKickP) {
        stat[poss].shots++;
        const { outcome } = resolveShot(rng, teams[poss], teams[defSide]);
        if (outcome === "saved" || outcome === "goal") stat[poss].sot++;
        if (outcome === "goal") {
          bumpEvent();
          stat[poss].goals++;
          poss = defSide;
        }
      }
      continue;
    }

    const edge = off.attack - def.defense;
    const chanceP = clamp(BASE_CHANCE * (1 + STRENGTH_K * edge), 0.002, 0.2);
    if (rng() >= chanceP) {
      continue; // isNothing() — the escape valve
    }

    stat[poss].shots++;
    const { outcome } = resolveShot(rng, off, def);

    if (outcome === "saved" || outcome === "goal") stat[poss].sot++;

    if (outcome === "goal") {
      bumpEvent();
      stat[poss].goals++;
      poss = defSide; // kickoff to conceding team
      continue;
    }

    if (
      (outcome === "blocked" || outcome === "off_target") &&
      rng() < CORNER_FROM_MISS_PROB
    ) {
      // Corner: one bonus shot, still gated through the normal cascade.
      bumpEvent();
      stat[poss].shots++;
      const { outcome: cornerOutcome } = resolveShot(rng, off, def);
      if (cornerOutcome === "saved" || cornerOutcome === "goal") stat[poss].sot++;
      if (cornerOutcome === "goal") {
        stat[poss].goals++;
        poss = defSide;
        continue;
      }
    }

    if (rng() < REBOUND_PROB) {
      // attacker keeps possession (poss unchanged)
    } else {
      poss = defSide;
    }
  }

  const totalTicks = stat.home.ticks + stat.away.ticks;
  return {
    home: stat.home.goals,
    away: stat.away.goals,
    possessionHome: totalTicks === 0 ? 0.5 : stat.home.ticks / totalTicks,
    stat,
  };
}

export interface DetailedMatchResult extends MatchResult {
  boxScore: BoxScore;
}

export interface SimMatchOptions {
  /**
   * Per-side hooks to re-roll normalized composites from the current on-pitch
   * group (spec §4: "before each match, and after subs/red cards"). Without a
   * hook, personnel changes fall back to the fixed man-down delta alone and
   * substitutions affect only stat attribution and energy.
   */
  recompute?: Partial<Record<Side, (onPitch: MatchPlayer[]) => Composites>>;
  /**
   * Played at a neutral venue: neither side gets `HOME_ATTACK_BONUS`.
   *
   * Only the promotion playoff final asks for this (a Wembley final, where
   * neither finalist is at home). Everything else leaves it unset and is
   * bit-identical to before — the flag changes a composite value, never a draw,
   * so an ordinary match's rng stream is untouched either way.
   *
   * `home`/`away` still mean something with it set: the box score, the event
   * feed and every stat line keep their sides. It is only the bonus that goes.
   */
  neutral?: boolean;
}

/**
 * Same gate cascade as simMatch, but with player-level attribution, plus fatigue
 * and substitutions (M5) which need player identity and so live only here —
 * simMatch (composite-only) is unaffected.
 *
 * Every shot picks a shooter; goals pick an optional assister; saves credit
 * the GK; turnovers credit a defender. No scoreline math changes.
 */
export function simMatchDetailed(
  rng: () => number,
  home: Composites,
  away: Composites,
  homePlayers: MatchPlayer[],
  awayPlayers: MatchPlayer[],
  homeBench: MatchPlayer[] = [],
  awayBench: MatchPlayer[] = [],
  opts: SimMatchOptions = {},
): DetailedMatchResult {
  // A neutral venue simply withholds the home bonus; `home`/`away` still label
  // the two sides everywhere else (box score, events, stat lines).
  const homeBonus = opts.neutral ? 0 : HOME_ATTACK_BONUS;
  const homeEff: Composites = {
    ...home,
    attack: clamp(home.attack + homeBonus),
  };
  const teams: Record<Side, Composites> = { home: homeEff, away };
  const manDown = { home: false, away: false };
  const yellowCounts = new Map<number, number>();

  // Currently on-pitch XI per side (mutated by red cards and substitutions).
  const onPitch: Record<Side, MatchPlayer[]> = { home: [...homePlayers], away: [...awayPlayers] };
  const bench: Record<Side, MatchPlayer[]> = { home: [...homeBench], away: [...awayBench] };
  const subsUsed = { home: 0, away: 0 };
  // In-play substitution opportunities each side has spent. Half-time does not
  // count against this, per the laws. Injury replacements don't either — they
  // fire immediately rather than at a window, so they are outside this system.
  const windowsUsed = { home: 0, away: 0 };
  /**
   * When each side may open a window, jittered per match so that not every club
   * in the world changes its team at the same four minutes. Managers pick their
   * own moments; without this the minute histogram is a handful of spikes with
   * nothing between them, which is both unrealistic and glaring in the live
   * match viewer.
   *
   * Drawn on its own hash off match intrinsics (the first man named in each
   * XI, which in any real lineup is the keeper), NEVER
   * the shared rng, so the draw order every other outcome depends on is
   * untouched — the same rule the cup rounds and touch attribution follow. It is
   * therefore also stable under a re-sim of a single match, which the live
   * viewer relies on.
   */
  function windowMomentsFor(side: Side): number[] {
    const seed = hashInts(
      homePlayers[0]?.pid ?? 0,
      awayPlayers[0]?.pid ?? 0,
      side === "home" ? 1 : 2,
      SUB_WINDOW_STREAM,
    );
    const draw = mulberry32(seed);
    return SUB_WINDOW_MOMENTS_ELAPSED
      // Half-time is a real fixed event and is never jittered; it is prepended
      // below rather than drawn from this list.
      .map((m) => m + (draw() * 2 - 1) * SUB_WINDOW_JITTER_SECONDS)
      .sort((a, b) => a - b);
  }

  // In-play moments only. Half-time is fired from the period boundary in the
  // main loop instead, so it lands at the actual break rather than at the start
  // of first-half stoppage — which is where an `elapsed >= 2700` test now puts it.
  const sideMoments: Record<Side, number[]> = {
    home: windowMomentsFor("home"),
    away: windowMomentsFor("away"),
  };
  // Fired per SIDE, not globally: the two sides no longer share their moments.
  const firedCheckpoints: Record<Side, Set<number>> = { home: new Set(), away: new Set() };

  const energy = new Map<number, number>();
  for (const p of [...homePlayers, ...awayPlayers, ...homeBench, ...awayBench]) {
    energy.set(p.pid, ENERGY_START);
  }

  const appeared: Record<Side, Set<number>> = {
    home: new Set(homePlayers.map((p) => p.pid)),
    away: new Set(awayPlayers.map((p) => p.pid)),
  };

  // Clock value (counts down from MATCH_SECONDS) at which each player entered
  // and left the match, for minutes-played math. Starters enter at kickoff;
  // a player with no exit entry was still on the pitch at the final whistle.
  const enterClock = new Map<number, number>();
  const exitClock = new Map<number, number>();
  for (const p of [...homePlayers, ...awayPlayers]) enterClock.set(p.pid, MATCH_SECONDS);

  /**
   * The slot each player actually filled, by pid. Starters get their formation
   * slot; a substitute records the slot he took over. Needed at full time
   * because the box score is built from the ORIGINAL roster arrays, where a
   * substitute still carries his bench slot (his own position).
   */
  const slotPlayed = new Map<number, MatchPosition>();
  for (const p of [...homePlayers, ...awayPlayers]) slotPlayed.set(p.pid, p.slot);

  const other = (side: Side): Side => (side === "home" ? "away" : "home");

  const stat = {
    home: { goals: 0, shots: 0, sot: 0, ticks: 0 } as TeamMatchStat,
    away: { goals: 0, shots: 0, sot: 0, ticks: 0 } as TeamMatchStat,
  };

  const lines = new Map<number, PlayerMatchLine>();
  for (const p of [...homePlayers, ...awayPlayers, ...homeBench, ...awayBench]) {
    lines.set(p.pid, emptyLine(p.pid));
  }

  const events: MatchEvent[] = [];

  let clock = MATCH_SECONDS;
  let poss: Side = rng() < 0.5 ? "home" : "away";

  /**
   * The two halves are real periods, each ending with its own stoppage.
   *
   * `clock` still counts down monotonically and still measures PLAYING TIME, so
   * everything built on it (minutes played, enter/exit clocks, the two-legged
   * split, which reads a jump back UP as the leg boundary) is untouched. What
   * changes is that it now runs past 0 by both halves' stoppage rather than
   * pausing at 90 — and that the first half's stoppage is played where it
   * happened instead of being carried to the end of the match.
   *
   * The displayed minute is therefore no longer `clock` alone: the second half
   * has to discount the stoppage already played in the first. That one number is
   * recorded on the box score (`firstHalfStoppage`) so every reader decodes the
   * same timeline; see liveMatch.ts's `eventMinute`.
   */
  let period: 1 | 2 = 1;
  /** Notable events in the CURRENT period — the board reads only its own half. */
  let periodEvents = 0;
  /** Clock this period genuinely lost to goal celebrations; credited back below. */
  let periodSecondsLost = 0;
  /** Countdown value at which this period's regulation time expires. */
  let regulationEndClock = HALF_SECONDS;
  /** Countdown value at which this period ends. Only meaningful once the board is up. */
  let periodEndClock = HALF_SECONDS;
  /** Has the fourth official shown this period's board yet? */
  let boardShown = false;
  /** First-half stoppage, in seconds. Fixed at the break; 0 until then. */
  let firstHalfStoppage = 0;

  const bumpEvent = () => {
    periodEvents++;
  };

  /**
   * Elapsed time on the clock a broadcast shows, in seconds — stoppage already
   * PLAYED in an earlier period does not advance it.
   *
   * Every rule phrased as "how far into the match are we" reads this rather than
   * raw elapsed playing time, so first-half stoppage cannot silently drag those
   * rules earlier in match terms than they were calibrated at.
   */
  const matchElapsedNow = (): number => MATCH_SECONDS - clock - firstHalfStoppage;

  /**
   * A goal costs clock, and the referee hands it back.
   *
   * Both halves of that are required. Consuming the time is what stops two goals
   * sharing a displayed minute (a tick is 2-10 seconds, so nothing else did);
   * crediting it to the half's stoppage is what keeps the amount of football in
   * a match unchanged, which is why this needed no rebalance.
   *
   * When the board is already up — a goal scored IN stoppage — the period is
   * extended rather than eaten into, which is both what referees do and what
   * stops a 90+1 winner truncating the passage it was scored in.
   */
  /** Put this period's board up (or revise it), always on a whole minute. */
  const showBoard = () => {
    const stoppage = computeStoppageSeconds(periodEvents, periodSecondsLost);
    periodEndClock = regulationEndClock - stoppage;
    if (period === 1) firstHalfStoppage = stoppage;
  };

  const celebrate = () => {
    const restart =
      GOAL_RESTART_MIN_SECONDS + rng() * (GOAL_RESTART_MAX_SECONDS - GOAL_RESTART_MIN_SECONDS);
    clock -= restart;
    periodSecondsLost += restart;
    // A goal scored after the board went up revises it rather than eating into
    // it — what referees do, and what stops a 90+1 winner cutting short the
    // passage it was scored in. Recomputed rather than nudged, so the board stays
    // a whole number of minutes; the inputs only ever grow, so it never shrinks.
    if (boardShown) showBoard();
  };

  /**
   * Re-roll a side's composites from its current on-pitch group after any
   * personnel change (sub, red card, unreplaced injury), per spec §4. The
   * man-down delta and home attack bonus are re-applied on top. No-op when the
   * caller supplied no recompute hook (composites then only change via the
   * fixed man-down delta, applied at the call sites).
   */
  function rebuildTeam(side: Side): void {
    const rc = opts.recompute?.[side];
    if (!rc) return;
    let c = rc(onPitch[side]);
    if (side === "home") c = { ...c, attack: clamp(c.attack + homeBonus) };
    teams[side] = manDown[side] ? applyManDown(c) : c;
  }

  const avgEnergy = (side: Side): number => {
    const xi = onPitch[side];
    if (xi.length === 0) return ENERGY_START;
    let sum = 0;
    for (const p of xi) sum += energy.get(p.pid)!;
    return sum / xi.length;
  };

  /**
   * A fresh bench player's value if brought on: his ovr, plus a small bonus for
   * fresh legs, plus the user's "give him more minutes" boost when flagged. Used
   * both to pick the *best* replacement and to gate whether the sub is worth it.
   */
  function benchValue(p: MatchPlayer): number {
    return p.ovr + SUB_FRESHNESS_BONUS + (p.minutesBoost ? SUB_MINUTES_BOOST : 0);
  }

  /**
   * An on-pitch player's value for the sub decision: his ovr, adjusted for how
   * he is actually playing this match (live match rating against the 6.0
   * baseline). Deliberately excludes fatigue, which lives in the allowance
   * below — a starter having a stormer protects himself, one having a shocker
   * is easier to justify hooking, at any point in the match.
   */
  function gateValueOf(side: Side, p: MatchPlayer): number {
    const form = (liveRatingFor(side, p) - RATING_BASELINE) / 10;
    return p.ovr + SUB_GATE_RATING_INFLUENCE * form;
  }

  /**
   * How much of a downgrade the side will accept to make this change. In play
   * that is the standing margin, plus a relief that grows with how gassed the
   * outgoing player is, plus what the shortness of the remaining match is worth.
   *
   * At half-time it is none of those. Nobody is gassed at 45', there is a whole
   * half still to play, and fresh legs buy nothing against a man who has run for
   * forty-five minutes — so a half-time change has to be a genuine upgrade
   * rather than a rest. Without that split the free half-time window is a free
   * lunch and every side in the world takes it: measured, half-time alone
   * produced 1.46 changes per team per match against a real rate nearer 0.4.
   */
  function subAllowance(p: MatchPlayer, atHalfTime: boolean): number {
    if (atHalfTime) return SUB_HALFTIME_MARGIN;
    const fatigue = (ENERGY_START - energy.get(p.pid)!) / (ENERGY_START - ENERGY_FLOOR);
    return SUB_QUALITY_MARGIN + SUB_FATIGUE_RELIEF * fatigue + lateAllowance();
  }

  /**
   * Extra downgrade tolerated because there is little match left to play. The
   * quality comparison is between two ovr values with no reference to duration,
   * which silently prices every swap as though the replacement will play the
   * rest of the match; a man brought on at 85' degrades five minutes of
   * composites, not forty-five. Growing the tolerance as the clock runs out is
   * that correction, and it is what produces the ordinary late change for a
   * fringe player. Clamped at 1 because stoppage pushes elapsed past the 90.
   *
   * Reads MATCH time, not playing time: "how much match is left" is a question
   * about the clock on the wall, and counting first-half stoppage twice would
   * make every second-half sub look later than it is.
   */
  function lateAllowance(): number {
    const elapsedFraction = clamp(matchElapsedNow() / MATCH_SECONDS, 0, 1);
    return SUB_LATE_MARGIN * elapsedFraction ** SUB_LATE_MARGIN_EXPONENT;
  }

  /**
   * Only sub when the fresh replacement roughly matches or beats the man he'd
   * replace — priced for the SLOT he'd be filling, not in the abstract. A bench
   * striker who'd have to cover at centre-back has to be better by more than
   * that costs him, otherwise the tired centre-back stays on. This must use the
   * same penalty the composite rollup does; if the gate were cheaper about
   * position than the rollup, the sim would keep making swaps it then punishes.
   *
   * The freshness bonus is withdrawn at half-time for the reason the allowance
   * is: fresh legs are worth something against a tired man, and nothing against
   * one who is not yet tired.
   */
  function worthSub(
    side: Side,
    on: MatchPlayer,
    off: MatchPlayer,
    atHalfTime: boolean,
  ): boolean {
    const onValue = benchValueAt(on, off.slot) - (atHalfTime ? SUB_FRESHNESS_BONUS : 0);
    return onValue >= gateValueOf(side, off) - subAllowance(off, atHalfTime);
  }

  /**
   * A bench player's worth *for a particular slot*: his quality less what it
   * costs him to play there. This is why the bench no longer answers a tired
   * centre-back with its best available striker — a good striker is only worth
   * putting at the back if he is better by more than the position costs him.
   */
  function benchValueAt(p: MatchPlayer, slot: MatchPlayer["slot"]): number {
    return benchValue(p) - familiarityPenalty(slot, p.pos, p.secondary);
  }

  /**
   * Pick the best bench replacement for a departing player's SLOT, trading
   * quality off against positional fit rather than treating an exact fit as
   * all-or-nothing. Keepers and outfielders never cover for each other unless
   * the bench holds nothing else. Flagged "more minutes" players are favored
   * via their benchValue bonus.
   */
  function pickReplacement(side: Side, slot: MatchPlayer["slot"]): MatchPlayer | undefined {
    const pool = slot === "GK"
      ? bench[side]
      : bench[side].filter((p) => p.pos !== "GK");
    const usable = pool.length > 0 ? pool : bench[side];
    if (usable.length === 0) return undefined;
    return usable.reduce((best, p) => (benchValueAt(p, slot) > benchValueAt(best, slot) ? p : best));
  }

  /** Minutes played so far by a still-on-pitch player, for a live (mid-match) rating estimate. */
  function liveMinutesFor(pid: number): number {
    // Match minutes, not playing time — see engine/matchTime.ts. Counting playing
    // time here made a starter at the 60th minute read 60 plus the first half's
    // stoppage, loosening the rating damping behind second-half subs.
    const enter = enterClock.get(pid) ?? MATCH_SECONDS;
    return matchMinutesBetween(enter, clock, firstHalfStoppage);
  }

  /** How well a still-on-pitch player is playing so far (0-10 live match rating). */
  function liveRatingFor(side: Side, p: MatchPlayer): number {
    return computeMatchRating(
      lines.get(p.pid)!,
      p.slot,
      liveMinutesFor(p.pid),
      stat[other(side)].goals,
    );
  }

  /**
   * Higher = more likely to be subbed off: fatigue (energy deficit) is the primary
   * driver, nudged by how well the player is performing so far (live match rating,
   * per spec's Match Rating feature) — a tired player having a great game is less
   * likely to be pulled than an equally tired one having a poor game, and vice versa.
   */
  function subPriority(side: Side, p: MatchPlayer): number {
    const energyDeficit = ENERGY_START - energy.get(p.pid)!;
    const ratingDeficit = (RATING_BASELINE - liveRatingFor(side, p)) / 10;
    return energyDeficit + SUB_RATING_INFLUENCE * ratingDeficit;
  }

  /**
   * Carry out a substitution: swap `off` for `on`, refresh energy, log the event.
   * The man coming on takes over the slot of the man going off — he is filling a
   * hole in the shape, not importing his own. A COPY carries the new slot rather
   * than mutating the bench MatchPlayer, because those objects are shared across
   * every match a TeamMatchData is used for (season.ts builds it once for all 380
   * fixtures); mutating one would leak a slot into unrelated matches.
   */
  function commitSub(side: Side, off: MatchPlayer, on: MatchPlayer, reshape = false): void {
    // `reshape` marks a deliberate change of shape rather than a like-for-like
    // swap: the man coming on plays his OWN position and the team simply lines
    // up differently (one fewer defender, one more attacker). That is what a
    // chase-the-game substitution actually is, and it keeps the gamble honest —
    // you really do gain an attacker and really do lose a defender, instead of
    // stranding a striker at centre-back and being penalized for both.
    const slot = reshape ? on.pos : off.slot;
    const arriving = on.slot === slot ? on : { ...on, slot };
    slotPlayed.set(on.pid, slot);
    onPitch[side] = onPitch[side].filter((p) => p.pid !== off.pid).concat(arriving);
    bench[side] = bench[side].filter((p) => p.pid !== on.pid);
    subsUsed[side]++;
    appeared[side].add(on.pid);
    energy.set(on.pid, ENERGY_START);
    exitClock.set(off.pid, clock);
    enterClock.set(on.pid, clock);
    rebuildTeam(side);
    bumpEvent();
    events.push({ clock, type: "substitution", side, pids: [off.pid, on.pid] });
  }

  /**
   * Open a substitution window for a side and make as many changes as it can
   * justify, up to SUB_MAX_PER_WINDOW. A window is the unit the laws actually
   * count: bringing on three players at once costs a manager one opportunity,
   * not three, which is why this loops rather than making a single swap the way
   * the old fixed checkpoints did. A window that produces no change costs
   * nothing — you only spend an opportunity by using it.
   */
  function runSubWindow(side: Side, moment: number): void {
    const halfTime = moment === SUB_WINDOW_HALFTIME_ELAPSED;
    if (!halfTime && windowsUsed[side] >= SUB_WINDOWS_IN_PLAY) return;

    // Chasing the game is the last roll of the dice, so it belongs to the final
    // moment only — and a side that has already spent its three opportunities
    // has nothing left to chase with, which is the cost of using them early.
    const own = sideMoments[side];
    const lastMoment = moment === own[own.length - 1];

    let made = 0;
    // The reshape gamble strips a defender for an attacker; doing it twice in
    // one window would tear the shape apart, so it is offered once and the rest
    // of the window falls back to ordinary like-for-like changes.
    let chaseAllowed = lastMoment;
    while (
      made < SUB_MAX_PER_WINDOW &&
      subsUsed[side] < MAX_SUBS &&
      bench[side].length > 0
    ) {
      const outcome = trySingleSub(side, chaseAllowed, halfTime);
      if (outcome === "none") break;
      if (outcome === "chase") chaseAllowed = false;
      made++;
    }
    if (made > 0 && !halfTime) windowsUsed[side]++;
  }

  /**
   * One swap inside an open window. Reports which kind of change it made so the
   * caller can retire the chase-the-game option after it has been taken.
   */
  function trySingleSub(
    side: Side,
    chaseAllowed: boolean,
    atHalfTime: boolean,
  ): "chase" | "normal" | "none" {
    const outfield = onPitch[side].filter((p) => p.slot !== "GK");
    if (outfield.length === 0) return "none";

    const worstSubPriority = (candidates: MatchPlayer[]): MatchPlayer =>
      candidates.reduce((worst, p) =>
        subPriority(side, p) > subPriority(side, worst) ? p : worst,
      );

    // Attacking sub: when trailing late, throw on the bench's best finisher for a
    // defensive-minded player. This is a deliberate chase-the-game gamble, so it
    // bypasses the quality gate below (you accept a downgrade to add attack).
    const trailing = stat[side].goals < stat[other(side)].goals;
    if (chaseAllowed && trailing) {
      const defensive = outfield.filter((p) => p.slot === "CB" || p.slot === "FB" || p.slot === "DM");
      const off = worstSubPriority(defensive.length > 0 ? defensive : outfield);
      const outfieldBench = bench[side].filter((p) => p.pos !== "GK");
      const on = outfieldBench.length > 0
        ? outfieldBench.reduce((best, p) => (p.shooting > best.shooting ? p : best))
        : undefined;
      if (!on) return "none";
      commitSub(side, off, on, true);
      return "chase";
    }

    // "Give more minutes": if the user flagged a bench player, try to get him on
    // by subbing off the weakest on-pitch player at his position (or the weakest
    // outfielder if none share it). His minutesBoost helps clear the worth-it gate.
    const flagged = bench[side].filter((p) => p.pos !== "GK" && p.minutesBoost);
    if (flagged.length > 0) {
      const on = flagged.reduce((best, p) => (benchValue(p) > benchValue(best) ? p : best));
      const samePos = outfield.filter((p) => p.slot === on.pos);
      const off = worstSubPriority(samePos.length > 0 ? samePos : outfield);
      if (worthSub(side, on, off, atHalfTime)) {
        commitSub(side, off, on);
        return "normal";
      }
      // Not worth it even with the boost — fall through to a normal sub.
    }

    // Normal sub: rest the worst-priority outfielder, but only if the best fresh
    // replacement is actually worth bringing on (a weak bench keeps the tired
    // starter on rather than downgrading itself).
    const off = worstSubPriority(outfield);
    const on = pickReplacement(side, off.slot);
    if (on && worthSub(side, on, off, atHalfTime)) {
      commitSub(side, off, on);
      return "normal";
    }
    return "none";
  }

  /**
   * An injured player must come off immediately, regardless of energy — unlike a
   * window, the outgoing player is fixed and the change fires the instant it is
   * needed rather than at one of the side's opportunities. It still counts
   * against MAX_SUBS, so a side that has spent all five plays on a man down.
   */
  function forceInjurySub(side: Side, offPid: number): void {
    const off = onPitch[side].find((p) => p.pid === offPid);
    if (!off) return;
    onPitch[side] = onPitch[side].filter((p) => p.pid !== offPid);
    exitClock.set(off.pid, clock);

    const on = subsUsed[side] < MAX_SUBS ? pickReplacement(side, off.slot) : undefined;
    if (on) {
      const arriving = on.slot === off.slot ? on : { ...on, slot: off.slot };
      slotPlayed.set(on.pid, off.slot);
      onPitch[side] = onPitch[side].concat(arriving);
      bench[side] = bench[side].filter((p) => p.pid !== on.pid);
      subsUsed[side]++;
      appeared[side].add(on.pid);
      energy.set(on.pid, ENERGY_START);
      enterClock.set(on.pid, clock);
      bumpEvent();
      events.push({ clock, type: "substitution", side, pids: [off.pid, on.pid] });
    } else if (!manDown[side]) {
      // No valid sub available: play the rest of the match a man down.
      // Applied once per side, matching the red-card semantics.
      manDown[side] = true;
      teams[side] = applyManDown(teams[side]);
    }
    rebuildTeam(side);
  }

  for (;;) {
    const dt = MIN_DT + rng() * (MAX_DT - MIN_DT);
    clock -= dt;
    /**
     * The clock a broadcast would show, in seconds: stoppage already PLAYED in
     * an earlier period does not advance it. Substitution windows are keyed on
     * this rather than on raw elapsed time, so every moment in
     * SUB_WINDOW_MOMENTS_ELAPSED still fires at the match minute it names —
     * without this, inserting first-half stoppage would silently drag every
     * second-half window two-odd minutes earlier than #354 measured them.
     */
    const matchElapsed = matchElapsedNow();

    if (!boardShown && clock <= regulationEndClock) {
      boardShown = true;
      showBoard();
    }
    if (boardShown && clock <= periodEndClock) {
      // Snap to the whistle. A goal's restart can overshoot the end of a period
      // by most of a minute, and left unsnapped that lands in `finalClock` and
      // inflates everyone's minutes played.
      clock = periodEndClock;
      if (period === 2) break;

      // Half time. The second half's regulation runs another HALF_SECONDS from
      // here, so the break's clock is its own reference point.
      period = 2;
      regulationEndClock = clock - HALF_SECONDS;
      periodEndClock = regulationEndClock;
      boardShown = false;
      periodEvents = 0;
      periodSecondsLost = 0;
      // Fired here rather than from sideMoments, so it lands at the real break
      // instead of at the start of first-half stoppage. runSubWindow keys its
      // no-fatigue-relief rules off this exact constant.
      for (const side of ["home", "away"] as const) {
        runSubWindow(side, SUB_WINDOW_HALFTIME_ELAPSED);
      }
      continue;
    }

    for (const side of ["home", "away"] as const) {
      for (const p of onPitch[side]) {
        const next = energy.get(p.pid)! - decayPerSecond(p.stamina) * dt;
        energy.set(p.pid, clamp(next, ENERGY_FLOOR, ENERGY_START));
      }
    }

    for (const side of ["home", "away"] as const) {
      for (const moment of sideMoments[side]) {
        if (!firedCheckpoints[side].has(moment) && matchElapsed >= moment) {
          firedCheckpoints[side].add(moment);
          runSubWindow(side, moment);
        }
      }
    }

    const defSide: Side = poss === "home" ? "away" : "home";
    const off = applyFatigue(teams[poss], avgEnergy(poss));
    let def = applyFatigue(teams[defSide], avgEnergy(defSide));
    stat[poss].ticks++;

    const turnoverP = clamp(
      TURNOVER_BASE * (1 + 0.6 * (def.defense - off.control)),
      0.02,
      0.5,
    );
    if (rng() < turnoverP) {
      const creditRoll = rng();
      let tacklerPid: number | null = null;
      if (creditRoll < TACKLE_CREDIT_PROB) {
        const tackler = pickTackler(rng, onPitch[defSide]);
        lines.get(tackler.pid)!.tackles++;
        tacklerPid = tackler.pid;
      } else if (creditRoll < TACKLE_CREDIT_PROB + INTERCEPTION_CREDIT_PROB) {
        const tackler = pickInterceptor(rng, onPitch[defSide]);
        lines.get(tackler.pid)!.interceptions++;
        tacklerPid = tackler.pid;
      }
      // No-credit turnovers skip player selection entirely — BoxScore.tsx
      // filters all "turnover" events out of the displayed play-by-play, so
      // there's no consumer of a pid here to justify the weighted-pick cost.
      events.push({ clock, type: "turnover", side: defSide, pids: tacklerPid !== null ? [tacklerPid] : [] });

      if (rng() < INJURY_PROB_ON_TACKLE) {
        const carrier = pickCarrier(rng, onPitch[poss]);
        bumpEvent();
        events.push({ clock, type: "injury", side: poss, pids: [carrier.pid] });
        forceInjurySub(poss, carrier.pid);
      }

      poss = defSide;
      continue;
    }

    if (rng() < FOUL_BASE) {
      const fouler = pickFouler(rng, onPitch[defSide]);
      lines.get(fouler.pid)!.foulsCommitted++;
      const cardRoll = rng();
      if (cardRoll < RED_STRAIGHT_GIVEN_FOUL) {
        lines.get(fouler.pid)!.redCards++;
        onPitch[defSide] = onPitch[defSide].filter((p) => p.pid !== fouler.pid);
        exitClock.set(fouler.pid, clock);
        if (!manDown[defSide]) {
          manDown[defSide] = true;
          teams[defSide] = applyManDown(teams[defSide]);
        }
        rebuildTeam(defSide);
        bumpEvent();
        events.push({ clock, type: "red_card", side: defSide, pids: [fouler.pid] });
      } else if (cardRoll < RED_STRAIGHT_GIVEN_FOUL + YELLOW_GIVEN_FOUL) {
        const priorYellows = yellowCounts.get(fouler.pid) ?? 0;
        yellowCounts.set(fouler.pid, priorYellows + 1);
        lines.get(fouler.pid)!.yellowCards++;
        bumpEvent();
        events.push({ clock, type: "yellow_card", side: defSide, pids: [fouler.pid] });
        if (priorYellows + 1 >= 2) {
          lines.get(fouler.pid)!.redCards++;
          onPitch[defSide] = onPitch[defSide].filter((p) => p.pid !== fouler.pid);
          exitClock.set(fouler.pid, clock);
          if (!manDown[defSide]) {
            manDown[defSide] = true;
            teams[defSide] = applyManDown(teams[defSide]);
          }
          rebuildTeam(defSide);
          bumpEvent();
          events.push({ clock, type: "red_card", side: defSide, pids: [fouler.pid] });
        }
      }

      // A red card just issued this tick may have mutated teams[defSide] above —
      // re-derive the fatigue-adjusted defensive composite so the free-kick/penalty
      // odds for this same foul reflect the man-down side, not the stale pre-card one.
      def = applyFatigue(teams[defSide], avgEnergy(defSide));

      // Edge-scaled so a fraction of fouls happen "in the box" (penalty) vs the
      // open-play free kick below — same reasoning as the composite-only version.
      const freeKickEdge = off.attack - def.defense;
      const penaltyP = clamp(
        PENALTY_GIVEN_FOUL * (1 + STRENGTH_K * freeKickEdge),
        0.001,
        0.08,
      );
      if (rng() < penaltyP) {
        const shooter = pickShooter(rng, onPitch[poss]);
        const shooterLine = lines.get(shooter.pid)!;
        stat[poss].shots++;
        shooterLine.shots++;

        bumpEvent();
        events.push({ clock, type: "penalty", side: poss, pids: [shooter.pid] });

        // Conversion hinges on the actual taker vs. the actual keeper (both
        // 0..100 ratings), not the fatigue-adjusted team composites — the
        // taker picked by pickShooter is the one who shoots.
        const gk = onPitch[defSide].find((p) => p.slot === "GK");
        const gkKeeping = gk ? gk.keeping : 50;
        const goalP = clamp(
          PENALTY_CONVERSION *
            (1 + 0.15 * (shooter.shooting / 100 - 0.5) - 0.15 * (gkKeeping / 100 - 0.5)),
          0.55,
          0.9,
        );
        // xG excludes the taker's own shooting rating, same reasoning as
        // resolveShot's xgOnTargetP/xgSaveP: an ace penalty-taker's spot
        // kicks shouldn't score higher xG just because he's an ace, or he'd
        // never show up as beating expectation. goalP (with his rating)
        // still drives the actual roll below.
        const xgP = clamp(PENALTY_CONVERSION * (1 - 0.15 * (gkKeeping / 100 - 0.5)), 0.55, 0.9);
        shooterLine.xg += xgP;
        if (rng() < goalP) {
          stat[poss].sot++;
          shooterLine.shotsOnTarget++;
          stat[poss].goals++;
          shooterLine.goals++;
          events.push({ clock, type: "goal", side: poss, pids: [shooter.pid] });
          celebrate();
          poss = defSide;
        } else if (rng() < PENALTY_MISS_SAVED_PROB) {
          stat[poss].sot++;
          shooterLine.shotsOnTarget++;
          if (gk) lines.get(gk.pid)!.saves++;
          events.push({ clock, type: "shot_saved", side: poss, pids: [shooter.pid] });
        } else {
          events.push({ clock, type: "shot_off_target", side: poss, pids: [shooter.pid] });
        }
        continue;
      }

      // free kick: bonus shot chance for the fouled (attacking) side, same tick.
      // Scaled by the same attack-vs-defense edge as the main chance gate, so it
      // doesn't dilute skill-driven spread by handing weak sides "free" chances.
      const freeKickP = clamp(
        FREE_KICK_CHANCE_BASE * (1 + STRENGTH_K * freeKickEdge),
        0.01,
        0.3,
      );
      if (rng() < freeKickP) {
        const shooter = pickShooter(rng, onPitch[poss]);
        const shooterLine = lines.get(shooter.pid)!;
        stat[poss].shots++;
        shooterLine.shots++;

        const { outcome, xg } = resolveShot(
          rng, off, def, finisherAdj(shooter, onPitch[poss], "shooting"),
        );
        shooterLine.xg += xg;
        if (outcome === "saved" || outcome === "goal") {
          stat[poss].sot++;
          shooterLine.shotsOnTarget++;
        }
        if (outcome === "saved") {
          const gk = onPitch[defSide].find((p) => p.slot === "GK");
          if (gk) lines.get(gk.pid)!.saves++;
        }
        events.push({ clock, type: eventTypeFromShot(outcome), side: poss, pids: [shooter.pid] });
        if (outcome === "goal") {
          // Bumps as well as celebrating; see the open-play goal for why that is
          // not the double-count it looks like.
          bumpEvent();
          stat[poss].goals++;
          shooterLine.goals++;
          celebrate();
          poss = defSide;
        }
      }
      continue;
    }

    const edge = off.attack - def.defense;
    const chanceP = clamp(BASE_CHANCE * (1 + STRENGTH_K * edge), 0.002, 0.2);
    if (rng() >= chanceP) {
      continue;
    }

    const shooter = pickShooter(rng, onPitch[poss]);
    const shooterLine = lines.get(shooter.pid)!;
    stat[poss].shots++;
    shooterLine.shots++;

    const { outcome, xg } = resolveShot(
      rng, off, def, finisherAdj(shooter, onPitch[poss], "shooting"),
    );
    shooterLine.xg += xg;

    if (outcome === "saved" || outcome === "goal") {
      stat[poss].sot++;
      shooterLine.shotsOnTarget++;
    }

    if (outcome === "saved") {
      const gk = onPitch[defSide].find((p) => p.slot === "GK");
      if (gk) lines.get(gk.pid)!.saves++;
    }

    const evtType = eventTypeFromShot(outcome);
    const pids = [shooter.pid];

    if (outcome === "goal") {
      // A goal bumps like any other notable event AND pays its celebration. That
      // reads like double-counting and was removed on exactly that reasoning,
      // then measured and put back: dropping it buys 24 seconds of displayed
      // stoppage and deletes 1.1% of the match's football (shots/match -0.3% ->
      // -1.1% against the merge base), because on the old model a goal credited
      // 20s and cost nothing, so those seconds were part of the scoring
      // calibration. The flat allowance is not "celebration time" — it is the
      // regrouping and the walk back that follow one.
      bumpEvent();
      stat[poss].goals++;
      shooterLine.goals++;

      const assister = pickAssister(rng, onPitch[poss], shooter.pid);
      if (assister) {
        lines.get(assister.pid)!.assists++;
        pids.push(assister.pid);
      }

      events.push({ clock, type: evtType, side: poss, pids });
      celebrate();
      poss = defSide;
      continue;
    }

    events.push({ clock, type: evtType, side: poss, pids });

    if (
      (outcome === "blocked" || outcome === "off_target") &&
      rng() < CORNER_FROM_MISS_PROB
    ) {
      bumpEvent();
      events.push({ clock, type: "corner", side: poss, pids: [] });
      const header = pickHeader(rng, onPitch[poss]);
      const headerLine = lines.get(header.pid)!;
      stat[poss].shots++;
      headerLine.shots++;

      const { outcome: cornerOutcome, xg: cornerXg } = resolveShot(
        rng, off, def, finisherAdj(header, onPitch[poss], "heading"),
      );
      headerLine.xg += cornerXg;
      if (cornerOutcome === "saved" || cornerOutcome === "goal") {
        stat[poss].sot++;
        headerLine.shotsOnTarget++;
      }
      if (cornerOutcome === "saved") {
        const gk = onPitch[defSide].find((p) => p.slot === "GK");
        if (gk) lines.get(gk.pid)!.saves++;
      }

      const cornerPids = [header.pid];
      if (cornerOutcome === "goal") {
        stat[poss].goals++;
        headerLine.goals++;
        const assister = pickAssister(rng, onPitch[poss], header.pid);
        if (assister) {
          lines.get(assister.pid)!.assists++;
          cornerPids.push(assister.pid);
        }
        events.push({ clock, type: "goal", side: poss, pids: cornerPids });
        celebrate();
        poss = defSide;
        continue;
      }
      events.push({ clock, type: eventTypeFromShot(cornerOutcome), side: poss, pids: cornerPids });
    }

    if (rng() < REBOUND_PROB) {
      // attacker keeps possession
    } else {
      poss = defSide;
    }
  }

  const totalTicks = stat.home.ticks + stat.away.ticks;

  const finalClock = clock;
  // Minutes on the MATCH clock, which holds at 45:00 and 90:00 through stoppage,
  // so a full match is 90 — see engine/matchTime.ts.
  const minutesFor = (pid: number): number => {
    const enter = enterClock.get(pid) ?? MATCH_SECONDS;
    const exit = exitClock.get(pid) ?? finalClock;
    return matchMinutesBetween(enter, exit, firstHalfStoppage);
  };

  // Goalkeepers can't currently be subbed off mid-match (see the landmine
  // noted in matchSim.ts's history), so exactly one GK per side plays the
  // whole game — the team's full-match goals conceded and the opponent's
  // full-match attacking xG can both be attributed to him directly, with no
  // need to track either per-shot.
  const teamXg = (roster: MatchPlayer[]): number =>
    roster.reduce((sum, p) => sum + (lines.get(p.pid)?.xg ?? 0), 0);

  const homeRosterAll = [...homePlayers, ...homeBench];
  const awayRosterAll = [...awayPlayers, ...awayBench];
  const homeXgTotal = teamXg(homeRosterAll);
  const awayXgTotal = teamXg(awayRosterAll);

  // Decorative passes/crosses, attributed on a separate rng stream seeded from
  // match-intrinsic values already fixed by the completed sim — never touches
  // the main `rng`, so the scoreline and every other stat stay bit-identical.
  // `home`/`away` are the pre-fatigue normalized composites (team passing quality).
  const touchSide = (roster: MatchPlayer[], appearedSet: Set<number>, control: number, ticks: number): TouchSide => ({
    players: roster
      .filter((p) => appearedSet.has(p.pid))
      .map((p) => ({ pid: p.pid, pos: p.pos, minutes: minutesFor(p.pid) })),
    ticks,
    control,
  });
  const attrSeed = hashInts(
    homePlayers[0]?.pid ?? 0,
    awayPlayers[0]?.pid ?? 0,
    stat.home.ticks,
    stat.away.ticks,
    stat.home.goals,
    stat.away.goals,
    stat.home.shots,
    stat.away.shots,
  );
  attributeTouchStats(
    lines,
    touchSide(homeRosterAll, appeared.home, home.control, stat.home.ticks),
    touchSide(awayRosterAll, appeared.away, away.control, stat.away.ticks),
    attrSeed,
  );

  const finishLines = (
    roster: MatchPlayer[],
    appearedSet: Set<number>,
    teamGoalsAgainst: number,
    teamXga: number,
  ): PlayerMatchLine[] =>
    roster
      .filter((p) => appearedSet.has(p.pid))
      .map((p) => {
        const line = lines.get(p.pid)!;
        line.minutesPlayed = minutesFor(p.pid);
        // Judge him on the job he actually did, not on what kind of player he
        // is: a defender who spent 20 minutes at centre-forward is rated as a
        // centre-forward for those minutes.
        const slot = slotPlayed.get(p.pid) ?? p.slot;
        // Recorded, not merely used: the lineup surfaces name a formation from
        // the starters' slots, and nothing else in the save remembers what
        // shape a club lined up in on the day.
        line.slot = slot;
        if (slot === "GK") {
          line.goalsAgainst = teamGoalsAgainst;
          line.xga = teamXga;
        }
        line.rating = computeMatchRating(line, slot, line.minutesPlayed, teamGoalsAgainst);
        return line;
      });

  const homeLines = finishLines(homeRosterAll, appeared.home, stat.away.goals, awayXgTotal);
  const awayLines = finishLines(awayRosterAll, appeared.away, stat.home.goals, homeXgTotal);

  return {
    home: stat.home.goals,
    away: stat.away.goals,
    possessionHome: totalTicks === 0 ? 0.5 : stat.home.ticks / totalTicks,
    stat,
    boxScore: {
      home: homeLines,
      away: awayLines,
      events,
      finalClock,
      firstHalfStoppage,
    },
  };
}
