import type { Player, Position, SeasonStats } from "./players/types.js";
import {
  AWARD_MIN_APPEARANCES, AWARD_OVR_BASELINE, AWARD_OVR_WEIGHT,
  POTY_GOAL_WEIGHT, POTY_ASSIST_WEIGHT, TOTS_POSITION_WORK,
} from "./constants.js";

export type PositionGroup = "GK" | "DEF" | "MID" | "FWD";

/**
 * Which weight column an award scores a player under. The groups exist to price
 * end product by how hard it is to come by at that position — a defender's goal
 * is worth more than a striker's precisely because he gets so few.
 *
 * **AM is grouped with the forwards, not the midfielders (2026-08-14).** It
 * looks wrong next to the position's name and is right by the engine's own
 * numbers: an attacking midfielder is an attacker here. `SHOT_WEIGHTS.AM` is
 * 1.5 (against W's 2 and CM's 1) and `ASSIST_WEIGHTS.AM` is 3, the highest on
 * the pitch, so his output lands on the winger's side of the line rather than
 * the midfielder's. Measured over 8 seasons of a 240-club world, per player
 * season with 19+ appearances: AM 6.3 goals + 5.8 assists, W 7.9 + 5.6,
 * CM 4.3 + 5.4. AM and W are near enough the same player; AM and CM are not.
 *
 * Grouped as a midfielder he was paid MID rates (0.10/goal, 0.07/assist) for
 * winger production, a 25%/40% premium over the W beside him doing the same
 * job, which inflated attacking midfielders throughout the shortlists. Over
 * those same 8 seasons the correction moves the Ballon d'Or top ten from
 * 27 AM / 29 ST slots to 17 AM / 34 ST.
 *
 * Note what this does *not* fix: it changed none of the 8 winners. Those are
 * decided by the ovr terms (`AWARD_OVR_WEIGHT` + `WORLD_AWARD_OVR_WEIGHT`,
 * 0.20/point together), and elite ovr simply persists longer at AM than at ST
 * — a player who reaches 80 holds it for 3.1 seasons as an AM against 1.2 as a
 * striker, so the 80+ population is AM-heavy no matter how end product is
 * priced. That lives in `OVR_WEIGHTS` (ST is 35% physical/height, AM 8%), not
 * here, and moving it would retune every rating in every save.
 */
export function positionGroup(pos: Position): PositionGroup {
  switch (pos) {
    case "GK": return "GK";
    case "CB": case "FB": return "DEF";
    case "DM": case "CM": return "MID";
    case "AM": case "W": case "ST": return "FWD";
  }
}

