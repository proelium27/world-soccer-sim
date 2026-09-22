import { describe, it, expect } from "vitest";
import { changedPosition, positionHistory } from "../../src/core/players/positions.js";
import { packPositionChange, unpackPositionChange } from "../../src/core/newsEvents.js";
import { progressPlayer } from "../../src/core/players/progression.js";
import { computeOvr } from "../../src/core/players/ovr.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { playSeason } from "../helpers/offseasonLeague.js";
import { simOffseason } from "../../src/core/offseason.js";
import { COVERABLE } from "../../src/engine/positionFit.js";
import { POSITIONS, type Player, type PlayerRatings, type Position } from "../../src/core/players/types.js";
import {
  POSITION_CHANGE_MARGIN,
  POSITION_CHANGE_SEASONS,
} from "../../src/core/constants.js";

const FLAT: PlayerRatings = {
  speed: 50, strength: 50, stamina: 50, jumping: 50,
  shortPass: 50, longPass: 50, crosses: 50, dribbling: 50, longShot: 50, finishing: 50,
  tackling: 50, interceptions: 50, positioning: 50, goalkeeping: 50,
};

/**
 * A winger built like a full-back: the defensive ratings FB weights and W does
 * not are raised, the attacking ones W leans on are cut. The exact gap this
 * produces is asserted in the tests rather than assumed, so a change to
 * OVR_WEIGHTS turns these into failures instead of silently making them vacuous.
 */
const FULLBACK_TILT: PlayerRatings = {
  ...FLAT,
  tackling: 82, interceptions: 82, strength: 70,
  dribbling: 34, finishing: 34, longShot: 34,
};

/**
 * A winger shaped like one: what W weights and FB does not is up, the
 * defensive ratings FB leans on are down. This is the "nothing to see here"
 * fixture, and it has to be a real winger rather than FLAT ratings — flat
 * ratings are not neutral. Every position's OVR carries a level correction
 * (POSITION_OVR_CALIBRATION), so a player with no shape at all still rates a
 * few points better at the positions that carry a positive one, which is
 * correct (a winger with a defender's balance of skills *is* better placed at
 * full-back) but makes him a terrible stand-in for "unremarkable".
 */
const WINGER_SHAPE: PlayerRatings = {
  ...FLAT,
  speed: 64, dribbling: 64, crosses: 62,
  tackling: 38, interceptions: 38,
};

function player(over: Partial<Player> = {}): Player {
  const pos = over.pos ?? "W";
  const ratings = over.ratings ?? FLAT;
  const heightCm = over.heightCm ?? 178;
  return {
    pid: 1,
    name: "Test Player",
    nationality: "TST",
    born: 1,
    pos,
    heightCm,
    ratings,
    ovr: computeOvr(pos, ratings, heightCm),
    potential: 70,
    contract: { salary: 1_000_000, expiresSeason: 10 },
    injury: null,
    stats: [],
    hist: [],
    ...over,
  };
}

/** `n` identical past seasons, all stamped at `pos`. */
function history(ratings: PlayerRatings, pos: Position, n: number, heightCm = 178) {
  return Array.from({ length: n }, (_, i) => ({
    season: i + 1,
    ratings,
    ovr: computeOvr(pos, ratings, heightCm),
    potential: 70,
    academy: false,
    pos,
  }));
}

