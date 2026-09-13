import type { LeagueStore } from "../leagueState.js";
import { RATING_BASELINE } from "../../engine/matchRating.js";
import {
  GOAT_OVR_BASELINE, GOAT_PEAK_WEIGHT, GOAT_PRIME_WEIGHT, GOAT_LONGEVITY_WEIGHT,
  GOAT_RATING_WEIGHT, GOAT_RATING_FULL_SAMPLE, GOAT_BALLON_DOR_WEIGHT, GOAT_WORLD_XI_WEIGHT,
  GOAT_GOALKEEPER_AWARD_WEIGHT, GOAT_DEFENDER_AWARD_WEIGHT,
  GOAT_POTY_WEIGHT, GOAT_GOLDEN_BOOT_WEIGHT, GOAT_TOTS_WEIGHT, GOAT_LEAGUE_TITLE_WEIGHT,
  GOAT_CUP_TITLE_WEIGHT, GOAT_SHIELD_TITLE_WEIGHT, GOAT_DOMESTIC_CUP_TITLE_WEIGHT,
  GOAT_WORLD_CUP_WEIGHT, GOAT_CAP_WEIGHT, GOAT_GOAL_WEIGHT, GOAT_ASSIST_WEIGHT,
  GOAT_TEAM_LEAGUE_TITLE_WEIGHT, GOAT_TEAM_CUP_TITLE_WEIGHT, GOAT_TEAM_SHIELD_TITLE_WEIGHT,
  GOAT_TEAM_DOMESTIC_CUP_TITLE_WEIGHT, GOAT_TEAM_SECOND_TIER_TITLE_WEIGHT,
  GOAT_TEAM_TOP_FINISH_WEIGHT, GOAT_TEAM_TOP_FINISH_POSITION, GOAT_TEAM_SEASON_WEIGHT,
  GOAT_TEAM_PPG_BASELINE, GOAT_TEAM_PPG_WEIGHT, GOAT_TEAM_SECOND_TIER_SCALE,
  GOAT_TEAM_TREBLE_WEIGHT, GOAT_AMERICAS_TITLE_WEIGHT, GOAT_TEAM_AMERICAS_TITLE_WEIGHT,
} from "../constants.js";
import { allCareers, type CareerRow } from "./careers.js";
import { trebleCountByTid } from "./trebles.js";

/** How many rows the GOAT boards show. */
export const GOAT_LIST_LIMIT = 50;

/** Every honour the player formula counts, per player. */
export interface PlayerHonours {
  ballonDOr: number;
  worldXI: number;
  /** Goalkeeper of the Year wins — the keeper's route onto this board. */
  goalkeeperOfYear: number;
  /** Defender of the Year wins. */
  defenderOfYear: number;
  playerOfSeason: number;
  goldenBoot: number;
  teamOfSeason: number;
  leagueTitles: number;
  cupTitles: number;
  shieldTitles: number;
  /** Americas Cup wins while he was in the squad. */
  americasTitles: number;
  /** Domestic cup wins while he was in the squad. */
  domesticCupTitles: number;
  worldCups: number;
}

/**
 * A career with nothing on it. Exported because `honours.ts` needs the same
 * zero row for a decorated player it could only stand up from award snapshots,
 * and an inline copy there silently went stale every time this interface grew.
 */
export function emptyHonours(): PlayerHonours {
  return {
    ballonDOr: 0, worldXI: 0, goalkeeperOfYear: 0, defenderOfYear: 0,
    playerOfSeason: 0, goldenBoot: 0,
    teamOfSeason: 0, leagueTitles: 0, cupTitles: 0, shieldTitles: 0, americasTitles: 0,
    domesticCupTitles: 0, worldCups: 0,
  };
}

/**
 * The only thing an honours count needs from a cup: who won it, and when.
 *
 * A cup history row is mostly `statLines`, and the three of them are ~23 MB on
 * a long save — which is exactly why `simArchive.detachNews` holds them back
 * from the worker. This is the projection that survives that boundary: two
 * numbers per cup per season, a few KB across a century.
 */
export interface CupChampion {
  season: number;
  championTid: number | null;
}

