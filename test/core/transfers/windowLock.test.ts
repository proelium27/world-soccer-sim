import { describe, it, expect } from "vitest";
import { makeLeague } from "../../helpers/league.js";
import {
  movedThisWindow, makeTransferOffer, acceptCounterOffer, isForSale,
  reservationPrice, FREE_AGENT_TID, type CompletedTransfer,
} from "../../../src/core/transfers/negotiation.js";
import {
  inboundOfferCandidates, acceptInboundOffer, counterInboundOffer, inboundCeiling,
} from "../../../src/core/transfers/inboundOffers.js";
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

/**
 * A refused action must leave the league alone. Asserted as "no transfer was
 * logged and the pid did not move" rather than `expect(result).toBe(league)`,
 * because on failure vitest tries to DIFF the two objects — and diffing two
 * 626-club leagues blows up its IPC with "RangeError: Invalid array length",
 * so the run reports an unhandled error instead of the assertion that failed.
 * Small observable facts fail readably.
 */
function assertNoOp(before: LeagueStore, after: LeagueStore, pid: number): void {
  expect(after.transfers.length).toBe(before.transfers.length);
  const holder = (l: LeagueStore) => l.teams.find((t) => t.roster.includes(pid))?.tid ?? null;
  expect(holder(after)).toBe(holder(before));
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
    assertNoOp(settled, makeTransferOffer(settled, pid, price), pid);
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
    assertNoOp(settled, acceptCounterOffer(settled, pid), pid);
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

describe("a persisted inbound offer is re-checked when it is acted on", () => {
  // Every sale condition otherwise lives in `inboundOfferCandidates`, and a
  // stored offer skips that builder — `resolveOpenOffer` returns the row first.
  // So an offer opened in one state and accepted in another was checked against
  // nothing at all.
  function openOfferOn(league: LeagueStore): { league: LeagueStore; pid: number } {
    const candidate = inboundOfferCandidates(league)[0];
    const ws = transferWindowState(league);
    // Ask just above what the buyer will actually pay, so he counters rather
    // than accepting (which would execute the sale and leave nothing stored).
    // Read from `inboundCeiling` because that is the number the function itself
    // uses — the candidate's own ceiling carries opening-offer jitter and is not
    // the same figure.
    const ceiling = inboundCeiling(league, candidate.player.pid)!;
    const withOffer = counterInboundOffer(
      league, candidate.player.pid, Math.round(ceiling * 1.05),
    );
    const stored = withOffer.inboundOffers.find(
      (o) => o.pid === candidate.player.pid && o.season === ws.season && o.window === ws.window,
    );
    expect(stored?.status).toBe("open");
    return { league: withOffer, pid: candidate.player.pid };
  }

  it("won't sell a player who has gone out on loan since the offer opened", () => {
    // The one with teeth: he sits on the LOANEE's roster, and executeTransfer
    // removes a pid only from the seller's. Accepting would put one pid on two
    // rosters with a live loan pointing at a third club.
    const { league, pid } = openOfferOn(windowLeague());
    const user = league.teams.find((t) => t.tid === 0)!;
    const loanee = league.teams.find((t) => t.tid !== 0)!;
    const onLoan: LeagueStore = {
      ...league,
      teams: league.teams.map((t) =>
        t.tid === user.tid ? { ...t, roster: t.roster.filter((p) => p !== pid) }
        : t.tid === loanee.tid ? { ...t, roster: [...t.roster, pid] }
        : t,
      ),
      activeLoans: [
        ...league.activeLoans,
        {
          pid, parentTid: user.tid, loaneeTid: loanee.tid,
          startSeason: league.season, seasons: 1, returnSeason: league.season + 1, fee: 0,
        },
      ],
    };
    assertNoOp(onLoan, acceptInboundOffer(onLoan, pid), pid);
    assertNoOp(onLoan, counterInboundOffer(onLoan, pid, 1), pid);
  });

  it("won't sell a player who has already moved this window", () => {
    const { league, pid } = openOfferOn(windowLeague());
    const settled: LeagueStore = {
      ...league,
      transfers: [...league.transfers, moveRecord(league, pid, 99, 0)],
    };
    assertNoOp(settled, acceptInboundOffer(settled, pid), pid);
    // Control: without the record the same offer is accepted and he leaves.
    const sold = acceptInboundOffer(league, pid);
    expect(sold.teams.find((t) => t.tid === 0)!.roster).not.toContain(pid);
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
