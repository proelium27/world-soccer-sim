import { describe, it, expect } from "vitest";
import { buildSeasonTimeline, type NewsAudience } from "../../src/ui/newsFeedTimeline.js";
import type { CompletedTransfer } from "../../src/core/transfers/negotiation.js";
import { FREE_AGENT_TID } from "../../src/core/transfers/negotiation.js";
import type { NewsEvent } from "../../src/core/newsEvents.js";
import type { AwardNews } from "../../src/core/awardNews.js";
import type { TrophyNews } from "../../src/core/trophyNews.js";
import type { DebtSanction } from "../../src/core/finance/debt.js";
import { debtNewsBySeason } from "../../src/core/debtNews.js";
import {
  NEWS_WORLD_TRANSFER_FEE,
  NEWS_WORLD_CAREER_GOALS,
  NEWS_CAREER_GOAL_FIRST,
} from "../../src/core/constants.js";

const USER_TID = 0;
const USER_COMP = 1;
const FOREIGN_COMP = 2;

// Clubs 0-4 share the user's competition; 5 and up are somewhere else entirely.
const audience: NewsAudience = {
  userTid: USER_TID,
  userCompId: USER_COMP,
  compOf: (tid) => (tid < 5 ? USER_COMP : FOREIGN_COMP),
};

/** The pids a timeline reports, in order. Trophies name a club or a nation
 *  rather than a player, so they carry no pid and are not counted here. */
const pidsOf = (timeline: ReturnType<typeof buildSeasonTimeline>) =>
  timeline
    .filter((item) => item.kind !== "trophy")
    .map((item) => (item.data as { pid: number }).pid)
    .sort((a, b) => a - b);

