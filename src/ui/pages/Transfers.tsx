import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { useDebounced } from "../useDebounced.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { transferWindowState } from "../../core/transfers/window.js";
import {
  recommendedTransfers,
  searchWorldPlayers,
  PLAYER_SEARCH_LIMIT,
} from "../../core/transfers/recommendations.js";
import {
  acquisitionWageCharge,
  currentNegotiations,
  isFreeAgentTid,
  type TransferNegotiation,
} from "../../core/transfers/negotiation.js";
import { WINTER_WINDOW_OPEN_MATCHDAY } from "../../core/calendar.js";
import { clubDisplayName, currency, formatWeeklyWage, talksCollapsedMessage } from "../format.js";
import { WatchToggle } from "../components/WatchToggle.js";
import { Flag } from "../components/Flag.js";
import { OfferAmountInput } from "../components/OfferAmountInput.js";
import { ClauseEditor } from "../components/ClauseEditor.js";
import type { ProposedClause } from "../../core/transfers/clauses.js";
import { clausesAreValid } from "../../core/transfers/clauses.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PlayerRefLink, usePlayerRefs } from "../components/PlayerRefLink.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import {
  PlayerFilterBar,
  EMPTY_PLAYER_FILTERS,
  hasAnyFilter,
  toSearchFilters,
  type PlayerFilterState,
} from "../components/PlayerFilterBar.js";
import { ROSTER_CAP, WINDOW_TRANSFER_LIMIT } from "../../core/constants.js";

// The column sort keys the two tables share, plus each one's "as ranked"
// sentinel: "recommended" is the shortlist's best-fit order and "rank" the
// search's own ovr ranking. Neither has an accessor, so sortRows leaves that
// order alone until the user actually clicks a header.
type ColumnSortKey = "name" | "pos" | "age" | "ovr" | "pot" | "club" | "wage" | "value";
type TargetSortKey = ColumnSortKey | "recommended";
type SearchSortKey = ColumnSortKey | "rank";

/** One recommended-transfer row (player + who's selling + scout value). */
type TargetRow = ReturnType<typeof recommendedTransfers>[number];

function windowBanner(league: LeagueStore): React.ReactNode {
  const ws = transferWindowState(league);
  if (ws.open) {
    const label = ws.window === "summer" ? "Summer" : "Winter";
    const until =
      league.phase === "offseason"
        ? `open through matchday ${ws.closesAfterMatchday} of next season`
        : `closes after matchday ${ws.closesAfterMatchday}`;
    return (
      <div className="alert alert-success mb-3">
        <strong>{label} transfer window is open</strong>. {until}.
      </div>
    );
  }
  return (
    <div className="alert alert-secondary mb-3">
      <strong>Transfer window closed.</strong> The winter window opens once
      matchday {WINTER_WINDOW_OPEN_MATCHDAY - 1} is played and closes after the
      deadline; the summer window runs through the offseason and August.
    </div>
  );
}

interface NegotiationControlsProps {
  pid: number;
  negotiation: TransferNegotiation | undefined;
  suggested: number;
  budget: number;
  /** Season wages charged on top of the fee for a mid-season buy. */
  wageCharge: number;
  disabled: boolean;
  /** The user's own club: buying, he is the one who would owe on an add-on. */
  userTid: number;
  onOffer: (pid: number, amount: number, clauses: ProposedClause[]) => void;
  onAcceptCounter: (pid: number, clauses: ProposedClause[]) => void;
}

