import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
import {
  MAX_SUBS,
  SUB_WINDOWS_IN_PLAY,
  SUB_MAX_PER_WINDOW,
  SUB_WINDOW_MOMENTS_ELAPSED,
  SUB_WINDOW_HALFTIME_ELAPSED,
  SUB_WINDOW_JITTER_SECONDS,
  MATCH_SECONDS,
  MAX_DT,
} from "../../src/engine/constants.js";
import type { MatchPlayer } from "../../src/engine/attribution.js";

function makeSquad(pidOffset: number, stamina = 50): MatchPlayer[] {
  const positions: MatchPlayer["pos"][] = [
    "GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST",
  ];
  return positions.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: pos === "ST" ? 68 : 62,
    shooting: pos === "ST" ? 80 : 40,
    dribbling: 50,
    tackling: pos === "CB" || pos === "DM" ? 70 : 40,
    keeping: pos === "GK" ? 80 : 5,
    positioning: 55,
    heading: 45,
    stamina,
    interceptions: pos === "CB" || pos === "DM" ? 70 : 40,
    passing: 50,
  }));
}

function makeBench(pidOffset: number, stamina = 50): MatchPlayer[] {
  const positions: MatchPlayer["pos"][] = ["CB", "FB", "CM", "W", "ST", "AM", "DM"];
  return positions.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: pos === "ST" ? 68 : 62,
    shooting: pos === "ST" ? 85 : 45,
    dribbling: 50,
    tackling: 50,
    keeping: 5,
    positioning: 55,
    heading: 45,
    stamina,
    interceptions: 50,
    passing: 50,
  }));
}