describe("buildSeasonTimeline", () => {
  it("orders summer transfers before in-season accomplishments before winter transfers", () => {
    const transfers: CompletedTransfer[] = [
      { pid: 1, fromTid: 0, toTid: 1, fee: 1000, season: 2026, window: "winter" },
      { pid: 2, fromTid: 1, toTid: 0, fee: 2000, season: 2026, window: "summer" },
    ];
    const newsEvents: NewsEvent[] = [
      { type: "hattrick", pid: 3, tid: 0, season: 2026, matchday: 10, detail: 3 },
    ];

    const timeline = buildSeasonTimeline(transfers, newsEvents, audience);

    expect(timeline.map((item) => item.kind)).toEqual(["transfer", "news", "transfer"]);
    expect(timeline[0].kind === "transfer" && timeline[0].data.window).toBe("summer");
    expect(timeline[2].kind === "transfer" && timeline[2].data.window).toBe("winter");
  });

  it("orders multiple accomplishments by matchday", () => {
    const newsEvents: NewsEvent[] = [
      { type: "hattrick", pid: 1, tid: 0, season: 2026, matchday: 20, detail: 3 },
      { type: "standoutRating", pid: 2, tid: 1, season: 2026, matchday: 5, detail: 91 },
    ];

    const timeline = buildSeasonTimeline([], newsEvents, audience);

    expect(timeline.map((item) => item.kind === "news" && item.data.matchday)).toEqual([5, 20]);
  });

  it("returns an empty array for a season with no transfers or events", () => {
    expect(buildSeasonTimeline([], [], audience)).toEqual([]);
  });

  it("hides other clubs' free signings but keeps the user's own and paid deals in the league", () => {
    const transfers: CompletedTransfer[] = [
      // Routine AI free signing (another club) — should be hidden.
      { pid: 1, fromTid: FREE_AGENT_TID, toTid: 4, fee: 0, season: 2026, window: "summer" },
      // The user signs a free agent — should stay.
      { pid: 2, fromTid: FREE_AGENT_TID, toTid: USER_TID, fee: 0, season: 2026, window: "summer" },
      // A paid deal between two AI clubs in the user's league — should stay.
      { pid: 3, fromTid: 2, toTid: 3, fee: 1000, season: 2026, window: "summer" },
    ];

    expect(pidsOf(buildSeasonTimeline(transfers, [], audience))).toEqual([2, 3]);
  });

  describe("relevance tiers", () => {
    it("keeps league-tier accomplishments at home and drops them abroad", () => {
      const rival: NewsEvent = {
        type: "hattrick", pid: 1, tid: 3, season: 2026, matchday: 4, detail: 3,
      };
      const foreign: NewsEvent = { ...rival, pid: 2, tid: 9 };

      expect(pidsOf(buildSeasonTimeline([], [rival, foreign], audience))).toEqual([1]);
    });

    it("keeps world-tier accomplishments wherever they happen", () => {
      const foreignHaul: NewsEvent = {
        type: "hattrick", pid: 1, tid: 9, season: 2026, matchday: 4, detail: 4,
      };
      const foreignLegend: NewsEvent = {
        type: "goalMilestoneCareer", pid: 2, tid: 9, season: 2026, matchday: 4,
        detail: NEWS_WORLD_CAREER_GOALS,
      };

      expect(pidsOf(buildSeasonTimeline([], [foreignHaul, foreignLegend], audience)))
        .toEqual([1, 2]);
    });

    it("shows the user's own club even for events that travel nowhere", () => {
      const ownPositionChange: NewsEvent = {
        type: "positionChange", pid: 1, tid: USER_TID, season: 2026, matchday: 0, detail: 3,
      };
      const foreignPositionChange: NewsEvent = { ...ownPositionChange, pid: 2, tid: 9 };

      expect(pidsOf(buildSeasonTimeline([], [ownPositionChange, foreignPositionChange], audience)))
        .toEqual([1]);
    });

    it("gates foreign transfers on the fee and lets any paid deal at home through", () => {
      const transfers: CompletedTransfer[] = [
        // Foreign squad-filler deal — below the world bar, hidden.
        { pid: 1, fromTid: 9, toTid: 10, fee: NEWS_WORLD_TRANSFER_FEE - 1, season: 2026, window: "summer" },
        // Foreign marquee signing — clears the bar, shown.
        { pid: 2, fromTid: 9, toTid: 10, fee: NEWS_WORLD_TRANSFER_FEE, season: 2026, window: "summer" },
        // Small deal inside the user's league — shown regardless of fee.
        { pid: 3, fromTid: 2, toTid: 3, fee: 1, season: 2026, window: "summer" },
      ];

      expect(pidsOf(buildSeasonTimeline(transfers, [], audience))).toEqual([2, 3]);
    });

    it("keeps loans at home and out of the world tier however large the fee", () => {
      const transfers: CompletedTransfer[] = [
        { pid: 1, fromTid: 2, toTid: 3, fee: 1, season: 2026, window: "summer", loanSeasons: 1 },
        {
          pid: 2, fromTid: 9, toTid: 10, fee: NEWS_WORLD_TRANSFER_FEE * 10,
          season: 2026, window: "summer", loanSeasons: 1,
        },
      ];

      expect(pidsOf(buildSeasonTimeline(transfers, [], audience))).toEqual([1]);
    });

    it("reports a loan return only when it is the user's own player", () => {
      const transfers: CompletedTransfer[] = [
        { pid: 1, fromTid: 3, toTid: USER_TID, fee: 0, season: 2026, window: "summer", loanReturn: true },
        { pid: 2, fromTid: 3, toTid: 4, fee: 0, season: 2026, window: "summer", loanReturn: true },
      ];

      expect(pidsOf(buildSeasonTimeline(transfers, [], audience))).toEqual([1]);
    });

    it("retires legacy every-10 milestones written by older builds", () => {
      // Saves from before the ladder existed are full of these. They must not
      // survive even in the user's own club, or an old save's feed stays buried.
      const legacy: NewsEvent = {
        type: "goalMilestoneCareer", pid: 1, tid: USER_TID, season: 2026, matchday: 4, detail: 10,
      };
      const current: NewsEvent = { ...legacy, pid: 2, detail: NEWS_CAREER_GOAL_FIRST };

      expect(pidsOf(buildSeasonTimeline([], [legacy, current], audience))).toEqual([2]);
    });

    it("shows an honour won by one of the user's own players", () => {
      const awards: AwardNews[] = [
        // His league's Team of the Season, at his club — the ask.
        { kind: "teamOfSeason", pid: 1, tid: USER_TID, compId: USER_COMP, slot: 10 },
        // The same honour in another country, at a club he has no stake in.
        { kind: "teamOfSeason", pid: 2, tid: 9, compId: FOREIGN_COMP, slot: 10 },
      ];

      expect(pidsOf(buildSeasonTimeline([], [], audience, awards))).toEqual([1]);
    });

    it("keeps a competition's honours inside it and the worldwide ones everywhere", () => {
      const awards: AwardNews[] = [
        { kind: "playerOfSeason", pid: 1, tid: 3, compId: USER_COMP },
        { kind: "playerOfSeason", pid: 2, tid: 9, compId: FOREIGN_COMP },
        { kind: "ballonDOr", pid: 3, tid: 9, placing: 1 },
        { kind: "goalkeeperOfYear", pid: 4, tid: 9 },
        { kind: "worldTeamOfYear", pid: 5, tid: 9, slot: 0 },
        // A placing behind the winner travels no further than his own league.
        { kind: "ballonDOr", pid: 6, tid: 9, placing: 2 },
        { kind: "ballonDOr", pid: 7, tid: 3, placing: 3 },
      ];

      expect(pidsOf(buildSeasonTimeline([], [], audience, awards))).toEqual([1, 3, 4, 5, 7]);
    });

    it("files a domestic honour by its competition, not by the winner's club", () => {
      // An old save can have award pids it can no longer attach to a club. The
      // competition is on the record itself, so the honour still files right.
      const awards: AwardNews[] = [
        { kind: "goldenBoot", pid: 1, compId: USER_COMP },
        { kind: "goldenBoot", pid: 2, compId: FOREIGN_COMP },
      ];

      expect(pidsOf(buildSeasonTimeline([], [], audience, awards))).toEqual([1]);
    });

    it("shows every trophy wherever it was won, and sorts them before the honours", () => {
      // A trophy is one row for the whole world, so it takes no tier test: who
      // won the Continental Cup matters wherever you play.
      const trophies: TrophyNews[] = [
        { kind: "continentalCup", name: "Continental Cup", tid: 9 },
        { kind: "worldCup", name: "World Cup", nation: "Brazil", runnerUp: "France", score: "2-1" },
      ];
      const awards: AwardNews[] = [{ kind: "goldenBoot", pid: 1, compId: USER_COMP }];
      const events: NewsEvent[] = [
        { type: "hattrick", pid: 2, tid: 3, season: 2026, matchday: 38, detail: 3 },
      ];

      const timeline = buildSeasonTimeline([], events, audience, awards, trophies);
      // Who won what, then who was best.
      expect(timeline.map((i) => i.kind)).toEqual(["news", "trophy", "trophy", "award"]);
    });

    it("sorts honours after the season's football", () => {
      const transfers: CompletedTransfer[] = [
        { pid: 1, fromTid: 2, toTid: 3, fee: 1, season: 2026, window: "winter" },
      ];
      const events: NewsEvent[] = [
        { type: "hattrick", pid: 2, tid: 3, season: 2026, matchday: 38, detail: 3 },
      ];
      const awards: AwardNews[] = [{ kind: "goldenBoot", pid: 3, compId: USER_COMP }];

      const timeline = buildSeasonTimeline(transfers, events, audience, awards);
      expect(timeline.map((i) => i.kind)).toEqual(["transfer", "news", "award"]);
    });

    it("falls back to world-tier only when the season's competition map is missing", () => {
      // A save with no snapshot for the season must not degrade to showing all
      // 320 clubs — an unresolved competition is nobody's league, not everybody's.
      const blind: NewsAudience = { userTid: USER_TID, userCompId: undefined, compOf: () => undefined };
      const events: NewsEvent[] = [
        { type: "hattrick", pid: 1, tid: 3, season: 2026, matchday: 4, detail: 3 },
        { type: "hattrick", pid: 2, tid: 9, season: 2026, matchday: 4, detail: 4 },
        { type: "hattrick", pid: 3, tid: USER_TID, season: 2026, matchday: 4, detail: 3 },
      ];

      expect(pidsOf(buildSeasonTimeline([], events, blind))).toEqual([2, 3]);
    });
  });
});

