import { describe, it, expect } from "vitest";
import { makeLeague } from "../helpers/league.js";
import { buildImportPromptText } from "../../src/core/teams/rosterAiPrompt.js";
import { parseRosterFile } from "../../src/core/teams/rosterFile.js";
import { POSITIONS, SKILL_KEYS } from "../../src/core/players/types.js";

const league = makeLeague(0, 3, 3);

describe("buildImportPromptText", () => {
  const prompt = buildImportPromptText(league);

  it("names the format and version", () => {
    expect(prompt).toContain("world-soccer-sim-roster");
    expect(prompt).toContain("formatVersion");
  });

  it("lists this save's actual competitions with slot counts", () => {
    for (const c of league.competitions) {
      expect(prompt).toContain(`"${c.name}"`);
    }
    // Slot count for a competition appears (e.g. "20 club slots").
    const anyComp = league.competitions[0];
    const slots = league.teams.filter((t) => t.compId === anyComp.id).length;
    expect(prompt).toContain(`${slots} club slots`);
  });

  // The name is the one identifier the player can invalidate by renaming a
  // division, so the prompt asks for the country and tier alongside it — those
  // survive a rename and are what resolveRosterSlots prefers.
  it("gives each competition's country and tier, and asks for them back", () => {
    for (const c of league.competitions) {
      expect(prompt).toContain(`country "${c.country}", tier ${c.tier}`);
    }
    expect(prompt).toMatch(/ALWAYS include `country` and `tier`/);
    expect(prompt).toContain('"country": "<country>"');
  });

  it("documents every position and skill key so an AI can produce exact ratings", () => {
    for (const p of POSITIONS) expect(prompt).toContain(p);
    for (const k of SKILL_KEYS) expect(prompt).toContain(k);
  });

  // The two ways a roster file silently applies nothing, per resolveRosterSlots:
  // an unrecognised `match` drops the whole competition, and an over-long club
  // list truncates from the end. Both were hit for real on 2026-08-29, so the
  // prompt has to warn about each by name.
  it("warns that an unmatched competition name is dropped in silence", () => {
    expect(prompt).toContain("never build one out of the country's name");
    expect(prompt).toMatch(/skipped with no error/i);
  });

  it("names a real competition whose name is not its country's", () => {
    // The warning is only convincing with an example, and it is taken from the
    // world so it stays true for a custom one.
    const odd = league.competitions.find(
      (c) => !c.name.toLowerCase().startsWith(c.country.toLowerCase()),
    );
    expect(odd).toBeDefined();
    expect(prompt).toContain(`this world calls ${odd!.country}'s top division "${odd!.name}"`);
  });

  it("caps the club list at the slot count and says what overflow costs", () => {
    expect(prompt).toContain("NEVER list more clubs than a competition's slot count");
    expect(prompt).toMatch(/thrown away from the END/);
  });

  it("says the divisions are different sizes when they are", () => {
    const sizes = new Set(
      league.competitions.map((c) => league.teams.filter((t) => t.compId === c.id).length),
    );
    expect(sizes.size).toBeGreaterThan(1);
    expect(prompt).toMatch(/deliberately different sizes/);
  });

  it("tells the AI to report a missing league rather than invent a name for it", () => {
    expect(prompt).toContain("Don't invent a competition");
  });

  // The regression test for the actual bug: three hand-authored files used
  // "Scotland/Greece/Serbia Division 1" — the `<country> Division N` form a
  // league ADDED in World setup gets — against shipped names like "Scottish
  // Division 1", and resolved to zero clubs. The prompt must never put that
  // form in front of an AI for a competition that isn't really called it.
  it("never shows the <country> Division N form for a competition not named that", () => {
    for (const c of league.competitions) {
      const constructed = `${c.country} Division ${c.tier}`;
      if (constructed.toLowerCase() === c.name.toLowerCase()) continue;
      expect(prompt).not.toContain(constructed);
    }
  });

  it("ends with a checklist covering both silent failures and the fatal one", () => {
    const checklist = prompt.slice(prompt.indexOf("== Check these before you answer =="));
    expect(checklist).toContain("character for character");
    expect(checklist).toContain("more clubs than its slot count");
    expect(checklist).toMatch(/`colors` is an array of exactly two/);
  });

  // The reported failure (2026-09-02): a 232-club, 5,873-player file was
  // rejected outright because two clubs listed their real three colours.
  // Unlike the name and count rules above, this one costs the author
  // EVERYTHING, so the prompt has to say both that the field takes exactly two
  // and that a shape error is fatal — an AI told that mistakes degrade
  // gracefully will not stop to re-read a field shape.
  it("says colors is exactly two, and warns that shape errors reject the whole file", () => {
    expect(prompt).toMatch(/`colors` is EXACTLY TWO hex strings/);
    expect(prompt).toMatch(/never one, never three/);
    expect(prompt).toMatch(/HARD error/);
    expect(prompt).toMatch(/not one club of the hundreds you wrote is imported/i);
  });

  // The prompt's claim that the three list rules "fail QUIETLY" is true of
  // those three and false of every field shape below them. Stating it
  // unqualified is what teaches an AI the wrong lesson, so pin the scope.
  it("scopes the fails-quietly warning to the three list rules", () => {
    expect(prompt).toMatch(/getting any of THESE THREE wrong fails QUIETLY/);
  });

  // Pins the BEHAVIOUR the colors rule describes, not merely its wording. If
  // the parser is ever made lenient about a third colour, this fails and says
  // to soften the prompt to match, rather than leaving it warning about
  // something that no longer happens.
  it("is warning about a real rejection: a third colour throws, and takes the file with it", () => {
    const comp = league.competitions[0];
    const file = {
      format: "world-soccer-sim-roster",
      formatVersion: 1,
      competitions: [
        {
          match: comp.name,
          country: comp.country,
          tier: comp.tier,
          clubs: [
            { name: "Two Colour FC", abbrev: "TWO", colors: ["#111111", "#222222"] },
            { name: "Three Colour FC", abbrev: "THR", colors: ["#111111", "#222222", "#333333"] },
          ],
        },
      ],
    };
    expect(() => parseRosterFile(JSON.stringify(file))).toThrow(/colors must be an array of two/);

    // And the rejection really is total rather than per-club: drop the single
    // bad entry and the very same file is accepted, so one club out of any
    // number is the whole cost.
    file.competitions[0].clubs.pop();
    expect(parseRosterFile(JSON.stringify(file)).competitions[0].clubs).toHaveLength(1);
  });

  it("tells the AI not to write a logo field, and points at where badges really come from", () => {
    expect(prompt).toMatch(/Don't add a logo, crest or badge field/);
    // The pointer matters as much as the prohibition: an AI told only "don't"
    // has nothing to tell the reader instead, and the reader is exactly the
    // person who wants badges.
    expect(prompt).toMatch(/image files/);
    // And it must never read as a request to produce one. A language model
    // asked for a picture emits hallucinated base64, which the pack parser
    // rejects outright — a fatal error in place of a missing feature.
    expect(prompt).not.toMatch(/data:image/);
  });

  // Pins the BEHAVIOUR that line describes. The claim is specifically that an
  // invented logo key is dropped in SILENCE — if the parser is ever made strict
  // about unknown fields this fails, and the prompt has to start saying the
  // opposite, because the mistake would then cost the author the whole file
  // rather than nothing.
  it("is right that an invented logo key is silently discarded rather than refused", () => {
    const comp = league.competitions[0];
    const file = {
      format: "world-soccer-sim-roster",
      formatVersion: 1,
      competitions: [
        {
          match: comp.name,
          country: comp.country,
          tier: comp.tier,
          clubs: [
            {
              name: "Badged FC",
              abbrev: "BAD",
              colors: ["#111111", "#222222"],
              logo: "https://example.com/badge.png",
              crest: "badge.png",
            },
          ],
        },
      ],
    };
    const parsed = parseRosterFile(JSON.stringify(file));
    const club = parsed.competitions[0].clubs[0] as unknown as Record<string, unknown>;
    expect(club.name).toBe("Badged FC");
    expect(club.logo).toBeUndefined();
    expect(club.crest).toBeUndefined();
  });

  it("embeds an example that itself parses as a valid roster file", () => {
    const start = prompt.indexOf("== Example ==");
    expect(start).toBeGreaterThan(-1);
    const jsonStart = prompt.indexOf("{", start);
    // The example is the last JSON block; grab from its opening brace to the
    // final closing brace before the trailing instruction line.
    const jsonText = prompt.slice(jsonStart, prompt.lastIndexOf("}") + 1);
    const parsed = parseRosterFile(jsonText);
    expect(parsed.competitions.length).toBeGreaterThan(0);
    expect(parsed.competitions[0].clubs[0].players?.length).toBeGreaterThan(0);
  });
});
