import { describe, expect, it } from "vitest";
import {
  extendPlayerNames, playerNameIndex, playerNameOf, referencedPids,
} from "../../src/core/players/playerNames.js";
import type { PlayerName } from "../../src/core/players/playerNames.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { Player } from "../../src/core/players/types.js";

function makePlayer(pid: number, name: string): Player {
  return {
    pid,
    name,
    nationality: "eng",
    born: 2000,
    pos: "ST",
    ovr: 60,
    potential: 60,
    recentStats: [],
    recentHist: [],
    ratings: {} as Player["ratings"],
    heightCm: 180,
    contract: { years: 2, salary: 1 },
    injury: null,
  } as unknown as Player;
}

/** Only the fields `referencedPids`/`extendPlayerNames` actually walk. */
function makeLeague(over: Partial<LeagueStore> = {}): LeagueStore {
  return {
    transfers: [],
    newsEvents: [],
    seasonHistory: [],
    cupHistory: [],
    shieldHistory: [],
    domesticCupHistory: [],
    playerNames: [],
    ...over,
  } as unknown as LeagueStore;
}

const transfer = (pid: number) => ({ pid, fromTid: 1, toTid: 2, fee: 0, season: 5, window: "summer" as const });

describe("referencedPids", () => {
  it("finds a pid on a transfer, a news event and a cup stat line", () => {
    const league = makeLeague({
      transfers: [transfer(11)],
      newsEvents: [{ type: "hattrick", pid: 22, tid: 1, season: 5, matchday: 3, detail: 3 }],
      cupHistory: [{ statLines: [{ pid: 33 }] }] as unknown as LeagueStore["cupHistory"],
    });
    expect(referencedPids(league)).toEqual(new Set([11, 22, 33]));
  });

  it("finds every award a season hands out, world and domestic", () => {
    const league = makeLeague({
      seasonHistory: [{
        awards: { 0: { playerOfSeasonPid: 1, goldenBootPid: 2, teamOfSeason: [3, null] } },
        world: { ballonDOr: [{ pid: 4 }], worldTeamOfYear: [5] },
      }] as unknown as LeagueStore["seasonHistory"],
    });
    expect(referencedPids(league)).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("covers the Shield and domestic cups, not just the Continental Cup", () => {
    // Each keeps its own per-player stat lines, and a retiree is likelier to
    // have featured in the Shield than in the Cup.
    const league = makeLeague({
      shieldHistory: [{ statLines: [{ pid: 44 }] }] as unknown as LeagueStore["shieldHistory"],
      domesticCupHistory: [{ statLines: [{ pid: 55 }] }] as unknown as LeagueStore["domesticCupHistory"],
    });
    expect(referencedPids(league)).toEqual(new Set([44, 55]));
  });
});

describe("extendPlayerNames", () => {
  it("keeps a retiree the history still points at", () => {
    const league = makeLeague({ transfers: [transfer(11)] });
    const out = extendPlayerNames([], [makePlayer(11, "Ade Bello")], league);
    expect(out).toEqual([
      { pid: 11, name: "Ade Bello", nationality: "eng", pos: "ST", born: 2000 },
    ]);
  });

  it("skips a retiree nothing references", () => {
    // The overwhelming majority of any offseason's retirees: unsigned players
    // who never moved, never played and never made the news. Storing them would
    // be the archive's volume problem all over again.
    const out = extendPlayerNames([], [makePlayer(99, "Nobody At All")], makeLeague());
    expect(out).toEqual([]);
  });

  it("does not duplicate a name it already holds", () => {
    const existing: PlayerName[] = [
      { pid: 11, name: "Ade Bello", nationality: "eng", pos: "ST", born: 2000 },
    ];
    const league = makeLeague({ transfers: [transfer(11)] });
    expect(extendPlayerNames(existing, [makePlayer(11, "Ade Bello")], league)).toBe(existing);
  });

  it("returns the same array when nobody retired, so a no-op offseason writes nothing", () => {
    const existing: PlayerName[] = [];
    expect(extendPlayerNames(existing, [], makeLeague())).toBe(existing);
  });

  it("appends in pid order, leaving existing rows where they are", () => {
    const existing: PlayerName[] = [
      { pid: 50, name: "Old Row", nationality: "eng", pos: "GK", born: 1990 },
    ];
    const league = makeLeague({ transfers: [transfer(9), transfer(3)] });
    const out = extendPlayerNames(existing, [makePlayer(9, "Nine"), makePlayer(3, "Three")], league);
    expect(out.map((n) => n.pid)).toEqual([50, 3, 9]);
  });
});

describe("playerNameIndex", () => {
  it("is empty for a save that predates the field", () => {
    expect(playerNameIndex(undefined).size).toBe(0);
  });

  it("looks a name up by pid", () => {
    const index = playerNameIndex([playerNameOf(makePlayer(7, "Gus Halle"))]);
    expect(index.get(7)?.name).toBe("Gus Halle");
  });
});
