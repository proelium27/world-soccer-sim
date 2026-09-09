import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import type { Player } from "../../core/players/types.js";
import type { StoredTeam } from "../../core/teams/clubs.js";
import { teamSlots, teamFormation } from "../../core/lineup/formations.js";
import { resolveXI } from "../../core/lineup/resolveXI.js";
import {
  computePowerRankingSnapshot,
  type PowerRankingSnapshot,
} from "../../core/teams/powerRanking.js";
import { layoutSlots } from "../pitchLayout.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { formatWeeklyWage, seasonYear } from "../format.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { Flag } from "../components/Flag.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { DivisionBadge } from "../components/DivisionBadge.js";
import { sortByPosThenOvr } from "./Roster.js";
import { shortName } from "../playerName.js";

/** The stored snapshot immediately preceding `snapshot` within the same season, for rank-movement arrows. */
function previousSnapshot(
  history: PowerRankingSnapshot[],
  snapshot: PowerRankingSnapshot,
): PowerRankingSnapshot | null {
  let prev: PowerRankingSnapshot | null = null;
  for (const s of history) {
    if (s.season !== snapshot.season || s.matchday >= snapshot.matchday) continue;
    if (prev === null || s.matchday > prev.matchday) prev = s;
  }
  return prev;
}

