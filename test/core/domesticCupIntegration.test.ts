import { describe, it, expect } from "vitest";
import type { TeamMatchData } from "../../src/core/league/composites.js";
import { makeLeague } from "../helpers/league.js";
import { simThrough } from "../../src/core/simThrough.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  worldCompetitions, worldTeamSlots,
} from "../../src/core/competitions.js";
import {
  buildDomesticCup, pendingRound, domesticRoundName, domesticPrizeForRound,
} from "../../src/core/domesticCup/cup.js";
import { playDomesticRound } from "../../src/core/domesticCup/simCup.js";
import {
  DOMESTIC_CUP_MATCHDAYS, DOMESTIC_CUP_PRIZE_RUNNER_UP,
  DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL, PRIZE_TOP_10, DOMESTIC_CUP_GLAMOUR_TIE_BONUS,
} from "../../src/core/constants.js";
import { domesticCupScaleFor } from "../../src/core/finance/budget.js";

const comps = worldCompetitions();
const tierById = new Map(comps.map((c) => [c.id, c.tier]));
/** Which division a club is in, for the glamour-tie gate receipts. */
function tierOfFrom(teams: { tid: number; compId: number }[]): (tid: number) => number {
  const byTid = new Map(teams.map((t) => [t.tid, tierById.get(t.compId) ?? 1]));
  return (tid) => byTid.get(tid) ?? 1;
}

// The real slot layout, not a hand-rolled one. This used to build tier 1 + tier 2
// itself, which silently stopped describing the world when a third division was
// added (2026-09-01) -- the cup fields EVERY division of a country, so a two-tier
// fixture tests a competition the game no longer runs. worldTeamSlots is the
// function generateWorld's tid layout is pinned against, so it cannot drift again.
function worldTeams(): { tid: number; compId: number }[] {
  return worldTeamSlots(comps);
}

/**
 * The wiring the pure unit tests can't reach: that `simThrough` actually plays a
 * domestic round on its matchday and draws the next one from the winners.
 *
 * Deliberately stops at matchday 8 rather than simming a season: the
 * preliminary round (matchday 5) and the draw that follows it exercise every
 * step of the cycle, and a full 16-competition season would cost minutes here
 * for nothing extra.
 */