describe("continental reallocation in the feed", () => {
  const own = { country: "England", compId: USER_COMP, from: 4, to: 3 };
  const foreign = { country: "Belgium", compId: FOREIGN_COMP, from: 2, to: 3 };

  it("shows a foreign country's reallocation as well as your own", () => {
    // Deliberately NOT tiered down to the user's league, for the same reason
    // the trophies aren't: the tiers control volume, and a place changes hands
    // well under once a season across the whole world.
    const timeline = buildSeasonTimeline([], [], audience, [], [], [own, foreign]);
    const countries = timeline
      .flatMap((i) => (i.kind === "continental" ? [i.data.country] : []))
      .sort();
    expect(countries).toEqual(["Belgium", "England"]);
  });

  it("closes the season, after the trophies and the honours", () => {
    const events: NewsEvent[] = [
      { type: "hattrick", pid: 1, tid: 0, season: 2026, matchday: 20, detail: 3 },
    ];
    const awards: AwardNews[] = [{ kind: "ballonDOr", pid: 1, tid: 0, placing: 1 }];
    const trophies: TrophyNews[] = [{ kind: "continentalCup", name: "Continental Cup", tid: 0 }];
    const timeline = buildSeasonTimeline([], events, audience, awards, trophies, [own]);
    expect(timeline.map((i) => i.kind)).toEqual(["news", "trophy", "award", "continental"]);
  });

  it("carries both ends, so the row can say which way it went", () => {
    const timeline = buildSeasonTimeline([], [], audience, [], [], [own]);
    const item = timeline.find((i) => i.kind === "continental");
    if (item?.kind !== "continental") throw new Error("expected a continental item");
    expect(item.data.from).toBe(4);
    expect(item.data.to).toBe(3);
  });
});

