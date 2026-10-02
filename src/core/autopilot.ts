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
import { mulberry32, mulberry32Resumable } from "../engine/rng.js";
import { simChunkTargets } from "./simChunks.js";
import {
  addToTeamSeasonAcc, cloneTeamSeasonAcc, emptyTeamSeasonAcc, teamSeasonStatsFromAcc,
  type PlayedMatch, type TeamSeasonAcc,
} from "./standings.js";

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
    // The academy is the one thing that keeps running for the real club: its
    // cuts are defaults that need nobody to decide them, so the offseason reads
    // `autopilotTid` for the academy steps and a jump no longer empties it.
    meta: { ...league.meta, userTid: AUTOPILOT_TID, autopilotTid: userTid },
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
  // Drop the jump's pointer at the real club along with the sentinel: absent
  // means "same as userTid", and a stale one would keep the academy keyed to a
  // club the user may have left by the time they next jump.
  const { autopilotTid: _autopilotTid, ...meta } = league.meta;
  const restored: LeagueStore = { ...league, meta: { ...meta, userTid } };
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
  options: {
    /**
     * This season's team totals over every match already in `league.played`.
     * The game's own league holds those matches with their player lines
     * dropped (db/leagueDb.ts), so it must hand the totals in or the first
     * offseason records a season of zeroes. Absent means `league.played` still
     * carries real box scores, as it does for every headless caller.
     */
    seasonAcc?: TeamSeasonAcc;
  } = {},
): LeagueStore {
  const total = clampJumpSeasons(seasons);
  const userTid = league.meta.userTid;
  const startSeason = league.season;
  const target = startSeason + total;

  let work = beginAutopilot(league);
  const managed: number[] = [];
  // The season's team totals, folded as matches are played so their player
  // lines can be dropped straight away (see simSeasonFolding).
  let acc = options.seasonAcc ? cloneTeamSeasonAcc(options.seasonAcc) : emptyTeamSeasonAcc();
  if (!options.seasonAcc) addToTeamSeasonAcc(acc, work.played);

  while (work.season < target) {
    onProgress?.(work.season - startSeason, total, work.season);

    if (work.phase === "regular") {
      // Only count a season as AI-managed if the AI actually picked the team
      // for some of it. Jumping from the offseason means the season just gone
      // was played by the user; only its offseason is run by the AI, and
      // labelling it "AI managed" in the history would be a lie.
      managed.push(work.season);
      const played = work.played.length;
      work = simSeasonFolding(work, acc);
      // A "regular" league with nothing left to play can't advance and would
      // spin here forever. Unreachable in practice (simThrough flips the phase
      // as the schedule empties), but a jump is a long unattended loop and an
      // infinite one is the worst way to find that out.
      if (work.phase === "regular" && work.played.length === played) break;
    }

    const advanced = simOffseason(work, mulberry32((work.lid * 1000 + work.season) >>> 0), {
      teamStats: teamSeasonStatsFromAcc(acc, work.teams.map((t) => t.tid)),
    });
    if (advanced.season === work.season) break;
    work = advanced;
    acc = emptyTeamSeasonAcc();
  }

  return {
    ...endAutopilot(work, userTid),
    aiManagedSeasons: [...league.aiManagedSeasons, ...managed],
  };
}

/**
 * The rest of the season, played exactly as `simThrough(league, "season", ...)`
 * with the worker's seed would play it, but a few matchdays at a time with each
 * chunk's box-score detail folded into `acc` and then dropped.
 *
 * A jump used to carry a whole season of box scores in the worker before its
 * offseason could let them go, ~330 MB on the shipped world: the same spike
 * that ran "Sim to End of Season" out of memory on phones. Nothing later in
 * the season reads an old match's detail (the sim reads scores only, which
 * `test/core/simArchive.test.ts` proves with stubbed matches), and the offseason
 * reads it only through the team totals `acc` carries. Same rng stream and
 * batch start across chunks as the game's split sim, so the matches are
 * identical; `test/core/simChunks.test.ts` holds a jump to that.
 */
function simSeasonFolding(league: LeagueStore, acc: TeamSeasonAcc): LeagueStore {
  const rng = mulberry32Resumable((league.lid * 1000 + league.played.length) >>> 0);
  const targets = simChunkTargets(league.schedule, "season");
  const batchStartMatchday = targets.length > 1
    ? Math.min(...league.schedule.map((g) => g.matchday))
    : undefined;
  let work = league;
  for (let i = 0; i < targets.length; i++) {
    const before = work.played.length;
    work = simThrough(work, targets[i], rng.next, undefined, { batchStartMatchday });
    const fresh = work.played.slice(before);
    addToTeamSeasonAcc(acc, fresh);
    work = { ...work, played: [...work.played.slice(0, before), ...fresh.map(withoutDetail)] };
    if (i === targets.length - 1) break;
    const stop = targets[i] as { matchday: number };
    if (
      work.played.length === before ||
      work.phase !== "regular" ||
      work.schedule.some((g) => g.matchday <= stop.matchday)
    ) break;
  }
  return work;
}

/** A played match with its timeline and player lines emptied; the score stays. */
function withoutDetail(m: PlayedMatch): PlayedMatch {
  return { ...m, boxScore: { ...m.boxScore, home: [], away: [], events: [] } };
}
