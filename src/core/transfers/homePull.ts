/**
 * Home-country pull: how much more a club values a player from its own country,
 * in rating points. See docs/club-reputation.md.
 *
 * It exists because nothing else in the sim looks at nationality after
 * generation. Free agency, the transfer market and loans all ranked purely on
 * rating, so every league drifted toward the world's average mix — measured on
 * a fresh 898-club world, Argentina's top flight went 85% domestic at
 * generation to 30% after five seasons, Serbia's 64% to 16%.
 *
 * `homePull = K × domesticShare(country) × (1 − statureSensitivity(ovr))`
 *
 *  - **One constant, fourteen targets.** Scaling by the league's own real
 *    domestic share lets a single `K` pull Argentina (0.84) far harder than
 *    Scotland (0.36), because the target is already per country.
 *  - **Stars are exempt.** `1 − care` is 0 at `PLAYER_WILL_CARE_CEILING`, so an
 *    elite player still moves on ambition alone, and the weak leagues keep
 *    selling their best upward — the transfer receipts they run on.
 *  - **Pure and rng-free.** A string compare, then arithmetic. It is only
 *    evaluated after the compare matches, so the free-agency loop — which
 *    re-scans the pool per shortfall slot across every club — stays cheap.
 *
 * A league added in World setup can carry a country name that is not a
 * nationality at all; no player then matches it and it gets no pull, which is
 * the honest answer.
 */
import type { Player } from "../players/types.js";
import type { Competition } from "../competitions.js";
import { competitionNationalities } from "../competitions.js";
import { LEAGUE_NATIONALITY_WEIGHTS } from "../players/nationalities.js";
import { statureSensitivity } from "./playerWill.js";

/** A club's country and how domestic its league really is. */
export interface HomeClub {
  country: string;
  domesticShare: number;
}

/**
 * The domestic share of a competition's own nationality table (its custom
 * table if it carries one, else the shipped one for its country). 0 when the
 * country is not a key in either — see the module note.
 */
export function domesticShare(comp: Competition): number {
  const table = competitionNationalities(comp) ?? LEAGUE_NATIONALITY_WEIGHTS[comp.country];
  if (!table) return 0;
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  return total > 0 ? (table[comp.country] ?? 0) / total : 0;
}

/** Every club's home country and domestic share, built once per pass. */
export function homeClubs(
  teams: readonly { tid: number; compId: number }[],
  competitions: readonly Competition[],
): Map<number, HomeClub> {
  const byComp = new Map<number, HomeClub>();
  for (const c of competitions) byComp.set(c.id, { country: c.country, domesticShare: domesticShare(c) });
  const out = new Map<number, HomeClub>();
  for (const t of teams) {
    const h = byComp.get(t.compId);
    if (h) out.set(t.tid, h);
  }
  return out;
}

/** Rating points of home pull between this player and this club. */
export function homePull(player: Player, club: HomeClub | undefined, k: number): number {
  if (k === 0 || !club || player.nationality !== club.country) return 0;
  return k * club.domesticShare * (1 - statureSensitivity(player.ovr));
}
