import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import type { StandingsRow } from "../../src/core/standings.js";
import {
  titlePlayoffFields, playTitlePlayoff, titlePlayoffMatchData, liguillaSeeds, titlePlayoffNextEntrants,
  drawTitlePlayoff, playTitlePlayoffRound, TITLE_PLAYOFF_QF_PAIRS, type TitlePlayoff,
} from "../../src/core/titlePlayoff.js";
import { playoffResult } from "../../src/core/manager/playoffExpectation.js";

/**
 * Mexico's Liguilla: the top eight, two legs a round, reseeded after the
 * quarter-finals — and the `liguilla` format, which puts Liga MX's old play-in
 * in front of it: the top six go straight through and 7th to 10th play for the
 * last two seeds (7 v 8 for the seventh, then the loser of that hosts the
 * winner of 9 v 10 for the eighth). No shipped league plays the play-in any
 * more, so it is tested on Liga MX's clubs with the format set by hand.
 */
describe("the Liguilla", () => {
  const league = makeLeague(0, 1);
  const mx1 = league.competitions.find((c) => c.country === "Mexico" && c.tier === 1)!;
  const mx2 = league.competitions.find((c) => c.country === "Mexico" && c.tier === 2)!;
  // A table in tid order, best first.
  const tables = new Map(league.competitions.map((c) => [
    c.id,
    league.teams.filter((t) => t.compId === c.id).map((t, i): StandingsRow => ({
      tid: t.tid, played: 34, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 100 - i,
    })),
  ]));
  const fields = titlePlayoffFields(league.competitions, tables, league.teams);
  const f2 = fields.find((f) => f.compId === mx2.id)!;
  const withPlayIn = league.competitions.map((c) => (c.id === mx1.id ? { ...c, titlePlayoff: "liguilla" as const } : c));
  const f1 = titlePlayoffFields(withPlayIn, tables, league.teams).find((f) => f.compId === mx1.id)!;
  const md1 = titlePlayoffMatchData({ compId: mx1.id, season: 1 }, league.teams, league.players, league.lid);
  const md2 = titlePlayoffMatchData({ compId: mx2.id, season: 1 }, league.teams, league.players, league.lid);
  // Different lids give different draws; enough to see every play-in outcome.
  const runs: TitlePlayoff[] = Array.from({ length: 40 }, (_, lid) => playTitlePlayoff(f1, md1, lid, 1));

  it("seats ten with a play-in and eight without, and Mexico plays without", () => {
    expect(fields.find((f) => f.compId === mx1.id)!.format).toBe("two-legged");
    expect(f1.format).toBe("liguilla");
    expect(f1.teams).toEqual(tables.get(mx1.id)!.slice(0, 10).map((r) => r.tid));
    expect(f2.format).toBe("two-legged");
    expect(f2.teams).toEqual(tables.get(mx2.id)!.slice(0, 8).map((r) => r.tid));
  });

  it("plays the play-in as three one-off games at the better-placed club's ground", () => {
    const [s7, s8, s9, s10] = f1.teams.slice(6);
    for (const p of runs) {
      const [g1, g2, g3] = p.ties.filter((t) => t.round === 0);
      expect(p.ties.filter((t) => t.round === 0)).toHaveLength(3);
      expect([g1.home, g1.away]).toEqual([s7, s8]);
      expect([g2.home, g2.away]).toEqual([s9, s10]);
      const g1Loser = g1.winner === s7 ? s8 : s7;
      expect([g3.home, g3.away]).toEqual([g1Loser, g2.winner]);
      for (const g of [g1, g2, g3]) {
        expect(g.legs).toBeUndefined();
        // Level after 90 goes straight to penalties.
        expect(g.wentToExtraTime).toBe(false);
      }
      expect(liguillaSeeds(p)).toEqual([...f1.teams.slice(0, 6), g1.winner, g3.winner]);
    }
    // Over forty draws the loser of 7 v 8 both wins and loses its second chance.
    const secondChance = runs.map((p) => {
      const [g1, , g3] = p.ties.filter((t) => t.round === 0);
      return g3.winner === g3.home && g3.home !== g1.winner;
    });
    expect(secondChance).toContain(true);
    expect(secondChance).toContain(false);
  });

  it("puts only 7th to 10th in the play-in and the eight seeds in the quarter-finals", () => {
    const drawn = drawTitlePlayoff(f1, 1);
    expect([...titlePlayoffNextEntrants(drawn)]).toEqual(f1.teams.slice(6));
    const afterPlayIn = playTitlePlayoffRound(drawn, md1, 0);
    expect(new Set(titlePlayoffNextEntrants(afterPlayIn))).toEqual(new Set(liguillaSeeds(afterPlayIn)));
  });

  it("pairs the quarter-finals by seed and reseeds the semi-finals, best left against worst", () => {
    for (const p of [...runs, playTitlePlayoff(f2, md2, 3, 1)]) {
      const qfRound = p.format === "liguilla" ? 1 : 0;
      const seeds = liguillaSeeds(p);
      const seed = (tid: number) => seeds.indexOf(tid);
      const qf = p.ties.filter((t) => t.round === qfRound);
      expect(qf.map((t) => [seed(t.home), seed(t.away)].sort((a, b) => a - b))).toEqual(TITLE_PLAYOFF_QF_PAIRS);
      for (const t of qf) expect(t.legs).toHaveLength(2);
      const left = qf.map((t) => t.winner).sort((a, b) => seed(a) - seed(b));
      const sf = p.ties.filter((t) => t.round === qfRound + 1);
      expect(sf.map((t) => [t.home, t.away].sort((a, b) => seed(a) - seed(b))))
        .toEqual([[left[0], left[3]], [left[1], left[2]]]);
      expect(p.winnerTid).not.toBeNull();
    }
  });

  it("records a club that lost 7 v 8 but won its second game as going out later, not in the play-in", () => {
    const p = runs.find((r) => {
      const [g1, , g3] = r.ties.filter((t) => t.round === 0);
      return g3.winner === g3.home && g3.home !== g1.winner;
    })!;
    const survivor = p.ties.filter((t) => t.round === 0)[2].winner;
    const stage = playoffResult(p, survivor);
    if (p.winnerTid === survivor) expect(stage!.round).toBeNull();
    else expect(stage!.round).toBeGreaterThanOrEqual(1);
  });
});