function NegotiationControls({
  pid, negotiation, suggested, budget, wageCharge, disabled, userTid, onOffer, onAcceptCounter,
}: NegotiationControlsProps) {
  const [draft, setDraft] = useState(() => String(suggested));
  const [clauses, setClauses] = useState<ProposedClause[]>([]);

  if (negotiation?.status === "accepted") {
    return <span className="text-success">Transferred</span>;
  }
  if (negotiation?.status === "collapsed") {
    return <span className="text-danger">{talksCollapsedMessage(pid)}</span>;
  }

  const lastOffer = negotiation?.offers.at(-1);
  // A repeat offer at or below the best one so far ends talks for the window,
  // so refuse to send one instead of letting a stray re-click collapse them.
  const bestOffer =
    negotiation && negotiation.offers.length > 0 ? Math.max(...negotiation.offers) : null;
  const draftValue = Number(draft);
  const notImproving = bestOffer !== null && draftValue <= bestOffer;
  const offerValid =
    draft !== "" && Number.isFinite(draftValue) && draftValue > 0
    && draftValue + wageCharge <= budget && !notImproving
    && clausesAreValid(clauses, draftValue);

  // Quick-pick amounts anchored to whatever the next valid bid must clear.
  const floor = negotiation?.counter ?? bestOffer ?? suggested;
  const quickAmounts = [floor, Math.round(floor * 1.1), Math.round(floor * 1.25)]
    .filter((amt) => amt + wageCharge <= budget);

  return (
    <div className="d-flex flex-column gap-1">
      {negotiation && (
        <small className="text-muted">
          Your offer: {currency.format(lastOffer ?? 0)}
          {negotiation.counter !== null && (
            <> &middot; Counter: <strong>{currency.format(negotiation.counter)}</strong></>
          )}
          {notImproving && <> &middot; bid more than your last offer</>}
        </small>
      )}
      <div className="d-flex gap-1 align-items-center">
        <OfferAmountInput
          value={draft}
          onChange={setDraft}
          quickAmounts={quickAmounts}
          disabled={disabled}
        />
        <button
          className="btn btn-sm btn-primary"
          disabled={disabled || !offerValid}
          title={notImproving ? "Must improve on your previous offer" : undefined}
          onClick={() => onOffer(pid, draftValue, clauses)}
        >
          Offer
        </button>
        {negotiation?.counter != null && (
          <button
            className="btn btn-sm btn-success text-nowrap"
            disabled={disabled || negotiation.counter + wageCharge > budget}
            onClick={() => onAcceptCounter(pid, clauses)}
          >
            Accept {currency.format(negotiation.counter)}
          </button>
        )}
      </div>
      {/* Buying, the add-ons are yours to owe — so they buy the asking price
          down rather than up. */}
      <ClauseEditor
        pid={pid}
        obligorTid={userTid}
        // An empty box makes draftValue NaN, which would propagate through the
        // pricing and render "NaN" in the panel. The button is already disabled
        // in that state, so 0 just keeps the copy sane until something is typed.
        baseFee={negotiation?.counter ?? (Number.isFinite(draftValue) ? draftValue : 0)}
        value={clauses}
        onChange={setClauses}
        disabled={disabled}
        direction="buying"
      />
    </div>
  );
}

