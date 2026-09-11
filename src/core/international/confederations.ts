/**
 * Which confederation each nation qualifies through.
 *
 * Covers every nation that has a name pool (NATIONALITIES + OTHER_NATIONS +
 * UNLISTED_NATIONALITIES in players/nationalities.ts) — i.e. every nationality
 * a generated player can actually hold. A nation missing from this table would
 * silently drop out of qualifying, so `nationsWithoutConfederation` in the test
 * suite asserts the two lists stay in step when a nation is added.
 */

export const CONFEDERATIONS = [
  "Europe",
  "South America",
  "Africa",
  "Asia",
  "North America",
  "Oceania",
] as const;

export type Confederation = (typeof CONFEDERATIONS)[number];

export const CONFEDERATION_OF: Record<string, Confederation> = {
  // Europe
  Albania: "Europe",
  Austria: "Europe",
  Belarus: "Europe",
  Belgium: "Europe",
  "Bosnia-Herzegovina": "Europe",
  Bulgaria: "Europe",
  Croatia: "Europe",
  "Czech Republic": "Europe",
  Denmark: "Europe",
  England: "Europe",
  Finland: "Europe",
  France: "Europe",
  Georgia: "Europe",
  Germany: "Europe",
  Greece: "Europe",
  Hungary: "Europe",
  Iceland: "Europe",
  Israel: "Europe", // plays in UEFA competition, as in real football
  Italy: "Europe",
  Kosovo: "Europe",
  Montenegro: "Europe",
  Netherlands: "Europe",
  "North Macedonia": "Europe",
  "Northern Ireland": "Europe",
  Norway: "Europe",
  Poland: "Europe",
  Portugal: "Europe",
  "Republic of Ireland": "Europe",
  Romania: "Europe",
  Russia: "Europe",
  Scotland: "Europe",
  Serbia: "Europe",
  Slovakia: "Europe",
  Slovenia: "Europe",
  Spain: "Europe",
  Sweden: "Europe",
  Switzerland: "Europe",
  Turkey: "Europe",
  Ukraine: "Europe",
  Wales: "Europe",

  // South America
  Argentina: "South America",
  Bolivia: "South America",
  Brazil: "South America",
  Chile: "South America",
  Colombia: "South America",
  Ecuador: "South America",
  Paraguay: "South America",
  Peru: "South America",
  Uruguay: "South America",
  Venezuela: "South America",

  // Africa
  Algeria: "Africa",
  Angola: "Africa",
  Benin: "Africa",
  "Burkina Faso": "Africa",
  Cameroon: "Africa",
  "Cape Verde": "Africa",
  Gambia: "Africa",
  "DR Congo": "Africa",
  Egypt: "Africa",
  Ethiopia: "Africa",
  Gabon: "Africa",
  Ghana: "Africa",
  Guinea: "Africa",
  "Guinea-Bissau": "Africa",
  "Ivory Coast": "Africa",
  Kenya: "Africa",
  Libya: "Africa",
  Mali: "Africa",
  Morocco: "Africa",
  Nigeria: "Africa",
  Senegal: "Africa",
  "South Africa": "Africa",
  Sudan: "Africa",
  Tanzania: "Africa",
  Togo: "Africa",
  Uganda: "Africa",
  Tunisia: "Africa",
  Zimbabwe: "Africa",
  Zambia: "Africa",

  // Asia (Australia plays in the Asian confederation, as in real football)
  Australia: "Asia",
  China: "Asia",
  India: "Asia",
  Indonesia: "Asia",
  Iran: "Asia",
  Iraq: "Asia",
  Japan: "Asia",
  Jordan: "Asia",
  Malaysia: "Asia",
  Qatar: "Asia",
  "Saudi Arabia": "Asia",
  "South Korea": "Asia",

  Thailand: "Asia",
  "United Arab Emirates": "Asia",
  Uzbekistan: "Asia",
  Vietnam: "Asia",
  // North America
  Canada: "North America",
  "Costa Rica": "North America",
  "El Salvador": "North America",
  Guatemala: "North America",
  Honduras: "North America",
  Jamaica: "North America",
  // Both play CONCACAF in real life, Suriname included despite sitting on the
  // South American mainland.
  Curacao: "North America",
  Suriname: "North America",
  Mexico: "North America",
  Panama: "North America",
  "Trinidad and Tobago": "North America",
  "United States": "North America",

  // Oceania
  Fiji: "Oceania",
  "New Zealand": "Oceania",
  "Papua New Guinea": "Oceania",

  // ---------------------------------------------------------------------
  // The remaining FIFA members, added with WORLD_NATIONALITIES so that every
  // nation the game can generate a player for also has somewhere to qualify.
  // Each sits in the confederation it really plays in, which is not always the
  // continent it sits on — see the Guyana and Guam notes below.

  // Europe. The Caucasus and Kazakhstan play UEFA in real football, the same
  // call the Israel line above makes.
  Andorra: "Europe",
  Armenia: "Europe",
  Azerbaijan: "Europe",
  Cyprus: "Europe",
  Estonia: "Europe",
  "Faroe Islands": "Europe",
  Gibraltar: "Europe",
  Kazakhstan: "Europe",
  Latvia: "Europe",
  Liechtenstein: "Europe",
  Lithuania: "Europe",
  Luxembourg: "Europe",
  Malta: "Europe",
  Moldova: "Europe",
  "San Marino": "Europe",

  // North America. Guyana plays CONCACAF despite being on the South American
  // mainland, exactly as Suriname does above.
  Anguilla: "North America",
  "Antigua and Barbuda": "North America",
  Aruba: "North America",
  Bahamas: "North America",
  Barbados: "North America",
  Belize: "North America",
  Bermuda: "North America",
  "British Virgin Islands": "North America",
  "Cayman Islands": "North America",
  Cuba: "North America",
  Dominica: "North America",
  "Dominican Republic": "North America",
  Grenada: "North America",
  Guyana: "North America",
  Haiti: "North America",
  Montserrat: "North America",
  Nicaragua: "North America",
  "Puerto Rico": "North America",
  "Saint Kitts and Nevis": "North America",
  "Saint Lucia": "North America",
  "Saint Vincent and the Grenadines": "North America",
  "Turks and Caicos Islands": "North America",
  "US Virgin Islands": "North America",

  // Africa
  Botswana: "Africa",
  Burundi: "Africa",
  "Central African Republic": "Africa",
  Chad: "Africa",
  Comoros: "Africa",
  Congo: "Africa",
  Djibouti: "Africa",
  "Equatorial Guinea": "Africa",
  Eritrea: "Africa",
  Eswatini: "Africa",
  Lesotho: "Africa",
  Liberia: "Africa",
  Madagascar: "Africa",
  Malawi: "Africa",
  Mauritania: "Africa",
  Mauritius: "Africa",
  Mozambique: "Africa",
  Namibia: "Africa",
  Niger: "Africa",
  Rwanda: "Africa",
  "Sao Tome and Principe": "Africa",
  Seychelles: "Africa",
  "Sierra Leone": "Africa",
  Somalia: "Africa",
  "South Sudan": "Africa",

  // Asia. Guam plays in the Asian confederation despite sitting in the Pacific,
  // the mirror image of the Australia note above.
  Afghanistan: "Asia",
  Bahrain: "Asia",
  Bangladesh: "Asia",
  Bhutan: "Asia",
  Brunei: "Asia",
  Cambodia: "Asia",
  Guam: "Asia",
  "Hong Kong": "Asia",
  Kuwait: "Asia",
  Kyrgyzstan: "Asia",
  Laos: "Asia",
  Lebanon: "Asia",
  Macau: "Asia",
  Maldives: "Asia",
  Mongolia: "Asia",
  Myanmar: "Asia",
  Nepal: "Asia",
  "North Korea": "Asia",
  Oman: "Asia",
  Pakistan: "Asia",
  Palestine: "Asia",
  Philippines: "Asia",
  Singapore: "Asia",
  "Sri Lanka": "Asia",
  Syria: "Asia",
  Taiwan: "Asia",
  Tajikistan: "Asia",
  "Timor-Leste": "Asia",
  Turkmenistan: "Asia",
  Yemen: "Asia",

  // Oceania
  "American Samoa": "Oceania",
  "Cook Islands": "Oceania",
  "New Caledonia": "Oceania",
  Samoa: "Oceania",
  "Solomon Islands": "Oceania",
  Tahiti: "Oceania",
  Tonga: "Oceania",
  Vanuatu: "Oceania",
};

