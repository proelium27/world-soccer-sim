import { describe, it, expect } from "vitest";
import { playerClubView, owningClub, mainReason, PLAYER_VIEW_LIST } from "../../src/core/transfers/playerView.js";
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

  it("only puts clubs where he'd beat their weakest starter in the playing list", () => {
    // Judged at the destination alone, not against his current club: the
    // playing-time line is relative and clamped, so a benched youngster reads
    // 0 at every club where he'd also sit.
    const choice = playerChoice({
      teams: league.teams, players: league.players, competitions: league.competitions,
      season: league.season, played: league.played, model: league.progressionModel,
    }, userTid);
    const bench = league.players
      .filter((p) => other.roster.includes(p.pid))
      .sort((a, b) => a.ovr - b.ovr)[0];
    for (const who of [star, bench]) {
      const v = playerClubView(league, who);
      for (const c of v.wouldPlay) {
        expect(who.ovr).toBeGreaterThan(choice.contexts.get(c.tid)!.posWeakestStarterOvr[who.pos]);
      }
      // And nothing the rule admits is skipped for a lower-ranked club.
      const admitted = [...v.favourites].filter((c) => who.ovr > choice.contexts.get(c.tid)!.posWeakestStarterOvr[who.pos]);
      if (admitted.length > 0) expect(v.wouldPlay[0].tid).toBe(admitted[0].tid);
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
