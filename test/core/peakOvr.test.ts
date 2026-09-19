import { describe, it, expect, beforeAll } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { englandCompetitions } from "../../src/core/competitions.js";
import { careerPeakOvr } from "../../src/core/players/freeAgentCull.js";
import { migrateLeague } from "../../src/db/migrate.js";
import type { Player } from "../../src/core/players/types.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/** What both readers used to do inline, kept here as the thing to match. */
function scanPeak(p: Player): number {
  let peak = p.ovr;
  for (const h of p.recentHist ?? []) if (h.ovr > peak) peak = h.ovr;
  return peak;
}

/**
 * `Player.peakOvr` replaces two full walks of `hist` — the free-agent cull's
 * quality gate and the retiree archive. Storing a running maximum is only safe
 * while it equals what the walk produced, so that equality is what these pin.
 *
 * It also matters beyond the saved work: it is the field that lets careers stop
 * being resident at all (`docs/lazy-career-plan.md`), because a cull that needs
 * `hist` in memory can never run against a player whose history is on disk.
 */
describe("Player.peakOvr", () => {
  let league: LeagueStore;
  beforeAll(() => {
    const rng = mulberry32(31);
    league = createLeagueState(0, rng, 0, "normal", englandCompetitions());
    for (let i = 0; i < 4; i++) {
      league = simThrough(league, "season", rng);
      league = simOffseason(league, rng);
    }
  }, 600_000);

  it("matches the scan it replaces, for every player in the world", () => {
    let checked = 0;
    for (const p of league.players) {
      expect(careerPeakOvr(p)).toBe(scanPeak(p));
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("is actually being maintained, not just falling through to the scan", () => {
    // A player who has been progressed at least once must carry the field, or
    // the fallback is quietly doing all the work and nothing has been saved.
    const progressed = league.players.filter((p) => p.recentHist.length > 0);
    expect(progressed.length).toBeGreaterThan(500);
    expect(progressed.every((p) => p.peakOvr != null)).toBe(true);
  });

  it("never sits below the player's current rating", () => {
    for (const p of league.players) {
      expect(careerPeakOvr(p)).toBeGreaterThanOrEqual(p.ovr);
    }
  });

  it("tracks a rising career and holds after decline", () => {
    // Someone in the pool has peaked and come back down; his stored peak must
    // be the high-water mark rather than what he is now.
    const declined = league.players.filter((p) => (p.peakOvr ?? p.ovr) > p.ovr + 2);
    expect(declined.length).toBeGreaterThan(0);
    for (const p of declined.slice(0, 50)) {
      expect(p.peakOvr).toBe(scanPeak(p));
      expect(Math.max(...p.recentHist.map((h) => h.ovr))).toBe(p.peakOvr);
    }
  });

  it("migrate backfills it exactly, for a save that never had it", () => {
    const stripped: LeagueStore = {
      ...league,
      players: league.players.map((p) => {
        const { peakOvr: _o, peakOvrSeason: _s, ...rest } = p;
        return rest as Player;
      }),
    };
    expect(stripped.players.every((p) => p.peakOvr === undefined)).toBe(true);

    const migrated = migrateLeague(stripped);
    const before = new Map(league.players.map((p) => [p.pid, scanPeak(p)]));
    for (const p of migrated.players) {
      expect(p.peakOvr).toBe(before.get(p.pid));
    }
  });
});
