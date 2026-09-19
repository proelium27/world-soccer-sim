import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generatePlayer } from "../../src/core/players/generate.js";
import { selectXI, bestFit } from "../../src/core/lineup/selectXI.js";
import { FORMATIONS } from "../../src/core/lineup/formations.js";
import { ROSTER_COMPOSITION } from "../../src/core/constants.js";
import { slotValue } from "../../src/core/players/positions.js";
import { POSITIONS, SKILL_KEYS } from "../../src/core/players/types.js";
import type { Player } from "../../src/core/players/types.js";

function roster(seed: number): Player[] {
  const rng = mulberry32(seed);
  const players: Player[] = [];
  let pid = 0;
  for (const pos of POSITIONS)
    for (let i = 0; i < ROSTER_COMPOSITION[pos]; i++)
      players.push(generatePlayer(rng, pos, 52, pid++, 20, 1));
  return players;
}

describe("selectXI", () => {
  it("returns 11 distinct players for a 4-3-3", () => {
    const xi = selectXI(roster(1), FORMATIONS["4-3-3"]);
    expect(xi).toHaveLength(11);
    expect(new Set(xi.map((p) => p.pid)).size).toBe(11);
  });
  it("puts a natural GK in the GK slot", () => {
    const xi = selectXI(roster(2), FORMATIONS["4-3-3"]);
    expect(xi[0].pos).toBe("GK");
  });
  it("fills every slot even when a natural position is missing (adjacency fallback)", () => {
    const noFb = roster(3).filter((p) => p.pos !== "FB");
    const xi = selectXI(noFb, FORMATIONS["4-3-3"]);
    expect(xi).toHaveLength(11);
    expect(new Set(xi.map((p) => p.pid)).size).toBe(11);
  });

  it("plays a far better man out of position rather than a hopeless specialist", () => {
    // The bug this rule replaced: fit ranked strictly above rating, so ANY
    // natural full-back beat EVERY non-full-back for a full-back slot, and a
    // first-division club would start a 39-rated specialist with a 67-rated
    // team-mate on the bench. A centre-back covers full-back at a known cost;
    // once the gap is wider than that cost, he plays.
    const rng = mulberry32(11);
    const hopelessFb = generatePlayer(rng, "FB", 25, 1, 24, 1);
    const strongCb = generatePlayer(rng, "CB", 78, 2, 24, 1);
    expect(slotValue(strongCb, "FB")).toBeGreaterThan(slotValue(hopelessFb, "FB"));
    expect(selectXI([hopelessFb, strongCb], ["FB"])[0].pid).toBe(strongCb.pid);
  });

  it("still prefers the specialist when the gap is smaller than the penalty", () => {
    // The other half: covering costs something, so a natural full-back keeps
    // his slot against a centre-back who is only marginally better at it.
    const rng = mulberry32(12);
    const goodFb = generatePlayer(rng, "FB", 70, 1, 24, 1);
    const similarCb = generatePlayer(rng, "CB", 70, 2, 24, 1);
    expect(slotValue(goodFb, "FB")).toBeGreaterThan(slotValue(similarCb, "FB"));
    expect(selectXI([goodFb, similarCb], ["FB"])[0].pid).toBe(goodFb.pid);
  });

  it("does not let an earlier slot claim a player a later one needs more", () => {
    // Slot order is not priority order. Filling slot by slot, the full-back
    // slots come before the striker slot in a 4-3-3, so a squad whose only good
    // forward is its lone striker would see him taken to cover at the back and
    // a reserve left up front. Assignment is over every (slot, player) pairing
    // at once, so that cannot happen.
    const rng = mulberry32(13);
    const slots = FORMATIONS["4-3-3"];
    const squad = [
      generatePlayer(rng, "GK", 50, 1, 24, 1),
      ...Array.from({ length: 4 }, (_, i) => generatePlayer(rng, "CB", 50, 10 + i, 24, 1)),
      ...Array.from({ length: 3 }, (_, i) => generatePlayer(rng, "CM", 50, 20 + i, 24, 1)),
      ...Array.from({ length: 2 }, (_, i) => generatePlayer(rng, "W", 50, 30 + i, 24, 1)),
      generatePlayer(rng, "ST", 85, 40, 24, 1),
    ];
    const xi = selectXI(squad, slots);
    expect(xi[slots.indexOf("ST")].pid).toBe(40);
  });

  it("leaves no improving swap or substitution behind", () => {
    // The property that makes the XI trustworthy, and the one the old rule
    // broke on 16.9% of first-division slots: nobody outside the eleven is
    // worth more in a slot than the man in it, and no two starters would each
    // be worth more in the other's. Checked on a depleted squad, since a
    // healthy one is served fine by naive selection.
    const slots = FORMATIONS["4-3-3"];
    const depleted = roster(7).filter((p) => p.pos !== "FB" && p.pos !== "W").slice(0, 16);
    const xi = selectXI(depleted, slots);
    const benched = depleted.filter((p) => !xi.some((s) => s.pid === p.pid));

    for (let i = 0; i < xi.length; i++) {
      for (const b of benched) {
        expect(slotValue(b, slots[i])).toBeLessThanOrEqual(slotValue(xi[i], slots[i]));
      }
      for (let j = i + 1; j < xi.length; j++) {
        const now = slotValue(xi[i], slots[i]) + slotValue(xi[j], slots[j]);
        const swapped = slotValue(xi[j], slots[i]) + slotValue(xi[i], slots[j]);
        expect(swapped).toBeLessThanOrEqual(now);
      }
    }
  });

  it("terminates on a player whose rating is not a number", () => {
    // A fixture (or a malformed save) can carry a player with no heightCm, and
    // computeOvr then returns NaN for any position weighting height. Selection
    // has always tolerated that by ranking him arbitrarily. The improvement pass
    // must too: `g <= gain` is FALSE for a NaN gain, so an unguarded loop
    // accepts every move forever and hangs the sim rather than failing. This
    // test hung the suite before the finiteness guard, so it is a real bound,
    // not a formality.
    const rng = mulberry32(21);
    const slots = FORMATIONS["4-3-3"];
    const squad = Array.from({ length: 14 }, (_, i) =>
      generatePlayer(rng, POSITIONS[i % POSITIONS.length], 55, i + 1, 24, 1),
    );
    for (const p of squad) delete (p as Partial<Player>).heightCm;
    expect(Number.isNaN(slotValue(squad[0], "CB") + slotValue(squad[0], "ST"))).toBe(true);

    const xi = selectXI(squad, slots);
    expect(xi).toHaveLength(11);
    expect(new Set(xi.map((p) => p.pid)).size).toBe(11);
  });

  it("is deterministic and independent of the roster's order", () => {
    const slots = FORMATIONS["4-2-3-1"];
    const squad = roster(9);
    const forward = selectXI(squad, slots).map((p) => p.pid);
    const reversed = selectXI([...squad].reverse(), slots).map((p) => p.pid);
    expect(reversed).toEqual(forward);
    expect(selectXI(squad, slots).map((p) => p.pid)).toEqual(forward);
  });
});

