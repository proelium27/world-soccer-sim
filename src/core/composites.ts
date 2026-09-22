import type { Composites } from "../engine/composites.js";
import type { Player, Position, SkillKey } from "./players/types.js";
import { heightScore } from "./players/ovr.js";
import { OVR_WEIGHTS, type OvrKey } from "./players/templates.js";
import { familiarityPenalty } from "../engine/positionFit.js";
import { secondaryPositions } from "./players/positions.js";
import { COMPOSITE_STAR_CONCENTRATION } from "./constants.js";

/**
 * A player together with the formation slot he's filling. Every composite is
 * bucketed by `slot`, never by the player's own position: the team's shape is
 * set by its formation, not by who happens to be standing in it. Playing a man
 * out of position moves him into that slot's phase and docks his contribution
 * (see familiarityPenalty) rather than quietly re-shaping the team around him.
 */
export interface SlottedPlayer {
  player: Player;
  slot: Position;
}

/** Pair an XI (in formation order) with its slots. */
export function withSlots(xi: Player[], slots: Position[]): SlottedPlayer[] {
  return xi.map((player, i) => ({ player, slot: slots[i] ?? player.pos }));
}

/** The value of one OVR input for a player: a rating, or height on the same 0..100 scale. */
function inputOf(p: Player, key: OvrKey): number {
  return key === "height" ? heightScore(p.heightCm) : p.ratings[key];
}

/**
 * A player's quality on a weighted skill set, 0..1, docked by what it costs him
 * to play this slot. The penalty is in raw rating points, so dividing by 100
 * puts it on the same scale as the quality itself.
 */
function weightedQuality(sp: SlottedPlayer, weights: Partial<Record<OvrKey, number>>): number {
  let acc = 0;
  let total = 0;
  for (const [key, w] of Object.entries(weights) as [OvrKey, number][]) {
    acc += w * inputOf(sp.player, key);
    total += w;
  }
  if (total === 0) return 0;
  const penalty = familiarityPenalty(sp.slot, sp.player.pos, secondaryPositions(sp.player));
  return Math.max(0, acc / total / 100 - penalty / 100);
}

/** Equal-weight quality over a plain skill list (the finishing composite). */
function playerQuality(sp: SlottedPlayer, skills: SkillKey[]): number {
  return weightedQuality(sp, Object.fromEntries(skills.map((k) => [k, 1])));
}

/**
 * Which OVR inputs belong to each phase of play. A skill can serve more than
 * one phase (positioning helps you attack, defend and keep the ball).
 */
const PHASE_SKILLS: Record<"attack" | "defense" | "control" | "keeping", OvrKey[]> = {
  attack: ["finishing", "longShot", "dribbling", "speed", "positioning", "crosses", "strength", "jumping", "height"],
  defense: ["tackling", "interceptions", "positioning", "strength", "jumping", "height", "speed"],
  control: ["shortPass", "longPass", "dribbling", "positioning"],
  keeping: ["goalkeeping", "positioning", "jumping", "height"],
};

/**
 * How a player in `slot` contributes to `phase`: the slot's own OVR weights,
 * restricted to that phase's skills.
 *
 * This is what keeps OVR honest. Composites used to read a fixed skill list per
 * phase, so any rating a position's OVR weighted but its phase list omitted
 * cost wages and transfer fees and did nothing on the pitch: 27% of a
 * full-back's OVR (speed, crossing), 35% of a keeper's (positioning, passing),
 * 23% of a striker's (strength, jumping, height). Reading the OVR row means a
 * rating counts on the pitch in proportion to what it adds to OVR, and a
 * retune of OVR_WEIGHTS reaches the match engine with no second table to keep
 * in step.
 */
const PHASE_WEIGHTS: Record<Position, Record<keyof typeof PHASE_SKILLS, Partial<Record<OvrKey, number>>>> =
  Object.fromEntries(
    (Object.keys(OVR_WEIGHTS) as Position[]).map((slot) => [
      slot,
      Object.fromEntries(
        (Object.keys(PHASE_SKILLS) as (keyof typeof PHASE_SKILLS)[]).map((phase) => [
          phase,
          Object.fromEntries(
            PHASE_SKILLS[phase].filter((k) => OVR_WEIGHTS[slot][k]).map((k) => [k, OVR_WEIGHTS[slot][k]]),
          ),
        ]),
      ),
    ]),
  ) as never;

/**
 * Position-weighted average of a per-player quality, then blended toward the
 * group's single best player by COMPOSITE_STAR_CONCENTRATION. The weights say
 * who drives the phase (a striker moves `attack` more than a midfielder); the
 * peak blend lets an elite individual resist being averaged down by weaker
 * teammates, so a standout in the right position genuinely carries a thin
 * group rather than washing out to the mean. A slot with no weight takes no
 * part. Pure — reads only attributes, no rng, so it never perturbs the seeded
 * stream.
 */
