# Club reputation and home-country pull

Design doc and work log. **Stage 1 (nationality realism) is built and being
tuned; Stages 2-3 are planned.** Decisions are Caleb's (2026-09-22), worked
out with a Fable review: the goal is realism, free agency is the player's
choice, playing time is a line, foreign-player rules are real league rules only
where a real league has one and bind the user too, wages are a later stage, and
there is no universal hidden AI bias toward domestic players.

## Why

**The main goal is nationality realism.** On `main`, a fresh 898-club world
(spectator save, `scripts/nationalityDriftProbe.ts`) drifts every league toward
the world's average mix and never levels off:

| League | Real | Generation | Season 5 | Season 20 (seed 1 / 2) |
|---|---|---|---|---|
| Argentina | 83.7% | 85.2% | 29.9% | 18.7% / 19.5% |
| Brazil | 74.9% | 78.2% | 26.4% | 19.6% / 16.7% |
| Serbia | 66.0% | 64.3% | 16.1% | 7.5% / 6.1% |
| Spain | 60.8% | 61.0% | 24.0% | 17.1% / 18.6% |
| England | 38.6% | 36.2% | 17.5% | 10.2% / 10.2% |

Youth intake draws from each league's real table, so academies pull toward the
real share; all the drift is movement. Nothing after generation looked at
nationality: free agency was one worldwide pool every club ranked on rating
alone, and the market and loans ignored it. Over the first five seasons the
foreign arrivals in top flights were 2,360 free agents (23 of them rated 73+),
1,751 bought from abroad and 444 loans; and the largest single way home players
left was being sold abroad.

## What Stage 1 builds

Three mechanisms, each modelling a real thing, none a formula tuned to hit a
number.

### A player's view of a club (`clubAppealFor`, `transfers/clubAppeal.ts`)

His reasons, line by line. The AI decides on the numbers and the screens show
the same lines, so the reason on screen is the reason he decided on. Every line
binds the user exactly as it binds an AI club.

| Line | What | Shape |
|---|---|---|
| Level of club | The existing stature rule (`moveAppeal`/`refusesMove`) | Only line that can refuse |
| Playing time | Would he start? His rating against the weakest man the club's shape fields at his position | `APPEAL_PLAYING_TIME` per point, clamped to −10/+5 points. ~0 for a star; decisive for a squad player |
| Home country | The club is in his country | `APPEAL_HOME × league domestic share × homeAttachment`. Leaving home costs what arriving gains |
| Confederation | The club is outside his confederation | `−APPEAL_CONFEDERATION × (1 − care)`, symmetric |
| Former club | He has played for them | `APPEAL_FORMER_CLUB`; never a refusal |

`homeAttachment` fades the home line for a star (the global care curve) **and
for a player who has outgrown his home league**: it falls to zero over
`APPEAL_HOME_FADE_RANGE` points above what his country's best clubs field
(Caleb, 2026-09-22: a 78-rated American leaves MLS; a 78-rated Englishman has no
reason to leave). Loans scale home and confederation by `APPEAL_LOAN_FACTOR`.
Score = sum of lines; as a valuation multiplier, `max(0, 1 + score)`, 0 when
refused. `moveAppealBetween` (transfer market, inbound offers) and both loan
loops read it; so does the user's loan search.

### Free agency is the player's choice (`freeAgencyMatch.ts`)

Club-proposing deferred acceptance in all three passes (shortfalls, depth
upgrades, prospects) and the mop-up. Clubs offer for open slots in their own
order; each player keeps the offer he likes best by his view of the club; a
rejected club moves on. Terminating and deterministic; stable and
order-independent except at a registration cap, where a slot that skipped a
player for a full cap never revisits him (rare, noted in freeAgencyMatch.ts). It
replaces the worst-first queue: a squad player picks where he would play and
where he is at home, which is the real reason small clubs sign real players,
and the ladder audit has to confirm that rather than assume it. Free agency
draws nothing from the shared rng (contract length is seeded per signing).
Cost: ~3s a pass on the 898-club world against ~1.5s for the greedy loop.

### Real foreign-player registration rules (`foreignRules.ts`)

