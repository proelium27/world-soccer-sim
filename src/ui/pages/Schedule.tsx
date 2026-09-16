import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import type { ScheduleGame } from "../../core/schedule.js";
import type { CupState } from "../../core/cup/types.js";
import { cupRoundName, koRoundsOf, koLegMatchdays } from "../../core/cup/cup.js";
import type { CupCompetitionId } from "../../core/constants.js";
import type { DomesticCupState } from "../../core/domesticCup/types.js";
import { domesticRoundName } from "../../core/domesticCup/cup.js";

interface FixtureRow {
  matchday: number;
  home: number;
  away: number;
  result: { homeGoals: number; awayGoals: number; possessionHome: number } | null;
  /** Index into league.played for the box-score link (league games only). */
  playedIndex: number | null;
  /**
   * "league" fixtures link to their box score; "cup" and "domestic" fixtures
   * link to their own cup page.
   */
  kind: "league" | "cup" | "domestic";
  /**
   * Continental rows only: which of the two continental competitions it is.
   * "domestic" rows don't carry it, since a country has exactly one cup.
   */
  competition?: CupCompetitionId;
  /** Cup rows only: the stage label, e.g. "League phase" or "Quarter-final (1st leg)". */
  label?: string;
  sortKey: number;
}

/** The user's domestic cup fixtures — at most one per round, and only once drawn. */
function userDomesticRows(cups: DomesticCupState[], userTid: number): FixtureRow[] {
  const rows: FixtureRow[] = [];
  for (const cup of cups) {
    for (const round of cup.rounds) {
      const tie = round.ties.find((t) => t.home === userTid || t.away === userTid);
      if (tie) {
        rows.push({
          matchday: round.matchday, home: tie.home, away: tie.away,
          result: { homeGoals: tie.homeGoals, awayGoals: tie.awayGoals, possessionHome: 0 },
          playedIndex: null, kind: "domestic",
          label: domesticRoundName(cup, round.round), sortKey: round.matchday,
        });
        continue;
      }
      // Drawn but not yet played: the user knows his next opponent in advance,
      // which is half the point of a cup draw.
      const pairing = round.ties.length === 0
        ? round.pairings.find((p) => p.home === userTid || p.away === userTid)
        : undefined;
      if (pairing) {
        rows.push({
          matchday: round.matchday, home: pairing.home, away: pairing.away,
          result: null, playedIndex: null, kind: "domestic",
          label: domesticRoundName(cup, round.round), sortKey: round.matchday,
        });
      }
    }
  }
  return rows;
}

/**
 * The user's fixtures in one continental competition (league phase, playoff and
 * knockout legs). Called once per competition — a club only ever plays one of
 * them, so at most one call returns anything.
 */
function userCupRows(cup: CupState | null, userTid: number): FixtureRow[] {
  if (!cup) return [];
  const competition = cup.competition;
  const rows: FixtureRow[] = [];
  const mine = (h: number, a: number): boolean => h === userTid || a === userTid;
  const push = (
    matchday: number,
    home: number,
    away: number,
    score: { homeGoals: number; awayGoals: number } | null,
    label: string,
  ): void => {
    rows.push({
      matchday, home, away,
      result: score ? { ...score, possessionHome: 0.5 } : null,
      playedIndex: null, kind: "cup", competition, label, sortKey: matchday,
    });
  };

  // League phase.
  for (const m of cup.leaguePhase?.matches ?? []) {
    if (!mine(m.home, m.away)) continue;
    push(m.matchday, m.home, m.away, m.played ? { homeGoals: m.homeGoals, awayGoals: m.awayGoals } : null, "League phase");
  }

  // Single-leg playoff (Swiss) — played tie if resolved, else the known pairing.
  if (cup.playoff) {
    const po = cup.playoff;
    const t = po.ties.find((x) => mine(x.home, x.away));
    if (t) push(po.matchday, t.home, t.away, { homeGoals: t.homeGoals, awayGoals: t.awayGoals }, "Playoff");
    else for (let i = 0; i + 1 < po.teams.length; i += 2) {
      if (mine(po.teams[i], po.teams[i + 1])) push(po.matchday, po.teams[i], po.teams[i + 1], null, "Playoff");
    }
  }

  const legMds = koLegMatchdays(cup);
  const roundName = (round: number): string => cupRoundName(round, koRoundsOf(cup));

  // Completed knockout ties. Two-legged ties show one row per leg (the second
  // leg with the host order swapped); single-leg ties show one row.
  for (const t of cup.ties) {
    if (!mine(t.home, t.away)) continue;
    if (t.legs && t.legs.length === 2) {
      push(legMds[t.round][0], t.home, t.away, { homeGoals: t.legs[0].homeGoals, awayGoals: t.legs[0].awayGoals }, `${roundName(t.round)} (1st leg)`);
      push(legMds[t.round][1], t.away, t.home, { homeGoals: t.legs[1].awayGoals, awayGoals: t.legs[1].homeGoals }, `${roundName(t.round)} (2nd leg)`);
    } else {
      push(t.matchday, t.home, t.away, { homeGoals: t.homeGoals, awayGoals: t.awayGoals }, roundName(t.round));
    }
  }

  // A two-legged round in progress: first leg played, second leg still to come.
  for (const l of cup.koLegs ?? []) {
    if (!mine(l.home, l.away)) continue;
    push(legMds[l.round][0], l.home, l.away, { homeGoals: l.homeGoals, awayGoals: l.awayGoals }, `${roundName(l.round)} (1st leg)`);
    push(legMds[l.round][1], l.away, l.home, null, `${roundName(l.round)} (2nd leg)`);
  }

  return rows;
}