export function PowerRankings() {
  const { league } = useLeague();
  const playerByPid = usePlayerMap(league?.players);
  const [expandedTid, setExpandedTid] = useState<number | null>(null);
  const [compId, setCompId] = useState<number | "all">("all");
  // -1 = the live "Current" view; otherwise an index into powerRankingHistory.
  const [viewIndex, setViewIndex] = useState(-1);

  const history = league?.powerRankingHistory ?? [];
  const isCurrent = viewIndex < 0 || viewIndex >= history.length;

  const snapshot = useMemo(() => {
    if (!league) return null;
    if (!isCurrent) return history[viewIndex];
    return computePowerRankingSnapshot(
      league.teams,
      league.players,
      league.played,
      league.season,
      0,
    );
  }, [league, history, isCurrent, viewIndex]);

  if (!league || !snapshot) {
    return <p className="p-3">Loading...</p>;
  }

  const teamByTid = new Map(league.teams.map((t) => [t.tid, t]));

  const rows = snapshot.rows.filter((r) => compId === "all" || r.compId === compId);

  // Rank movement vs the previous stored snapshot of the same season (the
  // live view compares against the season's latest snapshot). Ranks are
  // recomputed within the current competition filter so the arrows always
  // describe movement in the list actually being shown.
  const prev = isCurrent
    ? [...history].reverse().find((s) => s.season === league.season) ?? null
    : previousSnapshot(history, snapshot);
  const prevRankByTid = new Map<number, number>();
  if (prev) {
    prev.rows
      .filter((r) => compId === "all" || r.compId === compId)
      .forEach((r, i) => prevRankByTid.set(r.tid, i + 1));
  }

  const divisionRanks = new Map<number, number>();
  const divisionCounts = new Map<number, number>();
  for (const r of rows) {
    const next = (divisionCounts.get(r.compId) ?? 0) + 1;
    divisionCounts.set(r.compId, next);
    divisionRanks.set(r.tid, next);
  }

  // World rank = a club's position among every club in the world by Power
  // score. snapshot.rows is the full, globally-sorted list (before the
  // competition filter), so its index order is exactly that.
  const worldRankByTid = new Map<number, number>();
  snapshot.rows.forEach((r, i) => worldRankByTid.set(r.tid, i + 1));
  const worldTotal = snapshot.rows.length;

  // When a single competition is selected, everyone shares a division, so the
  // "Div" badge just mirrors the # column — show each club's world rank there
  // instead, which is genuinely new information in that view.
  const showWorldRank = compId !== "all";

  // Newest first in the dropdown: seasons descending, matchdays descending
  // within a season. Values are indices into powerRankingHistory.
  const seasonsDesc = [...new Set(history.map((s) => s.season))].sort((a, b) => b - a);

  return (
    <div className="container-fluid p-3">
      <h4>Power Rankings</h4>
      <p className="text-muted small mb-3">
        Teams ranked by a blended Power score: squad OVR (Starting XI + bench, depth-weighted) plus
        a current-season form bonus — results weighted by opponent quality (beating a strong side
        counts for more than beating a weak one) and goal difference. Snapshots are kept every few
        matchdays, so you can look back at how the rankings moved through any season.
        {isCurrent && " Click a team to see its roster."}
      </p>
      <div className="mb-3 d-flex flex-wrap gap-2">
        <select
          className="form-select form-select-sm w-auto"
          value={isCurrent ? -1 : viewIndex}
          onChange={(e) => {
            setViewIndex(Number(e.target.value));
            setExpandedTid(null);
          }}
        >
          <option value={-1}>Current</option>
          {seasonsDesc.map((season) => (
            <optgroup key={season} label={String(seasonYear(season))}>
              {history
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.season === season)
                .sort((a, b) => b.s.matchday - a.s.matchday)
                .map(({ s, i }) => (
                  <option key={i} value={i}>
                    Matchday {s.matchday}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <CompetitionSelect
          competitions={league.competitions}
          value={compId}
          onChange={setCompId}
          allOption
        />
      </div>
      {!isCurrent && (
        <p className="text-muted small mb-2">
          Rankings as they stood after matchday {snapshot.matchday},{" "}
          {seasonYear(snapshot.season)}. Movement is relative to the previous snapshot of that
          season.
        </p>
      )}
      <table className="table table-striped table-sm">
        <thead>
          <tr>
            <th className="text-end">#</th>
            <th style={{ width: "2.5em" }}></th>
            <th>Team</th>
            <th className="text-end">{showWorldRank ? "World" : "Div"}</th>
            <th className="text-end">Record</th>
            <th className="text-end">GD</th>
            <th className="text-end">OVR</th>
            <th className="text-end">
              Power
              <HelpHint>
                Power blends a club's squad strength (its starting XI plus a depth-weighted bench)
                with current-season form. Beating a strong side counts for more than beating a weak
                one, and goal difference factors in too, so a club can rank above or below its raw
                OVR depending on how it's actually playing.
              </HelpHint>
            </th>
            <th className="text-end">POT <PotHelp /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const team = teamByTid.get(r.tid);
            if (!team) return null;
            const isUser = r.tid === league.meta.userTid;
            const isExpanded = isCurrent && expandedTid === r.tid;
            const prevRank = prevRankByTid.get(r.tid);
            const move = prevRank === undefined ? null : prevRank - (i + 1);
            return (
              <Fragment key={r.tid}>
                <tr
                  className={isUser ? "team-highlight" : undefined}
                  style={isCurrent ? { cursor: "pointer" } : undefined}
                  onClick={
                    isCurrent
                      ? () => setExpandedTid(isExpanded ? null : r.tid)
                      : undefined
                  }
                >
                  <td className="text-end">{i + 1}</td>
                  <td className="text-center small">
                    {move !== null && move !== 0 && (
                      <span
                        className={move > 0 ? "text-success" : "text-danger"}
                        title={`${move > 0 ? "Up" : "Down"} ${Math.abs(move)} since the previous snapshot`}
                      >
                        {move > 0 ? "▲" : "▼"}
                        {Math.abs(move)}
                      </span>
                    )}
                    {move === 0 && <span className="text-muted">–</span>}
                  </td>
                  <td>
                    <span className="d-inline-flex align-items-center gap-1">
                      {isCurrent && (
                        <span className="text-muted" style={{ width: "1em", display: "inline-block" }}>
                          {isExpanded ? "▾" : "▸"}
                        </span>
                      )}
                      <ClubCrest tid={team.tid} colors={team.colors} />
                      <ClubLink tid={team.tid} season={snapshot.season} />
                    </span>
                  </td>
                  <td className="text-end">
                    {(() => {
                      if (showWorldRank) {
                        return (
                          <span
                            className="text-muted"
                            title={`World rank ${worldRankByTid.get(r.tid)} of ${worldTotal} by Power score`}
                          >
                            #{worldRankByTid.get(r.tid)}
                          </span>
                        );
                      }
                      return (
                        <DivisionBadge
                          competitions={league.competitions}
                          compId={r.compId}
                          rank={divisionRanks.get(r.tid)}
                        />
                      );
                    })()}
                  </td>
                  <td className="text-end">
                    {r.played > 0 ? `${r.won}-${r.drawn}-${r.lost}` : "—"}
                  </td>
                  <td className="text-end">
                    {r.played > 0 ? (r.gd > 0 ? `+${r.gd}` : r.gd) : "—"}
                  </td>
                  <td className="text-end">{r.ovr}</td>
                  <td className="text-end">
                    <span className="fw-semibold">{Math.round(r.powerScore)}</span>
                    {r.played > 0 && Math.abs(r.performanceBonus) >= 0.5 && (
                      <span
                        className={
                          "small ms-1 " + (r.performanceBonus > 0 ? "text-success" : "text-danger")
                        }
                      >
                        ({r.performanceBonus > 0 ? "+" : ""}
                        {r.performanceBonus.toFixed(1)})
                      </span>
                    )}
                  </td>
                  <td className="text-end">{r.pot}</td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={2}></td>
                    <td colSpan={7}>
                      <RosterPreview
                        team={team}
                        roster={team.roster
                          .map((pid) => playerByPid.get(pid))
                          .filter((p): p is Player => p !== undefined)}
                        season={league.season}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RosterPreview({
  team,
  roster,
  season,
}: {
  team: StoredTeam;
  roster: Player[];
  season: number;
}) {
  if (roster.length === 0) {
    return <p className="text-muted mb-2">No players on roster.</p>;
  }
  const slots = teamSlots(team);
  const coords = layoutSlots(teamFormation(team));
  const xi = resolveXI(roster, slots, team.starters);
  const xiPids = new Set(xi.map((p) => p.pid));
  const bench = sortByPosThenOvr(roster.filter((p) => !xiPids.has(p.pid)));

  return (
    <div className="mb-2">
      <div className="pitch-field">
        <div className="pitch-goal pitch-goal--left" />
        <div className="pitch-goal pitch-goal--right" />
        {xi.map((p, i) => {
          const coord = coords[i];
          return (
            <div
              key={p.pid}
              className="pitch-slot"
              style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
            >
              <PlayerRatingsTooltip player={p}>
                <span
                  className={"pitch-chip" + (p.pos === "GK" ? " pitch-chip--gk" : "")}
                  style={{ borderColor: getRatingColor(p.ovr), cursor: "default" }}
                >
                  <Link to={`/player/${p.pid}`} className="pitch-chip-name">
                    {shortName(p.name)}
                  </Link>
                  <span className="pitch-chip-ovr">{p.ovr}</span>
                </span>
              </PlayerRatingsTooltip>
            </div>
          );
        })}
      </div>
      {bench.length > 0 && (
        <>
          <h6 className="mt-3">Bench</h6>
          <table className="table table-sm mb-0">
            <thead>
              <tr>
                <th>Name</th>
                <th>Pos</th>
                <th className="text-end">Age</th>
                <th className="text-end">Ovr</th>
                <th className="text-end">Pot</th>
                <th className="text-end">Wage</th>
                <th className="text-end">Contract</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((p) => (
                <tr key={p.pid}>
                  <td>
                    <PlayerRatingsTooltip player={p}>
                      <Link to={`/player/${p.pid}`}>{p.name}</Link>
                    </PlayerRatingsTooltip>{" "}
                    <Flag nationality={p.nationality} />
                  </td>
                  <td>{p.pos}</td>
                  <td className="text-end">{season - p.born}</td>
                  <td className="text-end">{p.ovr}</td>
                  <td className="text-end"><PotDisplay player={p} /></td>
                  <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                  <td className="text-end">
                    {p.contract.expiresSeason <= season
                      ? "Final year"
                      : `Through ${seasonYear(p.contract.expiresSeason)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
