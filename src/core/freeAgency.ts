import type { Player, Position } from "./players/types.js";
import { POSITIONS } from "./players/types.js";
import type { StoredTeam } from "./teams/clubs.js";
import type { ActiveLoan } from "./loans.js";
import { isBorrowed } from "./loanOwnership.js";
import {
  ROSTER_COMPOSITION, ROSTER_CAP, CONTRACT_LENGTH_MIN, CONTRACT_LENGTH_MAX,
  ACADEMY_ROSTER_CAP, ROSTER_SAFETY_FLOOR, PROSPECT_AGE_MAX,
  AI_PROSPECT_SLOTS, AI_PROSPECT_MAX_AGE, AI_PROSPECT_MIN_POT,
  potentialBar, type ProgressionModel,
} from "./constants.js";
import {
  contractTerms, extendContract, seasonSalaryForOvr, extendAcademyContract, academyContractTerms,
} from "./contracts.js";
import { mulberry32, hashInts } from "../engine/rng.js";
import { affordable, type SpendPolicy } from "./finance/debt.js";
import { refusesFreeAgentSigning, refusesFreeAgentSigningWith, freeAgentStature } from "./transfers/playerWill.js";
import { clubStatures, deriveLeagueContexts } from "./ai/clubContext.js";
import { matchFreeAgents, type MatchSlot } from "./freeAgencyMatch.js";
import { appealScore } from "./transfers/clubAppeal.js";
import { worldRules, leagueRegistrationBlock } from "./foreignRules.js";
import type { Competition } from "./competitions.js";

/**
 * True while a player the user signed from free agency is inside his
 * one-season transfer hold (see Player.faSignedSeason). The user can't sell him
 * — via inbound offers or otherwise — until the season after the signing takes
 * effect, so free agents can't be flipped for a fee the same window. Only ever
 * meaningful for the user's own roster (AI signings don't set faSignedSeason).
 */
export function faTransferLocked(player: Player, season: number): boolean {
  return player.faSignedSeason != null && season <= player.faSignedSeason;
}

/**
 * Pids not currently on any team's roster or academy pool — the signable free
 * agents. A player out on loan is *never* a free agent: he's owned by his
 * parent club and physically on the loanee's roster, so passing `activeLoans`
 * keeps him out of the pool even in the pathological case where some path has
 * dropped him off the loanee roster while the loan is still live (which would
 * otherwise let a club re-sign him, then processLoanReturns hand a second copy
 * back to his parent — the same pid on two rosters). Ownership is tracked by
 * the loan, not by roster membership.
 */
export function freeAgentPids(
  teams: StoredTeam[],
  players: Player[],
  activeLoans: ActiveLoan[] = [],
): Set<number> {
  const rostered = new Set(teams.flatMap((t) => [...t.roster, ...t.academyRoster]));
  const onLoan = new Set(activeLoans.map((l) => l.pid));
  return new Set(
    players.map((p) => p.pid).filter((pid) => !rostered.has(pid) && !onLoan.has(pid)),
  );
}

/**
 * Remove players whose contract expired at or before `season` from every
 * team's roster and academy pool. The players remain in the league's player
 * pool as free agents; only roster/academy membership changes.
 *
 * `onLoanPids` must be every pid still out on loan, and skipping them is a
 * correctness requirement rather than a nicety: a loaned player sits on the
 * *loanee's* roster, so releasing him there strands him on no roster at all
 * while `freeAgentPids` still counts him as rostered (he is on loan), leaving
 * him unsignable, unplayable and invisible until the loan ends. The loan is a
 * fixed-duration commitment; his contract travels home with him and is settled
 * there, which is why the offseason returns loans *before* calling this.
 */
export function releaseExpiredContracts(
  teams: StoredTeam[],
  players: Player[],
  season: number,
  onLoanPids: ReadonlySet<number> = new Set(),
): StoredTeam[] {
  const expired = new Set(
    players
      .filter((p) => p.contract.expiresSeason <= season && !onLoanPids.has(p.pid))
      .map((p) => p.pid),
  );
  return teams.map((t) => ({
    ...t,
    roster: t.roster.filter((pid) => !expired.has(pid)),
    academyRoster: t.academyRoster.filter((pid) => !expired.has(pid)),
  }));
}

function positionCounts(roster: number[], players: Map<number, Player>): Record<Position, number> {
  const counts = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>;
  for (const pid of roster) {
    const p = players.get(pid);
    if (p) counts[p.pos]++;
  }
  return counts;
}

