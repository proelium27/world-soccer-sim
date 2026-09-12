import type { Player } from "../players/types.js";
import type { TeamMatchData } from "../league/composites.js";
import type { IntlGroup, IntlQualifyingCampaign, IntlQualifyingPlayoff, NationSquad } from "./types.js";
import type { CareerDelta } from "./simIntl.js";
import { playQualifyingPlayoff } from "./qualifyingPlayoff.js";
import { buildSquads, nationMatchData } from "./squads.js";
import { groupByConfederation, allocateSlots, allocateByQuota } from "./confederations.js";
import { buildGroup, serpentineGroups, groupTable, rankAcrossGroups, type GroupRow } from "./groups.js";
import { playGroups, emptyCareerDelta, mergeCareerDelta, QUALIFYING_GROUP_STREAM } from "./simIntl.js";
import { hashInts } from "../../engine/rng.js";
import { resolveWorldCupSize } from "./format.js";
import {
  INTL_FIELD_SIZE, INTL_QUAL_GROUP_TARGET, INTL_QUAL_GROUP_MAX, INTL_QUAL_LEGS, type WorldCupSize,
} from "../constants.js";

/**
 * How many groups a confederation's qualifying splits into: about
 * INTL_QUAL_GROUP_TARGET nations per group, but never more groups than it has
 * places (every group winner must be able to qualify) and never so many that a
 * group would hold fewer than two nations.
 */
function groupCountFor(nations: number, slots: number): number {
  return Math.max(1, Math.min(slots, Math.round(nations / INTL_QUAL_GROUP_TARGET), Math.floor(nations / 2)));
}

/**
 * Split a confederation's places over its completed groups: every finishing
 * position that takes every group's place is through outright (group winners,
 * then runners-up, and so on), and the one position that takes only some of
 * them goes to a playoff between all of its nations (see qualifyingPlayoff.ts).
 *
 * Working down by finishing position (rather than one flat merged table) is
 * both how real qualifying behaves and what makes the allocation total: however
 * lopsided the group sizes are, there is always another position to draw from,
 * so a confederation can never come up short of the places it was given. The
 * playoff entrants are seeded on per-game rates (see rankAcrossGroups), which
 * decides who hosts and who meets whom, never who goes through.
 */
function splitPlaces(
  groups: IntlGroup[],
  slots: number,
): { direct: number[]; playoff: { position: number; places: number; entrants: number[] } | null } {
  const tables = groups.map((g) => groupTable(g));
  const direct: number[] = [];
  let playoff: { position: number; places: number; entrants: number[] } | null = null;

  placesByPosition(tables.map((t) => t.length), slots).forEach((take, position) => {
    const atPosition: GroupRow[] = tables
      .map((table) => table[position])
      .filter((row): row is GroupRow => row !== undefined);
    const seeded = rankAcrossGroups(atPosition).map((row) => row.nid);
    if (take >= seeded.length) direct.push(...seeded);
    else playoff = { position, places: take, entrants: seeded };
  });
  return { direct, playoff };
}

/**
 * The playoff a confederation's draw sets up, if any: the finishing position
 * whose places run out part-way through it, how many nations finish there, and
 * how many of them go through. Settled by the draw alone, like placesByPosition.
 */
export function playoffShape(
  groupSizes: number[],
  slots: number,
): { position: number; entrants: number; places: number } | null {
  const byPosition = placesByPosition(groupSizes, slots);
  const position = byPosition.length - 1;
  if (position < 0) return null;
  const entrants = groupSizes.filter((size) => size > position).length;
  const places = byPosition[position];
  return places < entrants ? { position, entrants, places } : null;
}

/**
 * How many of a confederation's places each finishing position takes, index 0
 * being the group winners: every group's winner, then as many runners-up as
 * there are places left, and so on down. Group sizes can differ by one, so the
 * count available at a position is the number of groups deep enough to have it.
 *
 * This is the quota `fillPlaces` fills, which is the whole point of it being a
 * separate function: it is also what the Qualifying page draws its "the 7 group
 * winners, plus the 6 best runners-up" line and its zone bars from, and a UI
 * that described a different rule from the one being played would be worse than
 * no UI at all. Deriving both from one function is what stops that.
 *
 * It depends only on the draw (group sizes and the allocation), never on
 * results, so it is fully determined the moment the campaign is drawn — three
 * offseasons before the last leg is played.
 */
