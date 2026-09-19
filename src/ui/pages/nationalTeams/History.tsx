import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../../context/LeagueContext.js";
import { seasonYear } from "../../format.js";
import { nationRecords } from "../../../core/international/index.js";
import { INTL_CYCLE_YEARS, INTL_TOURNAMENT_NAME } from "../../../core/constants.js";
import { EmptyState } from "../../components/EmptyState.js";
import { NationalTeamsLayout, NationName, useHasInternational, IntlEmpty } from "./shared.js";

export function NTHistory() {
  const { league } = useLeague();
  const hasIntl = useHasInternational();
  const history = league?.international.history ?? [];
  const records = useMemo(() => nationRecords(history), [history]);

  if (!hasIntl || !league) return <IntlEmpty />;

  if (history.length === 0) {
    return (
      <NationalTeamsLayout title="History">
        <EmptyState headline="No tournament has been completed yet.">
          <p>
            The {INTL_TOURNAMENT_NAME} is played every {INTL_CYCLE_YEARS} seasons, so the first one
            finishes in the offseason after season {INTL_CYCLE_YEARS}. Until then there is nothing
            to put on the roll of honour.
          </p>
          <p>
            Qualifying for it is already under way, though. The standings are on the{" "}
            <Link to="/national-teams/qualifying">Qualifying</Link> page.
          </p>
        </EmptyState>
      </NationalTeamsLayout>
    );
  }

  return (
    <NationalTeamsLayout title="History">
      <h6>Roll of honour</h6>
      <table className="table table-sm mb-4">
        <thead>
          <tr>
            <th>Season</th>
            <th>Winners</th>
            <th>Runners-up</th>
            <th>Final</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((h) => (
            <tr key={h.season}>
              <td>{seasonYear(h.season)}</td>
              <td className="fw-bold"><NationName nation={h.champion} /></td>
              <td><NationName nation={h.runnerUp} /></td>
              <td>
                {h.finalScore.champion}-{h.finalScore.runnerUp}
                {h.finalScore.pens && (
                  <span className="text-muted">
                    {" "}({h.finalScore.pens.champion}-{h.finalScore.pens.runnerUp} pens)
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h6>By nation</h6>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Nation</th>
            <th className="text-end">Titles</th>
            <th className="text-end">Finals</th>
            <th className="text-end">Semis</th>
            <th className="text-end">Played</th>
            <th>Best finish</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.nation}>
              <td><NationName nation={r.nation} /></td>
              <td className="text-end fw-bold">{r.titles || ""}</td>
              <td className="text-end">{r.finals || ""}</td>
              <td className="text-end">{r.semis || ""}</td>
              <td className="text-end">{r.tournaments}</td>
              <td>{r.bestFinish}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </NationalTeamsLayout>
  );
}
