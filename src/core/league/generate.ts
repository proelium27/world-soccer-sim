import type { Player, Position } from "../players/types.js";
import type { FormationId } from "../lineup/formations.js";
import { POSITIONS } from "../players/types.js";
import { generatePlayer, drawGenerationAge } from "../players/generate.js";
import { hashInts } from "../../engine/rng.js";
import type { Competition } from "../competitions.js";
import {
  worldCompetitions, countryDivisions, competitionStrengthOffset, competitionAcademyOffset,
  competitionTeamCount, competitionNationalities,
} from "../competitions.js";
import type { NationalityWeights } from "../players/nationalities.js";
import {
  NUM_TEAMS, NUM_TEAMS_D2, LEAGUE_BASE, TEAM_STRENGTH_SPREAD, DIVISION_2_OFFSET,
  divisionStrengthOffset,
  ROSTER_COMPOSITION,
  CONTRACT_LENGTH_MIN, CONTRACT_LENGTH_MAX, type ProgressionModel,
} from "../constants.js";

const STARTING_SEASON = 1;

export interface LeagueTeam {
  tid: number;
  name: string;
  roster: number[]; // pids
  avgOvr: number;
  /**
   * Fixed generation-time strength base (LEAGUE_BASE + this team's strength
   * target, offset by DIVISION_2_OFFSET for Division 2), carried forward as
   * the permanent anchor for youth intake. Deliberately never derived from
   * the team's *current* roster average — see the long-form comment history
   * in CLAUDE.md's M4 section for why that ratchets OVR upward without bound.
   */
  academyBase: number;
  /** Which competition this team belongs to at generation time (see src/core/competitions.ts). */
  compId: number;
  /**
   * User-chosen starting XI (11 pids), or null/undefined to auto-select via
   * selectXI. Not set during generation; simThrough carries it over from
   * StoredTeam.starters so leagueMatchData can respect it.
   */
  starters?: number[] | null;
  /**
   * The club's formation, carried over from StoredTeam.formation by simThrough
   * so leagueMatchData picks the XI in the right shape. Undefined during
   * generation and for any team that hasn't chosen one (defaults to 4-3-3).
   */
  formation?: FormationId;
  /**
   * Pids the user has flagged for more minutes (StoredTeam.moreMinutes), carried
   * over by simThrough so leagueMatchData can bias the in-match sub logic toward
   * bringing them on. Only ever set for the user's own team.
   */
  moreMinutes?: number[];
}

export interface League {
  teams: LeagueTeam[];
  players: Player[];
}

/**
 * Generate `count` teams' worth of rosters, tid range [tidStart, tidStart+count),
 * evenly-spaced strength targets across [-TEAM_STRENGTH_SPREAD, +TEAM_STRENGTH_SPREAD]
 * minus `strengthOffset`, shuffled (Fisher-Yates) so the strong-to-weak
 * gradient isn't tied to tid/club order within this division, tagged with
 * `division`. Shared by generateLeague (Division 1: tidStart=0, offset=0)
 * and generateTwoDivisionLeague's Division 2 half (tidStart=NUM_TEAMS,
 * offset=DIVISION_2_OFFSET).
 *
 * `academyOffset` is the same quantity for the club's permanent youth-intake
 * anchor, and it is a SEPARATE parameter because the two answer different
 * questions: how strong this division is right now, versus what its clubs keep
 * regenerating toward. Pass the same value for both — which every shipped
 * league does — and behaviour is exactly as it was when one number did both
 * jobs; pass a weaker academy offset and the division declines over a dynasty,
 * a stronger one and it rises.
 *
 * The strength spread is drawn and shuffled ONCE and both bases are derived
 * from it, so the two anchors always describe the same club ordering. The
 * shuffle is the only rng use here, so the stream is consumed identically
 * however the offsets are set.
 */
