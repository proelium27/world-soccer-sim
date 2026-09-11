/**
 * What a card was for, and where a shot came from.
 *
 * DERIVED FROM THE EVENT STREAM, NEVER STORED. A reason is a pure function of
 * things the box score already records — the offender, the clock, the score at
 * that moment, and which other events share the tick — so it costs nothing on
 * disk, takes no rng draw, can never drift from the match it describes, and
 * appears on every save that already exists. Storing a string on ~2.3 yellows
 * and ~31 shots a match would have added roughly 5% to the largest field in a
 * save, forever, for something reconstructable.
 *
 * THE HONESTY RULE, AND IT IS WHAT MAKES THIS MORE THAN FLAVOUR TEXT.
 *
 * The engine rolls FOUL_BASE for "the defending side did something illegal" and
 * only then decides whether it produced a penalty or a free-kick chance. Measured
 * from the constants, FREE_KICK_CHANCE_BASE is 0.05 and the penalty chance is
 * smaller still, so the overwhelming majority of fouls yield NO set piece at all.
 * That matters here: an offence that conceded nothing is unconstrained and can
 * honestly be time-wasting, dissent or a handball, while an offence that produced
 * a penalty must be a foul in the area and nothing else. So the reason is picked
 * from the set of offences CONSISTENT with what the sim actually did, rather than
 * being decoration sprayed over it.
 *
 * The corollary is the rule for adding to these lists: an entry has to be
 * something the tick it is attached to could really have been. "Denies a
 * goalscoring opportunity" is a red and is only offered when a penalty was
 * given; "second bookable offence" is read off the player's own earlier card
 * rather than guessed.
 *
 * Deterministic: the same card always reads the same way, on the live feed and
 * in the box score, because the choice is a hash of the event's own intrinsics.
 */
import type { MatchEvent, MatchPosition } from "../engine/attribution.js";
import { hashInts } from "../engine/rng.js";

/** Keeps these draws clear of every other hashed stream in the game. */
const NARRATION_STREAM = 613;

function pick<T>(options: readonly T[], ...seed: number[]): T {
  return options[hashInts(...seed, NARRATION_STREAM) % options.length];
}

/* ---------------------------------------------------------------------------
   Cards
   --------------------------------------------------------------------------- */

/** Offences that conceded a free kick in a dangerous spot — a challenge, always. */
const CHALLENGE_FOULS = [
  "late challenge",
  "trips the runner",
  "clumsy challenge",
  "pulls the shirt",
  "catches him on the follow-through",
] as const;

/** An offence that stopped a promising move. Only offered away from goal. */
const TACTICAL_FOULS = [
  "tactical foul, breaks up the counter",
  "cynical trip to stop the break",
  "hauls him back as the move built",
] as const;

/**
 * Offences with no set piece attached, so the tick is unconstrained. Time-wasting
 * and dissent live here and ONLY here — a booking that conceded a penalty cannot
 * have been either.
 */
const LOOSE_OFFENCES = [
  "dissent",
  "arguing with the referee",
  "handball",
  "persistent fouling",
  "encroaching at the free kick",
] as const;

/** Only reachable while a side is protecting a lead late on. */
const TIME_WASTING = [
  "time wasting",
  "taking too long over the restart",
  "kicks the ball away",
] as const;

export interface CardContext {
  /** Events sharing this card's tick — a penalty or a shot pins what it was. */
  sameTick: MatchEvent[];
  /** Goals this side had scored, less those conceded, when the card was shown. */
  leadAtTime: number;
  /** Playing-time minute, for judging "late". */
  minute: number;
  /** True when this player had already been booked — so the red is automatic. */
  alreadyBooked: boolean;
  /** How far into the match, 0..1, so "late" survives a change in match length. */
  matchFraction: number;
}

/**
 * Why a yellow was shown. Returns null when nothing sensible can be said, which
 * callers render as a bare "Yellow card" rather than inventing something.
 */
export function yellowCardReason(event: MatchEvent, ctx: CardContext): string | null {
  const conceded = ctx.sameTick.find((e) => e.type === "penalty");
  if (conceded) return "foul in the penalty area";

  // A free kick was awarded in a shooting position: this was a challenge.
  const gaveFreeKick = ctx.sameTick.some(
    (e) => e.side !== event.side && e.type.startsWith("shot_"),
  );
  const seed = [event.pids[0] ?? 0, Math.round(event.clock)];

  if (gaveFreeKick) return pick(CHALLENGE_FOULS, ...seed);

  // Protecting a lead in the closing stages is when a referee books someone for
  // slowing the game down, and it is the one reason that needs the score.
  const late = ctx.matchFraction >= 0.8;
  if (late && ctx.leadAtTime > 0) {
    return pick([...TIME_WASTING, ...LOOSE_OFFENCES], ...seed);
  }
  // Chasing the game, a booking is far more likely to be a challenge.
  if (ctx.leadAtTime < 0) {
    return pick([...TACTICAL_FOULS, ...CHALLENGE_FOULS], ...seed);
  }
  return pick([...LOOSE_OFFENCES, ...TACTICAL_FOULS, ...CHALLENGE_FOULS], ...seed);
}

