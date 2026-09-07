import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { parseRosterFile, resolveRosterSlots, type RosterFile } from "../../src/core/teams/rosterFile.js";
import { applyRosterFile, applyRosterFileToNewLeague } from "../../src/core/teams/rosterImport.js";
import { assignAIFormations } from "../../src/core/teams/clubs.js";
import { worldCompetitions, worldTeamSlots } from "../../src/core/competitions.js";
import { POSITIONS, SKILL_KEYS, type PlayerRatings } from "../../src/core/players/types.js";
import { ROSTER_COMPOSITION } from "../../src/core/constants.js";

const base = makeLeague(0, 11, 11);
const league = { ...base, meta: { ...base.meta, name: base.teams[0].name } };

// Slot 0 of English Division 1 (the user's club here).
const d1 = league.competitions.find((c) => c.name === "English Division 1")!;
const d1Slot0 = league.teams.filter((t) => t.compId === d1.id).sort((a, b) => a.tid - b.tid)[0];

function fileWithSquad(players: unknown[]): RosterFile {
  return parseRosterFile(
    JSON.stringify({
      format: "world-soccer-sim-roster",
      formatVersion: 1,
      competitions: [
        { match: "English Division 1", clubs: [{ name: "Real Import", abbrev: "IMP", colors: ["#111111", "#eeeeee"], players }] },
      ],
    }),
  );
}

const flatRatings = (v: number): PlayerRatings =>
  Object.fromEntries(SKILL_KEYS.map((k) => [k, v])) as PlayerRatings;

describe("applyRosterFile — squad import", () => {
  it("materializes an `overall` player to (about) that overall, at the right position", () => {
    const file = fileWithSquad([{ name: "Star Striker", pos: "ST", age: 25, overall: 88, nationality: "Brazil" }]);
    const { league: out, squadsReplaced, playersAdded } = applyRosterFile(league, file);
    expect(squadsReplaced).toBe(1);
    const star = out.players.find((p) => p.name === "Star Striker")!;
    expect(star).toBeTruthy();
    expect(star.pos).toBe("ST");
    expect(star.nationality).toBe("Brazil");
    expect(Math.abs(star.ovr - 88)).toBeLessThanOrEqual(1);
    expect(star.potential).toBeGreaterThanOrEqual(star.ovr);
    // Full roster was topped up to a legal squad.
    expect(playersAdded).toBe(out.teams.find((t) => t.tid === d1Slot0.tid)!.roster.length);
  });

  it("uses exact `ratings` when provided, and computes ovr from them", () => {
    const ratings = { ...flatRatings(70), finishing: 90, dribbling: 88 };
    const file = fileWithSquad([{ name: "Exact Guy", pos: "AM", age: 27, ratings }]);
    const { league: out } = applyRosterFile(league, file);
    const p = out.players.find((pp) => pp.name === "Exact Guy")!;
    expect(p.ratings.finishing).toBe(90);
    expect(p.ratings.dribbling).toBe(88);
    expect(p.ratings.speed).toBe(70);
    expect(p.ovr).toBeGreaterThan(0);
  });

  it("tops up an under-filled squad so every position meets its composition and a GK exists", () => {
    // Only two outfielders provided — everything else must be filled.
    const file = fileWithSquad([
      { name: "Lonely Striker", pos: "ST", age: 24, overall: 80 },
      { name: "One Winger", pos: "W", age: 22, overall: 75 },
    ]);
    const { league: out } = applyRosterFile(league, file);
    const team = out.teams.find((t) => t.tid === d1Slot0.tid)!;
    const roster = team.roster.map((pid) => out.players.find((p) => p.pid === pid)!);
    const byPos: Record<string, number> = {};
    for (const p of roster) byPos[p.pos] = (byPos[p.pos] ?? 0) + 1;
    for (const pos of POSITIONS) {
      expect(byPos[pos] ?? 0).toBeGreaterThanOrEqual(ROSTER_COMPOSITION[pos]);
    }
    expect(byPos.GK).toBeGreaterThanOrEqual(1);
    expect(roster.length).toBeGreaterThanOrEqual(25);
  });

  it("replaces the club's roster and drops the old fictional players (fresh save, no history)", () => {
    const oldPids = new Set(d1Slot0.roster);
    const file = fileWithSquad([{ name: "New One", pos: "CM", age: 26, overall: 82 }]);
    const { league: out } = applyRosterFile(league, file);
    const team = out.teams.find((t) => t.tid === d1Slot0.tid)!;
    // None of the old pids remain on the roster...
    expect(team.roster.some((pid) => oldPids.has(pid))).toBe(false);
    // ...and since they never played, they're gone from the pool entirely.
    expect(out.players.some((p) => oldPids.has(p.pid))).toBe(false);
    // Stale user-XI selection is cleared.
    expect(team.starters).toBeNull();
  });

  it("leaves a club's roster untouched when it supplies no players (identity-only)", () => {
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          { match: "English Division 1", clubs: [{ name: "Renamed Only", abbrev: "RNO", colors: ["#000000", "#ffffff"] }] },
        ],
      }),
    );
    const { league: out, squadsReplaced, clubsRenamed } = applyRosterFile(league, file);
    expect(clubsRenamed).toBe(1);
    expect(squadsReplaced).toBe(0);
    const team = out.teams.find((t) => t.tid === d1Slot0.tid)!;
    expect(team.name).toBe("Renamed Only");
    expect(team.roster).toEqual(d1Slot0.roster); // unchanged
  });

  it("is deterministic — same file yields identical pids, ovrs, and roster", () => {
    const file = fileWithSquad([{ name: "Repeatable", pos: "CB", age: 28, overall: 79 }]);
    const a = applyRosterFile(league, file);
    const b = applyRosterFile(league, file);
    const ta = a.league.teams.find((t) => t.tid === d1Slot0.tid)!;
    const tb = b.league.teams.find((t) => t.tid === d1Slot0.tid)!;
    expect(ta.roster).toEqual(tb.roster);
    const ovrsA = ta.roster.map((pid) => a.league.players.find((p) => p.pid === pid)!.ovr);
    const ovrsB = tb.roster.map((pid) => b.league.players.find((p) => p.pid === pid)!.ovr);
    expect(ovrsA).toEqual(ovrsB);
  });

  it("passes warnings through for an unmatched competition and applies nothing", () => {
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          { match: "Martian League", clubs: [{ name: "X", abbrev: "X", colors: ["#000000", "#ffffff"], players: [{ name: "y", pos: "GK", age: 24, overall: 70 }] }] },
        ],
      }),
    );
    const { warnings, squadsReplaced, clubsRenamed } = applyRosterFile(league, file);
    expect(clubsRenamed).toBe(0);
    expect(squadsReplaced).toBe(0);
    expect(warnings[0]).toContain("Martian League");
  });

  it("does not change any other club's roster", () => {
    const otherSlot = league.teams.filter((t) => t.compId === d1.id).sort((a, b) => a.tid - b.tid)[5];
    const file = fileWithSquad([{ name: "Solo", pos: "ST", age: 25, overall: 85 }]);
    const { league: out } = applyRosterFile(league, file);
    const other = out.teams.find((t) => t.tid === otherSlot.tid)!;
    expect(other.roster).toEqual(otherSlot.roster);
  });
});

