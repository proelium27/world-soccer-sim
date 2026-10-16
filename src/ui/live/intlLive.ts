/**
 * Watching an international match: the one just played in the stage the
 * National Teams Schedule asked for, dug out of whichever competition holds it.
 *
 * The live viewer is club-shaped. It names and colours its two sides from a
 * StoredTeam list keyed by tid, and nations are keyed by `nid`, an index into
 * one campaign's `nations` that collides with real club tids. So every nation
 * is shifted up by NATION_TID_BASE into stand-in teams the viewer can read,
 * and the flag is drawn through LiveMatchView's `crest` hook rather than a
 * club crest that would belong to whichever club owns that tid.
 *
 * Pure and free of React, like liveCandidates.
 */
import type { StoredTeam } from "../../core/teams/clubs.js";
import type {
  InternationalState, IntlGroup, IntlGroupMatch, IntlTournament,
} from "../../core/international/index.js";
import { nextKnockoutRound, roundsRemaining } from "../../core/international/index.js";
import type { CupTie } from "../../core/cup/types.js";
import type { LiveTableRow } from "../components/LiveMatchView.js";
import { matchLineups } from "./lineups.js";
import { scoreAtMinute, type LiveMatch } from "./liveMatch.js";
import type { LiveView } from "./liveCandidates.js";
import { koRoundName } from "../intlRounds.js";

/** Far above any club tid, so a nation can never pick up a club's crest or colours. */
export const NATION_TID_BASE = 1_000_000;

/** Which international competition a fixture belongs to. */
export type IntlComp =
  | { kind: "qualifying" }
  | { kind: "worldCup" }
  | { kind: "confederation"; confederation: string };

/** One fixture, by the two nids that play it. Unique within a stage. */
export interface IntlWatchTarget {
  comp: IntlComp;
  home: number;
  away: number;
}

/** The fixture list a competition keeps: a qualifying campaign or a tournament. */
interface Fixtures {
  nations: string[];
  groups: IntlGroup[];
  /** Null for qualifying, which has no bracket on this page. */
  tournament: IntlTournament | null;
  name: string;
}

export function intlFixtures(intl: InternationalState, comp: IntlComp): Fixtures | null {
  if (comp.kind === "qualifying") {
    const q = intl.qualifying;
    return q ? { nations: q.nations, groups: q.groups, tournament: null, name: "World Cup qualifying" } : null;
  }
  const t = comp.kind === "worldCup"
    ? intl.tournament
    : intl.confederationCups.find((c) => c.confederation === comp.confederation) ?? null;
  return t ? { nations: t.nations, groups: t.groups, tournament: t, name: t.name } : null;
}

/** Stand-in teams for one campaign's nations, in the shape the viewer reads. */
export function nationTeams(nations: string[]): StoredTeam[] {
  return nations.map((nation, nid) => ({
    tid: NATION_TID_BASE + nid,
    name: nation,
    abbrev: nation.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(),
    colors: ["#888888", "#444444"],
  }) as unknown as StoredTeam);
}

const asTid = (nid: number) => NATION_TID_BASE + nid;

function groupLive(m: IntlGroupMatch): LiveMatch {
  return {
    home: asTid(m.home),
    away: asTid(m.away),
    matchday: 0,
    events: m.boxScore!.events,
    finalClock: m.boxScore!.finalClock,
    firstHalfStoppage: m.boxScore!.firstHalfStoppage,
  };
}

function tieLive(t: CupTie): LiveMatch {
  return {
    home: asTid(t.home),
    away: asTid(t.away),
    matchday: 0,
    events: t.boxScore!.events,
    finalClock: t.boxScore!.finalClock,
    firstHalfStoppage: t.boxScore!.firstHalfStoppage,
    extraTimeClock: t.boxScore?.extraTimeClock,
    penalties: t.wentToPens ? { home: t.homePens, away: t.awayPens } : undefined,
  };
}

/**
 * A group's table at `minute` of round `round`: everything before that round
 * counted at full time, that round's games at their live score. Points, then
 * goal difference, then goals scored, which is enough to order a rail.
 */
function groupRowsAtMinute(group: IntlGroup, round: number, leg: number, minute: number): LiveTableRow[] {
  const rows = new Map(group.nids.map((nid) => [nid, { points: 0, gd: 0, gf: 0 }]));
  for (const m of group.matches) {
    if (m.homeGoals < 0) continue;
    const mLeg = m.leg ?? 0;
    if (mLeg > leg || (mLeg === leg && m.round > round)) continue;
    let hg = m.homeGoals;
    let ag = m.awayGoals;
    if (mLeg === leg && m.round === round) {
      if (!m.boxScore) continue;
      const s = scoreAtMinute(m.boxScore.events, minute);
      hg = s.home;
      ag = s.away;
    }
    const h = rows.get(m.home);
    const a = rows.get(m.away);
    if (!h || !a) continue;
    h.gf += hg; a.gf += ag;
    h.gd += hg - ag; a.gd += ag - hg;
    if (hg > ag) h.points += 3;
    else if (ag > hg) a.points += 3;
    else { h.points += 1; a.points += 1; }
  }
  return [...rows.entries()]
    .sort(([, x], [, y]) => y.points - x.points || y.gd - x.gd || y.gf - x.gf)
    .map(([nid, r]) => ({ tid: asTid(nid), points: r.points }));
}

/** "Group C, matchday 2", or with a confederation in front for qualifying. */
function groupSubtitle(group: IntlGroup, index: number, m: IntlGroupMatch, qualifying: boolean): string {
  const name = qualifying
    ? `${group.confederation ?? "Group"} group ${index + 1}`
    : `Group ${String.fromCharCode(65 + index)}`;
  return `${name}, game ${m.round + 1}`;
}

