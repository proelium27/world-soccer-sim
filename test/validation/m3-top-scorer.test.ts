import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { competitionOf } from "../../src/core/competitions.js";

describe("M3 §8 gate — top scorer", () => {
  // Ceiling raised 32 -> 36 when the individual-finisher effect
  // (SHOOTER_FINISH_WEIGHT) landed: goals now concentrate on a team's best
  // finishers by design, so a league's scoring leader legitimately reaches the
  // mid-30s — in line with real top-flight Golden Boot totals (~30-36).
  //
  // MEASURES A TIER-1 LEAGUE'S GOLDEN BOOT, which is what the band above is
  // about. It used to take the max over every player in the world, and that is a
  // different quantity in two ways that both grew over time (2026-08-11):
  //
  //  1. It included SECOND DIVISIONS, where defences are weaker. Measured with
  //     scripts/topScorerProbe.ts, the world max was set by a tier-2 player in
  //     the seasons that mattered, and exceeded every top-flight league's leader
  //     that season (43 vs 32, 40 vs 34).
  //  2. A maximum rises with sample size on its own. Going from 12 competitions
  //     to 16 (Belgium and Turkey) raised the world max with no change in how
  //     much any individual league scores.
  //
  // Together those pushed the world max to a 36.2 mean and failed this gate,
  // while all 40 measured tier-1 Golden Boots sat between 23 and 34 — inside the
  // band, never once above it. Widening the ceiling would have kept a number
  // that drifts upward every time a country is added, so the fix was to measure
  // the thing the band describes. Now invariant to world size and to tier-2
  // scoring: measured mean 27.7, per-season range 27.0-28.8.
  it("a top-flight league's top scorer averages 18–36 goals over 5 seeded seasons", () => {
    const SEASONS = 5;
    const perSeasonMeans: number[] = [];

    for (let s = 0; s < SEASONS; s++) {
      const rng = mulberry32(3000 + s);
      let league = createLeagueState(0, rng);
      league = simThrough(league, "season", rng);

      const compOfTid = new Map(league.teams.map((t) => [t.tid, t.compId]));
      // Best league-goals tally in each competition this season.
      const bestByComp = new Map<number, number>();
      for (const p of league.players) {
        for (const ss of p.recentStats) {
          const compId = compOfTid.get(ss.tid);
          if (compId === undefined) continue;
          if (ss.goals > (bestByComp.get(compId) ?? 0)) bestByComp.set(compId, ss.goals);
        }
      }

      const tier1Tops = [...bestByComp.entries()]
        .filter(([compId]) => competitionOf(league.competitions, compId).tier === 1)
        .map(([, goals]) => goals);
      expect(tier1Tops.length).toBeGreaterThan(0);

      perSeasonMeans.push(tier1Tops.reduce((a, b) => a + b, 0) / tier1Tops.length);
    }

    const avg = perSeasonMeans.reduce((a, b) => a + b, 0) / SEASONS;
    expect(avg).toBeGreaterThanOrEqual(18);
    expect(avg).toBeLessThanOrEqual(36);
  });
});
