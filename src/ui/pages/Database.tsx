import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { Flag } from "../components/Flag.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { PotHelp } from "../components/HelpHint.js";
import { PlayerRatingsTooltip, SKILL_ABBREV, SKILL_LABELS } from "../components/PlayerRatingsTooltip.js";
import { Pagination } from "../components/Pagination.js";
import { WatchToggle } from "../components/WatchToggle.js";
import {
  EMPTY_PLAYER_FILTERS, PlayerFilterBar, hasAnyFilter, moneyFilter, toSearchFilters,
  type PlayerFilterState,
} from "../components/PlayerFilterBar.js";
import { SortableTh, sortRows, useTableSort } from "../components/SortableTable.js";
import { usePotentialView } from "../potentialView.js";
import { currencyCompact, formatWeeklyWage } from "../format.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { SKILL_KEYS } from "../../core/players/types.js";
import {
  PLAYER_DB_PAGE_SIZE, buildPlayerRows, filterPlayerRows, pageCount, pageOf,
  playerSortAccessors,
  type PlayerColumnSet, type PlayerDbRow, type PlayerSortKey, type PlayerStatus,
  type PlayerStatusFilter,
} from "../playerDatabase.js";

/**
 * The world in a table: every player, and (from the Clubs tab) every club,
 * filtered and sorted on any column.
 *
 * Two things shape this page and neither is negotiable.
 *
 * **It pages.** A 626-club world holds 15,650 players, and this app's one known
 * performance failure is DOM weight rather than JavaScript — the /transfers
 * freeze was 10,684 elements at a 147ms JS render. So the table shows
 * PLAYER_DB_PAGE_SIZE rows at a time, the parallel numeric columns are plain
 * text, and the only art per row is the one flag on the name.
 *
 * **The filters constrain the scan, not the rendered rows.** Filter, then sort,
 * then slice — filtering after the slice would show "the first hundred of
 * whatever ranked globally", which looks right and is not.
 */

const COLUMN_SETS: { key: PlayerColumnSet; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "attributes", label: "Attributes" },
];

const STATUS_OPTIONS: { key: PlayerStatusFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "contracted", label: "At a club" },
  { key: "free", label: "Free agents" },
  { key: "academy", label: "Youth academies" },
];

const STATUS_BADGE: Record<PlayerStatus, string | null> = {
  senior: null,
  academy: "Academy",
  trial: "On trial",
  free: "Free agent",
};

export function Database() {
  const { tab } = useParams<{ tab: string }>();
  const players = tab !== "clubs";
  return (
    <div className="container-fluid p-3">
      <h4>Database</h4>
      <p className="text-muted">
        Every player and club in the world, sortable on any column. Click a heading
        to sort by it.
      </p>
      <ul className="nav nav-pills mb-3">
        <li className="nav-item">
          <Link className={`nav-link ${players ? "active" : ""}`} to="/database/players">
            Players
          </Link>
        </li>
        <li className="nav-item">
          <Link className={`nav-link ${players ? "" : "active"}`} to="/database/clubs">
            Clubs
          </Link>
        </li>
      </ul>
      {players ? <PlayerDatabase /> : <ClubsPlaceholder />}
    </div>
  );
}

function ClubsPlaceholder() {
  return <p className="text-muted">The club table lands next.</p>;
}