export function Schedule() {
  const { league } = useLeague();

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTid = league.meta.userTid;

  const playedRows: FixtureRow[] = [];
  for (let mi = 0; mi < league.played.length; mi++) {
    const m = league.played[mi];
    if (m.home === userTid || m.away === userTid) {
      playedRows.push({
        matchday: m.matchday,
        home: m.home,
        away: m.away,
        result: { homeGoals: m.homeGoals, awayGoals: m.awayGoals, possessionHome: m.possessionHome },
        playedIndex: mi,
        kind: "league",
        sortKey: m.matchday,
      });
    }
  }

  const scheduledRows: FixtureRow[] = league.schedule
    .filter((g: ScheduleGame) => g.home === userTid || g.away === userTid)
    .map((g: ScheduleGame) => ({
      matchday: g.matchday,
      home: g.home,
      away: g.away,
      result: null,
      playedIndex: null,
      kind: "league" as const,
      sortKey: g.matchday,
    }));

  const cupRows = [
    ...userCupRows(league.cup, userTid),
    ...userCupRows(league.shield, userTid),
    ...userCupRows(league.americasCup ?? null, userTid),
  ];
  const domesticRows = userDomesticRows(league.domesticCups ?? [], userTid);

  // Within a matchday, list the league game first, then any cup fixture.
  const allRows = [...playedRows, ...scheduledRows, ...cupRows, ...domesticRows].sort(
    (a, b) => a.sortKey - b.sortKey || (a.kind === b.kind ? 0 : a.kind === "league" ? -1 : 1),
  );

  let lastPlayedIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].result !== null) {
      lastPlayedIdx = i;
    }
  }

  return (
    <div className="container-fluid p-3">
      <h4>Schedule</h4>
      {allRows.length === 0 ? (
        <p>No fixtures found.</p>
      ) : (
        <table className="table table-striped table-sm">
          <thead>
            <tr>
              <th className="text-end">MD</th>
              <th>Home</th>
              <th className="text-center">Score</th>
              <th>Away</th>
              <th className="text-center">Poss</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, i) => {
              const isLastPlayed = i === lastPlayedIdx;
              let outcome: "win" | "loss" | null = null;
              if (row.result) {
                const userIsHome = row.home === userTid;
                const userGoals = userIsHome ? row.result.homeGoals : row.result.awayGoals;
                const oppGoals = userIsHome ? row.result.awayGoals : row.result.homeGoals;
                if (userGoals > oppGoals) outcome = "win";
                else if (userGoals < oppGoals) outcome = "loss";
              }
              const outcomeClass =
                outcome === "win" ? "row-win" : outcome === "loss" ? "row-loss" : undefined;
              const rowClassName = [
                outcomeClass,
                isLastPlayed ? "row-current" : undefined,
              ]
                .filter(Boolean)
                .join(" ") || undefined;
              return (
                <tr
                  key={`${row.kind}-${row.home}-${row.away}-${row.sortKey}-${i}`}
                  className={rowClassName}
                >
                  <td className="text-end">{row.matchday}</td>
                  <td>
                    <ClubLink tid={row.home} />
                    {row.kind !== "league" && (
                      <span className="badge text-bg-secondary ms-2 align-middle" style={{ fontWeight: 400 }}>
                        {row.kind === "domestic"
                          ? "Domestic cup"
                          : row.competition === "shield" ? "Shield"
                            : row.competition === "americas" ? "Americas Cup" : "Cup"} · {row.label}
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    {row.result ? (
                      row.kind === "league" && row.playedIndex !== null ? (
                        <Link to={`/box-score/${row.playedIndex}`}>
                          {row.result.homeGoals} - {row.result.awayGoals}
                        </Link>
                      ) : (
                        <Link to={
                          row.kind === "domestic" ? "/domestic-cup"
                            : row.competition === "shield" ? "/shield"
                              : row.competition === "americas" ? "/americas-cup" : "/cup"
                        }>
                          {row.result.homeGoals} - {row.result.awayGoals}
                        </Link>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td><ClubLink tid={row.away} /></td>
                  <td className="text-center text-muted">
                    {row.kind === "league" && row.result
                      ? `${Math.round(row.result.possessionHome * 100)}–${Math.round((1 - row.result.possessionHome) * 100)}`
                      : ""}
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
