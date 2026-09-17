/**
 * EA FC league names -> soccer-gm competition names.
 *
 * The datasets disagree on naming across editions ("Spain Primera Division",
 * "LaLiga", "LaLiga EA Sports" and "Spanish La Liga" all appear for the same
 * competition, and sponsor names churn yearly), so each competition matches a
 * list of distinctive substrings against the normalized league cell rather than
 * relying on an exact name.
 *
 * Order matters: second-tier patterns are tested before first-tier ones,
 * because "2. Bundesliga" contains "bundesliga" and "Liga Portugal 2" contains
 * "liga portugal". Every rule is checked most-specific-first for that reason.
 */

export interface LeagueRule {
  /** The soccer-gm competition name this maps onto. */
  competition: string;
  /** Normalized substrings that identify the league. */
  patterns: string[];
}

/**
 * Normalize a league cell the same way headers are normalized.
 *
 * **Accents are deliberately NOT folded, and this is load-bearing.** Every
 * non-`[a-z0-9]` character becomes a separator, so "Süper Lig" comes out
 * `s_per_lig` — which looks like a bug and is the obvious thing to "fix" by
 * NFD-stripping diacritics first. Doing that was measured against the FC26
 * dataset and it silently breaks two competitions: Brazil's "Série A" (id 7,
 * 14 clubs) folds onto `serie_a` and is claimed by Italy, and "Primera
 * División" (id 338) folds onto `primera_division` and is claimed by Spain.
 * Both are unique names within that file, so the unambiguous-name fallback
 * trusts them and imports 19 foreign clubs — the exact failure LEAGUE_IDS
 * exists to prevent. The accents are what keeps those names apart.
 *
 * A league whose real name carries an accent therefore needs the mangled form
 * as a pattern (see Turkey's `s_per_lig`), which is the cheaper trade.
 */
