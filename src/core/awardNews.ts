import type { SeasonHistoryEntry } from "./standings.js";
import { NEWS_BALLON_DOR_PLACINGS } from "./constants.js";

/**
 * Which honour a feed row is reporting. Slot-keyed XI places (`teamOfSeason`,
 * `worldTeamOfYear`) carry the slot they were picked in, since that *is* the
 * award — the XI is a record of who was the best in each position.
 */
export type AwardNewsKind =
  | "ballonDOr"
  | "worldTeamOfYear"
  | "goalkeeperOfYear"
  | "defenderOfYear"
  | "americasPlayerOfYear"
  | "americasTeamOfYear"
  | "americasGoalkeeperOfYear"
  | "americasDefenderOfYear"
  | "playerOfSeason"
  | "goldenBoot"
  | "teamOfSeason";

export interface AwardNews {
  kind: AwardNewsKind;
  pid: number;
  /** The club he finished the season at. Absent when the save can no longer say. */
  tid?: number;
  /** The competition that awarded it; absent for the worldwide honours. */
  compId?: number;
  /** Ballon d'Or placing, 1-based. Only set for `ballonDOr`. */
  placing?: number;
  /** Index into TOTS_SLOTS. Only set for the two XI awards. */
  slot?: number;
}

/**
 * One season's honours, flattened into feed rows.
 *
 * **Derived from the season entry, never persisted as a `NewsEvent`.** Every
 * award is already stored on `SeasonHistoryEntry` (`awards` per competition,
 * `world` for the worldwide ones), which is exactly the test `newsEvents.ts`
 * states for what has to be written down at sim time: an accomplishment is
 * persisted only because it *can't* be derived retroactively. These can, so
 * they cost nothing in save size, they can't drift from the Awards page, and an
 * existing save shows its whole back catalogue of honours the moment this
 * ships rather than only the seasons played after it.
 *
 * A winner's club comes from `awardWinners`, the name/club snapshot taken when
 * the season rolled over, with the Ballon d'Or's own `tid` preferred since the
 * entry carries it directly. Neither is guaranteed on an old save (the snapshot
 * is backfilled as far as the pool and the archive still reach), so `tid` is
 * optional and a row without one simply can't be filed under a league — see
 * `awardNewsScope` for what that costs.
 */
export function seasonAwardNews(entry: SeasonHistoryEntry | null | undefined): AwardNews[] {
  // A season still being played has no entry yet, and so has no honours to
  // report — its awards are decided in the offseason that follows it.
  if (!entry) return [];

  const tidOf = new Map<number, number>();
  for (const w of entry.awardWinners ?? []) {
    if (w.tid !== undefined) tidOf.set(w.pid, w.tid);
  }
  const clubOf = (pid: number): number | undefined => tidOf.get(pid);

  const out: AwardNews[] = [];

  // Worldwide. Only the winner of each position award is an award — the rest of
  // the shortlist is a ranking, and is on the Awards page for anyone who wants
  // it. The Ballon d'Or reports its podium, since a top-three finish is an
  // honour a player carries on his profile.
  const world = entry.world;
  if (world) {
    world.ballonDOr.slice(0, NEWS_BALLON_DOR_PLACINGS).forEach((e, i) => {
      out.push({ kind: "ballonDOr", pid: e.pid, tid: e.tid ?? clubOf(e.pid), placing: i + 1 });
    });
    world.worldTeamOfYear.forEach((pid, slot) => {
      if (pid !== null) out.push({ kind: "worldTeamOfYear", pid, tid: clubOf(pid), slot });
    });
    const gk = world.goalkeeperOfYear?.[0];
    if (gk) out.push({ kind: "goalkeeperOfYear", pid: gk.pid, tid: gk.tid ?? clubOf(gk.pid) });
    const def = world.defenderOfYear?.[0];
    if (def) out.push({ kind: "defenderOfYear", pid: def.pid, tid: def.tid ?? clubOf(def.pid) });

    // The Americas' own set, winners only. Absent on a world without the
    // Americas and on seasons played before it existed.
    const americas = world.americas;
    if (americas) {
      const player = americas.ballonDOr[0];
      if (player) {
        out.push({ kind: "americasPlayerOfYear", pid: player.pid, tid: player.tid ?? clubOf(player.pid) });
      }
      americas.worldTeamOfYear.forEach((pid, slot) => {
        if (pid !== null) out.push({ kind: "americasTeamOfYear", pid, tid: clubOf(pid), slot });
      });
      const keeper = americas.goalkeeperOfYear?.[0];
      if (keeper) {
        out.push({ kind: "americasGoalkeeperOfYear", pid: keeper.pid, tid: keeper.tid ?? clubOf(keeper.pid) });
      }
      const defender = americas.defenderOfYear?.[0];
      if (defender) {
        out.push({ kind: "americasDefenderOfYear", pid: defender.pid, tid: defender.tid ?? clubOf(defender.pid) });
      }
    }
  }

  // Per competition. compId comes from the record's own key rather than from
  // the winner's club, so these still file correctly when the save can no
  // longer say which club he was at.
  for (const [key, awards] of Object.entries(entry.awards ?? {})) {
    const compId = Number(key);
    if (awards.playerOfSeasonPid !== null) {
      out.push({
        kind: "playerOfSeason", pid: awards.playerOfSeasonPid,
        tid: clubOf(awards.playerOfSeasonPid), compId,
      });
    }
    if (awards.goldenBootPid !== null) {
      out.push({
        kind: "goldenBoot", pid: awards.goldenBootPid,
        tid: clubOf(awards.goldenBootPid), compId,
      });
    }
    awards.teamOfSeason.forEach((pid, slot) => {
      if (pid !== null) out.push({ kind: "teamOfSeason", pid, tid: clubOf(pid), compId, slot });
    });
  }

  return out;
}

/**
 * How far an honour travels, on the same terms as `newsEventScope`.
 *
 * The worldwide awards are world news by definition — one Ballon d'Or winner, one
 * World XI, one Goalkeeper and one Defender of the Year for all 320 clubs.
 * Everything a single competition hands out is news inside that competition, and
 * so is a Ballon d'Or placing behind the winner: sixteen leagues' Players of the
 * Season would otherwise be sixteen times the honours a reader has any stake in.
 */
export function awardNewsScope(a: AwardNews): "world" | "league" | "americas" {
  switch (a.kind) {
    case "ballonDOr":
      return a.placing === 1 ? "world" : "league";
    case "worldTeamOfYear":
    case "goalkeeperOfYear":
    case "defenderOfYear":
      return "world";
    // The Americas' honours are news to anyone whose league is in the Americas,
    // and to nobody in Europe beyond the winner's own club and league.
    case "americasPlayerOfYear":
    case "americasTeamOfYear":
    case "americasGoalkeeperOfYear":
    case "americasDefenderOfYear":
      return "americas";
    case "playerOfSeason":
    case "goldenBoot":
    case "teamOfSeason":
      return "league";
  }
}