/** The confederation a nation qualifies through, or null if it has none on file. */
export function confederationOf(nation: string): Confederation | null {
  return CONFEDERATION_OF[nation] ?? null;
}

/**
 * Split `nations` by confederation, preserving the input order within each and
 * dropping any nation with no confederation on file. Confederations with no
 * eligible nation are omitted entirely.
 */
export function groupByConfederation(nations: string[]): Map<Confederation, string[]> {
  const out = new Map<Confederation, string[]>();
  for (const nation of nations) {
    const conf = confederationOf(nation);
    if (!conf) continue;
    const list = out.get(conf);
    if (list) list.push(nation);
    else out.set(conf, [nation]);
  }
  return out;
}

/**
 * Allocate `slots` tournament places across confederations by the
 * largest-remainder method, weighted by each confederation's share of the
 * world's genuinely competitive nations rather than by how many nations it has.
 *
 * `contenders` is the set of nations strong enough to count toward a
 * confederation's weight (the caller passes the global strongest N — see
 * planQualifying). Weighting by raw nation count instead was measurably wrong:
 * Africa's eight eligible nations earned as many places as Europe's twenty-four
 * despite Europe holding every one of the eight strongest sides, and the
 * tournament filled up with nations that had no business there while Germany
 * and England watched from home.
 *
 * A confederation with at least one eligible nation but no contender still
 * takes a floor of one place, so every part of the world stays represented —
 * the same reason real qualifying reserves places for its smaller
 * confederations. A confederation is never given more places than it has
 * nations; places freed by that cap go to the largest remainders. Pure function
 * of the inputs, so it needs no rng and is stable for a given world.
 *
 * NO LONGER HOW A NEW CAMPAIGN IS ALLOCATED (2026-09-11): that is
 * allocateByQuota, below. This stays because a qualifying campaign drawn
 * before campaigns recorded their own allocation replays it — see
 * planQualifying.
 */
