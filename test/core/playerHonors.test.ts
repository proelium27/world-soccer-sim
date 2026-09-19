import { describe, it, expect } from "vitest";
import { computePlayerHonors } from "../../src/core/playerHonors.js";
import type { SeasonAwards } from "../../src/core/awards.js";
import type { SeasonHistoryEntry } from "../../src/core/standings.js";
import type { WorldAwards } from "../../src/core/worldAwards.js";
import type { Player } from "../../src/core/players/types.js";

const noAwards: SeasonAwards = { playerOfSeasonPid: null, goldenBootPid: null, teamOfSeason: [] };
const noWorldAwards: WorldAwards = { ballonDOr: [], worldTeamOfYear: [] };

/** A completed season whose tier-1 champion is `championTid`. */
function entry(
  season: number,
  championTid: number,
  awards: Record<number, SeasonAwards> = { 0: noAwards },
  world: WorldAwards = noWorldAwards,
): SeasonHistoryEntry {
  return {
    season,
    table: [],
    teamStats: [],
    awards,
    compsByTid: {},
    championTidByCompId: { 0: championTid },
    world,
  };
}

/** A player whose only record is which club he was on in each listed season. */
function player(pid: number, seasonTids: Record<number, number>): Player {
  const stats = Object.entries(seasonTids).map(
    ([s, tid]) => ({ season: Number(s), tid, appearances: 0 }) as Player["recentStats"][number],
  );
  return { pid, recentStats: stats } as unknown as Player;
}

describe("computePlayerHonors", () => {
  const history = [entry(1, 10), entry(2, 10), entry(3, 11)];

  it("credits a league title only for seasons the player was in that club's squad", () => {
    // Joined club 10 for season 3 — and club 10 won seasons 1 and 2, before he arrived.
    const p = player(1, { 3: 10 });
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([]);
  });

  it("credits every title-winning season the player was in the squad for", () => {
    const p = player(2, { 1: 10, 2: 10, 3: 10 });
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([1, 2]);
  });

  it("credits a title won at a former club, not the current one", () => {
    // At champions 10 for season 2, moved to 11 for season 3 (which 11 won).
    const p = player(3, { 2: 10, 3: 11 });
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([2, 3]);
  });

  it("gives no title for a season the player has no record of at all", () => {
    // Youth intake generated after season 3 — no stats rows anywhere.
    const p = player(4, {});
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([]);
  });

  it("credits a squad member who never made an appearance", () => {
    const p = player(5, { 1: 10 });
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([1]);
  });

  it("gives no title for a season spent at a non-winning club", () => {
    const p = player(6, { 1: 11, 2: 11 });
    expect(computePlayerHonors(p, history).leagueTitles).toEqual([]);
  });

  it("collects individual awards across every competition", () => {
    const awarded: Record<number, SeasonAwards> = {
      0: { playerOfSeasonPid: 7, goldenBootPid: null, teamOfSeason: [null, 7] },
      1: { playerOfSeasonPid: null, goldenBootPid: 7, teamOfSeason: [] },
    };
    const h = computePlayerHonors(player(7, { 1: 11 }), [entry(1, 10, awarded)]);
    expect(h.playerOfSeason).toEqual([1]);
    expect(h.goldenBoot).toEqual([1]);
    expect(h.teamOfSeason).toEqual([1]);
    expect(h.leagueTitles).toEqual([]);
  });

  it("credits the Ballon d'Or winner and World Team of the Year places", () => {
    const world: WorldAwards = {
      ballonDOr: [
        { pid: 20, tid: 11, score: 9, league: 5, cup: 2 },
        { pid: 21, tid: 11, score: 8, league: 5, cup: 1 },
      ] as WorldAwards["ballonDOr"],
      worldTeamOfYear: [null, 21],
    };
    const h20 = computePlayerHonors(player(20, { 1: 11 }), [entry(1, 10, { 0: noAwards }, world)]);
    expect(h20.ballonDOr).toEqual([1]);
    expect(h20.worldTeamOfYear).toEqual([]);
    // Runner-up isn't a winner, but he does hold a World XI place.
    const h21 = computePlayerHonors(player(21, { 1: 11 }), [entry(1, 10, { 0: noAwards }, world)]);
    expect(h21.ballonDOr).toEqual([]);
    expect(h21.worldTeamOfYear).toEqual([1]);
  });

  it("tolerates a pre-worldwide-awards save with no `world` entry", () => {
    const legacy = { ...entry(1, 10), world: undefined } as unknown as SeasonHistoryEntry;
    const h = computePlayerHonors(player(22, { 1: 10 }), [legacy]);
    expect(h.ballonDOr).toEqual([]);
    expect(h.leagueTitles).toEqual([1]);
  });

  it("reports whether the player has any honour at all", () => {
    expect(computePlayerHonors(player(8, { 1: 11 }), history).hasAny).toBe(false);
    expect(computePlayerHonors(player(9, { 1: 10 }), history).hasAny).toBe(true);
  });
});

/**
 * The two position awards on a career.
 *
 * Both are optional fields on an optional `world`, because they postdate every
 * season already played on an existing save — so the case that matters most
 * here is the one where they are simply absent.
 */
describe("goalkeeper and defender of the year honours", () => {
  const won = (pid: number): WorldAwards => ({
    ballonDOr: [],
    worldTeamOfYear: [],
    goalkeeperOfYear: [{ pid, tid: 10, score: 12, league: 12, cup: 0, intl: 0, title: 0 }],
    defenderOfYear: [{ pid: 99, tid: 10, score: 9, league: 9, cup: 0, intl: 0, title: 0 }],
  });

  it("credits the winner of each, and nobody else on the shortlist", () => {
    const history = [entry(1, 10, { 0: noAwards }, won(7))];
    const keeper = computePlayerHonors(player(7, { 1: 10 }), history);
    expect(keeper.goalkeeperOfYear).toEqual([1]);
    expect(keeper.defenderOfYear).toEqual([]);
    expect(keeper.hasAny).toBe(true);

    const back = computePlayerHonors(player(99, { 1: 10 }), history);
    expect(back.defenderOfYear).toEqual([1]);
    expect(back.goalkeeperOfYear).toEqual([]);
  });

  it("credits a runner-up with nothing", () => {
    const world: WorldAwards = {
      ballonDOr: [],
      worldTeamOfYear: [],
      goalkeeperOfYear: [
        { pid: 7, tid: 10, score: 12, league: 12, cup: 0, intl: 0, title: 0 },
        { pid: 8, tid: 10, score: 11, league: 11, cup: 0, intl: 0, title: 0 },
      ],
    };
    const history = [entry(1, 10, { 0: noAwards }, world)];
    expect(computePlayerHonors(player(8, { 1: 10 }), history).goalkeeperOfYear).toEqual([]);
  });

  it("reads a season played before the awards existed as no award, not a crash", () => {
    // `world` present but without the two new lists — exactly the shape every
    // season already stored on an existing save has.
    const history = [entry(1, 10, { 0: noAwards }, noWorldAwards)];
    const honors = computePlayerHonors(player(7, { 1: 10 }), history);
    expect(honors.goalkeeperOfYear).toEqual([]);
    expect(honors.defenderOfYear).toEqual([]);
  });
});
