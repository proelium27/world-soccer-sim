import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { SCOUTING_SPEND_MAX } from "../../core/constants.js";
import { currency, seasonYear } from "../format.js";

/**
 * Mandatory offseason checkpoint: before a new season can start, the user has to
 * look at (and confirm) their scouting budget for the coming year. The Dashboard
 * "Advance" button routes here instead of running the offseason directly, so the
 * budget decision can't be skipped season after season.
 *
 * Editing the slider commits to nextScoutingSpend (via setScoutingSpendAction),
 * which only takes hold during the offseason phase — same guard the Dashboard
 * slider uses. "Lock it in" commits once more (in case of a pending drag) and
 * then runs the offseason, which copies nextScoutingSpend into the season's
 * locked scoutingSpend.
 */
export function SetScouting() {
  const { league, setScoutingSpendAction, offseasonAction, simming } = useLeague();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<number | null>(null);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);

  // Only reachable during the offseason phase. If we're not there (e.g. the user
  // typed the URL mid-season), bounce back to the dashboard rather than showing a
  // gate that can't do anything.
  if (league.phase !== "offseason" || !userTeam) {
    return (
      <div className="container-fluid p-3">
        <h4>Set Scouting Budget</h4>
        <p className="text-muted">You can only set your scouting budget during the offseason.</p>
        <button className="btn btn-secondary" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </button>
      </div>
    );
  }

  const value = draft ?? userTeam.nextScoutingSpend;

  const commitDraft = async () => {
    if (draft === null) return;
    await setScoutingSpendAction(draft);
  };

  const lockInAndAdvance = async () => {
    await commitDraft();
    await offseasonAction();
    navigate("/season-preview");
  };

  return (
    <div className="container-fluid p-3" style={{ maxWidth: 720 }}>
      <h4>Set your scouting budget for {seasonYear(league.season + 1)}</h4>
      <p className="text-muted mb-4">
        Before the new season kicks off, decide how much you want to pour into
        scouting. You're locking this in for the whole year, so there's no changing
        it once the games start.
      </p>

      <div className="card mb-4">
        <div className="card-body">
          <p className="mb-2">Here's what your scouting money actually buys you:</p>
          <ul className="mb-0">
            <li>
              Sharper transfer valuations, both on players you're chasing and on
              your own squad, so you're less likely to overpay or get lowballed.
            </li>
            <li>
              Clearer reads on potential. Spend more and a young player's POT shows
              up as an exact number sooner, instead of a wide "somewhere in this
              range" guess.
            </li>
            <li>
              A better youth intake. A scouting network is what finds young players
              in the first place, so what you spend here feeds straight into the
              kids who join your academy next summer.
            </li>
          </ul>
        </div>
      </div>

      <label className="form-label fw-semibold mb-1" htmlFor="scouting-spend">
        Scouting budget: {currency.format(value)}
      </label>
      <input
        id="scouting-spend"
        type="range"
        className="form-range"
        min={0}
        max={SCOUTING_SPEND_MAX}
        step={100_000}
        value={value}
        disabled={simming}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commitDraft}
        onBlur={commitDraft}
      />
      <div className="d-flex justify-content-between text-muted small mb-4">
        <span>{currency.format(0)} (none)</span>
        <span>{currency.format(SCOUTING_SPEND_MAX)} (max)</span>
      </div>

      <p className="text-muted small mb-3">
        Your budget is {currency.format(userTeam.budget)}. Scouting is paid out of
        it, so anything you sink here is money you won't have for transfers.
      </p>

      <button
        className="btn btn-success"
        disabled={simming}
        onClick={lockInAndAdvance}
      >
        Lock it in and start {seasonYear(league.season + 1)}
      </button>
    </div>
  );
}
