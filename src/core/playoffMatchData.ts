import type { StoredTeam } from "./teams/clubs.js";
import type { Player } from "./players/types.js";
import type { TeamMatchData } from "./league/composites.js";
import { leagueMatchData } from "./league/composites.js";
import { teamSeasonFormDelta, applySeasonForm } from "./teamSeasonForm.js";

/**
 * Match data for a playoff, built over the competitions its entrants are
 * measured against.
 *
 * Composites z-normalize within the pool they are built from, so the pool is
 * the caller's decision and the whole point of passing it: a bracket drawn
 * entirely from one division pools that division, a tie that crosses divisions
 * pools both (see `playPromotionPlayoffs`). Season form applies, because a
 * playoff is the last act of the season it decides; injuries are honoured by
 * `leagueMatchData`; suspensions are not carried in, the same call every cup
 * makes.
 *
 * Built afresh for every round of a staged playoff, so a lineup the user sets
 * between rounds is the one that plays. Built once over the same squads, it is
 * the same data, which is what lets a staged playoff and one played in a single
 * pass land on the same result.
 */
export function playoffMatchData(
  teams: readonly StoredTeam[],
  players: Player[],
  compIds: ReadonlySet<number>,
  lid: number,
  season: number,
): Map<number, TeamMatchData> {
  const poolTeams = teams.filter((t) => compIds.has(t.compId));
  const data = leagueMatchData({
    teams: poolTeams.map((t) => ({
      tid: t.tid,
      name: t.name,
      roster: t.roster,
      avgOvr: 0,
      academyBase: t.academyBase,
      compId: t.compId,
      starters: t.starters,
      formation: t.formation,
      moreMinutes: t.moreMinutes,
    })),
    players,
  });
  const matchData = new Map<number, TeamMatchData>();
  poolTeams.forEach((t, i) => {
    const delta = teamSeasonFormDelta(lid, season, t.tid);
    const d = data[i];
    matchData.set(t.tid, delta === 0 ? d : {
      ...d,
      composites: applySeasonForm(d.composites, delta),
      recompute: (onPitch) => applySeasonForm(d.recompute(onPitch), delta),
    });
  });
  return matchData;
}
