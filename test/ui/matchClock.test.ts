import { describe, it, expect } from "vitest";
import {
  eventMinute,
  formatClock,
  halfTimeMinute,
  matchMinuteLabel,
  matchTimeline,
  periodMarkers,
  stoppageMinutes,
  HALF_TIME_MINUTE,
  REGULATION_MINUTES,
} from "../../src/ui/matchClock.js";
import type { MatchEvent } from "../../src/engine/attribution.js";

const ev = (clock: number, type: MatchEvent["type"] = "goal"): MatchEvent => ({
  clock,
  type,
  side: "home",
  pids: [1],
});

describe("matchClock — the two different minutes", () => {
  it("eventMinute is PLAYING time and takes no account of which half it is", () => {
    // The continuous axis: playback walks it, events sort on it, liveRatings
    // reconstructs minutes from it. Stoppage is ordinary time here.
    expect(eventMinute(5400)).toBe(1);
    expect(eventMinute(2700)).toBe(45);
    expect(eventMinute(0)).toBe(90);
    expect(eventMinute(-90)).toBe(92);
  });

  it("labels first-half stoppage as 45+n and the second half discounted", () => {
    const h1 = 180; // three minutes added
    // Regulation first half is untouched.
    expect(matchMinuteLabel(44, h1)).toBe("44'");
    expect(matchMinuteLabel(45, h1)).toBe("45'");
    // The three playing-time minutes after 45 are the board's three.
    expect(matchMinuteLabel(46, h1)).toBe("45+1'");
    expect(matchMinuteLabel(48, h1)).toBe("45+3'");
    // ...and the second half resumes at 46, three playing-time minutes late.
    expect(matchMinuteLabel(49, h1)).toBe("46'");
    expect(matchMinuteLabel(93, h1)).toBe("90'");
    expect(matchMinuteLabel(95, h1)).toBe("90+2'");
  });

  it("decodes a box score with no first-half stoppage exactly as it always did", () => {
    // Absent is EXACT, not a guess: an engine that played both halves' stoppage
    // together at the end really did leave the first half with none. Nothing
    // reads 45+n, and the tail reads 90+n rather than 93.
    expect(matchMinuteLabel(46, undefined)).toBe("46'");
    expect(matchMinuteLabel(90, undefined)).toBe("90'");
    expect(matchMinuteLabel(93, undefined)).toBe("90+3'");
    expect(formatClock(-150, undefined)).toBe("90+3'");
  });

  it("puts the break at the END of first-half stoppage, not at 45", () => {
    expect(halfTimeMinute(undefined)).toBe(HALF_TIME_MINUTE);
    expect(halfTimeMinute(180)).toBe(48);
  });

  it("rounds a stoppage reading to whole board minutes", () => {
    expect(stoppageMinutes(undefined)).toBe(0);
    expect(stoppageMinutes(0)).toBe(0);
    expect(stoppageMinutes(180)).toBe(3);
    // Defensive: a hand-built fixture must not be able to make a fractional half.
    expect(stoppageMinutes(200)).toBe(3);
  });

  it("never labels two different playing-time minutes the same way", () => {
    // The property the whole decoding rests on. If it failed, two events would
    // claim the same minute and the timeline would read as a duplicate.
    for (const h1 of [0, 60, 180, 480]) {
      const seen = new Set<string>();
      for (let m = 1; m <= REGULATION_MINUTES + h1 / 60 + 8; m++) {
        const label = matchMinuteLabel(m, h1);
        expect(seen.has(label)).toBe(false);
        seen.add(label);
      }
    }
  });
});

describe("matchClock — period markers", () => {
  it("derives the board, the break and full time from the box score's own numbers", () => {
    const markers = periodMarkers(180, -420);
    expect(markers.map((m) => m.label)).toEqual(["added", "Half time", "added", "Full time"]);
    // First-half board shows 3 and sits at 45:00; the break is three minutes later.
    expect(markers[0].addedMinutes).toBe(3);
    expect(markers[0].minute).toBe(45);
    expect(markers[1].minute).toBe(48);
    // Second-half stoppage is the whistle past the 90, NET of the first half's:
    // finalClock -420 with 180 of it already played means four added, not seven.
    expect(markers[2].addedMinutes).toBe(4);
    expect(markers[3].minute).toBe(eventMinute(-420));
  });

  it("shows no board when a half added nothing, rather than a +0 row", () => {
    const markers = periodMarkers(undefined, -180);
    expect(markers.map((m) => m.label)).toEqual(["Half time", "added", "Full time"]);
    expect(markers[0].minute).toBe(45);
  });

  it("omits full time when the box score never recorded the whistle", () => {
    const markers = periodMarkers(120, undefined);
    expect(markers.map((m) => m.label)).toEqual(["added", "Half time"]);
  });
});

describe("matchClock — timeline merge", () => {
  it("puts a marker after the events of the minute it closes", () => {
    // The board goes up at the END of the 45th minute, not in the middle of it.
    const events = [ev(2700, "goal"), ev(1000, "goal")];
    const items = matchTimeline(events, periodMarkers(60, -120));
    const kinds = items.map((i) => i.kind);
    expect(kinds[0]).toBe("event"); // the 2700 goal
    expect(kinds[1]).toBe("marker"); // then the board at 2700
  });

  it("reveals only what has happened by a given minute", () => {
    const events = [ev(5000), ev(1000)];
    const items = matchTimeline(events, periodMarkers(60, -120), 10);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("event");
  });

  it("is chronological — descending clock", () => {
    const items = matchTimeline([ev(1000), ev(5000), ev(3000)], []);
    expect(items.map((i) => i.clock)).toEqual([5000, 3000, 1000]);
  });
});
