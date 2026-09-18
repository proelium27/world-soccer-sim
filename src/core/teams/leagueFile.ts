import type { LeagueStore } from "../leagueState.js";
import type { Player } from "../players/types.js";
import { OVR_SCALE_SHIFT, ROSTER_FILE_AGE_MIN, ROSTER_FILE_AGE_MAX } from "../constants.js";
import {
  buildRosterFile,
  resolveRosterSlots,
  type RosterFile,
  type RosterFileCompetition,
  type RosterFilePlayer,
  type RosterSlot,
} from "./rosterFile.js";
import type { RosterIdentityOptions } from "./rosterImport.js";

/**
 * One file for a whole world's look and squads: the "league file".
 *
 * It is not a new format. It is the roster file (rosterFile.ts) with each club
 * optionally carrying its own `logo`, so every roster file already in people's
 * hands, the hosted real-rosters file included, is a league file that happens
 * to have no badges. That is what lets import and export share one parser and
 * one importer instead of growing a second pair.
 *
 * What this module adds is the Basketball GM part: a checklist of what to take
 * from a file (names, colours, squads, badges, and which leagues), applied as a
 * pure transform before the ordinary import runs, plus the writer that turns a
 * save back into such a file.
 */

/** What the import checklist has ticked. */
export interface ImportSelection {
  /** Club names and abbreviations. */
  names: boolean;
  colors: boolean;
  squads: boolean;
  logos: boolean;
  /**
   * Leagues left OUT, by competitionKey. Stored as exclusions rather than
   * inclusions so a league from a file loaded later arrives ticked, the way
   * everything in a freshly loaded file does.
   */
  excluded: ReadonlySet<string>;
}

export const DEFAULT_IMPORT_SELECTION: ImportSelection = {
  names: true,
  colors: true,
  squads: true,
  logos: true,
  excluded: new Set(),
};

/**
 * The identity of a file competition for the checklist. Deliberately the same
 * key combineRosterFiles folds duplicates on, so one checkbox is one entry of
 * the combined file.
 */
export function competitionKey(comp: Pick<RosterFileCompetition, "match">): string {
  return comp.match.trim().toLowerCase();
}

export interface CompetitionContents {
  key: string;
  match: string;
  country?: string;
  tier?: number;
  clubs: number;
  /** Clubs in this competition that carry a squad. */
  squads: number;
  /** Clubs in this competition that carry a badge. */
  logos: number;
}

export interface RosterFileContents {
  competitions: CompetitionContents[];
  clubs: number;
  squads: number;
  logos: number;
}

/**
 * What a file holds, per competition and in total, so the checklist only
 * offers what is really there: a box for squads in a names-only file would be
 * a control that does nothing.
 */
export function describeRosterContents(file: RosterFile): RosterFileContents {
  const competitions = file.competitions.map((comp): CompetitionContents => ({
    key: competitionKey(comp),
    match: comp.match,
    ...(comp.country ? { country: comp.country } : {}),
    ...(comp.tier ? { tier: comp.tier } : {}),
    clubs: comp.clubs.length,
    squads: comp.clubs.filter((c) => c.players && c.players.length > 0).length,
    logos: comp.clubs.filter((c) => c.logo).length,
  }));
  const sum = (k: "clubs" | "squads" | "logos") => competitions.reduce((n, c) => n + c[k], 0);
  return { competitions, clubs: sum("clubs"), squads: sum("squads"), logos: sum("logos") };
}

/**
 * Which of a file's competitions this world has somewhere to put. The rest are
 * shown on the checklist but can't be ticked, since resolveRosterSlots would
 * skip them anyway and a live checkbox that imports nothing reads as a bug.
 */
export function unplaceableCompetitions(
  world: Parameters<typeof resolveRosterSlots>[0],
  file: RosterFile,
): Set<string> {
  const out = new Set<string>();
  for (const comp of file.competitions) {
    const { slots } = resolveRosterSlots(world, { ...file, competitions: [comp] });
    if (slots.length === 0) out.add(competitionKey(comp));
  }
  return out;
}

