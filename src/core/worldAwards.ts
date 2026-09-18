import type { Player, SeasonStats } from "./players/types.js";
import { competitionRegion, type Competition } from "./competitions.js";
import type { ContinentalRegion } from "./constants.js";
import type { CupState } from "./cup/types.js";
import type { CupStatLine } from "./cup/cupStats.js";
import { cupStatsByPid, cupAvgRating } from "./cup/cupStats.js";
import { cupRoundsFromFinal } from "./cup/cup.js";
import type { DomesticCupState } from "./domesticCup/types.js";
import { domesticStatsByPid } from "./domesticCup/stats.js";
import { RATING_BASELINE } from "../engine/matchRating.js";
import {
  type PositionGroup,
  positionGroup, statsFor, ovrDuringSeason, potyScore, totsScore, TOTS_SLOTS,
} from "./awards.js";
import {
  AWARD_OVR_BASELINE, BALLON_DOR_SHORTLIST, WORLD_POSITION_AWARD_SHORTLIST,
  WORLD_AWARD_TROPHY_STRENGTH_FLOOR, WORLD_AWARD_TROPHY_STRENGTH_CAP,
  WORLD_AWARD_CUP_FULL_INVOLVEMENT, WORLD_AWARD_TITLE_FULL_SEASON,
  WORLD_AWARD_DOMESTIC_CUP_FULL_INVOLVEMENT, AMERICAS_ACCOMPLISHMENT_SCALE,
} from "./constants.js";
import { DEFAULT_AWARD_FORMULA, type AwardFormula } from "./awardFormula.js";

/**
 * One player's case for a worldwide award, broken into the parts that made it
 * up so the award page can show *why* he won rather than just a number.
 *
 * Shared by all three worldwide awards - the Ballon d'Or, the Goalkeeper of
 * the Year and the Defender of the Year - because they differ only in the
 * formula behind `league` and in who they are open to, never in the shape of
 * the case. One interface is what lets the awards page render all three
 * through the same table.
 */
export interface WorldAwardEntry {
  pid: number;
  /** Club he finished the season at (SeasonStats.tid), for display after he later moves. */
  tid: number;
  score: number;
  /**
   * Domestic league season, league-strength corrected, including both ovr terms
   * (AWARD_OVR_WEIGHT + WORLD_AWARD_OVR_WEIGHT).
   *
   * Which formula produced it depends on the award: the Ballon d'Or uses
   * `potyScore`, the two position awards use `totsScore`. That is the whole
   * difference between them.
   */
  league: number;
  /**
   * His continental competition — the Continental Cup, or the Americas Cup for
   * a club in the Americas: his own end product and rating there, plus how far
   * his club went.
   */
  cup: number;
  /** The offseason's international campaign, plus a World Cup winner's bonus. */
  intl: number;
  /** Winning his own domestic league. */
  title: number;
  /**
   * Winning his own domestic cup, pro-rated by ties played. **Optional**: every
   * WorldAwards entry persisted before domestic cups existed lacks it, and
   * their `score` was computed without it, so readers default it to 0 rather
   * than treating its absence as a bug. A required field would have made every
   * one of those stored entries fail to typecheck for no gain.
   */
  domesticCup?: number;
  /**
   * `league` split into where it came from, so the Awards page can say *why*
   * someone won rather than printing one number that is most of the score for
   * everybody. The four parts add up to `league` (to floating-point noise).
   *
   * **Optional, and never backfilled**: entries written before it existed don't
   * have it, and the page falls back to the coarser league/cups/country split.
   */
  breakdown?: WorldAwardBreakdown;
}

/** See `WorldAwardEntry.breakdown`. Every part carries the same Americas scale `league` does. */
export interface WorldAwardBreakdown {
  /** His average match rating, times the formula's rating weight. */
  rating: number;
  /** His league goals and assists. */
  scoring: number;
  /**
   * The work his position does beyond the scoreline: tackles and interceptions
   * per game for a defender, save percentage for a keeper. Always 0 on a
   * Ballon d'Or entry, which is scored without it.
   */
  work: number;
  /**
   * Everything left: both overall-rating terms plus the league-strength
   * correction. Kept as one part because the strength correction only makes
   * sense read together with the quality it adjusts.
   */
  quality: number;
}

