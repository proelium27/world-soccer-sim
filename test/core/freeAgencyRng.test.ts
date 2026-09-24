/**
 * AI free agency draws nothing from the shared rng. Every pass takes contract
 * length from a per-signing seeded stream (tags 5, 6 and 7), so which players
 * sign where can change — player-choice free agency reorders signings on
 * purpose — without moving youth intake or any other draw downstream.
 */
import { describe, it, expect } from "vitest";
import { runAIFreeAgency, freeAgentPids } from "../../src/core/freeAgency.js";
import { makeLeague } from "../helpers/league.js";

describe("AI free agency and the shared rng", () => {
  it("signs players without drawing from the shared rng", () => {
    const league = makeLeague(0, 1);
    // Free two players from every club so every pass has work to do.
    const teams = league.teams.map((t) => ({ ...t, roster: t.roster.slice(0, -2) }));
    const order = teams.map((t) => t.tid);
    let draws = 0;
    const rng = () => { draws++; return 0.5; };

    const out = runAIFreeAgency(
      teams, league.players, league.season + 1, rng, league.meta.userTid, order, [],
      league.progressionModel,
    );

    expect(freeAgentPids(teams, league.players, []).size).toBeGreaterThan(1000);
    expect(out.signings.length).toBeGreaterThan(500);
    expect(draws).toBe(0);
  });
});
