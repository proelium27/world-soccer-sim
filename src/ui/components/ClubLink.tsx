import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { ClubCrest } from "./ClubCrest.js";
import { seasonYear } from "../format.js";

/**
 * A club, rendered as a link to what it did in one season.
 *
 * Every in-league surface that names a club goes through this, for two reasons.
 * A club name is only ever meaningful *in a season* — the same tid is a
 * champion one year and relegated the next — so the season the caller already
 * has to hand is what makes the link worth following. And a shared component is
 * the only way fourteen-odd call sites can't drift on the two edge cases: the
 * free-agent sentinel (FREE_AGENT_TID, which is not a club and must never
 * render as "Team -1" pointing at a page that can't exist) and a tid the save
 * no longer knows.
 *
 * Both of those degrade to plain text rather than a dead link.
 *
 * **Pass `crest` rather than wrapping this in your own span.** Several of these
 * surfaces already drew a flex wrapper around a crest and a name; putting an
 * anchor *inside* that wrapper adds one element per club mention, and the club
 * mentions on this game's densest pages run into the thousands. Measured on the
 * News Feed of a two-season save, nesting cost 6,552 extra elements and ~690ms
 * of render (69.5k/2.8s to 76.1k/3.5s) — on a page whose whole known failure
 * mode is DOM weight (see the /transfers freeze in CLAUDE.md). Letting the
 * anchor *be* the wrapper is the same markup main already shipped, so linking
 * every club costs nothing.
 */
export function ClubLink({
  tid,
  season,
  variant = "name",
  crest = false,
  crestSize = 18,
  className,
  title,
  linked = true,
}: {
  tid: number;
  /**
   * The season this mention belongs to. Omit on a surface with no season in
   * context (a live standings table, today's roster) and it points at the
   * season being played.
   */
  season?: number;
  /** `abbrev` for the three-letter form used in dense tables. */
  variant?: "name" | "abbrev";
  /** Draw the club's crest ahead of the label. */
  crest?: boolean;
  crestSize?: number;
  className?: string;
  title?: string;
  /**
   * Set false to render the club as plain text. For the caller who knows the
   * season it is naming has no page behind it — see `hasClubSeason` — which
   * should still show the club's name, just without offering a dead trip.
   */
  linked?: boolean;
}) {
  const { league } = useLeague();

  if (isFreeAgentTid(tid)) return <>Free agent</>;

  const team = league?.teams.find((t) => t.tid === tid);
  // A club God Mode folded is gone from `teams` but still named in history.
  const folded = team ? undefined : league?.defunctTeams?.find((d) => d.tid === tid);
  const known = team ?? folded;
  const label = known
    ? variant === "abbrev"
      ? known.abbrev
      : known.name
    : variant === "abbrev"
      ? "???"
      : "Unknown";

  const body = crest ? (
    <>
      <ClubCrest tid={tid} colors={known?.colors ?? ["#888888", "#888888"]} size={crestSize} />{" "}
      {label}
    </>
  ) : (
    label
  );

  // No league loaded, or a club this save has no record of: the page would have
  // nothing to show, so don't offer the trip.
  if (!league || !team || !linked) {
    const why = folded ? `Folded after ${seasonYear(folded.lastSeason)}` : undefined;
    return <span className={className} title={title ?? why}>{body}</span>;
  }

  return (
    <Link
      to={`/club/${tid}/${season ?? league.season}`}
      className={className ?? "text-decoration-none"}
      title={title}
    >
      {body}
    </Link>
  );
}
