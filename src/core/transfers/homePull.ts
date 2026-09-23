/**
 * The facts about a club that a player's view of it reads: its country, how
 * domestic its league really is, the confederation it sits in, and the level its
 * country's best clubs field. Built once per pass (`homeClubs`) and carried on
 * `ClubContext.home`. The view itself is `clubAppealFor` (clubAppeal.ts); see
 * docs/club-reputation.md.
 *
 * All pure and rng-free.
 *
 * A league added in World setup can carry a country name that is not a
 * nationality at all; no player then matches it, so nobody feels at home there,
 * which is the honest answer.
 */
import type { Player } from "../players/types.js";
import type { Competition } from "../competitions.js";
import { competitionNationalities } from "../competitions.js";
import { LEAGUE_NATIONALITY_WEIGHTS } from "../players/nationalities.js";
import { confederationOf, type Confederation } from "../international/confederations.js";
import { statureSensitivity } from "./playerWill.js";
import { squadStrength } from "../ai/clubContext.js";
import { APPEAL_HOME_FADE_RANGE } from "../constants.js";

export interface HomeClub {
  country: string;
  /** The real domestic share of the club's league, [0,1] (`domesticShare`). */
  domesticShare: number;
  /** The confederation the club's country plays in; null if the game has none for it. */
  confederation: Confederation | null;
  /**
   * What the country's best top-flight clubs field: the mean squad strength
   * (`squadStrength`, the top-16 average) of the top quarter of its top flight.
   * A player above it has outgrown his home league. Optional so a hand-built
   * club need not carry it; absent means no one has outgrown it.
   */
  homeLevel?: number;
}

/**
 * How attached this player is to his home country, [0,1], judged at a club in
 * that country. 1 is a squad player happy at home; 0 is a player who moves on
 * ambition alone.
 *
 * Two ways to lose it, whichever is stronger:
 *  - **World-class** (`statureSensitivity`): the global star exemption. The
 *    weak leagues keep selling their best upward, the receipts they run on.
 *  - **Outgrown his league**: attachment fades over APPEAL_HOME_FADE_RANGE
 *    points above what his country's best clubs field. A 78-rated American is a
 *    star in MLS and wants a bigger club; a 78-rated Englishman is an ordinary
 *    Premier League player with no reason to leave (user call, 2026-09-22).
 *
 * The second was added after the first alone compressed the country ladder:
 * measured (20 seasons, seed 1, the first home-pull shape), good Brazilians and
 * Argentines rated in the high 70s stayed home instead of being sold to Europe,
 * and the gap from the big four to Brazil fell 4.95 -> 1.09.
 */
export function homeAttachment(player: Player, club: HomeClub): number {
  const care = statureSensitivity(player.ovr);
  const outgrown = club.homeLevel === undefined
    ? 0
    : Math.max(0, Math.min(1, (player.ovr - club.homeLevel) / APPEAL_HOME_FADE_RANGE));
  return 1 - Math.max(care, outgrown);
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

/**
 * Every club's `HomeClub`, built once per pass. A country's level is computed
 * from its top flight's current squads, so it follows the league as it rises or
 * falls over a dynasty rather than being fixed at generation.
 */
export function homeClubs(
  teams: readonly { tid: number; compId: number; roster: readonly number[] }[],
  competitions: readonly Competition[],
  players: readonly Player[],
): Map<number, HomeClub> {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const topFlightStrengths = new Map<string, number[]>();
  const tier1 = new Map(competitions.filter((c) => c.tier === 1).map((c) => [c.id, c.country]));
  for (const t of teams) {
    const country = tier1.get(t.compId);
    if (country === undefined) continue;
    const roster = t.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
    if (roster.length === 0) continue;
    const list = topFlightStrengths.get(country) ?? [];
    list.push(squadStrength(roster));
    topFlightStrengths.set(country, list);
  }
  const levelOf = new Map<string, number>();
  for (const [country, list] of topFlightStrengths) {
    const top = [...list].sort((a, b) => b - a).slice(0, Math.max(1, Math.round(list.length / 4)));
    levelOf.set(country, top.reduce((a, b) => a + b, 0) / top.length);
  }

  const byComp = new Map<number, HomeClub>();
  for (const c of competitions) {
    byComp.set(c.id, {
      country: c.country,
      domesticShare: domesticShare(c),
      confederation: confederationOf(c.country),
      homeLevel: levelOf.get(c.country),
    });
  }
  const out = new Map<number, HomeClub>();
  for (const t of teams) {
    const h = byComp.get(t.compId);
    if (h) out.set(t.tid, h);
  }
  return out;
}
