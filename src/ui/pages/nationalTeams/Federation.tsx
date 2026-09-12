import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLeague } from "../../context/LeagueContext.js";
import { seasonYear, ordinal } from "../../format.js";
import { confidenceMood, confidenceLabel } from "../../../core/manager/confidence.js";
import {
  nationalReputation, nationExpectations, currentNationalStint,
  type NationOffer, type NationalStint, type NationalVerdictRecord,
} from "../../../core/nationalManager/index.js";
import { difficultyProfile } from "../../../core/constants.js";
import { NationalTeamsLayout, NationName } from "./shared.js";

const MOOD_CLASS: Record<string, string> = {
  secure: "bg-success",
  settled: "bg-info",
  uneasy: "bg-warning",
  danger: "bg-danger",
};

/** One decimal, except when the placement is a whole number (champions, runners-up). */
const placementLabel = (n: number): string =>
  (Number.isInteger(n) ? `${ordinal(n)}` : `${n.toFixed(1)}th`);

/**
 * What the federation made of the last campaign, in the same "here is the
 * arithmetic" spirit as the club board's panel: a verdict the user can't
 * interrogate is the "the sacking came out of nowhere" feeling a visible meter
 * exists to prevent.
 */
function LastCampaignPanel({ verdict }: { verdict: NationalVerdictRecord }) {
  const moved = verdict.confidence - verdict.previousConfidence;
  return (
    <div className="card mb-4">
      <div className="card-body">
        <h6 className="card-title">
          {verdict.competition}, {seasonYear(verdict.season)}
        </h6>
        <div className="row g-3">
          <div className="col-sm-3">
            <div className="text-muted small">Seeded</div>
            <div className="fs-6">
              {ordinal(verdict.expectedRank)} of {verdict.nations}
            </div>
          </div>
          <div className="col-sm-3">
            <div className="text-muted small">
              {verdict.kind === "qualifying" ? "Outcome" : "Finished"}
            </div>
            <div className="fs-6">
              {verdict.qualified === true
                ? "Qualified"
                : verdict.qualified === false
                  ? "Missed out"
                  : placementLabel(verdict.placement)}
            </div>
          </div>
          <div className="col-sm-3">
            <div className="text-muted small">Won</div>
            <div className="fs-6">
              {verdict.titles > 0
                ? "The World Cup"
                : verdict.continentalTitles > 0
                  ? "The championship"
                  : "Nothing"}
            </div>
          </div>
          <div className="col-sm-3">
            <div className="text-muted small">Confidence</div>
            <div className={`fs-6 ${moved >= 0 ? "text-success" : "text-danger"}`}>
              {Math.round(verdict.previousConfidence)} &rarr; {Math.round(verdict.confidence)}
            </div>
          </div>
        </div>
        <p className="text-muted small mb-0 mt-3">
          {verdict.overperformance > 0.02
            ? "Better than the players you had any right to expect. That buys you time."
            : verdict.overperformance < -0.02
              ? "Short of what this squad should manage, and they noticed."
              : "About what was expected of this group."}
        </p>
      </div>
    </div>
  );
}

/**
 * Your international career: which country you run, how they rate you, who else
 * has been in touch, and where you've been.
 *
 * Deliberately the same page shape as `/manager`, because it is the same
 * relationship from a different chair. The one thing that reads differently is
 * that having no country here is a perfectly ordinary state, so the empty case
 * is an invitation rather than a problem to be solved.
 */
