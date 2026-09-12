import type { LeagueStore } from "../leagueState.js";
import { scrubClausesForPids } from "../transfers/clauses.js";
import type { Player } from "./types.js";
import type { DomesticCupState } from "../domesticCup/types.js";
import {
  FREE_AGENT_CULL_MIN_AGE,
  FREE_AGENT_CULL_MAX_PEAK_OVR,
  FREE_AGENT_CULL_MAX_POT,
  FREE_AGENT_CULL_LOAD_THRESHOLD,
} from "../constants.js";

/**
 * Cull the unsigned free-agent pool, and scrub every reference to the players
 * it removes.
 *
 * Why this exists: retirement already deletes players outright (simOffseason
 * step 3), so a save holds no retired players — but nothing ever removed
 * *unsigned free agents*, so that pool grew forever. Measured on a 14-season
 * save: 9245 unsigned against 5996 rostered, 96% of them never having peaked
 * above ovr 55, together ~27% of an 88 MB save. Save size is the thing that
 * freezes the game (every mutation writes the whole league to IndexedDB and
 * every sim structuredClones it to the worker — both block the main thread),
 * so bounding this pool is the fix.
 *
 * **Consumes no rng.** It's a pure deterministic filter, so it can't perturb
 * the seeded streams the sim depends on (see CLAUDE.md's RNG-stream-order
 * invariant). It must still run at the very END of simOffseason: removing
 * entries from `players` would shift any later per-player rng draw.
 */

/** Best ovr a player ever reached, from his ratings history (current ovr included). */
export function careerPeakOvr(player: Player): number {
  // Maintained by `progressPlayer`; the scan is the path for a save that has not
  // been migrated yet. Current ovr still leads it, since god mode can raise a
  // rating without progression ever seeing it.
  //
  // **The invariant this depends on: `peakOvr` is authoritative once present.**
  // Anything that builds a `Player` carrying a `hist` must set it to match —
  // `generatePlayer`, `createCustomPlayer` and the roster importer all do. A
  // stale one makes a player read as worse than he ever was, and the scan below
  // will NOT save you: it is skipped precisely when the field is set. The
  // fallback also disappears entirely once `hist` stops being resident
  // (docs/lazy-career-plan.md), so the invariant is the only thing holding.
  if (player.peakOvr != null) return Math.max(player.ovr, player.peakOvr);
  let peak = player.ovr;
  for (const h of player.hist ?? []) {
    if (h.ovr > peak) peak = h.ovr;
  }
  return peak;
}

/**
 * Pids the cull would remove: on no roster, old enough to have stopped
 * developing, never any good, and not projected to become good.
 *
 * `protectedPids` is anything the caller wants kept regardless (award winners,
 * so no honours board can ever point at a deleted player).
 */
export function cullablePids(
  league: LeagueStore,
  protectedPids: ReadonlySet<number> = new Set(),
): Set<number> {
  const rostered = new Set<number>();
  for (const t of league.teams) {
    for (const pid of t.roster) rostered.add(pid);
    for (const pid of t.academyRoster) rostered.add(pid);
  }
  // A loaned player sits on the loanee's roster, so he's already covered above;
  // this is belt-and-braces in case a loan is ever mid-flight.
  for (const l of league.activeLoans) rostered.add(l.pid);

  const cull = new Set<number>();
  for (const p of league.players) {
    if (rostered.has(p.pid) || protectedPids.has(p.pid)) continue;
    if (league.season - p.born < FREE_AGENT_CULL_MIN_AGE) continue;
    if (careerPeakOvr(p) > FREE_AGENT_CULL_MAX_PEAK_OVR) continue;
    if (p.potential > FREE_AGENT_CULL_MAX_POT) continue;
    cull.add(p.pid);
  }
  return cull;
}

