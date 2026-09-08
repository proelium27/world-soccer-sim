import {
  NATIONALITIES,
  OTHER_NATIONS,
  UNLISTED_NATIONALITIES,
} from "../core/players/nationalities.js";

/**
 * A player's name as a label, where there is only room for the surname.
 *
 * This was four identical copies (PitchField, Awards, Power Rankings,
 * Frivolities) about to become a fifth for the match pitch, all doing the same
 * wrong thing to the same names: taking the last whitespace-separated word.
 * A surname is one entry in a name pool and plenty of those contain a space
 * ("van Dijk", "De Luca", "Espirito Santo"), while `Player.name` is only first
 * and last joined by a space — so the boundary is not recoverable from the
 * string, and "Jan Van Loo" came out as "Loo".
 *
 * So the pools are asked instead of guessed at. Every multi-word surname the
 * game can generate is collected once at module load (72 of 13,715 entries,
 * measured) and matched as a suffix. That is exact by construction and needs no
 * maintenance: a pool gaining a new compound is covered the day it lands, where
 * a hand-written list of particles would silently keep printing half of it.
 *
 * The particle walk below it is the fallback, and it is not redundant: an
 * imported roster or a custom player can carry any name at all, and "Van" or
 * "de" before the last word is a good guess there even though it is only a
 * guess. Failing both, it does what every caller did before.
 */

/** Surnames with a space in them, from every pool the generator can draw on. */
const COMPOUND_SURNAMES: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const pools = [
    ...Object.values(NATIONALITIES),
    ...Object.values(OTHER_NATIONS),
    ...Object.values(UNLISTED_NATIONALITIES),
  ];
  for (const nat of pools) {
    for (const last of nat.last) if (last.includes(" ")) out.add(last);
  }
  return out;
})();

/** How many words the longest of them runs to, so the suffix scan knows where to start. */
const MAX_SURNAME_WORDS = (() => {
  let n = 1;
  for (const s of COMPOUND_SURNAMES) n = Math.max(n, s.split(" ").length);
  return n;
})();

/**
 * Common surname particles, for names that came from outside the game's own
 * pools. Deliberately not the primary route — see the header.
 */
const PARTICLES = new Set([
  "de", "del", "della", "di", "da", "dos", "das", "do",
  "van", "von", "der", "den", "ter", "op",
  "el", "al", "ben", "bin", "na", "la", "le", "af", "st",
]);

export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;

  // Longest match first: "Cruz" is a surname in its own right and "Vera Cruz"
  // is another, and the longer one is the right answer when both fit.
  for (let k = Math.min(MAX_SURNAME_WORDS, parts.length - 1); k >= 2; k--) {
    const candidate = parts.slice(parts.length - k).join(" ");
    if (COMPOUND_SURNAMES.has(candidate)) return candidate;
  }

  let start = parts.length - 1;
  // Never past the first word. "Ben" and "Le" are given names as well as
  // particles, so on a plain two-word name the last word is the surname and
  // the one before it is not up for grabs — "Ben Carter" is Carter.
  while (start > 1 && PARTICLES.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(" ");
}
