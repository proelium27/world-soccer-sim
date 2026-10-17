/**
 * Knockout round names for international tournaments. In a module of its own,
 * free of React, so the live viewer's plumbing in LeagueContext can name a
 * round without importing a page (nationalTeams/shared.tsx re-exports these).
 */

/** Knockout round names, deepest first, for a bracket of up to five rounds (a 48-nation World Cup's). */
export const KO_ROUND_NAMES = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];

/** Rounds in a 32-nation World Cup's bracket, the depth a caller with no total gets. */
const DEFAULT_KO_ROUNDS = 4;

/**
 * What to call knockout round `round` of a bracket that has `totalRounds` of
 * them. Named backwards from the final, because brackets differ in depth: the
 * World Cup's is four rounds at 32 nations and five at 48, while a
 * confederation cup's can be two, whose round 0 is the semi-finals rather than
 * the quarters. With no total supplied it assumes a 32-nation World Cup.
 */
export function koRoundName(round: number, totalRounds: number = DEFAULT_KO_ROUNDS): string {
  const fromFinal = totalRounds - 1 - round;
  return KO_ROUND_NAMES[KO_ROUND_NAMES.length - 1 - fromFinal] ?? `Round ${round + 1}`;
}
