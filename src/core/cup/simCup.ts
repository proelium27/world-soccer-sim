import type { Composites } from "../../engine/composites.js";
import type { MatchPlayer, PlayerMatchLine, BoxScore } from "../../engine/attribution.js";
import type { TeamMatchData } from "../league/composites.js";
import type { CupState, CupTie, KnockoutLeg } from "./types.js";
import { simMatchDetailed, resolveShot, finisherAdj } from "../../engine/matchSim.js";
import { pickShooter, pickAssister, emptyLine } from "../../engine/attribution.js";
import { mulberry32, hashInts } from "../../engine/rng.js";
import {
  matchupsForRound, applyPlayIn, applyPlayoff, cupFormat,
  isSwissCup, koWinPrize, koFinalRound, seedKnockoutFromLeaguePhase, dueCupLeg,
} from "./cup.js";
import {
  CUP_ET_CHANCES_PER_SIDE, CUP_PEN_BEST_OF, CUP_PEN_BASE_CONVERSION,
} from "../constants.js";

/** Play-in ties are tagged with this round index (they live in cup.playIn.ties, not cup.ties). */
const PLAYIN_ROUND = -1;
/** Playoff ties are tagged with this round index (they live in cup.playoff.ties, not cup.ties). */
const PLAYOFF_ROUND = -1;
/** rng-stream offset for league-phase rounds, kept clear of the knockout rounds' own streams. */
const LEAGUE_PHASE_STREAM = 100;
/** rng-stream offset for the playoff round. */
const PLAYOFF_STREAM = 50;

/**
 * The rng tag for a cup's own streams. Two competitions run in the same season
 * on the same matchdays, so **every** stream here must be salted by which one
 * it is — without it the Shield's quarter-final would draw the identical
 * sequence as the Continental Cup's. The continental tag is 30, the literal
 * these streams shipped with, so existing saves are unmoved.
 */
