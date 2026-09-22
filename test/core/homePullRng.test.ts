/**
 * Home-country pull reorders free agency's candidate lists. Pass 1 of
 * `runAIFreeAgency` draws each signing's contract length from the SHARED rng,
 * so if the new ranking ever changed WHETHER a shortfall is filled (rather than
 * who fills it) the draw count would move and everything downstream — youth
 * intake first — would re-roll. That is not something "no new random draws"
 * guarantees on its own, so it is pinned here: with a pool deep enough that
 * every shortfall fills either way, the shared stream is consumed identically
 * with the pull off and strongly on.
 *
 * Also asserts the pull did something (different signings, more domestic),
 * so the equality can't pass by the pull being inert.
 */
import { describe, it, expect } from "vitest";
import { runAIFreeAgency, freeAgentPids } from "../../src/core/freeAgency.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeLeague } from "../helpers/league.js";

function counting(seed: number): { rng: () => number; count: () => number } {
  const base = mulberry32(seed);
  let n = 0;
  return { rng: () => { n++; return base(); }, count: () => n };
}

describe("home pull and free agency's shared rng", () => {
  const league = makeLeague(0, 1);
  // Free two players from every club so there are shortfalls to fill, then let
  // only every other club shop: supply ~2x demand, so every shortfall fills.
  const teams = league.teams.map((t) => ({ ...t, roster: t.roster.slice(0, -2) }));
  const order = teams.filter((_, i) => i % 2 === 0).map((t) => t.tid);
  const compCountry = new Map(league.competitions.map((c) => [c.id, c.country]));
  const byPid = new Map(league.players.map((p) => [p.pid, p]));

  const run = (k: number) => {
    const { rng, count } = counting(99);
    const out = runAIFreeAgency(
      teams, league.players, league.season + 1, rng, league.meta.userTid, order, [],
      league.progressionModel, 0, league.competitions, k,
    );
    return { ...out, draws: count() };
  };

  it("draws from the shared rng exactly as often with the pull off and on", () => {
    expect(freeAgentPids(teams, league.players, []).size).toBeGreaterThan(1000);
    const off = run(0);
    const on = run(30);
    expect(off.draws).toBeGreaterThan(0);
    expect(on.draws).toBe(off.draws);

    // Non-vacuous: the pull changed who signed, toward home players.
    const key = (s: { pid: number; toTid: number }) => `${s.pid}:${s.toTid}`;
    const offSet = new Set(off.signings.map(key));
    expect(on.signings.some((s) => !offSet.has(key(s)))).toBe(true);
    const domestic = (sigs: { pid: number; toTid: number }[]) => sigs.filter((s) => {
      const team = teams.find((t) => t.tid === s.toTid)!;
      return byPid.get(s.pid)!.nationality === compCountry.get(team.compId);
    }).length;
    expect(domestic(on.signings)).toBeGreaterThan(domestic(off.signings));
  });
});
