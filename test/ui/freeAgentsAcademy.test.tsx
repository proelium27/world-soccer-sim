import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import { ACADEMY_ROSTER_CAP, PROSPECT_AGE_MAX } from "../../src/core/constants.js";
import { freeAgentPids } from "../../src/core/freeAgency.js";
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

/** A league whose free-agent pool is a handful of young players, so they make the list. */
function youngPool(): LeagueStore {
  const league = makeLeague(0, 5);
  const fa = freeAgentPids(league.teams, league.players, league.activeLoans);
  // Release a few of another club's youngest players into free agency.
  const donor = league.teams.find((t) => t.tid !== league.meta.userTid)!;
  const young = donor.roster
    .map((pid) => league.players.find((p) => p.pid === pid)!)
    .filter((p) => league.season - p.born <= PROSPECT_AGE_MAX)
    .slice(0, 3)
    .map((p) => p.pid);
  const keep = new Set(young);
  return {
    ...league,
    // Only the young releases (plus whatever older free agents exist) are unsigned.
    players: league.players.filter((p) => !fa.has(p.pid) || keep.has(p.pid)),
    teams: league.teams.map((t) => (t.tid === donor.tid
      ? { ...t, roster: t.roster.filter((pid) => !keep.has(pid)) }
      : t)),
  };
}

describe("Free Agents academy signing", () => {
  it("offers an Academy button to players young enough", () => {
    const html = render(youngPool());
    expect(html).toContain("Academy ·");
    expect(html).toContain(`Academy age (${PROSPECT_AGE_MAX} and under)`);
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
