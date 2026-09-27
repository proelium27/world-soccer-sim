import type { Composites } from "../../engine/composites.js";
import type { Player, Position } from "../players/types.js";
import type { MatchPlayer } from "../../engine/attribution.js";
import type { League, LeagueTeam } from "./generate.js";
import { resolveXI } from "../lineup/resolveXI.js";
import { teamSlots } from "../lineup/formations.js";
import { rollupComposites, withSlots } from "../composites.js";
import { normalizeLeague, computeNormStats, normalizeWith } from "./normalize.js";
import { toMatchPlayers, type SetPieceTakers } from "./matchPlayers.js";
import { BENCH_SIZE } from "../constants.js";

export interface TeamMatchData {
  composites: Composites;
  xi: MatchPlayer[];
  bench: MatchPlayer[];
  /**
   * Re-roll this team's normalized composites from an arbitrary on-pitch group
   * (spec §4: "before each match, and after subs/red cards"). Normalization is
   * anchored to the same league stats as `composites`, so recomputing the
   * original XI reproduces `composites` exactly.
   */
  recompute: (onPitch: MatchPlayer[]) => Composites;
}

export interface MatchDataOptions {
  /**
   * Extra "he can't play today" test, on top of the injury filter every caller
   * gets. Exists so a *league* ban can sideline a player for league matches
   * without also keeping him out of the Continental Cup or a World Cup — the
   * cup and international callers simply don't pass it. See core/suspensions.ts.
   */
  unavailable?: (p: Player) => boolean;
}

/**
 * Full pipeline: for each team, pick its XI in its chosen formation, roll up raw composites,
 * then z-normalize across the league. Returns composites, the XI, and a bench
 * (best remaining players by ovr, capped at BENCH_SIZE) for in-match substitutions.
 * Injured players (gamesRemaining > 0) are excluded from both XI and bench selection,
 * as is anyone `opts.unavailable` rejects.
 */
function takersFor(t: LeagueTeam): SetPieceTakers | undefined {
  return t.penaltyTaker != null || t.setPieceTaker != null
    ? { penalty: t.penaltyTaker, setPiece: t.setPieceTaker }
    : undefined;
}

export function leagueMatchData(league: League, opts: MatchDataOptions = {}): TeamMatchData[] {
  const byPid = new Map<number, Player>(league.players.map((p) => [p.pid, p]));
  const unavailable = opts.unavailable;
  const xis: Player[][] = [];
  const benches: Player[][] = [];
  const boostSets: (Set<number> | undefined)[] = [];
  const slotsByTeam: Position[][] = [];
  const raw = league.teams.map((t) => {
    const roster = t.roster
      .map((pid) => byPid.get(pid)!)
      .filter((p) => !p.injury && !(unavailable && unavailable(p)));
    const slots = teamSlots(t);
    const xi = resolveXI(roster, slots, t.starters);
    xis.push(xi);
    slotsByTeam.push(slots);
    const xiPids = new Set(xi.map((p) => p.pid));
    const bench = roster
      .filter((p) => !xiPids.has(p.pid))
      .sort((a, b) => b.ovr - a.ovr)
      .slice(0, BENCH_SIZE);
    benches.push(bench);
    boostSets.push(t.moreMinutes && t.moreMinutes.length > 0 ? new Set(t.moreMinutes) : undefined);
    return rollupComposites(withSlots(xi, slots), t.name);
  });
  const stats = computeNormStats(raw);
  const normalized = normalizeLeague(raw);
  return normalized.map((c, i) => ({
    composites: c,
    xi: toMatchPlayers(xis[i], undefined, slotsByTeam[i], takersFor(league.teams[i])),
    bench: toMatchPlayers(benches[i], boostSets[i], undefined, takersFor(league.teams[i])),
    // After a sub or a red card the on-pitch group no longer lines up with the
    // formation array, so each MatchPlayer carries the slot it is currently
    // filling (a substitute inherits the slot of the man he replaced).
    recompute: (onPitch: MatchPlayer[]) => {
      const slotted = onPitch
        .map((mp) => {
          const player = byPid.get(mp.pid);
          return player ? { player, slot: mp.slot as Position } : undefined;
        })
        .filter((sp): sp is { player: Player; slot: Position } => sp !== undefined);
      return normalizeWith(stats, rollupComposites(slotted, league.teams[i].name));
    },
  }));
}

export function leagueComposites(league: League): Composites[] {
  return leagueMatchData(league).map((d) => d.composites);
}
