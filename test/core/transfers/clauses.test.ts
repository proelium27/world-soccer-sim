import { describe, it, expect } from "vitest";
import { makeLeague } from "../../helpers/league.js";
import type { LeagueStore } from "../../../src/core/leagueState.js";
import type { TransferClause, ProposedClause } from "../../../src/core/transfers/clauses.js";
import {
  settleClausesOnSale, expireClauses, scrubClausesForPids, clausesAreValid,
  materializeClauses, projectedValue, clauseExpectedValue, bonusTriggered,
  triggerProbability, settleBonuses, payoutDeltas, suggestedBonuses,
} from "../../../src/core/transfers/clauses.js";
import {
  executeTransfer, makeTransferOffer, reservationPrice,
} from "../../../src/core/transfers/negotiation.js";
import {
  inboundOfferCandidates, acceptInboundOffer, buyerAcceptsClauses,
} from "../../../src/core/transfers/inboundOffers.js";
import { transferWindowState } from "../../../src/core/transfers/window.js";
import {
  detachArchive, reattachArchive, detachNews, reattachNews,
  detachTransfers, reattachTransfers, detachPlayed, reattachPlayed,
} from "../../../src/core/simArchive.js";
import {
  SELL_ON_MAX_SHARE, BONUS_MAX_TOTAL_FRACTION,
  BONUS_APPEARANCE_THRESHOLD, BONUS_GOAL_THRESHOLD, BONUS_SUGGESTION_MIN_GOALS,
} from "../../../src/core/constants.js";

const sellOn = (over: Partial<TransferClause> = {}): TransferClause => ({
  kind: "sellOn", pid: 1, beneficiaryTid: 10, obligorTid: 20,
  season: 1, expires: 6, baseFee: 1_000_000, share: 0.2, ...over,
} as TransferClause);

const bonus = (over: Partial<TransferClause> = {}): TransferClause => ({
  kind: "bonus", pid: 1, beneficiaryTid: 10, obligorTid: 20,
  season: 1, expires: 4, trigger: "appearances", amount: 500_000, ...over,
} as TransferClause);

