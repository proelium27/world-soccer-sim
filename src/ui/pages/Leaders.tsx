import { useEffect, useMemo, useState } from "react";
import { useSeasonStats } from "../useSeasonStats.js";
import { seasonsWithStats } from "../playerDatabase.js";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import type { LeagueStore } from "../../core/leagueState.js";
import type { Player, SeasonStats } from "../../core/players/types.js";
import type { TeamSeasonStats } from "../../core/standings.js";
import { teamSeasonStatsFor } from "../../db/leagueDb.js";
import { Flag } from "../components/Flag.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { seasonYear, per90Text } from "../format.js";
import {
  rankLeaders,
  supportsPer90,
  STAT_OPTIONS,
  type LeaderMode,
  type StatKey,
} from "../leadersBoard.js";
import { per90QualifyingMinutes } from "../../core/stats/per90.js";

type LeadersTab = "players" | "teams";

interface LeaderRow {
  player: Player;
  teamName: string;
  isUserTeam: boolean;
  stats: SeasonStats;
  /** Which season this row's stat line belongs to; shown when browsing all seasons. */
  season: number | null;
}


export function Leaders() {
  const { league } = useLeague();
  const [tab, setTab] = useState<LeadersTab>("players");
  const [compIdOverride, setCompIdOverride] = useState<number | null>(null);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  const compId = compIdOverride ?? userTeam?.compId ?? league.competitions[0].id;

  return (
    <div className="container-fluid p-3">
      <h4>Stat Leaders</h4>
      <div className="mb-3 d-flex gap-2 align-items-center">
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn btn-sm ${tab === "players" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setTab("players")}
          >
            Players
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === "teams" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setTab("teams")}
          >
            Teams
          </button>
        </div>
        <CompetitionSelect
          competitions={league.competitions}
          value={compId}
          onChange={(v) => setCompIdOverride(v === "all" ? null : v)}
          style={{ width: "auto" }}
        />
      </div>
      {tab === "players" ? <PlayerLeaders compId={compId} /> : <TeamLeaders compId={compId} />}
    </div>
  );
}

function PlayerLeaders({ compId }: { compId: number }) {
  const { league } = useLeague();

  // The same list the Database's season picker offers, off the career summaries
  // and the window, so neither needs a season read back to know it exists.
  const seasonOptions = useMemo(
    () => seasonsWithStats(league?.players ?? []),
    [league?.players],
  );

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  if (seasonOptions.length === 0) {
    return <p>No matches played yet.</p>;
  }

  return <PlayerLeadersBody league={league} compId={compId} seasonOptions={seasonOptions} />;
}