/**
 * One set of end-of-season honours judged across several leagues at once: the
 * world's, or the Americas' own. `ballonDOr` is that set's player of the year
 * and `worldTeamOfYear` its team of the year. The names are the world set's,
 * kept rather than renamed because every WorldAwards already persisted uses them.
 */
export interface ContinentalAwards {
  /** The ranking, best first, up to BALLON_DOR_SHORTLIST. `[0]` is the winner; empty if nobody was eligible. */
  ballonDOr: WorldAwardEntry[];
  /** 11 pids (or null where no eligible player existed), index-aligned with TOTS_SLOTS. */
  worldTeamOfYear: (number | null)[];
  /**
   * The best goalkeeper in the world, and the rest of his shortlist, up to
   * WORLD_POSITION_AWARD_SHORTLIST.
   *
   * **Optional, on the same terms as `WorldAwardEntry.domesticCup`**: every
   * WorldAwards already persisted on a save predates this award, so readers
   * default it to empty rather than treating its absence as a bug. Note what
   * that means in practice - an existing save picks these up from its next
   * completed season onward and its past seasons stay without them. That is
   * deliberate: `migrate.ts` only computes awards for a season that has none,
   * because rescoring a played season would judge it on the survivors still in
   * the player pool and could hand its Ballon d'Or to somebody else.
   */
  goalkeeperOfYear?: WorldAwardEntry[];
  /** The best defender in the world (CB and FB), same shape and same caveats as `goalkeeperOfYear`. */
  defenderOfYear?: WorldAwardEntry[];
}

/** One completed season's worldwide honors, stored on SeasonHistoryEntry alongside the per-competition ones. */
export interface WorldAwards extends ContinentalAwards {
  /**
   * The Americas' own Player, Team, Goalkeeper and Defender of the Year, judged
   * over the leagues of the Americas alone and on the same formula as the
   * world's. They exist because the world's awards discount everything done at
   * a club in the Americas (AMERICAS_ACCOMPLISHMENT_SCALE), which keeps those
   * players off the worldwide shortlists; these are the honours they can win.
   *
   * Optional: absent on a world with no league in the Americas, and on every
   * season played before these awards existed, which is never rescored.
   */
  americas?: ContinentalAwards;
}

/**
 * Everything outside the players themselves that a worldwide award needs. All
 * of it is either already snapshotted on a SeasonHistoryEntry or derivable from
 * the archived cup, so past seasons can be scored exactly like fresh ones (see
 * migrate.ts's backfill).
 */
export interface WorldAwardContext {
  /** tid → compId *during the season being judged* (SeasonHistoryEntry.compsByTid). */
  compsByTid: Record<number, number>;
  competitions: Competition[];
  /** compId → champion tid, tier-1 only (SeasonHistoryEntry.championTidByCompId). */
  championTidByCompId: Record<number, number>;
  /** The Continental Cup played *during* that season, or null (season 1, or a world too small for one). */
  cup: CupState | null;
  /**
   * That season's domestic cups, one per country. Optional and defaulted to
   * empty: a save from before domestic cups existed has none for its past
   * seasons, and the backfill scores them the same way it always did.
   */
  domesticCups?: DomesticCupState[];
  /** Nation that won the World Cup in the offseason right after that season, or null (a qualifying year). */
  worldCupChampion: string | null;
  /**
   * Nations that won a confederation cup in that same offseason — the
   * Euro, Copa America and AFCON are all played at once, so this is a set
   * rather than one nation. Empty in the three offseasons of four that stage
   * none. Optional so an older caller that doesn't supply it simply scores no
   * confederation cup credit rather than failing to compile.
   */
  confederationCupChampions?: ReadonlySet<string>;
  /**
   * The Americas Cup played during that season. A club plays in at most one
   * continental competition, so this feeds the same cup term the Continental
   * Cup does, for clubs in the Americas. Optional: absent scores none.
   */
  americasCup?: CupState | null;
  /**
   * Override for AMERICAS_ACCOMPLISHMENT_SCALE, for the probe that sizes it.
   * Absent means the constant.
   */
  americasScale?: number;
}

