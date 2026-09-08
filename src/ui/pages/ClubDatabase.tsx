import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { CompetitionScopeSelect } from "../components/CompetitionScopeSelect.js";
import { Pagination } from "../components/Pagination.js";
import { SortableTh, sortRows, type SortDir } from "../components/SortableTable.js";
import { ColumnSetPills, columnSetParams, useColumnSet } from "./databaseShared.js";
import { currencyCompact } from "../format.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { ALL_COMPETITIONS, decodeScope, encodeScope } from "../../core/competitions.js";
import {
  CLUB_DB_PAGE_SIZE, buildClubRows, clubSortAccessors, clubSortKeysFor, filterClubRows,
  type ClubColumnSet, type ClubDbRow, type ClubSortKey,
} from "../clubDatabase.js";
import { pageCount, pageOf } from "../playerDatabase.js";

/**
 * Every club in the world: how good it is, what it earns and spends, and how
 * its season is going, on three swappable column sets.
 *
 * The strength and record columns come from the same power-ranking snapshot the
 * Power Rankings page draws and the money columns are the figures Finance
 * shows, so no two pages can disagree about the same club. Like the player
 * table it pages rather than scrolls, and for the same reason: DOM weight is
 * this app's one known performance failure.
 */

/** The scope every save opens on, and so the one value left out of the URL. */
const DEFAULT_SCOPE = encodeScope(ALL_COMPETITIONS);
const DEFAULT_CLUB_SORT: ClubSortKey = "ovr";
const CLUB_COLUMN_KEYS: readonly ClubColumnSet[] = ["overview", "finance", "season"];

const CLUB_COLUMN_SETS: { key: ClubColumnSet; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "finance", label: "Finance" },
  { key: "season", label: "Season" },
];

