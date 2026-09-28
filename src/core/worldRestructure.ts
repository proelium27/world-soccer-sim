/**
 * Applying God Mode's queued world at the season rollover, when it changes the
 * world's SHAPE: a league or division added or removed, or a division resized.
 * core/worldEdit.ts writes the queue; this is what the offseason runs at step
 * 3.65, after promotion and relegation and before free agency.
 *
 * - **New clubs** are generated like world creation generates them
 *   (`generateDivisionTeams`), on a private stream seeded off the save and the
 *   season, so no shared-rng draw moves. They take fresh tids (max + 1) and
 *   pids (`nextPid`), names from their country's identity list that no club in
 *   the save already uses, and a zero budget: step 6.5 charges the season's
 *   start exactly as world creation's opening charge does.
 * - **Dissolved clubs** leave `teams`. Their players become free agents simply
 *   by being on no roster, and step 4's free agency re-signs them. A club is
 *   snapshotted onto `defunctTeams` first so history can still name it. A
 *   shrinking division folds the clubs that finished bottom of it last season;
 *   clubs promoted into it earned their place and go last. The user's club is
 *   never dissolved: if its division is removed it drops into the lowest
 *   division its country still has.
 * - **Removed competitions** move to `retiredCompetitions`, so a past season's
 *   compId still resolves on the history pages. Ids are never reused.
 *
 * Pure: never mutates its inputs.
 */
import {
  competitionAcademyOffset, competitionNationalities, competitionStrengthOffset,
  competitionTeamCount, type Competition,
} from "./competitions.js";
import { divisionStrengthOffset, HYPE_INITIAL, SCOUTING_SPEND_DEFAULT } from "./constants.js";
import { generateDivisionTeams } from "./league/generate.js";
import { clubIdentitiesFor, type StoredTeam } from "./teams/clubs.js";
import { chargeSeasonStart, financeScale, wageBill } from "./finance/budget.js";
import { clampScoutingSpend } from "./finance/scouting.js";
import { hashInts, mulberry32 } from "../engine/rng.js";
import type { Player } from "./players/types.js";
import type { ActiveLoan } from "./loans.js";
import type { StandingsRow } from "./standings.js";
import type { ProgressionModel } from "./constants.js";

/** Stream tag for generating clubs mid-save. Arbitrary, but never reuse it. */
const NEW_CLUBS_STREAM = 0x3e7c1b;

/** A club that has folded, kept so history can still name it. */
export interface DefunctTeam {
  tid: number;
  name: string;
  abbrev: string;
  colors: [string, string];
  /** The competition it last played in. */
  compId: number;
  /** The last season it played. */
  lastSeason: number;
}

export interface RestructureInput {
  lid: number;
  /** The season about to start. */
  season: number;
  userTid: number;
  progressionModel: ProgressionModel;
  live: Competition[];
  pending: Competition[];
  retired: Competition[];
  teams: StoredTeam[];
  players: Player[];
  activeLoans: ActiveLoan[];
  nextPid: number;
  /** The season just played: final tables, and each club's division before the swap. */
  tablesByCompId: Map<number, StandingsRow[]>;
  compIdBeforeSwaps: Map<number, number>;
}

export interface RestructureResult {
  competitions: Competition[];
  retired: Competition[];
  teams: StoredTeam[];
  players: Player[];
  activeLoans: ActiveLoan[];
  nextPid: number;
  defunct: DefunctTeam[];
  dissolved: Set<number>;
  created: number[];
}

/**
 * Whether a queued table changes the world's shape rather than only its
 * settings: a competition added or removed, or a club count changed.
 */
export function isStructuralChange(live: readonly Competition[], pending: readonly Competition[]): boolean {
  if (live.length !== pending.length) return true;
  const byId = new Map(pending.map((c) => [c.id, c]));
  return live.some((c) => {
    const next = byId.get(c.id);
    return !next || competitionTeamCount(next) !== competitionTeamCount(c);
  });
}

/**
 * A queued table the live world can be turned into: every competition that
 * keeps its id keeps its country and tier, new ids are fresh (never a retired
 * one), and each country's tiers still run 1..n with no gap.
 */
