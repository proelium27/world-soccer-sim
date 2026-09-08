import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LiveMatchView } from "../../src/ui/components/LiveMatchView.js";
import type { MatchEvent } from "../../src/engine/attribution.js";
import type { StoredTeam } from "../../src/core/teams/clubs.js";
import type { LiveMatch } from "../../src/ui/live/liveMatch.js";
import type { MatchLineups } from "../../src/ui/live/lineups.js";

/**
 * Render harness for the live viewer (the pattern from transfersRender.test.tsx:
 * there is no DOM test env here, so this pins the server-rendered markup).
 *
 * The property that matters is that the viewer shows the match as it stood at
 * the current minute and NOT how it finished. A static render lands on minute 0,
 * which is exactly the frame where a leak would be obvious: the final score is
 * sitting right there on the match object it was handed.
 */

function at(minute: number, type: MatchEvent["type"], side: MatchEvent["side"]): MatchEvent {
  return { clock: 5400 - (minute - 1) * 60 - 1, type, side, pids: [1, 2] };
}

function match(over: Partial<LiveMatch> = {}): LiveMatch {
  return {
    home: 1,
    away: 2,
    matchday: 7,
    events: [
      at(20, "goal", "home"),
      at(55, "goal", "away"),
      at(70, "goal", "home"),
      at(88, "goal", "home"),
    ],
    ...over,
  };
}

function team(tid: number, name: string, abbrev: string): StoredTeam {
  return { tid, name, abbrev, colors: ["#123456", "#654321"], compId: 0 } as StoredTeam;
}

const TEAMS = [team(1, "Ashford United", "ASH"), team(2, "Kestrel City", "KES"), team(3, "Marden", "MAR"), team(4, "Thorne", "THO")];

const LINEUPS: MatchLineups = {
  home: {
    formation: "4-3-3",
    starters: [
      { pid: 10, slot: "GK" },
      { pid: 11, slot: "CB" },
    ],
    // Made at 60', so it must not be showing at kickoff.
    subs: [{ on: 12, off: 11, minute: 60, slot: "CB" }],
  },
  away: { formation: "4-4-2", starters: [{ pid: 20, slot: "GK" }], subs: [] },
};

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

function view(over: Record<string, unknown> = {}) {
  return createElement(LiveMatchView, {
    match: match(),
    otherMatches: [],
    teams: TEAMS,
    playerName: (pid: number) => `Player ${pid}`,
    competitionName: "Premier Division",
    tableAtMinute: () => TEAMS.map((t) => ({ tid: t.tid, points: 0 })),
    onComplete: () => {},
    ...over,
  } as never);
}

describe("LiveMatchView", () => {
  it("kicks off goalless rather than showing the final score", () => {
    const html = render(view());
    expect(html).toContain("0 - 0");
    // The match finished 3-1 and that number is on the object it was handed.
    expect(html).not.toContain("3 - 1");
  });

  it("has not revealed any of the match's events at kickoff", () => {
    const html = render(view());
    expect(html).not.toContain("Goal");
    expect(html).toContain("Just about to kick off");
  });

  it("names the competition and matchday", () => {
    const html = render(view());
    expect(html).toContain("Premier Division");
    expect(html).toContain("Matchday 7");
  });

  it("names both clubs", () => {
    const html = render(view());
    expect(html).toContain("Ashford United");
    expect(html).toContain("Kestrel City");
  });

  it("lists other matches on the rail by abbreviation", () => {
    const other = match({ home: 3, away: 4, matchday: 7 });
    const html = render(view({ otherMatches: [other] }));
    expect(html).toContain("Elsewhere");
    expect(html).toContain("MAR");
    expect(html).toContain("THO");
  });

  it("shows a live table covering the whole competition", () => {
    const html = render(view({ otherMatches: [match({ home: 3, away: 4 })] }));
    expect(html).toContain("Live table");
    // All four clubs in the competition appear, not just the two on the pitch.
    for (const abbrev of ["ASH", "KES", "MAR", "THO"]) expect(html).toContain(abbrev);
  });

  /* --- the page, not a dialog ------------------------------------------- */

  it("renders as page content rather than an overlay", () => {
    const html = render(view());
    // The class the sim overlay uses to cover the app. A page must not have it.
    expect(html).not.toContain("sim-overlay");
    expect(html).toContain("live-page");
  });

  it("gives the page a heading naming the match", () => {
    const html = render(view());
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Ashford United[\s\S]*<\/h1>/);
  });

  it("carries a polite live region for the running commentary", () => {
    const html = render(view());
    expect(html).toContain('aria-live="polite"');
  });

  /* --- lineups ---------------------------------------------------------- */

  it("shows both team sheets with the shape each side started in", () => {
    const html = render(view({ lineups: LINEUPS }));
    expect(html).toContain("Lineups");
    expect(html).toContain("4-3-3");
    expect(html).toContain("4-4-2");
    expect(html).toContain("Player 10");
    expect(html).toContain("Player 20");
  });

  it("has not made the 60th-minute substitution at kickoff", () => {
    const html = render(view({ lineups: LINEUPS }));
    expect(html).not.toContain("Substitutes used");
    expect(html).not.toContain("Player 12");
  });

  it("shows no lineups section at all when they can't be recovered", () => {
    const html = render(view({ lineups: null }));
    expect(html).not.toContain("Lineups");
  });
});