See the table at the end of this doc.

### What the user sees

A Keen / Open / Reluctant / Won't talk label (his score, text only, reasons on
hover) on Free Agents, both Transfers tables, the Watchlist and the loan search;
the league-rule line ("Foreign players 5 / 6") above Free Agents and Recommended
Transfers where the league has a rule; "League rules" in place of the button
when a signing would break one. `transfers/userView.ts` is the one helper they
all read.

## Verified along the way

1. Nationality and country strings share one key space for every shipped
   league (`homeCountryKeys.test.ts`); a mismatch would fail silently.
2. Free agency consumes no shared-rng draws (`freeAgencyRng.test.ts`).
3. The matching never double-signs and is stable and order-independent without
   caps (`freeAgencyMatch.test.ts`); caps count tentative offers, and at a cap
   the order-independence is only approximate (see freeAgencyMatch.ts).
   Known small quirk: in AI free agency a player's preference for his own last
   club is scored without the exemption that lets him re-sign there, so he may
   rank it lower than he should.

## The first shape, and why it was replaced

The first version made clubs prefer domestic players: a free-agency ranking
bonus, a market multiplier and a soft foreign quota, all scaled by how far over
its league's foreign allowance a club was. Tuned, it held every league within
2-11 points of its real share (10 seasons, two seeds), but it was a hidden AI
bias that bound only the AI, it had to invent the allowance formula to bite, and
that formula made a sub-73 Argentine at a 60%-domestic club unable to leave at
all. Findings kept from it:

| Variant | Worst gap | What it showed |
|---|---|---|
| Flat pull by league share | +17.9 (France) / −10.9 (Serbia) | Settled share depends on supply, not just preference |
| Feedback on the club's gap | −16.1, then −12.7 at 2.7x the gain | A steady offset, not a gain problem |
| + soft quota | −14.3 | Displaced foreign signings reappear in free agency and loans |
| Gap over the foreign allowance | −11.4 to −11.6 | Best of the shape; replaced for being a formula, not a mechanism |

Also: the star exemption never binds in free agency (free agents are almost
never 73+); keeping good Brazilians and Argentines at home compressed the
country ladder (big four to Brazil 4.95 -> 1.09 on one seed), which is why the
home line fades for a player who has outgrown his league.

## Stage 2: club reputation (built)

`StoredTeam.reputation` (optional, 0-100) sits beside hype. Hype stays what it
was, a finance channel; reputation is what players see. Code:
`src/core/teams/reputation.ts` (pure, rng-free) and
`src/core/teams/reputationSeed.ts`. Constants: the `REPUTATION_*` block after
`APPEAL_LOAN_FACTOR`, all first values, to be tuned.

**One world scale.** A finish scores `leagueCeiling − SPREAD × (rank−1)/(size−1)`,
where the ceiling is `FINISH_TOP (80) − PER_OFFSET (2.5) × strength offset −
PER_TIER (25) × (tier − 1)`. Bottom of the Premier League (50) outranks the
Serbian champion (42.5) by construction.

**Target, from that season only.** Finish in the division the club played in,
plus title (8, a top flight's recorded champion or a lower division's playoff
winner), domestic cup (6), every continental run (won 35; lost final 28, SF 23,
QF 17, earlier 12; playoff 8; league phase 6; × 1 / 0.5 / 0.7 for Cup / Shield /
Americas Cup), promotion (+5), relegation (−8), clamped to [0, 100]. No squad
strength and no hype term: a club cannot buy a name, it has to win with the
squad. Stepped at offseason step 3.61 (after the promotion swap, while the cups
are still the finished ones): 10% of the gap a season upward, 4.5% downward.
Zero rng draws.

