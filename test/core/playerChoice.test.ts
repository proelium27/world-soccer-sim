import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { playerChoice } from "../../src/core/transfers/playerChoice.js";
import { signFreeAgent } from "../../src/core/freeAgency.js";
import type { Player } from "../../src/core/players/types.js";

describe("playerChoice", () => {
  const league = makeLeague(0, 1);
  const comps = new Map(league.competitions.map((c) => [c.id, c]));
  const clubIn = (country: string, tier: number) =>
    league.teams.find((t) => comps.get(t.compId)!.country === country && comps.get(t.compId)!.tier === tier)!;
  // A free agent good enough for most clubs to want, invented so the world's
  // own players are untouched.
  const freeAgent = (ovr: number): Player => ({
    ...league.players[0], pid: 20_000_000 + ovr, nationality: "Brazil", pos: "CM", ovr,
    potential: ovr, born: league.season - 27, stats: [], career: undefined,
    contract: { salary: 0, expiresSeason: 0 },
  } as Player);

  const signWith = (tid: number, p: Player) => {
    const teams = league.teams.map((t) => (t.tid === tid ? { ...t, budget: 1e12 } : t));
    const out = signFreeAgent(
      teams, [...league.players, p], tid, p.pid, league.season, "offseason", [], undefined,
      league.competitions, league.progressionModel,
    );
    return out.teams.find((t) => t.tid === tid)!.roster.includes(p.pid);
  };

  it("signs a free agent for the user exactly when no AI club he'd prefer wants him", () => {
    const p = freeAgent(74);
    for (const club of [clubIn("England", 1), clubIn("Serbia", 3)]) {
      const choice = playerChoice({
        teams: league.teams, players: [...league.players, p], competitions: league.competitions,
        season: league.season, model: league.progressionModel,
      }, club.tid);
      expect(signWith(club.tid, p)).toBe(choice.freeAgentRival(p) === null);
    }
  });

  it("lets the biggest club sign a star a small club loses to a rival", () => {
    // A star, who starts anywhere: a squad player would rightly rather start at
    // a smaller club than sit on the biggest club's bench.
    const p = freeAgent(90);
    const world = { teams: league.teams, players: [...league.players, p], competitions: league.competitions, season: league.season };
    // The biggest club in the world is the best fit there is; the smallest is not.
    const byStature = [...playerChoice(world, -1).contexts.values()].sort((a, b) => b.stature - a.stature);
    expect(playerChoice(world, byStature[0].tid).freeAgentRival(p)).toBeNull();
    expect(playerChoice(world, byStature[byStature.length - 1].tid).freeAgentRival(p)).not.toBeNull();
  });
});
