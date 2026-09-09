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
import { SortableTh, sortRows } from "../components/SortableTable.js";
import { ClubDatabase } from "./ClubDatabase.js";
import { ColumnSetPills, columnSetOf, columnSetParams } from "./databaseShared.js";
import { defaultView, viewFromParams, viewToParams, type DatabaseView } from "../databaseUrl.js";
import { usePotentialView } from "../potentialView.js";
import { currencyCompact, formatWeeklyWage, seasonYear } from "../format.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { SKILL_KEYS } from "../../core/players/types.js";
import {
  PLAYER_DB_PAGE_SIZE, STAT_COLUMNS, buildPlayerRows, careerTotalsIndex, filterPlayerRows,
  filterToSeason, pageCount, pageOf, playerSortAccessors, seasonStatsIndex, seasonsWithStats,
  sortKeysFor,
  type PlayerColumnSet, type PlayerDbRow, type PlayerSortKey, type PlayerStatus,
  type PlayerStatusFilter,
} from "../playerDatabase.js";
import type { SeasonStats } from "../../core/players/types.js";
import type { AllTimeStatKey, StatTotals } from "../../core/players/careerSummary.js";

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
  { key: "season", label: "Season" },
  { key: "career", label: "Career" },
];

/** Derived from the list above, so the two can't fall out of step. */
const PLAYER_COLUMN_KEYS = COLUMN_SETS.map((c) => c.key);

/** The column the table opens sorted by, and which way. */
const DEFAULT_SORT: PlayerSortKey = "ovr";
const DEFAULT_DIR = "desc" as const;


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
      {players ? <PlayerDatabase /> : <ClubDatabase />}
    </div>
  );
}

