import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  WORLD_CUP_FORMATS, TOURNAMENT_FORMATS, bestThirdsFor, resolveWorldCupSize,
  autoWorldCupThreshold, worldCupFormatFor,
} from "../../src/core/international/format.js";
import {
  allocateSlots, allocateByQuota, groupByConfederation, CONFEDERATION_QUOTAS, QUOTA_MAX_SHARE_OF_ENTRANTS,
  type Confederation,
} from "../../src/core/international/confederations.js";
import { initQualifying, runQualifying } from "../../src/core/international/qualifying.js";
import { initTournament, runTournament } from "../../src/core/international/tournament.js";
import { seedBracket } from "../../src/core/international/simIntl.js";
import { buildGroup, groupTable, rankAcrossGroups } from "../../src/core/international/groups.js";
import { finishOf, qualifyingPlan } from "../../src/core/international/index.js";
import type { IntlGroup, IntlTournamentSummary } from "../../src/core/international/types.js";
import { INTL_FIELD_SIZE, INTL_QUAL_GROUP_MAX, WORLD_CUP_SIZES } from "../../src/core/constants.js";
import { koRoundName } from "../../src/ui/pages/nationalTeams/shared.js";

/**
 * The World Cup's size became a per-save setting (2026-09-11), prompted by a
 * save whose North America fielded nine nations and got one place — which the
 * draw then played as a single nine-nation group, three times over, for 24
 * games a nation. These pin the three things that fix: the size resolves
 * sensibly from the setting and the world, every qualifying group plays for at
 * least its winner's place, and the two sizes that aren't a power of two reach
 * a clean bracket through their best third-placed sides.
 */

describe("World Cup formats", () => {
  it("derives each size's best-third count from its group count", () => {
    for (const size of WORLD_CUP_SIZES) {
      const f = WORLD_CUP_FORMATS[size];
      expect(f.fieldSize).toBe(size);
      expect(bestThirdsFor(f.groupCount, f.qualifyPerGroup)).toBe(f.bestThirds ?? 0);
      const advancing = f.groupCount * f.qualifyPerGroup + (f.bestThirds ?? 0);
      expect(Math.log2(advancing) % 1).toBe(0); // a clean bracket
      expect(f.fieldSize / f.groupCount).toBe(4); // groups of four throughout
    }
  });

  it("sends no third-placed side through in any confederation cup shape", () => {
    // The confederation cups share seedBracket, which derives the thirds count
    // from the group count; every one of their shapes must still read zero.
    for (const f of TOURNAMENT_FORMATS) expect(bestThirdsFor(f.groupCount, f.qualifyPerGroup)).toBe(0);
  });
});

describe("resolveWorldCupSize", () => {
  it("keeps a default world on 32 under Auto, at creation and once intake has run", () => {
    // 66 eligible nations at generation, 74-82 over the first eight or eleven
    // seasons on three seeds. The bars must sit well clear of that whole range.
    for (const eligible of [66, 74, 77, 82]) expect(resolveWorldCupSize("auto", eligible)).toBe(32);
    expect(autoWorldCupThreshold(32)).toBeLessThanOrEqual(66 - 10);
    expect(autoWorldCupThreshold(48)).toBeGreaterThanOrEqual(82 + 10);
  });

  it("gives Auto 48 only once the world is genuinely bigger", () => {
    expect(resolveWorldCupSize("auto", autoWorldCupThreshold(48) - 1)).toBe(32);
    expect(resolveWorldCupSize("auto", autoWorldCupThreshold(48))).toBe(48);
    expect(resolveWorldCupSize("auto", 150)).toBe(48);
  });

  it("drops Auto to smaller sizes in a thin world, and to nothing below 16", () => {
    expect(resolveWorldCupSize("auto", 44)).toBe(24);
    expect(resolveWorldCupSize("auto", 30)).toBe(16);
    // Under every comfortable bar, but it can still fill 16.
    expect(resolveWorldCupSize("auto", 20)).toBe(16);
    expect(resolveWorldCupSize("auto", 15)).toBeNull();
  });

  it("treats a fixed size as a ceiling the world has to be able to fill", () => {
    expect(resolveWorldCupSize(48, 100)).toBe(48);
    expect(resolveWorldCupSize(48, 40)).toBe(32);
    expect(resolveWorldCupSize(24, 100)).toBe(24);
    expect(resolveWorldCupSize(16, 10)).toBeNull();
  });

  it("finds a format for any field that can hold one", () => {
    expect(worldCupFormatFor(48)?.fieldSize).toBe(48);
    expect(worldCupFormatFor(47)?.fieldSize).toBe(32);
    expect(worldCupFormatFor(15)).toBeNull();
  });
});

