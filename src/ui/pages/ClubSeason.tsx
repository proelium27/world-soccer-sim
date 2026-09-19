import { useMemo } from "react";
import { EmptyState } from "../components/EmptyState.js";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { computeClubSeason, type ClubRun, type ClubSeasonPlayer } from "../../core/clubSeason.js";
import { competitionOf, competitionRegion } from "../../core/competitions.js";
import { POSITIONS } from "../../core/players/types.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { Flag } from "../components/Flag.js";
import { BackLink } from "../components/BackLink.js";
import { seasonYear, ordinal } from "../format.js";

/** Squad order: by position down the pitch, then by the rating he played that season at. */
function sortSquad(squad: ClubSeasonPlayer[]): ClubSeasonPlayer[] {
  const posOrder = new Map(POSITIONS.map((pos, i) => [pos, i]));
  return [...squad].sort((a, b) => {
    const posA = posOrder.get(a.pos) ?? 99;
    const posB = posOrder.get(b.pos) ?? 99;
    if (posA !== posB) return posA - posB;
    return b.ovr - a.ovr;
  });
}

function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card h-100">
      <div className="card-body py-2 px-3">
        <div className="text-muted text-uppercase small">{label}</div>
        <div className="fs-4 fw-semibold">{value}</div>
        {sub !== undefined && <div className="text-muted small">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * One competition's line. A run the club won is marked; one it didn't enter says
 * so rather than being left out, because "we weren't in it" is itself the answer
 * to what happened in that cup.
 */
function RunCard({ title, run, to, note }: { title: string; run: ClubRun; to?: string; note?: string }) {
  const heading = to ? <Link to={to} className="text-decoration-none">{title}</Link> : title;
  return (
    <div className="card h-100">
      <div className="card-body py-2 px-3">
        <div className="text-muted text-uppercase small">{heading}</div>
        {run === null ? (
          <div className="fs-6 text-muted">{note ?? "Didn't take part"}</div>
        ) : (
          <div className="fs-5 fw-semibold">
            {run.note}
            {run.isChampion && <span className="badge text-bg-warning ms-2">Winners</span>}
            {run.isRunnerUp && <span className="badge text-bg-secondary ms-2">Runners-up</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClubSeason() {
  const { league } = useLeague();
  const params = useParams();
  const navigate = useNavigate();

  const tid = Number(params.tid);
  const season = Number(params.season);

  const clubSeason = useMemo(
    () =>
      league && Number.isFinite(tid) && Number.isFinite(season)
        ? computeClubSeason(league, tid, season)
        : null,
    [league, tid, season],
  );

  if (!league) return <p className="p-3">Loading...</p>;

  const team = league.teams.find((t) => t.tid === tid);

  // Every season this club has a record of, newest first, plus the one being
  // played. The picker is how you walk a club's history without going back out
  // to the history page each time.
  const seasonOptions = [
    league.season,
    ...league.seasonHistory.map((h) => h.season).filter((s) => s !== league.season),
  ].sort((a, b) => b - a);

  if (!clubSeason) {
    return (
      <div className="container-fluid p-3">
        <BackLink fallback={`/history?tid=${tid}`} />
        <h4 className="mb-2 mt-2">{team?.name ?? `Team ${tid}`}</h4>
        <EmptyState
          headline={`No record of ${team?.name ?? "this club"} in ${seasonYear(season)}.`}
          action={<Link to={`/history?tid=${tid}`}>Club History</Link>}
        >
          <p>That season either hasn&apos;t been played yet or happened before this club&apos;s record starts.</p>
        </EmptyState>
      </div>
    );
  }

  const comp = competitionOf(league.competitions, clubSeason.compId);
  const squad = sortSquad(clubSeason.squad);
  const row = clubSeason.row;
  const { power } = clubSeason;
  const played = row?.played ?? 0;
  // A completed season reads its rating off the finale snapshot; the season
  // being played has the squad itself to hand, which is better than nothing
  // before the first snapshot of the year is taken.
  const rating = power ?? clubSeason.liveRating;

  const honourPids = new Set<number>([
    ...(clubSeason.playerOfSeasonPid !== null ? [clubSeason.playerOfSeasonPid] : []),
    ...(clubSeason.goldenBootPid !== null ? [clubSeason.goldenBootPid] : []),
    ...clubSeason.teamOfSeasonPids,
    ...(clubSeason.ballonDOrPid !== null ? [clubSeason.ballonDOrPid] : []),
    ...clubSeason.worldTeamOfYearPids,
  ]);

  const honourLabels = (pid: number): string[] => {
    const out: string[] = [];
    if (clubSeason.ballonDOrPid === pid) out.push("Ballon d'Or");
    if (clubSeason.playerOfSeasonPid === pid) out.push("Player of the Season");
    if (clubSeason.goldenBootPid === pid) out.push("Golden Boot");
    if (clubSeason.worldTeamOfYearPids.includes(pid)) out.push("World Team of the Year");
    if (clubSeason.teamOfSeasonPids.includes(pid)) out.push("Team of the Season");
    return out;
  };

  return (
    <div className="container-fluid p-3">
      <BackLink fallback={`/history?tid=${tid}`} />

      <div className="d-flex align-items-center gap-2 mb-1 mt-2 flex-wrap">
        <ClubCrest tid={tid} colors={team?.colors ?? ["#888888", "#888888"]} size={32} />
        <h4 className="mb-0">{team?.name ?? `Team ${tid}`}</h4>
        <span className="fs-4 text-muted">{seasonYear(clubSeason.season)}</span>
        {clubSeason.live && !clubSeason.awaitingRollover && (
          <span className="badge text-bg-info">In progress</span>
        )}
        {clubSeason.awaitingRollover && (
          <span className="badge text-bg-secondary" title="The football is done. Promotion, relegation and the awards are settled in the offseason.">
            Season over
          </span>
        )}
        {clubSeason.treble && <span className="badge text-bg-warning">Treble</span>}
      </div>

      <div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
        <div className="text-muted">
          {/*
            A competition's own name already carries its tier ("English Division
            1"), so appending "· Division 1" printed it twice. Player-named and
            imported leagues can be called anything ("Eredivisie"), and those
            genuinely don't say which tier they are, so the suffix is kept for
            exactly those.
          */}
          {comp
            ? comp.name.toLowerCase().includes(`division ${clubSeason.tier}`)
              ? comp.name
              : `${comp.name} · Division ${clubSeason.tier}`
            : `Division ${clubSeason.tier}`}
        </div>
        <select
          className="form-select form-select-sm w-auto"
          value={clubSeason.season}
          onChange={(e) => navigate(`/club/${tid}/${e.target.value}`)}
          aria-label="Season"
        >
          {seasonOptions.map((s) => (
            <option key={s} value={s}>
              {seasonYear(s)}
              {s === league.season ? " (current)" : ""}
            </option>
          ))}
        </select>
        <Link to={`/history?tid=${tid}`} className="small">All-time club history</Link>
      </div>

      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3 col-xl-2">
          <StatCard
            label={clubSeason.live && !clubSeason.awaitingRollover ? "League (so far)" : "League"}
            /* Before a ball is kicked every club is level on nothing, so the
               table's order is arbitrary and calling anyone 1st would be a
               fiction. */
            value={played === 0 ? "—" : clubSeason.position > 0 ? ordinal(clubSeason.position) : "—"}
            sub={
              played === 0
                ? "No matches played yet"
                : `of ${clubSeason.teamsInComp}${clubSeason.champion ? " · Champions" : ""}`
            }
          />
        </div>
        <div className="col-6 col-md-3 col-xl-2">
          <StatCard
            label="Record"
            value={row ? `${row.won}-${row.drawn}-${row.lost}` : "—"}
            sub={row ? `${row.points} pts · ${row.gf}:${row.ga} (${row.gd >= 0 ? "+" : ""}${row.gd})` : undefined}
          />
        </div>
        <div className="col-6 col-md-3 col-xl-2">
          <StatCard
            label="Power ranking"
            value={power ? `#${power.divisionRank}` : "—"}
            sub={
              power
                ? `of ${power.divisionTotal} in the league · #${power.worldRank} of ${power.worldTotal} in the world`
                : "No snapshot for this season"
            }
          />
        </div>
        <div className="col-6 col-md-3 col-xl-2">
          <StatCard
            label="Squad OVR"
            value={rating ? rating.ovr : "—"}
            sub={
              power
                ? `POT ${power.pot} · Power ${power.powerScore.toFixed(1)}`
                : rating ? `POT ${rating.pot}` : undefined
            }
          />
        </div>
        <div className="col-6 col-md-3 col-xl-2">
          <StatCard label="Squad size" value={squad.length} sub={clubSeason.live ? "On the books now" : "Finished the season here"} />
        </div>
        <div className="col-6 col-md-3 col-xl-2">
          <StatCard
            label="Up or down"
            value={
              clubSeason.live
                ? "Not settled"
                : clubSeason.promoted ? "Promoted" : clubSeason.relegated ? "Relegated" : "Stayed up"
            }
            sub={clubSeason.live ? "Decided in the offseason" : "For the following season"}
          />
        </div>
      </div>

      <div className="row g-2 mb-3">
        <div className="col-12 col-md-4">
          <RunCard title="Domestic cup" run={clubSeason.domesticCupRun} to="/domestic-cup" />
        </div>
        {/* A club only ever plays its own continent's competitions, so an
            American club shows the Americas Cup where a European one shows the
            two European competitions. */}
        {competitionRegion(competitionOf(league.competitions, clubSeason.compId)) === "americas" ? (
          <div className="col-12 col-md-4">
            <RunCard title="Americas Cup" run={clubSeason.americasRun} to="/americas-cup" note="Didn't qualify" />
          </div>
        ) : (
          <>
            <div className="col-12 col-md-4">
              <RunCard title="Continental Cup" run={clubSeason.cupRun} to="/cup" note="Didn't qualify" />
            </div>
            <div className="col-12 col-md-4">
              <RunCard title="Continental Shield" run={clubSeason.shieldRun} to="/shield" note="Didn't qualify" />
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-body">
          <h6 className="card-title d-flex align-items-center gap-2">
            Squad
            <span className="badge text-bg-secondary">{squad.length}</span>
          </h6>
          {squad.length === 0 ? (
            <p className="text-muted mb-0">No squad on record for this season.</p>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table table-striped table-sm mb-0">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Name</th>
                      <th className="text-end">Age</th>
                      <th className="text-end">OVR</th>
                      <th className="text-end">Apps</th>
                      <th className="text-end">Min</th>
                      <th className="text-end">G</th>
                      <th className="text-end">A</th>
                      <th className="text-end">Rtg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {squad.map((p) => {
                      const honours = honourPids.has(p.pid) ? honourLabels(p.pid) : [];
                      return (
                        <tr key={p.pid}>
                          {/* His plain listed position, not PositionBadge: the secondary
                              positions that badge shows are derived from a player's
                              ratings *today*, which says nothing about where he was
                              playing in a season years ago. */}
                          <td>{p.pos}</td>
                          <td>
                            <Flag nationality={p.nationality} tip={false} />{" "}
                            <Link to={`/player/${p.pid}`}>{p.name}</Link>
                            {honours.length > 0 && (
                              <span
                                className="badge text-bg-warning ms-1"
                                title={honours.join(" · ")}
                              >
                                {honours.length === 1 ? honours[0] : `${honours.length} honours`}
                              </span>
                            )}
                          </td>
                          <td className="text-end">{p.age}</td>
                          <td className="text-end">{p.ovr}</td>
                          <td className="text-end">{p.appearances}</td>
                          <td className="text-end">{p.stats ? p.stats.minutesPlayed : "—"}</td>
                          <td className="text-end">{p.stats ? p.stats.goals : "—"}</td>
                          <td className="text-end">{p.stats ? p.stats.assists : "—"}</td>
                          <td className="text-end">
                            {p.stats && p.stats.appearances > 0 ? p.stats.avgRating.toFixed(2) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-muted small mb-0 mt-2">
                {clubSeason.live ? (
                  clubSeason.awaitingRollover
                    ? <>This is the squad that finished the season, before the offseason moves anyone on.</>
                    : <>This is the squad as it stands right now, mid-season.</>
                ) : (
                  <>
                    This is who finished the season here, so a winter signing shows up at his new
                    club only. Ratings are what each player carried through that season.
                    {clubSeason.fromArchiveCount > 0 && (
                      <>
                        {" "}
                        {clubSeason.fromArchiveCount} of them have retired since, so their
                        goals and assists that year are no longer on record.
                      </>
                    )}{" "}
                    Players who retired a long time ago may be missing entirely, because the game
                    only keeps a career record for the ones worth remembering.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
