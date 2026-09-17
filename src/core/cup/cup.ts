import type { Competition } from "../competitions.js";
import type { StandingsRow } from "../standings.js";
import type { CupState, CupPlayoff, CupTie } from "./types.js";
import { hashInts } from "../../engine/rng.js";
import type { CupFormat } from "../constants.js";
import {
  CUP_ROUNDS, CUP_ROUND_MATCHDAYS,
  CUP_KO_ROUND_MATCHDAYS, CUP_KO_LEG_MATCHDAYS,
  CUP_PLAYOFF_MATCHDAY, cupKnockoutPlan,
  CUP_FORMATS, CONTINENTAL_CUP_FORMAT,
} from "../constants.js";
import type { QualificationContext } from "./qualification.js";
import { cupPlan, qualifyCupTeams } from "./qualification.js";
import {
  drawLeaguePhase, leaguePhaseTable, splitLeaguePhase, leaguePhaseComplete,
  drawGroups, groupQualifiers,
} from "./leaguePhase.js";
import {
  isDefaultContinentalFormat, resolveCupShape, buildCupCalendar, splitOf,
  CUP_KO_MAX_SIZE_CUSTOM, type ContinentalFormatSettings,
} from "./cupShape.js";

/** Legacy straight-bracket size (2^CUP_ROUNDS = 16), used only by pre-Swiss saves. */
export const CUP_BRACKET_SIZE = 2 ** CUP_ROUNDS;

/** Furthest-stage sentinels for clubCupRun on a Swiss cup (KO rounds are 0 = QF … up). */
export const CUP_STAGE_PLAYOFF = -1;
export const CUP_STAGE_LEAGUE_PHASE = -2;

/* ── Format helpers ──────────────────────────────────────────────────────────
 * A cup is "Swiss" (all new saves) when it carries a league phase; otherwise
 * it's a legacy straight bracket kept alive only to finish an old mid-season
 * save. The knockout accessors below return the right schedule/prizes for each. */

/**
 * The competition format a cup belongs to — its qualification slots, prize
 * money and rng streams. Defaults to the Continental Cup for a save written
 * before the competitions were split (migrate stamps those, but a cup that
 * reaches here unstamped must not blow up).
 */
export function cupFormat(cup: CupState): CupFormat {
  return CUP_FORMATS[cup.competition] ?? CONTINENTAL_CUP_FORMAT;
}

export function isSwissCup(cup: CupState): boolean {
  return !!cup.leaguePhase;
}

/**
 * Number of knockout rounds: for a Swiss cup, however deep its own bracket is
 * (3 for a QF→Final eight, 2 for a SF→Final four); 4 (R16→Final) for legacy.
 *
 * Read off `cup.teams.length` rather than a constant, because the bracket is
 * sized from the field (see cupKnockoutPlan) and a small competition genuinely
 * has fewer rounds. An old save's cup carries eight slots and so still answers
 * 3, which is why this needs no migration.
 */
export function koRoundsOf(cup: CupState): number {
  if (!isSwissCup(cup)) return CUP_ROUNDS;
  return Math.max(1, Math.round(Math.log2(cup.teams.length || 2)));
}

/**
 * League matchdays for each knockout round, by cup format (the last/only leg of
 * each round). A shallower bracket takes the **last** rounds of the table, so a
 * smaller cup still finishes on the same matchday as everything else — the final
 * is the fixture the run-in and the stop-before-the-user's-final check are
 * built around, and moving it forward would strand both.
 */
export function koRoundMatchdays(cup: CupState): readonly number[] {
  if (!isSwissCup(cup)) return CUP_ROUND_MATCHDAYS;
  if (cup.calendar) return cup.calendar.ko.map((legs) => legs[legs.length - 1]);
  return CUP_KO_ROUND_MATCHDAYS.slice(CUP_KO_ROUND_MATCHDAYS.length - koRoundsOf(cup));
}

/**
 * The league matchday(s) each knockout round is played on, indexed by round
 * then by leg. A two-legged Swiss cup's QF/SF have two matchdays each (leg 1,
 * leg 2) and its final one; every other cup (single-leg Swiss, legacy) has one
 * matchday per round. Whether a round is two-legged is read off the leg count
 * here, so this table is the single source of truth for the knockout calendar.
 */
