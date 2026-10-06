import { useState } from "react";
import { useParams } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { WatchToggle } from "../components/WatchToggle.js";
import { HowHeSeesClubs } from "../components/HowHeSeesClubs.js";
import { HonorPills } from "../components/HonorPills.js";
import { SKILL_KEYS } from "../../core/players/types.js";
import type { CompletedTransfer } from "../../core/transfers/negotiation.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { SKILL_LABELS, SKILL_ABBREV } from "../components/PlayerRatingsTooltip.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { PotHelp } from "../components/HelpHint.js";
import { ValueHistoryChart } from "../components/ValueHistoryChart.js";
import { OvrHistoryChart } from "../components/OvrHistoryChart.js";
import { careerValueHistory } from "../../core/finance/valueHistory.js";
import { usePotentialView } from "../potentialView.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { Flag } from "../components/Flag.js";
import { BackLink } from "../components/BackLink.js";
import { competitionOf } from "../../core/competitions.js";
import { formatWeeklyWage, seasonYear, transferFeeLabel } from "../format.js";
import { PlayerClauseNote } from "../components/ClauseLedger.js";
import { ClubLink } from "../components/ClubLink.js";
import { PlayerStatsCard } from "../components/PlayerStatsCard.js";
import { isSuspended, matchesLabel } from "../../core/suspensions.js";
import { PlayerEditModal } from "../components/PlayerEditModal.js";
import { computePlayerHonors } from "../../core/playerHonors.js";
import { hasClubSeason } from "../../core/clubSeason.js";
import { RetiredPlayerProfile } from "./RetiredPlayerProfile.js";
import { PositionBadge, PositionHistoryNote, PositionStrip } from "../components/PositionBadge.js";

/**
 * Best-effort reconstruction of which team a player was on during a past
 * season. There's no per-season roster snapshot anywhere in the game, so
 * this walks the player's CompletedTransfer history (sorted chronologically):
 * the team he belonged to at the end of `season` is whichever transfer's
 * toTid most recently took effect at or before that season, or — if no
 * transfer has happened yet by that season — the fromTid of his earliest
 * transfer (he must have started there), or his present-day team if he's
 * never been transferred at all.
 *
 * One wrinkle: if his earliest record is a *free* signing, its fromTid is the
 * free-agent sentinel, which says nothing about where he was before it — a
 * player can spend years on a club's roster without any transfer being logged
 * (generated there, then released). So the sentinel must never become the
 * pre-history owner; those earlier seasons fall back to his present club, the
 * same best guess this made before free signings were recorded at all.
 */
function teamForSeason(
  transfers: CompletedTransfer[],
  season: number,
  currentTid: number,
): number {
  const sorted = [...transfers].sort((a, b) =>
    a.season !== b.season ? a.season - b.season : (a.window === "summer" ? 0 : 1) - (b.window === "summer" ? 0 : 1),
  );
  const earliest = sorted.length > 0 ? sorted[0].fromTid : currentTid;
  let owner = isFreeAgentTid(earliest) ? currentTid : earliest;
  for (const t of sorted) {
    if (t.season > season) break;
    owner = t.toTid;
  }
  return owner;
}

