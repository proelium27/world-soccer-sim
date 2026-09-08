/**
 * Shared rendering for a match's event stream.
 *
 * Extracted from the box score page so the live match viewer draws the same
 * timeline from the same data. Two surfaces rendering one event differently —
 * a different label, a different clock — reads as a bug, and the live view is
 * literally the box score's timeline revealed a minute at a time.
 *
 * Icons are hand-written inline SVG, never emoji (UI convention).
 */
import { Link } from "react-router-dom";
import type { MatchEvent, MatchEventType } from "../../engine/attribution.js";

/** Match clock counts down from 5400s, so elapsed minutes read off the remainder. */
export function formatClock(seconds: number): string {
  const mins = Math.max(1, Math.ceil((5400 - seconds) / 60));
  return `${mins}'`;
}

/* ---------------------------------------------------------------------------
   Icons
   --------------------------------------------------------------------------- */

export function BallIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1.6a10.4 10.4 0 1 0 0 20.8 10.4 10.4 0 0 0 0-20.8zm0 2.1l3.4 2.47-1.3 4h-4.2l-1.3-4zm-5.6 4.2l1.3 4-3.4 2.5A8.4 8.4 0 0 1 6.4 7.9zm11.2 0a8.4 8.4 0 0 1 2.1 6.5l-3.4-2.5zM9.9 13.8h4.2l1.3 4L12 20.3l-3.5-2.5z" />
    </svg>
  );
}

export function CardIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="14" height="18" rx="2.5" />
    </svg>
  );
}

export function SubInIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M6 0.8l4.4 5.2H7.6V11.2H4.4V6H1.6z" />
    </svg>
  );
}

export function SubOutIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M6 11.2L1.6 6h2.8V0.8h3.2V6h2.8z" />
    </svg>
  );
}

export function InjuryIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M4 0h2v4h4v2H6v4H4V6H0V4h4z" />
    </svg>
  );
}

export function WhistleIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 5.5a6.5 6.5 0 1 0 5.9 9.2l2.3-5.6a1 1 0 0 0-.6-1.3L14.6 5.6a6.5 6.5 0 0 0-.6-.1zM8.5 9.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
    </svg>
  );
}

export function CornerIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M2 0h1.4v12H2z" />
      <path d="M3.8 0.8L10 3.2 3.8 5.6z" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   Timeline
   --------------------------------------------------------------------------- */

/** The events worth reading by default: everything that changed the game or the teams. */
export const KEY_EVENTS = new Set<MatchEventType>([
  "goal",
  "yellow_card",
  "red_card",
  "substitution",
  "penalty",
  "injury",
]);

/** How each event colours its clock chip on the spine. */
export function chipTone(type: MatchEventType): string {
  switch (type) {
    case "goal":
      return "bs-chip--goal";
    case "red_card":
    case "injury":
      return "bs-chip--danger";
    case "yellow_card":
    case "penalty":
      return "bs-chip--warn";
    default:
      return "";
  }
}

