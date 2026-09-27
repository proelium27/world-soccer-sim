/**
 * Player-choice free agency: clubs make offers, players choose.
 * docs/club-reputation.md, Part A2.
 *
 * In real football a club does not pick a free agent; it offers, and the
 * player chooses between the offers he has. This is club-proposing deferred
 * acceptance, run in rounds:
 *
 *  1. Every open slot offers to its club's highest-ranked candidate it has not
 *     offered before and may still register.
 *  2. Every player with offers keeps the one he likes best (his own view of the
 *     club, `clubAppealFor`) and rejects the rest, including one he was holding
 *     if a new offer is better. A rejected slot reopens.
 *  3. Repeat until no slot makes a new offer. Held offers become signings.
 *
 * Properties: terminates (a club offers each player at most once) and is
 * deterministic (slots run in tid order, players in pid order, ties break on
 * stature then tid). Without registration caps it is also stable and
 * independent of processing order. With them it is only close to that: a slot
 * that skips a player because the club's cap was full never comes back to him,
 * even if a held offer is later rejected and frees the place, so which of a
 * club's slots ran first can occasionally decide a signing. Rare (a club has to
 * sit exactly at a cap mid-match) and deterministic either way.
 *
 * What replaces the old worst-first signing order: a squad player with offers
 * from a strong club and a weak one picks where he would PLAY (the playing-time
 * line) and where he is at HOME, which is the real reason small clubs sign real
 * players. Pure and rng-free.
 */
import type { Player } from "./players/types.js";

/** One place a club wants to fill, with its candidates in the club's own order. */
export interface MatchSlot {
  tid: number;
  /** The club's ranking for this slot, best first, already filtered to players who would not refuse it. */
  candidates: readonly Player[];
}

export interface MatchOptions {
  /** How much this player likes an offer from this club; higher is better. */
  preference(player: Player, tid: number): number;
  /** Tie-break between equally liked clubs: higher first. */
  stature(tid: number): number;
  /**
   * May this club add this player on top of its current squad plus `tentative`
   * (the players it is holding or offering this round)? Registration rules.
   */
  mayRegister(tid: number, tentative: readonly number[], player: Player): boolean;
}

/** Which player each slot ends up with (by slot index), or null. */
export function matchFreeAgents(slots: readonly MatchSlot[], options: MatchOptions): (number | null)[] {
  // Run one open slot at a time from a queue in tid order (Gale-Shapley). A
  // slot bumped by a player who took a better offer rejoins the back of the
  // queue. With the tie-breaks below every preference is strict, so this lands
  // on the same club-optimal stable matching whatever order slots are
  // processed in; the queue just avoids rescanning every slot in the world to
  // find the few still open.
  const order = slots.map((_, i) => i).sort((a, b) => slots[a].tid - slots[b].tid || a - b);
  const next = slots.map(() => 0);
  const holder: (number | null)[] = slots.map(() => null);
  const heldBy = new Map<number, number>(); // pid -> slot index
  const offeredBy = new Map<number, Set<number>>(); // tid -> pids offered
  const heldAt = new Map<number, Set<number>>(); // tid -> pids its slots hold
  const byPid = new Map<number, Player>();
  for (const s of slots) for (const p of s.candidates) byPid.set(p.pid, p);

  const better = (pid: number, a: number, b: number): boolean => {
    const player = byPid.get(pid)!;
    const ta = slots[a].tid;
    const tb = slots[b].tid;
    const pa = options.preference(player, ta);
    const pb = options.preference(player, tb);
    if (pa !== pb) return pa > pb;
    const sa = options.stature(ta);
    const sb = options.stature(tb);
    if (sa !== sb) return sa > sb;
    return ta !== tb ? ta < tb : a < b;
  };
  const setHolder = (i: number, pid: number | null): void => {
    const tid = slots[i].tid;
    const was = holder[i];
    if (was !== null) heldAt.get(tid)?.delete(was);
    holder[i] = pid;
    if (pid !== null) {
      const set = heldAt.get(tid) ?? new Set<number>();
      set.add(pid);
      heldAt.set(tid, set);
    }
  };

  const queue = [...order];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (holder[i] !== null) continue;
    const slot = slots[i];
    const offered = offeredBy.get(slot.tid) ?? new Set<number>();
    offeredBy.set(slot.tid, offered);
    while (next[i] < slot.candidates.length) {
      const p = slot.candidates[next[i]++];
      if (offered.has(p.pid)) continue;
      if (!options.mayRegister(slot.tid, [...(heldAt.get(slot.tid) ?? [])], p)) continue;
      offered.add(p.pid);
      const current = heldBy.get(p.pid);
      if (current === undefined) {
        setHolder(i, p.pid);
        heldBy.set(p.pid, i);
        break;
      }
      if (better(p.pid, i, current)) {
        setHolder(current, null);
        queue.push(current);
        setHolder(i, p.pid);
        heldBy.set(p.pid, i);
        break;
      }
      // Rejected: this slot tries its next candidate.
    }
  }
  return holder;
}