describe("domestic cups through simThrough", () => {
  it("plays a round on its matchday, then draws the next from the winners", () => {
    let league = makeLeague(0, 1);
    const rng = mulberry32(4242);

    expect(league.domesticCups).toHaveLength(16); // one per country

    // Countries no longer all field 40 clubs, so their cups no longer all have
    // the same number of rounds — and a shorter cup takes the LAST n matchdays
    // rather than the first, so every country's final still lands on the same
    // day. Belgium and Serbia (32 clubs) are the sharp case: an exact power of
    // two needs no preliminary round at all, so their round 0 IS the round of
    // 32 and it does not kick off until matchday 9.
    for (const cup of league.domesticCups) {
      // Rounds needed is ceil(log2(field)), and the cup takes that many
      // matchdays off the END of the list — so a smaller country starts later
      // and every final still lands on the same day.
      expect(cup.totalRounds).toBe(Math.ceil(Math.log2(cup.teams.length)));
      const firstMatchday = DOMESTIC_CUP_MATCHDAYS[DOMESTIC_CUP_MATCHDAYS.length - cup.totalRounds];
      expect(pendingRound(cup)!.matchday).toBe(firstMatchday);
    }

    // Matchdays 1-4: nothing is due yet, except in a seven-round cup (Argentina's
    // 70 clubs, the US's 66), which opens on matchday 1.
    league = simThrough(league, { matchday: 4 }, rng);
    for (const cup of league.domesticCups) {
      const first = DOMESTIC_CUP_MATCHDAYS[DOMESTIC_CUP_MATCHDAYS.length - cup.totalRounds];
      if (first > 4) {
        expect(cup.rounds).toHaveLength(1);
        expect(cup.rounds[0].ties).toHaveLength(0);
      } else {
        expect(cup.rounds[0].ties.length).toBeGreaterThan(0);
      }
    }
    expect(league.domesticCups.filter((c) => c.totalRounds === 7).map((c) => c.country).sort())
      .toEqual(["Argentina", "United States"]);

    // Through matchday 9 every cup has played at least its opening round — 9 is
    // the latest any of them starts.
    league = simThrough(league, { matchday: 9 }, rng);

    for (const cup of league.domesticCups) {
      const played = cup.rounds.filter((r) => r.ties.length > 0);
      expect(played.length).toBeGreaterThan(0);

      for (const round of played) {
        expect(round.ties).toHaveLength(round.pairings.length);
        for (const tie of round.ties) {
          // Single-leg: somebody always goes through on the day.
          expect([tie.home, tie.away]).toContain(tie.winner);
          expect(tie.boxScore).not.toBeNull();
        }
      }

      // The next round is drawn from exactly the clubs that came through the
      // last one, and each round halves the field.
      const last = played[played.length - 1];
      const next = pendingRound(cup)!;
      const survivors = next.pairings.flatMap((p) => [p.home, p.away]);
      expect(survivors).toHaveLength(next.pairings.length * 2);
      expect(new Set(survivors).size).toBe(survivors.length); // nobody drawn twice
      const through = new Set([...last.byes, ...last.ties.map((t) => t.winner)]);
      for (const tid of survivors) expect(through.has(tid)).toBe(true);
    }

    // A field that is not a power of two opens with a preliminary round; one
    // that is starts at its first named round. England fields 60 clubs across
    // three divisions, Scotland exactly 32 — which is why the power-of-two case
    // moved here from Belgium when every country gained a third division and
    // Belgium went to 48.
    const england = league.domesticCups.find((c) => c.country === "England")!;
    expect(domesticRoundName(england, england.rounds[0].round)).toBe("Preliminary round");
    const scotland = league.domesticCups.find((c) => c.country === "Scotland")!;
    expect(domesticRoundName(scotland, scotland.rounds[0].round)).toBe("Round of 32");
  });
});