/**
 * Every pid an honours board names, which must never be deleted.
 *
 * `SeasonAwards` stores **bare numbers** under `playerOfSeasonPid`,
 * `goldenBootPid` and `teamOfSeason[]` — there is no `pid` key anywhere. An
 * earlier version of this looked for objects with a `pid` property and so
 * returned an empty set every time, i.e. the protection did nothing at all.
 * (The same mistake made `scripts/freeAgentPoolAudit.ts` report zero award
 * references, which read as "awards are safe" when it had simply looked in the
 * wrong place.) That matters because tier-2 squads are capped below
 * `DIVISION_2_REFUSAL_OVR_THRESHOLD`, so a second-division Team-of-the-Season
 * pick or Golden Boot winner really can sit at peak ovr ≤ 65 — exactly the
 * profile the cull deletes — and `/awards` would then render an empty slot.
 *
 * The award container has had three shapes over time (a single SeasonAwards, a
 * [D1, D2] tuple, and a Record<compId, SeasonAwards>), so this walks whatever it
 * is and picks out any `*Pid` number plus the `teamOfSeason` array, rather than
 * assuming one layout.
 */
export function awardedPids(league: LeagueStore): Set<number> {
  const pids = new Set<number>();
  const addIfPid = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) pids.add(v);
  };
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
      if (key.endsWith("Pid")) addIfPid(value);
      else if (key === "teamOfSeason" && Array.isArray(value)) value.forEach(addIfPid);
      // `pid` is the shape international's topScorer uses.
      else if (key === "pid") addIfPid(value);
      else walk(value);
    }
  };
  for (const h of league.seasonHistory) walk(h.awards);
  // A tournament's stored top scorer keeps a name for display, but the profile
  // link still points at the pid, so he needs the same protection.
  for (const t of league.international?.history ?? []) walk(t.topScorer);
  return pids;
}

/** Unsigned free agents currently in the pool (on no roster, senior or academy). */
export function freeAgentCount(league: LeagueStore): number {
  const rostered = new Set<number>();
  for (const t of league.teams) {
    for (const pid of t.roster) rostered.add(pid);
    for (const pid of t.academyRoster) rostered.add(pid);
  }
  let n = 0;
  for (const p of league.players) if (!rostered.has(p.pid)) n++;
  return n;
}

/**
 * The cull as applied at **load**, which only fires on a genuinely bloated pool.
 *
 * A save that is already frozen can't be fixed at its next offseason, because its
 * owner can't get the game to respond long enough to reach one — hence culling on
 * load. But doing it on *every* load makes mid-season deletions immediate: release
 * a player by mistake, reload, and he's gone instead of re-signable from
 * /free-agents. So normal saves are left to the offseason cull, and only a pool
 * past FREE_AGENT_CULL_LOAD_THRESHOLD is drained here.
 */
export function cullOnLoad(league: LeagueStore): LeagueStore {
  if (freeAgentCount(league) <= FREE_AGENT_CULL_LOAD_THRESHOLD) return league;
  return cullFreeAgentPool(league);
}

/**
 * Remove the cullable free agents and scrub the references that would otherwise
 * dangle. A dangling pid isn't a crash (every reader guards the lookup) but it
 * renders as "Player 4821" in transfer history, so the rows go with the player.
 */
export function cullFreeAgentPool(league: LeagueStore): LeagueStore {
  return cullFreeAgentPoolReporting(league).league;
}

/**
 * The cull, plus who it removed.
 *
 * A separate entry point rather than a changed return type: `cullFreeAgentPool`
 * has callers that only want the league. The pid set exists because the scrub
 * below cannot run on the worker once `newsEvents` and the cup histories stay on
 * the main thread — it reports who went, and the main thread scrubs its own
 * copies (see `detachNews` in core/simArchive.ts).
 */
