import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { potentialFog } from "../../src/core/scouting/potentialFog.js";
import { SCOUTING_SPEND_DEFAULT, RATING_MAX } from "../../src/core/constants.js";
import { makeLeague } from "../helpers/league.js";

/**
 * Guards the rule every fogged POT column follows: **sort by a number the
 * reader can see.**
 *
 * The bug this exists for was live and shipped. Youth Intake opened sorted by
 * `p.potential` descending against a five-contract limit, so the top five rows
 * *were* the five best prospects — the fog was drawn on screen while the row
 * order handed over the answer it exists to keep open. Academy, Free Agents and
 * Loans had the same accessor, and Free Agents used it to pick which players
 * were listed at all.
 */

/** Pages whose POT column is fogged, and so must never sort on the truth. */
const FOGGED_POT_PAGES = [
  "src/ui/pages/YouthIntake.tsx",
  "src/ui/pages/Academy.tsx",
  "src/ui/pages/FreeAgents.tsx",
  "src/ui/pages/Loans.tsx",
  "src/ui/pages/Database.tsx",
];

describe("no fogged POT column sorts on the true value", () => {
  for (const page of FOGGED_POT_PAGES) {
    it(`${page} ranks on the scouting band`, () => {
      const src = readFileSync(page, "utf8");
      // A sort accessor reading `.potential` straight off a player is the shape
      // of the bug — every one of these pages had exactly that line.
      const raw = src.match(/(pot|potential)\s*:\s*\(\s*\w+\s*\)\s*=>\s*\w+\.potential\b/g);
      expect(raw, `${page} sorts POT by the true value`).toBeNull();
      // Either reading of the band is fine — `ceiling` for a page that only
      // needs the top, `fogOf` for the database, which also wants the floor to
      // break ties. What must not vary is that the number comes from the
      // scouting view rather than off the player.
      expect(
        /potView\.(ceiling|fogOf)/.test(src),
        `${page} does not rank POT through the scouting view`,
      ).toBe(true);
    });
  }
});

describe("the ceiling is a usable sort key", () => {
  const league = makeLeague(0, 4);
  const season = league.season;
  const ceiling = (p: { potential: number; pid: number }) =>
    potentialFog(p.potential, p.pid, season, null, SCOUTING_SPEND_DEFAULT, league.difficulty).high;

  it("is the top of the band, so a reader's eye tracks it down the column", () => {
    for (const p of league.players.slice(0, 200)) {
      const fog = potentialFog(p.potential, p.pid, season, null, SCOUTING_SPEND_DEFAULT, league.difficulty);
      expect(ceiling(p)).toBe(fog.high);
      // The band always brackets the truth, so the ceiling never *understates*
      // a player — which is what makes "best case" an honest reading of it.
      expect(ceiling(p)).toBeGreaterThanOrEqual(p.potential);
    }
  });

  it("clamps rarely, but often enough that the sort needs a tiebreak", () => {
    // The clamp at RATING_MAX collapses the best prospects into one block that
    // all reads "–99". On a fresh world at default scouting it is a few dozen of
    // 15,650; on a real season-5 save it was **151 of 10,106 (1.5%)**, which is
    // a page and a half of arbitrarily-ordered rows at the top of a POT sort —
    // visibly broken, and the reason `scoutedPotFloor` exists. So this bound is
    // not "the tie block is negligible", it is "the ceiling still separates the
    // bulk of the world"; the block itself is handled by the tiebreak.
    const clamped = league.players.filter((p) => ceiling(p) >= RATING_MAX).length;
    expect(clamped / league.players.length).toBeLessThan(0.05);
  });

  it("orders a same-tenure group the same way the midpoint would", () => {
    // At equal scouting the band is `potential + shift ± a half-width that is
    // the same for everyone`, so ceiling, midpoint and floor are one ordering
    // shifted by a constant. That is why moving to the ceiling costs nothing in
    // how much a group of trialists gives away — it only makes the column read
    // as sorted.
    const group = league.players.slice(0, 400);
    const mid = (p: { potential: number; pid: number }) => {
      const f = potentialFog(p.potential, p.pid, season, null, SCOUTING_SPEND_DEFAULT, league.difficulty);
      return f.known ? p.potential : (f.low + f.high) / 2;
    };
    const byCeiling = [...group].sort((a, b) => ceiling(b) - ceiling(a) || a.pid - b.pid);
    const byMid = [...group].sort((a, b) => mid(b) - mid(a) || a.pid - b.pid);
    const agree = byCeiling.filter((p, i) => byMid[i].pid === p.pid).length;
    expect(agree / group.length).toBeGreaterThan(0.9);
  });
});