/**
 * The order clubs shop the free-agent pool in: worst first, over the WHOLE
 * world as one queue, so the weakest club anywhere gets first pick.
 *
 * Ranked by points per game, not raw points, and the distinction is
 * load-bearing once divisions differ in size (2026-08-29). A 12-club league
 * plays 22 games and a 20-club one 38, so at equal quality the small league's
 * clubs carry ~58% of the points — and raw points put every one of them at the
 * front of the queue whatever they are worth. The pool drains by quality, so
 * picking first is the entire prize: measured on `scripts/divisionSizeProbe.ts`
 * (six countries identical in strength, money and promotion, differing only in
 * club count), a 12-club league's free-agent arrivals averaged **39 OVR**
 * against a 20-club league's **26**, at the same count per club, and that gap
 * alone was ~7 OVR of whole-roster drift over 15 seasons — big leagues signing
 * junk into their holes while small ones signed players. It is what put
 * Scotland, generated second-weakest in the world, top of the world's tier-1
 * mean OVR by season 20.
 *
 * Within one division every club has played the same number of games, so ppg
 * order IS raw-points order and a uniform-size world is byte-identical.
 * Ties keep their input order, as before.
 */
export function freeAgencySigningOrder(
  standings: readonly { tid: number; played: number; points: number }[],
): number[] {
  const ppg = (r: { played: number; points: number }) => (r.played > 0 ? r.points / r.played : 0);
  return [...standings].sort((a, b) => ppg(a) - ppg(b)).map((s) => s.tid);
}

/**
 * AI free-agent signing, as the player's choice (freeAgencyMatch.ts). Each club
 * in `signingOrderTids` (skipping `userTid`) offers for its open slots, in
 * three passes: positional shortfalls against ROSTER_COMPOSITION, one depth
 * upgrade per position, and prospect slots. Each player takes the offer he
 * likes best (clubAppeal.ts). `signingOrderTids` now only says which clubs
 * take part: the match does not depend on their order, and the worst-first
 * queue it used to be is replaced by the player choosing where he would play
 * and where he is at home. Registration rules (foreignRules.ts) bind every
 * club. Contract terms are a placeholder (ovr-based salary, 1-3 season length)
 * pending real finances. Mutates neither input; returns updated teams and
 * players.
 *
 * Measured cost: ~3s a pass on the 898-club world with a ~2,600-player pool,
 * against ~1.5s for the greedy loop it replaced, because every club with an
 * open slot starts by offering for the best free agent at the position.
 *
 * Has no Division 2 concept of its own — Division 2's strength ceiling is
 * enforced separately and deterministically by enforceDivisionCeilings
 * (offseason.ts), so a strong player who lands as a free agent from a
 * Division 2 club can be signed by anyone here without undoing that.
 */