describe("imported clubs are flagged so their slot's crest art is dropped", () => {
  // Crest images are keyed by tid — a slot — so once a slot becomes a real club
  // the badge belongs to the fictional club it displaced. The flag is what the
  // UI reads to fall back to the club's colours instead.
  it("flags every club the file named, squads or not", () => {
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          {
            match: "English Division 1",
            clubs: [
              // With a squad...
              {
                name: "With Squad",
                abbrev: "WSQ",
                colors: ["#111111", "#eeeeee"],
                players: [{ name: "A Player", pos: "ST", age: 25, overall: 75 }],
              },
              // ...and identity-only, which is exactly the case where the name
              // changed and the crest went stale without any squad involved.
              { name: "Name Only", abbrev: "NMO", colors: ["#222222", "#dddddd"] },
            ],
          },
        ],
      }),
    );
    const { league: out } = applyRosterFile(league, file);
    const d1Teams = out.teams.filter((t) => t.compId === d1.id).sort((a, b) => a.tid - b.tid);

    expect(d1Teams[0].importedIdentity).toBe(true);
    expect(d1Teams[1].importedIdentity).toBe(true);
    // A club the file never mentioned keeps its own identity and its crest.
    expect(d1Teams[2].importedIdentity).toBeUndefined();
    // ...as does every club in a competition the file didn't cover.
    const d2 = out.competitions.find((c) => c.name === "English Division 2")!;
    expect(out.teams.filter((t) => t.compId === d2.id).every((t) => !t.importedIdentity)).toBe(true);
  });

  it("carries the file's colors onto the flagged club", () => {
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          {
            match: "English Division 1",
            clubs: [{ name: "Colored", abbrev: "COL", colors: ["#6cabdd", "#ffffff"] }],
          },
        ],
      }),
    );
    const { league: out } = applyRosterFile(league, file);
    const team = out.teams.find((t) => t.tid === d1Slot0.tid)!;
    // The swatch the UI draws in place of the crest comes from these.
    expect(team.colors).toEqual(["#6cabdd", "#ffffff"]);
    expect(team.importedIdentity).toBe(true);
  });
});