export function cullFreeAgentPoolReporting(
  league: LeagueStore,
): { league: LeagueStore; culled: Set<number> } {
  const cull = cullablePids(league, awardedPids(league));
  if (cull.size === 0) return { league, culled: cull };

  return { culled: cull, league: {
    ...league,
    players: league.players.filter((p) => !cull.has(p.pid)),
    transfers: league.transfers.filter((t) => !cull.has(t.pid)),
    newsEvents: league.newsEvents.filter(
      (e) => !("pid" in e && typeof e.pid === "number" && cull.has(e.pid)),
    ),
    negotiations: league.negotiations.filter((n) => !cull.has(n.pid)),
    inboundOffers: league.inboundOffers.filter((o) => !cull.has(o.pid)),
    loanListings: league.loanListings.filter((l) => !cull.has(l.pid)),
    loanRejections: league.loanRejections.filter((l) => !cull.has(l.pid)),
    // A starred player nobody can open, list or un-star is worse than one the
    // shortlist forgets, so the watchlist is scrubbed with everything else.
    watchlist: league.watchlist.filter((pid) => !cull.has(pid)),
    // Same argument as the watchlist: a clause about a player who no longer
    // exists can never fire and can never be read, so it would just sit there.
    transferClauses: scrubClausesForPids(league.transferClauses ?? [], cull),
    teams: league.teams.map((t) => {
      // Fog-of-war bookkeeping is a pid-keyed map, so it needs the same scrub.
      const observed = t.scoutingObserved;
      if (!observed || Object.keys(observed).length === 0) return t;
      const kept = Object.fromEntries(
        Object.entries(observed).filter(([pid]) => !cull.has(Number(pid))),
      );
      return { ...t, scoutingObserved: kept };
    }),
    // Cup tie box scores keep per-player lines; drop the culled players' lines
    // so a historical tie never lists a player who no longer exists.
    cupHistory: league.cupHistory.map((cup) => scrubCupLines(cup, cull)),
    cup: league.cup ? scrubCupLines(league.cup, cull) : league.cup,
    // The Shield keeps the same per-player lines and needs the same scrub — a
    // culled player is far more likely to have featured there than in the Cup.
    shieldHistory: (league.shieldHistory ?? []).map((cup) => scrubCupLines(cup, cull)),
    shield: league.shield ? scrubCupLines(league.shield, cull) : league.shield,
    domesticCups: (league.domesticCups ?? []).map((c) => scrubDomesticCupLines(c, cull)),
    domesticCupHistory: (league.domesticCupHistory ?? []).map((c) => scrubDomesticCupLines(c, cull)),
    international: scrubInternational(league.international, cull),
  } };
}

/**
 * The same scrub, applied to the append-only history the worker never saw.
 *
 * `cullFreeAgentPoolReporting` above scrubs the copies it holds; when those
 * arrays stay on the main thread (`detachNews`), the worker's copies are empty
 * and this is what does the real work, against the retained ones. Exported so
 * the two can never drift into two different ideas of what a scrub is.
 */
export function scrubHistoryForCull(
  history: {
    newsEvents: LeagueStore["newsEvents"];
    cupHistory: LeagueStore["cupHistory"];
    shieldHistory: LeagueStore["shieldHistory"];
    domesticCupHistory: LeagueStore["domesticCupHistory"];
  },
  cull: Set<number>,
): typeof history {
  if (cull.size === 0) return history;
  return {
    newsEvents: history.newsEvents.filter(
      (e) => !("pid" in e && typeof e.pid === "number" && cull.has(e.pid)),
    ),
    cupHistory: (history.cupHistory ?? []).map((cup) => scrubCupLines(cup, cull)),
    shieldHistory: (history.shieldHistory ?? []).map((cup) => scrubCupLines(cup, cull)),
    domesticCupHistory: (history.domesticCupHistory ?? []).map((c) => scrubDomesticCupLines(c, cull)),
  };
}

/**
 * Drop culled pids from the current campaign's named squads.
 *
 * Only the live qualifying campaign and tournament hold squads at all (archived
 * campaigns already discard them), and by the time the cull runs the campaign
 * has finished playing, so these lists are display-only — the National Teams
 * Rosters tab. A weak nation genuinely can name a sub-65 player, so this is
 * reachable, and a squad listing a player who no longer exists is worse than one
 * listing a player fewer. `stageInjuries` is scrubbed for the same reason: it's
 * consumed at rollover to carry an injury onto a player who may now be gone.
 */
