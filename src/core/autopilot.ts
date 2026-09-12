/**
 * Jump forward N seasons with the user's club handed over to the AI.
 *
 * **The whole feature is one substitution: `meta.userTid` is swapped for a tid
 * no club owns.** Every AI system in the sim is already written as "do this for
 * each club except `userTid`" — the transfer market, free agency, contract
 * renewals, roster trimming, formation picking, the Division-2 ceiling sweep,
 * the finance scale, the difficulty levers. Point `userTid` at nothing and all
 * of them fall through onto the user's club, which is exactly what "the AI takes
 * over" means. Nothing in `simThrough`/`simOffseason` needed a branch for this,
 * so **RNG stream order for ordinary play is untouched** and a jumped season is
 * bit-identical to what the same world would have produced with that club under
 * AI control all along.
 *
 * The sentinel is confined to this module's working copy. `jumpSeasons` restores
 * the real tid before returning, so it can never reach disk — which matters,
 * because a save carrying it would be a save whose owner manages no club.
 */
import type { LeagueStore } from "./leagueState.js";
import type { StoredTeam } from "./teams/clubs.js";
import { simThrough } from "./simThrough.js";
import { simOffseason } from "./offseason.js";
import { ensureUserRosterSafety } from "./freeAgency.js";
import { reconcileScoutingObserved } from "./scouting/potentialFog.js";
import { FREE_AGENT_TID } from "./transfers/negotiation.js";
import { mulberry32 } from "../engine/rng.js";

/**
 * The stand-in `meta.userTid` while the AI is in charge. Negative so it can
 * never collide with a real tid (they are dense indices from 0), and
 * deliberately **not** -1: that is `FREE_AGENT_TID`, which is a real value in
 * `CompletedTransfer.fromTid`/`toTid`, and reusing it would make "the club the
 * user manages" and "no club at all" the same number.
 */
export const AUTOPILOT_TID = -2;

/**
 * Ceiling on one jump. A season costs roughly 15-20 seconds of sim on a desktop
 * (measured on the 320-club world: ~10s of matches plus ~7s of offseason), so
 * this is about eight minutes of worker time — past that the user should jump
 * twice rather than stare at a bar.
 */
export const MAX_JUMP_SEASONS = 25;

/** Progress hook, fired once as each season starts playing out. */
export type JumpProgress = (seasonsDone: number, totalSeasons: number, season: number) => void;

/**
 * How many seasons a request for `n` actually plays.
 *
 * The clamp is load-bearing at both ends. A `0` or a negative would leave the
 * loop below with nothing to do and the user staring at a bar that never moves;
 * a typo'd `500` would pin the worker for two hours with no way to stop it.
 */
export function clampJumpSeasons(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_JUMP_SEASONS, Math.floor(n)));
}

/**
 * Hand the club over: point `userTid` at nothing and drop the standing
 * instructions the user left behind.
 *
 * The manual XI has to go. `resolveXI` keeps a stored `starters` array as long
 * as it still resolves, so without this the "AI" would spend a decade fielding
 * the eleven names the user picked before they left, minus whoever got sold —
 * a lineup no manager chose. Clearing it drops the club onto `selectXI`, the
 * same auto-pick every AI club uses.
 *
 * The rest are pending conversations rather than settings: transfer listings,
 * live negotiations, inbound offers and loan listings all describe deals the
 * user was in the middle of, and there is nobody to finish them. They would
 * also be stale on the way out — an offer for a player sold six seasons ago.
 */
export function beginAutopilot(league: LeagueStore): LeagueStore {
  const userTid = league.meta.userTid;
  return {
    ...league,
    meta: { ...league.meta, userTid: AUTOPILOT_TID },
    teams: league.teams.map((t): StoredTeam =>
      t.tid === userTid
        ? { ...t, starters: null, transferListed: [], moreMinutes: [] }
        : t,
    ),
    negotiations: [],
    inboundOffers: [],
    loanListings: [],
    loanRejections: [],
    // `transferClauses` is deliberately NOT cleared. A sell-on or bonus is a
    // contract between two CLUBS rather than an instruction from the manager, so
    // it survives the handover exactly as `activeLoans` does — and it has to,
    // since the AI running the club during the jump can both trigger one and
    // collect one. Same call `switchClub` makes, for the same reason.
  };
}