export function placesByPosition(groupSizes: number[], slots: number): number[] {
  const deepest = Math.max(0, ...groupSizes);
  const out: number[] = [];
  let left = slots;
  for (let position = 0; position < deepest && left > 0; position++) {
    const available = groupSizes.filter((size) => size > position).length;
    const take = Math.min(available, left);
    out.push(take);
    left -= take;
  }
  return out;
}

/**
 * The size and confederation allocation a campaign plays for. Everything a
 * campaign drawn today needs is recorded on it (`fieldSize`, `places`), so this
 * reads it back rather than recomputing it — a campaign spans three offseasons,
 * and a rule or setting that changed in between must not re-deal places its
 * groups were drawn for.
 *
 * A campaign drawn before either field existed replays the rule it was drawn
 * under instead: a 32-nation field, strength-weighted with a floor of one place
 * per confederation. Nations arrive strongest first (buildSquads sorts them),
 * so nids and the contender set are stable.
 */
function planQualifying(campaign: QualifyingSource): {
  nidOf: Map<string, number>;
  fieldSize: number;
  byConfederation: ReturnType<typeof groupByConfederation>;
  slotsByConfederation: ReturnType<typeof allocateSlots>;
} {
  const { nations } = campaign;
  const nidOf = new Map(nations.map((n, i) => [n, i]));
  const byConfederation = groupByConfederation(nations);
  const fieldSize = campaign.fieldSize ?? INTL_FIELD_SIZE;
  const places = campaign.places;
  const slotsByConfederation = places
    ? new Map([...byConfederation.keys()].filter((c) => (places[c] ?? 0) > 0).map((c) => [c, places[c]]))
    : allocateSlots(byConfederation, fieldSize, new Set(nations.slice(0, fieldSize)));
  return { nidOf, fieldSize, byConfederation, slotsByConfederation };
}

/** The parts of a campaign planQualifying reads. */
type QualifyingSource = Pick<IntlQualifyingCampaign, "nations" | "fieldSize" | "places">;

/**
 * The places each confederation plays for in a campaign being drawn now: the
 * real World Cup's confederation quotas for this size, capped so qualifying
 * means something everywhere and floored so no group outgrows INTL_QUAL_GROUP_MAX —
 * see allocateByQuota.
 */
function allocatePlaces(nations: string[], fieldSize: number): Record<string, number> {
  const byConfederation = groupByConfederation(nations);
  return Object.fromEntries(allocateByQuota(byConfederation, fieldSize, INTL_QUAL_GROUP_MAX));
}

/** What one confederation is playing for, all of it fixed at the draw. */
export interface ConfederationQualifyingPlan {
  confederation: string;
  /** Places allocated out of the campaign's field size. */
  slots: number;
  /** Nations entered from this confederation. */
  nations: number;
  /** Groups it was drawn into. 0 when it had no more nations than places. */
  groups: number;
  /**
   * Places taken by each finishing position, index 0 = group winners (see
   * placesByPosition). Empty for a confederation that plays no qualifying,
   * whose nations are all through by entering.
   */
  byPosition: number[];
  /**
   * The playoff for the last places, when the quota runs out part-way through
   * a finishing position (see playoffShape). Null when every position it
   * reaches is through outright, or it plays no qualifying at all.
   */
  playoff: { position: number; entrants: number; places: number } | null;
}

/**
 * What every confederation in a campaign is playing for, in the order the draw
 * allocated the places. Pure, and read through the same planQualifying that
 * computeQualified fills the places from, so the two can never disagree.
 *
 * Note what this is NOT: a per-group qualifying count. A group's winner always
 * goes through, but whether its runner-up does depends on the other groups in
 * the same confederation, because runners-up are ranked against each other for
 * whatever places are left. So the honest statement is per confederation, and
 * per group it can only ever be a zone.
 */
