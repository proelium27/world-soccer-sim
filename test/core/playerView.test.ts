import { describe, it, expect } from "vitest";
import { playerClubView, owningClub, mainReason, PLAYER_VIEW_LIST } from "../../src/core/transfers/playerView.js";
import { userView } from "../../src/core/transfers/userView.js";
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
    const all = [...view.favourites, ...view.wouldPlay];
    expect(all.some((c) => c.tid === other.tid)).toBe(false);
    expect(view.clubCount).toBe(league.teams.length - 1);
  });

  it("orders favourites best first and caps both lists", () => {
    expect(view.favourites.length).toBeLessThanOrEqual(PLAYER_VIEW_LIST);
    expect(view.wouldPlay.length).toBeLessThanOrEqual(PLAYER_VIEW_LIST);
    for (let i = 1; i < view.favourites.length; i++) {
      expect(view.favourites[i - 1].appeal.score).toBeGreaterThanOrEqual(view.favourites[i].appeal.score);
    }
    for (const c of [...view.favourites, ...view.wouldPlay]) expect(c.appeal.refused).toBe(false);
  });

  it("only puts clubs he'd get games at in the playing list", () => {
    for (const c of view.wouldPlay) {
      const pt = c.appeal.lines.find((l) => l.id === "playingTime")?.value ?? 0;
      expect(pt).toBeGreaterThanOrEqual(0);
    }
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

  it("names the biggest line as the reason", () => {
    expect(mainReason({
      score: 0.1, refused: false,
      lines: [{ id: "home", label: "Home country", value: 0.05 }, { id: "playingTime", label: "Playing time", value: -0.2 }],
    })).toBe("Playing time");
    expect(mainReason({ score: 0, refused: false, lines: [] })).toBeNull();
  });
});
