import { useEffect, useRef, useState } from "react";
import { loadMatchEvents, isEventsElided } from "../db/index.js";
import type { PlayedMatch } from "../core/standings.js";
import type { MatchEvent } from "../engine/attribution.js";

/**
 * Read back the event timelines `loadLeague` left on disk.
 *
 * A loaded league carries its matches' scores and player lines but not their
 * events — measured, they are 12.7 KB a match against ~6.6 KB of lines, so a
 * league holding a full season of them is ~134 MB of what the tab weighs. Two
 * screens need them, both for a single match or a single matchday, and both go
 * through here.
 *
 * Matches simmed in THIS session are not elided: the worker returns real box
 * scores and they stay in memory until the next load. So a match watched
 * moments after it was played needs no fetch at all, which is the case that
 * matters most — the live viewer never waits on IndexedDB.
 */
export function useMatchEvents(
  lid: number | undefined,
  indices: readonly number[],
): { events: ReadonlyMap<number, MatchEvent[]>; loading: boolean } {
  // Indices are derived per render, so depending on the array itself would
  // restart the fetch every render. The joined key is what makes it settle.
  const key = indices.join(",");
  const [state, setState] = useState<{ key: string; events: Map<number, MatchEvent[]> }>(
    () => ({ key: "", events: new Map() }),
  );
  // Guards against a slow answer for an earlier match landing on top of a newer
  // one, when the reader moves between matches faster than IndexedDB replies.
  const latest = useRef("");

  useEffect(() => {
    if (lid === undefined || key === "") {
      setState({ key, events: new Map() });
      return;
    }
    latest.current = key;
    let live = true;
    void (async () => {
      const entries = await Promise.all(
        key.split(",").map(async (raw) => {
          const i = Number(raw);
          return [i, (await loadMatchEvents(lid, i)) ?? []] as const;
        }),
      );
      if (!live || latest.current !== key) return;
      setState({ key, events: new Map(entries) });
    })();
    return () => { live = false; };
  }, [lid, key]);

  return { events: state.events, loading: state.key !== key };
}

/**
 * The same match with a fetched timeline put back.
 *
 * Returns the match untouched when it was never elided, so a caller can apply
 * this unconditionally and a freshly simmed match costs nothing. The elision
 * marker is dropped along the way: once the events are back the box score is
 * whole, and leaving it set would have `saveLeague` skip the row.
 */
export function withEvents(m: PlayedMatch, events: MatchEvent[] | undefined): PlayedMatch {
  if (!isEventsElided(m) || events === undefined) return m;
  const { eventsElided: _dropped, ...boxScore } = m.boxScore;
  return { ...m, boxScore: { ...boxScore, events } };
}