function scrubInternational(
  intl: LeagueStore["international"],
  cull: ReadonlySet<number>,
): LeagueStore["international"] {
  const scrubSquads = <T extends { squads: { pids: number[] }[] }>(c: T): T => {
    if (!c.squads.some((s) => s.pids.some((pid) => cull.has(pid)))) return c;
    return {
      ...c,
      squads: c.squads.map((s) =>
        s.pids.some((pid) => cull.has(pid))
          ? { ...s, pids: s.pids.filter((pid) => !cull.has(pid)) }
          : s,
      ),
    };
  };
  return {
    ...intl,
    qualifying: intl.qualifying ? scrubSquads(intl.qualifying) : intl.qualifying,
    tournament: intl.tournament ? scrubSquads(intl.tournament) : intl.tournament,
    stageInjuries: intl.stageInjuries.filter((pid) => !cull.has(pid)),
  };
}

/**
 * Drop a culled player's traces from one cup: his per-match box-score lines while
 * the cup is live, and his stored aggregate line once it's archived (archiveCup
 * replaces the box scores with `statLines`, so both shapes have to be handled).
 *
 * Covers all three stages, not just the knockout ties — `cupStatsForPlayer` reads
 * the league phase and playoff too, so scrubbing only `ties` would leave a culled
 * player contributing to a live cup's stats.
 */
function scrubCupLines<T extends LeagueStore["cupHistory"][number]>(
  cup: T,
  cull: ReadonlySet<number>,
): T {
  let touched = false;
  /** Strip culled lines from one box score, or return it unchanged. */
  const scrubBox = <B extends { home: { pid: number }[]; away: { pid: number }[] } | null>(
    box: B,
  ): B => {
    if (!box) return box;
    const home = box.home.filter((l) => !cull.has(l.pid));
    const away = box.away.filter((l) => !cull.has(l.pid));
    if (home.length === box.home.length && away.length === box.away.length) return box;
    touched = true;
    return { ...box, home, away };
  };
  const scrubTies = <E extends { boxScore: unknown }>(ties: E[]): E[] =>
    ties.map((t) => {
      const box = scrubBox(t.boxScore as Parameters<typeof scrubBox>[0]);
      return box === t.boxScore ? t : { ...t, boxScore: box };
    });

  const leaguePhase = !cup.leaguePhase
    ? cup.leaguePhase
    : {
        ...cup.leaguePhase,
        matches: (cup.leaguePhase.matches ?? []).map((m) => {
          const box = scrubBox(m.boxScore);
          return box === m.boxScore ? m : { ...m, boxScore: box };
        }),
      };
  const playoff = !cup.playoff
    ? cup.playoff
    : { ...cup.playoff, ties: scrubTies(cup.playoff.ties ?? []) };
  const playIn = !cup.playIn
    ? cup.playIn
    : { ...cup.playIn, ties: scrubTies(cup.playIn.ties ?? []) };
  const ties = scrubTies(cup.ties ?? []);

  const statLines = cup.statLines?.some((l) => cull.has(l.pid))
    ? cup.statLines.filter((l) => !cull.has(l.pid))
    : cup.statLines;
  if (statLines !== cup.statLines) touched = true;

  return touched ? { ...cup, leaguePhase, playoff, playIn, ties, statLines } : cup;
}

/**
 * The same scrub for a domestic cup: its ties' box-score lines while it's live,
 * and its stored aggregate lines once archived. Simpler than the Continental
 * Cup's only because a domestic cup has one kind of stage.
 */
function scrubDomesticCupLines(
  cup: DomesticCupState,
  cull: ReadonlySet<number>,
): DomesticCupState {
  let touched = false;
  const rounds = (cup.rounds ?? []).map((round) => {
    const ties = (round.ties ?? []).map((t) => {
      if (!t.boxScore) return t;
      const home = t.boxScore.home.filter((l) => !cull.has(l.pid));
      const away = t.boxScore.away.filter((l) => !cull.has(l.pid));
      if (home.length === t.boxScore.home.length && away.length === t.boxScore.away.length) return t;
      touched = true;
      return { ...t, boxScore: { ...t.boxScore, home, away } };
    });
    return ties === round.ties ? round : { ...round, ties };
  });

  const statLines = cup.statLines?.some((l) => cull.has(l.pid))
    ? cup.statLines.filter((l) => !cull.has(l.pid))
    : cup.statLines;
  if (statLines !== cup.statLines) touched = true;

  return touched ? { ...cup, rounds, statLines } : cup;
}