export function koLegMatchdays(cup: CupState): readonly (readonly number[])[] {
  // A custom format (God Mode) carries the calendar it was drawn with.
  if (cup.calendar && isSwissCup(cup)) return cup.calendar.ko;
  if (isSwissCup(cup) && cup.twoLegged) {
    return CUP_KO_LEG_MATCHDAYS.slice(CUP_KO_LEG_MATCHDAYS.length - koRoundsOf(cup));
  }
  return koRoundMatchdays(cup).map((md) => [md]);
}

/** Whether knockout round `r` is played over two legs (only two-legged Swiss QF/SF). */
export function isTwoLeggedRound(cup: CupState, round: number): boolean {
  return koLegMatchdays(cup)[round]?.length === 2;
}

/** Per-win knockout prizes, by cup format and competition. */
export function koPrizeByRound(cup: CupState): readonly number[] {
  const { prizes } = cupFormat(cup);
  return isSwissCup(cup) ? prizes.koByRound : prizes.legacyKoByRound;
}

/**
 * The prize for winning knockout round `round`.
 *
 * A custom-format cup (one with a stored `shape`) counts rounds back from the
 * final, so its semi-final pays the semi-final prize however deep the bracket
 * is, and a Round of 16 — deeper than any prize table — pays half a
 * quarter-final. A shipped-format cup keeps the original indexing (0 = the
 * first knockout round) so no existing save's prize money moves; that indexing
 * only differs for a bracket shallower than the quarter-finals, which only a
 * hand-built world with a tiny field reaches.
 */
export function koWinPrize(cup: CupState, round: number): number {
  const byRound = koPrizeByRound(cup);
  if (!cup.shape) return byRound[round] ?? 0;
  const idx = byRound.length - 1 - (koFinalRound(cup) - round);
  return idx >= 0 ? byRound[idx] ?? 0 : Math.round((byRound[0] ?? 0) / 2);
}

/** Round index of the final for this cup (the round the user's sim halts before). */
export function koFinalRound(cup: CupState): number {
  return koRoundsOf(cup) - 1;
}

/* ── Qualification ──────────────────────────────────────────────────
 * Lives in ./qualification.ts, and is re-exported here because that is where
 * every caller has always imported it from. It moved out when a club stopped
 * being able to qualify by league position alone (title holders and domestic
 * cup winners), which turned qualifying from a slice of each league's table
 * into one pass over every competition at once — see that file's header. */
export type { CupPlan, Entrant, QualificationRoute, QualificationContext } from "./qualification.js";
export {
  cupPlan, worldHasCup, cupSlotsForCompetition, cupOffsetForCompetition, cupSlotRange,
  qualifyCupTeams, allocateContinentalPlaces, qualificationByTid,
} from "./qualification.js";

/**
 * Standard single-elimination seed ordering for a bracket of `n` slots
 * (n a power of 2): returns the 1-based seed sitting in each bracket position,
 * built so the top seeds only meet in the final. For n=8: [1,8,4,5,2,7,3,6].
 */
export function seedOrder(n: number): number[] {
  let pols = [1, 2];
  while (pols.length < n) {
    const length = pols.length * 2 + 1;
    const out: number[] = [];
    for (const p of pols) {
      out.push(p);
      out.push(length - p);
    }
    pols = out;
  }
  return pols;
}

/**
 * Seed the next season's Swiss cup from a completed season's per-competition
 * final tables: qualify the field, seed it, and draw the league phase. The
 * knockout bracket (CupState.teams, sized from the field by cupKnockoutPlan)
 * stays empty until the league phase and playoff resolve — see
 * seedKnockoutFromLeaguePhase. Returns null when the world can't field a cup
 * (see cupPlan).
 */
