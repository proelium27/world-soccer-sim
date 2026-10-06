import { useEffect, useState } from "react";
import type { ArchivedPlayer, RetireeCareer } from "../../core/players/archive.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { computeArchivedHonors } from "../../core/playerHonors.js";
import { ALL_TIME_STAT_KEYS } from "../../core/frivolities/stats.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { OvrHistoryChart } from "../components/OvrHistoryChart.js";
import { HonorPills } from "../components/HonorPills.js";
import { Flag } from "../components/Flag.js";
import { BackLink } from "../components/BackLink.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { seasonYear, transferFeeLabel } from "../format.js";
import { ClubLink } from "../components/ClubLink.js";
import { STAT_LABELS, formatStat } from "../statLabels.js";
import { useLeague } from "../context/LeagueContext.js";
import { PlayerStatsCard } from "../components/PlayerStatsCard.js";
import { loadRetireeCareer } from "../../db/leagueDb.js";

/**
 * His full stat lines, read off disk when the page opens (`RetireeCareer`).
 * `undefined` while the read is in flight, `null` once it's known there are
 * none: he retired before they were kept, or the save has never been written.
 */
function useRetireeCareer(lid: number, pid: number): RetireeCareer | null | undefined {
  const [found, setFound] = useState<{ key: string; career: RetireeCareer | null } | null>(null);
  const key = `${lid}:${pid}`;
  useEffect(() => {
    let live = true;
    const read = lid ? loadRetireeCareer(lid, pid) : Promise.resolve(undefined);
    read.then(
      (career) => { if (live) setFound({ key, career: career ?? null }); },
      () => { if (live) setFound({ key, career: null }); },
    );
    return () => { live = false; };
  }, [lid, pid, key]);
  // Keyed, so following a link from one retiree to another never shows the
  // first one's lines under the second one's name for a frame.
  return found?.key === key ? found.career : undefined;
}

/**
 * The career page for a player retirement has deleted from the pool.
 *
 * Everything here comes off his `ArchivedPlayer` record plus the league history
 * that outlives him (`seasonHistory` for honours, `league.transfers` for his
 * moves — retirement deliberately leaves both alone), plus his full stat lines,
 * read off disk on open (`RetireeCareer`), which give him the same stat tables a
 * living profile has. A player who retired before those were kept has only the
 * archive's club/rating/apps line per season, and the page shows that rather
 * than faking the rest. No attribute ratings survive for anyone.
 */