interface Entry {
  player: Player;
  stats: SeasonStats;
  group: PositionGroup;
  /** The competition he played that season in (SeasonStats records the club, not the league). */
  compId: number;
  /** The ovr he actually played the season with — see awards.ts's ovrDuringSeason. */
  ovr: number;
  cupLine: CupStatLine | undefined;
  /** The continent his league is on, which decides the scale the world's awards score him at. */
  region: ContinentalRegion;
  /** Rating-unit correction for how strong his competition was — see leagueStrengthOffsets. */
  strength: number;
  /**
   * How far his competition's mean ovr sits above the world's, in raw ovr
   * points. `strength` is this times a rating-per-ovr slope; the trophy scale
   * uses it on its own scale, so the delta is kept rather than recovered by
   * dividing one back out.
   */
  ovrDelta: number;
}

/**
 * How much to add to (or subtract from) a player's rating-based score for the
 * competition he played in, keyed by compId.
 *
 * Match ratings are z-normalized *within* each competition, so every league's
 * average player rates ~6.0 no matter how good that league actually is. Left
 * uncorrected, a worldwide award would systematically favour the weakest
 * leagues, where a good player stands further above his peers. The correction
 * is each competition's mean ovr relative to the world's, converted into rating
 * units by WORLD_AWARD_LEAGUE_STRENGTH_WEIGHT.
 *
 * Ovr is the right yardstick here precisely because it is *not* normalized: it
 * is the one player number that means the same thing in every league.
 *
 * Returns the raw ovr delta per competition. The caller converts it to rating
 * units for the match-rating correction, and uses it unconverted for the
 * league-title and domestic-cup scale — two different scales off one measure of
 * how strong a league is, rather than two independent notions of it.
 */
function leagueStrengthOffsets(entries: Entry[]): Map<number, number> {
  const sums = new Map<number, { total: number; count: number }>();
  let worldTotal = 0;
  let worldCount = 0;
  for (const e of entries) {
    const bucket = sums.get(e.compId) ?? { total: 0, count: 0 };
    bucket.total += e.ovr;
    bucket.count++;
    sums.set(e.compId, bucket);
    worldTotal += e.ovr;
    worldCount++;
  }
  const worldMean = worldCount > 0 ? worldTotal / worldCount : 0;
  const deltas = new Map<number, number>();
  for (const [compId, bucket] of sums) {
    deltas.set(compId, bucket.total / bucket.count - worldMean);
  }
  return deltas;
}

/**
 * A player's Continental Cup contribution. Goals and assists use the same
 * position weights as the domestic award, scaled up by WORLD_AWARD_CUP_MULTIPLIER;
 * his cup rating and his club's run are pro-rated by how much of the campaign he
 * actually played, so a bit-part player doesn't collect a full winner's share.
 *
 * The rating term takes no league-strength correction: cup matches normalize
 * against the whole pooled field, so they're already on one scale.
 */
function cupComponent(
  e: Entry,
  roundsFromFinal: Map<number, number>,
  goalWeight: Record<PositionGroup, number>,
  assistWeight: Record<PositionGroup, number>,
  f: AwardFormula,
): number {
  const line = e.cupLine;
  if (!line || line.appearances === 0) return 0;
  const involvement = Math.min(1, line.appearances / WORLD_AWARD_CUP_FULL_INVOLVEMENT);
  let score =
    (line.goals * goalWeight[e.group] + line.assists * assistWeight[e.group]) * f.world.cupMultiplier;
  const avg = cupAvgRating(line);
  if (avg !== null) score += (avg - RATING_BASELINE) * f.world.cupRatingWeight * involvement;
  const rounds = roundsFromFinal.get(e.stats.tid);
  if (rounds !== undefined) score += (f.world.cupRunBonus[rounds] ?? 0) * involvement;
  return score;
}

