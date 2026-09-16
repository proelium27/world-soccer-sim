import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { watchlistEntries } from "../../core/watchlist.js";
import { competitionOf } from "../../core/competitions.js";
import { currency, formatWeeklyWage, seasonYear } from "../format.js";
import { ClubLink } from "../components/ClubLink.js";
import { Flag } from "../components/Flag.js";
import { HelpHint } from "../components/HelpHint.js";
import { InjuryBadge } from "../components/InjuryBadge.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PositionBadge } from "../components/PositionBadge.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { SuspensionBadge } from "../components/SuspensionBadge.js";
import { WatchToggle } from "../components/WatchToggle.js";
import { SortableTh, sortRows, useTableSort } from "../components/SortableTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { usePotentialView } from "../potentialView.js";
import {
  PlayerViewCells, PlayerViewHeaders, PlayerViewSwitch, ViewTableWrap, performanceSeason,
  performanceSeasonOptions, usePlayerView, viewKeepsSort, viewSortAccessors, viewTableClass,
  type PlayerView, type ViewSortKey,
} from "../playerViews.js";

type SortKey =
  | "name" | "pos" | "age" | "ovr" | "pot" | "club" | "wage" | "contract" | "value" | "apps"
  | ViewSortKey;

/** Keys with a header only on the overview; see `viewKeepsSort`. */
const OVERVIEW_ONLY: readonly SortKey[] = ["pot", "apps", "wage", "contract", "value"];

/**
 * Your shortlist: every player you've starred, wherever he is in the world,
 * with what he's doing this season and whether you could actually sign him.
 *
 * Everything on it is derived on read (see core/watchlist.ts) rather than
 * snapshotted when the star was clicked, so a name starred three seasons ago
 * shows the club he's at today at the price he'd cost today.
 */