/**
 * Everything `computeHonours` reads, and nothing else.
 *
 * Deliberately NOT a `LeagueStore`. Honours were counted straight off the
 * league until 2026-09-02, and inside the offseason that is a silent bug: the
 * worker is handed empty cup histories, so a retiree scored there lost every
 * cup he had ever won, with no crash and no type error to say so (the failure
 * mode `simArchive.ts` documents, caught by its deep-equality gate). Naming the
 * two sources makes the dependency small enough to cross the worker boundary
 * and visible enough that a caller has to think about where they came from.
 */
export interface HonourSources {
  seasonHistory: readonly LeagueStore["seasonHistory"][number][];
  cup: readonly CupChampion[];
  shield: readonly CupChampion[];
  /**
   * The Americas Cup. Optional so a source object built before the Americas
   * existed still typechecks and simply counts none.
   */
  americas?: readonly CupChampion[];
  domestic: readonly CupChampion[];
}

/** Honour sources off a whole league — correct anywhere the histories are attached. */
export function honourSourcesOf(league: LeagueStore): HonourSources {
  const champions = (cups: readonly { season: number; championTid: number | null }[] | undefined) =>
    (cups ?? []).map((c) => ({ season: c.season, championTid: c.championTid }));
  return {
    seasonHistory: league.seasonHistory,
    cup: champions(league.cupHistory),
    shield: champions(league.shieldHistory),
    americas: champions(league.americasCupHistory),
    domestic: champions(league.domesticCupHistory),
  };
}

/**
 * Whether an individual award won in a given season belongs on the board being
 * built.
 *
 * Optional, and absent means "every award counts" — which is the world board's
 * rule and keeps it byte-identical. A *club* board needs the other answer: a
 * Ballon d'Or is stored by pid alone, so without this a man who won one
 * somewhere else would carry it onto every club he ever played for. The team
 * trophies below need no equivalent because they are already credited off the
 * club-per-season line.
 *
 * Deliberately not "which club" — the caller holds careers it has already
 * narrowed, so the only question left is whether he was there that season, and
 * asking it this way keeps this function ignorant of clubs entirely.
 */
export type AwardScope = (pid: number, season: number) => boolean;

/**
 * Count every player's honours in one pass over `seasonHistory` and the cups.
 *
 * Works identically for active players and archived retirees, which is the
 * whole point: awards are stored on the season-history entry by pid and never
 * change, and club-per-season comes off `CareerRow.seasons`, which both sources
 * populate the same way. Nothing here reads the live player pool, so a retiree
 * keeps every trophy he ever won.
 *
 * One pass over history rather than a lookup per player — a 100-season save
 * with thousands of careers would otherwise be a quadratic scan on every render.
 */
