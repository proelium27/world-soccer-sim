import { useState, type ReactNode } from "react";
import type { LeagueStore } from "../../core/leagueState.js";
import type { Position, SeasonStats } from "../../core/players/types.js";
import type { IntlCareer } from "../../core/international/career.js";
import { worldHasCup } from "../../core/cup/cup.js";
import { confederationOf, confederationCupSpec } from "../../core/international/index.js";
import { cupStatsBySeasonForPlayer } from "../../core/cup/cupStats.js";
import { domesticStatsBySeasonForPlayer } from "../../core/domesticCup/stats.js";
import { clubLines } from "../../core/players/seasonStints.js";
import { INTL_TOURNAMENT_NAME } from "../../core/constants.js";
import { hasClubSeason } from "../../core/clubSeason.js";
import { seasonYear } from "../format.js";
import {
  cupStatColumns, leagueStatColumns, statCellText, statColumnScope, statHeader, sumStatRows,
} from "../playerStatColumns.js";
import { Flag } from "./Flag.js";
import { ClubLink } from "./ClubLink.js";

/**
 * A player's stat tables: league season by season, the continental and
 * domestic cups, and the national team, with a totals / per-90 switch.
 *
 * Shared by the living profile and the retired one, so a retiree's career reads
 * exactly the way it did the season before he retired. It takes the stat lines
 * rather than a `Player` for that reason: a retiree has no `Player`, only his
 * archive row and the lines kept beside it (`RetireeCareer`). The cup tabs read
 * the archived cups by pid, which retirement leaves alone, so they work for
 * every retiree whether or not his league lines were kept.
 */
