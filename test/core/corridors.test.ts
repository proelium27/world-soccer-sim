import { describe, it, expect } from "vitest";
import { CORRIDORS, corridorFor } from "../../src/core/transfers/corridors.js";
import { clubAppealFor, appealScore, type AppealClub } from "../../src/core/transfers/clubAppeal.js";
import { namePoolFor } from "../../src/core/players/nationalities.js";
import { worldCompetitions } from "../../src/core/competitions.js";
import { POSITIONS, type Player, type Position } from "../../src/core/players/types.js";
import type { HomeClub } from "../../src/core/transfers/homePull.js";
import { APPEAL_LANGUAGE, APPEAL_LOAN_FACTOR } from "../../src/core/constants.js";

const player = (nationality: string, ovr: number) =>
  ({ pid: 1, nationality, ovr, pos: "CM", stats: [] }) as unknown as Player;
const weakest = Object.fromEntries(POSITIONS.map((p) => [p, 60])) as Record<Position, number>;
const home = (country: string): HomeClub =>
  ({ country, domesticShare: 0.5, confederation: "Europe", homeLevel: 80 });
const club = (tid: number, country: string): AppealClub =>
  ({ tid, stature: 0.4, home: home(country), posWeakestStarterOvr: weakest });

const portugal = club(1, "Portugal");
const germany = club(2, "Germany");
const language = (a: { lines: { id: string; value: number }[] }) =>
  a.lines.find((l) => l.id === "language")?.value ?? 0;

describe("language and family ties", () => {
  it("names only nationalities the game has and countries it ships", () => {
    const countries = new Set(worldCompetitions().map((c) => c.country));
    for (const c of CORRIDORS) {
      expect(countries.has(c.to), c.to).toBe(true);
      for (const n of c.from) expect(namePoolFor(n), n).toBeDefined();
      for (const n of c.from) expect(n).not.toBe(c.to);
    }
  });

  it("takes the strongest route when a nationality has two into one country", () => {
    expect(corridorFor("DR Congo", "Belgium")?.strength).toBe(1.25);
    expect(corridorFor("Brazil", "Portugal")?.strength).toBe(1.5);
    expect(corridorFor("Brazil", "Germany")).toBeNull();
    expect(corridorFor("Portugal", "Portugal")).toBeNull();
  });

  it("pulls a Brazilian squad player to Portugal and not to an equal German club", () => {
    const p = player("Brazil", 60);
    const from = { stature: 0.4 };
    expect(language(clubAppealFor(p, portugal, from))).toBeCloseTo(APPEAL_LANGUAGE * 1.5, 12);
    expect(language(clubAppealFor(p, germany, from))).toBe(0);
    expect(appealScore(p, portugal, from).score).toBeGreaterThan(appealScore(p, germany, from).score);
  });

  it("costs him the same to leave, halves on a loan and labels the route's reason", () => {
    const p = player("Brazil", 60);
    const leaving = clubAppealFor(p, germany, { stature: 0.4, club: portugal });
    expect(language(leaving)).toBeCloseTo(-APPEAL_LANGUAGE * 1.5, 12);
    const loan = clubAppealFor(p, portugal, { stature: 0.4 }, { loan: true });
    expect(language(loan)).toBeCloseTo(APPEAL_LANGUAGE * 1.5 * APPEAL_LOAN_FACTOR, 12);
    const congo = clubAppealFor(player("DR Congo", 60), club(3, "Belgium"), { stature: 0.4 });
    expect(congo.lines.find((l) => l.id === "language")?.label).toBe("Family ties");
  });

  it("fades for a star, like the home line", () => {
    const star = clubAppealFor(player("Brazil", 95), portugal, { stature: 0.4 });
    expect(language(star)).toBe(0);
  });
});