describe("settleClausesOnSale", () => {
  it("pays a share of the PROFIT over what the obligor paid", () => {
    const { payouts, remaining } = settleClausesOnSale(
      [sellOn({ baseFee: 1_000_000, share: 0.25 })], 1, 20, 5_000_000, 3,
    );
    // 25% of the 4M profit, not of the 5M fee.
    expect(payouts).toEqual([
      { fromTid: 20, toTid: 10, amount: 1_000_000, pid: 1, reason: "sellOn" },
    ]);
    expect(remaining).toEqual([]);
  });

  it("pays nothing when the obligor sells at a loss, and still ends the clause", () => {
    const { payouts, remaining } = settleClausesOnSale(
      [sellOn({ baseFee: 5_000_000 })], 1, 20, 2_000_000, 3,
    );
    expect(payouts).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it("ignores a sale by anyone other than the club that owes it", () => {
    const clauses = [sellOn()];
    const { payouts, remaining } = settleClausesOnSale(clauses, 1, 99, 9_000_000, 3);
    expect(payouts).toEqual([]);
    expect(remaining).toEqual(clauses);
  });

  it("ignores a sale of a different player", () => {
    const clauses = [sellOn({ pid: 7 })];
    const { payouts, remaining } = settleClausesOnSale(clauses, 1, 20, 9_000_000, 3);
    expect(payouts).toEqual([]);
    expect(remaining).toEqual(clauses);
  });

  it("does not pay a sell-on whose expiry has passed, but does clear it", () => {
    const { payouts, remaining } = settleClausesOnSale(
      [sellOn({ expires: 2 })], 1, 20, 9_000_000, 5,
    );
    expect(payouts).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it("kills a bonus unpaid when the player is sold on — the bet was about that club", () => {
    const { payouts, remaining } = settleClausesOnSale([bonus()], 1, 20, 9_000_000, 3);
    expect(payouts).toEqual([]);
    expect(remaining).toEqual([]);
  });
});

describe("executeTransfer with clauses", () => {
  /** A resale by the club that owes a sell-on, with a distinct third-party beneficiary. */
  function resaleLeague(): { league: LeagueStore; pid: number; from: number; to: number; ben: number } {
    const base = makeLeague(0, 1);
    // Three distinct AI clubs so no tid plays two roles.
    const ben = base.teams[5].tid;
    const from = base.teams[6].tid;
    const to = base.teams[7].tid;
    const pid = base.teams[6].roster[0];
    const league: LeagueStore = {
      ...base,
      transferClauses: [sellOn({ pid, beneficiaryTid: ben, obligorTid: from, baseFee: 1_000_000, share: 0.25 })],
    };
    return { league, pid, from, to, ben };
  }

  it("conserves money across all three clubs", () => {
    const { league, pid, from, to } = resaleLeague();
    const before = league.teams.reduce((s, t) => s + t.budget, 0);
    const out = executeTransfer(league, pid, from, to, 5_000_000, 0, league.season, "summer");
    const after = out.teams.reduce((s, t) => s + t.budget, 0);
    // Nothing is created or destroyed. (Budgets here sit well under budgetCap,
    // so clampBudget is inert — see the cap note in clauses.ts.)
    expect(after).toBeCloseTo(before, 6);
  });

  it("routes the sell-on to the beneficiary and the rest to the seller", () => {
    const { league, pid, from, to, ben } = resaleLeague();
    const b = (l: LeagueStore, tid: number) => l.teams.find((t) => t.tid === tid)!.budget;
    const out = executeTransfer(league, pid, from, to, 5_000_000, 0, league.season, "summer");
    // 25% of the 4M profit.
    expect(b(out, ben) - b(league, ben)).toBe(1_000_000);
    expect(b(out, from) - b(league, from)).toBe(4_000_000);
    expect(b(out, to) - b(league, to)).toBe(-5_000_000);
  });

  it("clears the clause once it has paid", () => {
    const { league, pid, from, to } = resaleLeague();
    const out = executeTransfer(league, pid, from, to, 5_000_000, 0, league.season, "summer");
    expect(out.transferClauses).toEqual([]);
  });

  it("attaches new clauses with the seller owed and the buyer owing", () => {
    const base = makeLeague(0, 1);
    const from = base.teams[6].tid;
    const to = base.teams[7].tid;
    const pid = base.teams[6].roster[0];
    const out = executeTransfer(
      base, pid, from, to, 4_000_000, 0, base.season, "summer",
      [{ kind: "sellOn", share: 0.3 }],
    );
    expect(out.transferClauses).toHaveLength(1);
    const c = out.transferClauses[0];
    expect(c.kind).toBe("sellOn");
    expect(c.beneficiaryTid).toBe(from);
    expect(c.obligorTid).toBe(to);
    // Profit is measured over what the buyer actually paid.
    if (c.kind === "sellOn") expect(c.baseFee).toBe(4_000_000);
  });

  it("handles a club that is both buyer and beneficiary (a buy-back)", () => {
    const base = makeLeague(0, 1);
    const from = base.teams[6].tid;
    const to = base.teams[7].tid;
    const pid = base.teams[6].roster[0];
    // `to` sold him to `from` earlier with a sell-on, and is now buying him back.
    const league: LeagueStore = {
      ...base,
      transferClauses: [sellOn({ pid, beneficiaryTid: to, obligorTid: from, baseFee: 1_000_000, share: 0.5 })],
    };
    const before = league.teams.reduce((s, t) => s + t.budget, 0);
    const out = executeTransfer(league, pid, from, to, 3_000_000, 0, league.season, "summer");
    const b = (l: LeagueStore, tid: number) => l.teams.find((t) => t.tid === tid)!.budget;
    // Buyer pays 3M and takes back 50% of the 2M profit: net -2M.
    expect(b(out, to) - b(league, to)).toBe(-2_000_000);
    expect(b(out, from) - b(league, from)).toBe(2_000_000);
    expect(out.teams.reduce((s, t) => s + t.budget, 0)).toBeCloseTo(before, 6);
  });

  it("leaves budgets exactly as before when there are no clauses", () => {
    const base = makeLeague(0, 1);
    const from = base.teams[6].tid;
    const to = base.teams[7].tid;
    const pid = base.teams[6].roster[0];
    const b = (l: LeagueStore, tid: number) => l.teams.find((t) => t.tid === tid)!.budget;
    const out = executeTransfer(base, pid, from, to, 2_000_000, 500_000, base.season, "summer");
    expect(b(out, from) - b(base, from)).toBe(2_000_000);
    expect(b(out, to) - b(base, to)).toBe(-2_500_000);
  });
});

/**
 * The gate for the bug this feature's whole shape exists to avoid.
 *
 * Clauses deliberately do NOT live on `CompletedTransfer`, because
 * `detachTransfers` windows that log to the last few seasons before it crosses
 * to the worker — and bonuses settle, and resales fire sell-ons, inside that
 * worker. A clause parked on a windowed field would read as absent and silently
 * pay nobody. Anyone who "tidies" clauses onto the transfer log, or adds them to
 * a detach, fails here rather than shipping a save that quietly stops paying.
 */
describe("clauses survive the worker boundary", () => {
  it("round-trips through every detach the sim applies", () => {
    const base = makeLeague(0, 1);
    const clause = sellOn({ pid: base.teams[6].roster[0], season: base.season, expires: base.season + 5 });
    const league: LeagueStore = { ...base, transferClauses: [clause] };

    const a = detachArchive(league);
    const b = detachNews(a.payload);
    const c = detachTransfers(b.payload);
    const d = detachPlayed(c.payload);

    // The payload the worker actually receives still carries the obligation.
    expect(d.payload.transferClauses).toEqual([clause]);

    const back = reattachArchive(
      reattachNews(
        reattachTransfers(reattachPlayed(d.payload, d.played), c.transfers, new Set()),
        b.news, new Set(),
      ),
      a.archive,
    );
    expect(back.transferClauses).toEqual([clause]);
  });
});

describe("settleBonuses", () => {
  const inputs = (over: Partial<Parameters<typeof settleBonuses>[1]> = {}) => ({
    rosterOf: new Map([[1, 20]]),
    statsByPid: new Map([[1, { appearances: 30, goals: 12 }]]),
    qualifiedTids: new Set<number>(),
    promotedTids: new Set<number>(),
    ...over,
  });

  it("pays a performance bonus the player earned, once, and retires it", () => {
    const { payouts, remaining } = settleBonuses([bonus({ trigger: "appearances" })], inputs());
    expect(payouts).toEqual([
      { fromTid: 20, toTid: 10, amount: 500_000, pid: 1, reason: "appearances" },
    ]);
    expect(remaining).toEqual([]);
  });

  it("keeps an unearned bonus alive for another go", () => {
    const clause = bonus({ trigger: "goals", amount: 400_000 });
    const { payouts, remaining } = settleBonuses(
      [clause], inputs({ statsByPid: new Map([[1, { appearances: 30, goals: 1 }]]) }),
    );
    expect(payouts).toEqual([]);
    expect(remaining).toEqual([clause]);
  });

  it("pays nothing once the player has left the club that agreed it", () => {
    const clause = bonus({ trigger: "appearances" });
    const { payouts, remaining } = settleBonuses(
      [clause], inputs({ rosterOf: new Map([[1, 77]]) }),
    );
    expect(payouts).toEqual([]);
    expect(remaining).toEqual([clause]);
  });

  it("reads the team triggers off the caller's answers, not the player's stats", () => {
    const cont = bonus({ trigger: "continental" });
    const promo = bonus({ trigger: "promotion" });
    const none = settleBonuses([cont, promo], inputs());
    expect(none.payouts).toEqual([]);

    const both = settleBonuses([cont, promo], inputs({
      qualifiedTids: new Set([20]), promotedTids: new Set([20]),
    }));
    expect(both.payouts.map((p) => p.reason).sort()).toEqual(["continental", "promotion"]);
    expect(both.remaining).toEqual([]);
  });

  it("leaves sell-on clauses completely alone", () => {
    const s = sellOn();
    const { payouts, remaining } = settleBonuses([s], inputs());
    expect(payouts).toEqual([]);
    expect(remaining).toEqual([s]);
  });
});

describe("payoutDeltas", () => {
  it("moves money without creating any", () => {
    const deltas = payoutDeltas([
      { fromTid: 1, toTid: 2, amount: 500, pid: 9, reason: "goals" },
      { fromTid: 3, toTid: 2, amount: 250, pid: 8, reason: "sellOn" },
    ]);
    expect(deltas.get(1)).toBe(-500);
    expect(deltas.get(3)).toBe(-250);
    expect(deltas.get(2)).toBe(750);
    expect([...deltas.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("clause lifecycle", () => {
  it("expires a clause once the league passes its last season", () => {
    const live = sellOn({ expires: 6 });
    expect(expireClauses([live], 6)).toEqual([live]);
    expect(expireClauses([live], 7)).toEqual([]);
  });

  it("scrubs clauses for players who no longer exist", () => {
    const kept = sellOn({ pid: 2 });
    expect(scrubClausesForPids([sellOn({ pid: 1 }), kept], new Set([1]))).toEqual([kept]);
  });
});

describe("clausesAreValid", () => {
  const fee = 10_000_000;

  it("accepts an ordinary sell-on plus one bonus", () => {
    expect(clausesAreValid(
      [{ kind: "sellOn", share: 0.2 }, { kind: "bonus", trigger: "goals", amount: 1_000_000 }],
      fee,
    )).toBe(true);
  });

  it("rejects a sell-on share above the cap", () => {
    expect(clausesAreValid([{ kind: "sellOn", share: SELL_ON_MAX_SHARE + 0.01 }], fee)).toBe(false);
  });

  it("caps the sell-on on the TOTAL, not per clause", () => {
    const half = SELL_ON_MAX_SHARE * 0.6;
    expect(clausesAreValid(
      [{ kind: "sellOn", share: half }, { kind: "sellOn", share: half }], fee,
    )).toBe(false);
  });

  it("rejects bonus money above its fraction of the fee", () => {
    expect(clausesAreValid(
      [{ kind: "bonus", trigger: "goals", amount: BONUS_MAX_TOTAL_FRACTION * fee + 1 }], fee,
    )).toBe(false);
  });

  it("rejects two bonuses on the same trigger", () => {
    expect(clausesAreValid(
      [
        { kind: "bonus", trigger: "goals", amount: 100_000 },
        { kind: "bonus", trigger: "goals", amount: 100_000 },
      ],
      fee,
    )).toBe(false);
  });

  it("rejects a non-positive or non-finite amount", () => {
    expect(clausesAreValid([{ kind: "bonus", trigger: "goals", amount: 0 }], fee)).toBe(false);
    expect(clausesAreValid([{ kind: "sellOn", share: Number.NaN }], fee)).toBe(false);
  });
});

describe("bonusTriggered", () => {
  it("reads the season's appearances and goals", () => {
    const b = bonus({ trigger: "appearances" }) as Extract<TransferClause, { kind: "bonus" }>;
    expect(bonusTriggered(b, { appearances: BONUS_APPEARANCE_THRESHOLD, goals: 0 }, false)).toBe(true);
    expect(bonusTriggered(b, { appearances: BONUS_APPEARANCE_THRESHOLD - 1, goals: 0 }, false)).toBe(false);
    const g = bonus({ trigger: "goals" }) as Extract<TransferClause, { kind: "bonus" }>;
    expect(bonusTriggered(g, { appearances: 38, goals: BONUS_GOAL_THRESHOLD }, false)).toBe(true);
  });

  it("treats a player who never appeared as not having triggered", () => {
    const b = bonus({ trigger: "appearances" }) as Extract<TransferClause, { kind: "bonus" }>;
    expect(bonusTriggered(b, undefined, false)).toBe(false);
  });

  it("defers to the caller for the two team triggers", () => {
    const c = bonus({ trigger: "continental" }) as Extract<TransferClause, { kind: "bonus" }>;
    expect(bonusTriggered(c, undefined, true)).toBe(true);
    expect(bonusTriggered(c, { appearances: 38, goals: 40 }, false)).toBe(false);
  });
});

describe("pricing", () => {
  it("projects a young player with room to grow ABOVE his value today", () => {
    const league = makeLeague(0, 1);
    const young = league.players.find(
      (p) => league.season - p.born <= 20 && p.potential - p.ovr >= 10,
    );
    expect(young).toBeDefined();
    const now = projectedValue(young!, league.season, 0);
    const later = projectedValue(young!, league.season, 2);
    expect(later).toBeGreaterThan(now);
  });

  it("prices a sell-on at zero when there is no profit to share", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[6].roster[0];
    const obligorTid = league.teams[7].tid;
    // A base fee far above anything he could be resold for leaves no profit.
    const value = clauseExpectedValue(
      league, pid, obligorTid, 10 * 350_000_000, [{ kind: "sellOn", share: SELL_ON_MAX_SHARE }],
    );
    expect(value).toBe(0);
  });

  it("prices a bigger share higher than a smaller one on the same deal", () => {
    const league = makeLeague(0, 1);
    const pid = league.teams[6].roster[0];
    const obligorTid = league.teams[7].tid;
    const small = clauseExpectedValue(league, pid, obligorTid, 1_000_000, [{ kind: "sellOn", share: 0.1 }]);
    const big = clauseExpectedValue(league, pid, obligorTid, 1_000_000, [{ kind: "sellOn", share: 0.4 }]);
    expect(big).toBeGreaterThan(small);
  });

  it("costs nothing and derives nothing for an empty proposal", () => {
    const league = makeLeague(0, 1);
    expect(clauseExpectedValue(league, league.teams[6].roster[0], league.teams[7].tid, 1_000_000, []))
      .toBe(0);
  });

  it("gives a promotion bonus zero chance in the top flight and a real one below it", () => {
    const league = makeLeague(0, 1);
    const player = league.players[0];
    const top = league.teams.find((t) => league.competitions.find((c) => c.id === t.compId)!.tier === 1)!;
    const lower = league.teams.find((t) => league.competitions.find((c) => c.id === t.compId)!.tier === 2)!;
    expect(triggerProbability("promotion", player, top, league.competitions, null, 3)).toBe(0);
    expect(triggerProbability("promotion", player, lower, league.competitions, null, 3))
      .toBeGreaterThan(0);
    // ...and continental qualification is the mirror image.
    expect(triggerProbability("continental", player, lower, league.competitions, null, 3)).toBe(0);
    expect(triggerProbability("continental", player, top, league.competitions, null, 3))
      .toBeGreaterThan(0);
  });

  it("makes an appearance bonus likelier for a player who beats the incumbent starter", () => {
    const league = makeLeague(0, 1);
    const player = league.players[0];
    const club = league.teams[3];
    const walksIn = triggerProbability("appearances", player, club, league.competitions, player.ovr - 20, 3);
    const benchWarmer = triggerProbability("appearances", player, club, league.competitions, player.ovr + 20, 3);
    expect(walksIn).toBeGreaterThan(benchWarmer);
    expect(walksIn).toBeLessThanOrEqual(1);
    expect(benchWarmer).toBeGreaterThanOrEqual(0);
  });
});

/**
 * All four negotiation entry points share ONE model: the number you name is the
 * deal's total, and add-ons come out of it. These pin that, because a panel
 * that says "cash becomes X" is only honest if every button agrees.
 */
describe("negotiating with add-ons", () => {
  /** A league sitting in the winter window, like inboundOffers.test.ts uses. */
  function windowLeague(seed = 1): LeagueStore {
    const l = makeLeague(0, seed);
    return { ...l, schedule: l.schedule.filter((g) => g.matchday >= 20) };
  }

  /** The open window, asserted — every case here needs one to mean anything. */
  function openWindow(league: LeagueStore) {
    const ws = transferWindowState(league);
    if (!ws.open) throw new Error("fixture is not in an open transfer window");
    return { season: ws.season, window: ws.window };
  }

  it("buying: the cash is exactly what you offered, and a clause is attached", () => {
    const league = windowLeague();
    const userTid = league.meta.userTid;
    const user = league.teams.find((t) => t.tid === userTid)!;
    const ws = openWindow(league);

    const target = league.players.find((p) => {
      const seller = league.teams.find((t) => t.tid !== userTid && t.roster.includes(p.pid));
      if (!seller) return false;
      const res = reservationPrice(league.lid, ws.season, ws.window, p);
      return res > 2_000_000 && res < user.budget * 0.4;
    });
    expect(target).toBeDefined();
    const res = reservationPrice(league.lid, ws.season, ws.window, target!);

    const plain = makeTransferOffer(league, target!.pid, res);
    const withClause = makeTransferOffer(
      league, target!.pid, res, [{ kind: "sellOn", share: 0.3 }],
    );

    expect(plain.transfers.length).toBe(league.transfers.length + 1);
    expect(withClause.transfers.length).toBe(league.transfers.length + 1);
    // Add-ons sit ON TOP: what changes hands now is untouched by them.
    expect(withClause.transfers.at(-1)!.fee).toBe(plain.transfers.at(-1)!.fee);
    expect(withClause.transfers.at(-1)!.fee).toBe(res);
    expect(withClause.transferClauses).toHaveLength(1);
    expect(withClause.transferClauses[0].obligorTid).toBe(userTid);
    expect(plain.transferClauses).toHaveLength(0);
  });

  it("buying: add-ons close a deal the cash alone wouldn't — the whole point", () => {
    const league = windowLeague();
    const userTid = league.meta.userTid;
    const ws = openWindow(league);
    const target = league.players.find((p) => {
      const seller = league.teams.find((t) => t.tid !== userTid && t.roster.includes(p.pid));
      if (!seller) return false;
      return reservationPrice(league.lid, ws.season, ws.window, p) > 5_000_000;
    })!;
    const res = reservationPrice(league.lid, ws.season, ws.window, target);
    const clauses: ProposedClause[] = [{ kind: "sellOn", share: 0.4 }];
    const value = clauseExpectedValue(league, target.pid, userTid, res, clauses);
    if (value <= 0) return;

    // Bid under his price by less than the add-ons are worth. In cash alone the
    // seller says no; with the add-ons on top the same cash clears his number.
    const short = res - Math.round(value / 2);
    expect(makeTransferOffer(league, target.pid, short).transfers.length)
      .toBe(league.transfers.length);
    const done = makeTransferOffer(league, target.pid, short, clauses);
    expect(done.transfers.length).toBe(league.transfers.length + 1);
    // ...and you still pay only the cash you bid.
    expect(done.transfers.at(-1)!.fee).toBe(short);
  });

  it("selling: you keep the full cash offer and the clause on top", () => {
    const league = windowLeague();
    // A buyer with room under his ceiling for add-ons as well as his own bid.
    const candidate = inboundOfferCandidates(league).find((c) =>
      buyerAcceptsClauses(league, c.player.pid, [{ kind: "sellOn", share: 0.3 }]));
    expect(candidate).toBeDefined();
    const pid = candidate!.player.pid;

    const plain = acceptInboundOffer(league, pid);
    const withClause = acceptInboundOffer(league, pid, [{ kind: "sellOn", share: 0.3 }]);
    expect(plain.transfers.length).toBe(league.transfers.length + 1);
    expect(withClause.transfers.length).toBe(league.transfers.length + 1);
    expect(withClause.transfers.at(-1)!.fee).toBe(plain.transfers.at(-1)!.fee);
    expect(withClause.transferClauses).toHaveLength(1);
    // The BUYER owes it; the user is owed.
    expect(withClause.transferClauses[0].beneficiaryTid).toBe(league.meta.userTid);
    expect(withClause.transferClauses[0].obligorTid).toBe(candidate!.buyerTid);
  });

  it("selling: a buyer who can't wear the add-ons refuses rather than paying up", () => {
    const league = windowLeague();
    // The biggest sell-on this player's buyer could be asked for on top of his
    // own bid. Where that is over his ceiling, accepting must be a no-op —
    // otherwise "accept, and also give me a sell-on" is free money.
    const greedy: ProposedClause[] = [{ kind: "sellOn", share: SELL_ON_MAX_SHARE }];
    const blocked = inboundOfferCandidates(league).find(
      (c) => !buyerAcceptsClauses(league, c.player.pid, greedy),
    );
    if (!blocked) return; // no such buyer this seed; the rule is still pinned above
    expect(acceptInboundOffer(league, blocked.player.pid, greedy)).toBe(league);
  });

  it("refuses a proposal that breaks the caps rather than silently trimming it", () => {
    const league = windowLeague();
    const candidate = inboundOfferCandidates(league)[0];
    const out = acceptInboundOffer(
      league, candidate.player.pid, [{ kind: "sellOn", share: SELL_ON_MAX_SHARE + 0.2 }],
    );
    expect(out).toBe(league);
  });
});

/**
 * Per-player suggestions.
 *
 * The property that matters most here is the LAST one: probability has to fall
 * as the threshold rises. Without it a 5-goal bonus would be priced like a
 * 15-goal one, and picking the low threshold would be free money — the same
 * exploit the sell-on pricing exists to close, arriving through the bonus door.
 */
describe("suggestedBonuses", () => {
  const world = () => makeLeague(0, 1);

  function ctx(league: LeagueStore, pos: string) {
    const player = league.players.find((p) => p.pos === pos)!;
    const top = league.teams.find(
      (t) => league.competitions.find((c) => c.id === t.compId)!.tier === 1,
    )!;
    const lower = league.teams.find(
      (t) => league.competitions.find((c) => c.id === t.compId)!.tier > 1,
    )!;
    return { player, top, lower };
  }

  it("never offers a goal bonus to a keeper", () => {
    const league = world();
    const { player, top } = ctx(league, "GK");
    const out = suggestedBonuses(player, top, league.competitions, 50, 10_000_000);
    expect(out.map((b) => b.trigger)).not.toContain("goals");
  });

  it("does offer one to a striker", () => {
    const league = world();
    const { player, top } = ctx(league, "ST");
    const out = suggestedBonuses(player, top, league.competitions, 50, 10_000_000);
    const goals = out.find((b) => b.trigger === "goals");
    expect(goals).toBeDefined();
    expect(goals!.threshold!).toBeGreaterThanOrEqual(BONUS_SUGGESTION_MIN_GOALS);
  });

  it("offers Europe to a top-flight buyer and promotion to anyone below", () => {
    const league = world();
    const { player, top, lower } = ctx(league, "CM");
    const t = suggestedBonuses(player, top, league.competitions, 50, 10_000_000).map((b) => b.trigger);
    const l = suggestedBonuses(player, lower, league.competitions, 50, 10_000_000).map((b) => b.trigger);
    expect(t).toContain("continental");
    expect(t).not.toContain("promotion");
    expect(l).toContain("promotion");
    expect(l).not.toContain("continental");
  });

  it("offers no promotion bonus to a club in a closed division", () => {
    const league = world();
    const { player } = ctx(league, "CM");
    // Mexico and the US run closed pyramids: their second tiers send nobody up.
    const closed = league.competitions.find(
      (c) => c.tier === 2 && (c.country === "Mexico" || c.country === "United States"),
    )!;
    expect(closed).toBeDefined();
    const club = league.teams.find((t) => t.compId === closed.id)!;
    const out = suggestedBonuses(player, club, league.competitions, 50, 10_000_000)
      .map((b) => b.trigger);
    expect(out).not.toContain("promotion");
    expect(out).not.toContain("continental");
    expect(out).toContain("appearances");
  });

  it("asks more of a player who walks into the team than one who won't play", () => {
    const league = world();
    const { player, top } = ctx(league, "CM");
    const walksIn = suggestedBonuses(player, top, league.competitions, player.ovr - 25, 10_000_000);
    const fringe = suggestedBonuses(player, top, league.competitions, player.ovr + 25, 10_000_000);
    const appsOf = (l: ReturnType<typeof suggestedBonuses>) =>
      l.find((b) => b.trigger === "appearances")!.threshold!;
    expect(appsOf(walksIn)).toBeGreaterThan(appsOf(fringe));
  });

  it("always offers an appearance bonus, and always with a threshold", () => {
    const league = world();
    for (const pos of ["GK", "CB", "CM", "ST"]) {
      const { player, top } = ctx(league, pos);
      const apps = suggestedBonuses(player, top, league.competitions, 50, 10_000_000)
        .find((b) => b.trigger === "appearances");
      expect(apps).toBeDefined();
      expect(apps!.threshold).toBeGreaterThan(0);
    }
  });

  it("prices a harder target as less likely — the anti-exploit property", () => {
    const league = world();
    const { player, top } = ctx(league, "ST");
    const at = (t: number) =>
      triggerProbability("goals", player, top, league.competitions, 50, 3, t);
    // Strictly decreasing across the whole plausible range.
    for (let t = 1; t < 25; t++) expect(at(t + 1)).toBeLessThanOrEqual(at(t));
    expect(at(3)).toBeGreaterThan(at(20));

    const apps = (t: number) =>
      triggerProbability("appearances", player, top, league.competitions, 50, 3, t);
    for (let t = 5; t < 38; t++) expect(apps(t + 1)).toBeLessThanOrEqual(apps(t));
  });

  it("values an easier bonus more highly than a harder one", () => {
    const league = world();
    const pid = league.teams[6].roster[0];
    const obligorTid = league.teams[7].tid;
    const easy = clauseExpectedValue(league, pid, obligorTid, 10_000_000, [
      { kind: "bonus", trigger: "appearances", amount: 1_000_000, threshold: 8 },
    ]);
    const hard = clauseExpectedValue(league, pid, obligorTid, 10_000_000, [
      { kind: "bonus", trigger: "appearances", amount: 1_000_000, threshold: 36 },
    ]);
    expect(easy).toBeGreaterThan(hard);
  });
});

describe("bonusTriggered honours the clause's own threshold", () => {
  it("uses the stored number, not the shipped default", () => {
    const low = bonus({ trigger: "appearances", threshold: 8 }) as Extract<TransferClause, { kind: "bonus" }>;
    const high = bonus({ trigger: "appearances", threshold: 36 }) as Extract<TransferClause, { kind: "bonus" }>;
    const line = { appearances: 12, goals: 0 };
    expect(bonusTriggered(low, line, false)).toBe(true);
    expect(bonusTriggered(high, line, false)).toBe(false);
  });

  it("falls back to the default when a clause carries none", () => {
    const c = bonus({ trigger: "goals" }) as Extract<TransferClause, { kind: "bonus" }>;
    expect(bonusTriggered(c, { appearances: 30, goals: BONUS_GOAL_THRESHOLD }, false)).toBe(true);
    expect(bonusTriggered(c, { appearances: 30, goals: BONUS_GOAL_THRESHOLD - 1 }, false)).toBe(false);
  });
});

describe("materializeClauses", () => {
  it("dates the clause from the deal and sets its expiry", () => {
    const proposed: ProposedClause[] = [
      { kind: "sellOn", share: 0.2 },
      { kind: "bonus", trigger: "goals", amount: 250_000 },
    ];
    const out = materializeClauses(proposed, 42, 3, 9, 7, 8_000_000);
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.pid).toBe(42);
      expect(c.beneficiaryTid).toBe(3);
      expect(c.obligorTid).toBe(9);
      expect(c.season).toBe(7);
      expect(c.expires).toBeGreaterThan(7);
    }
  });
});