export function qualifyingPlan(campaign: IntlQualifyingCampaign): ConfederationQualifyingPlan[] {
  const { byConfederation, slotsByConfederation } = planQualifying(campaign);

  // Read the group sizes off the drawn groups instead of recomputing them, so
  // the plan describes the campaign in front of the user and not a fresh draw.
  const sizes = new Map<string, number[]>();
  for (const group of campaign.groups) {
    if (group.confederation == null) continue;
    const list = sizes.get(group.confederation) ?? [];
    list.push(group.nids.length);
    sizes.set(group.confederation, list);
  }

  return [...slotsByConfederation].map(([confederation, slots]) => {
    const groupSizes = sizes.get(confederation) ?? [];
    return {
      confederation,
      slots,
      nations: (byConfederation.get(confederation) ?? []).length,
      groups: groupSizes.length,
      byPosition: placesByPosition(groupSizes, slots),
      playoff: playoffShape(groupSizes, slots),
    };
  });
}

/**
 * Draw a qualifying campaign without playing a match: every eligible nation
 * names a squad, the World Cup's size is settled from the save's setting and
 * how many nations that is (resolveWorldCupSize), confederations are allocated
 * the places between them, and each confederation that has more nations than places is drawn into
 * serpentine groups whose fixtures start unplayed (`qualified` stays empty until
 * the last leg is played, one leg per offseason via playQualifyingRound). No rng
 * draw is taken from the shared stream and no player is touched, so this is safe
 * to run the instant the offseason begins.
 *
 * Returns null when the world simply cannot fill the field — an England-only
 * legacy save, say, whose player pool spans too few nations. The caller treats
 * that exactly like a world with no Continental Cup: the feature stays dark.
 */
export function initQualifying(
  players: Player[],
  season: number,
  /** The save's `worldCupSize`; absent means the 32 every older save plays. */
  size: WorldCupSize = INTL_FIELD_SIZE,
): IntlQualifyingCampaign | null {
  const squads: NationSquad[] = buildSquads(players);
  const fieldSize = resolveWorldCupSize(size, squads.length);
  if (fieldSize === null) return null;

  const nations = squads.map((s) => s.nation);
  const places = allocatePlaces(nations, fieldSize);
  const { nidOf, byConfederation, slotsByConfederation } = planQualifying({ nations, fieldSize, places });

  const groups: IntlGroup[] = [];
  for (const [confederation, slots] of slotsByConfederation) {
    const members = (byConfederation.get(confederation) ?? []).map((n) => nidOf.get(n)!);
    // A confederation with no more nations than places sends them all — there
    // is nothing to qualify for, so it plays no matches.
    if (members.length <= slots) continue;
    for (const nids of serpentineGroups(members, groupCountFor(members.length, slots))) {
      groups.push(buildGroup(groups.length, nids, confederation, INTL_QUAL_LEGS));
    }
  }

  return { season, nations, squads, groups, qualified: [], fieldSize, places };
}

/**
 * The qualifiers, decided once the whole campaign is played: each
 * confederation's outright places by finishing position across its groups, its
 * playoff played for the rest, plus the direct qualifiers whose confederation
 * had no more nations than places. Strongest first (by nid) so the tournament
 * draw's pots seed correctly. The allocation is the one recorded at the draw
 * (see planQualifying).
 */
export function decideQualifiers(
  played: IntlGroup[],
  campaign: QualifyingSource & Pick<IntlQualifyingCampaign, "season">,
  matchData: Map<number, TeamMatchData>,
  lid: number,
  delta: CareerDelta,
  injured: Set<number>,
): { qualified: string[]; playoffs: IntlQualifyingPlayoff[] } {
  const { nations } = campaign;
  const { nidOf, fieldSize, byConfederation, slotsByConfederation } = planQualifying(campaign);

  // Which of the played groups belong to each confederation, keyed off the
  // confederation stamped on the fixture at draw time.
  const groupsOfConfederation = new Map<string, number[]>();
  played.forEach((g, i) => {
    if (g.confederation == null) return;
    const arr = groupsOfConfederation.get(g.confederation) ?? [];
    arr.push(i);
    groupsOfConfederation.set(g.confederation, arr);
  });

  const qualifiedNids: number[] = [];
  const playoffs: IntlQualifyingPlayoff[] = [];
  [...slotsByConfederation].forEach(([confederation, slots], confederationIndex) => {
    const members = (byConfederation.get(confederation) ?? []).map((n) => nidOf.get(n)!);
    if (members.length <= slots) {
      qualifiedNids.push(...members); // direct qualifiers, played no matches
      return;
    }
    const indices = groupsOfConfederation.get(confederation) ?? [];
    const { direct, playoff } = splitPlaces(indices.map((i) => played[i]), slots);
    qualifiedNids.push(...direct);
    if (!playoff) return;
    const result = playQualifyingPlayoff(
      confederation, confederationIndex, playoff.position, playoff.entrants, playoff.places,
      matchData, lid, campaign.season, delta, injured,
    );
    playoffs.push(result);
    qualifiedNids.push(...result.qualified);
  });

  const qualified = [...new Set(qualifiedNids)]
    .sort((a, b) => a - b)
    .slice(0, fieldSize)
    .map((nid) => nations[nid]);
  return { qualified, playoffs };
}

