import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import {
  searchLoanTargets, requestLoan, loansTakenThisWindow, loanGateFor, borrowedPids,
} from "../../src/core/loanSearch.js";
import { computeLoanFee, processLoanReturns } from "../../src/core/loans.js";
import { releasePlayer } from "../../src/core/freeAgency.js";
import { setTransferListed, inboundOfferCandidates } from "../../src/core/transfers/inboundOffers.js";
import { renewalsDue } from "../../src/core/contractRenewal.js";
import { resolveXI } from "../../src/core/lineup/resolveXI.js";
import { teamSlots } from "../../src/core/lineup/formations.js";
import { acquisitionWageCharge } from "../../src/core/transfers/negotiation.js";
import {
  LOAN_AI_MAX_AGE, LOAN_FEE_MIN, LOAN_IN_MAX_PER_WINDOW, ROSTER_CAP,
} from "../../src/core/constants.js";
import {
  SUMMER_WINDOW_CLOSE_MATCHDAY, WINTER_WINDOW_OPEN_MATCHDAY,
} from "../../src/core/calendar.js";

/** Right after generation the summer window is open (matchdays 1-4). */
function windowLeague(seed = 1): LeagueStore {
  return makeLeague(0, seed);
}

/** The first row a request would actually go through on. */
function firstAvailable(league: LeagueStore, seasons: 1 | 2 | 3 = 1) {
  const target = searchLoanTargets(league, seasons, { availableOnly: true })[0];
  expect(target, "no borrowable player in a fresh world").toBeDefined();
  return target;
}

describe("searchLoanTargets", () => {
  it("only offers young players who aren't in their club's starting eleven", () => {
    const league = windowLeague();
    const targets = searchLoanTargets(league);
    expect(targets.length).toBeGreaterThan(0);

    const playerMap = new Map(league.players.map((p) => [p.pid, p]));
    for (const t of targets) {
      expect(league.season - t.player.born).toBeLessThanOrEqual(LOAN_AI_MAX_AGE);
      expect(t.parentTid).not.toBe(league.meta.userTid);

      const parent = league.teams.find((tm) => tm.tid === t.parentTid)!;
      const squad = parent.roster.map((pid) => playerMap.get(pid)!);
      const xi = resolveXI(squad, teamSlots(parent), parent.starters).map((p) => p.pid);
      expect(xi).not.toContain(t.player.pid);
    }
  });

  it("is empty with no window open", () => {
    const league = windowLeague();
    // September: the summer window has shut and winter hasn't opened. The
    // window is read off the next unplayed matchday, so dropping the early
    // ones is what closes it.
    const shut: LeagueStore = {
      ...league,
      schedule: league.schedule.filter(
        (g) => g.matchday > SUMMER_WINDOW_CLOSE_MATCHDAY
          && g.matchday < WINTER_WINDOW_OPEN_MATCHDAY,
      ),
    };
    expect(searchLoanTargets(shut)).toEqual([]);
    // ...and the action refuses too, not just the list.
    const target = firstAvailable(league);
    expect(requestLoan(shut, target.player.pid, 1)).toBe(shut);
  });

  it("narrows to the filters it is given", () => {
    const league = windowLeague();
    const byPosition = searchLoanTargets(league, 1, { position: "GK" });
    expect(byPosition.length).toBeGreaterThan(0);
    for (const t of byPosition) expect(t.player.pos).toBe("GK");

    const named = searchLoanTargets(league, 1, { name: byPosition[0].player.name });
    expect(named.some((t) => t.player.pid === byPosition[0].player.pid)).toBe(true);
  });

  it("prices a longer loan higher, at the length the panel asked about", () => {
    const league = windowLeague();
    const one = searchLoanTargets(league, 1);
    const three = searchLoanTargets(league, 3);
    const shared = one.find((a) => three.some((b) => b.player.pid === a.player.pid))!;
    const longer = three.find((b) => b.player.pid === shared.player.pid)!;
    expect(longer.fee).toBeGreaterThan(shared.fee);
  });

  it("agrees with requestLoan on every row it shows", () => {
    // The gate the search renders and the gate the action enforces are the same
    // function on purpose: a button that promises a loan the action then
    // silently refuses is the failure this shape exists to prevent.
    const league = windowLeague();
    for (const t of searchLoanTargets(league).slice(0, 12)) {
      const after = requestLoan(league, t.player.pid, 1);
      expect(after !== league, `row for ${t.player.name} disagreed with the action`)
        .toBe(t.available);
    }
  });
});

