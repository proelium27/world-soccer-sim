import { useEffect, useMemo, useState } from "react";
import type { LeagueStore } from "../core/leagueState.js";
import { loadCareer, mergeCareer, type Career } from "../db/careerDb.js";

/**
 * One player's whole career, read back from disk under his resident window.
 *
 * A loaded league holds only each player's last few seasons (`recentStats`/
 * `recentHist`); the Player Profile is the one screen that wants all of them,
 * for its season tables and both career charts. Undefined until the first read
 * lands, and a caller must treat that as "loading" rather than as a short
 * career — the window alone looks like a plausible career, which is exactly the
 * wrong number this is here to prevent.
 *
 * Read once per player, not once per commit: rows older than the window never
 * change, so the last read stays good and the CURRENT window is laid over it on
 * every render. A season he has just finished, a God Mode edit, a matchday
 * simmed while the page is open — all show at once, with no loading flash.
 */
export function useCareer(league: LeagueStore | null | undefined, pid: number | undefined): Career | undefined {
  const [disk, setDisk] = useState<{ lid: number | undefined; pid: number; career: Career } | null>(null);
  const lid = league?.lid;
  const player = useMemo(
    () => (pid === undefined ? undefined : league?.players.find((p) => p.pid === pid)),
    [league, pid],
  );
  const known = player !== undefined;

  useEffect(() => {
    if (!league || pid === undefined || !known) return;
    const p = league.players.find((x) => x.pid === pid)!;
    let live = true;
    void loadCareer(league, p).then((career) => {
      if (live) setDisk({ lid, pid, career });
    });
    return () => { live = false; };
    // Deliberately not keyed on `league`: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lid, pid, known]);

  return useMemo(() => {
    if (!player) return undefined;
    // A league that has never been saved has no history on disk, so memory is
    // all of it and there is nothing to wait for.
    if (!lid) return { stats: [...player.recentStats], hist: [...player.recentHist] };
    if (!disk || disk.pid !== pid || disk.lid !== lid) return undefined;
    return mergeCareer(disk.career, player);
  }, [player, disk, pid, lid]);
}
