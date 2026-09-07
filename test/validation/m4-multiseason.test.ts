import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../../src/core/leagueState.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { computeStandings } from "../../src/core/standings.js";
import { ROSTER_CAP } from "../../src/core/constants.js";
import { competitionTeamCount } from "../../src/core/competitions.js";

/**
 * §8 gates were validated at M1/M3 for a single generated season. M4 adds
 * progression, retirement, free agency, and youth intake between seasons —
 * this is the real risk for constant drift (ratings creeping up/down over
 * many simulated seasons). Re-check the table-spread gate across a chain of
 * simulated seasons with real offseasons in between, not just fresh leagues.
 */
describe("M4 — multi-season stability", () => {
  const SEASONS = 5;

  /**
   * One five-season chain with real offseasons, shared by both gates below.
   *
   * The integrity gate used to live in its own file, m4-multiseason-integrity,
   * running a second chain of the same shape on seed 99. The note that
   * justified the split said it plainly -- "each of these gates sims the full
   * world over 5 seasons (~2min each), so they are split into separate files"
   * -- and that premise is what has gone: sharing one chain means there is only
   * one sim to spread, and the file this replaces was ~440s of it.
   *
   * The honest trade is that seed 99's world is no longer exercised. Both
   * integrity properties are structural rather than statistical, and the
   * checks now run after *every* season here rather than once at the end of
   * one chain, which is more coverage of the same invariant on one fewer world.
   *
   * Lazy, so running one gate by name still pays for one chain.
   */
  let chain: { league: LeagueStore; champPoints: number[]; bottomPoints: number[]; rosterSizes: number[] } | null = null;

  const run = () => {
    if (chain) return chain;
    const rng = mulberry32(2024);
    let league = createLeagueState(0, rng);

    const champPoints: number[] = [];
    const bottomPoints: number[] = [];
    const rosterSizes: number[] = [];

    for (let s = 0; s < SEASONS; s++) {
      league = simThrough(league, "season", rng);
      // Measured PER COMPETITION and scaled to a 38-game season, then averaged —
      // not as the best and worst club in one world-wide table.
      //
      // The pooled version was a world-wide max and min, which stopped being a
      // league statistic the moment divisions stopped all being 20 clubs (see
      // Competition.teamCount). Points are a function of games played, so the
      // worst club in the world is now whoever sits bottom of the SHORTEST
      // season — Scotland's 10-club second division, 18 games — and the gate
      // read 8.8 against a floor of 10 while every league in the world was
      // healthy. Same fault the M3 top-scorer gate had ("a world-wide max is not
      // a league statistic") and the M1 benchmark gate had ("average team must
      // mean the average team"): the estimator was wrong, not the band.
      //
      // The bands below are unchanged and still describe a full 38-game season,
      // which is exactly what this now measures: 78.9 / 27.3 against 70-100 and
      // 10-38.
      const perComp = league.competitions.map((comp) => {
        const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
        const own = new Set(tids);
        const table = computeStandings(
          tids,
          league.played.filter((m) => own.has(m.home) && own.has(m.away)),
        );
        const games = (competitionTeamCount(comp) - 1) * 2;
        return {
          champ: (table[0].points / games) * 38,
          bottom: (table[table.length - 1].points / games) * 38,
        };
      });
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      champPoints.push(mean(perComp.map((c) => c.champ)));
      bottomPoints.push(mean(perComp.map((c) => c.bottom)));
      // AI teams get trimmed back to target composition each offseason; the
      // user's team is intentionally left alone (release is a manual action),
      // so only AI rosters are checked for bloat here.
      for (const t of league.teams) {
        if (t.tid !== league.meta.userTid) rosterSizes.push(t.roster.length);
      }

      league = simOffseason(league, rng);

      // Absorbed from m4-multiseason-integrity.test.ts. Checked every season
      // rather than only at the end of the chain: a pid collision or an
      // orphaned roster entry introduced in season 2 and cleaned up by season 5
      // would have gone unseen before.
      const seasonPids = league.players.map((p) => p.pid);
      expect(new Set(seasonPids).size).toBe(seasonPids.length);
      const pool = new Set(seasonPids);
      for (const t of league.teams) {
        for (const pid of t.roster) expect(pool.has(pid)).toBe(true);
      }
    }

    chain = { league, champPoints, bottomPoints, rosterSizes };
    return chain;
  };

  it("champion/bottom points spread stays in range across chained seasons", () => {
    const { champPoints, bottomPoints, rosterSizes } = run();
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(avg(champPoints)).toBeGreaterThanOrEqual(70);
    expect(avg(champPoints)).toBeLessThanOrEqual(100);
    expect(avg(bottomPoints)).toBeGreaterThanOrEqual(10);
    expect(avg(bottomPoints)).toBeLessThanOrEqual(38);

    // AI rosters stay sane (no team collapses or balloons over 5 offseasons).
    // AI clubs now buy in the transfer market, so a squad can carry up to the
    // roster cap between offseason trims (not just the 25-man composition).
    for (const size of rosterSizes) {
      expect(size).toBeGreaterThanOrEqual(18);
      expect(size).toBeLessThanOrEqual(ROSTER_CAP);
    }
  });

  it("runs 5 seasons without pid collisions or orphaned rosters", () => {
    // The per-season assertions inside the chain above are the real gate; this
    // states the invariant as its own named case, so a failure reports as an
    // integrity failure rather than as a points-spread one, and re-checks the
    // final league.
    const { league } = run();
    const pids = league.players.map((p) => p.pid);
    expect(new Set(pids).size).toBe(pids.length);

    const pool = new Set(pids);
    for (const t of league.teams) {
      for (const pid of t.roster) expect(pool.has(pid)).toBe(true);
    }
  });
});