describe("requestLoan", () => {
  it("brings the player in, pays his club the fee, and books the return", () => {
    const league = windowLeague();
    const target = firstAvailable(league);
    const fee = computeLoanFee(target.player, league.season, 2);
    const userBefore = league.teams.find((t) => t.tid === league.meta.userTid)!;
    const parentBefore = league.teams.find((t) => t.tid === target.parentTid)!;

    const after = requestLoan(league, target.player.pid, 2);
    expect(after).not.toBe(league);

    const user = after.teams.find((t) => t.tid === league.meta.userTid)!;
    const parent = after.teams.find((t) => t.tid === target.parentTid)!;
    expect(user.roster).toContain(target.player.pid);
    expect(parent.roster).not.toContain(target.player.pid);
    // Mid-season the borrower also picks up his wages on the spot, the same
    // charge a permanent signing pays (acquisitionWageCharge).
    expect(user.budget).toBe(userBefore.budget - fee - acquisitionWageCharge(league, target.player));
    expect(parent.budget).toBeGreaterThan(parentBefore.budget);

    const loan = after.activeLoans.find((l) => l.pid === target.player.pid)!;
    expect(loan.parentTid).toBe(target.parentTid);
    expect(loan.loaneeTid).toBe(league.meta.userTid);
    expect(loan.returnSeason).toBe(league.season + 2);

    const record = after.transfers.at(-1)!;
    expect(record).toMatchObject({
      pid: target.player.pid, toTid: league.meta.userTid, loanSeasons: 2,
    });
  });

  it("hands him back to his parent club when the loan runs out", () => {
    const league = windowLeague();
    const target = firstAvailable(league);
    const after = requestLoan(league, target.player.pid, 1);

    const returned = processLoanReturns(
      after.teams, after.activeLoans, after.transfers, league.season + 1,
    );
    expect(returned.teams.find((t) => t.tid === target.parentTid)!.roster)
      .toContain(target.player.pid);
    expect(returned.teams.find((t) => t.tid === league.meta.userTid)!.roster)
      .not.toContain(target.player.pid);
    expect(returned.activeLoans).toHaveLength(0);
  });

  it("stops at the per-window cap", () => {
    let league = windowLeague();
    for (let i = 0; i < LOAN_IN_MAX_PER_WINDOW; i++) {
      const target = firstAvailable(league);
      const next = requestLoan(league, target.player.pid, 1);
      expect(next).not.toBe(league);
      league = next;
    }
    expect(loansTakenThisWindow(league)).toBe(LOAN_IN_MAX_PER_WINDOW);

    // Not merely "no rows left": every remaining row says why, and the action
    // agrees with them.
    const remaining = searchLoanTargets(league);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every((t) => !t.available)).toBe(true);
    expect(requestLoan(league, remaining[0].player.pid, 1)).toBe(league);
  });

  it("refuses a loan longer than the player's contract", () => {
    const league = windowLeague();
    const target = searchLoanTargets(league).find((t) => t.maxSeasons < 3);
    if (!target) return; // Nobody in this world is that close to expiry.
    expect(requestLoan(league, target.player.pid, 3)).toBe(league);
  });

  it("refuses a player who is already out on loan somewhere else", () => {
    const league = windowLeague();
    const target = firstAvailable(league);
    const taken = requestLoan(league, target.player.pid, 1);
    // A second club (here, the user again) can't borrow the same player.
    expect(requestLoan(taken, target.player.pid, 1)).toBe(taken);
  });
});

describe("a borrowed player is not the borrowing club's to dispose of", () => {
  function withBorrowedPlayer(): { league: LeagueStore; pid: number; userTid: number } {
    const base = windowLeague();
    const target = firstAvailable(base);
    return {
      league: requestLoan(base, target.player.pid, 2),
      pid: target.player.pid,
      userTid: base.meta.userTid,
    };
  }

  it("can't be released", () => {
    const { league, pid, userTid } = withBorrowedPlayer();
    const teams = releasePlayer(league.teams, league.players, userTid, pid, league.activeLoans);
    expect(teams).toBe(league.teams);
  });

  it("can't be listed for transfer", () => {
    const { league, pid } = withBorrowedPlayer();
    expect(setTransferListed(league, pid, true)).toBe(league);
  });

  it("draws no offers from other clubs", () => {
    const { league, pid } = withBorrowedPlayer();
    expect(inboundOfferCandidates(league).some((c) => c.player.pid === pid)).toBe(false);
  });

  it("is left out of the senior squad's contract renewals", () => {
    const { league, pid, userTid } = withBorrowedPlayer();
    // Force his deal into its final year so he would qualify if he were ours.
    const expiring: LeagueStore = {
      ...league,
      players: league.players.map((p) =>
        p.pid === pid
          ? { ...p, contract: { ...p.contract, expiresSeason: league.season } }
          : p),
    };
    const due = renewalsDue(expiring, "senior");
    expect(due.pids).not.toContain(pid);
    expect(due.refusingPids).not.toContain(pid);
    expect(borrowedPids(expiring, userTid).has(pid)).toBe(true);
  });
});

