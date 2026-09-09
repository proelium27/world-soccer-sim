import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { usePlayerMap } from "../usePlayerMap.js";
import type { PlayedMatch } from "../../core/standings.js";
import type { PlayerMatchLine } from "../../engine/attribution.js";
import { Flag } from "../components/Flag.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { BackLink } from "../components/BackLink.js";
import { KEY_EVENTS, TimelineRow } from "../components/matchEvents.js";


function ratingClass(rating: number): string {
  if (rating >= 8) return "text-success fw-semibold";
  if (rating < 6) return "text-danger";
  return "";
}

/* ---------------------------------------------------------------------------
   Icons. Hand-drawn inline SVG, never emoji (UI convention).
   --------------------------------------------------------------------------- */

function StarIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.9 6.26L21.6 9.2l-4.9 4.66 1.22 6.94L12 17.5l-5.92 3.3 1.22-6.94L2.4 9.2l6.7-.94z" />
    </svg>
  );
}


/* ---------------------------------------------------------------------------
   Scoreboard header
   --------------------------------------------------------------------------- */

function ScoreboardSide({
  tid,
  colors,
  goals,
  won,
  lost,
  align,
}: {
  tid: number;
  colors: [string, string];
  goals: number;
  won: boolean;
  lost: boolean;
  align: "home" | "away";
}) {
  const nameEl = (
    <span className={`bs-club-name${won ? " bs-club-name--won" : ""}${lost ? " bs-club-name--lost" : ""}`}>
      <ClubLink tid={tid} className="bs-club-link" />
    </span>
  );
  const crest = <ClubCrest tid={tid} colors={colors} size={30} />;
  return (
    <div className={`bs-club bs-club--${align}`}>
      {align === "home" ? (
        <>
          {nameEl}
          {crest}
        </>
      ) : (
        <>
          {crest}
          {nameEl}
        </>
      )}
      <span className={`bs-goals${lost ? " bs-goals--lost" : ""}`}>{goals}</span>
    </div>
  );
}

