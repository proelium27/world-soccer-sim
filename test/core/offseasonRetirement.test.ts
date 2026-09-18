/**
 * Offseason: retirement, the retiree archive, and award records.
 *
 * Part of the offseason suite, which is split across several files.
 *
 * Not for tidiness: every test here plays its own full season (~55s), and as a
 * single file that ran to ~32 minutes on CI — long enough that it *was* the
 * build, since a shard can never be faster than its slowest file. Vitest gives
 * each file its own worker, so splitting is what lets these run in parallel.
 * `test/helpers/shardPartition.ts` then keeps the pieces on different shards.
 *
 * Tests are independent (each builds its own seeded rng), so they can move
 * between these files freely — keep a new one with its subject.
 */

import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { awardWinnerPids } from "../../src/core/awardWinners.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { playFullSeason } from "../helpers/offseasonLeague.js";
import type { ArchivedPlayer } from "../../src/core/players/archive.js";
import { emptyTotals, emptyBestSeasons } from "../../src/core/frivolities/stats.js";
import {
  RETIREMENT_NOTABLE_LIMIT, RETIREE_ARCHIVE_LIMIT, RETIREE_ARCHIVE_MIN_PEAK_OVR, RETIREE_ARCHIVE_MIN_APPEARANCES,
} from "../../src/core/constants.js";

