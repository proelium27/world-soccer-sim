# Importing EA FC rosters

Turns an EA FC player CSV into a soccer-gm roster file, so you can play a
season with real clubs and real players instead of the generated fictional
world.

Nothing here ships. The converter is a dev script, the CSV and the roster file
it produces are gitignored, and the game continues to ship its own 320
fictional clubs — real names and ratings are a local overlay you bring
yourself, loaded through the roster import that already exists on the Leagues
page.

## Workflow

1. Get an EA FC player dataset as CSV — the sofifa-derived "complete player
   dataset" exports work directly. You want the version with the *detailed*
   attribute columns (`attacking_short_passing`, `defending_standing_tackle`,
   `movement_sprint_speed`, `goalkeeping_*`), not just the six face stats;
   without them every player's skills get flattened onto pace/shooting/passing
   and imported squads lose their individuality.

2. Convert:

   ```bash
   npx tsx scripts/eafcRosterConvert.ts --in players_25.csv --out eafc-roster.json
   ```

   Run it with `--help` for the full flag list. It prints what it kept, what it
   skipped, and the EA→soccer-gm overall mapping per league, so you can see
   what it did before loading anything.

3. In-game: **Leagues → Import →** pick `eafc-roster.json`, then
   choose your club from the imported teams and start.

Import replaces each listed club's identity *and* squad, and tops any short
position up with deliberately-weak filler so every squad is legal. Slots the
file doesn't cover keep their existing fictional club untouched — so a partial
import is fine.

**The format tag is `world-soccer-sim-roster`** (renamed from `soccer-gm-roster`
on 2026-08-10 to match the game's name). The old tag is still accepted on read
and always will be — files carrying it are already in people's hands — so an
older converted file keeps loading; `parseRosterFile` upgrades the tag as it
reads, so anything re-serialized comes out on the new one.

**A roster file can only be loaded when a league is created**, not into a save
in progress: replacing a squad deletes the careers, stats and transfer history
of everyone it overwrites, which is fine on a world that is one second old and
destructive on one you've played. `applyRosterFileToNewLeague` is the entry
point, and it redoes the two things `createLeagueState` derives from a squad —
AI formations, and the user's scouting observation stamps — against the
imported players rather than the generated ones it threw away.

## What the converter has to reconcile

**Rating scale.** This is the part that matters most. A freshly generated
soccer-gm world spans roughly 23–81 OVR (tier-1 median 62, 95th percentile 73,
maximum 81); 90+ only ever appears after decades of progression, by design. EA
FC's top flights run 47–91 with a couple of dozen players at 88+. Importing EA
numbers verbatim would lift the whole world about ten points, which collides
with the anti-inflation equilibrium the sim is tuned around — wages are cubic
in OVR, the elite valuation premium keys off 76, the division-2 ceiling off 70.

So overalls are **rank-matched** rather than fitted to a hand-tuned curve: a
player at the Nth percentile of the imported set is assigned the OVR at the Nth
percentile of a freshly generated reference world. The imported world therefore
has the same OVR distribution as a generated one, with no tuned constants to
drift. The practical consequence is that the best players in the world read
around 80 rather than 91 (on the FC26 dataset: Mbappé, Lautaro, Kimmich and
Kane at 80; Van Dijk, Salah, Rodri, Haaland and Bellingham at 79) — the
ordering and the gaps are faithful, the absolute numbers are on soccer-gm's
scale, and the very top is left where the sim leaves it: reachable only through
progression.

`--scale` picks how leagues are matched:

- `competition` (default) rank-matches each league onto its own soccer-gm
  counterpart. This preserves the game's designed country-strength gaps (France
  and Portugal are deliberately weaker — see `COUNTRY_STRENGTH_OFFSET`) and
  keeps second-tier stars below the division-2 ceiling.
- `global` pools every imported league, so real cross-league gaps carry over
  instead. More faithful to reality, but the strongest second-tier players can
  then clear the division-2 ceiling (70) and get swept up to a top flight in
  the first offseason by `enforceDivision2Ceiling`.

