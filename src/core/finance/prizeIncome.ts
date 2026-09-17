/**
 * What a club has earned in prize money this season, broken down by where it
 * came from.
 *
 * **Derived, never stored, and that is the same call the trophy and honours
 * news make.** A cup prize is a pure function of results the save already
 * keeps — who won which tie, who drew which league-phase match — so recording
 * it again would be a second copy of the same fact that could drift from the
 * first. Deriving it costs no persisted field, no `migrate.ts` change, and it
 * works on a save created before this existed: open the Finance page and the
 * season's cup earnings are simply there.
 *
 * **The risk this carries is drift in the other direction**, and it is real:
 * these rules are a restatement of `cup/simCup.ts` and `domesticCup/simCup.ts`,
 * so a change to what the sim pays would leave this quietly reporting the old
 * number. Two things hold them together. Every *amount* comes from the sim's
 * own helpers (`cupFormat().prizes`, `koWinPrize`, `domesticPrizeForRound`,
 * `domesticCupScaleFor`) rather than being re-read from constants here, so no
 * retune of a prize can pass this by. And `prizeIncome.test.ts` plays real cups
 * and asserts these totals equal the sum of what the sim actually credited,
 * which is what catches a change in the *rules* rather than the amounts.
 *
 * League prize money is deliberately absent: it is paid at season-end
 * settlement rather than banked during the season, and the Finance page already
 * projects it in its own card. This answers "what has the cup run put in the
 * bank", which is a different question.
 */
import type { LeagueStore } from "../leagueState.js";
import type { CupState } from "../cup/types.js";
import type { DomesticCupState } from "../domesticCup/types.js";
import type { Competition } from "../competitions.js";
import { cupFormat, koWinPrize, koFinalRound } from "../cup/cup.js";
import { domesticPrizeForRound, roundsFromFinal } from "../domesticCup/cup.js";
import { domesticCupScaleFor } from "./budget.js";
import { competitionOf } from "../competitions.js";
import {
  DOMESTIC_CUP_GLAMOUR_TIE_BONUS,
  DOMESTIC_CUP_PRIZE_RUNNER_UP,
} from "../constants.js";

/** One earning line, e.g. "League phase wins" or "Quarter-final". */
export interface PrizeLine {
  label: string;
  amount: number;
}

/** One competition's contribution, with the lines that make it up. */
export interface PrizeSource {
  competition: string;
  lines: PrizeLine[];
  total: number;
}

export interface PrizeIncome {
  sources: PrizeSource[];
  total: number;
}

/** Fold repeated labels ("Round win" x3) into one line carrying a count. */
function collect(raw: { label: string; amount: number }[]): PrizeLine[] {
  const byLabel = new Map<string, { amount: number; count: number }>();
  for (const { label, amount } of raw) {
    if (amount <= 0) continue;
    const prev = byLabel.get(label);
    if (prev) {
      prev.amount += amount;
      prev.count += 1;
    } else {
      byLabel.set(label, { amount, count: 1 });
    }
  }
  return [...byLabel].map(([label, { amount, count }]) => ({
    label: count > 1 ? `${label} (x${count})` : label,
    amount,
  }));
}

/**
 * Continental Cup or Shield earnings for one club.
 *
 * Mirrors `playLeaguePhaseRound` / `playPlayoffRound` / `playKnockoutLeg`:
 * participation once the first league-phase round has been played, per-result
 * money for every played league-phase match, the playoff win, each knockout
 * round the club won, and the runner-up cheque for losing the final. Paid flat,
 * with no `financeScale` — a Serbian club earns exactly what an English one
 * does, which is the point of continental money.
 */
export function continentalPrizeIncome(cup: CupState | null, tid: number): PrizeSource | null {
  if (!cup) return null;
  const { participation, leaguePhaseWin, leaguePhaseDraw, playoffWin, runnerUp } =
    cupFormat(cup).prizes;
  const raw: { label: string; amount: number }[] = [];

  const lp = cup.leaguePhase;
  if (lp?.teams.includes(tid)) {
    // Participation is credited when round 0 is played, not at the draw, so a
    // club that has qualified but not yet kicked off has banked nothing. A
    // straight-knockout cup has no round 0 and pays it on its first tie or leg.
    const started = cup.shape?.opening === "knockout"
      ? (cup.playoff?.ties.length ?? 0) > 0 || cup.ties.length > 0 || (cup.koLegs?.length ?? 0) > 0
      : lp.matches.some((m) => m.played && m.round === 0);
    if (started) {
      raw.push({ label: "Reaching the league phase", amount: participation });
    }
    for (const m of lp.matches) {
      if (!m.played || (m.home !== tid && m.away !== tid)) continue;
      if (m.homeGoals === m.awayGoals) {
        raw.push({ label: "League phase draw", amount: leaguePhaseDraw });
      } else {
        const won = m.homeGoals > m.awayGoals ? m.home : m.away;
        if (won === tid) raw.push({ label: "League phase win", amount: leaguePhaseWin });
      }
    }
  }

  for (const tie of cup.playoff?.ties ?? []) {
    if (tie.winner === tid) raw.push({ label: "Winning the playoff", amount: playoffWin });
  }

  const finalRound = koFinalRound(cup);
  for (const tie of cup.ties) {
    if (tie.home !== tid && tie.away !== tid) continue;
    if (tie.winner === tid) {
      raw.push({ label: knockoutLabel(tie.round, finalRound), amount: koWinPrize(cup, tie.round) });
    } else if (tie.round === finalRound) {
      raw.push({ label: "Runner-up", amount: runnerUp });
    }
  }

  const lines = collect(raw);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return total > 0 ? { competition: cupName(cup), lines, total } : null;
}