/**
 * Play the next unplayed leg of a qualifying campaign — one leg per offseason
 * across the four-year cycle. Each leg is seeded independently (off the
 * campaign's start season and the leg index), so its results are the same
 * whether the campaign is clicked through a leg at a time or run in one pass.
 * Squad pids are filtered to players still in the world, because a three-season
 * campaign outlives some of the players named at its start (retirement runs
 * between offseasons). Once the final leg completes, the qualifiers are
 * locked in.
 */
export function playQualifyingRound(
  campaign: IntlQualifyingCampaign,
  players: Player[],
  lid: number,
): { campaign: IntlQualifyingCampaign; delta: CareerDelta; injured: number[] } {
  const delta = emptyCareerDelta();
  const injured = new Set<number>();

  // Drop squad members who have since retired out of the world so match data
  // never dereferences a missing pid.
  const liveMatchData = (): Map<number, TeamMatchData> => {
    const alive = new Set(players.map((p) => p.pid));
    const liveSquads = campaign.squads.map((s) => ({ ...s, pids: s.pids.filter((pid) => alive.has(pid)) }));
    return nationMatchData(liveSquads, players);
  };

  // The next leg to play is the lowest leg with any fixture still unplayed.
  const pendingLegs = campaign.groups.flatMap((g) =>
    g.matches.filter((m) => m.homeGoals < 0).map((m) => m.leg ?? 0),
  );
  if (pendingLegs.length === 0) {
    // Nothing left to play (or a world where every confederation qualified
    // directly): make sure the qualifiers are decided.
    if (campaign.qualified.length > 0) return { campaign, delta, injured: [] };
    const decided = decideQualifiers(campaign.groups, campaign, liveMatchData(), lid, delta, injured);
    return {
      campaign: { ...campaign, qualified: decided.qualified, playoffs: decided.playoffs },
      delta,
      injured: [...injured],
    };
  }
  const leg = Math.min(...pendingLegs);
  const matchData = liveMatchData();

  const seed = hashInts(lid, campaign.season, QUALIFYING_GROUP_STREAM, leg);
  const played = playGroups(campaign.groups, matchData, seed, false, delta, injured, leg);

  const complete = played.every((g) => g.matches.every((m) => m.homeGoals >= 0));
  if (!complete) {
    return { campaign: { ...campaign, groups: played }, delta, injured: [...injured] };
  }
  // The last leg is in: play each confederation's playoff straight after it,
  // on the same squads, and lock in the field.
  const decided = decideQualifiers(played, campaign, matchData, lid, delta, injured);
  return {
    campaign: { ...campaign, groups: played, qualified: decided.qualified, playoffs: decided.playoffs },
    delta,
    injured: [...injured],
  };
}

/**
 * Draw and play a whole qualifying campaign (every leg) in one pass — the bulk
 * path and the equivalence baseline for the staged, one-leg-per-offseason play.
 * Null when the world cannot fill the field (see initQualifying).
 */
export function runQualifying(
  players: Player[],
  season: number,
  lid: number,
  size: WorldCupSize = INTL_FIELD_SIZE,
): { campaign: IntlQualifyingCampaign; delta: CareerDelta; injured: number[] } | null {
  const drawn = initQualifying(players, season, size);
  if (!drawn) return null;

  const delta = emptyCareerDelta();
  const injured = new Set<number>();
  let campaign = drawn;
  for (let guard = 0; campaign.qualified.length === 0 && guard <= INTL_QUAL_LEGS; guard++) {
    const r = playQualifyingRound(campaign, players, lid);
    mergeCareerDelta(delta, r.delta);
    for (const pid of r.injured) injured.add(pid);
    campaign = r.campaign;
  }

  if (campaign.qualified.length < (campaign.fieldSize ?? INTL_FIELD_SIZE)) return null;
  return { campaign, delta, injured: [...injured] };
}
