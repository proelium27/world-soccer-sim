import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import {
  encodeLeagueFile,
  importLeagueJSON,
  readLeagueFileText,
} from "../../src/db/exportImport.js";
import { buildRosterFile } from "../../src/core/teams/rosterFile.js";

/** A stand-in for the browser File the import UI hands over. */
function jsonFile(name: string, value: unknown): File {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return new File([text], name, { type: "application/json" });
}

/** The file the export button now writes: compact JSON, gzipped. */
async function exportedFile(league: unknown): Promise<File> {
  const bytes = await encodeLeagueFile(league as never);
  return new File([bytes], "save.json.gz", { type: "application/gzip" });
}

describe("encodeLeagueFile", () => {
  it("writes gzip, not plain text", async () => {
    const bytes = await encodeLeagueFile(makeLeague(0, 1));
    // The two-byte gzip magic number. Import sniffs for exactly this, so if the
    // encoder ever stops emitting it, every export silently becomes unreadable.
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  });

  it("writes compact JSON, not the pretty-printed form", async () => {
    // Half the old file was indentation whitespace. Nothing reads the export as
    // formatted text, so the indentation was pure cost.
    const league = makeLeague(0, 1);
    const text = await readLeagueFileText(await exportedFile(league));
    expect(text).toBe(JSON.stringify(league));
  });

  it("is dramatically smaller than the pretty-printed JSON it replaces", async () => {
    const league = makeLeague(0, 1);
    const before = JSON.stringify(league, null, 2).length;
    const after = (await encodeLeagueFile(league)).length;
    expect(after).toBeLessThan(before / 5);
  });
});

describe("readLeagueFileText", () => {
  it("passes an uncompressed file through unchanged", async () => {
    const text = await readLeagueFileText(jsonFile("plain.json", { a: 1 }));
    expect(text).toBe('{"a":1}');
  });

  it("decompresses a gzipped file", async () => {
    const gz = await encodeLeagueFile({ a: 1 } as never);
    const text = await readLeagueFileText(new File([gz], "x.json.gz"));
    expect(text).toBe('{"a":1}');
  });
});

describe("importLeagueJSON", () => {
  it("round-trips a gzipped save export", async () => {
    const league = makeLeague(0, 1);
    const { league: imported } = await importLeagueJSON(await exportedFile(league));
    expect(imported.meta.name).toBe(league.meta.name);
    expect(imported.season).toBe(league.season);
    expect(imported.players).toHaveLength(league.players.length);
    expect(imported.teams).toHaveLength(league.teams.length);
  });

  it("still reads an uncompressed save exported by an older build", async () => {
    const league = makeLeague(0, 1);
    const { league: imported } = await importLeagueJSON(jsonFile("save.json", league));
    expect(imported.meta.name).toBe(league.meta.name);
    expect(imported.meta.userTid).toBe(league.meta.userTid);
    expect(imported.season).toBe(league.season);
    expect(imported.players).toHaveLength(league.players.length);
    expect(imported.teams).toHaveLength(league.teams.length);
  });

  it("names the mix-up when handed a roster file instead of a saved game", async () => {
    // Reachable from the New League screen's "Import League", which takes only
    // a save. Before, this surfaced as a confusing 'missing "players" array'.
    const rosterFile = buildRosterFile(makeLeague(0, 1));
    await expect(
      importLeagueJSON(jsonFile("soccer-gm-teams-england.json", rosterFile)),
    ).rejects.toThrow(/roster file, not a saved game/i);
  });

  it("recognizes a roster file written before the format was renamed", async () => {
    // Files carrying the old tag are already in people's hands, so they must
    // still get the helpful message rather than a field-validation error.
    const legacy = { ...buildRosterFile(makeLeague(0, 1)), format: "soccer-gm-roster" };
    await expect(
      importLeagueJSON(jsonFile("old-teams-file.json", legacy)),
    ).rejects.toThrow(/roster file, not a saved game/i);
  });

  it("rejects a file that is not JSON", async () => {
    await expect(
      importLeagueJSON(jsonFile("notes.json", "this is not json")),
    ).rejects.toThrow(/invalid JSON/i);
  });

  it("rejects a JSON object that is missing league fields", async () => {
    await expect(
      importLeagueJSON(jsonFile("half.json", { teams: [], players: [] })),
    ).rejects.toThrow(/schedule/);
  });

  it("names the offending file in its errors", async () => {
    await expect(
      importLeagueJSON(jsonFile("my-save.json", { nope: true })),
    ).rejects.toThrow(/my-save\.json/);
  });
});

