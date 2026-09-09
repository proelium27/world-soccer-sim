import type { CompletedTransfer } from "../core/transfers/negotiation.js";
import { isFreeAgentTid } from "../core/transfers/negotiation.js";
import type { NewsEvent } from "../core/newsEvents.js";
import { newsEventScope, isNewsworthy } from "../core/newsEvents.js";
import type { AwardNews } from "../core/awardNews.js";
import { awardNewsScope } from "../core/awardNews.js";
import type { TrophyNews } from "../core/trophyNews.js";
import type { PromotionNews } from "../core/promotionNews.js";
import type { ContinentalNews } from "../core/continentalNews.js";
import type { DebtSanction } from "../core/finance/debt.js";
import { WINTER_WINDOW_OPEN_MATCHDAY } from "../core/calendar.js";
import { NEWS_WORLD_TRANSFER_FEE } from "../core/constants.js";

export type FeedItem =
  | { kind: "transfer"; order: number; data: CompletedTransfer }
  | { kind: "news"; order: number; data: NewsEvent }
  | { kind: "trophy"; order: number; data: TrophyNews }
  | { kind: "promotion"; order: number; data: PromotionNews }
  | { kind: "award"; order: number; data: AwardNews }
  | { kind: "continental"; order: number; data: ContinentalNews }
  | { kind: "debt"; order: number; data: DebtSanction };

/**
 * Trophies and honours are settled once the football is over, so they sort
 * after every matchday however long the season was. A competition can be as
 * short as `MIN_DIVISION_TEAMS` rounds, so this is a sentinel rather than a
 * matchday number: it only has to be larger than any `order` a match or a
 * transfer window produces. It also puts them first on the Dashboard's
 * headline panel, which reads the *end* of the timeline.
 */
const SEASON_END_ORDER = Number.MAX_SAFE_INTEGER;
/**
 * Before matchday 1 — the summer window and the super cups played in it. Shares
 * its key with the summer transfers deliberately: they happen in the same weeks
 * and there is no finer clock to separate them by.
 */
const PRESEASON_ORDER = 0;

/**
 * Who is reading, and where they play — everything the feed needs to sort the
 * world's activity into "yours", "your league's" and "everyone else's".
 *
 * `compOf` is per-season rather than a live team lookup because a club's
 * competition changes with promotion and relegation: filing an old season under
 * the club's *present* division misattributes it (the same reason
 * clubHistory.ts reads the season's own `compsByTid` snapshot). `userCompId`
 * is likewise the user's competition in that season, so a dynasty that spent
 * three years in the second division reads back as second-division news.
 */
export interface NewsAudience {
  userTid: number;
  /** The user's competition that season, or undefined if it can't be resolved. */
  userCompId: number | undefined;
  /** The competition a club played in that season, or undefined if unknown. */
  compOf: (tid: number) => number | undefined;
}

/**
 * Merges one season's transfers and accomplishments into a single
 * chronological timeline. Transfers have no matchday of their own, so they're
 * placed at an approximate point in the calendar by window: summer business
 * before matchday 1, winter business around the window's opening matchday.
 * Ties (same order key) keep transfers before accomplishments.
 *
 * ## What gets in
 *
 * The world is 16 competitions and 320 clubs, and reporting all of them equally
 * made the feed useless: measured at season 4 it ran to ~6,000 rows a season,
 * of which ~10% touched the user's own competition and ~0.1% their club, with a
 * median subject OVR of 61 — below an average starter. So relevance is tiered:
 *
 *   - the user's own club — everything, including loans, free signings and
 *     every honour one of his players won, because their own business is
 *     never noise;
 *   - the user's competition — every accomplishment the detector kept, every
 *     paid deal and loan, and the honours that competition handed out;
 *   - anywhere else — only world-tier accomplishments (`newsEventScope`) and
 *     honours (`awardNewsScope`), and paid deals at or above
 *     `NEWS_WORLD_TRANSFER_FEE`.
 *
 * Two things are dropped outside the user's club at every tier: routine
 * free-agent churn (AI clubs refilling squads from the free pool, on the order
 * of a thousand signings a season) and loan returns, which are the paperwork
 * ending a move that was already reported when it happened.
 *
 * `isNewsworthy` re-applies the detector's current floor, which is what keeps
 * an existing save's legacy every-10 goal milestones out without a migration.
 */
