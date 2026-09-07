/**
 * What the user can watch on a given matchday, and everything the viewer needs
 * to show it.
 *
 * Cup matchdays are ordinary league matchdays too (the schedule has no cup
 * awareness), so a qualified club can have two matches on one matchday. This
 * gathers both and lets the caller ask which one to play.
 *
 * Pure and free of React so the awkward part — digging one club's match out of
 * four different cup shapes — can be tested directly.
 */
import type { LeagueStore } from "../../core/leagueState.js";
import type { PlayedMatch } from "../../core/standings.js";
import type { CupState } from "../../core/cup/types.js";
import { competitionOf } from "../../core/competitions.js";
import { cupRoundName, koRoundsOf } from "../../core/cup/cup.js";
import type { DomesticCupState } from "../../core/domesticCup/types.js";
import { domesticRoundName } from "../../core/domesticCup/cup.js";
import { leaguePhaseTable } from "../../core/cup/leaguePhase.js";
import type { LiveTableRow } from "../components/LiveMatchOverlay.js";
import type { LiveChoice } from "../components/LiveMatchPicker.js";
import {
  liveTableRows,
  scoreAtMinute,
  splitTwoLeggedEvents,
  toLiveMatch,
  type LiveMatch,
} from "./liveMatch.js";
import { pointsDeductionMap } from "../../core/finance/debt.js";

export interface LiveView {
  match: LiveMatch;
  otherMatches: LiveMatch[];
  competitionName: string;
  subtitle?: string;
  tableAtMinute: ((minute: number) => LiveTableRow[]) | null;
}

export interface LiveCandidate {
  key: "league" | "cup" | "domestic";
  choice: LiveChoice;
  view: LiveView;
}

/** "at home to Kestrel City" / "away to Kestrel City", from the user's side. */
function versus(userTid: number, home: number, away: number, nameOf: (tid: number) => string): string {
  return home === userTid ? `at home to ${nameOf(away)}` : `away to ${nameOf(home)}`;
}

/**
 * The user's league fixture. `before` supplies the table's starting point,
 * since the matchday it is about to play is exactly what the live table adds.
 */
function leagueCandidate(
  before: LeagueStore,
  mdResults: PlayedMatch[],
  nameOf: (tid: number) => string,
): LiveCandidate | null {
  const userTid = before.meta.userTid;
  const played = mdResults.find((m) => m.home === userTid || m.away === userTid);
  const userTeam = before.teams.find((t) => t.tid === userTid);
  if (!played || !userTeam) return null;

  const compTeamIds = before.teams.filter((t) => t.compId === userTeam.compId).map((t) => t.tid);
  const inComp = new Set(compTeamIds);
  const match = toLiveMatch(played);
  // The rail shows the user's own division. Every competition in the world
  // plays the same day, and all sixteen at once is noise.
  const otherMatches = mdResults
    .filter((m) => m !== played && inComp.has(m.home))
    .map(toLiveMatch);
  const priorMatches = before.played.filter((m) => inComp.has(m.home));
  const competitionName = competitionOf(before.competitions, userTeam.compId).name;

  return {
    key: "league",
    choice: {
      key: "league",
      title: competitionName,
      detail: `Matchday ${played.matchday}, ${versus(userTid, played.home, played.away, nameOf)}`,
    },
    view: {
      match,
      otherMatches,
      competitionName,
      tableAtMinute: (minute) =>
        liveTableRows(
          compTeamIds, priorMatches, [match, ...otherMatches], minute,
          pointsDeductionMap(before.debtSanctions, before.season),
        ),
    },
  };
}

/** The Swiss table, with this matchday's games counted at their current score. */
function leaguePhaseRowsAtMinute(
  cup: CupState,
  matchday: number,
  minute: number,
): LiveTableRow[] {
  const lp = cup.leaguePhase!;
  const matches = lp.matches.map((m) => {
    if (m.matchday !== matchday || !m.boxScore) return m;
    const score = scoreAtMinute(m.boxScore.events, minute);
    return { ...m, homeGoals: score.home, awayGoals: score.away };
  });
  return leaguePhaseTable({ ...lp, matches }, cup.seeds).map((r) => ({
    tid: r.tid,
    points: r.points,
  }));
}

/**
 * The user's Continental Cup match, dug out of whichever shape holds it.
 *
 * Four cases, because the cup stores a match four different ways:
 *  - a league-phase match, on `leaguePhase.matches`;
 *  - a playoff tie, on `playoff.ties`;
 *  - a knockout **first** leg, held on `koLegs` until its second leg resolves it;
 *  - a finished tie on `ties` — the final (one match), or a second leg, whose
 *    events have to be split back out of the merged two-leg stream.
 *
 * Reads the POST-sim cup, since that's the one holding this matchday's results.
 */
