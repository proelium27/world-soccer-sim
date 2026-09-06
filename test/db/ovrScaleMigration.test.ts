import { describe, it, expect } from "vitest";
import { migrateLeague } from "../../src/db/migrate.js";
import { makeLeague } from "../helpers/league.js";
import { GEN_OFFSETS } from "../../src/core/players/templates.js";
import type { SkillKey } from "../../src/core/players/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import {
  OVR_SCALE_SHIFT, DIVISION_2_REFUSAL_OVR_THRESHOLD, PROTECTED_STAR_OVR,
  WAGE_OVR_FLOOR, GOAT_OVR_BASELINE, AWARD_OVR_BASELINE,
} from "../../src/core/constants.js";

/**
 * The OVR scale shift moved every rating AND every threshold by the same amount,
 * which is what makes it a relabel rather than a rebalance. That only holds for
 * a world whose ratings actually moved, so a save written on the old scale has
 * to be lifted on load -- otherwise it fields old-scale players against
 * new-scale rules, which is silent and ruinous rather than loud.
 */
describe("OVR scale migration", () => {
  /**
   * A save as it existed before the shift: old-scale ratings, no marker.
   *
   * Built by shifting a current world DOWN, which is lossy in exactly one place
   * -- a rating below OVR_SCALE_SHIFT clamps at 1 on the way down and cannot
   * carry its true value back up. `losslessDown` marks the players that affects
   * so the round-trip assertions can skip them; the loss is the fixture's, not
   * the migration's.
   */
  function preShiftSave(): LeagueStore {
    const league = makeLeague(0, 1);
    const down = (v: number) => Math.max(1, v - OVR_SCALE_SHIFT);
    return {
      ...league,
      meta: { ...league.meta, ovrScale: undefined },
      players: league.players.map((p) => {
        const ratings = { ...p.ratings };
        for (const key of Object.keys(ratings) as SkillKey[]) {
          if (GEN_OFFSETS[p.pos]?.[key] === "ABS") continue;
          ratings[key] = down(ratings[key]);
        }
        return { ...p, ratings, ovr: down(p.ovr), potential: down(p.potential) };
      }),
    } as LeagueStore;
  }

  /** True when no non-ABS rating would clamp on the way down. */
  function losslessDown(p: { pos: string; ratings: Record<string, number> }): boolean {
    for (const [key, v] of Object.entries(p.ratings)) {
      if (GEN_OFFSETS[p.pos as keyof typeof GEN_OFFSETS]?.[key as SkillKey] === "ABS") continue;
      if (v - OVR_SCALE_SHIFT < 1) return false;
    }
    return true;
  }

  it("lifts an unmarked save onto the current scale", () => {
    const migrated = migrateLeague(preShiftSave());
    const fresh = makeLeague(0, 1);
    const freshByPid = new Map(fresh.players.map((p) => [p.pid, p]));

    // Sample broadly rather than asserting on one player: the lift has to reach
    // the whole pool, and a bug that misses (say) academy players would pass a
    // single-player check.
    let compared = 0;
    for (const p of migrated.players) {
      const original = freshByPid.get(p.pid);
      if (!original) continue;
      if (!losslessDown(original)) continue;
      expect(p.ovr).toBe(original.ovr);
      expect(p.potential).toBe(original.potential);
      compared++;
    }
    expect(compared).toBeGreaterThan(10_000);
  });

  it("stamps the scale so the lift is applied exactly once", () => {
    const once = migrateLeague(preShiftSave());
    expect(once.meta.ovrScale).toBe(OVR_SCALE_SHIFT);

    // The bug this guards is a double-lift on the second load, which would put
    // the whole world 11 points too high and would look like a balance problem
    // rather than a migration one.
    const twice = migrateLeague(once);
    for (let i = 0; i < twice.players.length; i++) {
      expect(twice.players[i].ovr).toBe(once.players[i].ovr);
      expect(twice.players[i].potential).toBe(once.players[i].potential);
    }
  });

  it("leaves a save already on the current scale untouched", () => {
    const current = makeLeague(0, 1);
    const migrated = migrateLeague(current);
    for (let i = 0; i < current.players.length; i++) {
      expect(migrated.players[i].ratings).toEqual(current.players[i].ratings);
    }
  });

  it("leaves the ABS tier on its absolute floor, since it carries no ovr weight", () => {
    const migrated = migrateLeague(preShiftSave());
    const outfielders = migrated.players.filter((p) => p.pos !== "GK");
    expect(outfielders.length).toBeGreaterThan(0);
    // Every outfielder's goalkeeping is ABS-tier and must not have been lifted;
    // if it had been, old saves and new ones would describe the same player
    // differently.
    for (const p of outfielders.slice(0, 500)) {
      expect(p.ratings.goalkeeping).toBeLessThanOrEqual(20);
    }
  });

  it("is what puts a save back on the right side of the rules that moved with it", () => {
    // The bug the migration exists to prevent, demonstrated rather than
    // described: every threshold moved up with the scale, so an unlifted save
    // sits ~11 points below all of them and the rules simply stop firing --
    // no error, no crash, just a world where nobody is ever swept out of
    // Division 2 and nobody is ever too good to buy.
    const stale = preShiftSave();
    const over = (l: LeagueStore, bar: number) =>
      l.players.filter((p) => p.ovr >= bar).length;

    expect(over(stale, DIVISION_2_REFUSAL_OVR_THRESHOLD)).toBe(0);
    expect(over(stale, PROTECTED_STAR_OVR)).toBe(0);

    const migrated = migrateLeague(stale);
    expect(over(migrated, DIVISION_2_REFUSAL_OVR_THRESHOLD)).toBeGreaterThan(0);
    expect(over(migrated, PROTECTED_STAR_OVR)).toBeGreaterThan(0);

    // And the wage floor, which is the one that costs money rather than
    // realism: unlifted, a first-teamer is priced off a floor 11 points below
    // where he actually sits, at roughly a fifth of his proper salary.
    const fresh = makeLeague(0, 1);
    expect(over(migrated, WAGE_OVR_FLOOR)).toBe(over(fresh, WAGE_OVR_FLOOR));
    expect(over(migrated, AWARD_OVR_BASELINE)).toBe(over(fresh, AWARD_OVR_BASELINE));
    expect(over(migrated, GOAT_OVR_BASELINE)).toBe(over(fresh, GOAT_OVR_BASELINE));
  });
});