/**
 * A player's international contribution: everything he played in the offseason
 * straight after this season (see core/international). Knockout football counts
 * for more than a qualifier — a World Cup goal is worth double a qualifying one
 * and a confederation cup goal one and a half times — and a winner's
 * medal is worth a flat bonus on top of that.
 *
 * **Every line for the season is summed, not just the first.** The offseason
 * that stages the confederation cups also plays a World Cup qualifying
 * leg, so a player can hold two lines for one season; taking the first would
 * silently drop whichever campaign happened to be appended second. (Before the
 * championships existed there was only ever one line, so this was a latent
 * problem rather than a live one.)
 *
 * Reads Player.intl.seasons, which only exists from the save where per-campaign
 * lines started being recorded; older saves simply score zero here rather than
 * guessing from career totals.
 */
function intlComponent(
  p: Player,
  season: number,
  worldCupChampion: string | null,
  confederationCupChampions: ReadonlySet<string>,
  f: AwardFormula,
): number {
  const w = f.world;
  const lines = p.intl?.seasons.filter((l) => l.season === season) ?? [];
  let score = 0;
  for (const line of lines) {
    const multiplier = line.kind === "tournament"
      ? w.worldCupMultiplier
      : line.kind === "confederation"
        ? w.confederationCupMultiplier
        : 1;
    score +=
      (line.goals * w.intlGoalWeight +
        line.assists * w.intlAssistWeight +
        line.caps * w.intlCapWeight) * multiplier;
    // A medal counts only for a player who actually featured, so a squad
    // member who never got on doesn't collect one.
    if (line.caps === 0) continue;
    if (line.kind === "tournament" && worldCupChampion !== null && p.nationality === worldCupChampion) {
      score += w.worldCupBonus;
    }
    if (line.kind === "confederation" && confederationCupChampions.has(p.nationality)) {
      score += w.confederationCupBonus;
    }
  }
  return score;
}

/** The confederation cup champions on a context, defaulting to none. */
const NO_CHAMPIONS: ReadonlySet<string> = new Set();

/**
 * The extra ovr weight the worldwide awards apply on top of the one already
 * baked into potyScore/totsScore — see WORLD_AWARD_OVR_WEIGHT for why it's a
 * separate constant rather than a bigger AWARD_OVR_WEIGHT.
 *
 * Uses the same AWARD_OVR_BASELINE, so it's a straight continuation of the same
 * line rather than a second, differently-shaped term.
 */
function worldOvrComponent(e: Entry, f: AwardFormula): number {
  return (e.ovr - AWARD_OVR_BASELINE) * f.world.ovrWeight;
}

/**
 * How much a trophy won *inside one league* is worth, scaled by how strong that
 * league is.
 *
 * Applies to the league title and the domestic cup and to nothing else, because
 * they are the only two league-relative trophies: every league crowns a
 * champion regardless of its standard, so without this an English title and a
 * Belgian one score identically. The Continental Cup and the international
 * campaign need no such scale — they are contested between leagues, so their
 * difficulty is already priced in.
 *
 * Clamped at both ends. The floor is what stops a tier-2 club's domestic cup
 * win, which is legitimate, from scoring negative and turning a trophy into a
 * penalty. See WORLD_AWARD_TROPHY_STRENGTH_WEIGHT.
 */
function trophyStrengthScale(e: Entry, f: AwardFormula): number {
  const raw = 1 + e.ovrDelta * f.world.trophyStrengthWeight;
  return Math.min(WORLD_AWARD_TROPHY_STRENGTH_CAP, Math.max(WORLD_AWARD_TROPHY_STRENGTH_FLOOR, raw));
}

/** Winning your own league, pro-rated by how much of the season you played and scaled by the league's strength. Tier-2 titles aren't in championTidByCompId, so they score nothing. */
function titleComponent(e: Entry, championTidByCompId: Record<number, number>, f: AwardFormula): number {
  if (championTidByCompId[e.compId] !== e.stats.tid) return 0;
  return f.world.leagueTitleBonus
    * Math.min(1, e.stats.appearances / WORLD_AWARD_TITLE_FULL_SEASON)
    * trophyStrengthScale(e, f);
}

