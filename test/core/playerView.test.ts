import { describe, it, expect } from "vitest";
import { playerClubView, owningClub, PLAYER_VIEW_LIST } from "../../src/core/transfers/playerView.js";
import { userView } from "../../src/core/transfers/userView.js";
import { playerChoice } from "../../src/core/transfers/playerChoice.js";
import { makeLeague } from "../helpers/league.js";

describe("playerClubView", () => {
  const league = makeLeague(0, 1);
  const userTid = league.meta.userTid;
  const other = league.teams.find((t) => t.tid !== userTid && t.roster.length > 0)!;
  const star = other.roster
    .map((pid) => league.players.find((p) => p.pid === pid)!)
    .sort((a, b) => b.ovr - a.ovr)[0];
  const view = playerClubView(league, star);

  it("never lists his own club and counts every other one", () => {
    const all = view.favourites;
    expect(all.some((c) => c.tid === other.tid)).toBe(false);
    expect(view.clubCount).toBe(league.teams.length - 1);
  });

  it("orders favourites best first and caps both lists", () => {
    expect(view.favourites.length).toBeLessThanOrEqual(PLAYER_VIEW_LIST);
    for (let i = 1; i < view.favourites.length; i++) {
      expect(view.favourites[i - 1].appeal.score).toBeGreaterThanOrEqual(view.favourites[i].appeal.score);
    }
    for (const c of view.favourites) expect(c.appeal.refused).toBe(false);
  });

  it("marks a club as starting when he beats its weakest starter at his position", () => {
    // Judged at the destination alone, not from the playing-time line, which
    // is relative to his current club and clamped.
    const choice = playerChoice({
      teams: league.teams, players: league.players, competitions: league.competitions,
      season: league.season, played: league.played, model: league.progressionModel,
    }, userTid);
    const bench = league.players
      .filter((p) => other.roster.includes(p.pid))
      .sort((a, b) => a.ovr - b.ovr)[0];
    let seen = 0;
    for (const who of [star, bench]) {
      const v = playerClubView(league, who);
      for (const c of [...v.favourites, ...(v.yourClub ? [v.yourClub] : [])]) {
        expect(c.starts).toBe(who.ovr > choice.contexts.get(c.tid)!.posWeakestStarterOvr[who.pos]);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("agrees with the user's-club view the transfer pages read", () => {
    const fromList = userView(league).of(star, other.tid);
    expect(view.yourClub).not.toBeNull();
    expect(view.yourClub!.appeal.score).toBeCloseTo(fromList!.appeal.score, 12);
    expect(view.yourClub!.interest).toBe(fromList!.interest);
  });

  it("has no your-club line for your own player", () => {
    const mine = league.players.find((p) => p.pid === league.teams.find((t) => t.tid === userTid)!.roster[0])!;
    expect(playerClubView(league, mine).yourClub).toBeNull();
    expect(owningClub(league, mine.pid)).toBe(userTid);
  });
});
