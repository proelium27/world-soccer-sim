import type { Player } from "../players/types.js";
import type { IntlGroup, IntlQualifyingCampaign, NationSquad } from "./types.js";
import type { CareerDelta } from "./simIntl.js";
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
 * Fill a confederation's places from its completed groups: every group winner
 * first, then the best runners-up, then the best third-placed nations, and so
 * on until the places are gone.
 *
 * Working down by finishing position (rather than one flat merged table) is
 * both how real qualifying behaves and what makes the allocation total: however
 * lopsided the group sizes are, there is always another position to draw from,
 * so a confederation can never come up short of the places it was given.
 * Nations from different groups are compared on per-game rates — see
 * rankAcrossGroups.
 */
function fillPlaces(groups: IntlGroup[], slots: number): number[] {
  const tables = groups.map((g) => groupTable(g));
  const qualified: number[] = [];

  placesByPosition(tables.map((t) => t.length), slots).forEach((take, position) => {
    const atPosition: GroupRow[] = tables
      .map((table) => table[position])
      .filter((row): row is GroupRow => row !== undefined);
    for (const row of rankAcrossGroups(atPosition).slice(0, take)) qualified.push(row.nid);
  });
  return qualified;
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
 * The qualifiers, computed once the whole campaign is played: each
 * confederation's places filled by finishing position across its groups, plus
 * the direct qualifiers whose confederation had no more nations than places.
 * Strongest first (by nid) so the tournament draw's pots seed correctly. The
 * allocation is the one recorded at the draw (see planQualifying).
 */
export function computeQualified(played: IntlGroup[], campaign: QualifyingSource): string[] {
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
  for (const [confederation, slots] of slotsByConfederation) {
    const members = (byConfederation.get(confederation) ?? []).map((n) => nidOf.get(n)!);
    if (members.length <= slots) {
      qualifiedNids.push(...members); // direct qualifiers, played no matches
      continue;
    }
    const indices = groupsOfConfederation.get(confederation) ?? [];
    qualifiedNids.push(...fillPlaces(indices.map((i) => played[i]), slots));
  }

  return [...new Set(qualifiedNids)]
    .sort((a, b) => a - b)
    .slice(0, fieldSize)
    .map((nid) => nations[nid]);
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

  // The next leg to play is the lowest leg with any fixture still unplayed.
  const pendingLegs = campaign.groups.flatMap((g) =>
    g.matches.filter((m) => m.homeGoals < 0).map((m) => m.leg ?? 0),
  );
  if (pendingLegs.length === 0) {
    // Nothing left to play (or a world where every confederation qualified
    // directly): make sure the qualifiers are computed.
    const qualified = campaign.qualified.length > 0
      ? campaign.qualified
      : computeQualified(campaign.groups, campaign);
    return { campaign: { ...campaign, qualified }, delta, injured: [] };
  }
  const leg = Math.min(...pendingLegs);

  // Drop squad members who have since retired out of the world so match data
  // never dereferences a missing pid.
  const alive = new Set(players.map((p) => p.pid));
  const liveSquads = campaign.squads.map((s) => ({ ...s, pids: s.pids.filter((pid) => alive.has(pid)) }));
  const matchData = nationMatchData(liveSquads, players);

  const seed = hashInts(lid, campaign.season, QUALIFYING_GROUP_STREAM, leg);
  const played = playGroups(campaign.groups, matchData, seed, false, delta, injured, leg);

  const complete = played.every((g) => g.matches.every((m) => m.homeGoals >= 0));
  const qualified = complete ? computeQualified(played, campaign) : campaign.qualified;
  return { campaign: { ...campaign, groups: played, qualified }, delta, injured: [...injured] };
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
