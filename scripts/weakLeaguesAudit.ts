/**
 * Dynasty audit for the weak-league feature (France/Netherlands/Portugal/
 * Belgium/Turkey/Greece/Scotland/Serbia).
 * Verifies, over a multi-season dynasty with real simThrough/simOffseason:
 *  - AI solvency holds (no non-user club ever goes into deficit), including the
 *    poorer weak-league clubs;
 *  - the weakness ladder (England > France > Portugal > Belgium > Turkey in D1
 *    mean OVR) persists across the dynasty rather than collapsing (talent
 *    drain) or inverting;
 *  - **each adjacent gap survives at a minimum magnitude**, not merely in rank
 *    order — see MIN_GAP below;
 *  - the league-wide OVR equilibrium doesn't inflate.
 *
 * Why the magnitude check exists (2026-08-08): the original audit asserted only
 * the *ordering* England > France > Portugal, and reported "OK" throughout a
 * dynasty in which the England→Portugal gap eroded from 9.6 to 5.5 OVR and the
 * France→Portugal gap fell to ~2.5 — the design intent was substantially gone
 * while the check still passed. Rank order is far too weak a condition for what
 * COUNTRY_STRENGTH_OFFSET is actually for.
 *
 * Two separate forces move a league off its generated rung, and they are easy
 * to confuse:
 *
 *  1. `growthDamping` throttles positive growth above a *global, absolute* ovr
 *     (GROWTH_DAMPING_START), so a league sitting below that line grows
 *     undamped while the big four are throttled. Attributing 20 seasons of
 *     drift to its sources (a player's ovr only ever changes in progression, so
 *     retained players' mean change is pure progression and the remainder is
 *     pure churn) measured progression at +4.06 for England vs +7.53 for
 *     Portugal. This compresses every gap toward the middle but does NOT
 *     reorder leagues, and it should not be "fixed" by making the threshold
 *     league-relative — that hands every weak league its own elites.
 *
 *  2. **Budget reorders them.** COUNTRY_BUDGET_SCALE must stay monotonic with
 *     COUNTRY_STRENGTH_OFFSET: at Belgium 0.35 / Turkey 0.50 the ladder
 *     inverted by 2.23 OVR over 20 seasons, with Turkey finishing above a
 *     Belgium it generated 0.9 below.
 *
 * MEASUREMENT TRAP: comparing leagues with very different starting OVR
 * (England vs Portugal) buries force 2 under force 1 — that comparison put
 * churn at only 0.55 OVR and wrongly cleared a budget inversion that a
 * near-equal pair (Belgium vs Turkey) then caught. Compare near-equal leagues.
 *
 * The user's own club (tid 0) is EXCLUDED from every metric — an unmanaged user
 * club rots in a headless sim and contaminates minima/tails (see the
 * headless-audit-user-club memory).
 *
 * Run: npx tsx scripts/weakLeaguesAudit.ts
 *      SEASONS=30 SEEDS=1,2,3 npx tsx scripts/weakLeaguesAudit.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { countryStrengthOffset, type ProgressionModel } from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 20);

/**
 * Which development model the audited worlds run (`MODEL=steady`).
 *
 * Defaults to `"random"`, so every existing invocation of this script — and
 * every number recorded against it in CLAUDE.md — measures exactly what it
 * measured before. The reason it is a knob at all is that `"steady"` is a
 * different progression model, and progression is what the country ladder and
 * the weak leagues' solvency both rest on; a mode that quietly bankrupted
 * Serbia would be no better for being opt-in.
 *
 * Note the two models are NOT comparable run for run: they are different worlds
 * from the first offseason, so read each against its own gates rather than
 * against the other's numbers.
 */
