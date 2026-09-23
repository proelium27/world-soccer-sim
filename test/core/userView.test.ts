import { describe, it, expect } from "vitest";
import { interestOf, appealBreakdown, userView, standingLabel } from "../../src/core/transfers/userView.js";
import type { ClubAppeal } from "../../src/core/transfers/clubAppeal.js";
import { makeLeague } from "../helpers/league.js";

const appeal = (score: number, refused = false): ClubAppeal =>
  ({ score, refused, lines: [{ id: "home", label: "Home country", value: score }] });

describe("userView", () => {
  it("labels by score, with a refusal always Won't talk", () => {
    expect(interestOf(appeal(0.3))).toBe("Keen");
    expect(interestOf(appeal(0))).toBe("Open");
    expect(interestOf(appeal(-0.2))).toBe("Reluctant");
    expect(interestOf(appeal(0.9, true))).toBe("Won't talk");
  });

  it("spells out the lines for a tooltip", () => {
    expect(appealBreakdown(appeal(0.25))).toBe("Home country +0.25");
    expect(appealBreakdown({ score: 0, refused: false, lines: [] })).toBe("Nothing either way");
  });

  it("answers for real players at the user's club, and shows its league rules", () => {
    const league = makeLeague(0, 1); // tid 0: an English club
    const view = userView(league);
    const englishman = league.players.find((p) => p.nationality === "England" && p.ovr < 70)!;
    expect(view.of(englishman)).not.toBeNull();
    // England has a homegrown minimum, so the user sees one standing.
    expect(view.standings.map(standingLabel)[0]).toMatch(/Homegrown/);
  });
});
