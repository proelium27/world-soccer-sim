import type { LeagueStore } from "../leagueState.js";
import type { Player, Position } from "./types.js";

/**
 * Who a deleted player was, kept so the records pointing at him can still name
 * him.
 *
 * This is the *second* tier of the retiree record and it exists because the
 * first one answers a different question. `ArchivedPlayer` is a leaderboard row
 * — career totals, a best season in every ranked stat, a line per season played
 * — which is why it costs ~2,200 bytes and why `RETIREE_ARCHIVE_LIMIT` caps it
 * at 2,000. A leaderboard only ever wants the top N, so that cap is correct for
 * what it does.
 *
 * Naming a pid on a transfer row is not that question. It needs five fields,
 * and it needs them for *everyone the save still points at*, which is a much
 * larger set of much smaller rows. Conflating the two is what made a long save
 * forget its own history: measured on a real season-101 save, the archive's
 * prune bar had risen to peak ovr **79**, so anyone who merely had a good career
 * was dropped and 78% of every historical pid reference in the save resolved to
 * nobody.
 *
 * Measured cost of separating them: **102 bytes a row**, against the archive's
 * 2,204. Naming every referenced pid on that save is 4.76 MB — less than the
 * 4.41 MB its 2,000 fat rows already spend, and 2.9% of the save. Re-measure
 * with `scripts/retireeNameCost.ts`.
 *
 * Deliberately not merged into `ArchivedPlayer` with the fat fields made
 * optional: the archive is pruned by career score and this table must not be
 * pruned at all, so one array cannot serve both.
 */
export interface PlayerName {
  pid: number;
  name: string;
  nationality: string;
  pos: Position;
  /** Birth season, so the age boards can still date what he did. */
  born: number;
}

/** The five fields, off a player who is about to stop existing. */
export function playerNameOf(player: Player): PlayerName {
  return {
    pid: player.pid,
    name: player.name,
    nationality: player.nationality,
    pos: player.pos,
    born: player.born,
  };
}

/**
 * Every pid the save's surviving history still points at.
 *
 * These are exactly the references that render as "Player #4821" when the man
 * behind them is gone, so they are exactly the ones worth a name. Note what is
 * *not* here: `Player.stats` and `Player.hist` die with the player, and the
 * live-state lists (negotiations, inbound offers, loans) are scrubbed at
 * retirement, so neither can strand a reference.
 *
 * `international.history[].topScorer` is skipped on purpose — it already
 * carries a `name` fallback of its own.
 */
export function referencedPids(league: LeagueStore): Set<number> {
  const pids = new Set<number>();
  for (const t of league.transfers ?? []) pids.add(t.pid);
  for (const e of league.newsEvents ?? []) {
    if ("pid" in e && typeof e.pid === "number") pids.add(e.pid);
  }
  for (const h of league.seasonHistory ?? []) {
    for (const a of Object.values(h.awards ?? {})) {
      if (a.playerOfSeasonPid != null) pids.add(a.playerOfSeasonPid);
      if (a.goldenBootPid != null) pids.add(a.goldenBootPid);
      for (const pid of a.teamOfSeason ?? []) if (pid != null) pids.add(pid);
    }
    for (const e of h.world?.ballonDOr ?? []) pids.add(e.pid);
    for (const pid of h.world?.worldTeamOfYear ?? []) if (pid != null) pids.add(pid);
  }
  for (const cup of league.cupHistory ?? []) {
    for (const l of cup.statLines ?? []) pids.add(l.pid);
  }
  for (const cup of league.shieldHistory ?? []) {
    for (const l of cup.statLines ?? []) pids.add(l.pid);
  }
  for (const cup of league.americasCupHistory ?? []) {
    for (const l of cup.statLines ?? []) pids.add(l.pid);
  }
  for (const cup of league.domesticCupHistory ?? []) {
    for (const l of cup.statLines ?? []) pids.add(l.pid);
  }
  return pids;
}

/**
 * Fold this offseason's retirees into the permanent name table.
 *
 * **Only retirees need this, and that asymmetry is load-bearing.** The other
 * way a player leaves the save is `cullFreeAgentPool`, which deletes his
 * transfers, news events and cup lines along with him — a culled nobody leaves
 * nothing dangling, so naming him would be storage for a reference that does
 * not exist. Retirement deliberately keeps those records, because unlike a
 * culled nobody a retiree had a real career, and that is the whole reason his
 * name has to be kept too.
 *
 * **Bounded by construction rather than by a cap.** A row is written only for a
 * pid the history actually references, so the table cannot outgrow the records
 * pointing into it, and a name is never dropped while the thing naming it
 * survives. That is deliberate: a fixed cap is precisely what `RETIREE_ARCHIVE_LIMIT`
 * does, and it is the bug. It is also the right economics — measured on the
 * season-101 save, the referenced set grows ~460 pids a season (~47 KB) against
 * the ~900 KB a season the history referencing it already adds, so names are
 * about 5% of the cost of the records they make legible. Capping them would
 * save almost nothing and re-break the save.
 *
 * Pure and rng-free, so sim results are bit-identical. Order-stable: existing
 * rows keep their positions and new ones append in pid order.
 */
export function extendPlayerNames(
  names: PlayerName[],
  retirees: Player[],
  league: LeagueStore,
  /**
   * References the caller has already worked out, for the history it kept.
   *
   * Same reason `simOffseason` takes a precomputed `teamStats`: this walk is one
   * of only two things in the offseason that reads the append-only history —
   * `newsEvents` and the cup `statLines` — so supplying it is what lets that
   * history stay off the worker (`detachNews` in core/simArchive.ts). Optional
   * and defaulted, so every other caller is unaffected.
   *
   * **It is unioned with the live walk, never substituted for it.** The caller
   * measures the league *before* the offseason runs, and the offseason then
   * adds references of its own: this season's cup is archived into `cupHistory`
   * right above, so a one-club retiree whose only surviving mention is a cup
   * line from his final season is referenced by the finished league and not by
   * the one the caller measured. The union cannot over-name either — the extra
   * pids it may carry are ones the cull has since deleted, and a retiree is
   * never one of those (retirement runs at step 3, the cull at the very end).
   */
  precomputedReferenced?: Set<number>,
): PlayerName[] {
  if (retirees.length === 0) return names;
  const live = referencedPids(league);
  const referenced = precomputedReferenced
    ? new Set([...precomputedReferenced, ...live])
    : live;
  const known = new Set(names.map((n) => n.pid));
  const added = retirees
    .filter((p) => referenced.has(p.pid) && !known.has(p.pid))
    .sort((a, b) => a.pid - b.pid)
    .map(playerNameOf);
  return added.length === 0 ? names : [...names, ...added];
}

/** pid -> identity, for the read side. */
export function playerNameIndex(names: PlayerName[] | undefined): Map<number, PlayerName> {
  const map = new Map<number, PlayerName>();
  for (const n of names ?? []) map.set(n.pid, n);
  return map;
}