/**
 * Hand the club back.
 *
 * Two repairs beyond restoring the tid, both because the club spent the jump
 * outside the "is this the user's club?" checks that normally maintain them:
 *
 * - **Scouting fog.** `simOffseason` re-stamps `scoutingObserved` for the user's
 *   club only, so during the jump it froze: it still names players who were sold
 *   and knows nothing of the ones who arrived. Re-reconciling keeps the
 *   first-seen season of everyone who was already there (a ten-year servant is
 *   not suddenly a stranger) and stamps the new arrivals as first seen now, so
 *   their potential comes back fogged. That is the honest reading — you have
 *   not watched these players.
 * - **Roster safety.** `ensureUserRosterSafety` is likewise user-club-only and
 *   so never ran. In practice the AI leaves a full 25-man squad behind and this
 *   is a no-op, but it is the guarantee that the club handed back can field
 *   eleven men with a keeper among them, and it costs nothing to keep.
 */
export function endAutopilot(league: LeagueStore, userTid: number): LeagueStore {
  const restored: LeagueStore = { ...league, meta: { ...league.meta, userTid } };
  const { teams, players, marketSignings } = ensureUserRosterSafety(
    restored.teams, restored.players, userTid, restored.season, restored.activeLoans,
  );
  return {
    ...restored,
    players,
    // A call-up off the open market is a real arrival and needs the same fee-0
    // sentinel record an ordinary free signing gets, or club-by-season history
    // (rebuilt from the transfer log alone) keeps naming his previous club.
    transfers: [
      ...restored.transfers,
      ...marketSignings.map((pid) => ({
        pid, fromTid: FREE_AGENT_TID, toTid: userTid, fee: 0,
        season: restored.season, window: "summer" as const,
      })),
    ],
    teams: teams.map((t): StoredTeam =>
      t.tid === userTid
        ? { ...t, scoutingObserved: reconcileScoutingObserved(t.scoutingObserved, t.roster, restored.season) }
        : t,
    ),
  };
}

/**
 * Play `seasons` whole seasons with the AI managing the user's club, landing at
 * the start of season `league.season + seasons`.
 *
 * A jump started mid-season finishes the current season first, so the seasons
 * counted are calendar seasons, not "seasons from scratch" — asking to jump one
 * season on matchday 20 means "get me to next season", which is what the wording
 * on the button promises.
 *
 * Each step is seeded exactly the way the worker seeds the equivalent button
 * click (`lid * 1000 + played.length` for a season, `lid * 1000 + season` for an
 * offseason), so a jump is the same world the user would have reached by
 * clicking through it — with the one intended difference that the AI, not they,
 * ran their club.
 */
export function jumpSeasons(
  league: LeagueStore,
  seasons: number,
  onProgress?: JumpProgress,
): LeagueStore {
  const total = clampJumpSeasons(seasons);
  const userTid = league.meta.userTid;
  const startSeason = league.season;
  const target = startSeason + total;

  let work = beginAutopilot(league);
  const managed: number[] = [];

  while (work.season < target) {
    onProgress?.(work.season - startSeason, total, work.season);

    if (work.phase === "regular") {
      // Only count a season as AI-managed if the AI actually picked the team
      // for some of it. Jumping from the offseason means the season just gone
      // was played by the user; only its offseason is run by the AI, and
      // labelling it "AI managed" in the history would be a lie.
      managed.push(work.season);
      const played = work.played.length;
      work = simThrough(work, "season", mulberry32((work.lid * 1000 + played) >>> 0));
      // A "regular" league with nothing left to play can't advance and would
      // spin here forever. Unreachable in practice (simThrough flips the phase
      // as the schedule empties), but a jump is a long unattended loop and an
      // infinite one is the worst way to find that out.
      if (work.phase === "regular" && work.played.length === played) break;
    }

    const advanced = simOffseason(work, mulberry32((work.lid * 1000 + work.season) >>> 0));
    if (advanced.season === work.season) break;
    work = advanced;
  }

  return {
    ...endAutopilot(work, userTid),
    aiManagedSeasons: [...league.aiManagedSeasons, ...managed],
  };
}