export function isValidRestructure(
  live: readonly Competition[],
  pending: readonly Competition[],
  retired: readonly Competition[],
): boolean {
  const liveById = new Map(live.map((c) => [c.id, c]));
  const retiredIds = new Set(retired.map((c) => c.id));
  const seen = new Set<number>();
  for (const c of pending) {
    if (seen.has(c.id) || retiredIds.has(c.id)) return false;
    seen.add(c.id);
    const was = liveById.get(c.id);
    if (was && (was.country !== c.country || was.tier !== c.tier)) return false;
  }
  const tiers = new Map<string, number[]>();
  for (const c of pending) tiers.set(c.country, [...(tiers.get(c.country) ?? []), c.tier]);
  for (const list of tiers.values()) {
    const sorted = [...list].sort((a, b) => a - b);
    if (sorted.some((t, i) => t !== i + 1)) return false;
  }
  return true;
}

/**
 * The order a division's clubs fold in when it shrinks: the clubs that finished
 * bottom of its own table first, then clubs relegated into it (worst finish
 * first), then clubs promoted into it. Never the user's club.
 */
function foldOrder(
  comp: Competition,
  members: readonly StoredTeam[],
  input: RestructureInput,
): number[] {
  const tierOf = new Map([...input.live, ...input.retired].map((c) => [c.id, c.tier]));
  const posIn = new Map<number, number>();
  for (const table of input.tablesByCompId.values()) table.forEach((r, i) => posIn.set(r.tid, i));
  const rank = (t: StoredTeam): [number, number] => {
    const before = input.compIdBeforeSwaps.get(t.tid);
    const pos = posIn.get(t.tid) ?? 0;
    if (before === comp.id) return [0, -pos];
    const beforeTier = before === undefined ? undefined : tierOf.get(before);
    if (beforeTier !== undefined && beforeTier < comp.tier) return [1, -pos];
    return [2, -pos];
  };
  return members
    .filter((t) => t.tid !== input.userTid)
    .map((t) => ({ tid: t.tid, key: rank(t) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || b.tid - a.tid)
    .map((e) => e.tid);
}

/**
 * Names for `count` new clubs in `country` that no club in the save (live or
 * folded) already has. Walks the country's identity list past the clubs it
 * already has, and further if the user renamed a club onto one of its names.
 */
function freshIdentities(
  country: string,
  count: number,
  inCountry: number,
  takenNames: Set<string>,
  takenAbbrevs: Set<string>,
): { name: string; abbrev: string; colors: [string, string] }[] {
  const out: { name: string; abbrev: string; colors: [string, string] }[] = [];
  for (let want = inCountry + count; out.length < count; want += count) {
    for (const id of clubIdentitiesFor(country, want)) {
      if (out.length >= count) break;
      if (takenNames.has(id.name)) continue;
      let abbrev = id.abbrev;
      for (let n = 2; takenAbbrevs.has(abbrev); n++) abbrev = `${id.abbrev.slice(0, 2)}${n}`;
      takenNames.add(id.name);
      takenAbbrevs.add(abbrev);
      out.push({ name: id.name, abbrev, colors: [id.colors[0], id.colors[1]] });
    }
    if (want > 10_000) throw new Error(`No club names left for ${country}`);
  }
  return out;
}

export function restructureWorld(input: RestructureInput): RestructureResult {
  const { live, userTid, season } = input;
  let pending = input.pending.map((c) => ({ ...c }));
  const pendingIds = new Set(pending.map((c) => c.id));

  // The user's club is never dissolved. A whole country can't be removed while
  // the user manages there (the editor refuses it; this restores it if a queue
  // slipped through), and a removed division drops the club into the lowest
  // division its country keeps.
  const userTeam = input.teams.find((t) => t.tid === userTid);
  let userMove: number | null = null;
  if (userTeam && !pendingIds.has(userTeam.compId)) {
    const country = live.find((c) => c.id === userTeam.compId)!.country;
    const kept = pending.filter((c) => c.country === country).sort((a, b) => b.tier - a.tier);
    if (kept.length === 0) {
      pending = [...pending, ...live.filter((c) => c.country === country)]
        .sort((a, b) => a.id - b.id);
    } else {
      userMove = kept[0].id;
      kept[0].teamCount = competitionTeamCount(kept[0]) + 1;
    }
  }
  const pendingById = new Map(pending.map((c) => [c.id, c]));

  // Who folds.
  const dissolved = new Set<number>();
  for (const t of input.teams) {
    if (!pendingById.has(t.compId) && t.tid !== userTid) dissolved.add(t.tid);
  }
  for (const comp of pending) {
    if (!live.some((c) => c.id === comp.id)) continue;
    const members = input.teams.filter((t) => t.compId === comp.id
      || (t.tid === userTid && userMove === comp.id));
    const surplus = members.length - competitionTeamCount(comp);
    if (surplus > 0) foldOrder(comp, members, input).slice(0, surplus).forEach((tid) => dissolved.add(tid));
  }

  const defunct: DefunctTeam[] = input.teams
    .filter((t) => dissolved.has(t.tid))
    .map((t) => ({
      tid: t.tid, name: t.name, abbrev: t.abbrev, colors: [t.colors[0], t.colors[1]],
      compId: t.compId, lastSeason: season - 1,
    }));

  // Loans touching a folded club end now: a player lent BY it has no club to go
  // back to and becomes a free agent; a player lent TO it goes home.
  const returning = new Map<number, number>();
  const freed = new Set<number>();
  const activeLoans = input.activeLoans.filter((l) => {
    if (dissolved.has(l.parentTid)) { freed.add(l.pid); return false; }
    if (dissolved.has(l.loaneeTid)) { returning.set(l.pid, l.parentTid); return false; }
    return true;
  });
  let teams = input.teams
    .filter((t) => !dissolved.has(t.tid))
    .map((t) => {
      let next = t;
      if (t.tid === userTid && userMove !== null) next = { ...next, compId: userMove };
      if (next.roster.some((pid) => freed.has(pid))) {
        next = { ...next, roster: next.roster.filter((pid) => !freed.has(pid)) };
      }
      const back = [...returning].filter(([, parent]) => parent === t.tid).map(([pid]) => pid);
      if (back.length > 0) next = { ...next, roster: [...next.roster, ...back] };
      return next;
    });

  // Who is created.
  const takenNames = new Set([...input.teams.map((t) => t.name)]);
  const takenAbbrevs = new Set([...input.teams.map((t) => t.abbrev)]);
  let nextTid = Math.max(-1, ...input.teams.map((t) => t.tid)) + 1;
  let nextPid = input.nextPid;
  const players = [...input.players];
  const created: number[] = [];
  for (const comp of pending) {
    const have = teams.filter((t) => t.compId === comp.id).length;
    const need = competitionTeamCount(comp) - have;
    if (need <= 0) continue;
    const tierOffset = divisionStrengthOffset(comp.tier);
    const rng = mulberry32(hashInts(input.lid, season, comp.id, NEW_CLUBS_STREAM));
    const gen = generateDivisionTeams(
      rng, nextTid, need,
      tierOffset + competitionStrengthOffset(comp),
      tierOffset + competitionAcademyOffset(comp),
      comp.id, hashInts(input.lid, season, NEW_CLUBS_STREAM), nextPid, comp.country,
      competitionNationalities(comp), input.progressionModel, season,
    );
    nextTid += need;
    nextPid = gen.nextPid;
    players.push(...gen.players);
    const salary = new Map(gen.players.map((p) => [p.pid, p.contract.salary]));
    const countryIds = new Set(pending.filter((c) => c.country === comp.country).map((c) => c.id));
    const inCountry = input.teams.filter((t) => countryIds.has(t.compId)).length;
    const names = freshIdentities(comp.country, need, inCountry, takenNames, takenAbbrevs);
    gen.teams.forEach((g, i) => {
      const opening = chargeSeasonStart(0, wageBill(g.roster, salary), financeScale(pending, comp.id), HYPE_INITIAL);
      created.push(g.tid);
      teams = [...teams, {
        tid: g.tid,
        ...names[i],
        roster: g.roster,
        academyRoster: [],
        scoutingRegions: [],
        scoutingPositions: [],
        // Step 6.5 charges the season's start onto this, which is exactly the
        // opening charge world creation makes.
        budget: 0,
        hype: HYPE_INITIAL,
        scoutingSpend: clampScoutingSpend(SCOUTING_SPEND_DEFAULT, opening),
        nextScoutingSpend: clampScoutingSpend(SCOUTING_SPEND_DEFAULT, opening),
        academyBase: g.academyBase,
        compId: comp.id,
        divisionConvergence: null,
        formation: "4-3-3",
        starters: null,
        transferListed: [],
        moreMinutes: [],
        scoutingObserved: {},
        // Crest art is keyed by tid off the shipped layout; a new tid can land
        // inside it in a save built with fewer countries, and must not borrow a
        // shipped club's badge.
        importedIdentity: true,
      }];
    });
  }

  // Every division's club count is what it actually holds now.
  const competitions = pending.map((c) => {
    const n = teams.filter((t) => t.compId === c.id).length;
    return competitionTeamCount(c) === n ? c : { ...c, teamCount: n };
  });
  const removed = live.filter((c) => !competitions.some((k) => k.id === c.id));

  return {
    competitions,
    retired: [...input.retired, ...removed],
    teams,
    players,
    activeLoans,
    nextPid,
    defunct,
    dissolved,
    created,
  };
}