/**
 * The eleven slots a Team of the Season is picked in.
 *
 * Deliberately its own list rather than FORMATIONS["4-3-3"], for two reasons.
 * A showcase XI never has to be a *fieldable* shape, so borrowing the sim's
 * formation table would let a future tactical retune silently reshape an award.
 * And the 4-3-3 has no AM slot at all, which made an attacking midfielder
 * structurally ineligible: he could win Player of the Season and never appear
 * in the XI. Measured over 6 seasons x 2 seeds x 16 competitions
 * (`scripts/totsSlotProbe.ts`), *every* AM who won Player of the Season missed
 * out — 14 of 14, two thirds of all misses — and swapping one CM slot for an
 * AM takes POTY-in-XI from 88.5% to 95.3%. 4-2-3-1 was the other candidate and
 * is worse (93.2%): it buys the AM slot with a CM slot, so CM winners start
 * missing instead (1 -> 5).
 *
 * Careful re-measuring those two figures, because changing this list shifts the
 * seeded RNG stream. `teamOfSeason` feeds `isProtectedStar`, and
 * `runAITransferMarket` skips a protected pid *before* that candidate's jitter
 * draw, so a different XI means a different draw count and a different world
 * from the next season on. That is inherent to the award gating the market and
 * would be true of any change here. It means a pre/post scoreline comparison
 * proves nothing, and that the probe's baseline row is only a true baseline on
 * an UNMODIFIED tree: rows inside one run share their worlds and compare
 * cleanly, but a "shipped" row measured on a tree that already carries this
 * change reads 82.8% against the 88.5% above.
 *
 * Still a 4-3-3 in shape — back four, midfield three, front three — so it reads
 * as a real formation on the pitch view; only the midfield trio changes, from
 * DM-CM-CM to DM-CM-AM.
 *
 * **The obvious alternative — let a slot take a player who covers it, the way a
 * real Team of the Year fields men out of position — was built two ways,
 * measured, and rejected both times.** Ranked against each other on identical
 * worlds (`scripts/totsSlotProbe.ts`): this list 91.7% POTY-in-XI, the shipped
 * exact-match list 82.8%, the engine's flat ADJACENCY table 86.5%, and real
 * per-player `secondaryPositions` **75.0%** — *below* the baseline it was meant
 * to beat. Both cover-rules wreck the XI the same way: centre-backs take 39-41%
 * of all slots and wingers fall from 18.2% to under 1%.
 *
 * The cause is not the versatility model, and this is the durable lesson.
 * `totsScore` is a *within-position* statistic: every position has its own
 * formula (TOTS_POSITION_WORK), and at the time this was measured the formula
 * paid a defender 0.03 per tackle and interception on season totals against a
 * forward's 0.01, on stats defenders collect in vastly greater volume, so a
 * centre-back's score was not commensurable with a winger's at all. Exact matching is not an
 * oversight hiding that — it is the guardrail that keeps the formula valid, by
 * only ever comparing a player against others at his own position.
 * `secondaryPositions` is the *better* of the two cover-rules by construction
 * (per-player, gated on his own rating at that slot, and COVERABLE never lets a
 * centre-back reach the wing) and it scored **worse**, which is the tell: the
 * count of eligible players was never the binding constraint, the score gap
 * was. Admitting even a calibrated few centre-backs hands them every full-back
 * and holding slot. Doing this properly means normalizing totsScore within each
 * position first — a separate design change, not a slot-list edit. The probe
 * keeps both cover-rules so the rejection stays reproducible.
 *
 * Changing this list does NOT rewrite history: migrate.ts only computes awards
 * for a season that has none, so seasons already played keep the XI they were
 * picked with. See the note on XI_SLOTS in frivolities/honours.ts for the one
 * visible consequence.
 */
export const TOTS_SLOTS: Position[] =
  ["GK", "CB", "CB", "FB", "FB", "DM", "CM", "AM", "W", "W", "ST"];

/** One completed season's individual/team honors, stored on SeasonHistoryEntry. */
export interface SeasonAwards {
  playerOfSeasonPid: number | null;
  goldenBootPid: number | null;
  /** 11 pids (or null if no eligible player existed), index-aligned with TOTS_SLOTS. */
  teamOfSeason: (number | null)[];
}

export function statsFor(p: Player, season: number): SeasonStats | undefined {
  return p.stats.find((s) => s.season === season);
}

/**
 * The ovr a player actually played `season` with — NOT p.ovr, which is
 * present-day and can be many seasons stale by the time this is called (see
 * migrate.ts's historical-award backfill, which recomputes awards for
 * arbitrary past seasons from today's player pool). progressPlayer tags each
 * p.hist entry with the season that just ended, but the ratings/ovr in that
 * entry are the *post-growth* values for the season being entered — so the
 * ovr a player carried into `season` is the hist entry tagged `season - 1`.
 * Falls back to the player's current ovr only when no such snapshot exists
 * (a save's very first season, before any progression has run yet — at that
 * point p.ovr *is* the season-1 ovr — or pre-hist legacy data).
 */
export function ovrDuringSeason(p: Player, season: number): number {
  const snapshot = p.hist.find((h) => h.season === season - 1);
  return snapshot?.ovr ?? p.ovr;
}

function ovrBonus(p: Player, season: number): number {
  return (ovrDuringSeason(p, season) - AWARD_OVR_BASELINE) * AWARD_OVR_WEIGHT;
}

export function potyScore(p: Player, s: SeasonStats, season: number): number {
  const group = positionGroup(p.pos);
  return s.avgRating + s.goals * POTY_GOAL_WEIGHT[group] + s.assists * POTY_ASSIST_WEIGHT[group]
    + ovrBonus(p, season);
}

