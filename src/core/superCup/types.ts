import type { CupTie } from "../cup/types.js";

/** Which super cup a tie belongs to. */
export type SuperCupCompetitionId = "domestic" | "continental" | "intercontinental";

/**
 * Why a club is in a super cup. Kept on the record rather than re-derived,
 * because the answer is a fact about the season that seeded it and the tables
 * it came from are two clicks away by the time anything renders this — and
 * because "league runners-up" is only ever true as a *consequence* of the
 * double rule, which nothing downstream could otherwise reconstruct.
 */
export type SuperCupRoute =
  | "league-champions"
  | "cup-winners"
  | "league-runners-up"
  | "continental-cup"
  | "continental-shield"
  | "americas-cup";

/**
 * One super cup: a single match between the previous season's two headline
 * winners, played in the preseason before a ball is kicked in anger.
 *
 * Two flavours, by `competition`:
 *  - **domestic** — one per country, its league champion against its domestic
 *    cup winner. When one club won both (a double) the league runner-up steps
 *    in, which is what the FA Community Shield does; see `buildSuperCups`.
 *  - **continental** — exactly one in the world, the Continental Cup winner
 *    against the Continental Shield winner.
 *  - **intercontinental** — exactly one in the world, the Continental Cup
 *    winner against the Americas Cup winner: the FIFA Intercontinental Cup's
 *    "Derby of the Americas" and final rolled into a single match.
 *
 * **Played at a neutral venue and worth no money.** The neutrality is real
 * football (Wembley, Istanbul) and happens to be free here — `resolveCupTie`
 * already takes the flag. The prize money is the load-bearing one: the domestic
 * cups shipped at zero because a 4-seed/20-season audit put two seeds into
 * deficit with real prizes while every strength check stayed green, and a super
 * cup credits the same weak clubs on the same thin margins. At zero this
 * competition touches nothing — see `playSuperCups` for the full argument.
 *
 * Box scores are deliberately **never** kept, matching the promotion playoff:
 * the world plays one of these per country every single season and a save keeps
 * its history forever, so the scoreline is the record.
 */
export interface SuperCupTie {
  competition: SuperCupCompetitionId;
  /**
   * The season this opens — i.e. the *new* one. The winners that contest it
   * were decided in season − 1, which is the same offset the Continental Cup
   * carries between its qualifiers and the season it is played in.
   */
  season: number;
  /** Domestic only: the country whose champions these are. */
  country?: string;
  /** Domestic only: the top flight it belongs to, for filing it by league. */
  compId?: number;
  /** Display name, e.g. "English Champions Cup". */
  name: string;
  /**
   * The two contestants, index-aligned with `routes`. Listed champions first;
   * the venue is neutral, so neither position carries a home advantage and the
   * order is presentational only.
   */
  teams: [number, number];
  routes: [SuperCupRoute, SuperCupRoute];
  /** The completed match, or null while it is still pending. `boxScore` is always null. */
  tie: CupTie | null;
}

/** Who lifted it, or null while the match is still to be played. */
export function superCupChampion(sc: SuperCupTie): number | null {
  return sc.tie?.winner ?? null;
}
