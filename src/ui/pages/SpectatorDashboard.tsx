/**
 * The Dashboard for a save nobody manages.
 *
 * Its own page rather than a branch through `Dashboard.tsx`, because that page
 * is built around a `userTeam` that does not exist here: its table position,
 * next fixture, injury list, board meter, wage bill, scouting slider and squad
 * stat leaders are all readings of one club. Threading a null through them
 * would leave a dashboard that is mostly empty cards apologising for
 * themselves, and would put a conditional in front of every derivation on the
 * hottest page in the game.
 *
 * What survives is the part that was never about your club: the controls that
 * move time forward, and the world they move. So this page is the sim controls
 * plus a league table you choose, the matchday that table came from, and the
 * competitions the world is playing for, leaning on the existing pages for the
 * rest rather than rebuilding them.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { useOffseasonAdvance } from "../useOffseasonAdvance.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { ClubLink } from "../components/ClubLink.js";
import { computeStandings } from "../../core/standings.js";
import { nextMatchday } from "../../core/transfers/window.js";
import { SimTargetForm } from "../components/SimTargetForm.js";
import { isIntlStagePending } from "../../core/international/index.js";
import {
  intlStageButton,
  intlStageHeadline,
  intlStageLink,
  intlStageSkipLabel,
  intlStageThroughLabel,
  type PlayableStage,
} from "../intlStageLabels.js";
import { seasonYear } from "../format.js";
import { qualifyingLeg } from "../../core/constants.js";
import {
  PowerRankingPanel, CupBracketPanel, InternationalBracketPanel, MatchdayPanel,
} from "./worldPanels.js";
import { pointsDeductionMap } from "../../core/finance/debt.js";

/** How many standings rows the table snippet shows before pointing at /standings. */
const STANDINGS_TOP_N = 8;

