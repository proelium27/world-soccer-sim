import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { seasonYear, ordinal } from "../format.js";
import { confidenceMood, confidenceLabel } from "../../core/manager/confidence.js";
import { managerReputation } from "../../core/manager/jobOffers.js";
import { cachedExpectations } from "../../core/manager/expectation.js";
import { ExpectationPanel, LastSeasonPanel } from "./managerPanels.js";
import { JobInterestsPanel } from "./JobInterestsPanel.js";
import { difficultyProfile } from "../../core/constants.js";
import type { JobOffer, ManagerStint } from "../../core/manager/types.js";

const MOOD_CLASS: Record<string, string> = {
  secure: "bg-success",
  settled: "bg-info",
  uneasy: "bg-warning",
  danger: "bg-danger",
};

/**
 * Your managerial career: how safe the job is, who's been in touch, and where
 * you've been.
 *
 * Doubles as the gate a sacked manager has to pass through — there is no
 * unemployed state, so when `manager.sacked` is set the offer list is the only
 * way the save moves forward and the page says so plainly.
 */
export function Manager() {
  const {
    league, acceptJobOfferAction, declineJobOffersAction, setSackingEnabledAction, simming,
    setClubInterestAction, setNationInterestAction,
  } = useLeague();
  const navigate = useNavigate();

  const reputation = useMemo(
    () => (league ? managerReputation(league.manager.stints) : 0),
    [league],
  );

  // The world-wide pass costs ~22ms, so it is memoized on the league object the
  // context hands out fresh per commit, not recomputed per render.
  const expectation = useMemo(
    () => (league
      ? cachedExpectations(league).get(league.meta.userTid) ?? null
      : null),
    [league],
  );

  if (!league) return <p className="p-3">Loading...</p>;

  const { manager } = league;
  const club = league.teams.find((t) => t.tid === league.meta.userTid);
  const mood = confidenceMood(manager.confidence, manager.sackingEnabled);
  const stints = [...manager.stints].reverse();
  const patience = difficultyProfile(league.difficulty).boardPatience;

  const clubName = (tid: number): string =>
    league.teams.find((t) => t.tid === tid)?.name ?? `Club ${tid}`;
  const compName = (compId: number): string =>
    league.competitions.find((c) => c.id === compId)?.name ?? "Unknown league";

  const offerRow = (offer: JobOffer) => (
    <div className="card mb-2" key={offer.tid}>
      <div className="card-body d-flex align-items-center gap-3">
        <ClubCrest
          tid={offer.tid}
          colors={league.teams.find((t) => t.tid === offer.tid)?.colors ?? ["#888", "#fff"]}
          size={32}
        />
        <div className="flex-grow-1">
          <div className="fw-semibold">
            {clubName(offer.tid)}
            {manager.interests?.includes(offer.tid) && (
              <span className="badge bg-primary ms-2">You asked about them</span>
            )}
          </div>
          <div className="text-muted small">
            {compName(offer.compId)}
            {offer.moving === "promoted" && (
              <span className="badge bg-success ms-2">Just promoted</span>
            )}
            {offer.moving === "relegated" && (
              <span className="badge bg-warning text-dark ms-2">Just relegated</span>
            )}
          </div>
          <div className="text-muted small">
            Their board would expect {ordinal(offer.expectedRank)} of {offer.clubs}
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled={simming}
          onClick={async () => {
            await acceptJobOfferAction(offer.tid);
            navigate("/roster");
          }}
        >
          Take the job
        </button>
      </div>
    </div>
  );

  const stintRow = (stint: ManagerStint, index: number) => (
    <tr key={`${stint.tid}-${stint.startSeason}-${index}`}>
      <td>
        <ClubCrest
          tid={stint.tid}
          colors={league.teams.find((t) => t.tid === stint.tid)?.colors ?? ["#888", "#fff"]}
          size={18}
          className="me-2"
        />
        {clubName(stint.tid)}
      </td>
      <td>
        {seasonYear(stint.startSeason)}
        {stint.endSeason === null ? " – now" : ` – ${seasonYear(stint.endSeason)}`}
      </td>
      <td className="text-end">{stint.seasons}</td>
      <td className="text-end">{stint.titles}</td>
      <td className="text-end">{stint.trophies}</td>
      <td>
        {stint.ending === "sacked" ? (
          <span className="badge bg-danger">Sacked</span>
        ) : stint.ending === "left" ? (
          <span className="text-muted">Left</span>
        ) : (
          <span className="badge bg-primary">Current</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="container-fluid p-3" style={{ maxWidth: 900 }}>
      <h4>Manager</h4>

      {manager.sacked && (
        <div className="alert alert-danger">
          <div className="fw-semibold mb-1">
            {club ? `${club.name} have let you go.` : "You've been let go."}
          </div>
          <div>
            Pick one of the clubs below to carry on. You can't sit this one out, so
            take the best job you can get and start rebuilding.
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-baseline mb-2">
            <span className="fw-semibold">
              {club ? `How ${club.name} feel about you` : "Board confidence"}
            </span>
            <span className="text-muted small">{confidenceLabel(mood)}</span>
          </div>
          <div className="progress" style={{ height: 10 }}>
            <div
              className={`progress-bar ${MOOD_CLASS[mood] ?? "bg-secondary"}`}
              style={{ width: `${Math.round(manager.confidence)}%` }}
            />
          </div>
          <div className="text-muted small mt-2">
            {manager.sackingEnabled
              ? "The board judges you on where you finish against what your squad is worth. Beat that and you bank goodwill; fall short often enough and you're out."
              : "Sackings are switched off for this save, so the job is yours for as long as you want it."}
          </div>

          <hr />

          <div className="row g-3">
            <div className="col-sm-4">
              <div className="text-muted small">Reputation</div>
              <div className="fs-5">{Math.round(reputation)}</div>
            </div>
            <div className="col-sm-4">
              <div className="text-muted small">Board patience</div>
              <div className="fs-5">{difficultyProfile(league.difficulty).label}</div>
              <div className="text-muted small">
                {patience > 1 ? "Forgiving" : patience < 1 ? "Impatient" : "Standard"}
              </div>
            </div>
            <div className="col-sm-4">
              <div className="form-check form-switch mt-3">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="sacking-toggle"
                  checked={!manager.sackingEnabled}
                  disabled={simming}
                  onChange={(e) => setSackingEnabledAction(!e.target.checked)}
                />
                <label className="form-check-label" htmlFor="sacking-toggle">
                  Never sack me
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ExpectationPanel
        expectation={expectation}
        competitionName={expectation ? compName(expectation.compId) : ""}
      />

      {manager.lastVerdict && <LastSeasonPanel verdict={manager.lastVerdict} />}

      <h5>
        {manager.sacked ? "Clubs willing to take you on" : "Clubs who want you"}
      </h5>
      {manager.offers.length === 0 ? (
        <p className="text-muted">
          Nobody's come calling. Beat what your squad is worth and that changes fast.
        </p>
      ) : (
        <>
          {manager.offers.map(offerRow)}
          {!manager.sacked && (
            <button
              className="btn btn-outline-secondary btn-sm mb-3"
              disabled={simming}
              onClick={() => declineJobOffersAction()}
            >
              Turn them all down
            </button>
          )}
          {!manager.sacked && (
            <p className="text-muted small">
              Taking a new job hands your current squad straight to the AI, and your
              youth academy graduates on the way out. You'll also be starting from
              scratch on scouting the players you inherit.
            </p>
          )}
        </>
      )}

      <JobInterestsPanel
        league={league}
        simming={simming}
        onClub={(tid, on) => { void setClubInterestAction(tid, on); }}
        onNation={(nation, on) => { void setNationInterestAction(nation, on); }}
      />

      <h5 className="mt-4">Career</h5>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Club</th>
              <th>Seasons</th>
              <th className="text-end">Played</th>
              <th className="text-end">Titles</th>
              <th className="text-end">Cups</th>
              <th>How it ended</th>
            </tr>
          </thead>
          <tbody>{stints.map(stintRow)}</tbody>
        </table>
      </div>
    </div>
  );
}