describe("fatigue + substitutions", () => {
  it("substitutes in windows: several changes at once, capped by MAX_SUBS and the window budget", () => {
    const rng = mulberry32(1);
    const result = simMatchDetailed(
      rng,
      makeTeam("Home"),
      makeTeam("Away"),
      makeSquad(0),
      makeSquad(100),
      makeBench(1000),
      makeBench(2000),
    );

    for (const side of ["home", "away"] as const) {
      const subs = result.boxScore.events.filter(
        (e) => e.type === "substitution" && e.side === side,
      );
      const injuries = new Set(
        result.boxScore.events
          .filter((e) => e.type === "injury" && e.side === side)
          .map((e) => e.pids[0]),
      );
      // Injury replacements fire the instant they are needed rather than at a
      // window, so they are outside the budget this test is about.
      const planned = subs.filter((e) => !injuries.has(e.pids[0]));

      // Never more than the laws allow, however deep the bench.
      expect(subs.length).toBeLessThanOrEqual(MAX_SUBS);

      // Every change made inside one window is committed on the same tick, so an
      // exact clock value identifies the window. Matching against the nominal
      // minutes would not work: the in-play moments are jittered per side.
      const clocks = planned.map((e) => e.clock);

      // Each in-play window lands within the jitter of one of the nominal
      // moments (plus a tick, since a moment fires on the first tick past it).
      for (const c of clocks) {
        const elapsed = MATCH_SECONDS - c;
        if (Math.abs(elapsed - SUB_WINDOW_HALFTIME_ELAPSED) <= MAX_DT) continue;
        const near = SUB_WINDOW_MOMENTS_ELAPSED.some(
          (m) =>
            elapsed >= m - SUB_WINDOW_JITTER_SECONDS &&
            elapsed <= m + SUB_WINDOW_JITTER_SECONDS + MAX_DT,
        );
        expect(near).toBe(true);
      }

      // The budget is on OPPORTUNITIES, not on players: at most three in-play
      // windows (half-time is free and additional), and at most
      // SUB_MAX_PER_WINDOW changes inside any one of them.
      const inPlayWindows = new Set(
        clocks.filter(
          (c) => MATCH_SECONDS - c > SUB_WINDOW_HALFTIME_ELAPSED + MAX_DT,
        ),
      );
      expect(inPlayWindows.size).toBeLessThanOrEqual(SUB_WINDOWS_IN_PLAY);
      for (const c of new Set(clocks)) {
        const inThisWindow = clocks.filter((x) => x === c).length;
        expect(inThisWindow).toBeLessThanOrEqual(SUB_MAX_PER_WINDOW);
      }
    }

    // The point of a window: this bench is deep enough and this squad tired
    // enough that at least one side gets more than the two changes the old
    // fixed-checkpoint model could ever make.
    const perSide = (["home", "away"] as const).map(
      (side) =>
        result.boxScore.events.filter(
          (e) => e.type === "substitution" && e.side === side,
        ).length,
    );
    expect(Math.max(...perSide)).toBeGreaterThan(2);
  });

  it("box score includes subbed-on bench players who accumulate stats", () => {
    const rng = mulberry32(1);
    const result = simMatchDetailed(
      rng,
      makeTeam("Home"),
      makeTeam("Away"),
      makeSquad(0),
      makeSquad(100),
      makeBench(1000),
      makeBench(2000),
    );
    const subEvents = result.boxScore.events.filter((e) => e.type === "substitution");
    for (const e of subEvents) {
      const onPid = e.pids[1];
      const line = [...result.boxScore.home, ...result.boxScore.away].find((l) => l.pid === onPid);
      expect(line).toBeDefined();
    }
    // Starting XI is still 11 + however many bench players came on and touched the ball/box score.
    expect(result.boxScore.home.length).toBeGreaterThanOrEqual(11);
    expect(result.boxScore.away.length).toBeGreaterThanOrEqual(11);
  });

  it("does not substitute when no bench is provided", () => {
    const rng = mulberry32(7);
    const result = simMatchDetailed(
      rng,
      makeTeam("Home"),
      makeTeam("Away"),
      makeSquad(0),
      makeSquad(100),
    );
    const subs = result.boxScore.events.filter((e) => e.type === "substitution");
    expect(subs).toHaveLength(0);
    expect(result.boxScore.home).toHaveLength(11);
    expect(result.boxScore.away).toHaveLength(11);
  });

  it("low-stamina squads generate fewer shots than an otherwise-identical high-stamina squad", () => {
    // Same composites, same seed, same everything except stamina — fatigue should be the
    // only thing driving a difference, and tired legs should mean fewer created chances.
    // trials was 40 pre-interception-split; the three-way tackle/interception credit roll
    // added an extra rng() draw per turnover, shifting the downstream tick sequence enough
    // that 40 trials occasionally failed on a borderline seed. Bumped to 200 to smooth that
    // noise back out rather than change the (intentional, approved) credit-roll logic.
    const trials = 200;
    let lowShots = 0;
    let highShots = 0;
    for (let seed = 1; seed <= trials; seed++) {
      const lowRng = mulberry32(seed);
      const low = simMatchDetailed(
        lowRng,
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0, 1),
        makeSquad(100, 1),
      );
      lowShots += low.stat.home.shots + low.stat.away.shots;

      const highRng = mulberry32(seed);
      const high = simMatchDetailed(
        highRng,
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0, 99),
        makeSquad(100, 99),
      );
      highShots += high.stat.home.shots + high.stat.away.shots;
    }
    expect(lowShots).toBeLessThan(highShots);
  });

  it("red-carded players are removed from the pitch and can't be subbed off or on again", () => {
    // Run several seeds and check invariants hold whenever a red card actually occurs.
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng,
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0),
        makeSquad(100),
        makeBench(1000),
        makeBench(2000),
      );
      const redEvents = result.boxScore.events.filter((e) => e.type === "red_card");
      for (const e of redEvents) {
        const line = [...result.boxScore.home, ...result.boxScore.away].find((l) => l.pid === e.pids[0]);
        expect(line?.redCards).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("never makes more than MAX_SUBS substitutions per side", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng,
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0),
        makeSquad(100),
        makeBench(1000),
        makeBench(2000),
      );
      for (const side of ["home", "away"] as const) {
        const subs = result.boxScore.events.filter(
          (e) => e.type === "substitution" && e.side === side,
        );
        expect(subs.length).toBeLessThanOrEqual(MAX_SUBS);
      }
    }
  });

  it("a second yellow to the same player becomes a red card and removes him", () => {
    let sawSecondYellow = false;
    for (let seed = 1; seed <= 400; seed++) {
      const rng = mulberry32(seed);
      const result = simMatchDetailed(
        rng,
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0),
        makeSquad(100),
        makeBench(1000),
        makeBench(2000),
      );
      const allLines = [...result.boxScore.home, ...result.boxScore.away];
      for (const line of allLines) {
        if (line.yellowCards < 2) continue;
        sawSecondYellow = true;
        // Two yellows cap out (the player is off, he can't be booked again)...
        expect(line.yellowCards).toBe(2);
        // ...and always come with the resulting red on his line...
        expect(line.redCards).toBe(1);
        // ...whose event immediately follows the second yellow in the log.
        const yellows = result.boxScore.events.filter(
          (e) => e.type === "yellow_card" && e.pids[0] === line.pid,
        );
        expect(yellows).toHaveLength(2);
        const idx = result.boxScore.events.findIndex(
          (e) => e === yellows[1],
        );
        expect(result.boxScore.events[idx + 1]).toMatchObject({
          type: "red_card",
          pids: [line.pid],
        });
      }
    }
    expect(sawSecondYellow).toBe(true);
  });

  it("substitutions re-roll composites through the recompute hook (spec §4)", () => {
    // Wiring check: the hook fires on every home sub with the full on-pitch XI.
    const xiSizes: number[] = [];
    const rng = mulberry32(1);
    const result = simMatchDetailed(
      rng,
      makeTeam("Home"),
      makeTeam("Away"),
      makeSquad(0),
      makeSquad(100),
      makeBench(1000),
      makeBench(2000),
      {
        recompute: {
          home: (onPitch) => {
            xiSizes.push(onPitch.length);
            return makeTeam("Home");
          },
        },
      },
    );
    const homeSubs = result.boxScore.events.filter(
      (e) => e.type === "substitution" && e.side === "home",
    );
    expect(homeSubs.length).toBeGreaterThanOrEqual(1);
    expect(xiSizes.length).toBeGreaterThanOrEqual(homeSubs.length);
    // The hook always sees the side's real on-pitch group. That is eleven, except
    // where an injury went unreplaced and the side plays on with ten — reachable
    // now that a side can spend all five subs and then lose someone, which is the
    // genuine risk of emptying your bench.
    for (const n of xiSizes) {
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(11);
    }

    // Behavior check: a hook that upgrades the on-pitch side after subs must
    // shift outcomes — aggregate home shots rise vs. the identical no-hook run.
    let baseShots = 0;
    let boostedShots = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const base = simMatchDetailed(
        mulberry32(seed),
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0),
        makeSquad(100),
        makeBench(1000),
        makeBench(2000),
      );
      baseShots += base.stat.home.shots;

      const boosted = simMatchDetailed(
        mulberry32(seed),
        makeTeam("Home"),
        makeTeam("Away"),
        makeSquad(0),
        makeSquad(100),
        makeBench(1000),
        makeBench(2000),
        { recompute: { home: () => makeTeam("Home", { attack: 0.95, finishing: 0.95 }) } },
      );
      boostedShots += boosted.stat.home.shots;
    }
    expect(boostedShots).toBeGreaterThan(baseShots);
  });
});

