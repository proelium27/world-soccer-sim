import type { Competition } from "../competitions.js";
import type { StandingsRow } from "../standings.js";
import type { StoredTeam } from "../teams/clubs.js";
import type { Player } from "../players/types.js";
import type { CupState } from "../cup/types.js";
import type { DomesticCupState } from "../domesticCup/types.js";
import type { TeamMatchData } from "../league/composites.js";
import type { SuperCupTie, SuperCupRoute } from "./types.js";
import { countryDivisions } from "../competitions.js";
import { leagueMatchData } from "../league/composites.js";
import { resolveCupTie } from "../cup/simCup.js";
import { teamSeasonFormDelta, applySeasonForm } from "../teamSeasonForm.js";
import { mulberry32, hashInts } from "../../engine/rng.js";
import { COUNTRY_CUP_ADJECTIVE } from "../constants.js";

/**
 * rng-stream tag for the super cups, kept clear of every other competition's
 * (continental 30, shield 70, domestic cup 0x0d0c/0x0d0d, promotion playoff
 * 0x9a0f, international 900+). Every match draws its own stream off
 * (lid, season, compId, competition) and never the shared league `rng`, so
 * adding this competition cannot move a single league scoreline.
 */
export const SUPER_CUP_STREAM = 0x5c00;

/**
 * The round index every super cup match is stamped with. A super cup is one
 * match, so there is no round structure to record — but `CupTie` carries the
 * field and the shared renderers read it, so it is pinned rather than left to
 * drift. Zero reads as "the final", which is what a one-match competition is.
 */
export const SUPER_CUP_ROUND = 0;

/**
 * The compId a continental super cup is filed under. It belongs to no league —
 * it is the one match in the world contested between two continental
 * competitions — so it takes a sentinel rather than borrowing a real league's
 * id, which would file it under whichever club happened to be listed first.
 */
export const CONTINENTAL_SUPER_CUP_COMP_ID = -1;

/** Display name for the one worldwide super cup. */
export const CONTINENTAL_SUPER_CUP_NAME = "Continental Champions Cup";

/**
 * The compId the intercontinental super cup is filed under — its own sentinel,
 * distinct from the continental one's, because it also seeds this match's rng
 * stream and two matches sharing a stream would replay each other's draws.
 */
export const INTERCONTINENTAL_SUPER_CUP_COMP_ID = -2;

/** Display name for the Europe-v-Americas champions match. */
export const INTERCONTINENTAL_SUPER_CUP_NAME = "Intercontinental Cup";

/** Display name for a country's super cup: "England" -> "English Champions Cup". */
export function superCupName(country: string): string {
  const adj = COUNTRY_CUP_ADJECTIVE[country];
  return adj ? `${adj} Champions Cup` : `${country} Champions Cup`;
}

/** What to call a route in prose. */
export function superCupRouteLabel(route: SuperCupRoute): string {
  switch (route) {
    case "league-champions": return "League champions";
    case "cup-winners": return "Cup winners";
    case "league-runners-up": return "League runners-up";
    case "continental-cup": return "Continental Cup winners";
    case "continental-shield": return "Continental Shield winners";
    case "americas-cup": return "Americas Cup winners";
  }
}

/** Everything `buildSuperCups` needs, all of it decided by the season just finished. */
export interface SuperCupSeed {
  competitions: Competition[];
  /** Final tables of the season just finished, keyed by compId. */
  tablesByCompId: Map<number, StandingsRow[]>;
  /** That season's tier-1 champions, keyed by compId. */
  championTidByCompId: Record<number, number>;
  /** That season's domestic cups, still carrying their `championTid`. */
  domesticCups: DomesticCupState[];
  /** That season's Continental Cup and Shield, still carrying their champions. */
  cup: CupState | null;
  shield: CupState | null;
  /** That season's Americas Cup. Optional so callers from before it existed still typecheck. */
  americasCup?: CupState | null;
  /** The season the super cups will open — i.e. the new one. */
  season: number;
}