export function Transfers() {
  const { league, makeOfferAction, acceptCounterAction, simming } = useLeague();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [filters, setFilters] = useState<PlayerFilterState>(EMPTY_PLAYER_FILTERS);
  const [search, setSearch] = useState<PlayerFilterState>(EMPTY_PLAYER_FILTERS);
  // The search's own two controls, which the shared bar doesn't carry: a name
  // box (only this panel looks players up by name) and the for-sale toggle
  // (the shortlist never shows an unbuyable player in the first place).
  const [searchName, setSearchName] = useState("");
  const [forSaleOnly, setForSaleOnly] = useState(false);
  const { sort, toggle } = useTableSort<TargetSortKey>("recommended", "desc");
  const searchSort = useTableSort<SearchSortKey>("rank", "desc");

  const hasFilters = hasAnyFilter(filters);
  // "For sale only" isn't a search on its own — by itself it still describes
  // most of the world, so the core treats it as a narrowing, not a query.
  const hasSearch = searchName.trim() !== "" || hasAnyFilter(search);

  const clearSearch = () => {
    setSearch(EMPTY_PLAYER_FILTERS);
    setSearchName("");
    setForSaleOnly(false);
  };

  // Both scans below walk every club's roster, so they run off *debounced*
  // copies of the filter state: the inputs stay bound to the raw state (typing
  // is instant) while the scan itself waits until the user stops. Keying them
  // straight off the raw state meant one full-world scan per keystroke, which
  // is what pushed this page's INP into the seconds on mobile.
  const debouncedFilters = useDebounced(filters);
  const debouncedSearch = useDebounced(search);
  const debouncedName = useDebounced(searchName);

  // Filters feed into the search itself (not a post-hoc row filter), so
  // changing one re-runs the candidate scan and surfaces genuinely new
  // targets — e.g. picking "FB" brings up a fresh list of full-backs. The
  // full-league scan is memoized so unrelated renders (typing an offer) don't
  // redo it; it re-runs only when the league, refresh, or a filter changes.
  const targets = useMemo(() => {
    if (!league) return [];
    return recommendedTransfers(league, refreshNonce, toSearchFilters(debouncedFilters, league.competitions));
  }, [league, refreshNonce, debouncedFilters]);

  // Free-form world search: scans every club, so it's memoized to stay off the
  // path of unrelated renders (typing an offer amount). Empty until the user
  // sets a name or filter (see searchWorldPlayers).
  const searchResults = useMemo(() => {
    if (!league) return [];
    return searchWorldPlayers(league, {
      ...toSearchFilters(debouncedSearch, league.competitions),
      name: debouncedName,
      forSaleOnly,
    });
  }, [league, debouncedSearch, debouncedName, forSaleOnly]);

  // Players bought earlier *this visit*. A completed buy moves the player onto
  // your roster, so he drops out of the recommended scan and his row would just
  // vanish. We keep it pinned at the same index (with a "Transferred" badge)
  // instead. Local state, not the persisted negotiation, so the row is gone the
  // next time you open the page — exactly once, right after the buy.
  const [pinnedBuys, setPinnedBuys] = useState<{ row: TargetRow; index: number }[]>([]);
  // Snapshot of the rows shown last render, so when a buy drops a player out of
  // the fresh scan we can recover his row and its position from before.
  const prevTargetsRef = useRef<TargetRow[]>([]);

  useEffect(() => {
    const negs = league ? currentNegotiations(league) : [];
    const pinnedPids = new Set(pinnedBuys.map((b) => b.row.player.pid));
    const additions = negs.flatMap((n) => {
      if (n.status !== "accepted" || pinnedPids.has(n.pid)) return [];
      const idx = prevTargetsRef.current.findIndex((t) => t.player.pid === n.pid);
      return idx >= 0 ? [{ row: prevTargetsRef.current[idx], index: idx }] : [];
    });
    prevTargetsRef.current = targets;
    if (additions.length > 0) setPinnedBuys((prev) => [...prev, ...additions]);
  }, [league, targets, pinnedBuys]);

  // Lookup maps over the whole world, memoized because they were being rebuilt
  // on every render of this page — 10500-odd players and 420 clubs at a time,
  // including on every keystroke in an offer box. `teamNameByTid` also replaces
  // a linear `teams.find` that the club-column sort accessor called once per
  // comparison.
  const playerMap = useMemo(
    () => new Map((league?.players ?? []).map((p) => [p.pid, p])),
    [league?.players],
  );
  // Covers retirees too — the completed-transfer log outlives the players in it.
  const refOf = usePlayerRefs();
  const teamNameByTid = useMemo(
    () => new Map((league?.teams ?? []).map((t) => [t.tid, t.name])),
    [league?.teams],
  );
  const teamName = useCallback(
    (tid: number) => clubDisplayName(tid, (id) => teamNameByTid.get(id)),
    [teamNameByTid],
  );
  const negotiations = useMemo(
    () => (league ? currentNegotiations(league) : []),
    [league],
  );

  // The nationality dropdown is built from the world rather than from the
  // static nationality tables: a save only ever contains the countries its
  // leagues draw from, and offering the other fifty as options that match
  // nobody is worse than offering none. One pass over the pool, memoized —
  // it runs on the same 8000-player array as the maps above.
  const nationalities = useMemo(() => {
    const seen = new Set<string>();
    for (const p of league?.players ?? []) seen.add(p.nationality);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [league?.players]);
  const competitions = useMemo(() => league?.competitions ?? [], [league?.competitions]);

  // Splice players bought this visit back into the list at their original row,
  // so the row appears to stay put and flip to "Transferred" rather than jump
  // to the top or disappear. (See `pinnedBuys` above for the once-per-visit
  // lifetime.) Then apply the chosen column sort on top: the default
  // "recommended" key has no accessor, so sortRows leaves the pinned best-fit
  // order (and bought-row positions) untouched; any other key sorts the whole
  // list, pinned buys included.
  const displayTargets = useMemo(() => {
    const pinnedPids = new Set(pinnedBuys.map((b) => b.row.player.pid));
    const baseTargets = targets.filter((t) => !pinnedPids.has(t.player.pid));
    for (const { row, index } of [...pinnedBuys].sort((a, b) => a.index - b.index)) {
      baseTargets.splice(Math.min(index, baseTargets.length), 0, row);
    }
    const season = league?.season ?? 0;
    return sortRows(baseTargets, sort, {
      name: (r) => r.player.name,
      pos: (r) => r.player.pos,
      age: (r) => season - r.player.born,
      ovr: (r) => r.player.ovr,
      pot: (r) => r.player.potential,
      club: (r) => teamName(r.sellerTid),
      wage: (r) => r.player.contract.salary,
      value: (r) => r.scoutedValue,
    });
  }, [targets, pinnedBuys, sort, league?.season, teamName]);

  // Same column sort for the search table. Its default "rank" key has no
  // accessor either, so until a header is clicked the rows stay in the order
  // the core ranked them (ovr descending, which is also what the row cap slices
  // on — see PLAYER_SEARCH_LIMIT).
  const displaySearchResults = useMemo(() => {
    const season = league?.season ?? 0;
    return sortRows(searchResults, searchSort.sort, {
      name: (r) => r.player.name,
      pos: (r) => r.player.pos,
      age: (r) => season - r.player.born,
      ovr: (r) => r.player.ovr,
      pot: (r) => r.player.potential,
      club: (r) => teamName(r.sellerTid),
      wage: (r) => r.player.contract.salary,
      value: (r) => r.scoutedValue,
    });
  }, [searchResults, searchSort.sort, league?.season, teamName]);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!userTeam) {
    return <p className="p-3">Team not found.</p>;
  }

  const ws = transferWindowState(league);
  const atCap = userTeam.roster.length >= ROSTER_CAP;
  const negotiationByPid = new Map(negotiations.map((n) => [n.pid, n]));

  // Talks that outlived the recommended list (e.g. the budget shrank after a
  // signing, or the current filters exclude the player) still need controls
  // somewhere. A player currently shown in the search results already has
  // controls there, so he doesn't also need an "Other Negotiations" row.
  const listedPids = new Set([
    ...targets.map((t) => t.player.pid),
    ...searchResults.filter((r) => r.forSale).map((r) => r.player.pid),
  ]);
  const orphaned = negotiations.filter(
    (n) => !listedPids.has(n.pid) && n.status !== "accepted",
  );

  const allWindowTransfers = league.transfers.filter(
    (t) =>
      ws.open && t.season === ws.season && t.window === ws.window &&
      // Routine AI free-agent churn is recorded for history but not shown as
      // window activity; the user's own free signings still show.
      (!isFreeAgentTid(t.fromTid) || t.toTid === league.meta.userTid),
  );

  // This list used to render every transfer in the window, which is what froze
  // the page: a 240-club world moves thousands of players per summer, and a real
  // save measured **2056 rows / 2066 flag images / 10684 DOM elements**, pulling
  // ~1 MB of SVG flag art (some single flags are 150-240 KB of coat-of-arms
  // detail, drawn at 13px). The JS is fast — 147ms — so this never showed up in
  // any profiling of the page's logic; the cost is all layout, image decode and
  // paint, and it is why /transfers froze when no other page did.
  //
  // Your own club's business always shows. The rest is capped to the biggest
  // remaining deals, which is the interesting part of a window anyway, with the
  // News Feed carrying the full record.
  const isUserDeal = (t: (typeof allWindowTransfers)[number]) =>
    t.fromTid === league.meta.userTid || t.toTid === league.meta.userTid;
  const userDeals = allWindowTransfers.filter(isUserDeal);
  const otherDeals = allWindowTransfers
    .filter((t) => !isUserDeal(t))
    .sort((a, b) => b.fee - a.fee)
    .slice(0, Math.max(0, WINDOW_TRANSFER_LIMIT - userDeals.length));
  const windowTransfers = [...userDeals, ...otherDeals];
  const hiddenTransfers = allWindowTransfers.length - windowTransfers.length;

  return (
    <div className="container-fluid p-3">
      <h4>Transfers</h4>
      {windowBanner(league)}

      <p>
        Budget: <strong>{currency.format(userTeam.budget)}</strong>
        {" "}&middot; Scout valuations tighten with scouting spend (set on the Dashboard).
        {" "}&middot; Roster: <strong>{userTeam.roster.length}/{ROSTER_CAP}</strong>
      </p>
      {atCap && (
        <div className="alert alert-warning">
          Your roster is full ({ROSTER_CAP}/{ROSTER_CAP}). Release a player before buying another.
        </div>
      )}

      {ws.open && (
        <div className="card mb-3">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start">
              <h5 className="card-title">Recommended Transfers</h5>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setRefreshNonce((n) => n + 1)}
              >
                Refresh
              </button>
            </div>
            <p className="card-text text-muted">
              Players near your team&apos;s level, within budget. The scout
              valuation is your baseline for offers — the selling club&apos;s
              real price may differ.
              {league.phase === "regular" && (
                <> Mid-season buys also charge the player&apos;s season wages
                on top of the fee.</>
              )}
            </p>
            <PlayerFilterBar
              idPrefix="rt"
              value={filters}
              onChange={setFilters}
              onClear={() => setFilters(EMPTY_PLAYER_FILTERS)}
              nationalities={nationalities}
              competitions={competitions}
            />
            {displayTargets.length === 0 ? (
              <p className="mb-0">
                {hasFilters
                  ? "No available targets match these filters. Try widening them or hit Refresh."
                  : "No suitable targets found."}
              </p>
            ) : (
              <table className="table table-striped table-sm align-middle">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
                    <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
                    <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Age</SortableTh>
                    <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">Ovr</SortableTh>
                    <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">Pot <PotHelp /></SortableTh>
                    <SortableTh sortKey="club" sort={sort} onSort={toggle} defaultDir="asc">Club</SortableTh>
                    <SortableTh sortKey="wage" sort={sort} onSort={toggle} className="text-end">Wage</SortableTh>
                    <SortableTh sortKey="value" sort={sort} onSort={toggle} className="text-end">
                      Scout value
                      <HelpHint>
                        Our scouts' estimate of this player's transfer value. It's an estimate, not
                        the exact asking price. More scouting spend makes it more accurate (it can be
                        off by up to &plusmn;35% at &pound;0 spend, down to about &plusmn;5% at the max).
                      </HelpHint>
                    </SortableTh>
                    <th>Offer</th>
                  </tr>
                </thead>
                <tbody>
                  {displayTargets.map(({ player: p, sellerTid, scoutedValue }) => (
                    <tr key={p.pid}>
                      <td><WatchToggle pid={p.pid} name={p.name} /></td>
                      <td>
                        <PlayerRatingsTooltip player={p}>
                          <Link to={`/player/${p.pid}`}>{p.name}</Link>
                        </PlayerRatingsTooltip>{" "}
                        <Flag nationality={p.nationality} />
                      </td>
                      <td>{p.pos}</td>
                      <td className="text-end">{league.season - p.born}</td>
                      <td className="text-end">{p.ovr}</td>
                      <td className="text-end"><PotDisplay player={p} /></td>
                      <td><ClubLink tid={sellerTid} /></td>
                      <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                      <td className="text-end">{currency.format(scoutedValue)}</td>
                      <td>
                        <NegotiationControls
                          pid={p.pid}
                          negotiation={negotiationByPid.get(p.pid)}
                          suggested={scoutedValue}
                          budget={userTeam.budget}
                          wageCharge={acquisitionWageCharge(league, p)}
                          disabled={simming || atCap}
                          userTid={league.meta.userTid}
                          onOffer={makeOfferAction}
                          onAcceptCounter={acceptCounterAction}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {ws.open && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">Search all players</h5>
            <p className="card-text text-muted">
              Look up any player in the world by name or filters and bid on him
              directly — not just the recommended shortlist. A club won&apos;t part
              with a player it needs for depth, and the very best players at
              successful clubs simply aren&apos;t for sale at any price.
            </p>
            <PlayerFilterBar
              idPrefix="ps"
              value={search}
              onChange={setSearch}
              onClear={clearSearch}
              nationalities={nationalities}
              competitions={competitions}
            >
              <div>
                <label className="form-label small mb-0" htmlFor="ps-name">Name</label>
                <input
                  id="ps-name"
                  type="text"
                  className="form-control form-control-sm"
                  style={{ width: "12rem" }}
                  placeholder="Search by name"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                />
              </div>
            </PlayerFilterBar>
            <div className="form-check form-switch mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="ps-for-sale"
                checked={forSaleOnly}
                onChange={(e) => setForSaleOnly(e.target.checked)}
              />
              <label className="form-check-label small" htmlFor="ps-for-sale">
                Only show players I can actually bid on
              </label>
            </div>
            {!hasSearch ? (
              <p className="mb-0 text-muted">
                Enter a name or set a filter to search the whole world.
              </p>
            ) : searchResults.length === 0 ? (
              <p className="mb-0">No players match your search.</p>
            ) : (
              <table className="table table-striped table-sm align-middle">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTh sortKey="name" sort={searchSort.sort} onSort={searchSort.toggle} defaultDir="asc">Name</SortableTh>
                    <SortableTh sortKey="pos" sort={searchSort.sort} onSort={searchSort.toggle} defaultDir="asc">Pos</SortableTh>
                    <SortableTh sortKey="age" sort={searchSort.sort} onSort={searchSort.toggle} className="text-end" defaultDir="asc">Age</SortableTh>
                    <SortableTh sortKey="ovr" sort={searchSort.sort} onSort={searchSort.toggle} className="text-end">Ovr</SortableTh>
                    <SortableTh sortKey="pot" sort={searchSort.sort} onSort={searchSort.toggle} className="text-end">Pot <PotHelp /></SortableTh>
                    <SortableTh sortKey="club" sort={searchSort.sort} onSort={searchSort.toggle} defaultDir="asc">Club</SortableTh>
                    <SortableTh sortKey="wage" sort={searchSort.sort} onSort={searchSort.toggle} className="text-end">Wage</SortableTh>
                    <SortableTh sortKey="value" sort={searchSort.sort} onSort={searchSort.toggle} className="text-end">Scout value</SortableTh>
                    <th>Offer</th>
                  </tr>
                </thead>
                <tbody>
                  {displaySearchResults.map(({ player: p, sellerTid, scoutedValue, forSale, notForSaleReason }) => (
                    <tr key={p.pid}>
                      <td><WatchToggle pid={p.pid} name={p.name} /></td>
                      <td>
                        <PlayerRatingsTooltip player={p}>
                          <Link to={`/player/${p.pid}`}>{p.name}</Link>
                        </PlayerRatingsTooltip>{" "}
                        <Flag nationality={p.nationality} />
                      </td>
                      <td>{p.pos}</td>
                      <td className="text-end">{league.season - p.born}</td>
                      <td className="text-end">{p.ovr}</td>
                      <td className="text-end"><PotDisplay player={p} /></td>
                      <td><ClubLink tid={sellerTid} /></td>
                      <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                      <td className="text-end">{currency.format(scoutedValue)}</td>
                      <td>
                        {forSale ? (
                          <NegotiationControls
                            pid={p.pid}
                            negotiation={negotiationByPid.get(p.pid)}
                            suggested={scoutedValue}
                            budget={userTeam.budget}
                            wageCharge={acquisitionWageCharge(league, p)}
                            disabled={simming || atCap}
                            userTid={league.meta.userTid}
                            onOffer={makeOfferAction}
                            onAcceptCounter={acceptCounterAction}
                          />
                        ) : (
                          <span className="text-muted small">{notForSaleReason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {hasSearch && searchResults.length >= PLAYER_SEARCH_LIMIT && (
              <p className="text-muted small mb-0">
                Showing the top {PLAYER_SEARCH_LIMIT} by overall — narrow your
                filters to see more specific targets.
              </p>
            )}
          </div>
        </div>
      )}

      {orphaned.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">Other Negotiations</h5>
            <table className="table table-sm align-middle">
              <tbody>
                {orphaned.map((n) => {
                  const p = playerMap.get(n.pid);
                  if (!p) return null;
                  return (
                    <tr key={n.pid}>
                      <td>
                        <PlayerRatingsTooltip player={p}>
                          <Link to={`/player/${p.pid}`}>{p.name}</Link>
                        </PlayerRatingsTooltip>{" "}
                        <Flag nationality={p.nationality} /> ({p.pos}, <ClubLink tid={n.sellerTid} />)
                      </td>
                      <td>
                        <NegotiationControls
                          pid={n.pid}
                          negotiation={n}
                          suggested={n.counter ?? n.offers.at(-1) ?? 0}
                          budget={userTeam.budget}
                          wageCharge={acquisitionWageCharge(league, p)}
                          disabled={simming || atCap}
                          userTid={league.meta.userTid}
                          onOffer={makeOfferAction}
                          onAcceptCounter={acceptCounterAction}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {windowTransfers.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">Completed This Window</h5>
            {hiddenTransfers > 0 && (
              <p className="card-text text-muted">
                Your own deals, plus the {otherDeals.length} biggest elsewhere.{" "}
                {hiddenTransfers.toLocaleString()} more went through around the
                league &mdash; the <Link to="/news">News Feed</Link> has the lot.
              </p>
            )}
            <ul className="mb-0">
              {windowTransfers.map((t, i) => {
                const ref = refOf(t.pid);
                return (
                  <li key={i}>
                    <PlayerRefLink pid={t.pid} fallback={`Player ${t.pid}`} />{" "}
                    {ref && <Flag nationality={ref.nationality} />} — <ClubLink tid={t.fromTid} season={t.season} /> →{" "}
                    <ClubLink tid={t.toTid} season={t.season} /> for {currency.format(t.fee)}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