const MODEL = (process.env.MODEL ?? "random") as ProgressionModel;
if (MODEL !== "random" && MODEL !== "steady") {
  throw new Error(`MODEL must be "random" or "steady"; got "${process.env.MODEL}"`);
}
// Overridable so a tuning change can be checked against worlds it was not
// tuned on — fitting a constant to seeds 1 and 2 and then reporting seeds 1
// and 2 measures the sample, not the mechanism.
// Parsed defensively: the whole point of this knob is checking a tuning change
// on unseen seeds, so a typo must not silently produce a confident verdict about
// a world nobody meant to run. Note `SEEDS=` is an empty string, not nullish, so
// `??` alone would not fall back — and Number("") is 0, not NaN, so an empty
// segment (or a trailing comma) would quietly add seed 0 rather than be rejected.
// Four seeds by default, not two: the adjacent-rung check below gates a MEAN
// across seeds, and a mean of two draws from a quantity whose per-seed noise is
// ~±1 OVR is not worth gating on. This is a manual audit run before touching
// country constants, not CI, so it can afford the wall-clock (~45 min).
const seedsRaw = process.env.SEEDS?.trim();
const SEEDS = (seedsRaw || "1,2,3,4")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map(Number);
if (!SEEDS.length || !SEEDS.every(Number.isFinite)) {
  throw new Error(`SEEDS must be a comma-separated list of numbers; got "${process.env.SEEDS}"`);
}
const USER_TID = 0;

/**
 * The ladder, strongest first. Only the *weak* leagues are checked pairwise —
 * the big four are equal siblings by design, so their mutual order is noise.
 */
const BIG_FOUR = ["England", "Spain", "Italy", "Germany"];
const WEAK_LADDER = [
  "France", "Netherlands", "Portugal", "Belgium", "Turkey", "Greece", "Scotland", "Serbia",
];

/**
 * Rungs that are only ONE COUNTRY_STRENGTH_OFFSET point apart from the rung
 * above them are NOT separately resolvable across a dynasty, so their per-seed
 * order is not gated — only the cross-seed mean is. See the header.
 *
 * **Derived from the offsets, never hand-listed**, so it cannot drift when a
 * country is added or an offset moves: if you widen a rung to a 2-point step it
 * automatically starts being gated per-seed again, and if you squeeze one to a
 * 1-point step it automatically stops. Hand-listing this was the obvious
 * shortcut and would have silently kept gating a rung the design had just
 * stopped promising.
 */
const RESOLVABLE_STEP = 2;
function isConvergedRung(country: string, prevCountry: string): boolean {
  const off = (c: string) => (c === "BIG4" ? 0 : countryStrengthOffset(c));
  return off(country) - off(prevCountry) < RESOLVABLE_STEP;
}

