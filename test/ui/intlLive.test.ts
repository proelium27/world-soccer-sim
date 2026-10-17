import { describe, expect, it } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { emptyInternationalState, playIntlStage, stripQualifyingDetail } from "../../src/core/international/index.js";
import type { InternationalState } from "../../src/core/international/index.js";
import { initQualifying } from "../../src/core/international/qualifying.js";
import { initConfederationCups } from "../../src/core/international/confederationCup.js";
import { nextKnockoutRound } from "../../src/core/international/tournament.js";
import {
  NATION_TID_BASE, fieldPairs, inNextStage, intlLiveView, stageComp,
} from "../../src/ui/live/intlLive.js";

/**
 * Watching an international match plays the next stage with qualifying's box
 * scores kept, builds the viewer from them, then strips them before the save.
 * These pin the two promises that makes: the stripped stage is exactly the
 * stage an unwatched click would have played, and the viewer finds the match
 * the Schedule row named.
 */

// One read-only world for the whole file (see CLAUDE.md on test worlds).
const league = makeLeague(0, 11);

function qualifyingState(): InternationalState {
  const campaign = initQualifying(league.players, 1);
  if (!campaign) throw new Error("world too small to qualify");
  return { ...emptyInternationalState(), qualifying: campaign, stage: "qualifying" };
}

describe("watching a qualifier", () => {
  const before = qualifyingState();
  const plain = playIntlStage(before, league.players, league.lid, 1);
  const kept = playIntlStage(before, league.players, league.lid, 1, { keepQualifyingDetail: true });

  it("keeps box scores only when asked, and stripping them gives the unwatched stage back", () => {
    const boxed = (s: InternationalState) =>
      s.qualifying!.groups.flatMap((g) => g.matches).filter((m) => m.boxScore).length;
    expect(boxed(plain.international)).toBe(0);
    expect(boxed(kept.international)).toBeGreaterThan(0);
    expect(stripQualifyingDetail(kept.international)).toEqual(plain.international);
    expect(kept.players).toEqual(plain.players);
  });

  it("finds the named fixture, with its group's other games and a table", () => {
    const m = before.qualifying!.groups[0].matches.find((x) => (x.leg ?? 0) === 0)!;
    expect(stageComp(before)).toEqual({ kind: "qualifying" });
    expect(inNextStage(before, { kind: "qualifying" }, m.home, m.away)).toBe(true);

    const live = intlLiveView(before, kept.international, { comp: { kind: "qualifying" }, home: m.home, away: m.away });
    expect(live).not.toBeNull();
    expect(live!.view.match.home).toBe(NATION_TID_BASE + m.home);
    expect(live!.view.nationOf?.(live!.view.match.home)).toBe(before.qualifying!.nations[m.home]);
    const table = live!.view.tableAtMinute!(90);
    expect(table).toHaveLength(before.qualifying!.groups[0].nids.length);
  });

  it("has nothing to show when the stage kept no box scores", () => {
    const m = before.qualifying!.groups[0].matches.find((x) => (x.leg ?? 0) === 0)!;
    expect(intlLiveView(before, plain.international, { comp: { kind: "qualifying" }, home: m.home, away: m.away })).toBeNull();
  });
});

describe("watching a confederation cup knockout tie", () => {
  const cups = initConfederationCups(league.players, 2, league.lid);
  const drawn: InternationalState = { ...emptyInternationalState(), confederationCups: cups, stage: "confederation-groups" };
  const afterGroups = playIntlStage(drawn, league.players, league.lid, 2).international;

  it("offers the next round's pairings, and only those", () => {
    expect(afterGroups.stage).toBe("confederation-ko");
    const comp = stageComp(afterGroups)!;
    expect(comp.kind).toBe("confederation");
    const cup = afterGroups.confederationCups.find(
      (c) => comp.kind === "confederation" && c.confederation === comp.confederation,
    )!;
    const [h, a] = fieldPairs(nextKnockoutRound(cup).field)[0];
    expect(inNextStage(afterGroups, comp, h, a)).toBe(true);
    expect(inNextStage(afterGroups, comp, a, h)).toBe(false);

    const afterKo = playIntlStage(afterGroups, league.players, league.lid, 2).international;
    const live = intlLiveView(afterGroups, afterKo, { comp, home: h, away: a });
    expect(live).not.toBeNull();
    expect(live!.view.tableAtMinute).toBeNull();
    expect(live!.view.competitionName).toBe(cup.name);
  });
});