export function runAIFreeAgency(
  teams: StoredTeam[],
  players: Player[],
  season: number,
  /** Unused since free agency left the shared stream; removed with the greedy loop. */
  _rng: () => number,
  userTid: number,
  signingOrderTids: number[],
  activeLoans: ActiveLoan[] = [],
  /**
   * The save's development model, for the prospect bar only. A steady save
   * lists lower potentials for the same players (an honest forecast sits below
   * an optimistic one), so a fixed bar would quietly stop protecting the
   * wonderkids this pass exists to sign — see `potentialBar`.
   */
  model: ProgressionModel = "random",
  /**
   * Only consider free agents at or above this rating. 0 is the shipped
   * behaviour and the default, so the step-4 call is byte for byte what it
   * always was; the post-trim mop-up (offseason step 6.05) passes
   * MOP_UP_MIN_OVR so it hoovers up the elite tail and leaves the rest of the
   * pool for the user. See that constant for why a quality floor is the only
   * lever here that works.
   */
  poolMinOvr = 0,
  /**
   * The world's competitions, for the player's view of each club once free
   * agency becomes the player's choice (docs/club-reputation.md, step 4).
   */
  competitions: readonly Competition[] = [],
): { teams: StoredTeam[]; players: Player[]; signings: { pid: number; toTid: number }[] } {
  const prospectPot = potentialBar(AI_PROSPECT_MIN_POT, model);
  const playerMap = new Map(players.map((p) => [p.pid, { ...p }]));
  const teamMap = new Map(teams.map((t) => [t.tid, { ...t, roster: [...t.roster] }]));

  let pool = [...freeAgentPids(teams, players, activeLoans)]
    .filter((pid) => (playerMap.get(pid)?.ovr ?? 0) >= poolMinOvr);

  /**
   * A free agent has a say here too, exactly as he does when the user signs him.
   *
   * Leaving this out made the AI the one actor in the world exempt from the
   * module that exists to stop stars moving downhill — and worse than exempt:
   * `freeAgencySigningOrder` is worst-first, so the WEAKEST club in the world
   * got first pick of every elite free agent, while the user was refused the
   * identical signing. The pass most likely to move a star down the pyramid was
   * the one pass that never asked him.
   *
   * Statures are computed ONCE rather than after each signing. Recomputing per
   * signing would be quadratic over 626 clubs, and it would buy nothing: a
   * club's stature is its top-16 mean blended with hype, which one arrival
   * barely moves.
   *
   * Costs nothing for the great majority of a real pool — `statureSensitivity`
   * is 0 below the care floor, so the check returns on its first line for every
   * squad player and every prospect, who are the bulk of what is on offer.
   */
  // Each club's view of itself, once per pass: stature, home country, and the
  // weakest man its shape fields at each position (the playing-time line). A
  // club's stature is its top-16 mean blended with hype, which one arrival
  // barely moves, so recomputing per signing would buy nothing.
  const contexts = deriveLeagueContexts({ teams, players, season, played: [], competitions: [...competitions] });
  // Stature from the squads directly (the same figure a context carries), so a
  // caller that passes no competitions still gets real statures.
  const statures = clubStatures(teams, players);
  const worldMax = statures.size > 0 ? Math.max(...statures.values()) : 1;
  // The league registration rules (foreignRules.ts). Caps are checked against
  // each club's squad plus what it is holding and offering in the match.
  const rules = worldRules(teams, competitions, (pid) => playerMap.get(pid), season);
  // A free agent has a say, exactly as when the user signs him: a player who
  // would refuse a club (playerWill.ts) is never on its list. The AI was once
  // the one actor exempt from that, and with worst-first order the weakest club
  // in the world got first pick of every elite free agent.
  const willing = (p: Player, tid: number): boolean =>
    !refusesFreeAgentSigningWith(p, statures.get(tid) ?? 0, statures, tid, worldMax);
  // His view of an offer (clubAppeal.ts), measured from the stature he expects.
  const liked = new Map<number, number>();
  const preference = (p: Player, tid: number): number => {
    const key = p.pid * 65536 + tid;
    let v = liked.get(key);
    if (v === undefined) {
      const ctx = contexts.get(tid);
      v = ctx ? appealScore(p, ctx, { stature: freeAgentStature(p, statures, worldMax) }).score : 0;
      liked.set(key, v);
    }
    return v;
  };
  // Each free-agent arrival is logged by the caller as a fee-0 transfer (see
  // offseason.ts) so the player's club-by-season history registers the move.
  const signings: { pid: number; toTid: number }[] = [];
  const clubs = [...new Set(signingOrderTids)].filter((tid) => tid !== userTid && teamMap.has(tid))
    .sort((a, b) => a - b);

  // Contract length comes from a per-signing seeded stream, NOT the shared rng,
  // one tag per pass (7 shortfalls, 5 depth upgrades, 6 prospects). Free agency
  // therefore consumes no shared draws at all.
  const sign = (tid: number, pid: number, tag: number): void => {
    const team = teamMap.get(tid)!;
    const signing = playerMap.get(pid)!;
    const lenRng = mulberry32(hashInts(season, tid, pid, tag));
    const length = CONTRACT_LENGTH_MIN
      + Math.floor(lenRng() * (CONTRACT_LENGTH_MAX - CONTRACT_LENGTH_MIN + 1));
    signing.contract = {
      salary: seasonSalaryForOvr(signing.ovr, pid, season),
      expiresSeason: season + length,
    };
    team.roster.push(pid);
    signings.push({ pid, toTid: tid });
  };

  // One pass: build every club's slots, match, sign. `pool` shrinks as passes sign.
  const runPass = (slots: MatchSlot[], tag: number): void => {
    const held = matchFreeAgents(slots, {
      preference,
      stature: (tid) => statures.get(tid) ?? 0,
      mayRegister: (tid, tentative, p) =>
        rules.block(tid, [...teamMap.get(tid)!.roster, ...tentative], p) === null,
    });
    const taken = new Set<number>();
    held.forEach((pid, i) => {
      if (pid === null) return;
      sign(slots[i].tid, pid, tag);
      taken.add(pid);
    });
    pool = pool.filter((pid) => !taken.has(pid));
  };
  const poolPlayers = () => pool.map((pid) => playerMap.get(pid)!);
  // A club short of a registration minimum (soft) ranks the players who would
  // help it first; otherwise by rating.
  const rankFor = (tid: number, list: Player[], key: (p: Player) => number): Player[] => {
    const reg = rules.forSquad(tid, teamMap.get(tid)!.roster);
    // Worked out once per candidate, not inside the comparison.
    const helps = new Map(list.map((p) => [p.pid, reg.helpsMinimum(p) ? 1 : 0]));
    return list.sort((a, b) => helps.get(b.pid)! - helps.get(a.pid)! || key(b) - key(a) || a.pid - b.pid);
  };

  // Pass 1: positional shortfalls against ROSTER_COMPOSITION.
  {
    const byPos = new Map<Position, Player[]>();
    for (const p of poolPlayers()) {
      const list = byPos.get(p.pos);
      if (list) list.push(p); else byPos.set(p.pos, [p]);
    }
    const slots: MatchSlot[] = [];
    for (const tid of clubs) {
      const team = teamMap.get(tid)!;
      const counts = positionCounts(team.roster, playerMap);
      for (const pos of POSITIONS as readonly Position[]) {
        const shortfall = ROSTER_COMPOSITION[pos] - counts[pos];
        if (shortfall <= 0) continue;
        const candidates = rankFor(tid, (byPos.get(pos) ?? []).filter((p) => willing(p, tid)), (p) => p.ovr);
        for (let k = 0; k < shortfall; k++) slots.push({ tid, candidates });
      }
    }
    runPass(slots, 7);
  }

  // Pass 2: depth upgrades. A club at target depth at a position offers for one
  // free agent better than its weakest there, taking it to ROSTER_COMPOSITION +
  // 1; trimRosterSurplus later keeps the best and releases the now-weakest, so
  // the strongest free agents leave the pool without squads ballooning.
  {
    const byPos = new Map<Position, Player[]>();
    for (const p of poolPlayers()) {
      const list = byPos.get(p.pos);
      if (list) list.push(p); else byPos.set(p.pos, [p]);
    }
    const slots: MatchSlot[] = [];
    for (const tid of clubs) {
      const team = teamMap.get(tid)!;
      let room = ROSTER_CAP - team.roster.length;
      for (const pos of POSITIONS as readonly Position[]) {
        if (room <= 0) break;
        const atPos = team.roster.map((pid) => playerMap.get(pid)!).filter((p) => p.pos === pos);
        if (atPos.length < ROSTER_COMPOSITION[pos]) continue;
        const weakest = Math.min(...atPos.map((p) => p.ovr));
        const candidates = rankFor(
          tid, (byPos.get(pos) ?? []).filter((p) => p.ovr > weakest && willing(p, tid)), (p) => p.ovr,
        );
        if (candidates.length === 0) continue;
        slots.push({ tid, candidates });
        room--;
      }
    }
    runPass(slots, 5);
  }

  // Pass 3: prospects. The passes above rank on current ovr, so without this no
  // AI club had a reason to sign a 16-year-old and the unsigned under-22 pool
  // grew without bound. Each club offers for its spare AI_PROSPECT_SLOTS, on top
  // of the depth chart, on the same bar trimRosterSurplus retains on, so a
  // prospect signed here is kept rather than churned straight back out.
  {
    const prospects = poolPlayers().filter(
      (p) => season - p.born <= AI_PROSPECT_MAX_AGE && p.potential >= prospectPot,
    );
    const slots: MatchSlot[] = [];
    for (const tid of clubs) {
      const team = teamMap.get(tid)!;
      const held = team.roster
        .map((pid) => playerMap.get(pid)!)
        .filter((p) => p && season - p.born <= AI_PROSPECT_MAX_AGE && p.potential >= prospectPot).length;
      const room = Math.min(AI_PROSPECT_SLOTS - held, ROSTER_CAP - team.roster.length);
      if (room <= 0) continue;
      const candidates = prospects.filter((p) => willing(p, tid))
        .sort((a, b) => b.potential - a.potential || b.ovr - a.ovr || a.pid - b.pid);
      for (let k = 0; k < room; k++) slots.push({ tid, candidates });
    }
    runPass(slots, 6);
  }

  return {
    teams: [...teams.map((t) => teamMap.get(t.tid)!)],
    players: [...players.map((p) => playerMap.get(p.pid)!)],
    signings,
  };
}

