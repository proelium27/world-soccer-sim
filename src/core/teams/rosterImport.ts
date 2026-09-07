import type { LeagueStore } from "../leagueState.js";
import { assignAIFormations, type StoredTeam } from "./clubs.js";
import type { Player, PlayerRatings, Position } from "../players/types.js";
import { SKILL_KEYS, POSITIONS } from "../players/types.js";
import type { RosterFile, RosterFilePlayer } from "./rosterFile.js";
import { resolveRosterSlots } from "./rosterFile.js";
import { applyTeamIdentities } from "./customize.js";
import { generatePlayer } from "../players/generate.js";
import { computeOvr } from "../players/ovr.js";
import { estimatePotential } from "../players/progression.js";
import { seasonSalaryForOvr } from "../contracts.js";
import { competitionOf, competitionNationalities } from "../competitions.js";
import type { NationalityWeights } from "../players/nationalities.js";
import { reconcileScoutingObserved } from "../scouting/potentialFog.js";
import { computeTeamRating } from "./teamRating.js";
import { mulberry32, hashInts } from "../../engine/rng.js";
import { emptyCareerSummary } from "../players/careerSummary.js";
import {
  LEAGUE_BASE, RATING_MIN, RATING_MAX, ROSTER_COMPOSITION,
  INITIAL_AGE_MIN, INITIAL_AGE_MAX, CONTRACT_LENGTH_MIN, CONTRACT_LENGTH_MAX,
} from "../constants.js";

/**
 * How far below a club's own generation-strength anchor (academyBase) the
 * auto-generated filler that tops a real squad up to a legal shape is
 * generated — so filler reads as clearly sub-first-team reserve cover, never
 * competing with the imported real players.
 */
const FILLER_BASE_OFFSET = 12;

const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));

/**
 * Find a uniform shift of a position-shaped rating set that makes computeOvr
 * land on `target`. computeOvr is monotonic non-decreasing under a uniform
 * shift (clamping preserves monotonicity), so a binary search on the shift
 * converges to the exact integer overall (give or take 1 at the clamp
 * extremes, where a 99-target player is already maxed out).
 */
function shiftRatingsToOverall(
  pos: Position,
  shape: PlayerRatings,
  heightCm: number,
  target: number,
): PlayerRatings {
  const want = clampInt(target, RATING_MIN, RATING_MAX);
  const shifted = (s: number): PlayerRatings =>
    Object.fromEntries(
      SKILL_KEYS.map((k) => [k, clampInt(shape[k] + s, RATING_MIN, RATING_MAX)]),
    ) as PlayerRatings;
  let lo = -RATING_MAX;
  let hi = RATING_MAX;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (computeOvr(pos, shifted(mid), heightCm) < want) lo = mid;
    else hi = mid;
  }
  return shifted(hi);
}

function clampRatings(r: PlayerRatings): PlayerRatings {
  return Object.fromEntries(
    SKILL_KEYS.map((k) => [k, clampInt(r[k], RATING_MIN, RATING_MAX)]),
  ) as PlayerRatings;
}

interface MaterializeCtx {
  pid: number;
  season: number;
  rng: () => number;
  genSeed: number;
  country: string;
  /**
   * The target league's own nationality mix, used for the players the file
   * did NOT name a nationality for and for auto-generated filler. Imported
   * players who carry one keep it, so a file with real nationalities is
   * unaffected either way.
   */
  nationalities: NationalityWeights | null;
}