/**
 * Why a red was shown.
 *
 * The second-yellow case is READ, not guessed: the engine sends a player off the
 * moment his second booking lands, so his own earlier card in the same stream
 * settles it. Denying a goalscoring opportunity is only offered when a penalty
 * was actually awarded on the same tick, which is the one situation where the
 * sim genuinely modelled a chance being stopped.
 */
export function redCardReason(event: MatchEvent, ctx: CardContext): string | null {
  if (ctx.alreadyBooked) return "second bookable offence";
  if (ctx.sameTick.some((e) => e.type === "penalty")) {
    return "denies a goalscoring opportunity";
  }
  return pick(
    ["serious foul play", "violent conduct", "denies a clear chance"] as const,
    event.pids[0] ?? 0,
    Math.round(event.clock),
  );
}

/**
 * Build a card's context from the whole stream.
 *
 * One pass per card rather than a prepared index: a match carries ~2.3 yellows
 * against ~180 events, so the index would cost more to build than the scans it
 * saves, and every caller already holds the array.
 */
export function cardContext(event: MatchEvent, events: MatchEvent[], lastClock: number): CardContext {
  let mine = 0;
  let theirs = 0;
  let alreadyBooked = false;
  const sameTick: MatchEvent[] = [];
  for (const e of events) {
    if (e.clock === event.clock && e !== event) sameTick.push(e);
    // Strictly before this card: a goal on the same tick has not been scored yet
    // as far as the referee reaching for his pocket is concerned.
    if (e.clock > event.clock) {
      if (e.type === "goal") {
        if (e.side === event.side) mine++;
        else theirs++;
      }
      if (e.type === "yellow_card" && e.pids[0] === event.pids[0]) alreadyBooked = true;
    }
  }
  const elapsed = 5400 - event.clock;
  const total = Math.max(5400, 5400 - lastClock);
  return {
    sameTick,
    leadAtTime: mine - theirs,
    minute: Math.max(1, Math.ceil(elapsed / 60)),
    alreadyBooked,
    matchFraction: Math.min(1, elapsed / total),
  };
}

/* ---------------------------------------------------------------------------
   Shots
   --------------------------------------------------------------------------- */

/**
 * Where a shot came from.
 *
 * Two of these are EXACT rather than flavour — the sim really did award a
 * penalty, and really did play a header from a corner — and they are the ones
 * worth having. The rest key off the shooter's slot, which is real recorded data
 * (`PlayerMatchLine.slot`), so a centre-back's effort reads like a centre-back's.
 * Nothing here invents physical detail the sim has no notion of: there is no
 * "curled into the top corner", because the engine never decided that.
 */
export function shotSource(
  event: MatchEvent,
  sameTick: MatchEvent[],
  slot: MatchPosition | undefined,
): string | null {
  if (sameTick.some((e) => e.type === "penalty" && e.side === event.side)) {
    return "from the spot";
  }
  if (sameTick.some((e) => e.type === "corner" && e.side === event.side)) {
    return "header from the corner";
  }
  switch (slot) {
    case "CB":
    case "GK":
      return "from deep";
    case "DM":
    case "CM":
      return "from distance";
    case "FB":
      return "from the angle";
    default:
      return null;
  }
}

/* ---------------------------------------------------------------------------
   The one entry point
   --------------------------------------------------------------------------- */

/**
 * The extra clause an event carries, or null for the ones that speak for
 * themselves.
 *
 * Both timeline surfaces go through here rather than each deciding for itself —
 * the same reason `eventSummary` sits beside `EventBody`. Two screens giving
 * different reasons for one booking reads as a bug, and this is exactly the kind
 * of text that would drift.
 *
 * `slotOf` is optional because the live viewer is fed from a `LiveMatch`, which
 * carries the event stream and no player lines. Without it the two EXACT shot
 * sources (a penalty, a header from a corner) still resolve, since both are read
 * off the stream; only the position-flavoured ones drop out.
 */
export function eventDetail(
  event: MatchEvent,
  events: MatchEvent[],
  lastClock: number,
  slotOf?: (pid: number) => MatchPosition | undefined,
): string | null {
  switch (event.type) {
    case "yellow_card":
      return yellowCardReason(event, cardContext(event, events, lastClock));
    case "red_card":
      return redCardReason(event, cardContext(event, events, lastClock));
    case "goal":
    case "shot_saved":
    case "shot_blocked":
    case "shot_off_target": {
      const sameTick = events.filter((e) => e.clock === event.clock && e !== event);
      return shotSource(event, sameTick, slotOf?.(event.pids[0]));
    }
    default:
      return null;
  }
}
