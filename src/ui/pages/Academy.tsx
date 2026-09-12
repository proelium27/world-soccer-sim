import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import { ExtendAllButton } from "../components/ExtendAllButton.js";
import { ScoutDirections } from "../components/ScoutDirections.js";
import {
  canExtend, contractTerms, academyContractTerms, academyCheckpointExpiry,
} from "../../core/contracts.js";
import { renewalsDue } from "../../core/contractRenewal.js";
import {
  projectAcademyCheckpoints, type AcademyDecision,
} from "../../core/academyPipeline.js";
import {
  academyFacilitiesBonus, ACADEMY_FACILITIES_MAX,
} from "../../core/players/academyFacilities.js";
import { formatWeeklyWage, seasonYear } from "../format.js";
import { Flag } from "../components/Flag.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { WatchToggle } from "../components/WatchToggle.js";
import { usePotentialView } from "../potentialView.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import {
  ROSTER_CAP, ACADEMY_ROSTER_CAP, USER_ACADEMY_ENTRY_AGE, USER_ACADEMY_INTAKE_MIN,
  USER_ACADEMY_INTAKE_MAX, ACADEMY_SCHOLARSHIP_AGE, ACADEMY_GRADUATION_AGE,
} from "../../core/constants.js";
import { EmptyState } from "../components/EmptyState.js";

type AcademySortKey = "name" | "pos" | "ovr" | "pot" | "age" | "wage" | "next";

/** How the next rollover's default reads in the table, and how loudly. */
const OUTCOME_BADGE: Record<AcademyDecision["outcome"], { label: string; cls: string; title: string }> = {
  promote: {
    label: "Joins the first team",
    cls: "bg-success",
    title: "He's at the professional cut. Unless you release him, he's promoted to your senior squad at the next rollover.",
  },
  release: {
    label: "Leaves",
    cls: "bg-danger",
    title: "He's at the professional cut and your senior squad has no room for him. Promote him now, or make room, or he leaves at the next rollover.",
  },
  keep: {
    label: `Kept to ${ACADEMY_GRADUATION_AGE}`,
    cls: "bg-secondary",
    title: "He's at the scholarship cut and there's room, so he stays on unless you release him.",
  },
  atRisk: {
    label: "Cut if full",
    cls: "bg-warning text-dark",
    title: "He's at the scholarship cut and your scouts rate him among the lowest. If the academy is full after the new intake arrives, he's the one who goes.",
  },
};

/**
 * The user's academy: kids join automatically every offseason, and the
 * decisions come at the scholarship and professional cuts (see
 * core/academyPipeline.ts). Replaces the old Youth Intake trial screen.
 *
 * The "Next rollover" column is `projectAcademyCheckpoints`, the same rules and
 * ranking the offseason applies, so what this page says will happen is what
 * happens unless the user acts first.
 */