// Split out from the guards above so its hooks run unconditionally, which lets
// every derivation below be memoized. All of it is O(players) — three separate
// scans over the whole world's player pool, each reading multi-season stat
// histories — and all of it sits directly on the interaction path: changing the
// season, scope, or stat dropdown re-renders this component. Unmemoized, each
// of those clicks redid the lot, which is what put this page's INP in the
// 8-14 second range on mobile.
function PlayerLeadersBody({
  league,
  compId,
  seasonOptions,
}: {
  league: LeagueStore;
  compId: number;
  seasonOptions: number[];
}) {
  const [stat, setStat] = useState<StatKey>("goals");
  // Totals or per-90 rates. Per 90 is what makes a squad player comparable to
  // an ever-present; totals stay the default because they're what a league
  // table of scorers means by "top scorer".
  const [mode, setMode] = useState<LeaderMode>("totals");
  // This board is per-season only. The all-seasons career and best-season views
  // it used to carry now live on Frivolities' All-Time Leaders tab, which can
  // also rank archived retirees — something this page never could, since it
  // reads the live player pool and retirement deletes from it.
  const [season, setSeason] = useState<number>(
    seasonOptions.includes(league.season) ? league.season : seasonOptions[0],
  );
  const [initializedSeason, setInitializedSeason] = useState(false);
  // That season's lines, from memory or read back from disk (useSeasonStats).
  const lines = useSeasonStats(league, season);

  useEffect(() => {
    if (initializedSeason) return;
    // The current season may have no recorded stats yet (right after advancing,
    // before its first match) — fall back to the most recent season that does.
    setSeason(seasonOptions.includes(league.season) ? league.season : seasonOptions[0]);
    setInitializedSeason(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, initializedSeason]);

  // A player's *current* team (used for the Career aggregate, which spans
  // many seasons and has no single "correct" historical team to show).
  const { compTids } = useMemo(() => {
    const compTids = new Set<number>();
    for (const team of league.teams) {
      if (team.compId !== compId) continue;
      compTids.add(team.tid);
    }
    return { compTids };
  }, [league.teams, compId]);

  // How many games this competition has played in a given season — the
  // denominator the Match Rating qualifier takes a fraction of. The current
  // season is in progress (count distinct matchdays played so far); any earlier
  // season is complete, so it's the full double round-robin.
  const matchesPlayedInSeason = useMemo(() => {
    const mds = new Set<number>();
    for (const m of league.played) {
      if (compTids.has(m.home) || compTids.has(m.away)) mds.add(m.matchday);
    }
    const currentMatchdaysPlayed = mds.size;
    const fullSeasonMatches = Math.max(0, 2 * (compTids.size - 1));
    return (s: number): number =>
      s === league.season ? currentMatchdaysPlayed : fullSeasonMatches;
  }, [league.played, league.season, compTids]);

  // A specific season's stat line carries the team the player was actually
  // on that season (SeasonStats.tid); this map resolves any tid to its
  // current display name/division, since a club's compId can itself have
  // changed since then (promotion/relegation).
  const { teamNameByTid, compByTidForSeason } = useMemo(() => {
    const teamNameByTid = new Map<number, string>();
    const currentCompByTid = new Map<number, number>();
    for (const team of league.teams) {
      teamNameByTid.set(team.tid, team.name);
      currentCompByTid.set(team.tid, team.compId);
    }
    const compByTidCache = new Map<number, Map<number, number>>();
    const compByTidForSeason = (s: number): Map<number, number> => {
      let m = compByTidCache.get(s);
      if (!m) {
        const entry = league.seasonHistory.find((h) => h.season === s);
        m = entry
          ? new Map(Object.entries(entry.compsByTid).map(([k, v]) => [Number(k), v]))
          : currentCompByTid;
        compByTidCache.set(s, m);
      }
      return m;
    };
    return { teamNameByTid, compByTidForSeason };
  }, [league.teams, league.seasonHistory]);

  const rows = useMemo(() => {
    const rows: LeaderRow[] = [];
    const compByTid = compByTidForSeason(season);
    for (const p of league.players) {
      const ss = lines.lineOf(p);
      if (!ss || ss[stat] <= 0) continue;
      if (compByTid.get(ss.tid) !== compId) continue;
      rows.push({
        player: p,
        teamName: teamNameByTid.get(ss.tid) ?? "Unknown",
        isUserTeam: ss.tid === league.meta.userTid,
        stats: ss,
        season: null,
      });
    }
    return rows;
  }, [
    league.players, league.meta.userTid, season, stat, compId,
    compByTidForSeason, teamNameByTid, lines,
  ]);

  // Ranking and both playing-time qualifiers live in ../leadersBoard.js — the
  // Match Rating appearance gate (an average is meaningless on one hot cameo)
  // and the per-90 minutes gate (a rate is worse: a 12-minute goal reads 7.5
  // per 90 and owns the board forever). Both scale to games played so far.
  const top = useMemo(
    () => rankLeaders(rows, { stat, mode, matchesPlayed: matchesPlayedInSeason(season) }),
    [rows, stat, mode, season, matchesPlayedInSeason],
  );

  // Whether the selected stat is actually being shown as a rate. Match Rating
  // and Minutes have no per-90 meaning, so they ignore the toggle.
  const rate = mode === "per90" && supportsPer90(stat);
  const qualifyingMinutes = per90QualifyingMinutes(matchesPlayedInSeason(season));

  const showSeasonColumn = false;

  return (
    <>
      <div className="mb-3 d-flex gap-2">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
        >
          {seasonOptions.map((s) => (
            <option key={s} value={s}>{seasonYear(s)}</option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={stat}
          onChange={(e) => setStat(e.target.value as StatKey)}
        >
          {STAT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        {lines.loading && (
          <span className="text-muted small align-self-center" role="status">Loading that season...</span>
        )}
        <div className="btn-group" role="group" aria-label="Totals or per 90 minutes">
          <button
            type="button"
            className={`btn btn-sm ${mode === "totals" ? "btn-secondary" : "btn-outline-secondary"}`}
            onClick={() => setMode("totals")}
          >
            Totals
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === "per90" ? "btn-secondary" : "btn-outline-secondary"}`}
            onClick={() => setMode("per90")}
            disabled={!supportsPer90(stat)}
            title={
              supportsPer90(stat)
                ? "Stats divided by 90-minute matches played"
                : "This stat is already an average, so it has no per-90 rate"
            }
          >
            Per 90
          </button>
        </div>
      </div>
      {rate && (
        <p className="text-muted small mb-2">
          Per 90 minutes played. Needs {qualifyingMinutes.toLocaleString()} minutes
          to qualify, so a substitute can't top the board on one cameo.
        </p>
      )}
      {/* Per-90 mode adds "/90" to eleven headers, which is enough to push this
          table past its container on a narrow window — let it scroll itself
          rather than clipping the last column, as the Player Profile does. */}
      <div className="table-responsive">
        <table className="table table-striped table-sm">
          <thead>
            <tr>
              <th className="text-end">#</th>
              <th>Player</th>
              <th>Team</th>
              <th>Pos</th>
              {showSeasonColumn && <th className="text-end">Season</th>}
              <th className="text-end">Apps</th>
              <th className="text-end">Min</th>
              <th className="text-end">G{rate && "/90"}</th>
              <th className="text-end">A{rate && "/90"}</th>
              <th className="text-end">Sh{rate && "/90"}</th>
              <th className="text-end">SoT{rate && "/90"}</th>
              <th className="text-end">xG{rate && "/90"}</th>
              <th className="text-end">Sv{rate && "/90"}</th>
              <th className="text-end">Tkl{rate && "/90"}</th>
              <th className="text-end">Int{rate && "/90"}</th>
              <th className="text-end" title="Passes completed / attempted">Pass{rate && "/90"}</th>
              <th className="text-end" title="Crosses">Crs{rate && "/90"}</th>
              <th className="text-end" title="Fouls committed">Fls{rate && "/90"}</th>
              <th className="text-end" title="Yellow cards">YC{rate && "/90"}</th>
              <th className="text-end" title="Red cards">RC{rate && "/90"}</th>
              <th className="text-end">Rtg</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => {
            const mins = row.stats.minutesPlayed;
            // In rate mode every counting column becomes a per-90 figure; Apps,
            // Min and Rtg stay as they are — the first two are the denominator
            // and its context, the last is already an average.
            const v = (value: number) => (rate ? per90Text(value, mins) : String(value));
            return (
              <tr
                key={row.season === null ? row.player.pid : `${row.player.pid}-${row.season}`}
                className={row.isUserTeam ? "text-primary fw-semibold" : undefined}
              >
                <td className="text-end">{i + 1}</td>
                <td>
                  <PlayerRatingsTooltip player={row.player}>
                    <Link to={`/player/${row.player.pid}`}>{row.player.name}</Link>
                  </PlayerRatingsTooltip>{" "}
                  <Flag nationality={row.player.nationality} />
                </td>
                <td><ClubLink tid={row.stats.tid} season={row.season ?? undefined} /></td>
                <td>{row.player.pos}</td>
                {showSeasonColumn && (
                  <td className="text-end">{row.season !== null ? seasonYear(row.season) : ""}</td>
                )}
                <td className="text-end">{row.stats.appearances}</td>
                <td className="text-end">{mins}</td>
                <td className="text-end">{v(row.stats.goals)}</td>
                <td className="text-end">{v(row.stats.assists)}</td>
                <td className="text-end">{v(row.stats.shots)}</td>
                <td className="text-end">{v(row.stats.shotsOnTarget)}</td>
                <td className="text-end">
                  {rate ? per90Text(row.stats.xg, mins) : row.stats.xg.toFixed(2)}
                </td>
                <td className="text-end">{v(row.stats.saves)}</td>
                <td className="text-end">{v(row.stats.tackles)}</td>
                <td className="text-end">{v(row.stats.interceptions)}</td>
                <td className="text-end">
                  {row.stats.passes
                    ? `${v(row.stats.passesCompleted)}/${v(row.stats.passes)}`
                    : ""}
                </td>
                <td className="text-end">{v(row.stats.crosses)}</td>
                <td className="text-end">{v(row.stats.foulsCommitted)}</td>
                <td className="text-end">{v(row.stats.yellowCards)}</td>
                <td className="text-end">{v(row.stats.redCards)}</td>
                <td className="text-end">{row.stats.avgRating.toFixed(2)}</td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

type TeamStatKey =
  | "goals" | "assists" | "shots" | "shotsOnTarget" | "xg" | "goalsAgainst" | "xga"
  | "saves" | "tackles" | "possessionPct" | "avgRating";

const TEAM_STAT_OPTIONS: { key: TeamStatKey; label: string }[] = [
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "shots", label: "Shots" },
  { key: "shotsOnTarget", label: "Shots on Target" },
  { key: "xg", label: "xG" },
  { key: "goalsAgainst", label: "Goals Against" },
  { key: "xga", label: "xG Against" },
  { key: "saves", label: "Saves" },
  { key: "tackles", label: "Tackles" },
  { key: "possessionPct", label: "Possession" },
  { key: "avgRating", label: "Match Rating" },
];

interface TeamLeaderRow extends TeamSeasonStats {
  teamName: string;
  isUserTeam: boolean;
}

function TeamLeaders({ compId }: { compId: number }) {
  const { league } = useLeague();
  const [stat, setStat] = useState<TeamStatKey>("goals");
  const [season, setSeason] = useState<number | "current">("current");

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const seasonOptions = [...league.seasonHistory.map((h) => h.season)].sort((a, b) => b - a);

  if (league.played.length === 0 && seasonOptions.length === 0) {
    return <p>No matches played yet.</p>;
  }

  const teamIds = league.teams.filter((t) => t.compId === compId).map((t) => t.tid);
  const teamStats: TeamSeasonStats[] = season === "current"
    ? teamSeasonStatsFor(league, teamIds)
    : (league.seasonHistory.find((h) => h.season === season)?.teamStats ?? [])
        .filter((s) => league.seasonHistory.find((h) => h.season === season)?.compsByTid[s.tid] === compId);

  const teamByTid = new Map(league.teams.map((t) => [t.tid, t.name]));
  const rows: TeamLeaderRow[] = teamStats.map((s) => ({
    ...s,
    teamName: teamByTid.get(s.tid) ?? "Unknown",
    isUserTeam: s.tid === league.meta.userTid,
  }));
  rows.sort((a, b) => b[stat] - a[stat]);

  return (
    <>
      <div className="mb-3 d-flex gap-2">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={season}
          onChange={(e) => setSeason(e.target.value === "current" ? "current" : Number(e.target.value))}
        >
          <option value="current">Current Season ({seasonYear(league.season)})</option>
          {seasonOptions.map((s) => (
            <option key={s} value={s}>{seasonYear(s)}</option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={stat}
          onChange={(e) => setStat(e.target.value as TeamStatKey)}
        >
          {TEAM_STAT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted">
          No team stats recorded for this season (saves from before Team Stat Leaders history
          don't have box-score data for seasons that already ended).
        </p>
      ) : (
        <table className="table table-striped table-sm">
          <thead>
            <tr>
              <th className="text-end">#</th>
              <th>Team</th>
              <th className="text-end">Pld</th>
              <th className="text-end">G</th>
              <th className="text-end">A</th>
              <th className="text-end">Sh</th>
              <th className="text-end">SoT</th>
              <th className="text-end">xG</th>
              <th className="text-end">GA</th>
              <th className="text-end">xGA</th>
              <th className="text-end">Sv</th>
              <th className="text-end">Tkl</th>
              <th className="text-end">Poss%</th>
              <th className="text-end">Rtg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.tid}
                className={row.isUserTeam ? "text-primary fw-semibold" : undefined}
              >
                <td className="text-end">{i + 1}</td>
                <td><ClubLink tid={row.tid} season={season === "current" ? undefined : season} /></td>
                <td className="text-end">{row.played}</td>
                <td className="text-end">{row.goals}</td>
                <td className="text-end">{row.assists}</td>
                <td className="text-end">{row.shots}</td>
                <td className="text-end">{row.shotsOnTarget}</td>
                <td className="text-end">{row.xg.toFixed(2)}</td>
                <td className="text-end">{row.goalsAgainst}</td>
                <td className="text-end">{row.xga.toFixed(2)}</td>
                <td className="text-end">{row.saves}</td>
                <td className="text-end">{row.tackles}</td>
                <td className="text-end">{row.possessionPct.toFixed(1)}</td>
                <td className="text-end">{row.avgRating.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