/** Turn one authored player spec into a full engine Player. */
function materializePlayer(spec: RosterFilePlayer, ctx: MaterializeCtx): Player {
  const age = clampInt(spec.age, INITIAL_AGE_MIN - 3, INITIAL_AGE_MAX + 6);
  // Archetype provides a position-appropriate rating shape, a default height,
  // and a country-appropriate default nationality — all overridable below.
  const archetype = generatePlayer(
    ctx.rng, spec.pos, LEAGUE_BASE, ctx.pid, age, ctx.season, ctx.genSeed,
    ctx.country, ctx.nationalities,
  );
  const heightCm = spec.heightCm != null ? clampInt(spec.heightCm, 150, 220) : archetype.heightCm;

  const ratings = spec.ratings
    ? clampRatings(spec.ratings)
    : shiftRatingsToOverall(spec.pos, archetype.ratings, heightCm, spec.overall ?? 50);

  const ovr = computeOvr(spec.pos, ratings, heightCm);
  const potential =
    spec.potential != null
      ? clampInt(spec.potential, ovr, RATING_MAX)
      : estimatePotential(ctx.rng, ratings, ovr, age, spec.pos, heightCm, ctx.pid);
  const length = CONTRACT_LENGTH_MIN + Math.floor(ctx.rng() * (CONTRACT_LENGTH_MAX - CONTRACT_LENGTH_MIN + 1));

  return {
    pid: ctx.pid,
    name: spec.name.trim(),
    nationality: spec.nationality?.trim() || archetype.nationality,
    born: ctx.season - age,
    pos: spec.pos,
    heightCm,
    ratings,
    ovr,
    potential,
    contract: { salary: seasonSalaryForOvr(ovr, ctx.pid, ctx.season), expiresSeason: ctx.season + length },
    injury: null,
    stats: [],
    hist: [{ season: ctx.season - 1, ratings, ovr, potential, academy: false, pos: spec.pos }],
    // Set alongside `hist`, never left to the first progression. `peakOvr` is
    // authoritative once present, so a player carrying a history and a stale
    // peak would read as worse than he ever was — and the fallback that would
    // have caught it disappears when `hist` stops being resident
    // (docs/lazy-career-plan.md).
    peakOvr: ovr,
    peakOvrSeason: ctx.season - 1,
    career: emptyCareerSummary(),
  };
}

/** Auto-generated reserve cover to fill a hole the imported squad left. */
function makeFiller(pos: Position, base: number, ctx: MaterializeCtx): Player {
  const age = INITIAL_AGE_MIN + Math.floor(ctx.rng() * (INITIAL_AGE_MAX - INITIAL_AGE_MIN + 1));
  const p = generatePlayer(
    ctx.rng, pos, base, ctx.pid, age, ctx.season, ctx.genSeed, ctx.country, ctx.nationalities,
  );
  const length = CONTRACT_LENGTH_MIN + Math.floor(ctx.rng() * (CONTRACT_LENGTH_MAX - CONTRACT_LENGTH_MIN + 1));
  p.contract.expiresSeason = ctx.season + length;
  return p;
}

/**
 * Build a club's replacement squad from its imported players, topping up each
 * under-filled position with filler so the result is always a legal,
 * sub-capable squad (every position at least its ROSTER_COMPOSITION count).
 * Provided extras beyond a position's target are kept, never trimmed.
 */
function materializeSquad(
  specs: RosterFilePlayer[],
  team: StoredTeam,
  season: number,
  startPid: number,
  competitionCountry: string,
  competitionNats: NationalityWeights | null,
): { players: Player[]; nextPid: number } {
  const rng = mulberry32(hashInts(team.tid, season, startPid, 0x5c0));
  const genSeed = hashInts(team.tid, season, 0xf1);
  let pid = startPid;
  const mkCtx = (): MaterializeCtx => ({
    pid, season, rng, genSeed, country: competitionCountry, nationalities: competitionNats,
  });

  const real = specs.map((spec) => {
    const p = materializePlayer(spec, mkCtx());
    pid++;
    return p;
  });

  const have: Record<string, number> = {};
  for (const p of real) have[p.pos] = (have[p.pos] ?? 0) + 1;

  const fillerBase = Math.max(RATING_MIN + 5, team.academyBase - FILLER_BASE_OFFSET);
  const filler: Player[] = [];
  for (const pos of POSITIONS as readonly Position[]) {
    const need = Math.max(0, ROSTER_COMPOSITION[pos] - (have[pos] ?? 0));
    for (let i = 0; i < need; i++) {
      const p = makeFiller(pos, fillerBase, mkCtx());
      pid++;
      filler.push(p);
    }
  }

  return { players: [...real, ...filler], nextPid: pid };
}

