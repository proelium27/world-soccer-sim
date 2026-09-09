import type { Player } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { ClubContext } from "../ai/clubContext.js";
import { clubStature } from "../ai/clubContext.js";
import {
  PLAYER_WILL_CARE_FLOOR, PLAYER_WILL_CARE_CEILING,
  PLAYER_WILL_DROP_STRENGTH, PLAYER_WILL_REFUSAL_DROP, PLAYER_WILL_RISE_BONUS,
  PLAYER_SETTLED_BONUS, PLAYER_SETTLED_SEASONS,
  STATURE_STRENGTH_HI,
} from "../constants.js";

/**
 * The player's own say in a transfer.
 *
 * Every valuation in the sim is a *club's* view of a player. That is only half
 * of a real transfer, and leaving out the other half produced the single worst
 * realism bug in the game: because club valuation keys off how much a player
 * would upgrade the buyer, the clubs that valued a superstar most were always
 * the weakest ones in the world, so stars poured downhill into small clubs.
 * Football has no salary cap to justify that (basketball does — cap space
 * really can send a star to a small market), so this module supplies the
 * missing constraint: a good player will not drop down, whatever the money.
 *
 * Two independent frictions live here:
 *   - `moveAppeal`, whether he fancies the destination at all, and
 *   - `settledMultiplier`, how hard he is to move again having just arrived.
 *
 * Both are pure functions of state — no rng draw of any kind — so they can be
 * called anywhere in the market without disturbing the shared RNG stream order
 * the sim's determinism depends on.
 */

/** Clamp into [0,1]. */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * How much this player weighs club stature at all, [0,1]. A squad filler will
 * go wherever there's a game; a genuine star cares enormously. Ramps between
 * PLAYER_WILL_CARE_FLOOR and PLAYER_WILL_CARE_CEILING.
 */
export function statureSensitivity(playerOvr: number): number {
  return clamp01(
    (playerOvr - PLAYER_WILL_CARE_FLOOR) /
      (PLAYER_WILL_CARE_CEILING - PLAYER_WILL_CARE_FLOOR),
  );
}

/**
 * Would this player flatly refuse to join `toStature`, coming from `fromStature`?
 * A step down bigger than PLAYER_WILL_REFUSAL_DROP (scaled by how much he cares)
 * is a non-starter at any price — this is the hard gate that keeps a
 * world-class player out of a small club entirely rather than merely making him
 * expensive.
 */
export function refusesMove(playerOvr: number, fromStature: number, toStature: number): boolean {
  const care = statureSensitivity(playerOvr);
  if (care <= 0) return false;
  const drop = fromStature - toStature;
  return drop > PLAYER_WILL_REFUSAL_DROP / care;
}

/**
 * Multiplier applied to a buying club's valuation to account for whether the
 * player actually wants the move: ~0 for a step down he'd refuse, <1 for one he
 * merely dislikes, slightly >1 for a real step up (ambition helps a deal along).
 *
 * Applied to the *buyer's* value rather than as a separate veto so it flows
 * naturally through the rest of the market: a reluctant target's valuation
 * falls below the seller's reservation and the deal simply never assembles,
 * and a grudging move doesn't get bid up into a headline fee.
 */
export function moveAppeal(playerOvr: number, fromStature: number, toStature: number): number {
  const care = statureSensitivity(playerOvr);
  if (care <= 0) return 1;
  if (refusesMove(playerOvr, fromStature, toStature)) return 0;

  const delta = toStature - fromStature;
  if (delta >= 0) return 1 + care * PLAYER_WILL_RISE_BONUS * delta;
  return Math.max(0, 1 - care * PLAYER_WILL_DROP_STRENGTH * -delta);
}

/**
 * Would this player refuse to join `buyer`, leaving `seller`? The club-object
 * form, for one-off checks (a single user offer, or explaining a target in the
 * UI) that don't already have a derived ClubContext to hand.
 *
 * Applies to the user exactly as it does to an AI club. A superstar has no more
 * reason to drop into a struggling side because a human picked it, and exempting
 * the user would hand them the very exploit this module exists to close.
 */