/**
 * Release each team's lowest-ovr surplus players (beyond ROSTER_COMPOSITION
 * per position) back to the free agent pool. Without this, youth intake
 * accumulates every season with nothing offsetting it except the occasional
 * retirement/contract expiry, and rosters balloon indefinitely. Skips
 * `userTid` so the user manages their own squad size manually.
 *
 * A loaned-in player (physically on the loanee's roster but owned by his
 * parent) is never trimmed: he leaves only via processLoanReturns at loan
 * end. Pruning him here would orphan the still-live ActiveLoan — he'd become
 * a "free agent" a club could re-sign while the loan later hands a copy back
 * to his parent, duplicating the pid across two rosters. He's also excluded
 * from the position's kept-count so he can't displace a genuine squad member.
 *
 * **Each club also retains up to AI_PROSPECT_SLOTS young high-potential players
 * beyond the depth chart.** Without that the depth chart alone — which ranks on
 * *current* ovr, where a 16-year-old is always last — released 84-86% of every
 * club's youth intake into free agency in the offseason it arrived, wonderkids
 * included, and nothing in AI free agency valued potential enough to pick them
 * back up. See AI_PROSPECT_SLOTS for the measurements and for why retention is
 * additive rather than folded into the ranking: keeping a prospect *instead of*
 * a squad player would change who is selected, and the point is that it doesn't.
 */
