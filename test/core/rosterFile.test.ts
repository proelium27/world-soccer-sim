import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { applyTeamIdentities } from "../../src/core/teams/customize.js";
import {
  buildRosterFile,
  parseRosterFile,
  rosterFileToEdits,
  isRosterFileFormat,
  combineRosterFiles,
  resolveRosterSlots,
  retargetRosterFile,
  ROSTER_FILE_FORMAT,
} from "../../src/core/teams/rosterFile.js";

const base = makeLeague(0, 7, 7);
// NewLeague names the league after the user's club; mirror that.
const league = { ...base, meta: { ...base.meta, name: base.teams[0].name } };

describe("buildRosterFile", () => {
  it("emits one competition entry per league competition, in table order", () => {
    const file = buildRosterFile(league);
    expect(file.format).toBe("world-soccer-sim-roster");
    expect(file.formatVersion).toBe(1);
    expect(file.competitions.map((c) => c.match)).toEqual(
      league.competitions.map((c) => c.name),
    );
  });

  it("lists each competition's clubs in ascending-tid slot order", () => {
    const file = buildRosterFile(league);
    for (const comp of league.competitions) {
      const entry = file.competitions.find((c) => c.match === comp.name)!;
      const expected = league.teams
        .filter((t) => t.compId === comp.id)
        .sort((a, b) => a.tid - b.tid)
        .map((t) => t.name);
      expect(entry.clubs.map((c) => c.name)).toEqual(expected);
    }
  });
});

describe("roundtrip (export -> apply)", () => {
  it("export then re-import leaves every identity unchanged", () => {
    const file = buildRosterFile(league);
    const { edits, warnings } = rosterFileToEdits(league, file);
    expect(warnings).toEqual([]);
    const updated = applyTeamIdentities(league, edits);
    for (const t of updated.teams) {
      expect(t.name).toBe(league.teams[t.tid].name);
      expect(t.abbrev).toBe(league.teams[t.tid].abbrev);
      expect(t.colors).toEqual(league.teams[t.tid].colors);
    }
  });
});

describe("rosterFileToEdits", () => {
  it("maps clubs positionally onto the matched competition's slots", () => {
    const comp = league.competitions[0];
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          {
            match: comp.name,
            clubs: [
              { name: "Real Club", abbrev: "rcl", colors: ["#111111", "#222222"] },
              { name: "Second Club", abbrev: "SEC", colors: ["#333333", "#444444"] },
            ],
          },
        ],
      }),
    );
    const { edits, warnings } = rosterFileToEdits(league, file);
    expect(warnings).toEqual([]);
    const slots = league.teams
      .filter((t) => t.compId === comp.id)
      .sort((a, b) => a.tid - b.tid);
    expect(edits[0].tid).toBe(slots[0].tid);
    expect(edits[0].name).toBe("Real Club");
    expect(edits[1].tid).toBe(slots[1].tid);

    // Only the two named slots are touched once applied.
    const updated = applyTeamIdentities(league, edits);
    expect(updated.teams[slots[0].tid].name).toBe("Real Club");
    expect(updated.teams[slots[0].tid].abbrev).toBe("RCL"); // applyTeamIdentities uppercases
    expect(updated.teams[slots[2].tid].name).toBe(league.teams[slots[2].tid].name);
  });

  it("matches competition names case-insensitively", () => {
    const comp = league.competitions[0];
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          { match: comp.name.toUpperCase(), clubs: [{ name: "X", abbrev: "X", colors: ["#000000", "#ffffff"] }] },
        ],
      }),
    );
    const { edits, warnings } = rosterFileToEdits(league, file);
    expect(warnings).toEqual([]);
    expect(edits).toHaveLength(1);
  });

  it("warns and skips an unknown competition name", () => {
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          { match: "Martian Premier League", clubs: [{ name: "X", abbrev: "X", colors: ["#000000", "#ffffff"] }] },
        ],
      }),
    );
    const { edits, warnings } = rosterFileToEdits(league, file);
    expect(edits).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Martian Premier League");
  });

  it("warns and ignores clubs beyond the competition's slot count", () => {
    const comp = league.competitions[0];
    const slotCount = league.teams.filter((t) => t.compId === comp.id).length;
    const clubs = Array.from({ length: slotCount + 3 }, (_, i) => ({
      name: `Club ${i}`,
      abbrev: `C${i}`,
      colors: ["#000000", "#ffffff"] as [string, string],
    }));
    const file = parseRosterFile(
      JSON.stringify({ format: "world-soccer-sim-roster", formatVersion: 1, competitions: [{ match: comp.name, clubs }] }),
    );
    const { edits, warnings } = rosterFileToEdits(league, file);
    expect(edits).toHaveLength(slotCount);
    expect(warnings.some((w) => w.includes("ignored"))).toBe(true);
  });
});