**Ordering** (from an 8th-place finish in England, the agreed design order):
Cup win (+35) > lost final (+28) > semi-final (+23) > league title (climb to
first plus the bonus, ~+19) > domestic cup (+6) > nothing. The continental
values were raised from a first draft (25 / 18 / 14 / 11 / 9 / 7 / 5) under
which a title beat a lost final. Pinned by `test/core/reputation.test.ts`.
A lower-division club that tops its table is not a champion here (only a
lower division's title-playoff winner is); the promotion bonus credits it.

**Seeding.** A new world, a roster import (forced reseed, since squads are
replaced) and migration of an old save give each club the finish score its squad
strength ranks it at within its division. Same scale as the target, so there is
no opening transient. A seed, not a reconstruction of an old save's history.

**Stature reads how good a club is.** `0.45 × squad strength + 0.2 ×
reputation / 100 + 0.35 × wealth` (`STATURE_W_STRENGTH`, `STATURE_W_REPUTATION`,
`STATURE_W_WEALTH`), where wealth is `clubWealth`: the league's money scale
(`financeScale`, 1 at a big-four top flight) times how big a name the club is on
the world scale, `0.5 + 0.5 × reputation / 100`. It is the stand-in for wages
until wages exist. All three are the club's own; there is no
regional term (user rule: players are pulled to good clubs, and good clubs
happen to be in Europe). The first shape, `0.65 × squad + 0.35 × reputation`,
still rated Brazil's best club (0.67) above a median big-four club (0.56),
because squads there really are comparable and the reputation seed puts
Brazil's champion level with a mid-table English club; with wealth at 0.35 the
median big-four club reads 0.71 against Brazil's best 0.67
(`scripts/statureGapProbe.ts`). Every stature reader (`clubStature`,
`clubStatures`, the contexts, `refusesMoveToClub`, `refusesFreeAgentSigning`)
now REQUIRES the competitions, so no screen can compute a different stature
from the AI's. `ClubContext.statureParts` carries the three weighted parts.

**Ambition for good players.** The step-up bonus used the star-only care curve
(ovr 73 → 89) at `PLAYER_WILL_RISE_BONUS` 0.35, so a 76-rated player gained
~0.02 for a move from Brazil to a mid-table big-four club against a home pull of
~0.17. A step up now reads `playerAmbition`, ramping from
`PLAYER_WILL_AMBITION_FLOOR` (ovr 66) to the care ceiling, at a rise bonus of
1.2. Refusals still read the care curve, so who refuses a step down is
unchanged. `scripts/appealCheck.ts` prints the line-by-line view of that move.

**Reputation line.** `clubAppealFor` shows the level line as two: "Level of
club" (squad and wealth) and "Reputation", apportioned by each part's share of
the stature gap (a free agent's own stature is split in the weights'
proportion). Display only: `appealScore`/`appealMultiplier` read the unsplit
value. A refusal stays whole on the level line.

**Measured (20 seasons, seeds 1-2, against Stage 1 at the same seeds):**
Brazil 66.1 / 66.3 (Stage 1 67.9 / 67.6, main ~63), big four 71.6 / 71.1
(69.0 / 68.6), France 66.3 / 68.7. France→Brazil +0.16 / +2.38 (Stage 1
−0.09 / −0.62); BIG4→France +5.38 / +2.47; BIG4→Serbia 13.3 / 13.2 (main ~10):
good players everywhere now move up to the best clubs, so the ladder widens.
0 of 882 clubs in deficit at any sample on either seed. Nationality: worst gap
8.5 / 9.6, mean absolute 3.6 / 3.8 (Stage 1 about the same); the big-four
leagues run a few points more foreign, as their clubs import more talent.

**First four-seed audit, before the review fixes** (Stage 2 / Stage 1 / main): every rung within the
±1 mean gate. BIG4→France +3.49 / +1.80 / +3.66, **France→Brazil +0.84** /
−1.27 / +2.51, Brazil→Netherlands +2.60 / +4.63 / −0.19, Netherlands→Argentina
−0.34 / −0.82 / +1.54, Argentina→Portugal +3.08 / +3.09 / −0.07,
Portugal→Belgium +1.54, Belgium→Mexico +1.30, Mexico→Turkey +1.37, Turkey→US
−0.53, US→Greece +0.13, Greece→Scotland −0.49, Scotland→Serbia −0.02.
BIG4→Serbia 12.95 (main ~10): the ladder widens as good players move up to the
best clubs, the big four ending ~71 against main's ~69.5. Brazil averages 66.7
against France's 67.5. Solvency 4/4 seeds, 0 of 882 clubs in deficit at any of
42 samples.

**Review fixes (a /code-review pass on Stage 2), and one that went wrong.**
Wealth was a league label (every club in a division read the same), so it was
first rebuilt from the club's money ceiling (`budgetCap`: league money × hype).
Hype is ranked within a club's own division, so that made the top of every league
read equally rich again: four seeds pooled, France→Brazil fell to **−0.92** and
Italy ran 10-13 points too foreign. The user's objection, "players shop clubs
across the entire world", is the rule: nothing in stature may be ranked within a
league. Wealth now reads reputation (world-scaled) instead. The other review
fixes, all in: a player's view decides whether an AI deal happens but not the
fee; a loan counts as half a move for the level line and refusals; AI free
agency rebuilds contexts between passes; every division's champion earns the
title bonus; reputation's finish scale is proportional (positive everywhere);
Swiss players register as EU; Welsh training counts for England; and players
choose the user as they choose AI clubs (`playerChoice.ts`: a free agent signs
only if the user suits him at least as well as the best AI club that wants him,
and a Reluctant player turns the user's bid down).

**Four seeds pooled, final shape (wealth from reputation):** every rung within
the ±1 mean gate. BIG4→France +2.90, **France→Brazil +1.20**, Brazil→Netherlands
+2.41, Netherlands→Argentina +0.80, Argentina→Portugal +1.98, Portugal→Belgium
+1.97, Belgium→Mexico −0.05, Mexico→Turkey +2.00, Turkey→US −0.32, US→Greece
+0.14, Greece→Scotland +0.33, Scotland→Serbia −0.90. BIG4→Serbia ~12.4. 0 of
882 clubs in deficit at any sample on any seed. Nationality (seeds 1-2): worst
gap 9.1 / 10.5, mean absolute 4.6 / 4.2; Spain and Italy run ~9-10 points too
foreign as their clubs attract more talent, the one place Stage 2 is worse than
Stage 1.

## Stage 3 (planned)

The player-profile "How he sees clubs" panel; reputation and trend on Club
History and the club Database; personality traits later. Neighbour/language
pull (Brazil -> Portugal) needs data first.

## Tuning and audits (in progress)

Levers in order: `APPEAL_HOME` / `APPEAL_CONFEDERATION`, then
`APPEAL_PLAYING_TIME`, then `APPEAL_FORMER_CLUB`; the league rules are facts,
not levers. Target: every league within a few points of its real share at
season 20, foreign blocks staying in-confederation. Read by group: rule leagues
should land close almost by construction; no-rule leagues (Netherlands,
Scotland) test the player lines. Scouting reach (a club-side term, AI only) is
built only if a no-rule group sits well short after the player levers.

**First measurement, starting values, seed 1, 20 seasons** (APPEAL_HOME 0.3,
CONFEDERATION 0.15, PLAYING_TIME 0.02/pt, FORMER_CLUB 0.1; this run still had
the MLS cap, since removed):

| League | Real | `main` s20 | New s20 | Gap |
|---|---|---|---|---|
| Argentina | 83.7% | 18.7% | 80.6% | −3.1 |
| Brazil | 74.9% | 19.6% | 74.7% | −0.2 |
| Serbia | 66.0% | 7.5% | 60.5% | −5.5 |
| Spain | 60.8% | 17.1% | 58.9% | −2.0 |
| Mexico | 62.9% | 8.6% | 61.6% | −1.3 |
| Turkey | 48.2% | 6.3% | 48.9% | +0.6 |
| Germany | 45.4% | 10.7% | 48.3% | +2.9 |
| England | 38.6% | 10.2% | 42.8% | +4.2 |
| Scotland (no rule) | 35.8% | 3.0% | 37.4% | +1.6 |
| Netherlands (no rule) | 50.3% | 9.6% | 54.1% | +3.8 |
| Greece | 45.2% | 3.6% | 41.1% | −4.1 |
| Belgium | 38.3% | 5.5% | 45.3% | +7.0 |
| Portugal | 39.8% | 7.6% | 47.2% | +7.3 |
| Italy | 39.5% | 10.0% | 31.8% | −7.7 |
| France | 49.6% | 10.7% | 60.1% | +10.5 |
| United States | 39.5% | 7.9% | 65.8% | +26.2 (MLS cap, now removed) |

The two no-rule leagues, the real test of the player lines, land within 2-4
points.

**Home-line sweep (MLS cap removed, 20 seasons, seeds 1 and 2).** Gap to the
real share at season 20, summarised over all 16 top flights:

| APPEAL_HOME | Mean absolute gap (s1 / s2) | Worst (s1 / s2) | Mean signed gap |
|---|---|---|---|
| 0.3 | 4.5 / 4.5 | 15.8 France / 12.9 France | about +2.6 (too domestic) |
| **0.25 (shipped)** | 3.4 / 3.8 | 8.4 Serbia / 11.3 France | about +0.5 |
| 0.2 | 2.8 / 4.5 | 9.1 Serbia / 9.8 Scotland | about −2.2 (too foreign) |

0.2 and 0.25 tie on the mean absolute gap across both seeds; 0.25 is the one
centred on the real level. What is left does not move with the home line and is
the same on both seeds: France (+7.8 / +11.3) and Portugal (+6.0 / +6.6) run too
domestic, Italy (−6.3 / −8.3), Serbia (−8.4 / −4.9) and Argentina (−5.4 / −3.6)
too foreign.

- **France is not the non-EU cap.** Only 4 of 18 clubs sit at it at season 20.
  France has the largest surplus of its own nationals in the world (1.36
  French players at home per top-flight place its real share needs), so its
  clubs simply find French players. Supply does not explain everything,
  though: Italy has a surplus (1.09) and still runs short.
- **Italy** is the candidate for its real flow rule (at most two new non-EU
  arrivals from abroad per club per season), which the game does not model.
- Open, for review: whether to accept these league-level gaps, add the Italian
  rule, or look at where the surpluses and shortfalls of nationals come from.

**Baseline audit (`origin/main` 2b6b67fd, `weakLeaguesAudit`, 20 seasons, one
seed per run):** ladder OK on seeds 1-3. Solvency: seed 1 −£0.1M (Serbia s18),
seed 2 −£0.5M (Serbia s21), seed 3 solvent. Single-seed "BROKEN" flags land on
a different converged rung each seed (seed 1 Belgium→Mexico −1.08 and
US→Greece −1.30, seed 2 Scotland→Serbia −1.29, seed 3 Belgium→Mexico −1.97) and
are pooled by hand before being read. Seed 4: solvent, ladder OK.

**The ladder: Brazil and Argentina stopped exporting.** The first branch audits
(APPEAL_HOME 0.25, confederation 0.15) were solvent on every seed with zero
deficits, but Brazil held its generated level for 20 seasons while every other
league slipped: season-21 strength (seed 1 / seed 2) Brazil 69.5 / 70.6 against
the big four's 67.8 / 68.2, where `main` has Brazil at 63.1 / 63.5. Argentina
+3.7 on `main`, the United States −1.5. Each part was then switched off in turn
(20 seasons, seed 1, Brazil at season 21):

| Variant | Brazil | France | Big four | Worst nationality gap |
|---|---|---|---|---|
| `main` | 63.1 | 66.2 | 69.5 | the original drift |
| Home level read off own squads | 69.5 | 64.3 | 67.8 | 9.1 |
| Home level pinned to the ladder | 69.9 | 65.8 | 68.7 | 8.6 |
| + confederation line off | **67.9** (s2 67.6) | 67.8 | 69.0 | **7.0** |
| + leaving home free on a step up | 68.4 | 67.3 | 69.2 | 8.8 |
| + registration rules off | 66.0 | 66.1 | 69.3 | not run |
| home line off (rules on) | 65.1 | 65.1 | 68.2 | not run; Serbia 55.6, US 62.6 |
| home line faded both ways over 0.15 / 0.35 | 64.8 / 65.9 | 65.1 / 66.4 | 68.1 / 67.7 | 23.9 / 21.7 |
| rules, home and confederation all off (only the new free agency and playing time) | 65.0 | 65.9 | 69.0 | not run; Argentina 62.1 |

- The self-referential home level was a real loop but not the cause: pinning a
  country's stage to its ladder place (APPEAL_HOME_LEVEL_PER_OFFSET) kept, as
  the cleaner rule, moved nothing.
- The **confederation line** was the wrong shape: it taxed a South American
  twice going to Europe and held France, Portugal and Belgium (whose real
  foreign blocks are mostly non-European) too domestic. Off, both measures
  improve. It stays in the code at 0 for a language-corridor version.
- The rest splits between the **registration rules** (~2.4: every Brazilian and
  Argentine counts as non-EU, so Spain's, France's and Greece's caps stop
  European clubs buying them; in reality many hold Italian or Spanish passports)
  and the **home line** (~3). Fading the home line on moves between clubs of
  different level removes Brazil's excess and destroys nationality realism with
  it, because the pull toward home is what keeps every league domestic. Leaving
  home free on a step up alone does nothing.
- **Four-seed audit at the shipped settings, pooled by hand** (seeds 1-2 from
  the confederation-off runs, 3-4 on the final tree), against `origin/main`:
  solvency **4/4 seeds, 0 of 882 clubs in deficit at any of 42 samples** (main:
  small Serbian dips on seeds 1-2). Rung means, branch / main: BIG4→France
  +1.80 / +3.66, **France→Brazil −1.27 / +2.51 (fails the ±1 mean gate)**,
  Brazil→Netherlands +4.63 / −0.19, Netherlands→Argentina −0.82 / +1.54,
  Argentina→Portugal +3.09 / −0.07, Portugal→Belgium +0.50 / +1.96,
  Belgium→Mexico +1.43 / −0.96, Mexico→Turkey +0.65 / +1.24, Turkey→US −0.02 /
  +0.90, US→Greece −0.50 / −0.29, Greece→Scotland −0.43 / +0.17,
  Scotland→Serbia +0.10 / −0.37. Brazil at season 21 by seed: 67.9, 67.6, 69.3,
  67.9 against the big four's 69.0, 68.6, 68.8, 68.5.
- **Why good Brazilians stay: a club's stature does not know how good it is.**
  `scripts/statureGapProbe.ts` at generation: Brazil's best club 0.620 against a
  median big-four club 0.512-0.530, so to a player a move from Brazil's best
  club to a mid-table Premier League side reads as a step DOWN. Stature is squad
  strength plus hype, and hype is ranked within a club's own league, so the top
  of any league looks equally famous. Deferred to Stage 2 as a stature fix,
  with a design rule from the user: players are pulled to good clubs, never by
  continent; good clubs happen to be in Europe. So stature should read what
  makes a club good (squad, earned reputation on one world scale, its own
  wealth), plus a real pull up for good players, not only stars. PR #401 merges
  with the France→Brazil rung open for that.
- Nationality with the confederation line off, both seeds: mean absolute gap
  3.5 / 4.4, worst 7.0 / 8.5, mean signed gap about −2 (slightly too foreign).
  Raising APPEAL_HOME would re-centre it but is the same pull that holds Brazil
  up, so it was left at 0.25.
- Shipped: confederation off. Brazil ends level with France and about a point
  below the big four (Opta's real league rankings put the Brasileirao around
  Ligue 1). Open: second passports as a real rule (the Spanish two-year route
  for Ibero-Americans, Italian oriundi), which would take roughly two points
  more off Brazil and Argentina.

## Foreign-player registration rules (Stage 1, step 3)

`src/core/foreignRules.ts`. Real league rules, in the shape each league really
has, binding every club including the user's. Caps are hard (a club at one
cannot sign another player it counts; nobody is removed for being over).
Minimums are soft (a club short of one prefers eligible players; trimming never
takes it below one it meets). Youth intake is exempt. Researched 2026-09-22:

| League | Rule in the game | Source |
|---|---|---|
| England | homegrown min 8 | [PL squad lists 2025/26](https://www.premierleague.com/en/news/4407896/202526-premier-league-squad-lists) |
| Spain | non-EU cap 3 (ACP count as EU) | [DAZN](https://www.dazn.com/es-ES/news/f%C3%BAtbol/cuantos-jugadores-extracomunitarios-puede-tener-un-equipo-de-laliga/1ipeyahvwv5441wvuz3ivs0elp) |
| Italy ⚠ | homegrown min 8 (4 club + 4 Italy-trained) | [Sky Sport](https://sport.sky.it/calcio/serie-a/2024/05/14/giocatori-extracomunitari-tesseramento-serie-a-2024-2025) |
| Germany | German nationals min 12, homegrown min 8 | [DFL](https://www.dfl.de/de/hintergrund/transferwesen/local-player-regelung/) |
| France | non-EU cap 4 (ACP, UK tolerated); Ligue 2: 2 | [LFP 2024-25](https://www.lfp.fr/assets/24_25_Les_joueurs_entraineurs_25_06_2024_824256d416.pdf) |
| Portugal ⚠ | homegrown min 8 | [Liga Portugal regs](https://www.ligaportugal.pt/backoffice/assets/rc_b78abbb4ce.pdf) |
| Belgium ⚠ | homegrown min 6 | [RBFA Book P](https://belgianfootball.s3.eu-central-1.amazonaws.com/s3fs-public/rbfa/docs/pdf/reglement/bondsreglement_reglement_federal/URBSFA_Reglement_Livre_P_proleague.pdf) |
| Turkey ⚠ | foreigner cap 14 | [TFF](https://www.tff.org/Resources/TFF/Auto/e580c59db48141a88e6fdaff05a1b4ed.PDF) |
| Netherlands | none (salary floor only) | [Everaert](https://www.everaert.nl/en/conditions-for-attracting-international-football-talent-to-be-relaxed/) |
| Scotland ⚠ | none | no league quota found |
| Greece ⚠ | non-EU cap 6 | [Inside World Football](https://www.insideworldfootball.com/2026/07/06/greek-super-league-increases-squad-cap-on-foreign-players-to-7/) |
| Serbia | Serbian nationals min 13 (15 of 30, scaled to 25) | [Mondo](https://mondo.rs/Sport/Fudbal/a1803900/Promenjeno-pravilo-o-strancima-u-Superligi.html) |
| Brazil ⚠ | foreigner cap 9 (a matchday limit, applied to the squad) | [Exame](https://exame.com/esporte/cbf-reduz-o-limite-de-estrangeiros-e-amplia-espaco-para-jovens-entenda-a-mudanca/) |
| Argentina ⚠ | foreigner cap 6 | [El Viejo Var](https://elviejovar.com/cuantos-extranjeros-se-pueden-tener-en-la-liga-argentina/) |
| Mexico | cap 9 on players not trained in Mexico | [Telediario](https://www.telediario.mx/futbol/liga-mx/extranjeros-en-liga-mx-2025-cuantos-puede-en-un-equipo) |
| United States | none in the game: the real 8 international slots count green-card holders as domestic, so they don't limit nationality (the real mix is 39.5% US); by nationality the cap froze all 30 clubs from day one | [MLS roster rules](https://www.mlssoccer.com/news/2025-mls-roster-rules-and-regulations) |

⚠ = weaker sourcing or a recent change (Turkey's planned cut to 12 not taken;
Greece rises to 7 in 2026-27; Brazil cuts from 2027; Italy and Argentina have
unread 2026 revisions; Belgium's 8-of-25 status unclear).

**Approximations, stated:** rules apply to every division of a country except
where a lower tier is known to differ (France); squad-list numbers are scaled
to 25; matchday, on-pitch, arrivals-per-season (Italy's two new non-EU a
season) and salary-floor rules are not modelled; ACP membership is
approximated from confederations; EU/EEA is an explicit list (Curacao counts,
being Dutch). **Homegrown** is computed properly from each player's record
(three seasons aged 15-20 at clubs in the country); a season with no record
(before the save began, unsigned, or in an academy) is credited to his own
nationality's country.
