/**
 * What a board expects from its club in continental football, and how it reads
 * what happened.
 *
 * Two separate asks, both judged every season:
 *
 * - **Qualifying.** A club the board expects to finish inside its league's
 *   continental places is expected to earn one. The two European competitions
 *   are two rungs (the Continental Cup above the Shield), so a club expected in
 *   the Cup that only makes the Shield falls one rung short; the Americas has a
 *   single competition, worth both rungs. Getting in when nobody expected it,
 *   through the table or by winning the domestic cup, counts the other way.
 * - **The run.** A club playing in a continental competition is expected to go
 *   as far as its seed in the draw says. The top seed is expected to win it, the
 *   next to reach the final, the next two the semi-finals, and a low seed just
 *   to take part. Both sides become a place in the field (an exit's place is the
 *   middle of the places its losers share), the same scale the league verdict
 *   uses, so the board's demand and the difficulty's patience apply unchanged.
 *
 * The seed comes from last season's tables, so no transfer can move it — the
 * same property the league expectation is built on (see expectation.ts).
 *
 * **Reads nothing the simulation worker holds back.** The review runs inside the
 * worker, which is handed empty cup histories (see simArchive's detachNews), so
 * everything here comes from the competitions and this season's cups alone.
 * That is why qualification is judged against each league's standing slot
 * counts rather than the rolling-coefficient allocation, which needs the
 * archive: the two differ only where a country has won or lost a place, and
 * then by one position at the cut.
 *
 * Pure, rng-free.
 */
import type { Competition } from "../competitions.js";
import { competitionRegion } from "../competitions.js";
import type { CupState } from "../cup/types.js";
import type { StandingsRow } from "../standings.js";
import type { DomesticCupState } from "../domesticCup/types.js";
import {
  clubCupRun, cupRoundName, cupSplitPlan, isSwissCup, koFinalRound, koRoundsOf,
  CUP_STAGE_LEAGUE_PHASE, CUP_STAGE_PLAYOFF,
} from "../cup/cup.js";
import {
  cupSlotsForCompetition, domesticCupWinners, qualificationByTid,
} from "../cup/qualification.js";
import { CONTINENTAL_ORDER, CUP_FORMATS, type CupCompetitionId } from "../constants.js";

/* ── Qualifying ──────────────────────────────────────────────────────────── */

/** A region's competitions, best first. Europe: the Cup, then the Shield. */
function regionLadder(comp: Competition): CupCompetitionId[] {
  const region = competitionRegion(comp);
  return CONTINENTAL_ORDER.filter((id) => CUP_FORMATS[id].region === region);
}

/**
 * How high a competition sits, in rungs: 2 for a region's top competition, 1
 * for the one below, 0 for none. A single-competition region's only competition
 * is its top one, so missing it costs as much as missing Europe outright.
 */
function levelOf(comp: Competition, id: CupCompetitionId | null): number {
  if (id === null) return 0;
  const index = regionLadder(comp).indexOf(id);
  return index === -1 ? 0 : 2 - index;
}

/**
 * Which continental competition a club finishing `rank` in `comp` would earn
 * through the table, or null. Only a top flight earns places this way.
 */
export function expectedContinentalPlace(comp: Competition, rank: number): CupCompetitionId | null {
  if (comp.tier !== 1) return null;
  let cut = 0;
  for (const id of regionLadder(comp)) {
    cut += cupSlotsForCompetition(comp, CUP_FORMATS[id]);
    if (rank <= cut) return id;
  }
  return null;
}

export interface QualificationJudgement {
  /** The competition the board expected, or null if it didn't expect one. */
  expected: CupCompetitionId | null;
  /** The competition earned, or null. */
  earned: CupCompetitionId | null;
  /** Rungs above (+) or below (-) what they expected. */
  rungs: number;
}

/**
 * Which competition this season's tables and cups actually earned the club,
 * off the same allocation the offseason makes (routes included: a domestic cup
 * winner or a holder can come in from anywhere in the table).
 */
export function judgeQualification(
  competitions: Competition[],
  tables: ReadonlyMap<number, StandingsRow[]>,
  cups: { cup: CupState | null; shield: CupState | null; americasCup?: CupState | null; domesticCups: DomesticCupState[] },
  comp: Competition,
  tid: number,
  expectedRank: number,
): QualificationJudgement {
  const earnedBy = qualificationByTid(competitions, tables, {
    domesticCupWinners: domesticCupWinners(cups.domesticCups),
    holders: {
      continental: cups.cup?.championTid ?? undefined,
      shield: cups.shield?.championTid ?? undefined,
      americas: cups.americasCup?.championTid ?? undefined,
    },
  });
  const expected = expectedContinentalPlace(comp, expectedRank);
  const earned = earnedBy.get(tid)?.competition ?? null;
  return { expected, earned, rungs: levelOf(comp, earned) - levelOf(comp, expected) };
}

/* ── The run ─────────────────────────────────────────────────────────────── */

/** One way a run in a continental competition can end. */
export interface CupStage {
  /** "champion", a knockout round index, or one of the two early exits. */
  kind: "champion" | "knockout" | "playoff" | "opening";
  round: number | null;
  placeHi: number;
  placeLo: number;
  place: number;
}

