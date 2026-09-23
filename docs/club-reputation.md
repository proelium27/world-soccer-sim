# Club reputation and home-country pull

Design doc and work log. Stage 1 (home-country pull) is in progress; later
stages are planned, not built.

## Why

**The main goal is nationality realism.** Measured on a fresh 898-club world
(seed 1, spectator save, `scripts/nationalityDriftProbe.ts`), each top flight's
domestic share:

| League | Real | Generation | After 1 season | After 5 seasons |
|---|---|---|---|---|
| Argentina | 83.7% | 85.2% | 74.4% | 29.9% |
| Brazil | 74.9% | 78.2% | 67.7% | 26.4% |
| Serbia | 66.0% | 64.3% | 55.2% | 16.1% |
| Spain | 60.8% | 61.0% | 57.5% | 24.0% |
| England | 38.6% | 36.2% | 35.4% | 17.5% |
| Scotland | 35.8% | 41.3% | 31.7% | 9.4% |

Generation is right; every season after it moves every league toward the
world's average mix, with no sign of levelling off. Across all divisions it is
worse (Argentina 84% -> 22%, Serbia 67% -> 9%).

Nothing after generation looks at nationality. Youth intake draws from the
static real table (`LEAGUE_NATIONALITY_WEIGHTS`, or a custom league's own), so
academies are a *restoring* force toward the real share. All drift is movement.
Foreign arrivals in top flights over those five seasons:

| Route | Foreign arrivals | Of which rated 73+ |
|---|---|---|
| Free agency | 2,360 | 23 |
| Bought from abroad | 1,751 | 992 |
| Loans | 444 | 10 |

So over half the drift is ordinary players, and free agency is one worldwide
pool that every club ranks purely on rating. A player-side preference alone
could not fix it: below `PLAYER_WILL_CARE_FLOOR` (73) a player never refuses
anyone, and `runAIFreeAgency` never consults player appeal at all — the club
picks.

The second goal is a transparent, world-scale club reputation, and a
per-player view of each club that the AI and the screens both read.

## Rules for every stage

- **Pure, rng-free terms.** New terms are arithmetic on data the save already
  has. That alone does not keep the random stream in order (see Stage 1), so
  where it matters it is pinned by a test, not asserted.
- **Player-side rules bind the user and the AI identically.** Club-side
  preferences are AI-only; the user picks their own signings.
- **Every stage that changes AI behaviour is audited**: `weakLeaguesAudit`,
  20 seasons x 4 seeds, this branch and `origin/main`, pooled by hand; plus the
  drift probe.
- **Stars still go abroad.** The weak leagues run on selling their best
  upward, so home pull is zero at `PLAYER_WILL_CARE_CEILING`.

## Stage 1: home-country pull (in progress)

`homePull(player, club) = K x domesticShare(club.country) x (1 - statureSensitivity(ovr))`
when the player's nationality is the club's country, else 0. In rating points.
`src/core/transfers/homePull.ts`, constant `HOME_PULL_K` (currently **0 = off**).

- **One K, per-country strength.** `domesticShare` is the league's own real
  domestic share, so Argentina pulls at 0.84K and Scotland at 0.36K.
- **Free agency (AI only):** passes 1 and 2 rank by `ovr + homePull`; pass 3
  (prospects) ranks by `potential + homePull`, i.e. in potential units.
  Eligibility (`willing`) is untouched and keeps its early exit; the pull is a
  string compare first, arithmetic only on a match. **Done, K = 0.**
- **Transfer market:** the same term as a multiplier on the buyer's valuation
  via `moveAppealBetween`. Selling side (`keepValueToClub`) untouched. *To do.*
- **Loans:** same term. *To do.*
- **Confederation term:** a player discounts any club outside his
  confederation, scaled by `1 - care`, so Argentina's imports stay mostly South
  American. Symmetric. *To do.*
- **User side unchanged:** a below-floor player still refuses nobody, so the
  user's Free Agents screen shows him as available.
- `clubAppealFor(player, club, league)` returning line items (level match,
  home country, confederation) is introduced in this stage and read by
  `refusesMove`, `moveAppeal`, `refusesFreeAgentSigning` and the AI ranking, so
  later stages only add lines. *To do.*

### Verified before tuning K

1. **Nationality and country strings share one key space.** Every shipped
   country is a `LEAGUE_NATIONALITY_WEIGHTS` key with a domestic weight, a name
   pool and a confederation, and every generated league's players carry its
   country string (`test/core/homeCountryKeys.test.ts`). This matters because a
   mismatch fails silently: `pickNationality` falls back to England's table and
   the compare never matches. A league added in World setup whose country is not
   a nationality gets no pull, which is correct.
2. **Pass 1's shared-rng draw count.** Pass 1 draws contract length from the
   shared rng; passes 2 and 3 use seeded streams. The ranking changes *who*
   fills a shortfall, not *whether*, so the count holds whenever the pool has a
   candidate: with a pool ~2x demand, K = 0 and K = 30 consume the shared stream
   identically while signing different, more domestic players
   (`test/core/homePullRng.test.ts`). **Caveat:** if a position runs completely
   dry for late-picking clubs, the counts can differ. That is a property of
   typical worlds, not a guarantee; it does not block tuning, since Stage 1
   changes the dynasty anyway.
3. K = 0 leaves every existing free-agency test unchanged (65 of 65).

### Tuning (done, pending the audits)

**Baseline (`main`, 20 seasons, seeds 1 and 2):** every top flight ends 3-20%
domestic; the worst gap is Argentina, 64-65 points below its real 84%. Two
seeds agree to within a point or two everywhere.

The shipped shape is three strengths, all scaled by one gap:

- `homeGap = max(0, realShare − clubDomesticNow) / (1 − realShare)` — how far
  over its league's **foreign allowance** a club is. 0 at the real share.
- `HOME_PULL_K` 15 — free agency, rating points added to a home player's rank.
- `HOME_PULL_MARKET` 1.2 — transfers and loans, player side: valuation up for a
  move home, down for a move away (`homeAppeal`).
- `HOME_PULL_FOREIGN` 1.5 — transfers and loans, club side, AI only: a soft
  foreign quota discounting foreign signings (`foreignDiscount`).
- Every term is scaled by `1 − care`, so stars move on ambition alone.

**Result, 10 seasons:** worst gap 11.6 (seed 1) and 11.4 (seed 2), both Serbia;
most leagues within 2-6 points.

**What was tried and why it changed** (10 seasons, seed 1 unless noted):

| Variant | Worst gap | What it showed |
|---|---|---|
| Flat pull `K × realShare`, K 6 | +17.9 (France) / −10.9 (Serbia) | One K cannot hit per-league targets: settled share also depends on supply |
| Feedback `K × (realShare − now)`, K 15 | −16.1 | Every league now errs the same way; a proportional controller's steady offset |
| Same, K 25 / 40 | −12.6 / −12.7 | Diminishing to nothing: not a gain problem |
| K 25 with no star exemption in FA | identical to K 25 | Free agents are almost never 73+; the exemption never bound |
| + soft foreign quota, F 2 / 4 | −14.7 / −14.3 | Foreign transfers fell ~25-60%, but clubs refilled from foreign free agents and loans |
| Gap over the foreign allowance, K 15 / M 1.2 / F 1.5 | −11.6 (seed 2: −11.4) | Shipped. The residual tracks how domestic a league should be, and this closes most of it |

**The residual is not supply.** Per-country counts at season 10 (with the
pull): Serbia has 514 Serbians at home against 618 needed, with 198 more
abroad and 227 unsigned. The unsigned are mostly released academy players too
weak to sign over the foreigners on offer; only a hard quota (Argentina's real
six-foreigner cap) would make clubs field them, at a cost to league strength.
That is a separate decision.

**Measurement notes.** Free agency is where displaced foreign signings reappear:
any lever that only touches the market moves them there. The probe's "sold
abroad" out-flow is the largest single way home players leave a top flight
(1,424 in two seasons on `main`), which is why the market half is required.

Next: the ladder and solvency audit (20 seasons x 4 seeds, pull on and off),
then one ~75-season drift run, since the ladder invariant has failed only at
that horizon before (`docs/player-save-findings.md`).

## Stage 2: club reputation

- `StoredTeam.reputation` (0-100), beside hype. Hype stays short-term buzz and
  keeps driving revenue.
- **Target is a per-season achievement score**, with no squad-strength or hype
  term (stature already carries squad strength): continental trophy >
  continental deep run > league title (scaled by league strength) > domestic
  cup > league finish (scaled by league strength) > promotion; relegation is a
  penalty.
- **Asymmetric movement:** ~10% a season toward the target rising, ~4-5%
  falling. Fallen giants keep their pull for a generation; a one-off title does
  not make a club a giant.
- Stature becomes 0.65 x squad strength + 0.35 x reputation.
- Seeded at generation; backfilled in `migrate.ts` from squad, hype and titles.
- Expected ladder effect, stated up front: a newly promoted rich club stays
  "small" for years and stars refuse it.

**Open for the user:** the Americas prestige discount (European and African
players rating Americas clubs lower) was the user's ask; the review proposed
dropping it in favour of the symmetric confederation term. They are different
things — the confederation term is about where a player feels at home, the
discount is about prestige — so it is kept as a candidate line for Stage 3
pending the user's call.

## Stages 3-4: the per-player view and the screens

- Add the remaining lines to `clubAppealFor`: reputation, former club (and the
  Americas prestige line if kept).
- **Free agency becomes the player's choice** (user call, 2026-09-22). Today
  the club picks and a sub-73 free agent never refuses anyone, so the player's
  home preference has no channel there and Stage 1 reaches it through the club's
  ranking instead. Once `clubAppealFor` exists, a free agent chooses among the
  clubs that want him on that list. Measure it against Stage 1's drift numbers;
  a player-only preference was measured missing the targets both ways (France
  +18, Serbia −11), so the foreign quota stays as the backstop unless the new
  version holds the real mixes without it.
- Stage 1's two halves are presented as what they model: **Home country** is a
  line in the player's own reasons; the **foreign quota** is shown as the
  league's registration rule ("Serbian clubs are close to their foreign-player
  limit"), a real rule rather than a hidden AI bias.
- Player profile "How he sees clubs" panel; a Keen / Open / Reluctant / Won't
  talk label on Transfers, Free Agents, Watchlist and loan search (text only,
  for DOM weight); reputation and trend on Club History and the club Database;
  Manual and changelog.

## Later

- Personality traits (Patriot, Glory hunter) that reweight a player's lines,
  shown on his profile.
- Neighbour and language pull (Brazil -> Portugal). No data for it yet.

## Risks

| Risk | Check |
|---|---|
| Weak leagues stop selling upward and go into debt | Stars feel no pull; pooled solvency audit on both sides |
| The strength ladder shifts | Pooled 4-seed audit vs `main` |
| Small countries short of players | Preference, not a filter; watch minimum AI squad size |
| FA pass 1's draw count shifts | `homePullRng.test.ts` |
| `willing()` stops being cheap | Early exit preserved; time the offseason on the 898-club world |
| User's Free Agents screen fills with foreigners the AI passes over before Stage 4's labels | Acceptable; they show as available; note in changelog |
| Stage 2 slows promoted clubs' rise | Pooled ladder audit, direction stated up front |
| Free-agent gate regressions | Keep existing tests; add home and confederation cases |