/**
 * A player's Team of the Season case, on his own position's formula: his Player
 * of the Season score plus the work his position does per game. See
 * TOTS_POSITION_WORK for the weights and the measurements behind them.
 *
 * Built on `potyScore` deliberately, so the two awards can only disagree about
 * a player by what his position does beyond the scoreline. For an attacker they
 * cannot disagree at all.
 */
export function totsScore(p: Player, s: SeasonStats, season: number): number {
  const work = TOTS_POSITION_WORK[p.pos];
  const games = Math.max(1, s.appearances);
  return potyScore(p, s, season)
    + ((s.tackles + s.interceptions) / games) * work.defendingPerGame
    - (s.goalsAgainst / games) * work.concededPerGame;
}

function pickPlayerOfSeason(
  entries: { player: Player; stats: SeasonStats }[],
  season: number,
): number | null {
  const qualified = entries.filter((e) => e.stats.appearances >= AWARD_MIN_APPEARANCES);
  const pool = qualified.length > 0 ? qualified : entries;
  if (pool.length === 0) return null;
  let best = pool[0];
  let bestScore = potyScore(best.player, best.stats, season);
  for (const e of pool.slice(1)) {
    const score = potyScore(e.player, e.stats, season);
    const bestGA = best.stats.goals + best.stats.assists;
    const ga = e.stats.goals + e.stats.assists;
    if (
      score > bestScore ||
      (score === bestScore && (ga > bestGA || (ga === bestGA && e.player.pid < best.player.pid)))
    ) {
      best = e;
      bestScore = score;
    }
  }
  return best.player.pid;
}

function pickGoldenBoot(entries: { player: Player; stats: SeasonStats }[]): number | null {
  const scorers = entries.filter((e) => e.stats.goals > 0);
  if (scorers.length === 0) return null;
  let best = scorers[0];
  for (const e of scorers.slice(1)) {
    if (
      e.stats.goals > best.stats.goals ||
      (e.stats.goals === best.stats.goals &&
        (e.stats.appearances < best.stats.appearances ||
          (e.stats.appearances === best.stats.appearances &&
            (e.stats.assists > best.stats.assists ||
              (e.stats.assists === best.stats.assists && e.player.pid < best.player.pid)))))
    ) {
      best = e;
    }
  }
  return best.player.pid;
}

function pickTeamOfSeason(
  entries: { player: Player; stats: SeasonStats }[],
  formation: Position[],
  season: number,
): (number | null)[] {
  const used = new Set<number>();
  return formation.map((slotPos) => {
    const candidates = entries.filter(
      (e) => e.player.pos === slotPos && e.stats.appearances > 0 && !used.has(e.player.pid),
    );
    if (candidates.length === 0) return null;
    let best = candidates[0];
    let bestScore = scoreForSlot(best);
    for (const c of candidates.slice(1)) {
      const score = scoreForSlot(c);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    used.add(best.player.pid);
    return best.player.pid;

    function scoreForSlot(e: { player: Player; stats: SeasonStats }): number {
      const qualifies = e.stats.appearances >= AWARD_MIN_APPEARANCES;
      // Qualified players always outrank unqualified ones; within each group,
      // rank by totsScore. Keeps every slot filled even when a thin position
      // has no one over the appearances bar.
      return (qualifies ? 1000 : 0) + totsScore(e.player, e.stats, season);
    }
  });
}

/**
 * Compute a completed season's awards from the players who have a
 * SeasonStats entry for that season. Player.stats is append-only and never
 * pruned, so this can be run for any past season, not just the one that
 * just ended — used both by simOffseason (fresh) and migrateLeague
 * (backfilling old saves that predate this feature).
 */
export function computeSeasonAwards(players: Player[], season: number): SeasonAwards {
  const entries: { player: Player; stats: SeasonStats }[] = [];
  for (const player of players) {
    const stats = statsFor(player, season);
    if (stats && stats.appearances > 0) entries.push({ player, stats });
  }

  return {
    playerOfSeasonPid: pickPlayerOfSeason(entries, season),
    goldenBootPid: pickGoldenBoot(entries),
    teamOfSeason: pickTeamOfSeason(entries, TOTS_SLOTS, season),
  };
}