export function normalizeLeague(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Second tiers first — see the ordering note above. Within a country the tier-2
 * rule must be unambiguous against the tier-1 name.
 */
export const LEAGUE_RULES: LeagueRule[] = [
  // --- Second tiers ---
  // Scotland's second tier comes FIRST, and the order is load-bearing: its name
  // is "Scottish Championship", which *contains* England's bare "championship"
  // pattern, and mapLeague returns on the first matching rule. Listed after
  // England it would silently import every Scottish second-tier club into the
  // English Championship — the same class of bug as the 12 Austrian clubs in
  // the Bundesliga. Bare "premiership" is likewise NOT a pattern for Scotland's
  // top flight below: Northern Ireland's top division is the NIFL Premiership.
  { competition: "Scottish Division 2", patterns: ["scottish_championship", "spfl_championship", "cinch_championship"] },
  { competition: "English Division 2", patterns: ["championship", "efl_championship", "english_league_championship"] },
  { competition: "Spanish Division 2", patterns: ["segunda_division", "laliga_2", "la_liga_2", "laliga_hypermotion", "spain_segunda"] },
  { competition: "Italian Division 2", patterns: ["serie_b"] },
  { competition: "German Division 2", patterns: ["2_bundesliga", "german_2", "bundesliga_2"] },
  { competition: "French Division 2", patterns: ["ligue_2", "french_ligue_2", "domino_s_ligue_2"] },
  { competition: "Portuguese Division 2", patterns: ["liga_portugal_2", "segunda_liga", "liga_2", "portuguese_segunda"] },
  // Belgium's and Turkey's second tiers are absent from every dataset checked
  // so far, so neither has a verified id below — these resolve by name only,
  // exactly like Portugal's. Bare "1_lig" is deliberately NOT a pattern: it is
  // a substring of Poland's "Fortuna 1 Liga" (`fortuna_1_liga`), so it would
  // import a third country's league. Only the sponsor/federation-qualified
  // forms are listed.
  { competition: "Belgian Division 2", patterns: ["challenger_pro_league", "belgian_first_division_b", "proximus_league"] },
  { competition: "Turkish Division 2", patterns: ["tff_1_lig", "trendyol_1_lig", "turkish_1_lig"] },
  // The Netherlands' second tier. "eerste_divisie" is the risk to know about:
  // Suriname's *top* flight is the SVB Eerste Divisie, so on a dataset that
  // carries Surinamese football this pattern would claim it. No dataset checked
  // so far does, and the id route below would separate them if one did.
  { competition: "Dutch Division 2", patterns: ["eerste_divisie", "keuken_kampioen", "jupiler_league"] },
  // Greece's and Serbia's second tiers. "super_league_2" must come before the
  // Greek tier-1 rule below for the usual first-match reason, and bare
  // "prva_liga" is deliberately absent — it is the second tier in Serbia but a
  // *top* flight in Croatia, Slovenia, Bosnia and Montenegro.
  { competition: "Greek Division 2", patterns: ["super_league_2", "souper_ligka_2", "football_league_greece"] },
  { competition: "Serbian Division 2", patterns: ["prva_liga_srbije", "serbian_first_league", "prva_liga_serbia"] },

  // --- First tiers ---
  { competition: "English Division 1", patterns: ["premier_league", "english_premier"] },
  { competition: "Spanish Division 1", patterns: ["primera_division", "laliga", "la_liga", "spain_primera"] },
  { competition: "Italian Division 1", patterns: ["serie_a"] },
  { competition: "German Division 1", patterns: ["bundesliga"] },
  { competition: "French Division 1", patterns: ["ligue_1"] },
  { competition: "Portuguese Division 1", patterns: ["liga_portugal", "primeira_liga", "liga_nos", "liga_zon", "portuguese_liga"] },
  // Belgium's top flight is the one competition here with NO safe bare name.
  // The FC26 dataset carries three leagues called exactly "Pro League" —
  // Belgium's (id 4), Saudi Arabia's (id 350) and the UAE's (id 2013) — so a
  // "pro_league" pattern would claim all three. Only the qualified forms are
  // listed, and Belgium is really identified by its id below; on this dataset
  // the resolver reaches it that way and the Saudi/UAE rows fall through to
  // null, which is what we want.
  { competition: "Belgian Division 1", patterns: ["jupiler", "belgian_pro_league", "belgium_pro_league", "belgian_first_division_a"] },
  // `s_per_lig` is "Süper Lig" after normalization — the ü becomes a separator.
  // See the note on normalizeLeague for why that isn't fixed by folding accents.
  { competition: "Turkish Division 1", patterns: ["super_lig", "s_per_lig", "turkish_super"] },
  // "eredivisie" is unique across every dataset checked, and does not contain
  // and is not contained by any other pattern here.
  { competition: "Dutch Division 1", patterns: ["eredivisie", "dutch_eredivisie"] },
  // Scotland qualified every way. Bare "premiership" is deliberately absent —
  // Northern Ireland's NIFL Premiership would match it.
  { competition: "Scottish Division 1", patterns: ["scottish_premiership", "spfl_premiership", "cinch_premiership", "ladbrokes_premiership"] },
  // Greece. Bare "super_league" is safe here only because the Greek second-tier
  // rule ("super_league_2") is listed above and therefore matches first; there
  // is no other Super League in the datasets checked. "souper_ligka" is the
  // normalized form of "Σούπερ Λίγκα" when a dataset ships it transliterated.
  // Greece. Bare "super_league" is deliberately NOT a pattern, and this was
  // corrected against the real FC26 export rather than reasoned about: that
  // file carries FOUR leagues called exactly "Super League" — Greece (63),
  // China (2012), Switzerland (189) and India (2149). The resolver's
  // ambiguous-name guard stops it importing the wrong country, but only by
  // dropping all four, so Greece silently imported nothing at all. It is
  // Belgium's "Pro League" situation exactly, and it takes the same answer:
  // qualified names only, and the id below does the real work.
  // "souper_ligka" is the normalized form of "Σούπερ Λίγκα" transliterated.
  { competition: "Greek Division 1", patterns: ["super_league_greece", "greek_super_league", "souper_ligka"] },
  // Serbia. "superliga" (one word) is Serbia's; the spaced "super liga" forms
  // belong to Denmark and Slovakia, so only the closed-up and qualified forms
  // are listed.
  { competition: "Serbian Division 1", patterns: ["superliga_srbije", "serbian_superliga", "mozzart_bet_superliga", "linglong_superliga"] },
  // The Americas' top flights (2026-09-14), each reached by a verified id in
  // LEAGUE_IDS; these names are the qualified fallbacks only. Bare "serie_a" is
  // Italy's rule above and must not be widened for Brazil (accents are not folded,
  // so "Série A" normalizes to `s_rie_a` and stays apart). Bare "liga_profesional"
  // is absent because Ecuador's LigaPro and several others share the words, and
  // bare "mls" is a substring hazard. Their second tiers carry no rule: no export
  // checked holds any of them.
  { competition: "Brazilian Division 1", patterns: ["brasileir", "campeonato_brasileiro"] },
  { competition: "Argentine Division 1", patterns: ["liga_profesional_de_f", "argentina_primera", "torneo_betano"] },
  { competition: "US Division 1", patterns: ["major_league_soccer"] },
];

/**
 * Resolve an EA league cell to a soccer-gm competition name, or null when the
 * league is not one this converter covers (the datasets carry 30+ leagues;
 * everything else is simply skipped).
 *
 * **Coverage is every FIRST and SECOND division across the game's twelve
 * countries** — see COVERED_COMPETITIONS, which is derived from the rules rather
 * than listed. The big four's THIRD divisions are deliberately not covered:
 * rules for them would have to be written from real league names with no dataset
 * checked against, which is exactly what put 12 Austrian clubs in the German top
 * flight and every Scottish second-tier club in the English Championship. Cover
 * them by running inspectLeagues.ts over a real export, confirming the ids, and
 * minding the ORDER traps below — not by pattern-matching from memory.
 * Coverage is not the same as *presence*: no dataset checked so far carries
 * Portugal's, Belgium's or Turkey's second tier, and those divisions simply keep
 * their generated identities after an import, the same as any club a roster file
 * does not cover.
 *
 * **The Dutch, Scottish and Greek TOP flights were verified against the FC26
 * export on 2026-08-29 and now carry ids** (10, 50, 63). That check was worth
 * running exactly as this note asked: on the name route alone Scotland and
 * Greece resolved to *zero* clubs, because that file spells them "Premiership"
 * and "Super League" — one of which is deliberately unclaimed and the other of
 * which four federations share. The Netherlands worked on its name.
 *
 * **Their second tiers, and both Serbian divisions, still have no verified
 * id**: no dataset checked so far carries any of them, so they resolve by the
 * unambiguous-name fallback exactly like Portugal's second tier does. Run
 * scripts/eafc/inspectLeagues.ts over a new export and add the ids before
 * trusting an import that covers them; the name route is the weaker of the
 * two by design. Adding a league means adding a rule below *and*, where the
 * name is not unique, a verified id in LEAGUE_IDS — confirmed against a real
 * dataset with scripts/eafc/inspectLeagues.ts, since names alone collide across
 * federations.
 *
 * Name matching alone is NOT sufficient on real data — see resolveByRow below.
 */
export function mapLeague(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = normalizeLeague(raw);
  for (const rule of LEAGUE_RULES) {
    if (rule.patterns.some((p) => n.includes(p))) return rule.competition;
  }
  return null;
}

/**
 * Numeric league ids, which are unambiguous where names are not.
 *
 * League *names* collide across federations, and the exports strip the country
 * prefix that would separate them: in the FC26 dataset "Bundesliga" is both
 * Germany's (id 19) and Austria's (id 80), "Premier League" is both England's
 * (13) and Ukraine's (332), and "Serie A" is both Italy's (31) and Ecuador's
 * (2018). Matching on name alone pulled 12 Austrian clubs into the German top
 * flight and let Shakhtar compete for a Premier League slot.
 *
 * Belgium is the sharpest case in the file: "Pro League" is Belgium's (4),
 * Saudi Arabia's (350) *and* the UAE's (2013) in that one dataset, so the name
 * carries no country at all and the id is the only thing that separates them.
 *
 * Every id below was verified against that dataset by inspecting the clubs it
 * contains (see scripts/eafc/inspectLeagues.ts), not taken from memory: id 4
 * holds Club Brugge, Anderlecht, Genk and Union Saint-Gilloise, id 68 holds
 * Galatasaray, Fenerbahçe, Beşiktaş and Trabzonspor.
 *
 * Portugal's, Belgium's and Turkey's second tiers are absent from that dataset,
 * so no id is listed for any of them — they resolve by name instead, via the
 * unambiguous-name rule.
 */
export const LEAGUE_IDS: Record<string, string> = {
  "13": "English Division 1",   // Premier League
  "14": "English Division 2",   // Championship
  "53": "Spanish Division 1",   // La Liga
  "54": "Spanish Division 2",   // La Liga 2
  "31": "Italian Division 1",   // Serie A
  "32": "Italian Division 2",   // Serie B
  "19": "German Division 1",    // Bundesliga
  "20": "German Division 2",    // 2. Bundesliga
  "16": "French Division 1",    // Ligue 1
  "17": "French Division 2",    // Ligue 2
  "308": "Portuguese Division 1", // Primeira Liga
  "4": "Belgian Division 1",    // Pro League (NOT 350 Saudi / 2013 UAE)
  "68": "Turkish Division 1",   // Süper Lig
  // Verified against the FC26 export on 2026-08-29, the way every id above was:
  // by inspecting the clubs each one holds, not from memory. Id 50 holds Celtic,
  // Rangers, Hearts and Aberdeen; 63 holds AEK, Olympiacos, PAOK and
  // Panathinaikos; 10 holds Ajax, PSV, Feyenoord and AZ.
  //
  // The first two are what make Scotland and Greece importable at all. Their
  // name rules alone match nothing in that file: its Scottish cell is a bare
  // "Premiership" (which stays unclaimed on purpose — Northern Ireland's NIFL
  // Premiership would take it), and its Greek cell is a bare "Super League"
  // shared with three other federations. Both leagues resolved to zero clubs
  // before these ids existed.
  "50": "Scottish Division 1",  // Premiership (NOT Northern Ireland's NIFL Premiership)
  "63": "Greek Division 1",     // Super League (NOT 2012 China / 189 Switzerland / 2149 India)
  "10": "Dutch Division 1",     // Eredivisie
  // Verified against the FC26 export on 2026-09-14 by the clubs each holds: 353
  // holds Boca Juniors, River Plate, Racing Club and Independiente (30 clubs); 39
  // holds Inter Miami, LAFC, Seattle and Toronto (30); 7 holds Flamengo,
  // Palmeiras, Corinthians and São Paulo (14 of the 20, the clubs EA licenses).
  // 7 is also why accents are not folded: folded, "Série A" is Italy's.
  "353": "Argentine Division 1", // Liga Profesional de Fútbol
  "39": "US Division 1",        // Major League Soccer
  "7": "Brazilian Division 1",  // Série A (NOT 31 Italy / 2018 Ecuador)
};

/**
 * Every soccer-gm competition this converter can fill, by either route.
 *
 * Derived rather than written out, so a tool reporting "which divisions will
 * keep their fictional clubs" cannot drift from the rules that decide it — the
 * hand-maintained copy this replaced in inspectLeagues.ts still listed twelve
 * after the world had grown to sixteen.
 */
export const COVERED_COMPETITIONS: string[] = [
  ...new Set([...LEAGUE_RULES.map((r) => r.competition), ...Object.values(LEAGUE_IDS)]),
];

export interface LeagueResolver {
  /** Resolve one row's league, given its raw league name and id. */
  resolve(name: string | undefined, id: string | undefined): string | null;
  /** League names that were skipped because they span several ids. */
  ambiguous: { name: string; ids: string[] }[];
}

/**
 * Build a resolver that prefers league ids and only falls back to the name
 * when that name is unambiguous *within this file*.
 *
 * The fallback rule is what keeps this working on datasets whose ids we don't
 * recognise: a name that maps to exactly one id in the file cannot be hiding a
 * second country's league, so trusting it is safe. A name spanning several ids
 * (Germany's and Austria's "Bundesliga") is only honoured for the ids we
 * actually know, and the rest are dropped rather than guessed at.
 *
 * Datasets with no id column at all fall back to pure name matching, which is
 * the best available and was the previous behaviour.
 */
export function buildLeagueResolver(
  rows: { name: string | undefined; id: string | undefined }[],
): LeagueResolver {
  const idsByName = new Map<string, Set<string>>();
  let sawAnyId = false;
  for (const { name, id } of rows) {
    if (!name) continue;
    if (id) sawAnyId = true;
    if (!idsByName.has(name)) idsByName.set(name, new Set());
    if (id) idsByName.get(name)!.add(id);
  }

  const ambiguous: { name: string; ids: string[] }[] = [];
  for (const [name, ids] of idsByName) {
    if (ids.size > 1 && mapLeague(name) !== null) {
      ambiguous.push({ name, ids: [...ids] });
    }
  }

  return {
    ambiguous,
    resolve(name, id) {
      if (id && LEAGUE_IDS[id]) return LEAGUE_IDS[id];
      if (!name) return null;
      const byName = mapLeague(name);
      if (byName === null) return null;
      // With ids present, only trust the name when it identifies one league.
      if (sawAnyId) {
        const ids = idsByName.get(name);
        if (ids && ids.size > 1) return null;
      }
      return byName;
    },
  };
}