describe("financial sanctions in the feed", () => {
  const sanction = (over: Partial<DebtSanction> = {}): DebtSanction => ({
    season: 2026, tid: USER_TID, balance: -50_000_000, limit: 60_000_000,
    embargo: true, pointsDeduction: 0, consecutiveSeasons: 1, ...over,
  });

  it("reports your own club's sanction", () => {
    const timeline = buildSeasonTimeline([], [], audience, [], [], [], [], [sanction()]);
    expect(timeline.map((i) => i.kind)).toEqual(["debt"]);
  });

  /**
   * A sanction is only ever handed to the user's club, but it belongs to the
   * CLUB — so one he ran into trouble and then left still serves it, and a club
   * in your league starting on minus six is news whoever manages it.
   */
  it("reports one in your league, and ignores one somewhere else", () => {
    const timeline = buildSeasonTimeline(
      [], [], audience, [], [], [], [],
      [sanction({ tid: 3 }), sanction({ tid: 9 })],
    );
    const tids = timeline.flatMap((i) => (i.kind === "debt" ? [i.data.tid] : []));
    expect(tids).toEqual([3]);
  });

  /**
   * An embargo governs the summer window that is about to open, so it has to be
   * read before the business it forbids rather than filed with the season that
   * caused it.
   */
  it("opens the season, ahead of the summer window", () => {
    const transfers: CompletedTransfer[] = [
      { pid: 1, fromTid: 1, toTid: 0, fee: 2000, season: 2026, window: "summer" },
    ];
    const events: NewsEvent[] = [
      { type: "hattrick", pid: 2, tid: 0, season: 2026, matchday: 10, detail: 3 },
    ];
    const timeline = buildSeasonTimeline(
      transfers, events, audience, [], [], [], [], [sanction()],
    );
    expect(timeline.map((i) => i.kind)).toEqual(["debt", "transfer", "news"]);
  });

  it("carries the depth and the deduction, so the row can say which penalty it is", () => {
    const timeline = buildSeasonTimeline(
      [], [], audience, [], [], [], [],
      [sanction({ pointsDeduction: 9, consecutiveSeasons: 2 })],
    );
    const item = timeline.find((i) => i.kind === "debt");
    if (item?.kind !== "debt") throw new Error("expected a debt item");
    expect(item.data.pointsDeduction).toBe(9);
    expect(item.data.consecutiveSeasons).toBe(2);
    expect(item.data.balance).toBe(-50_000_000);
  });
});

describe("debtNewsBySeason", () => {
  it("buckets by the season the sanction applies to", () => {
    const rows: DebtSanction[] = [
      { season: 3, tid: 0, balance: -1, limit: 2, embargo: true, pointsDeduction: 0, consecutiveSeasons: 1 },
      { season: 4, tid: 0, balance: -2, limit: 2, embargo: true, pointsDeduction: 6, consecutiveSeasons: 2 },
    ];
    const map = debtNewsBySeason(rows);
    expect(map.get(3)?.[0].consecutiveSeasons).toBe(1);
    expect(map.get(4)?.[0].pointsDeduction).toBe(6);
    expect(map.get(5)).toBeUndefined();
  });

  it("is empty for a save that has never been in the red", () => {
    expect(debtNewsBySeason(undefined).size).toBe(0);
    expect(debtNewsBySeason([]).size).toBe(0);
  });
});
