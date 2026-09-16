import type { Player, Position } from "./players/types.js";
import type { SeasonAwards } from "./awards.js";
import { ovrDuringSeason, statsFor } from "./awards.js";
import type { WorldAwards } from "./worldAwards.js";
import type { ArchivedPlayer } from "./players/archive.js";

/**
 * Who a season's award winner *was*, copied onto the season it was won in.
 *
 * Every award is stored as a bare pid — `SeasonAwards.playerOfSeasonPid`,
 * `goldenBootPid`, `teamOfSeason[]`, `world.ballonDOr[].pid`,
 * `world.worldTeamOfYear[]` — which was fine while a pid could always be looked
 * up. It can't: retirement deletes the player from `league.players` outright,
 * and the retiree archive that catches him is quality-gated and hard-capped
 * (`RETIREE_ARCHIVE_LIMIT`), so a modest career eventually falls out of the save
 * entirely. Measured across four real saves, the winners a save could no longer
 * name:
 *
 * | seasons | Ballon d'Or | league Player of the Season |
 * |---|---|---|
 * | 11 | 0 of 11 | 8 of 176 (5%) |
 * | 32 | 0 of 32 | 152 of 512 (30%) |
 * | 100 | 30 of 100 | 1,177 of 1,600 (74%) |
 *
 * The league Player of the Season goes first and worst because it is awarded
 * per competition: a second-division or weak-league winner is exactly the modest
 * career the archive drops first. The Ballon d'Or lasts longer only because its
 * winners are elite.
 *
 * **The fix is a copy, not a reference** — the same trade `RetirementSummary`
 * makes for the farewell list, and for the same reason: the thing being
 * described is about to stop existing. Exempting winners from the archive prune
 * was the alternative and it does not scale — 16 competitions hand out 13 places
 * each, so a season names up to 229 players and a century names 10-20k of them,
 * against an archive capped at 2,000 rows for save-size reasons.
 *
 * Cost is ~200 rows a season of six small fields, which is a fraction of the
 * standings table already stored beside it.
 */
export interface AwardWinner {
  pid: number;
  name: string;
  nationality: string;
  pos: Position;
  /** The rating he played that season at (`ovrDuringSeason`), not his present-day one. */
  ovr: number;
  /** The club he finished the season at (`SeasonStats.tid`); absent if he somehow has no stats row. */
  tid?: number;
  /** Birth season, so the youngest/oldest-winner boards still know his age. */
  born: number;
}

/**
 * Every pid a season's awards point at, individual and slot-keyed, world and
 * domestic.
 *
 * Every worldwide shortlist is walked, not just its winner: a runner-up is
 * shown by name on the awards page and on the Frivolities boards, so a season
 * that could name its winner and not the man he beat would read as broken.
 */
export function awardWinnerPids(entry: {
  awards?: Record<number, SeasonAwards>;
  world?: WorldAwards;
}): Set<number> {
  const pids = new Set<number>();
  const note = (pid: number | null | undefined): void => {
    if (pid != null) pids.add(pid);
  };
  for (const e of entry.world?.ballonDOr ?? []) note(e.pid);
  for (const pid of entry.world?.worldTeamOfYear ?? []) note(pid);
  for (const e of entry.world?.goalkeeperOfYear ?? []) note(e.pid);
  for (const e of entry.world?.defenderOfYear ?? []) note(e.pid);
  // The Americas' own set is shown by name on the awards page just the same.
  const americas = entry.world?.americas;
  for (const e of americas?.ballonDOr ?? []) note(e.pid);
  for (const pid of americas?.worldTeamOfYear ?? []) note(pid);
  for (const e of americas?.goalkeeperOfYear ?? []) note(e.pid);
  for (const e of americas?.defenderOfYear ?? []) note(e.pid);
  for (const a of Object.values(entry.awards ?? {})) {
    note(a.playerOfSeasonPid);
    note(a.goldenBootPid);
    for (const pid of a.teamOfSeason ?? []) note(pid);
  }
  return pids;
}

/**
 * Snapshot every winner a season's awards name, off the pool that won them.
 *
 * Must be called with the pool the awards were *scored* against — in
 * `simOffseason` that is `league.players`, which both `awardsByCompetition` and
 * `computeWorldAwards` read and which progression and retirement leave alone.
 * A pid with nobody behind it is skipped rather than stubbed: a missing row and
 * a row that says "unknown" read the same to a caller, and the callers all have
 * to keep their fallback anyway (migrate.ts backfills old seasons from a pool
 * that has already forgotten some of them).
 */
export function snapshotAwardWinners(
  players: Player[],
  season: number,
  entry: { awards?: Record<number, SeasonAwards>; world?: WorldAwards },
): AwardWinner[] {
  const wanted = awardWinnerPids(entry);
  if (wanted.size === 0) return [];
  const out: AwardWinner[] = [];
  for (const p of players) {
    if (!wanted.has(p.pid)) continue;
    const tid = statsFor(p, season)?.tid;
    out.push({
      pid: p.pid,
      name: p.name,
      nationality: p.nationality,
      pos: p.pos,
      ovr: ovrDuringSeason(p, season),
      ...(tid !== undefined ? { tid } : {}),
      born: p.born,
    });
  }
  return out;
}

/** pid -> winner, across every season on record. Later seasons win, so the name is his latest. */
export function awardWinnerIndex(
  history: { awardWinners?: AwardWinner[] }[],
): Map<number, AwardWinner> {
  const map = new Map<number, AwardWinner>();
  for (const h of history) {
    for (const w of h.awardWinners ?? []) map.set(w.pid, w);
  }
  return map;
}

/**
 * The best snapshot an existing save can still be given for a past season.
 *
 * Used only by migrate.ts. A save written before this field existed has award
 * pids going back to season 1 and no names for any of them, so the backfill
 * takes whatever is still resolvable — the live pool first, then the retiree
 * archive — and writes it down permanently. That is complete for a young save
 * and partial for an old one, which is the point: it stops the loss where the
 * save currently stands instead of letting the next few offseasons take the
 * rest. Nobody already deleted can be recovered; those slots stay unnamed.
 *
 * An entry that already has the field keeps it untouched. Anything missing from
 * it was missing when it was written, and deletion only runs one way.
 */
export function backfillAwardWinners(
  entry: { awards?: Record<number, SeasonAwards>; world?: WorldAwards; awardWinners?: AwardWinner[] },
  season: number,
  players: Player[],
  retired: ArchivedPlayer[],
): AwardWinner[] | undefined {
  if (entry.awardWinners) return entry.awardWinners;
  const live = snapshotAwardWinners(players, season, entry);
  const wanted = awardWinnerPids(entry);
  if (wanted.size === 0) return undefined;
  for (const w of live) wanted.delete(w.pid);
  if (wanted.size === 0) return live;
  for (const a of retired) {
    if (!wanted.has(a.pid)) continue;
    // His line for that season if the archive kept one; otherwise the closest
    // thing it has, which is where his career ended.
    const line = a.seasons.find((s) => s.season === season);
    live.push({
      pid: a.pid,
      name: a.name,
      nationality: a.nationality,
      pos: a.pos,
      ovr: line?.ovr ?? a.finalOvr,
      ...(line ? { tid: line.tid } : {}),
      born: a.born,
    });
  }
  return live;
}
