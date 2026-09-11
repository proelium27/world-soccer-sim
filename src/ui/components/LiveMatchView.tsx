import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { StoredTeam } from "../../core/teams/clubs.js";
import type { MatchEvent, MatchPosition } from "../../engine/attribution.js";
import { ClubCrest } from "./ClubCrest.js";
import { eventSummary, KEY_EVENTS, TimelineRow, TimelineMarkerRow } from "./matchEvents.js";
import { halfTimeMinute, matchMinuteLabel, matchTimeline, periodMarkers } from "../matchClock.js";
import { eventDetail } from "../matchNarration.js";
import { SPEEDS, useMatchPlayback } from "../live/useMatchPlayback.js";
import type { MatchLineups, SideLineup } from "../live/lineups.js";
import { liveMatchState } from "../live/liveRatings.js";
import { MatchPitch } from "./MatchPitch.js";
import { useMediaQuery } from "../useIsMobile.js";
import {
  eventMinute,
  eventsThrough,
  scoreAtMinute,
  scoresAtMinute,
  statsAtMinute,
  type LiveMatch,
} from "../live/liveMatch.js";

/**
 * The live match viewer: your club's match replayed a minute at a time, with the
 * rest of the matchday landing beside it.
 *
 * Nothing here re-simulates anything. The match is already played and its event
 * stream already timestamped, so this reveals a recording — which is what makes
 * it safe to drop into a sim that is otherwise bit-for-bit deterministic.
 *
 * Presentational on purpose: it takes a match and calls `onComplete` when the
 * viewer is done. The league-committing version passes a callback that saves;
 * the rewatch-an-old-match version passes one that just navigates away.
 *
 * It renders as ordinary page content rather than a modal (2026-09-08, user
 * ask, from a screen reader user). A dialog laid over the app has to be
 * announced, focus-trapped and dismissed before anything else can be read; a
 * page is simply read, with headings to jump between and browser history to
 * leave by. WatchMatch.tsx owns the route.
 */

/** One row of the rail's table. Only what the rail draws — position comes from order. */
export interface LiveTableRow {
  tid: number;
  points: number;
}

interface LiveMatchViewProps {
  /** The match being watched. */
  match: LiveMatch;
  /** Every other match being played alongside it, for the rail. */
  otherMatches: LiveMatch[];
  teams: StoredTeam[];
  playerName: (pid: number) => string;
  competitionName: string;
  /** What this match is, when "Matchday N" doesn't say it — "Quarter-final, second leg". */
  subtitle?: string;
  /**
   * The table beside the match, recomputed each minute so it moves as results
   * land. Null for a knockout round, which has no table to stand in.
   */
  tableAtMinute?: ((minute: number) => LiveTableRow[]) | null;
  /**
   * Both team sheets. Null where they can't be recovered honestly — a two-legged
   * tie stores one merged box score, so the second leg cannot be read apart from
   * the first (see lineups.ts).
   */
  lineups?: MatchLineups | null;
  /** Called when the user leaves the viewer — commits the matchday in the live flow. */
  onComplete: () => void;
  completeLabel?: string;
  /**
   * The same exit, offered before the final whistle.
   *
   * There has to be one. The live flow holds a simulated-but-uncommitted
   * matchday while this is on screen, so WatchMatch keeps the user here until
   * they finish (see its redirect) — and a screen you cannot leave for another
   * eighty minutes is a trap however good the reason. Omitted on a rewatch,
   * where there is nothing to hold and the back link is the way out.
   */
  skipLabel?: string;
}

function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M2.5 1.2l8 4.8-8 4.8z" />
    </svg>
  );
}

function PauseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2.2" y="1.4" width="2.9" height="9.2" rx="0.6" />
      <rect x="6.9" y="1.4" width="2.9" height="9.2" rx="0.6" />
    </svg>
  );
}

function SkipIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M1.6 1.2l6.2 4.8-6.2 4.8z" />
      <rect x="8.6" y="1.2" width="2" height="9.6" rx="0.6" />
    </svg>
  );
}

/**
 * A club on the scoreboard: full name where it fits, abbreviation on a phone.
 *
 * The scoreboard gives each side about 90px at 390px wide, which truncated
 * both clubs to "Sudbury R..." and "Ashbourne..." — and the second of those is
 * usually the club you manage. An abbreviation beside the crest identifies it
 * outright where a cut-off name only half does.
 *
 * The abbreviation is hidden from assistive tech rather than duplicated: only
 * one of the two is ever painted, but both are always in the DOM, so a screen
 * reader would otherwise read the club twice.
 */
