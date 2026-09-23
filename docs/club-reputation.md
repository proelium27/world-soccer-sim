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

## Stage 2: club reputation (planned)

`StoredTeam.reputation` beside hype. Target is a per-season achievement score
(continental trophy > deep run > league title scaled by league strength >
domestic cup > finish scaled by league strength > promotion; relegation a
penalty), with no squad-strength or hype term. Rises ~10% a season toward it,
falls ~4-5%. Stature becomes 0.65 × squad strength + 0.35 × reputation. Adds a
Reputation line to `clubAppealFor`. Own audit; expected to slow a newly promoted
rich club's rise.

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

**Baseline audit (`main`-equivalent, `weakLeaguesAudit`, 20 seasons):** seed 1
deficit (Serbia −£2.2M, 1 club of 882), seeds 2 and 3 solvent, seed 4 to run
from a clean `main` checkout.

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