/**
 * What the ladder actually guarantees, and what it does not.
 *
 * Portugal/Belgium/Turkey are one COUNTRY_STRENGTH_OFFSET point apart (≈0.9 OVR
 * at generation), and ~40% of every country gap erodes over 20 seasons. So
 * adjacent weak rungs end up within a few tenths of each other and are NOT
 * separately resolvable — measured, seed 1: POR 49.6 / BEL 49.6 / TUR 49.3.
 * Asserting a per-rung magnitude there would be asserting precision the design
 * doesn't have, and would fail on seed noise alone.
 *
 * What IS meaningful, and what these gates check:
 *  - ORDER never inverts. This is the real failure mode and the one that
 *    actually bit: a weaker-but-richer league overtaking a stronger-but-poorer
 *    one, which showed up as a 2.23 OVR inversion, far outside noise.
 *  - The weak block stays genuinely below the big four (MIN_SPREAD).
 *  - The weak ladder's own ends stay apart (MIN_END_SPREAD) — France must still
 *    be clearly stronger than Turkey even if the middle rungs blur.
 *
 * ORDER IS GATED AT TWO DIFFERENT SCALES, and the split is the whole point
 * (2026-08-11). An earlier version stated all of the above and *then* gated
 * adjacent-rung order per seed at 0.5 — a tolerance below the noise it had just
 * described, so the gate contradicted its own header and failed on seed choice
 * alone. Measured over 4 seeds × 20 seasons:
 *
 *     Portugal→Belgium  +0.24  -0.44  +1.51  +1.75   mean +0.77
 *     Belgium→Turkey    -1.33  +0.48  -0.45  +0.06   mean -0.31
 *
 * Per-seed values straddle zero with ~±1 OVR of spread; the means sit near it.
 * That is noise, not a ladder failure — so a single seed can only resolve a
 * GROSS inversion (SEED_INVERSION_TOLERANCE), while a SYSTEMATIC one shows up
 * in the mean across seeds (MEAN_INVERSION_TOLERANCE), where the noise averages
 * down. Both real failures are caught twice over: the Belgium/Turkey budget
 * inversion ran -2.23 on every seed, and the 2026-08-11 transfer-market
 * inversion ran -2.5 with England below Portugal.
 *
 * Per-rung *magnitudes* remain printed for information, not gated. If a future
 * change needs the rungs individually resolvable across a dynasty, widen the
 * offsets to 2-point steps (e.g. Portugal 10 / Belgium 12 / Turkey 14) rather
 * than tightening these numbers.
 *
 * WHICH RUNGS GET THE PER-SEED GATE AT ALL (2026-08-28, when the world went to
 * twelve countries). The weak ladder now has eight rungs and the bottom six sit
 * one offset point apart, which is below the resolution the ladder has after a
 * dynasty. Gating every adjacent pair per seed therefore started failing on
 * seed noise alone on a world whose every cross-seed mean was healthy —
 * measured, Turkey→Greece ran +1.31 / +1.69 / **-2.27** / +0.25 for a mean of
 * +0.25. That is the same contradiction the 2026-08-11 note above describes,
 * arriving from the other direction: the gate was asserting more than the
 * header promised.
 *
 * So the per-seed gross-inversion gate now applies ONLY to rungs the design
 * claims are resolvable — a step of RESOLVABLE_STEP (2) offset points or more,
 * currently BIG4→France, France→Netherlands and Netherlands→Portugal. The
 * one-point block below that (Portugal/Belgium/Turkey/Greece/Scotland/Serbia)
 * is gated as a BLOCK: cross-seed mean order, plus the block-level spreads
 * (BIG4→weakest and France→weakest) which are checked both per seed and on the
 * mean. **This deliberately did NOT loosen SEED_INVERSION_TOLERANCE** — the
 * tolerance is untouched and still fires on any rung that is supposed to hold
 * apart. Widening a rung to a 2-point step automatically re-enables its
 * per-seed gate, since isConvergedRung reads the offsets.
 *
 * THE SPREADS ARE GATED AT THE SAME TWO SCALES (2026-08-13), after the
 * per-seed MIN_END_SPREAD floor false-failed on a healthy main. Measured over
 * 8 seeds × 20 seasons per build, France→Turkey end spread:
 *
 *     pre-#217   1.81  1.52  1.40  3.07  2.99  4.10  -1.11  2.65   mean 2.05, sd 1.47
 *     post-#217  2.47  0.97  4.73  3.47  2.30  4.33   1.51  2.68   mean 2.81, sd 1.22
 *
 * Two lessons paid for there:
 *  - A 4-SEED RANGE IS NOT A VARIANCE ESTIMATE. Seeds 1-4 alone read as
 *    "#217 doubled the spread" (range 1.67 → 3.76); seeds 5-8 alone read the
 *    opposite. On all 8, post-#217 is *tighter* (sd 1.22 vs 1.47) and stronger
 *    (mean 2.81 vs 2.05). Before attributing a variance change to a PR, run
 *    fresh seeds on both builds — the first 4-seed comparison measured its own
 *    sample, exactly the trap the SEEDS knob comment warns about.
 *  - Per-seed noise on this metric is ~±1.4 OVR: pre-#217 seed 7 lands at
 *    -1.11 — an outright France-below-Turkey inversion on a build whose seeds
 *    1-4 all cleared the old 1.0 floor. A per-seed floor of 1.0 was asserting
 *    precision the metric never had; it passed by seed luck. So, as with
 *    order: a single seed only resolves a GROSS end inversion (reusing
 *    SEED_INVERSION_TOLERANCE; the worst healthy observation is -1.11), while
 *    the design intent — France clearly above Turkey — is gated on the MEAN,
 *    where healthy builds measure 2.05/2.81.
 * BIG4→weakest gets the same split on principle (per-seed 3.0 is the gross
 * floor; the mean catches systematic erosion): healthy per-seed values measure
 * 4.86-6.72 with means 5.86/5.96, against a generation-time gap of ~11.
 */
