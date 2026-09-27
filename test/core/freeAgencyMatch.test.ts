import { describe, it, expect } from "vitest";
import { matchFreeAgents, type MatchSlot, type MatchOptions } from "../../src/core/freeAgencyMatch.js";
import type { Player } from "../../src/core/players/types.js";
import { mulberry32 } from "../../src/engine/rng.js";

const p = (pid: number) => ({ pid }) as Player;

/** A seeded world of clubs, slots and players with arbitrary but fixed tastes on both sides. */
function world(seed: number) {
  const rng = mulberry32(seed);
  const players = Array.from({ length: 40 }, (_, i) => p(100 + i));
  const clubs = Array.from({ length: 12 }, (_, i) => i + 1);
  const taste = new Map<string, number>();
  for (const pl of players) for (const c of clubs) taste.set(`${pl.pid}:${c}`, rng());
  const slots: MatchSlot[] = [];
  for (const tid of clubs) {
    const ranked = [...players].sort((a, b) => (tid * 7919 + a.pid * 104729) % 97 - (tid * 7919 + b.pid * 104729) % 97 || a.pid - b.pid);
    const n = 1 + (tid % 3);
    for (let k = 0; k < n; k++) slots.push({ tid, candidates: ranked });
  }
  const options: MatchOptions = {
    preference: (pl, tid) => taste.get(`${pl.pid}:${tid}`)!,
    stature: (tid) => tid / 100,
    mayRegister: () => true,
  };
  return { players, slots, options };
}

const result = (slots: MatchSlot[], held: (number | null)[]) =>
  held.map((pid, i) => [slots[i].tid, pid] as const).filter(([, pid]) => pid !== null)
    .map(([tid, pid]) => `${tid}:${pid}`).sort();

describe("matchFreeAgents", () => {
  it("does not depend on the order the slots arrive in", () => {
    const { slots, options } = world(3);
    const a = result(slots, matchFreeAgents(slots, options));
    const shuffled = [...slots].reverse();
    const b = result(shuffled, matchFreeAgents(shuffled, options));
    expect(b).toEqual(a);
  });

  it("is stable: no club and player both prefer each other to what they got", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { slots, options } = world(seed);
      const held = matchFreeAgents(slots, options);
      const clubOf = new Map<number, number>();
      held.forEach((pid, i) => { if (pid !== null) clubOf.set(pid, slots[i].tid); });
      slots.forEach((slot, i) => {
        const mine = held[i];
        const myRank = mine === null ? Infinity : slot.candidates.findIndex((c) => c.pid === mine);
        for (const cand of slot.candidates.slice(0, myRank)) {
          const theirs = clubOf.get(cand.pid);
          if (theirs === slot.tid) continue; // already with this club via a sibling slot
          const prefersUs = theirs === undefined
            || options.preference(cand, slot.tid) > options.preference(cand, theirs);
          expect(prefersUs, `seed ${seed}: club ${slot.tid} and player ${cand.pid}`).toBe(false);
        }
      });
    }
  });

  it("never offers a player twice from one club, and never double-signs him", () => {
    const { slots, options } = world(5);
    const held = matchFreeAgents(slots, options).filter((pid) => pid !== null);
    expect(new Set(held).size).toBe(held.length);
  });

  it("counts tentative offers against registration, so a one-slot cap holds one", () => {
    const players = [p(1), p(2), p(3)];
    const slots: MatchSlot[] = [
      { tid: 1, candidates: players }, { tid: 1, candidates: players }, { tid: 1, candidates: players },
    ];
    const held = matchFreeAgents(slots, {
      preference: () => 1,
      stature: () => 0,
      // Players 1 and 2 are "foreign" and the club may hold at most one of them.
      mayRegister: (_tid, tentative, pl) =>
        pl.pid === 3 || tentative.filter((pid) => pid === 1 || pid === 2).length === 0,
    });
    const got = held.filter((pid) => pid !== null);
    expect(got.filter((pid) => pid === 1 || pid === 2)).toHaveLength(1);
    expect(got).toContain(3);
  });
});
