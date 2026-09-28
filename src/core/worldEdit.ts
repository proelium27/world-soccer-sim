/**
 * Editing a live save's leagues from God Mode: the same per-league settings the
 * new-save screen offers, changed between seasons.
 *
 * A save's competitions table is otherwise fixed at creation (see
 * competitions.ts). This module is the one door through which it changes, and
 * it only lets through what the save can absorb without new clubs:
 *
 *  - **Editable:** names, money, continental places, promotion spots and
 *    playoff formats, how the champion is decided, conference splits that fit
 *    the division's current size, the nationality mix and foreign-player rules.
 *  - **Locked:** how many divisions a country has, how many clubs each holds,
 *    strength and academy offsets (baked into squads and every club's
 *    `academyBase`), and the continent (coefficient history is per region).
 *
 * Edits are QUEUED on `LeagueStore.pendingCompetitions` and applied by the
 * offseason right after promotion and relegation (step 3.65), so the season
 * that just finished is settled by the rules it was played under, and the new
 * rules are in force for the summer market, youth intake and the next schedule.
 *
 * Ids never change: history, tables and `team.compId` all key off them.
 * Pure and rng-free.
 */
import {
  buildCompetitions, competitionTeamCount, divisionsOf, normalizeLeagueSpec, resolveLeagueSpec,
  type Competition, type LeagueSpec,
} from "./competitions.js";
import { competitionForeignRules, type ForeignRule } from "./foreignRules.js";

/** Spec keys a mid-save edit may never move. */
const LOCKED_KEYS = [
  "country", "divisions", "d1Teams", "d2Teams", "d3Teams",
  "strengthOffset", "academyOffset", "region", "abbrev",
] as const satisfies readonly (keyof LeagueSpec)[];

