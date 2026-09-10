import { useCallback, useEffect, useMemo, useState } from "react";
import type { MatchEvent } from "../../engine/attribution.js";
import { finalMinute, HALF_TIME_MINUTE } from "./liveMatch.js";

/**
 * The playback clock for the live match viewer.
 *
 * Deliberately knows nothing about soccer — it walks a match minute forward and
 * lets the screen derive everything else from it. That keeps the pacing rules
 * (speed, pausing, the half-time beat) in one testable place, and means the
 * same hook drives both a freshly simulated match and a rewatch of an old one.
 *
 * It ticks once per MATCH minute, not per animation frame: a full match is ~90
 * state updates rather than several thousand, which matters because the screen
 * re-derives the feed, the stats strip and the score-centre rail on every tick.
 */

/** Real milliseconds per match minute at 1x — a full match runs a little over a minute. */
const MS_PER_MATCH_MINUTE = 800;

/** A longer beat on the stroke of half time, so the break reads as a break. */
const HALF_TIME_MS = 2400;

/**
 * Half speed is here because a match minute at 1x is 800ms, which is fine for
 * following the score and quick enough that a passage where something happens
 * in consecutive minutes can be over before it has been read.
 */
export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

/** The speeds offered, slowest first — the order the buttons are drawn in. */
export const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4];

/**
 * How long to hold on `minute` before advancing.
 *
 * Pulled out of the effect because there is no DOM test environment in this
 * repo, so this is the only part of the clock a test can reach — and it is the
 * part that would break silently. The speed divides, so a *smaller* number is a
 * *slower* match; half time scales along with everything else, because a break
 * that stayed 2400ms at 0.5x would read as shorter than the minutes around it.
 */
export function tickDelayMs(minute: number, speed: PlaybackSpeed): number {
  const base = minute === HALF_TIME_MINUTE ? HALF_TIME_MS : MS_PER_MATCH_MINUTE;
  return base / speed;
}

export interface MatchPlayback {
  /** Match minute reached so far. 0 means kickoff hasn't happened yet. */
  minute: number;
  /** The minute the match ends on — 90, or later when stoppage ran long. */
  lastMinute: number;
  playing: boolean;
  finished: boolean;
  speed: PlaybackSpeed;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  /** Jump straight to the final whistle. */
  skipToEnd: () => void;
}

export function useMatchPlayback(
  events: MatchEvent[],
  opts: { autoStart?: boolean; finalClock?: number } = {},
): MatchPlayback {
  const autoStart = opts.autoStart ?? true;
  const { finalClock } = opts;
  // Play to the whistle, not to the last thing that happened — stoppage carries
  // on past the final event, so the old reading stopped the clock short.
  const lastMinute = useMemo(() => finalMinute(events, finalClock), [events, finalClock]);

  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(autoStart);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  // A different match means a fresh kickoff. Keyed on the array identity rather
  // than its contents: every caller hands over one match's stream.
  useEffect(() => {
    setMinute(0);
    setPlaying(autoStart);
  }, [events, autoStart]);

  const finished = minute >= lastMinute;

  useEffect(() => {
    if (!playing || finished) return;
    // setTimeout rather than setInterval so half time can take longer than a
    // normal minute without the interval fighting the change.
    const timer = setTimeout(() => setMinute((m) => m + 1), tickDelayMs(minute, speed));
    return () => clearTimeout(timer);
  }, [playing, finished, minute, speed]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const skipToEnd = useCallback(() => {
    setPlaying(false);
    setMinute(lastMinute);
  }, [lastMinute]);

  return {
    minute,
    lastMinute,
    playing,
    finished,
    speed,
    play,
    pause,
    toggle,
    setSpeed,
    skipToEnd,
  };
}