export function Watchlist() {
  const { league } = useLeague();

  const entries = useMemo(() => (league ? watchlistEntries(league) : []), [league]);

  const { sort, toggle, setSort } = useTableSort<SortKey>("ovr");
  const potView = usePotentialView();
  const [view, setView] = usePlayerView();
  const seasonOptions = useMemo(
    () => (league ? performanceSeasonOptions(league) : []),
    [league],
  );
  const defaultSeason = useMemo(() => (league ? performanceSeason(league) : 0), [league]);
  const [pickedSeason, setPickedSeason] = useState<number | null>(null);
  const perfSeason = pickedSeason !== null && seasonOptions.includes(pickedSeason)
    ? pickedSeason
    : defaultSeason;
  const changeView = (next: PlayerView) => {
    setView(next);
    if (!viewKeepsSort(sort.key, next, OVERVIEW_ONLY)) setSort({ key: "ovr", dir: "desc" });
  };

  const rows = useMemo(() => {
    if (!league) return [];
    const teamByTid = new Map(league.teams.map((t) => [t.tid, t]));
    const named = entries.map((e) => {
      const team = e.tid === null ? undefined : teamByTid.get(e.tid);
      return {
        ...e,
        clubName: team?.name ?? "Free agent",
        // competitionOf throws on an unknown compId, so it is only asked when
        // there is a club to ask about.
        compName: team ? competitionOf(league.competitions, team.compId).name : null,
        // This season's line, if he has one yet. Absent in the offseason and
        // before a ball is kicked, which reads as blank rather than as zeroes.
        season: e.player.stats.find((s) => s.season === league.season) ?? null,
      };
    });
    return sortRows(named, sort, {
      name: (r) => r.player.name,
      pos: (r) => r.player.pos,
      age: (r) => league.season - r.player.born,
      ovr: (r) => r.player.ovr,
      // The scouted ceiling, never the true value: the column shows a band, and
      // ordering rows by the number behind it would hand the answer over.
      pot: (r) => potView.ceiling(r.player),
      club: (r) => r.clubName,
      wage: (r) => r.player.contract.salary,
      contract: (r) => r.player.contract.expiresSeason,
      value: (r) => r.value,
      apps: (r) => r.season?.appearances ?? -1,
      ...viewSortAccessors((r: (typeof named)[number]) => r.player, perfSeason, named),
    });
  }, [league, entries, sort, potView, perfSeason]);

  if (!league) return null;

  return (
    <div className="container-fluid p-3">
      <h4>
        Watchlist
        <HelpHint>
          Players you've starred to keep an eye on. Click the star beside anyone's name — on his
          profile, in the transfer search, or on the free agent and youth lists — to add or remove
          him. It's just a shortlist: watching a player doesn't scout him, doesn't tell his club
          anything, and doesn't affect anything in the game.
        </HelpHint>
      </h4>

      {rows.length === 0 ? (
        <EmptyState
          headline="Nobody on your watchlist yet."
          action={
            <>
              Star anyone from his profile, from the search on{" "}
              <Link to="/transfers">Transfers</Link>, or from{" "}
              <Link to="/free-agents">Free Agents</Link> and your{" "}
              <Link to="/academy">Academy</Link>.
            </>
          }
        >
          <p>
            It&apos;s a shortlist that keeps itself current. Nothing is frozen at the moment you
            starred someone, so once there are names here each row tells you:
          </p>
          <ul>
            <li>Where he plays today, and what he&apos;s rated today.</li>
            <li>What he&apos;d cost today, and what he&apos;s earning.</li>
            <li>How long his contract has left, and whether his club would sell.</li>
          </ul>
        </EmptyState>
      ) : (
        <>
          <p className="text-muted">
            {rows.length} {rows.length === 1 ? "player" : "players"}. Club, rating and price are
            all as they stand today, not as they were when you starred him.
          </p>
          <PlayerViewSwitch
            value={view}
            onChange={changeView}
            season={perfSeason}
            seasons={seasonOptions}
            onSeason={setPickedSeason}
          />
          <ViewTableWrap view={view}>
          <table className={`table table-striped table-sm align-middle${viewTableClass(view)}`}>
            <thead>
              <tr>
                <th></th>
                <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
                <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
                <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Age</SortableTh>
                {view !== "overview" ? (
                  <>
                    <SortableTh sortKey="club" sort={sort} onSort={toggle} defaultDir="asc">Club</SortableTh>
                    <PlayerViewHeaders view={view} sort={{ sort, onSort: toggle }} />
                  </>
                ) : (
                  <>
                    <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">Ovr</SortableTh>
                    <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">Pot</SortableTh>
                    <SortableTh sortKey="club" sort={sort} onSort={toggle} defaultDir="asc">Club</SortableTh>
                    <SortableTh sortKey="apps" sort={sort} onSort={toggle} className="text-end">
                      This season
                      <HelpHint>
                        Appearances, goals and assists in league play so far this season, and his
                        average match rating. Blank if he hasn't played yet.
                      </HelpHint>
                    </SortableTh>
                    <SortableTh sortKey="wage" sort={sort} onSort={toggle} className="text-end">Wage</SortableTh>
                    <SortableTh sortKey="contract" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Until</SortableTh>
                    <SortableTh sortKey="value" sort={sort} onSort={toggle} className="text-end">
                      Scout value
                      <HelpHint>
                        Our scouts' estimate of his transfer value — the same figure the Transfers
                        page quotes, and an estimate rather than the asking price. More scouting spend
                        makes it sharper.
                      </HelpHint>
                    </SortableTh>
                  </>
                )}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.player;
                return (
                  <tr key={p.pid}>
                    <td><WatchToggle pid={p.pid} name={p.name} /></td>
                    <td>
                      <PlayerRatingsTooltip player={p}>
                        <Link to={`/player/${p.pid}`}>{p.name}</Link>
                      </PlayerRatingsTooltip>{" "}
                      <Flag nationality={p.nationality} />
                      <InjuryBadge player={p} />
                      <SuspensionBadge player={p} />
                    </td>
                    <td><PositionBadge player={p} /></td>
                    <td className="text-end">{league.season - p.born}</td>
                    {view !== "overview" ? (
                      <>
                        <td>
                          {r.tid === null
                            ? <span className="text-muted">Free agent</span>
                            : <ClubLink tid={r.tid} />}
                        </td>
                        <PlayerViewCells view={view} player={p} season={perfSeason} />
                      </>
                    ) : (
                      <>
                        <td className="text-end">{p.ovr}</td>
                        <td className="text-end"><PotDisplay player={p} /></td>
                        <td>
                          {r.tid === null ? (
                            <span className="text-muted">Free agent</span>
                          ) : (
                            <>
                              <ClubLink tid={r.tid} />
                              {r.academy && <span className="text-muted small"> Academy</span>}
                              <br />
                              <span className="text-muted small">{r.compName}</span>
                            </>
                          )}
                        </td>
                        <td className="text-end text-nowrap">
                          {r.season && r.season.appearances > 0 ? (
                            <>
                              {r.season.appearances} app{r.season.appearances === 1 ? "" : "s"}
                              {" "}&middot; {r.season.goals}G {r.season.assists}A
                              <br />
                              <span className="text-muted small">
                                {r.season.avgRating.toFixed(2)} avg
                              </span>
                            </>
                          ) : (
                            <span className="text-muted">&mdash;</span>
                          )}
                        </td>
                        <td className="text-end text-nowrap">{formatWeeklyWage(p.contract.salary)}</td>
                        <td className="text-end">{seasonYear(p.contract.expiresSeason)}</td>
                        <td className="text-end text-nowrap">{currency.format(r.value)}</td>
                      </>
                    )}
                    <td className="small">
                      {r.own ? (
                        <span className="text-muted">Yours</span>
                      ) : r.tid === null ? (
                        <Link to="/free-agents">Sign him free</Link>
                      ) : r.notForSaleReason ? (
                        <span className="text-muted">{r.notForSaleReason}</span>
                      ) : (
                        <Link to="/transfers">Make an offer</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </ViewTableWrap>
        </>
      )}
    </div>
  );
}
