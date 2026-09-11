import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../../context/LeagueContext.js";
import { seasonYear } from "../../format.js";
import type {
  IntlTournament, IntlTournamentSummary,
} from "../../../core/international/index.js";
import { tournamentGoals } from "../../../core/international/index.js";
import { PlayerRefLink } from "../../components/PlayerRefLink.js";
import { INTL_TOURNAMENT_NAME, INTL_QUALIFY_PER_GROUP, INTL_CYCLE_YEARS } from "../../../core/constants.js";
import { bestThirdsFor } from "../../../core/international/format.js";
import { EmptyState } from "../../components/EmptyState.js";
import {
  NationalTeamsLayout, NationName, GroupCards, liveGroupRows, KnockoutColumns, SeasonSelect,
  useHasInternational, IntlEmpty, type StandingRow, type KnockoutResultView,
} from "./shared.js";

function ChampionBanner({ champion }: { champion: string }) {
  return (
    <div className="cup-champion-banner mb-3">
      <span className="cup-champion-label">Winners</span> <NationName nation={champion} />
    </div>
  );
}

/**
 * Group cards from already-normalized standings. Shaded rows are who went
 * through: the top two in each group, or, once the knockout is seeded, exactly
 * the nations in it — which is the only way to show which third-placed sides
 * made it at a 24- or 48-nation World Cup.
 */
function GroupStage({ groups, through }: { groups: StandingRow[][]; through?: ReadonlySet<string> }) {
  const thirds = bestThirdsFor(groups.length, INTL_QUALIFY_PER_GROUP);
  return (
    <>
      <h6 className="mt-3">Group stage</h6>
      <p className="text-muted small mb-2">
        {thirds > 0
          ? `The top two in each group go through, along with the ${thirds} best third-placed teams.`
          : "The top two in each group go through."}
      </p>
      <GroupCards groups={groups} advancing={INTL_QUALIFY_PER_GROUP} through={through} />
    </>
  );
}

function LiveTournament({ tournament }: { tournament: IntlTournament }) {
  const { league } = useLeague();
  const nations = tournament.nations;
  const champion = tournament.championNid !== null ? nations[tournament.championNid] : null;

  const groups = tournament.groups.map((g) => liveGroupRows(g, nations));
  const through = tournament.bracket.length > 0
    ? new Set(tournament.bracket.map((nid) => nations[nid]))
    : undefined;
  const knockout: KnockoutResultView[] = tournament.ties.map((t) => ({
    round: t.round,
    home: nations[t.home],
    away: nations[t.away],
    homeGoals: t.homeGoals,
    awayGoals: t.awayGoals,
    winner: nations[t.winner],
    pens: t.wentToPens ? { home: t.homePens, away: t.awayPens } : null,
    extraTime: t.wentToExtraTime,
  }));

  const scorers = useMemo(() => {
    const goals = tournamentGoals(tournament);
    const byPid = new Map((league?.players ?? []).map((p) => [p.pid, p]));
    // Nationality comes off the live record when there is one and the archive
    // otherwise, so a retired top scorer keeps his flag as well as his name.
    const retiredByPid = new Map((league?.retiredPlayers ?? []).map((a) => [a.pid, a]));
    return [...goals.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 10)
      .map(([pid, n]) => ({
        pid,
        goals: n,
        nationality: byPid.get(pid)?.nationality ?? retiredByPid.get(pid)?.nationality,
      }));
  }, [tournament, league?.players, league?.retiredPlayers]);

  return (
    <>
      {champion && <ChampionBanner champion={champion} />}
      <GroupStage groups={groups} through={through} />
      <h6>Knockout</h6>
      <KnockoutColumns results={knockout} />
      {scorers.length > 0 && (
        <>
          <h6>Leading scorers</h6>
          <table className="table table-sm w-auto mb-3">
            <tbody>
              {scorers.map((s) => (
                <tr key={s.pid}>
                  <td>
                    {/* A tournament outlives its scorers; the archive keeps the
                        retired ones nameable and clickable. */}
                    <PlayerRefLink pid={s.pid} fallback="(retired)" />
                  </td>
                  <td>{s.nationality && <NationName nation={s.nationality} />}</td>
                  <td className="text-end fw-bold">{s.goals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/** The nations in an archived tournament's first knockout round, i.e. who got out of the groups. */
function firstRoundNations(summary: IntlTournamentSummary): ReadonlySet<string> | undefined {
  const first = summary.knockout.filter((k) => k.round === 0);
  return first.length > 0 ? new Set(first.flatMap((k) => [k.home, k.away])) : undefined;
}

function ArchivedTournament({ summary }: { summary: IntlTournamentSummary }) {
  const groups = summary.groups.map((g) => g.rows);
  const knockout: KnockoutResultView[] = summary.knockout.map((k) => ({
    round: k.round,
    home: k.home,
    away: k.away,
    homeGoals: k.homeGoals,
    awayGoals: k.awayGoals,
    winner: k.winner,
    pens: k.pens,
    extraTime: k.extraTime,
  }));

  return (
    <>
      <ChampionBanner champion={summary.champion} />
      {groups.length > 0 ? <GroupStage groups={groups} through={firstRoundNations(summary)} /> : null}
      {knockout.length > 0 && (
        <>
          <h6>Knockout</h6>
          <KnockoutColumns results={knockout} />
        </>
      )}
      {summary.topScorer && (
        <p className="small">
          <span className="text-muted">Golden Boot: </span>
          <Link to={`/player/${summary.topScorer.pid}`}>
            {summary.topScorer.name ?? `#${summary.topScorer.pid}`}
          </Link>{" "}
          (<NationName nation={summary.topScorer.nation} />, {summary.topScorer.goals} goals)
        </p>
      )}
    </>
  );
}

export function NTWorldCup() {
  const { league } = useLeague();
  const hasIntl = useHasInternational();
  const current = league?.international.tournament ?? null;
  const history = league?.international.history ?? [];

  // Newest first: the current (maybe in-progress) tournament, then archived ones.
  const seasons = useMemo(() => {
    const set = new Set<number>();
    if (current) set.add(current.season);
    for (const h of history) set.add(h.season);
    return [...set].sort((a, b) => b - a);
  }, [current, history]);

  const [season, setSeason] = useState<number | null>(null);
  const selected = season ?? seasons[0] ?? null;

  if (!hasIntl || !league) return <IntlEmpty />;

  const showingCurrent = current !== null && selected === current.season;
  const archived = history.find((h) => h.season === selected) ?? null;

  return (
    <NationalTeamsLayout title={INTL_TOURNAMENT_NAME}>
      <SeasonSelect
        seasons={seasons}
        value={selected ?? 0}
        onChange={setSeason}
        labelFor={(s) => `${INTL_TOURNAMENT_NAME} ${seasonYear(s)}`}
      />
      {showingCurrent && current
        ? <LiveTournament tournament={current} />
        : archived
          ? <ArchivedTournament summary={archived} />
          : (
            <EmptyState headline={`No ${INTL_TOURNAMENT_NAME} has been played yet.`}>
              <p>
                It comes round every {INTL_CYCLE_YEARS} seasons. The three offseasons in between
                play a round of qualifying each, and the fourth is the tournament itself.
              </p>
              <p>
                Qualifying is running now, so who ends up here is being decided on the{" "}
                <Link to="/national-teams/qualifying">Qualifying</Link> page.
              </p>
            </EmptyState>
          )}
    </NationalTeamsLayout>
  );
}
