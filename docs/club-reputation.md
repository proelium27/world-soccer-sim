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
rejected club moves on. Stable, terminating, independent of input order. It
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
3. The matching is stable, order-independent and never double-signs
   (`freeAgencyMatch.test.ts`); caps count tentative offers.

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
winner), domestic cup (6), every continental run (won 25; lost final 18, SF 14,
QF 11, earlier 9; playoff 7; league phase 5; × 1 / 0.5 / 0.7 for Cup / Shield /
Americas Cup), promotion (+5), relegation (−8), clamped to [0, 100]. No squad
strength and no hype term: a club cannot buy a name, it has to win with the
squad. Stepped at offseason step 3.61 (after the promotion swap, while the cups
are still the finished ones): 10% of the gap a season upward, 4.5% downward.
Zero rng draws.

**Ordering the constants give** (from an 8th-place finish in England): Cup win
> league title > Cup semi-final > domestic cup > nothing. The plan listed a
deep continental run above a strong-league title; with these values a title
(climb to first plus the bonus, ~19) beats a semi-final (14) and even a lost
final (18). A tuning question, pinned as-is by `test/core/reputation.test.ts`.

**Seeding.** A new world, a roster import (forced reseed, since squads are
replaced) and migration of an old save give each club the finish score its squad
strength ranks it at within its division. Same scale as the target, so there is
no opening transient. A seed, not a reconstruction of an old save's history.

**Stature** is `0.65 × squad strength + 0.35 × reputation / 100`
(`STATURE_W_REPUTATION`, was `STATURE_W_HYPE`). Every stature reader
(`clubStature`, `clubStatures`, the club contexts, `refusesMoveToClub`) reads
`teamReputation`. `ClubContext.statureParts` carries the two weighted halves.

**Reputation line.** `clubAppealFor` shows the level line as two: "Level of
club" and "Reputation", apportioned by each half's share of the stature gap
(a free agent's own stature is split in the 0.65/0.35 proportion). Display only:
`appealScore`/`appealMultiplier` read the unsplit value, so no decision moves
because of the split. A refusal stays whole on the level line.

**Behaviour change to know about:** hype started every club at `HYPE_INITIAL`,
so stature's second half was flat in a new world; the reputation seed is not,
so from season 1 big-league clubs read bigger to players than before. Needs its
own audit (not yet run); expected to slow a newly promoted rich club's rise.

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
are pooled by hand before being read.

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
