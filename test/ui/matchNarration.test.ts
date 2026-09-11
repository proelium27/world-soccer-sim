import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { makeTeam } from "../../src/engine/composites.js";
import { simMatchDetailed } from "../../src/engine/matchSim.js";
import { eventDetail } from "../../src/ui/matchNarration.js";
import type { MatchEvent, MatchPlayer } from "../../src/engine/attribution.js";

const ev = (over: Partial<MatchEvent> & Pick<MatchEvent, "type">): MatchEvent => ({
  clock: 3000,
  side: "home",
  pids: [7],
  ...over,
});

function makeSquad(pidOffset: number): MatchPlayer[] {
  const positions: MatchPlayer["pos"][] = [
    "GK", "CB", "CB", "FB", "FB", "DM", "CM", "CM", "W", "W", "ST",
  ];
  return positions.map((pos, i) => ({
    pid: pidOffset + i + 1,
    pos,
    slot: pos,
    secondary: [],
    ovr: 65,
    shooting: pos === "ST" ? 78 : 45,
    dribbling: 50,
    tackling: pos === "CB" || pos === "DM" ? 70 : 45,
    keeping: pos === "GK" ? 75 : 5,
    positioning: 55,
    heading: 50,
    stamina: 60,
    interceptions: pos === "CB" || pos === "DM" ? 70 : 45,
    passing: 55,
  }));
}

describe("matchNarration — the honesty rule", () => {
  it("calls a booking that conceded a penalty a foul in the area, and nothing else", () => {
    // The tick is pinned: the sim really did award a penalty, so this offence
    // cannot honestly be dissent or time-wasting.
    const card = ev({ type: "yellow_card", side: "away" });
    const penalty = ev({ type: "penalty", side: "home", pids: [3] });
    expect(eventDetail(card, [card, penalty], -120)).toBe("foul in the penalty area");
  });

  it("never offers time wasting or dissent when a set piece was conceded", () => {
    const card = ev({ type: "yellow_card", side: "away", clock: 400 });
    const freeKickShot = ev({ type: "shot_saved", side: "home", clock: 400, pids: [3] });
    const detail = eventDetail(card, [card, freeKickShot], -120);
    expect(detail).not.toBeNull();
    expect(detail).not.toMatch(/time wasting|dissent|referee|handball/);
  });

  it("only reaches for time wasting while a side is protecting a lead late on", () => {
    // Same offender, same clock, same tick — only the scoreline differs, which is
    // the one thing that makes the reason plausible.
    const card = ev({ type: "yellow_card", side: "home", clock: 200 });
    const leading = ev({ type: "goal", side: "home", clock: 3000, pids: [9] });
    const trailing = ev({ type: "goal", side: "away", clock: 3000, pids: [99] });

    const whenAhead = eventDetail(card, [leading, card], -120);
    const whenBehind = eventDetail(card, [trailing, card], -120);
    expect(whenBehind).not.toMatch(/time wasting|too long|kicks the ball away/);
    // Chasing the game, a booking reads as a challenge or a tactical foul.
    expect(whenAhead).not.toBe(whenBehind);
  });

  it("reads a second bookable offence off the player's own earlier card", () => {
    // Derived, not guessed: the engine sends him off the moment the second lands.
    const first = ev({ type: "yellow_card", clock: 4000 });
    const red = ev({ type: "red_card", clock: 1500 });
    expect(eventDetail(red, [first, red], -120)).toBe("second bookable offence");
    // Without the earlier booking it is a straight red and must not claim otherwise.
    expect(eventDetail(red, [red], -120)).not.toBe("second bookable offence");
  });

  it("names a penalty and a corner header exactly, since the sim really did play them", () => {
    const goal = ev({ type: "goal" });
    const penalty = ev({ type: "penalty" });
    expect(eventDetail(goal, [goal, penalty], -120)).toBe("from the spot");

    const corner = ev({ type: "corner", pids: [] });
    expect(eventDetail(goal, [goal, corner], -120)).toBe("header from the corner");
  });

  it("is deterministic — the same card always reads the same way", () => {
    // Both timeline surfaces derive independently, so a wobble here would show as
    // the box score and the live feed disagreeing about one booking.
    const card = ev({ type: "yellow_card", clock: 1234 });
    const first = eventDetail(card, [card], -120);
    for (let i = 0; i < 20; i++) {
      expect(eventDetail(card, [card], -120)).toBe(first);
    }
  });

  it("produces a varied card sheet rather than one stock phrase", () => {
    // The point of the feature: 'more colour than two sides taking shots'. Run
    // real matches and count how many distinct reasons the cards actually draw.
    const reasons = new Set<string>();
    let cards = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = simMatchDetailed(
        mulberry32(seed),
        makeTeam("Home"), makeTeam("Away"),
        makeSquad(0), makeSquad(100),
      );
      const events = r.boxScore.events;
      const last = r.boxScore.finalClock ?? 0;
      for (const e of events) {
        if (e.type !== "yellow_card" && e.type !== "red_card") continue;
        cards++;
        const d = eventDetail(e, events, last);
        if (d) reasons.add(d);
      }
    }
    expect(cards).toBeGreaterThan(20);
    expect(reasons.size).toBeGreaterThanOrEqual(6);
  });

  it("says nothing about the events that speak for themselves", () => {
    expect(eventDetail(ev({ type: "substitution", pids: [1, 2] }), [], -120)).toBeNull();
    expect(eventDetail(ev({ type: "corner", pids: [] }), [], -120)).toBeNull();
    expect(eventDetail(ev({ type: "injury" }), [], -120)).toBeNull();
  });
});
