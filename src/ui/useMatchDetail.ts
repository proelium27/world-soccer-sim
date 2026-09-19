import { useEffect, useRef, useState } from "react";
import { loadMatchBoxScore, isDetailElided } from "../db/index.js";
import type { PlayedMatch } from "../core/standings.js";
import type { BoxScore } from "../engine/attribution.js";

/**
 * Read back the box scores `loadLeague` left on disk.
 *
 * A loaded league carries its matches' scores but not their box scores: the
 * event timeline and both teams' player lines are ~19 KB a match, so a season of
 * them is most of what the tab would otherwise weigh (see db/leagueDb.ts). Two
 * screens need them, both for a single match or a single matchday, and both go
 * through here. Every whole-season total the lines fed is answered by
 * `teamSeasonStatsFor` instead, which never needs them.
 *
 * Matches simmed in THIS session keep their box scores only until the save that
 * wrote them lands, so the live viewer — built from the fresh sim result before
 * that save — never waits on IndexedDB.
 */
export function useMatchDetail(
  lid: number | undefined,
  indices: readonly number[],
): { boxScores: ReadonlyMap<number, BoxScore>; loading: boolean } {
  // Indices are derived per render, so depending on the array itself would
  // restart the fetch every render. The joined key is what makes it settle.
  const key = indices.join(",");
  const [state, setState] = useState<{ key: string; boxScores: Map<number, BoxScore> }>(
    () => ({ key: "", boxScores: new Map() }),
  );
  // Guards against a slow answer for an earlier match landing on top of a newer
  // one, when the reader moves between matches faster than IndexedDB replies.
  const latest = useRef("");

  useEffect(() => {
    if (lid === undefined || key === "") {
      setState({ key, boxScores: new Map() });
      return;
    }
    latest.current = key;
    let live = true;
    void (async () => {
      // In parallel: a rewatch asks for a whole matchday at once.
      const loaded = await Promise.all(
        key.split(",").map(async (raw) => {
          const i = Number(raw);
          return [i, await loadMatchBoxScore(lid, i)] as const;
        }),
      );
      const entries = loaded.filter((e): e is readonly [number, BoxScore] => e[1] !== undefined);
      if (!live || latest.current !== key) return;
      setState({ key, boxScores: new Map(entries) });
    })();
    return () => { live = false; };
  }, [lid, key]);

  return { boxScores: state.boxScores, loading: state.key !== key };
}

/**
 * The same match with its fetched box score put back.
 *
 * Returns the match untouched when it was never elided, so a caller can apply
 * this unconditionally and a freshly simmed match costs nothing. The stored box
 * score carries no elision marker (a marked row is never written), so what comes
 * back is whole.
 */
export function withDetail(m: PlayedMatch, box: BoxScore | undefined): PlayedMatch {
  if (!isDetailElided(m) || box === undefined) return m;
  return { ...m, boxScore: box };
}
