import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { simSeason } from "../../src/core/season.js";
import { attributeTouchStats, emptyLine, type TouchSide, type PlayerMatchLine } from "../../src/engine/attribution.js";

/**
 * Passes/crosses/fouls are decorative attribution layered on the composite sim.
 * These tests lock in two things: (1) they never change the scoreline, and
 * (2) their per-team volumes read like real top-flight football.
 */

// A full deterministic season through the real pipeline; reused across cases.
const SEASON = simSeason(mulberry32(12345));

/**
 * Baseline scoreline hash. Still guards that touch attribution (passes/crosses)
 * never perturbs the scoreline — it runs on a separate rng stream. The fixed
 * value has been rebased for deliberate shot-outcome changes: first when the
 * individual-finisher effect (SHOOTER_FINISH_WEIGHT) was added to resolveShot;
 * again when rollupComposites gained position-weighting + star concentration
 * (COMPOSITE_STAR_CONCENTRATION), which changed the attack/defense/control
 * composites (and thus match results) without touching the rng stream; again
 * when the substitution logic gained a bench-quality gate (SUB_FATIGUE_RELIEF et
 * al.), which now holds back roughly one sub in ten, changing who's on the pitch
 * late; once more when that gate became form-aware (SUB_GATE_RATING_INFLUENCE),
 * shifting which held-back subs fire; and again when SUB_QUALITY_MARGIN was
 * retuned 1→2.5 so the gate holds back its intended ~1 sub in ten rather than
 * ~1 in five; and again when composites began bucketing by the SLOT a player
 * fills rather than his natural position (see engine/positionFit.ts), which
 * changes both every composite value and which substitutions the bench is
 * willing to make; and again when players gained derived secondary positions
 * (core/players/positions.ts), which waive the familiarity penalty for a slot a
 * player genuinely covers and let him win that slot in selectXI on his rating
 * AT it — so both the XI and the composites move — each a personnel/composite
 * change, not an rng-stream shift.
 *
 * And most recently when YELLOW_GIVEN_FOUL was raised 0.11 -> 0.18, once
 * suspensions gave cards a consequence and the booking rate was measured at
 * roughly a third of a real top flight's. That one is worth distinguishing from
 * the rest: the card roll is drawn on EVERY foul either way (`const cardRoll =
 * rng()`), so the draw count and stream order are untouched, exactly as with the
 * composite changes above. What moves is which branch it takes — more second
 * yellows, so more men sent off, so more man-down composites, and marginally
 * longer matches, since every card calls bumpEvent() and stoppage time scales
 * with events. Measured, that last channel is worth ~+0.01 goals/match
 * (scripts/cardRateSweep.ts), well inside seed noise.
 *
 * And now once more, when pickAssister began weighting the assist draw by the
 * new MatchPlayer.passing instead of dribbling. Same class as the card change
 * above: the draw count and stream order are untouched (the same weightedPick
 * runs either way), only the player it lands on moves. It reaches the scoreline
 * because an assist feeds computeMatchRating, match ratings drive subPriority
 * and the bench-quality gate, and substitutions change who is on the pitch —
 * the one feedback path from attribution back into the sim. Assist ATTRIBUTION
 * was the point: measured over a simmed league season, a creative midfielder's
 * passing went from r = 0.08 against his assists to r = 0.31.
 *
 * And again for ATTRIBUTION_RATING_EXPONENT, which steepens the rating term in
 * the same four credit draws so a good player takes a bigger share of the events
 * he is good at (an 80 vs a 40 at the same position goes from 1.8x apart to
 * 3.2x). Same class again: the draw count is unchanged, only who it lands on,
 * and it reaches the scoreline through the same match-rating -> substitution
 * path. Measured, scoring barely moves (goals/game 3.021 -> 3.029, top scorer
 * 24 -> 26) while every stat gets more specific to its own skill — see the
 * constant for the full per-axis table.
 *
 * And again for the position-OVR balance work (POSITION_OVR_CALIBRATION and
 * POSITION_RATING_SPREAD), which is a different class from all of the above and
 * worth being clear about: this one changes the PLAYERS, not the sim. Rating
 * draws are still one gaussian per rating, so the stream order and draw count
 * are untouched, but each draw is scaled by its position and the resulting OVR
 * is shifted, so the world generates different squads. Different squads play
 * different football. Nothing about attribution moved, and the invariant this
 * test exists for — attribution not perturbing the match stream — is unchanged.
 *
 * And again when selectXI began choosing on `slotValue` — a player's rating at
 * the slot less the familiarity penalty — instead of ranking fit tier strictly
 * above rating. Same class as the composite changes above: the picker is pure
 * and draws nothing, so stream order and draw count are untouched; what moves is
 * WHO starts, and therefore every composite rolled up from the XI. It is a large
 * move for the same reason it was worth making — measured on a season-8 world,
 * 16.9% of first-division starting slots held a man the sim rated below someone
 * on that club's bench, and the picker had been refusing a 6-point penalty at a
 * cost of up to 35 rating points. Formation choice moved with it, since
 * chooseBestFormation scores the same number.
 */
