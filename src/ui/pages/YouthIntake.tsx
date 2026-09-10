import { useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { PotHelp } from "../components/HelpHint.js";
import type { Player } from "../../core/players/types.js";
import { Flag } from "../components/Flag.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { WatchToggle } from "../components/WatchToggle.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { usePotentialView } from "../potentialView.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import { trialSigningsLeft } from "../../core/freeAgency.js";
import {
  academyFacilitiesBonus, ACADEMY_FACILITIES_MAX,
} from "../../core/players/academyFacilities.js";
import {
  ACADEMY_ROSTER_CAP, YOUTH_TRIAL_SIGN_LIMIT, SCOUTING_REGION_MAX,
  SCOUT_POSITION_MAX,
} from "../../core/constants.js";
import { PICKABLE_NATIONALITIES } from "../components/NationalityEditor.js";
import { POSITIONS } from "../../core/players/types.js";
import type { Position } from "../../core/players/types.js";
import { scoutDirectionsOf } from "../../core/scouting/scoutDirections.js";

type IntakeSortKey = "name" | "pos" | "ovr" | "pot";

/**
 * This year's youth trial group: the players your academy turned up, and the
 * decision about which of them get a contract.
 *
 * Replaces the old Incoming Talent page, which listed every unsigned under-22
 * in the world. That list existed only because AI clubs released ~85% of their
 * own youth intake every year and nothing signed it back, so it was a permanent
 * free supply of other clubs' wonderkids — see AI_PROSPECT_SLOTS. With clubs
 * keeping their own, the leftovers are genuinely leftovers and live on the Free
 * Agents page with everyone else nobody wanted.
 */
export function YouthIntake() {
  const { league, signTrialistAction, simming } = useLeague();
  const { sort, toggle } = useTableSort<IntakeSortKey>("pot", "desc");
  // A trialist has never been on the senior roster, so his POT is at maximum
  // fog — which is the whole reason picking five of twelve is a decision. This
  // table therefore sorts on the band the reader can see, never on the true
  // value: opening it sorted by the truth would have ranked the group in exact
  // order of who to sign.
  const potView = usePotentialView();

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  const trialPids = new Set(userTeam?.youthTrialists ?? []);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const trialists: Player[] = [...trialPids]
    .map((pid) => byPid.get(pid))
    .filter((p): p is Player => p != null);

  const left = userTeam ? trialSigningsLeft(userTeam) : 0;
  const academyFull = (userTeam?.academyRoster.length ?? 0) >= ACADEMY_ROSTER_CAP;
  const bonus = userTeam ? academyFacilitiesBonus(userTeam) : 0;

  const shown = sortRows(trialists, sort, {
    name: (p) => p.name,
    pos: (p) => p.pos,
    ovr: (p) => p.ovr,
    pot: (p) => potView.ceiling(p),
  });

  return (
    <div className="container-fluid p-3">
      <h4>Youth Intake</h4>
      <p className="text-muted" style={{ maxWidth: "48rem" }}>
        Every summer your academy turns up a group of 15-year-olds on trial. You can offer a
        contract to {YOUTH_TRIAL_SIGN_LIMIT} of them. Nobody here is signed until you say so, and
        whoever you haven't signed when the next season starts leaves for good, free for anyone
        else to pick up, so passing on the right one can come back to haunt you.
      </p>
      <p className="text-muted" style={{ maxWidth: "48rem" }}>
        How good the group is comes down to your academy's standing, how the club's been finishing,
        and two things you control directly: what you spend on scouting, and how much buzz there is
        around the club. Right now that's worth <strong>+{bonus.toFixed(1)}</strong> of a possible
        +{ACADEMY_FACILITIES_MAX.toFixed(1)}. Their ceilings are estimates, same as anywhere else,
        and better scouting narrows them.
      </p>

      <ScoutDirections />

      {trialists.length === 0 ? (
        <p>
          No trialists right now. Your next group turns up in the offseason. In the meantime, the{" "}
          <Link to="/academy">Academy</Link> page has the prospects you've already signed.
        </p>
      ) : (
        <>
          <div className={left > 0 ? "alert alert-info" : "alert alert-warning"}>
            {left > 0 ? (
              <>
                <strong>{left}</strong> contract{left === 1 ? "" : "s"} left to offer, from{" "}
                {trialists.length} still on trial.
              </>
            ) : academyFull ? (
              <>
                Your academy is full ({ACADEMY_ROSTER_CAP}/{ACADEMY_ROSTER_CAP}), so you can't sign
                anyone else this year. Release someone on the{" "}
                <Link to="/academy">Academy</Link> page to make room.
              </>
            ) : (
              <>
                You've offered all {YOUTH_TRIAL_SIGN_LIMIT} contracts for this intake. Whoever's
                still on trial will leave when the season starts.
              </>
            )}
          </div>

          <table className="table table-striped table-sm">
            <thead>
              <tr>
                {/* The star column Incoming Talent carried, kept on the page
                    that replaced it: a trialist you decline becomes a free
                    agent, so following him is exactly what a watchlist is for. */}
                <th></th>
                <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
                <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
                <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">OVR</SortableTh>
                <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">POT <PotHelp /></SortableTh>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
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
                  <td className="text-end">
                    <div className="d-inline-flex gap-1">
                      <button
                        className="btn btn-sm btn-primary text-nowrap"
                        disabled={simming || left <= 0}
                        title={left <= 0 ? "No contracts left to offer this year" : undefined}
                        onClick={() => signTrialistAction(p.pid)}
                      >
                        Offer contract
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * "Send your scouts here": up to SCOUTING_REGION_MAX countries the academy
 * goes looking in, which supply most of next summer's trial group between them.
 *
 * Deliberately says what it does NOT do — the scouts find you different
 * players, not better ones — because a control sitting next to a quality bonus
 * invites exactly that reading, and a player who believed it would be tuning
 * something that cannot move. What it genuinely changes is who can cap them,
 * which is the reason to care.
 */
/** One removable chip in a directions row. */
function Chip(
  { label, flag, onRemove, disabled }:
  { label: string; flag?: string; onRemove: () => void; disabled: boolean },
) {
  return (
    <span className="badge text-bg-secondary d-inline-flex align-items-center gap-1">
      {flag ? <Flag nationality={flag} /> : null} {label}
      <button
        type="button"
        className="btn-close btn-close-white ms-1"
        style={{ fontSize: "0.6em" }}
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={onRemove}
      />
    </span>
  );
}

/**
 * What the user has told his youth scouts: where to look, and which positions
 * to look for.
 *
 * **The two deliberately do not reach equally far, and the copy says so rather
 * than glossing it.** Where they look is re-drawn over the whole trial group,
 * because nationality decides a name and an international eligibility and
 * nothing else, so it can be relabelled after the fact for free. Which
 * positions they look for can only shape the players the scouts themselves turn
 * up: a position changes how a player is generated, and the rest of the group
 * is generated on the shared rng, where a different draw would re-roll every
 * club in the world. Saying "most of the group" is honest and costs nothing;
 * implying all of it would be a promise the numbers don't keep.
 */
function ScoutDirections() {
  const { league, setScoutDirectionsAction, simming } = useLeague();
  const [open, setOpen] = useState(false);
  if (!league) return null;

  const team = league.teams.find((t) => t.tid === league.meta.userTid);
  const { regions, positions } = scoutDirectionsOf(team);
  const countriesFull = regions.length >= SCOUTING_REGION_MAX;
  const positionsFull = positions.length >= SCOUT_POSITION_MAX;

  const setRegions = (next: string[]) => void setScoutDirectionsAction({ regions: next });
  const setPositions = (next: Position[]) => void setScoutDirectionsAction({ positions: next });

  return (
    <div className="card mb-3">
      <div className="card-body py-2">
        <div className="d-flex align-items-center gap-2 mb-2">
          <strong>Scout directions</strong>
          <span className="text-muted small">for next summer's intake</span>
          <button
            type="button"
            className="btn btn-sm btn-link text-decoration-none ms-auto"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "What does this do?"}
          </button>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <span className="text-muted" style={{ minWidth: "6.5rem" }}>Countries</span>
          {regions.length === 0 && (
            <span className="text-muted fst-italic">anywhere close to home</span>
          )}
          {regions.map((c) => (
            <Chip
              key={c}
              label={c}
              flag={c}
              disabled={simming}
              onRemove={() => setRegions(regions.filter((x) => x !== c))}
            />
          ))}
          {!countriesFull && (
            <select
              className="form-select form-select-sm w-auto"
              value=""
              disabled={simming}
              onChange={(e) => e.target.value && setRegions([...regions, e.target.value])}
              aria-label="Add a country to scout"
            >
              <option value="">Add a country...</option>
              {PICKABLE_NATIONALITIES.filter((c) => !regions.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="text-muted" style={{ minWidth: "6.5rem" }}>Positions</span>
          {positions.length === 0 && (
            <span className="text-muted fst-italic">whoever they turn up</span>
          )}
          {positions.map((pos) => (
            <Chip
              key={pos}
              label={pos}
              disabled={simming}
              onRemove={() => setPositions(positions.filter((x) => x !== pos))}
            />
          ))}
          {!positionsFull && (
            <select
              className="form-select form-select-sm w-auto"
              value=""
              disabled={simming}
              onChange={(e) => e.target.value && setPositions([...positions, e.target.value as Position])}
              aria-label="Add a position to scout for"
            >
              <option value="">Add a position...</option>
              {POSITIONS.filter((pos) => !positions.includes(pos)).map((pos) => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          )}
        </div>

        {open && (
          <div className="text-muted small mt-3" style={{ maxWidth: "48rem" }}>
            <p className="mb-2">
              All of this takes effect at your <em>next</em> intake, not the group below.
            </p>
            <p className="mb-2">
              <strong>Countries</strong> change where the whole group is from — up to{" "}
              {SCOUTING_REGION_MAX} of them, supplying most of it between them while the rest
              still comes from around your own league. Your scouts find you <em>different</em>{" "}
              players here, never better ones: where a kid is from decides his name and which
              country can pick him, and nothing else. That's the point of it, though, if you
              fancy stocking a national team with players you brought through yourself.
            </p>
            <p className="mb-0">
              <strong>Positions</strong> (up to {SCOUT_POSITION_MAX}) shape the ones your scouts
              actually go out and find, which is most of the group but not all of it — the handful
              your academy turned up on its own arrive as they are. It isn't a filter: ask for
              strikers and you'll get a lot of strikers, not eleven of them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
