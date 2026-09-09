import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
import type { BoxScore, MatchPlayer, MatchPosition } from "../../src/engine/attribution.js";
import { FORMATIONS } from "../../src/core/lineup/formations.js";
import { formationOf, matchLineups } from "../../src/ui/live/lineups.js";

/**
 * The lineup derivation, run against real engine output rather than a
 * hand-built box score.
 *
 * That distinction is the point of the file: it claims to recover a team sheet
 * from what the sim happens to record, so the only test worth having is one
 * that reads what the sim actually recorded. A fixture would agree with
 * whatever the derivation currently believes.
 */

function player(pid: number, slot: MatchPosition): MatchPlayer {
  return {
    pid,
    pos: slot,
    slot,
    secondary: [],
    ovr: 62,
    shooting: slot === "ST" ? 75 : 40,
    dribbling: 50,
    tackling: slot === "CB" || slot === "DM" ? 70 : 40,
    keeping: slot === "GK" ? 80 : 5,
    positioning: 55,
    heading: 50,
    // Low, so fatigue forces the sub logic to actually make substitutions —
    // which is the half of the derivation a fresh XI would never exercise.
    stamina: 12,
    interceptions: 50,
    passing: 50,
  };
}

/** An XI in the slot order the formation lists, exactly as leagueMatchData builds one. */
function xi(pidBase: number, formation: keyof typeof FORMATIONS): MatchPlayer[] {
  return (FORMATIONS[formation] as MatchPosition[]).map((slot, i) => player(pidBase + i, slot));
}

function bench(pidBase: number): MatchPlayer[] {
  return (["GK", "CB", "FB", "CM", "W", "ST"] as MatchPosition[]).map((slot, i) =>
    player(pidBase + i, slot),
  );
}

/** One real match, played until both sides have had to use their benches. */
function playedMatch(seed: number): BoxScore {
  return simMatchDetailed(
    mulberry32(seed),
    makeTeam("Home"),
    makeTeam("Away"),
    xi(100, "4-3-3"),
    xi(200, "4-4-2"),
    bench(150),
    bench(250),
  ).boxScore;
}

const BOX = playedMatch(4242);

describe("formationOf", () => {
  it("names every shipped shape from its slots alone", () => {
    for (const [id, slots] of Object.entries(FORMATIONS)) {
      expect(formationOf(slots as MatchPosition[])).toBe(id);
    }
  });

  it("is order-independent, since a shape is a multiset of slots", () => {
    const shuffled = [...(FORMATIONS["4-2-3-1"] as MatchPosition[])].reverse();
    expect(formationOf(shuffled)).toBe("4-2-3-1");
  });

  it("declines to name an eleven that is not a shipped shape", () => {
    const madeUp: MatchPosition[] = [
      "GK", "CB", "CB", "CB", "CB", "CB", "CB", "CB", "CB", "CB", "ST",
    ];
    expect(formationOf(madeUp)).toBeNull();
  });

  it("declines rather than guessing when a slot is missing", () => {
    const partial = [...(FORMATIONS["4-3-3"] as MatchPosition[])];
    expect(formationOf([...partial.slice(0, 10), null])).toBeNull();
  });
});

describe("matchLineups, from real engine output", () => {
  const lineups = matchLineups(BOX);

  it("recovers the shape each side actually lined up in", () => {
    expect(lineups.home.formation).toBe("4-3-3");
    expect(lineups.away.formation).toBe("4-4-2");
  });

  it("puts exactly eleven players in each starting lineup", () => {
    expect(lineups.home.starters).toHaveLength(11);
    expect(lineups.away.starters).toHaveLength(11);
  });

  it("counts nobody who came off the bench as a starter", () => {
    // The whole point of the sub-event rule: the box score lists everyone who
    // appeared, starters and substitutes together, in one array.
    for (const side of ["home", "away"] as const) {
      const startingPids = new Set(lineups[side].starters.map((p) => p.pid));
      for (const s of lineups[side].subs) expect(startingPids.has(s.on)).toBe(false);
    }
  });

  it("found substitutions to report at all, so the rule above was exercised", () => {
    expect(lineups.home.subs.length + lineups.away.subs.length).toBeGreaterThan(0);
  });

  it("reports every substitution the match recorded, and no others", () => {
    for (const side of ["home", "away"] as const) {
      const fromEvents = BOX.events.filter((e) => e.type === "substitution" && e.side === side);
      expect(lineups[side].subs).toHaveLength(fromEvents.length);
      for (const e of fromEvents) {
        expect(lineups[side].subs.some((s) => s.off === e.pids[0] && s.on === e.pids[1])).toBe(true);
      }
    }
  });

  it("lists the team sheet back to front, keeper first", () => {
    expect(lineups.home.starters[0].slot).toBe("GK");
    expect(lineups.home.starters.at(-1)?.slot).toBe("ST");
  });

  it("reads a leg's own events, not the whole box score's", () => {
    // What a two-legged tie would do if it were ever handed a merged stream:
    // with no substitution events in scope, everyone who appeared reads as a
    // starter. This is exactly why cupCandidate refuses to build lineups for a
    // merged tie rather than passing it the wrong events.
    const noEvents = matchLineups(BOX, []);
    expect(noEvents.home.starters.length).toBe(BOX.home.length);
    expect(noEvents.home.subs).toHaveLength(0);
  });
});

describe("a box score written before slots were recorded", () => {
  const legacy: BoxScore = {
    home: BOX.home.map(({ slot: _slot, ...rest }) => rest),
    away: BOX.away.map(({ slot: _slot, ...rest }) => rest),
    events: BOX.events,
  };
  const lineups = matchLineups(legacy);

  it("still separates the starters from the substitutes", () => {
    expect(lineups.home.starters).toHaveLength(11);
    const startingPids = new Set(lineups.home.starters.map((p) => p.pid));
    for (const s of lineups.home.subs) expect(startingPids.has(s.on)).toBe(false);
  });

  it("says it cannot name the shape rather than inventing one", () => {
    expect(lineups.home.formation).toBeNull();
    expect(lineups.home.starters.every((p) => p.slot === null)).toBe(true);
  });
});