function mkPlayer(pid: number, pos: Player["pos"], ovr: number): Player {
  return {
    pid,
    name: `Player ${pid}`,
    nationality: "ENG",
    born: 2000,
    pos,
    heightCm: 180,
    ratings: Object.fromEntries(SKILL_KEYS.map((k) => [k, 50])) as Player["ratings"],
    ovr,
    potential: ovr,
    contract: { salary: 10000, expiresSeason: 5 },
    injury: null,
    recentStats: [],
    recentHist: [],
  };
}

describe("bestFit", () => {
  it("prefers an exact position match over a higher-ovr adjacent one", () => {
    const cb = mkPlayer(1, "CB", 60);
    const dm = mkPlayer(2, "DM", 90); // DM is adjacent-fit for CB slot, but not exact
    expect(bestFit("CB", [dm, cb])).toBe(cb);
  });

  it("picks the higher-ovr candidate among equally-good fits", () => {
    const cbLow = mkPlayer(1, "CB", 55);
    const cbHigh = mkPlayer(2, "CB", 70);
    expect(bestFit("CB", [cbLow, cbHigh])).toBe(cbHigh);
  });

  it("falls back to an adjacent position when no exact fit exists", () => {
    const dm = mkPlayer(1, "DM", 65);
    const st = mkPlayer(2, "ST", 80); // not adjacent to CB at all
    expect(bestFit("CB", [dm, st])).toBe(dm);
  });

  it("breaks exact ties by lower pid, deterministically", () => {
    const a = mkPlayer(5, "CB", 70);
    const b = mkPlayer(2, "CB", 70);
    expect(bestFit("CB", [a, b])).toBe(b);
  });

  it("returns null for an empty candidate pool", () => {
    expect(bestFit("CB", [])).toBeNull();
  });
});