export function PlayerStatsCard({
  league,
  pid,
  pos,
  nationality,
  stats,
  intl,
  seasonTid,
  leagueEmpty,
}: {
  league: LeagueStore;
  pid: number;
  pos: Position;
  nationality: string;
  /** League season rows, any order. */
  stats: SeasonStats[];
  intl: IntlCareer | null;
  /** The club to label a season row with when it has no split; null for none. */
  seasonTid: (season: number) => number | null;
  /** Shown on the league tab in place of the table when `stats` is empty. */
  leagueEmpty?: ReactNode;
}) {
  const [statsTab, setStatsTab] = useState<"league" | "cup" | "domestic" | "intl">("league");
  // Totals or per-90 rates, across both the league and cup stat tables (they
  // record minutes in the same shape). No qualifier here, unlike the Stat
  // Leaders board: you're deliberately looking at one player, so a low-minutes
  // season reading high is information rather than a fake leader.
  const [statsRate, setStatsRate] = useState(false);

  const statsBySeasonDesc = [...stats].sort((a, b) => b.season - a.season);
  // Both continental competitions on one tab, each row labelled. A player can
  // have Cup seasons and Shield seasons in one career (and, if he moves clubs
  // mid-season, one of each in the same season), so the rows are keyed by
  // competition *and* season rather than season alone.
  const cupStatsBySeason = [
    ...cupStatsBySeasonForPlayer(league.cup, league.cupHistory, pid)
      .map((line) => ({ line, competition: "Cup" })),
    ...cupStatsBySeasonForPlayer(league.shield, league.shieldHistory ?? [], pid)
      .map((line) => ({ line, competition: "Shield" })),
    ...cupStatsBySeasonForPlayer(league.americasCup ?? null, league.americasCupHistory ?? [], pid)
      .map((line) => ({ line, competition: "Americas" })),
  ].sort((a, b) => b.line.season - a.line.season || a.competition.localeCompare(b.competition));
  const showCupTab = worldHasCup(league.competitions);
  // Labelled the same way, so the two tabs share one row shape and one render.
  const domesticStatsBySeason = domesticStatsBySeasonForPlayer(
    league.domesticCups ?? [], league.domesticCupHistory ?? [], pid,
  ).map((line) => ({ line, competition: "Domestic" }));
  // The domestic tab appears only once there is something in it — a save that
  // predates domestic cups picks them up a season later, and an empty tab in
  // the meantime is just a dead end.
  const showDomesticTab = domesticStatsBySeason.length > 0;
  // The national-team tab appears once he's been involved at all. Its per-campaign
  // lines only exist from the season they started being recorded, so a save older
  // than that still shows the career totals with an empty table underneath.
  // Which championship a "confederation" line refers to isn't stored on the line
  // — it doesn't have to be, since a player only ever plays his own
  // confederation's. Derived from his nationality instead.
  const confederationCupName = confederationCupSpec(confederationOf(nationality) ?? "")?.name
    ?? "Confederation Cup";
  const showIntlTab = intl !== null && (intl.caps > 0 || intl.tournaments > 0);
  const intlSeasonsDesc = [...(intl?.seasons ?? [])].sort((a, b) => b.season - a.season);
  // Guard against a stale selection: a tab that isn't offered for this player
  // (no cup in the world, never capped) falls back to the league stats.
  const activeStatsTab =
    (statsTab === "cup" && !showCupTab)
    || (statsTab === "domestic" && !showDomesticTab)
    || (statsTab === "intl" && !showIntlTab)
      ? "league"
      : statsTab;
  // Both cup tables have identical columns, so they share one render below.
  const cupRows = activeStatsTab === "domestic" ? domesticStatsBySeason : cupStatsBySeason;
  // Both stat tables are generated from a column list rather than hand-written
  // cells, so a season row, the career row under it and the per-90 reading of
  // either all come out of one definition per stat and cannot drift apart.
  // Which columns appear depends on what the player has actually recorded — see
  // statColumnScope.
  const cupLines = cupRows.map((r) => r.line);
  const cupColumns = cupStatColumns(statColumnScope(pos, cupLines));
  const cupTotals = sumStatRows(cupLines);
  const leagueColumns = leagueStatColumns(statColumnScope(pos, stats));
  const leagueTotals = sumStatRows(stats);

  return (
    <div className="card mt-3">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h6 className="card-title mb-0">
            {activeStatsTab === "cup"
              ? "Continental Stats"
              : activeStatsTab === "domestic"
                ? "Domestic Cup Stats"
                : activeStatsTab === "intl"
                  ? "National Team Stats"
                  : "Season Stats"}
          </h6>
          <div className="d-flex align-items-center gap-2">
            {/* The national-team table records caps, not minutes, so it has
                no per-90 reading and the toggle is hidden on that tab. */}
            {activeStatsTab !== "intl" && (
              <div
                className="btn-group btn-group-sm"
                role="group"
                aria-label="Totals or per 90 minutes"
              >
                <button
                  type="button"
                  className={`btn ${statsRate ? "btn-outline-secondary" : "btn-secondary"}`}
                  onClick={() => setStatsRate(false)}
                >
                  Totals
                </button>
                <button
                  type="button"
                  className={`btn ${statsRate ? "btn-secondary" : "btn-outline-secondary"}`}
                  onClick={() => setStatsRate(true)}
                  title="Stats divided by 90-minute matches played"
                >
                  Per 90
                </button>
              </div>
            )}
            {(showCupTab || showDomesticTab || showIntlTab) && (
              <ul className="nav nav-pills nav-sm">
                <li className="nav-item">
                  <button
                    type="button"
                    className={`nav-link py-0 px-2${activeStatsTab === "league" ? " active" : ""}`}
                    onClick={() => setStatsTab("league")}
                  >
                    League
                  </button>
                </li>
                {showCupTab && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className={`nav-link py-0 px-2${activeStatsTab === "cup" ? " active" : ""}`}
                      onClick={() => setStatsTab("cup")}
                    >
                      Cup
                    </button>
                  </li>
                )}
                {showDomesticTab && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className={`nav-link py-0 px-2${activeStatsTab === "domestic" ? " active" : ""}`}
                      onClick={() => setStatsTab("domestic")}
                    >
                      Domestic Cup
                    </button>
                  </li>
                )}
                {showIntlTab && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className={`nav-link py-0 px-2${activeStatsTab === "intl" ? " active" : ""}`}
                      onClick={() => setStatsTab("intl")}
                    >
                      National Team
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
        {activeStatsTab === "intl" && intl ? (
          <>
            <p className="small mb-2">
              <Flag nationality={nationality} /> {nationality} &middot;{" "}
              <strong>{intl.caps}</strong> {intl.caps === 1 ? "cap" : "caps"},{" "}
              <strong>{intl.goals}</strong> {intl.goals === 1 ? "goal" : "goals"},{" "}
              <strong>{intl.assists}</strong> {intl.assists === 1 ? "assist" : "assists"}
              {intl.tournaments > 0 && <> &middot; {intl.tournaments} {intl.tournaments === 1 ? "tournament" : "tournaments"}</>}
              {intl.titles > 0 && <> &middot; <strong>{intl.titles}</strong> {intl.titles === 1 ? "title" : "titles"}</>}
              {(intl.confederationCups ?? 0) > 0 && (
                <> &middot; {intl.confederationCups} confederation {intl.confederationCups === 1 ? "cup" : "cups"}</>
              )}
              {(intl.confederationCupTitles ?? 0) > 0 && (
                <> &middot; <strong>{intl.confederationCupTitles}</strong> confederation cup {intl.confederationCupTitles === 1 ? "title" : "titles"}</>
              )}
            </p>
            {intlSeasonsDesc.length === 0 ? (
              <p className="text-muted mb-0">
                No campaign-by-campaign breakdown on record, so the totals above are his whole
                international career.
              </p>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-sm mb-0">
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th>Competition</th>
                      <th className="text-end">Apps</th>
                      <th className="text-end">G</th>
                      <th className="text-end">A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intlSeasonsDesc.map((s) => (
                      <tr key={`${s.season}-${s.kind}`}>
                        <td>{seasonYear(s.season)}</td>
                        <td>
                          {s.kind === "tournament"
                            ? INTL_TOURNAMENT_NAME
                            : s.kind === "confederation"
                              ? confederationCupName
                              : "Qualifying"}
                        </td>
                        <td className="text-end">{s.caps}</td>
                        <td className="text-end">{s.goals}</td>
                        <td className="text-end">{s.assists}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : activeStatsTab === "cup" || activeStatsTab === "domestic" ? (
          cupRows.length === 0 ? (
            <p className="text-muted mb-0">
              {activeStatsTab === "domestic"
                ? "No domestic cup matches yet."
                : "No Continental Cup or Shield matches yet."}
            </p>
          ) : (
            <div className="table-responsive">
              {/* text-nowrap so the responsive wrapper scrolls on a narrow
                  screen instead of crushing twenty-odd columns into it,
                  which wraps the season cell and doubles every row. */}
              <table className="table table-striped table-sm text-nowrap mb-0">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Comp</th>
                    {cupColumns.map((c) => (
                      <th key={c.key} className="text-end" title={c.title}>
                        {statHeader(c, statsRate)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cupRows.map(({ line: s, competition }, i) => (
                    // Keyed by index, not season: a player who moves club
                    // mid-season can play in two of these in one season (two
                    // domestic cups, or a Cup line and a Shield line), and
                    // each is its own row.
                    <tr key={i}>
                      <td>{seasonYear(s.season)}</td>
                      <td className="text-muted small">{competition}</td>
                      {cupColumns.map((c) => (
                        <td key={c.key} className="text-end">{statCellText(c, s, statsRate)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {/* A career row under a single season would just repeat it. */}
                {cupRows.length > 1 && (
                  <tfoot>
                    <tr className="fw-semibold">
                      <td>Career</td>
                      <td />
                      {cupColumns.map((c) => (
                        <td key={c.key} className="text-end">
                          {statCellText(c, cupTotals, statsRate)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )
        ) : statsBySeasonDesc.length === 0 ? (
          leagueEmpty ?? <p className="text-muted mb-0">No matches played yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped table-sm text-nowrap mb-0">
              <thead>
                <tr>
                  <th>Season</th>
                  {leagueColumns.map((c) => (
                    <th key={c.key} className="text-end" title={c.title}>
                      {statHeader(c, statsRate)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statsBySeasonDesc.flatMap((s) => {
                  // A season split by a mid-season move reads as one row per
                  // club and then the season's total, the way a real player's
                  // record does (seasonStints.ts).
                  const lines = clubLines(s);
                  const rows = lines.length === 1
                    ? [{ key: `${s.season}`, tid: seasonTid(s.season), line: s, total: false }]
                    : [
                        ...lines.map((l, i) => ({ key: `${s.season}-${i}`, tid: l.tid, line: l, total: false })),
                        { key: `${s.season}-total`, tid: null, line: s, total: true },
                      ];
                  return rows.map((r) => (
                    <tr key={r.key} className={r.total ? "fst-italic" : undefined}>
                      <td>
                        {seasonYear(s.season)}
                        {r.total ? (
                          <span className="text-muted small"> (Total)</span>
                        ) : r.tid !== null && (
                          <span className="text-muted small">
                            {" ("}
                            <ClubLink tid={r.tid} season={s.season} variant="abbrev"
                              linked={hasClubSeason(league, s.season)} />
                            {")"}
                          </span>
                        )}
                      </td>
                      {leagueColumns.map((c) => (
                        <td key={c.key} className="text-end">{statCellText(c, r.line, statsRate)}</td>
                      ))}
                    </tr>
                  ));
                })}
              </tbody>
              {/* A career row under a single season would just repeat it. */}
              {statsBySeasonDesc.length > 1 && (
                <tfoot>
                  <tr className="fw-semibold">
                    <td>Career</td>
                    {leagueColumns.map((c) => (
                      <td key={c.key} className="text-end">
                        {statCellText(c, leagueTotals, statsRate)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