export function buildCupState(
  competitions: Competition[],
  tablesByCompId: Map<number, StandingsRow[]>,
  season: number,
  format: CupFormat = CONTINENTAL_CUP_FORMAT,
  routes: QualificationContext = {},
  /** The save's format for this competition (God Mode). Absent or default → the shipped format, built exactly as before. */
  settings?: ContinentalFormatSettings,
): CupState | null {
  const plan = cupPlan(competitions, format);
  if (!plan) return null;
  const { field, drawGroups: countryOf } = qualifyCupTeams(competitions, tablesByCompId, format, routes);
  if (field.length !== plan.total) return null;
  if (settings && !isDefaultContinentalFormat(settings)) {
    return buildCustomCupState(field, countryOf, season, format, settings);
  }
  const drawGroups = countryOf;

  const seeds: Record<number, number> = {};
  field.forEach((tid, i) => (seeds[tid] = i + 1));
  const matches = drawLeaguePhase(field, drawGroups, hashInts(season, format.drawSeed));
  return {
    competition: format.id,
    season,
    name: format.name,
    teams: new Array<number>(cupKnockoutPlan(field.length).koSize).fill(-1),
    seeds,
    leaguePhase: { teams: field, matches },
    playoff: null,
    playIn: null,
    ties: [],
    championTid: null,
    twoLegged: true,
    koLegs: null,
    // Live cup: stats are summed from box scores until it is archived.
    statLines: null,
  };
}

/**
 * Draw a cup in a custom format (see core/cup/cupShape.ts). The qualified field
 * is the same one the shipped format would use — formats change how a
 * competition is played, never who is in it — except that a straight knockout
 * holds at most two full Round-of-16 brackets, so a bigger field loses its
 * lowest seeds.
 */
function buildCustomCupState(
  qualified: number[],
  countryOf: Map<number, number>,
  season: number,
  format: CupFormat,
  settings: ContinentalFormatSettings,
): CupState {
  const field = settings.opening === "knockout"
    ? qualified.slice(0, 2 * CUP_KO_MAX_SIZE_CUSTOM)
    : qualified;
  const shape = resolveCupShape(field.length, settings);
  const calendar = buildCupCalendar(shape, shape.playoffTeams > 0);
  const seeds: Record<number, number> = {};
  field.forEach((tid, i) => (seeds[tid] = i + 1));
  const drawSeed = hashInts(season, format.drawSeed);

  const leaguePhase = shape.opening === "groups"
    ? { teams: field, ...drawGroups(field, countryOf, drawSeed, calendar.opening) }
    : shape.opening === "league"
      ? { teams: field, matches: drawLeaguePhase(field, countryOf, drawSeed, shape.openingGames, calendar.opening) }
      : { teams: field, matches: [] };

  const cup: CupState = {
    competition: format.id,
    season,
    name: format.name,
    teams: new Array<number>(shape.koSize).fill(-1),
    seeds,
    leaguePhase,
    playoff: null,
    playIn: null,
    ties: [],
    championTid: null,
    twoLegged: shape.twoLegged,
    koLegs: null,
    statLines: null,
    shape,
    calendar,
  };
  // A straight knockout has no opening stage to wait for: seed it now, by seed.
  return shape.opening === "knockout" ? seedBracket(cup, field, splitOf(shape)) : cup;
}

/* ── Swiss league phase → knockout seeding ───────────────────────────────────*/

/* ── Naming a cup's stages ────────────────────────────────────────────────────
 * One place for the words, so the cup page, the schedule, the dashboard panel
 * and the live viewer can't call the same stage two different things. */

/** "Group stage" for a groups-format cup, "League phase" otherwise. */
export function openingStageName(cup: CupState): string {
  return cup.leaguePhase?.groups ? "Group stage" : "League phase";
}

/** Whether a cup opens with a stage of games at all (a straight knockout doesn't). */
export function hasOpeningStage(cup: CupState): boolean {
  return (cup.leaguePhase?.matches.length ?? 0) > 0;
}

/** "Preliminary round" for a straight knockout, "Playoff Round" otherwise. */
export function prelimRoundName(cup: CupState): string {
  return cup.shape?.opening === "knockout" ? "Preliminary round" : cupRoundName(CUP_STAGE_PLAYOFF);
}

/** How this cup's Swiss table splits: the stored split for a custom format, else sized off the field as shipped. */
export function cupSplitPlan(cup: CupState): { koSize: number; directQF: number; playoffTeams: number } {
  return cup.shape ? splitOf(cup.shape) : cupKnockoutPlan(cup.leaguePhase?.teams.length ?? 0);
}

/** Whether the knockout bracket has been seeded from the league phase yet. */
export function knockoutSeeded(cup: CupState): boolean {
  return cup.teams.some((t) => t >= 0) || cup.playoff !== null;
}

