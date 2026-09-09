/**
 * Each player's match rating and stat line as they stood at a given minute.
 *
 * The whole point of this file is that it is **exact, not an estimate**.
 * `computeMatchRating` reads exactly eight things — goals, assists, shots on
 * target, tackles, interceptions, saves, cards and minutes played, plus the
 * team's goals against — and every one of them is recoverable from the
 * timestamped event stream:
 *
 *  - goals and assists: the `goal` event carries `[scorer, assister?]`;
 *  - shots on target: `shot_saved` and `goal`, the same pair `statsAtMinute`
 *    already counts;
 *  - tackles and interceptions: a `turnover` event carries the pid of whoever
 *    won the ball. It does NOT say which of the two it was — and it does not
 *    have to, because `INTERCEPTION_WEIGHT` is *aliased* to `TACKLE_WEIGHT` in
 *    matchRating.ts, so the rating cannot tell them apart either. That alias is
 *    load-bearing here and its own comment warns against forking it; the
 *    full-time equality test below is what catches it if anyone does;
 *  - saves: a `shot_saved` event is stamped with the ATTACKING side, and the
 *    engine credits the defending keeper, so a side's saves are the opponent's
 *    saved shots. Keepers are never substituted (matchSim says so), so the
 *    keeper is simply whoever started in the GK slot;
 *  - cards and minutes: the card and substitution events, with a red card
 *    ending a player's afternoon exactly as a substitution does.
 *
 * Nothing here is interpolated or pro-rated. That matters because this codebase
 * has a standing rule against showing a live number whose value is only known
 * at full time (the reason xG and possession are absent from the live strip),
 * and a rating built by scaling a final figure by minutes elapsed would be
 * exactly that. `liveRatings.test.ts` pins the claim the only way worth
 * pinning it: it sims real matches and demands the derived full-time rating
 * equal the one the engine stored, for every player.
 */
import type { MatchEvent, MatchPosition, PlayerMatchLine } from "../../engine/attribution.js";
import { emptyLine } from "../../engine/attribution.js";
import { computeMatchRating } from "../../engine/matchRating.js";
import type { MatchLineups, SideLineup } from "./lineups.js";
import { eventMinute } from "./liveMatch.js";
import { MATCH_SECONDS } from "../../engine/constants.js";

/** One player's afternoon so far. */
export interface LiveLine {
  pid: number;
  /** The slot he is filling. Null on a box score written before slots were recorded. */
  slot: MatchPosition | null;
  /** The minute he came on. 0 means he started. */
  from: number;
  /** The minute he left, by substitution or red card. Null while he is still on. */
  until: number | null;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  /**
   * His rating as it stands, or null before he has kicked a ball — an unused
   * substitute has no rating, and neither does anyone at kickoff.
   */
  rating: number | null;
}

/** One side, as it stands at a minute. */
export interface LiveSide {
  /** The eleven currently on the pitch, in the order the formation lists its slots. */
  onPitch: LiveLine[];
  /** Everyone who has played, including those already withdrawn. */
  all: LiveLine[];
  goals: number;
  goalsAgainst: number;
}

export interface LiveMatchState {
  home: LiveSide;
  away: LiveSide;
}

const other = (side: "home" | "away") => (side === "home" ? "away" : "home");

/**
 * Rebuild a side's stat lines from the events up to `minute`.
 *
 * Deliberately builds a real `PlayerMatchLine` and hands it to the engine's own
 * `computeMatchRating` rather than reimplementing the weighting. A second copy
 * of that formula would disagree with the box score the moment either moved.
 */