describe("allocateByQuota", () => {
  const nations = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const total = (m: Map<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  /** Shaped like a real save a decade in: the world the report came from. */
  const matureWorld = () => new Map<Confederation, string[]>([
    ["Europe", nations("E", 31)], ["South America", nations("S", 5)], ["Africa", nations("A", 19)],
    ["Asia", nations("As", 6)], ["North America", nations("N", 9)], ["Oceania", nations("O", 1)],
  ]);

  it("reproduces the bug under the old rule: nine nations and no contender get one place", () => {
    const byConf = new Map<Confederation, string[]>([
      ["Europe", nations("E", 40)],
      ["North America", nations("N", 9)],
    ]);
    const contenders = new Set(nations("E", 32));
    expect(allocateSlots(byConf, 32, contenders).get("North America")).toBe(1);
  });

  it("gives the screenshot's North America a real share, with no group over seven", () => {
    const alloc = allocateByQuota(matureWorld(), 32, INTL_QUAL_GROUP_MAX);
    // 1998-2022 CONCACAF quota is 3.5 of 31: about four.
    expect(alloc.get("North America")).toBeGreaterThanOrEqual(3);
    expect(alloc.get("North America")).toBeLessThanOrEqual(6);
    expect(total(alloc)).toBe(32);
    for (const [conf, ns] of matureWorld()) {
      expect(alloc.get(conf)!).toBeGreaterThanOrEqual(Math.ceil(ns.length / INTL_QUAL_GROUP_MAX));
    }
  });

  it("follows the real quotas when every confederation has nations to spare", () => {
    // Each confederation well over twice its quota, so no cap binds.
    const byConf = new Map<Confederation, string[]>([
      ["Europe", nations("E", 40)], ["South America", nations("S", 14)], ["Africa", nations("A", 16)],
      ["Asia", nations("As", 14)], ["North America", nations("N", 12)], ["Oceania", nations("O", 3)],
    ]);
    for (const size of WORLD_CUP_SIZES) {
      const quotas = CONFEDERATION_QUOTAS[size];
      const weight = Object.values(quotas).reduce((a, b) => a + b, 0);
      const alloc = allocateByQuota(byConf, size, INTL_QUAL_GROUP_MAX);
      expect(total(alloc)).toBe(size);
      for (const [conf, places] of alloc) {
        const target = (quotas[conf] / weight) * size;
        const floor = Math.ceil(byConf.get(conf)!.length / INTL_QUAL_GROUP_MAX);
        // Within a place of the quota, unless the group floor lifts it.
        expect(places).toBeLessThanOrEqual(Math.max(Math.ceil(target) + 1, floor));
        expect(places).toBeGreaterThanOrEqual(Math.min(Math.floor(target) - 1, floor));
      }
    }
  });

  it("never sends more than two thirds of a confederation while the field allows it", () => {
    const alloc = allocateByQuota(matureWorld(), 32, INTL_QUAL_GROUP_MAX);
    for (const [conf, ns] of matureWorld()) {
      expect(alloc.get(conf)!).toBeLessThanOrEqual(Math.max(1, Math.floor(ns.length * QUOTA_MAX_SHARE_OF_ENTRANTS)));
    }
  });

  it("loosens the caps evenly when the field is too big for them", () => {
    // Caps total 46 against 48 places: two confederations must go over.
    const alloc = allocateByQuota(matureWorld(), 48, INTL_QUAL_GROUP_MAX);
    expect(total(alloc)).toBe(48);
    for (const [conf, ns] of matureWorld()) expect(alloc.get(conf)!).toBeLessThanOrEqual(ns.length);
  });

  it("is not strength-weighted: which nations are strong does not move a place", () => {
    // The same counts in a different order (i.e. different nations strongest)
    // must share places identically.
    const reversed = new Map([...matureWorld()].map(([c, ns]) => [c, [...ns].reverse()]));
    expect([...allocateByQuota(reversed, 32, INTL_QUAL_GROUP_MAX)])
      .toEqual([...allocateByQuota(matureWorld(), 32, INTL_QUAL_GROUP_MAX)]);
  });

  it("falls back to nation counts when the floors alone overrun the field", () => {
    const byConf = new Map<Confederation, string[]>([
      ["Europe", nations("E", 60)],
      ["Africa", nations("A", 60)],
    ]);
    // Floors would be 9 + 9 against 16 places.
    const alloc = allocateByQuota(byConf, 16, INTL_QUAL_GROUP_MAX);
    expect(alloc.get("Europe")).toBe(8);
    expect(alloc.get("Africa")).toBe(8);
  });
});

describe("qualifying at a chosen size", () => {
  const league = makeLeague(0, 7);

  it("records its size and allocation at the draw, and never draws a group bigger than seven", () => {
    for (const size of WORLD_CUP_SIZES) {
      const campaign = initQualifying(league.players, league.season, size);
      expect(campaign).not.toBeNull();
      expect(campaign!.fieldSize).toBe(size);
      const places = Object.values(campaign!.places ?? {}).reduce((a, b) => a + b, 0);
      expect(places).toBe(size);
      for (const g of campaign!.groups) expect(g.nids.length).toBeLessThanOrEqual(7);
      // Every group can at least send its winner.
      for (const plan of qualifyingPlan(campaign!)) {
        if (plan.groups > 0) expect(plan.slots).toBeGreaterThanOrEqual(plan.groups);
      }
    }
  });

  it("replays the rule an older campaign was drawn under", () => {
    // A campaign from before the size could vary has neither field; its plan
    // must come out as the 32-place strength allocation it was drawn for.
    const drawn = initQualifying(league.players, league.season)!;
    const legacy = { ...drawn, fieldSize: undefined, places: undefined };
    const byConf = groupByConfederation(legacy.nations);
    const expected = allocateSlots(byConf, INTL_FIELD_SIZE, new Set(legacy.nations.slice(0, INTL_FIELD_SIZE)));
    expect(qualifyingPlan(legacy).map((p) => [p.confederation, p.slots])).toEqual([...expected]);
  });

  it("plays a 48-nation campaign through to a 48-nation World Cup with a round of 32", () => {
    const q = runQualifying(league.players, league.season, league.lid, 48);
    expect(q).not.toBeNull();
    expect(q!.campaign.qualified).toHaveLength(48);
    expect(new Set(q!.campaign.qualified).size).toBe(48);

    const drawn = initTournament(q!.campaign.qualified, league.players, league.season + 1, league.lid);
    expect(drawn!.groups).toHaveLength(12);

    const t = runTournament(q!.campaign.qualified, league.players, league.season + 1, league.lid);
    expect(t).not.toBeNull();
    const { tournament } = t!;
    expect(tournament.bracket).toHaveLength(32);
    expect(tournament.championNid).not.toBeNull();
    // Five rounds: 16 + 8 + 4 + 2 + 1 ties.
    expect(tournament.ties).toHaveLength(31);
    expect(Math.max(...tournament.ties.map((tie) => tie.round))).toBe(4);
  });
});

/**
 * A group stage with known results. Each group's nids are listed in finishing
 * order and the table is made to agree: every higher-listed side beats every
 * lower-listed one, by a margin that also separates the groups, so the thirds
 * rank in a known order across groups.
 */
function playedGroups(groupCount: number): IntlGroup[] {
  return Array.from({ length: groupCount }, (_, g) => {
    const nids = [0, 1, 2, 3].map((pos) => g * 4 + pos);
    const group = buildGroup(g, nids, null);
    return {
      ...group,
      matches: group.matches.map((m) => {
        const [better, worse] = m.home < m.away ? [m.home, m.away] : [m.away, m.home];
        const margin = 1 + ((groupCount - g) % 5); // groups differ, so ranks are total
        return m.home === better
          ? { ...m, homeGoals: margin, awayGoals: 0 }
          : { ...m, homeGoals: 0, awayGoals: margin };
        void worse;
      }),
    };
  });
}

describe("seedBracket with best third-placed sides", () => {
  for (const [groupCount, thirds, size] of [[6, 4, 16], [12, 8, 32]] as const) {
    it(`seeds ${groupCount} groups into a ${size}-nation bracket with no first-round rematch`, () => {
      const groups = playedGroups(groupCount);
      const bracket = seedBracket(groups);
      expect(bracket).toHaveLength(size);
      expect(new Set(bracket).size).toBe(size);

      const groupOf = (nid: number) => Math.floor(nid / 4);
      for (let i = 0; i < bracket.length; i += 2) {
        expect(groupOf(bracket[i])).not.toBe(groupOf(bracket[i + 1]));
      }

      // Every winner and runner-up is in, plus exactly the best thirds.
      const tables = groups.map((g) => groupTable(g));
      for (const t of tables) {
        expect(bracket).toContain(t[0].nid);
        expect(bracket).toContain(t[1].nid);
        expect(bracket).not.toContain(t[3].nid);
      }
      const bestThirds = rankAcrossGroups(tables.map((t) => t[2])).slice(0, thirds).map((r) => r.nid);
      expect(bracket.filter((nid) => nid % 4 === 2).sort((a, b) => a - b)).toEqual([...bestThirds].sort((a, b) => a - b));
    });
  }

  it("leaves the partner-group seeding of a 32-nation World Cup exactly as it was", () => {
    // Eight groups: winners v partner-group runners-up, mirror ties in the
    // bottom half. No thirds, so the new path must not be taken.
    const bracket = seedBracket(playedGroups(8));
    expect(bracket.slice(0, 4)).toEqual([0, 5, 8, 13]);
    expect(bracket.slice(8, 12)).toEqual([4, 1, 12, 9]);
  });
});

describe("naming a deeper bracket", () => {
  it("calls the first round of a five-round bracket the round of 32", () => {
    expect(koRoundName(0, 5)).toBe("Round of 32");
    expect(koRoundName(1, 5)).toBe("Round of 16");
    expect(koRoundName(4, 5)).toBe("Final");
    expect(koRoundName(0)).toBe("Round of 16"); // no total: a 32-nation World Cup
  });

  it("records a finish by how far from the final the nation went out", () => {
    // A round-of-32 bracket: A beat B in the final; C lost a semi, D a quarter,
    // E in the round of 16, F in the round of 32.
    const tie = (round: number, home: string, away: string) =>
      ({ round, home, away, homeGoals: 1, awayGoals: 0, winner: home, pens: null });
    const summary: IntlTournamentSummary = {
      season: 4, name: "World Cup", champion: "A", runnerUp: "B",
      finalScore: { champion: 1, runnerUp: 0, pens: null }, topScorer: null,
      field: ["A", "B", "C", "D", "E", "F", "G"], groups: [],
      knockout: [tie(0, "A", "F"), tie(1, "A", "E"), tie(2, "A", "D"), tie(3, "A", "C"), tie(4, "A", "B")],
    };
    expect(finishOf(summary, "C")).toBe("Semi-finals");
    expect(finishOf(summary, "D")).toBe("Quarter-finals");
    expect(finishOf(summary, "E")).toBe("Round of 16");
    expect(finishOf(summary, "F")).toBe("Round of 32");
    expect(finishOf(summary, "G")).toBe("Group stage");
  });
});
