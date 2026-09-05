import type { DomesticCupState } from "./domesticCup/types.js";
import { trophyNewsBySeason, type TrophyRecords } from "./trophyNews.js";

/** A club competition's winner in one season. */
export interface SeasonTrophyWin {
  /** What the competition was called that season. */
  name: string;
  tid: number;
}

/** An international tournament's winner in one season. */
export interface SeasonInternationalWin {
  /** The tournament's own name — "World Cup", "Copa América", … */
  name: string;
  /**
   * Which confederation's championship this was. Absent on the World Cup, which
   * is how a caller tells the two apart without matching on the name.
   */
  confederation?: string;
  nation: string;
  runnerUp?: string;
  /** Final scoreline, champion first, with a shootout appended if it went there. */
  score?: string;
}

/**
 * Everything the save can say about who won what in one season — one row of the
 * Season History table.
 */
export interface SeasonSummaryRow {
  season: number;
  /**
   * Whether the season has been rolled over. A season still being played can
   * already have continental and domestic cup winners (both finals are played
   * before the offseason), but its league champions are only written into
   * `seasonHistory` at the rollover, so `leagueChampions` is empty until then.
   */
  complete: boolean;
  /** Each top flight's champion, keyed by compId. Empty until the season rolls over. */
  leagueChampions: Record<number, number>;
  /** Each country's domestic cup winner, keyed by country. */
  domesticCupWinners: Record<string, number>;
  continentalCup: SeasonTrophyWin | null;
  continentalShield: SeasonTrophyWin | null;
  /**
   * The World Cup winner, or every confederation champion, from the offseason
   * that followed this season. Empty in the two qualifying-only years of each
   * four-season cycle.
   */
  international: SeasonInternationalWin[];
}

/**
 * What `seasonSummaries` reads. Structural rather than a `LeagueStore` for the
 * same reason `TrophyRecords` is: it keeps the derivation testable off a
 * handful of hand-built records instead of a generated world, and a real
 * `LeagueStore` satisfies it without any adapting at the call site.
 */
export interface SeasonSummaryRecords extends TrophyRecords {
  seasonHistory: readonly { season: number; championTidByCompId: Record<number, number> }[];
  /** This season's domestic cups, which hold a champion from matchday 36 on. */
  domesticCups: readonly DomesticCupState[];
  domesticCupHistory: readonly DomesticCupState[];
}

/**
 * Every season the save has a champion for, newest first.
 *
 * **Derived, like `trophyNewsBySeason` and `awardNews.ts`, and for the same
 * reason**: every winner here is already recorded somewhere the save keeps
 * forever (`SeasonHistoryEntry.championTidByCompId`, `CupState.championTid`,
 * `DomesticCupState.championTid`, `IntlTournamentSummary.champion`), so there
 * is no persisted field and no migration, and an existing dynasty shows its
 * whole back catalogue the moment this ships.
 *
 * **The continental and international halves go through `trophyNewsBySeason`
 * rather than reading those records again.** Two surfaces answering "who won
 * the Continental Cup in season N" out of two separate walks is exactly the
 * drift this file exists to avoid, and that function already handles the two
 * cases a fresh implementation gets wrong: the live cup as well as the archive
 * (a cup only moves into its history at the rollover, so without it the club
 * season's biggest result goes unreported until the user clicks Advance), and
 * the convention that an international tournament files under the club season
 * it *followed*, which is what the awards and the News Feed already do.
 *
 * **Super cups are deliberately dropped**, even though the trophy map carries
 * them. The table shows one column per competition and they would add thirteen
 * — and, more sharply, a super cup is played in the *preseason*, so counting
 * one would open a row for the new season on matchday 0 with nothing else in it
 * yet. They live on the Champions Cups page.
 *
 * A row exists for every season in `seasonHistory` whether or not it awarded a
 * trophy (a gap in a list of seasons reads as a bug), plus any later season
 * that already has a winner this table shows.
 */
export function seasonSummaries(records: SeasonSummaryRecords): SeasonSummaryRow[] {
  const rows = new Map<number, SeasonSummaryRow>();
  const rowFor = (season: number): SeasonSummaryRow => {
    let row = rows.get(season);
    if (!row) {
      row = {
        season,
        complete: false,
        leagueChampions: {},
        domesticCupWinners: {},
        continentalCup: null,
        continentalShield: null,
        international: [],
      };
      rows.set(season, row);
    }
    return row;
  };

  for (const h of records.seasonHistory) {
    const row = rowFor(h.season);
    row.complete = true;
    row.leagueChampions = { ...h.championTidByCompId };
  }

  // Archive first, then the live cups, so the season in progress wins if the
  // two ever describe the same one. They can't today — the rollover archives
  // the old cup and builds the new one in the same step — but nothing in the
  // shape of these two fields says so.
  const addDomestic = (cup: DomesticCupState): void => {
    if (cup.championTid === null) return;
    rowFor(cup.season).domesticCupWinners[cup.country] = cup.championTid;
  };
  for (const c of records.domesticCupHistory) addDomestic(c);
  for (const c of records.domesticCups) addDomestic(c);

  for (const [season, trophies] of trophyNewsBySeason(records)) {
    for (const t of trophies) {
      // Each branch calls rowFor itself, so a season whose only trophy is one
      // this table doesn't show never opens an empty row.
      if (t.kind === "continentalCup" && t.tid !== undefined) {
        rowFor(season).continentalCup = { name: t.name, tid: t.tid };
      } else if (t.kind === "continentalShield" && t.tid !== undefined) {
        rowFor(season).continentalShield = { name: t.name, tid: t.tid };
      } else if ((t.kind === "worldCup" || t.kind === "confederationCup") && t.nation) {
        rowFor(season).international.push({
          name: t.name,
          confederation: t.confederation,
          nation: t.nation,
          runnerUp: t.runnerUp,
          score: t.score,
        });
      }
    }
  }

  const out = [...rows.values()].sort((a, b) => b.season - a.season);
  // A season holds either the World Cup or its confederations' championships,
  // never both, so this only orders the several confederation cups of one
  // offseason against each other — by name, so they don't reshuffle between
  // renders of the same save.
  for (const row of out) row.international.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
