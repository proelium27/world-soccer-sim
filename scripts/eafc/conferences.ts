/**
 * Which half of a split division a real club belongs to.
 *
 * A roster file seats clubs POSITIONALLY: the first club listed for a competition
 * takes its lowest tid, and a split division's first conference is whichever
 * clubs hold its lower tids (see core/conferences.ts — at world creation the
 * halves are filled in tid order). So a converted MLS emitted in strength order
 * scatters the Eastern and Western Conferences across both halves, and nothing
 * throws: Seattle simply plays in the East. Listing the first half's clubs first
 * is the whole fix, and it has to happen twice — in the converter, and again in
 * mergeRosterFiles, which appends names-only clubs after the converted ones
 * (Gimnasia de Mendoza would otherwise land in Zone B).
 *
 * Each club is listed under every name it goes by, because the converter sees
 * the CSV label ("Dep. Riestra") and the merge sees the display name after an
 * --identities rename ("Deportivo Riestra"). Membership is exact, never the
 * merge's containment rule: "Gimnasia" (La Plata, Zone B) must not match
 * "Gimnasia y Esgrima de Mendoza" (Zone A).
 *
 * Only divisions whose halves are known are listed. Divisions filled entirely
 * from a names file need no entry — that file's own order is kept — so the
 * Primera Nacional and USL Championship are ordered there instead.
 */
export const FIRST_HALF_CLUBS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  // MLS 2026 Eastern Conference (EA FC 27 label, then full name).
  "US Division 1": [
    ["Atlanta United", "Atlanta United FC"], ["Charlotte FC"], ["Chicago Fire FC"],
    ["FC Cincinnati"], ["Columbus Crew"], ["D.C. United"], ["Inter Miami CF"], ["CF Montréal"],
    ["Nashville SC"], ["New England", "New England Revolution"], ["New York City FC"],
    ["Red Bulls", "New York Red Bulls"], ["Orlando City", "Orlando City SC"],
    ["Philadelphia", "Philadelphia Union"], ["Toronto FC"],
  ],
  // Liga Profesional 2026 Zone A, from the league's official draw (English
  // Wikipedia's split disagreed with it). The zones are redrawn each season, so
  // this wants updating with the ratings.
  "Argentine Division 1": [
    ["Platense"], ["Defensa", "Defensa y Justicia"], ["Central Córdoba"], ["Lanús"],
    ["Dep. Riestra", "Deportivo Riestra"], ["Talleres"], ["Boca Juniors"],
    ["Estudiantes", "Estudiantes de La Plata"], ["Instituto"], ["Gimnasia y Esgrima de Mendoza"],
    ["San Lorenzo"], ["Independiente"], ["Newell's", "Newell's Old Boys"], ["Unión"],
    ["Vélez Sarsfield"],
  ],
};

/**
 * Put a split division's first-half clubs first, keeping the incoming order
 * within each half. A competition with no entry comes back unchanged.
 */
export function orderByConference<T>(
  competition: string,
  clubs: readonly T[],
  nameOf: (club: T) => string = (c) => (c as { clubName: string }).clubName,
): T[] {
  const first = FIRST_HALF_CLUBS[competition];
  if (!first) return [...clubs];
  const names = new Set(first.flat());
  return [...clubs.filter((c) => names.has(nameOf(c))), ...clubs.filter((c) => !names.has(nameOf(c)))];
}