/**
 * Once the league phase is complete, split its table and seed the knockout
 * bracket: the direct qualifiers take the top seeds outright, and the playoff
 * entrants are paired highest-against-lowest (in a 24-club cup, 5v12, 6v11, …)
 * with the winner of tie i taking the next seed down. Bracket order via
 * seedOrder so the top seeds can only meet late. No-op if not applicable /
 * already seeded.
 *
 * Both halves are sized by cupKnockoutPlan off the field, and **either can be
 * empty**: a 16-club field advances exactly a bracket's worth, so there is no
 * playoff to play and `playoff` is left null rather than set to a round with no
 * ties in it — playoffDue would otherwise fire on an empty round forever.
 */
export function seedKnockoutFromLeaguePhase(cup: CupState): CupState {
  if (!cup.leaguePhase || knockoutSeeded(cup) || !leaguePhaseComplete(cup.leaguePhase)) return cup;
  if (cup.leaguePhase.groups) return seedFromGroups(cup);
  const table = leaguePhaseTable(cup.leaguePhase, cup.seeds);
  return seedBracket(cup, table.map((r) => r.tid), cup.shape ? splitOf(cup.shape) : undefined);
}

/**
 * Seed the bracket (and any playoff) from a ranked list of clubs, best first:
 * the direct places take the top seeds outright and the playoff pairs the next
 * group highest-against-lowest, each winner taking the next seed down. Shared
 * by the Swiss table and the straight-knockout opening (where the ranking is
 * simply the qualification seeding).
 */
function seedBracket(
  cup: CupState,
  ranked: number[],
  plan?: { koSize: number; directQF: number; playoffTeams: number },
): CupState {
  const { directQF, playoff } = splitLeaguePhase(ranked.map((tid) => ({ tid })), plan);
  const koSize = cup.teams.length;

  const order = seedOrder(koSize); // seed sitting at each bracket position
  const teams = order.map((seed) => (seed <= directQF.length ? directQF[seed - 1] : -1));
  if (playoff.length === 0) return { ...cup, teams, playoff: null };

  const playoffTeams: number[] = [];
  const half = playoff.length / 2;
  for (let i = 0; i < half; i++) playoffTeams.push(playoff[i], playoff[playoff.length - 1 - i]);
  const slots: number[] = [];
  for (let s = directQF.length + 1; s <= koSize; s++) slots.push(order.indexOf(s));

  const matchday = cup.calendar?.playoff ?? CUP_PLAYOFF_MATCHDAY;
  const playoffRound: CupPlayoff = { teams: playoffTeams, slots, matchday, ties: [] };
  return { ...cup, teams, playoff: playoffRound };
}

/**
 * Seed the bracket from a finished group stage. Qualifiers are ranked winners,
 * then runners-up, then third-placed sides (see groupQualifiers) and placed by
 * seedOrder, so the best group winners can only meet late. Seeding alone can
 * pair two clubs from the same group in the first round — a rematch the group
 * has just settled — so a repair pass swaps the lower-seeded side of any such
 * pair with the lower-seeded side of another pair wherever that clears both.
 */
function seedFromGroups(cup: CupState): CupState {
  const lp = cup.leaguePhase!;
  const koSize = cup.teams.length;
  const quals = groupQualifiers(lp, cup.seeds, koSize);
  const order = seedOrder(koSize);
  const slots = order.map((seed) => quals[seed - 1] ?? null);
  const groupAt = (i: number): number => slots[i]?.group ?? -1 - i;
  for (let p = 0; p < koSize; p += 2) {
    if (groupAt(p) !== groupAt(p + 1)) continue;
    for (let q = 0; q < koSize; q += 2) {
      if (q === p) continue;
      // Swap the lower-seeded side of each pair (the odd slot holds it by seedOrder).
      if (groupAt(q + 1) !== groupAt(p) && groupAt(p + 1) !== groupAt(q)) {
        [slots[p + 1], slots[q + 1]] = [slots[q + 1], slots[p + 1]];
        break;
      }
    }
  }
  return { ...cup, teams: slots.map((x) => x?.tid ?? -1), playoff: null };
}

/** Whether the playoff is due to be played at `matchday` (seeded, and not yet played). */
export function playoffDue(cup: CupState, matchday: number): boolean {
  return cup.playoff !== null && cup.playoff.ties.length === 0 && matchday >= cup.playoff.matchday;
}

/** Whether a playoff exists and still needs playing — the quarter-finals must wait for it. */
export function playoffPending(cup: CupState): boolean {
  return cup.playoff !== null && cup.playoff.ties.length === 0;
}