function cupCandidate(
  cup: CupState | null,
  userTid: number,
  matchday: number,
  nameOf: (tid: number) => string,
): LiveCandidate | null {
  if (!cup) return null;
  const competitionName = cup.name;
  const koRounds = koRoundsOf(cup);

  const build = (
    match: LiveMatch,
    otherMatches: LiveMatch[],
    subtitle: string,
    tableAtMinute: ((minute: number) => LiveTableRow[]) | null,
  ): LiveCandidate => ({
    key: "cup",
    choice: {
      key: "cup",
      title: competitionName,
      detail: `${subtitle}, ${versus(userTid, match.home, match.away, nameOf)}`,
    },
    view: { match, otherMatches, competitionName, subtitle, tableAtMinute },
  });

  const mine = (home: number, away: number) => home === userTid || away === userTid;

  // 1. League phase.
  const lp = cup.leaguePhase;
  if (lp) {
    const today = lp.matches.filter((m) => m.matchday === matchday && m.played && m.boxScore);
    const ours = today.find((m) => mine(m.home, m.away));
    if (ours) {
      const asLive = (m: typeof ours): LiveMatch => ({
        home: m.home,
        away: m.away,
        matchday,
        events: m.boxScore!.events,
      });
      return build(
        asLive(ours),
        today.filter((m) => m !== ours).map(asLive),
        `League phase, round ${ours.round + 1}`,
        (minute) => leaguePhaseRowsAtMinute(cup, matchday, minute),
      );
    }
  }

  // 2. Playoff round — single leg, no table to stand in.
  const po = cup.playoff;
  if (po && po.matchday === matchday && po.ties.length > 0) {
    const ours = po.ties.find((t) => mine(t.home, t.away));
    if (ours?.boxScore) {
      const asLive = (t: typeof ours): LiveMatch => ({
        home: t.home,
        away: t.away,
        matchday,
        events: t.boxScore!.events,
      });
      return build(
        asLive(ours),
        po.ties.filter((t) => t !== ours && t.boxScore).map(asLive),
        "Playoff round",
        null,
      );
    }
  }

  // 3. A knockout first leg, still held pending its second.
  const legs = cup.koLegs;
  if (legs && legs.length > 0) {
    const ours = legs.find((l) => mine(l.home, l.away));
    if (ours) {
      const asLive = (l: typeof ours): LiveMatch => ({
        home: l.home,
        away: l.away,
        matchday,
        events: l.boxScore.events,
      });
      return build(
        asLive(ours),
        legs.filter((l) => l !== ours).map(asLive),
        `${cupRoundName(ours.round, koRounds)}, first leg`,
        null,
      );
    }
  }

  // 4. A tie finished on this matchday: the final, or a second leg.
  const ties = cup.ties.filter((t) => t.matchday === matchday && t.boxScore);
  const ours = ties.find((t) => mine(t.home, t.away));
  if (ours?.boxScore) {
    const twoLegged = (t: typeof ours): boolean => (t.legs?.length ?? 0) === 2;
    const asLive = (t: typeof ours): LiveMatch =>
      twoLegged(t)
        ? // Leg 2 is played at the other ground, so the clubs swap and the
          // events already use that orientation — no flipping needed.
          { home: t.away, away: t.home, matchday, events: splitTwoLeggedEvents(t.boxScore!.events)[1] }
        : { home: t.home, away: t.away, matchday, events: t.boxScore!.events };
    const round = cupRoundName(ours.round, koRounds);
    return build(
      asLive(ours),
      ties.filter((t) => t !== ours).map(asLive),
      twoLegged(ours) ? `${round}, second leg` : round,
      null,
    );
  }

  return null;
}

/**
 * The user's domestic cup tie, if his country's cup played a round today.
 *
 * Far simpler than the Continental Cup's four shapes: a domestic cup keeps one
 * list of rounds and every tie is single-leg, so it's one lookup. There is no
 * table to stand in beside the match, since a knockout has none.
 *
 * Reads the POST-sim cups, which are the ones holding today's results.
 */
function domesticCandidate(
  cups: DomesticCupState[],
  userTid: number,
  matchday: number,
  nameOf: (tid: number) => string,
): LiveCandidate | null {
  for (const cup of cups) {
    const round = cup.rounds.find((r) => r.matchday === matchday && r.ties.length > 0);
    if (!round) continue;
    const ours = round.ties.find((t) => t.home === userTid || t.away === userTid);
    if (!ours?.boxScore) continue;

    const asLive = (t: typeof ours): LiveMatch => ({
      home: t.home,
      away: t.away,
      matchday,
      events: t.boxScore!.events,
    });
    const subtitle = domesticRoundName(cup, round.round);
    return {
      key: "domestic",
      choice: {
        key: "domestic",
        title: cup.name,
        detail: `${subtitle}, ${versus(userTid, ours.home, ours.away, nameOf)}`,
      },
      view: {
        match: asLive(ours),
        otherMatches: round.ties.filter((t) => t !== ours && t.boxScore).map(asLive),
        competitionName: cup.name,
        subtitle,
        tableAtMinute: null,
      },
    };
  }
  return null;
}

/**
 * Everything the user could watch on the matchday just simulated, in the order
 * the engine played them — the cup round runs before the league fixtures.
 */
export function liveCandidates(
  before: LeagueStore,
  after: LeagueStore,
  mdResults: PlayedMatch[],
  nameOf: (tid: number) => string,
): LiveCandidate[] {
  const userTid = before.meta.userTid;
  const league = leagueCandidate(before, mdResults, nameOf);
  const matchday = league?.view.match.matchday ?? mdResults[0]?.matchday;
  if (matchday === undefined) return [];
  const cup = cupCandidate(after.cup, userTid, matchday, nameOf);
  const domestic = domesticCandidate(after.domesticCups ?? [], userTid, matchday, nameOf);
  return [cup, domestic, league].filter((c): c is LiveCandidate => c !== null);
}