export function computeHonours(
  sources: HonourSources,
  careers: readonly CareerRow[],
  awardScope?: AwardScope,
): Map<number, PlayerHonours> {
  const out = new Map<number, PlayerHonours>();
  const honoursFor = (pid: number): PlayerHonours => {
    let h = out.get(pid);
    if (!h) { h = emptyHonours(); out.set(pid, h); }
    return h;
  };
  // Individual awards only. Team trophies below are already scoped by the
  // club-per-season line they are credited on, so they need no filter.
  const award = (pid: number | null | undefined, season: number): PlayerHonours | null => {
    if (pid == null) return null;
    if (awardScope && !awardScope(pid, season)) return null;
    return honoursFor(pid);
  };

  for (const h of sources.seasonHistory) {
    const ballon = award(h.world?.ballonDOr?.[0]?.pid, h.season);
    if (ballon) ballon.ballonDOr += 1;
    for (const pid of h.world?.worldTeamOfYear ?? []) {
      const xi = award(pid, h.season);
      if (xi) xi.worldXI += 1;
    }
    // Winners only, matching how the Ballon d'Or is counted just above: a
    // shortlist place is a near-miss and the awards component counts trophies.
    const bestKeeper = award(h.world?.goalkeeperOfYear?.[0]?.pid, h.season);
    if (bestKeeper) bestKeeper.goalkeeperOfYear += 1;
    const bestDefender = award(h.world?.defenderOfYear?.[0]?.pid, h.season);
    if (bestDefender) bestDefender.defenderOfYear += 1;
    for (const awards of Object.values(h.awards ?? {})) {
      const poty = award(awards.playerOfSeasonPid, h.season);
      if (poty) poty.playerOfSeason += 1;
      const boot = award(awards.goldenBootPid, h.season);
      if (boot) boot.goldenBoot += 1;
      for (const pid of awards.teamOfSeason ?? []) {
        const tots = award(pid, h.season);
        if (tots) tots.teamOfSeason += 1;
      }
    }
  }

  // Team trophies are credited to whoever was at the club that season, so they
  // need the club-per-season line rather than the award lists.
  const championsBySeason = new Map<number, Set<number>>();
  for (const h of sources.seasonHistory) {
    championsBySeason.set(h.season, new Set(Object.values(h.championTidByCompId ?? {})));
  }
  const cupChampionBySeason = new Map<number, number>();
  for (const cup of sources.cup) {
    if (cup.championTid != null) cupChampionBySeason.set(cup.season, cup.championTid);
  }
  const shieldChampionBySeason = new Map<number, number>();
  for (const shield of sources.shield) {
    if (shield.championTid != null) shieldChampionBySeason.set(shield.season, shield.championTid);
  }
  const americasChampionBySeason = new Map<number, number>();
  for (const cup of sources.americas ?? []) {
    if (cup.championTid != null) americasChampionBySeason.set(cup.season, cup.championTid);
  }
  // Keyed by season AND tid, unlike the Continental Cup: eight countries each
  // crown a domestic champion in the same season, so a season maps to a set.
  const domesticChampions = new Set<string>();
  for (const cup of sources.domestic) {
    if (cup.championTid != null) domesticChampions.add(`${cup.season}:${cup.championTid}`);
  }

  for (const career of careers) {
    const h = honoursFor(career.pid);
    // Squad membership, not appearances — the same rule core/playerHonors.ts
    // credits a profile's league-title pills on. These two must agree.
    for (const s of career.seasons) {
      if (championsBySeason.get(s.season)?.has(s.tid)) h.leagueTitles += 1;
      if (cupChampionBySeason.get(s.season) === s.tid) h.cupTitles += 1;
      if (shieldChampionBySeason.get(s.season) === s.tid) h.shieldTitles += 1;
      if (americasChampionBySeason.get(s.season) === s.tid) h.americasTitles += 1;
      if (domesticChampions.has(`${s.season}:${s.tid}`)) h.domesticCupTitles += 1;
    }
    h.worldCups = career.intlTitles;
  }

  return out;
}

/**
 * One line of the arithmetic behind a component.
 *
 * Structured rather than pre-formatted text: `count x weight = points` is the
 * whole explanation, and keeping the three numbers apart lets the UI render
 * "3 league titles, 12 each" without core knowing anything about wording. `key`
 * is a stable id the UI maps to a label.
 */
export interface GoatTerm {
  key: string;
  /** How many of the thing — awards won, rating above the baseline, seasons played. */
  count: number;
  /** What one of them is worth. */
  weight: number;
  /**
   * count x weight, **exact**. Deliberately not rounded: a line reading
   * "24 x 0.15 = 4" is arithmetic a reader can see is wrong, which defeats the
   * point of showing the working. Rounding happens once, at the component.
   */
  points: number;
}

/** One part of a score, with the terms that produced it. */
export interface GoatComponent {
  key: "peak" | "prime" | "longevity" | "awards" | "trophies" | "production";
  /** Exactly the sum of `terms`, so a reader can always reconcile the two. */
  points: number;
  terms: GoatTerm[];
}

/**
 * Build a component from its terms.
 *
 * Terms keep their exact value and the component is the rounded sum of them —
 * rounding once, here, rather than per term. That keeps two things true at the
 * same time: every line of the shown working is arithmetic a reader can verify,
 * and the whole-number components still sum exactly to the whole-number score,
 * so the table's columns always reconcile with its total.
 *
 * Terms worth nothing are dropped, so an expanded row shows the case that was
 * actually made rather than a column of zeroes.
 */
function component(key: GoatComponent["key"], terms: Omit<GoatTerm, "points">[]): GoatComponent {
  const scored = terms
    .map((t) => ({ ...t, points: t.count * t.weight }))
    .filter((t) => t.points > 0);
  return {
    key,
    points: Math.round(scored.reduce((sum, t) => sum + t.points, 0)),
    terms: scored,
  };
}