const BASELINE_SCORELINE_HASH = 3838391028;

function scorelineHash(matches: typeof SEASON.matches): number {
  const s = matches.map((m) => `${m.home}:${m.homeGoals}-${m.awayGoals}:${m.away}`).join("|");
  let h = 0;
  for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return h >>> 0;
}

describe("touch attribution — scoreline invariance", () => {
  it("does not perturb the main match RNG stream (scorelines bit-identical to pre-attribution baseline)", () => {
    expect(scorelineHash(SEASON.matches)).toBe(BASELINE_SCORELINE_HASH);
  });

  it("is deterministic: same lines + same seed produce identical passes/crosses", () => {
    const side = (): TouchSide => ({
      players: [
        { pid: 1, pos: "CM", minutes: 90 },
        { pid: 2, pos: "W", minutes: 90 },
        { pid: 3, pos: "GK", minutes: 90 },
      ],
      ticks: 470,
      control: 0.55,
    });
    const run = () => {
      const lines = new Map<number, PlayerMatchLine>([1, 2, 3].map((p) => [p, emptyLine(p)]));
      attributeTouchStats(lines, side(), side(), 999);
      return [1, 2, 3].map((p) => {
        const l = lines.get(p)!;
        return [l.passes, l.passesCompleted, l.crosses];
      });
    };
    expect(run()).toEqual(run());
  });
});

describe("touch attribution — realism", () => {
  // Aggregate every team-match's box score across the full season.
  const perTeam: { passes: number; completed: number; crosses: number; fouls: number }[] = [];
  const byPos: Record<string, { passes: number; crosses: number; fouls: number; n: number }> = {};
  const posOf = new Map(SEASON.league.players.map((p) => [p.pid, p.pos]));

  for (const m of SEASON.matches) {
    for (const side of [m.boxScore.home, m.boxScore.away]) {
      let passes = 0, completed = 0, crosses = 0, fouls = 0;
      for (const l of side) {
        passes += l.passes;
        completed += l.passesCompleted;
        crosses += l.crosses;
        fouls += l.foulsCommitted;
        const pos = posOf.get(l.pid)!;
        const b = (byPos[pos] ??= { passes: 0, crosses: 0, fouls: 0, n: 0 });
        b.passes += l.passes;
        b.crosses += l.crosses;
        b.fouls += l.foulsCommitted;
        b.n++;
      }
      perTeam.push({ passes, completed, crosses, fouls });
    }
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const passMean = mean(perTeam.map((t) => t.passes));
  const totalPasses = perTeam.reduce((a, t) => a + t.passes, 0);
  const totalCompleted = perTeam.reduce((a, t) => a + t.completed, 0);
  const completionPct = (100 * totalCompleted) / totalPasses;
  const crossMean = mean(perTeam.map((t) => t.crosses));
  const foulMean = mean(perTeam.map((t) => t.fouls));

  it("passes per team land in a realistic top-flight range (~450-500)", () => {
    expect(passMean).toBeGreaterThan(420);
    expect(passMean).toBeLessThan(560);
  });

  it("pass completion sits in the realistic 78-86% band", () => {
    expect(completionPct).toBeGreaterThan(78);
    expect(completionPct).toBeLessThan(86);
  });

  it("completed never exceeds attempted on any team-match", () => {
    expect(perTeam.every((t) => t.completed <= t.passes)).toBe(true);
  });

  it("crosses per team land in a realistic range (~12-22)", () => {
    expect(crossMean).toBeGreaterThan(11);
    expect(crossMean).toBeLessThan(23);
  });

  it("fouls per team match the engine's actual foul events (~5-9)", () => {
    // Tied to real FOUL_BASE foul events (not synthesized), so consistent with cards.
    expect(foulMean).toBeGreaterThan(4);
    expect(foulMean).toBeLessThan(10);
  });

  it("distributes touches sensibly by position", () => {
    // Central/deep positions circulate the ball more than a lone striker.
    expect(byPos.CM.passes / byPos.CM.n).toBeGreaterThan(byPos.ST.passes / byPos.ST.n);
    expect(byPos.CB.passes / byPos.CB.n).toBeGreaterThan(byPos.ST.passes / byPos.ST.n);
    // Wide players dominate crosses; keepers and centre-backs barely cross.
    expect(byPos.W.crosses / byPos.W.n).toBeGreaterThan(byPos.CM.crosses / byPos.CM.n);
    expect(byPos.FB.crosses / byPos.FB.n).toBeGreaterThan(byPos.CB.crosses / byPos.CB.n);
    expect(byPos.GK.crosses).toBe(0);
  });
});