/**
 * Work out who contests each super cup, from the season that just finished.
 *
 * Pure, rng-free, and called during the offseason roll — every winner it reads
 * is already decided by then, and the cups it reads them off are archived a few
 * lines later.
 *
 * **The double rule is the only judgement in here.** A club that wins both its
 * league and its domestic cup would otherwise play itself, so the league
 * runner-up steps in — which is exactly what the FA Community Shield does, and
 * it always produces a match against a genuinely strong side. The alternative
 * convention (the beaten cup finalist) was considered and passed over because
 * every one of a country's divisions enters the domestic cup here, so a lower-
 * tier club can reach its final — which would put a second- or third-division
 * side in the showpiece rather more often than reads right.
 *
 * A country with no domestic cup champion yet — season 1 has none, since the
 * cups are still being played — simply holds no super cup that preseason, and
 * the same goes for the continental one until both continental competitions
 * have crowned a winner.
 */
export function buildSuperCups(seed: SuperCupSeed): SuperCupTie[] {
  const out: SuperCupTie[] = [];
  const cupWinnerByCountry = new Map<string, number>();
  for (const dc of seed.domesticCups) {
    if (dc.championTid !== null) cupWinnerByCountry.set(dc.country, dc.championTid);
  }

  // One super cup per country, contested by its TOP division's champion —
  // `divisions` is ordered top flight first, so that is always [0] however many
  // tiers a country runs. A lower division's champion is promoted, not crowned.
  for (const { divisions } of countryDivisions(seed.competitions)) {
    const d1 = divisions[0];
    const champion = seed.championTidByCompId[d1.id];
    const cupWinner = cupWinnerByCountry.get(d1.country);
    if (champion === undefined || cupWinner === undefined) continue;

    let opponent = cupWinner;
    let opponentRoute: SuperCupRoute = "cup-winners";
    if (opponent === champion) {
      // The double. The best-placed club that ISN'T the champion steps in —
      // not simply second in the table, because where a title playoff decides
      // the champion he can have finished anywhere in the top eight, and
      // second place may be the champion himself. Without one (a division of
      // one club, which no real world has) there is simply no match.
      const runnerUp = (seed.tablesByCompId.get(d1.id) ?? []).find((r) => r.tid !== champion);
      if (runnerUp === undefined) continue;
      opponent = runnerUp.tid;
      opponentRoute = "league-runners-up";
    }

    out.push({
      competition: "domestic",
      season: seed.season,
      country: d1.country,
      compId: d1.id,
      name: superCupName(d1.country),
      teams: [champion, opponent],
      routes: ["league-champions", opponentRoute],
      tie: null,
    });
  }

  const cupWinner = seed.cup?.championTid ?? null;
  const shieldWinner = seed.shield?.championTid ?? null;
  // The two fields are disjoint by construction (see cup/qualification), so
  // these can never be the same club and no double rule is needed here.
  if (cupWinner !== null && shieldWinner !== null && cupWinner !== shieldWinner) {
    out.push({
      competition: "continental",
      season: seed.season,
      name: CONTINENTAL_SUPER_CUP_NAME,
      teams: [cupWinner, shieldWinner],
      routes: ["continental-cup", "continental-shield"],
      tie: null,
    });
  }

  // Europe's champions against the Americas'. The two fields come from
  // different continents' leagues, so these can never be the same club either.
  const americasWinner = seed.americasCup?.championTid ?? null;
  if (cupWinner !== null && americasWinner !== null && cupWinner !== americasWinner) {
    out.push({
      competition: "intercontinental",
      season: seed.season,
      name: INTERCONTINENTAL_SUPER_CUP_NAME,
      teams: [cupWinner, americasWinner],
      routes: ["continental-cup", "americas-cup"],
      tie: null,
    });
  }

  return out;
}

/** Whether any of this preseason's super cups is still to be played. */
export function superCupsPending(superCups: SuperCupTie[]): boolean {
  return superCups.some((sc) => sc.tie === null);
}

/** The seeded stream for one super cup match. */
function matchRng(lid: number, season: number, compId: number) {
  return mulberry32(hashInts(lid, season, compId, SUPER_CUP_STREAM));
}

