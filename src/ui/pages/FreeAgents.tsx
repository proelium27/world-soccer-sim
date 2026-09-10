import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import { freeAgentPids } from "../../core/freeAgency.js";
import type { Player, Position } from "../../core/players/types.js";
import { POSITIONS } from "../../core/players/types.js";
import { contractTerms } from "../../core/contracts.js";
import { formatWeeklyWage } from "../format.js";
import { Flag } from "../components/Flag.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { WatchToggle } from "../components/WatchToggle.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { usePotentialView } from "../potentialView.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import { ROSTER_CAP } from "../../core/constants.js";
import { clubStatures } from "../../core/ai/clubContext.js";
import { refusesFreeAgentSigningWith } from "../../core/transfers/playerWill.js";

const MAX_LISTED = 25;
// On the unfiltered "all positions" view, cap how many of any one position can
// appear so the list can't turn into a wall of a single position. The two
// low-slot positions (DM/AM, 2 roster slots each) structurally leak more good
// players into free agency than positions with 4 slots, so without this the
// top of the list is dominated by them. Pick a specific position to see its
// full depth chart, uncapped.
const PER_POSITION_CAP = 5;

type FaSortKey = "name" | "pos" | "ovr" | "pot" | "age";

/**
 * General free-agent signing: every unsigned player, any age.
 *
 * Used to exclude anyone at or under PROSPECT_AGE_MAX, who had their own
 * Incoming Talent page. That page existed because AI clubs released ~85% of
 * their youth intake every year and nothing signed it back, so the under-22
 * pool was a standing supply of other clubs' wonderkids worth browsing on its
 * own (see AI_PROSPECT_SLOTS). Clubs keep their own now, so what is left is
 * ordinary scrap-heap material and belongs on one list with everyone else
 * nobody wanted — the user's own youth comes from Youth Intake instead.
 */
