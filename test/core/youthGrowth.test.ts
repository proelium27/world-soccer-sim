import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  youthGrowthPerSeason, youthShortfall, youthRatingsAt, progressPlayer,
} from "../../src/core/players/progression.js";
import { enrolAcademyYouth } from "../../src/core/academyPipeline.js";
import { applyPlayerEdit } from "../../src/core/godMode.js";
import { computeOvr } from "../../src/core/players/ovr.js";
import { mulberry32 } from "../../src/engine/rng.js";
import {
  YOUTH_BASE_REFERENCE_AGE, ACADEMY_GROWTH_TIMING_SPREAD, USER_ACADEMY_ENTRY_AGE,
} from "../../src/core/constants.js";
import type { Player, PlayerRatings, Position, SkillKey } from "../../src/core/players/types.js";

const POSITIONS: Position[] = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];

const league = makeLeague(0, 1);
const season = league.season;

/** A real generated player, re-born so he arrives at the academy entry age. */
function youngster(i = 0): Player {
  const p = league.players[i];
  return { ...p, born: season - USER_ACADEMY_ENTRY_AGE };
}

/** Counts shared-rng draws, so a test can pin that the draw count never moves. */
function countingRng(seed: number): { rng: () => number; draws: () => number } {
  const inner = mulberry32(seed);
  let n = 0;
  return { rng: () => { n++; return inner(); }, draws: () => n };
}

describe("youth growth arithmetic", () => {
  it("is a real, positive season of growth under both development models", () => {
    expect(youthGrowthPerSeason("random")).toBeGreaterThan(1);
    expect(youthGrowthPerSeason("steady")).toBeGreaterThan(1);
  });

  it("is nothing at or past the reference age, and two full seasons two years short", () => {
    const g = youthGrowthPerSeason();
    for (let pid = 0; pid < 50; pid++) {
      expect(youthShortfall(pid, YOUTH_BASE_REFERENCE_AGE)).toBe(0);
      expect(youthShortfall(pid, YOUTH_BASE_REFERENCE_AGE + 3)).toBe(0);
      expect(youthShortfall(pid, YOUTH_BASE_REFERENCE_AGE - 2)).toBeCloseTo(2 * g);
    }
  });

  it("splits the final year between early and late developers, and nobody goes backwards", () => {
    const g = youthGrowthPerSeason();
    const lastYear = Array.from({ length: 400 }, (_, pid) =>
      youthShortfall(pid, YOUTH_BASE_REFERENCE_AGE - 1));
    for (const s of lastYear) {
      expect(s).toBeGreaterThanOrEqual(g * (1 - ACADEMY_GROWTH_TIMING_SPREAD) - 1e-9);
      expect(s).toBeLessThanOrEqual(g * (1 + ACADEMY_GROWTH_TIMING_SPREAD) + 1e-9);
      // Less left at 15 than at 14, so the first year is always growth.
      expect(s).toBeLessThan(2 * g);
    }
    // It genuinely varies: some kids do most of it early, some late.
    expect(lastYear.some((s) => s < g * 0.8)).toBe(true);
    expect(lastYear.some((s) => s > g * 1.2)).toBe(true);
  });

  it("climbs every rating toward the target and returns the target itself at sixteen", () => {
    const p = league.players[3];
    const at14 = youthRatingsAt(p.ratings, p.pid, 14);
    const at15 = youthRatingsAt(p.ratings, p.pid, 15);
    expect(youthRatingsAt(p.ratings, p.pid, 16)).toBe(p.ratings);
    for (const key of Object.keys(p.ratings) as SkillKey[]) {
      expect(at14[key]).toBeLessThanOrEqual(at15[key]);
      expect(at15[key]).toBeLessThanOrEqual(p.ratings[key]);
    }
  });

  it("takes the same off every position, so a kid's best position is the same at 14 as at 16", () => {
    // Clear of RATING_MIN so the clamp (the one thing allowed to bend it) never
    // bites, which isolates the property the uniform shortfall exists for.
    const p = league.players.find((x) => x.pos === "CM")!;
    const target = Object.fromEntries(
      Object.entries(p.ratings).map(([k, v]) => [k, Math.max(v, 40)]),
    ) as PlayerRatings;
    const shown = youthRatingsAt(target, p.pid, 14);
    const drops = POSITIONS.map((pos) =>
      computeOvr(pos, target, p.heightCm) - computeOvr(pos, shown, p.heightCm));
    expect(Math.max(...drops) - Math.min(...drops)).toBeLessThanOrEqual(1);

    const best = (r: PlayerRatings) =>
      Math.max(...POSITIONS.map((pos) => computeOvr(pos, r, p.heightCm)));
    const bestPos = POSITIONS.find((pos) => computeOvr(pos, target, p.heightCm) === best(target))!;
    expect(computeOvr(bestPos, shown, p.heightCm)).toBeGreaterThanOrEqual(best(shown) - 1);
  });
});