/**
 * Play every unplayed super cup, on the squads that will start the season.
 *
 * **Which clubs share a normalization baseline matters here, and it is the same
 * lesson `cupMatchData`, the domestic cups and the promotion playoff all carry.**
 * Composites are z-normalized within the pool they are built from, so a pool of
 * the two contestants alone would be degenerate — every match would read as an
 * even one however far apart the sides really are. So:
 *
 *  - a **domestic** super cup pools its country's clubs across **every one of
 *    its divisions**, exactly as the domestic cup does. It has to: the domestic
 *    cup is open to all of them, so its winner can be a second- or third-tier
 *    club, and measuring him against his own division alone would have him meet
 *    the champions as an equal. Keyed off `country` rather than an enumerated
 *    pair of tiers, so a country gaining a division needs no change here.
 *  - the **continental** one pools every **tier-1** club in the world. Both
 *    contestants are elite top-flight sides from different countries, and the
 *    world's top flights are the only baseline that means anything across
 *    leagues — the same argument that makes `cupMatchData` pool its whole field.
 *
 * The new season's form swing applies, because this is the new season's first
 * match. Injuries are honoured (`leagueMatchData` filters them for every
 * caller); suspensions deliberately are not, the same call every cup makes.
 *
 * **Nothing here reaches the league.** No prize is credited, no box score is
 * kept, no injury or card is carried out of the match, and every draw comes off
 * a dedicated stream — so a dynasty with these played is bit-identical to one
 * without them. That is the property that made shipping the domestic cups safe
 * and it is asserted by test rather than assumed.
 */
export function playSuperCups(
  superCups: SuperCupTie[],
  competitions: Competition[],
  teams: StoredTeam[],
  players: Player[],
  lid: number,
): SuperCupTie[] {
  if (!superCupsPending(superCups)) return superCups;

  const compsByCountry = new Map<string, Set<number>>();
  for (const c of competitions) {
    const set = compsByCountry.get(c.country) ?? new Set<number>();
    set.add(c.id);
    compsByCountry.set(c.country, set);
  }
  const tier1 = new Set(competitions.filter((c) => c.tier === 1).map((c) => c.id));
  // Every tie in one preseason shares a season by construction, and the form
  // swing is a property of the season rather than of the match, so it is read
  // once here rather than per pool.
  const season = superCups[0].season;

  // Built per match rather than cached: there is exactly one super cup per
  // country and one in the world, so no two matches ever want the same pool and
  // a cache here would never once be hit.
  const poolFor = (compIds: Set<number>): Map<number, TeamMatchData> => {
    const poolTeams = teams.filter((t) => compIds.has(t.compId));
    const data = leagueMatchData({
      teams: poolTeams.map((t) => ({
        tid: t.tid,
        name: t.name,
        roster: t.roster,
        avgOvr: 0,
        academyBase: t.academyBase,
        compId: t.compId,
        starters: t.starters,
        formation: t.formation,
        moreMinutes: t.moreMinutes,
      })),
      players,
    });
    const built = new Map<number, TeamMatchData>();
    poolTeams.forEach((t, i) => {
      const delta = teamSeasonFormDelta(lid, season, t.tid);
      const d = data[i];
      built.set(t.tid, delta === 0 ? d : {
        ...d,
        composites: applySeasonForm(d.composites, delta),
        recompute: (onPitch) => applySeasonForm(d.recompute(onPitch), delta),
      });
    });
    return built;
  };

  return superCups.map((sc) => {
    if (sc.tie !== null) return sc;
    // Both worldwide matches pool every top flight in the world: the continental
    // one's two clubs are European, the intercontinental one's come from two
    // continents, and the world's top flights are the only shared baseline for
    // either.
    const pool = sc.competition === "domestic"
      ? poolFor(compsByCountry.get(sc.country ?? "") ?? new Set())
      : poolFor(tier1);

    const [homeTid, awayTid] = sc.teams;
    const hd = pool.get(homeTid);
    const ad = pool.get(awayTid);
    // A contestant with no match data can't be fielded. Unreachable in a real
    // save — both clubs were playing in this world a moment ago — but the match
    // is skipped rather than half-played, leaving the trophy unawarded.
    if (!hd || !ad) return sc;

    const compId = sc.compId ?? (sc.competition === "intercontinental"
      ? INTERCONTINENTAL_SUPER_CUP_COMP_ID
      : CONTINENTAL_SUPER_CUP_COMP_ID);
    const tie = resolveCupTie(
      matchRng(lid, sc.season, compId),
      homeTid,
      awayTid,
      hd,
      ad,
      SUPER_CUP_ROUND,
      0,
      // Neutral venue — the Community Shield is at Wembley and the UEFA Super
      // Cup moves city every year. Extra time and the shootout never applied
      // the home bonus anyway, so the match is neutral end to end.
      true,
    );
    return { ...sc, tie: { ...tie, boxScore: null } };
  });
}