/**
 * One player's GOAT case.
 *
 * The six components are held as a list rather than six named fields on
 * purpose: the table generates its columns from them, so a component can never
 * again be left out of the display while still counting toward the score.
 */
export interface PlayerGoatRow {
  career: CareerRow;
  honours: PlayerHonours;
  /** Exactly the sum of `components`. */
  score: number;
  components: GoatComponent[];
}

/** Look up one component's points on a row. */
export function pointsOf(row: PlayerGoatRow, key: GoatComponent["key"]): number {
  return row.components.find((c) => c.key === key)?.points ?? 0;
}

/**
 * Score one career.
 *
 * See the `GOAT_*` block in constants.ts for what each weight is trying to say
 * and, importantly, for the positional bias this first draft carries.
 */
export function scorePlayer(career: CareerRow, honours: PlayerHonours): PlayerGoatRow {
  // Area under his career rating curve, above the "good starter" line. A long
  // stretch near the top out-earns a single spike, which is the difference the
  // formula most wants to capture.
  // Seasons he actually played: `seasons` now also carries squad-membership
  // rows with no appearances (needed for title attribution), and crediting a
  // rating arc for a year he sat out would reward being injured.
  const primeOvr = career.seasons.reduce(
    (sum, s) => sum + (s.apps > 0 ? Math.max(0, s.ovr - GOAT_OVR_BASELINE) : 0), 0,
  );
  // Damped until he has a real sample, so a handful of good games can't buy a
  // sustained-quality score.
  const sample = Math.min(1, career.totals.appearances / GOAT_RATING_FULL_SAMPLE);

  const components: GoatComponent[] = [
    component("peak", [
      { key: "peakOvr", count: Math.max(0, career.peakOvr - GOAT_OVR_BASELINE), weight: GOAT_PEAK_WEIGHT },
    ]),
    component("prime", [
      { key: "primeOvr", count: primeOvr, weight: GOAT_PRIME_WEIGHT },
    ]),
    component("longevity", [
      { key: "seasons", count: career.seasonsPlayed, weight: GOAT_LONGEVITY_WEIGHT },
      {
        key: "rating",
        count: Math.max(0, career.totals.avgRating - RATING_BASELINE) * sample,
        weight: GOAT_RATING_WEIGHT,
      },
    ]),
    component("awards", [
      { key: "ballonDOr", count: honours.ballonDOr, weight: GOAT_BALLON_DOR_WEIGHT },
      { key: "playerOfSeason", count: honours.playerOfSeason, weight: GOAT_POTY_WEIGHT },
      { key: "worldXI", count: honours.worldXI, weight: GOAT_WORLD_XI_WEIGHT },
      {
        key: "goalkeeperOfYear",
        count: honours.goalkeeperOfYear,
        weight: GOAT_GOALKEEPER_AWARD_WEIGHT,
      },
      {
        key: "defenderOfYear",
        count: honours.defenderOfYear,
        weight: GOAT_DEFENDER_AWARD_WEIGHT,
      },
      { key: "goldenBoot", count: honours.goldenBoot, weight: GOAT_GOLDEN_BOOT_WEIGHT },
      { key: "teamOfSeason", count: honours.teamOfSeason, weight: GOAT_TOTS_WEIGHT },
    ]),
    component("trophies", [
      { key: "worldCups", count: honours.worldCups, weight: GOAT_WORLD_CUP_WEIGHT },
      { key: "cupTitles", count: honours.cupTitles, weight: GOAT_CUP_TITLE_WEIGHT },
      { key: "leagueTitles", count: honours.leagueTitles, weight: GOAT_LEAGUE_TITLE_WEIGHT },
      { key: "shieldTitles", count: honours.shieldTitles, weight: GOAT_SHIELD_TITLE_WEIGHT },
      { key: "americasTitles", count: honours.americasTitles, weight: GOAT_AMERICAS_TITLE_WEIGHT },
      {
        key: "domesticCupTitles",
        count: honours.domesticCupTitles,
        weight: GOAT_DOMESTIC_CUP_TITLE_WEIGHT,
      },
    ]),
    component("production", [
      { key: "goals", count: career.totals.goals, weight: GOAT_GOAL_WEIGHT },
      { key: "assists", count: career.totals.assists, weight: GOAT_ASSIST_WEIGHT },
      { key: "caps", count: career.caps, weight: GOAT_CAP_WEIGHT },
    ]),
  ];

  return {
    career,
    honours,
    components,
    score: components.reduce((sum, c) => sum + c.points, 0),
  };
}

