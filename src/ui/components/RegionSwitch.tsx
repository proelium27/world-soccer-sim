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

/** A continent, or both of them on one list. */
export type RegionView = ContinentalRegion | "both";

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

/** The continent filter a view passes to a ranking: none for "both". */
export function regionFilter(view: RegionView | undefined): ContinentalRegion | undefined {
  return view === "both" ? undefined : view;
}

export function RegionSwitch<T extends RegionView>({
  value,
  onChange,
  includeBoth = false,
}: {
  value: T;
  onChange: (region: T) => void;
  /** Offer a third button listing both continents together. */
  includeBoth?: boolean;
}) {
  const options = (includeBoth ? [...REGION_ORDER, "both"] : REGION_ORDER) as readonly T[];
  return (
    <div className="btn-group segmented" role="group" aria-label="Choose a continent">
      {options.map((r) => (
        <button
          key={r}
          type="button"
          className={`btn btn-outline-secondary btn-sm${r === value ? " active" : ""}`}
          aria-pressed={r === value}
          onClick={() => onChange(r)}
        >
          {r === "both" ? "Both" : REGION_LABELS[r as ContinentalRegion]}
        </button>
      ))}
    </div>
  );
}
