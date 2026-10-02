import type { LeagueStore } from "../leagueState.js";

export type TakerRole = "penalty" | "setPiece";

/**
 * Name (or, with null, clear) the user's penalty or set-piece taker. No-op
 * unless the pid is on the user's senior roster. A named taker only counts
 * while he's on the pitch; otherwise the match falls back to auto (see
 * engine/attribution.ts's penaltyTakerOf / cornerTakerOf).
 */
export function setSetPieceTaker(
  league: LeagueStore,
  role: TakerRole,
  pid: number | null,
): LeagueStore {
  const userTid = league.meta.userTid;
  const key = role === "penalty" ? "penaltyTaker" : "setPieceTaker";
  return {
    ...league,
    teams: league.teams.map((t) => {
      if (t.tid !== userTid) return t;
      if (pid !== null && !t.roster.includes(pid)) return t;
      if ((t[key] ?? null) === pid) return t;
      return { ...t, [key]: pid };
    }),
  };
}