export function PlayerProfile() {
  const { pid } = useParams<{ pid: string }>();
  const { league, movePlayerToClubAction, releasePlayerGodModeAction, editPlayerAction } = useLeague();
  const [careerChart, setCareerChart] = useState<"value" | "ovr">("value");
  const [editing, setEditing] = useState(false);
  // The user's scouting view of a potential — the band the ratings table shows
  // and the midpoint the value chart prices on. A hook, so it lives above the
  // guards below; shared with PotDisplay and the player database so the three
  // can't disagree about what the user is allowed to know.
  const potView = usePotentialView();

  if (!league || pid === undefined) {
    return <p className="p-3">Loading...</p>;
  }

  const targetPid = parseInt(pid, 10);
  const player = league.players.find((p) => p.pid === targetPid);

  if (!player) {
    // Retirement deletes a player from the pool, so a link from anywhere
    // historical (all-time lists, an old transfer, a news item) lands here for
    // anyone who has hung up his boots. His archived career is the page to show.
    const archived = (league.retiredPlayers ?? []).find((a) => a.pid === targetPid);
    if (archived) return <RetiredPlayerProfile archived={archived} league={league} />;
    return (
      <div className="container-fluid p-3">
        <p>Player not found.</p>
        <BackLink fallback="/roster" />
      </div>
    );
  }

  const team = league.teams.find((t) => t.roster.includes(player.pid));
  const inAcademy = league.teams.find((t) => t.academyRoster.includes(player.pid));

  const playerTransfers = league.transfers
    .filter((t) => t.pid === player.pid)
    .sort((a, b) => b.season - a.season || (a.window === "summer" ? 1 : 0) - (b.window === "summer" ? 1 : 0));

  // Career honours. League titles are credited only for seasons he was actually
  // in the champion's squad — see computePlayerHonors for why that can't come
  // from teamForSeason's transfer-history walk.
  const honors = computePlayerHonors(player, league.seasonHistory, {
    cupHistory: league.cupHistory,
    shieldHistory: league.shieldHistory,
    americasCupHistory: league.americasCupHistory,
    domesticCupHistory: league.domesticCupHistory,
  });

  const histBySeasonDesc = [...player.hist].sort((a, b) => b.season - a.season);
  // Scouting fog also applies to the POT column of the history table, per row
  // and keyed off that row's own season — so a player the user has never
  // scouted stays fogged here too (closing the "read the exact number one tab
  // over" leak), while an owned player's estimate clears with tenure exactly
  // as it does everywhere else.
  // How a given season's POT should *read* — the same fogged band the history
  // table below shows, evaluated on that season like the table does.
  const potBandLabel = (potential: number, season: number): string => {
    const fog = potView.fogFor(potential, player.pid, season);
    return fog ? `${fog.low}–${fog.high}` : String(potential);
  };
  // The POT the value chart *prices* off. trueTransferValue pays a premium for
  // an unfulfilled potential gap, so feeding it the true number would turn the
  // dollar figure into an exact read on a hidden one — it gets the fogged
  // band's midpoint instead. The band is taken once, at the current season, so
  // its seeded off-center jitter is a single constant across the career and the
  // value line stays smooth; the hover card still quotes each season's own band.
  const pricedPotential = (potential: number): number =>
    potView.midpoint(potential, player.pid, league.season);

  const valuePoints = careerValueHistory(player, league.season, (snap) =>
    pricedPotential(snap.potential));
  const statsBySeason = new Map(player.stats.map((s) => [s.season, s]));

  /**
   * The club a season belongs to, for the club column on the season tables.
   *
   * SeasonStats.tid is recorded fact — the club he was at as of his last
   * appearance that year — so it wins wherever there is a row for the season.
   * teamForSeason's transfer walk is the fallback for a season with no stats
   * row at all (a year he sat out entirely), where it is the only answer going.
   * Preferring the fact matters now that the club is a link: the walk falls
   * back to his *present* club for seasons before his first recorded move, and
   * a link built on that guess lands on a squad he was never in.
   */
  const seasonTid = (season: number): number | null => {
    const row = statsBySeason.get(season);
    if (row && !isFreeAgentTid(row.tid)) return row.tid;
    return team ? teamForSeason(playerTransfers, season, team.tid) : null;
  };
  // Two different lookups, because a snapshot's ratings and its academy flag
  // describe different seasons. The ratings stamped at the end of season N are
  // what he carried through N+1; the flag records where he *was* in N. So the
  // POT shown for a played season comes from the snapshot before it, while the
  // academy label comes from the snapshot for that same season — falling back
  // to his live squad for the current one, which has no snapshot yet.
  const histBySeasonPlayed = new Map(player.hist.map((h) => [h.season + 1, h]));
  const academyBySeason = new Map(player.hist.map((h) => [h.season, h.academy]));

  return (
    <div className="container-fluid p-3">
      <BackLink fallback={team && team.tid === league.meta.userTid ? "/roster" : "/leaders"} />

      <h4 className="mt-2">
        {player.name} <Flag nationality={player.nationality} />{" "}
        <small className="text-muted">
          <PositionBadge player={player} /> &middot; Age {league.season - player.born} &middot; {player.heightCm}cm &middot; {player.nationality}
        </small>{" "}
        <WatchToggle pid={player.pid} name={player.name} />
      </h4>
      <p className="mb-3">
        {team ? (
          <>
            <ClubLink tid={team.tid} /> <small className="text-muted">({competitionOf(league.competitions, team.compId).name})</small>
          </>
        ) : inAcademy ? (
          <><ClubLink tid={inAcademy.tid} /> Academy</>
        ) : (
          <span className="text-muted">Free agent</span>
        )}
        {" "}&middot; OVR <strong>{player.ovr}</strong> / POT <strong><PotDisplay player={player} /></strong>
        {" "}&middot; Wage {formatWeeklyWage(player.contract.salary)}
        {" "}&middot; Contract through {seasonYear(player.contract.expiresSeason)}
        {player.injury && (
          <>
            {" "}&middot; <span className="text-danger">Injured ({player.injury.type}, {player.injury.gamesRemaining} matches remaining)</span>
          </>
        )}
        {isSuspended(player) && (
          <>
            {" "}&middot;{" "}
            <span className="text-danger" title="League matches only, so he can still play in the cup.">
              Suspended ({player.suspension!.reason}, {matchesLabel(player.suspension!.matchesRemaining)} remaining)
            </span>
          </>
        )}
        {/* Shown whether or not God Mode is currently on: the lock is saved
            state, so turning God Mode off must not hide the reason a player
            has stopped developing. */}
        {player.ratingsLocked && (
          <>
            {" "}&middot;{" "}
            <span className="text-warning" title="God Mode: his ratings, overall and potential won't change in the offseason.">
              Ratings locked
            </span>
          </>
        )}
      </p>

      <PositionStrip player={player} />
      <PositionHistoryNote player={player} />

      {player.intl && player.intl.caps > 0 && (
        <p className="mb-3 small">
          <span className="text-muted">{player.nationality}:</span>{" "}
          <strong>{player.intl.caps}</strong> caps, <strong>{player.intl.goals}</strong> goals
          {player.intl.tournaments > 0 && <> &middot; {player.intl.tournaments} {player.intl.tournaments === 1 ? "tournament" : "tournaments"}</>}
          {player.intl.titles > 0 && <> &middot; <strong>{player.intl.titles}</strong> {player.intl.titles === 1 ? "title" : "titles"}</>}
          {(player.intl.confederationCupTitles ?? 0) > 0 && (
            <> &middot; <strong>{player.intl.confederationCupTitles}</strong> confederation cup {player.intl.confederationCupTitles === 1 ? "title" : "titles"}</>
          )}
        </p>
      )}

      {league.godMode && (
        <div className="gm-panel">
          <div className="gm-panel-title">God Mode</div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <button className="btn btn-sm btn-warning" onClick={() => setEditing(true)}>Edit Player</button>
            {/* The same setting the edit modal stages, offered as one click for
                when locking him is the only thing you came here to do. */}
            <button
              className="btn btn-sm btn-outline-warning"
              title="Freeze his ratings, overall and potential so the offseason stops moving them."
              onClick={() => editPlayerAction(player.pid, { ratingsLocked: !player.ratingsLocked })}
            >
              {player.ratingsLocked ? "Unlock ratings" : "Lock ratings"}
            </button>
            <div className="d-flex align-items-center gap-1">
              <label className="small text-muted m-0">Move to</label>
              <select
                className="form-select form-select-sm"
                style={{ width: "auto" }}
                value=""
                onChange={(e) => {
                  const tid = Number(e.target.value);
                  if (!Number.isNaN(tid)) movePlayerToClubAction(player.pid, tid);
                }}
              >
                <option value="">Select club…</option>
                {[...league.teams]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((t) => (
                    <option key={t.tid} value={t.tid} disabled={team?.tid === t.tid}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() => releasePlayerGodModeAction(player.pid)}
            >
              Release to free agency
            </button>
          </div>
        </div>
      )}

      {editing && <PlayerEditModal player={player} onClose={() => setEditing(false)} />}

      {/* Full width at the top: the pills wrap sideways, so a decorated career
          takes a line or two here, where in the left column it stretched that
          side far past the value chart. Hidden until there's something in it. */}
      {honors.hasAny && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="card-title">Awards &amp; Trophies</h6>
            <HonorPills honors={honors} competitions={league.competitions} />
          </div>
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="card-title">Attributes</h6>
              <div className="row row-cols-2 g-1">
                {SKILL_KEYS.map((key) => (
                  <div key={key} className="col d-flex justify-content-between">
                    <span className="text-muted small">{SKILL_LABELS[key]}</span>
                    <span className="fw-semibold" style={{ color: getRatingColor(player.ratings[key]) }}>
                      {player.ratings[key]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h6 className="card-title">Transfer History</h6>
              {/* Anything contingent still riding on this player. Sits with his
                  transfer record because that is where it came from, and it is
                  the one place a reader is already asking about his fees. */}
              <PlayerClauseNote pid={player.pid} />
              {playerTransfers.length === 0 ? (
                <p className="text-muted mb-0">No transfers on record.</p>
              ) : (
                <table className="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th>Window</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="text-end">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerTransfers.map((t, i) => (
                      <tr key={i}>
                        <td>{seasonYear(t.season)}</td>
                        <td className="text-capitalize">{t.window}</td>
                        <td><ClubLink tid={t.fromTid} season={t.season} /></td>
                        <td><ClubLink tid={t.toTid} season={t.season} /></td>
                        <td className="text-end">{transferFeeLabel(t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-7">
          <div className="card mb-3">
            <div className="card-body">
              {/* Value and OVR answer different questions about the same
                  career — what he was worth vs how good he was — and the two
                  come apart (an aging star's rating holds while his value
                  falls off the age curve). Both charts already exist, so they
                  share the panel rather than one replacing the other. */}
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="card-title mb-0">
                  {careerChart === "ovr" ? "OVR History" : "Transfer Value"}
                </h6>
                <ul className="nav nav-pills nav-sm">
                  <li className="nav-item">
                    <button type="button"
                      className={`nav-link py-0 px-2${careerChart === "value" ? " active" : ""}`}
                      onClick={() => setCareerChart("value")}>
                      Value
                    </button>
                  </li>
                  <li className="nav-item">
                    <button type="button"
                      className={`nav-link py-0 px-2${careerChart === "ovr" ? " active" : ""}`}
                      onClick={() => setCareerChart("ovr")}>
                      OVR
                    </button>
                  </li>
                </ul>
              </div>
              {careerChart === "ovr" ? (
                <OvrHistoryChart
                  pid={player.pid}
                  name={player.name}
                  points={player.hist}
                  league={league}
                  teamTidForSeason={(season) => {
                    if (!team) return inAcademy ? inAcademy.tid : null;
                    // teamForSeason never hands back the free-agent sentinel, so
                    // every season resolves to a real club to color by.
                    return teamForSeason(playerTransfers, season, team.tid);
                  }}
                />
              ) : (
              <ValueHistoryChart
                pid={player.pid}
                name={player.name}
                points={valuePoints}
                league={league}
                detailForSeason={(season) => {
                  const stats = statsBySeason.get(season);
                  const snap = histBySeasonPlayed.get(season);
                  const apps = stats?.appearances ?? 0;
                  return {
                    // teamForSeason never hands back the free-agent sentinel, so
                    // every season resolves to a real club to color by. It needs
                    // a present-day club to walk back from, though, which an
                    // unrostered player hasn't got — for him each season falls
                    // back to SeasonStats.tid, the club he was at as of his last
                    // appearance that year. Without it a released veteran's whole
                    // career read "Free agent", including the seasons the very
                    // same card credits him 17 goals for.
                    tid: team
                      ? teamForSeason(playerTransfers, season, team.tid)
                      : inAcademy?.tid
                        ?? (stats && !isFreeAgentTid(stats.tid) ? stats.tid : null),
                    potentialLabel: snap ? potBandLabel(snap.potential, snap.season) : "?",
                    academy: academyBySeason.get(season) ?? inAcademy !== undefined,
                    age: season - player.born,
                    goals: stats?.goals ?? 0,
                    assists: stats?.assists ?? 0,
                    appearances: apps,
                    avgRating: stats?.avgRating ?? 0,
                    didNotPlay: apps === 0,
                  };
                }}
              />
              )}
            </div>
          </div>
        </div>
      </div>

      <PlayerStatsCard
        league={league}
        pid={player.pid}
        pos={player.pos}
        nationality={player.nationality}
        stats={player.stats}
        intl={player.intl ?? null}
        seasonTid={seasonTid}
      />

      <div className="card mt-3">
        <div className="card-body">
          <h6 className="card-title">OVR / POT / Attribute History</h6>
          {histBySeasonDesc.length === 0 ? (
            <p className="text-muted mb-0">No history recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm mb-0">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th className="text-end">Ovr</th>
                    <th className="text-end">Pot <PotHelp /></th>
                    {SKILL_KEYS.map((key) => (
                      <th key={key} className="text-end" title={SKILL_LABELS[key]}>
                        {SKILL_ABBREV[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {histBySeasonDesc.map((h) => (
                    <tr key={h.season}>
                      <td>
                        {seasonYear(h.season)}
                        {seasonTid(h.season) !== null && (
                          <span className="text-muted small">
                            {" ("}
                            <ClubLink tid={seasonTid(h.season)!} season={h.season} variant="abbrev"
                              /* The ratings table opens with the snapshot taken when
                                 the league was created, labelled a season before
                                 season 1 and never actually played. */
                              linked={hasClubSeason(league, h.season)} />
                            {")"}
                          </span>
                        )}
                      </td>
                      <td className="text-end fw-semibold" style={{ color: getRatingColor(h.ovr) }}>{h.ovr}</td>
                      {(() => {
                        const fog = potView.fogFor(h.potential, player.pid, h.season);
                        const colorAt = potView.midpoint(h.potential, player.pid, h.season);
                        return (
                          <td className="text-end" style={{ color: getRatingColor(colorAt) }}>
                            {fog ? `${fog.low}–${fog.high}` : h.potential}
                          </td>
                        );
                      })()}
                      {SKILL_KEYS.map((key) => (
                        <td key={key} className="text-end" style={{ color: getRatingColor(h.ratings[key]) }}>
                          {h.ratings[key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted small mt-2 mb-0">
            Each row is the player&apos;s ratings as of the end of that season (i.e. what he
            carried into the following one).
          </p>
        </div>
      </div>

      <HowHeSeesClubs league={league} player={player} />
    </div>
  );
}
