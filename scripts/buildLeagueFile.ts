/**
 * Fold the three separately published roster downloads into ONE league file:
 *
 *   npx tsx scripts/buildLeagueFile.ts <names.json> <players.json> <badges.json> <out.json>
 *
 * - names:   every club's name, abbreviation and colours, every division (the
 *            "Real club names" download). This is the BASE, because it is the
 *            one written for the current world's division sizes.
 * - players: real squads (the "Real clubs and players" download). Squads are
 *            attached to the names file's clubs by NAME within the same
 *            country, never by slot: the two files were built for worlds with
 *            different division sizes, so the same slot can hold a different
 *            club in each, and a club promoted between the two builds sits in
 *            a different division.
 * - badges:  a logo pack (the "Real club badges" download), attached to each
 *            club by the same name match the game uses (resolveLogoPack), so a
 *            club gets exactly the badge the in-game pack loader would give it.
 *
 * Dev-only, like the EA FC converter: the output carries real club names and
 * badges and is never committed. It checks the result against the shipped
 * world and prints what landed, so a file that half-applies says so here
 * rather than on someone's New League screen.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  parseRosterFile,
  resolveRosterSlots,
  competitionRef,
  type RosterFile,
  type RosterFileClub,
} from "../src/core/teams/rosterFile.js";
import { parseLogoPack, resolveLogoPack, normalizeClubName } from "../src/core/teams/logoPack.js";
import { describeRosterContents } from "../src/core/teams/leagueFile.js";
import { worldCompetitions, worldTeamSlots } from "../src/core/competitions.js";

const [namesPath, playersPath, badgesPath, outPath] = process.argv.slice(2);
if (!namesPath || !playersPath || !badgesPath || !outPath) {
  console.error("usage: buildLeagueFile.ts <names.json> <players.json> <badges.json> <out.json>");
  process.exit(1);
}

const names = parseRosterFile(readFileSync(namesPath, "utf8"));
const players = parseRosterFile(readFileSync(playersPath, "utf8"));
const pack = parseLogoPack(readFileSync(badgesPath, "utf8"));

const countryOf = (comp: RosterFile["competitions"][number]) => competitionRef(comp)?.country ?? comp.match;

// Every club in the players file that carries a squad, by country + name.
const squads = new Map<string, RosterFileClub>();
for (const comp of players.competitions) {
  for (const club of comp.clubs) {
    if (!club.players?.length) continue;
    squads.set(`${countryOf(comp)}|${normalizeClubName(club.name)}`, club);
  }
}

// Badges: resolve the pack against a flat list of every club in the base file,
// numbered in file order, exactly as the game would against a world's clubs.
const flat = names.competitions.flatMap((comp) => comp.clubs);
const { byTid: logoByIndex, unmatched } = resolveLogoPack(
  flat.map((c, i) => ({ tid: i, name: c.name, abbrev: c.abbrev })),
  pack,
);

let index = 0;
const usedSquads = new Set<RosterFileClub>();
const out: RosterFile = {
  ...names,
  // The squads are the only rated thing in the file, so their scale is the file's.
  ...(players.ovrScale !== undefined ? { ovrScale: players.ovrScale } : {}),
  competitions: names.competitions.map((comp) => ({
    ...comp,
    clubs: comp.clubs.map((club) => {
      const squad = squads.get(`${countryOf(comp)}|${normalizeClubName(club.name)}`);
      if (squad) usedSquads.add(squad);
      const logo = logoByIndex.get(index++);
      return {
        name: club.name,
        abbrev: club.abbrev,
        colors: club.colors,
        ...(squad ? { players: squad.players } : {}),
        ...(logo ? { logo } : {}),
      };
    }),
  })),
};

writeFileSync(outPath, JSON.stringify(out));

// Everything below is the check, not the build.
const reread = parseRosterFile(readFileSync(outPath, "utf8"));
const contents = describeRosterContents(reread);
const world = { competitions: worldCompetitions(), teams: [] as { tid: number; compId: number }[] };
world.teams = worldTeamSlots(world.competitions);
const { slots, warnings } = resolveRosterSlots(world, reread);

const droppedSquads = [...squads.values()].filter((c) => !usedSquads.has(c)).map((c) => c.name);
console.log(`wrote ${outPath} (${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
console.log(`  ${contents.competitions.length} divisions, ${contents.clubs} clubs, ${contents.squads} with squads, ${contents.logos} with badges`);
console.log(`  lands on ${slots.length} of ${world.teams.length} clubs in the shipped world`);
if (warnings.length) console.log("  placement warnings:\n   ", warnings.join("\n    "));
console.log(`  squads in the players file with no club of that name here: ${droppedSquads.length}`, droppedSquads.slice(0, 20));
console.log(`  badges in the pack matching no club: ${unmatched.length}`, unmatched.slice(0, 20));
