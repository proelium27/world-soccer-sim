import { useMemo } from "react";
import type { LeagueStore } from "../../core/leagueState.js";
import type { Player } from "../../core/players/types.js";
import type { AppealLineId, ClubAppeal } from "../../core/transfers/clubAppeal.js";
import { playerClubView, type ClubInView } from "../../core/transfers/playerView.js";
import { ClubLink } from "./ClubLink.js";

/**
 * Every reason a player weighs, in clubAppealFor's order, with what it means on
 * hover. All but Former club are the move against where he is now (his parent
 * club on loan), so the hover says so.
 */
export const FACTORS: { id: AppealLineId; head: string; name: string }[] = [
  { id: "level", head: "Level", name: "How much bigger or smaller a club than his: the squad and the money" },
  { id: "reputation", head: "Reputation", name: "How much bigger or smaller a name than his club" },
  { id: "playingTime", head: "Playing time", name: "Whether he'd play more or less than he does now" },
  { id: "home", head: "Home", name: "Moving to or away from his own country" },
  { id: "confederation", head: "Far from home", name: "Moving to or away from a club outside his part of the world" },
  { id: "language", head: "Language", name: "Moving to or away from a country he knows: a shared language or family ties" },
  { id: "formerClub", head: "Former club", name: "A club he has played for before" },
];

function interestTone(c: ClubInView): string {
  if (c.interest === "Keen") return "text-success";
  if (c.interest === "Reluctant" || c.interest === "Won't talk") return "text-warning";
  return "text-muted";
}

/** Two decimals, signed; a value that rounds to nothing is a plain 0.00, never "−0.00". */
export function signed(value: number): string {
  const shown = value.toFixed(2);
  if (Number(shown) === 0) return "0.00";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function valueTone(value: number): string {
  if (Number(value.toFixed(2)) === 0) return "text-muted";
  return value > 0 ? "text-success" : "text-danger";
}

function ClubRow({ c, factors }: { c: ClubInView; factors: typeof FACTORS }) {
  return (
    <tr>
      <td className="text-nowrap how-he-sees-club"><ClubLink tid={c.tid} crest /></td>
      <td className={`text-nowrap ${interestTone(c)}`}>{c.interest}</td>
      <td className="text-muted">{c.starts ? "Yes" : "No"}</td>
      {factors.map((f) => {
        const line = c.appeal.lines.find((l) => l.id === f.id);
        // A refusal rides on the level line as a flat −1, a marker rather than
        // a weight, so it reads as what it is.
        if (line && c.appeal.refused && f.id === "level") {
          return (
            <td key={f.id} className="text-end text-warning text-nowrap"
              title="Too big a step down: he won't talk at any price">Too small</td>
          );
        }
        return (
          <td key={f.id} className={`text-end ${line ? valueTone(line.value) : ""}`}
            title={line ? `${line.label} ${signed(line.value)}` : undefined}>
            {line ? signed(line.value) : ""}
          </td>
        );
      })}
      <td className={`text-end fw-semibold ${c.appeal.refused ? "text-warning" : valueTone(c.appeal.score)}`}>
        {c.appeal.refused ? "Refuses" : signed(c.appeal.score)}
      </td>
    </tr>
  );
}

/** The factor columns some shown club actually has a value on; an all-blank column is noise. */
export function shownFactors(appeals: ClubAppeal[]): typeof FACTORS {
  const used = new Set(appeals.flatMap((a) => a.lines.map((l) => l.id)));
  return FACTORS.filter((f) => used.has(f.id));
}

/**
 * How a player sees clubs: his favourites and your club, each with every reason
 * he weighs and their total, and how many clubs he'd refuse. Reads the same view
 * the markets decide with (core/transfers/playerView.ts), so the numbers are the
 * ones he acts on; what each reason means is in the Manual.
 */
export function HowHeSeesClubs({ league, player }: { league: LeagueStore; player: Player }) {
  const view = useMemo(() => playerClubView(league, player), [league, player]);
  const you = view.yourClub;
  const factors = shownFactors([...view.favourites, ...(you ? [you] : [])].map((c) => c.appeal));
  const columns = 4 + factors.length;
  return (
    <div className="card mt-3">
      <div className="card-body">
        <h6 className="card-title">How he sees clubs</h6>
        <div className="table-responsive">
          <table className="table table-sm small mb-2 w-auto how-he-sees">
            <thead>
              <tr className="text-muted">
                <th className="fw-normal how-he-sees-club">Club</th>
                <th className="fw-normal">Feeling</th>
                <th className="fw-normal">Starts</th>
                {factors.map((f) => (
                  <th key={f.id} className="fw-normal text-end" title={f.name}>{f.head}</th>
                ))}
                <th className="fw-normal text-end" title="All his reasons added up">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={columns} className="text-muted how-he-sees-group"><span>Where he'd most like to go</span></td></tr>
              {view.favourites.length === 0
                ? <tr><td colSpan={columns} className="text-muted">None.</td></tr>
                : view.favourites.map((c) => <ClubRow key={c.tid} c={c} factors={factors} />)}
            </tbody>
            {you && (
              <tbody>
                <tr><td colSpan={columns} className="text-muted how-he-sees-group"><span>Your club</span></td></tr>
                <ClubRow c={you} factors={factors} />
              </tbody>
            )}
          </table>
        </div>
        <p className="small text-muted mb-0">
          {view.refusedCount === 0
            ? "He'd talk to any club."
            : `Won't talk to ${view.refusedCount} of ${view.clubCount} clubs.`}
        </p>
      </div>
    </div>
  );
}
