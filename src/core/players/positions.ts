import type { Player, PlayerRatings, Position, RatingsSnapshot } from "./types.js";
import { POSITIONS } from "./types.js";
import { computeOvr } from "./ovr.js";
import { COVERABLE, familiarityPenalty } from "../../engine/positionFit.js";
import {
  MAX_SECONDARY_POSITIONS, SECONDARY_POSITION_CUTOFF,
  POSITION_CHANGE_MARGIN, POSITION_CHANGE_SEASONS,
} from "../constants.js";

/** What a player would be rated at one position, on the usual OVR scale. */
export interface PositionRating {
  pos: Position;
  ovr: number;
  /** His listed position — the one his OVR and every stat weighting keys off. */
  primary: boolean;
  /** He knows this job too: no familiarity penalty for playing it. */
  secondary: boolean;
}

/**
 * A player's OVR at his own position and at every slot he could plausibly
 * cover, best first (his own position wins ties, so the strip leads with what
 * he actually is).
 *
 * OVR is position-relative by construction — `computeOvr` weights the same 14
 * skills differently per position — so "what would he be as a full-back" is a
 * question the rating model can already answer exactly. Nothing new is stored
 * or rolled: this is a re-read of attributes the player already has.
 *
 * Deliberately NOT all eight positions. A keeper's striker rating, or a
 * striker's centre-back rating, is a number the model will happily produce and
 * that means nothing — seven lines of noise around the one that matters. The
 * coverable set is the same one versatility is drawn from, so the strip shows
 * exactly the positions where the answer is meaningful.
 */
function rate(p: Player): PositionRating[] {
  const secondary = new Set(deriveSecondaries(p));
  const shown: Position[] = [p.pos, ...COVERABLE[p.pos]];
  return shown
    .map((pos) => ({
      pos,
      ovr: pos === p.pos ? p.ovr : computeOvr(pos, p.ratings, p.heightCm),
      primary: pos === p.pos,
      secondary: secondary.has(pos),
    }))
    .sort((a, b) => b.ovr - a.ovr || (a.primary ? -1 : b.primary ? 1 : 0));
}

/**
 * The positions a player can fill without a familiarity penalty, beyond his own.
 *
 * Two gates, and both are load-bearing:
 *
 *  - **Adjacency.** Only a slot he could plausibly cover is eligible, via
 *    COVERABLE — the REVERSE of the adjacency table, since we are asking where
 *    else he can play rather than who can replace him, and the table is not
 *    symmetric. This bounds the sim change: a secondary can only ever waive the
 *    *adjacent* penalty, never the foreign one, so no derivation quirk can hand
 *    a centre-back a free run at striker. Keepers cover nothing and nothing
 *    covers them, so they are always specialists.
 *
 *  - **Rating, against a PER-PAIR bar.** His OVR at that slot must beat his own
 *    by at least `SECONDARY_POSITION_CUTOFF[pos][slot]`, a measured figure that
 *    admits a fixed share of players at his position. One shared threshold
 *    cannot work at any value: how close a player rates one position along is
 *    set by how much the two positions' OVR weights overlap, which is a
 *    property of the pair, not of him. CM/DM/AM share most of their weighting,
 *    a striker's overlaps almost nothing — so a flat gap makes every midfielder
 *    a three-position player before any striker is a two-position one
 *    (measured; see scripts/secondaryPositionProbe.ts). Calibrating per pair
 *    removes that bias and makes a badge mean "better here than the typical
 *    player of his position" rather than "plays a position whose weights happen
 *    to overlap".
 *
 * Versatility is therefore a property of his attributes, which is what keeps
 * the badge and the per-position strip from ever contradicting each other, and
 * lets it update itself over a career — no stored field to migrate, and no rng
 * draw, so the seeded stream is untouched.
 *
 * Best first, capped at `MAX_SECONDARY_POSITIONS`.
 */