/**
 * The file as the checklist leaves it: excluded leagues gone, squads and badges
 * stripped when their boxes are clear. Names and colours are not stripped here
 * (they are required on a club entry) and travel as identityOptions instead.
 * Pure, and the identity for the default selection, so an untouched checklist
 * imports exactly what the file says.
 */
export function selectFromRosterFile(file: RosterFile, selection: ImportSelection): RosterFile {
  return {
    ...file,
    competitions: file.competitions
      .filter((comp) => !selection.excluded.has(competitionKey(comp)))
      .map((comp) => ({
        ...comp,
        clubs: comp.clubs.map((club) => {
          const { players, logo, ...rest } = club;
          return {
            ...rest,
            ...(selection.squads && players ? { players } : {}),
            ...(selection.logos && logo ? { logo } : {}),
          };
        }),
      })),
  };
}

export function identityOptions(selection: ImportSelection): RosterIdentityOptions {
  return { names: selection.names, colors: selection.colors };
}

/**
 * The badges a resolved file puts on each slot. Keyed straight off the slot a
 * club landed on, so no name matching is involved: this works whether or not
 * the club's name was imported too.
 */
export function clubLogosByTid(slots: readonly RosterSlot[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const { tid, club } of slots) {
    if (club.logo) out.set(tid, club.logo);
  }
  return out;
}

export interface LeagueFileExportOptions {
  /** Include every club's senior squad. Off gives a names-and-colours file. */
  squads: boolean;
  /** Include the save's custom badges. */
  logos: boolean;
}

function exportPlayer(p: Player, season: number): RosterFilePlayer {
  return {
    name: p.name,
    pos: p.pos,
    // The parser refuses an age outside this range, so a 14-year-old academy
    // graduate on a senior roster would otherwise make the whole file unreadable.
    age: Math.max(ROSTER_FILE_AGE_MIN, Math.min(ROSTER_FILE_AGE_MAX, season - p.born)),
    nationality: p.nationality,
    heightCm: p.heightCm,
    potential: p.potential,
    ratings: { ...p.ratings },
  };
}

/**
 * Turn a save into a league file someone else can start a league from.
 *
 * Built on buildRosterFile, so the competitions carry their country and tier
 * as well as their names and a file survives the reader having renamed their
 * divisions. Squads are exported with exact ratings (not an overall) so a
 * player comes back as the same player, and the file is stamped with the
 * current rating scale, which `ratings` needs: an unstamped file is read
 * literally, which is right today and wrong the day the scale moves again.
 *
 * Only the SENIOR roster is exported. The academy is the user's own pipeline
 * and has no equivalent on a club the reader picks up; a roster file's
 * players are the squad a club starts with.
 *
 * `crests` is the save's custom badge store (crestDb). The shipped crest art is
 * not included: it is bundled with the game and keyed by slot, so a reader of
 * the file already has it for every fictional club it would describe.
 */
export function buildLeagueFile(
  league: LeagueStore,
  crests: ReadonlyMap<number, string>,
  options: LeagueFileExportOptions,
): RosterFile {
  const base = buildRosterFile(league);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const teamsByComp = new Map<number, LeagueStore["teams"]>();
  for (const t of [...league.teams].sort((a, b) => a.tid - b.tid)) {
    const list = teamsByComp.get(t.compId);
    if (list) list.push(t);
    else teamsByComp.set(t.compId, [t]);
  }

  return {
    ...base,
    ovrScale: OVR_SCALE_SHIFT,
    competitions: base.competitions.map((comp, i) => {
      // buildRosterFile emits one entry per competition in table order, with
      // clubs in ascending tid, so entry i's clubs line up with this list.
      const teams = teamsByComp.get(league.competitions[i]!.id) ?? [];
      return {
        ...comp,
        clubs: comp.clubs.map((club, k) => {
          const team = teams[k];
          if (!team) return club;
          const logo = options.logos ? crests.get(team.tid) : undefined;
          const players = options.squads
            ? team.roster
              .map((pid) => byPid.get(pid))
              .filter((p): p is Player => p !== undefined)
              .map((p) => exportPlayer(p, league.season))
            : undefined;
          return {
            ...club,
            ...(players && players.length > 0 ? { players } : {}),
            ...(logo ? { logo } : {}),
          };
        }),
      };
    }),
  };
}
