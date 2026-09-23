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
 * `homePull = K × max(0, realShare − clubDomesticNow) × (1 − statureSensitivity(ovr))`
 *
 *  - **One constant, every league.** The pull is the club's gap below its
 *    league's real domestic share, so it is strongest for a club that has
 *    drifted furthest and fades to nothing at the real share (see `homeGap`).
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
import { squadStrength } from "../ai/clubContext.js";
import { HOME_PULL_FADE_RANGE } from "../constants.js";

/**
 * A club's country, how domestic its league really is, and how domestic the
 * club's own squad is right now.
 */
export interface HomeClub {
  country: string;
  domesticShare: number;
  /** Share of the club's current roster from its own country, [0,1]. */
  domesticNow: number;
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
 *  - **Outgrown his league**: attachment fades over HOME_PULL_FADE_RANGE points
 *    above what his country's best clubs field. A 78-rated American is a star
 *    in MLS and wants a bigger club; a 78-rated Englishman is an ordinary
 *    Premier League player with no reason to leave.
 *
 * The second was added after the first alone compressed the country ladder:
 * measured (20 seasons, seed 1), good Brazilians and Argentines rated in the
 * high 70s stayed home instead of being sold to Europe, and the gap from the
 * big four to Brazil fell 4.95 -> 1.09 and to Argentina 8.35 -> 2.06.
 */
export function homeAttachment(player: Player, club: HomeClub): number {
  const care = statureSensitivity(player.ovr);
  const outgrown = club.homeLevel === undefined
    ? 0
    : Math.max(0, Math.min(1, (player.ovr - club.homeLevel) / HOME_PULL_FADE_RANGE));
  return 1 - Math.max(care, outgrown);
}

/**
 * How far below its league's real domestic share this club sits, [0,1]. The
 * pull fades to nothing at the real share rather than pushing past it.
 *
 * A flat per-league pull was tried first and could not hit the targets:
 * measured (K = 6, 10 seasons), France overshot its real share by 18 points and
 * Serbia undershot by 11 at the same K, because how domestic a league settles
 * also depends on how many of its own players the world supplies. Scaling by
 * the club's own gap is what lets one constant land every league.
 */
export function homeGap(club: HomeClub): number {
  if (club.domesticShare >= 1) return 0;
  return Math.max(0, club.domesticShare - club.domesticNow) / (1 - club.domesticShare);
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
 * Every club's home country, league domestic share and current squad makeup,
 * built once per pass (one arrival barely moves a squad's share, and
 * recomputing per signing would be quadratic over the world).
 */
export function homeClubs(
  teams: readonly { tid: number; compId: number; roster: readonly number[] }[],
  competitions: readonly Competition[],
  players: readonly Player[],
): Map<number, HomeClub> {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  // Each country's level: the top quarter of its top flight, by squad strength.
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

  const byComp = new Map<number, { country: string; domesticShare: number }>();
  for (const c of competitions) byComp.set(c.id, { country: c.country, domesticShare: domesticShare(c) });
  const out = new Map<number, HomeClub>();
  for (const t of teams) {
    const h = byComp.get(t.compId);
    if (!h) continue;
    let home = 0;
    for (const pid of t.roster) if (byPid.get(pid)?.nationality === h.country) home++;
    out.set(t.tid, {
      ...h,
      domesticNow: t.roster.length > 0 ? home / t.roster.length : 0,
      homeLevel: levelOf.get(h.country),
    });
  }
  return out;
}

/** Rating points of home pull between this player and this club. */
export function homePull(player: Player, club: HomeClub | undefined, k: number): number {
  if (k === 0 || !club || player.nationality !== club.country) return 0;
  return k * homeGap(club) * homeAttachment(player, club);
}

/**
 * Home pull on a move between two clubs, as a multiplier on the buyer's
 * valuation: above 1 for a move home, below 1 for a move away from home, 1 when
 * neither club is in his country. The market-side form of `homePull`, used by
 * `moveAppealBetween` (transfers) and the loan market.
 *
 * `m` is HOME_PULL_MARKET: at 1, a squad player in a fully domestic league
 * would be valued twice as highly by a home club as by a foreign one. Stars feel
 * none of it (`1 − care`), so the weak leagues' upward sales of their best
 * players are untouched. Clamped at 0.
 */
export function homeAppeal(
  player: Player,
  from: HomeClub | undefined,
  to: HomeClub | undefined,
  m: number,
): number {
  if (m === 0) return 1;
  const side = (c: HomeClub | undefined) =>
    c && player.nationality === c.country ? homeGap(c) * homeAttachment(player, c) : 0;
  const diff = side(to) - side(from);
  if (diff === 0) return 1;
  return Math.max(0, 1 + m * diff);
}

/**
 * A soft foreign-player quota, club side and AI only: a club below its
 * league's real domestic share values a FOREIGN signing less, in proportion to
 * how far below it sits. Multiplies the buyer's valuation in the transfer and
 * loan markets; 1 for a home player, for a club at or above its share, and for
 * stars (`1 − care`), so the weak leagues' upward sales are untouched.
 *
 * Why it exists: `homeAppeal` only ever made home players MORE attractive, and
 * that plateaued (K 25 and 40 measured identical) with the most domestic leagues
 * still 10-13 points short, because nothing made a foreigner less attractive —
 * a club far below its share still bought and borrowed foreigners at full
 * value. Real leagues answer this with quotas (Argentina allows six foreigners
 * a squad); this is the soft version. `f` is HOME_PULL_FOREIGN.
 */
export function foreignDiscount(player: Player, to: HomeClub | undefined, f: number): number {
  if (f === 0 || !to || player.nationality === to.country) return 1;
  const gap = homeGap(to);
  if (gap === 0) return 1;
  return Math.max(0, 1 - f * (1 - statureSensitivity(player.ovr)) * gap);
}