function stage(kind: CupStage["kind"], round: number | null, hi: number, lo: number): CupStage {
  return { kind, round, placeHi: hi, placeLo: lo, place: (hi + lo) / 2 };
}

/**
 * Every exit from a competition's shape, deepest first, off the cup itself so a
 * custom format (God Mode) or a small field reads correctly. Null for a legacy
 * straight-bracket cup, which has no seeded field to set an expectation from.
 */
export function cupStages(cup: CupState): CupStage[] | null {
  if (!isSwissCup(cup) || !cup.seeds) return null;
  const field = cup.leaguePhase!.teams.length;
  const koSize = cup.teams.length;
  const koRounds = koRoundsOf(cup);
  const playoffLosers = Math.floor(cupSplitPlan(cup).playoffTeams / 2);
  const out: CupStage[] = [stage("champion", null, 1, 1)];
  for (let r = koRounds - 1; r >= 0; r--) {
    const inRound = 2 ** (koRounds - r);
    out.push(stage("knockout", r, inRound / 2 + 1, inRound));
  }
  let next = koSize + 1;
  if (playoffLosers > 0) {
    out.push(stage("playoff", CUP_STAGE_PLAYOFF, next, next + playoffLosers - 1));
    next += playoffLosers;
  }
  if (field >= next) out.push(stage("opening", CUP_STAGE_LEAGUE_PHASE, next, field));
  return out;
}

/** The stage a club's seed says it should reach. */
function stageForSeed(stages: CupStage[], seed: number): CupStage | null {
  return stages.find((s) => seed >= s.placeHi && seed <= s.placeLo) ?? null;
}

/** Where a club's run in a finished competition ended, or null if it wasn't in it. */
function stageReached(cup: CupState, stages: CupStage[], tid: number): CupStage | null {
  const run = clubCupRun(cup, tid);
  if (!run) return null;
  if (run.round === koFinalRound(cup) && run.wonRound) return stages[0];
  return stages.find((s) => s.round === run.round && s.kind !== "champion") ?? null;
}

/** "the opening round": what a cup calls the stage everyone starts in. */
function openingName(cup: CupState): string {
  if (cup.leaguePhase?.groups) return "the group stage";
  return "the league phase";
}

function roundLabel(cup: CupState, round: number): string {
  return `the ${cupRoundName(round, koRoundsOf(cup)).toLowerCase()}`;
}

/** What a board wants from a seed, in words; null when taking part is the ask. */
function goalLabel(cup: CupState, s: CupStage): string | null {
  switch (s.kind) {
    case "champion": return "win it";
    case "knockout": return s.placeLo === 2 ? "reach the final" : `reach ${roundLabel(cup, s.round!)}`;
    case "playoff": return `get out of ${openingName(cup)}`;
    case "opening": return null;
  }
}

function resultLabel(cup: CupState, s: CupStage): string {
  switch (s.kind) {
    case "champion": return "won it";
    case "knockout": return s.placeLo === 2 ? "lost the final" : `went out in ${roundLabel(cup, s.round!)}`;
    case "playoff": return "went out in the playoff round";
    case "opening": return `went out in ${openingName(cup)}`;
  }
}

export interface ContinentalRunJudgement {
  competition: CupCompetitionId;
  /** The competition's display name. */
  name: string;
  seed: number;
  field: number;
  goal: string | null;
  result: string;
  expectedPlace: number;
  actualPlace: number;
}

/**
 * A club's run in whichever of this season's competitions it played in, judged
 * against its seed. Null if it played in none, or the competition isn't
 * finished (the review only runs once it is).
 */
export function judgeContinentalRun(
  cups: readonly (CupState | null | undefined)[],
  tid: number,
): ContinentalRunJudgement | null {
  for (const cup of cups) {
    if (!cup || cup.championTid === null) continue;
    const seed = cup.seeds?.[tid];
    if (seed === undefined) continue;
    const stages = cupStages(cup);
    if (!stages) continue;
    const expected = stageForSeed(stages, seed);
    const reached = stageReached(cup, stages, tid);
    if (!expected || !reached) continue;
    return {
      competition: cup.competition,
      name: cup.name,
      seed,
      field: cup.leaguePhase!.teams.length,
      goal: goalLabel(cup, expected),
      result: resultLabel(cup, reached),
      expectedPlace: expected.place,
      actualPlace: reached.place,
    };
  }
  return null;
}

/**
 * The board's continental goals for a club right now, for the UI: the
 * competition it should qualify for, and what it should do in the one it is
 * playing in this season (if any).
 */
export function boardContinentalGoals(
  comp: Competition | undefined,
  expectedRank: number,
  liveCups: readonly (CupState | null | undefined)[],
  tid: number,
): { qualify: string | null; run: { name: string; goal: string | null; seed: number } | null } {
  const qualifyId = comp ? expectedContinentalPlace(comp, expectedRank) : null;
  let run: { name: string; goal: string | null; seed: number } | null = null;
  for (const cup of liveCups) {
    const seed = cup?.seeds?.[tid];
    if (!cup || seed === undefined) continue;
    const stages = cupStages(cup);
    const expected = stages ? stageForSeed(stages, seed) : null;
    if (!expected) continue;
    run = { name: cup.name, goal: goalLabel(cup, expected), seed };
    break;
  }
  return { qualify: qualifyId ? CUP_FORMATS[qualifyId].name : null, run };
}
