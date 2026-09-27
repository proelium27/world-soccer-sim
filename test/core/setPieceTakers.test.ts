import { describe, it, expect } from "vitest";
import { setSetPieceTaker } from "../../src/core/lineup/setPieceTakers.js";
import { leagueMatchData } from "../../src/core/league/composites.js";
import { makeLeague } from "../helpers/league.js";

// One read-only world for the file; nothing here mutates it.
const league = makeLeague(0, 1);

describe("setSetPieceTaker", () => {
  it("names and clears the user's penalty and set-piece takers", () => {
    const userTid = league.meta.userTid;
    const [a, b] = league.teams.find((t) => t.tid === userTid)!.roster;

    const named = setSetPieceTaker(setSetPieceTaker(league, "penalty", a), "setPiece", b);
    const team = named.teams.find((t) => t.tid === userTid)!;
    expect(team.penaltyTaker).toBe(a);
    expect(team.setPieceTaker).toBe(b);

    const cleared = setSetPieceTaker(named, "penalty", null);
    expect(cleared.teams.find((t) => t.tid === userTid)!.penaltyTaker).toBeNull();
    expect(cleared.teams.find((t) => t.tid === userTid)!.setPieceTaker).toBe(b);
  });

  it("never names a player who isn't on the user's roster", () => {
    const rivalPid = league.teams.find((t) => t.tid !== league.meta.userTid)!.roster[0];
    for (const pid of [rivalPid, 9_999_999]) {
      const after = setSetPieceTaker(league, "penalty", pid);
      expect(after.teams.every((t, i) => t === league.teams[i])).toBe(true);
    }
  });

  it("flags the named takers on the match players, XI or bench", () => {
    const t = league.teams[0];
    const [pen, set] = t.roster;
    const data = leagueMatchData({
      teams: league.teams.map((x) => (x.tid === t.tid ? { ...x, avgOvr: 0, penaltyTaker: pen, setPieceTaker: set } : { ...x, avgOvr: 0 })),
      players: league.players,
    });
    const all = [...data[0].xi, ...data[0].bench];
    const penMp = all.find((p) => p.pid === pen);
    const setMp = all.find((p) => p.pid === set);
    // Either can be outside the 18 (a reserve), in which case there's nothing to flag.
    if (penMp) expect(penMp.penaltyTaker).toBe(true);
    if (setMp) expect(setMp.setPieceTaker).toBe(true);
    expect(all.filter((p) => p.penaltyTaker).length).toBeLessThanOrEqual(1);
    // No other club picks the flags up.
    for (const d of data.slice(1)) {
      expect([...d.xi, ...d.bench].some((p) => p.penaltyTaker || p.setPieceTaker)).toBe(false);
    }
  });
});