function generateDivisionTeams(
  rng: () => number,
  tidStart: number,
  count: number,
  strengthOffset: number,
  academyOffset: number,
  compId: number,
  genSeed: number,
  pidStart: number,
  country: string,
  nationalities: NationalityWeights | null = null,
  model: ProgressionModel = "random",
): { teams: LeagueTeam[]; players: Player[]; nextPid: number } {
  const teams: LeagueTeam[] = [];
  const players: Player[] = [];
  let pid = pidStart;

  // Evenly spaced strength targets, then shuffled so the strong-to-weak
  // gradient isn't tied to tid/club order within this division.
  const targets: number[] = [];
  for (let i = 0; i < count; i++) {
    const frac = count > 1 ? i / (count - 1) : 0; // 0..1
    targets.push(TEAM_STRENGTH_SPREAD - frac * (2 * TEAM_STRENGTH_SPREAD));
  }
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [targets[i], targets[j]] = [targets[j], targets[i]];
  }

  for (let i = 0; i < count; i++) {
    const tid = tidStart + i;
    const base = LEAGUE_BASE + targets[i] - strengthOffset;
    // The permanent youth anchor. Never derived from the roster this loop is
    // about to build (that ratchets OVR upward without bound — see CLAUDE.md's
    // anti-inflation notes); it is this division's own fixed band, which is
    // exactly why it is safe to let a player set it.
    const academyBase = LEAGUE_BASE + targets[i] - academyOffset;

    const roster: number[] = [];
    let ovrSum = 0;
    for (const pos of POSITIONS as readonly Position[]) {
      for (let j = 0; j < ROSTER_COMPOSITION[pos]; j++) {
        // One rng draw, exactly as the uniform draw it replaces — see AGE_CDF.
        const age = drawGenerationAge(rng());
        const p = generatePlayer(
          rng, pos, base, pid++, age,
          STARTING_SEASON, genSeed, country, nationalities, model, true,
        );
        const length = CONTRACT_LENGTH_MIN
          + Math.floor(rng() * (CONTRACT_LENGTH_MAX - CONTRACT_LENGTH_MIN + 1));
        p.contract.expiresSeason = STARTING_SEASON + length;
        players.push(p);
        roster.push(p.pid);
        ovrSum += p.ovr;
      }
    }
    teams.push({
      tid,
      name: `Team ${tid + 1}`,
      roster,
      avgOvr: ovrSum / roster.length,
      academyBase,
      compId,
    });
  }

  return { teams, players, nextPid: pid };
}

/**
 * Hybrid talent model: each team gets a strength target evenly spaced across
 * [-SPREAD, +SPREAD]; every player is generated around base = LEAGUE_BASE +
 * target, biased by position archetype. Deterministic given the RNG.
 * Produces exactly NUM_TEAMS Division-1 teams — unchanged behavior from
 * before this file supported a second division.
 */
export function generateLeague(rng: () => number, seed = 0): League {
  const genSeed = hashInts(seed, 1);
  const { teams, players } = generateDivisionTeams(rng, 0, NUM_TEAMS, 0, 0, 0, genSeed, 0, "England");
  return { teams, players };
}

/**
 * Generate both divisions in one pass, sharing one rng stream (Division 1
 * first, then Division 2, so a given seed's Division-1 half is byte-for-byte
 * identical to a plain generateLeague call with the same seed). Division 2's
 * strength targets are shifted down by DIVISION_2_OFFSET so its strongest
 * teams land around Division 1's mid-table strength.
 */
export function generateTwoDivisionLeague(rng: () => number, seed = 0): League {
  const genSeed = hashInts(seed, 1);
  const d1 = generateDivisionTeams(rng, 0, NUM_TEAMS, 0, 0, 0, genSeed, 0, "England");
  const d2 = generateDivisionTeams(
    rng, NUM_TEAMS, NUM_TEAMS_D2, DIVISION_2_OFFSET, DIVISION_2_OFFSET, 1, genSeed, d1.nextPid, "England",
  );
  return {
    teams: [...d1.teams, ...d2.teams],
    players: [...d1.players, ...d2.players],
  };
}

/**
 * Generate every country's worth of teams/players in one rng pass, sharing
 * one shared stream — countries process in worldCompetitions() order
 * (England, Spain, Italy, Germany), each country's tier-1 block generated before its
 * tier-2 block, exactly mirroring generateTwoDivisionLeague's own order.
 * England's block is therefore byte-identical to a plain
 * generateTwoDivisionLeague call for the same seed. Equal-sibling by
 * construction: every country uses the identical strength bands
 * (divisionStrengthOffset by tier: 0 for tier 1, DIVISION_2_OFFSET for tier 2) — no
 * per-country tuning.
 */
export function generateWorld(
  rng: () => number,
  seed = 0,
  competitions: Competition[] = worldCompetitions(),
  model: ProgressionModel = "random",
): League {
  const genSeed = hashInts(seed, 1);
  const comps = competitions;
  let pid = 0;
  let tidCursor = 0;
  const teams: LeagueTeam[] = [];
  const players: Player[] = [];
  for (const { divisions } of countryDivisions(comps)) {
    // Each country's divisions in pyramid order, top flight first, one
    // contiguous tid block per country. A country with fewer (or more)
    // divisions than another simply contributes a shorter (or longer) block, so
    // every later country shifts — which is why club identities key off position
    // WITHIN the country rather than the absolute tid.
    //
    // Per-country strength handicap stacked onto the tier offset (0 for the big
    // four's top flight, so England stays byte-identical). Changing a player's
    // `base` doesn't alter rng-stream consumption, so the tier loop consumes the
    // stream in exactly the order the old d1-then-d2 pair did.
    for (const comp of divisions) {
      const tierOffset = divisionStrengthOffset(comp.tier);
      const result = generateDivisionTeams(
        rng, tidCursor, competitionTeamCount(comp),
        tierOffset + competitionStrengthOffset(comp),
        tierOffset + competitionAcademyOffset(comp),
        comp.id, genSeed, pid, comp.country, competitionNationalities(comp), model,
      );
      pid = result.nextPid;
      tidCursor += competitionTeamCount(comp);
      teams.push(...result.teams);
      players.push(...result.players);
    }
  }
  return { teams, players };
}