**Attributes.** The two sets line up unusually well — both are 1–99, and 12 of
soccer-gm's 14 skills have a near-namesake in EA's list. Two judgment calls:
`tackling` averages EA's standing and sliding tackle, and `positioning` (which
soccer-gm weights for *every* position, so it means general game-reading) is
blended per-position from EA's attacking `mentality_positioning` and defensive
`defending_marking_awareness`, using `goalkeeping_positioning` for keepers.

Each player's attributes give his rating *shape*; the shape is then shifted
uniformly until it computes to his rescaled overall. That is what keeps a fast
winger fast and a strong one strong while still landing every player on the
right number.

**Positions.** EA's 27 slot labels collapse onto soccer-gm's 8 roles. The lossy
one is width: LM/RM and LW/RW all become `W`, since there is no wide-midfield
role and `W` is the closer fit for both.

**Potential** gets its own curve rather than reusing the overall one, because
it is a different distribution — a 94-potential teenager sits above every
*current* overall in the dataset, so the overall curve clamped him to the top of
its range and gave every wonderkid in the world an identical ceiling. Potential
is display-only in this game (progression never reads it; it is a scout
estimate), but it is the number that tells you who is worth developing, so it is
worth getting right. With its own curve, a 17-year-old Lamine Yamal comes out
78 now / 82 ceiling while a 33-year-old Van Dijk is 79 / 80.

**Leagues and clubs.** Only the competitions this converter covers are kept;
everything else in the dataset is skipped and reported. It now covers **all
sixteen the game models**, Belgium and Turkey included. Coverage is not the same
as presence, though: the FC26 export carries the Belgian Pro League (16 clubs)
and the Süper Lig (18) but *no* second tier for Belgium, Turkey or Portugal, so
those three divisions keep their generated identities after an import unless a
names file fills them. Each league's clubs are ranked by squad strength and the
top 20 take the game's 20 slots — leagues with
18 real clubs (Bundesliga, Ligue 1, Primeira Liga) leave two fictional clubs in
place, and leagues with more (the Championship's 24) drop the weakest. Squads
are picked to match `ROSTER_COMPOSITION` rather than taking a flat top 25, so
nobody ends up with one keeper and seven strikers.

**Leagues are matched by id, not by name — this matters more than it looks.**
League names collide across federations, and the exports strip the country
prefix that would separate them. In the FC26 dataset, "Bundesliga" is both
Germany's (id 19) and Austria's (id 80), "Premier League" is both England's (13)
and Ukraine's (332), "Serie A" is both Italy's (31) and Ecuador's (2018), and
"Primera Division" is Chile's and Venezuela's but *not* Spain's (which is "La
Liga", 53). Name matching alone put twelve Austrian clubs into the German top
flight and let Shakhtar Donetsk compete for a Premier League slot.

So `LEAGUE_IDS` in `leagues.ts` maps the ids, each one verified by inspecting
the clubs it actually contains rather than taken from memory. A league name is
only trusted when it maps to exactly one id in the file, which keeps unfamiliar
datasets working without reopening the hole.

**Belgium is the sharpest case, and it is why Belgium has no bare name rule at
all.** FC26 carries *three* leagues named exactly "Pro League": Belgium's (id 4),
Saudi Arabia's (350) and the UAE's (2013). The name carries no country
whatsoever, so a `pro_league` pattern would have claimed Al Hilal and Al Nassr
for the Belgian top flight. Belgium is reached by id alone; only qualified forms
("Jupiler Pro League", "Belgian First Division A") are matched by name.

**Turkey is why accents are deliberately not folded in `normalizeLeague`.**
"Süper Lig" normalizes to `s_per_lig`, since every non-alphanumeric character
becomes a separator — which looks like a bug, and the obvious fix is to strip
diacritics first. That was tried and measured against FC26: it silently hands
Brazil's "Série A" (id 7, 14 clubs) to Italy and "Primera División" (id 338) to
Spain, because both then fold onto a pattern and both are unique names within
the file, so the unambiguous-name fallback trusts them. 19 foreign clubs, no
warning. The accents are load-bearing; Turkey carries the mangled `s_per_lig`
as a pattern instead.

**Before trusting a new dataset, inspect it:**

```bash
npx tsx scripts/eafc/inspectLeagues.ts --in players.csv
```

It lists every (league name, id) group with its club count, says which
competition each resolves to, and flags any name that would have been imported
into the wrong competition. Sanity-check the club counts: 20 for the Premier
League, La Liga, Serie A; 18 for the Bundesliga, Ligue 1 and Primeira Liga.
Anything higher means a foreign league is leaking in.

To check the result afterwards:

```bash
npx tsx scripts/eafc/inspectRosterFile.ts --in eafc-roster.json --clubs
```

It prints the clubs, the strongest players, and the OVR distribution — which
should look like a generated world's (p50 ~55, p95 ~71, p99 ~75, max ~81).

Note that datasets don't necessarily carry all sixteen leagues. The FC26 export
has no Liga Portugal 2, so Portuguese Division 2 keeps all 20 fictional clubs;
the converter says so in its warnings rather than leaving you to notice.

## Filling the gaps with a second file

A converted file can't cover every slot: the 18-club leagues (Bundesliga,
Ligue 1, Primeira Liga) leave 2 slots each, and a division the dataset omits
leaves all 20. `mergeRosterFiles.ts` fills those from a second roster file
carrying the missing club names:

```bash
npx tsx scripts/eafc/mergeRosterFiles.ts \
  --base eafc-roster.json --names soccer-gm-teams-x.json --out merged-roster.json
```

Names only: a filled slot keeps its generated squad. On the FC26 export plus a
hand-named file this takes the world from 210 real clubs to 233, with 210 of
them carrying real players.

**It also adopts the names file's colors** for clubs the base already has —
matched by the same comparison used for dedupe, so "Bayern Munich" recolors "FC
Bayern München". The converter hashes a color pair out of the club name (the
datasets carry none), which was invisible while clubs drew crest art and became
the whole visual identity once imported clubs stopped. On the FC26 export that
recolored 184 of 233 clubs: Liverpool goes from purple/gold to `#c8102e`.
Colors only, never abbreviations — the converter already ran those through a
uniqueness pass and a hand-written one could reintroduce a collision. The
recolor pass runs *before* filling, so an entry describing a club already in the
world is spent recoloring it rather than left to fill some other slot with a
second copy.

**The merge carries the base's `ovrScale` across, and forgetting to was a silent
+11 (fixed 2026-09-07).** `mergeRosterFiles` rebuilt its output as `{format,
formatVersion, competitions}`, which dropped the stamp the converter had just
written. Nothing throws and the merged file parses cleanly — but `ovrScale`
absent means "written before `OVR_SCALE_SHIFT`", so `rescaleRosterFile` lifts
every rating a *second* time and the whole imported world lands 11 points above
where the rank-match put it. It is the converted-then-merged path that ships as
"Download Real Rosters", so this was on the shipped pipeline rather than a corner
of it. The names file cannot disagree about the scale, because it contributes
identities only and carries no ratings to be on a scale at all — which is why
taking the base's value unconditionally is right rather than a guess.
`nationalities` was being dropped by the same line and is carried across too.