/**
 * Score a set of careers against each other, pid -> score.
 *
 * The board below is the same thing over the whole world; this exists for
 * callers holding a handful of careers they want ranked by caliber rather than
 * by a single-season number — the Season Preview's farewell list, which would
 * otherwise rank a fading legend below whichever unsigned 24-year-old happened
 * to retire at a higher rating.
 *
 * `league` decides which honours count, so pass the league as of the *end* of
 * the season being scored: `computeHonours` reads honours off `seasonHistory`
 * and the cup histories, and mid-offseason neither has taken the season that
 * just finished yet.
 */
export function goatScores(
  sources: HonourSources,
  careers: readonly CareerRow[],
): Map<number, number> {
  const honours = computeHonours(sources, careers);
  return new Map(
    careers.map((c) => [c.pid, scorePlayer(c, honours.get(c.pid) ?? emptyHonours()).score]),
  );
}

/** The player GOAT board, best first. */
export function playerGoatRanking(
  league: LeagueStore,
  limit = GOAT_LIST_LIMIT,
): PlayerGoatRow[] {
  const careers = allCareers(league);
  const honours = computeHonours(honourSourcesOf(league), careers);
  return careers
    .map((c) => scorePlayer(c, honours.get(c.pid) ?? emptyHonours()))
    .sort((a, b) => b.score - a.score || a.career.pid - b.career.pid)
    .slice(0, limit);
}

/** One club's GOAT case, with the same expandable arithmetic as a player's. */
export interface TeamGoatRow {
  tid: number;
  /** Exactly the sum of `components`. */
  score: number;
  /** Trophies and consistency, each with the terms that produced them. */
  components: GoatComponent[];
  leagueTitles: number;
  cupTitles: number;
  shieldTitles: number;
  americasTitles: number;
  domesticCupTitles: number;
  /** League, Continental Cup and domestic cup in one season. Scored as a bonus on top of all three. */
  trebles: number;
  secondTierTitles: number;
  topFinishes: number;
  seasons: number;
  topFlightSeasons: number;
  /** Career points per game across every season played. */
  ppg: number;
}

/**
 * The club GOAT board, best first.
 *
 * Derived entirely from `seasonHistory` and `cupHistory`, so it covers every
 * club the save has ever recorded a season for — including one currently in the
 * second tier, which is the point of ranking careers rather than current form.
 */