export function trimRosterSurplus(
  teams: StoredTeam[],
  players: Player[],
  userTid: number,
  season: number,
  activeLoans: ActiveLoan[] = [],
  /** See `runAIFreeAgency`'s `model`, and `potentialBar`. */
  model: ProgressionModel = "random",
  /** The world's competitions, for registration minimums. Empty = none checked. */
  competitions: readonly Competition[] = [],
): StoredTeam[] {
  const playerMap = new Map(players.map((p) => [p.pid, p]));
  const onLoan = new Set(activeLoans.map((l) => l.pid));
  const prospectPot = potentialBar(AI_PROSPECT_MIN_POT, model);
  const rules = worldRules(teams, competitions, (pid) => playerMap.get(pid), season);

  return teams.map((t) => {
    if (t.tid === userTid) return t;

    const byPos = new Map<Position, Player[]>();
    for (const pid of t.roster) {
      if (onLoan.has(pid)) continue;
      const p = playerMap.get(pid);
      if (!p) continue;
      const list = byPos.get(p.pos) ?? [];
      list.push(p);
      byPos.set(p.pos, list);
    }

    const kept = new Set<number>();
    for (const pos of POSITIONS as readonly Position[]) {
      const squad = (byPos.get(pos) ?? []).sort((a, b) => b.ovr - a.ovr);
      for (const p of squad.slice(0, ROSTER_COMPOSITION[pos])) kept.add(p.pid);
    }

    // Prospect slots, on top of the depth chart above. Ranked by potential
    // (then ovr, then pid — a total order, so the choice can't depend on
    // roster array order) among the young players the chart didn't already
    // keep. Rng-free, like the rest of this function.
    // The allowance is AI_PROSPECT_SLOTS prospects **beyond** the depth chart.
    // A prospect good enough for the chart is kept on merit and does not spend
    // a slot, so a club rich in them can carry more than the bare constant.
    //
    // **That is deliberate, and counting the chart's own prospects against the
    // allowance was tried and reverted (2026-09-01).** It makes this agree
    // arithmetically with the free-agency pass, which counts every young
    // high-potential player on the roster when deciding whether a club is full
    // — but it also retains fewer prospects, and prospects are the cheapest
    // players in the game (wages are cubic in ovr). Releasing them means
    // refilling the squad from the market with older, dearer players, and the
    // dynasty audit measured the cost: deficits went **1 of 4 seeds (worst
    // −£0.2M) to 2 of 4 (worst −£2.0M)** with nothing else in the sim changed.
    // The finance column is the one that fails first here, so a real deficit is
    // not worth paying to make a comment tidy.
    //
    // The two passes therefore differ on purpose, and the difference is
    // conservative in the safe direction: free agency's count is an
    // over-estimate, so a prospect-rich club stops shopping early rather than
    // over-signing.
    const prospects = [...byPos.values()]
      .flat()
      .filter(
        (p) =>
          !kept.has(p.pid)
          && season - p.born <= AI_PROSPECT_MAX_AGE
          && p.potential >= prospectPot,
      )
      .sort((a, b) => b.potential - a.potential || b.ovr - a.ovr || a.pid - b.pid);
    for (const p of prospects.slice(0, AI_PROSPECT_SLOTS)) kept.add(p.pid);

    // Never trim a club below a registration minimum it met before the trim
    // (foreignRules.ts): the best-rated players it would lose are kept.
    for (const pid of rules.keepForMinimums(t.tid, t.roster.filter((p) => !onLoan.has(p)), kept)) {
      kept.add(pid);
    }

    return { ...t, roster: t.roster.filter((pid) => kept.has(pid) || onLoan.has(pid)) };
  });
}

/**
 * Depth floor shared by the transfer market (isForSale) and manual releases:
 * losing `pid` must leave the club with at least half its target complement
 * (ROSTER_COMPOSITION, rounded up) at that position. Without this floor a
 * user could release their way down to an unfieldable squad — an empty side
 * crashes the match engine and the state persists, bricking the save.
 */
export function keepsDepthFloor(
  team: StoredTeam,
  players: Map<number, Player>,
  pid: number,
): boolean {
  const p = players.get(pid);
  if (!p || !team.roster.includes(pid)) return false;
  const depthAfter =
    team.roster.filter((q) => players.get(q)?.pos === p.pos).length - 1;
  return depthAfter >= Math.ceil(ROSTER_COMPOSITION[p.pos] / 2);
}

/**
 * Release a player from a team's roster back to the free agent pool. No-op
 * if the release would take the squad below the positional depth floor, or if
 * the club doesn't own him.
 *
 * The ownership check is what stops a club dumping a player it has in on loan.
 * His contract belongs to his parent, so "releasing" him would free nobody and
 * make nobody a free agent — it would drop the pid off this roster while the
 * loan stayed live, which is a free early recall plus the wage relief that goes
 * with it, and the loan mechanic deliberately offers neither. It only became
 * reachable when the user could borrow; `activeLoans` defaults to empty so no
 * existing caller changes behaviour.
 */