/**
 * Winning your own domestic cup, pro-rated by ties played.
 *
 * A **team** term, like the league title above and unlike the Continental Cup
 * component: no domestic cup goals, assists or ratings enter the award. Those
 * ratings normalize within one country, so they carry exactly the weak-league
 * bias `leagueStrengthOffsets` exists to remove, and there is no equivalent
 * correction available for them. A flat squad bonus has no such bias.
 *
 * Pro-rated on domestic cup appearances rather than league ones, because the
 * question is what he did in *this* competition — a man who played every league
 * game and no cup ties didn't win it.
 *
 * Second-tier winners count. A tier-2 club really can win the thing, and unlike
 * a tier-2 league title (which `championTidByCompId` excludes by construction)
 * there is no weaker version of this trophy to confuse it with. It is scaled
 * down hard by `trophyStrengthScale` — a second division sits far below the
 * world mean — but the floor there keeps it a reduced reward rather than a
 * penalty.
 */
function domesticCupComponent(
  e: Entry,
  champions: ReadonlySet<number>,
  lines: Map<number, CupStatLine>,
  f: AwardFormula,
): number {
  if (!champions.has(e.stats.tid)) return 0;
  const appearances = lines.get(e.player.pid)?.appearances ?? 0;
  return f.world.domesticCupBonus
    * Math.min(1, appearances / WORLD_AWARD_DOMESTIC_CUP_FULL_INVOLVEMENT)
    * trophyStrengthScale(e, f);
}

/**
 * Everything a worldwide award needs beyond the player himself, gathered once
 * per season rather than threaded through every scoring function as six
 * separate parameters. Built at the top of computeWorldAwards; nothing in it
 * varies by player, or by which of the three awards is being scored.
 */
interface Scoring {
  season: number;
  ctx: WorldAwardContext;
  /** tid -> how many rounds from the Continental Cup final his club got. */
  roundsFromFinal: Map<number, number>;
  /** The tids that won their domestic cup that season. */
  domesticChampions: ReadonlySet<number>;
  /** pid -> his domestic cup line, for pro-rating the winner's bonus by ties played. */
  domesticLines: Map<number, CupStatLine>;
  /**
   * What a player's whole case is multiplied by: 1, or
   * AMERICAS_ACCOMPLISHMENT_SCALE for a player at a club in the Americas when
   * the world's awards are scored. The Americas' own awards score everyone at 1.
   */
  scale: (e: Entry) => number;
  /** The save's award weights (God Mode can edit them); the shipped ones by default. */
  formula: AwardFormula;
}

/**
 * One award case: a base domestic score plus the cross-competition credit every
 * worldwide award shares.
 *
 * The *only* thing that differs between the three awards is what `base` is and
 * which weight columns his cup end product is priced with — the Ballon d'Or
 * passes `potyScore` and the POTY weights, the two position awards pass
 * `totsScore` and the TOTS weights. Everything after that (league strength, the
 * extra ovr term, the Continental Cup, the international campaign, a league
 * title, a domestic cup) is identical by construction, which is what stops the
 * awards drifting apart as any one of those terms is retuned.
 */
function worldAwardParts(
  e: Entry,
  s: Scoring,
  base: number,
  goalWeight: Record<PositionGroup, number>,
  assistWeight: Record<PositionGroup, number>,
): WorldAwardEntry {
  // The ovr terms fold into `league` rather than becoming a fifth part: the UI
  // already labels that column as including an ovr term, and adding a field
  // would break WorldAwards entries already persisted on old saves.
  // Every part takes the same scale, so the breakdown still adds up to the score
  // and an Americas case is discounted whole rather than piece by piece.
  const f = s.formula;
  const k = s.scale(e);
  const league = (base + e.strength + worldOvrComponent(e, f)) * k;
  const cup = cupComponent(e, s.roundsFromFinal, goalWeight, assistWeight, f) * k;
  const intl = intlComponent(
    e.player, s.season, s.ctx.worldCupChampion, s.ctx.confederationCupChampions ?? NO_CHAMPIONS, f,
  ) * k;
  const title = titleComponent(e, s.ctx.championTidByCompId, f) * k;
  const domesticCup = domesticCupComponent(e, s.domesticChampions, s.domesticLines, f) * k;
  // Display only: nothing ranks on these, so the score above is untouched.
  // `quality` is taken as the remainder so the parts always add back to `league`.
  const rating = e.stats.avgRating * f.ratingWeight;
  const scoring = e.stats.goals * f.goalWeight[e.group] + e.stats.assists * f.assistWeight[e.group];
  const work = base - potyScore(e.player, e.stats, s.season, f);
  const breakdown: WorldAwardBreakdown = {
    rating: rating * k,
    scoring: scoring * k,
    work: work * k,
    quality: league - (rating + scoring + work) * k,
  };
  return {
    pid: e.player.pid, tid: e.stats.tid,
    score: league + cup + intl + title + domesticCup,
    league, cup, intl, title, domesticCup,
    breakdown,
  };
}