describe("parseRosterFile validation", () => {
  it("rejects non-JSON", () => {
    expect(() => parseRosterFile("not json")).toThrow(/not valid JSON/);
  });
  it("rejects a wrong format tag", () => {
    expect(() => parseRosterFile(JSON.stringify({ format: "nope", formatVersion: 1, competitions: [] }))).toThrow(/format/);
  });

  // The format announced itself as "soccer-gm-roster" before the game settled
  // on its name. Files carrying it are already in people's hands, so they have
  // to keep loading — only what we WRITE changed.
  it("still reads a file written before the rename", () => {
    const file = parseRosterFile(
      JSON.stringify({
        format: "soccer-gm-roster",
        formatVersion: 1,
        competitions: [
          { match: "English Division 1", clubs: [{ name: "Old File FC", abbrev: "OLD", colors: ["#111111", "#eeeeee"] }] },
        ],
      }),
    );
    expect(file.competitions[0].clubs[0].name).toBe("Old File FC");
    // Parsing upgrades the tag, so anything re-serialized carries the new one.
    expect(file.format).toBe(ROSTER_FILE_FORMAT);
  });

  it("recognizes both format tags, and nothing else", () => {
    expect(isRosterFileFormat(ROSTER_FILE_FORMAT)).toBe(true);
    expect(isRosterFileFormat("soccer-gm-roster")).toBe(true);
    expect(isRosterFileFormat("nope")).toBe(false);
    // An exported save has no `format` field at all — this is what the Leagues
    // page's Import button relies on to tell the two files apart.
    expect(isRosterFileFormat(undefined)).toBe(false);
  });
  it("rejects an unsupported version", () => {
    expect(() => parseRosterFile(JSON.stringify({ format: "world-soccer-sim-roster", formatVersion: 99, competitions: [] }))).toThrow(/version/);
  });
  it("rejects a missing competitions array", () => {
    expect(() => parseRosterFile(JSON.stringify({ format: "world-soccer-sim-roster", formatVersion: 1 }))).toThrow(/competitions/);
  });
  it("names the offending path on a malformed club", () => {
    expect(() =>
      parseRosterFile(
        JSON.stringify({
          format: "world-soccer-sim-roster",
          formatVersion: 1,
          competitions: [{ match: "English Division 1", clubs: [{ name: "ok", abbrev: "OK", colors: ["#000000"] }] }],
        }),
      ),
    ).toThrow(/competitions\[0\]\.clubs\[0\]\.colors/);
  });
});

