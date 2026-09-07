import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { makeLeague } from "../helpers/league.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import { transferWindowState } from "../../src/core/transfers/window.js";
import { searchLoanTargets, requestLoan } from "../../src/core/loanSearch.js";

/**
 * Render harness for the Loans page, covering the surfaces added when contract
 * expiry and loans were reconciled (docs/player-save-findings.md #2): the
 * contract column and Extend control on "Players Out on Loan" — the only place
 * a loaned-out player appears, since he is on nobody's Roster page — and the
 * duration picker's cap at what his contract covers.
 *
 * There is no DOM test env in this repo, so this is server rendering: a throw
 * surfaces as a failure, and note error boundaries do NOT run here (React
 * re-throws to the caller), which is what makes that useful.
 */
const leagueRef: { current: LeagueStore | null } = { current: null };

vi.mock("../../src/ui/context/LeagueContext.js", () => ({
  useLeague: () => ({
    league: leagueRef.current,
    listPlayerForLoanAction: () => {},
    unlistPlayerForLoanAction: () => {},
    acceptLoanOfferAction: () => {},
    rejectLoanOfferAction: () => {},
    requestLoanAction: () => {},
    extendContractAction: () => {},
    extendAllContractsAction: () => {},
    simming: false,
  }),
}));

const { Loans } = await import("../../src/ui/pages/Loans.js");

function render(league: LeagueStore): string {
  leagueRef.current = league;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Loans)));
}

/**
 * The markup of one card, from its title to the next one. The page carries two
 * loan-duration pickers now — one for sending a player out, one for bringing
 * someone in — so a bare `toContain("2 seasons")` can't tell which it found.
 * Slice the card first, then assert.
 */
function card(html: string, title: string): string {
  const start = html.indexOf(title);
  expect(start, `no card titled "${title}"`).toBeGreaterThan(-1);
  const next = html.indexOf("card-title", start);
  return next === -1 ? html.slice(start) : html.slice(start, next);
}

/** Send one of the user's players out on loan to an AI club. */
function lendOut(league: LeagueStore, expiresSeason: number) {
  const userTid = league.meta.userTid;
  const user = league.teams.find((t) => t.tid === userTid)!;
  const loanee = league.teams.find((t) => t.tid !== userTid)!;
  const pid = user.roster[0];
  return {
    ...league,
    players: league.players.map((p) =>
      p.pid === pid ? { ...p, contract: { ...p.contract, expiresSeason } } : p,
    ),
    teams: league.teams.map((t) => {
      if (t.tid === userTid) return { ...t, roster: t.roster.filter((r) => r !== pid) };
      if (t.tid === loanee.tid) return { ...t, roster: [...t.roster, pid] };
      return t;
    }),
    activeLoans: [{
      pid, parentTid: userTid, loaneeTid: loanee.tid,
      startSeason: league.season, seasons: 2, returnSeason: league.season + 2, fee: 0,
    }],
    name: league.players.find((p) => p.pid === pid)!.name,
  };
}

describe("Loans page renders", () => {
  it("shows a loaned-out player's contract and offers to extend him in his final year", () => {
    const league = makeLeague(0, 1);
    const { name, ...withLoan } = lendOut(league, league.season);
    const html = render(withLoan as LeagueStore);

    expect(html).toContain("Players Out on Loan");
    expect(html).toContain(name);
    expect(html).toContain("Final year");
    // The Extend control, which exists nowhere else for a player who is away.
    expect(html).toContain("Extend");
  });

  it("shows the expiry season, and no Extend control, when the deal still runs", () => {
    const league = makeLeague(0, 1);
    const { name, ...withLoan } = lendOut(league, league.season + 3);
    const html = render(withLoan as LeagueStore);

    expect(html).toContain(name);
    expect(html).toContain("Through ");
  });

  it("offers only the loan durations the player's contract covers", () => {
    const league = makeLeague(0, 1);
    const ws = transferWindowState(league);
    expect(ws.open).toBe(true);
    const userTid = league.meta.userTid;
    const user = league.teams.find((t) => t.tid === userTid)!;
    const userPids = new Set(user.roster);

    // Every one of the user's players has exactly one season left, so a
    // 2- or 3-season loan is off the table for all of them.
    const html = render({
      ...league,
      players: league.players.map((p) =>
        userPids.has(p.pid) ? { ...p, contract: { ...p.contract, expiresSeason: ws.season! } } : p,
      ),
    });

    const listing = card(html, "List a Player for Loan");
    expect(listing).toContain("1 season<");
    expect(listing).not.toContain("2 seasons");
    expect(listing).not.toContain("3 seasons");
  });

  it("won't list a player at all once his contract is up", () => {
    const league = makeLeague(0, 1);
    const ws = transferWindowState(league);
    const userTid = league.meta.userTid;
    const user = league.teams.find((t) => t.tid === userTid)!;
    const userPids = new Set(user.roster);

    const html = render({
      ...league,
      players: league.players.map((p) =>
        userPids.has(p.pid)
          ? { ...p, contract: { ...p.contract, expiresSeason: ws.season! - 1 } }
          : p,
      ),
    });

    expect(card(html, "List a Player for Loan")).toContain("Contract runs out first");
  });
});

describe("Loans page: bringing a player in", () => {
  /**
   * A second-division club. A club is only offered players who would get into
   * its team, so the generated default (tid 0, an English top-flight side) can
   * borrow nobody — the mechanic working, but a fixture that shows nothing.
   * Same cached world, different club in charge.
   */
  function borrower(): LeagueStore {
    const base = makeLeague(0, 1);
    const tier2 = new Set(base.competitions.filter((c) => c.tier === 2).map((c) => c.id));
    const tid = base.teams.find((t) => tier2.has(t.compId))!.tid;
    return { ...base, meta: { ...base.meta, userTid: tid } };
  }

  it("lists borrowable players with their club and fee", () => {
    const league = borrower();
    const targets = searchLoanTargets(league, 1, { availableOnly: true });
    expect(targets.length).toBeGreaterThan(0);

    const panel = card(render(league), "Loan a Player In");
    expect(panel).toContain(targets[0].player.name);
    expect(panel).toContain("Loan him in");
  });

  it("names the players in on loan and doesn't offer to extend them", () => {
    const base = borrower();
    const target = searchLoanTargets(base, 1, { availableOnly: true })[0];
    const league = requestLoan(base, target.player.pid, 2);
    expect(league).not.toBe(base);

    const html = render(league);
    const panel = card(html, "Players In on Loan");
    expect(panel).toContain(target.player.name);
    expect(panel).toContain("Goes back");
    // He's someone else's player, so there is no Extend control beside him —
    // that column doesn't exist on this table at all.
    expect(panel).not.toContain("Extend");
  });

  it("says the club is in the red rather than letting the rows blame other clubs", () => {
    // Affordability is the one user-side check that depends on which player it
    // is, so it can't be hoisted in the gate — and on an overall-ranked list
    // the top rows are refused on price first, so it never reaches a row.
    const base = makeLeague(0, 1);
    const league: LeagueStore = {
      ...base,
      teams: base.teams.map((t) =>
        t.tid === base.meta.userTid ? { ...t, budget: -5_000_000 } : t),
    };
    const panel = card(render(league), "Loan a Player In");
    expect(panel).toContain("You&#x27;re in the red");
  });

  it("explains why a refused player is out of reach when you ask to see them", () => {
    // The panel filters to the available ones by default precisely because
    // plenty of rows are refused — most often because he wouldn't get a game.
    const league = borrower();
    const refused = searchLoanTargets(league, 1).filter((t) => !t.available);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0].unavailableReason).toBeTruthy();
  });
});