/**
 * The Ballon d'Or score: a POTY-style domestic season on a worldwide scale,
 * plus the cross-league competitions the domestic award can't see.
 *
 * `potyScore` carries no defensive statistics of any kind, which is not an
 * oversight to be patched here but the reason goalkeepers and defenders have
 * awards of their own — see the block above WORLD_POSITION_AWARD_SHORTLIST in
 * constants.ts.
 */
function ballonDOrParts(e: Entry, s: Scoring): WorldAwardEntry {
  const f = s.formula;
  return worldAwardParts(
    e, s, potyScore(e.player, e.stats, s.season, f), f.goalWeight, f.assistWeight,
  );
}

/**
 * The defensive-aware score, built on the Team-of-the-Season formula, which
 * does credit tackles, interceptions, saves and goals conceded.
 *
 * Picks the World Team of the Year's slots *and* decides the Goalkeeper of the
 * Year and Defender of the Year, deliberately off one number, so the trophy and
 * the XI can never disagree about who the best keeper in the world was. The
 * trophy multiplier is applied inside here rather than at those call sites for
 * exactly that reason — see WORLD_TOTS_TROPHY_MULTIPLIER's history note.
 */
function worldTotsParts(e: Entry, s: Scoring): WorldAwardEntry {
  // Cup end product is priced with the Player of the Season columns, the same
  // ones `totsScore` now uses for his league goals and assists.
  const f = s.formula;
  const base = worldAwardParts(
    e, s, totsScore(e.player, e.stats, s.season, f), f.goalWeight, f.assistWeight,
  );
  // Everything beyond his own league season is scaled by
  // WORLD_TOTS_TROPHY_MULTIPLIER (now 1, i.e. the Ballon d'Or's own weighting;
  // see its history note). It is applied HERE, at the shared base, precisely so
  // all three awards built on it stay in agreement about the same player.
  const m = f.world.positionAwardTrophyMultiplier;
  const cup = base.cup * m;
  const intl = base.intl * m;
  const title = base.title * m;
  const domesticCup = (base.domesticCup ?? 0) * m;
  return {
    ...base,
    cup, intl, title, domesticCup,
    score: base.league + cup + intl + title + domesticCup,
  };
}

/**
 * The best player in the world at one position group, and the rest of his
 * shortlist.
 *
 * Reads the `worldTotsParts` already computed for every player to pick the
 * World XI, so an award costs a filter and a sort rather than a second scoring
 * pass over the whole world — and, more importantly, so the award and the XI
 * cannot disagree about the same player.
 *
 * **Only ever compares a group against itself, and that is a correctness
 * requirement rather than a scoping choice.** `totsScore` prices a defender's
 * tackle at 0.03 against a forward's 0.01, on a statistic defenders collect in
 * vastly greater volume, so its scores are commensurable *within* a position
 * group and meaningless across one — the same property that makes the Team of
 * the Season pick into fixed positional slots (see TOTS_SLOTS, which has the
 * measurements behind it).
 *
 * The appearance bar falls back exactly like the Ballon d'Or's: if no keeper in
 * the world played a full season's worth of games, the award goes to the best
 * of whoever did play rather than going vacant.
 */