/**
 * Give the strongest imported squad the strongest youth anchor available to it.
 *
 * Every club carries an `academyBase`, a strength anchor fixed at generation
 * that drives its youth intake for the life of the save. It exists to stop the
 * inflation ratchet: intake anchors to it rather than to the club's current
 * roster, so a good squad can't bootstrap itself into a better one. Generation
 * *shuffles* those anchors across a competition's slots, so slot order carries
 * no information about slot strength — and import overwrites a slot's identity
 * and squad but not its anchor. A superclub could therefore land on a slot
 * anchored well below the league's best and drift down over a long dynasty,
 * producing youth intakes that made no sense for who it was.
 *
 * The fix is a permutation, not a recalculation, and the distinction is the
 * whole safety argument: the competition's existing multiset of anchors is
 * reassigned among the same clubs, once, at import. Nothing is derived from the
 * imported ratings, so the total stays exactly what generation produced and the
 * anti-inflation equilibrium is untouched — this cannot ratchet, because there
 * is no new value to ratchet with.
 *
 * Only clubs whose squad was actually replaced take part. A club the file left
 * alone keeps both its players and its anchor, so a partial import can't
 * degrade the clubs it didn't touch — which also means an imported club can
 * only claim an anchor already held by another imported club, never the best in
 * the division if an untouched club holds it.
 */
function realignAcademyBases(
  teams: StoredTeam[],
  players: Player[],
  replacedTids: number[],
): void {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const byTid = new Map(teams.map((t) => [t.tid, t]));

  const byComp = new Map<number, StoredTeam[]>();
  for (const tid of replacedTids) {
    const team = byTid.get(tid);
    if (!team) continue;
    byComp.set(team.compId, [...(byComp.get(team.compId) ?? []), team]);
  }

  for (const group of byComp.values()) {
    if (group.length < 2) continue; // nothing to swap with
    const anchors = group.map((t) => t.academyBase).sort((a, b) => b - a);
    const strengthOf = (t: StoredTeam): number => {
      const roster = t.roster
        .map((pid) => byPid.get(pid))
        .filter((p): p is Player => p !== undefined);
      // starters=null: the imported squad has no saved XI, so let it auto-pick.
      return computeTeamRating(roster, null).ovr;
    };
    const strength = new Map(group.map((t) => [t.tid, strengthOf(t)]));
    // tid breaks ties so the result is deterministic, same as everything else here.
    const ranked = [...group].sort(
      (a, b) => strength.get(b.tid)! - strength.get(a.tid)! || a.tid - b.tid,
    );
    ranked.forEach((team, i) => {
      team.academyBase = anchors[i];
    });
  }
}

export interface RosterFileApplyResult {
  league: LeagueStore;
  warnings: string[];
  /** Clubs whose identity was changed. */
  clubsRenamed: number;
  /** Clubs whose squad was replaced with imported players. */
  squadsReplaced: number;
  /** Imported + filler players added. */
  playersAdded: number;
}

/**
 * Apply a parsed roster file to a save: overlay club identities everywhere, and
 * for each club that supplied `players`, replace its senior squad with the
 * imported players (topped up with filler). Pure — returns a new LeagueStore.
 *
 * Replaced players are removed from the club's roster. Those who never played
 * (no recorded season stats — the normal case when importing onto a fresh save)
 * are dropped from the player pool entirely so it doesn't accumulate orphans;
 * any replaced player who *does* have history is kept as a free agent so his
 * record survives. The club's saved starting XI is cleared (the old XI's pids
 * are gone) and stale scouting/transfer-list references are pruned.
 */
