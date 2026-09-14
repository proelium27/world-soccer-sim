import type { ContinentalRegion } from "../../core/constants.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { competitionRegion } from "../../core/competitions.js";
import { REGION_LABELS, REGION_ORDER } from "../continents.js";

/*
 * The Europe / Americas switch on the world-wide lists (Power Rankings and the
 * all-time boards). The two continents play in separate competitions and the
 * world awards are built around Europe, so a single list mixing both reads as
 * one ladder when it is really two.
 */

/** Whether the world has a league in the Americas, i.e. whether a switch means anything. */
export function worldHasAmericas(league: Pick<LeagueStore, "competitions">): boolean {
  return league.competitions.some((c) => competitionRegion(c) === "americas");
}

/** The continent a page opens on: the user's club's, or Europe for a spectator. */
export function defaultRegion(league: LeagueStore): ContinentalRegion {
  const team = league.teams.find((t) => t.tid === league.meta.userTid);
  const comp = team && league.competitions.find((c) => c.id === team.compId);
  return comp ? competitionRegion(comp) : "europe";
}

export function RegionSwitch({
  value,
  onChange,
}: {
  value: ContinentalRegion;
  onChange: (region: ContinentalRegion) => void;
}) {
  return (
    <div className="btn-group segmented" role="group" aria-label="Choose a continent">
      {REGION_ORDER.map((r) => (
        <button
          key={r}
          type="button"
          className={`btn btn-outline-secondary btn-sm${r === value ? " active" : ""}`}
          aria-pressed={r === value}
          onClick={() => onChange(r)}
        >
          {REGION_LABELS[r]}
        </button>
      ))}
    </div>
  );
}