/** Fill the bracket's four playoff slots with the tie winners and record the completed playoff ties. */
export function applyPlayoff(cup: CupState, ties: CupTie[]): CupState {
  if (!cup.playoff) return cup;
  const teams = [...cup.teams];
  cup.playoff.slots.forEach((slot, i) => { if (ties[i]) teams[slot] = ties[i].winner; });
  return { ...cup, teams, playoff: { ...cup.playoff, ties } };
}

/* ── Legacy play-in (pre-Swiss saves only) ───────────────────────────────────*/

/** Whether the legacy preliminary play-in is due at `matchday` (and not already played). */
export function playInDue(cup: CupState, matchday: number): boolean {
  return cup.playIn !== null && cup.playIn.ties.length === 0 && matchday >= cup.playIn.matchday;
}

/** Whether a legacy play-in exists and still needs playing — the round of 16 must wait. */
export function playInPending(cup: CupState): boolean {
  return cup.playIn !== null && cup.playIn.ties.length === 0;
}

/** Fill the legacy bracket's two play-in slots with the tie winners. */
export function applyPlayIn(cup: CupState, ties: CupTie[]): CupState {
  if (!cup.playIn) return cup;
  const teams = [...cup.teams];
  cup.playIn.slots.forEach((slot, i) => { if (ties[i]) teams[slot] = ties[i].winner; });
  return { ...cup, teams, playIn: { ...cup.playIn, ties } };
}

/* ── Knockout (shared by both formats) ───────────────────────────────────────*/

/** How many knockout rounds have already been played (a full round is played atomically). */
export function completedRounds(cup: CupState): number {
  return new Set(cup.ties.map((t) => t.round)).size;
}

/** Winners of a completed round, in bracket order (so they pair up cleanly for the next round). */
export function winnersOfRound(cup: CupState, round: number): number[] {
  return cup.ties.filter((t) => t.round === round).map((t) => t.winner);
}

/** The [home, away] pairings for round `r` — bracket order for the opener, else the previous round's winners paired up. */
export function matchupsForRound(cup: CupState, round: number): [number, number][] {
  const teams = round === 0 ? cup.teams : winnersOfRound(cup, round - 1);
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) pairs.push([teams[i], teams[i + 1]]);
  return pairs;
}

export function isCupComplete(cup: CupState): boolean {
  return cup.championTid !== null;
}

/** The two finalists, known once the semi-finals are complete (empty before then). */
export function cupFinalists(cup: CupState): number[] {
  return winnersOfRound(cup, koFinalRound(cup) - 1);
}

/**
 * How far each club got, as **rounds from the final**: 0 = won it, 1 = lost the
 * final, 2 = out in the semis, 3 = out in the quarters, and every other
 * participant one step worse again (never reached the knockout at all).
 *
 * Deliberately measured backwards from the final rather than by raw round
 * index, because the round numbering isn't the same across formats — a Swiss
 * cup's knockout opens at the quarter-finals (round 0 = QF), a legacy bracket's
 * at the round of 16. Counting down from the final means "out in the semis" is
 * the same number in both.
 */
export function cupRoundsFromFinal(cup: CupState): Map<number, number> {
  const finalRound = koFinalRound(cup);
  const out = new Map<number, number>();
  const participants = cup.leaguePhase ? cup.leaguePhase.teams : cup.teams;
  for (const tid of participants) if (tid >= 0) out.set(tid, finalRound + 2);
  for (const tie of cup.ties) {
    for (const tid of [tie.home, tie.away]) {
      const reached = finalRound - tie.round + (tid === tie.winner ? 0 : 1);
      const best = out.get(tid);
      if (best === undefined || reached < best) out.set(tid, reached);
    }
  }
  return out;
}

/** A knockout leg due to be played: which round, which leg (0/1), and whether the round is two-legged. */
export interface DueLeg {
  round: number;
  leg: number; // 0 = first leg (or the only leg of a single-leg round), 1 = second leg
  twoLeg: boolean;
  matchday: number; // the leg's scheduled matchday
}

/**
 * The knockout leg due to be played at `matchday`, or null if none is. For a
 * Swiss cup the knockout can't start until the league phase and playoff have
 * filled the bracket; for a legacy cup, until the play-in has. Within a
 * two-legged round the first leg comes due first; once it's played (its results
 * held in `cup.koLegs`) the second leg comes due on its own later matchday.
 */