export function applyRosterFile(league: LeagueStore, file: RosterFile): RosterFileApplyResult {
  const { slots, warnings } = resolveRosterSlots(league, file);

  const withIdentities = applyTeamIdentities(
    league,
    slots.map(({ tid, club }) => ({ tid, name: club.name, abbrev: club.abbrev, colors: club.colors })),
  );

  // Every slot the file named is flagged so the UI stops drawing the built-in
  // crest for it: that art is keyed by tid (a slot), so once a slot becomes a
  // real club the badge belongs to somebody else entirely. Flagged on rename,
  // not on squad replacement — an identity-only entry is exactly the case where
  // the name changed and the crest went stale.
  const renamedTids = new Set(slots.map((s) => s.tid));
  const teams = withIdentities.teams.map((t) =>
    renamedTids.has(t.tid) ? { ...t, importedIdentity: true } : { ...t },
  );
  const teamByTid = new Map(teams.map((t) => [t.tid, t]));
  let players = [...withIdentities.players];
  // Take the stored monotonic cursor, not max(pid) + 1. Players get removed
  // (retirement deletes them outright, and so does the free-agent cull) WITHOUT
  // their transfers/newsEvents/cup lines being scrubbed in retirement's case, so
  // a derived cursor can reissue a removed player's pid to an imported player who
  // then inherits that history. See LeagueStore.nextPid.
  let nextPid = Math.max(
    Number.isFinite(withIdentities.nextPid) ? withIdentities.nextPid : 0,
    players.reduce((m, p) => Math.max(m, p.pid), -1) + 1,
  );
  const season = withIdentities.season;

  const removedPids = new Set<number>();
  const replacedTids: number[] = [];
  let squadsReplaced = 0;
  let playersAdded = 0;

  for (const { tid, club } of slots) {
    if (!club.players || club.players.length === 0) continue;
    const team = teamByTid.get(tid);
    if (!team) continue;
    const comp = competitionOf(withIdentities.competitions, team.compId);

    const built = materializeSquad(
      club.players, team, season, nextPid, comp.country, competitionNationalities(comp),
    );
    nextPid = built.nextPid;

    for (const pid of team.roster) removedPids.add(pid);
    team.roster = built.players.map((p) => p.pid);
    team.starters = null; // old XI's pids are gone
    team.transferListed = team.transferListed.filter((pid) => !removedPids.has(pid));
    if (team.scoutingObserved && Object.keys(team.scoutingObserved).length > 0) {
      team.scoutingObserved = Object.fromEntries(
        Object.entries(team.scoutingObserved).filter(([pid]) => !removedPids.has(Number(pid))),
      );
    }

    players.push(...built.players);
    playersAdded += built.players.length;
    replacedTids.push(tid);
    squadsReplaced++;
  }

  if (removedPids.size > 0) {
    // Keep replaced players who actually have history (as free agents); drop
    // the rest so a fresh-save import doesn't leave hundreds of orphans.
    players = players.filter((p) => !removedPids.has(p.pid) || p.stats.length > 0);
  }

  // After the pool is final, so squad strength is measured on who actually
  // ended up on each roster.
  realignAcademyBases(teams, players, replacedTids);

  return {
    league: { ...withIdentities, teams, players, nextPid },
    warnings,
    clubsRenamed: slots.length,
    squadsReplaced,
    playersAdded,
  };
}

/**
 * Apply a roster file to a league that was generated a moment ago and hasn't
 * been saved or played yet — the "Import Custom League" path.
 *
 * The two extra steps are the reason this exists rather than callers using
 * applyRosterFile directly. createLeagueState does two things that read a
 * club's squad, and both were done against the *generated* players that the
 * import then throws away:
 *
 *  - every AI club is put in the formation that fields its strongest XI, which
 *    is meaningless once its squad is eleven different people;
 *  - the user's roster is stamped as first-observed in season 1 so scouting's
 *    potential fog clears normally, and applyRosterFile prunes those stamps
 *    with the players they pointed at, leaving the imported squad unstamped.
 *
 * Both are cheap pure recomputations, so redo them against the squad that
 * actually exists. Safe only on a fresh league: re-stamping scouting resets
 * every player's observation date to season 1, which on a save in progress
 * would hand the user a fully-scouted squad.
 */
export function applyRosterFileToNewLeague(
  league: LeagueStore,
  file: RosterFile,
  userTid: number,
): RosterFileApplyResult {
  const applied = applyRosterFile(league, file);
  const teams = assignAIFormations(applied.league.teams, applied.league.players, userTid);
  const userTeam = teams.find((t) => t.tid === userTid);
  if (userTeam) {
    userTeam.scoutingObserved = reconcileScoutingObserved({}, userTeam.roster, league.season);
  }
  return { ...applied, league: { ...applied.league, teams } };
}
