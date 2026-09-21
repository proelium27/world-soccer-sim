import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { promotionBands } from "../../src/core/promotionBands.js";
import { competitionTeamCount } from "../../src/core/competitions.js";

/**
 * Two things the table has to get right about a season that has not started.
 *
 * With every club on zero, the order is whatever the tiebreak fell back to, so
 * a numbered table and a shaded Cup zone both state something the season has
 * not decided — the same rule the Finance page follows before quoting a rank.
 * And once it has started, the promotion and relegation lines have to appear,
 * since the table never said where either one sits.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { Standings } = await import("../../src/ui/pages/Standings.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(Standings)),
  );
}

/** One played match in the user's own division, which is all `started` asks for. */
function withOneResult(league: LeagueStore): LeagueStore {
  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid)!;
  const [a, b] = league.teams.filter((t) => t.compId === userTeam.compId);
  return {
    ...league,
    played: [{
      home: a.tid, away: b.tid, homeGoals: 2, awayGoals: 1, matchday: 1,
      possessionHome: 0.5,
      // The page reads scores, never the box score, so an empty one is enough
      // and keeps the fixture to what `started` actually depends on.
      boxScore: { home: [], away: [], events: [] },
    }],
  };
}

describe("Standings", () => {
  const league = makeLeague(0, 4);

  it("shows the clubs but no positions before a ball is kicked", () => {
    const html = render(league);
    expect(html).toContain("No games played yet");
    // Every position cell is blank...
    expect(html).toContain('qual-pos">—');
    // ...and no ROW is shaded as a cup place on a table nobody has played. The
    // legend below it still says which places qualify, which is a statement
    // about the league rather than about anyone's position in it.
    expect(html).not.toContain('title="Continental Cup place"');
  });

  it("numbers the table and draws the promotion and relegation lines once it starts", () => {
    const html = render(withOneResult(league));
    expect(html).not.toContain("No games played yet");
    expect(html).not.toContain('qual-pos">—');

    // The user opens in a top flight, so there is a relegation line and no
    // promotion one — which is also the check that the bands are read from the
    // division rather than drawn unconditionally.
    const userTeam = league.teams.find((t) => t.tid === league.meta.userTid)!;
    const comp = league.competitions.find((c) => c.id === userTeam.compId)!;
    const bands = promotionBands(league.competitions, comp, competitionTeamCount(comp));
    expect(bands.relegated.length).toBeGreaterThan(0);
    expect(bands.promoted).toEqual([]);

    expect(html).toContain("band-cut-down");
    expect(html).not.toContain("band-cut-up");
    expect(html).toContain("go down");
  });

  /**
   * The lines are drawn by CSS, and the way they break is invisible: `.table >
   * tbody td` sets `border-bottom-color`, which out-specifies a bare
   * `.band-cut-up > td`, so the rule lands at the right width and style in the
   * table's own grey. That renders as an ordinary ruled table rather than as
   * anything wrong. Found in a browser, not by a render test.
   */
  it("draws those lines in a colour the table cannot override", () => {
    const css = readFileSync("src/ui/styles.css", "utf8");
    for (const cls of [
      "band-cut-up", "band-cut-up-playoff", "band-cut-down-playoff", "band-cut-down",
    ]) {
      const rule = new RegExp(`([^\\n{]*\\.${cls}[^\\n{]*)\\{`).exec(css);
      expect(rule, `no CSS rule for .${cls}`).not.toBeNull();
      expect(rule![1]).toContain(".table > tbody > tr");
    }
  });
});