describe("simOffseason — retirement, archive and awards", () => {
  it("stores per-competition awards on seasonHistory", () => {
    const rng = mulberry32(7);
    const league = playFullSeason(rng);
    const next = simOffseason(league, rng);
    const history = next.seasonHistory.at(-1)!;
    expect(Object.keys(history.awards)).toHaveLength(next.competitions.length);
  });

  it("records who retired on the season-history entry, since the players themselves are deleted", () => {
    const rng = mulberry32(6);
    const league = playFullSeason(rng);
    const next = simOffseason(league, rng);

    const retirements = next.seasonHistory.at(-1)!.retirements!;
    expect(retirements.total).toBeGreaterThan(0);
    expect(retirements.rostered).toBeLessThanOrEqual(retirements.total);
    // Bounded on purpose: this list is persisted, and thousands leave each
    // offseason once the unrostered rate applies at any age.
    expect(retirements.notable.length).toBeLessThanOrEqual(RETIREMENT_NOTABLE_LIMIT);

    const survivors = new Set(next.players.map((p) => p.pid));
    const wasRostered = new Set(league.teams.flatMap((t) => [...t.roster, ...t.academyRoster]));
    for (const r of retirements.notable) {
      // Every one of them really is gone, and the snapshot carries the details
      // that could no longer be looked up.
      expect(survivors.has(r.pid)).toBe(false);
      expect(r.name).not.toBe("");
      expect(r.ovr).toBeGreaterThan(0);
      // The club is read from the pre-release rosters, so a player whose
      // contract expired this same offseason is still filed under his club.
      if (r.tid !== null) expect(wasRostered.has(r.pid)).toBe(true);
    }
  });

  it("drops retired and culled players from the watchlist, since nothing else can", () => {
    const rng = mulberry32(6);
    const league = playFullSeason(rng);
    // Star the whole world, so whoever the offseason deletes was on it.
    const watching = { ...league, watchlist: league.players.map((p) => p.pid) };

    const next = simOffseason(watching, rng);

    // The star lives on a player's profile page, and a deleted player has none —
    // so a pid left behind here could never be un-starred, and the shortlist
    // would carry a row nobody can open for the rest of the save.
    const alive = new Set(next.players.map((p) => p.pid));
    expect(next.watchlist.every((pid) => alive.has(pid))).toBe(true);
    // And it really was exercised: an offseason always retires someone.
    expect(next.watchlist.length).toBeLessThan(watching.watchlist.length);
  });

  it("names every award winner on the season it was won", () => {
    // Awards are stored as bare pids, and a pid stops resolving once retirement
    // deletes the player and the capped archive declines to keep him — measured
    // at 74% of league Players of the Season on a 100-season save. The snapshot
    // has to be complete the season it is taken, or there is nothing to fall
    // back to later.
    const rng = mulberry32(31);
    const league = playFullSeason(rng);
    const next = simOffseason(league, rng);

    const entry = next.seasonHistory.at(-1)!;
    const wanted = awardWinnerPids(entry);
    expect(wanted.size).toBeGreaterThan(0);
    const named = new Map((entry.awardWinners ?? []).map((w) => [w.pid, w]));
    expect([...wanted].filter((pid) => !named.has(pid))).toEqual([]);

    const before = new Map(league.players.map((p) => [p.pid, p]));
    for (const w of named.values()) {
      const player = before.get(w.pid)!;
      expect(w.name).toBe(player.name);
      expect(w.nationality).toBe(player.nationality);
      expect(w.pos).toBe(player.pos);
      expect(w.born).toBe(player.born);
      // The club he finished the season at, which is what the honours boards
      // credit the award to.
      expect(w.tid).toBe(player.recentStats.find((st) => st.season === league.season)!.tid);
    }

    // The snapshot exists because a pid stops resolving once retirement deletes
    // the player, so assert that this offseason really does delete players —
    // that is what makes taking the snapshot load-bearing rather than decorative.
    //
    // It deliberately does NOT assert that one of the deleted players is an
    // award winner. That was the original assertion and it measures seed luck
    // rather than a property of the code: award winners are prime-age players,
    // so whether any of the ~200 of them retires in one particular offseason
    // swings on the seed. Measured on origin/main with no code change at all,
    // this test passes on seed 31 and FAILS on seed 32 — so anything that
    // reshuffles which players win awards flips it for reasons unrelated to what
    // it guards, which is exactly what moving assists onto passing did. The
    // completeness and correctness of the snapshot is asserted above and is the
    // real contract. Same lesson as the roster-floor test earlier in this file:
    // fix the statistic rather than the seed.
    const survivors = new Set(next.players.map((p) => p.pid));
    expect([...before.keys()].some((pid) => !survivors.has(pid))).toBe(true);
  });

  it("archives the retirees worth keeping, and only those", () => {
    const rng = mulberry32(11);
    const league = playFullSeason(rng);
    const before = new Map(league.players.map((p) => [p.pid, p]));
    const next = simOffseason(league, rng);

    const survivors = new Set(next.players.map((p) => p.pid));
    const retirees = [...before.values()].filter((p) => !survivors.has(p.pid));
    expect(retirees.length).toBeGreaterThan(0);

    // The gate restated from raw player rows rather than by calling
    // isArchiveWorthy, so this asserts the rule independently instead of
    // echoing the implementation.
    const expected = retirees.filter((p) => {
      const apps = p.recentStats.reduce((sum, s) => sum + s.appearances, 0);
      const peak = Math.max(p.ovr, ...p.recentHist.map((h) => h.ovr));
      return apps > 0
        && (peak >= RETIREE_ARCHIVE_MIN_PEAK_OVR || apps >= RETIREE_ARCHIVE_MIN_APPEARANCES);
    });

    // Set equality, deliberately not a count over zero. After a single season
    // only a handful of players have both a senior appearance and a peak at the
    // ovr bar — on this world exactly one of 330 retirees qualifies — so a
    // `toBeGreaterThan(0)` here is really an assertion about one player, and it
    // failed on CI while passing locally for reasons that had nothing to do
    // with the archive. Set equality is both robust to that and strictly
    // stronger: it catches a retiree wrongly kept as well as one wrongly
    // dropped. Whether the gate admits anyone at all is pinned deterministically
    // against hand-built players in test/core/archive.test.ts.
    const byPid = (a: number, b: number) => a - b;
    expect(next.retiredPlayers.map((a) => a.pid).sort(byPid))
      .toEqual(expected.map((p) => p.pid).sort(byPid));

    expect(next.retiredPlayers.length).toBeLessThanOrEqual(RETIREE_ARCHIVE_LIMIT);

    for (const a of next.retiredPlayers) {
      // Really retired, and the snapshot carries what can no longer be looked up.
      expect(survivors.has(a.pid)).toBe(false);
      expect(a.name).not.toBe("");
      // The gate is the save-size guarantee: nobody without a real career, and
      // nobody below both bars, may take up a permanent row.
      expect(a.totals.appearances).toBeGreaterThan(0);
      expect(
        a.peakOvr >= RETIREE_ARCHIVE_MIN_PEAK_OVR
        || a.totals.appearances >= RETIREE_ARCHIVE_MIN_APPEARANCES,
      ).toBe(true);
      // Peak is read off the ratings history, so it can't be the post-decline
      // value retirement leaves behind.
      expect(a.peakOvr).toBeGreaterThanOrEqual(a.finalOvr);
      expect(before.has(a.pid)).toBe(true);
    }
  });

  it("carries the archive forward across offseasons instead of replacing it", () => {
    const rng = mulberry32(12);
    let league = playFullSeason(rng);
    league = simOffseason(league, rng);

    // A synthetic legend stands in for "whatever the archive already held".
    // Without him this test would rest on however many players happened to
    // retire worth keeping in one offseason, which on some worlds is one and on
    // others none — and a carry-forward assertion over an empty archive proves
    // nothing. His peak keeps him clear of the cap's career-score pruning.
    const sentinel: ArchivedPlayer = {
      pid: -999,
      name: "Sentinel Legend",
      nationality: "EN",
      pos: "ST",
      born: 1,
      heightCm: 180,
      retiredSeason: 1,
      retiredAge: 35,
      firstSeason: 1,
      seasonsPlayed: 15,
      peakOvr: 95,
      peakSeason: 1,
      finalOvr: 70,
      clubs: [0],
      seasons: [],
      totals: emptyTotals(),
      best: emptyBestSeasons(),
      caps: 0,
      intlGoals: 0,
      intlTitles: 0,
    };
    league = { ...league, retiredPlayers: [...league.retiredPlayers, sentinel] };
    const first = league.retiredPlayers.map((a) => a.pid);

    league = simThrough(league, "season", rng);
    league = simOffseason(league, rng);

    // Nothing from the first intake may be dropped while the cap is nowhere
    // near reached — a save must not quietly forget last decade's legends.
    const now = new Set(league.retiredPlayers.map((a) => a.pid));
    for (const pid of first) expect(now.has(pid)).toBe(true);
    expect(now.has(sentinel.pid)).toBe(true);
    expect(league.retiredPlayers.length).toBeGreaterThanOrEqual(first.length);
  });

  it("names a retiring player's last club rather than filing him as a free agent", () => {
    const rng = mulberry32(11);
    const league = playFullSeason(rng);
    const next = simOffseason(league, rng);

    const retirements = next.seasonHistory.at(-1)!.retirements!;
    // The notable list is ranked by ovr, and the best players in the world are
    // on somebody's books, so at least one named retiree must have a club.
    const withClub = retirements.notable.filter((r) => r.tid !== null);
    expect(withClub.length).toBeGreaterThan(0);
    const tids = new Set(next.teams.map((t) => t.tid));
    for (const r of withClub) expect(tids.has(r.tid!)).toBe(true);
  });
});