function streamTag(cup: CupState): number {
  return cupFormat(cup).streamTag;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Find a side's box-score line by pid, creating a fresh one if the player has none yet. */
function lineFor(lines: PlayerMatchLine[], pid: number): PlayerMatchLine {
  let line = lines.find((l) => l.pid === pid);
  if (!line) {
    line = emptyLine(pid);
    lines.push(line);
  }
  return line;
}

/**
 * Merge one leg's box-score lines for a club into an accumulator (keyed by pid):
 * every counting stat sums across the two legs, and `rating` becomes a
 * minutes-weighted mean of the legs a player featured in (so a full-90 leg
 * weighs more than a cameo). Used to fold two-legged ties into a single tie
 * box score, so cup stats and the box-score UI treat the tie as one line.
 */
function mergeLines(acc: PlayerMatchLine[], add: PlayerMatchLine[]): void {
  for (const src of add) {
    const dst = acc.find((l) => l.pid === src.pid);
    if (!dst) {
      acc.push({ ...src });
      continue;
    }
    const totalMin = dst.minutesPlayed + src.minutesPlayed;
    dst.rating = totalMin > 0
      ? (dst.rating * dst.minutesPlayed + src.rating * src.minutesPlayed) / totalMin
      : (dst.rating + src.rating) / 2;
    dst.goals += src.goals;
    dst.assists += src.assists;
    dst.shots += src.shots;
    dst.shotsOnTarget += src.shotsOnTarget;
    dst.xg += src.xg;
    dst.goalsAgainst += src.goalsAgainst;
    dst.xga += src.xga;
    dst.saves += src.saves;
    dst.tackles += src.tackles;
    dst.interceptions += src.interceptions;
    dst.passes += src.passes;
    dst.passesCompleted += src.passesCompleted;
    dst.crosses += src.crosses;
    dst.foulsCommitted += src.foulsCommitted;
    dst.yellowCards += src.yellowCards;
    dst.redCards += src.redCards;
    dst.minutesPlayed += src.minutesPlayed;
  }
}

/**
 * Extra time: each side takes CUP_ET_CHANCES_PER_SIDE shots resolved with the
 * same block→off-target→save→goal cascade as regulation, attributed to a
 * picked shooter/assister and (for goals/xGA) the defending keeper, mutating
 * the existing box score in place. Returns the extra-time goals added per side.
 */
function playExtraTime(
  rng: () => number,
  homeComp: Composites,
  awayComp: Composites,
  homeXI: MatchPlayer[],
  awayXI: MatchPlayer[],
  box: BoxScore,
): { homeGoals: number; awayGoals: number } {
  const sideGoals = (
    offComp: Composites,
    defComp: Composites,
    attackers: MatchPlayer[],
    offLines: PlayerMatchLine[],
    defXI: MatchPlayer[],
    defLines: PlayerMatchLine[],
  ): number => {
    let goals = 0;
    const gk = defXI.find((p) => p.pos === "GK");
    for (let i = 0; i < CUP_ET_CHANCES_PER_SIDE; i++) {
      const shooter = pickShooter(rng, attackers);
      const shot = resolveShot(rng, offComp, defComp, finisherAdj(shooter, attackers, "shooting"));
      const line = lineFor(offLines, shooter.pid);
      line.shots++;
      line.xg += shot.xg;
      if (gk) lineFor(defLines, gk.pid).xga += shot.xg;
      if (shot.outcome === "saved") {
        line.shotsOnTarget++;
        if (gk) lineFor(defLines, gk.pid).saves++;
      } else if (shot.outcome === "goal") {
        line.shotsOnTarget++;
        line.goals++;
        goals++;
        if (gk) lineFor(defLines, gk.pid).goalsAgainst++;
        const assister = pickAssister(rng, attackers, shooter.pid);
        if (assister) lineFor(offLines, assister.pid).assists++;
      }
    }
    return goals;
  };

  const homeGoals = sideGoals(homeComp, awayComp, homeXI, box.home, awayXI, box.away);
  const awayGoals = sideGoals(awayComp, homeComp, awayXI, box.away, homeXI, box.home);
  return { homeGoals, awayGoals };
}

/** Penalty shootout (best-of-CUP_PEN_BEST_OF, then sudden death). Shootout kicks are NOT counted as goals. */
function playShootout(
  rng: () => number,
  homeComp: Composites,
  awayComp: Composites,
): { homePens: number; awayPens: number } {
  const convProb = (off: Composites, def: Composites): number =>
    clamp(
      CUP_PEN_BASE_CONVERSION + 0.1 * (off.finishing - 0.5) - 0.15 * (def.keeping - 0.5),
      0.5,
      0.95,
    );
  const pHome = convProb(homeComp, awayComp);
  const pAway = convProb(awayComp, homeComp);
  let home = 0;
  let away = 0;
  for (let i = 0; i < CUP_PEN_BEST_OF; i++) {
    if (rng() < pHome) home++;
    if (rng() < pAway) away++;
  }
  while (home === away) {
    if (rng() < pHome) home++;
    if (rng() < pAway) away++;
  }
  return { homePens: home, awayPens: away };
}

/**
 * A straight-knockout cup (a God Mode format) has no opening stage, so the
 * entry fee every other format pays on league-phase round 0 is paid on the
 * first stage it does play: the preliminary round if there is one, otherwise
 * the first leg of the opening knockout round. Byes collect it too.
 */
function isKnockoutOpening(cup: CupState): boolean {
  return cup.shape?.opening === "knockout";
}

function payKnockoutOpeningEntry(cup: CupState, addPrize: (tid: number, amount: number) => void): void {
  for (const tid of cup.leaguePhase?.teams ?? []) addPrize(tid, cupFormat(cup).prizes.participation);
}

/**
 * Play one **single-leg** knockout tie (the final, the league-phase playoff,
 * the legacy play-in, and any round of a single-leg cup): 90' via
 * simMatchDetailed, then extra time if level, then a penalty shootout if still
 * level. The box score carries regulation + extra-time attribution; shootout
 * kicks decide the winner only.
 */
export function resolveCupTie(
  rng: () => number,
  home: number,
  away: number,
  hd: TeamMatchData,
  ad: TeamMatchData,
  round: number,
  matchday: number,
  /**
   * Played at a neutral venue, so neither side takes the home attack bonus.
   *
   * Only the promotion playoff final passes this (England's final is at
   * Wembley). Every cup caller omits it and is bit-identical to before: the
   * flag changes a composite value, never a draw. Extra time and the shootout
   * are already venue-neutral here, so a neutral tie is neutral end to end.
   */
  neutral = false,
  /**
   * Whether a level game gets extra time before penalties. False sends it
   * straight to the shootout — MLS's wild card and first round and Argentina's
   * knockout rounds. Every cup caller omits it and is bit-identical to before.
   */
  extraTime = true,
): CupTie {
  const result = simMatchDetailed(rng, hd.composites, ad.composites, hd.xi, ad.xi, hd.bench, ad.bench, {
    recompute: { home: hd.recompute, away: ad.recompute },
    neutral,
  });
  const box = result.boxScore;
  let homeGoals = result.home;
  let awayGoals = result.away;
  let wentToExtraTime = false;
  let wentToPens = false;
  let homePens = 0;
  let awayPens = 0;

  if (homeGoals === awayGoals) {
    if (extraTime) {
      wentToExtraTime = true;
      const et = playExtraTime(rng, hd.composites, ad.composites, hd.xi, ad.xi, box);
      homeGoals += et.homeGoals;
      awayGoals += et.awayGoals;
    }
    if (homeGoals === awayGoals) {
      wentToPens = true;
      ({ homePens, awayPens } = playShootout(rng, hd.composites, ad.composites));
    }
  }

  const winner =
    homeGoals > awayGoals ? home
      : awayGoals > homeGoals ? away
        : homePens > awayPens ? home
          : away;

  return { round, matchday, home, away, homeGoals, awayGoals, wentToExtraTime, wentToPens, homePens, awayPens, winner, boxScore: box };
}

/**
 * Play the **first leg** of a two-legged knockout tie: a plain 90' match with
 * `home` hosting (it may end level — the aggregate decides the tie on the
 * second leg, so no extra time here). Returns the held leg for CupState.koLegs.
 */
export function playFirstLeg(
  rng: () => number,
  home: number,
  away: number,
  hd: TeamMatchData,
  ad: TeamMatchData,
  round: number,
): KnockoutLeg {
  const result = simMatchDetailed(rng, hd.composites, ad.composites, hd.xi, ad.xi, hd.bench, ad.bench, {
    recompute: { home: hd.recompute, away: ad.recompute },
  });
  return { round, home, away, homeGoals: result.home, awayGoals: result.away, boxScore: result.boxScore };
}

/**
 * Resolve a two-legged tie: play the **second leg** with `away` hosting
 * (composites/XI swapped), add it to the held first leg, and decide on the
 * aggregate. Level on aggregate after both legs → extra time (attributed into
 * the merged box in the tie's `home`/`away` orientation) → shootout if still
 * level. Both legs' box scores are merged into one so cup stats and the
 * box-score UI see a single line per tie; `legs` carries the two 90' scorelines
 * (from `home`'s perspective) for display. The home-and-away swap cancels home
 * advantage and doubles the sample, so the tie tracks squad strength far more
 * than a single-match coin flip.
 *
 * `levelGoesTo`, when given, replaces extra time and the shootout: a tie level
 * on aggregate is awarded straight to that club. That is the Liguilla's real
 * quarter- and semi-final rule (the better-placed club goes through). Every cup
 * omits it, and a tie that isn't level never reads it, so no existing result
 * moves. Skipping extra time also skips its rng draws, which is safe only
 * because every caller passing this runs the tie on a stream of its own.
 */
export function resolveTwoLeggedTie(
  rng: () => number,
  firstLeg: KnockoutLeg,
  hd: TeamMatchData,
  ad: TeamMatchData,
  matchday: number,
  levelGoesTo?: number,
): CupTie {
  const { round, home, away } = firstLeg;
  // Leg 2: `away` hosts, so leg2.home is the `away` club and leg2.away is `home`.
  const leg2 = simMatchDetailed(rng, ad.composites, hd.composites, ad.xi, hd.xi, ad.bench, hd.bench, {
    recompute: { home: ad.recompute, away: hd.recompute },
  });

  // Merge both legs into one box, keeping this tie's `home`/`away` orientation.
  const box: BoxScore = { home: [], away: [], events: [...firstLeg.boxScore.events, ...leg2.boxScore.events] };
  mergeLines(box.home, firstLeg.boxScore.home); // `home` club at home (leg 1)
  mergeLines(box.home, leg2.boxScore.away);      // `home` club away (leg 2)
  mergeLines(box.away, firstLeg.boxScore.away);  // `away` club away (leg 1)
  mergeLines(box.away, leg2.boxScore.home);      // `away` club at home (leg 2)

  const legs = [
    { homeGoals: firstLeg.homeGoals, awayGoals: firstLeg.awayGoals },
    { homeGoals: leg2.away, awayGoals: leg2.home },
  ];
  let homeGoals = firstLeg.homeGoals + leg2.away;
  let awayGoals = firstLeg.awayGoals + leg2.home;
  let wentToExtraTime = false;
  let wentToPens = false;
  let homePens = 0;
  let awayPens = 0;

  // The Liguilla's quarter- and semi-final rule: level on aggregate goes straight
  // to the named club, and extra time and the shootout are never played.
  if (homeGoals === awayGoals && levelGoesTo !== undefined) {
    return {
      round, matchday, home, away, homeGoals, awayGoals, wentToExtraTime, wentToPens,
      homePens, awayPens, winner: levelGoesTo, boxScore: box, legs, decidedByTablePosition: true,
    };
  }

  if (homeGoals === awayGoals) {
    wentToExtraTime = true;
    const et = playExtraTime(rng, hd.composites, ad.composites, hd.xi, ad.xi, box);
    homeGoals += et.homeGoals;
    awayGoals += et.awayGoals;
    if (homeGoals === awayGoals) {
      wentToPens = true;
      ({ homePens, awayPens } = playShootout(rng, hd.composites, ad.composites));
    }
  }

  const winner =
    homeGoals > awayGoals ? home
      : awayGoals > homeGoals ? away
        : homePens > awayPens ? home
          : away;

  return { round, matchday, home, away, homeGoals, awayGoals, wentToExtraTime, wentToPens, homePens, awayPens, winner, boxScore: box, legs };
}

/**
 * Play the knockout leg (or single-leg round) due on `matchday`, advancing the
 * bracket and returning the prize money each club earned (keyed by tid; the
 * caller credits budgets). Three cases, dispatched by dueCupLeg:
 *  - a two-legged round's **first leg**: play all first legs and hold them in
 *    `cup.koLegs` (no prizes, no bracket advance yet);
 *  - a two-legged round's **second leg**: resolve each held tie on aggregate,
 *    append the finished ties, and clear `koLegs`;
 *  - a **single-leg round** (the final, or any round of a single-leg cup):
 *    play every tie in full, as before.
 * Each leg uses its own seeded rng (derived from lid/season/round/leg) so cup
 * results are deterministic and independent of the league's own match stream.
 */
export function playKnockoutLeg(
  cup: CupState,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  matchday: number,
): { cup: CupState; prizes: Map<number, number> } {
  const due = dueCupLeg(cup, matchday);
  if (!due) return { cup, prizes: new Map() };
  const { round, leg, twoLeg } = due;

  // A straight knockout with no preliminary round pays its entry fee on its first leg.
  const entryDue = isKnockoutOpening(cup) && !cup.playoff && round === 0 && leg === 0;

  // First leg of a two-legged round: play and hold, no prizes yet.
  if (twoLeg && leg === 0) {
    const entry = new Map<number, number>();
    if (entryDue) payKnockoutOpeningEntry(cup, (tid, amount) => entry.set(tid, (entry.get(tid) ?? 0) + amount));
    const rng = mulberry32(hashInts(lid, cup.season, round, streamTag(cup), 1));
    const koLegs: KnockoutLeg[] = [];
    for (const [home, away] of matchupsForRound(cup, round)) {
      const hd = matchData.get(home);
      const ad = matchData.get(away);
      if (!hd || !ad) continue; // defensive: a qualifier should always be in matchData
      koLegs.push(playFirstLeg(rng, home, away, hd, ad, round));
    }
    return { cup: { ...cup, koLegs }, prizes: entry };
  }

  const finalRound = koFinalRound(cup);
  const prizes = new Map<number, number>();
  const addPrize = (tid: number, amount: number): void => {
    prizes.set(tid, (prizes.get(tid) ?? 0) + amount);
  };
  if (entryDue) payKnockoutOpeningEntry(cup, addPrize);

  // Legacy cups credit the participation fee once as the first bracket round is
  // played (the two play-in winners already collected it in the play-in). Swiss
  // cups pay participation during the league phase, so nothing to credit here.
  if (round === 0 && !isSwissCup(cup)) {
    const playInTeams = new Set(cup.playIn?.teams ?? []);
    for (const tid of cup.teams) if (!playInTeams.has(tid)) addPrize(tid, cupFormat(cup).prizes.participation);
  }

  const newTies: CupTie[] = [];
  let championTid = cup.championTid;
  const finalizeTie = (tie: CupTie, home: number, away: number): void => {
    newTies.push(tie);
    addPrize(tie.winner, koWinPrize(cup, round));
    if (round === finalRound) {
      championTid = tie.winner;
      const runnerUp = tie.winner === home ? away : home;
      addPrize(runnerUp, cupFormat(cup).prizes.runnerUp);
    }
  };

  // Second leg of a two-legged round: resolve each held first leg on aggregate.
  if (twoLeg && leg === 1) {
    const rng = mulberry32(hashInts(lid, cup.season, round, streamTag(cup), 2));
    for (const fl of cup.koLegs ?? []) {
      const hd = matchData.get(fl.home);
      const ad = matchData.get(fl.away);
      if (!hd || !ad) continue; // defensive
      finalizeTie(resolveTwoLeggedTie(rng, fl, hd, ad, matchday), fl.home, fl.away);
    }
    return { cup: { ...cup, ties: [...cup.ties, ...newTies], championTid, koLegs: null }, prizes };
  }

  // Single-leg round (the final, or any round of a single-leg cup): play in full.
  const rng = mulberry32(hashInts(lid, cup.season, round, streamTag(cup)));
  for (const [home, away] of matchupsForRound(cup, round)) {
    const hd = matchData.get(home);
    const ad = matchData.get(away);
    if (!hd || !ad) continue; // defensive: a qualifier should always be in matchData
    finalizeTie(resolveCupTie(rng, home, away, hd, ad, round, matchday), home, away);
  }
  return { cup: { ...cup, ties: [...cup.ties, ...newTies], championTid }, prizes };
}

/**
 * Play the Swiss league-phase matches due on `matchday` in full: each is a 90'
 * game (no extra time — it may end level) resolved on the round's own seeded rng
 * and written back into the league phase with its box score. On the first
 * league-phase matchday every qualifier collects the participation fee, and every
 * matchday pays each club for its own result. Once the final matchday completes
 * the league phase, the knockout bracket + playoff are seeded from the table
 * (see seedKnockoutFromLeaguePhase).
 */
export function playLeaguePhaseRound(
  cup: CupState,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  matchday: number,
): { cup: CupState; prizes: Map<number, number> } {
  const lp = cup.leaguePhase;
  const prizes = new Map<number, number>();
  if (!lp) return { cup, prizes };
  const addPrize = (tid: number, amount: number): void => {
    prizes.set(tid, (prizes.get(tid) ?? 0) + amount);
  };

  const round = lp.matches.find((m) => m.matchday === matchday)?.round ?? 0;
  const rng = mulberry32(hashInts(lid, cup.season, LEAGUE_PHASE_STREAM + round, streamTag(cup)));

  if (round === 0) for (const tid of lp.teams) addPrize(tid, cupFormat(cup).prizes.participation);

  const { leaguePhaseWin, leaguePhaseDraw } = cupFormat(cup).prizes;
  const matches = lp.matches.map((m) => {
    if (m.played || m.matchday !== matchday) return m;
    const hd = matchData.get(m.home);
    const ad = matchData.get(m.away);
    if (!hd || !ad) return m; // defensive: a qualifier should always be in matchData
    const result = simMatchDetailed(rng, hd.composites, ad.composites, hd.xi, ad.xi, hd.bench, ad.bench, {
      recompute: { home: hd.recompute, away: ad.recompute },
    });
    // Performance money, as real continental football pays it: a result in the
    // league phase is worth something on its own, so six games are six chances
    // to earn rather than a toll on the way to the knockout. Pure arithmetic on
    // a result the sim just produced — no rng draw, so stream order is untouched.
    if (result.home > result.away) addPrize(m.home, leaguePhaseWin);
    else if (result.away > result.home) addPrize(m.away, leaguePhaseWin);
    else {
      addPrize(m.home, leaguePhaseDraw);
      addPrize(m.away, leaguePhaseDraw);
    }
    return { ...m, played: true, homeGoals: result.home, awayGoals: result.away, boxScore: result.boxScore };
  });

  const advanced = seedKnockoutFromLeaguePhase({ ...cup, leaguePhase: { ...lp, matches } });
  return { cup: advanced, prizes };
}

/**
 * Play the Swiss single-leg playoff round in full: each tie (a higher league-
 * phase finisher vs a lower one) is resolved with the same 90'→extra-time→
 * shootout cascade as any knockout tie, its winner written into the quarter-
 * final bracket. Each winner earns a playoff prize. Uses its own seeded rng.
 */
export function playPlayoff(
  cup: CupState,
  matchData: Map<number, TeamMatchData>,
  lid: number,
): { cup: CupState; prizes: Map<number, number> } {
  const po = cup.playoff;
  if (!po) return { cup, prizes: new Map() };
  const rng = mulberry32(hashInts(lid, cup.season, PLAYOFF_STREAM, streamTag(cup)));
  const prizes = new Map<number, number>();
  const addPrize = (tid: number, amount: number): void => {
    prizes.set(tid, (prizes.get(tid) ?? 0) + amount);
  };

  if (isKnockoutOpening(cup)) payKnockoutOpeningEntry(cup, addPrize);

  const ties: CupTie[] = [];
  for (let i = 0; i + 1 < po.teams.length; i += 2) {
    const home = po.teams[i];
    const away = po.teams[i + 1];
    const hd = matchData.get(home);
    const ad = matchData.get(away);
    if (!hd || !ad) continue; // defensive
    const tie = resolveCupTie(rng, home, away, hd, ad, PLAYOFF_ROUND, po.matchday);
    ties.push(tie);
    addPrize(tie.winner, cupFormat(cup).prizes.playoffWin);
  }
  return { cup: applyPlayoff(cup, ties), prizes };
}

/**
 * Play the preliminary play-in round in full: each tie (a weakest big-four
 * qualifier vs a weak-league champion) is resolved, its winner written into the
 * bracket's pending slot. Every play-in club earns the participation fee here
 * (so the byes get it at R16 instead — see playCupRound), and each winner earns
 * a play-in win bonus. Uses its own seeded rng, like every other cup round.
 */
export function playPlayIn(
  cup: CupState,
  matchData: Map<number, TeamMatchData>,
  lid: number,
): { cup: CupState; prizes: Map<number, number> } {
  const pi = cup.playIn;
  if (!pi) return { cup, prizes: new Map() };
  const rng = mulberry32(hashInts(lid, cup.season, PLAYIN_ROUND, streamTag(cup)));
  const prizes = new Map<number, number>();
  const addPrize = (tid: number, amount: number): void => {
    prizes.set(tid, (prizes.get(tid) ?? 0) + amount);
  };
  for (const tid of pi.teams) addPrize(tid, cupFormat(cup).prizes.participation);

  const ties: CupTie[] = [];
  for (let i = 0; i + 1 < pi.teams.length; i += 2) {
    const home = pi.teams[i];
    const away = pi.teams[i + 1];
    const hd = matchData.get(home);
    const ad = matchData.get(away);
    if (!hd || !ad) continue; // defensive: a qualifier should always be in matchData
    const tie = resolveCupTie(rng, home, away, hd, ad, PLAYIN_ROUND, pi.matchday);
    ties.push(tie);
    addPrize(tie.winner, cupFormat(cup).prizes.playInWin);
  }
  return { cup: applyPlayIn(cup, ties), prizes };
}