function PlayerDatabase() {
  const { league } = useLeague();
  const potView = usePotentialView();
  const [filters, setFilters] = useState<PlayerFilterState>(EMPTY_PLAYER_FILTERS);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<PlayerStatusFilter>("all");
  // In the URL rather than in state, so a view can be linked to and — the
  // reason it went in now — so a render test can reach the widest column set.
  // Anything unrecognised reads as the overview, never as a blank table.
  const [params, setParams] = useSearchParams();
  const columns: PlayerColumnSet = params.get("cols") === "attributes" ? "attributes" : "overview";
  const setColumns = (next: PlayerColumnSet) => {
    const updated = new URLSearchParams(params);
    if (next === "overview") updated.delete("cols");
    else updated.set("cols", next);
    setParams(updated, { replace: true });
  };
  const [page, setPage] = useState(0);
  const { sort, toggle } = useTableSort<PlayerSortKey>("ovr", "desc");

  const competitions = league?.competitions ?? [];

  // The nationality dropdown comes from the world rather than the static
  // tables: a save only holds the countries its leagues draw from, and offering
  // the other hundred as options that match nobody is worse than offering none.
  const nationalities = useMemo(() => {
    const seen = new Set<string>();
    for (const p of league?.players ?? []) seen.add(p.nationality);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [league?.players]);

  // One pass over the world's pool, keyed on the league object — a commit
  // replaces it, so this rebuilds exactly when the world actually changed and
  // not on a keystroke.
  const rows = useMemo(
    () => (league ? buildPlayerRows(league, potView.sortValue) : []),
    [league, potView],
  );

  const clubName = useMemo(() => {
    const byTid = new Map((league?.teams ?? []).map((t) => [t.tid, t.name]));
    return (tid: number | null) => (tid === null ? "" : byTid.get(tid) ?? "");
  }, [league?.teams]);

  const leagueName = useMemo(() => {
    const byId = new Map(competitions.map((c) => [c.id, c.name]));
    return (compId: number | null) => (compId === null ? "" : byId.get(compId) ?? "");
  }, [competitions]);

  const filtered = useMemo(() => {
    if (!league) return [];
    const search = toSearchFilters(filters, competitions);
    return filterPlayerRows(
      rows,
      {
        fields: search,
        minValue: moneyFilter(filters.minValue),
        maxValue: moneyFilter(filters.maxValue),
        status,
        name,
      },
      league.season,
    );
  }, [league, rows, filters, competitions, status, name]);

  const sorted = useMemo(
    () => sortRows(filtered, sort, playerSortAccessors(clubName, leagueName)),
    [filtered, sort, clubName, leagueName],
  );

  // A filter change can leave the current page past the end; clamp rather than
  // reset, so paging back through a long list survives an unrelated re-render.
  const pages = pageCount(sorted.length);
  const current = Math.min(page, pages - 1);
  const shown = pageOf(sorted, current);

  if (!league) return <p>Loading...</p>;

  const onFilters = (next: PlayerFilterState) => {
    setFilters(next);
    setPage(0);
  };

  return (
    <>
      <PlayerFilterBar
        idPrefix="db"
        value={filters}
        onChange={onFilters}
        onClear={() => onFilters(EMPTY_PLAYER_FILTERS)}
        nationalities={nationalities}
        competitions={competitions}
      >
        <div>
          <label className="form-label small mb-0" htmlFor="db-name">Name</label>
          <input
            id="db-name"
            type="text"
            className="form-control form-control-sm"
            style={{ width: "11rem" }}
            placeholder="Search by name"
            value={name}
            onChange={(e) => { setName(e.target.value); setPage(0); }}
          />
        </div>
        <div>
          <label className="form-label small mb-0" htmlFor="db-status">Status</label>
          <select
            id="db-status"
            className="form-select form-select-sm"
            style={{ width: "9rem" }}
            value={status}
            onChange={(e) => { setStatus(e.target.value as PlayerStatusFilter); setPage(0); }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </PlayerFilterBar>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <ul className="nav nav-pills">
          {COLUMN_SETS.map((c) => (
            <li className="nav-item" key={c.key}>
              <button
                type="button"
                className={`nav-link ${columns === c.key ? "active" : ""}`}
                onClick={() => setColumns(c.key)}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
        {hasAnyFilter(filters) || name !== "" || status !== "all" ? (
          <span className="text-muted small">
            {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} players match
          </span>
        ) : null}
      </div>

      <div className="table-responsive">
        <table className="table table-striped table-sm align-middle db-table">
          <thead>
            <tr>
              <th></th>
              <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
              <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
              <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Age</SortableTh>
              <SortableTh sortKey="club" sort={sort} onSort={toggle} defaultDir="asc">Club</SortableTh>
              {columns === "overview" ? (
                <>
                  <SortableTh sortKey="league" sort={sort} onSort={toggle} defaultDir="asc" className="db-divide">League</SortableTh>
                  <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">Ovr</SortableTh>
                  <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">Pot <PotHelp /></SortableTh>
                  <SortableTh sortKey="value" sort={sort} onSort={toggle} className="text-end">Value</SortableTh>
                  <SortableTh sortKey="wage" sort={sort} onSort={toggle} className="text-end">Wage</SortableTh>
                  <SortableTh sortKey="contract" sort={sort} onSort={toggle} className="text-end">Yrs</SortableTh>
                </>
              ) : (
                <>
                  <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end db-divide">Ovr</SortableTh>
                  {SKILL_KEYS.map((key) => (
                    <SortableTh
                      key={key}
                      sortKey={key}
                      sort={sort}
                      onSort={toggle}
                      className="text-end"
                    >
                      <abbr title={SKILL_LABELS[key]}>{SKILL_ABBREV[key]}</abbr>
                    </SortableTh>
                  ))}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <PlayerRow
                key={row.player.pid}
                row={row}
                columns={columns}
                season={league.season}
                leagueName={leagueName(row.compId)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={current}
        pageCount={pages}
        total={sorted.length}
        pageSize={PLAYER_DB_PAGE_SIZE}
        onPage={setPage}
        noun="players"
      />
    </>
  );
}

function PlayerRow({
  row, columns, season, leagueName,
}: {
  row: PlayerDbRow;
  columns: PlayerColumnSet;
  season: number;
  /** Resolved by the parent — a lookup per row would be a hook per row. */
  leagueName: string;
}) {
  const p = row.player;
  const badge = STATUS_BADGE[row.status];
  return (
    <tr>
      <td><WatchToggle pid={p.pid} name={p.name} /></td>
      <td>
        <PlayerRatingsTooltip player={p}>
          <Link to={`/player/${p.pid}`}>{p.name}</Link>
        </PlayerRatingsTooltip>{" "}
        <Flag nationality={p.nationality} />
      </td>
      <td>{p.pos}</td>
      <td className="text-end">{row.age}</td>
      <td>
        {row.tid === null
          ? <span className="text-muted small">{badge}</span>
          : (
            <>
              <ClubLink tid={row.tid} season={season} />
              {badge && <span className="text-muted small"> ({badge})</span>}
            </>
          )}
      </td>
      {columns === "overview" ? (
        <>
          <td className="db-divide small text-muted">{leagueName || "—"}</td>
          <td className="text-end fw-semibold" style={{ color: getRatingColor(p.ovr) }}>{p.ovr}</td>
          <td className="text-end"><PotDisplay player={p} /></td>
          <td className="text-end">{currencyCompact.format(row.value)}</td>
          <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
          <td className="text-end">{row.tid === null ? "—" : row.contractYears}</td>
        </>
      ) : (
        <>
          <td className="text-end fw-semibold db-divide" style={{ color: getRatingColor(p.ovr) }}>{p.ovr}</td>
          {SKILL_KEYS.map((key) => (
            <td key={key} className="text-end">{p.ratings[key]}</td>
          ))}
        </>
      )}
    </tr>
  );
}
