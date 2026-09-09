import { describe, it, expect } from "vitest";
import { migrateLeague } from "../../src/db/migrate.js";
import { makeLeague } from "../helpers/league.js";
import { playSeason } from "../helpers/offseasonLeague.js";
import { simOffseason } from "../../src/core/offseason.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { GEN_OFFSETS } from "../../src/core/players/templates.js";
import type { SkillKey } from "../../src/core/players/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import {
  OVR_SCALE_SHIFT, DIVISION_2_REFUSAL_OVR_THRESHOLD, PROTECTED_STAR_OVR,
  WAGE_OVR_FLOOR, GOAT_OVR_BASELINE, AWARD_OVR_BASELINE, RATING_MAX,
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

  it("keeps awardWinners an ARRAY, and lifts the history nothing else can recover", () => {
    // The bug this pins was silent and permanent: mapping awardWinners through
    // Object.entries/fromEntries turned the array into {"0": ..., "1": ...},
    // which migrateLeague itself tolerated and then wrote back to disk, and
    // which every consumer iterates with for...of and throws on. One load was
    // enough to corrupt the save.
    // Built from a REAL played season rather than a hand-written entry, because
    // the shapes migrateFields walks are deep and a thin fixture proves nothing
    // about the entry a save actually holds. Marking a current save "stale"
    // lifts it a second time, which is semantically odd and exactly right for
    // what is being measured: the mechanics of the lift, against a known before.
    const rng = mulberry32(11);
    const played = simOffseason(playSeason(makeLeague(0, 3), rng), rng);
    const stale: LeagueStore = { ...played, meta: { ...played.meta, ovrScale: undefined } };

    const out = migrateLeague(stale);
    const before = played.seasonHistory[0];
    const after = out.seasonHistory[0];
    expect(before.awardWinners!.length).toBeGreaterThan(0);

    expect(Array.isArray(after.awardWinners)).toBe(true);
    expect(() => [...after.awardWinners!]).not.toThrow();
    // Clamped, because this fixture deliberately lifts an already-shifted save a
    // second time and an award winner is by definition near the top of the
    // scale, so plenty of them land past RATING_MAX.
    const lifted = (v: number) => Math.min(RATING_MAX, v + OVR_SCALE_SHIFT);
    expect(after.awardWinners!.map((w) => w.ovr))
      .toEqual(before.awardWinners!.map((w) => lifted(w.ovr)));

    // Every past power-ranking row is on the rating scale too, is never
    // recomputed, and is rendered in the same table as the live one — so an
    // unlifted history reads as the whole world dropping 11 points a season ago.
    expect(played.powerRankingHistory.length).toBeGreaterThan(0);
    const rowBefore = played.powerRankingHistory[0].rows[0];
    const rowAfter = out.powerRankingHistory[0].rows[0];
    expect(rowAfter.ovr).toBe(lifted(rowBefore.ovr));
    expect(rowAfter.pot).toBe(lifted(rowBefore.pot));
    expect(rowAfter.powerScore).toBe(lifted(rowBefore.powerScore));
  });

  it("lifts finalOvr alongside peakOvr, since neither can be re-derived", () => {
    // finalOvr is the rating a retiree stopped at, stored with no ratings behind
    // it. Missed, his profile shows a final rating 11 below a correctly-lifted
    // peak on the same card, and an old award winner resolved through the
    // archive lands 11 low on the awards board.
    const base = preShiftSave();
    const stale: LeagueStore = {
      ...base,
      retiredPlayers: [{
        ...(makeLeague(0, 1).retiredPlayers[0] ?? {}),
        pid: 9_000_001,
        peakOvr: 60,
        finalOvr: 52,
        seasons: [{ season: 1, tid: 0, ovr: 58, apps: 30 }],
      }] as unknown as LeagueStore["retiredPlayers"],
    };
    const r = migrateLeague(stale).retiredPlayers[0];
    expect(r.peakOvr).toBe(60 + OVR_SCALE_SHIFT);
    expect(r.finalOvr).toBe(52 + OVR_SCALE_SHIFT);
    expect(r.seasons[0].ovr).toBe(58 + OVR_SCALE_SHIFT);
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

    // Compared against the migrated count rather than against zero. The claim
    // is that the rules effectively stop firing on an unlifted save, and "a
    // rounding error's worth of players" says that; exact zero says something
    // stronger that only held while the generated world's maximum happened to
    // sit below `bar + OVR_SCALE_SHIFT`. It duly broke when world generation
    // gained an age model and the world max moved 92 -> 94, at which point seven
    // players of 15,650 (0.04%) cleared the Division-2 bar from below.
    const migrated = migrateLeague(stale);
    for (const bar of [DIVISION_2_REFUSAL_OVR_THRESHOLD, PROTECTED_STAR_OVR]) {
      expect(over(migrated, bar)).toBeGreaterThan(0);
      expect(over(stale, bar)).toBeLessThan(over(migrated, bar) * 0.05);
    }

    // And the wage floor, which is the one that costs money rather than
    // realism: unlifted, a first-teamer is priced off a floor 11 points below
    // where he actually sits, at roughly a fifth of his proper salary.
    const fresh = makeLeague(0, 1);
    expect(over(migrated, WAGE_OVR_FLOOR)).toBe(over(fresh, WAGE_OVR_FLOOR));
    expect(over(migrated, AWARD_OVR_BASELINE)).toBe(over(fresh, AWARD_OVR_BASELINE));
    expect(over(migrated, GOAT_OVR_BASELINE)).toBe(over(fresh, GOAT_OVR_BASELINE));
  });
});