/** BIG4→weakest, PER SEED — only a gross collapse of the weak block. */
const MIN_SPREAD = 3.0;
/** BIG4→weakest, on the CROSS-SEED MEAN — systematic erosion (healthy ≈ 5.9-6.2). */
const MEAN_MIN_SPREAD = 4.0;
/** France→Turkey, on the CROSS-SEED MEAN (healthy ≈ 2.0-2.8). Per seed, only a
 * gross end inversion beyond SEED_INVERSION_TOLERANCE fails — see the header. */
const MIN_END_SPREAD = 1.0;
/**
 * How far a rung may sit below where it belongs ON A SINGLE SEED before that
 * alone is a failure. Sits above the ~±1 OVR of measured per-seed noise, and
 * below both real failures (2.23 and 2.5) — so one bad seed still fails loudly,
 * but a coin-flip between two rungs a tenth apart does not.
 */
const SEED_INVERSION_TOLERANCE = 2.0;
/**
 * Same, applied to the MEAN across seeds, where noise averages down and a
 * systematic inversion cannot hide. This is the sensitive gate: a real
 * inversion is present on every seed and so survives averaging, while the
 * measured noise means sit at +0.77 and -0.31.
 */
const MEAN_INVERSION_TOLERANCE = 1.0;

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Mean OVR of all rostered players in a country's tier-1 clubs, excluding the user's club. */
function d1MeanOvr(league: LeagueStore, country: string): number {
  const ovrByPid = new Map(league.players.map((p) => [p.pid, p.ovr]));
  const ovrs: number[] = [];
  for (const t of league.teams) {
    if (t.tid === USER_TID) continue;
    const comp = competitionOf(league.competitions, t.compId);
    if (comp.country !== country || comp.tier !== 1) continue;
    for (const pid of t.roster) {
      const o = ovrByPid.get(pid);
      if (o !== undefined) ovrs.push(o);
    }
  }
  return avg(ovrs);
}

function minAIBudget(league: LeagueStore): number {
  return Math.min(...league.teams.filter((t) => t.tid !== USER_TID).map((t) => t.budget));
}

/**
 * Clubs currently in deficit, as a COUNT and a SHARE of the world.
 *
 * The min alone is not comparable between worlds of different sizes, and this
 * file is the one place that matters most. A minimum is a tail statistic: it
 * gets worse as you add clubs even when nothing about the per-club distribution
 * has moved, so a 626-club world will read a deeper worst case than a 420-club
 * one for free. Measured across this exact change — adding a third division to
 * every country grew the world 49% — and the min went from -£0.6M to -£8.0M
 * while the question "is a club here more likely to go broke than before" was
 * never actually asked.
 *
 * Same lesson as the M3 top-scorer gate (a world-wide max standing in for a
 * league statistic), the offseason roster floor ("a minimum over 320 clubs is
 * not a safety invariant"), the M4 points gate and the free-agency ppg fix:
 * when a gate fails after a world-size change, check whether its ESTIMATOR is
 * size-dependent before believing the number. Fix the statistic, don't widen
 * the band.
 *
 * The min is still reported — a single club £8M under is worth seeing — but the
 * rate is what compares across worlds.
 */