export function releasePlayer(
  teams: StoredTeam[],
  players: Player[],
  tid: number,
  pid: number,
  activeLoans: ActiveLoan[] = [],
): StoredTeam[] {
  const team = teams.find((t) => t.tid === tid);
  if (!team) return teams;
  if (isBorrowed(activeLoans, tid, pid)) return teams;
  const playerMap = new Map(players.map((p) => [p.pid, p]));
  if (!keepsDepthFloor(team, playerMap, pid)) return teams;
  return teams.map((t) =>
    t.tid === tid ? { ...t, roster: t.roster.filter((p) => p !== pid) } : t,
  );
}

/**
 * Sign a specific free agent to a specific team (used by the user-facing free
 * agency page). No-op if the pid isn't actually a free agent or the team is
 * already at ROSTER_CAP. Terms are the deterministic one-button contract
 * (age-based length, ovr-based salary) so the sign button can display them
 * up front. Wages are paid up front at each season's start, so a signing
 * during the regular phase charges the new contract's full season salary at
 * signing (no-op if the team can't afford it); offseason signings cost
 * nothing here — the upcoming season-start charge covers them.
 */
export function signFreeAgent(
  teams: StoredTeam[],
  players: Player[],
  tid: number,
  pid: number,
  season: number,
  phase: "regular" | "offseason",
  activeLoans: ActiveLoan[] = [],
  spend?: SpendPolicy,
  /** The world's competitions, for the club's registration rules. Empty = no rules checked. */
  competitions: readonly Competition[] = [],
): { teams: StoredTeam[]; players: Player[] } {
  if (!freeAgentPids(teams, players, activeLoans).has(pid)) {
    return { teams, players };
  }
  const team = teams.find((t) => t.tid === tid);
  if (!team || team.roster.length >= ROSTER_CAP) {
    return { teams, players };
  }
  const player = players.find((p) => p.pid === pid);
  if (!player) return { teams, players };
  // A free transfer is still a registration, so an embargoed club cannot make
  // one however little it costs. Absent policy = the old cash-in-hand rule, so
  // nothing that does not pass one changes behaviour.
  if (spend?.embargoed) return { teams, players };
  // A good player will not drop down for a free transfer any more than he will
  // for a fee. Without this, free agency is the one route around the player-will
  // module (see refusesFreeAgentSigning), and it is the route the pool is
  // stocked for: trimRosterSurplus releases whoever a club is deepest at, not
  // whoever is worst.
  if (refusesFreeAgentSigning(player, team, teams, players)) return { teams, players };
  // The club's league registration rules bind the user like any club.
  if (leagueRegistrationBlock({ teams, competitions, players, season }, tid, player) !== null) {
    return { teams, players };
  }
  const wageCharge = phase === "regular" ? contractTerms(player, season).salary : 0;
  if (!affordable(team.budget, wageCharge, spend)) return { teams, players };

  // The one-season transfer hold is keyed to the season the player actually
  // joins the XI: a mid-season signing plays this season; an offseason signing
  // plays next season (the rollover bumps league.season to season + 1).
  const effectiveSeason = phase === "offseason" ? season + 1 : season;
  const contracted = extendContract(players, pid, season);

  return {
    teams: teams.map((t) =>
      t.tid === tid
        ? { ...t, roster: [...t.roster, pid], budget: t.budget - wageCharge }
        : t,
    ),
    players: contracted.map((p) =>
      p.pid === pid ? { ...p, faSignedSeason: effectiveSeason } : p,
    ),
  };
}

/**
 * Sign a free agent into a team's academy pool (used by Incoming Talent for
 * young prospects). No-op if the pid isn't a free agent, isn't age-eligible
 * (PROSPECT_AGE_MAX — enforced here too, not just by Incoming Talent's UI
 * filter, so the action itself can't park an expensive older free agent at
 * the academy's near-zero stipend), the academy is already at
 * ACADEMY_ROSTER_CAP, or (mid-season) the club can't afford it. Academy
 * contracts are a flat stipend (academyContractTerms), not the normal
 * ovr-cubic wage, but the same wage-timing convention as
 * signFreeAgent/promoteFromAcademy still applies: a mid-season signing
 * charges the season's stipend immediately, an offseason one is covered by
 * the next season-start charge (wageBill folds academyRoster in alongside
 * roster — see its call sites).
 */
