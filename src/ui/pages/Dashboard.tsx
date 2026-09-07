import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import type { LeagueStore } from "../../core/leagueState.js";
import type { StoredTeam } from "../../core/teams/clubs.js";
import { HelpHint } from "../components/HelpHint.js";
import { computeStandings, type StandingsRow } from "../../core/standings.js";
import { nextMatchday, transferWindowState } from "../../core/transfers/window.js";
import { SimTargetForm } from "../components/SimTargetForm.js";
import { SCOUTING_SPEND_MAX, RATING_LEADER_QUALIFY_FRACTION } from "../../core/constants.js";
import { wageBill } from "../../core/finance/budget.js";
import { cupFinalists, isCupComplete } from "../../core/cup/cup.js";
import { domesticFinalists } from "../../core/domesticCup/cup.js";
import { isIntlStagePending, editableSquad } from "../../core/international/index.js";
import { superCupsPending } from "../../core/superCup/superCup.js";
import {
  intlStageButton,
  intlStageHeadline,
  intlStageLink,
  intlStageSkipLabel,
  intlStageThroughLabel,
  type PlayableStage,
} from "../intlStageLabels.js";
import { confidenceMood, confidenceLabel } from "../../core/manager/confidence.js";
import { cachedExpectations } from "../../core/manager/expectation.js";
import { qualifyingLeg } from "../../core/constants.js";

/** Bootstrap bar colour per board mood — kept beside the Manager page's copy of the same map. */
const BOARD_MOOD_CLASS: Record<string, string> = {
  secure: "bg-success",
  settled: "bg-info",
  uneasy: "bg-warning",
  danger: "bg-danger",
};
import { buildSeasonTimeline, type FeedItem } from "../newsFeedTimeline.js";
import { newsHeadlineNode } from "../components/NewsHeadline.js";
import { isSpectator } from "../../core/spectator.js";
import { SpectatorDashboard } from "./SpectatorDashboard.js";
import {
  PowerRankingPanel, CupBracketPanel, InternationalBracketPanel,
} from "./worldPanels.js";
import { seasonAwardNews } from "../../core/awardNews.js";
import { trophyNewsBySeason } from "../../core/trophyNews.js";
import { promotionNewsBySeason } from "../../core/promotionNews.js";
import { currency, ordinal, seasonYear } from "../format.js";
import { Flag } from "../components/Flag.js";
import { ClubCrest } from "../components/ClubCrest.js";
import type { Player, SeasonStats } from "../../core/players/types.js";
import { isSuspended, matchesLabel } from "../../core/suspensions.js";
import { pointsDeductionMap } from "../../core/finance/debt.js";
import { userDebtView } from "../userDebt.js";

/**
 * One job's standing, as a single line: who you answer to, a thin bar, and
 * where you stand with them.
 *
 * Both meters share this so the club board and the federation can't drift into
 * looking like two different things — they are the same relationship from two
 * chairs, and the Manager and Federation pages already mirror each other.
 *
 * `value` null means there is no bar to draw: a manager being courted by
 * countries while managing none has a standing with nobody, and a meter sitting
 * at its starting value would invent one.
 */
function ConfidenceLine({ label, mood, value, note, to }: {
  label: string;
  mood: string;
  value: number | null;
  note: string;
  to: string;
}) {
  return (
    <div className="d-flex align-items-center gap-2">
      <Link to={to} className="small text-body text-decoration-none flex-shrink-0">{label}</Link>
      {value !== null && (
        <div className="progress flex-grow-1" style={{ height: 4, minWidth: 40 }}>
          <div
            className={`progress-bar ${BOARD_MOOD_CLASS[mood] ?? "bg-secondary"}`}
            style={{ width: `${Math.round(value)}%` }}
          />
        </div>
      )}
      <span className={`small text-nowrap ${value === null ? "flex-grow-1" : "flex-shrink-0"} text-muted`}>
        {note}
      </span>
    </div>
  );
}

const STANDINGS_TOP_N = 8;
const NEWS_TOP_N = 8;
const LEADER_STAT_KEYS: { key: keyof SeasonStats; label: string }[] = [
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "tackles", label: "Tackles" },
  { key: "avgRating", label: "Match Rating" },
];
const LEADERS_PER_STAT = 3;

interface StatLeaderRow {
  player: Player;
  value: number;
}