describe("retired players' stat lines in an exported save", () => {
  const withArchive = () => {
    const league = makeLeague(0, 1);
    return {
      ...league,
      retiredPlayers: [{ pid: 9001 }, { pid: 9002 }] as unknown as typeof league.retiredPlayers,
    };
  };
  // Packed, as the store holds them and the file carries them.
  const line = (pid: number) => ({ pid, cols: ["season", "goals"], rows: [[3, 9]], intl: null });

  it("survives the round trip and stays off the league record", async () => {
    const bytes = await encodeLeagueFile(withArchive(), undefined, [line(9001), line(9002)]);
    const { league, retireeCareers } = await importLeagueJSON(new File([bytes], "s.json.gz"));
    expect(retireeCareers).toEqual([line(9001), line(9002)]);
    expect("retireeCareers" in (league as unknown as Record<string, unknown>)).toBe(false);
  });

  it("drops lines for anyone the file's archive doesn't have, and junk rows", async () => {
    const bytes = await encodeLeagueFile(
      withArchive(), undefined, [line(9001), line(4242), { pid: "x" } as never],
    );
    const { retireeCareers } = await importLeagueJSON(new File([bytes], "s.json.gz"));
    expect(retireeCareers).toEqual([line(9001)]);
  });

  it("reads an older file without them as none", async () => {
    const { retireeCareers } = await importLeagueJSON(jsonFile("old.json", makeLeague(0, 1)));
    expect(retireeCareers).toEqual([]);
  });
});

describe("custom club badges in an exported save", () => {
  const PNG = "data:image/png;base64,AAAA";

  it("survives the round trip, so a save doesn't silently lose its badges", async () => {
    const league = makeLeague(0, 1);
    const bytes = await encodeLeagueFile(league, new Map([[0, PNG], [4, PNG]]));
    const { crests } = await importLeagueJSON(
      new File([bytes], "save.json.gz", { type: "application/gzip" }),
    );
    expect(crests.get(0)).toBe(PNG);
    expect(crests.size).toBe(2);
  });

  it("never reaches the league record", async () => {
    // The whole reason badges have their own store: on the league record they
    // would be re-serialised on every mutation. Riding in through a file is the
    // one route by which they could get there by accident.
    const league = makeLeague(0, 1);
    const bytes = await encodeLeagueFile(league, new Map([[0, PNG]]));
    const { league: imported } = await importLeagueJSON(new File([bytes], "s.json.gz"));
    expect("crests" in (imported as unknown as Record<string, unknown>)).toBe(false);
  });

  it("writes nothing at all for a save with none", async () => {
    // So a file from a save without badges is byte-identical to one this game
    // wrote before the feature existed.
    const league = makeLeague(0, 1);
    const withNone = await readLeagueFileText(
      new File([await encodeLeagueFile(league, new Map())], "a.gz"),
    );
    expect(withNone).toBe(
      await readLeagueFileText(new File([await encodeLeagueFile(league)], "b.gz")),
    );
  });

  it("opens a save whose badge block is malformed rather than refusing it", async () => {
    // A bad badge must never cost someone a 60-season dynasty, so this is
    // lenient where the pack parser is strict.
    const league = makeLeague(0, 1);
    const withJunk = {
      ...(league as unknown as Record<string, unknown>),
      crests: [
        { tid: 0, image: PNG },
        { tid: "nope", image: PNG },
        { tid: 1, image: "https://example.com/badge.png" },
        { tid: 2, image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
        "garbage",
      ],
    };
    const { league: imported, crests } = await importLeagueJSON(jsonFile("s.json", withJunk));
    expect(imported.players.length).toBe(league.players.length);
    expect([...crests.keys()]).toEqual([0]);
  });

  it("gives an empty set for a file exported before badges existed", async () => {
    const { crests } = await importLeagueJSON(jsonFile("old.json", makeLeague(0, 1)));
    expect(crests.size).toBe(0);
  });
});