export function teamGoatRanking(league: LeagueStore, limit = GOAT_LIST_LIMIT): TeamGoatRow[] {
  const tierByCompId = new Map(league.competitions.map((c) => [c.id, c.tier]));
  const rows = new Map<number, TeamGoatRow>();
  const rowFor = (tid: number): TeamGoatRow => {
    let r = rows.get(tid);
    if (!r) {
      r = {
        tid, score: 0, components: [], leagueTitles: 0, cupTitles: 0, shieldTitles: 0,
        americasTitles: 0, domesticCupTitles: 0, trebles: 0, secondTierTitles: 0,
        topFinishes: 0, seasons: 0, topFlightSeasons: 0, ppg: 0,
      };
      rows.set(tid, r);
    }
    return r;
  };

  // Points and matches carried separately so career ppg is a true weighted mean
  // rather than an average of per-season averages.
  const points = new Map<number, number>();
  const played = new Map<number, number>();
  // Summed across seasons and turned into a single term at the end, so the
  // expanded row shows one readable line rather than one per season.
  const ppgSurplus = new Map<number, number>();

  for (const h of league.seasonHistory) {
    const byComp = new Map<number, typeof h.table>();
    for (const row of h.table) {
      if (row.played <= 0) continue;
      const compId = h.compsByTid?.[row.tid] ?? 0;
      const list = byComp.get(compId);
      if (list) list.push(row); else byComp.set(compId, [row]);
    }

    for (const [compId, table] of byComp) {
      const tier = tierByCompId.get(compId) ?? 1;
      const sorted = [...table].sort(
        (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.tid - b.tid,
      );
      // A top flight's champion is the recorded one, not the table leader: a
      // title playoff can crown someone other than the club that topped it.
      const recordedChampion = tier === 1 ? h.championTidByCompId?.[compId] : undefined;
      sorted.forEach((row, i) => {
        const r = rowFor(row.tid);
        const position = i + 1;
        r.seasons += 1;
        if (tier === 1) r.topFlightSeasons += 1;
        const wonIt = recordedChampion !== undefined ? recordedChampion === row.tid : position === 1;
        if (wonIt) {
          if (tier === 1) r.leagueTitles += 1; else r.secondTierTitles += 1;
        }
        // Contending seasons only count in the division that matters.
        if (tier === 1 && position <= GOAT_TEAM_TOP_FINISH_POSITION) r.topFinishes += 1;

        points.set(row.tid, (points.get(row.tid) ?? 0) + row.points);
        played.set(row.tid, (played.get(row.tid) ?? 0) + row.played);

        // Sustained strength, measured against a mid-table baseline so an
        // ordinary season adds nothing. Halved in the second tier: dominating a
        // division you shouldn't be in isn't a GOAT case.
        const seasonPpg = row.points / row.played;
        const scale = tier === 1 ? 1 : GOAT_TEAM_SECOND_TIER_SCALE;
        ppgSurplus.set(
          row.tid,
          (ppgSurplus.get(row.tid) ?? 0)
            + Math.max(0, seasonPpg - GOAT_TEAM_PPG_BASELINE) * scale,
        );
      });
    }
  }

  for (const cup of league.cupHistory ?? []) {
    if (cup.championTid != null) rowFor(cup.championTid).cupTitles += 1;
  }
  for (const shield of league.shieldHistory ?? []) {
    if (shield.championTid != null) rowFor(shield.championTid).shieldTitles += 1;
  }
  for (const cup of league.americasCupHistory ?? []) {
    if (cup.championTid != null) rowFor(cup.championTid).americasTitles += 1;
  }
  for (const cup of league.domesticCupHistory ?? []) {
    if (cup.championTid != null) rowFor(cup.championTid).domesticCupTitles += 1;
  }

  const treblesByTid = trebleCountByTid(league);

  for (const r of rows.values()) {
    const p = played.get(r.tid) ?? 0;
    r.ppg = p > 0 ? (points.get(r.tid) ?? 0) / p : 0;
    r.trebles = treblesByTid.get(r.tid) ?? 0;
    r.components = [
      component("trophies", [
        { key: "cupTitles", count: r.cupTitles, weight: GOAT_TEAM_CUP_TITLE_WEIGHT },
        { key: "leagueTitles", count: r.leagueTitles, weight: GOAT_TEAM_LEAGUE_TITLE_WEIGHT },
        { key: "shieldTitles", count: r.shieldTitles, weight: GOAT_TEAM_SHIELD_TITLE_WEIGHT },
        { key: "americasTitles", count: r.americasTitles, weight: GOAT_TEAM_AMERICAS_TITLE_WEIGHT },
        {
          key: "domesticCupTitles",
          count: r.domesticCupTitles,
          weight: GOAT_TEAM_DOMESTIC_CUP_TITLE_WEIGHT,
        },
        // Sits with the trophies because that is what it is made of, and after
        // them so the row reads as "these three, and all three at once".
        { key: "trebles", count: r.trebles, weight: GOAT_TEAM_TREBLE_WEIGHT },
        { key: "secondTierTitles", count: r.secondTierTitles, weight: GOAT_TEAM_SECOND_TIER_TITLE_WEIGHT },
      ]),
      component("longevity", [
        { key: "topFinishes", count: r.topFinishes, weight: GOAT_TEAM_TOP_FINISH_WEIGHT },
        { key: "topFlightSeasons", count: r.topFlightSeasons, weight: GOAT_TEAM_SEASON_WEIGHT },
        { key: "ppgSurplus", count: ppgSurplus.get(r.tid) ?? 0, weight: GOAT_TEAM_PPG_WEIGHT },
      ]),
    ];
    r.score = r.components.reduce((sum, c) => sum + c.points, 0);
  }

  return [...rows.values()]
    .sort((a, b) => b.score - a.score || a.tid - b.tid)
    .slice(0, limit);
}