export function ClubDatabase() {
  const { league } = useLeague();
  const [page, setPage] = useState(0);

  // Scope, name and sort live in the URL, not in component state, for the same
  // reason the player table's do: a narrowed, sorted view is worth being able to
  // link to. This table held them in `useState`, so `?sort=wages` was accepted
  // into the address bar and silently ignored — the one thing a shareable link
  // must not do. Same parameter names as the player table (`in`, `q`, `sort`,
  // `dir`), so the two tabs read the same and neither invents a vocabulary.
  const [params, setParams] = useSearchParams();
  const [columns] = useColumnSet<ClubColumnSet>(CLUB_COLUMN_KEYS);
  const accessors = useMemo(() => clubSortAccessors(), []);

  const scopeValue = params.get("in") ?? DEFAULT_SCOPE;
  const name = params.get("q") ?? "";
  const sort = useMemo(() => {
    // An unrecognised key would leave `sortRows` on the natural order — a table
    // that looks sorted and isn't — so a stale or hand-edited link falls back to
    // the default rather than to nothing. Same leniency `databaseUrl` promises.
    const raw = params.get("sort");
    const key = (raw && raw in accessors ? raw : DEFAULT_CLUB_SORT) as ClubSortKey;
    return { key, dir: params.get("dir") === "asc" ? "asc" : "desc" } as const;
  }, [params, accessors]);

  /** Write only what differs from the default, so the query string stays readable. */
  const writeParams = (
    next: { scope?: string; name?: string; key?: ClubSortKey; dir?: SortDir },
    base: URLSearchParams = params,
  ) => {
    const out = new URLSearchParams(base);
    const put = (param: string, value: string, dflt: string) => {
      if (value === dflt) out.delete(param);
      else out.set(param, value);
    };
    put("in", next.scope ?? scopeValue, DEFAULT_SCOPE);
    put("q", next.name ?? name, "");
    put("sort", next.key ?? sort.key, DEFAULT_CLUB_SORT);
    put("dir", next.dir ?? sort.dir, "desc");
    setParams(out, { replace: true });
  };
  const update = (next: Parameters<typeof writeParams>[0]) => {
    writeParams(next);
    setPage(0);
  };
  const toggle = (key: ClubSortKey, defaultDir: SortDir = "desc") =>
    writeParams(key === sort.key
      ? { dir: sort.dir === "asc" ? "desc" : "asc" }
      : { key, dir: defaultDir });

  /**
   * Switching column sets keeps the sort where the new set still has a header
   * for it and resets it where it doesn't — otherwise the table stays sorted by
   * a column nobody can see, with no caret to say so. One `setParams`, because
   * two in a handler both build on this render's params and the second discards
   * the first (the trap `columnSetParams` exists for).
   */
  const changeColumns = (next: ClubColumnSet) => {
    const withColumns = columnSetParams(params, CLUB_COLUMN_KEYS, next);
    if (clubSortKeysFor(next).has(sort.key)) setParams(withColumns, { replace: true });
    else writeParams({ key: DEFAULT_CLUB_SORT, dir: "desc" }, withColumns);
  };

  const competitions = league?.competitions ?? [];

  // Two world-wide passes live in here — a team rating per club, and every box
  // score of the season — so it is keyed on the league object and never redone
  // on a keystroke.
  const rows = useMemo(() => (league ? buildClubRows(league) : []), [league]);

  const filtered = useMemo(
    () => filterClubRows(rows, { scope: decodeScope(scopeValue), name }, competitions),
    [rows, scopeValue, name, competitions],
  );

  const sorted = useMemo(() => sortRows(filtered, sort, accessors), [filtered, sort, accessors]);

  const pages = pageCount(sorted.length, CLUB_DB_PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const shown = pageOf(sorted, current, CLUB_DB_PAGE_SIZE);

  if (!league) return <p>Loading...</p>;

  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <div>
          <label className="form-label small mb-0" htmlFor="cdb-name">Club</label>
          <input
            id="cdb-name"
            type="text"
            className="form-control form-control-sm"
            style={{ width: "12rem" }}
            placeholder="Search by name"
            value={name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div>
          <label className="form-label small mb-0" htmlFor="cdb-scope">League</label>
          <CompetitionScopeSelect
            id="cdb-scope"
            competitions={competitions}
            value={decodeScope(scopeValue)}
            onChange={(s) => update({ scope: encodeScope(s) })}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => update({ scope: DEFAULT_SCOPE, name: "" })}
        >
          Clear filters
        </button>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <ColumnSetPills options={CLUB_COLUMN_SETS} value={columns} onChange={changeColumns} />
        {sorted.length !== rows.length && (
          <span className="text-muted small">
            {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} clubs match
          </span>
        )}
      </div>

      <div className="table-responsive">
        <table className="table table-striped table-sm align-middle db-table">
          <thead>
            <tr>
              <SortableTh sortKey="club" sort={sort} onSort={toggle} defaultDir="asc">Club</SortableTh>
              <SortableTh sortKey="league" sort={sort} onSort={toggle} defaultDir="asc">League</SortableTh>
              <SortableTh sortKey="rank" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Pos</SortableTh>
              {columns === "overview" && (
                <>
                  <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end db-divide">Ovr</SortableTh>
                  <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">Pot</SortableTh>
                  <SortableTh sortKey="power" sort={sort} onSort={toggle} className="text-end">Power</SortableTh>
                  <SortableTh sortKey="squad" sort={sort} onSort={toggle} className="text-end">Squad</SortableTh>
                  <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end">Avg age</SortableTh>
                  <SortableTh sortKey="hype" sort={sort} onSort={toggle} className="text-end">Hype</SortableTh>
                </>
              )}
              {columns === "finance" && (
                <>
                  <SortableTh sortKey="budget" sort={sort} onSort={toggle} className="text-end db-divide">Budget</SortableTh>
                  <SortableTh sortKey="cap" sort={sort} onSort={toggle} className="text-end">Cap used</SortableTh>
                  <SortableTh sortKey="wages" sort={sort} onSort={toggle} className="text-end">Wage bill</SortableTh>
                  <SortableTh sortKey="hype" sort={sort} onSort={toggle} className="text-end">Hype</SortableTh>
                  <SortableTh sortKey="spent" sort={sort} onSort={toggle} className="text-end">Spent</SortableTh>
                  <SortableTh sortKey="received" sort={sort} onSort={toggle} className="text-end">Received</SortableTh>
                  <SortableTh sortKey="net" sort={sort} onSort={toggle} className="text-end">Net</SortableTh>
                </>
              )}
              {columns === "season" && (
                <>
                  <SortableTh sortKey="played" sort={sort} onSort={toggle} className="text-end db-divide">P</SortableTh>
                  <SortableTh sortKey="won" sort={sort} onSort={toggle} className="text-end">W</SortableTh>
                  <SortableTh sortKey="drawn" sort={sort} onSort={toggle} className="text-end">D</SortableTh>
                  <SortableTh sortKey="lost" sort={sort} onSort={toggle} className="text-end">L</SortableTh>
                  <SortableTh sortKey="gf" sort={sort} onSort={toggle} className="text-end">GF</SortableTh>
                  <SortableTh sortKey="ga" sort={sort} onSort={toggle} className="text-end">GA</SortableTh>
                  <SortableTh sortKey="gd" sort={sort} onSort={toggle} className="text-end">GD</SortableTh>
                  <SortableTh sortKey="points" sort={sort} onSort={toggle} className="text-end">Pts</SortableTh>
                  <SortableTh sortKey="shots" sort={sort} onSort={toggle} className="text-end db-divide">Sh</SortableTh>
                  <SortableTh sortKey="sot" sort={sort} onSort={toggle} className="text-end">SoT</SortableTh>
                  <SortableTh sortKey="xg" sort={sort} onSort={toggle} className="text-end">xG</SortableTh>
                  <SortableTh sortKey="xga" sort={sort} onSort={toggle} className="text-end">xGA</SortableTh>
                  <SortableTh sortKey="saves" sort={sort} onSort={toggle} className="text-end">Sv</SortableTh>
                  <SortableTh sortKey="tackles" sort={sort} onSort={toggle} className="text-end">Tkl</SortableTh>
                  <SortableTh sortKey="possession" sort={sort} onSort={toggle} className="text-end">Poss</SortableTh>
                  <SortableTh sortKey="rating" sort={sort} onSort={toggle} className="text-end">Rtg</SortableTh>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <ClubRow
                key={row.team.tid}
                row={row}
                columns={columns}
                season={league.season}
                isUser={row.team.tid === league.meta.userTid}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={current}
        pageCount={pages}
        total={sorted.length}
        pageSize={CLUB_DB_PAGE_SIZE}
        onPage={setPage}
        noun="clubs"
      />
    </>
  );
}

function ClubRow({
  row, columns, season, isUser,
}: {
  row: ClubDbRow;
  columns: ClubColumnSet;
  season: number;
  isUser: boolean;
}) {
  const { table, stats } = row;
  return (
    <tr className={isUser ? "team-highlight" : undefined}>
      <td><ClubLink tid={row.team.tid} season={season} /></td>
      <td className="small text-muted">{row.leagueName}</td>
      <td className="text-end">{row.rank ?? "—"}</td>
      {columns === "overview" && (
        <>
          <td className="text-end fw-semibold db-divide" style={{ color: getRatingColor(row.ovr) }}>{row.ovr}</td>
          <td className="text-end">{row.pot}</td>
          <td className="text-end">{row.powerScore.toFixed(1)}</td>
          <td className="text-end">{row.squadSize}</td>
          <td className="text-end">{row.avgAge > 0 ? row.avgAge.toFixed(1) : "—"}</td>
          <td className="text-end">{Math.round(row.hype)}</td>
        </>
      )}
      {columns === "finance" && (
        <>
          <td className="text-end db-divide">{currencyCompact.format(row.budget)}</td>
          <td className="text-end">{Math.round(row.capUsed * 100)}%</td>
          <td className="text-end">{currencyCompact.format(row.wages)}</td>
          <td className="text-end">{Math.round(row.hype)}</td>
          <td className="text-end">{row.spent > 0 ? currencyCompact.format(row.spent) : "—"}</td>
          <td className="text-end">{row.received > 0 ? currencyCompact.format(row.received) : "—"}</td>
          <td className="text-end">{currencyCompact.format(row.received - row.spent)}</td>
        </>
      )}
      {columns === "season" && (
        <>
          <td className="text-end db-divide">{table?.played ?? 0}</td>
          <td className="text-end">{table?.won ?? 0}</td>
          <td className="text-end">{table?.drawn ?? 0}</td>
          <td className="text-end">{table?.lost ?? 0}</td>
          <td className="text-end">{table?.gf ?? 0}</td>
          <td className="text-end">{table?.ga ?? 0}</td>
          <td className="text-end">{table ? (table.gd > 0 ? `+${table.gd}` : table.gd) : 0}</td>
          <td className="text-end fw-semibold">{table?.points ?? 0}</td>
          <td className="text-end db-divide">{stats?.shots ?? 0}</td>
          <td className="text-end">{stats?.shotsOnTarget ?? 0}</td>
          <td className="text-end">{(stats?.xg ?? 0).toFixed(1)}</td>
          <td className="text-end">{(stats?.xga ?? 0).toFixed(1)}</td>
          <td className="text-end">{stats?.saves ?? 0}</td>
          <td className="text-end">{stats?.tackles ?? 0}</td>
          <td className="text-end">{stats ? `${stats.possessionPct.toFixed(0)}%` : "—"}</td>
          <td className="text-end">{stats && stats.avgRating > 0 ? stats.avgRating.toFixed(2) : "—"}</td>
        </>
      )}
    </tr>
  );
}