export function signToAcademy(
  teams: StoredTeam[],
  players: Player[],
  tid: number,
  pid: number,
  season: number,
  phase: "regular" | "offseason",
  activeLoans: ActiveLoan[] = [],
  spend?: SpendPolicy,
  /**
   * The world's competitions, for the club's registration rules. A player the
   * rules would stop the club signing to the senior squad can't come in through
   * the academy either, or a cap would be a door with a side entrance (the
   * academy has an age cap and no rating cap, and promotion is not a new
   * signing). The club's own youth intake is still exempt. Empty = no rules.
   */
  competitions: readonly Competition[] = [],
): { teams: StoredTeam[]; players: Player[] } {
  if (!freeAgentPids(teams, players, activeLoans).has(pid)) {
    return { teams, players };
  }
  const player = players.find((p) => p.pid === pid);
  if (!player || season - player.born > PROSPECT_AGE_MAX) {
    return { teams, players };
  }
  if (leagueRegistrationBlock({ teams, competitions, players, season }, tid, player) !== null) {
    return { teams, players };
  }
  const team = teams.find((t) => t.tid === tid);
  if (!team || team.academyRoster.length >= ACADEMY_ROSTER_CAP) {
    return { teams, players };
  }
  // The same gate signFreeAgent takes, and it is needed here for a sharper
  // reason: this route has an age cap and NO rating cap, so without it the
  // academy is a cheaper door to the identical exploit — a 21-year-old free
  // agent of any rating parked on a flat stipend instead of an ovr-cubic wage.
  if (refusesFreeAgentSigning(player, team, teams, players)) return { teams, players };
  const wageCharge = phase === "regular" ? academyContractTerms(season).salary : 0;
  // Payable out of the overdraft, and deliberately NOT gated on the embargo:
  // a club barred from the transfer market can still run its own academy, which
  // is both how real sanctions work and the one route out of trouble that
  // costs almost nothing.
  if (!affordable(team.budget, wageCharge, spend)) return { teams, players };

  return {
    teams: teams.map((t) =>
      t.tid === tid
        ? { ...t, academyRoster: [...t.academyRoster, pid], budget: t.budget - wageCharge }
        : t,
    ),
    players: extendAcademyContract(players, pid, season),
  };
}

/**
 * Promote an academy player onto the senior roster: moves the pid from
 * academyRoster to roster and re-contracts him at the normal ovr-cubic wage
 * (contractTerms) instead of the academy stipend — he's now competing for a
 * real squad slot. No-op if he isn't in the team's academy or the roster is
 * already at ROSTER_CAP. Mirrors signFreeAgent's wage-timing: a mid-season
 * promotion charges the new contract's full season salary immediately
 * (no-op if unaffordable); an offseason promotion is covered by the next
 * season-start charge.
 */
export function promoteFromAcademy(
  teams: StoredTeam[],
  players: Player[],
  tid: number,
  pid: number,
  season: number,
  phase: "regular" | "offseason",
  spend?: SpendPolicy,
): { teams: StoredTeam[]; players: Player[] } {
  const team = teams.find((t) => t.tid === tid);
  if (!team || !team.academyRoster.includes(pid) || team.roster.length >= ROSTER_CAP) {
    return { teams, players };
  }
  const player = players.find((p) => p.pid === pid);
  if (!player) return { teams, players };
  const wageCharge = phase === "regular" ? contractTerms(player, season).salary : 0;
  // A promotion is not a new registration — he is already at the club — so
  // this takes the overdraft and ignores the embargo, or a sanction would
  // strand a club's own graduates in the academy.
  if (!affordable(team.budget, wageCharge, spend)) return { teams, players };

  return {
    teams: teams.map((t) =>
      t.tid === tid
        ? {
            ...t,
            academyRoster: t.academyRoster.filter((p) => p !== pid),
            roster: [...t.roster, pid],
            budget: t.budget - wageCharge,
          }
        : t,
    ),
    players: extendContract(players, pid, season),
  };
}

/**
 * Release an academy player back to the free agent pool (the "choose not to
 * re-sign" path, or a manual cut) — no depth floor, unlike releasePlayer, since
 * the academy has no fixed composition target to protect.
 */
export function releaseAcademyPlayer(
  teams: StoredTeam[],
  tid: number,
  pid: number,
): StoredTeam[] {
  const team = teams.find((t) => t.tid === tid);
  if (!team || !team.academyRoster.includes(pid)) return teams;
  return teams.map((t) =>
    t.tid === tid ? { ...t, academyRoster: t.academyRoster.filter((p) => p !== pid) } : t,
  );
}

/**
 * Emergency call-up: auto-promotes from the user's own academy if their
 * senior roster has fallen dangerously thin (see ROSTER_SAFETY_FLOOR for
 * why this exists). GK first if the roster has none at all (fielding
 * requires exactly one) — falling back to the open free-agent pool if the
 * academy itself has no GK, since generateYouthIntake's uniform position
 * draw means the academy can easily lack one and the whole point of this
 * function is to guarantee a fieldable team, not just a headcount — then by
 * ovr from the academy until the floor is reached or it runs out. A no-op
 * for every other team, and for a healthily managed user roster. Called once
 * per offseason from simOffseason.
 */
