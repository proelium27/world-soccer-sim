import type { PromotionPlayoff } from "./promotionPlayoff.js";
import { PLAYOFF_ROUND_FINAL } from "./promotionPlayoff.js";

/** One promotion playoff, reported as the news it is: who went up, and how. */
export interface PromotionNews {
  country: string;
  /**
   * The **upper** division of the link — the place that was being played for.
   * Named for tier 1 to match the record it comes off; on a D3-D2 playoff it is
   * the second division. Worth naming in the headline now that a country
   * decides more than one of these a summer.
   */
  d1CompId: number;
  /** The **lower** division — where the challenger came from. */
  d2CompId: number;
  /** The club that won the deciding tie. */
  tid: number;
  /**
   * Whether winning it moved him up. False only for a German tie the incumbent
   * held on to, where the winner keeps a place rather than taking one — the two
   * read very differently and the headline has to say which.
   */
  promoted: boolean;
  /**
   * His finishing position in his own division's table — the whole point of a
   * playoff is that this needn't be first.
   */
  position: number;
  /** The beaten finalist. */
  runnerUpTid: number;
  /** The final's scoreline, winner first, with a shootout appended if it went there. */
  score: string;
}

/**
 * Every promotion playoff the save has a result for, bucketed by the season it
 * decided.
 *
 * **Derived, like the trophies in `trophyNews.ts` and the honours in
 * `awardNews.ts`, for the same reason**: the result is already recorded on the
 * season entry, so writing a news event for one would be a second copy that
 * could drift from the first. A dynasty already in progress reports every
 * playoff it has ever held the moment this ships.
 *
 * Takes a flat list rather than a league so both sources can be handed in
 * together — the set decided by the season that has just ended and is still
 * sitting on `LeagueStore.promotionPlayoffs`, and everything the season history
 * has archived. Without the first, the promotion that just happened would go
 * unreported until the user clicked Advance.
 */
export function promotionNewsBySeason(playoffs: PromotionPlayoff[]): Map<number, PromotionNews[]> {
  const out = new Map<number, PromotionNews[]>();
  for (const p of playoffs) {
    const decider = p.ties.find((t) => t.round === PLAYOFF_ROUND_FINAL);
    if (!decider || p.winnerTid === null) continue;
    const won = decider.winner === decider.home;
    const pens = decider.wentToPens
      ? ` (${won ? decider.homePens : decider.awayPens}-${won ? decider.awayPens : decider.homePens} on pens)`
      : "";
    const row: PromotionNews = {
      country: p.country,
      d1CompId: p.d1CompId,
      d2CompId: p.d2CompId,
      tid: p.winnerTid,
      // A German tie is the one case where winning changes nothing: teams[0] is
      // the incumbent from the division above, so his win keeps the place he
      // already had. Every English winner is by construction a promotion.
      promoted: p.format !== "german" || p.winnerTid === p.teams[1],
      position: p.positions[p.teams.indexOf(p.winnerTid)] ?? 0,
      runnerUpTid: won ? decider.away : decider.home,
      score: won
        ? `${decider.homeGoals}-${decider.awayGoals}${pens}`
        : `${decider.awayGoals}-${decider.homeGoals}${pens}`,
    };
    const bucket = out.get(p.season);
    if (bucket) bucket.push(row);
    else out.set(p.season, [row]);
  }
  return out;
}