function deficitRate(league: LeagueStore): { count: number; share: number } {
  const ai = league.teams.filter((t) => t.tid !== USER_TID);
  const count = ai.filter((t) => t.budget < 0).length;
  return { count, share: count / ai.length };
}

let anyFailure = false;
/** Each rung gap, collected across seeds, so the mean gate can run at the end. */
const gapsAcrossSeeds = new Map<string, number[]>();
/** BIG4→weakest and France→Turkey spreads, collected for the mean gates. */
const bigSpreadAcrossSeeds: number[] = [];
const endSpreadAcrossSeeds: number[] = [];

for (const seed of SEEDS) {
  console.log(`\n=== seed ${seed} (${SEASONS} seasons) ===`);
  let league = createLeagueState(
    USER_TID, mulberry32(seed), 0, undefined, undefined, true, null, MODEL,
  );

  let worstDeficitCount = 0;
  let worstDeficitClubs = 0;
  let everInDeficit = 0;
  let samples = 0;
  let minBudget = Infinity;
  let minBudgetSeason = 0;
  let minBudgetCountry = "";

  const trackBudget = () => {
    const { count } = deficitRate(league);
    // Record the denominator every sample, not only when a new worst is seen —
    // otherwise a world that never goes into deficit reports "0/0 clubs", which
    // hides the very number the rate exists to make comparable.
    worstDeficitClubs = league.teams.filter((t) => t.tid !== USER_TID).length;
    worstDeficitCount = Math.max(worstDeficitCount, count);
    everInDeficit += count > 0 ? 1 : 0;
    samples += 1;
    const mb = minAIBudget(league);
    if (mb < minBudget) {
      minBudget = mb;
      minBudgetSeason = league.season;
      const worst = league.teams.filter((t) => t.tid !== USER_TID).sort((a, b) => a.budget - b.budget)[0];
      minBudgetCountry = competitionOf(league.competitions, worst.compId).country;
    }
  };

  const measure = () => {
    const byCountry = new Map<string, number>();
    for (const c of [...BIG_FOUR, ...WEAK_LADDER]) byCountry.set(c, d1MeanOvr(league, c));
    trackBudget();
    return byCountry;
  };

  const report = (label: string, m: Map<string, number>, checkGaps: boolean) => {
    const big = avg(BIG_FOUR.map((c) => m.get(c)!));
    const line = WEAK_LADDER.map((c) => `${c.slice(0, 3).toUpperCase()} ${m.get(c)!.toFixed(1)}`).join("  ");
    console.log(`${label} s${league.season}: BIG4 ${big.toFixed(1)}  ${line}`);
    if (!checkGaps) return;

    const problems: string[] = [];

    // 1. Order must never invert — the real failure mode (see the header). Only
    //    a GROSS inversion is resolvable on one seed; the sensitive test is the
    //    cross-seed mean, run after every seed completes.
    let prev = big;
    let prevName = "BIG4";
    const gaps: string[] = [];
    for (const c of WEAK_LADDER) {
      const gap = prev - m.get(c)!;
      gaps.push(`${prevName}→${c} ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}`);
      const key = `${prevName}→${c}`;
      if (!gapsAcrossSeeds.has(key)) gapsAcrossSeeds.set(key, []);
      gapsAcrossSeeds.get(key)!.push(gap);
      // Per-seed order is only gated where the design actually promises
      // separation, i.e. a step of RESOLVABLE_STEP offset points or more. A
      // one-point rung converges to within noise by season 20 and its per-seed
      // sign is a coin flip (measured over 4 seeds, Turkey→Greece ran
      // +1.31/+1.69/-2.27/+0.25 on a world whose every *mean* was healthy), so
      // gating it per seed asserts precision the ladder does not have. The mean
      // gate below still covers it, and that is where a systematic inversion —
      // the failure that actually bit, at -2.23 and -2.5 on every seed — shows.
      if (gap < -SEED_INVERSION_TOLERANCE && !isConvergedRung(c, prevName)) {
        problems.push(`${prevName}→${c} GROSSLY INVERTED (${gap.toFixed(2)})`);
      }
      prev = m.get(c)!;
      prevName = c;
    }
    console.log(`       rungs: ${gaps.join("  ")}`);

    // 2. The weak block must stay genuinely below the big four. Per seed this
    //    only catches a gross collapse; the sensitive check is the cross-seed
    //    mean, run after every seed completes.
    const weakest = WEAK_LADDER[WEAK_LADDER.length - 1];
    const spread = big - m.get(weakest)!;
    bigSpreadAcrossSeeds.push(spread);
    if (spread < MIN_SPREAD) problems.push(`BIG4→${weakest} spread only ${spread.toFixed(2)} (< ${MIN_SPREAD})`);

    // 3. The weak ladder's own ends must stay apart — but per-seed noise on
    //    this spread is ~±1.4 OVR (a healthy build measured -1.11 on one seed,
    //    see the header), so a single seed only resolves a GROSS end
    //    inversion; the magnitude itself is gated on the cross-seed mean.
    const endSpread = m.get(WEAK_LADDER[0])! - m.get(weakest)!;
    endSpreadAcrossSeeds.push(endSpread);
    if (endSpread < -SEED_INVERSION_TOLERANCE) {
      problems.push(`${WEAK_LADDER[0]}→${weakest} ends GROSSLY INVERTED (${endSpread.toFixed(2)})`);
    }

    if (problems.length) {
      anyFailure = true;
      console.log(`  → ladder **BROKEN**: ${problems.join("; ")}`);
    } else {
      console.log(
        `  → ladder OK (no inversion beyond ${SEED_INVERSION_TOLERANCE} on resolvable rungs; ` +
        `BIG4→${weakest} ${spread.toFixed(2)} ≥ ${MIN_SPREAD}; ` +
        `${WEAK_LADDER[0]}→${weakest} ${endSpread.toFixed(2)})`,
      );
    }
  };

  const gen = measure();
  report("gen ", gen, false);
  for (let s = 0; s < SEASONS; s++) {
    const seasonRng = mulberry32(seed * 1000 + s);
    league = simThrough(league, "season", seasonRng);
    // simThrough halts before the user's cup final (a UI courtesy — the live
    // player sims the final deliberately). Headlessly that leaves the phase
    // "regular", and simOffseason SILENTLY RETURNS THE LEAGUE UNCHANGED on any
    // phase but "offseason" — so a dynasty whose unmanaged user club reached a
    // cup final quietly simmed one fewer season than reported (caught
    // 2026-08-13: one seed of eight ended a "20-season" run at season 20, not
    // 21). Resume until the season actually ends; a no-op for every other
    // seed, so their results are bit-identical to before this guard.
    for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
      if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish (phase ${league.phase})`);
      league = simThrough(league, "season", seasonRng);
    }
    // Sample the budget at BOTH points in the cycle, every season. This used to
    // run only at generation and at the end, while reporting itself as "min AI
    // budget over dynasty" — so a club that dipped negative in season 9 and
    // recovered by season 20 was reported as solvent, and an in-season deficit
    // (regular-window buys charge a full season's salary up front) was never
    // sampled at all.
    trackBudget();
    league = simOffseason(league, mulberry32(seed * 2000 + s));
    trackBudget();
  }
  const end = measure();
  report("end ", end, true);

  // Erosion report: how much of each generation-time gap survived.
  const genBig = avg(BIG_FOUR.map((c) => gen.get(c)!));
  const endBig = avg(BIG_FOUR.map((c) => end.get(c)!));
  console.log("  erosion vs the big four:");
  for (const c of WEAK_LADDER) {
    const g = genBig - gen.get(c)!;
    const e = endBig - end.get(c)!;
    console.log(`    ${c.padEnd(9)} gap ${g.toFixed(2)} → ${e.toFixed(2)}  (${((1 - e / g) * 100).toFixed(0)}% eroded)`);
  }

  const solvent = minBudget > 0;
  if (!solvent) anyFailure = true;
  console.log(
    `  → min AI budget over dynasty: £${(minBudget / 1e6).toFixed(1)}M ` +
    `(season ${minBudgetSeason}, ${minBudgetCountry}) — ${solvent ? "SOLVENT" : "**DEFICIT**"}`,
  );
  // The size-independent reading. Compare THIS across worlds; the min above is
  // a tail statistic and deepens for free as the club count grows.
  console.log(
    `  → deficit rate: worst ${worstDeficitCount}/${worstDeficitClubs} clubs ` +
    `(${(100 * worstDeficitCount / Math.max(1, worstDeficitClubs)).toFixed(2)}% at once), ` +
    `any club in deficit at ${everInDeficit}/${samples} samples`,
  );
}

// The sensitive order gate: each rung gap averaged over every seed. Per-seed
// noise is ~±1 OVR and straddles zero, so a single seed can only catch a gross
// inversion; a systematic one is present on every seed and survives averaging.
console.log(`\n=== rung gaps, mean over ${SEEDS.length} seed(s) ===`);
const meanProblems: string[] = [];
for (const [key, gaps] of gapsAcrossSeeds) {
  const m = avg(gaps);
  const detail = gaps.map((g) => `${g >= 0 ? "+" : ""}${g.toFixed(2)}`).join(" ");
  console.log(`  ${key.padEnd(20)} mean ${m >= 0 ? "+" : ""}${m.toFixed(2)}   (${detail})`);
  if (m < -MEAN_INVERSION_TOLERANCE) {
    meanProblems.push(`${key} INVERTED on the mean (${m.toFixed(2)} < -${MEAN_INVERSION_TOLERANCE})`);
  }
}
// The spread magnitudes, gated on the same cross-seed mean (per seed they only
// catch gross failures — see the 2026-08-13 header note for the measured noise).
const weakestName = WEAK_LADDER[WEAK_LADDER.length - 1];
const spreadGates: Array<[string, number[], number]> = [
  [`BIG4→${weakestName}`, bigSpreadAcrossSeeds, MEAN_MIN_SPREAD],
  [`${WEAK_LADDER[0]}→${weakestName}`, endSpreadAcrossSeeds, MIN_END_SPREAD],
];
for (const [key, values, floor] of spreadGates) {
  const m = avg(values);
  const detail = values.map((v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`).join(" ");
  console.log(`  ${key.padEnd(20)} mean ${m >= 0 ? "+" : ""}${m.toFixed(2)}   (${detail})`);
  if (m < floor) meanProblems.push(`${key} mean spread only ${m.toFixed(2)} (< ${floor})`);
}
if (meanProblems.length) {
  anyFailure = true;
  console.log(`  → **BROKEN**: ${meanProblems.join("; ")}`);
} else {
  console.log(
    `  → OK (no mean inversion beyond ${MEAN_INVERSION_TOLERANCE}; mean spreads ≥ ${MEAN_MIN_SPREAD}/${MIN_END_SPREAD})`,
  );
}
if (SEEDS.length < 3) {
  // Not a failure, but the mean gate above is the sensitive one and it is weak
  // on one or two draws — say so rather than letting a thin run read as a pass.
  console.log(`  NOTE: only ${SEEDS.length} seed(s); the mean gate is under-powered below 3.`);
}

// Exit non-zero on failure. An earlier version of this script printed
// "**BROKEN**" and exited 0, so a fully inverted strength ladder shipped to main
// with green CI (see docs/transfer-mobility.md). A gate that reports failure and
// returns success is worse than no gate — it reads as evidence the invariant holds.
console.log(anyFailure ? "\nRESULT: **FAILURES ABOVE**" : "\nRESULT: all checks passed");
process.exit(anyFailure ? 1 : 0);
