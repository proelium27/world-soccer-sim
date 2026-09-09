import { describe, it, expect } from "vitest";
import { makeLeague } from "../../helpers/league.js";
import {
  movedThisWindow, makeTransferOffer, acceptCounterOffer, isForSale,
  reservationPrice, FREE_AGENT_TID, type CompletedTransfer,
} from "../../../src/core/transfers/negotiation.js";
import { inboundOfferCandidates } from "../../../src/core/transfers/inboundOffers.js";
import { saleGateFor } from "../../../src/core/transfers/recommendations.js";
import { runAITransferMarket } from "../../../src/core/ai/transferMarket.js";
import { transferWindowState } from "../../../src/core/transfers/window.js";
import { type LeagueStore } from "../../../src/core/leagueState.js";
import { difficultyProfile } from "../../../src/core/constants.js";

/**
 * A player moves at most once per transfer window (movedThisWindow).
 *
 * The gate spans four independent paths — the AI market, the user's two buy
 * entry points, and the user's sell side — because the window is wider than
 * any one of them: `enforceDivisionCeilings` moves players either side of the
 * market inside `simOffseason`, and the user then trades through matchday 4 of
 * the same summer window. Anything the rule misses shows up as a player
 * changing clubs twice in one window, which is what
 * `scripts/windowDoubleMoveProbe.ts` counts.
 */

/** A league sitting in the winter window with a rich user club (tid 0). */
function windowLeague(seed = 1): LeagueStore {
  const league = makeLeague(0, seed);
  return {
    ...league,
    schedule: league.schedule.filter((g) => g.matchday >= 20),
    teams: league.teams.map((t) => (t.tid === 0 ? { ...t, budget: 500_000_000 } : t)),
  };
}

/** Some other club's player the user could legitimately bid for. */
function firstTarget(league: LeagueStore): { pid: number; sellerTid: number } {
  const seller = league.teams[1];
  const playerMap = new Map(league.players.map((p) => [p.pid, p]));
  const pid = seller.roster.find((q) => isForSale(seller, playerMap, q))!;
  return { pid, sellerTid: seller.tid };
}

/** A completed club-to-club move for `pid`, stamped with the open window. */
function moveRecord(league: LeagueStore, pid: number, fromTid: number, toTid: number): CompletedTransfer {
  const ws = transferWindowState(league);
  return { pid, fromTid, toTid, fee: 1_000_000, season: ws.season!, window: ws.window! };
}

describe("movedThisWindow", () => {
  const base = { pid: 5, fromTid: 1, toTid: 2, fee: 1, season: 3 } as const;

  it("counts a permanent club-to-club move in the window asked about", () => {
    const moved = movedThisWindow([{ ...base, window: "summer" }], 3, "summer");
    expect([...moved]).toEqual([5]);
  });

  it("ignores other seasons and the other window", () => {
    const rows: CompletedTransfer[] = [
      { ...base, window: "winter" },
      { ...base, season: 2, window: "summer" },
      { ...base, season: 4, window: "summer" },
    ];
    expect(movedThisWindow(rows, 3, "summer").size).toBe(0);
  });

  it("ignores loans and loan returns — a loan moves who he plays for, not who owns him", () => {
    const rows: CompletedTransfer[] = [
      { ...base, window: "summer", loanSeasons: 1 },
      { ...base, window: "summer", fee: 0, loanReturn: true },
    ];
    expect(movedThisWindow(rows, 3, "summer").size).toBe(0);
  });

  it("ignores free-agent arrivals, which carry their own longer hold", () => {
    // faTransferLocked already holds a free signing for a full season, and
    // free-agent *departures* are never logged at all, so counting the
    // sentinel would lock half a story.
    const rows: CompletedTransfer[] = [
      { ...base, window: "summer", fromTid: FREE_AGENT_TID, fee: 0 },
      { ...base, window: "summer", toTid: FREE_AGENT_TID, fee: 0 },
    ];
    expect(movedThisWindow(rows, 3, "summer").size).toBe(0);
  });
});