/** One row of the head-to-head strip: a value each side, a shared label, two proportional bars. */
function CompareRow({
  label,
  home,
  away,
  format,
}: {
  label: string;
  home: number;
  away: number;
  format?: (n: number) => string;
}) {
  const total = home + away;
  const homePct = total > 0 ? (home / total) * 100 : 0;
  const awayPct = total > 0 ? (away / total) * 100 : 0;
  const show = format ?? ((n: number) => String(n));
  return (
    <div className="bs-compare-row">
      <span className="bs-compare-val stat-num">{show(home)}</span>
      <span className="bs-compare-track bs-compare-track--home">
        <span className="bs-compare-fill" style={{ width: `${homePct}%` }} />
      </span>
      <span className="bs-compare-label">{label}</span>
      <span className="bs-compare-track bs-compare-track--away">
        <span className="bs-compare-fill" style={{ width: `${awayPct}%` }} />
      </span>
      <span className="bs-compare-val stat-num">{show(away)}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Team box score
   --------------------------------------------------------------------------- */

/** Column groups, so 19 stat columns read as six scannable blocks rather than one wall. */
const COLUMN_GROUPS: { label: string; span: number }[] = [
  { label: "", span: 3 },
  { label: "Attacking", span: 5 },
  { label: "Keeping", span: 3 },
  { label: "Defending", span: 2 },
  { label: "Passing", span: 2 },
  { label: "Discipline", span: 3 },
  { label: "", span: 1 },
];

function TeamBoxTable({
  tid,
  colors,
  lines,
  playerName,
  playerPos,
  playerNationality,
  motmPid,
}: {
  tid: number;
  colors: [string, string];
  lines: PlayerMatchLine[];
  playerName: (pid: number) => string;
  playerPos: (pid: number) => string;
  playerNationality: (pid: number) => string | undefined;
  motmPid: number | null;
}) {
  return (
    <section className="bs-team-block">
      <h6 className="bs-team-heading">
        <ClubCrest tid={tid} colors={colors} size={18} />
        <ClubLink tid={tid} className="bs-club-link" />
      </h6>
      <table className="table table-sm table-striped bs-table">
        <thead>
          <tr className="bs-group-row">
            {COLUMN_GROUPS.map((g, i) => (
              <th key={i} colSpan={g.span} className={g.label ? "bs-group" : undefined}>
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th className="text-end">Min</th>
            <th className="text-end bs-group" title="Goals">G</th>
            <th className="text-end" title="Assists">A</th>
            <th className="text-end" title="Shots">Sh</th>
            <th className="text-end" title="Shots on target">SoT</th>
            <th className="text-end" title="Expected goals">xG</th>
            <th className="text-end bs-group" title="Saves">Sv</th>
            <th className="text-end" title="Goals against (keeper)">GA</th>
            <th className="text-end" title="Expected goals against (keeper)">xGA</th>
            <th className="text-end bs-group" title="Tackles">Tkl</th>
            <th className="text-end" title="Interceptions">Int</th>
            <th className="text-end bs-group" title="Passes completed / attempted">Pass</th>
            <th className="text-end" title="Crosses">Crs</th>
            <th className="text-end bs-group" title="Fouls committed">Fls</th>
            <th className="text-end" title="Yellow cards">YC</th>
            <th className="text-end" title="Red cards">RC</th>
            <th className="text-end bs-group" title="Match rating">Rtg</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            // The job he did, not the kind of player he is: a winger who filled
            // in at full-back is a full-back for this match, which is also what
            // his rating was computed against. Falls back to his listed
            // position on a box score written before slots were recorded.
            const played = line.slot ?? playerPos(line.pid);
            const isKeeper = played === "GK";
            const nat = playerNationality(line.pid);
            return (
              <tr key={line.pid} className={line.pid === motmPid ? "bs-row-motm" : undefined}>
                <td className="bs-player-cell">
                  {line.pid === motmPid && (
                    <span className="bs-motm-mark" title="Man of the match" aria-label="Man of the match">
                      <StarIcon />
                    </span>
                  )}
                  <Link to={`/player/${line.pid}`}>{playerName(line.pid)}</Link>
                  {nat && <Flag nationality={nat} />}
                </td>
                <td className="bs-pos">{played}</td>
                <td className="text-end">{line.minutesPlayed}</td>
                <td className="text-end bs-group">{line.goals || ""}</td>
                <td className="text-end">{line.assists || ""}</td>
                <td className="text-end">{line.shots || ""}</td>
                <td className="text-end">{line.shotsOnTarget || ""}</td>
                <td className="text-end">{line.xg > 0 ? line.xg.toFixed(2) : ""}</td>
                <td className="text-end bs-group">{line.saves || ""}</td>
                <td className="text-end">{isKeeper ? line.goalsAgainst : ""}</td>
                <td className="text-end">{isKeeper ? line.xga.toFixed(2) : ""}</td>
                <td className="text-end bs-group">{line.tackles || ""}</td>
                <td className="text-end">{line.interceptions || ""}</td>
                <td className="text-end bs-group">
                  {line.passes ? `${line.passesCompleted}/${line.passes}` : ""}
                </td>
                <td className="text-end">{line.crosses || ""}</td>
                <td className="text-end bs-group">{line.foulsCommitted || ""}</td>
                <td className="text-end">{line.yellowCards || ""}</td>
                <td className="text-end">{line.redCards || ""}</td>
                <td className={`text-end bs-group ${ratingClass(line.rating)}`}>
                  {line.rating.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Highest-rated player with actual minutes on the pitch, across both sides. */
function manOfTheMatch(match: PlayedMatch): PlayerMatchLine | null {
  const candidates = [...match.boxScore.home, ...match.boxScore.away].filter(
    (l) => l.minutesPlayed > 0,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, l) => (l.rating > best.rating ? l : best));
}

/* ---------------------------------------------------------------------------
   Play-by-play timeline
   --------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   Page
   --------------------------------------------------------------------------- */

export function BoxScore() {
  const { matchIndex } = useParams<{ matchIndex: string }>();
  const { league } = useLeague();
  const playerMap = usePlayerMap(league?.players);
  const [showAllEvents, setShowAllEvents] = useState(false);

  if (!league || matchIndex === undefined) {
    return <p className="p-3">Loading...</p>;
  }

  const idx = parseInt(matchIndex, 10);
  const match: PlayedMatch | undefined = league.played[idx];

  if (!match) {
    return (
      <div className="container-fluid p-3">
        <p>Match not found.</p>
        <BackLink fallback="/schedule" />
      </div>
    );
  }

  const homeTeam = league.teams.find((t) => t.tid === match.home);
  const awayTeam = league.teams.find((t) => t.tid === match.away);
  const homeName = homeTeam?.name ?? "Home";
  const awayName = awayTeam?.name ?? "Away";
  const homeColors: [string, string] = homeTeam?.colors ?? ["#888888", "#888888"];
  const awayColors: [string, string] = awayTeam?.colors ?? ["#888888", "#888888"];
  const compName = league.competitions.find((c) => c.id === homeTeam?.compId)?.name;

  const playerName = (pid: number) => playerMap.get(pid)?.name ?? `#${pid}`;
  const playerPos = (pid: number) => playerMap.get(pid)?.pos ?? "?";
  const playerNationality = (pid: number) => playerMap.get(pid)?.nationality;

  const sum = (lines: PlayerMatchLine[], pick: (l: PlayerMatchLine) => number) =>
    lines.reduce((total, l) => total + pick(l), 0);

  const home = match.boxScore.home;
  const away = match.boxScore.away;
  const possHome = Math.round(match.possessionHome * 100);
  const corners = (side: "home" | "away") =>
    match.boxScore.events.filter((e) => e.type === "corner" && e.side === side).length;

  const motm = manOfTheMatch(match);
  const motmIsHome = motm ? home.some((l) => l.pid === motm.pid) : false;

  const events = match.boxScore.events
    .filter((e) => e.type !== "turnover")
    .filter((e) => showAllEvents || KEY_EVENTS.has(e.type))
    // The clock counts down, so descending clock is chronological order.
    .sort((a, b) => b.clock - a.clock);

  return (
    <div className="container-fluid p-3 bs-page">
      <div className="bs-topbar">
        <BackLink fallback="/schedule" className="bs-back" />
        {/* A link rather than a button opening an overlay: the viewer is its
            own route, so this match's replay has a URL and a back button. */}
        <Link to={`/watch/${matchIndex}`} className="btn btn-sm btn-outline-secondary">
          Watch it back
        </Link>
      </div>

      <header className="bs-scoreboard">
        <div className="bs-eyebrow">
          {compName ? `${compName} · ` : ""}Matchday {match.matchday}
        </div>
        <div className="bs-scoreline">
          <ScoreboardSide
            tid={match.home}
            colors={homeColors}
            goals={match.homeGoals}
            won={match.homeGoals > match.awayGoals}
            lost={match.homeGoals < match.awayGoals}
            align="home"
          />
          <span className="bs-score-sep" aria-hidden="true" />
          <ScoreboardSide
            tid={match.away}
            colors={awayColors}
            goals={match.awayGoals}
            won={match.awayGoals > match.homeGoals}
            lost={match.awayGoals < match.homeGoals}
            align="away"
          />
        </div>

        {motm && (
          <div className={`bs-motm bs-motm--${motmIsHome ? "home" : "away"}`}>
            <span className="bs-motm-mark">
              <StarIcon size={11} />
            </span>
            <span className="bs-motm-label">Man of the match</span>
            <Link to={`/player/${motm.pid}`} className="bs-motm-name">
              {playerName(motm.pid)}
            </Link>
            <span className="bs-motm-meta">
              {playerPos(motm.pid)} · {motmIsHome ? homeName : awayName} ·{" "}
              <span className="stat-num">{motm.rating.toFixed(1)}</span>
            </span>
          </div>
        )}
      </header>

      <section className="bs-compare" aria-label="Match statistics">
        <CompareRow label="Possession" home={possHome} away={100 - possHome} format={(n) => `${n}%`} />
        <CompareRow label="Shots" home={sum(home, (l) => l.shots)} away={sum(away, (l) => l.shots)} />
        <CompareRow
          label="On target"
          home={sum(home, (l) => l.shotsOnTarget)}
          away={sum(away, (l) => l.shotsOnTarget)}
        />
        <CompareRow
          label="xG"
          home={sum(home, (l) => l.xg)}
          away={sum(away, (l) => l.xg)}
          format={(n) => n.toFixed(2)}
        />
        <CompareRow label="Corners" home={corners("home")} away={corners("away")} />
        <CompareRow
          label="Fouls"
          home={sum(home, (l) => l.foulsCommitted)}
          away={sum(away, (l) => l.foulsCommitted)}
        />
      </section>

      <TeamBoxTable
        tid={match.home}
        colors={homeColors}
        lines={home}
        playerName={playerName}
        playerPos={playerPos}
        playerNationality={playerNationality}
        motmPid={motm?.pid ?? null}
      />
      <TeamBoxTable
        tid={match.away}
        colors={awayColors}
        lines={away}
        playerName={playerName}
        playerPos={playerPos}
        playerNationality={playerNationality}
        motmPid={motm?.pid ?? null}
      />

      <div className="bs-timeline-head">
        <h6>Play-by-play</h6>
        <div className="btn-group btn-group-sm" role="group" aria-label="Event detail">
          <button
            type="button"
            className={`btn ${showAllEvents ? "btn-outline-success" : "btn-success"}`}
            onClick={() => setShowAllEvents(false)}
          >
            Key events
          </button>
          <button
            type="button"
            className={`btn ${showAllEvents ? "btn-success" : "btn-outline-success"}`}
            onClick={() => setShowAllEvents(true)}
          >
            Every event
          </button>
        </div>
      </div>

      <div className="bs-timeline">
        {events.length === 0 ? (
          <p className="text-muted mb-0 p-3">Nothing worth reporting happened.</p>
        ) : (
          events.map((e, i) => <TimelineRow key={i} event={e} playerName={playerName} />)
        )}
      </div>
    </div>
  );
}
