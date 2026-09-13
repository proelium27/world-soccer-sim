import { useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { Flag } from "./Flag.js";
import { PICKABLE_NATIONALITIES } from "./NationalityEditor.js";
import { SCOUTING_REGION_MAX, SCOUT_POSITION_MAX } from "../../core/constants.js";
import { POSITIONS } from "../../core/players/types.js";
import type { Position } from "../../core/players/types.js";
import { scoutDirectionsOf } from "../../core/scouting/scoutDirections.js";

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
 * to look for. Lives on the Academy page, since the kids it shapes join the
 * academy directly.
 *
 * **The two deliberately do not reach equally far, and the copy says so rather
 * than glossing it.** Where they look is re-drawn over the whole yearly intake,
 * because nationality decides a name and an international eligibility and
 * nothing else, so it can be relabelled after the fact for free. Which
 * positions they look for can only shape the kids the scouts themselves turn
 * up: a position changes how a player is generated, and the rest of the intake
 * is generated on the shared rng, where a different draw would re-roll every
 * club in the world. Saying "most of them" is honest and costs nothing;
 * implying all of them would be a promise the numbers don't keep.
 *
 * Also deliberately says what it does NOT do — the scouts find you different
 * players, not better ones — because a control sitting next to a quality bonus
 * invites exactly that reading.
 */
export function ScoutDirections() {
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
              All of this takes effect at your <em>next</em> intake, not the kids already here.
            </p>
            <p className="mb-2">
              <strong>Countries</strong> change where the whole intake is from, up to{" "}
              {SCOUTING_REGION_MAX} of them, supplying most of it between them while the rest
              still comes from around your own league. Your scouts find you <em>different</em>{" "}
              players here, never better ones: where a kid is from decides his name and which
              country can pick him, and nothing else. That's the point of it, though, if you
              fancy stocking a national team with players you brought through yourself.
            </p>
            <p className="mb-0">
              <strong>Positions</strong> (up to {SCOUT_POSITION_MAX}) shape the kids your scouts
              actually go out and find, which is most of the intake but not all of it. The handful
              your academy turned up on its own arrive as they are. It isn't a filter: ask for
              strikers and you'll get a lot of strikers, not eleven of them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
