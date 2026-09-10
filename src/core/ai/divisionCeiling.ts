import type { Player, Position } from "../players/types.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { CompletedTransfer } from "../transfers/negotiation.js";
import type { Competition } from "../competitions.js";
import type { ActiveLoan } from "../loans.js";
import { tierOf, competitionOf } from "../competitions.js";
import { divisionRefusalOvr, ROSTER_CAP, ROSTER_COMPOSITION } from "../constants.js";
import { trueTransferValue } from "../finance/valuation.js";
import { clampBudget, financeScale } from "../finance/budget.js";

/**
 * The tier a player is swept to from `fromTier`: the deepest division above
 * him whose own ceiling he does NOT clear, and so the deepest one he is
 * allowed to stay in.
 *
 * Exported for the test that pins it, because it is the whole of the
 * "one move, not one per rung" property and reads as arithmetic rather than as
 * a rule otherwise. Tier 1 has no ceiling (`divisionRefusalOvr` answers
 * Infinity there), so the walk always terminates at 1 at the latest.
 */
export function landingTierFor(ovr: number, fromTier: number): number {
  let tier = fromTier;
  while (tier >= 2 && ovr >= divisionRefusalOvr(tier)) tier -= 1;
  return tier;
}

/**
 * Guaranteed, deterministic ceiling on how good an AI-controlled Division 2
 * player is allowed to stay: any rostered player at or above
 * DIVISION_2_REFUSAL_OVR_THRESHOLD is moved to a Division 1 club every
 * offseason, no market/affordability chance involved. Skips the user's club
 * on both sides — as seller (their roster is never auto-modified) and as
 * buyer (never force-added to without consent) — matching every other
 * AI-automation convention in this codebase.
 *
 * This replaces earlier probabilistic nudges (a per-club valueToClub match,
 * then a flat OVR-based "refuses to re-sign" preference feeding free agency
 * and the AI market) as the primary drift-fighting mechanism: a 30-season
 * dynasty audit found Division 2's strength ceiling kept climbing toward
 * Division 1's even with the AI transfer market disabled entirely — the
 * dominant driver is simply that a relegated club keeps its full-strength
 * existing roster (only future youth intake is anchored weaker), and three
 * clubs relegate every single season. No amount of nudging a *chance* that
 * a buyer shows up can close a gap driven by players who were never put up
 * for sale in the first place. A hard, unconditional move is the only thing
 * that reliably empties Division 2 of anyone above the line every season,
 * regardless of contract status, club wealth, or whether any specific AI
 * buyer happened to want him that window.
 *
 * The receiving Division 1 club is picked deterministically — whichever
 * (non-user) Division 1 club currently has the lowest average OVR at his
 * position — recomputed after each move so multiple qualifying players in
 * the same offseason spread across different needy clubs rather than
 * piling onto a single one. If the receiving club is already at ROSTER_CAP,
 * its own weakest player (any position) is released to the free agent pool
 * to make room, so the move always succeeds. The move itself is guaranteed,
 * but the money is real: the receiving club pays the player's regular market
 * price (trueTransferValue — the same base every negotiated deal starts
 * from), capped at whatever it can actually pay so a forced move can never
 * push a club into deficit, and the selling club banks the fee (clamped by
 * its tier's budget cap, same as any AI-market sale).
 *
 * **Deliberately exempt from the one-move-per-window rule** (`movedThisWindow`
 * in transfers/negotiation.ts). Every other path refuses to move a player who
 * has already changed clubs this window; this one must not, because catching a
 * player the market has just sold below the ceiling *in the same offseason it
 * happens* is the entire reason the second call sits after the market rather
 * than before it. Do not "fix" the inconsistency by adding the check here.
 * The moves logged below still count as moves, so a swept player is settled
 * for the rest of the window like anyone else.
 */