export interface IntlLive {
  view: LiveView;
  /** For the picker line, should one ever be shown. */
  detail: string;
}

/**
 * The watched match, out of the state AFTER its stage was played. `before` is
 * what says which fixtures that stage played: a group match that was unplayed
 * before and is played now, or a tie in the round that was next.
 *
 * Null when the target wasn't in this stage, or kept no box score to replay.
 */
export function intlLiveView(
  before: InternationalState,
  after: InternationalState,
  target: IntlWatchTarget,
): IntlLive | null {
  const prior = intlFixtures(before, target.comp);
  const now = intlFixtures(after, target.comp);
  if (!prior || !now) return null;
  const teams = nationTeams(now.nations);
  const nationOf = (tid: number) => now.nations[tid - NATION_TID_BASE];
  const qualifying = target.comp.kind === "qualifying";

  // A group match this stage played.
  for (let g = 0; g < prior.groups.length; g++) {
    const j = prior.groups[g].matches.findIndex(
      (m) => m.homeGoals < 0 && m.home === target.home && m.away === target.away,
    );
    if (j < 0) continue;
    const group = now.groups[g];
    const m = group?.matches[j];
    if (!m || m.homeGoals < 0 || !m.boxScore) return null;
    const leg = m.leg ?? 0;
    const others = group.matches.filter(
      (o, k) => k !== j && o.boxScore && (o.leg ?? 0) === leg && o.round === m.round
        && prior.groups[g].matches[k]?.homeGoals < 0,
    );
    const subtitle = groupSubtitle(group, g, m, qualifying);
    return {
      detail: `${subtitle}, ${now.nations[m.home]} v ${now.nations[m.away]}`,
      view: {
        teams,
        nationOf,
        match: groupLive(m),
        otherMatches: others.map(groupLive),
        competitionName: now.name,
        subtitle,
        tableAtMinute: (minute) => groupRowsAtMinute(group, m.round, leg, minute),
        lineups: matchLineups(m.boxScore),
      },
    };
  }

  // A knockout tie in the round that was next.
  if (prior.tournament && now.tournament) {
    const { round, field } = nextKnockoutRound(prior.tournament);
    const totalRounds = round + Math.log2(Math.max(2, field.length));
    const today = now.tournament.ties.filter((t) => t.round === round && t.boxScore);
    const tie = today.find((t) => t.home === target.home && t.away === target.away);
    if (!tie?.boxScore) return null;
    const subtitle = koRoundName(round, totalRounds);
    return {
      detail: `${subtitle}, ${now.nations[tie.home]} v ${now.nations[tie.away]}`,
      view: {
        teams,
        nationOf,
        match: tieLive(tie),
        otherMatches: today.filter((t) => t !== tie).map(tieLive),
        competitionName: now.name,
        subtitle,
        tableAtMinute: null,
        lineups: matchLineups(tie.boxScore),
      },
    };
  }
  return null;
}

/** The competition the next stage plays in, for a page to open on. Null with nothing pending. */
export function stageComp(intl: InternationalState): IntlComp | null {
  switch (intl.stage) {
    case "qualifying": return { kind: "qualifying" };
    case "groups":
    case "knockout": return { kind: "worldCup" };
    case "confederation-groups":
    case "confederation-ko": {
      const live = intl.stage === "confederation-ko"
        ? intl.confederationCups.find((c) => roundsRemaining(c) > 0)
        : intl.confederationCups.find((c) => c.groups.some((g) => g.matches.some((m) => m.homeGoals < 0)));
      return live ? { kind: "confederation", confederation: live.confederation } : null;
    }
    default: return null;
  }
}

/** Consecutive pairs of a knockout field: the ties its next round will play. */
export function fieldPairs(field: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < field.length; i += 2) out.push([field[i], field[i + 1]]);
  return out;
}

/**
 * Whether the next international stage plays this fixture, which is what puts
 * a Watch button on it. Mirrors playIntlStage: one qualifying leg, a whole
 * group stage, or one knockout round (in a confederation cup, only the cups
 * with the most rounds left, since the finals are aligned).
 */
export function inNextStage(intl: InternationalState, comp: IntlComp, home: number, away: number): boolean {
  const unplayedGroupMatch = (groups: IntlGroup[], leg?: number) => groups.some((g) =>
    g.matches.some((m) => m.homeGoals < 0 && m.home === home && m.away === away
      && (leg === undefined || (m.leg ?? 0) === leg)));
  const nextTie = (t: IntlTournament) =>
    fieldPairs(nextKnockoutRound(t).field).some(([h, a]) => h === home && a === away);

  switch (intl.stage) {
    case "qualifying": {
      const q = intl.qualifying;
      if (comp.kind !== "qualifying" || !q) return false;
      const pending = q.groups.flatMap((g) => g.matches.filter((m) => m.homeGoals < 0).map((m) => m.leg ?? 0));
      return pending.length > 0 && unplayedGroupMatch(q.groups, Math.min(...pending));
    }
    case "groups":
      return comp.kind === "worldCup" && !!intl.tournament && unplayedGroupMatch(intl.tournament.groups);
    case "knockout":
      return comp.kind === "worldCup" && !!intl.tournament && roundsRemaining(intl.tournament) > 0
        && nextTie(intl.tournament);
    case "confederation-groups":
    case "confederation-ko": {
      if (comp.kind !== "confederation") return false;
      const cup = intl.confederationCups.find((c) => c.confederation === comp.confederation);
      if (!cup) return false;
      if (intl.stage === "confederation-groups") return unplayedGroupMatch(cup.groups);
      const deepest = Math.max(0, ...intl.confederationCups.map(roundsRemaining));
      return deepest > 0 && roundsRemaining(cup) === deepest && nextTie(cup);
    }
    default:
      return false;
  }
}