export function FreeAgents() {
  const { league, signFreeAgentAction, simming } = useLeague();
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const { sort, toggle } = useTableSort<FaSortKey>("ovr", "desc");
  const potView = usePotentialView();
  // One pass per league rather than per row: the object form of the refusal
  // rebuilds a league-wide player index on every call, which on a 25-row table
  // over a 19,000-player pool is the quadratic case clubStatures warns about.
  const statures = useMemo(
    () => (league ? clubStatures(league.teams, league.players) : new Map<number, number>()),
    [league],
  );

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const faPids = freeAgentPids(league.teams, league.players, league.activeLoans);
  const availablePlayers: Player[] = league.players.filter((p) => faPids.has(p.pid));

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  const atCap = (userTeam?.roster.length ?? 0) >= ROSTER_CAP;
  // Wages are paid up front each season, so a mid-season signing charges the
  // contract's full season salary at signing; offseason signings are covered
  // by the next season-start charge.
  const midSeason = league.phase === "regular";

  // Pool: the top players by OVR + scouted ceiling (caps the render size).
  // Sorting below only reorders this shown set, so a re-sort never surfaces a
  // 40-ovr filler player.
  //
  // The ceiling rather than the true potential, and here that matters more than
  // it does for a column heading: this rule decides *who is listed at all*, so
  // ranking it on the truth would have handed the reader the genuinely best
  // free agents while the POT column beside them showed only an estimate.
  // Players who won't join sink below those who will, and this has to happen
  // BEFORE the MAX_LISTED cap rather than at render time. Refusals land exactly
  // on the highest-rated players, so ranking on quality alone lets them eat the
  // whole list from the top and hide every signable player below the cut, on a
  // page with no pagination — verbatim the mistake CLAUDE.md records from the
  // loan-in panel, where the top 40 rows were refused every time. They are sunk
  // rather than dropped so the reason stays visible when there is room for it.
  const refusesFor = (p: Player) =>
    userTeam != null
    && refusesFreeAgentSigningWith(p, statures.get(userTeam.tid) ?? 0, statures, userTeam.tid);
  availablePlayers.sort((a, b) =>
    Number(refusesFor(a)) - Number(refusesFor(b))
    || b.ovr + potView.ceiling(b) - (a.ovr + potView.ceiling(a)));
  const filtered =
    posFilter === "ALL"
      ? availablePlayers
      : availablePlayers.filter((p) => p.pos === posFilter);
  // Select the shown set first (by OVR+POT): the "all positions" view diversifies
  // by capping each position; a specific position is already narrowed, so show its
  // depth uncapped. The column sort below only reorders this already-selected set,
  // so a re-sort never surfaces a filler player past the caps.
  let pool: Player[];
  if (posFilter === "ALL") {
    const perPos = new Map<Position, number>();
    pool = [];
    for (const p of filtered) {
      if (pool.length >= MAX_LISTED) break;
      const used = perPos.get(p.pos) ?? 0;
      if (used >= PER_POSITION_CAP) continue;
      perPos.set(p.pos, used + 1);
      pool.push(p);
    }
  } else {
    pool = filtered.slice(0, MAX_LISTED);
  }
  const shownPlayers = sortRows(pool, sort, {
    name: (p) => p.name,
    pos: (p) => p.pos,
    ovr: (p) => p.ovr,
    pot: (p) => potView.ceiling(p),
    age: (p) => league.season - p.born,
  });

  return (
    <div className="container-fluid p-3">
      <h4>
        Free Agents
        <HelpHint>
          Unsigned players you can add on a free transfer (no fee), at a wage based on their
          rating. Released veterans and youngsters nobody kept both end up here. Your own academy's
          crop is on the Youth Intake page. A free transfer still has to appeal to the player:
          someone who was a regular at a much bigger club won't drop to you just because there's no
          fee, so build the club up and he'll take the call.
        </HelpHint>
      </h4>
      {atCap && (
        <div className="alert alert-warning">
          Your roster is full ({ROSTER_CAP}/{ROSTER_CAP}). Release a player before signing another.
        </div>
      )}
      <div className="mb-3 d-flex flex-wrap gap-2 align-items-center">
        <label htmlFor="fa-pos" className="text-muted small mb-0">Position</label>
        <select
          id="fa-pos"
          className="form-select form-select-sm w-auto"
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value as Position | "ALL")}
        >
          <option value="ALL">All positions</option>
          {(POSITIONS as readonly Position[]).map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </div>
      {availablePlayers.length === 0 ? (
        <p>No available players.</p>
      ) : filtered.length === 0 ? (
        <p>No available players at {posFilter}.</p>
      ) : (
        <>
        <p className="text-muted">
          {posFilter === "ALL"
            ? `Showing the top ${shownPlayers.length} across every position (up to ${PER_POSITION_CAP} per position so one spot can't crowd out the rest) of ${availablePlayers.length} free agents by OVR + POT. Pick a position to see its full list.`
            : `Showing top ${shownPlayers.length} of ${filtered.length} ${posFilter}s by OVR + POT.`}
        </p>
        <table className="table table-striped table-sm">
          <thead>
            <tr>
              <th></th>
              <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
              <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
              <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">OVR</SortableTh>
              <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">POT <PotHelp /></SortableTh>
              <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Age</SortableTh>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shownPlayers.map((p) => {
              const terms = contractTerms(p, league.season);
              const unaffordable = midSeason && terms.salary > (userTeam?.budget ?? 0);
              // Shown rather than hidden, so the reason a good player is out of
              // reach is legible instead of the list just being mysteriously
              // short — same call the Transfers page makes for a protected star.
              // Sunk to the bottom of the selection above so they can't crowd
              // signable players past the render cap.
              const refuses = refusesFor(p);
              return (
                <tr key={p.pid}>
                  <td><WatchToggle pid={p.pid} name={p.name} /></td>
                  <td>
                    <PlayerRatingsTooltip player={p}>
                      <Link to={`/player/${p.pid}`}>{p.name}</Link>
                    </PlayerRatingsTooltip>{" "}
                    <Flag nationality={p.nationality} />
                  </td>
                  <td>{p.pos}</td>
                  <td className="text-end">{p.ovr}</td>
                  <td className="text-end"><PotDisplay player={p} /></td>
                  <td className="text-end">{league.season - p.born}</td>
                  <td className="text-end">
                    {refuses ? (
                      <span className="text-muted small text-nowrap">
                        Won&apos;t drop to your level
                      </span>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary text-nowrap"
                        disabled={simming || atCap || unaffordable}
                        title={
                          unaffordable
                            ? "Mid-season signings charge the season's wages up front"
                            : undefined
                        }
                        onClick={() => signFreeAgentAction(p.pid)}
                      >
                        Sign {terms.lengthSeasons}y &middot; {formatWeeklyWage(terms.salary)}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}
