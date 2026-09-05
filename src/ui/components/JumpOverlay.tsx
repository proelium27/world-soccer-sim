/**
 * The overlay a multi-season jump runs behind: a progress bar while the AI
 * plays the seasons out, then the recap of what it did with your club.
 *
 * The recap is the point. A jump is the one action in the game where several
 * years of your club's life happen without you seeing a single screen of it, so
 * landing back on the Dashboard with a new season and no explanation would be
 * the worst version of this feature. Everything shown is derived from
 * `seasonHistory` by `computeClubHistory` — the same source the Club History
 * page reads — so nothing extra is stored to produce it.
 */
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { LeagueStore } from "../../core/leagueState.js";
import { computeClubHistory } from "../../core/clubHistory.js";
import { seasonYear } from "../format.js";
import type { JumpProgressUpdate } from "../useSimWorker.js";

export interface JumpResult {
  league: LeagueStore;
  /** The seasons the AI actually picked the team for. */
  managedSeasons: number[];
}

interface JumpOverlayProps {
  open: boolean;
  /** Live progress while the worker is running; null once it's done. */
  progress: JumpProgressUpdate | null;
  /** The finished jump; null while it's still running. */
  result: JumpResult | null;
  onClose: () => void;
}

/** "3rd", "1st" — the club's finishing position reads better as an ordinal. */
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function JumpOverlay({ open, progress, result, onClose }: JumpOverlayProps): ReactNode {
  const rows = useMemo(() => {
    if (!result) return [];
    const managed = new Set(result.managedSeasons);
    // A club's competition changes with promotion and relegation, so the name
    // comes from the season's own compId rather than where the club sits now.
    const compName = new Map(result.league.competitions.map((c) => [c.id, c.name]));
    const history = computeClubHistory(result.league, result.league.meta.userTid);
    return history.seasons
      .filter((s) => managed.has(s.season))
      // Oldest first. Club History leads with the most recent season, which is
      // right for browsing a career, but this is the story of the years you
      // missed and it should run forwards.
      .sort((a, b) => a.season - b.season)
      .map((s) => ({ ...s, compName: compName.get(s.compId) ?? "—" }));
  }, [result]);

  if (!open) return null;

  const club = result?.league.teams.find((t) => t.tid === result.league.meta.userTid);
  const done = progress ? progress.seasonsDone : 0;
  const total = progress ? progress.totalSeasons : 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="sim-overlay">
      <div className="jump-overlay card">
        <div className="card-body">
          {result === null ? (
            <>
              <h5 className="card-title">Jumping ahead</h5>
              <p className="text-muted small mb-3">
                {progress
                  ? `Playing ${seasonYear(progress.season)}, season ${done + 1} of ${total}.`
                  : "Getting started."}{" "}
                Your club is being run by the AI until this finishes.
              </p>
              <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-bar" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-muted small mt-3 mb-0">
                A season takes a while to play out, so a long jump can run for several
                minutes. Leave this open.
              </p>
            </>
          ) : (
            <>
              <h5 className="card-title">
                Welcome back to {seasonYear(result.league.season)}
              </h5>
              <p className="text-muted small mb-3">
                {/* No club at all is a spectator save, which can jump like any
                    other and has no squad to have been handed back. */}
                {!club
                  ? "The world played on without anybody in charge."
                  : rows.length === 0
                    ? `${club.name} is yours again.`
                    : `Here's how ${club.name} got on while the AI had it.`}
              </p>
              {rows.length > 0 && (
                <div className="jump-recap">
                  <table className="table table-sm table-striped mb-0">
                    <thead>
                      <tr>
                        <th>Season</th>
                        <th>League</th>
                        <th className="text-end">Finish</th>
                        <th className="text-end">Pts</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => {
                        const notes: string[] = [];
                        if (s.champion) notes.push("Champions");
                        if (s.promoted) notes.push("Promoted");
                        if (s.relegated) notes.push("Relegated");
                        if (s.cupRun) notes.push(s.cupRun.note);
                        return (
                          <tr key={s.season}>
                            <td>{seasonYear(s.season)}</td>
                            <td>{s.compName}</td>
                            <td className="text-end">
                              {ordinal(s.position)}
                              <span className="text-muted"> of {s.teamsInComp}</span>
                            </td>
                            <td className="text-end">{s.row.points}</td>
                            <td className="text-muted small">{notes.join(" · ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-muted small mt-3 mb-3">
                {/* A spectator save has no squad and no Roster page, and it can
                    jump like any other — so the advice is gated rather than
                    pointing at a route ClubOnly would bounce them off. */}
                {club && (
                  <>
                    Your lineup was cleared and the squad has moved on without you, so
                    it&apos;s worth a look at the Roster before you sim anything.{" "}
                  </>
                )}
                Taking over lands you on Season History, which has every champion from
                the years you missed.
              </p>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Take over
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