describe("changedPosition — the gates", () => {
  it("moves a player who has been clearly better elsewhere for the full window", () => {
    const p = player({
      ratings: FULLBACK_TILT,
      hist: history(FULLBACK_TILT, "W", POSITION_CHANGE_SEASONS - 1),
    });
    // Precondition, so this can never pass because the fixture stopped tilting.
    const gap = computeOvr("FB", FULLBACK_TILT, 178) - computeOvr("W", FULLBACK_TILT, 178);
    expect(gap).toBeGreaterThanOrEqual(POSITION_CHANGE_MARGIN);

    expect(changedPosition(p, FULLBACK_TILT)).toBe("FB");
  });

  it("leaves a player alone when the gap is only this season's", () => {
    // Same tilted ratings today, but his recorded seasons were flat — exactly
    // the shape a noise-driven one-season blip has, and the 6-8% of players who
    // change their best position every season are mostly this.
    const p = player({
      ratings: FULLBACK_TILT,
      hist: history(WINGER_SHAPE, "W", POSITION_CHANGE_SEASONS - 1),
    });
    // Precondition: those recorded seasons really do show a settled winger.
    const past = computeOvr("FB", WINGER_SHAPE, 178) - computeOvr("W", WINGER_SHAPE, 178);
    expect(past).toBeLessThan(POSITION_CHANGE_MARGIN);

    expect(changedPosition(p, FULLBACK_TILT)).toBeNull();
  });

  it("leaves a player alone without enough history to judge", () => {
    // A youth-intake player carries one seeded snapshot, so he cannot convert
    // in his first seasons however lopsided he looks.
    const p = player({ ratings: FULLBACK_TILT, hist: [] });
    expect(changedPosition(p, FULLBACK_TILT)).toBeNull();
    const one = player({ ratings: FULLBACK_TILT, hist: history(FULLBACK_TILT, "W", 1) });
    expect(POSITION_CHANGE_SEASONS).toBeGreaterThan(2); // else the case below is empty
    expect(changedPosition(one, FULLBACK_TILT)).toBeNull();
  });

  it("leaves a player alone when the gap is real but under the margin", () => {
    // Scaled back until it sits just below the bar. Everyone has *some*
    // position they rate a little higher at; that is not a career change.
    const mild: PlayerRatings = { ...WINGER_SHAPE, tackling: 52, interceptions: 52 };
    const gap = computeOvr("FB", mild, 178) - computeOvr("W", mild, 178);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(POSITION_CHANGE_MARGIN);

    const p = player({ ratings: mild, hist: history(mild, "W", POSITION_CHANGE_SEASONS - 1) });
    expect(changedPosition(p, mild)).toBeNull();
  });
});

describe("changedPosition — what it can never do", () => {
  it("never moves a keeper, and never moves anyone into goal", () => {
    // A keeper's outfield ratings are meaningless numbers the model will still
    // produce, so this is the gate that stops them being acted on.
    const gk = player({
      pos: "GK",
      ratings: FULLBACK_TILT,
      heightCm: 192,
      hist: history(FULLBACK_TILT, "GK", POSITION_CHANGE_SEASONS - 1, 192),
    });
    expect(changedPosition(gk, FULLBACK_TILT)).toBeNull();

    for (const pos of POSITIONS) {
      const keeperish: PlayerRatings = { ...FLAT, goalkeeping: 99 };
      const p = player({
        pos,
        ratings: keeperish,
        hist: history(keeperish, pos, POSITION_CHANGE_SEASONS - 1),
      });
      expect(changedPosition(p, keeperish)).not.toBe("GK");
    }
  });

  it("only ever returns a position the player could already cover", () => {
    // Bounds the whole mechanic: a conversion is one step across the pitch, so
    // no tilt of the ratings can turn a striker into a centre-back.
    const extremes: PlayerRatings[] = [
      FULLBACK_TILT,
      { ...FLAT, goalkeeping: 99 },
      { ...FLAT, finishing: 99, positioning: 99, longShot: 99 },
      { ...FLAT, tackling: 99, interceptions: 99, strength: 99, jumping: 99 },
      { ...FLAT, shortPass: 99, longPass: 99, stamina: 99 },
    ];
    for (const pos of POSITIONS) {
      for (const ratings of extremes) {
        const p = player({
          pos,
          ratings,
          hist: history(ratings, pos, POSITION_CHANGE_SEASONS - 1),
        });
        const to = changedPosition(p, ratings);
        if (to !== null) expect(COVERABLE[pos]).toContain(to);
      }
    }
  });
});