describe("an academy kid, enrolment to sixteen", () => {
  it("enrols as the younger version of the player he was rolled as", () => {
    const rolled = youngster();
    const kid = enrolAcademyYouth(rolled, season);
    expect(kid.youthTarget).toBe(rolled.ratings);
    expect(kid.ratings).toEqual(youthRatingsAt(rolled.ratings, rolled.pid, USER_ACADEMY_ENTRY_AGE));
    expect(kid.ovr).toBe(computeOvr(kid.pos, kid.ratings, kid.heightCm));
    expect(kid.ovr).toBeLessThan(rolled.ovr);
    // Potential was forecast from the rolled ratings, which is where he lands.
    expect(kid.potential).toBe(rolled.potential);
    // peakOvr is authoritative once set, so it must describe the shown player.
    expect(kid.peakOvr).toBe(kid.ovr);
    expect(kid.hist.every((h) => h.academy && h.ovr === kid.ovr)).toBe(true);
  });

  it("leaves a kid already at the reference age exactly as rolled", () => {
    const p = { ...league.players[0], born: season - YOUTH_BASE_REFERENCE_AGE };
    const kid = enrolAcademyYouth(p, season);
    expect(kid.ratings).toBe(p.ratings);
    expect(kid.youthTarget).toBeUndefined();
  });

  it("grows a year, then lands on the target exactly and drops it", () => {
    const rolled = youngster(5);
    const kid = enrolAcademyYouth(rolled, season);

    const at15 = progressPlayer(mulberry32(1), kid, season, true);
    expect(at15.ratings).toEqual(youthRatingsAt(rolled.ratings, rolled.pid, 15));
    expect(at15.youthTarget).toBe(rolled.ratings);
    expect(at15.ovr).toBeGreaterThanOrEqual(kid.ovr);
    expect(at15.potential).toBe(rolled.potential);

    const at16 = progressPlayer(mulberry32(2), at15, season + 1, true);
    expect(at16.ratings).toEqual(rolled.ratings);
    expect(at16.ovr).toBe(computeOvr(rolled.pos, rolled.ratings, rolled.heightCm));
    expect(at16.potential).toBe(rolled.potential);
    expect("youthTarget" in at16).toBe(false);
    expect(at16.hist[at16.hist.length - 1].ovr).toBe(at16.ovr);
  });

  it("spends exactly the draws a kid without a target spends", () => {
    const rolled = youngster(7);
    const withTarget = countingRng(9);
    progressPlayer(withTarget.rng, enrolAcademyYouth(rolled, season), season, true);
    const without = countingRng(9);
    progressPlayer(without.rng, rolled, season, true);
    expect(withTarget.draws()).toBe(without.draws());
  });

  it("still holds a kid enrolled before targets existed until sixteen", () => {
    const old = youngster(2);
    const next = progressPlayer(mulberry32(3), old, season, true);
    expect(next.ratings).toBe(old.ratings);
    expect(next.ovr).toBe(old.ovr);
  });

  it("carries a God Mode rating edit through to where he lands", () => {
    const kid = enrolAcademyYouth(youngster(4), season);
    const edited = applyPlayerEdit(
      [kid], kid.pid, season, { ratings: { finishing: kid.ratings.finishing + 5 } },
    )[0];
    expect(edited.youthTarget!.finishing).toBe(Math.min(99, kid.youthTarget!.finishing + 5));
    expect(edited.youthTarget!.speed).toBe(kid.youthTarget!.speed);
  });
});