export function EventBody({
  event,
  playerName,
}: {
  event: MatchEvent;
  playerName: (pid: number) => string;
}) {
  const link = (pid: number) => (
    <Link key={pid} to={`/player/${pid}`}>
      {playerName(pid)}
    </Link>
  );

  switch (event.type) {
    case "goal":
      return (
        <div className="bs-ev-body bs-ev-body--goal">
          <span className="bs-ev-icon">
            <BallIcon />
          </span>
          <span>
            <strong className="bs-ev-headline">Goal</strong> {link(event.pids[0])}
            {event.pids[1] !== undefined && (
              <span className="bs-ev-sub">assist {playerName(event.pids[1])}</span>
            )}
          </span>
        </div>
      );
    case "yellow_card":
    case "red_card": {
      const red = event.type === "red_card";
      return (
        <div className="bs-ev-body">
          <span className={`bs-ev-icon ${red ? "bs-ev-icon--red" : "bs-ev-icon--yellow"}`}>
            <CardIcon />
          </span>
          <span>
            <span className="bs-ev-kind">{red ? "Red card" : "Yellow card"}</span>{" "}
            {link(event.pids[0])}
          </span>
        </div>
      );
    }
    case "substitution":
      return (
        <div className="bs-ev-body">
          <span className="bs-sub-pair">
            <span className="bs-sub-on">
              <SubInIcon size={8} /> {link(event.pids[1])}
            </span>
            <span className="bs-sub-off">
              <SubOutIcon size={8} /> {playerName(event.pids[0])}
            </span>
          </span>
        </div>
      );
    case "penalty":
      return (
        <div className="bs-ev-body">
          <span className="bs-ev-icon bs-ev-icon--warn">
            <WhistleIcon />
          </span>
          <span>
            <span className="bs-ev-kind">Penalty</span> {link(event.pids[0])} steps up
          </span>
        </div>
      );
    case "injury":
      return (
        <div className="bs-ev-body">
          <span className="bs-ev-icon bs-ev-icon--red">
            <InjuryIcon />
          </span>
          <span>
            <span className="bs-ev-kind">Injury</span> {link(event.pids[0])} goes down
          </span>
        </div>
      );
    case "corner":
      return (
        <div className="bs-ev-body bs-ev-body--quiet">
          <span className="bs-ev-icon">
            <CornerIcon />
          </span>
          <span className="bs-ev-kind">Corner</span>
        </div>
      );
    case "shot_saved":
    case "shot_blocked":
    case "shot_off_target": {
      const label =
        event.type === "shot_saved"
          ? "Saved"
          : event.type === "shot_blocked"
            ? "Blocked"
            : "Off target";
      return (
        <div className="bs-ev-body bs-ev-body--quiet">
          <span className="bs-ev-kind">{label}</span> {link(event.pids[0])}
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * The same event as a plain sentence.
 *
 * Two callers, and both are about being read rather than looked at: the live
 * viewer announces the newest event to a screen reader, and every timeline row
 * carries one as its hidden label — the visual row says which club it belongs
 * to by which column it sits in, which conveys nothing to someone who cannot
 * see the columns.
 *
 * Kept beside EventBody deliberately. They describe the same event and would
 * drift apart the moment they lived in different files.
 */
export function eventSummary(
  event: MatchEvent,
  playerName: (pid: number) => string,
  clubName?: string,
): string {
  const who = (i: number) => playerName(event.pids[i]);
  const club = clubName ? `${clubName}. ` : "";
  const at = `${formatClock(event.clock)} ${club}`;
  switch (event.type) {
    case "goal":
      return `${at}Goal, ${who(0)}${event.pids[1] !== undefined ? `, assisted by ${who(1)}` : ""}.`;
    case "yellow_card":
      return `${at}Yellow card, ${who(0)}.`;
    case "red_card":
      return `${at}Red card, ${who(0)}.`;
    case "substitution":
      return `${at}Substitution, ${who(1)} on for ${who(0)}.`;
    case "penalty":
      return `${at}Penalty, ${who(0)} steps up.`;
    case "injury":
      return `${at}Injury, ${who(0)} goes down.`;
    case "corner":
      return `${at}Corner.`;
    case "shot_saved":
      return `${at}Shot saved, ${who(0)}.`;
    case "shot_blocked":
      return `${at}Shot blocked, ${who(0)}.`;
    case "shot_off_target":
      return `${at}Shot off target, ${who(0)}.`;
    default:
      return "";
  }
}

export function TimelineRow({
  event,
  playerName,
  clubName,
}: {
  event: MatchEvent;
  playerName: (pid: number) => string;
  /** Which club this belongs to. Sighted readers get it from the column; nobody else does. */
  clubName?: string;
}) {
  const body = <EventBody event={event} playerName={playerName} />;
  if (!body) return null;
  // The clock chip is real text in the middle column, so the hidden summary
  // deliberately leads with the club rather than repeating the minute.
  const label = clubName ? <span className="visually-hidden">{clubName}. </span> : null;
  const cell = (
    <>
      {label}
      {body}
    </>
  );
  return (
    <div className={`bs-ev bs-ev--${event.side}`}>
      <div className="bs-ev-cell bs-ev-cell--home">{event.side === "home" && cell}</div>
      <div className="bs-ev-spine">
        <span className={`bs-ev-chip stat-num ${chipTone(event.type)}`}>
          {formatClock(event.clock)}
        </span>
      </div>
      <div className="bs-ev-cell bs-ev-cell--away">{event.side === "away" && cell}</div>
    </div>
  );
}
