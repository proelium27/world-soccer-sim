import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { competitionTeamCount, worldCompetitions } from "../../src/core/competitions.js";

/**
 * The site's search description quotes the world's size as a literal, in two
 * places that must stay static (index.html is read before any script runs, and
 * seo.ts mirrors it). Both went stale across every world expansion (16 leagues
 * and 320 clubs, then 36 and 626) with nothing failing, so this pins them to the
 * world the game actually ships.
 */
const comps = worldCompetitions();
const leagues = comps.length;
const clubs = comps.reduce((n, c) => n + competitionTeamCount(c), 0);

const FILES = ["index.html", "src/ui/seo.ts"];

describe("quoted world size", () => {
  for (const file of FILES) {
    it(`${file} quotes the shipped world's league and club counts`, () => {
      const text = readFileSync(file, "utf8");
      const quoted = [...text.matchAll(/(\d+) leagues and (\d+) clubs/g)];
      expect(quoted.length).toBeGreaterThan(0);
      for (const [phrase, l, c] of quoted) {
        expect(`${phrase}`).toBe(`${leagues} leagues and ${clubs} clubs`);
        expect(Number(l)).toBe(leagues);
        expect(Number(c)).toBe(clubs);
      }
    });
  }
});