describe("the user cannot buy a player who has already moved this window", () => {
  it("makeTransferOffer is a no-op for him, and buys him without the record", () => {
    const league = windowLeague();
    const { pid, sellerTid } = firstTarget(league);
    const ws = transferWindowState(league);
    const player = league.players.find((p) => p.pid === pid)!;
    const price = reservationPrice(
      league.lid, ws.season!, ws.window!, player,
      difficultyProfile(league.difficulty).buyPriceScale,
    );

    // Control: the same offer succeeds when he has not moved.
    const bought = makeTransferOffer(league, pid, price);
    expect(bought.teams.find((t) => t.tid === 0)!.roster).toContain(pid);

    // With a move already logged this window, the identical offer does nothing.
    const settled: LeagueStore = {
      ...league,
      transfers: [...league.transfers, moveRecord(league, pid, 99, sellerTid)],
    };
    expect(makeTransferOffer(settled, pid, price)).toBe(settled);
  });

  it("acceptCounterOffer re-checks it, so a move made since the counter still blocks", () => {
    const league = windowLeague();
    const { pid, sellerTid } = firstTarget(league);
    const ws = transferWindowState(league);
    const player = league.players.find((p) => p.pid === pid)!;
    const price = reservationPrice(
      league.lid, ws.season!, ws.window!, player,
      difficultyProfile(league.difficulty).buyPriceScale,
    );

    // Open talks with a lowball that draws a counter rather than an acceptance.
    const talking = makeTransferOffer(league, pid, Math.round(price * 0.85));
    const negotiation = talking.negotiations.find((n) => n.pid === pid);
    expect(negotiation?.counter).toBeGreaterThan(0);

    const settled: LeagueStore = {
      ...talking,
      transfers: [...talking.transfers, moveRecord(talking, pid, 99, sellerTid)],
    };
    expect(acceptCounterOffer(settled, pid)).toBe(settled);
    // Control: without the record the same counter is accepted.
    expect(acceptCounterOffer(talking, pid).teams.find((t) => t.tid === 0)!.roster).toContain(pid);
  });

  it("the search says why rather than silently refusing the offer", () => {
    const league = windowLeague();
    const { pid, sellerTid } = firstTarget(league);
    const user = league.teams.find((t) => t.tid === 0)!;
    const player = league.players.find((p) => p.pid === pid)!;
    const seller = league.teams.find((t) => t.tid === sellerTid)!;
    const playerMap = new Map(league.players.map((p) => [p.pid, p]));

    expect(saleGateFor(league, user, playerMap)(player, seller)).toBeNull();

    const settled: LeagueStore = {
      ...league,
      transfers: [...league.transfers, moveRecord(league, pid, 99, sellerTid)],
    };
    expect(saleGateFor(settled, user, playerMap)(player, seller))
      .toBe("Just moved clubs this window");
  });
});

describe("the user cannot sell a player he has just bought", () => {
  it("no club bids for a player who arrived this window", () => {
    const league = windowLeague();
    const user = league.teams.find((t) => t.tid === 0)!;
    const before = inboundOfferCandidates(league);
    expect(before.length).toBeGreaterThan(0);

    // Stamp every one of them as having arrived this window. This is the flip
    // the rule exists to stop: buy at a crushed reservation, sell on at the
    // new club's own price, inside one window.
    const arrivals = before.map((c) => moveRecord(league, c.player.pid, 99, user.tid));
    const settled: LeagueStore = { ...league, transfers: [...league.transfers, ...arrivals] };

    const offeredPids = new Set(inboundOfferCandidates(settled).map((c) => c.player.pid));
    for (const c of before) expect(offeredPids.has(c.player.pid)).toBe(false);
  });
});

describe("the AI market seeds its per-window moved set from the log", () => {
  // A market pass prices every one of the 626 clubs' players against every
  // other club and is the most expensive call in this file at ~24s, so the
  // unseeded run is shared rather than paid for twice. Lazy rather than a
  // beforeAll so running one case by name still pays for one pass. Same
  // reasoning as the memo in test/core/ai/transferMarket.test.ts.
  function marketOn(league: LeagueStore, season: number, transfers: CompletedTransfer[]) {
    return runAITransferMarket(
      league.teams, league.players, league.activeLoans, transfers,
      season, league.played, "summer", "offseason", 0, 12345,
      league.competitions, new Set(),
    );
  }
  let cached: {
    league: LeagueStore;
    season: number;
    open: ReturnType<typeof runAITransferMarket>;
  } | null = null;
  function openRun() {
    if (!cached) {
      const league = makeLeague(0, 7);
      const season = league.season + 1;
      cached = { league, season, open: marketOn(league, season, league.transfers) };
    }
    return cached;
  }

  it("never moves a player another mechanism already moved this window", () => {
    // The market's own `moved` set only spans one run, and the run is not the
    // whole window — `enforceDivisionCeilings` moves players immediately
    // before and after it. Seeding is what closes that gap.
    const { league, season, open } = openRun();
    const movers = open.transfers.slice(league.transfers.length).map((t) => t.pid);
    expect(movers.length).toBeGreaterThan(0);

    // Re-run with the first ten of those already logged for this window.
    const already = movers.slice(0, 10);
    const seeded = marketOn(league, season, [
      ...league.transfers,
      ...already.map((pid) => ({
        pid, fromTid: 500, toTid: 501, fee: 1, season, window: "summer" as const,
      })),
    ]);
    const executed = new Set(
      seeded.transfers.slice(league.transfers.length + already.length).map((t) => t.pid),
    );
    for (const pid of already) expect(executed.has(pid)).toBe(false);
    // Non-vacuous: the market still trades briskly around them.
    expect(executed.size).toBeGreaterThan(0);
  });

  it("does not move a player twice within a single run either", () => {
    const { league, open } = openRun();
    const executed = open.transfers.slice(league.transfers.length).map((t) => t.pid);
    expect(new Set(executed).size).toBe(executed.length);
  });
});
