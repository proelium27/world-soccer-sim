import type { Player } from "../../core/players/types.js";
import { usePotentialView } from "../potentialView.js";

const FOG_TITLE =
  "Scouting estimate. Sharpens with your scouting spend and how long the player has been on your senior roster.";

/**
 * Renders a player's potential the way the *user* perceives it: an exact
 * number once fully scouted, otherwise a low–high estimate band (see
 * src/core/scouting/potentialFog.ts). Drop this in place of `p.potential` and
 * every POT display across the app stays consistent.
 *
 * The fog itself lives in {@link usePotentialView}, shared with the player
 * database's POT sort — a table that ordered rows by the true value while
 * showing a band here would leak the hidden number without showing it.
 */
export function PotDisplay({ player }: { player: Player }) {
  const fog = usePotentialView().fogOf(player);
  if (!fog) return <>{player.potential}</>;
  return (
    <span title={FOG_TITLE} className="scouting-estimate">
      {fog.low}&ndash;{fog.high}
    </span>
  );
}
