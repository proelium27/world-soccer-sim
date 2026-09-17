/**
 * Dashboard panels about the world rather than about your club.
 *
 * They live here rather than in the dashboard that renders them for the reason
 * `managerPanels.tsx` exists: a dashboard is a layout, and the things it lays
 * out are worth reading on their own. Nothing in here touches `meta.userTid`,
 * so they are equally at home on a managed dashboard if they are ever wanted
 * there.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { LeagueStore } from "../../core/leagueState.js";
import type { CupState } from "../../core/cup/types.js";
import type { IntlTournament } from "../../core/international/types.js";
import { ClubLink } from "../components/ClubLink.js";
import { MiniBracket, type MiniBracketTie } from "../components/MiniBracket.js";
import { computePowerRankingSnapshot } from "../../core/teams/powerRanking.js";
import { koRoundsOf, cupRoundName, isCupComplete, cupSplitPlan, hasOpeningStage } from "../../core/cup/cup.js";
import { leaguePhaseTable } from "../../core/cup/leaguePhase.js";
import { koRoundName, NationName } from "./nationalTeams/shared.js";
import {
  isTournamentSeason, isConfederationCupSeason,
} from "../../core/constants.js";

/** How many clubs the power-ranking panel lists before pointing at the full board. */
const POWER_TOP_N = 10;