**Sourcing the names file got harder on 2026-08-10**: the Leagues page's "Export
Teams" button (which emitted exactly this — `buildRosterFile`, identities only)
was replaced by "Export Save", so the game no longer writes one. `buildRosterFile`
still exists and is still tested, just unreachable from the UI. Until something
re-exposes it, a names file has to be hand-written or AI-generated (the "Copy AI
Prompt to Customize" button still produces a prompt for one).

**Duplicate clubs are the entire difficulty, and they are not hypothetical.** A
hand-built names file routinely disagrees with the dataset about which division
a club is in. The two clubs spare in one file's Bundesliga list were Bochum,
Kiel and Schalke — all of which FC26 places in the 2. Bundesliga — and its Liga
Portugal 2 list contained Rio Ave, Nacional, Casa Pia and Chaves, all of which
sit in its own top flight. Fill by slot position and the same club ends up in
two divisions at once, which promotion/relegation then has to make sense of. So
every candidate is checked against every club already in the merged world, not
just the ones in its own competition.

The name comparison has to survive "Casa Pia" vs "Casa Pia AC", "Alverca" vs
"FC Alverca", "VfL Bochum 1848" vs "VfL Bochum", "ESTAC Troyes" vs "Troyes
Aubois" and "Vitória SC" vs "Vitoria de Guimaraes". It strips accents, club-type
words and founding years, then requires the shorter name's remaining tokens to
be *contained* in the longer's. Containment rather than overlap is deliberate:
overlap matched AS Saint-Étienne to Paris Saint-Germain on the shared "saint".
Cross-language spellings ("Bayern Munich" vs "FC Bayern München") get a small
explicit table, since no general string rule recovers them. The residual false
positive is a single-token name contained in a longer unrelated one — "Paris FC"
still reads as a subset of "Paris Saint-Germain" — which is why **the tool
prints every rejection with the club it matched**. Read that list; it is the
check on the heuristic.

**Club colors and abbreviations** aren't in the datasets, so both are
synthesized deterministically from the club name — which makes Liverpool purple
and gold.

**Imported clubs draw no crest art, only their colors.** `ClubCrest` keys the
England/Spain crest images by tid, i.e. by *slot*, which is right for the
shipped fictional clubs (a name is editable, a tid isn't) and wrong the instant
a slot becomes a real club — Real Madrid would wear an English club's badge.
`applyRosterFile` therefore flags every slot the file named with
`StoredTeam.importedIdentity`, and `CrestArtProvider` (wrapped around the
in-league shell in `Layout.tsx`, and around the new-league club picker so the
preview matches) suppresses art for those tids. It is a context rather than a
prop because `ClubCrest` is rendered from fourteen places, most holding only a
tid; any one of them forgetting to pass a flag would show a wrong badge on that
surface alone.

That makes the colors the club's entire visual identity, which is why
`mergeRosterFiles` adopts real colors from the names file (see below) and why
`--identities` is worth using for the clubs you care about:

```json
{
  "Manchester City": { "abbrev": "MCI", "colors": ["#6CABDD", "#ffffff"] },
  "FC Barcelona":    { "abbrev": "BAR", "colors": ["#A50044", "#004D98"] }
}
```

## Club strength anchors are realigned on import

Each club slot carries an `academyBase` — a fixed generation-time strength
anchor that drives its youth intake for the rest of the save — and generation
*shuffles* those anchors, so slot order has nothing to do with slot strength.
Import overwrites a club's identity and squad, so without realignment a
superclub could land on a slot anchored well below the league's strongest and
drift down over a long save, producing youth intakes that made no sense for who
it was.

`realignAcademyBases` (in `rosterImport.ts`, run at the end of
`applyRosterFile`) sorts each competition's *imported* clubs by squad strength
(`computeTeamRating`, XI auto-picked) and hands them that same group's existing
anchors in descending order.

**It is a permutation, not a recalculation, and that distinction is the whole
safety argument.** The competition's existing multiset of anchors is reassigned
among the same clubs, once, at import; nothing is derived from the imported
ratings. The total is exactly what generation produced, so the anti-inflation
equilibrium is untouched — it cannot ratchet, because there is no new value to
ratchet with. A test asserts the multiset is unchanged.

Only clubs whose squad was actually *replaced* take part, so a partial import
can't degrade the clubs it didn't touch. The corollary is that an imported club
can only claim an anchor already held by another imported club — never the best
in the division, if an untouched club happens to hold it.

## Layout

| Path | What |
| --- | --- |
| `scripts/eafcRosterConvert.ts` | CLI entry point |
| `scripts/eafc/csv.ts` | RFC 4180 reader (no dependency) |
| `scripts/eafc/schema.ts` | column detection across dataset naming conventions |
| `scripts/eafc/positions.ts` | EA position → soccer-gm position |
| `scripts/eafc/leagues.ts` | EA league id/name → competition |
| `scripts/eafc/inspectLeagues.ts` | audit a dataset's leagues before converting |
| `scripts/eafc/inspectRosterFile.ts` | audit a generated roster file after |
| `scripts/eafc/mergeRosterFiles.ts` | fill uncovered slots from a second roster file |
| `scripts/eafc/nations.ts` | EA nation name → nationality key |
| `scripts/eafc/ratings.ts` | EA attributes → `PlayerRatings`, shift-to-overall |
| `scripts/eafc/scale.ts` | rank-matching rescale |
| `scripts/eafc/identity.ts` | abbrevs and colors |
| `scripts/eafc/convert.ts` | the pipeline |
| `scripts/ovrDistProbe.ts` | prints the world's OVR distribution (calibration) |
| `test/core/eafcConvert.test.ts` | tests, incl. a round-trip through the real importer |

## What FC26 actually holds for the four newest countries (2026-08-29)

The Dutch, Scottish, Greek and Serbian rules were written from the leagues' real
names and shipped with a note asking for a check against a real dataset. Here is
that check, against `FC26_20250921.csv`.

| League | Cell in the file | Result |
| --- | --- | --- |
| Eredivisie | `Eredivisie` (id 10) | 18 clubs, full squads — the name is unique, so it always worked |
| Scottish Premiership | `Premiership` (id 50) | 12 clubs, full squads — **but only via the id** |
| Greek Super League | `Super League` (id 63) | 4 clubs (AEK, Olympiacos, PAOK, Panathinaikos) — **only via the id** |
| Serbian SuperLiga | absent | nothing, on any route |
| Scottish Championship, Greek SL2, Serbian Prva Liga | absent | nothing |

**Scotland and Greece imported zero clubs before their ids were added**, and
neither failed loudly. Scotland's cell is a bare `Premiership`, which is
deliberately not a pattern (Northern Ireland's NIFL Premiership would take it),
so nothing matched. Greece's is a bare `Super League`, which **four** federations
in that one file share — Greece, China, Switzerland and India — so the resolver's
ambiguous-name guard did its job and dropped all four rather than importing
Shanghai Port into the Greek top flight. Both are now reached by id, and the bare
`super_league` pattern is gone, exactly as Belgium's `Pro League` is handled.

The lesson generalizes past these two: **a name rule that matches nothing and a
name rule that matches the wrong country fail differently but look identical from
the outside — an empty competition.** Run `scripts/eafc/inspectLeagues.ts` over a
new export before trusting either.

## Partly-covered leagues are scaled against the world

Rank-matching maps the source's *weakest* player onto the reference league's
weakest, which is only sound when the source spans that league. FC26 holds 4 of
Greece's 14 clubs and they are the four best in the country, so matching them
onto the full Greek band states that Panathinaikos are Greece's relegation
fodder: measured, their top-11 comes out at 56.7 rather than 62.6, below every
Belgian and Turkish club.

A competition whose source covers less than `PARTIAL_LEAGUE_COVERAGE` (0.75) of
its slots therefore takes the pooled-world curve instead, which places each
player where his EA overall ranks against every imported league at once. The bar
clears every league FC26 genuinely carries — England's second tier is the
thinnest at 20 of 24 — so it only catches the fragmentary case, and the report
says when it fires. Scotland and the Netherlands come out byte-identical either
way.

Note the pooled curve only protects because the pool holds *other* leagues. A
one-league conversion is its own pool, and rank-matching spreads it across the
whole band again.

## Slot counts come from the competition

Divisions have real sizes (20 in England, 18 in Germany, 16 in Belgium, 14 in
Greece, 12 in Scotland, 10 in Scotland's second tier), so `--clubs` now defaults
to whatever the competition fields rather than a flat 20. It matters for which
clubs survive: the converter cuts an over-full league by squad strength, whereas
the importer would drop the overflow by slot order.
