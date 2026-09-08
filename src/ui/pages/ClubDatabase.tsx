import { useMemo, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { CompetitionScopeSelect } from "../components/CompetitionScopeSelect.js";
import { Pagination } from "../components/Pagination.js";
import { SortableTh, sortRows, useTableSort } from "../components/SortableTable.js";
import { ColumnSetPills, useColumnSet } from "./databaseShared.js";
import { currencyCompact } from "../format.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { ALL_COMPETITIONS, decodeScope, encodeScope } from "../../core/competitions.js";
import {
  CLUB_DB_PAGE_SIZE, buildClubRows, clubSortAccessors, filterClubRows,
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

const CLUB_COLUMN_SETS: { key: ClubColumnSet; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "finance", label: "Finance" },
  { key: "season", label: "Season" },
];

export function ClubDatabase() {
  const { league } = useLeague();
  const [scopeValue, setScopeValue] = useState(encodeScope(ALL_COMPETITIONS));
  const [name, setName] = useState("");
  const [columns, setColumns] = useColumnSet<ClubColumnSet>(["overview", "finance", "season"]);
  const [page, setPage] = useState(0);
  const { sort, toggle } = useTableSort<ClubSortKey>("ovr", "desc");

  const competitions = league?.competitions ?? [];

  // Two world-wide passes live in here — a team rating per club, and every box
  // score of the season — so it is keyed on the league object and never redone
  // on a keystroke.
  const rows = useMemo(() => (league ? buildClubRows(league) : []), [league]);

  const filtered = useMemo(
    () => filterClubRows(rows, { scope: decodeScope(scopeValue), name }, competitions),
    [rows, scopeValue, name, competitions],
  );

  const accessors = useMemo(() => clubSortAccessors(), []);
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
            onChange={(e) => { setName(e.target.value); setPage(0); }}
          />
        </div>
        <div>
          <label className="form-label small mb-0" htmlFor="cdb-scope">League</label>
          <CompetitionScopeSelect
            id="cdb-scope"
            competitions={competitions}
            value={decodeScope(scopeValue)}
            onChange={(s) => { setScopeValue(encodeScope(s)); setPage(0); }}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => { setScopeValue(encodeScope(ALL_COMPETITIONS)); setName(""); setPage(0); }}
        >
          Clear filters
        </button>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <ColumnSetPills options={CLUB_COLUMN_SETS} value={columns} onChange={setColumns} />
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