describe("changedPosition — the cooldown", () => {
  it("ignores history recorded at a position he has since left", () => {
    // The window counts only seasons spent at his CURRENT position, which is
    // what gives a conversion its cooldown: right after moving, his history
    // there is empty and he cannot move again. Without this a borderline player
    // could oscillate, and every leg of an oscillation mints ovr.
    const justConverted = player({
      pos: "FB",
      ratings: FULLBACK_TILT,
      // A full window of seasons, but all of them stamped at his OLD position.
      hist: history(FULLBACK_TILT, "W", POSITION_CHANGE_SEASONS + 2),
    });
    expect(changedPosition(justConverted, FULLBACK_TILT)).toBeNull();
  });

  it("will not span a gap to reach a full window", () => {
    // He played here years ago, left, and has just come back. Those old seasons
    // are at the right position but belong to a different spell; counting them
    // would let a returning player convert again immediately, which is exactly
    // the oscillation the cooldown exists to prevent.
    const returned = player({
      pos: "W",
      ratings: FULLBACK_TILT,
      hist: [
        ...history(FULLBACK_TILT, "W", 4),
        ...history(FULLBACK_TILT, "AM", 3).map((h) => ({ ...h, season: h.season + 4 })),
        // A single season back at W — one short of the window on its own.
        ...history(FULLBACK_TILT, "W", 1).map((h) => ({ ...h, season: h.season + 7 })),
      ],
    });
    expect(POSITION_CHANGE_SEASONS - 1).toBeGreaterThan(1); // else there is no gap to span
    expect(changedPosition(returned, FULLBACK_TILT)).toBeNull();
  });

  it("counts a full window once he has served it at the new position", () => {
    const winger: PlayerRatings = {
      ...FLAT,
      speed: 84, dribbling: 84, crosses: 80,
      tackling: 30, interceptions: 30,
    };
    const gap = computeOvr("W", winger, 178) - computeOvr("FB", winger, 178);
    expect(gap).toBeGreaterThanOrEqual(POSITION_CHANGE_MARGIN);

    const settled = player({
      pos: "FB",
      ratings: winger,
      hist: [
        ...history(FLAT, "W", 3),
        ...history(winger, "FB", POSITION_CHANGE_SEASONS - 1),
      ],
    });
    expect(changedPosition(settled, winger)).toBe("W");
  });
});

describe("positionHistory", () => {
  it("reports each move, oldest first, and nothing for a settled player", () => {
    const settled = player({ hist: history(FLAT, "W", 5) });
    expect(positionHistory(settled)).toEqual([]);

    const moved = player({
      pos: "AM",
      hist: [
        ...history(FLAT, "W", 3),
        ...history(FLAT, "FB", 2).map((h) => ({ ...h, season: h.season + 3 })),
        ...history(FLAT, "AM", 1).map((h) => ({ ...h, season: h.season + 5 })),
      ],
    });
    expect(positionHistory(moved)).toEqual([
      { season: 4, from: "W", to: "FB" },
      { season: 6, from: "FB", to: "AM" },
    ]);
  });

  it("reads a pre-feature save as never having moved", () => {
    // migrate.ts stamps every old snapshot with the player's current position,
    // which is exact rather than a guess: nothing could change a position before
    // this existed. The note on his profile must therefore stay silent.
    const migrated = player({ pos: "CM", hist: history(FLAT, "CM", 8) });
    expect(positionHistory(migrated)).toEqual([]);
  });
});

describe("news event packing", () => {
  it("round-trips every ordered pair of positions", () => {
    // Both ends have to survive: reading the "to" off the player's current
    // position would silently rewrite old feed entries after his next move.
    for (const from of POSITIONS) {
      for (const to of POSITIONS) {
        expect(unpackPositionChange(packPositionChange(from, to))).toEqual({ from, to });
      }
    }
  });
});

