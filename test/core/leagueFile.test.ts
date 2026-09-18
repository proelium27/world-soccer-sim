import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { parseRosterFile, resolveRosterSlots, type RosterFile } from "../../src/core/teams/rosterFile.js";
import { applyRosterFile } from "../../src/core/teams/rosterImport.js";
import {
  DEFAULT_IMPORT_SELECTION,
  buildLeagueFile,
  clubLogosByTid,
  competitionKey,
  describeRosterContents,
  identityOptions,
  selectFromRosterFile,
  unplaceableCompetitions,
  type ImportSelection,
} from "../../src/core/teams/leagueFile.js";
import { OVR_SCALE_SHIFT } from "../../src/core/constants.js";

// The same cached world rosterImport.test.ts uses, so no new fixture is built.
const league = makeLeague(0, 11, 11);

const d1 = league.competitions.find((c) => c.name === "English Division 1")!;
const d2 = league.competitions.find((c) => c.name === "English Division 2")!;
const slotsOf = (compId: number) =>
  league.teams.filter((t) => t.compId === compId).sort((a, b) => a.tid - b.tid);
const d1Slot0 = slotsOf(d1.id)[0]!;
const d2Slot0 = slotsOf(d2.id)[0]!;

// A real, decodable 1x1 PNG. What matters to the parser is the shape.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function twoLeagueFile(): RosterFile {
  return parseRosterFile(JSON.stringify({
    format: "world-soccer-sim-roster",
    formatVersion: 1,
    ovrScale: OVR_SCALE_SHIFT,
    competitions: [
      {
        match: "English Division 1",
        clubs: [{
          name: "Top Import", abbrev: "TOP", colors: ["#111111", "#eeeeee"], logo: PNG,
          players: [{ name: "Ada Striker", pos: "ST", age: 25, overall: 80 }],
        }],
      },
      {
        match: "English Division 2",
        clubs: [{ name: "Second Import", abbrev: "SEC", colors: ["#222222", "#dddddd"] }],
      },
    ],
  }));
}

const sel = (patch: Partial<ImportSelection>): ImportSelection => ({ ...DEFAULT_IMPORT_SELECTION, ...patch });

describe("club logos in a roster file", () => {
  it("keeps an image data URL", () => {
    expect(twoLeagueFile().competitions[0]!.clubs[0]!.logo).toBe(PNG);
  });

  it("drops anything else without rejecting the file", () => {
    for (const logo of ["https://example.com/a.png", "data:text/html;base64,PGgxPg==", 42, "data:image/svg+xml;base64,PHN2Zz4="]) {
      const file = parseRosterFile(JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [{ match: "English Division 1", clubs: [{ name: "X", abbrev: "X", colors: ["#000", "#fff"], logo }] }],
      }));
      expect(file.competitions[0]!.clubs[0]!.logo).toBeUndefined();
      expect(file.competitions[0]!.clubs[0]!.name).toBe("X");
    }
  });

  it("puts each badge on the slot its club lands on", () => {
    const { slots } = resolveRosterSlots(league, twoLeagueFile());
    expect([...clubLogosByTid(slots)]).toEqual([[d1Slot0.tid, PNG]]);
  });
});

describe("describeRosterContents", () => {
  it("counts what each league in the file holds", () => {
    const c = describeRosterContents(twoLeagueFile());
    expect(c.competitions.map((x) => [x.key, x.clubs, x.squads, x.logos])).toEqual([
      ["english division 1", 1, 1, 1],
      ["english division 2", 1, 0, 0],
    ]);
    expect([c.clubs, c.squads, c.logos]).toEqual([2, 1, 1]);
  });
});

describe("selectFromRosterFile", () => {
  it("is the identity for the default selection", () => {
    const file = twoLeagueFile();
    expect(selectFromRosterFile(file, DEFAULT_IMPORT_SELECTION)).toEqual(file);
  });

  it("drops an unticked league", () => {
    const out = selectFromRosterFile(twoLeagueFile(), sel({ excluded: new Set(["english division 2"]) }));
    expect(out.competitions.map(competitionKey)).toEqual(["english division 1"]);
  });

  it("strips squads and badges when their boxes are clear", () => {
    const club = selectFromRosterFile(twoLeagueFile(), sel({ squads: false, logos: false })).competitions[0]!.clubs[0]!;
    expect(club.players).toBeUndefined();
    expect(club.logo).toBeUndefined();
    expect(club.name).toBe("Top Import");
  });
});

