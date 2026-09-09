import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { trimRosterSurplus, runAIFreeAgency } from "../../src/core/freeAgency.js";
import {
  ROSTER_COMPOSITION, AI_PROSPECT_SLOTS, AI_PROSPECT_MIN_POT, AI_PROSPECT_MAX_AGE,
} from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";

/**
 * AI clubs keep their wonderkids. Before this, `trimRosterSurplus` ranked
 * purely on current ovr and a 16-year-old is always bottom of his position's
 * depth chart, so 84-86% of every club's youth intake was released in the
 * offseason it arrived — 80% of the POT>=70 prospects among them — and neither
 * pass of AI free agency valued potential enough to sign them back. See
 * AI_PROSPECT_SLOTS.
 */
describe("AI prospect retention", () => {
  // Deliberately low ovr: that is what makes him bottom of the depth chart,
  // and so the exact player the old trim always released.
  const makeProspect = (pid: number, season: number, potential: number): Player =>
    ({
      pid,
      name: `Prospect ${pid}`,
      pos: "CB",
      born: season - 17,
      ovr: 30,
      potential,
      nationality: "England",
      contract: { salary: 100_000, expiresSeason: season + 3 },
      hist: [],
      stats: [],
    }) as unknown as Player;

  /**
   * The target club with its own young high-potential players stripped out.
   *
   * A generated squad can already contain prospects of its own, which makes
   * "did the allowance keep MY prospects" ambiguous. Isolating the fixture keeps
   * these assertions about the retention rule rather than about how many
   * wonderkids seed 1 happened to hand this club.
   */
  const cleanTarget = (league: ReturnType<typeof makeLeague>) => {
    const pmap = new Map(league.players.map((p) => [p.pid, p]));
    const isProspect = (pid: number) => {
      const p = pmap.get(pid);
      return p != null
        && league.season - p.born <= AI_PROSPECT_MAX_AGE
        && p.potential >= AI_PROSPECT_MIN_POT;
    };
    const t = league.teams[1];
    return { ...t, roster: t.roster.filter((pid) => !isProspect(pid)) };
  };

  it("keeps a club's wonderkids through the trim, without displacing the depth chart", () => {
    const league = makeLeague(0, 1);
    const season = league.season;
    const target = cleanTarget(league);

    // Who the ovr depth chart keeps at CB, measured before the prospects exist.
    const pmap = new Map(league.players.map((p) => [p.pid, p]));
    const keptOnOvr = target.roster
      .map((pid) => pmap.get(pid)!)
      .filter((p) => p.pos === "CB")
      .sort((a, b) => b.ovr - a.ovr)
      .slice(0, ROSTER_COMPOSITION.CB)
      .map((p) => p.pid);

    const prospects = [9_000_001, 9_000_002].map((pid) =>
      makeProspect(pid, season, AI_PROSPECT_MIN_POT + 5),
    );
    const players = [...league.players, ...prospects];
    const teams = league.teams.map((t) =>
      t.tid === target.tid
        ? { ...target, roster: [...target.roster, ...prospects.map((p) => p.pid)] }
        : t,
    );

    const roster = trimRosterSurplus(teams, players, /* userTid */ -1, season)
      .find((t) => t.tid === target.tid)!.roster;

    for (const p of prospects) expect(roster).toContain(p.pid);
    // ...and everyone the depth chart would have kept is still there. Retention
    // is additive, so selectXI's input is unchanged — that is the whole point.
    for (const pid of keptOnOvr) expect(roster).toContain(pid);
  });

  it("retains at most AI_PROSPECT_SLOTS of them, best potential first", () => {
    const league = makeLeague(0, 1);
    const season = league.season;
    const target = cleanTarget(league);

    // One more prospect than there are slots, each a point better than the last.
    const prospects = Array.from({ length: AI_PROSPECT_SLOTS + 1 }, (_, i) =>
      makeProspect(9_100_000 + i, season, AI_PROSPECT_MIN_POT + i),
    );
    // A full depth chart at CB, guaranteed rather than assumed.
    //
    // The allowance is AI_PROSPECT_SLOTS **beyond** the chart, so a prospect the
    // chart takes on merit spends no slot and the club legitimately carries more
    // than the bare constant. Stripping the club's own prospects can leave it
    // short of `ROSTER_COMPOSITION.CB` real centre-backs, at which point one of
    // these ovr-30 synthetics fills the chart and six survive — correct
    // behaviour that reads exactly like the cap having failed. It happened: the
    // count of prospects `cleanTarget` removes moved from 10 to 6 when world
    // generation gained an age model, and this assertion had been resting on it.
    const squadCbs = Array.from({ length: ROSTER_COMPOSITION.CB }, (_, i) =>
      ({
        ...makeProspect(9_200_000 + i, season, AI_PROSPECT_MIN_POT - 20),
        born: season - 26,
        ovr: 60,
      }) as Player,
    );
    const filler = [...squadCbs, ...prospects];
    const players = [...league.players, ...filler];
    const teams = league.teams.map((t) =>
      t.tid === target.tid
        ? { ...target, roster: [...target.roster, ...filler.map((p) => p.pid)] }
        : t,
    );

    const roster = new Set(
      trimRosterSurplus(teams, players, -1, season).find((t) => t.tid === target.tid)!.roster,
    );
    const survivors = prospects.filter((p) => roster.has(p.pid));
    expect(survivors).toHaveLength(AI_PROSPECT_SLOTS);
    // The one dropped is the weakest, not whoever happened to come last in the
    // roster array — the sort is a total order for exactly this reason.
    expect(survivors.map((p) => p.pid)).not.toContain(prospects[0].pid);
  });

  it("does NOT spend a slot on a prospect the depth chart keeps on merit", () => {
    // The allowance is N prospects *beyond* the chart, so a club rich in them
    // carries more than the bare constant. Counting the chart's own against it
    // was tried and reverted: it agrees with the free-agency pass arithmetically
    // but retains fewer of the cheapest players in the game, and the dynasty
    // audit measured deficits going 1 of 4 seeds to 2 of 4 for it.
    const league = makeLeague(0, 1);
    const season = league.season;
    const target = cleanTarget(league);

    // Exactly as many as the CB depth chart holds, so every one is kept on
    // merit and none spills into the allowance. (Sizing this by
    // AI_PROSPECT_SLOTS instead was wrong: the chart holds ROSTER_COMPOSITION.CB
    // of them, so the surplus fell through and spent a slot.)
    const onMerit = Array.from({ length: ROSTER_COMPOSITION.CB }, (_, i) => ({
      ...makeProspect(9_500_000 + i, season, AI_PROSPECT_MIN_POT + 10),
      ovr: 90,
    }));
    const spares = Array.from({ length: AI_PROSPECT_SLOTS }, (_, i) =>
      makeProspect(9_600_000 + i, season, AI_PROSPECT_MIN_POT + 1),
    );
    const added = [...onMerit, ...spares];
    const players = [...league.players, ...added];
    const teams = league.teams.map((t) =>
      t.tid === target.tid
        ? { ...target, roster: [...target.roster, ...added.map((p) => p.pid)] }
        : t,
    );

    const roster = new Set(
      trimRosterSurplus(teams, players, -1, season).find((t) => t.tid === target.tid)!.roster,
    );
    for (const p of onMerit) expect(roster.has(p.pid)).toBe(true);
    // ...and the full allowance is still available to the spares on top.
    expect(spares.filter((p) => roster.has(p.pid))).toHaveLength(AI_PROSPECT_SLOTS);
  });

  it("leaves an ordinary low-potential youngster to be released", () => {
    const league = makeLeague(0, 1);
    const season = league.season;
    const target = league.teams[1];

    const filler = makeProspect(9_200_001, season, AI_PROSPECT_MIN_POT - 1);
    const players = [...league.players, filler];
    const teams = league.teams.map((t) =>
      t.tid === target.tid ? { ...t, roster: [...t.roster, filler.pid] } : t,
    );

    const roster = trimRosterSurplus(teams, players, -1, season)
      .find((t) => t.tid === target.tid)!.roster;
    expect(roster).not.toContain(filler.pid);
  });

  it("signs an unsigned wonderkid out of the pool", () => {
    const league = makeLeague(0, 1);
    const season = league.season;
    const wonderkid = makeProspect(9_300_001, season, AI_PROSPECT_MIN_POT + 5);
    const players = [...league.players, wonderkid];

    const { teams } = runAIFreeAgency(
      league.teams,
      players,
      season,
      mulberry32(9),
      -1,
      league.teams.map((t) => t.tid),
    );
    expect(teams.some((t) => t.roster.includes(wonderkid.pid))).toBe(true);
  });

  it("takes no shared-rng draws to sign him", () => {
    // If the prospect pass drew from the shared stream, adding one prospect to
    // the pool would change the draw count and shift every downstream draw with
    // it — the RNG-stream-order invariant youth generation rests on.
    const league = makeLeague(0, 1);
    const season = league.season;
    const wonderkid = makeProspect(9_400_001, season, AI_PROSPECT_MIN_POT + 5);

    const draws = (pool: Player[]): number => {
      let n = 0;
      const inner = mulberry32(9);
      runAIFreeAgency(
        league.teams,
        pool,
        season,
        () => {
          n++;
          return inner();
        },
        -1,
        league.teams.map((t) => t.tid),
      );
      return n;
    };
    expect(draws([...league.players, wonderkid])).toBe(draws(league.players));
  });
});