describe("offseason wiring", () => {
  // The rule is unit-tested above; this pins that it is actually CONNECTED —
  // that a conversion survives a real offseason and is announced. Without it,
  // deleting the emission in offseason.ts would break nothing in the suite.
  it("converts a player through a real offseason and puts it on the news feed", () => {
    const rng = mulberry32(21);
    let league = createLeagueState(0, rng);

    // Plant a winger built like a full-back on the user's club, with a full
    // window of history behind him, so exactly one conversion is expected.
    const userTid = league.meta.userTid;
    const userTeam = league.teams.find((t) => t.tid === userTid)!;
    const target = league.players.find(
      (p) => userTeam.roster.includes(p.pid) && p.pos === "W",
    )!;
    const planted: Player = {
      ...target,
      ratings: FULLBACK_TILT,
      ovr: computeOvr("W", FULLBACK_TILT, target.heightCm),
      hist: history(FULLBACK_TILT, "W", POSITION_CHANGE_SEASONS - 1, target.heightCm),
    };
    league = {
      ...league,
      players: league.players.map((p) => (p.pid === target.pid ? planted : p)),
    };

    // playSeason, not a bare simThrough: simThrough HALTS before the user's own
    // cup final, and simOffseason then silently does nothing on a league still
    // in the regular phase — no player is progressed, so no conversion fires and
    // this reads as "he stayed a winger". Which seeds halt moves with any change
    // to match results; the raised foul rate is what put this seed's club in a
    // final (2026-09-22). Byte-identical for a seed that never halts.
    league = playSeason(league, rng);
    const next = simOffseason(league, rng);

    const after = next.players.find((p) => p.pid === target.pid);
    // He could in principle retire, in which case there is nothing to assert.
    if (after === undefined) return;
    expect(after.pos).toBe("FB");

    const event = next.newsEvents.find(
      (e) => e.type === "positionChange" && e.pid === target.pid,
    );
    expect(event).toBeDefined();
    expect(unpackPositionChange(event!.detail)).toEqual({ from: "W", to: "FB" });
  });
});

describe("progressPlayer integration", () => {
  it("stamps the position on the snapshot and rates him at the new one", () => {
    const p = player({
      born: 1,
      ratings: FULLBACK_TILT,
      hist: history(FULLBACK_TILT, "W", POSITION_CHANGE_SEASONS - 1),
    });
    const next = progressPlayer(mulberry32(3), p, 25);

    expect(next.pos).toBe("FB");
    // His rating must be recomputed at the position he now holds, not carried
    // over from the old one.
    expect(next.ovr).toBe(computeOvr("FB", next.ratings, next.heightCm));
    const last = next.hist[next.hist.length - 1];
    expect(last.pos).toBe("FB");
    expect(last.ovr).toBe(next.ovr);
  });

  it("consumes the same number of rng draws whether or not he converts", () => {
    // The seeded stream is load-bearing: inserting or removing a draw shifts
    // every downstream roll in the world. Position changes ride entirely on
    // attributes, so a converting player and a settled one of the same age must
    // leave the stream in the same place.
    const count = (p: Player) => {
      let n = 0;
      const rng = mulberry32(11);
      const counting = () => { n++; return rng(); };
      progressPlayer(counting, p, 25);
      return n;
    };

    const converts = player({
      ratings: FULLBACK_TILT,
      hist: history(FULLBACK_TILT, "W", POSITION_CHANGE_SEASONS - 1),
    });
    const settles = player({
      ratings: WINGER_SHAPE,
      hist: history(WINGER_SHAPE, "W", POSITION_CHANGE_SEASONS - 1),
    });
    // Guard that the two fixtures really do differ in outcome.
    expect(changedPosition(converts, converts.ratings)).toBe("FB");
    expect(changedPosition(settles, settles.ratings)).toBeNull();

    expect(count(converts)).toBe(count(settles));
  });
});