export function deriveSecondaries(
  p: Player,
  cutoff: Partial<Record<Position, number>> = SECONDARY_POSITION_CUTOFF[p.pos],
  max: number = MAX_SECONDARY_POSITIONS,
): Position[] {
  const out: { pos: Position; ovr: number }[] = [];
  for (const pos of COVERABLE[p.pos]) {
    const bar = cutoff[pos];
    if (bar === undefined) continue;
    const ovr = computeOvr(pos, p.ratings, p.heightCm);
    if (ovr - p.ovr >= bar) out.push({ pos, ovr });
  }
  // Ovr desc, then position order, so the list is stable for a given player.
  out.sort((a, b) => b.ovr - a.ovr || POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
  return out.slice(0, max).map((r) => r.pos);
}

/**
 * Per-player memo. Keyed on the player OBJECT, which is exactly right here: the
 * core is purely functional and hands unchanged players through by reference,
 * so a player whose ratings moved is a *new* object and misses the cache
 * automatically. A pid key would go stale the season he progresses.
 */
const secondaryCache = new WeakMap<Player, Position[]>();
const ratingCache = new WeakMap<Player, PositionRating[]>();

/** Cached `deriveSecondaries` at the shipped constants — the normal entry point. */
export function secondaryPositions(p: Player): Position[] {
  let hit = secondaryCache.get(p);
  if (!hit) {
    hit = deriveSecondaries(p);
    secondaryCache.set(p, hit);
  }
  return hit;
}

/** Cached full per-position strip, best first. */
export function positionRatings(p: Player): PositionRating[] {
  let hit = ratingCache.get(p);
  if (!hit) {
    hit = rate(p);
    ratingCache.set(p, hit);
  }
  return hit;
}

/**
 * What he'd be rated playing THIS slot, rather than his own position.
 *
 * The number to rank candidates by whenever a slot is being filled. Ranking by
 * `p.ovr` instead compares a winger's *winger* rating against a striker's
 * *striker* rating and then plays the winner up front — which measurably cost
 * team finishing, because a versatile winger would take the striker slot on a
 * rating he doesn't carry into it (see scripts/midVsMidProbe.ts). Making him
 * beat the striker at being a striker is both the correct comparison and what
 * keeps the goals/game benchmark where it was.
 */
export function ovrAtSlot(p: Player, slot: Position): number {
  if (slot === p.pos) return p.ovr;
  const known = positionRatings(p).find((r) => r.pos === slot);
  return known ? known.ovr : computeOvr(slot, p.ratings, p.heightCm);
}

/**
 * What he is actually worth to a side playing THIS slot: his rating at the job
 * (`ovrAtSlot`) less the familiarity penalty the match sim charges him for
 * filling in there.
 *
 * The number to *choose* by whenever a slot is being filled, and deliberately
 * the same one `benchValueAt` maximizes when the sim picks a substitute. Those
 * two must agree or the game contradicts itself — a picker that ranks fit
 * strictly ahead of rating fields a man the sim then rates below someone on the
 * bench, which is exactly how a first-division club ended up starting a
 * 39-rated full-back with a 67-rated midfielder sat behind him (measured; see
 * scripts/xiFitProbe.ts).
 *
 * Both halves are load-bearing. `ovrAtSlot` asks how good he'd be at the job,
 * so a striker can't claim a full-back slot on a striker's rating; the penalty
 * then charges him for not knowing it, so a specialist still beats an
 * equally-rated stand-in. A secondary position waives the penalty but not the
 * re-rating, which keeps a utility man genuinely first-choice at the slot he
 * doubles at without making him a free upgrade everywhere he can reach.
 */
export function slotValue(p: Player, slot: Position): number {
  return ovrAtSlot(p, slot) - familiarityPenalty(slot, p.pos, secondaryPositions(p));
}

/** "ST" or "ST / W" — his position as the UI should name it. */
export function positionLabel(p: Player): string {
  const sec = secondaryPositions(p);
  return sec.length === 0 ? p.pos : `${p.pos} / ${sec.join(" / ")}`;
}

/** One career position change, as recorded in a player's rating snapshots. */
export interface PositionMove {
  season: number;
  from: Position;
  to: Position;
}

/**
 * Every position change in a player's recorded career, oldest first.
 *
 * Read straight off `hist`, so it needs nothing stored beyond the per-snapshot
 * position and works unchanged for a save that pre-dates the feature — those
 * snapshots all carry his current position (see migrate.ts), which correctly
 * yields no moves.
 */
export function positionHistory(hist: readonly RatingsSnapshot[]): PositionMove[] {
  const out: PositionMove[] = [];
  let prev: Position | null = null;
  for (const h of hist) {
    if (prev !== null && h.pos !== prev) out.push({ season: h.season, from: prev, to: h.pos });
    prev = h.pos;
  }
  return out;
}

/** How much better he'd rate at `to` than at `from`, on one set of ratings. */
function gapBetween(
  ratings: PlayerRatings,
  heightCm: number,
  from: Position,
  to: Position,
): number {
  return computeOvr(to, ratings, heightCm) - computeOvr(from, ratings, heightCm);
}

/**
 * The position a player should now be LISTED at, or null to leave him where he
 * is — a career position change, checked once per offseason.
 *
 * A secondary position (above) says "he can also do that job". This says "that
 * job is now what he is", and unlike a secondary it is not free: `ovr` is
 * position-relative, so relisting a player where he rates higher raises his
 * rating, his wage (cubic in ovr) and his transfer value. Three gates keep that
 * honest, and each one is load-bearing:
 *
 *  - **Coverable only.** The same COVERABLE set secondaries are drawn from, so
 *    a conversion can only ever be one step across the pitch and keepers are
 *    excluded in both directions. A striker cannot wake up a centre-back.
 *
 *  - **A real margin.** `POSITION_CHANGE_MARGIN` points better, not merely
 *    better. Every player has *some* position he'd rate a fraction higher at,
 *    so "play your best position" would relabel a fifth of the world on noise
 *    alone and inflate the whole rating scale doing it.
 *
 *  - **Sustained, and measured only over seasons he spent at his current
 *    position.** The gap must have held for `POSITION_CHANGE_SEASONS` seasons
 *    running. This is the gate that does the real work: which position a player
 *    rates highest at changes for 6-8% of rostered players *every season*, so
 *    without it the badge would be noise. Restricting the window to snapshots
 *    stamped at his current position also gives conversions a cooldown for
 *    free — immediately after a move his history there is empty, so he cannot
 *    bounce back and collect a second OVR bump.
 *
 * Pure, and deliberately draws nothing from the shared rng — position changes
 * ride entirely on attributes the player already has, so introducing them does
 * not shift the seeded stream (see the RNG-stream-order lesson). `ratings` is
 * passed separately because the caller (`progressPlayer`) has already stepped
 * them and has not rebuilt the player yet.
 */
export function changedPosition(
  player: Player,
  ratings: PlayerRatings,
  margin: number = POSITION_CHANGE_MARGIN,
  seasons: number = POSITION_CHANGE_SEASONS,
): Position | null {
  const from = player.pos;
  const candidates = COVERABLE[from];
  if (candidates.length === 0) return null;

  // This season's gap, best candidate first. Ties break on position order so a
  // dead heat resolves the same way every time it is evaluated.
  let bestPos: Position | null = null;
  let bestGap = -Infinity;
  for (const to of candidates) {
    const gap = gapBetween(ratings, player.heightCm, from, to);
    if (gap > bestGap || (gap === bestGap && bestPos !== null
      && POSITIONS.indexOf(to) < POSITIONS.indexOf(bestPos))) {
      bestGap = gap;
      bestPos = to;
    }
  }
  if (bestPos === null || bestGap < margin) return null;

  // ...and the same candidate must have cleared it in each of the previous
  // seasons of his CURRENT spell at this position. Walking back until the
  // position changes is what makes it a spell rather than a career total: a
  // player who once played here, moved away and came back would otherwise be
  // able to pair a fresh season with one from years ago and satisfy the window
  // across the gap, which is precisely the case the cooldown exists for.
  // Anything short of a full window — a youth-intake player, or one who just
  // converted — is not enough history to move him on.
  const need = seasons - 1;
  const spell = [];
  for (let i = player.recentHist.length - 1; i >= 0 && spell.length < need; i--) {
    if (player.recentHist[i].pos !== from) break;
    spell.push(player.recentHist[i]);
  }
  if (spell.length < need) return null;
  for (const h of spell) {
    if (gapBetween(h.ratings, player.heightCm, from, bestPos) < margin) return null;
  }
  return bestPos;
}
