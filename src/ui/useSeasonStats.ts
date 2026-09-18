import { useEffect, useMemo, useState } from "react";
import type { LeagueStore } from "../core/leagueState.js";
import type { Player, SeasonStats } from "../core/players/types.js";
import { seasonIsResident } from "../core/simArchive.js";
import { readSeasonStats } from "../db/careerDb.js";

/**
 * One season's league line for any player, whether or not it is in memory.
 *
 * A player holds only his last couple of stat lines (`recentStats`); anything
 * older is on disk (`docs/lazy-career-plan.md`). Every page with a season picker
 * over the whole pool — the performance views, Leaders, the Database's season
 * columns — goes through this, so none of them can quietly read a two-line
 * window as if it were the season they asked for.
 */
export interface SeasonLines {
  season: number;
  lineOf: (player: Player) => SeasonStats | undefined;
  /** True while an older season is still being read back; lines read as absent until then. */
  loading: boolean;
}

/** Lines for a season that is in memory for everyone (see `seasonIsResident`). */
export function residentSeasonLines(season: number): SeasonLines {
  return {
    season,
    lineOf: (p) => p.recentStats.find((s) => s.season === season),
    loading: false,
  };
}

/**
 * The hook. The season in progress and the one before answer from memory with
 * no read at all; an older season is one indexed read of `seasons`, cached for
 * as long as the page asks for it. A resident line still wins over a disk one
 * for the same season — it is what the game is playing with.
 */
export function useSeasonStats(league: LeagueStore | undefined | null, season: number): SeasonLines {
  const lid = league?.lid;
  const resident = !league || !lid || seasonIsResident(season, league.season);
  const key = resident ? "" : `${lid}:${season}`;
  const [disk, setDisk] = useState<{ key: string; lines: Map<number, SeasonStats> }>(
    () => ({ key: "", lines: new Map() }),
  );

  useEffect(() => {
    if (key === "" || lid === undefined) return;
    let live = true;
    void readSeasonStats(lid, season).then((lines) => {
      if (live) setDisk({ key, lines });
    });
    return () => { live = false; };
  }, [key, lid, season]);

  return useMemo(() => {
    if (resident) return residentSeasonLines(season);
    const lines = disk.key === key ? disk.lines : undefined;
    return {
      season,
      lineOf: (p: Player) => p.recentStats.find((s) => s.season === season) ?? lines?.get(p.pid),
      loading: lines === undefined,
    };
  }, [resident, season, disk, key]);
}
