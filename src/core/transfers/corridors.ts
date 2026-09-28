/**
 * Language and family ties: the countries a player finds familiar although he
 * wasn't born there (docs/club-reputation.md, Stage 3). A Brazilian settles in
 * Portugal, a Senegalese in France, a Surinamese in the Netherlands, because
 * the language is his and so, often, is family. These are the biggest real
 * migration routes in football that cross a confederation, which nothing else
 * in a player's view could produce: the home line only knows his own country.
 *
 * Hand-authored, every row with a reason a real route stands on, and
 * deliberately NOT derived from `LEAGUE_NATIONALITY_WEIGHTS`: those tables are
 * what the nationality probe measures the result against, and a pull tuned
 * from the same table would be a formula fitted to hit its own target.
 *
 * Routes inside a confederation are left out (Balkans to Turkey, Scandinavia to
 * the Netherlands, England and Scotland): the stepping-stone and neighbour
 * moves they describe already come from the level and playing-time lines.
 *
 * Strength 1 is an ordinary shared-language route. Brazil to Portugal is above
 * it because it is the single largest route in world football, about three
 * times any other. The routes into Spain and Italy are below it, because those
 * two leagues already run more foreign than real (docs/club-reputation.md).
 */

export interface Corridor {
  /** The league country a player from `from` finds familiar. */
  to: string;
  from: readonly string[];
  strength: number;
  reason: string;
}

const FRENCH_SPEAKING_AFRICA = [
  "Senegal", "Ivory Coast", "Mali", "Cameroon", "Guinea", "Burkina Faso", "DR Congo",
  "Congo", "Gabon", "Benin", "Togo", "Niger", "Chad", "Madagascar", "Algeria", "Morocco", "Tunisia",
] as const;
const PORTUGUESE_SPEAKING_AFRICA = ["Angola", "Cape Verde", "Guinea-Bissau", "Mozambique", "Sao Tome and Principe"] as const;
const SPANISH_SPEAKING_AMERICAS = [
  "Argentina", "Uruguay", "Colombia", "Venezuela", "Paraguay", "Ecuador", "Chile", "Peru", "Bolivia",
] as const;
const ENGLISH_SPEAKING_ABROAD = ["Australia", "New Zealand", "Canada"] as const;

export const CORRIDORS: readonly Corridor[] = [
  { to: "Portugal", from: ["Brazil"], strength: 1.5, reason: "Language" },
  { to: "Portugal", from: PORTUGUESE_SPEAKING_AFRICA, strength: 1, reason: "Language" },
  { to: "France", from: FRENCH_SPEAKING_AFRICA, strength: 1, reason: "Language" },
  { to: "Belgium", from: ["DR Congo"], strength: 1.25, reason: "Family ties" },
  { to: "Belgium", from: FRENCH_SPEAKING_AFRICA.filter((n) => n !== "DR Congo"), strength: 0.75, reason: "Language" },
  { to: "Netherlands", from: ["Suriname", "Curacao", "Indonesia"], strength: 1, reason: "Family ties" },
  { to: "Netherlands", from: ["Morocco"], strength: 0.5, reason: "Family ties" },
  { to: "Spain", from: SPANISH_SPEAKING_AMERICAS, strength: 0.5, reason: "Language" },
  { to: "Italy", from: ["Argentina", "Uruguay"], strength: 0.4, reason: "Italian roots" },
  { to: "Mexico", from: SPANISH_SPEAKING_AMERICAS, strength: 0.3, reason: "Language" },
  { to: "Scotland", from: ENGLISH_SPEAKING_ABROAD, strength: 1, reason: "Language" },
  { to: "England", from: ENGLISH_SPEAKING_ABROAD, strength: 0.5, reason: "Language" },
  { to: "United States", from: ["Canada"], strength: 0.75, reason: "Neighbours" },
];

/** country → nationality → strongest route, built once. */
const byCountry = new Map<string, Map<string, Corridor>>();
for (const c of CORRIDORS) {
  let row = byCountry.get(c.to);
  if (!row) byCountry.set(c.to, (row = new Map()));
  for (const n of c.from) {
    const had = row.get(n);
    if (!had || had.strength < c.strength) row.set(n, c);
  }
}

/** The route that makes `country` familiar to a player of `nationality`, or null. */
export function corridorFor(nationality: string, country: string): Corridor | null {
  return byCountry.get(country)?.get(nationality) ?? null;
}