describe("unplaceableCompetitions", () => {
  it("names the leagues this world has nowhere to put", () => {
    const file: RosterFile = {
      ...twoLeagueFile(),
      competitions: [
        ...twoLeagueFile().competitions,
        { match: "Eredivisie Plus", clubs: [{ name: "Nowhere", abbrev: "NOW", colors: ["#000", "#fff"] }] },
      ],
    };
    expect([...unplaceableCompetitions(league, file)]).toEqual(["eredivisie plus"]);
  });
});

describe("applyRosterFile with identity options", () => {
  it("keeps the slot's name, and its built-in badge, when names are unticked", () => {
    const file = selectFromRosterFile(twoLeagueFile(), sel({ names: false }));
    const out = applyRosterFile(league, file, identityOptions(sel({ names: false }))).league;
    const team = out.teams.find((t) => t.tid === d1Slot0.tid)!;
    expect(team.name).toBe(d1Slot0.name);
    expect(team.abbrev).toBe(d1Slot0.abbrev);
    expect(team.colors).toEqual(["#111111", "#eeeeee"]);
    expect(team.importedIdentity).toBeUndefined();
    // The squad still came across.
    expect(out.players.some((p) => p.name === "Ada Striker" && team.roster.includes(p.pid))).toBe(true);
  });

  it("keeps the slot's colors when colors are unticked", () => {
    const out = applyRosterFile(league, twoLeagueFile(), identityOptions(sel({ colors: false }))).league;
    const team = out.teams.find((t) => t.tid === d2Slot0.tid)!;
    expect(team.name).toBe("Second Import");
    expect(team.colors).toEqual(d2Slot0.colors);
    expect(team.importedIdentity).toBe(true);
  });
});

describe("buildLeagueFile", () => {
  // A copy of the world with one club renamed and badged, exported, then
  // imported onto the untouched world: everything that was changed must come
  // back, and a squad must come back as the same players.
  const renamed = {
    ...league,
    teams: league.teams.map((t) =>
      t.tid === d1Slot0.tid ? { ...t, name: "Exported FC", abbrev: "EXP", colors: ["#123456", "#654321"] as [string, string] } : t,
    ),
  };
  const crests = new Map([[d1Slot0.tid, PNG]]);

  it("round-trips names, colors, badges and squads through Import", () => {
    const text = JSON.stringify(buildLeagueFile(renamed, crests, { squads: true, logos: true }));
    const file = parseRosterFile(text);
    expect(file.ovrScale).toBe(OVR_SCALE_SHIFT);

    const { slots } = resolveRosterSlots(league, file);
    expect(clubLogosByTid(slots).get(d1Slot0.tid)).toBe(PNG);

    const out = applyRosterFile(league, file).league;
    const team = out.teams.find((t) => t.tid === d1Slot0.tid)!;
    expect([team.name, team.abbrev, team.colors]).toEqual(["Exported FC", "EXP", ["#123456", "#654321"]]);

    const byPid = (l: typeof league) => new Map(l.players.map((p) => [p.pid, p]));
    const squad = (l: typeof league, tid: number) => {
      const map = byPid(l);
      return l.teams.find((t) => t.tid === tid)!.roster
        .map((pid) => map.get(pid)!)
        .map((p) => `${p.name}|${p.pos}|${p.ovr}`)
        .sort();
    };
    expect(squad(out, d1Slot0.tid)).toEqual(squad(league, d1Slot0.tid));
  });

  it("leaves squads and badges out when asked to", () => {
    const file = buildLeagueFile(renamed, crests, { squads: false, logos: false });
    const contents = describeRosterContents(file);
    expect(contents.squads).toBe(0);
    expect(contents.logos).toBe(0);
    expect(contents.clubs).toBe(league.teams.length);
  });
});