export function dueCupLeg(cup: CupState, matchday: number): DueLeg | null {
  if (isCupComplete(cup)) return null;
  if (isSwissCup(cup)) {
    if (!cup.leaguePhase || !leaguePhaseComplete(cup.leaguePhase)) return null;
    if (playoffPending(cup)) return null;
  } else if (playInPending(cup)) {
    return null;
  }
  const round = completedRounds(cup);
  if (round >= koRoundsOf(cup)) return null;
  const legMds = koLegMatchdays(cup)[round];
  const twoLeg = legMds.length === 2;
  // First leg still outstanding? koLegs holds the current round's first legs.
  const leg = twoLeg && cup.koLegs && cup.koLegs.length > 0 ? 1 : 0;
  const md = legMds[leg];
  return matchday >= md ? { round, leg, twoLeg, matchday: md } : null;
}

/**
 * The knockout round due to be played at `matchday`, or null if none is — a
 * thin wrapper over dueCupLeg for callers that only care about the round (the
 * stop-before-final check, UI). See dueCupLeg for the full leg detail.
 */
export function dueCupRound(cup: CupState, matchday: number): number | null {
  return dueCupLeg(cup, matchday)?.round ?? null;
}

/**
 * One club's furthest stage in a single cup and whether it won that stage's tie.
 * For a Swiss cup the stage may be a knockout round (0 = QF …), CUP_STAGE_PLAYOFF
 * (lost the playoff), or CUP_STAGE_LEAGUE_PHASE (didn't reach the playoff). Null
 * if the club didn't take part / no result yet.
 */
export function clubCupRun(cup: CupState, tid: number): { round: number; wonRound: boolean } | null {
  // Furthest knockout tie (shared by both formats).
  let round = -Infinity;
  let wonRound = false;
  for (const tie of cup.ties) {
    if ((tie.home === tid || tie.away === tid) && tie.round > round) {
      round = tie.round;
      wonRound = tie.winner === tid;
    }
  }
  if (round > -Infinity) return { round, wonRound };

  if (isSwissCup(cup)) {
    if (!cup.leaguePhase!.teams.includes(tid)) return null;
    if (cup.playoff && cup.playoff.ties.length > 0) {
      const tie = cup.playoff.ties.find((t) => t.home === tid || t.away === tid);
      if (tie) return { round: CUP_STAGE_PLAYOFF, wonRound: tie.winner === tid };
    }
    return { round: CUP_STAGE_LEAGUE_PHASE, wonRound: false };
  }

  if (!cup.teams.includes(tid)) return null;
  return null; // legacy: qualified but no tie played yet
}

/** Display name for a knockout round index, given the cup's total knockout rounds. */
export function cupRoundName(round: number, koRounds: number = CUP_KO_ROUND_MATCHDAYS.length): string {
  if (round === CUP_STAGE_LEAGUE_PHASE) return "League Phase";
  if (round === CUP_STAGE_PLAYOFF) return "Playoff Round";
  const teamsInRound = 2 ** (koRounds - round);
  switch (teamsInRound) {
    case 2: return "Final";
    case 4: return "Semi-finals";
    case 8: return "Quarter-finals";
    default: return `Round of ${teamsInRound}`;
  }
}

/**
 * A club's cup run in one season summarised for history: a short label
 * ("Winners", "Semi-finals", "Playoff", "League phase", …) plus champion /
 * runner-up flags — all format-aware, so it works for Swiss and legacy cups
 * alike. Null if the club didn't take part.
 */
export function cupRunSummary(
  cup: CupState,
  tid: number,
): { note: string; isChampion: boolean; isRunnerUp: boolean } | null {
  const run = clubCupRun(cup, tid);
  if (!run) return null;
  const finalRound = koFinalRound(cup);
  const isChampion = run.round === finalRound && run.wonRound;
  const isRunnerUp = run.round === finalRound && !run.wonRound;
  const note =
    run.round === CUP_STAGE_LEAGUE_PHASE ? (cup.leaguePhase?.groups ? "Group stage" : "League phase")
      : run.round === CUP_STAGE_PLAYOFF ? "Playoff"
        : isChampion ? "Winners"
          : isRunnerUp ? "Runners-up"
            : cupRoundName(run.round, koRoundsOf(cup));
  return { note, isChampion, isRunnerUp };
}