export function ensureUserRosterSafety(
  teams: StoredTeam[],
  players: Player[],
  userTid: number,
  season: number,
  activeLoans: ActiveLoan[] = [],
): { teams: StoredTeam[]; players: Player[]; marketSignings: number[] } {
  const team = teams.find((t) => t.tid === userTid);
  if (!team) return { teams, players, marketSignings: [] };

  const playerMap = new Map(players.map((p) => [p.pid, p]));
  const roster = [...team.roster];
  let academy = [...team.academyRoster];
  const promoted = new Map<number, Player>();

  // Who came from the open market rather than from inside the club. The caller
  // logs these as fee-0 arrivals from FREE_AGENT_TID: club-by-season history is
  // reconstructed from `league.transfers` alone (teamForSeason, the OVR chart's
  // club colours), so an unrecorded free arrival is attributed to whichever club
  // last had a record for him — the exact bug that sentinel record exists to
  // prevent. A promotion from the academy needs no record: it is the same club,
  // so the owner the record would establish is already right.
  const marketSignings: number[] = [];

  function promote(pid: number): void {
    const p = playerMap.get(pid)!;
    const terms = contractTerms(p, season);
    const fromMarket = !academy.includes(pid);
    promoted.set(pid, {
      ...p,
      contract: { salary: terms.salary, expiresSeason: terms.expiresSeason },
      // Signed off the market, so he takes the same one-season transfer hold any
      // free-agent signing does — otherwise an emergency call-up could be listed
      // and sold in the same window.
      ...(fromMarket ? { faSignedSeason: season } : {}),
    });
    if (fromMarket) marketSignings.push(pid);
    roster.push(pid);
    academy = academy.filter((q) => q !== pid);
  }

  /**
   * Everyone the club could call up, best first: its own academy, then the open
   * market.
   *
   * The academy fills itself every offseason, but it can still be empty — a
   * user who released every kid, or one who only just took over a club — and an
   * empty pool is fatal rather than cosmetic: the roster starves, `selectXI`
   * silently leaves slots empty, and `pickInterceptor` then dereferences an
   * undefined tackler and takes the whole sim down. Found by the dynasty audit,
   * which never signs anybody.
   *
   * **Free agents make the floor a guarantee instead of best-effort.** The GK
   * branch below already reached for the market as a last resort for exactly
   * this reason; the general floor had no such fallback and so quietly did
   * nothing whenever the academy was empty, which was reachable before this
   * change too (release your whole academy). Only ever fires below
   * ROSTER_SAFETY_FLOOR, i.e. when a squad has been neglected into being
   * unfieldable, and only ever for the user's club.
   */
  function callUpPool(): Player[] {
    const own = [...academy];
    // `freeAgentPids` reads the CALLER's teams, which this function does not
    // update as it promotes — so anyone already called up still looks unsigned
    // here. Excluding them is a correctness requirement, not a tidy-up: without
    // it the loop below re-promotes the same man every pass, the roster ends up
    // holding a duplicate pid, `selectXI` cannot then fill one slot (a player
    // may hold only one), and `improve` dereferences the resulting null and
    // takes the sim down. Found by the dynasty audit.
    const market = [...freeAgentPids(teams, players, activeLoans)].filter(
      (pid) => !promoted.has(pid) && !own.includes(pid),
    );
    const rank = (pids: number[]): Player[] =>
      pids
        .map((pid) => playerMap.get(pid))
        .filter((p): p is Player => p != null)
        .sort((a, b) => b.ovr - a.ovr);
    // TIERED, not one sorted list. A single ovr sort collapses the tiers: free
    // agents are grown men and an academy kid can be 14, so the market would
    // always win and the club would sign strangers while its own kids sat in the
    // academy. A call-up promotes from within first; the market is the last
    // resort it always was.
    return [...rank(own), ...rank(market)];
  }

  // A keeper first and separately: an outfielder forced into goal corrupts the
  // keeping composite, so "enough bodies" is not the same as "fieldable".
  if (!roster.some((pid) => playerMap.get(pid)?.pos === "GK")) {
    const gk = callUpPool().find((p) => p.pos === "GK");
    if (gk) promote(gk.pid);
  }

  while (roster.length < ROSTER_SAFETY_FLOOR) {
    const best = callUpPool()[0];
    if (!best) break;
    promote(best.pid);
  }

  if (promoted.size === 0) return { teams, players, marketSignings: [] };

  return {
    teams: teams.map((t) =>
      t.tid === userTid
        ? { ...t, roster, academyRoster: academy }
        : t,
    ),
    players: players.map((p) => promoted.get(p.pid) ?? p),
    marketSignings,
  };
}

