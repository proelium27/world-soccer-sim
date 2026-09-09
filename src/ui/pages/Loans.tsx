import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import { transferWindowState } from "../../core/transfers/window.js";
import type { Player } from "../../core/players/types.js";
import { loanOfferCandidates, maxLoanSeasons } from "../../core/loans.js";
import { searchLoanTargets, loansTakenThisWindow } from "../../core/loanSearch.js";
import { borrowedPids } from "../../core/loanOwnership.js";
import { WINTER_WINDOW_OPEN_MATCHDAY } from "../../core/calendar.js";
import { LOAN_MAX_SEASONS, LOAN_IN_MAX_PER_WINDOW, LOAN_AI_MAX_AGE } from "../../core/constants.js";
import { useDebounced } from "../useDebounced.js";
import {
  PlayerFilterBar, EMPTY_PLAYER_FILTERS, hasAnyFilter, toSearchFilters,
  type PlayerFilterState,
} from "../components/PlayerFilterBar.js";
import { canExtend } from "../../core/contracts.js";
import { hasRosterRoom } from "../../core/transfers/negotiation.js";
import { renewalsDue } from "../../core/contractRenewal.js";
import { wouldRefuseExtension } from "../../core/ai/breakoutRefusal.js";
import { currency, formatWeeklyWage, seasonYear } from "../format.js";
import { Flag } from "../components/Flag.js";
import { ExtendControl } from "../components/ExtendControl.js";
import { ExtendAllButton } from "../components/ExtendAllButton.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { usePotentialView } from "../potentialView.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";

const SEASON_OPTIONS = Array.from({ length: LOAN_MAX_SEASONS }, (_, i) => (i + 1) as 1 | 2 | 3);

type LoanOfferSortKey = "default" | "name" | "pos" | "ovr" | "pot" | "club" | "seasons" | "fee";
type EligibleSortKey = "name" | "pos" | "age" | "ovr" | "pot" | "wage";
type TargetSortKey = "default" | "name" | "pos" | "age" | "ovr" | "pot" | "club" | "wage" | "fee";