function PlayerDatabase() {
  const { league } = useLeague();
  const potView = usePotentialView();
  const [page, setPage] = useState(0);

  // Filters, sort and season live in the URL rather than in component state, so
  // a view somebody has narrowed and sorted is a link. Everything at its
  // default is left out of the query string — see databaseUrl.ts.
  const [params, setParams] = useSearchParams();
  const columns = columnSetOf(params, PLAYER_COLUMN_KEYS);
  const fallback = useMemo(() => defaultView(DEFAULT_SORT, DEFAULT_DIR), []);
  const view = useMemo(() => viewFromParams(params, fallback), [params, fallback]);
  const { filters, name, status } = view;
  const sort = useMemo(
    () => ({ key: view.sortKey as PlayerSortKey, dir: view.sortDir }),
    [view.sortKey, view.sortDir],
  );
  const update = (patch: Partial<DatabaseView>, resetPage = true) => {
    setParams(viewToParams({ ...view, ...patch }, fallback, params), { replace: true });
    if (resetPage) setPage(0);
  };
  const toggle = (key: PlayerSortKey, defaultDir: "asc" | "desc" = "desc") =>
    update(
      key === sort.key
        ? { sortDir: sort.dir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: defaultDir },
      false,
    );
  /**
   * Switching column sets keeps the sort where it still means something and
   * falls back to the default where it doesn't: a key with no header in the new
   * set leaves `sortRows` on the natural order, so the table would read as
   * unsorted rather than say so.
   *
   * Both changes go through **one** `setParams`. Two calls in this handler
   * would each build on this render's params, and the second would silently
   * discard the first.
   */
  const setColumns = (next: PlayerColumnSet) => {
    const withColumns = columnSetParams(params, PLAYER_COLUMN_KEYS, next);
    const nextView = sortKeysFor(next).has(sort.key)
      ? view
      : { ...view, sortKey: DEFAULT_SORT, sortDir: DEFAULT_DIR };
    setParams(viewToParams(nextView, fallback, withColumns), { replace: true });
  };

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
    () => (league
      ? buildPlayerRows(
        league,
        // A fully-scouted player has no band; his exact potential is both ends.
        (p) => potView.fogOf(p) ?? { low: p.potential, high: p.potential },
        (p) => potView.midpoint(p.potential, p.pid, league.season),
      )
      : []),
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

  // Every season anyone has a stat line for, for the season picker.
  const seasons = useMemo(() => seasonsWithStats(league?.players ?? []), [league?.players]);
  // Default to the season being played, but only once it HAS something to show.
  // `league.played` is emptied at the rollover, so on matchday 1 nobody has a
  // line for the current season yet: defaulting to it blindly opened the table
  // empty on a save with four seasons behind it, and — because the picker's
  // options are exactly the seasons that do have lines — the `<select>` then
  // fell back to displaying its first option, so it named a different year from
  // the one the table was showing. Falling back to the newest season on record
  // is both non-empty and what the picker is already claiming.
  const season = view.season
    ?? (league && seasons.includes(league.season) ? league.season : seasons[0])
    ?? league?.season ?? 0;

  // Built only for the view that reads them. The season index is cheap; the
  // career one walks every season line of every player in the world, which on a
  // long dynasty is the difference between opening instantly and pausing first.
  const seasonStats = useMemo(
    () => (columns === "season" ? seasonStatsIndex(league?.players ?? [], season) : undefined),
    [league?.players, season, columns],
  );
  const careerTotals = useMemo(
    () => (columns === "career" ? careerTotalsIndex(league?.players ?? []) : undefined),
    [league?.players, columns],
  );

  // The season view has nothing to say about a player the season has no record
  // of, so it narrows the table rather than printing a row of dashes.
  const inView = useMemo(
    () => (seasonStats ? filterToSeason(filtered, seasonStats) : filtered),
    [filtered, seasonStats],
  );

  const sorted = useMemo(
    () => sortRows(
      inView, sort, playerSortAccessors(clubName, leagueName, seasonStats, careerTotals),
    ),
    [inView, sort, clubName, leagueName, seasonStats, careerTotals],
  );

  // A filter change can leave the current page past the end; clamp rather than
  // reset, so paging back through a long list survives an unrelated re-render.
  const pages = pageCount(sorted.length);
  const current = Math.min(page, pages - 1);
  const shown = pageOf(sorted, current);

  if (!league) return <p>Loading...</p>;

  const onFilters = (next: PlayerFilterState) => update({ filters: next });
  // "Clear filters" sits at the end of the same bar as the name box and the
  // status picker, so it clears those too — leaving two of the bar's controls
  // set after clearing it would read as the button not having worked.
  const onClear = () => update({ filters: EMPTY_PLAYER_FILTERS, name: "", status: "all" });

  return (
    <>
      <PlayerFilterBar
        idPrefix="db"
        value={filters}
        onChange={onFilters}
        onClear={onClear}
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
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label small mb-0" htmlFor="db-status">Status</label>
          <select
            id="db-status"
            className="form-select form-select-sm"
            style={{ width: "9rem" }}
            value={status}
            onChange={(e) => update({ status: e.target.value as PlayerStatusFilter })}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </PlayerFilterBar>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <ColumnSetPills options={COLUMN_SETS} value={columns} onChange={setColumns} />
        {columns === "season" && seasons.length > 0 && (
          <select
            className="form-select form-select-sm"
            style={{ width: "auto" }}
            aria-label="Season"
            value={season}
            onChange={(e) => update({ season: Number(e.target.value) })}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>{seasonYear(s)}</option>
            ))}
          </select>
        )}
        {hasAnyFilter(filters) || name !== "" || status !== "all" || columns === "season" ? (
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
              {columns === "overview" && (
                <>
                  <SortableTh sortKey="league" sort={sort} onSort={toggle} defaultDir="asc" className="db-divide">League</SortableTh>
                  <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">Ovr</SortableTh>
                  <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">Pot <PotHelp /></SortableTh>
                  <SortableTh sortKey="value" sort={sort} onSort={toggle} className="text-end">Value</SortableTh>
                  <SortableTh sortKey="wage" sort={sort} onSort={toggle} className="text-end">Wage</SortableTh>
                  <SortableTh sortKey="contract" sort={sort} onSort={toggle} className="text-end">Yrs</SortableTh>
                </>
              )}
              {columns === "attributes" && (
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
              {(columns === "season" || columns === "career") && (
                <>
                  {statColumnsFor(columns).map((col, i) => (
                    <SortableTh
                      key={col.key}
                      sortKey={col.key}
                      sort={sort}
                      onSort={toggle}
                      className={`text-end${i === 0 ? " db-divide" : ""}`}
                    >
                      <abbr title={col.title}>{col.label}</abbr>
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
                stats={seasonStats?.get(row.player.pid)}
                career={careerTotals?.get(row.player.pid)}
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

/** The stat columns a view shows — the career one drops what it can't total. */
function statColumnsFor(columns: PlayerColumnSet) {
  return columns === "career" ? STAT_COLUMNS.filter((c) => c.career) : STAT_COLUMNS;
}

/** One stat cell's text: a count, or a fixed number of decimals for a rate. */
function statText(value: number, decimals = 0, dashOnZero = false): string {
  if (dashOnZero && value === 0) return "—";
  return decimals === 0 ? value.toLocaleString() : value.toFixed(decimals);
}

function PlayerRow({
  row, columns, season, leagueName, stats, career,
}: {
  row: PlayerDbRow;
  columns: PlayerColumnSet;
  season: number;
  /** Resolved by the parent — a lookup per row would be a hook per row. */
  leagueName: string;
  /** The chosen season's line, on the season view only. */
  stats?: SeasonStats;
  /** Career totals, on the career view only. */
  career?: StatTotals;
}) {
  const p = row.player;
  const badge = STATUS_BADGE[row.status];
  // On a past season the club that matters is the one he played for then, which
  // his stat line records — his club today would be a different claim entirely.
  const clubTid = stats && stats.tid >= 0 ? stats.tid : row.tid;
  const statValue = (col: (typeof STAT_COLUMNS)[number]): number => {
    if (col.key === "stat_yellowCards") return stats?.yellowCards ?? 0;
    if (col.key === "stat_redCards") return stats?.redCards ?? 0;
    const key = col.key.slice("stat_".length) as AllTimeStatKey;
    if (career) return career[key] ?? 0;
    return stats ? stats[key] : 0;
  };
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
        {clubTid === null
          ? <span className="text-muted small">{badge}</span>
          : (
            <>
              <ClubLink tid={clubTid} season={stats?.season ?? season} />
              {badge && !stats && <span className="text-muted small"> ({badge})</span>}
            </>
          )}
      </td>
      {columns === "overview" && (
        <>
          <td className="db-divide small text-muted">{leagueName || "—"}</td>
          <td className="text-end fw-semibold" style={{ color: getRatingColor(p.ovr) }}>{p.ovr}</td>
          <td className="text-end"><PotDisplay player={p} /></td>
          <td className="text-end">{currencyCompact.format(row.value)}</td>
          <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
          <td className="text-end">{row.tid === null ? "—" : row.contractYears}</td>
        </>
      )}
      {columns === "attributes" && (
        <>
          <td className="text-end fw-semibold db-divide" style={{ color: getRatingColor(p.ovr) }}>{p.ovr}</td>
          {SKILL_KEYS.map((key) => (
            <td key={key} className="text-end">{p.ratings[key]}</td>
          ))}
        </>
      )}
      {(columns === "season" || columns === "career") && (
        <>
          {statColumnsFor(columns).map((col, i) => (
            <td key={col.key} className={`text-end${i === 0 ? " db-divide" : ""}`}>
              {statText(statValue(col), col.decimals, col.dashOnZero)}
            </td>
          ))}
        </>
      )}
    </tr>
  );
}
