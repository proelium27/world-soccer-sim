import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import { ACADEMY_GRADUATION_AGE, ACADEMY_ROSTER_CAP } from "../../src/core/constants.js";
import { freeAgentPids } from "../../src/core/freeAgency.js";
import { playerChoice } from "../../src/core/transfers/playerChoice.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * The Free Agents page offers an academy signing for anyone young enough.
 * signToAcademy itself is covered in the core tests; this pins that the page
 * actually exposes it, which it silently stopped doing when Incoming Talent
 * was retired.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => new Proxy(
    { league: leagueRef.current, simming: false } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => {}) },
  ),
}));

const { FreeAgents } = await import("../../src/ui/pages/FreeAgents.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FreeAgents)));
}

/**
 * A league whose free-agent pool is a handful of young players who would pick
 * the user's club. Players choose where they sign (clubReputation Stage 2), so
 * a prospect an AI club wants more shows "Prefers <club>" instead of a button;
 * the fixture releases kids with no such rival.
 */
function youngPool(): LeagueStore {
  const league = makeLeague(0, 5);
  const fa = freeAgentPids(league.teams, league.players, league.activeLoans);
  const choice = playerChoice({
    teams: league.teams, players: league.players, competitions: league.competitions,
    season: league.season, played: league.played,
  }, league.meta.userTid);
  const young = league.players
    .filter((p) => !fa.has(p.pid) && league.season - p.born < ACADEMY_GRADUATION_AGE)
    .filter((p) => !league.teams.find((t) => t.tid === league.meta.userTid)!.roster.includes(p.pid))
    .filter((p) => choice.freeAgentRival(p) === null)
    .slice(0, 5)
    .map((p) => p.pid);
  const keep = new Set(young);
  return {
    ...league,
    // Only the young releases (plus whatever older free agents exist) are unsigned.
    players: league.players.filter((p) => !fa.has(p.pid) || keep.has(p.pid)),
    teams: league.teams.map((t) => ({ ...t, roster: t.roster.filter((pid) => !keep.has(pid)) })),
  };
}

describe("Free Agents academy signing", () => {
  it("offers an Academy button to players young enough", () => {
    const html = render(youngPool());
    expect(html).toContain("Academy ·");
    expect(html).toContain(`Academy age (under ${ACADEMY_GRADUATION_AGE})`);
  });

  it("says so when the academy is full", () => {
    const league = youngPool();
    const filler = league.players.slice(0, ACADEMY_ROSTER_CAP).map((p) => p.pid);
    const full = {
      ...league,
      teams: league.teams.map((t) => (t.tid === league.meta.userTid
        ? { ...t, academyRoster: filler }
        : t)),
    };
    expect(render(full)).toContain("Your academy is full");
  });
});