function sideState(
  lineup: SideLineup,
  side: "home" | "away",
  events: MatchEvent[],
  minute: number,
  finalClock?: number,
): LiveSide {
  // Everyone who appears in the box score is a starter or came on for one, so
  // the team sheet already names the whole cast and no second input is needed.
  const pids = [...lineup.starters.map((s) => s.pid), ...lineup.subs.map((s) => s.on)];
  const slotOf = new Map<number, MatchPosition | null>();
  for (const s of lineup.starters) slotOf.set(s.pid, s.slot);
  for (const s of lineup.subs) slotOf.set(s.on, s.slot);

  // Two parallel records, and the distinction between them is the whole reason
  // the live rating used to disagree with the box score it sits beside.
  //
  // `from`/`until` are MINUTE LABELS, for display: the minute a change is
  // reported at, which is `eventMinute`'s ceiling of elapsed time.
  //
  // `fromClock`/`untilClock` are the raw countdown clocks, for ARITHMETIC.
  // Minutes played has to be `round((enter - exit) / 60)` — the engine's
  // `minutesFor` rounds the DURATION — and subtracting one ceiled label from
  // another is not that number. A man withdrawn at 45:10 is reported in the
  // 46th minute and has played 45 minutes; `46 - 0` says 46, the rating is
  // damped by minutes, and the two surfaces printed different numbers for one
  // afternoon.
  const from = new Map<number, number>();
  const until = new Map<number, number>();
  const fromClock = new Map<number, number>();
  const untilClock = new Map<number, number>();
  for (const s of lineup.starters) {
    from.set(s.pid, 0);
    fromClock.set(s.pid, MATCH_SECONDS);
  }

  const lines = new Map<number, PlayerMatchLine>();
  for (const pid of pids) lines.set(pid, emptyLine(pid));

  const keeperPid = lineup.starters.find((s) => s.slot === "GK")?.pid ?? null;

  let goals = 0;
  let goalsAgainst = 0;

  // Chronological — the clock counts down, so descending clock runs forwards.
  const sorted = [...events].sort((a, b) => b.clock - a.clock);
  for (const e of sorted) {
    const at = eventMinute(e.clock);
    if (at > minute) break;
    const mine = e.side === side;
    const line = (pid: number) => lines.get(pid);

    switch (e.type) {
      case "goal":
        if (mine) {
          goals++;
          const scorer = line(e.pids[0]);
          if (scorer) scorer.goals++, scorer.shotsOnTarget++;
          if (e.pids[1] !== undefined) {
            const assister = line(e.pids[1]);
            if (assister) assister.assists++;
          }
        } else {
          goalsAgainst++;
        }
        break;
      case "shot_saved":
        if (mine) {
          const shooter = line(e.pids[0]);
          if (shooter) shooter.shotsOnTarget++;
        } else if (keeperPid !== null) {
          // Stamped with the attacking side; the keeper who made it is ours.
          const gk = line(keeperPid);
          if (gk) gk.saves++;
        }
        break;
      case "turnover":
        // Whoever won the ball back. Credited as a tackle because the rating
        // weighs the two identically (see this file's header).
        if (mine && e.pids.length > 0) {
          const winner = line(e.pids[0]);
          if (winner) winner.tackles++;
        }
        break;
      case "yellow_card":
        if (mine) {
          const booked = line(e.pids[0]);
          if (booked) booked.yellowCards++;
        }
        break;
      case "red_card":
        if (mine) {
          const sent = line(e.pids[0]);
          if (sent) sent.redCards++;
          if (!until.has(e.pids[0])) {
            until.set(e.pids[0], at);
            untilClock.set(e.pids[0], e.clock);
          }
        }
        break;
      case "substitution":
        if (mine) {
          const [off, on] = e.pids;
          if (!until.has(off)) {
            until.set(off, at);
            untilClock.set(off, e.clock);
          }
          from.set(on, at);
          fromClock.set(on, e.clock);
        }
        break;
      default:
        break;
    }
  }

  // Where the clock stands for a man who is still on. During playback that is
  // simply the minute being watched; once playback reaches the whistle it has to
  // be the whistle itself, since stoppage runs past the final event and the
  // engine measured him to the whistle. Without a recorded `finalClock` (a box
  // score written before 2026-09-09) the playback clock is the best answer
  // available and runs a little short, exactly as it always did.
  const playbackClock = MATCH_SECONDS - minute * 60;
  const stillOnClock =
    finalClock !== undefined && minute >= eventMinute(finalClock) ? finalClock : playbackClock;

  const build = (pid: number): LiveLine | null => {
    const start = from.get(pid);
    if (start === undefined) return null; // Hasn't come on yet.
    const left = until.get(pid) ?? null;
    // The engine's own arithmetic (`minutesFor`): round the duration, never the
    // endpoints. See the comment on `fromClock` above.
    const enter = fromClock.get(pid) ?? MATCH_SECONDS;
    const exit = untilClock.get(pid) ?? stillOnClock;
    const minutesPlayed = Math.max(0, Math.round((enter - exit) / 60));
    const line = lines.get(pid)!;
    line.minutesPlayed = minutesPlayed;
    const slot = slotOf.get(pid) ?? null;
    return {
      pid,
      slot,
      from: start,
      until: left,
      minutesPlayed,
      goals: line.goals,
      assists: line.assists,
      yellowCards: line.yellowCards,
      redCards: line.redCards,
      // Before kickoff nobody has a rating; a number there would be a claim
      // about a match that hasn't started.
      rating:
        minute === 0 || slot === null
          ? null
          : computeMatchRating(line, slot, minutesPlayed, goalsAgainst),
    };
  };

  const all: LiveLine[] = [];
  for (const pid of pids) {
    const l = build(pid);
    if (l) all.push(l);
  }

  // Whoever holds each starting slot now: the starter, or the man who came on
  // for him (and the man who came on for HIM). Keeping the starters' order
  // means the pitch never reshuffles as substitutions are made — a chip
  // changes name in place, which is what actually happened.
  const replacedBy = new Map<number, number>();
  for (const s of lineup.subs) if (s.minute <= minute) replacedBy.set(s.off, s.on);
  const byPid = new Map(all.map((l) => [l.pid, l]));
  const onPitch: LiveLine[] = [];
  for (const starter of lineup.starters) {
    let pid: number | undefined = starter.pid;
    const seen = new Set<number>();
    while (pid !== undefined && replacedBy.has(pid) && !seen.has(pid)) {
      seen.add(pid);
      pid = replacedBy.get(pid);
    }
    const held = pid === undefined ? undefined : byPid.get(pid);
    // A man sent off leaves the slot empty rather than the chip vanishing from
    // the middle of the shape, which would silently renumber every slot after it.
    if (held && held.until === null) onPitch.push(held);
    else if (held) onPitch.push({ ...held });
  }

  return { onPitch, all, goals, goalsAgainst };
}

/**
 * Both sides as they stood at `minute`.
 *
 * Takes the same events the lineups were built from, for the reason
 * `matchLineups` takes them at all: a single leg of a two-legged tie must not
 * be read against the other leg's play.
 */
export function liveMatchState(
  lineups: MatchLineups,
  events: MatchEvent[],
  minute: number,
  finalClock?: number,
): LiveMatchState {
  return {
    home: sideState(lineups.home, "home", events, minute, finalClock),
    away: sideState(lineups.away, "away", events, minute, finalClock),
  };
}

export { other as otherSide };
