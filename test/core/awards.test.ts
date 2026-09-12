import { describe, it, expect } from "vitest";
import {
  computeSeasonAwards, positionGroup, potyScore, totsScore, TOTS_SLOTS,
} from "../../src/core/awards.js";
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

/** Same player with a season's defensive work, keeper numbers, or a different appearance count. */
function withStats(p: Player, extra: Partial<Player["stats"][number]>): Player {
  return { ...p, stats: [{ ...p.stats[0], ...extra }] };
}

describe("Team of the Season: a formula per position", () => {
  it("scores an attacker on exactly his Player of the Season score", () => {
    // Defensive work adds nothing up front, which is what makes a forward who
    // wins Player of the Season the best at his position by construction.
    for (const pos of ["AM", "W", "ST"] as Position[]) {
      const p = withStats(player({ pid: 1, pos, goals: 14, assists: 6 }), { tackles: 40, interceptions: 30 });
      expect(totsScore(p, p.stats[0], SEASON)).toBeCloseTo(potyScore(p, p.stats[0], SEASON), 10);
    }
  });

  it("no longer lets a busier striker take the spot off a better one", () => {
    // The reported shape: the old formula paid a forward 0.01 per tackle and
    // interception on season totals, so 120 of them outweighed a goal and a
    // point of rating.
    const better = player({ pid: 1, pos: "ST", ovr: 90, goals: 22, assists: 6, avgRating: 7.1 });
    const busier = withStats(
      player({ pid: 2, pos: "ST", ovr: 88, goals: 21, assists: 6, avgRating: 7.0 }),
      { tackles: 60, interceptions: 60 },
    );
    const awards = computeSeasonAwards([better, busier], SEASON);
    expect(awards.playerOfSeasonPid).toBe(1);
    expect(awards.teamOfSeason).toContain(1);
    expect(awards.teamOfSeason).not.toContain(2);
  });

  it("counts defending per game, not over the season", () => {
    // Same rate over more games is the same defender, not a better one.
    const base = player({ pid: 1, pos: "CB", avgRating: 6.6 });
    const regular = withStats(base, { appearances: 34, tackles: 68, interceptions: 68 });
    const longer = withStats(base, { appearances: 38, tackles: 76, interceptions: 76 });
    expect(totsScore(regular, regular.stats[0], SEASON))
      .toBeCloseTo(totsScore(longer, longer.stats[0], SEASON), 10);
    // A higher rate is.
    const busier = withStats(base, { appearances: 34, tackles: 102, interceptions: 102 });
    expect(totsScore(busier, busier.stats[0], SEASON)).toBeGreaterThan(totsScore(regular, regular.stats[0], SEASON));
  });

  it("gives a centre-back more for his defending than a central midfielder", () => {
    const cb = withStats(player({ pid: 1, pos: "CB" }), { tackles: 60, interceptions: 60 });
    const cm = withStats(player({ pid: 2, pos: "CM" }), { tackles: 60, interceptions: 60 });
    const work = (p: Player) => totsScore(p, p.stats[0], SEASON) - potyScore(p, p.stats[0], SEASON);
    expect(work(cb)).toBeGreaterThan(work(cm));
    expect(work(cm)).toBeGreaterThan(0);
  });

  it("judges a keeper on goals conceded per game, not on saves", () => {
    // A keeper facing a barrage makes more saves and concedes more; that is a
    // busier keeper, not a better one.
    const calm = withStats(player({ pid: 1, pos: "GK" }), { goalsAgainst: 30, saves: 60 });
    const busy = withStats(player({ pid: 2, pos: "GK" }), { goalsAgainst: 50, saves: 140 });
    expect(totsScore(calm, calm.stats[0], SEASON)).toBeGreaterThan(totsScore(busy, busy.stats[0], SEASON));
    expect(computeSeasonAwards([calm, busy], SEASON).teamOfSeason[0]).toBe(1);
  });
});