export function refusesMoveToClub(
  player: Player,
  seller: StoredTeam,
  buyer: StoredTeam,
  players: Player[],
): boolean {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const rosterOf = (t: StoredTeam): Player[] =>
    t.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
  return refusesMove(
    player.ovr,
    clubStature(rosterOf(seller), seller.hype),
    clubStature(rosterOf(buyer), buyer.hype),
  );
}

/**
 * The tid of the last club this player was on the books at, or null if he has
 * never been on any.
 *
 * `SeasonStats.tid` is the only place a *departure* into free agency is written
 * down. `league.transfers` deliberately records free-agent arrivals and not
 * releases (see negotiation.ts), so the transfer log cannot answer this — but
 * `accumulateStats` opens a row for every player in a matchday squad, appearance
 * or not, which makes the stats array the game's per-season record of who he
 * belonged to.
 */
export function lastClubTid(player: Player): number | null {
  const stats = player.stats ?? [];
  return stats.length > 0 ? stats[stats.length - 1].tid : null;
}

/**
 * The stature a player's own ability entitles him to, on the same 0..1 scale
 * `clubStature` produces — his rating normalized against the band a club's
 * squad strength is normalized against.
 *
 * Needed because the club he last played for is NOT a sufficient measure of
 * what he'll accept, and measuring proved it: on the save that prompted this,
 * an 85-rated free agent had last played for a club of stature 0.158, so
 * joining a second-division side was a step *up* and nothing gated it. Good
 * players sit at small clubs all the time, especially in a world where the
 * pool is stocked by clubs releasing whoever they are deepest at.
 *
 * **The band is an individual's, not a squad's, and getting that wrong is the
 * easy mistake here.** `clubStature` normalizes a club's top-16 MEAN against
 * STATURE_STRENGTH_LO..HI; feeding one player's rating through that same band
 * systematically overstates him, because a squad averaging 89 contains players
 * well above 89. Measured, it put an ovr-95 free agent at a flat 1.0, which no
 * club in the world can clear — nobody could sign him at all.
 *
 * So it runs from the rating at which a player starts caring where he plays up
 * to the top of the squad-strength band, where an individual really does belong
 * at the best club there is. Both ends are taken BY REFERENCE from the
 * constants that already state those two things, so the relationship survives a
 * retune of either rather than silently drifting. (They currently make this
 * numerically identical to `statureSensitivity`, which reads well — how much he
 * cares and how high he expects to be are the same ramp — but that is a
 * consequence, not the definition.)
 *
 * Deliberately the top of what his ability implies rather than the median club
 * that employs players of his rating (measured at ~0.43 for an 85). This is a
 * hard gate against skipping the ladder, and it should key off what he *is*,
 * not off where players of his standard happen to have washed up in a world
 * whose market has been leaving them lying around.
 */
export function abilityStature(playerOvr: number): number {
  return clamp01(
    (playerOvr - PLAYER_WILL_CARE_FLOOR) / (STATURE_STRENGTH_HI - PLAYER_WILL_CARE_FLOOR),
  );
}

/**
 * What a free agent measures an offer against: the higher of where he last
 * played and what his ability entitles him to.
 *
 * The max is the load-bearing part. Either half alone has a hole: his last club
 * misses the 85 who was at a small club, and his ability alone would ignore a
 * modest player who has spent a career at a giant.
 */
function freeAgentFromStature(player: Player, lastClub: number | null): number {
  const ability = abilityStature(player.ovr);
  return lastClub == null ? ability : Math.max(lastClub, ability);
}

/**
 * Would this free agent turn down a move to `buyer`?
 *
 * `signFreeAgent` used to skip the player-will module entirely, which made a
 * free transfer the one route around a gate this file's own header calls the
 * fix for "the single worst realism bug in the game": a player who would flatly
 * refuse to be *bought* by a club would happily *sign* for it, so a third-tier
 * side could assemble a top-flight squad for nothing. The pool is stocked by
 * `trimRosterSurplus`, which releases whoever a club is deepest at rather than
 * whoever is bad, so the players sitting in it are routinely better than the
 * club shopping for them.
 *
 * `from` is `freeAgentFromStature` — the higher of the club that released him
 * and what his own ability entitles him to. Measuring the last club alone was
 * tried first and leaks badly; see that function.
 *
 * A player at `statureSensitivity` 0 always passes: a squad filler goes
 * wherever there is a game, which is the care ramp doing its job rather than a
 * special case.
 *
 * Pure, no rng draw. `refusesMoveToClub`'s note applies unchanged: this binds
 * the user exactly as it binds an AI club.
 */