/** "Quarter-final" / "Semi-final" / "Winning the final", counted back from the final. */
function knockoutLabel(round: number, finalRound: number): string {
  const fromFinal = finalRound - round;
  if (fromFinal === 0) return "Winning the final";
  if (fromFinal === 1) return "Semi-final";
  if (fromFinal === 2) return "Quarter-final";
  return `Round of ${2 ** (fromFinal + 1)}`;
}

function cupName(cup: CupState): string {
  if (cup.competition === "shield") return "Continental Shield";
  if (cup.competition === "americas") return "Americas Cup";
  return "Continental Cup";
}

/**
 * Domestic cup earnings for one club.
 *
 * Mirrors `playDomesticRound`: the round-win prize, the glamour-tie gate
 * receipts (paid to the smaller club only, win or lose, scaled by how many
 * divisions separate the two), and the final's runner-up cheque. Everything is
 * scaled by `domesticCupScaleFor`, which is country-scaled but deliberately
 * flat across tiers — so this reports the cheque the club actually banked.
 */
export function domesticCupPrizeIncome(
  cup: DomesticCupState | null,
  competitions: Competition[],
  tid: number,
  compId: number,
  userTid: number,
  difficulty: LeagueStore["difficulty"],
  tierOf: (tid: number) => number,
): PrizeSource | null {
  if (!cup) return null;
  const scale = domesticCupScaleFor(competitions, compId, tid, userTid, difficulty);
  const raw: { label: string; amount: number }[] = [];

  for (const round of cup.rounds) {
    for (const tie of round.ties) {
      if (tie.home !== tid && tie.away !== tid) continue;
      const fromFinal = roundsFromFinal(cup, round.round);
      if (tie.winner === tid) {
        raw.push({
          label: fromFinal === 0 ? "Winning the cup" : `${domesticLabel(fromFinal)} win`,
          amount: domesticPrizeForRound(cup, round.round) * scale,
        });
      } else if (fromFinal === 0) {
        raw.push({ label: "Runner-up", amount: DOMESTIC_CUP_PRIZE_RUNNER_UP * scale });
      }
      const gap = Math.abs(tierOf(tie.home) - tierOf(tie.away));
      const smaller = tierOf(tie.home) > tierOf(tie.away) ? tie.home : tie.away;
      if (gap > 0 && smaller === tid) {
        raw.push({
          label: "Glamour tie (drawing a bigger club)",
          amount: gap * DOMESTIC_CUP_GLAMOUR_TIE_BONUS * scale,
        });
      }
    }
  }

  const lines = collect(raw);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return total > 0 ? { competition: cup.name, lines, total } : null;
}

function domesticLabel(fromFinal: number): string {
  if (fromFinal === 1) return "Semi-final";
  if (fromFinal === 2) return "Quarter-final";
  return "Round";
}

/**
 * Every cup prize one club has banked this season, across all three
 * competitions it can be in at once.
 */
export function seasonPrizeIncome(league: LeagueStore, tid: number): PrizeIncome {
  const team = league.teams.find((t) => t.tid === tid);
  if (!team) return { sources: [], total: 0 };

  const tierOf = (id: number): number => {
    const t = league.teams.find((x) => x.tid === id);
    return t ? competitionOf(league.competitions, t.compId).tier : 1;
  };
  const country = competitionOf(league.competitions, team.compId).country;
  const domestic = league.domesticCups.find((c) => c.country === country) ?? null;

  const sources = [
    continentalPrizeIncome(league.cup, tid),
    continentalPrizeIncome(league.shield, tid),
    continentalPrizeIncome(league.americasCup ?? null, tid),
    domesticCupPrizeIncome(
      domestic, league.competitions, tid, team.compId,
      league.meta.userTid, league.difficulty, tierOf,
    ),
  ].filter((s): s is PrizeSource => s !== null);

  return { sources, total: sources.reduce((sum, s) => sum + s.total, 0) };
}
