import { describe, it, expect } from "vitest";
import { homeAttachment, domesticShare, homeClubs, type HomeClub } from "../../src/core/transfers/homePull.js";
import { worldCompetitions, competitionStrengthOffset } from "../../src/core/competitions.js";
import { statureSensitivity } from "../../src/core/transfers/playerWill.js";
import { APPEAL_HOME_FADE_RANGE, APPEAL_HOME_LEVEL_PER_OFFSET } from "../../src/core/constants.js";
import type { Player } from "../../src/core/players/types.js";

const player = (nationality: string, ovr: number) => ({ nationality, ovr }) as Player;

describe("homeAttachment", () => {
  // Roughly what each country's best clubs field at generation.
  const usa: HomeClub = { country: "United States", domesticShare: 0.4, confederation: "North America", homeLevel: 73.7 };
  const england: HomeClub = { country: "England", domesticShare: 0.39, confederation: "Europe", homeLevel: 84.7 };
  const noLevel: HomeClub = { country: "Argentina", domesticShare: 0.84, confederation: "South America" };

  it("lets a player who has outgrown his league go, and keeps an ordinary one home", () => {
    // 78 is a star in MLS: over 4 points above its best clubs.
    expect(homeAttachment(player("United States", 78), usa)).toBeLessThan(0.15);
    // 78 is an ordinary Premier League player: only the global curve applies.
    expect(homeAttachment(player("England", 78), england)).toBeCloseTo(1 - statureSensitivity(78));
    expect(homeAttachment(player("England", 78), england)).toBeGreaterThan(0.6);
  });

  it("is gone entirely at the fade range above his league, and full for a squad player", () => {
    expect(homeAttachment(player("United States", 73.7 + APPEAL_HOME_FADE_RANGE), usa)).toBe(0);
    expect(homeAttachment(player("United States", 65), usa)).toBe(1);
  });

  it("falls back to the global star curve when the club carries no level", () => {
    expect(homeAttachment(player("Argentina", 80), noLevel)).toBeCloseTo(1 - statureSensitivity(80));
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

describe("homeClubs", () => {
  // One top-flight club each for England (the top of the ladder) and Brazil,
  // each fielding a squad of identical players.
  const comps = worldCompetitions().filter((c) => c.tier === 1 && (c.country === "England" || c.country === "Brazil"));
  const england = comps.find((c) => c.country === "England")!;
  const brazil = comps.find((c) => c.country === "Brazil")!;
  const squad = (from: number, ovr: number) =>
    Array.from({ length: 20 }, (_, i) => ({ pid: from + i, ovr }) as Player);
  const levels = (brazilOvr: number) => {
    const players = [...squad(0, 80), ...squad(100, brazilOvr)];
    const teams = [
      { tid: 0, compId: england.id, roster: players.slice(0, 20).map((p) => p.pid) },
      { tid: 1, compId: brazil.id, roster: players.slice(20).map((p) => p.pid) },
    ];
    const homes = homeClubs(teams, comps, players);
    return { england: homes.get(0)!.homeLevel!, brazil: homes.get(1)!.homeLevel! };
  };

  it("sets a country's stage by its place on the ladder, not by its own squads", () => {
    const weak = levels(60);
    const strong = levels(79);
    // Brazil keeping better players does not raise its own stage: that loop is
    // what let it finish above the big four.
    expect(strong.brazil).toBe(weak.brazil);
    const gap = competitionStrengthOffset(brazil) - competitionStrengthOffset(england);
    expect(gap).toBeGreaterThan(0);
    expect(weak.brazil).toBeCloseTo(80 - APPEAL_HOME_LEVEL_PER_OFFSET * gap, 6);
    expect(weak.england).toBe(80);
  });
});