describe("what a loan costs the user", () => {
  const DIFFICULTIES = ["easy", "normal", "hard", "brutal"] as const;
  const atDifficulty = (d: LeagueStore["difficulty"]): LeagueStore =>
    ({ ...windowLeague(), difficulty: d });

  it("is never free, on any difficulty", () => {
    // trueTransferValue is exactly 0 at or below VALUATION_OVR_FLOOR (45) —
    // every multiplier in it sits on a zero base — and that is 55% of the
    // world, so without LOAN_FEE_MIN most of the loan market is free and the
    // fee column reads "$0". Reported by a player, 2026-09-07.
    for (const d of DIFFICULTIES) {
      const rows = searchLoanTargets(atDifficulty(d), 1, { availableOnly: true });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.fee).toBeGreaterThan(0);
    }
  });

  it("rises with difficulty, so borrowing can't dodge the price lever", () => {
    // A loan was the one acquisition route buyPriceScale never reached.
    const feeFor = (d: LeagueStore["difficulty"], pid: number) =>
      searchLoanTargets(atDifficulty(d), 1).find((t) => t.player.pid === pid)!.fee;
    // Someone whose fee is above the floor, or every level reads identically.
    const pricey = searchLoanTargets(atDifficulty("normal"), 1)
      .find((t) => t.fee > LOAN_FEE_MIN * 4)!;
    expect(pricey).toBeDefined();

    const fees = DIFFICULTIES.map((d) => feeFor(d, pricey.player.pid));
    expect(fees[0]).toBeLessThan(fees[1]);   // easy  < normal
    expect(fees[1]).toBeLessThan(fees[2]);   // normal < hard
    expect(fees[2]).toBeLessThan(fees[3]);   // hard  < brutal
  });

  it("charges exactly what the row quoted, and pays it to his club", () => {
    for (const d of DIFFICULTIES) {
      const league = atDifficulty(d);
      const row = searchLoanTargets(league, 1, { availableOnly: true })[0];
      const after = requestLoan(league, row.player.pid, 1);
      const parentBefore = league.teams.find((t) => t.tid === row.parentTid)!.budget;
      const parentAfter = after.teams.find((t) => t.tid === row.parentTid)!.budget;
      expect(parentAfter - parentBefore).toBe(row.fee);
    }
  });
});

describe("a refusal names something the user can act on", () => {
  // The list is ranked by overall and its top rows are refused on price, so a
  // user-state reason checked last would never surface: a full squad used to
  // read as forty clubs rating their players too highly.
  it("says the squad is full rather than blaming the selling clubs", () => {
    const base = windowLeague();
    const tid = base.meta.userTid;
    const donor = base.teams.find((t) => t.tid !== tid)!;
    const full: LeagueStore = {
      ...base,
      teams: base.teams.map((t) => (t.tid === tid
        ? { ...t, roster: [...t.roster, ...donor.roster].slice(0, ROSTER_CAP + 5) }
        : t)),
    };
    const rows = searchLoanTargets(full, 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.unavailableReason === "Your squad is full")).toBe(true);
  });

  it("says the window cap is spent rather than blaming the selling clubs", () => {
    let league = windowLeague();
    for (let i = 0; i < LOAN_IN_MAX_PER_WINDOW; i++) {
      league = requestLoan(league, firstAvailable(league).player.pid, 1);
    }
    const rows = searchLoanTargets(league, 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /agreed \d+ loans this window/.test(r.unavailableReason ?? ""))).toBe(true);
  });
});

describe("who a loan is worth something to", () => {
  it("gets better the further down the pyramid the borrowing club is", () => {
    // The one behavioural property worth pinning, and it isn't tuned — it falls
    // out of buy-side vs keep-side valuation. A club asks "how much would he
    // improve us"; a top-flight side is improved by almost nobody a rival would
    // lend, while a lower-division side is improved by a lot of them. Measured
    // on a fresh world, best borrowable overall: tier 1 ~60, tier 2 and tier 3
    // in the mid-70s. If this ever inverts, the loan market has stopped being a
    // route for small clubs and become a way for big ones to stockpile.
    const base = windowLeague();
    const bestFor = (tid: number) => {
      const league: LeagueStore = { ...base, meta: { ...base.meta, userTid: tid } };
      const rows = searchLoanTargets(league, 1, { availableOnly: true });
      return rows.length === 0 ? 0 : Math.max(...rows.map((t) => t.player.ovr));
    };

    const byTier = new Map<number, number>();
    for (const team of base.teams) {
      const tier = base.competitions.find((c) => c.id === team.compId)!.tier;
      if (!byTier.has(tier)) byTier.set(tier, team.tid);
    }
    const topFlight = bestFor(byTier.get(1)!);
    const second = bestFor(byTier.get(2)!);
    expect(second).toBeGreaterThan(topFlight);
  });
});

describe("loanGateFor", () => {
  it("explains a refusal rather than just saying no", () => {
    const league = windowLeague();
    const user = league.teams.find((t) => t.tid === league.meta.userTid)!;
    const gate = loanGateFor(league, user, league.season)!;
    const refused = searchLoanTargets(league).find((t) => !t.available);
    if (!refused) return; // Everyone in this world happens to be available.
    const parent = league.teams.find((t) => t.tid === refused.parentTid)!;
    const reason = gate(refused.player, parent, 1);
    expect(reason).toBeTruthy();
    expect(reason).toBe(refused.unavailableReason);
  });
});