export function refusesFreeAgentSigning(
  player: Player,
  buyer: StoredTeam,
  teams: StoredTeam[],
  players: Player[],
): boolean {
  // Checked before the roster indexes are built: most of a real pool is below
  // the care floor, and this is on the click path of a page listing thousands.
  if (statureSensitivity(player.ovr) <= 0) return false;
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const rosterOf = (t: StoredTeam): Player[] =>
    t.roster.map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
  const lastTid = lastClubTid(player);
  const last = lastTid == null ? undefined : teams.find((t) => t.tid === lastTid);
  const from = freeAgentFromStature(
    player, last ? clubStature(rosterOf(last), last.hype) : null,
  );
  return refusesMove(player.ovr, from, clubStature(rosterOf(buyer), buyer.hype));
}

/**
 * `refusesFreeAgentSigning` against a precomputed stature map.
 *
 * The club-object form above rebuilds a league-wide player index on every call,
 * so a per-row loop over a listing page is quadratic — the same trap
 * `clubStatures` exists to let callers avoid. Build the map once per league and
 * use this per row.
 *
 * A last club the map doesn't know (a tid no longer in the world) reads as no
 * gate, matching the object form.
 */
export function refusesFreeAgentSigningWith(
  player: Player,
  buyerStature: number,
  statureByTid: Map<number, number>,
): boolean {
  if (statureSensitivity(player.ovr) <= 0) return false;
  const lastTid = lastClubTid(player);
  const from = freeAgentFromStature(
    player, lastTid == null ? null : statureByTid.get(lastTid) ?? null,
  );
  return refusesMove(player.ovr, from, buyerStature);
}

/** `moveAppeal` for a concrete pair of clubs. */
export function moveAppealBetween(
  player: Player,
  from: ClubContext,
  to: ClubContext,
): number {
  return moveAppeal(player.ovr, from.stature, to.stature);
}

/**
 * Keep-value multiplier for how recently the player joined: a man who has only
 * just signed is much harder to prise away again. Decays linearly from
 * 1 + PLAYER_SETTLED_BONUS in the season he arrives to 1.0 after
 * PLAYER_SETTLED_SEASONS.
 *
 * `joinedSeason` is undefined for a player who has never moved (an academy
 * graduate, or anyone predating the transfer log), which is treated as fully
 * settled — a homegrown player is not a flight risk.
 */
export function settledMultiplier(
  joinedSeason: number | undefined,
  season: number,
): number {
  if (joinedSeason === undefined) return 1;
  const elapsed = season - joinedSeason;
  if (elapsed >= PLAYER_SETTLED_SEASONS || elapsed < 0) return 1;
  const remaining = 1 - elapsed / PLAYER_SETTLED_SEASONS;
  return 1 + PLAYER_SETTLED_BONUS * remaining;
}

/**
 * Season each player last arrived at his current club, derived from the
 * transfer log. Free-agent arrivals (the FREE_AGENT_TID sentinel) count — a
 * player who just signed on a free is every bit as newly-arrived — but loan
 * moves and loan returns do not, since they don't change who owns him.
 *
 * Derived rather than persisted so old saves get it for free and there is no
 * new field to migrate.
 */
export function joinedSeasons(
  transfers: readonly {
    pid: number;
    season: number;
    loanSeasons?: number;
    loanReturn?: boolean;
  }[],
): Map<number, number> {
  const joined = new Map<number, number>();
  for (const t of transfers) {
    if (t.loanSeasons || t.loanReturn) continue;
    const prev = joined.get(t.pid);
    if (prev === undefined || t.season > prev) joined.set(t.pid, t.season);
  }
  return joined;
}
