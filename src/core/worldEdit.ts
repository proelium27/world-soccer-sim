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

/** The current value of every locked key, written over the edited spec. */
function lockStructure(edited: LeagueSpec, current: LeagueSpec): LeagueSpec {
  const out: Record<string, unknown> = { ...edited };
  for (const key of LOCKED_KEYS) {
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
): Competition[] | null {
  const ordered = [...divisions].sort((a, b) => a.tier - b.tier);
  const current = leagueSpecFromDivisions(ordered);
  const spec = normalizeLeagueSpec(lockStructure(edited, current));
  const before = resolveLeagueSpec(current);
  const after = resolveLeagueSpec(spec);
  if (after.divisions !== before.divisions
    || after.d1Teams !== before.d1Teams
    || (before.divisions >= 2 && after.d2Teams !== before.d2Teams)
    || (before.divisions >= 3 && after.d3Teams !== before.d3Teams)) {
    return null;
  }
  return buildCompetitions([spec]).map((built, i) => {
    const old = ordered[i];
    const next: Competition = {
      ...built,
      id: old.id,
      ...(old.seasonFormat === undefined ? {} : { seasonFormat: old.seasonFormat }),
    };
    if (foreignRules !== null) return { ...next, foreignRules };
    if (old.foreignRules !== undefined) return { ...next, foreignRules: old.foreignRules };
    const was = competitionForeignRules(old);
    return sameRules(competitionForeignRules(next), was) ? next : { ...next, foreignRules: was };
  });
}

/** `competitions` with one country's divisions swapped for `rebuilt`, by id. */
export function replaceCountry(
  competitions: readonly Competition[],
  rebuilt: readonly Competition[],
): Competition[] {
  const byId = new Map(rebuilt.map((c) => [c.id, c]));
  return competitions.map((c) => byId.get(c.id) ?? c);
}

/**
 * Queue an edit to one country on top of whatever is already queued. Returns
 * the new pending table, `undefined` when it would leave the queue identical to
 * the live table (nothing to apply), or null when the edit does not fit (see
 * rebuildCountry).
 */
export function queueCountryEdit(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  country: string,
  edited: LeagueSpec,
  foreignRules: ForeignRule[] | null = null,
): Competition[] | undefined | null {
  const base = pending ?? live;
  const rebuilt = rebuildCountry(divisionsOf([...base], country), edited, foreignRules);
  if (rebuilt === null) return null;
  const next = replaceCountry(base, rebuilt);
  return sameTable(next, live) ? undefined : next;
}

/**
 * Drop one country's queued edits (back to the live table for it), leaving any
 * other country's queued. `undefined` when nothing is left queued.
 */
export function discardCountryEdit(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
  country: string,
): Competition[] | undefined {
  if (!pending) return undefined;
  const next = replaceCountry(pending, divisionsOf([...live], country));
  return sameTable(next, live) ? undefined : next;
}

export function sameTable(a: readonly Competition[], b: readonly Competition[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** Countries whose queued divisions differ from the live ones. */
export function editedCountries(
  live: readonly Competition[],
  pending: readonly Competition[] | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!pending) return out;
  const liveById = new Map(live.map((c) => [c.id, c]));
  for (const c of pending) {
    const was = liveById.get(c.id);
    if (!was || JSON.stringify(was) !== JSON.stringify(c)) out.add(c.country);
  }
  return out;
}

/**
 * The table the new season plays under: the queued one when it still lines up
 * with the live world division for division (same ids, countries, tiers and
 * club counts), else the live one unchanged. The check is defensive — the only
 * writer is queueCountryEdit, which cannot produce a mismatch — but a queued
 * table that disagreed with the clubs' `compId`s would break the schedule
 * builder, so it is refused rather than trusted.
 */
export function applyPendingCompetitions(
  live: Competition[],
  pending: readonly Competition[] | undefined,
): Competition[] {
  if (!pending || pending.length !== live.length) return live;
  const lines = pending.every((c, i) => {
    const was = live[i];
    return c.id === was.id && c.country === was.country && c.tier === was.tier
      && competitionTeamCount(c) === competitionTeamCount(was);
  });
  return lines ? [...pending] : live;
}