function Panel({ title, link, linkLabel, className, children }: {
  title: string;
  link?: string;
  linkLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card h-100${className ? ` ${className}` : ""}`}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline gap-2 mb-2">
          <h5 className="card-title mb-0">{title}</h5>
          {link && <Link to={link} className="small">{linkLabel ?? "More"}</Link>}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The world's best clubs right now, across every division.
 *
 * World-wide rather than per-competition on purpose: the table panel beside
 * this one is already a league you chose, so ranking within a league here would
 * be the same question twice. This is the one place a spectator can see all 24
 * divisions measured against each other.
 */
export function PowerRankingPanel({ league, highlightTid }: {
  league: LeagueStore;
  /**
   * Shade this club's row, the same `.team-highlight` Standings and the full
   * Power Rankings board use. Passed only by the managed dashboard: a spectator
   * has no club to pick out, and shading nothing is the honest reading.
   */
  highlightTid?: number;
}) {
  // Walks every club in the world building team ratings, so it is memoized on
  // the league object (fresh per commit) rather than recomputed per render.
  const rows = useMemo(
    () => computePowerRankingSnapshot(
      league.teams, league.players, league.played, league.season, 0,
    ).rows.slice(0, POWER_TOP_N),
    [league],
  );

  return (
    <Panel title="Power rankings" link="/power-rankings" linkLabel="Full board">
      <table className="table table-sm mb-0">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.tid} className={r.tid === highlightTid ? "team-highlight" : undefined}>
              <td className="text-muted" style={{ width: "1.5rem" }}>{i + 1}</td>
              <td><ClubLink tid={r.tid} crest /></td>
              {/* The power score, not OVR. The board is ordered by power (squad
                  strength blended with form), so an OVR column beside it runs
                  76, 75, 74, 77 and reads as an unsorted list — the full page
                  can show both because it has a header and a help note
                  explaining the difference, and this has room for neither. */}
              <td className="text-end text-muted">{Math.round(r.powerScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/**
 * The clubs still alive in a cup's league phase, with the qualification cut
 * drawn on.
 *
 * How many rows is **derived, not chosen**: everyone who advances, which is
 * `directQF + playoffTeams` from the field's own `cupKnockoutPlan`. A fixed
 * slice was wrong twice over — it left the card two-thirds empty (these sit in
 * a row with the ten-row power board, and `h-100` stretches them all to the
 * tallest), and cutting at an arbitrary line hid the only thing a league-phase
 * table is about, which is who is going through. A smaller competition sends
 * fewer through and this shrinks with it.
 *
 * The zone classes and their colours are the ones `/cup` already uses, so the
 * shading means the same thing in both places.
 */
function LeaguePhaseTop({ table, cup }: {
  table: ReturnType<typeof leaguePhaseTable>;
  cup: CupState;
}) {
  const { directQF, playoffTeams } = cupSplitPlan(cup);
  const advancing = directQF + playoffTeams;
  const opener = cupRoundName(0, koRoundsOf(cup)).toLowerCase();

  return (
    <>
      <div className="text-muted text-uppercase fw-semibold mini-bracket-round">League phase</div>
      <table className="table table-sm mb-1">
        <tbody>
          {table.slice(0, advancing).map((r, i) => (
            <tr key={r.tid} className={i < directQF ? "cup-lp-direct" : "cup-lp-playoff"}>
              <td className="text-muted" style={{ width: "1.5rem" }}>{i + 1}</td>
              <td><ClubLink tid={r.tid} crest /></td>
              <td className="text-end">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small text-muted">
        {directQF > 0 && <>Top {directQF} to the {opener}. </>}
        {playoffTeams > 0 && <>{directQF > 0 ? "Next" : "Top"} {playoffTeams} to a playoff. </>}
        {table.length > advancing && <>{table.length - advancing} others out.</>}
      </div>
    </>
  );
}

/**
 * One matchday of one competition: the fixtures if it hasn't been played, the
 * scores if it has.
 *
 * Which matchday is deliberately not a setting, and it is the **most recently
 * played** one wherever there is one. Results are the payoff of the click in
 * the card above: showing the next fixtures instead means the scorelines never
 * appear anywhere on the page, and a column of "v" says little the table beside
 * it doesn't. Before a ball is kicked there is nothing to report, so it opens
 * on the fixtures, and during an offseason it holds the season's last round
 * (`played` is emptied when the new season starts, not when the old one ends).
 * The heading names the matchday and the league, so which of the two you are
 * looking at is never ambiguous.
 *
 * Full club names rather than the abbreviations the brackets use: a bracket is
 * a wide grid of short cells where the shape carries the meaning, and this is a
 * list of ten lines with room to say who is playing.
 */
export function MatchdayPanel({ league, compId }: { league: LeagueStore; compId: number }) {
  const comp = league.competitions.find((c) => c.id === compId);

  const { matchday, games, played } = useMemo(() => {
    const tids = new Set(
      league.teams.filter((t) => t.compId === compId).map((t) => t.tid),
    );
    // A fixture and a result are both "home v away"; only the score differs, so
    // they are normalized here and the row below draws one shape.
    const done = league.played.filter((m) => tids.has(m.home));
    if (done.length > 0) {
      const md = Math.max(...done.map((m) => m.matchday));
      return { matchday: md, played: true, games: done.filter((m) => m.matchday === md) };
    }
    const upcoming = league.schedule.filter((g) => tids.has(g.home));
    if (upcoming.length === 0) return { matchday: null, played: false, games: [] };
    const md = Math.min(...upcoming.map((g) => g.matchday));
    return {
      matchday: md,
      played: false,
      games: upcoming
        .filter((g) => g.matchday === md)
        .map((g) => ({ home: g.home, away: g.away, homeGoals: 0, awayGoals: 0 })),
    };
  }, [league.schedule, league.played, league.teams, compId]);

  return (
    <div className="card h-100">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline gap-2 mb-2">
          <h5 className="card-title mb-0">
            {matchday === null ? "Matchday" : `Matchday ${matchday}`}
          </h5>
          <span className="text-muted small text-truncate">{comp?.name}</span>
        </div>
        {games.length === 0 ? (
          <p className="text-muted small mb-0">No fixtures.</p>
        ) : (
          <table className="table table-sm mb-0">
            <tbody>
              {games.map((g, i) => (
                <tr key={i}>
                  <td className="text-end"><ClubLink tid={g.home} /></td>
                  <td className="text-center text-nowrap" style={{ width: "3.5rem" }}>
                    {played
                      ? <span className="fw-semibold">{g.homeGoals}-{g.awayGoals}</span>
                      : <span className="text-muted">v</span>}
                  </td>
                  <td><ClubLink tid={g.away} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Turn a cup's played knockout ties into bracket lines, drawn as clubs. */
function cupTies(cup: CupState): MiniBracketTie[] {
  return cup.ties.map((t): MiniBracketTie => ({
    round: t.round,
    home: <ClubLink tid={t.home} variant="abbrev" />,
    away: <ClubLink tid={t.away} variant="abbrev" />,
    homeGoals: t.homeGoals,
    awayGoals: t.awayGoals,
    winner: t.winner === t.home ? "home" : t.winner === t.away ? "away" : null,
    pens: t.wentToPens ? { home: t.homePens, away: t.awayPens } : null,
  }));
}

/**
 * One continental competition: its bracket once the knockout starts, and the
 * league-phase leaders before that.
 *
 * The stage split is what makes this worth a panel at all. A cup spends most of
 * the season in its Swiss league phase, and a bracket card that is empty from
 * August to March is a card nobody looks at twice.
 */
export function CupBracketPanel({ cup, title, href }: {
  cup: CupState | null;
  title: string;
  href: string;
}) {
  if (!cup) {
    return (
      <Panel title={title}>
        <p className="text-muted small mb-0">
          Seeded from last season's tables, so it starts next season.
        </p>
      </Panel>
    );
  }

  const ties = cupTies(cup);
  const champion = isCupComplete(cup) && cup.championTid !== null ? cup.championTid : null;

  // Before the knockout, the story is the league-phase table. `leaguePhaseTable`
  // is derived rather than stored, so this is the same table the cup page draws.
  // A groups-format cup has no single table worth summarising here (the cup
  // page draws each group), and a straight knockout has no opening stage.
  const groups = !!cup.leaguePhase?.groups;
  const lp = ties.length === 0 && cup.leaguePhase && hasOpeningStage(cup) && !groups
    ? leaguePhaseTable(cup.leaguePhase, cup.seeds)
    : null;
  const played = cup.leaguePhase?.matches.filter((m) => m.played).length ?? 0;

  return (
    <Panel title={title} link={href} linkLabel="Full bracket">
      {champion !== null && (
        <p className="small mb-2">
          <ClubLink tid={champion} crest /> <span className="text-muted">win it.</span>
        </p>
      )}
      {groups && ties.length === 0 ? (
        <p className="text-muted small mb-0">
          {played === 0 ? "Drawn. The group stage kicks off shortly." : "The group stage is under way."}
        </p>
      ) : lp ? (
        played === 0 ? (
          <p className="text-muted small mb-0">Drawn. The league phase kicks off shortly.</p>
        ) : (
          <LeaguePhaseTop table={lp} cup={cup} />
        )
      ) : (
        <MiniBracket
          ties={ties}
          totalRounds={koRoundsOf(cup)}
          roundName={cupRoundName}
          empty="The knockout hasn't started yet."
        />
      )}
    </Panel>
  );
}

/** Turn an international tournament's ties into bracket lines, drawn as nations. */
function intlTies(t: IntlTournament): MiniBracketTie[] {
  const nameOf = (nid: number) => t.nations[nid] ?? "?";
  return t.ties.map((tie): MiniBracketTie => ({
    round: tie.round,
    home: <NationName nation={nameOf(tie.home)} />,
    away: <NationName nation={nameOf(tie.away)} />,
    homeGoals: tie.homeGoals,
    awayGoals: tie.awayGoals,
    winner: tie.winner === tie.home ? "home" : tie.winner === tie.away ? "away" : null,
    pens: tie.wentToPens ? { home: tie.homePens, away: tie.awayPens } : null,
  }));
}

/**
 * Bracket depth from the field rather than from the rounds played so far.
 *
 * Naming a round counts backwards from the final, so deriving the depth from
 * what has been played calls the first round of a half-finished tournament its
 * final. `bracket` holds the qualified nations and is empty until the groups
 * finish, which is also exactly when there are no ties to name.
 */
function intlRounds(t: IntlTournament): number {
  return t.bracket.length > 1 ? Math.round(Math.log2(t.bracket.length)) : 1;
}

/**
 * The summer's international football, shown only in the offseasons that have
 * a tournament in them.
 *
 * The cycle is four seasons: a World Cup on `season % 4 === 0`, the
 * confederation championships on `season % 4 === 2`, and qualifying alone on
 * the other two — so this appears every other year, which is the shape of the
 * real calendar rather than a display rule.
 */
export function InternationalBracketPanel({ league }: { league: LeagueStore }) {
  const worldCup = isTournamentSeason(league.season);
  const confederations = isConfederationCupSeason(league.season);
  if (league.phase !== "offseason" || (!worldCup && !confederations)) return null;

  if (worldCup) {
    const t = league.international.tournament;
    return (
      <Panel title="World Cup" link="/national-teams/world-cup" linkLabel="Full bracket" className="mb-3">
        {!t ? (
          <p className="text-muted small mb-0">Waiting on the draw.</p>
        ) : (
          <>
            {t.championNid !== null && (
              <p className="small mb-2">
                <NationName nation={t.nations[t.championNid] ?? "?"} />{" "}
                <span className="text-muted">win it.</span>
              </p>
            )}
            <MiniBracket
              ties={intlTies(t)}
              totalRounds={intlRounds(t)}
              roundName={koRoundName}
              empty="The group stage is still being played."
            />
          </>
        )}
      </Panel>
    );
  }

  const cups = league.international.confederationCups ?? [];
  return (
    <Panel title="Confederation cups" link="/national-teams/confederation-cups" linkLabel="All of them" className="mb-3">
      {cups.length === 0 ? (
        <p className="text-muted small mb-0">Waiting on the draws.</p>
      ) : (
        <div className="row g-3">
          {cups.map((c) => (
            <div className="col-md-6 col-lg-4" key={c.confederation}>
              <div className="fw-semibold small mb-1">
                {c.name}
                {c.championNid !== null && (
                  <span className="text-muted fw-normal">
                    {" — "}<NationName nation={c.nations[c.championNid] ?? "?"} />
                  </span>
                )}
              </div>
              <MiniBracket
                ties={intlTies(c)}
                totalRounds={intlRounds(c)}
                roundName={koRoundName}
                empty="Groups still being played."
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