function phaseComposite(
  players: SlottedPlayer[],
  phase: keyof typeof PHASE_SKILLS,
  weightOf: Partial<Record<Position, number>>,
): number {
  let acc = 0;
  let wsum = 0;
  let peak = 0;
  for (const sp of players) {
    const w = weightOf[sp.slot] ?? 0;
    if (w === 0) continue;
    const q = weightedQuality(sp, PHASE_WEIGHTS[sp.slot][phase]);
    acc += w * q;
    wsum += w;
    if (q > peak) peak = q;
  }
  if (wsum === 0) return 0.5;
  const c = COMPOSITE_STAR_CONCENTRATION;
  return (1 - c) * (acc / wsum) + c * peak;
}

/** Weighted expected shot share by position (ST > W > AM > others). */
const SHOT_SHARE: Partial<Record<Position, number>> = {
  ST: 4, W: 2.5, AM: 2, CM: 1, FB: 0.5, DM: 0.5, CB: 0.3,
};

/**
 * Who drives chance creation (`attack`): strikers most, then wingers and the
 * full-backs overlapping outside them, then AM/CM.
 *
 * The group weights below are MEASURED, not chosen, and the full-back numbers
 * are the ones that look odd. The target is that one extra OVR point on any
 * outfield starter is worth about the same in points, which is what makes OVR
 * mean one thing at every position. `scripts/deadAttrProbe.ts` measures it:
 * before this, +1 OVR on a full-back was worth 0.09 points a season against
 * 0.22-0.29 at every other outfield position. A full-back's OVR is split
 * between defending and going forward, so to land level he needs a heavy
 * weight in both phases; 2.5 here and 4.5 in defense put him at 0.21-0.22 on
 * both a real imported save and a generated world. Re-run the probe before
 * touching any of these.
 */
const ATTACK_WEIGHT: Partial<Record<Position, number>> = {
  ST: 4, W: 2.5, FB: 2.5, AM: 2, CM: 1,
};

/** Who drives possession (`control`): central midfield most, then AM/wide, striker and keeper least. */
const CONTROL_WEIGHT: Partial<Record<Position, number>> = {
  CM: 3, DM: 2.5, AM: 2, W: 1, FB: 1, CB: 1, ST: 0.5, GK: 0.5,
};

/**
 * Who drives defending (`defense`): full-backs and centre-backs most, then DM,
 * then a central midfielder's share. See ATTACK_WEIGHT for why the full-back
 * figure is what it is.
 */
const DEFENSE_WEIGHT: Partial<Record<Position, number>> = {
  FB: 4.5, CB: 3, DM: 2, CM: 0.75,
};

/**
 * Roll the on-pitch 11 up into the engine's five RAW (unnormalized) composites,
 * per SOCCER_GM_SPEC.md §4 mapped onto the 15-stat set. Values are ~0..1;
 * league normalization rescales them so the average XI hits 0.5.
 *
 * Every grouping and weight keys off the SLOT a player occupies, not his own
 * position. Before this, a centre-back pushed to centre-forward still counted
 * toward `defense` at full strength and contributed nothing to `attack` — so
 * moving a defender up the pitch made your back line *better*. Now he takes the
 * striker's weight in `attack`, carries a familiarity penalty for being there,
 * and leaves the defensive group entirely.
 */
export function rollupComposites(xi: SlottedPlayer[], teamName: string): Composites {
  const keeper = xi.find((sp) => sp.slot === "GK");
  const outfield = xi.filter((sp) => sp.slot !== "GK");

  const attack = phaseComposite(outfield, "attack", ATTACK_WEIGHT);

  // finishing: shot-share-weighted finishing/longShot/positioning across outfielders
  let fw = 0;
  let fsum = 0;
  for (const sp of outfield) {
    const share = SHOT_SHARE[sp.slot] ?? 0.3;
    fsum += share * playerQuality(sp, ["finishing", "longShot", "positioning"]);
    fw += share;
  }
  const finishing = fw === 0 ? 0.5 : fsum / fw;

  const defense = phaseComposite(outfield, "defense", DEFENSE_WEIGHT);

  // An outfielder pressed into goal is measured on a keeper's weights and takes
  // the keeper penalty, which is large enough to floor his contribution — as it
  // should be.
  const keeping = keeper ? weightedQuality(keeper, PHASE_WEIGHTS.GK.keeping) : 0.5;

  const control = phaseComposite(xi, "control", CONTROL_WEIGHT);

  return { name: teamName, attack, finishing, defense, keeping, control };
}