describe("combineRosterFiles", () => {
  const fileFor = (match: string, clubName: string, players?: unknown[]) =>
    parseRosterFile(
      JSON.stringify({
        format: ROSTER_FILE_FORMAT,
        formatVersion: 1,
        competitions: [
          {
            match,
            clubs: [{ name: clubName, abbrev: "ABC", colors: ["#000000", "#ffffff"], players }],
          },
        ],
      }),
    );

  it("keeps every competition, in load order, when files cover different leagues", () => {
    const { file, warnings } = combineRosterFiles([
      { name: "england 1.json", file: fileFor("English Division 1", "Eng One") },
      { name: "england 2.json", file: fileFor("English Division 2", "Eng Two") },
      { name: "spain 1.json", file: fileFor("Spanish Division 1", "Spa One") },
    ]);
    expect(file.competitions.map((c) => c.match)).toEqual([
      "English Division 1",
      "English Division 2",
      "Spanish Division 1",
    ]);
    expect(warnings).toEqual([]);
  });

  it("carries squads through untouched", () => {
    const players = [{ name: "Star", pos: "ST", age: 25, overall: 85 }];
    const { file } = combineRosterFiles([
      { name: "a.json", file: fileFor("English Division 1", "With Squad", players) },
      { name: "b.json", file: fileFor("Spanish Division 1", "No Squad") },
    ]);
    expect(file.competitions[0].clubs[0].players).toHaveLength(1);
    expect(file.competitions[0].clubs[0].players![0].name).toBe("Star");
    expect(file.competitions[1].clubs[0].players).toBeUndefined();
  });

  it("lets a later file win a competition an earlier one already covered, and says so", () => {
    const { file, warnings } = combineRosterFiles([
      { name: "old.json", file: fileFor("English Division 1", "Old Name") },
      { name: "new.json", file: fileFor("english division 1", "New Name") },
    ]);
    expect(file.competitions).toHaveLength(1);
    expect(file.competitions[0].clubs[0].name).toBe("New Name");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("old.json");
    expect(warnings[0]).toContain("new.json");
  });

  it("holds a replaced competition's original position in the order", () => {
    const { file } = combineRosterFiles([
      { name: "a.json", file: fileFor("English Division 1", "First") },
      { name: "b.json", file: fileFor("Spanish Division 1", "Second") },
      { name: "c.json", file: fileFor("English Division 1", "Redo") },
    ]);
    expect(file.competitions.map((c) => c.match)).toEqual([
      "English Division 1",
      "Spanish Division 1",
    ]);
    expect(file.competitions[0].clubs[0].name).toBe("Redo");
  });

  /** One competition of several clubs; `squad` names the clubs that get a player. */
  const clubsFile = (match: string, names: string[], squad: string[] = []) =>
    parseRosterFile(
      JSON.stringify({
        format: ROSTER_FILE_FORMAT,
        formatVersion: 1,
        competitions: [
          {
            match,
            clubs: names.map((n) => ({
              name: n,
              abbrev: n.slice(0, 3).toUpperCase(),
              colors: ["#000000", "#ffffff"],
              ...(squad.includes(n)
                ? { players: [{ name: `${n} Star`, pos: "ST", age: 25, overall: 80 }] }
                : {}),
            })),
          },
        ],
      }),
    );

  // The Leagues page offers a names-only file and a squads file side by side.
  // Under plain later-wins, loading the names file second replaced every real
  // squad with generated players, and a multi-file picker doesn't let the
  // player choose the order.
  it("keeps the squads whichever order a squads file and a names-only file come in", () => {
    const squads = clubsFile("English Division 1", ["Alpha", "Beta"], ["Alpha", "Beta"]);
    const names = clubsFile("English Division 1", ["Alpha", "Beta", "Gamma"]);
    for (const files of [
      [{ name: "squads.json", file: squads }, { name: "names.json", file: names }],
      [{ name: "names.json", file: names }, { name: "squads.json", file: squads }],
    ]) {
      const { file, warnings } = combineRosterFiles(files);
      const clubs = file.competitions[0].clubs;
      expect(clubs.map((c) => c.name)).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(clubs[0].players).toHaveLength(1);
      expect(clubs[1].players).toHaveLength(1);
      expect(clubs[2].players).toBeUndefined();
      expect(warnings).toEqual([]);
    }
  });

  it("tops a squads list up only with clubs it doesn't already name", () => {
    const { file } = combineRosterFiles([
      { name: "squads.json", file: clubsFile("English Division 1", ["Alpha"], ["Alpha"]) },
      { name: "names.json", file: clubsFile("English Division 1", ["Gamma", "ALPHA"]) },
    ]);
    expect(file.competitions[0].clubs.map((c) => c.name)).toEqual(["Alpha", "Gamma"]);
  });

  it("still lets the later of two squads files win, and says so", () => {
    const { file, warnings } = combineRosterFiles([
      { name: "old.json", file: clubsFile("English Division 1", ["Old"], ["Old"]) },
      { name: "new.json", file: clubsFile("English Division 1", ["New"], ["New"]) },
    ]);
    expect(file.competitions[0].clubs.map((c) => c.name)).toEqual(["New"]);
    expect(warnings).toHaveLength(1);
  });

  it("treats two names-only lists as agreeing when one only runs longer", () => {
    const short = clubsFile("English Division 1", ["Alpha", "Beta"]);
    const long = clubsFile("English Division 1", ["Alpha", "Beta", "Gamma"]);
    for (const files of [
      [{ name: "short.json", file: short }, { name: "long.json", file: long }],
      [{ name: "long.json", file: long }, { name: "short.json", file: short }],
    ]) {
      const { file, warnings } = combineRosterFiles(files);
      expect(file.competitions[0].clubs.map((c) => c.name)).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(warnings).toEqual([]);
    }
  });

  it("combines to an empty (but valid) file when handed nothing", () => {
    const { file, warnings } = combineRosterFiles([]);
    expect(file.format).toBe(ROSTER_FILE_FORMAT);
    expect(file.competitions).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("resolves a combined file onto the slots of every league it covers", () => {
    const { file } = combineRosterFiles([
      { name: "england 1.json", file: fileFor(league.competitions[0].name, "Eng One") },
      { name: "england 2.json", file: fileFor(league.competitions[1].name, "Eng Two") },
    ]);
    const { slots, warnings } = resolveRosterSlots(league, file);
    expect(warnings).toEqual([]);
    expect(slots).toHaveLength(2);
    expect(new Set(slots.map((s) => s.tid)).size).toBe(2);
    expect(slots.map((s) => s.club.name)).toEqual(["Eng One", "Eng Two"]);
  });
});

describe("the top-level nationalities block", () => {
  const withNats = (nationalities: unknown) => JSON.stringify({
    format: ROSTER_FILE_FORMAT,
    formatVersion: 1,
    competitions: [],
    nationalities,
  });

  it("is read when present", () => {
    const file = parseRosterFile(withNats({ Netherlands: 60, Belgium: 40 }));
    expect(file.nationalities).toEqual({ Netherlands: 60, Belgium: 40 });
  });

  it("is absent, not empty, when the file omits it", () => {
    const file = parseRosterFile(JSON.stringify({
      format: ROSTER_FILE_FORMAT, formatVersion: 1, competitions: [],
    }));
    expect(file.nationalities).toBeUndefined();
  });

  it("drops a nation the game has no names for rather than failing the file", () => {
    // These files are usually AI-written; one invented country shouldn't cost
    // the author the forty that were right.
    const file = parseRosterFile(withNats({ Netherlands: 60, Wakanda: 40 }));
    expect(file.nationalities).toEqual({ Netherlands: 60 });
  });

  it("goes absent when nothing in it was usable", () => {
    expect(parseRosterFile(withNats({ Wakanda: 40 })).nationalities).toBeUndefined();
  });

  it("rejects a wrong shape, which is an authoring mistake worth reporting", () => {
    expect(() => parseRosterFile(withNats(["Netherlands"]))).toThrow(/nationalities/);
    expect(() => parseRosterFile(withNats({ Netherlands: "lots" }))).toThrow(/Netherlands/);
  });

  it("survives retargeting onto a league invented after the file was written", () => {
    const file = parseRosterFile(JSON.stringify({
      format: ROSTER_FILE_FORMAT,
      formatVersion: 1,
      competitions: [{ match: "Whatever League", clubs: [] }],
      nationalities: { Japan: 100 },
    }));
    const { file: retargeted } = retargetRosterFile(file, ["Atlantis Division 1"]);
    expect(retargeted.competitions[0].match).toBe("Atlantis Division 1");
    expect(retargeted.nationalities).toEqual({ Japan: 100 });
  });
});
