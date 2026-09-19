import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";

/**
 * Render harness for Club History, covering the one thing that is easy to get
 * wrong: *which* club it shows.
 *
 * The club comes from the `tid` search param rather than component state,
 * because the club-season page links here for the club you were just looking
 * at. Held in state, that link could only ever land on your own club — which is
 * exactly the bug this pins.
 *
 * **Assert on the heading link and the selected option, never on the club's
 * name.** The picker renders an `<option>` for every club in the world, so
 * `toContain(name)` and `toContain('value="7"')` both pass whichever club the
 * page actually chose, and a test written that way is vacuous. Verified by
 * running these against the state-based version: the heading assertion fails
 * there, the name one does not.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({ league: leagueRef.current, simming: false }),
}));

const { ClubHistory } = await import("../../src/ui/pages/ClubHistory.js");

function render(league: LeagueStore, search = ""): string {
  leagueRef.current = league;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/history${search}`] },
      createElement(ClubHistory),
    ),
  );
}

/** The club the page is actually about, read off its heading link. */
function shownTid(html: string): number | null {
  const m = html.match(/<h4[^>]*><a[^>]*href="\/club\/(\d+)\//);
  return m ? Number(m[1]) : null;
}

describe("Club History page render", () => {
  // The fixture's own userTid is 0, and 0 is a real club — the first English
  // one. `Number(null)` is 0 too, so a page that reads the missing `tid` param
  // straight to a number lands on that club and is indistinguishable from one
  // that correctly fell back to yours. Every default-case assertion below is
  // therefore made against a league whose manager is somebody else, which is
  // the only way this can fail. Overridden rather than generated with a second
  // `makeLeague(tid, ...)`: each distinct (userTid, seed) is another cached
  // world fixture, and nothing here reads the squad.
  const world = makeLeague(0, 1);
  const userTid = world.teams[7].tid;
  const base = { ...world, meta: { ...world.meta, userTid } } as LeagueStore;
  const otherTid = base.teams.find((t) => t.tid !== userTid)!.tid;

  it("shows your own club when no club is named", () => {
    const html = render(base);
    expect(shownTid(html)).toBe(userTid);
  });

  it("shows your own club for an empty tid param", () => {
    // `Number("")` is 0, the same trap as the missing param one line up.
    expect(shownTid(render(base, "?tid="))).toBe(userTid);
  });

  it("still shows club 0 when that is the club named", () => {
    // The flip side of the fix: 0 is a legitimate tid and must stay reachable.
    expect(shownTid(render(base, "?tid=0"))).toBe(0);
  });

  it("shows the club named in the URL, not your own", () => {
    const html = render(base, `?tid=${otherTid}`);
    expect(shownTid(html)).toBe(otherTid);
    // The picker has to agree with the heading, or the page contradicts itself.
    expect(html).toContain(`value="${otherTid}" selected=""`);
  });

  it("falls back to your club for a tid the save has never heard of", () => {
    expect(shownTid(render(base, "?tid=99999"))).toBe(userTid);
  });

  it("falls back to your club for a tid that isn't a number", () => {
    expect(shownTid(render(base, "?tid=banana"))).toBe(userTid);
  });

  // A club with at least one completed season. Hoisted to the outer scope
  // because the greatest-players board needs one too: the whole page is a
  // placeholder until a season is on record.
  const played: LeagueStore = {
    ...base,
    season: base.season + 1,
    seasonHistory: [{
      season: base.season,
      table: base.teams.map((t, i) => ({
        tid: t.tid, played: 38, won: 38 - i, drawn: 0, lost: i,
        gf: 60, ga: 30, gd: 30, points: (38 - i) * 3,
      })),
      teamStats: [],
      awards: {},
      compsByTid: Object.fromEntries(base.teams.map((t) => [t.tid, t.compId])),
      championTidByCompId: {},
      world: { ballonDOr: [], worldTeamOfYear: [] },
    }],
  } as unknown as LeagueStore;

  describe("season rows", () => {
    it("marks each season row clickable and gives it a chevron", () => {
      const html = render(played);
      // Matched loosely on purpose: a title-winning season also carries
      // champion-highlight, and that pair is the case the hover CSS has to
      // stack two washes for rather than losing the gold one.
      expect(html).toMatch(/<tr class="season-row(?: champion-highlight)?"/);
      // The chevron is decoration, not information — the year link already says
      // where the row goes, and announcing it twice is noise.
      expect(html).toContain('<td class="season-row-go" aria-hidden="true">');
    });

    it("keeps the year a real anchor, not just a click handler", () => {
      // This is the regression that matters: a <tr> onClick cannot give you
      // cmd-click, middle-click, "open in new tab" or keyboard focus. Replacing
      // the anchor with a handler would look identical to a mouse user and
      // silently break all four.
      const html = render(played);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/club/${userTid}/${base.season}"`));
    });
  });

  describe("greatest players board", () => {
    // A completed season (the page shows nothing without one) plus a season
    // line per club naming who played for it. That line is the whole input to
    // the board, so this pins what a filter-by-club board gets wrong: showing
    // the world's best rather than this club's.
    const other = base.teams.find((t) => t.tid !== userTid)!;
    const ourPid = base.teams.find((t) => t.tid === userTid)!.roster[0];
    const theirPid = other.roster[0];

    const line = (tid: number) => ({
      season: base.season, tid, appearances: 30, goals: 10, assists: 5,
      ratingSum: 210, avgRating: 7, minutesPlayed: 2700,
    });

    const leagueWith = (stats: boolean): LeagueStore => ({
      ...played,
      players: stats
        ? played.players.map((p) =>
          // No stored summary on the two edited players, so their career is
          // exactly the line given here (the boards read the summary, which a
          // real save keeps in step with the lines; a fixture has to as well).
          p.pid === ourPid ? { ...p, recentStats: [line(userTid)], career: undefined }
            : p.pid === theirPid ? { ...p, recentStats: [line(other.tid)], career: undefined }
              : { ...p, recentStats: [] })
        : played.players.map((p) => ({ ...p, recentStats: [] })),
    } as unknown as LeagueStore);

    it("names the club's own alumni and nobody else's", () => {
      const league = leagueWith(true);
      const ourName = league.players.find((p) => p.pid === ourPid)!.name;
      const theirName = league.players.find((p) => p.pid === theirPid)!.name;

      const mine = render(league);
      expect(mine).toContain("Greatest Players");
      expect(mine).toContain(`/player/${ourPid}`);
      expect(mine).toContain(ourName);
      expect(mine).not.toContain(`/player/${theirPid}`);

      const yours = render(league, `?tid=${other.tid}`);
      expect(yours).toContain(`/player/${theirPid}`);
      expect(yours).toContain(theirName);
      expect(yours).not.toContain(`/player/${ourPid}`);
    });

    it("gives each part of the score its own column, and drops the empty one", () => {
      // The world board generates its columns from `row.components` so a part
      // can't count toward a total without appearing. This does the same, with
      // one difference worth pinning: "Extras" (goals, assists, caps) is zeroed
      // for everyone on a club board by construction, and a column of nothing
      // but zeroes reads as a bug rather than as a fact.
      const html = render(leagueWith(true));
      for (const part of ["Peak", "Prime", "Career", "Awards", "Trophies"]) {
        expect(html).toContain(`<th class="text-end">${part}</th>`);
      }
      expect(html).not.toContain('<th class="text-end">Extras</th>');
      // The raw rating keeps a name of its own, or it and the Peak score column
      // both read as "peak" and the row stops making sense.
      expect(html).toContain('<th class="text-end">Best OVR</th>');
    });

    it("says the board is empty rather than rendering a headerless table", () => {
      // A club whose players have no recorded appearances. Legitimate on a save
      // that has only just started, and it has to read as such.
      expect(render(leagueWith(false)))
        .toContain("No players with a game for this club yet.");
    });
  });
});
