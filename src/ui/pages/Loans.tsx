import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import { transferWindowState } from "../../core/transfers/window.js";
import type { Player } from "../../core/players/types.js";
import { loanOfferCandidates, maxLoanSeasons } from "../../core/loans.js";
import { WINTER_WINDOW_OPEN_MATCHDAY } from "../../core/calendar.js";
import { LOAN_MAX_SEASONS } from "../../core/constants.js";
import { canExtend } from "../../core/contracts.js";
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

export function Loans() {
  const {
    league, listPlayerForLoanAction, unlistPlayerForLoanAction,
    acceptLoanOfferAction, rejectLoanOfferAction, extendContractAction,
    extendAllContractsAction, simming,
  } = useLeague();
  const [draftSeasons, setDraftSeasons] = useState<Record<number, 1 | 2 | 3>>({});
  const offerSort = useTableSort<LoanOfferSortKey>("default", "desc");
  const eligibleSort = useTableSort<EligibleSortKey>("ovr", "desc");
  const potView = usePotentialView();

  const rawOffers = useMemo(() => (league ? loanOfferCandidates(league) : []), [league]);
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
    pot: (c) => c.player.potential,
    club: (c) => teamName(c.buyerTid),
    seasons: (c) => c.seasons,
    fee: (c) => c.fee,
  });

  const listedPids = new Set(league.loanListings.map((l) => l.pid));
  const eligible = sortRows(
    userTeam.roster
      .map((pid) => league.players.find((p) => p.pid === pid))
      .filter((p): p is NonNullable<typeof p> => p != null && !listedPids.has(p.pid)),
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

  return (
    <div className="container-fluid p-3">
      <h4>
        Loans
        <HelpHint>
          Send a player to another club for 1&ndash;3 seasons to get him minutes he isn't getting
          with you, and minutes drive development. List a player, then accept or reject the flat-fee
          loan offers that come in. He comes back on his own when the loan ends. His contract
          stays yours the whole time, so you can still extend him while he&apos;s away, from the
          list at the bottom of this page.
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

      <div className="card">
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
                      <td className="text-end">Season {l.returnSeason}</td>
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
    </div>
  );
}
