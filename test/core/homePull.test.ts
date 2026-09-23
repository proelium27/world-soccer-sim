import { describe, it, expect } from "vitest";
import {
  homePull, homeAppeal, foreignDiscount, homeGap, domesticShare, type HomeClub,
} from "../../src/core/transfers/homePull.js";
import { worldCompetitions } from "../../src/core/competitions.js";
import { PLAYER_WILL_CARE_CEILING, PLAYER_WILL_CARE_FLOOR } from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";

const player = (nationality: string, ovr: number) => ({ nationality, ovr }) as Player;
// Clubs sitting 10 points below their league's real domestic share.
const argentina: HomeClub = { country: "Argentina", domesticShare: 0.84, domesticNow: 0.74 };
const scotland: HomeClub = { country: "Scotland", domesticShare: 0.36, domesticNow: 0.26 };
const spain: HomeClub = { country: "Spain", domesticShare: 0.61, domesticNow: 0.51 };

describe("homeGap", () => {
  it("is how far over its foreign allowance the club is", () => {
    // 10 points short of 84% domestic is 10 points over a 16% foreign allowance.
    expect(homeGap(argentina)).toBeCloseTo(0.1 / 0.16);
    expect(homeGap(scotland)).toBeCloseTo(0.1 / 0.64);
  });

  it("is 0 at or above the real share, and for a league with no foreign allowance", () => {
    expect(homeGap({ ...argentina, domesticNow: 0.84 })).toBe(0);
    expect(homeGap({ ...argentina, domesticNow: 0.95 })).toBe(0);
    expect(homeGap({ ...argentina, domesticShare: 1, domesticNow: 0.5 })).toBe(0);
  });

  it("pushes a very domestic league harder for the same shortfall", () => {
    expect(homeGap(argentina)).toBeGreaterThan(homeGap(scotland));
  });
});

describe("homePull", () => {
  it("is off at K = 0 and for a foreign player", () => {
    expect(homePull(player("Argentina", 60), argentina, 0)).toBe(0);
    expect(homePull(player("Brazil", 60), argentina, 6)).toBe(0);
  });

  it("is K times the club's gap for a squad player", () => {
    expect(homePull(player("Argentina", 60), argentina, 6)).toBeCloseTo(6 * homeGap(argentina));
  });

  it("fades out for stars: full at the care floor, none at the ceiling", () => {
    expect(homePull(player("Argentina", PLAYER_WILL_CARE_FLOOR), argentina, 6)).toBeCloseTo(6 * homeGap(argentina));
    expect(homePull(player("Argentina", PLAYER_WILL_CARE_CEILING), argentina, 6)).toBe(0);
  });

  it("stops once the club reaches its league's real share", () => {
    expect(homePull(player("Argentina", 60), { ...argentina, domesticNow: 0.84 }, 6)).toBe(0);
  });
});

describe("homeAppeal", () => {
  it("is exactly 1 when the market pull is off", () => {
    expect(homeAppeal(player("Argentina", 60), argentina, spain, 0)).toBe(1);
  });

  it("pulls a squad player home and holds him there", () => {
    const g = homeGap(argentina);
    expect(homeAppeal(player("Argentina", 60), argentina, spain, 0.5)).toBeCloseTo(1 - 0.5 * g);
    expect(homeAppeal(player("Argentina", 60), spain, argentina, 0.5)).toBeCloseTo(1 + 0.5 * g);
  });

  it("is neutral between two foreign clubs and for stars", () => {
    expect(homeAppeal(player("Brazil", 60), argentina, spain, 0.5)).toBe(1);
    expect(homeAppeal(player("Argentina", PLAYER_WILL_CARE_CEILING), argentina, spain, 0.5)).toBe(1);
  });

  it("never goes negative", () => {
    expect(homeAppeal(player("Argentina", 60), argentina, spain, 5)).toBe(0);
  });
});

describe("foreignDiscount", () => {
  it("discounts a foreign squad player at a club over its foreign allowance", () => {
    expect(foreignDiscount(player("Brazil", 60), argentina, 1.5)).toBeCloseTo(Math.max(0, 1 - 1.5 * homeGap(argentina)));
    expect(foreignDiscount(player("Brazil", 60), scotland, 1.5)).toBeCloseTo(1 - 1.5 * homeGap(scotland));
  });

  it("leaves home players, stars, clubs at their share and the off setting alone", () => {
    expect(foreignDiscount(player("Argentina", 60), argentina, 1.5)).toBe(1);
    expect(foreignDiscount(player("Brazil", PLAYER_WILL_CARE_CEILING), argentina, 1.5)).toBe(1);
    expect(foreignDiscount(player("Brazil", 60), { ...argentina, domesticNow: 0.9 }, 1.5)).toBe(1);
    expect(foreignDiscount(player("Brazil", 60), argentina, 0)).toBe(1);
  });
});

describe("domesticShare", () => {
  it("reads each shipped league's real domestic share", () => {
    const comps = worldCompetitions().filter((c) => c.tier === 1);
    const arg = comps.find((c) => c.country === "Argentina")!;
    const eng = comps.find((c) => c.country === "England")!;
    expect(domesticShare(arg)).toBeGreaterThan(0.8);
    expect(domesticShare(eng)).toBeGreaterThan(0.3);
    expect(domesticShare(eng)).toBeLessThan(0.45);
  });

  it("is 0 for a league whose country is not a nationality", () => {
    const [base] = worldCompetitions();
    expect(domesticShare({ ...base, country: "Neverland", nationalities: undefined })).toBe(0);
  });
});
