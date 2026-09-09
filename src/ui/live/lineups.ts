/**
 * Who lined up, in what shape, derived from a finished match's own box score.
 *
 * Nothing about a lineup is stored as a lineup. What the save holds is a line
 * per player who appeared, each stamped with the formation slot he played
 * (`PlayerMatchLine.slot`), plus the timestamped substitution events. That is
 * enough to recover both halves exactly:
 *
 *  - a **starter** is anyone who appeared and was never substituted ON, which
 *    is exact and needs no assumption about the order of the lines;
 *  - a **formation** is the multiset of the starting eleven's slots, which
 *    identifies it outright because every shape in FORMATIONS is a distinct
 *    multiset (formations.ts pins that, and the sim knows a shape by its slots
 *    and nothing else).
 *
 * The one thing genuinely unavailable is the unused bench: `finishLines` keeps
 * a line only for players who appeared, so a substitute who never came on left
 * no trace in the match at all. Callers say "substitutes used" rather than
 * implying a full bench.
 *
 * Pure and free of React so the rules can be tested against real engine output.
 */
import type {
  BoxScore,
  MatchEvent,
  MatchPosition,
  PlayerMatchLine,
} from "../../engine/attribution.js";
import { FORMATIONS, type FormationId } from "../../core/lineup/formations.js";
import { eventMinute } from "./liveMatch.js";

/** Reading order for a team sheet: back to front, which is the order FORMATIONS uses. */
const SLOT_ORDER: MatchPosition[] = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];

const SLOT_RANK = new Map<MatchPosition, number>(SLOT_ORDER.map((p, i) => [p, i]));

export interface LineupPlayer {
  pid: number;
  /** The slot he played. Null on a box score written before slots were recorded. */
  slot: MatchPosition | null;
}

export interface LineupSub {
  /** Coming on. */
  on: number;
  /** Making way. */
  off: number;
  minute: number;
  /** The slot the arriving player took over, where it is known. */
  slot: MatchPosition | null;
}

export interface SideLineup {
  /**
   * The shape the eleven started in, or null when it can't be named — a legacy
   * box score with no slots recorded, or a set of slots matching no shipped
   * formation (reachable when a squad is too short to fill one, since selectXI
   * leaves the trailing slots empty rather than refusing to pick a team).
   */
  formation: FormationId | null;
  starters: LineupPlayer[];
  subs: LineupSub[];
}

export interface MatchLineups {
  home: SideLineup;
  away: SideLineup;
}

/** A stable key for a multiset of slots: sorted, so the order they arrive in is irrelevant. */
function slotKey(slots: MatchPosition[]): string {
  return [...slots].sort().join(",");
}

const FORMATION_BY_SLOTS = new Map<string, FormationId>(
  (Object.keys(FORMATIONS) as FormationId[]).map((id) => [
    slotKey(FORMATIONS[id] as MatchPosition[]),
    id,
  ]),
);

/** Name the shape an eleven lined up in, or null if these slots aren't one. */
export function formationOf(slots: (MatchPosition | null)[]): FormationId | null {
  if (slots.length !== 11 || slots.some((s) => s === null)) return null;
  return FORMATION_BY_SLOTS.get(slotKey(slots as MatchPosition[])) ?? null;
}

function sideLineup(
  lines: PlayerMatchLine[],
  events: MatchEvent[],
  side: "home" | "away",
): SideLineup {
  const subs: LineupSub[] = [];
  const cameOn = new Set<number>();
  const slotOf = new Map<number, MatchPosition | null>(lines.map((l) => [l.pid, l.slot ?? null]));

  // Chronological — the clock counts down, so descending clock runs forwards.
  for (const e of [...events].sort((a, b) => b.clock - a.clock)) {
    if (e.type !== "substitution" || e.side !== side) continue;
    // commitSub logs [off, on].
    const [off, on] = e.pids;
    cameOn.add(on);
    subs.push({ on, off, minute: eventMinute(e.clock), slot: slotOf.get(on) ?? null });
  }

  const starters = lines
    .filter((l) => !cameOn.has(l.pid))
    .map((l) => ({ pid: l.pid, slot: l.slot ?? null }));

  // Sorted back to front rather than left in array order. The array happens to
  // be the XI in formation order followed by the bench, but that is an
  // incidental property of how finishLines walks the roster, and a team sheet
  // is read by position either way.
  starters.sort((a, b) => {
    const ra = a.slot ? SLOT_RANK.get(a.slot) ?? SLOT_ORDER.length : SLOT_ORDER.length;
    const rb = b.slot ? SLOT_RANK.get(b.slot) ?? SLOT_ORDER.length : SLOT_ORDER.length;
    return ra - rb;
  });

  return { formation: formationOf(starters.map((s) => s.slot)), starters, subs };
}

/**
 * Both team sheets for a match.
 *
 * Pass the events actually being shown when they are narrower than the box
 * score's own: a single leg of a two-legged tie must not be read against the
 * other leg's substitutions.
 */
export function matchLineups(box: BoxScore, events: MatchEvent[] = box.events): MatchLineups {
  return {
    home: sideLineup(box.home, events, "home"),
    away: sideLineup(box.away, events, "away"),
  };
}
