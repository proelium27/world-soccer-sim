/**
 * Watching a match, as a page.
 *
 * Two routes land here and they are genuinely different things:
 *
 *  - `/watch` plays the matchday that has just been simulated but NOT yet
 *    committed. LeagueContext holds the result and the candidates; this is only
 *    the screen for them.
 *  - `/watch/:matchIndex` replays a match already in `league.played`, reached
 *    from its box score. Nothing is pending and nothing is committed.
 *
 * It used to be a modal laid over whatever page you were on. It is a route
 * because a screen reader user asked for it (2026-09-08): a dialog has to be
 * announced, focus-managed and dismissed before the rest of the app can be
 * read at all, where a page is just a document with headings to jump between
 * and a URL you can leave by. It is also how ZenGM does it.
 */
import { useCallback, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { BackLink } from "../components/BackLink.js";
import { LiveMatchView } from "../components/LiveMatchView.js";
import { LiveMatchPicker } from "../components/LiveMatchPicker.js";
import { competitionOf } from "../../core/competitions.js";
import { liveTableRows, toLiveMatch } from "../live/liveMatch.js";
import { matchLineups } from "../live/lineups.js";

/** The route the pending-match redirect defends. Exported so the guard can't drift from it. */
export const WATCH_PATH = "/watch";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-fluid p-3" style={{ maxWidth: 640 }}>
      <h1 className="h4">Nothing to watch</h1>
      <p className="text-muted">{children}</p>
      <Link to="/dashboard" className="btn btn-secondary">
        Back to dashboard
      </Link>
    </div>
  );
}

/** Replay a match the save already holds. */
function Rewatch({ matchIndex }: { matchIndex: number }) {
  const { league } = useLeague();
  const navigate = useNavigate();
  const playerMap = usePlayerMap(league?.players);
  const playerName = useCallback(
    (pid: number) => playerMap.get(pid)?.name ?? `Player ${pid}`,
    [playerMap],
  );

  const match = league?.played[matchIndex];
  const close = useCallback(
    () => navigate(`/box-score/${matchIndex}`),
    [navigate, matchIndex],
  );

  // Hooks cannot sit under an early return, so the whole derivation is memoized
  // above the guard and simply answers null when there is no match.
  const view = useMemo(() => {
    if (!league || !match) return null;
    const homeTeam = league.teams.find((t) => t.tid === match.home);
    const compTeamIds = league.teams
      .filter((t) => t.compId === homeTeam?.compId)
      .map((t) => t.tid);
    const inComp = new Set(compTeamIds);
    const sameMatchday = league.played.filter(
      (m) => m.matchday === match.matchday && inComp.has(m.home),
    );
    const watched = toLiveMatch(match);
    const others = sameMatchday.filter((m) => m !== match).map(toLiveMatch);
    return {
      watched,
      others,
      compTeamIds,
      competitionName:
        homeTeam === undefined
          ? ""
          : competitionOf(league.competitions, homeTeam.compId).name,
      // The table as it stood going INTO this matchday, so it climbs the same
      // way it did on the day rather than starting from today's finished
      // position.
      prior: league.played.filter((m) => m.matchday < match.matchday && inComp.has(m.home)),
      lineups: matchLineups(match.boxScore),
    };
  }, [league, match]);

  if (!league) return null;
  if (!match || !view) {
    return <Empty>That match isn&apos;t in this save.</Empty>;
  }

  return (
    <div className="container-fluid p-3 watch-page">
      <div className="watch-topbar">
        <BackLink fallback={`/box-score/${matchIndex}`} />
      </div>
      <LiveMatchView
        match={view.watched}
        otherMatches={view.others}
        teams={league.teams}
        playerName={playerName}
        competitionName={view.competitionName}
        tableAtMinute={(minute) =>
          liveTableRows(view.compTeamIds, view.prior, [view.watched, ...view.others], minute)
        }
        lineups={view.lineups}
        onComplete={close}
        completeLabel="Back to the box score"
      />
    </div>
  );
}

/** The matchday just simulated, still uncommitted. */
function LiveWatch() {
  const { league, liveMatch, chooseLiveMatch, finishLiveMatch } = useLeague();
  const playerMap = usePlayerMap(league?.players);
  const playerName = useCallback(
    (pid: number) => playerMap.get(pid)?.name ?? `Player ${pid}`,
    [playerMap],
  );

  if (!liveMatch) {
    return (
      <Empty>
        There&apos;s no match in progress. Sim a matchday with &quot;Watch next game&quot; to
        follow one minute by minute, or open any played match&apos;s box score and watch it
        back.
      </Empty>
    );
  }

  const chosen = liveMatch.candidates.find((c) => c.key === liveMatch.chosen);
  if (!chosen) {
    return (
      <div className="container-fluid p-3 watch-page">
        <LiveMatchPicker
          choices={liveMatch.candidates.map((c) => c.choice)}
          onPick={chooseLiveMatch}
          onSkip={finishLiveMatch}
        />
      </div>
    );
  }

  return (
    <div className="container-fluid p-3 watch-page">
      <LiveMatchView
        match={chosen.view.match}
        otherMatches={chosen.view.otherMatches}
        teams={league?.teams ?? []}
        playerName={playerName}
        competitionName={chosen.view.competitionName}
        subtitle={chosen.view.subtitle}
        tableAtMinute={chosen.view.tableAtMinute}
        lineups={chosen.view.lineups}
        onComplete={finishLiveMatch}
        skipLabel="Skip the rest"
      />
    </div>
  );
}

export function WatchMatch() {
  const { matchIndex } = useParams<{ matchIndex?: string }>();
  const index = matchIndex === undefined ? null : Number(matchIndex);
  if (index !== null) {
    if (!Number.isInteger(index) || index < 0) {
      return <Empty>That isn&apos;t a match this save has played.</Empty>;
    }
    return <Rewatch matchIndex={index} />;
  }
  return <LiveWatch />;
}

/**
 * Keeps the user on the watch page while a simulated matchday is uncommitted.
 *
 * This is the one thing the modal was doing that a route does not do for free.
 * The matchday sits in LeagueContext's pendingResultRef, computed from the
 * PRE-sim league — so a mutation made elsewhere in the meantime (a lineup drag,
 * a signing) would be saved and then silently overwritten when the match
 * finishes and that pre-sim-derived result is committed. A classic lost update,
 * and a silent one.
 *
 * The alternative considered and rejected was committing on navigate-away.
 * StrictMode double-invokes effects, so an unmount cleanup that commits fires
 * during the simulated remount in development, ending the match the instant it
 * starts — and there is no way to tell that unmount from a real one.
 *
 * Kept bearable by the viewer's own always-available exit (`skipLabel`): you
 * can leave at any minute, you just have to leave through the match.
 */
export function LiveMatchRedirect({ active }: { active: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (active && location.pathname !== WATCH_PATH) {
      navigate(WATCH_PATH, { replace: true });
    }
  }, [active, location.pathname, navigate]);
  return null;
}
