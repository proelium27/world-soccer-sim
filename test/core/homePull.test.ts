import { describe, it, expect } from "vitest";
import { homePull, homeAppeal, domesticShare, type HomeClub } from "../../src/core/transfers/homePull.js";
import { worldCompetitions } from "../../src/core/competitions.js";
import { PLAYER_WILL_CARE_CEILING, PLAYER_WILL_CARE_FLOOR } from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";

const player = (nationality: string, ovr: number) => ({ nationality, ovr }) as Player;
const argentina: HomeClub = { country: "Argentina", domesticShare: 0.84 };
const scotland: HomeClub = { country: "Scotland", domesticShare: 0.36 };
const spain: HomeClub = { country: "Spain", domesticShare: 0.61 };

describe("homePull", () => {
  it("is off at K = 0 and for a foreign player", () => {
    expect(homePull(player("Argentina", 60), argentina, 0)).toBe(0);
    expect(homePull(player("Brazil", 60), argentina, 6)).toBe(0);
  });

  it("scales with how domestic the league really is", () => {
    const arg = homePull(player("Argentina", 60), argentina, 6);
    const sco = homePull(player("Scotland", 60), scotland, 6);
    expect(arg).toBeCloseTo(6 * 0.84);
    expect(sco).toBeCloseTo(6 * 0.36);
  });

  it("fades out for stars: full below the care floor, none at the ceiling", () => {
    expect(homePull(player("Argentina", PLAYER_WILL_CARE_FLOOR), argentina, 6)).toBeCloseTo(6 * 0.84);
    expect(homePull(player("Argentina", PLAYER_WILL_CARE_CEILING), argentina, 6)).toBe(0);
  });
});

describe("homeAppeal", () => {
  it("is exactly 1 when the market pull is off", () => {
    expect(homeAppeal(player("Argentina", 60), argentina, spain, 0)).toBe(1);
  });

  it("pulls a squad player home and holds him there", () => {
    const leaving = homeAppeal(player("Argentina", 60), argentina, spain, 0.5);
    const returning = homeAppeal(player("Argentina", 60), spain, argentina, 0.5);
    expect(leaving).toBeCloseTo(1 - 0.5 * 0.84);
    expect(returning).toBeCloseTo(1 + 0.5 * 0.84);
  });

  it("is neutral between two foreign clubs and for stars", () => {
    expect(homeAppeal(player("Brazil", 60), argentina, spain, 0.5)).toBe(1);
    expect(homeAppeal(player("Argentina", PLAYER_WILL_CARE_CEILING), argentina, spain, 0.5)).toBe(1);
  });

  it("never goes negative", () => {
    expect(homeAppeal(player("Argentina", 60), argentina, spain, 5)).toBe(0);
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
