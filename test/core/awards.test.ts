import { describe, it, expect } from "vitest";
import {
  computeSeasonAwards, positionGroup, potyScore, totsScore, TOTS_SLOTS,
} from "../../src/core/awards.js";
import { worldHonourees, type WorldAwards } from "../../src/core/worldAwards.js";

describe("worldHonourees", () => {
  it("lists the Ballon d'Or winner, the position awards, then the World XI", () => {
    const entry = (pid: number) => ({ pid, tid: 0, score: 0, league: 0, cup: 0, intl: 0, title: 0 });
    const world = {
      ballonDOr: [entry(7), entry(8)],
      goalkeeperOfYear: [entry(1)],
      defenderOfYear: [entry(2)],
      worldTeamOfYear: [1, 2, null, 3],
    } as unknown as WorldAwards;
    // The shortlist behind the winner (pid 8) is a ranking, not an honour.
    expect(worldHonourees(world)).toEqual([7, 1, 2, 1, 2, 3]);
    expect(worldHonourees(undefined)).toEqual([]);
  });
});
import { emptySeasonStats, type Player, type Position } from "../../src/core/players/types.js";

const SEASON = 5;

interface PlayerSpec {
  pid: number;
  pos: Position;
  ovr?: number;
  goals?: number;
  assists?: number;
  avgRating?: number;
}

function player(spec: PlayerSpec): Player {
  const ovr = spec.ovr ?? 75;
  const appearances = 30;
  const stats = {
    ...emptySeasonStats(SEASON, 1),
    appearances,
    goals: spec.goals ?? 0,
    assists: spec.assists ?? 0,
    avgRating: spec.avgRating ?? 6.5,
    minutesPlayed: appearances * 90,
  };
  return {
    pid: spec.pid,
    name: `Player ${spec.pid}`,
    nationality: "England",
    born: SEASON - 26,
    pos: spec.pos,
    ovr,
    stats: [stats],
    // ovrDuringSeason reads the hist entry tagged `season - 1`.
    hist: [{ season: SEASON - 1, ovr, potential: ovr, academy: false, ratings: {} }],
  } as unknown as Player;
}

describe("award position groups", () => {
  it("scores an attacking midfielder as a forward, not a midfielder", () => {
    expect(positionGroup("AM")).toBe("FWD");
    expect(positionGroup("W")).toBe("FWD");
    expect(positionGroup("ST")).toBe("FWD");
  });

  it("still scores central and defensive midfielders as midfielders", () => {
    expect(positionGroup("CM")).toBe("MID");
    expect(positionGroup("DM")).toBe("MID");
  });

  it("gives an AM and a W with the same season the same end-product credit", () => {
    const am = player({ pid: 1, pos: "AM", goals: 12, assists: 10 });
    const w = player({ pid: 2, pos: "W", goals: 12, assists: 10 });
    expect(potyScore(am, am.stats[0], SEASON)).toBeCloseTo(potyScore(w, w.stats[0], SEASON), 10);
  });

  it("lets a winger with more goals beat an otherwise identical AM", () => {
    // Grouped as a midfielder the AM was paid 0.10/goal and 0.07/assist against
    // the winger's 0.08/0.05 — a 25%/40% premium for the same job — so he took
    // Player of the Season here (8.70 to 8.34) despite scoring one goal fewer.
    const am = player({ pid: 1, pos: "AM", goals: 12, assists: 10, avgRating: 6.8 });
    const winger = player({ pid: 2, pos: "W", goals: 13, assists: 10, avgRating: 6.8 });

    expect(computeSeasonAwards([am, winger], SEASON).playerOfSeasonPid).toBe(2);
  });

  it("keeps a defender's goals worth more than an attacker's", () => {
    // The groups exist to price end product by how hard it is to come by;
    // moving AM must not flatten that.
    const cb = player({ pid: 1, pos: "CB", goals: 10 });
    const st = player({ pid: 2, pos: "ST", goals: 10 });
    expect(potyScore(cb, cb.stats[0], SEASON)).toBeGreaterThan(potyScore(st, st.stats[0], SEASON));
  });
});