export function buildSeasonTimeline(
  transfers: CompletedTransfer[],
  newsEvents: NewsEvent[],
  audience: NewsAudience,
  awards: AwardNews[] = [],
  trophies: TrophyNews[] = [],
  continental: ContinentalNews[] = [],
  promotions: PromotionNews[] = [],
  sanctions: DebtSanction[] = [],
): FeedItem[] {
  const { userTid, userCompId, compOf } = audience;

  // An unresolved competition is nobody's league rather than everybody's, so a
  // missing snapshot degrades to showing only world-tier news, never to
  // showing all 320 clubs' worth.
  const inUserComp = (tid: number): boolean =>
    userCompId !== undefined && compOf(tid) === userCompId;

  const shownTransfers = transfers.filter((t) => {
    if (t.fromTid === userTid || t.toTid === userTid) return true;
    if (t.loanReturn) return false;
    if (isFreeAgentTid(t.fromTid)) return false;
    if (inUserComp(t.fromTid) || inUserComp(t.toTid)) return true;
    return !t.loanSeasons && t.fee >= NEWS_WORLD_TRANSFER_FEE;
  });

  const shownEvents = newsEvents.filter((e) => {
    if (!isNewsworthy(e)) return false;
    if (e.tid === userTid || inUserComp(e.tid)) return true;
    return newsEventScope(e) === "world";
  });

  const shownAwards = awards.filter((a) => {
    if (a.tid === userTid) return true;
    // A competition-level honour files under the competition that gave it,
    // which the record knows directly — so it lands in the right league even
    // when the save can no longer say which club the winner was at. A
    // worldwide honour has no competition of its own and files under his club.
    const home = a.compId !== undefined
      ? userCompId !== undefined && a.compId === userCompId
      : a.tid !== undefined && inUserComp(a.tid);
    return home || awardNewsScope(a) === "world";
  });

  const items: FeedItem[] = [
    ...shownTransfers.map((t): FeedItem => ({
      kind: "transfer",
      order: t.window === "summer" ? 0 : WINTER_WINDOW_OPEN_MATCHDAY,
      data: t,
    })),
    ...shownEvents.map((e): FeedItem => ({ kind: "news", order: e.matchday, data: e })),
    // Trophies take no tier test: each is one row for the whole world, and
    // which club or country won the Continental Cup is news wherever you play.
    //
    // A super cup is the one trophy that is *not* a season-end story: it is
    // played in the preseason, before a league point exists, so it sorts at the
    // top of the season alongside the summer window rather than at the bottom
    // with the champions. Within that key the summer's business still comes
    // first (RANK below), which is the right order — you sign your players and
    // then play the match.
    ...trophies.map((t): FeedItem => ({
      kind: "trophy",
      order: t.kind === "superCup" ? PRESEASON_ORDER : SEASON_END_ORDER,
      data: t,
    })),
    ...shownAwards.map((a): FeedItem => ({ kind: "award", order: SEASON_END_ORDER, data: a })),
    // No tier test either, for the same reason as the trophies: a country's
    // Cup allocation moves well under once a season across the whole world,
    // and when it does it changes the competition everyone plays in. The tiers
    // exist to control volume, and there is no volume here to control.
    ...continental.map((c): FeedItem => ({
      kind: "continental", order: SEASON_END_ORDER, data: c,
    })),
    // A playoff is reported for the user'"'"'s own country only, and the test is
    // either division rather than his own: a top-flight manager wants to know
    // which club is joining his league, and a second-division one wants to know
    // who took the place he was chasing. Ten other countries deciding their
    // second division is not news wherever you play, which is what separates
    // this from the trophies above.
    ...promotions
      .filter((p) => userCompId !== undefined
        && (p.d1CompId === userCompId || p.d2CompId === userCompId))
      .map((p): FeedItem => ({ kind: "promotion", order: SEASON_END_ORDER, data: p })),
    // A sanction is in force from the moment the season opens, so it sorts at
    // the top of it rather than at the end of the season that caused it — and
    // ahead of the summer window (RANK below), because an embargo governs the
    // business the player is about to try to do.
    //
    // Shown for the user's club and for anyone in his competition. Only his
    // club is ever assessed, so the second half looks redundant and is not: a
    // sanction belongs to the CLUB, so one he ran into trouble and then left
    // still serves it, and a club in your league starting on minus six is news
    // whoever manages it. At most one row a season either way, so unlike the
    // transfers and honours above there is no volume here to tier for.
    ...sanctions
      .filter((d) => d.tid === userTid || inUserComp(d.tid))
      .map((d): FeedItem => ({ kind: "debt", order: PRESEASON_ORDER, data: d })),
  ];

  // Within one order key: what you are allowed to do first, then business, then
  // what happened on the pitch. A season ends in the order the story does: who
  // won what, then who was best, then what it changed about next season's
  // competition.
  const RANK: Record<FeedItem["kind"], number> = {
    debt: 0, transfer: 1, news: 2, trophy: 3, promotion: 4, award: 5, continental: 6,
  };
  const rank = (item: FeedItem) => RANK[item.kind];

  return items.sort((a, b) => (a.order !== b.order ? a.order - b.order : rank(a) - rank(b)));
}