/** A bench of near-scrubs: every player is far below the starters' ovr. */
function makeWeakBench(pidOffset: number): MatchPlayer[] {
  return makeBench(pidOffset).map((p) => ({ ...p, ovr: 45 }));
}

describe("substitutions weigh bench quality", () => {
  it("holds tired starters on rather than subbing them for a much weaker bench", () => {
    // Same match, same seed, only the bench quality differs. A strong bench (ovr
    // ~62) refreshes freely; a scrub bench (ovr 45) is too big a downgrade at the
    // checkpoints, so fewer (often zero) normal subs are made.
    let strongTotal = 0;
    let weakTotal = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const strong = simMatchDetailed(
        mulberry32(seed), makeTeam("Home"), makeTeam("Away"),
        makeSquad(0), makeSquad(100), makeBench(1000), makeBench(2000),
      );
      const weak = simMatchDetailed(
        mulberry32(seed), makeTeam("Home"), makeTeam("Away"),
        makeSquad(0), makeSquad(100), makeWeakBench(1000), makeWeakBench(2000),
      );
      strongTotal += strong.boxScore.events.filter((e) => e.type === "substitution").length;
      weakTotal += weak.boxScore.events.filter((e) => e.type === "substitution").length;
    }
    expect(weakTotal).toBeLessThan(strongTotal);
  });

  it("subs on a flagged 'more minutes' bench player who'd otherwise stay benched", () => {
    // A lone flagged bench player, weaker than his un-flagged bench-mates, still
    // gets on because his minutesBoost tips the sub decision toward him.
    const flaggedPid = 5001;
    const bench: MatchPlayer[] = makeBench(5000).map((p, i) =>
      i === 0 ? { ...p, pid: flaggedPid, pos: "CM", ovr: 52, minutesBoost: true } : p,
    );
    const result = simMatchDetailed(
      mulberry32(3), makeTeam("Home"), makeTeam("Away"),
      makeSquad(0), makeSquad(100), bench, makeBench(6000),
    );
    const cameOn = result.boxScore.events.some(
      (e) => e.type === "substitution" && e.side === "home" && e.pids[1] === flaggedPid,
    );
    expect(cameOn).toBe(true);
  });
});
