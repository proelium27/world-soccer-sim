import { useMemo } from "react";
import type { LeagueStore } from "../../core/leagueState.js";
import type { Player } from "../../core/players/types.js";
import { playerClubView, mainReason, type ClubInView } from "../../core/transfers/playerView.js";
import { appealBreakdown } from "../../core/transfers/userView.js";
import { ClubLink } from "./ClubLink.js";

function interestTone(c: ClubInView): string {
  if (c.interest === "Keen") return "text-success";
  if (c.interest === "Reluctant" || c.interest === "Won't talk") return "text-warning";
  return "text-muted";
}

function ClubRows({ clubs }: { clubs: ClubInView[] }) {
  if (clubs.length === 0) return <p className="text-muted small mb-2">None.</p>;
  return (
    <table className="table table-sm mb-2">
      <thead>
        <tr className="small text-muted">
          <th className="fw-normal">Club</th>
          <th className="fw-normal">Feeling</th>
          <th className="fw-normal text-end">Main reason</th>
        </tr>
      </thead>
      <tbody>
        {clubs.map((c) => (
          <tr key={c.tid} title={appealBreakdown(c.appeal)}>
            <td><ClubLink tid={c.tid} crest /></td>
            <td className={`small text-nowrap ${interestTone(c)}`}>{c.interest}</td>
            <td className="small text-muted text-end">{mainReason(c.appeal) ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * How a player sees clubs: your club and why, his favourites, the best clubs
 * where he'd play, and how many he'd refuse. Reads the same view the markets
 * decide with (core/transfers/playerView.ts); what each reason means is in the
 * Manual.
 */
export function HowHeSeesClubs({ league, player }: { league: LeagueStore; player: Player }) {
  const view = useMemo(() => playerClubView(league, player), [league, player]);
  const you = view.yourClub;
  return (
    <div className="card mt-3">
      <div className="card-body">
        <h6 className="card-title">How he sees clubs</h6>
        {you && (
          <p className="small mb-2">
            Your club: <span className={`fw-semibold ${interestTone(you)}`}>{you.interest}</span>
            <span className="text-muted"> · {appealBreakdown(you.appeal)}</span>
          </p>
        )}
        <div className="text-muted small mb-1">Where he'd most like to go</div>
        <ClubRows clubs={view.favourites} />
        <div className="text-muted small mb-1">Where he'd play</div>
        <ClubRows clubs={view.wouldPlay} />
        <p className="small text-muted mb-0">
          {view.refusedCount === 0
            ? "He'd talk to any club."
            : `Won't talk to ${view.refusedCount} of ${view.clubCount} clubs.`}
        </p>
      </div>
    </div>
  );
}