export function allocateSlots(
  byConfederation: Map<Confederation, string[]>,
  slots: number,
  contenders: ReadonlySet<string> = new Set(),
): Map<Confederation, number> {
  const entries = [...byConfederation.entries()].filter(([, ns]) => ns.length > 0);
  const out = new Map<Confederation, number>();
  if (entries.length === 0) return out;

  // Weight = contenders held, or 0 for a confederation that has none. When no
  // contender set is supplied at all, fall back to nation counts so the
  // function still behaves sensibly on its own.
  const weightOf = (nations: string[]): number =>
    contenders.size === 0 ? nations.length : nations.filter((n) => contenders.has(n)).length;
  const totalWeight = entries.reduce((sum, [, ns]) => sum + weightOf(ns), 0);
  const totalNations = totalWeight > 0 ? totalWeight : entries.reduce((sum, [, ns]) => sum + ns.length, 0);

  // Floor of one place each; if the confederations alone outnumber the places,
  // the largest ones take them (a world too fragmented to seat everyone).
  if (entries.length >= slots) {
    const ranked = [...entries].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    ranked.slice(0, slots).forEach(([conf]) => out.set(conf, 1));
    return out;
  }

  // Proportional share of the places left after every confederation's floor.
  const spare = slots - entries.length;
  const exact = entries.map(([conf, ns]) => ({
    conf,
    cap: ns.length,
    quota: ((totalWeight > 0 ? weightOf(ns) : ns.length) / totalNations) * spare,
  }));
  for (const e of exact) out.set(e.conf, 1 + Math.floor(e.quota));

  // Hand out the rounding remainder, largest first, respecting each cap.
  let remaining = slots - [...out.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort(
    (a, b) => (b.quota - Math.floor(b.quota)) - (a.quota - Math.floor(a.quota)) || a.conf.localeCompare(b.conf),
  );
  while (remaining > 0) {
    const before = remaining;
    for (const e of byRemainder) {
      if (remaining === 0) break;
      const current = out.get(e.conf)!;
      if (current >= e.cap) continue;
      out.set(e.conf, current + 1);
      remaining--;
    }
    if (remaining === before) break; // every confederation is at its cap
  }

  return out;
}

/**
 * How the real World Cup of each size shared its places between the six
 * confederations, used as WEIGHTS rather than counts (they are normalised, so a
 * row need not sum to its size). Each size takes the allocation of the era that
 * really played that format:
 *
 *  - 16: 1974. UEFA 9 (the hosts among them), CONMEBOL 4 (the holders among
 *    them), CONCACAF 1, CAF 1, and one place for Asia and Oceania together,
 *    which went to Australia.
 *  - 24: 1986. UEFA 14, CONMEBOL 4, CAF 2, AFC 2, CONCACAF 2 with the hosts,
 *    and Oceania's half place in a playoff it lost.
 *  - 32: the 1998-2022 quotas. UEFA 13, CAF 5, AFC 4.5, CONMEBOL 4.5, CONCACAF
 *    3.5, OFC 0.5, the halves being intercontinental playoffs. The host's place
 *    is left out: the game has no host, and a rotating one averages to noise.
 *  - 48: 2026. UEFA 16, CAF 9, AFC 8, CONMEBOL 6, CONCACAF 6 with its three
 *    hosts, OFC 1, and the six-team intercontinental playoff for two places
 *    shared a third each (one side each for AFC, CAF, CONMEBOL and OFC, two for
 *    CONCACAF).
 *
 * The point of weights over counts is that this world's confederations are not
 * real football's size: almost every player is generated from a European
 * league's nationality table, so a default world fields ~31 European nations
 * but only ~6 Asian and ~4 North American ones. See allocateByQuota for how the
 * quotas bend to that.
 */
export const CONFEDERATION_QUOTAS: Record<number, Record<Confederation, number>> = {
  16: { "Europe": 9, "South America": 4, "Africa": 1, "Asia": 0.75, "North America": 1, "Oceania": 0.25 },
  24: { "Europe": 14, "South America": 4, "Africa": 2, "Asia": 2, "North America": 2, "Oceania": 0.5 },
  32: { "Europe": 13, "South America": 4.5, "Africa": 5, "Asia": 4.5, "North America": 3.5, "Oceania": 0.5 },
  48: { "Europe": 16, "South America": 6.33, "Africa": 9.33, "Asia": 8.33, "North America": 6.67, "Oceania": 1.33 },
};

/**
 * The most of its own entrants a confederation may send, before the field is
 * too big for the world to allow it. Two thirds is CONMEBOL's real share
 * (6.33 of its 10 at the 2026 World Cup), the highest any confederation has.
 * Without it a quota meant for real football's 46 Asian nations lands on this
 * world's 6 and sends all of them, which is no qualifying at all.
 */
export const QUOTA_MAX_SHARE_OF_ENTRANTS = 2 / 3;

/**
 * Share `slots` World Cup places between confederations the way FIFA does: by
 * a fixed quota for each (CONFEDERATION_QUOTAS, the real allocation for a World
 * Cup of this size), bent to fit the nations this world actually has. Team
 * strength plays no part, deliberately — real quotas are set in advance and a
 * confederation keeps its places through a bad cycle. It replaced
 * allocateSlots, which dealt places by how many of the world's strongest
 * nations each confederation held; that filled the World Cup with the best
 * teams and made qualifying outside Europe a formality or a lockout, neither of
 * which is how the real thing reads.
 *
 * In order:
 *  1. Caps. No confederation sends more than QUOTA_MAX_SHARE_OF_ENTRANTS of its
 *     entrants (at least one). When the caps together can't fill the field —
 *     a 48-nation World Cup in a thin world — they are raised one place at a
 *     time, always for the confederation sending the smallest share, so the
 *     slack is shared out evenly rather than landing on one.
 *  2. Floors. Every confederation gets one place per `maxGroup` nations
 *     (rounded up), since the draw never makes more groups than places: that
 *     is what keeps a qualifying group from growing past `maxGroup` nations.
 *     The bug this began with was nine nations on one place, drawn into one
 *     group and played three times, 24 games each. A world so big the floors
 *     overrun the field falls back to sharing by nation count.
 *  3. The rest by quota, Sainte-Laguë: each place goes to the confederation
 *     with the highest quota / (2 x places + 1) that is still under its cap —
 *     the standard proportional method, with no bias toward big or small.
 *
 * Pure and rng-free, so it is stable for a given world.
 */
export function allocateByQuota(
  byConfederation: Map<Confederation, string[]>,
  slots: number,
  maxGroup: number,
  quotas: Record<Confederation, number> = CONFEDERATION_QUOTAS[slots] ?? CONFEDERATION_QUOTAS[32],
): Map<Confederation, number> {
  const confs = [...byConfederation.entries()]
    .filter(([, ns]) => ns.length > 0)
    .map(([conf, ns]) => ({ conf, nations: ns.length, quota: quotas[conf] ?? 0 }));
  if (confs.length === 0) return new Map();
  // More confederations than places: the legacy rule already handles it.
  if (confs.length >= slots) return allocateSlots(byConfederation, slots);

  const cap = new Map(confs.map((c) => [
    c.conf, Math.min(c.nations, Math.max(1, Math.floor(c.nations * QUOTA_MAX_SHARE_OF_ENTRANTS))),
  ]));
  const capTotal = () => [...cap.values()].reduce((a, b) => a + b, 0);
  while (capTotal() < slots) {
    const open = confs.filter((c) => cap.get(c.conf)! < c.nations);
    if (open.length === 0) break; // fewer nations than places; the caller never asks this
    open.sort((a, b) =>
      cap.get(a.conf)! / a.nations - cap.get(b.conf)! / b.nations
      || b.quota - a.quota || a.conf.localeCompare(b.conf));
    cap.set(open[0].conf, cap.get(open[0].conf)! + 1);
  }

  const out = new Map(confs.map((c) => [
    c.conf, Math.min(cap.get(c.conf)!, Math.max(1, Math.ceil(c.nations / maxGroup))),
  ]));
  const given = () => [...out.values()].reduce((a, b) => a + b, 0);
  if (given() > slots) return allocateSlots(byConfederation, slots);

  while (given() < slots) {
    const next = confs
      .filter((c) => out.get(c.conf)! < cap.get(c.conf)!)
      .sort((a, b) =>
        b.quota / (2 * out.get(b.conf)! + 1) - a.quota / (2 * out.get(a.conf)! + 1)
        || b.nations - a.nations || a.conf.localeCompare(b.conf))[0];
    if (!next) break; // every cap met; cannot happen once the caps cover the field
    out.set(next.conf, out.get(next.conf)! + 1);
  }
  return out;
}

/**
 * Each confederation's cup: what it's called and how big a field it
 * would like. The actual field is the smaller of this target and how many
 * eligible nations the confederation has (see formatFor), so a target is a
 * ceiling rather than a promise.
 *
 * Every confederation has one, but a default world only plays three of them —
 * see CONFEDERATION_CUP_MIN_NATIONS for why, and why the other three are defined
 * anyway rather than left out.
 */
export interface ConfederationCupSpec {
  confederation: Confederation;
  name: string;
  /** Largest field this cup will take, if the nations are there. */
  targetField: number;
}

export const CONFEDERATION_CUPS: ConfederationCupSpec[] = [
  { confederation: "Europe", name: "European Championship", targetField: 16 },
  { confederation: "South America", name: "Copa América", targetField: 10 },
  { confederation: "Africa", name: "Africa Cup of Nations", targetField: 16 },
  { confederation: "Asia", name: "Asian Cup", targetField: 16 },
  { confederation: "North America", name: "Gold Cup", targetField: 12 },
  { confederation: "Oceania", name: "OFC Nations Cup", targetField: 8 },
];

/** The cup spec for a confederation, or null if it somehow has none. */
export function confederationCupSpec(confederation: string): ConfederationCupSpec | null {
  return CONFEDERATION_CUPS.find((t) => t.confederation === confederation) ?? null;
}

/**
 * A confederation's index in CONFEDERATIONS. Used to give each cup its
 * own rng stream — several are played in the same offseason, so sharing one
 * stream would make each tournament's results depend on the order the others
 * were played in.
 */
export function confederationIndex(confederation: string): number {
  return CONFEDERATIONS.indexOf(confederation as Confederation);
}
