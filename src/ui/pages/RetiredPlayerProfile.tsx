import type { ReactNode } from "react";
import type { ArchivedPlayer } from "../../core/players/archive.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { computeArchivedHonors } from "../../core/playerHonors.js";
import { ALL_TIME_STAT_KEYS } from "../../core/frivolities/stats.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { OvrHistoryChart } from "../components/OvrHistoryChart.js";
import { TrophyIcon } from "../components/TrophyIcon.js";
import { Flag } from "../components/Flag.js";
import { BackLink } from "../components/BackLink.js";
import { GoldenBootIcon } from "../components/GoldenBootIcon.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { seasonYear, transferFeeLabel } from "../format.js";
import { ClubLink } from "../components/ClubLink.js";
import { STAT_LABELS, formatStat } from "../statLabels.js";

/** One career-honor badge, e.g. "3x Golden Boot" — omits the count for a single win. */
function AwardPill({ label, seasons, icon }: { label: string; seasons: number[]; icon?: ReactNode }) {
  if (seasons.length === 0) return null;
  const years = [...seasons].sort((a, b) => a - b).map(seasonYear);
  return (
    <span className="award-pill" title={years.join(", ")}>
      {icon}
      {years.length > 1 && <span className="award-pill-count">{years.length}x</span>}
      {label}
    </span>
  );
}

/**
 * The career page for a player retirement has deleted from the pool.
 *
 * Everything here comes off his `ArchivedPlayer` record plus the league history
 * that outlives him (`seasonHistory` for honours, `league.transfers` for his
 * moves — retirement deliberately leaves both alone). It deliberately shows
 * *less* than a living player's profile rather than faking the gaps: the
 * archive keeps career totals and a best season per stat, not the full
 * season-by-season stat lines, and it keeps no attribute ratings at all.
 */
export function RetiredPlayerProfile({
  archived,
  league,
}: {
  archived: ArchivedPlayer;
  league: LeagueStore;
}) {
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

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="card-title">Awards &amp; Trophies</h6>
              {!honors.hasAny ? (
                <p className="text-muted mb-0">No individual or team honors.</p>
              ) : (
                <div className="award-pills">
                  <AwardPill label="Ballon d'Or" seasons={honors.ballonDOr} />
                  <AwardPill label="World Team of the Year" seasons={honors.worldTeamOfYear} />
                  <AwardPill label="Goalkeeper of the Year" seasons={honors.goalkeeperOfYear} />
                  <AwardPill label="Defender of the Year" seasons={honors.defenderOfYear} />
                  <AwardPill label="Americas Player of the Year" seasons={honors.americasPlayerOfYear} />
                  <AwardPill label="Americas Team of the Year" seasons={honors.americasTeamOfYear} />
                  <AwardPill label="Americas Goalkeeper of the Year" seasons={honors.americasGoalkeeperOfYear} />
                  <AwardPill label="Americas Defender of the Year" seasons={honors.americasDefenderOfYear} />
                  <AwardPill label="Player of the Season" seasons={honors.playerOfSeason} />
                  <AwardPill label="Golden Boot" seasons={honors.goldenBoot} icon={<GoldenBootIcon />} />
                  <AwardPill label="Team of the Season" seasons={honors.teamOfSeason} />
                  <AwardPill label="League Champion" seasons={honors.leagueTitles} icon={<TrophyIcon />} />
                  <AwardPill label="Continental Cup" seasons={honors.continentalCups} />
                  <AwardPill label="Continental Shield" seasons={honors.shields} />
                  <AwardPill label="Americas Cup" seasons={honors.americasCups} />
                  <AwardPill label="Domestic Cup" seasons={honors.domesticCups} />
                </div>
              )}
            </div>
          </div>

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
          <div className="card mb-3">
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

          <div className="card">
            <div className="card-body">
              <h6 className="card-title">Season by Season</h6>
              {seasonsDesc.length === 0 ? (
                <p className="text-muted mb-0">No seasons on record.</p>
              ) : (
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
              )}
              <p className="text-muted small mt-2 mb-0">
                Retired players keep a career record rather than a full stat line, so the
                per-season goals and assists behind those totals aren&apos;t here. Apps of 0 means he
                was in the squad that season without getting on the pitch.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
