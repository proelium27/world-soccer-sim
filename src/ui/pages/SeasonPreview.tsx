import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { PotHelp } from "../components/HelpHint.js";
import type { Player } from "../../core/players/types.js";
import type { StoredTeam } from "../../core/teams/clubs.js";
import { computeTeamRating } from "../../core/teams/teamRating.js";
import { teamSlots } from "../../core/lineup/formations.js";
import { currency, seasonYear } from "../format.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { Flag } from "../components/Flag.js";
import { usePlayerRefs } from "../components/PlayerRefLink.js";

const TOP_N = 10;

export function SeasonPreview() {
  const { league } = useLeague();
  const playersByPid = usePlayerMap(league?.players);
  const refOf = usePlayerRefs();

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const teamByPid = new Map<number, StoredTeam>();
  for (const team of league.teams) {
    for (const pid of team.roster) teamByPid.set(pid, team);
  }

  const topPlayers = league.players
    .filter((p) => teamByPid.has(p.pid))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, TOP_N);

  const topTeams = league.teams
    .map((team) => {
      const roster = league.players.filter((p) => team.roster.includes(p.pid));
      return { team, rating: computeTeamRating(roster, team.starters, teamSlots(team)) };
    })
    .sort((a, b) => b.rating.ovr - a.rating.ovr)
    .slice(0, TOP_N);

  // The offseason that produced this preview retired players at the end of the
  // *previous* season, which is the history entry it wrote them onto. Matched by
  // season rather than taking the last entry, so a save mid-rollover can't show
  // the wrong offseason's farewells.
  const retirements = league.seasonHistory.find((h) => h.season === league.season - 1)?.retirements;
  const topTransfers = league.transfers
    // Free signings (fee 0, from the free-agent sentinel) aren't "top" anything
    // — the biggest-fee deals are what belongs in a season preview.
    .filter((t) => t.season === league.season && t.window === "summer" && !isFreeAgentTid(t.fromTid))
    .sort((a, b) => b.fee - a.fee)
    .slice(0, TOP_N);

  return (
    <div className="container-fluid p-3">
      <h4>Season Preview: {seasonYear(league.season)}</h4>
      <p className="text-muted small mb-4">
        Here's how the offseason shook out before {seasonYear(league.season)} kicks off.
      </p>

      <div className="row g-4">
        <div className="col-lg-6">
          <h5>Top {TOP_N} Rated Players</h5>
          <table className="table table-striped table-sm">
            <thead>
              <tr>
                <th className="text-end">#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="text-end">OVR</th>
                <th className="text-end">POT <PotHelp /></th>
              </tr>
            </thead>
            <tbody>
              {topPlayers.map((player: Player, i) => {
                const team = teamByPid.get(player.pid);
                return (
                  <tr key={player.pid} className={team?.tid === league.meta.userTid ? "team-highlight" : undefined}>
                    <td className="text-end">{i + 1}</td>
                    <td>
                      <PlayerRatingsTooltip player={player}>
                        <span className="d-inline-flex align-items-center gap-1">
                          <Flag nationality={player.nationality} />
                          <Link to={`/player/${player.pid}`}>{player.name}</Link>
                        </span>
                      </PlayerRatingsTooltip>
                    </td>
                    <td>{team ? <ClubLink tid={team.tid} /> : "—"}</td>
                    <td className="text-end">{player.ovr}</td>
                    <td className="text-end"><PotDisplay player={player} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="col-lg-6">
          <h5>Top {TOP_N} Rated Teams</h5>
          <table className="table table-striped table-sm">
            <thead>
              <tr>
                <th className="text-end">#</th>
                <th>Team</th>
                <th className="text-end">OVR</th>
                <th className="text-end">POT <PotHelp /></th>
              </tr>
            </thead>
            <tbody>
              {topTeams.map(({ team, rating }, i) => (
                <tr key={team.tid} className={team.tid === league.meta.userTid ? "team-highlight" : undefined}>
                  <td className="text-end">{i + 1}</td>
                  <td>
                    <ClubLink
                      tid={team.tid}
                      crest
                      crestSize={20}
                      className="d-inline-flex align-items-center gap-1 text-decoration-none"
                    />
                  </td>
                  <td className="text-end">{rating.ovr}</td>
                  <td className="text-end">{rating.pot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h5 className="mt-4">Top {TOP_N} Offseason Transfers</h5>
      {topTransfers.length === 0 ? (
        <p className="text-muted">No transfers went through during the offseason window.</p>
      ) : (
        <table className="table table-striped table-sm">
          <thead>
            <tr>
              <th className="text-end">#</th>
              <th>Player</th>
              <th>From</th>
              <th>To</th>
              <th className="text-end">Fee</th>
            </tr>
          </thead>
          <tbody>
            {topTransfers.map((t, i) => {
              const player = playersByPid.get(t.pid);
              return (
                <tr key={`${t.pid}-${t.season}-${i}`}>
                  <td className="text-end">{i + 1}</td>
                  <td>{player ? <Link to={`/player/${player.pid}`}>{player.name}</Link> : "—"}</td>
                  <td><ClubLink tid={t.fromTid} season={t.season} /></td>
                  <td><ClubLink tid={t.toTid} season={t.season} /></td>
                  <td className="text-end">{currency.format(t.fee)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h5 className="mt-4">Retirements</h5>
      {!retirements ? (
        <p className="text-muted">
          No retirement record for this offseason. This save is from before the game started keeping one.
        </p>
      ) : retirements.total === 0 ? (
        <p className="text-muted">Nobody hung up their boots this offseason.</p>
      ) : (
        <>
          <p className="text-muted small">
            {retirements.total} {retirements.total === 1 ? "player" : "players"} retired, {retirements.rostered} of
            them on a club's books. Here are the biggest names to go, ranked by the career each of
            them had rather than the rating he finished on.
          </p>
          <table className="table table-striped table-sm">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th className="text-end">Age</th>
                <th>Last club</th>
                <th className="text-end">OVR</th>
                <th className="text-end">Seasons</th>
                <th className="text-end">Apps</th>
                <th className="text-end">G</th>
                <th className="text-end">A</th>
                <th className="text-end">Caps</th>
                {/* The number the list is ordered on, so the ranking can be read
                    rather than taken on trust. Last, matching where the GOAT
                    board itself puts its score. */}
                <th className="text-end" title="Career score, the same one the GOAT rankings use">
                  GOAT
                </th>
              </tr>
            </thead>
            <tbody>
              {retirements.notable.map((r) => (
                <tr key={r.pid} className={r.tid === league.meta.userTid ? "team-highlight" : undefined}>
                  {/* Linked only when the archive kept his career (see
                      isArchiveWorthy) — the farewell list names every notable
                      retiree, but a page only exists for the ones with a record
                      behind it. It has to be `linkable`, not mere existence: a
                      ref now also resolves off the award snapshots and off this
                      very farewell list, neither of which is a career page. */}
                  <td>
                    <span className="d-inline-flex align-items-center gap-1">
                      <Flag nationality={r.nationality} />
                      {refOf(r.pid)?.linkable
                        ? <Link to={`/player/${r.pid}`}>{r.name}</Link>
                        : r.name}
                    </span>
                  </td>
                  <td>{r.pos}</td>
                  <td className="text-end">{r.age}</td>
                  <td>
                    {r.tid === null
                      ? <span className="text-muted">Free agent</span>
                      /* His last club, in the season he last played - which is the
                         one that just finished, not the one about to start. */
                      : <ClubLink tid={r.tid} season={league.season - 1} />}
                  </td>
                  <td className="text-end">{r.ovr}</td>
                  <td className="text-end">{r.seasonsPlayed}</td>
                  <td className="text-end">{r.appearances}</td>
                  <td className="text-end">{r.goals}</td>
                  <td className="text-end">{r.assists}</td>
                  <td className="text-end">{r.caps}</td>
                  {/* Absent on a farewell list written before the score was
                      recorded: the player is long deleted, so there is no
                      career left to score him from. */}
                  <td className="text-end">
                    {r.goat === undefined
                      ? <span className="text-muted">—</span>
                      : <strong>{r.goat}</strong>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Link to="/awards" className="btn btn-primary mt-2">
        View Season Awards
      </Link>
    </div>
  );
}