/** Drop keys whose value is undefined, so an unset knob stays absent. */
function withDefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The spec that `buildCompetitions` would turn back into exactly these
 * divisions (one country's, any order). The inverse of buildCompetitions, so
 * the new-save league panel can edit a live save's country.
 */
export function leagueSpecFromDivisions(divisions: readonly Competition[]): LeagueSpec {
  const [d1, d2, d3] = [...divisions].sort((a, b) => a.tier - b.tier);
  const slots = d1.continentalSlots;
  // `conferences: null` is meaningful (an explicit single table), so it is
  // carried whenever the key is present, not only when truthy.
  const split = (c: Competition | undefined) => (c && "conferences" in c ? c.conferences : undefined);
  return withDefined<LeagueSpec>({
    country: d1.country,
    divisions: divisions.length as 1 | 2 | 3,
    abbrev: d1.abbrev,
    d1Teams: d1.teamCount,
    d2Teams: d2?.teamCount,
    d3Teams: d3?.teamCount,
    d1Conferences: split(d1),
    d2Conferences: split(d2),
    d3Conferences: split(d3),
    d1Name: d1.name,
    d2Name: d2?.name,
    d3Name: d3?.name,
    strengthOffset: d1.strengthOffset,
    academyOffset: d1.academyOffset,
    budgetScale: d1.budgetScale,
    cupSlots: slots?.continental,
    shieldSlots: slots?.shield,
    promotionSpots: d1.promotionSpots,
    playoffFormat: d1.playoffFormat,
    d3PromotionSpots: d3 && d3.promotionSpots !== d1.promotionSpots ? d3.promotionSpots : undefined,
    d3PlayoffFormat: d3 && d3.playoffFormat !== d1.playoffFormat ? d3.playoffFormat : undefined,
    nationalities: d1.nationalities,
    region: d1.region,
    titlePlayoff: d1.titlePlayoff,
  });
}

/**
 * What an existing country keeps however its shape changes: the strength its
 * clubs were generated at and the continent its coefficient history is kept on.
 */
const STRENGTH_KEYS = [
  "country", "strengthOffset", "academyOffset", "region", "abbrev",
] as const satisfies readonly (keyof LeagueSpec)[];

/** The current value of every locked key, written over the edited spec. */
function lockKeys(edited: LeagueSpec, current: LeagueSpec, keys: readonly (keyof LeagueSpec)[]): LeagueSpec {
  const out: Record<string, unknown> = { ...edited };
  for (const key of keys) {
    if (current[key] === undefined) delete out[key];
    else out[key] = current[key];
  }
  return out as unknown as LeagueSpec;
}

const sameRules = (a: readonly ForeignRule[], b: readonly ForeignRule[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * One country's divisions rebuilt from an edited spec, with the same ids, or
 * null when the edit cannot be absorbed without changing a division's size (a
 * 30-club split division cannot go back to one table, which holds 20).
 *
 * `foreignRules`: a new rule set for every division, or null to keep each
 * division's rules as they are. "As they are" is pinned onto the competition
 * when the edit would otherwise change them, because a competition with its own
 * nationality table and no rules of its own resolves to NO rules (see
 * competitionForeignRules): editing Spain's mix must not quietly lift its
 * non-EU cap.
 *
 * Fields the spec has no word for (`seasonFormat`) are carried over.
 */
export function rebuildCountry(
  divisions: readonly Competition[],
  edited: LeagueSpec,
  foreignRules: ForeignRule[] | null = null,
  /**
   * Allow the shape to change (divisions added or removed at the bottom, club
   * counts), with new divisions numbered from `nextId`. Omitted, the shape is
   * locked and an edit that would move it returns null.
   */
  structure: { nextId: number } | null = null,
): Competition[] | null {
  const ordered = [...divisions].sort((a, b) => a.tier - b.tier);
  const current = leagueSpecFromDivisions(ordered);
  const locked = structure ? STRENGTH_KEYS : LOCKED_KEYS;
  const spec = normalizeLeagueSpec(lockKeys(edited, current, locked));
  if (!structure) {
    const before = resolveLeagueSpec(current);
    const after = resolveLeagueSpec(spec);
    if (after.divisions !== before.divisions
      || after.d1Teams !== before.d1Teams
      || (before.divisions >= 2 && after.d2Teams !== before.d2Teams)
      || (before.divisions >= 3 && after.d3Teams !== before.d3Teams)) {
      return null;
    }
  }
  const bottom = ordered[ordered.length - 1];
  return buildCompetitions([spec]).map((built, i) => {
    // A division that existed keeps its id; one added below the pyramid takes
    // a fresh one and inherits the lowest division's rules.
    const old = ordered[i] ?? bottom;
    const next: Competition = {
      ...built,
      id: ordered[i] ? ordered[i].id : structure!.nextId + (i - ordered.length),
      ...(old.seasonFormat === undefined || !ordered[i] ? {} : { seasonFormat: old.seasonFormat }),
    };
    if (foreignRules !== null) return { ...next, foreignRules };
    if (old.foreignRules !== undefined) return { ...next, foreignRules: old.foreignRules };
    const was = competitionForeignRules(old);
    return sameRules(competitionForeignRules(next), was) ? next : { ...next, foreignRules: was };
  });
}

/** One past the highest competition id the save has ever used. */
export function nextCompetitionId(...tables: (readonly Competition[] | null | undefined)[]): number {
  let max = -1;
  for (const t of tables) for (const c of t ?? []) max = Math.max(max, c.id);
  return max + 1;
}

/**
 * `competitions` with one country's divisions replaced by `rebuilt` (which may
 * be longer, shorter or empty). The country keeps its place in the table; a
 * country new to it goes on the end.
 */
export function replaceCountry(
  competitions: readonly Competition[],
  country: string,
  rebuilt: readonly Competition[],
): Competition[] {
  const at = competitions.findIndex((c) => c.country === country);
  const rest = competitions.filter((c) => c.country !== country);
  if (at < 0) return [...rest, ...rebuilt];
  return [...rest.slice(0, at), ...rebuilt, ...rest.slice(at)];
}

/**
 * Queue an edit to one country on top of whatever is already queued. Returns
 * the new pending table, `undefined` when it would leave the queue identical to
 * the live table (nothing to apply), or null when the edit does not fit (see
 * rebuildCountry). With `retired` given, the edit may change the country's
 * shape; new divisions take ids no competition in the save has ever had.
 */
export function queueCountryEdit(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  country: string,
  edited: LeagueSpec,
  foreignRules: ForeignRule[] | null = null,
  retired: readonly Competition[] | null = null,
): Competition[] | undefined | null {
  const base = pending ?? live;
  const structure = retired ? { nextId: nextCompetitionId(live, pending, retired) } : null;
  const rebuilt = rebuildCountry(divisionsOf([...base], country), edited, foreignRules, structure);
  if (rebuilt === null) return null;
  return settle(live, replaceCountry(base, country, rebuilt));
}

/** A country a save may add: a name no live or queued league already uses. */
export function canAddCountry(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  country: string,
): boolean {
  const name = country.trim().toLowerCase();
  return name.length > 0
    && ![...live, ...(pending ?? [])].some((c) => c.country.trim().toLowerCase() === name);
}

/**
 * Queue a brand-new country's league, built from a spec like the new-save
 * screen's. `replacing` names a league added earlier and not yet played (only
 * in the queue): it is swapped for this one, which is how such a league is
 * edited before its first season, strength and all.
 */
export function queueAddCountry(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  retired: readonly Competition[],
  spec: LeagueSpec,
  replacing: string | null = null,
): Competition[] | undefined | null {
  const clean = normalizeLeagueSpec({ ...spec, country: spec.country.trim() });
  if (replacing !== null && live.some((c) => c.country === replacing)) return null;
  const base = (pending ?? live).filter((c) => replacing === null || c.country !== replacing);
  if (!canAddCountry(live, base, clean.country)) return null;
  const first = nextCompetitionId(live, pending, retired);
  const built = buildCompetitions([clean]).map((c, i) => ({ ...c, id: first + i }));
  return settle(live, [...base, ...built]);
}

/** Queue a country's removal: every one of its clubs folds at the rollover. */
export function queueRemoveCountry(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  country: string,
): Competition[] | undefined {
  return settle(live, (pending ?? live).filter((c) => c.country !== country));
}

/**
 * Drop one country's queued edits (back to the live table for it), leaving any
 * other country's queued. An added country is dropped, a removed one comes
 * back. `undefined` when nothing is left queued.
 */
export function discardCountryEdit(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  country: string,
): Competition[] | undefined {
  if (!pending) return undefined;
  const restored = divisionsOf([...live], country);
  const inPending = pending.some((c) => c.country === country);
  const next = inPending
    ? replaceCountry(pending, country, restored)
    : restoreInLiveOrder(live, pending, restored);
  return settle(live, next);
}

/** Put a country back where it sat in the live table, among whatever is queued. */
function restoreInLiveOrder(
  live: readonly Competition[],
  pending: readonly Competition[],
  restored: readonly Competition[],
): Competition[] {
  if (restored.length === 0) return [...pending];
  const liveIndex = new Map(live.map((c, i) => [c.id, i]));
  const at = liveIndex.get(restored[0].id)!;
  const insert = pending.findIndex((c) => (liveIndex.get(c.id) ?? Infinity) > at);
  return insert < 0
    ? [...pending, ...restored]
    : [...pending.slice(0, insert), ...restored, ...pending.slice(insert)];
}

/** The queue as it should be stored: undefined when it says nothing new. */
function settle(live: readonly Competition[], next: Competition[]): Competition[] | undefined {
  return sameTable(next, live) ? undefined : next;
}

/** Same competitions, compared by id regardless of table order. */
export function sameTable(a: readonly Competition[], b: readonly Competition[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((c) => [c.id, JSON.stringify(c)]));
  return a.every((c) => byId.get(c.id) === JSON.stringify(c));
}

/** Countries whose queued divisions differ from the live ones, including added and removed countries. */
export function editedCountries(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!pending) return out;
  const liveById = new Map(live.map((c) => [c.id, c]));
  const pendingIds = new Set(pending.map((c) => c.id));
  for (const c of pending) {
    const was = liveById.get(c.id);
    if (!was || JSON.stringify(was) !== JSON.stringify(c)) out.add(c.country);
  }
  for (const c of live) if (!pendingIds.has(c.id)) out.add(c.country);
  return out;
}

/**
 * The table the new season plays under when the queue only changes settings:
 * the queued one when it still lines up with the live world division for
 * division (same ids, countries, tiers and club counts), else the live one
 * unchanged. A queue that changes the world's shape goes through
 * core/worldRestructure.ts instead.
 */
export function applyPendingCompetitions(
  live: Competition[],
  pending: readonly Competition[] | undefined,
): Competition[] {
  if (!pending || pending.length !== live.length) return live;
  const liveById = new Map(live.map((c) => [c.id, c]));
  const lines = pending.every((c) => {
    const was = liveById.get(c.id);
    return was !== undefined && c.country === was.country && c.tier === was.tier
      && competitionTeamCount(c) === competitionTeamCount(was);
  });
  return lines ? [...pending] : live;
}

/**
 * Every competition a save has had, live and removed. For looking up a PAST
 * season's compId, which may name a league God Mode has since removed; the
 * live table alone would throw in `competitionOf`.
 */
export function everyCompetition(league: {
  competitions: readonly Competition[];
  retiredCompetitions?: readonly Competition[];
}): Competition[] {
  return [...league.competitions, ...(league.retiredCompetitions ?? [])];
}

/**
 * A save with its queue set to `next`, as the God Mode actions store it: null
 * (the edit didn't fit) changes nothing, undefined clears the queue.
 */
export function withQueue<L extends { pendingCompetitions?: Competition[] }>(
  league: L,
  next: Competition[] | undefined | null,
): L | null {
  if (next === null) return null;
  if (next === undefined) {
    if (!league.pendingCompetitions) return null;
    const { pendingCompetitions: _dropped, ...without } = league;
    return without as L;
  }
  return { ...league, pendingCompetitions: next };
}

/** The country whose league the user's club plays in, or null for a spectator. */
export function userCountryOf(league: {
  competitions: readonly Competition[];
  teams: readonly { tid: number; compId: number }[];
  meta: { userTid: number };
}): string | null {
  const team = league.teams.find((t) => t.tid === league.meta.userTid);
  return team ? league.competitions.find((c) => c.id === team.compId)?.country ?? null : null;
}