export function enforceDivisionCeilings(
  teams: StoredTeam[],
  players: Player[],
  activeLoans: ActiveLoan[],
  transfers: CompletedTransfer[],
  season: number,
  userTid: number,
  competitions: Competition[],
): { teams: StoredTeam[]; players: Player[]; transfers: CompletedTransfer[] } {
  const playerByPid = new Map(players.map((p) => [p.pid, p]));
  // A loaned player sits on the loanee's roster but is owned by his parent.
  // Never sweep him out to a Division 1 club — processLoanReturns would later
  // return a copy to the parent, duplicating the pid across two rosters.
  const onLoanPids = new Set(activeLoans.map((l) => l.pid));
  const rosterByTid = new Map(teams.map((t) => [t.tid, [...t.roster]]));
  const tierByTid = new Map(teams.map((t) => [t.tid, tierOf(competitions, t.compId)]));
  const countryByTid = new Map(teams.map((t) => [t.tid, competitionOf(competitions, t.compId).country]));
  const scaleByTid = new Map(teams.map((t) => [t.tid, financeScale(competitions, t.compId)]));
  const budgetByTid = new Map(teams.map((t) => [t.tid, t.budget]));
  const hypeByTid = new Map(teams.map((t) => [t.tid, t.hype]));
  const executed: CompletedTransfer[] = [];

  const avgOvrAtPos = (tid: number, pos: Position): number => {
    const atPos = rosterByTid.get(tid)!
      .map((pid) => playerByPid.get(pid)!)
      .filter((p) => p.pos === pos);
    if (atPos.length === 0) return -Infinity; // an empty position is the neediest possible fit
    return atPos.reduce((s, p) => s + p.ovr, 0) / atPos.length;
  };

  // One pass per tier that has a division above it, DEEPEST FIRST — and the
  // order is load-bearing rather than tidy. Each pass reads the rosters the
  // previous one left behind, so a player is never stranded a division short
  // and left to surface a whole season later, which is exactly the drift this
  // exists to prevent. A two-division world runs one pass and is unchanged.
  //
  // A player who clears SEVERAL ceilings lands at his final tier in one move
  // (`landingTierFor`), rather than being hoisted a rung at a time. That used
  // to be a rung at a time, and every rung banked its own fee and logged its
  // own transfer — so a third-tier player good enough for the top flight read
  // as two transfers inside one window (the thing `movedThisWindow` exists to
  // make impossible everywhere else), a club that held him for no time at all
  // pocketed the difference between a second-tier fee and a top-flight one,
  // and if that club happened to be at ROSTER_CAP it released one of its own
  // players to make room for someone it lost again in the same breath.
  //
  // Skipping the intermediate club changes nothing about where he ends up, and
  // that is checkable rather than assumed: the receiving pool at each rung is
  // drawn from the seller's COUNTRY, which never changes on the way up, and
  // the neediest-club search reads only the destination tier's rosters. So the
  // intermediate club's identity could not affect the next rung's choice — it
  // was an artifact of the loop, not a step in the journey.
  const deepestTier = Math.max(1, ...competitions.map((c) => c.tier));
  for (let fromTier = deepestTier; fromTier >= 2; fromTier--) {
    const ceiling = divisionRefusalOvr(fromTier);

    // Highest OVR first: the biggest stars get first pick of the neediest club
    // one division up, since avgOvrAtPos is recomputed (and shifts) after each
    // move.
    const qualifying = [...rosterByTid.entries()]
      .filter(([tid]) => tierByTid.get(tid) === fromTier && tid !== userTid)
      .flatMap(([, roster]) => roster)
      .filter((pid) => !onLoanPids.has(pid))
      .map((pid) => playerByPid.get(pid)!)
      .filter((p) => p.ovr >= ceiling)
      .sort((a, b) => b.ovr - a.ovr || a.pid - b.pid);

    for (const player of qualifying) {
      const sellerTid = [...rosterByTid.entries()].find(([, r]) => r.includes(player.pid))?.[0];
      if (sellerTid === undefined) continue; // already moved earlier this pass

      // Receiving pool is the player's OWN country's clubs ONE DIVISION UP — the
      // ceiling invariant is "a country's D2 can't out-strengthen its own D1", so
      // a Portuguese D2 star is pulled up into Portuguese D1, not dumped into
      // whichever weak-league club happens to be the globally weakest. (Scoping
      // this worldwide systematically injected strong players into France/Portugal
      // D1 — the weakest tier-1 clubs — compressing the deliberate cross-country
      // strength gap over a dynasty; a 15-season audit confirmed the compression.)
      //
      // Only as far up as his rating actually forces him, never straight to the
      // top flight on principle: a third tier's ceiling is a statement about the
      // second tier, and teleporting its best players past a division they are
      // allowed to play in would flatten the pyramid it is meant to grade. So
      // an ovr-65 third-division player stops in the second division, and only
      // one who also clears the second division's own ceiling carries on — a
      // player who provably cannot stay there either way.
      const landingTier = landingTierFor(player.ovr, fromTier);
      const sellerCountry = countryByTid.get(sellerTid);
      const upCandidates = [...tierByTid.entries()].filter(
        ([tid, tier]) =>
          tier === landingTier && tid !== userTid && countryByTid.get(tid) === sellerCountry,
      );
      if (upCandidates.length === 0) continue;

      let buyerTid = upCandidates[0][0];
      let bestNeed = avgOvrAtPos(buyerTid, player.pos);
      for (const [tid] of upCandidates.slice(1)) {
        const need = avgOvrAtPos(tid, player.pos);
        if (need < bestNeed) {
          bestNeed = need;
          buyerTid = tid;
        }
      }

      let buyerRoster = rosterByTid.get(buyerTid)!;
      if (buyerRoster.length >= ROSTER_CAP) {
        // Prefer the weakest player whose release still keeps the buyer's
        // positional depth floor (same bar releasePlayer/keepsDepthFloor use
        // elsewhere) — otherwise a forced sweep can strip a club's only backup
        // at a thin position with nothing left in this offseason to refill it
        // (this is the second, later of enforceDivisionCeilings's two passes;
        // free agency/trimming/the summer market have already run). Falls back
        // to the true weakest player only if every release would breach the
        // floor, so the move still always succeeds.
        const posCounts = new Map<Position, number>();
        for (const pid of buyerRoster) {
          const pos = playerByPid.get(pid)!.pos;
          posCounts.set(pos, (posCounts.get(pos) ?? 0) + 1);
        }
        const keepsFloor = (pid: number): boolean => {
          const pos = playerByPid.get(pid)!.pos;
          return (posCounts.get(pos) ?? 0) - 1 >= Math.ceil(ROSTER_COMPOSITION[pos] / 2);
        };

        // Never release a loaned-in player to make room: he's owned by his
        // parent and must leave only via processLoanReturns, or the live loan is
        // orphaned into a duplicate (same reasoning as the sweep's own onLoanPids
        // skip above). Releasable = on the buyer's roster and not on loan.
        const releasable = buyerRoster.filter((pid) => !onLoanPids.has(pid));
        let weakestPid: number | null = null;
        let weakestOvr = Infinity;
        for (const pid of releasable) {
          if (!keepsFloor(pid)) continue;
          const ovr = playerByPid.get(pid)!.ovr;
          if (ovr < weakestOvr) {
            weakestOvr = ovr;
            weakestPid = pid;
          }
        }
        if (weakestPid === null) {
          // No release keeps every position above its floor — fall back to
          // the true weakest overall (still never a loaned-in player) rather
          // than block the guaranteed move.
          for (const pid of releasable) {
            const ovr = playerByPid.get(pid)!.ovr;
            if (ovr < weakestOvr) {
              weakestOvr = ovr;
              weakestPid = pid;
            }
          }
        }
        buyerRoster = buyerRoster.filter((pid) => pid !== weakestPid);
      }

      // The move is guaranteed, but the buyer still pays the regular market
      // price for the player — capped at what it actually has, so a forced
      // move never drives its budget negative. Money is conserved between the
      // two clubs (before the seller's tier budget cap, same as the AI market).
      const fee = Math.min(
        Math.round(trueTransferValue(player, season)),
        Math.max(0, budgetByTid.get(buyerTid) ?? 0),
      );
      budgetByTid.set(buyerTid, (budgetByTid.get(buyerTid) ?? 0) - fee);
      budgetByTid.set(
        sellerTid,
        clampBudget((budgetByTid.get(sellerTid) ?? 0) + fee, scaleByTid.get(sellerTid)!, hypeByTid.get(sellerTid) ?? 0),
      );

      rosterByTid.set(sellerTid, rosterByTid.get(sellerTid)!.filter((pid) => pid !== player.pid));
      rosterByTid.set(buyerTid, [...buyerRoster, player.pid]);
      executed.push({ pid: player.pid, fromTid: sellerTid, toTid: buyerTid, fee, season, window: "summer" });
    }
  }

  return {
    teams: teams.map((t) => ({
      ...t,
      roster: rosterByTid.get(t.tid) ?? t.roster,
      budget: budgetByTid.get(t.tid) ?? t.budget,
    })),
    players,
    transfers: [...transfers, ...executed],
  };
}