describe("domestic cup prize money", () => {
  // An empty match-data map makes every tie a walkover, which is what's wanted
  // here: the money, with no match sim in the way. (The walkover path itself is
  // the guard against a pairing failing to produce a winner and quietly losing
  // a club from the next round's draw.)
  const noMatchData = new Map<number, TeamMatchData>();

  /**
   * The cup pays nothing, and that is load-bearing rather than an oversight.
   *
   * Prize money is the only part of this feature that can touch the economy,
   * and with real prizes the weak-leagues audit put 2 of 4 seeds into deficit
   * where the baseline is solvent on all four (see the constant for the
   * numbers). At zero, `creditPrizes` is never reached and a dynasty is
   * bit-identical to one with no domestic cups at all.
   *
   * If you re-enable the prizes, this test fails — which is the point. Re-run
   * `scripts/weakLeaguesAudit.ts` against the merge base before you do.
   */
  it("pays every tie's winner, and of the losers only the beaten finalist", () => {
    const teams = worldTeams();
    const tierOf = tierOfFrom(teams);
    let cup = buildDomesticCup("England", comps, teams, new Map(), 1)!;
    const totals = new Map<number, number>();
    let pot = 0;
    let championRun = 0;
    let glamourGaps = 0;
    for (let r = 0; r < cup.totalRounds; r++) {
      const played = playDomesticRound(cup, comps, noMatchData, 0, () => 1, tierOf);
      const winPrize = domesticPrizeForRound(cup, r);
      expect(winPrize).toBeGreaterThan(0); // every round pays something
      const isFinal = played.ties.length === 1;
      glamourGaps += played.ties.reduce(
        (sum, t) => sum + Math.abs(tierOf(t.home) - tierOf(t.away)),
        0,
      );
      for (const tie of played.ties) {
        const loser = tie.winner === tie.home ? tie.away : tie.home;
        expect(played.prizes.get(tie.winner)).toBeGreaterThanOrEqual(winPrize);
        // A beaten side is paid only as the finalist, or as the smaller club in
        // a cross-tier tie (gate receipts are taken on the day, win or lose).
        const gap = Math.abs(tierOf(tie.home) - tierOf(tie.away));
        const smaller = tierOf(tie.home) > tierOf(tie.away) ? tie.home : tie.away;
        const expected =
          (isFinal ? DOMESTIC_CUP_PRIZE_RUNNER_UP : 0) +
          (gap > 0 && loser === smaller ? gap * DOMESTIC_CUP_GLAMOUR_TIE_BONUS : 0);
        expect(played.prizes.get(loser) ?? 0).toBe(expected);
      }
      for (const [tid, v] of played.prizes) {
        totals.set(tid, (totals.get(tid) ?? 0) + v);
        pot += v;
      }
      cup = played.cup;
    }
    championRun = totals.get(cup.championTid!)!;

    // The pot is what the table says it is, derived from the ties actually
    // played rather than written as a number, so a reshaped bracket can't
    // silently change what the competition costs.
    expect(pot).toBe(
      cup.rounds.reduce(
        (sum, round, r) => sum + round.pairings.length * domesticPrizeForRound(cup, r),
        0,
      ) +
        DOMESTIC_CUP_PRIZE_RUNNER_UP +
        glamourGaps * DOMESTIC_CUP_GLAMOUR_TIE_BONUS,
    );
    // Winning it is worth every round he won, and it is deliberately SMALL --
    // a real cup run is a supporting income, not a title's worth (see the
    // constant's comment). The Shield place it earns is the actual prize.
    expect(championRun).toBeGreaterThan(DOMESTIC_CUP_PRIZE_BY_ROUNDS_FROM_FINAL[0]);
    expect(championRun).toBeLessThan(PRIZE_TOP_10);
    expect(cup.championTid).not.toBeNull();
  });

  it("pays a second-division club exactly what it pays a top-flight one", () => {
    // The flatness across tiers is the whole real-world point (see
    // domesticCupScaleFor) -- a cup run has to be worth the same to a small club.
    const teams = worldTeams();
    const d1 = comps.find((c) => c.country === "England" && c.tier === 1)!;
    const d2 = comps.find((c) => c.country === "England" && c.tier === 2)!;
    const userTid = -1;
    const scaleOf = (tid: number): number => {
      const compId = teams.find((t) => t.tid === tid)!.compId;
      return domesticCupScaleFor(comps, compId, tid, userTid, "normal");
    };
    const topFlight = teams.find((t) => t.compId === d1.id)!.tid;
    const second = teams.find((t) => t.compId === d2.id)!.tid;
    expect(scaleOf(second)).toBe(scaleOf(topFlight));
    // Every division of the country, however deep the pyramid gets.
    for (const c of comps.filter((x) => x.country === "England")) {
      const tid = teams.find((t) => t.compId === c.id)!.tid;
      expect(scaleOf(tid)).toBe(scaleOf(topFlight));
    }
    // ...and it is still the country's scale, not a flat 1.
    const serbia = comps.find((c) => c.country === "Serbia" && c.tier === 1)!;
    const serbTid = teams.find((t) => t.compId === serbia.id)!.tid;
    expect(scaleOf(serbTid)).toBeLessThan(scaleOf(topFlight));
  });

  it("still resolves every tie to exactly one winner, prizes or not", () => {
    const teams = worldTeams();
    const tierOf = tierOfFrom(teams);
    let cup = buildDomesticCup("England", comps, teams, new Map(), 1)!;
    let survivors = cup.teams.length;
    for (let r = 0; r < cup.totalRounds; r++) {
      const played = playDomesticRound(cup, comps, noMatchData, 0, () => 1, tierOf);
      for (const tie of played.ties) expect([tie.home, tie.away]).toContain(tie.winner);
      survivors -= played.ties.length; // one club eliminated per tie
      cup = played.cup;
    }
    expect(survivors).toBe(1); // 40 clubs, 39 ties, one left standing
  });
});
