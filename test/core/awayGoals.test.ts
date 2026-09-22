import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { leagueMatchData } from "../../src/core/league/composites.js";
import { playFirstLeg, resolveTwoLeggedTie } from "../../src/core/cup/simCup.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  DEFAULT_CONTINENTAL_FORMAT, resolveCupShape, sanitizeContinentalFormat,
  isDefaultContinentalFormat, describeCupShape,
} from "../../src/core/cup/cupShape.js";

/**
 * The away-goals rule: a two-legged tie level on aggregate goes to whoever
 * scored more away from home, extra time included. Real European football until
 * 2021, and off unless a save switches it on.
 *
 * Tested on real match data, like the Liguilla tiebreaker beside it. A level
 * aggregate can't be forced, so the tests search seeds for one.
 */
describe("the away goals rule", () => {
  const league = makeLeague(0, 1);
  const england = league.competitions.find((c) => c.country === "England" && c.tier === 1)!;
  const clubs = league.teams.filter((t) => t.compId === england.id);
  const data = leagueMatchData({
    teams: clubs.map((t) => ({
      tid: t.tid, name: t.name, roster: t.roster, avgOvr: 0, academyBase: t.academyBase,
      compId: t.compId, starters: t.starters, formation: t.formation, moreMinutes: t.moreMinutes,
    })),
    players: league.players,
  });
  const [home, away] = [clubs[0].tid, clubs[1].tid];
  const [hd, ad] = [data[0], data[1]];

  const play = (seed: number, awayGoals: boolean) => {
    const rng = mulberry32(seed);
    const leg1 = playFirstLeg(rng, home, away, hd, ad, 0);
    return resolveTwoLeggedTie(rng, leg1, hd, ad, 0, { awayGoals });
  };

  const seeds = Array.from({ length: 600 }, (_, s) => s);
  // A tie the rule decides at 180 minutes: level on aggregate, away goals apart.
  const ruleSeed = seeds.find((s) => play(s, true).decidedByAwayGoals && !play(s, true).wentToExtraTime);
  // A tie already settled inside 180 minutes — the rule must not touch it.
  // NOT "the aggregates differ": a tie level at 180 and won in extra time also
  // has differing aggregates, and the rule legitimately pre-empts that one, so
  // it is the wrong control. `wentToExtraTime` is the question being asked.
  const settledSeed = seeds.find((s) => !play(s, false).wentToExtraTime);

  it("gives a level aggregate to the club with more away goals, with no extra time", () => {
    expect(ruleSeed).toBeDefined();
    const tie = play(ruleSeed!, true);
    expect(tie.homeGoals).toBe(tie.awayGoals);
    expect(tie.wentToExtraTime).toBe(false);
    expect(tie.wentToPens).toBe(false);
    expect(tie.decidedByAwayGoals).toBe(true);
    // Away goals in this tie's orientation: `home` hosted leg 1, so his away
    // goals are leg 2's, and `away`'s are leg 1's. Getting these the wrong way
    // round still picks a winner — always the wrong one — so the test asserts
    // the direction rather than just that somebody won.
    const [leg1, leg2] = tie.legs!;
    const homeAway = leg2.homeGoals;
    const awayAway = leg1.awayGoals;
    expect(homeAway).not.toBe(awayAway);
    expect(tie.winner).toBe(homeAway > awayAway ? home : away);
  });

  it("plays extra time on the same tie when the rule is off", () => {
    const tie = play(ruleSeed!, false);
    expect(tie.wentToExtraTime).toBe(true);
    expect(tie.decidedByAwayGoals).toBeUndefined();
  });

  it("changes nothing about a tie that wasn't level on aggregate", () => {
    expect(settledSeed).toBeDefined();
    expect(play(settledSeed!, true)).toEqual(play(settledSeed!, false));
  });

  it("never decides a tie on away goals when they were level too", () => {
    for (const s of seeds.slice(0, 200)) {
      const tie = play(s, true);
      if (!tie.decidedByAwayGoals) continue;
      const [leg1, leg2] = tie.legs!;
      // After extra time the rule counts `home`'s extra-time goals as away
      // goals as well, so only the leg lines being equal would be a bug — and
      // only for a tie the rule settled inside 180 minutes.
      if (!tie.wentToExtraTime) expect(leg2.homeGoals).not.toBe(leg1.awayGoals);
    }
  });
});

describe("away goals as a format setting", () => {
  it("is off in the shipped format, so no existing cup plays it", () => {
    expect(DEFAULT_CONTINENTAL_FORMAT.awayGoals).toBe(false);
    expect(isDefaultContinentalFormat({ ...DEFAULT_CONTINENTAL_FORMAT })).toBe(true);
    expect(isDefaultContinentalFormat({ ...DEFAULT_CONTINENTAL_FORMAT, awayGoals: true })).toBe(false);
  });

  it("is recorded as off for a single-leg format, which has no away leg to count", () => {
    const oneLeg = resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT, twoLegged: false, awayGoals: true });
    expect(oneLeg.awayGoals).toBe(false);
    const twoLeg = resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT, twoLegged: true, awayGoals: true });
    expect(twoLeg.awayGoals).toBe(true);
  });

  it("is described to the player only when it applies", () => {
    const on = describeCupShape(resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT, awayGoals: true }), 32);
    expect(on).toContain("away goals");
    const off = describeCupShape(resolveCupShape(32, { ...DEFAULT_CONTINENTAL_FORMAT }), 32);
    expect(off).not.toContain("away goals");
  });

  it("survives a hand-edited save", () => {
    expect(sanitizeContinentalFormat({ awayGoals: "yes" }).awayGoals).toBe(false);
    expect(sanitizeContinentalFormat({ awayGoals: true }).awayGoals).toBe(true);
  });
});