describe("academy anchor realignment", () => {
  /** A file importing squads of the given overalls onto the first N D1 slots. */
  function fileWithSquads(overalls: number[]): RosterFile {
    return parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          {
            match: "English Division 1",
            clubs: overalls.map((ovr, i) => ({
              name: `Club ${i}`,
              abbrev: `C${i}`,
              colors: ["#111111", "#eeeeee"],
              players: POSITIONS.flatMap((pos) =>
                Array.from({ length: 3 }, (_, n) => ({
                  name: `${pos}${n} of ${i}`,
                  pos,
                  age: 25,
                  overall: ovr,
                })),
              ),
            })),
          },
        ],
      }),
    );
  }

  const d1Teams = (l: typeof league) =>
    l.teams.filter((t) => t.compId === d1.id).sort((a, b) => a.tid - b.tid);

  it("is a permutation — the competition's anchors are reassigned, never changed", () => {
    const before = d1Teams(league).map((t) => t.academyBase).sort((a, b) => a - b);
    const { league: out } = applyRosterFile(league, fileWithSquads([80, 55, 70, 62, 75]));
    const after = d1Teams(out).map((t) => t.academyBase).sort((a, b) => a - b);
    // Same multiset: nothing invented, nothing lost, so no inflation pressure.
    expect(after).toEqual(before);
  });

  it("hands the strongest imported squad the strongest anchor available", () => {
    const overalls = [55, 80, 62, 75, 70];
    const before = d1Teams(league).slice(0, overalls.length).map((t) => t.academyBase);
    const { league: out } = applyRosterFile(league, fileWithSquads(overalls));
    const imported = d1Teams(out).slice(0, overalls.length);

    // Generation shuffles anchors across slots, so on this fixture they start
    // out of order and the realignment has real work to do. Asserted so the
    // test can't quietly pass by the anchors having been sorted already.
    expect(imported.map((t) => t.academyBase)).not.toEqual(before);

    // Anchors, ranked, should follow squad strength, ranked.
    const byStrength = [...imported].sort(
      (a, b) => overalls[imported.indexOf(b)] - overalls[imported.indexOf(a)],
    );
    const anchors = byStrength.map((t) => t.academyBase);
    expect(anchors).toEqual([...anchors].sort((a, b) => b - a));
    // And the 80-ovr club specifically holds the best of the five.
    const best = imported[overalls.indexOf(80)];
    expect(best.academyBase).toBe(Math.max(...imported.map((t) => t.academyBase)));
  });

  it("leaves clubs the file didn't touch completely alone", () => {
    const importedCount = 5;
    const before = d1Teams(league);
    const { league: out } = applyRosterFile(league, fileWithSquads([80, 55, 70, 62, 75]));
    const after = d1Teams(out);
    for (let i = importedCount; i < before.length; i++) {
      expect(after[i].academyBase).toBe(before[i].academyBase);
      expect(after[i].roster).toEqual(before[i].roster);
    }
  });

  it("does not touch anchors for an identity-only import (no squads replaced)", () => {
    const before = d1Teams(league).map((t) => t.academyBase);
    const file = parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [
          {
            match: "English Division 1",
            clubs: [{ name: "Renamed", abbrev: "RNM", colors: ["#000000", "#ffffff"] }],
          },
        ],
      }),
    );
    const { league: out } = applyRosterFile(league, file);
    expect(d1Teams(out).map((t) => t.academyBase)).toEqual(before);
  });

  it("is deterministic across identical imports", () => {
    const file = fileWithSquads([80, 55, 70, 62, 75]);
    const a = applyRosterFile(league, file);
    const b = applyRosterFile(league, file);
    expect(d1Teams(a.league).map((t) => t.academyBase)).toEqual(
      d1Teams(b.league).map((t) => t.academyBase),
    );
  });
});

describe("pre-generation slot resolution", () => {
  // The new-league importer resolves a roster file against a world that hasn't
  // been generated yet, so the club picker can show real club names without
  // paying for 6000 players first. That only works while the projected slot
  // layout matches what generateWorld actually produces — this is the guard
  // against the two drifting apart.
  it("worldTeamSlots matches a real generated world's tid -> competition", () => {
    const projected = worldTeamSlots(worldCompetitions());
    const actual = league.teams
      .map((t) => ({ tid: t.tid, compId: t.compId }))
      .sort((a, b) => a.tid - b.tid);
    expect(projected).toEqual(actual);
  });

  it("resolves a file to the same clubs before and after the world exists", () => {
    const file = fileWithSquad([{ name: "Star Striker", pos: "ST", age: 25, overall: 88 }]);
    const projected = resolveRosterSlots(
      {
        competitions: worldCompetitions(),
        teams: worldTeamSlots(worldCompetitions()),
      },
      file,
    );
    expect(projected.slots).toEqual(resolveRosterSlots(league, file).slots);
    expect(projected.slots[0].tid).toBe(d1Slot0.tid);
  });
});

