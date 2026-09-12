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

  // A free kick was awarded in a shooting position: this was a challenge. A goal
  // counts too — a scored free kick is logged as "goal", not "shot_*", and
  // missing it would let the booking that conceded it read as time wasting.
  const gaveFreeKick = ctx.sameTick.some(
    (e) => e.side !== event.side && (e.type.startsWith("shot_") || e.type === "goal"),
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
 * THE ENGINE HAS NO PITCH, and that is the constraint everything here works
 * inside. `resolveShot` decides a shot from team composites alone, so every shot
 * a side takes in a match carries the same xG; nothing about it says whether it
 * was a tap-in or a thirty-yarder. Three sources are nonetheless EXACT, because
 * the sim really did play them and the stream says so: a penalty, a header from
 * a corner, and a shot off a free kick (which is only visible when the foul drew
 * a card — an uncarded foul leaves no event behind, so its free kick reads as
 * open play).
 *
 * Every other shot gets a ZONE picked to fit the one real fact the stream holds
 * about it: how it ended. The engine's outcome mix already lands on real
 * football (measured from the constants: ~28% blocked, ~38% off target, ~23%
 * saved, ~11% scored, against a top flight's ~27/38/24/11), so real football's
 * "where do shots that end this way come from" can be borrowed directly. That is
 * what stops the old failure, where a label keyed on position alone had every
 * midfielder's goal arriving "from distance" when most real midfield goals are
 * scored inside the box. Position only SHADES the odds.
 *
 * Still a label: the zone caused nothing, and the xG beside it does not move.
 * Making it real means rolling a zone inside the engine and letting it set
 * conversion — an engine change with an audit, not a display one.
 *
 * Open-play shots are never called headers. The engine resolves them on the
 * shooter's `shooting` rating, so calling one a header would contradict it;
 * only the corner path resolves on `heading`.
 */
export type ShotZone = "close" | "box" | "outside";
export type ShotOrigin = ShotZone | "penalty" | "corner" | "freeKick";

type ZoneWeights = readonly [close: number, box: number, outside: number];

/**
 * Real-football share of each outcome by zone: six-yard box, the rest of the
 * area, outside it. Built from typical top-flight figures (shots ~7/55/38 by
 * zone, converting ~32% / ~12.5% / ~3.5%, blocked ~15% / ~25% / ~34%) and
 * inverted, so goals come mostly from inside the box and blocks lean outside it.
 * `scripts/shotZoneProbe.ts` measures what these produce on real matches.
 */
const ZONE_BY_OUTCOME: Record<string, ZoneWeights> = {
  goal: [21, 66, 13],
  shot_saved: [8, 57, 35],
  shot_blocked: [4, 50, 46],
  shot_off_target: [5, 55, 40],
};

/**
 * How a position shades those odds. A striker lives in the six-yard box, a
 * holding midfielder shoots from outside it, a centre-back's open-play chances
 * are mostly knock-downs in the area. Missing (an old box score with no slot on
 * its lines) means no shading.
 */
const ZONE_BY_SLOT: Partial<Record<MatchPosition, ZoneWeights>> = {
  ST: [1.5, 1.15, 0.65],
  W: [0.8, 1.0, 1.15],
  AM: [0.7, 0.95, 1.35],
  CM: [0.6, 0.85, 1.55],
  DM: [0.5, 0.75, 1.8],
  FB: [0.6, 1.0, 1.2],
  CB: [1.6, 1.1, 0.6],
};

const ZONES: readonly ShotZone[] = ["close", "box", "outside"];

const ZONE_LABELS: Record<ShotZone, readonly string[]> = {
  close: ["from close range", "from inside the six-yard box"],
  box: ["inside the box", "from 12 yards", "from just inside the area"],
  outside: ["from distance", "from the edge of the box", "from 25 yards", "from long range"],
};

/** Salts that keep the zone roll and the wording roll independent of each other. */
const ZONE_ROLL = 1;
const LABEL_ROLL = 2;

function unitRoll(...seed: number[]): number {
  return hashInts(...seed, NARRATION_STREAM) / 4294967296;
}

function pickZone(outcome: string, slot: MatchPosition | undefined, seed: number[]): ShotZone {
  const base = ZONE_BY_OUTCOME[outcome] ?? ZONE_BY_OUTCOME.shot_off_target;
  const shade = (slot && ZONE_BY_SLOT[slot]) || [1, 1, 1];
  const weights = base.map((w, i) => w * shade[i]);
  let r = unitRoll(...seed, ZONE_ROLL) * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < ZONES.length; i++) {
    r -= weights[i];
    if (r < 0) return ZONES[i];
  }
  return ZONES[ZONES.length - 1];
}

function zoneLabel(zone: ShotZone, outcome: string, slot: MatchPosition | undefined, seed: number[]): string {
  let options = ZONE_LABELS[zone];
  // A tap-in is a goal by definition, and a tight angle is where wide men shoot from.
  if (zone === "close" && outcome === "goal") options = ["tap-in", ...options];
  if (zone === "box" && (slot === "W" || slot === "FB")) options = [...options, "from a tight angle"];
  return pick(options, ...seed, LABEL_ROLL);
}

/** The origin and its wording. Exported so the probe and tests can see the zone. */
export function shotLocation(
  event: MatchEvent,
  sameTick: MatchEvent[],
  slot: MatchPosition | undefined,
  afterCorner: boolean,
): { origin: ShotOrigin; label: string } {
  if (sameTick.some((e) => e.type === "penalty" && e.side === event.side)) {
    return { origin: "penalty", label: "from the spot" };
  }
  // A corner tick holds TWO shots: the one that went out for the corner, then
  // the header from it. Only the second is the header, so this has to know
  // which side of the corner the shot sits in the stream, not merely that a
  // corner shares its tick.
  if (afterCorner) return { origin: "corner", label: "header from the corner" };
  // The engine's free kick is a shot for the fouled side on the foul's own
  // tick, so an opposing card sharing the tick (with no penalty) pins it.
  if (sameTick.some((e) => e.side !== event.side && (e.type === "yellow_card" || e.type === "red_card"))) {
    return { origin: "freeKick", label: "from a free kick" };
  }
  const seed = [event.pids[0] ?? 0, Math.round(event.clock)];
  const zone = pickZone(event.type, slot, seed);
  return { origin: zone, label: zoneLabel(zone, event.type, slot, seed) };
}

export function shotSource(
  event: MatchEvent,
  sameTick: MatchEvent[],
  slot: MatchPosition | undefined,
  afterCorner: boolean,
): string {
  return shotLocation(event, sameTick, slot, afterCorner).label;
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
 * `slotOf` is optional because a caller may hold the event stream and no player
 * lines. Without it the EXACT shot sources (penalty, corner header, free kick)
 * still resolve, since all are read off the stream, and every other shot still
 * gets a zone fitted to its outcome; only the positional shading drops out.
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
      // Stream order is engine order (shot, corner, header), which both callers
      // pass through untouched.
      const at = events.indexOf(event);
      const afterCorner = events.some(
        (e, i) => i < at && e.clock === event.clock && e.type === "corner" && e.side === event.side,
      );
      return shotSource(event, sameTick, slotOf?.(event.pids[0]), afterCorner);
    }
    default:
      return null;
  }
}