export function Loans() {
  const {
    league, listPlayerForLoanAction, unlistPlayerForLoanAction,
    acceptLoanOfferAction, rejectLoanOfferAction, extendContractAction,
    extendAllContractsAction, requestLoanAction, simming,
  } = useLeague();
  const [draftSeasons, setDraftSeasons] = useState<Record<number, 1 | 2 | 3>>({});
  const offerSort = useTableSort<LoanOfferSortKey>("default", "desc");
  const eligibleSort = useTableSort<EligibleSortKey>("ovr", "desc");
  const potView = usePotentialView();

  // The loan-in search. One duration for the whole panel rather than one per
  // row: both the fee and the contract check depend on it, so a per-row picker
  // would mean re-gating a row on every dropdown change, and the column would
  // be pricing eleven different deals at once.
  const [targetSeasons, setTargetSeasons] = useState<1 | 2 | 3>(1);
  const [targetFilters, setTargetFilters] = useState<PlayerFilterState>(EMPTY_PLAYER_FILTERS);
  const [targetName, setTargetName] = useState("");
  // On by default, unlike the transfer search's for-sale toggle. Measured on a
  // fresh world: the top 40 borrowable players by overall are refused *every
  // time* — the best young players benched at big clubs are exactly the ones
  // their clubs value most — so an unfiltered first view is 40 rows of "his
  // club rates him too highly" and looks like a broken screen. Turning it off
  // is how you find out why someone specific is out of reach.
  const [availableOnly, setAvailableOnly] = useState(true);
  const targetSort = useTableSort<TargetSortKey>("default", "desc");

  const rawOffers = useMemo(() => (league ? loanOfferCandidates(league) : []), [league]);

  // Walks every roster in the world and derives a club context for each, so it
  // runs off *debounced* filter state (typing stays instant) and is memoized to
  // stay off the path of unrelated renders — the same shape the Transfers
  // page's world search uses, for the same measured reason.
  const debouncedTargetFilters = useDebounced(targetFilters);
  const debouncedTargetName = useDebounced(targetName);
  const rawTargets = useMemo(() => {
    if (!league) return [];
    return searchLoanTargets(league, targetSeasons, {
      ...toSearchFilters(debouncedTargetFilters, league.competitions),
      name: debouncedTargetName,
      availableOnly,
    });
  }, [league, targetSeasons, debouncedTargetFilters, debouncedTargetName, availableOnly]);
  const loansTaken = useMemo(() => (league ? loansTakenThisWindow(league) : 0), [league]);
  const nationalities = useMemo(() => {
    const seen = new Set<string>();
    for (const p of league?.players ?? []) seen.add(p.nationality);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [league?.players]);
  // Walks the whole player pool, like rawOffers above: memoized so the
  // duration dropdowns don't re-run it on every change.
  const renewals = useMemo(
    () => (league ? renewalsDue(league, "loanedOut") : null), [league],
  );

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!userTeam) {
    return <p className="p-3">Team not found.</p>;
  }

  const ws = transferWindowState(league);
  // A loan can't outlast the player's contract (see maxLoanSeasons): he'd be
  // away when it ran down and walk for free the moment he got home. The picker
  // offers only the durations his deal covers, and listPlayerForLoan refuses
  // the rest. Measured from the season the loan would start in, which during
  // the offseason is next season, not league.season.
  const loanStartSeason = ws.open ? ws.season : league.season;
  const allowedSeasons = (p: Player) => maxLoanSeasons(p, loanStartSeason);
  const draftFor = (p: Player) =>
    Math.max(1, Math.min(draftSeasons[p.pid] ?? 1, allowedSeasons(p))) as 1 | 2 | 3;
  const teamName = (tid: number) => league.teams.find((t) => t.tid === tid)?.name ?? "Unknown";
  const playerName = (pid: number) => league.players.find((p) => p.pid === pid);

  const offers = sortRows(rawOffers, offerSort.sort, {
    name: (c) => c.player.name,
    pos: (c) => c.player.pos,
    ovr: (c) => c.player.ovr,
    pot: (c) => potView.ceiling(c.player),
    club: (c) => teamName(c.buyerTid),
    seasons: (c) => c.seasons,
    fee: (c) => c.fee,
  });

  const listedPids = new Set(league.loanListings.map((l) => l.pid));
  // A player in on loan sits on this roster and is not ours to lend on. The
  // core refuses it (listPlayerForLoan returns the league unchanged for any pid
  // already in activeLoans), so leaving him here is a live button that silently
  // does nothing — the exact shape this feature exists to avoid.
  const borrowed = borrowedPids(league.activeLoans, userTeam.tid);
  const eligible = sortRows(
    userTeam.roster
      .map((pid) => league.players.find((p) => p.pid === pid))
      .filter(
        (p): p is NonNullable<typeof p> =>
          p != null && !listedPids.has(p.pid) && !borrowed.has(p.pid),
      ),
    eligibleSort.sort,
    {
      name: (p) => p.name,
      pos: (p) => p.pos,
      age: (p) => league.season - p.born,
      ovr: (p) => p.ovr,
      pot: (p) => potView.ceiling(p),
      wage: (p) => p.contract.salary,
    },
  );

  const outOnLoan = league.activeLoans.filter((l) => l.parentTid === userTeam.tid);
  const inOnLoan = league.activeLoans.filter(
    (l) => l.loaneeTid === userTeam.tid && l.parentTid !== userTeam.tid,
  );

  const targets = sortRows(rawTargets, targetSort.sort, {
    name: (t) => t.player.name,
    pos: (t) => t.player.pos,
    age: (t) => league.season - t.player.born,
    ovr: (t) => t.player.ovr,
    pot: (t) => potView.ceiling(t.player),
    club: (t) => teamName(t.parentTid),
    wage: (t) => t.player.contract.salary,
    fee: (t) => t.fee,
  });

  return (
    <div className="container-fluid p-3">
      <h4>
        Loans
        <HelpHint>
          Loans work both ways. Send a player to another club for 1&ndash;3 seasons to get him
          minutes he isn't getting with you, and minutes drive development: list him, then accept
          or reject the flat-fee offers that come in. He comes back on his own when the loan ends,
          and his contract stays yours the whole time, so you can still extend him while he&apos;s
          away from the list further down this page. Or borrow someone else&apos;s young player the
          same way &mdash; you pay the fee and his wages, he plays for you, and he goes home when
          the loan runs out. He isn&apos;t yours, so you can&apos;t sell, release or re-sign him.
        </HelpHint>
      </h4>

      {!ws.open ? (
        <div className="alert alert-secondary mb-3">
          <strong>Transfer window closed.</strong> Loans can only be listed or
          offered during an open window. The winter window opens once
          matchday {WINTER_WINDOW_OPEN_MATCHDAY - 1} is played; the summer
          window runs through the offseason and August.
        </div>
      ) : (
        <p>
          Sending a player on loan gets him minutes elsewhere when he can&apos;t
          get them at your club &mdash; the loanee club pays a flat fee up front
          and covers his wages for the loan&apos;s length, and he returns to your
          roster automatically once it ends.
        </p>
      )}

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Incoming Loan Offers</h5>
          {offers.length === 0 ? (
            <p className="text-muted mb-0">No offers on your listed players right now.</p>
          ) : (
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <SortableTh sortKey="name" sort={offerSort.sort} onSort={offerSort.toggle} defaultDir="asc">Name</SortableTh>
                  <SortableTh sortKey="pos" sort={offerSort.sort} onSort={offerSort.toggle} defaultDir="asc">Pos</SortableTh>
                  <SortableTh sortKey="ovr" sort={offerSort.sort} onSort={offerSort.toggle} className="text-end">Ovr</SortableTh>
                  <SortableTh sortKey="pot" sort={offerSort.sort} onSort={offerSort.toggle} className="text-end">Pot <PotHelp /></SortableTh>
                  <SortableTh sortKey="club" sort={offerSort.sort} onSort={offerSort.toggle} defaultDir="asc">Club</SortableTh>
                  <SortableTh sortKey="seasons" sort={offerSort.sort} onSort={offerSort.toggle} className="text-end">Seasons</SortableTh>
                  <SortableTh sortKey="fee" sort={offerSort.sort} onSort={offerSort.toggle} className="text-end">Fee</SortableTh>
                  <th />
                </tr>
              </thead>
              <tbody>
                {offers.map((c) => (
                  <tr key={c.player.pid}>
                    <td>
                      <PlayerRatingsTooltip player={c.player}>
                        <Link to={`/player/${c.player.pid}`}>{c.player.name}</Link>
                      </PlayerRatingsTooltip>{" "}
                      <Flag nationality={c.player.nationality} />
                    </td>
                    <td>{c.player.pos}</td>
                    <td className="text-end">{c.player.ovr}</td>
                    <td className="text-end"><PotDisplay player={c.player} /></td>
                    <td><ClubLink tid={c.buyerTid} /></td>
                    <td className="text-end">{c.seasons}</td>
                    <td className="text-end">{currency.format(c.fee)}</td>
                    <td className="text-end">
                      <button
                        className="btn btn-sm btn-success me-1"
                        disabled={simming}
                        onClick={() => acceptLoanOfferAction(c.player.pid)}
                      >
                        Accept
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        disabled={simming}
                        onClick={() => rejectLoanOfferAction(c.player.pid)}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Loan a Player In</h5>
          <p className="card-text text-muted">
            Clubs will lend you a young player who isn&apos;t getting into their
            starting eleven &mdash; {LOAN_AI_MAX_AGE} and under, on the bench, and
            worth more to you than to them. That last part is what decides how
            good a loan you can get: a club near the top of the pyramid won&apos;t
            find much, while a side scrapping in a lower division can borrow
            genuinely useful players. You pay a flat fee up front and cover his
            wages for the whole loan, then he goes back to his club when it ends.
            You can agree {LOAN_IN_MAX_PER_WINDOW} loans a window
            {loansTaken > 0 ? ` (${loansTaken} so far)` : ""}.
          </p>

          <PlayerFilterBar
            idPrefix="li"
            value={targetFilters}
            onChange={setTargetFilters}
            onClear={() => { setTargetFilters(EMPTY_PLAYER_FILTERS); setTargetName(""); }}
            nationalities={nationalities}
            competitions={league.competitions}
            showValue={false}
          >
            <div>
              <label className="form-label small mb-0" htmlFor="li-name">Name</label>
              <input
                id="li-name"
                type="text"
                className="form-control form-control-sm"
                style={{ width: "12rem" }}
                placeholder="Search by name"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label small mb-0" htmlFor="li-seasons">Loan length</label>
              <select
                id="li-seasons"
                className="form-select form-select-sm"
                style={{ width: "8rem" }}
                value={targetSeasons}
                onChange={(e) => setTargetSeasons(Number(e.target.value) as 1 | 2 | 3)}
              >
                {SEASON_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s} season{s > 1 ? "s" : ""}</option>
                ))}
              </select>
            </div>
          </PlayerFilterBar>
          <div className="form-check form-switch mb-3">
            <input
              className="form-check-input"
              type="checkbox"
              id="li-available"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="li-available">
              Only show players you can take right now &mdash; turn this off to see
              who else you looked at and why they said no
            </label>
          </div>

          {/* Said once, up here, because the rows can't say it: they're ranked
              by overall and the best of them are refused on price long before
              the cap is reached, so the per-row reason never surfaces. Without
              this the panel just empties out and the copy below blames the
              clubs for something the user did. */}
          {ws.open && loansTaken >= LOAN_IN_MAX_PER_WINDOW && (
            <div className="alert alert-secondary">
              <strong>That&apos;s your {LOAN_IN_MAX_PER_WINDOW} loans for this window.</strong>{" "}
              You can borrow again when the next one opens.
            </div>
          )}
          {/* The third of the three user-side conditions that refuse every row
              at once. Same argument as the cap above: it's checked first in the
              gate, so with the available-only filter on (the default) the table
              empties and the copy below blames the clubs for a full squad. */}
          {ws.open && !hasRosterRoom(userTeam) && (
            <div className="alert alert-secondary">
              <strong>Your squad is full.</strong> You&apos;ll need to move
              someone on before you can take anyone in on loan.
            </div>
          )}
          {/* Affordability is the one user-side check that depends on which
              player it is, so it can't be hoisted in the gate the way the cap
              and a full squad are — and on a list ranked by overall the top
              rows are refused on price before it's ever reached. Said here so
              a club in the red doesn't read as forty clubs turning it down. */}
          {ws.open && userTeam.budget <= 0 && (
            <div className="alert alert-warning">
              <strong>You&apos;re in the red.</strong> A loan still costs a fee and
              his wages, so you can&apos;t take anyone on until the books are
              back in order.
            </div>
          )}

          {!ws.open ? (
            <p className="text-muted mb-0">Loans can only be agreed while a window is open.</p>
          ) : targets.length === 0 ? (
            <p className="text-muted mb-0">
              {loansTaken >= LOAN_IN_MAX_PER_WINDOW
                ? "Nobody left to take this window."
                : hasAnyFilter(targetFilters) || targetName.trim() !== ""
                  ? "Nobody available matches that. Clubs only lend players who aren't in their starting eleven, so a first-team regular won't show up here."
                  : "No clubs are willing to lend anyone right now."}
            </p>
          ) : (
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <SortableTh sortKey="name" sort={targetSort.sort} onSort={targetSort.toggle} defaultDir="asc">Name</SortableTh>
                  <SortableTh sortKey="pos" sort={targetSort.sort} onSort={targetSort.toggle} defaultDir="asc">Pos</SortableTh>
                  <SortableTh sortKey="age" sort={targetSort.sort} onSort={targetSort.toggle} className="text-end" defaultDir="asc">Age</SortableTh>
                  <SortableTh sortKey="ovr" sort={targetSort.sort} onSort={targetSort.toggle} className="text-end">Ovr</SortableTh>
                  <SortableTh sortKey="pot" sort={targetSort.sort} onSort={targetSort.toggle} className="text-end">Pot <PotHelp /></SortableTh>
                  <SortableTh sortKey="club" sort={targetSort.sort} onSort={targetSort.toggle} defaultDir="asc">Club</SortableTh>
                  <SortableTh sortKey="wage" sort={targetSort.sort} onSort={targetSort.toggle} className="text-end">Wage</SortableTh>
                  <SortableTh sortKey="fee" sort={targetSort.sort} onSort={targetSort.toggle} className="text-end">Fee</SortableTh>
                  <th />
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.player.pid}>
                    <td>
                      <PlayerRatingsTooltip player={t.player}>
                        <Link to={`/player/${t.player.pid}`}>{t.player.name}</Link>
                      </PlayerRatingsTooltip>{" "}
                      <Flag nationality={t.player.nationality} />
                    </td>
                    <td>{t.player.pos}</td>
                    <td className="text-end">{league.season - t.player.born}</td>
                    <td className="text-end">{t.player.ovr}</td>
                    <td className="text-end"><PotDisplay player={t.player} /></td>
                    <td><ClubLink tid={t.parentTid} /></td>
                    <td className="text-end">{formatWeeklyWage(t.player.contract.salary)}</td>
                    <td className="text-end">{currency.format(t.fee)}</td>
                    <td className="text-end">
                      {t.available ? (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={simming}
                          onClick={() => requestLoanAction(t.player.pid, targetSeasons)}
                        >
                          Loan him in
                        </button>
                      ) : (
                        <span className="text-muted small fst-italic text-nowrap">
                          {t.unavailableReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Your Loan Listings</h5>
          {league.loanListings.length === 0 ? (
            <p className="text-muted mb-0">No players currently listed for loan.</p>
          ) : (
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-end">Seasons</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {league.loanListings.map((listing) => {
                  const p = playerName(listing.pid);
                  return (
                    <tr key={listing.pid}>
                      <td>{p ? p.name : `Player ${listing.pid}`}</td>
                      <td className="text-end">{listing.seasons}</td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          disabled={simming}
                          onClick={() => unlistPlayerForLoanAction(listing.pid)}
                        >
                          Unlist
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">List a Player for Loan</h5>
          {eligible.length === 0 ? (
            <p className="text-muted mb-0">Nothing eligible to list right now.</p>
          ) : (
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <SortableTh sortKey="name" sort={eligibleSort.sort} onSort={eligibleSort.toggle} defaultDir="asc">Name</SortableTh>
                  <SortableTh sortKey="pos" sort={eligibleSort.sort} onSort={eligibleSort.toggle} defaultDir="asc">Pos</SortableTh>
                  <SortableTh sortKey="age" sort={eligibleSort.sort} onSort={eligibleSort.toggle} className="text-end" defaultDir="asc">Age</SortableTh>
                  <SortableTh sortKey="ovr" sort={eligibleSort.sort} onSort={eligibleSort.toggle} className="text-end">Ovr</SortableTh>
                  <SortableTh sortKey="pot" sort={eligibleSort.sort} onSort={eligibleSort.toggle} className="text-end">Pot <PotHelp /></SortableTh>
                  <SortableTh sortKey="wage" sort={eligibleSort.sort} onSort={eligibleSort.toggle} className="text-end">Wage</SortableTh>
                  <th>Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {eligible.map((p) => (
                  <tr key={p.pid}>
                    <td>
                      <PlayerRatingsTooltip player={p}>{p.name}</PlayerRatingsTooltip>{" "}
                      <Flag nationality={p.nationality} />
                    </td>
                    <td>{p.pos}</td>
                    <td className="text-end">{league.season - p.born}</td>
                    <td className="text-end">{p.ovr}</td>
                    <td className="text-end"><PotDisplay player={p} /></td>
                    <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                    <td>
                      {allowedSeasons(p) === 0 ? (
                        <span className="text-muted small">Contract runs out first</span>
                      ) : (
                        <select
                          className="form-select form-select-sm"
                          style={{ width: "auto" }}
                          value={draftFor(p)}
                          onChange={(e) =>
                            setDraftSeasons((d) => ({ ...d, [p.pid]: Number(e.target.value) as 1 | 2 | 3 }))
                          }
                        >
                          {SEASON_OPTIONS.filter((s) => s <= allowedSeasons(p)).map((s) => (
                            <option key={s} value={s}>
                              {s} season{s > 1 ? "s" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="text-end">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={simming || !ws.open || allowedSeasons(p) === 0}
                        title={
                          allowedSeasons(p) === 0
                            ? "His contract is up before a loan could even start. Extend him first."
                            : allowedSeasons(p) < LOAN_MAX_SEASONS
                              ? "A loan can't run past his contract. Extend him first if you want to send him out for longer."
                              : undefined
                        }
                        onClick={() => listPlayerForLoanAction(p.pid, draftFor(p))}
                      >
                        List for Loan
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          {/* A loan moves the pid onto the loanee's roster, so this is the only
              page these players appear on — the Roster page's own "Extend all"
              can't reach them. */}
          <div className="d-flex flex-wrap gap-2 justify-content-between align-items-start">
            <h5 className="card-title">Players Out on Loan</h5>
            <ExtendAllButton
              count={renewals?.pids.length ?? 0}
              totalSalary={renewals?.totalSalary ?? 0}
              disabled={simming}
              onExtendAll={() => { void extendAllContractsAction("loanedOut"); }}
            />
          </div>
          {outOnLoan.length === 0 ? (
            <p className="text-muted mb-0">None of your players are currently out on loan.</p>
          ) : (
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Loanee Club</th>
                  <th className="text-end">Returns</th>
                  <th className="text-end">Contract</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {outOnLoan.map((l) => {
                  const p = playerName(l.pid);
                  return (
                    <tr key={l.pid}>
                      <td>
                        {p ? (
                          <Link to={`/player/${p.pid}`}>{p.name}</Link>
                        ) : (
                          `Player ${l.pid}`
                        )}
                      </td>
                      <td><ClubLink tid={l.loaneeTid} /></td>
                      <td className="text-end">{seasonYear(l.returnSeason)}</td>
                      <td className="text-end">
                        {!p ? "" : p.contract.expiresSeason <= league.season ? (
                          <span
                            className="badge bg-warning text-dark"
                            title="His deal runs out this season. He's still yours to extend while he's away. Leave it and he walks the moment he gets back."
                          >
                            Final year
                          </span>
                        ) : (
                          `Through ${seasonYear(p.contract.expiresSeason)}`
                        )}
                      </td>
                      <td className="text-end">
                        {p && canExtend(p, league.season) && (
                          wouldRefuseExtension(p, userTeam, league.competitions) ? (
                            <span
                              className="text-muted small fst-italic text-nowrap"
                              title="He's holding out for a move to Division 1 and won't sign a new deal here."
                            >
                              Wants a move to Division 1
                            </span>
                          ) : (
                            <ExtendControl
                              player={p}
                              season={league.season}
                              onExtend={extendContractAction}
                            />
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {/* Players you're borrowing. They sit on your roster and play for you,
              but the contract is someone else's — so there's no Extend column
              here, and the Roster page won't offer to sell or release them. */}
          <h5 className="card-title">Players In on Loan</h5>
          {inOnLoan.length === 0 ? (
            <p className="text-muted mb-0">You don&apos;t have anyone in on loan.</p>
          ) : (
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Parent Club</th>
                  <th className="text-end">Goes back</th>
                  <th className="text-end">Wage</th>
                </tr>
              </thead>
              <tbody>
                {inOnLoan.map((l) => {
                  const p = playerName(l.pid);
                  return (
                    <tr key={l.pid}>
                      <td>
                        {p ? (
                          <Link to={`/player/${p.pid}`}>{p.name}</Link>
                        ) : (
                          `Player ${l.pid}`
                        )}
                      </td>
                      <td><ClubLink tid={l.parentTid} /></td>
                      <td className="text-end">{seasonYear(l.returnSeason)}</td>
                      <td className="text-end">
                        {p ? formatWeeklyWage(p.contract.salary) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
