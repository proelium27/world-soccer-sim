import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { Player } from "../../src/core/players/types.js";
import { playerClubView } from "../../src/core/transfers/playerView.js";

/**
 * The How he sees clubs card: every reason a player weighs, a column each, for
 * his favourites and your club.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current }),
}));

const { HowHeSeesClubs, FACTORS, shownFactors, signed } = await import("../../src/ui/components/HowHeSeesClubs.js");

function render(league: LeagueStore, player: Player): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(HowHeSeesClubs, { league, player })),
  );
}

describe("How he sees clubs", () => {
  const league = makeLeague(0, 1);
  const userTid = league.meta.userTid;
  const elsewhere = league.players
    .filter((p) => league.teams.some((t) => t.tid !== userTid && t.roster.includes(p.pid)))
    .sort((a, b) => b.ovr - a.ovr);

  it("signs every value and never prints a negative zero", () => {
    expect(signed(0.123)).toBe("+0.12");
    expect(signed(-0.05)).toBe("−0.05");
    expect(signed(-0.001)).toBe("0.00");
    expect(signed(0.004)).toBe("0.00");
  });

  it("shows only the reasons some club actually has, in the model's order", () => {
    const shown = shownFactors([
      { score: 0, refused: false, lines: [{ id: "home", label: "Home country", value: 0.1 }] },
      { score: 0, refused: false, lines: [{ id: "level", label: "Level of club", value: -0.1 }] },
    ]);
    expect(shown.map((f) => f.id)).toEqual(["level", "home"]);
    expect(FACTORS).toHaveLength(7);
  });

  it("gives every club a cell under each reason it shows, and a total", () => {
    const player = elsewhere[Math.floor(elsewhere.length / 2)];
    const view = playerClubView(league, player);
    const html = render(league, player);
    const factors = shownFactors([...view.favourites, view.yourClub!].map((c) => c.appeal));
    for (const f of factors) expect(html).toContain(`>${f.head}</th>`);
    expect(html).toContain(">Total</th>");
    expect(html).toContain("Your club");
    // A favourite's total is the sum of its reasons, as the markets score it.
    const top = view.favourites[0];
    expect(html).toContain(`>${signed(top.appeal.score)}</td>`);
  });

  it("names a refusal instead of showing its −1 marker", () => {
    // Make the user the world's weakest club, which its best players won't drop to.
    const byPid = new Map(league.players.map((p) => [p.pid, p]));
    const strength = (tid: number) => league.teams.find((t) => t.tid === tid)!.roster
      .reduce((n, pid) => n + (byPid.get(pid)?.ovr ?? 0), 0);
    const weakest = league.teams.reduce((a, b) => (strength(b.tid) < strength(a.tid) ? b : a));
    const small: LeagueStore = { ...league, meta: { ...league.meta, userTid: weakest.tid } };
    const star = elsewhere.find((p) => playerClubView(small, p).yourClub?.appeal.refused);
    expect(star).toBeDefined();
    const html = render(small, star!);
    expect(html).toContain(">Too small</td>");
    expect(html).toContain(">Refuses</td>");
    expect(html).not.toContain("−1.00");
  });

  it("has no your-club group for your own player", () => {
    const mine = league.players.find((p) => p.pid === league.teams.find((t) => t.tid === userTid)!.roster[0])!;
    expect(render(league, mine)).not.toContain("Your club");
  });
});