describe("applyRosterFileToNewLeague", () => {
  // createLeagueState picks AI formations and stamps the user's scouting
  // against the *generated* squads; importing throws those squads away, so
  // both have to be redone or the save opens with formations chosen for
  // players who no longer exist and an unscouted user squad.

  /** A file that imports `players` onto exactly `tid`, padding the earlier slots. */
  function fileForTid(tid: number, players: unknown[]): RosterFile {
    const compId = league.teams.find((t) => t.tid === tid)!.compId;
    const comp = league.competitions.find((c) => c.id === compId)!;
    const slotIndex = league.teams
      .filter((t) => t.compId === compId)
      .sort((a, b) => a.tid - b.tid)
      .findIndex((t) => t.tid === tid);
    const clubs = Array.from({ length: slotIndex + 1 }, (_, i) => ({
      name: `Import ${i}`,
      abbrev: `I${i}`,
      colors: ["#111111", "#eeeeee"],
      ...(i === slotIndex ? { players } : {}),
    }));
    return parseRosterFile(
      JSON.stringify({
        format: "world-soccer-sim-roster",
        formatVersion: 1,
        competitions: [{ match: comp.name, clubs }],
      }),
    );
  }

  const squad = POSITIONS.flatMap((pos) =>
    Array.from({ length: 2 }, (_, i) => ({ name: `${pos} Import ${i}`, pos, age: 24, overall: 70 })),
  );

  it("stamps the user's imported squad as observed, where a plain import leaves it blank", () => {
    const userTid = league.meta.userTid;
    const file = fileForTid(userTid, squad);

    const plain = applyRosterFile(league, file).league;
    const plainTeam = plain.teams.find((t) => t.tid === userTid)!;
    expect(Object.keys(plainTeam.scoutingObserved ?? {})).toHaveLength(0);

    const fixed = applyRosterFileToNewLeague(league, file, userTid).league;
    const fixedTeam = fixed.teams.find((t) => t.tid === userTid)!;
    expect(
      Object.keys(fixedTeam.scoutingObserved ?? {})
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...fixedTeam.roster].sort((a, b) => a - b));
  });

  it("re-picks AI formations against the imported squad", () => {
    const aiTid = league.teams.find((t) => t.tid !== league.meta.userTid)!.tid;
    // Deliberately LOPSIDED, and not the shared `squad` above. The chooser
    // maximizes the XI's total rating, so a squad that is equally good
    // everywhere prefers no shape at all and every formation ties — which lands
    // on whichever the chooser starts from, and if the club was already there
    // this test proves nothing while still passing. (That is exactly what
    // happened once positions were calibrated to a common mean: a uniform
    // import and a generated squad both came out on 4-3-3.) Stacking the
    // quality on the flanks and up front makes the imported squad want a
    // genuinely different shape, so the precondition below is a statement about
    // the chooser rather than about this seed.
    const lopsided = POSITIONS.flatMap((pos) =>
      Array.from({ length: 2 }, (_, i) => ({
        name: `${pos} Import ${i}`,
        pos,
        age: 24,
        overall: pos === "W" || pos === "ST" ? 82 : 58,
      })),
    );
    const file = fileForTid(aiTid, lopsided);

    // A plain import leaves the club on the shape chosen for the squad it just
    // deleted. Asserted so this test can't quietly go vacuous if the chooser
    // ever returns the same formation regardless of roster.
    const plain = applyRosterFile(league, file).league;
    const plainStale = assignAIFormations(plain.teams, plain.players, league.meta.userTid).filter(
      (t, i) => t.formation !== plain.teams[i].formation,
    );
    expect(plainStale.map((t) => t.tid)).toEqual([aiTid]);

    const fixed = applyRosterFileToNewLeague(league, file, league.meta.userTid).league;
    const reRun = assignAIFormations(fixed.teams, fixed.players, league.meta.userTid);
    expect(reRun.map((t) => t.formation)).toEqual(fixed.teams.map((t) => t.formation));
  });

  it("returns the same import summary applyRosterFile does", () => {
    const userTid = league.meta.userTid;
    const file = fileForTid(userTid, squad);
    const plain = applyRosterFile(league, file);
    const fixed = applyRosterFileToNewLeague(league, file, userTid);
    expect([fixed.clubsRenamed, fixed.squadsReplaced, fixed.playersAdded, fixed.warnings]).toEqual([
      plain.clubsRenamed,
      plain.squadsReplaced,
      plain.playersAdded,
      plain.warnings,
    ]);
  });
});