describe("Team of the Season slots", () => {
  it("gives the attacking midfielder a slot", () => {
    // Without one an AM is structurally ineligible: he can win Player of the
    // Season and never appear in the XI. Measured before this slot existed,
    // every AM who won it missed out — 14 of 14 over 6 seasons x 2 seeds.
    expect(TOTS_SLOTS).toContain("AM");
  });

  it("is eleven slots in a 4-3-3 shape", () => {
    // Still a real formation, so it reads correctly on the pitch view: one
    // keeper, a back four, a midfield three, a front three.
    expect(TOTS_SLOTS).toHaveLength(11);
    const count = (...of: Position[]) => TOTS_SLOTS.filter((p) => of.includes(p)).length;
    expect(count("GK")).toBe(1);
    expect(count("CB", "FB")).toBe(4);
    expect(count("DM", "CM", "AM")).toBe(3);
    expect(count("W", "ST")).toBe(3);
  });

  it("actually picks an attacking midfielder into the XI", () => {
    const am = player({ pid: 1, pos: "AM", goals: 15, assists: 12 });
    expect(computeSeasonAwards([am], SEASON).teamOfSeason).toContain(1);
  });
});

/** A striker whose Team of the Season case beats a better player's on tackles alone. */
function withDefending(p: Player, tacklesAndInterceptions: number): Player {
  const s = p.stats[0];
  return { ...p, stats: [{ ...s, tackles: tacklesAndInterceptions, interceptions: tacklesAndInterceptions }] };
}

describe("Team of the Season agrees with the bigger honours", () => {
  // Two strikers for one ST slot. The busy one wins totsScore on defensive
  // work (0.01 a tackle for a forward), while the elite one scores more and
  // rates higher — the shape of the report that prompted this.
  const elite = () => player({ pid: 1, pos: "ST", ovr: 80, goals: 22, assists: 6, avgRating: 7.0 });
  const busy = () => withDefending(player({ pid: 2, pos: "ST", ovr: 78, goals: 21, assists: 6, avgRating: 6.9 }), 60);

  it("sets up a real disagreement between the two formulas", () => {
    // Guards the fixture: the busy striker must win on totsScore while the
    // elite one wins Player of the Season, or the tests below prove nothing.
    const e = elite();
    const b = busy();
    expect(totsScore(b, b.stats[0], SEASON)).toBeGreaterThan(totsScore(e, e.stats[0], SEASON));
    expect(computeSeasonAwards([e, b], SEASON).playerOfSeasonPid).toBe(1);
  });

  it("always includes the league's Player of the Season", () => {
    const awards = computeSeasonAwards([elite(), busy()], SEASON);
    expect(awards.teamOfSeason).toContain(awards.playerOfSeasonPid);
  });

  it("always includes the league's Golden Boot winner", () => {
    const scorer = player({ pid: 3, pos: "ST", ovr: 70, goals: 30, avgRating: 6.4 });
    const awards = computeSeasonAwards([elite(), scorer], SEASON);
    expect(awards.goldenBootPid).toBe(3);
    // POTY and Golden Boot are different strikers and there is one ST slot, so
    // the higher-priority honour keeps it.
    expect(awards.teamOfSeason).toContain(awards.playerOfSeasonPid);
  });

  it("seats a worldwide honouree ahead of the league's own winners", () => {
    // The Ballon d'Or winner is the busy striker's team-mate here; he takes the
    // one ST slot even though the league named someone else.
    const awards = computeSeasonAwards([elite(), busy()], SEASON, [2]);
    expect(awards.teamOfSeason).toContain(2);
    expect(awards.teamOfSeason.filter((pid) => pid !== null)).toHaveLength(1);
  });

  it("only seats a player at his own position and never twice", () => {
    const winger = player({ pid: 4, pos: "W", goals: 10 });
    const xi = computeSeasonAwards([winger], SEASON, [4, 4]).teamOfSeason;
    expect(xi.filter((pid) => pid === 4)).toHaveLength(1);
    TOTS_SLOTS.forEach((slot, i) => {
      if (xi[i] === 4) expect(slot).toBe("W");
    });
  });

  it("ignores honourees who aren't in this league", () => {
    const xi = computeSeasonAwards([elite()], SEASON, [999]).teamOfSeason;
    expect(xi).toContain(1);
    expect(xi).not.toContain(999);
  });
});