export function SpectatorDashboard({ league }: { league: LeagueStore }) {
  const { simAction, intlStageAction, simming } = useLeague();
  const advanceOffseason = useOffseasonAdvance();

  // Which league's table to show. A view, not save state — a spectator has no
  // home division, so this is simply the last one they looked at.
  const [compId, setCompId] = useState<number>(() => league.competitions[0]?.id ?? 0);
  const competition =
    league.competitions.find((c) => c.id === compId) ?? league.competitions[0];

  const standings = useMemo(() => {
    if (!competition) return [];
    const divisionTids = league.teams
      .filter((t) => t.compId === competition.id)
      .map((t) => t.tid);
    const tidSet = new Set(divisionTids);
    return computeStandings(
      divisionTids,
      league.played.filter((m) => tidSet.has(m.home)),
      pointsDeductionMap(league.debtSanctions, league.season),
    );
  }, [league.teams, league.played, competition, league.debtSanctions, league.season]);

  const nextMd = nextMatchday(league);
  const lastMd = league.schedule.length > 0
    ? Math.max(...league.schedule.map((g) => g.matchday))
    : null;
  const stage = league.international.stage as PlayableStage;

  return (
    <div className="container-fluid p-3">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <h4 className="mb-0">{league.meta.name}</h4>
          <div className="text-muted small">
            {seasonYear(league.season)} ·{" "}
            {league.phase === "offseason"
              ? "Offseason"
              : nextMd !== null
                ? `Matchday ${nextMd}`
                : "Season complete"}{" "}
            · {league.teams.length} clubs across {league.competitions.length} divisions
          </div>
        </div>
        <span className="badge bg-secondary align-self-start">Spectating</span>
      </div>

      {/* Sim controls. Same phase-aware shape as the managed Dashboard's card,
          minus the two things that need a club: the live viewer (there is no
          match of yours to watch) and the sacked-manager gate (a spectator has
          no board and no stint, so it can never fire). */}
      <div className="card mb-3">
        {/* In season the body is a two-column grid so the sim-target hint can
            sit on the heading's line and over the select at once; the offseason
            branch is ordinary prose and buttons, so it stays in normal flow. */}
        <div className={`card-body${league.phase === "offseason" ? "" : " sim-grid"}`}>
          <h5 className="card-title sim-grid-title">Simulation</h5>
          {league.phase === "offseason" ? (
            isIntlStagePending(league.international) ? (
              <>
                <p className="card-text">
                  {intlStageHeadline(
                    stage,
                    qualifyingLeg(league.season) + 1,
                    league.international.confederationCups,
                    league.international.tournament,
                  )}{" "}
                  Follow it on the{" "}
                  <Link to={intlStageLink(stage)}>National Teams</Link> pages. You'll advance to{" "}
                  {seasonYear(league.season + 1)} once it wraps up, or you can skip it and go
                  straight to the offseason.
                </p>
                <div className="d-flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={simming}
                    onClick={() => intlStageAction("stage")}
                  >
                    {intlStageButton(
                      stage,
                      qualifyingLeg(league.season) + 1,
                      league.international.confederationCups,
                      league.international.tournament,
                    )}
                  </button>
                  {league.international.stage !== "qualifying" && (
                    <button
                      className="btn btn-outline-primary"
                      disabled={simming}
                      onClick={() => intlStageAction("through")}
                    >
                      {intlStageThroughLabel(stage)}
                    </button>
                  )}
                  <button
                    className="btn btn-outline-secondary"
                    disabled={simming}
                    onClick={advanceOffseason}
                  >
                    {intlStageSkipLabel(stage)}
                  </button>
                </div>
                <p className="card-text text-muted small mt-2 mb-0">
                  Skipping still plays the games out, you just don't watch them. The results will be
                  on the National Teams pages when you get there.
                </p>
              </>
            ) : (
              <>
                <p className="card-text">
                  {seasonYear(league.season)} is complete. Advancing runs player progression,
                  retirements, transfers, free agency and youth intake across every club, and starts{" "}
                  {seasonYear(league.season + 1)}.
                </p>
                <button className="btn btn-success" disabled={simming} onClick={advanceOffseason}>
                  Advance to {seasonYear(league.season + 1)}
                </button>
              </>
            )
          ) : (
            // The buttons take column 1, under the heading; the sim-target form
            // takes column 2, which puts its hint on the heading's line and
            // directly over the select. See `.sim-grid` in styles.css.
            <>
              <div className="sim-grid-buttons d-flex align-items-center gap-2 flex-wrap">
                <button
                  className="btn btn-primary"
                  disabled={simming}
                  onClick={() => simAction("game")}
                >
                  Sim One Matchday
                </button>
                <button
                  className="btn btn-primary"
                  disabled={simming}
                  onClick={() => simAction("season")}
                >
                  Sim to End of Season
                </button>
              </div>
              {nextMd !== null && lastMd !== null && (
                <SimTargetForm
                  current={nextMd}
                  last={lastMd}
                  disabled={simming}
                  onSim={(matchday) => simAction({ matchday })}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/*
        The summer's international football, and only in the offseasons that
        have some — a World Cup or the confederation championships, alternating
        years. It sits above the club panels because during an offseason it is
        the only football being played. Unwrapped, because the panel renders
        nothing at all in the other three offseasons and a wrapper would leave
        an empty spacer behind.
      */}
      <InternationalBracketPanel league={league} />

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                <h5 className="card-title mb-0">Table</h5>
                <select
                  className="form-select form-select-sm"
                  style={{ width: "auto" }}
                  value={competition?.id ?? ""}
                  aria-label="Competition"
                  onChange={(e) => setCompId(Number(e.target.value))}
                >
                  {league.competitions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {standings.length === 0 ? (
                <p className="text-muted mb-0">No games played yet.</p>
              ) : (
                <table className="table table-sm mb-2">
                  <thead>
                    <tr>
                      <th></th><th>Club</th><th className="text-end">P</th>
                      <th className="text-end">GD</th><th className="text-end">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.slice(0, STANDINGS_TOP_N).map((r, i) => (
                      <tr key={r.tid}>
                        <td className="text-muted">{i + 1}</td>
                        <td><ClubLink tid={r.tid} crest /></td>
                        <td className="text-end">{r.played}</td>
                        <td className="text-end">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                        <td className="text-end fw-semibold">{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link to="/standings" className="btn btn-sm btn-outline-secondary">
                Full standings
              </Link>
            </div>
          </div>
        </div>

        {/*
          The games themselves, for the competition the picker above selects —
          one dropdown governs the whole row, so the table and the matchday it
          came from are always the same league. The panel names that league
          itself so the pairing can't be read as a coincidence.
        */}
        <div className="col-lg-6">
          <MatchdayPanel league={league} compId={competition?.id ?? 0} />
        </div>
      </div>

      {/* The world's clubs measured against each other, and the two continental
          competitions they're measured in. */}
      <div className="row g-3 mt-0">
        <div className="col-lg-4">
          <PowerRankingPanel league={league} />
        </div>
        <div className="col-lg-4">
          <CupBracketPanel cup={league.cup} title="Continental Cup" href="/cup" />
        </div>
        <div className="col-lg-4">
          <CupBracketPanel cup={league.shield} title="Continental Shield" href="/shield" />
        </div>
      </div>
    </div>
  );
}