export function RetiredPlayerProfile({
  archived,
  league,
}: {
  archived: ArchivedPlayer;
  league: LeagueStore;
}) {
  const { unretirePlayerAction, simming } = useLeague();
  const career = useRetireeCareer(league.lid, archived.pid);
  const honors = computeArchivedHonors(archived, league.seasonHistory, {
    cupHistory: league.cupHistory,
    shieldHistory: league.shieldHistory,
    americasCupHistory: league.americasCupHistory,
    domesticCupHistory: league.domesticCupHistory,
  });

  const transfers = league.transfers
    .filter((t) => t.pid === archived.pid)
    .sort((a, b) => b.season - a.season || (a.window === "summer" ? 1 : 0) - (b.window === "summer" ? 1 : 0));

  const seasonsDesc = [...archived.seasons].sort((a, b) => b.season - a.season);
  const tidBySeason = new Map(archived.seasons.map((s) => [s.season, s.tid]));

  /**
   * The last season he played at a club. The header lists his clubs without
   * seasons, but a club link needs one — and the season his spell there ended
   * on is the most informative single choice. Falls back to the season he
   * retired for a club with no season line of its own.
   */
  const lastSeasonAt = (tid: number): number => {
    const seasons = archived.seasons.filter((s) => s.tid === tid).map((s) => s.season);
    return seasons.length > 0 ? Math.max(...seasons) : archived.retiredSeason;
  };

  // Only the stats he actually recorded — a keeper's career shouldn't list ten
  // zero rows for shots, and an outfielder's shouldn't list saves.
  const totalKeys = ALL_TIME_STAT_KEYS.filter((k) => archived.totals[k] > 0);
  const bestKeys = ALL_TIME_STAT_KEYS.filter((k) => archived.best[k].appearances > 0 && archived.best[k].value > 0);

  return (
    <div className="container-fluid p-3">
      <BackLink fallback="/frivolities" />

      <h4 className="mt-2">
        {archived.name} <Flag nationality={archived.nationality} />{" "}
        <span className="badge text-bg-secondary align-middle">Retired</span>{" "}
        <small className="text-muted">
          {archived.pos} &middot; {archived.heightCm}cm &middot; {archived.nationality}
        </small>
      </h4>
      <p className="mb-3">
        Hung up his boots after {seasonYear(archived.retiredSeason)}, aged {archived.retiredAge}
        {" "}&middot; {archived.seasonsPlayed} {archived.seasonsPlayed === 1 ? "season" : "seasons"} played
        {" "}&middot; Peak OVR{" "}
        <strong style={{ color: getRatingColor(archived.peakOvr) }}>{archived.peakOvr}</strong>
        {" "}in {seasonYear(archived.peakSeason)}
        {" "}&middot; Final OVR <strong style={{ color: getRatingColor(archived.finalOvr) }}>{archived.finalOvr}</strong>
      </p>

      {league.godMode && (
        <div className="gm-panel">
          <div className="gm-panel-title">God Mode</div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            {/* Once he's back in the pool this same URL renders his living
                profile, where Move to / Edit / Lock take over. */}
            <button
              className="btn btn-sm btn-warning"
              disabled={simming}
              title="Bring him back as a free agent, rated where he finished."
              onClick={() => unretirePlayerAction(archived.pid)}
            >
              Un-retire
            </button>
          </div>
        </div>
      )}

      {archived.clubs.length > 0 && (
        <p className="mb-3">
          <span className="text-muted">Clubs:</span>{" "}
          {archived.clubs.map((tid, i) => (
            <span key={tid}>
              {i > 0 && ", "}
              <ClubLink tid={tid} season={lastSeasonAt(tid)} />
            </span>
          ))}
        </p>
      )}

      {archived.caps > 0 && (
        <p className="mb-3 small">
          <span className="text-muted">{archived.nationality}:</span>{" "}
          <strong>{archived.caps}</strong> caps, <strong>{archived.intlGoals}</strong> goals
          {archived.intlTitles > 0 && (
            <> &middot; <strong>{archived.intlTitles}</strong> {archived.intlTitles === 1 ? "title" : "titles"}</>
          )}
        </p>
      )}

      {/* Full width at the top, as on the living profile: the pills wrap
          sideways, so a long career's honours stay a line or two tall. */}
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
              <h6 className="card-title">Career Totals</h6>
              {totalKeys.length === 0 ? (
                <p className="text-muted mb-0">No league stats on record.</p>
              ) : (
                <table className="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th>Stat</th>
                      <th className="text-end">Career</th>
                      <th className="text-end">Best season</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totalKeys.map((k) => (
                      <tr key={k}>
                        <td>{STAT_LABELS[k]}</td>
                        <td className="text-end fw-semibold">{formatStat(k, archived.totals[k])}</td>
                        <td className="text-end">
                          {bestKeys.includes(k) ? (
                            <>
                              {formatStat(k, archived.best[k].value)}{" "}
                              <span className="text-muted small">({seasonYear(archived.best[k].season)})</span>
                            </>
                          ) : (
                            <span className="text-muted">&mdash;</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h6 className="card-title">Transfer History</h6>
              {transfers.length === 0 ? (
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
                    {transfers.map((t, i) => (
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
          <div className="card">
            <div className="card-body">
              <h6 className="card-title">OVR History</h6>
              <OvrHistoryChart
                pid={archived.pid}
                name={archived.name}
                points={archived.seasons.map((s) => ({ season: s.season, ovr: s.ovr }))}
                league={league}
                teamTidForSeason={(season) => {
                  const tid = tidBySeason.get(season);
                  return tid === undefined || isFreeAgentTid(tid) ? null : tid;
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <PlayerStatsCard
        league={league}
        pid={archived.pid}
        pos={archived.pos}
        nationality={archived.nationality}
        stats={career?.stats ?? []}
        intl={career?.intl ?? null}
        seasonTid={(season) => {
          const tid = tidBySeason.get(season);
          return tid === undefined || isFreeAgentTid(tid) ? null : tid;
        }}
        leagueEmpty={career === undefined ? (
          <p className="text-muted mb-0">Loading&hellip;</p>
        ) : seasonsDesc.length === 0 ? (
          <p className="text-muted mb-0">No seasons on record.</p>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-striped table-sm mb-0">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Club</th>
                    <th className="text-end">Ovr</th>
                    <th className="text-end">Apps</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonsDesc.map((s) => (
                    <tr key={s.season}>
                      <td>{seasonYear(s.season)}</td>
                      <td>
                        <ClubLink tid={s.tid} season={s.season} />{" "}
                        <span className="text-muted small">
                          (<ClubLink tid={s.tid} season={s.season} variant="abbrev" />)
                        </span>
                      </td>
                      <td className="text-end fw-semibold" style={{ color: getRatingColor(s.ovr) }}>{s.ovr}</td>
                      <td className="text-end">{s.apps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted small mt-2 mb-0">
              He retired before full stat lines were kept, so only his club, rating and apps
              survive for each season. Apps of 0 means he was in the squad without playing.
            </p>
          </>
        )}
      />
    </div>
  );
}