function topByStat(
  players: Player[],
  pidPool: Set<number>,
  season: number,
  key: keyof SeasonStats,
  ratingMinApps: number,
): StatLeaderRow[] {
  const rows: StatLeaderRow[] = [];
  for (const p of players) {
    if (!pidPool.has(p.pid)) continue;
    const ss = p.stats.find((s) => s.season === season);
    if (!ss || Number(ss[key]) <= 0) continue;
    // Match Rating is an average: a one-off cameo shouldn't top the board. The
    // threshold scales with how many games have been played (see caller).
    if (key === "avgRating" && ss.appearances < ratingMinApps) continue;
    rows.push({ player: p, value: Number(ss[key]) });
  }
  rows.sort((a, b) => b.value - a.value);
  return rows.slice(0, LEADERS_PER_STAT);
}

function StatLeaderList({ title, rows, decimals }: { title: string; rows: StatLeaderRow[]; decimals?: boolean }) {
  return (
    <div className="mb-2">
      <div className="text-muted small fw-semibold">{title}</div>
      {rows.length === 0 ? (
        <div className="text-muted small">No data yet</div>
      ) : (
        <ol className="mb-0 ps-3 small">
          {rows.map((r) => (
            <li key={r.player.pid}>
              <Link to={`/player/${r.player.pid}`}>{r.player.name}</Link>{" "}
              <Flag nationality={r.player.nationality} />{" "}
              <span className="text-muted">— {decimals ? r.value.toFixed(2) : r.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Dashboard() {
  const { league } = useLeague();

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  // Nobody manages a club here, so there is no club dashboard to draw: no
  // table position of yours, no next fixture, no board, no wage bill. It gets
  // its own page rather than a pile of conditionals through this one, which is
  // built around a `userTeam` that does not exist.
  if (isSpectator(league)) {
    return <SpectatorDashboard league={league} />;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!userTeam) {
    return <p className="p-3">Team not found.</p>;
  }

  return <DashboardBody league={league} userTeam={userTeam} />;
}

// The rendered body lives in its own component so its hooks run unconditionally
// (after the null-guards above). Every expensive derivation is memoized on the
// specific league slice it reads, so a re-render that doesn't touch that slice
// — most importantly dragging the scouting slider, which only changes local
// draft state — skips recomputing standings, the news timeline, the lookup
// maps, the wage bill, and the stat-leader scans over the whole player pool.
function DashboardBody({ league, userTeam }: { league: LeagueStore; userTeam: StoredTeam }) {
  const {
    simAction, simLiveAction, setScoutingSpendAction, intlStageAction, simming,
    playSuperCupsAction,
  } = useLeague();
  const navigate = useNavigate();
  // Whether the user's own club contests one of this preseason's champions
  // cups. Cheap enough to read straight off the field — it is at most a dozen
  // ties — so it needs no memo.
  const userInSuperCup = (league.superCups ?? [])
    .some((sc) => sc.teams.includes(league.meta.userTid));
  // Slider position while dragging; persisted (and clamped) only on release
  // so we don't write to IndexedDB on every drag tick.
  const [scoutingDraft, setScoutingDraft] = useState<number | null>(null);

  const commitScoutingDraft = async () => {
    if (scoutingDraft === null) return;
    // Persist first, then drop the draft, so the slider never flashes the
    // stale stored value while the save is in flight.
    await setScoutingSpendAction(scoutingDraft);
    setScoutingDraft(null);
  };

  // Shared with the Finance page and the spending actions, so the warning here
  // and the button that refuses the signing can never disagree.
  const debt = userDebtView(league);

  // Compute standings (user's own division) and find user's row
  const { userRow, leaguePosition, standingsTop, userInTop } = useMemo(() => {
    const divisionTids = league.teams.filter((t) => t.compId === userTeam.compId).map((t) => t.tid);
    const standings = computeStandings(
      divisionTids,
      league.played.filter((m) => {
        const home = league.teams.find((t) => t.tid === m.home);
        return home?.compId === userTeam.compId;
      }),
      pointsDeductionMap(league.debtSanctions, league.season),
    );
    const userRow = standings.find((r) => r.tid === league.meta.userTid);
    const leaguePosition = standings.findIndex((r) => r.tid === league.meta.userTid) + 1;
    const standingsTop: StandingsRow[] = standings.slice(0, STANDINGS_TOP_N);
    const userInTop = standingsTop.some((r) => r.tid === league.meta.userTid);
    return { userRow, leaguePosition, standingsTop, userInTop };
  }, [league.teams, league.played, league.meta.userTid, userTeam.compId]);

  // Next match: lowest matchday in schedule, find user's fixture
  const nextMatchInfo = useMemo<React.ReactNode>(() => {
    if (league.schedule.length === 0) {
      return <span>Season Complete</span>;
    }
    const minMatchday = Math.min(...league.schedule.map((g) => g.matchday));
    const userFixture = league.schedule.find(
      (g) =>
        g.matchday === minMatchday &&
        (g.home === league.meta.userTid || g.away === league.meta.userTid),
    );
    if (userFixture) {
      const isHome = userFixture.home === league.meta.userTid;
      const opponentTid = isHome ? userFixture.away : userFixture.home;
      const opponent = league.teams.find((t) => t.tid === opponentTid);
      return (
        <span>
          {isHome ? "vs" : "@"} {opponent?.name ?? "Unknown"} (Matchday {minMatchday})
        </span>
      );
    }
    return <span>Bye (Matchday {minMatchday})</span>;
  }, [league.schedule, league.teams, league.meta.userTid]);

  // News headlines: most recent items from the current season's timeline.
  const newsHeadlines = useMemo(() => {
    const currentSeasonTransfers = league.transfers.filter((t) => t.season === league.season);
    const currentSeasonEvents = league.newsEvents.filter((e) => e.season === league.season);
    // The season in progress has no seasonHistory snapshot yet, so the live
    // teams are its competition map (see NewsFeed.tsx for the general case).
    const comps: Record<number, number> = {};
    for (const t of league.teams) comps[t.tid] = t.compId;
    const userTid = league.meta.userTid;

    // A season's honours are written into history by the offseason that ends
    // it, which is the same step that moves the clock on — so the season the
    // awards belong to is never the season this panel is showing, and passing
    // it its own awards would always pass none. What the manager wants at that
    // moment is last season's, so they ride along until the new season kicks
    // off (`played` is emptied every offseason) and then drop out on their own.
    //
    // Only his own club's, and only here: the full slate is 27 honours against
    // a panel of NEWS_TOP_N, so the world's would be all a reader ever saw.
    // The News Feed carries the rest.
    const lastSeasonHonours = league.played.length === 0
      ? seasonAwardNews(league.seasonHistory.find((h) => h.season === league.season - 1))
          .filter((a) => a.tid === userTid)
      : [];

    // Trophies need no club filter: each is a single row for the whole world,
    // where the honours run to 27. This season's arrive as they are won (the
    // Continental Cup final, then the World Cup in the offseason, both while
    // the clock still reads this season), and last season's ride along through
    // the rollover the same way the honours do.
    const trophies = trophyNewsBySeason({
      cup: league.cup,
      cupHistory: league.cupHistory,
      shield: league.shield,
      shieldHistory: league.shieldHistory,
      // Only the live ones: the panel shows the season in progress, and this
      // preseason's super cups are exactly that. Archived ones belong to
      // seasons the panel has already stopped reporting.
      superCups: league.superCups ?? [],
      international: league.international,
    });
    const shownTrophies = [
      ...(league.played.length === 0 ? trophies.get(league.season - 1) ?? [] : []),
      ...(trophies.get(league.season) ?? []),
    ];

    // The promotion playoffs the season just ended decided. They live on
    // `promotionPlayoffs` only between the final whistle and the advance, and
    // are stamped with the season that has just finished — so during the
    // offseason that is `league.season`, and once the clock has moved on the
    // record has moved to the history entry and this is empty. Either way the
    // panel shows it beside the trophies, which ride the rollover the same way.
    const promotions = promotionNewsBySeason([
      ...league.promotionPlayoffs,
      ...(league.played.length === 0
        ? (league.seasonHistory.find((h) => h.season === league.season - 1)?.promotionPlayoffs ?? [])
        : []),
    ]);
    const shownPromotions = [
      ...(promotions.get(league.season) ?? []),
      ...(promotions.get(league.season - 1) ?? []),
    ];

    const newsTimeline = buildSeasonTimeline(currentSeasonTransfers, currentSeasonEvents, {
      userTid,
      userCompId: comps[userTid],
      compOf: (tid) => comps[tid],
    }, lastSeasonHonours, shownTrophies, [], shownPromotions);
    return [...newsTimeline].slice(-NEWS_TOP_N).reverse();
  }, [
    league.transfers, league.newsEvents, league.season, league.played,
    league.meta.userTid, league.teams, league.seasonHistory,
    league.cup, league.cupHistory, league.shield, league.shieldHistory, league.international,
    league.promotionPlayoffs,
    league.superCups,
  ]);

  const teamByTid = useMemo(() => new Map(league.teams.map((t) => [t.tid, t])), [league.teams]);
  const playerByPid = useMemo(() => new Map(league.players.map((p) => [p.pid, p])), [league.players]);

  const headlineNode = (item: FeedItem): React.ReactNode =>
    newsHeadlineNode(item, { teamByTid, playerByPid, competitions: league.competitions });

  // Stat leaders: league-wide (user's division) vs. the user's own team only.
  const leaguePidPool = useMemo(() => {
    const pool = new Set<number>();
    for (const t of league.teams) {
      if (t.compId !== userTeam.compId) continue;
      for (const pid of t.roster) pool.add(pid);
    }
    return pool;
  }, [league.teams, userTeam.compId]);
  const teamPidPool = useMemo(() => new Set(userTeam.roster), [userTeam.roster]);

  // The Match Rating board needs a player to have appeared in a fraction of the
  // games played *so far* — count the matchdays this division has completed and
  // take that fraction, so a hot cameo can't top the board ten games in.
  const ratingMinApps = useMemo(() => {
    const compTids = new Set(
      league.teams.filter((t) => t.compId === userTeam.compId).map((t) => t.tid),
    );
    const mds = new Set<number>();
    for (const m of league.played) {
      if (compTids.has(m.home) || compTids.has(m.away)) mds.add(m.matchday);
    }
    return Math.max(1, Math.ceil(RATING_LEADER_QUALIFY_FRACTION * mds.size));
  }, [league.teams, league.played, userTeam.compId]);

  // Pre-scan the stat leaders once per pool (each is an O(players) sweep). Index
  // aligns with LEADER_STAT_KEYS so the JSX below just reads the ith result.
  const leagueLeaders = useMemo(
    () => LEADER_STAT_KEYS.map(({ key }) => topByStat(league.players, leaguePidPool, league.season, key, ratingMinApps)),
    [league.players, leaguePidPool, league.season, ratingMinApps],
  );
  const teamLeaders = useMemo(
    () => LEADER_STAT_KEYS.map(({ key }) => topByStat(league.players, teamPidPool, league.season, key, ratingMinApps)),
    [league.players, teamPidPool, league.season, ratingMinApps],
  );

  // Season wage bill: senior roster + academy, priced from every player's
  // salary. Memoized so the O(players) salary map isn't rebuilt each render.
  const seasonWageBill = useMemo(
    () => wageBill(
      [...userTeam.roster, ...userTeam.academyRoster],
      new Map(league.players.map((p) => [p.pid, p.contract.salary])),
    ),
    [userTeam.roster, userTeam.academyRoster, league.players],
  );

  // Injured players in the user's squad — surfaced so you know who's out before
  // simming (they get auto-benched during the sim, so this is the heads-up).
  const injuredPlayers = useMemo(() => {
    const roster = new Set(userTeam.roster);
    return league.players
      .filter((p) => roster.has(p.pid) && p.injury)
      .sort((a, b) => (b.injury!.gamesRemaining - a.injury!.gamesRemaining));
  }, [league.players, userTeam.roster]);

  // Banned players sit alongside the injured for the same reason: the sim
  // leaves them out on its own, so this is the only warning before you advance.
  const suspendedPlayers = useMemo(() => {
    const roster = new Set(userTeam.roster);
    return league.players
      .filter((p) => roster.has(p.pid) && isSuspended(p))
      .sort((a, b) => b.suspension!.matchesRemaining - a.suspension!.matchesRemaining);
  }, [league.players, userTeam.roster]);

  // The matchday buttons only render in season now (the Simulation card
  // swaps to the offseason controls otherwise), so a sim in flight is the
  // only thing left to disable them for.
  const disableSim = simming;
  const boardMood = confidenceMood(league.manager.confidence, league.manager.sackingEnabled);
  // Memoized on the league object (fresh per commit), since the expectation pass
  // walks every club in the world.
  const boardExpectation = useMemo(
    () => cachedExpectations(league).get(league.meta.userTid) ?? null,
    [league],
  );
  const nationMood = confidenceMood(
    league.nationalManager.confidence, league.nationalManager.sackingEnabled,
  );
  // Your country is in the campaign this stage belongs to, so there is a team to
  // pick before the next click plays it.
  const myNationPlaying = editableSquad(league.international, league.nationalManager.nation) !== null;
  // The matchday the club is standing on, and the last one left this season —
  // the bounds the "sim to matchday" box accepts.
  const nextMd = nextMatchday(league);
  const lastMd = league.schedule.length > 0
    ? Math.max(...league.schedule.map((g) => g.matchday))
    : null;

  return (
    <div className="container-fluid p-3">
      {/* Team header */}
      {/*
        The club, and beside it how your two employers rate you.

        Here rather than in a card of their own because that is what these are:
        a property of the job, read at a glance on the way past, not a section.
        Up at the top rather than at the foot of the page because the whole point
        of a visible meter is that trouble is something you watch build — at the
        bottom you meet it on the way out, which is too late to be a warning.
      */}
      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <h4 className="card-title d-flex align-items-center gap-2 mb-0">
              <ClubCrest tid={userTeam.tid} colors={userTeam.colors} size={32} />
              {userTeam.name}
            </h4>
            <div className="d-flex flex-wrap gap-3 ms-auto">
              {/*
                The note carries where the board expects you to finish, kept
                from the larger card this line replaced. An offer to leave is
                the more urgent thing to say in the same space, so it takes the
                slot whenever there is one.
              */}
              <div style={{ minWidth: 190 }}>
                <ConfidenceLine
                  label="Board"
                  mood={boardMood}
                  value={league.manager.confidence}
                  to="/manager"
                  note={league.manager.offers.length > 0
                    ? `${league.manager.offers.length} club${league.manager.offers.length === 1 ? "" : "s"} want you`
                    : boardExpectation
                      ? `${confidenceLabel(boardMood)} · ${ordinal(boardExpectation.expectedRank)} of ${boardExpectation.clubs} expected`
                      : confidenceLabel(boardMood)}
                />
              </div>
              {/*
                Only when there is a country or somebody asking: a manager who
                has never taken an international job should not be shown a meter
                for a job they don't have.
              */}
              {(league.nationalManager.nation || league.nationalManager.offers.length > 0) && (
                <div style={{ minWidth: 190 }}>
                  <ConfidenceLine
                    label={league.nationalManager.nation ?? "Federation"}
                    mood={nationMood}
                    value={league.nationalManager.nation ? league.nationalManager.confidence : null}
                    to="/national-teams/federation"
                    note={league.nationalManager.offers.length > 0
                      ? `${league.nationalManager.offers.length} countr${league.nationalManager.offers.length === 1 ? "y wants" : "ies want"} you`
                      : confidenceLabel(nationMood)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Youth trialists waiting on a decision. Load-bearing rather than a
          nicety: the group is replaced at the next offseason whether or not it
          was ever looked at, so a user who never finds the page silently loses
          a dozen prospects a year and never learns the screen exists. */}
      {(userTeam.youthTrialists?.length ?? 0) > 0 && (
        <div className="alert alert-info d-flex justify-content-between align-items-center mb-3">
          <span>
            {userTeam.youthTrialists!.length} youngster
            {userTeam.youthTrialists!.length === 1 ? " is" : "s are"} on trial at your academy.
            Offer contracts before the season starts or they'll leave.
          </span>
          <Link to="/youth-intake" className="btn btn-sm btn-outline-primary">Youth intake</Link>
        </div>
      )}

      {/* A continental final: the season sim halts before it, so flag why. The
          user's club can only be in one of the two competitions. */}
      {([["cup", league.cup], ["shield", league.shield]] as const).map(([kind, comp]) =>
        comp && !isCupComplete(comp) && cupFinalists(comp).includes(league.meta.userTid) ? (
          <div key={kind} className="alert alert-warning d-flex justify-content-between align-items-center mb-3">
            <span>
              Your club has reached the {comp.name} final. Simming pauses here so you can prepare.
            </span>
            <Link to={`/${kind}`} className="btn btn-sm btn-outline-warning">View bracket</Link>
          </div>
        ) : null,
      )}

      {/* Domestic cup final: the season sim halts before this one too. */}
      {(league.domesticCups ?? []).some(
        (c) => c.championTid === null && domesticFinalists(c).includes(league.meta.userTid),
      ) && (
        <div className="alert alert-warning d-flex justify-content-between align-items-center mb-3">
          <span>Your club has reached the domestic cup final. Simming pauses here so you can prepare.</span>
          <Link to="/domestic-cup" className="btn btn-sm btn-outline-warning">View the cup</Link>
        </div>
      )}

      {/* Sim controls. Phase-aware: in season these play matchdays, in the
          offseason they play the offseason, so the buttons that move time
          forward always sit in the same card instead of moving down the page
          when the season ends. */}
      <div className="card mb-3">
        {/* In season the body is a two-column grid so the sim-target hint can
            sit on the heading's line and over the select at once; the offseason
            branch is ordinary prose and buttons, so it stays in normal flow. */}
        <div className={`card-body${league.phase === "offseason" ? "" : " sim-grid"}`}>
          <h5 className="card-title sim-grid-title">Simulation</h5>
          {league.phase === "offseason" ? (
            <>
              {league.manager.sacked ? (
                <>
                  <p className="card-text">
                    The board has seen enough. You're out of a job, and the season
                    can't move on until you've found a new one.
                  </p>
                  <button className="btn btn-danger" onClick={() => navigate("/manager")}>
                    See who'll have you
                  </button>
                </>
              ) : isIntlStagePending(league.international) ? (
                <>
                  <p className="card-text">
                    {intlStageHeadline(
                      league.international.stage as PlayableStage,
                      qualifyingLeg(league.season) + 1,
                      league.international.confederationCups,
                      league.international.tournament,
                    )}{" "}
                    Follow it on the{" "}
                    <Link to={intlStageLink(league.international.stage as PlayableStage)}>
                      National Teams
                    </Link>{" "}
                    pages. You'll advance to {seasonYear(league.season + 1)} once it wraps up, or you
                    can skip it and go straight to the offseason.
                  </p>
                  {/*
                    Your own country is in this one, so there is a team to pick
                    before the next click plays it. Placed here rather than left
                    to the sidebar because the stage button is the thing about to
                    make the decision permanent.
                  */}
                  {myNationPlaying && (
                    <p className="card-text">
                      <strong>{league.nationalManager.nation}</strong> are in it, and you pick
                      the team.{" "}
                      <Link to="/national-teams/my-squad">Name your squad</Link> before you
                      play the next round.
                    </p>
                  )}
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      className="btn btn-primary"
                      disabled={simming}
                      onClick={() => intlStageAction("stage")}
                    >
                      {intlStageButton(
                        league.international.stage as PlayableStage,
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
                        {intlStageThroughLabel(league.international.stage as PlayableStage)}
                      </button>
                    )}
                    {/*
                      Skip: go straight to the offseason without watching any of
                      this. Nothing is thrown away — the advance itself plays out
                      every stage the user left unplayed (simOffseason opens with
                      simThroughInternational), on the same seeded streams, so the
                      results are identical to having clicked through them and are
                      waiting on the National Teams pages afterwards.
                    */}
                    <button
                      className="btn btn-outline-secondary"
                      disabled={simming}
                      onClick={() => navigate("/set-scouting")}
                    >
                      {intlStageSkipLabel(league.international.stage as PlayableStage)}
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
                    {seasonYear(league.season)} is complete. First you'll set your
                    scouting budget for the new season, then advancing runs player
                    progression, retirements, AI free agency, and youth intake, and
                    starts {seasonYear(league.season + 1)}.
                  </p>
                  <button
                    className="btn btn-success"
                    disabled={simming}
                    onClick={() => navigate("/set-scouting")}
                  >
                    Advance to {seasonYear(league.season + 1)}
                  </button>
                </>
              )}
            </>
          ) : superCupsPending(league.superCups ?? []) ? (
            <>
              {/*
                The preseason, standing in for the sim buttons for one click so
                the season's opening match is a moment rather than something
                that happens behind a "sim to end of season".

                It reads like a gate and is not one: `simThrough` plays anything
                still pending on its way into the season, so every path that
                never sees this card — a multi-season jump, a headless audit —
                gets the same result without needing a button. This is only
                where a person is offered the click.
              */}
              <p className="card-text">
                The season opens with the champions cups.{" "}
                {userInSuperCup
                  ? <><strong>You're in one.</strong> </>
                  : null}
                They're played before the first matchday, so anyone you sign
                between now and then can play in yours.
              </p>
              <div className="d-flex align-items-start gap-2 flex-wrap">
                <button className="btn btn-primary" onClick={() => void playSuperCupsAction()}>
                  Play the champions cups
                </button>
                <button className="btn btn-outline-secondary" onClick={() => navigate("/champions-cups")}>
                  See the ties
                </button>
              </div>
            </>
          ) : (
            <>
              {/* The buttons take column 1, under the heading; the sim-target
                  form takes column 2, which puts its hint on the heading's line
                  and directly over the select. See `.sim-grid` in styles.css. */}
              <div className="sim-grid-buttons d-flex align-items-center gap-2 flex-wrap">
                <button
                  className="btn btn-primary"
                  disabled={disableSim}
                  onClick={() => simAction("game")}
                >
                  Sim One Game
                </button>
                {/*
                  Same matchday, watched instead of skipped. Deliberately its own
                  button rather than a saved preference: watching is a mood, and
                  a setting you have to go and flip is worse than a second button
                  you can ignore.
                */}
                <button
                  className="btn btn-primary"
                  disabled={disableSim}
                  title="Watch your club's match play out minute by minute"
                  onClick={() => simLiveAction()}
                >
                  Watch Next Game
                </button>
                <button
                  className="btn btn-primary"
                  disabled={disableSim}
                  onClick={() => simAction("season")}
                >
                  Sim to End of Season
                </button>
              </div>
              {nextMd !== null && lastMd !== null && (
                <SimTargetForm
                  current={nextMd}
                  last={lastMd}
                  disabled={disableSim}
                  onSim={(matchday) => simAction({ matchday })}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Injury report: who on your squad is currently sidelined. */}
      {injuredPlayers.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">
              Injuries <span className="text-muted small">({injuredPlayers.length} out)</span>
            </h5>
            <ul className="list-unstyled small mb-0">
              {injuredPlayers.map((p) => (
                <li key={p.pid} className="mb-1">
                  <Link to={`/player/${p.pid}`}>{p.name}</Link>{" "}
                  <Flag nationality={p.nationality} />
                  <span className="text-muted">
                    {" "}({p.pos}) — {p.injury!.type}, out about {p.injury!.gamesRemaining}{" "}
                    {p.injury!.gamesRemaining === 1 ? "match" : "matches"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Suspensions: who's banned, and for how much longer. */}
      {suspendedPlayers.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">
              Suspensions <span className="text-muted small">({suspendedPlayers.length} out)</span>
            </h5>
            <ul className="list-unstyled small mb-0">
              {suspendedPlayers.map((p) => (
                <li key={p.pid} className="mb-1">
                  <Link to={`/player/${p.pid}`}>{p.name}</Link>{" "}
                  <Flag nationality={p.nationality} />
                  <span className="text-muted">
                    {" "}({p.pos}) — {p.suspension!.reason}, out of the next{" "}
                    {matchesLabel(p.suspension!.matchesRemaining)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="text-muted small mt-2">
              Bans only cover league matches, so these players can still play in the cup.
            </div>
          </div>
        </div>
      )}


      {/* Standings | Record + Next Match | News headlines */}
      <div className="row g-3 mb-3">
        <div className="col-lg-3 order-lg-1">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Standings</h5>
              <table className="table table-striped table-sm mb-1">
                <thead>
                  <tr>
                    <th className="text-end">#</th>
                    <th>Team</th>
                    <th className="text-end">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standingsTop.map((row, i) => {
                    const isUser = row.tid === league.meta.userTid;
                    return (
                      <tr key={row.tid} className={isUser ? "team-highlight" : undefined}>
                        <td className="text-end">{i + 1}</td>
                        <td><ClubLink tid={row.tid} /></td>
                        <td className="text-end">{row.points}</td>
                      </tr>
                    );
                  })}
                  {!userInTop && userRow && (
                    <tr className="team-highlight">
                      <td className="text-end">{leaguePosition}</td>
                      <td>{userTeam.name}</td>
                      <td className="text-end">{userRow.points}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <Link to="/standings" className="small">Full standings</Link>
            </div>
          </div>
        </div>

        <div className="col-lg-6 order-lg-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <h5 className="card-title">Current Record</h5>
              {userRow && userRow.played > 0 ? (
                <p className="display-6 mb-1">
                  {userRow.won}-{userRow.drawn}-{userRow.lost}
                </p>
              ) : (
                <p className="display-6 mb-1">0-0-0</p>
              )}
              <p className="text-muted mb-3">
                {userRow && userRow.played > 0
                  ? `${userRow.points} pts · ${ordinal(leaguePosition)} in league`
                  : "No matches played yet"}
              </p>
              <h6 className="text-muted">Next Match</h6>
              <p className="mb-3">{nextMatchInfo}</p>

              <hr />

              <h5 className="card-title text-start">Finances</h5>
              <div className="text-start">
                {debt?.sanction && (
                  <div className="alert alert-danger py-2 text-start" role="alert">
                    {debt.sanction.pointsDeduction > 0
                      ? `You're under a transfer embargo and started the season on `
                        + `-${debt.sanction.pointsDeduction} points.`
                      : "You're under a transfer embargo and can't sign anyone this season."}
                    {" "}<Link to="/finance">See the finances</Link>.
                  </div>
                )}
                {/* The one warning that has to arrive DURING the season: the
                    books are read at the final whistle, so by the time the
                    penalty exists it is too late to trade out of it. */}
                {debt && !debt.sanction && debt.projected !== "clear" && (
                  <div className="alert alert-warning py-2 text-start" role="alert">
                    Finish the season this far overdrawn and you'll start next season with a
                    transfer embargo
                    {debt.projected === "deduction" && " and a points deduction"}.
                    {" "}<Link to="/finance">See the finances</Link>{" "}
                    or sell someone you can do without.
                  </div>
                )}
                {debt?.inDebt && debt.projected === "clear" && (
                  <div className="alert alert-secondary py-2 text-start" role="alert">
                    You're in the red. That's allowed, and you can borrow up to{" "}
                    {currency.format(debt.limit)}, but it costs interest every season and your
                    scouting stays switched off while you're overdrawn.
                    {" "}<Link to="/finance">See the finances</Link>.
                  </div>
                )}
                <p className="card-text mb-2">
                  Budget:{" "}
                  <span className={userTeam.budget < 0 ? "text-danger fw-semibold" : undefined}>
                    {currency.format(userTeam.budget)}
                  </span>
                  {" "}&middot; Hype: {Math.round(userTeam.hype)}/100
                  {" "}&middot; <Link to="/finance">Full breakdown</Link>
                </p>
                <p className="card-text mb-2">
                  Season wage bill:{" "}
                  <strong>{currency.format(seasonWageBill)}</strong>{" "}
                  &middot; paid up front each season
                </p>
                <p className="card-text mb-2">
                  {(() => {
                    const ws = transferWindowState(league);
                    return ws.open ? (
                      <>
                        {ws.window === "summer" ? "Summer" : "Winter"} transfer window{" "}
                        <strong>open</strong> &middot; <Link to="/transfers">Go to Transfers</Link>
                      </>
                    ) : (
                      <>Transfer window closed</>
                    );
                  })()}
                </p>
                {(() => {
                  const isOffseason = league.phase === "offseason";
                  return (
                    <>
                      <label className="form-label mb-1" htmlFor="scouting-spend">
                        {isOffseason ? (
                          <>Scouting budget for next season: {currency.format(scoutingDraft ?? userTeam.nextScoutingSpend)}</>
                        ) : (
                          <>Scouting spend this season: {currency.format(userTeam.scoutingSpend)} (locked)</>
                        )}
                        <HelpHint>
                          {isOffseason
                            ? "More scouting spend sharpens everything you see all season. Transfer valuations for targets and for your own players get way more accurate, and players' potential (POT) shows as an exact number sooner instead of a wide range."
                            : "Wait until the offseason to set your scouting budget."}
                        </HelpHint>
                      </label>
                      <input
                        id="scouting-spend"
                        type="range"
                        className="form-range"
                        min={0}
                        max={SCOUTING_SPEND_MAX}
                        step={100_000}
                        value={isOffseason ? (scoutingDraft ?? userTeam.nextScoutingSpend) : userTeam.scoutingSpend}
                        disabled={simming || !isOffseason}
                        onChange={(e) => setScoutingDraft(Number(e.target.value))}
                        onPointerUp={commitScoutingDraft}
                        onBlur={commitScoutingDraft}
                      />
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-3 order-lg-3">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">News</h5>
              {newsHeadlines.length === 0 ? (
                <p className="text-muted small">Nothing to report yet.</p>
              ) : (
                <ul className="list-unstyled small mb-1">
                  {newsHeadlines.map((item, i) => (
                    <li key={i} className="mb-2">{headlineNode(item)}</li>
                  ))}
                </ul>
              )}
              <Link to="/news" className="small">Full news feed</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Stat leaders */}
      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Stat Leaders</h5>
          <div className="row">
            <div className="col-md-6">
              <div className="text-muted small text-uppercase mb-1">League-wide</div>
              {LEADER_STAT_KEYS.map(({ key, label }, i) => (
                <StatLeaderList
                  key={key}
                  title={label}
                  decimals={key === "avgRating"}
                  rows={leagueLeaders[i]}
                />
              ))}
            </div>
            <div className="col-md-6">
              <div className="text-muted small text-uppercase mb-1">{userTeam.name}</div>
              {LEADER_STAT_KEYS.map(({ key, label }, i) => (
                <StatLeaderList
                  key={key}
                  title={label}
                  decimals={key === "avgRating"}
                  rows={teamLeaders[i]}
                />
              ))}
            </div>
          </div>
          <Link to="/leaders" className="small">Full stat leaders</Link>
        </div>
      </div>

      {/*
        The world outside your club. Appended at the very bottom rather than
        worked into the page above, deliberately: everything higher up is about
        the club you manage and is where a returning player expects it, so these
        add a row instead of moving one. Same panels the spectator dashboard
        carries — they read nothing user-specific — except that the power board
        picks your club out of the world's top ten.
      */}
      <InternationalBracketPanel league={league} />
      <div className="row g-3 mt-0">
        <div className="col-lg-4">
          <PowerRankingPanel league={league} highlightTid={league.meta.userTid} />
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