export function NTFederation() {
  const {
    league, takeNationalJobAction, leaveNationalJobAction, declineNationalOffersAction,
    setNationalSackingEnabledAction, simming,
  } = useLeague();
  const navigate = useNavigate();

  // Ranks every eligible nation in the world; memoized on the league object the
  // context hands out fresh per commit rather than recomputed per render.
  const expectations = useMemo(
    () => nationExpectations(
      league?.international.powerRankings[league.international.powerRankings.length - 1],
    ),
    [league],
  );

  if (!league) return <p className="p-3">Loading...</p>;

  const state = league.nationalManager;
  const nation = state.nation;
  const reputation = nationalReputation(state.stints);
  const mood = confidenceMood(state.confidence, state.sackingEnabled);
  const stints = [...state.stints].reverse();
  const mine = nation ? expectations.get(nation) : undefined;
  const stint = currentNationalStint(state);
  const patience = difficultyProfile(league.difficulty).boardPatience;

  const offerRow = (offer: NationOffer) => (
    <div className="card mb-2" key={offer.nation}>
      <div className="card-body d-flex align-items-center gap-3">
        <div className="flex-grow-1">
          <div className="fw-semibold">
            <NationName nation={offer.nation} />
            {state.interests?.includes(offer.nation) && (
              <span className="badge bg-primary ms-2">You asked about them</span>
            )}
          </div>
          <div className="text-muted small">{offer.confederation || "Unaffiliated"}</div>
          <div className="text-muted small">
            {ordinal(offer.rank)} of {offer.nations} nations by the players available to them
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled={simming}
          onClick={async () => {
            await takeNationalJobAction(offer.nation);
            navigate("/national-teams/my-squad");
          }}
        >
          Take the job
        </button>
      </div>
    </div>
  );

  const stintRow = (s: NationalStint, index: number) => (
    <tr key={`${s.nation}-${s.startSeason}-${index}`}>
      <td><NationName nation={s.nation} /></td>
      <td>
        {seasonYear(s.startSeason)}
        {s.endSeason === null ? " – now" : ` – ${seasonYear(s.endSeason)}`}
      </td>
      <td className="text-end">{s.campaigns}</td>
      <td className="text-end">{s.qualifications}</td>
      <td className="text-end">{s.continentalTitles}</td>
      <td className="text-end">{s.titles}</td>
      <td>
        {s.ending === "sacked" ? (
          <span className="badge bg-danger">Sacked</span>
        ) : s.ending === "left" ? (
          <span className="text-muted">Left</span>
        ) : (
          <span className="badge bg-primary">Current</span>
        )}
      </td>
    </tr>
  );

  return (
    <NationalTeamsLayout title="Federation">
      {state.sacked && !nation && (
        <div className="alert alert-danger">
          <div className="fw-semibold mb-1">
            {state.lastVerdict
              ? <>The {state.lastVerdict.nation} federation have let you go.</>
              : "Your federation have let you go."}
          </div>
          <div>
            You're back to club football only. Take another country below if one comes
            in, or leave it. Plenty of managers never take an international job.
          </div>
        </div>
      )}

      {nation ? (
        <div className="card mb-4">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-baseline mb-2">
              <span className="fw-semibold">
                How <NationName nation={nation} /> feel about you
              </span>
              <span className="text-muted small">{confidenceLabel(mood)}</span>
            </div>
            <div className="progress" style={{ height: 10 }}>
              <div
                className={`progress-bar ${MOOD_CLASS[mood] ?? "bg-secondary"}`}
                style={{ width: `${Math.round(state.confidence)}%` }}
              />
            </div>
            <div className="text-muted small mt-2">
              {state.sackingEnabled
                ? "You're judged once per campaign, on how far you get against how good your players are. You can't sign anyone, so the bar only moves when the talent does."
                : "Sackings are switched off for this save, so the job is yours for as long as you want it."}
            </div>

            <hr />

            <div className="row g-3">
              <div className="col-sm-3">
                <div className="text-muted small">World ranking</div>
                <div className="fs-5">
                  {mine ? `${ordinal(mine.rank)} of ${mine.nations}` : "Unranked"}
                </div>
                {mine && <div className="text-muted small">{mine.confederation}</div>}
              </div>
              <div className="col-sm-3">
                <div className="text-muted small">Reputation</div>
                <div className="fs-5">{Math.round(reputation)}</div>
              </div>
              <div className="col-sm-3">
                <div className="text-muted small">Campaigns here</div>
                <div className="fs-5">{stint?.campaigns ?? 0}</div>
                <div className="text-muted small">
                  {difficultyProfile(league.difficulty).label}
                  {patience > 1 ? " · forgiving" : patience < 1 ? " · impatient" : ""}
                </div>
              </div>
              <div className="col-sm-3">
                <div className="form-check form-switch mt-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="national-sacking-toggle"
                    checked={!state.sackingEnabled}
                    disabled={simming}
                    onChange={(e) => setNationalSackingEnabledAction(!e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="national-sacking-toggle">
                    Never sack me
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card mb-4">
          <div className="card-body">
            <h6 className="card-title">You don't manage a country</h6>
            <p className="card-text text-muted mb-0">
              That's a perfectly normal way to play, and most managers only ever run a club.
              If you want one, federations get in touch over the summer, and the better
              you do the better the country. Anything on the table shows up below.
            </p>
          </div>
        </div>
      )}

      {state.lastVerdict && <LastCampaignPanel verdict={state.lastVerdict} />}

      <h5>{nation ? "Countries who want you" : "Countries willing to take you on"}</h5>
      <p className="text-muted small">
        Got a country in mind? Pick it under Jobs you'd like on the{" "}
        <Link to="/manager">Manager</Link> page and it gets its own chance to call each summer.
      </p>
      {state.offers.length === 0 ? (
        <p className="text-muted">
          Nobody's been in touch. Federations look around each summer, and a good club
          season or a deep run with a country is what gets you noticed.
        </p>
      ) : (
        <>
          {state.offers.map(offerRow)}
          <button
            className="btn btn-outline-secondary btn-sm mb-3"
            disabled={simming}
            onClick={() => declineNationalOffersAction()}
          >
            Turn them all down
          </button>
          {nation && (
            <p className="text-muted small">
              Taking a new country hands your current one straight back, along with any
              eleven you'd picked. A campaign already under way carries on with whoever
              was called up.
            </p>
          )}
        </>
      )}

      {nation && (
        <div className="mb-4">
          <button
            className="btn btn-outline-danger btn-sm"
            disabled={simming}
            onClick={() => leaveNationalJobAction()}
          >
            Step down as <NationName nation={nation} /> manager
          </button>
        </div>
      )}

      {stints.length > 0 && (
        <>
          <h5 className="mt-4">Career</h5>
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Seasons</th>
                  <th className="text-end">Campaigns</th>
                  <th className="text-end">Qualified</th>
                  <th className="text-end">Continental</th>
                  <th className="text-end">World Cups</th>
                  <th>How it ended</th>
                </tr>
              </thead>
              <tbody>{stints.map(stintRow)}</tbody>
            </table>
          </div>
        </>
      )}
    </NationalTeamsLayout>
  );
}
