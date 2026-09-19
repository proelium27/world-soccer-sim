import { ordinal, seasonYear } from "../format.js";
import { demandLabel, type ClubExpectation } from "../../core/manager/expectation.js";
import type { ManagerVerdictRecord } from "../../core/manager/types.js";

/**
 * The two panels that explain the confidence bar rather than just showing it:
 * what the board is measuring you against, and what the last season did to you.
 *
 * Kept out of Manager.tsx only to stop that page sprawling; they are pure
 * presentation and take everything they need as props.
 */
export function ExpectationPanel({
  expectation,
  competitionName,
}: {
  expectation: ClubExpectation | null;
  competitionName: string;
}) {
  return (
    <div className="card mb-4">
      <div className="card-body">
        <h6 className="card-title">What the board expects</h6>
        {expectation === null ? (
          <p className="text-muted mb-0">No expectation set yet.</p>
        ) : (
          <>
            {expectation.playoffGoal ? (
              <p className="mb-2">
                {competitionName} crowns its champion in a playoff, so they judge you on
                the playoffs, not the table. They want you to{" "}
                <strong>{expectation.playoffGoal}</strong>.
              </p>
            ) : (
              <p className="mb-2">
                They expect a club like yours to finish around{" "}
                <strong>{ordinal(expectation.expectedRank)}</strong> of {expectation.clubs} in{" "}
                {competitionName}.
                {expectation.playoffLeague && " Getting into the playoffs is still the least they ask."}
              </p>
            )}
            <p className="text-muted small mb-2">
              That comes from where you've recently finished and how well known the club is.
              It deliberately doesn't come from your squad or your bank balance, so nothing you
              do in the transfer market can lower the bar you're measured against.
            </p>
            {expectation.historyCoverage < 1 && (
              <p className="text-muted small mb-2">
                This save hasn't recorded enough seasons yet for results alone to set it, so
                for now it's still partly based on the squad here.
              </p>
            )}
            <div className="text-muted small">
              This board is <strong>{demandLabel(expectation.demand)}</strong>.{" "}
              {expectation.demand >= 0.5
                ? "They'll give you less credit for a good season than a smaller club would, and take a bad one harder."
                : "They'll take a bad season more calmly than a bigger club would."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LastSeasonPanel({ verdict }: { verdict: ManagerVerdictRecord }) {
  const finishNote =
    verdict.overperformance > 0.01 ? "Better than they were expecting"
      : verdict.overperformance < -0.01 ? "Short of what they were expecting"
        : "About where they expected";

  return (
    <div className="card mb-4">
      <div className="card-body">
        <h6 className="card-title">How {seasonYear(verdict.season)} went down</h6>
        <p className="mb-2">
          {verdict.playoff ? (
            <>
              You finished <strong>{ordinal(verdict.finish)}</strong> and{" "}
              <strong>{verdict.playoff.result}</strong>
              {verdict.playoff.goal
                ? <>; they wanted you to <strong>{verdict.playoff.goal}</strong>.</>
                : <>; they'd have settled for <strong>{ordinal(verdict.expectedRank)}</strong>.</>}
            </>
          ) : (
            <>
              You finished <strong>{ordinal(verdict.finish)}</strong>; they'd have settled for{" "}
              <strong>{ordinal(verdict.expectedRank)}</strong>.
            </>
          )}{" "}
          Confidence went{" "}
          {Math.round(verdict.previousConfidence)} →{" "}
          <strong>{Math.round(verdict.confidence)}</strong>.
        </p>
        <ul className="mb-0 small text-muted">
          <li>{finishNote}</li>
          {verdict.titles > 0 && <li>You won the league</li>}
          {verdict.playoff?.missed && <li>Missed the playoffs</li>}
          {verdict.trophies > 0 && (
            <li>{verdict.trophies} cup{verdict.trophies === 1 ? "" : "s"} won</li>
          )}
          {verdict.promoted && <li>Promoted</li>}
          {verdict.relegated && <li>Relegated</li>}
        </ul>
      </div>
    </div>
  );
}