function positionAward(
  entries: Entry[],
  group: PositionGroup,
  parts: Map<number, WorldAwardEntry>,
  minAppearances: number,
): WorldAwardEntry[] {
  const inGroup = entries.filter((e) => e.group === group);
  const qualified = inGroup.filter((e) => e.stats.appearances >= minAppearances);
  const pool = qualified.length > 0 ? qualified : inGroup;
  return pool
    .map((e) => ({ entry: e, parts: parts.get(e.player.pid)! }))
    // Ties break on average match rating, then pid — deliberately NOT the
    // Ballon d'Or's goals-plus-assists, which is the wrong yardstick for an
    // award a goalkeeper can win and would separate two level centre-backs by
    // which of them got on the end of more corners.
    .sort((a, b) => {
      if (b.parts.score !== a.parts.score) return b.parts.score - a.parts.score;
      if (b.entry.stats.avgRating !== a.entry.stats.avgRating) {
        return b.entry.stats.avgRating - a.entry.stats.avgRating;
      }
      return a.parts.pid - b.parts.pid;
    })
    .slice(0, WORLD_POSITION_AWARD_SHORTLIST)
    .map((x) => x.parts);
}

function pickWorldTeam(
  entries: Entry[],
  parts: Map<number, WorldAwardEntry>,
  minAppearances: number,
): (number | null)[] {
  const used = new Set<number>();
  return TOTS_SLOTS.map((slotPos) => {
    let best: Entry | null = null;
    let bestScore = 0;
    for (const e of entries) {
      if (e.player.pos !== slotPos || used.has(e.player.pid)) continue;
      // Qualified players always outrank unqualified ones, so a thin position
      // still fills its slot rather than going empty (same rule as the
      // per-competition Team of the Season).
      const score =
        (e.stats.appearances >= minAppearances ? 1000 : 0) + parts.get(e.player.pid)!.score;
      if (best === null || score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (best === null) return null;
    used.add(best.player.pid);
    return best.player.pid;
  });
}

/**
 * Compute a completed season's worldwide honors — the Ballon d'Or ranking, the
 * World Team of the Year, and the Goalkeeper and Defender of the Year — from
 * every player in the world who featured that season, however many competitions
 * they're spread across.
 *
 * Pure and re-runnable, exactly like computeSeasonAwards: it reads only
 * append-only records (Player.stats / Player.hist / Player.intl.seasons) plus a
 * context of things already snapshotted per season, so it can be run for any
 * past season — used both by simOffseason (fresh) and migrateLeague (backfill).
 * No rng of any kind.
 *
 * `formula` is the save's award formula (God Mode can edit it); omitted, the
 * shipped weights apply and every score is exactly what it was before the
 * formula became editable.
 */
export function computeWorldAwards(
  players: Player[],
  season: number,
  ctx: WorldAwardContext,
  formula: AwardFormula = DEFAULT_AWARD_FORMULA,
): WorldAwards {
  // Both continental competitions feed the one cup term: a club enters at most
  // one of them, so a player's line and his club's run come from whichever his
  // club played. The Continental Cup is read last, so a player who somehow
  // appeared in both after a mid-season move keeps its line.
  const cupLines = new Map<number, CupStatLine>();
  const roundsFromFinal = new Map<number, number>();
  for (const cup of [ctx.americasCup ?? null, ctx.cup]) {
    if (!cup) continue;
    for (const [pid, line] of cupStatsByPid(cup)) cupLines.set(pid, line);
    for (const [tid, rounds] of cupRoundsFromFinal(cup)) roundsFromFinal.set(tid, rounds);
  }
  const regionByCompId = new Map(ctx.competitions.map((c) => [c.id, competitionRegion(c)]));
  // Domestic cups: who won each country's, and how many ties each player made.
  // Both empty on a save whose past seasons predate domestic cups, which scores
  // exactly as it did before the competition existed.
  const domesticCups = ctx.domesticCups ?? [];
  const domesticChampions = new Set<number>(
    domesticCups.map((c) => c.championTid).filter((tid): tid is number => tid !== null),
  );
  const domesticLines = domesticStatsByPid(domesticCups);

  const entries: Entry[] = [];
  for (const player of players) {
    const stats = statsFor(player, season);
    if (!stats || stats.appearances === 0) continue;
    const compId = ctx.compsByTid[stats.tid];
    // A club with no competition recorded for that season (a tid that no longer
    // exists, or history from before compsByTid was snapshotted) can't be placed
    // on the world scale, so it sits out rather than being scored uncorrected.
    if (compId === undefined) continue;
    entries.push({
      player,
      stats,
      group: positionGroup(player.pos),
      compId,
      ovr: ovrDuringSeason(player, season),
      cupLine: cupLines.get(player.pid),
      region: regionByCompId.get(compId) ?? "europe",
      strength: 0,
      ovrDelta: 0,
    });
  }
  if (entries.length === 0) {
    return {
      ballonDOr: [],
      worldTeamOfYear: TOTS_SLOTS.map(() => null),
      goalkeeperOfYear: [],
      defenderOfYear: [],
    };
  }

  const shared = { season, ctx, roundsFromFinal, domesticChampions, domesticLines, formula };
  const americasScale = ctx.americasScale ?? AMERICAS_ACCOMPLISHMENT_SCALE;

  // The world's awards: every league at once, a case made in the Americas at a
  // discount.
  const world = rankHonours(entries, {
    ...shared,
    scale: (e) => (e.region === "americas" ? americasScale : 1),
  });

  // The Americas' own: its leagues alone, measured against each other, so the
  // league-strength correction is recomputed over that pool and nobody is
  // discounted. Copies, because ranking writes each entry's strength.
  const americasPool = entries.filter((e) => e.region === "americas").map((e) => ({ ...e }));
  if (americasPool.length === 0) return world;
  return { ...world, americas: rankHonours(americasPool, { ...shared, scale: () => 1 }) };
}

/**
 * One set of honours over one pool of players: the player of the year and his
 * shortlist, the team of the year, and the two position awards.
 *
 * The world's awards run it over every player in the world and the Americas'
 * over that continent's alone. The league-strength correction is computed over
 * whatever pool it is handed, so each set measures its leagues against its own
 * average.
 */
function rankHonours(entries: Entry[], scoring: Scoring): ContinentalAwards {
  const formula = scoring.formula;
  const deltas = leagueStrengthOffsets(entries);
  for (const e of entries) {
    e.ovrDelta = deltas.get(e.compId) ?? 0;
    e.strength = e.ovrDelta * formula.world.leagueStrengthWeight;
  }
  const minAppearances = formula.minAppearances;

  // Ballon d'Or: a full season's worth of appearances is the bar, but if a world
  // is small or short enough that nobody clears it, everyone who played is
  // considered rather than leaving the award vacant.
  const qualified = entries.filter((e) => e.stats.appearances >= minAppearances);
  const pool = qualified.length > 0 ? qualified : entries;
  const ranked = pool
    .map((e) => ({ entry: e, parts: ballonDOrParts(e, scoring) }))
    // Ties break on end product, then pid — the same order the per-competition
    // Player of the Season uses, so both awards resolve a dead heat identically.
    .sort((a, b) => {
      if (b.parts.score !== a.parts.score) return b.parts.score - a.parts.score;
      const ga = b.entry.stats.goals + b.entry.stats.assists
        - (a.entry.stats.goals + a.entry.stats.assists);
      return ga !== 0 ? ga : a.parts.pid - b.parts.pid;
    })
    .slice(0, BALLON_DOR_SHORTLIST)
    .map((x) => x.parts);

  // One defensive-aware pass over the world, feeding three awards: the World
  // XI's eleven slots and the two position trophies. Scoring them off the same
  // map is what guarantees the Goalkeeper of the Year is the XI's keeper.
  const totsParts = new Map<number, WorldAwardEntry>();
  for (const e of entries) totsParts.set(e.player.pid, worldTotsParts(e, scoring));

  return {
    ballonDOr: ranked,
    worldTeamOfYear: pickWorldTeam(entries, totsParts, minAppearances),
    goalkeeperOfYear: positionAward(entries, "GK", totsParts, minAppearances),
    defenderOfYear: positionAward(entries, "DEF", totsParts, minAppearances),
  };
}