function ClubName({ name, abbrev }: { name: string; abbrev: string }) {
  return (
    <>
      <span className="bs-club-name d-none d-md-inline">{name}</span>
      <span className="bs-club-name d-md-none" title={name} aria-hidden="true">
        {abbrev}
      </span>
      <span className="visually-hidden d-md-none">{name}</span>
    </>
  );
}

/**
 * One side's substitutions, under the pitch.
 *
 * Only the changes: who is ON the pitch is the pitch's job, and repeating the
 * eleven here would mean a screen reader hearing each team twice.
 */
function SubList({
  tid,
  name,
  colors,
  lineup,
  playerName,
  minute,
  firstHalfStoppage,
}: {
  tid: number;
  name: string;
  colors: [string, string];
  lineup: SideLineup;
  playerName: (pid: number) => string;
  /** Subs are revealed as they are made, so the list tracks the match being watched. */
  minute: number;
  /** See matchClock.ts — what makes a substitution at the break read 45+2. */
  firstHalfStoppage?: number;
}) {
  const subs = lineup.subs.filter((s) => s.minute <= minute);
  return (
    <section className="live-sheet">
      <h3 className="live-sheet-head">
        <ClubCrest tid={tid} colors={colors} size={18} />
        <span>{name}</span>
        {lineup.formation && <span className="live-sheet-shape">{lineup.formation}</span>}
      </h3>
      {subs.length === 0 ? (
        <p className="text-muted small mb-0">No substitutions yet.</p>
      ) : (
        <>
          <h4 className="live-sheet-subhead">Substitutes used</h4>
          <ul className="live-sheet-list live-sheet-list--subs">
            {subs.map((s) => (
              <li key={s.on}>
                <span className="live-sheet-slot stat-num">
                  {matchMinuteLabel(s.minute, firstHalfStoppage)}
                </span>
                <span>
                  <Link to={`/player/${s.on}`}>{playerName(s.on)}</Link>{" "}
                  <span className="live-sheet-for">for {playerName(s.off)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function LiveMatchView({
  match,
  otherMatches,
  teams,
  playerName,
  competitionName,
  subtitle,
  tableAtMinute,
  lineups,
  onComplete,
  completeLabel = "Continue",
  skipLabel,
}: LiveMatchViewProps) {
  const [showAllEvents, setShowAllEvents] = useState(true);
  // The clock on the wall is not the minute playback is on: a minute past 45 in
  // the first half reads 45+2, and the second half discounts the stoppage
  // already played. One number bridges them. See matchClock.ts.
  const h1 = match.firstHalfStoppage;
  const playback = useMatchPlayback(match.events, {
    autoStart: true,
    finalClock: match.finalClock,
    firstHalfStoppage: h1,
  });
  const { minute, finished } = playback;

  // Two elevens side by side need real width, and this column loses ~500px of
  // it to the sidebar and the rail — so the pitch asks about its own threshold
  // rather than borrowing the mobile breakpoint.
  //
  // 1440 is measured, not guessed: a landscape pitch needs about 870px before
  // the chips stop colliding (at a 1210 viewport it gets 654 and seven pairs
  // overlap, by up to 27px; at 1400 it gets 844 and two still touch), and this
  // is the first width that clears it. Below it the portrait pitch is the better
  // answer anyway: a half each way gives a chip more room than a half across.
  const narrow = useMediaQuery("(max-width: 1439.98px)");

  // Rebuilt every minute, which is the point: it is a replay of the events up
  // to now, so ratings and marks move as the match does. O(events) on ~200
  // events, against the feed and rail this screen already re-derives per tick.
  const live = useMemo(
    () => (lineups ? liveMatchState(lineups, match.events, minute, match.finalClock) : null),
    [lineups, match.events, match.finalClock, minute],
  );

  // Slots come from the lineups when the caller has them; a LiveMatch on its own
  // carries only events, and the two EXACT shot sources still resolve without it.
  const slotOfPid = useMemo(() => {
    const map = new Map<number, MatchPosition>();
    for (const side of [lineups?.home, lineups?.away]) {
      for (const p of side?.starters ?? []) if (p.slot) map.set(p.pid, p.slot);
    }
    return (pid: number) => map.get(pid);
  }, [lineups]);

  const teamOf = useMemo(() => {
    const map = new Map<number, StoredTeam>();
    for (const t of teams) map.set(t.tid, t);
    return map;
  }, [teams]);

  const score = scoreAtMinute(match.events, minute);
  const stats = statsAtMinute(match.events, minute);

  const homeTeam = teamOf.get(match.home);
  const awayTeam = teamOf.get(match.away);
  const nameOf = (tid: number) => teamOf.get(tid)?.name ?? `#${tid}`;
  const abbrevOf = (tid: number) => teamOf.get(tid)?.abbrev ?? `#${tid}`;
  const clubOfSide = (side: "home" | "away") => nameOf(side === "home" ? match.home : match.away);

  // Newest first — a live feed reads top-down as it arrives, which also spares
  // an auto-scroll. The box score's own timeline stays oldest-first, since a
  // finished match reads as a story from kickoff.
  const shown = eventsThrough(match.events, minute).filter((e) => e.type !== "turnover");
  const feed = matchTimeline(
    shown.filter((e) => showAllEvents || KEY_EVENTS.has(e.type)),
    periodMarkers(h1, match.finalClock),
    minute,
  ).reverse();

  /**
   * Why a card was shown, or where a shot came from — the same derivation the
   * box score uses, so the two cannot describe one booking differently.
   *
   * Built against the WHOLE stream rather than the revealed prefix: the reason a
   * card was given does not change as the match runs on, and deriving it from a
   * growing slice would have a booking's explanation shift under the reader.
   */
  const detailOf = (e: MatchEvent) =>
    eventDetail(e, match.events, match.finalClock ?? 0, slotOfPid);

  const rail = scoresAtMinute(otherMatches, minute);
  const table = tableAtMinute ? tableAtMinute(minute) : null;

  const clockLabel =
    minute === 0 ? "Kickoff" : finished ? "Full time" : matchMinuteLabel(minute, h1);
  // The break falls at the END of first-half stoppage, so it is minute 48 of
  // football when three were added — not minute 45.
  const atHalfTime = minute === halfTimeMinute(h1) && !finished;

  /**
   * What a screen reader hears as the match runs.
   *
   * Deliberately a single small region rather than aria-live on the feed
   * itself. The feed is newest-first, so a live region there would be announcing
   * insertions at the top of a list — which assistive tech handles poorly — and
   * it re-renders wholesale every minute and on every filter change, so the
   * whole match would be re-read at the worst moments. One sentence per minute,
   * naming the club, is what someone actually needs.
   */
  const latest = shown.filter((e) => KEY_EVENTS.has(e.type)).at(-1);
  const latestIsNow = latest !== undefined && eventMinute(latest.clock) === minute;
  const announcement = finished
    ? `Full time. ${nameOf(match.home)} ${score.home}, ${nameOf(match.away)} ${score.away}.`
    : latestIsNow
      ? `${eventSummary(latest, playerName, clubOfSide(latest.side), h1, detailOf(latest))} ${score.home}-${score.away}.`
      : "";

  return (
    <div className="live-page">
      <div className="live-main">
        <header className="bs-scoreboard live-scoreboard">
          <div className="bs-eyebrow">
            {competitionName} · {subtitle ?? `Matchday ${match.matchday}`}
          </div>
          <h1 className="bs-scoreline live-scoreline">
            <span className="bs-club bs-club--home">
              <ClubName name={nameOf(match.home)} abbrev={abbrevOf(match.home)} />
              <ClubCrest tid={match.home} colors={homeTeam?.colors ?? ["#888", "#444"]} size={30} />
            </span>
            <span className="live-score stat-num">
              {score.home} - {score.away}
            </span>
            <span className="bs-club bs-club--away">
              <ClubCrest tid={match.away} colors={awayTeam?.colors ?? ["#888", "#444"]} size={30} />
              <ClubName name={nameOf(match.away)} abbrev={abbrevOf(match.away)} />
            </span>
          </h1>
          <div className={`live-clock stat-num${atHalfTime ? " live-clock--break" : ""}`}>
            {atHalfTime ? "Half time" : clockLabel}
          </div>
        </header>

        <div className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>

        <div className="live-controls">
          {!finished && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={playback.toggle}
              >
                {playback.playing ? <PauseIcon /> : <PlayIcon />}{" "}
                {playback.playing ? "Pause" : "Play"}
              </button>
              <div className="btn-group btn-group-sm" role="group" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn btn-outline-secondary${playback.speed === s ? " active" : ""}`}
                    aria-pressed={playback.speed === s}
                    onClick={() => playback.setSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={playback.skipToEnd}
              >
                <SkipIcon /> Skip to end
              </button>
              {skipLabel && (
                <button type="button" className="btn btn-sm btn-link" onClick={onComplete}>
                  {skipLabel}
                </button>
              )}
            </>
          )}
          {finished && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onComplete}>
              {completeLabel}
            </button>
          )}
          <label className="live-toggle form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              checked={showAllEvents}
              onChange={(e) => setShowAllEvents(e.target.checked)}
            />
            <span className="form-check-label">Every chance</span>
          </label>
        </div>

        <div className="live-stats stat-num">
          <span>
            Shots {stats.home.shots}-{stats.away.shots}
          </span>
          <span>
            On target {stats.home.onTarget}-{stats.away.onTarget}
          </span>
          <span>
            Corners {stats.home.corners}-{stats.away.corners}
          </span>
          <span>
            Cards {stats.home.yellows + stats.home.reds}-{stats.away.yellows + stats.away.reds}
          </span>
        </div>

        <section className="live-feed-section">
          <h2 className="visually-hidden">Match events</h2>
          <div className="live-feed">
            {feed.length === 0 ? (
              <p className="text-muted small live-feed-empty">
                {minute === 0 ? "Just about to kick off." : "Nothing doing yet."}
              </p>
            ) : (
              feed.map((item, i) =>
                item.kind === "marker" ? (
                  <TimelineMarkerRow key={`m-${i}`} marker={item.marker} />
                ) : (
                  <TimelineRow
                    key={`${item.clock}-${item.event.type}-${i}`}
                    event={item.event}
                    playerName={playerName}
                    clubName={clubOfSide(item.event.side)}
                    firstHalfStoppage={h1}
                    detail={detailOf(item.event)}
                  />
                ),
              )
            )}
          </div>
        </section>

        {lineups && live && (
          <section className="live-lineups">
            <h2 className="live-section-head">Lineups</h2>
            <MatchPitch
              home={live.home}
              away={live.away}
              homeFormation={lineups.home.formation}
              awayFormation={lineups.away.formation}
              homeName={nameOf(match.home)}
              awayName={nameOf(match.away)}
              homeColors={homeTeam?.colors ?? ["#888", "#444"]}
              awayColors={awayTeam?.colors ?? ["#888", "#444"]}
              playerName={playerName}
              vertical={narrow}
            />
            <div className="live-lineups-grid">
              <SubList
                tid={match.home}
                name={nameOf(match.home)}
                colors={homeTeam?.colors ?? ["#888", "#444"]}
                lineup={lineups.home}
                playerName={playerName}
                minute={minute}
                firstHalfStoppage={h1}
              />
              <SubList
                tid={match.away}
                name={nameOf(match.away)}
                colors={awayTeam?.colors ?? ["#888", "#444"]}
                lineup={lineups.away}
                playerName={playerName}
                minute={minute}
                firstHalfStoppage={h1}
              />
            </div>
            <p className="live-lineups-note text-muted small">
              Ratings update as the match runs, from what each player has actually done so far.
              Substitutes who never came on aren&apos;t recorded, so only the ones used are
              listed.
            </p>
          </section>
        )}
      </div>

      <aside className="live-rail" aria-label="Elsewhere on this matchday">
        <h2 className="live-rail-head">Elsewhere</h2>
        {rail.length === 0 ? (
          <p className="text-muted small">No other matches today.</p>
        ) : (
          <ul className="live-rail-list">
            {rail.map(({ match: m, score: s, justScored }) => (
              <li
                key={`${m.home}-${m.away}`}
                className={`live-rail-row${justScored ? " live-rail-row--scored" : ""}`}
              >
                <span className="live-rail-club">{abbrevOf(m.home)}</span>
                <span className="live-rail-score stat-num">
                  {s.home}-{s.away}
                </span>
                <span className="live-rail-club live-rail-club--away">{abbrevOf(m.away)}</span>
                <span className="visually-hidden">
                  {nameOf(m.home)} {s.home}, {nameOf(m.away)} {s.away}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* A knockout round has no table to stand in, so the rail just ends. */}
        {table && (
          <>
            <h2 className="live-rail-head">Live table</h2>
            <ol className="live-rail-table">
              {table.slice(0, 8).map((row, i) => (
                <li
                  key={row.tid}
                  className={`live-rail-trow${
                    row.tid === match.home || row.tid === match.away ? " live-rail-trow--mine" : ""
                  }`}
                >
                  <span className="live-rail-pos stat-num">{i + 1}</span>
                  <span className="live-rail-club" aria-hidden="true">
                    {abbrevOf(row.tid)}
                  </span>
                  <span className="visually-hidden">{nameOf(row.tid)}</span>
                  <span className="live-rail-pts stat-num">{row.points}</span>
                  <span className="visually-hidden">points</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}