export function Academy() {
  const {
    league, promoteFromAcademyAction, extendAcademyContractAction, extendAllContractsAction,
    releaseAcademyPlayerAction,
    simming,
  } = useLeague();
  const { sort, toggle } = useTableSort<AcademySortKey>("age", "desc");
  // Academy players are never in `scoutingObserved` (it is reconciled off the
  // SENIOR roster), so their POT is fogged and the column must sort on the band.
  const potView = usePotentialView();
  // Both walk the whole player pool, so they stay behind a memo rather than
  // re-running on every sort click.
  const renewals = useMemo(
    () => (league ? renewalsDue(league, "academy") : null), [league],
  );
  const decisions = useMemo(() => {
    const team = league?.teams.find((t) => t.tid === league.meta.userTid);
    return league && team
      ? projectAcademyCheckpoints(team, league.players, league.season, league.difficulty)
      : new Map<number, AcademyDecision>();
  }, [league]);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const academyRoster = (userTeam?.academyRoster ?? [])
    .map((pid) => byPid.get(pid))
    .filter((p): p is NonNullable<typeof p> => p != null);
  const outcomeRank: Record<AcademyDecision["outcome"], number> = {
    release: 0, atRisk: 1, promote: 2, keep: 3,
  };
  const academyPlayers = sortRows(academyRoster, sort, {
    name: (p) => p.name,
    pos: (p) => p.pos,
    ovr: (p) => p.ovr,
    pot: (p) => potView.ceiling(p),
    age: (p) => league.season - p.born,
    wage: (p) => p.contract.salary,
    // Decisions first, most urgent at the top, then everyone else by how soon
    // their deal is up.
    next: (p) => {
      const d = decisions.get(p.pid);
      return d ? outcomeRank[d.outcome] : 10 + p.contract.expiresSeason;
    },
  });

  const atRosterCap = (userTeam?.roster.length ?? 0) >= ROSTER_CAP;
  // Wages are paid up front each season, so a mid-season promotion charges
  // the new senior contract's full season salary at promotion time.
  const midSeason = league.phase === "regular";
  const bonus = userTeam ? academyFacilitiesBonus(userTeam) : 0;

  const count = (o: AcademyDecision["outcome"]) =>
    [...decisions.values()].filter((d) => d.outcome === o).length;
  // Older prospects signed out of free agency are on ordinary academy deals,
  // not checkpoints, so they can still quietly run out — same warning as Roster.
  const expiring = academyPlayers.filter(
    (p) => !decisions.has(p.pid) && p.contract.expiresSeason <= league.season,
  );

  return (
    <div className="container-fluid p-3">
      <h4>
        Academy
        <HelpHint>
          Your youth academy. Kids join at {USER_ACADEMY_ENTRY_AGE} every summer and draw a cheap
          flat stipend without counting against your senior roster. You decide who stays at{" "}
          {ACADEMY_SCHOLARSHIP_AGE} and who turns pro at {ACADEMY_GRADUATION_AGE}. Only your club
          has an academy.
        </HelpHint>
      </h4>
      <p className="text-muted" style={{ maxWidth: "48rem" }}>
        Every summer {USER_ACADEMY_INTAKE_MIN} to {USER_ACADEMY_INTAKE_MAX} kids join at{" "}
        {USER_ACADEMY_ENTRY_AGE}. Nobody develops until {ACADEMY_SCHOLARSHIP_AGE}, so you get two
        seasons to watch them first. At {ACADEMY_SCHOLARSHIP_AGE} their first deal is up: they're
        kept on while there's room (up to {ACADEMY_ROSTER_CAP} in the academy), and when there isn't,
        the ones your scouts rate lowest go. At {ACADEMY_GRADUATION_AGE} they join your first team
        if there's space, or leave. Release anyone early, or promote them early, whenever you like.
      </p>
      <p className="text-muted" style={{ maxWidth: "48rem" }}>
        How good each intake is comes down to your academy's standing, how the club's been
        finishing, and two things you control: what you spend on scouting, and how much buzz there
        is around the club. Right now that's worth <strong>+{bonus.toFixed(1)}</strong> of a
        possible +{ACADEMY_FACILITIES_MAX.toFixed(1)}.
      </p>

      <ScoutDirections />

      {atRosterCap && (
        <div className="alert alert-warning">
          Your senior roster is full ({ROSTER_CAP}/{ROSTER_CAP}). Release a player before
          promoting another.
        </div>
      )}
      {decisions.size > 0 && (
        <div className={count("release") + count("atRisk") > 0 ? "alert alert-warning py-2" : "alert alert-info py-2"}>
          <strong>
            {decisions.size} {decisions.size === 1 ? "kid reaches" : "kids reach"} a cut at the next
            rollover.
          </strong>{" "}
          If you leave it: {count("promote")} join the first team, {count("release")} leave,{" "}
          {count("keep")} stay on and {count("atRisk")} could be cut if the academy is full. The
          Next rollover column says who.
        </div>
      )}
      {expiring.length > 0 && (
        <div className="alert alert-warning py-2 px-3 small mb-2 d-flex flex-wrap gap-2 justify-content-between align-items-center">
          <div>
            {expiring.length === 1 ? (
              <><strong>{expiring[0].name}</strong> is in the final year of his academy deal.</>
            ) : (
              <><strong>{expiring.length} prospects</strong> are in the final year of their academy deals.</>
            )}{" "}
            Extend {expiring.length === 1 ? "him" : "them"} before the offseason, or{" "}
            {expiring.length === 1 ? "he'll" : "they'll"} leave on a free with nothing coming back.
          </div>
          <ExtendAllButton
            count={renewals?.pids.length ?? 0}
            totalSalary={renewals?.totalSalary ?? 0}
            disabled={simming}
            onExtendAll={() => { void extendAllContractsAction("academy"); }}
          />
        </div>
      )}
      {academyPlayers.length === 0 ? (
        <EmptyState
          headline="Nobody in the academy yet."
          action={
            <>
              You don&apos;t have to wait, though. Any free agent aged 21 or under on the{" "}
              <Link to="/free-agents">Free Agents</Link> page can be signed straight into the
              academy.
            </>
          }
        >
          <p>
            Your first intake arrives at the end of your next offseason: {USER_ACADEMY_INTAKE_MIN} to{" "}
            {USER_ACADEMY_INTAKE_MAX} kids aged {USER_ACADEMY_ENTRY_AGE}, straight in, no forms to fill.
          </p>
          <p>What the academy is for:</p>
          <ul>
            <li>Kids here draw a cheap flat stipend instead of a real wage.</li>
            <li>
              They don&apos;t count against your {ROSTER_CAP}-man senior roster, so you can bring
              through more of them than you could keep in the first team.
            </li>
            <li>
              The calls come at {ACADEMY_SCHOLARSHIP_AGE} and {ACADEMY_GRADUATION_AGE}, and doing
              nothing is a real choice: the game keeps the kids it can and promotes the ones there&apos;s
              room for.
            </li>
          </ul>
        </EmptyState>
      ) : (
        <table className="table table-striped table-sm">
          <thead>
            <tr>
              <th></th>
              <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
              <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
              <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">OVR</SortableTh>
              <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">POT <PotHelp /></SortableTh>
              <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end">Age</SortableTh>
              <SortableTh sortKey="wage" sort={sort} onSort={toggle} className="text-end">Wage</SortableTh>
              <SortableTh sortKey="next" sort={sort} onSort={toggle} defaultDir="asc">Next rollover</SortableTh>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {academyPlayers.map((p) => {
              const decision = decisions.get(p.pid);
              const badge = decision ? OUTCOME_BADGE[decision.outcome] : null;
              // A kid short of the professional cut has no deal to extend: his
              // runs to his next checkpoint, which only the rollover resolves.
              const extendable =
                canExtend(p, league.season) && academyCheckpointExpiry(p.born, league.season) === null;
              const age = league.season - p.born;
              return (
                <tr key={p.pid}>
                  <td><WatchToggle pid={p.pid} name={p.name} /></td>
                  <td>
                    <PlayerRatingsTooltip player={p}>
                      <Link to={`/player/${p.pid}`}>{p.name}</Link>
                    </PlayerRatingsTooltip>{" "}
                    <Flag nationality={p.nationality} />
                  </td>
                  <td>{p.pos}</td>
                  <td className="text-end">{p.ovr}</td>
                  <td className="text-end"><PotDisplay player={p} /></td>
                  <td className="text-end">{age}</td>
                  <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                  <td>
                    {badge ? (
                      <span className={`badge ${badge.cls}`} title={badge.title}>{badge.label}</span>
                    ) : age < ACADEMY_GRADUATION_AGE ? (
                      <span className="text-muted small">
                        Decision at {age < ACADEMY_SCHOLARSHIP_AGE ? ACADEMY_SCHOLARSHIP_AGE : ACADEMY_GRADUATION_AGE}
                      </span>
                    ) : p.contract.expiresSeason <= league.season ? (
                      <span
                        className="badge bg-warning text-dark"
                        title="His academy deal runs out this season. Extend him before the offseason or he leaves on a free."
                      >
                        Final year
                      </span>
                    ) : (
                      <span className="text-muted small">Deal through {seasonYear(p.contract.expiresSeason)}</span>
                    )}
                  </td>
                  <td className="text-end">
                    <div className="d-inline-flex gap-1">
                      {extendable && (() => {
                        const terms = academyContractTerms(league.season, p.born);
                        return (
                          <button
                            className="btn btn-sm btn-outline-success text-nowrap"
                            disabled={simming}
                            onClick={() => extendAcademyContractAction(p.pid)}
                          >
                            Extend {terms.lengthSeasons}y &middot; {formatWeeklyWage(terms.salary)}
                          </button>
                        );
                      })()}
                      {(() => {
                        const unaffordable =
                          midSeason && contractTerms(p, league.season).salary > (userTeam?.budget ?? 0);
                        return (
                          <button
                            className="btn btn-sm btn-primary text-nowrap"
                            disabled={simming || atRosterCap || unaffordable}
                            title={
                              unaffordable
                                ? "Mid-season promotions charge the season's wages up front"
                                : undefined
                            }
                            onClick={() => promoteFromAcademyAction(p.pid)}
                          >
                            Promote
                          </button>
                        );
                      })()}
                      <button
                        className="btn btn-sm btn-outline-danger"
                        disabled={simming}
                        onClick={() => releaseAcademyPlayerAction(p.pid)}
                      >
                        Release
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
