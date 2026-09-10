/**
 * Cost-aware split of test files across CI shards.
 *
 * Vitest's own `--shard` hashes each file path with sha1, sorts by the hash and
 * slices the list into equal *counts* (see `BaseSequencer.shard`). That is
 * deterministic and cost-blind, which is a bad combination for this suite: the
 * work is wildly unevenly distributed — a handful of full-world multi-season sim
 * files run for minutes while most run in milliseconds — so one shard reliably
 * draws the heavy files and every other runner finishes early and idles. It is
 * the same draw every run, because the hash of a path doesn't change. Measured
 * over three consecutive CI runs on six shards, the slowest shard took 1749s,
 * 1765s and 1863s while the fastest took 40s, 41s and 47s, against ~75 minutes
 * of total work.
 *
 * So: weight each file, then greedily pack the shards. Nothing here changes
 * which tests run, only which runner runs them.
 *
 * **This does not by itself reduce CI wall-clock, and why not is worth knowing
 * before trusting any estimate of what balancing buys.** The floor is the
 * slowest single *file*, which no split can beat, and here that floor is very
 * nearly the whole budget: on the first packed run, shard 1 ran
 * `test/core/offseason.test.ts` **alone** and took 1933s, against a
 * pre-balancing worst shard of 1749-1863s. So the old worst shard was already
 * almost exactly that one file, and there was never a large wall-clock win to
 * take. What balancing actually bought is the other five shards getting
 * lighter — spare runner capacity, not a faster build.
 *
 * What it did do is make the floor mechanical and visible: shard 1 was provably
 * one file, which made the next move unambiguous. That move has since been
 * taken — `offseason.test.ts` (23 tests, ~1933s on CI) and
 * `international.test.ts` (25 tests, ~1082s) were each split into several
 * files, and this packing is what spreads the pieces across shards. Without it
 * two halves of a split file can land straight back on the same shard.
 * `test/validation/m4-multiseason-integrity.test.ts` was the precedent -- and
 * has since been folded back in, once it turned out the two gates could share
 * one five-season chain instead of simming one each, which is the case where
 * splitting stops being worth anything.
 *
 * With those split, no single file dominates any more and the binding
 * constraint becomes the *total*: work / shard count. If CI needs to go faster
 * still, the lever is the shard count in `.github/workflows/ci.yml`, not
 * further splitting.
 *
 * **That has stopped being true, and the next person to raise the shard count
 * should know it.** The 626-club world (#308) grew the sim files by roughly the
 * same 49% the world grew, and the one-file floor rose with them until it sat
 * *inside* the range the shards actually finish in. A seventh shard therefore
 * buys essentially nothing; the lever is the heaviest file.
 *
 * **The last time it was pulled the answer was a shared fixture rather than a
 * split, and that is worth reading before reaching for either.**
 * `test/core/youthIntake.test.ts` measured **2,073s on CI** (run 34169962576)
 * against that shard's total wall clock of 2,114s — one file was 98% of a
 * runner, and it was the slowest in the suite by 2.3x over
 * `offseasonRetirement` at 907s. The cause was not that the file did too much:
 * twelve of its fifteen tests each ran `advance(createLeagueState(0,
 * mulberry32(4)), rng)` for themselves, all on the same seed, so it built and
 * simmed the identical world twelve times to assert twelve things about it.
 * Sharing one world through `beforeAll` was the whole fix, and it needed no
 * test to change what it asserts: 13 season+offseason runs became 2, and the
 * file went from ~1382s to **186s** locally with all 15 tests unchanged.
 *
 * So: **before splitting a heavy file, check whether it is repeating one
 * world.** A split divides the same work across runners and adds files to keep
 * in step; sharing removes the work. `scoutDirections.test.ts` is the case that
 * genuinely cannot share — its three worlds differ in the directions they were
 * built with, which is the thing under test — and it already memoises across
 * the four cases that do want the same one.
 *
 * Note CI runners are ~1.5x slower than a dev machine here
 * (`offseason.test.ts` was ~1276s locally against ~1933s on CI), so the weights
 * below are local seconds. That is fine: uniform scaling doesn't change how the
 * packing sorts.
 */

/**
 * Approximate wall-clock seconds per test file, for the files where the number
 * is big enough to matter. Everything absent is assumed to cost
 * `DEFAULT_WEIGHT_SECONDS`.
 *
 * **This whole table was rebuilt from one CI run on 2026-09-02**, because the
 * world grew 49% (420 -> 626 clubs, #308) and the old numbers were 420-club
 * measurements. That is worse than it sounds: the growth is not uniform, so
 * this is not a case where a stale table still sorts correctly. A file that
 * builds a world and sims seasons roughly tripled, while a pure-derivation file
 * did not move at all — and fourteen files that had crossed the ~30s bar were
 * still sitting on the 10s default, `cupIntegration.test.ts` at 743s of CI time
 * against a weight of 10. Measured against the packing the old table produced,
 * the slowest shard ran 1.37x the even share (1911s against 1394s) while the
 * model believed it had balanced them to within 1%.
 *
 * The source is a single full CI run's per-file `tests` durations
 * (run 33580546751, six shards, all green), divided by the ~1.5x CI-to-dev
 * factor documented above so the table keeps its stated basis of local seconds.
 * Taking every number from ONE contended run is the point: these are internally
 * consistent with each other, which is what packing needs, where the previous
 * table mixed measurements from different months and different worlds.
 *
 * **Measured after the refresh (run 33641959090), and the honest result is that
 * balancing bought less than the model predicted — for a reason worth knowing
 * before anyone tunes this again.** Re-scored on the old run's numbers the new
 * table predicted a near-perfect split and ~24 minutes; the actual shards ran
 * 1245/1304/1438/1531/1501/**1802**s, so the slowest went 1911s -> 1802s and CI
 * ~32 -> ~30 minutes. The work really did even out — summed test-time per shard
 * landed 1.13x the even share against 1.37x before — but **summed test-time is
 * not shard wall clock, and this table can only ever balance the former.** Two
 * things break the conversion, both visible inside that one run:
 *
 *   - **Runner speed varies ~44% within a single run.** Effective parallelism
 *     (summed test-time / wall clock) came out 2.48 / 2.38 / 2.32 / 2.25 / 1.87
 *     / **1.72** across the six. Shard 2 drew the slowest runner and finished
 *     last on the second-*lightest* load — no packing can fix that.
 *   - **Per-file cost itself swings run to run.** `offseasonRetirement` read
 *     1359s then 1481s; `internationalConfederationCups` 813s then 574s. The
 *     ordering survives, which is all packing needs, but it means a predicted
 *     wall clock carries error bars the model does not show.
 *
 * So: refresh the table when the world changes, because a 1.37x imbalance is
 * real and worth removing. Do not expect the wall clock to fall in proportion,
 * and do not tune these numbers against a single run's wall clock.
 *
 * Treat these as an ordering, not as measurements. A machine running full-world
 * sims back to back thermally throttles — the same file measured 234s and 557s
 * an hour apart — which is fine for the purpose but means you should not read
 * them as seconds anywhere, and should not chase a small discrepancy.
 *
 * **A file timed on its own is not the same number as the same file timed
 * during a full run, and the gap is large.** Measured on an 8GB MacBook:
 * `offseasonFinance.test.ts` took 156s alone and 244s alongside three other
 * heavy files — 1.57x, at only four workers on eight cores, so it is not CPU
 * contention but memory bandwidth and thermals. Parallel efficiency across
 * those four files was ~55%. The entries here are full-run numbers, which is
 * the right basis since packing is about a full run. So when you refresh one
 * with a solo `npx vitest run <file>` it will look far too low — do not paste
 * it in on its own. Mixing a solo number into a table of contended ones
 * reorders the packing on a measurement artefact rather than on real cost.
 *
 * That inflation is also the reason the local two-machine runner
 * (`scripts/testCluster.sh`) is worth more than its core count implies: a
 * second machine adds a memory subsystem and a thermal budget, not just cores.
 *
 * These drive load balancing only. Being wrong costs balance, never
 * correctness: every file still runs exactly once across the shards whatever
 * the weights say (`partitionByCost` is total and disjoint, pinned by
 * `shardPartition.test.ts`). So an unlisted new file is safe — it just lands
 * somewhere by default weight.
 *
 * **Refresh the whole table after a world-size change, not one entry at a
 * time.** The cheapest source is a green CI run, which reports every file's
 * duration in one internally consistent contended sample:
 *   gh run view <id> --log | grep -oE '\S+\.test\.tsx? \([0-9]+ tests?\) [0-9]+ms'
 * For a single new file, time it in a full local run and add an entry whenever
 * it runs longer than ~30s.
 */
// Six entries were re-weighted on 2026-09-03, after a test-audit pass removed
// repeated setup. offseason 835 -> 625 and offseasonSquads 642 -> 385 (identical
// seeds are no longer re-simmed per test); generate 149 -> 55 (seven world
// generations -> one); ai/transferMarket 108 -> 45 (nine market passes -> four);
// internationalPlayerRecord 455 -> 60 (its four-season chain moved to
// internationalCampaign, which already ran the identical one -- measured at 47s
// for the file afterwards); and db/leagueDb dropped out of the table entirely,
// an England-only world putting it under the ~30s threshold for being listed.
//
// Scaled by the change in expensive operations rather than pasted from a local
// run, per the warning above about solo timings: being wrong here costs shard
// balance, never correctness.
export const FILE_WEIGHTS_SECONDS: Readonly<Record<string, number>> = {
  // The youth trial group and the scout directions beside it, both on the same
  // basis as everything else here: taken from one green CI run (33688034353)
  // and divided by the ~1.5x CI-to-dev factor. Worth knowing that the solo
  // timings these were first entered at (664s and 192s, scaled by the old 1.57x
  // rule) put scoutDirections at 301 against a real 860 — under by 2.9x, and
  // exactly the mixed-basis error the note above warns about.
  //
  // youthIntake was the suite's slowest single file at 1217 here (2073s on CI)
  // until it stopped rebuilding one world twelve times over; see the fixture
  // note at the top of this file. 190 is a directly measured local run of the
  // shared-fixture version (186s, with an unrelated vitest run competing for
  // the machine, so on this table's contended basis rather than a solo one).
  // Deriving it instead from the CI arithmetic — 13 season+offseason runs became
  // 2, so ~1 generation plus 2 of the ~149s units the old number implies, ~308s
  // CI, ~205 here — lands within 10% of that, which is the check that the two
  // bases still agree. Worth refreshing from the first green CI run that carries
  // it; an under-estimate is the harmful direction, since that is what let this
  // file dominate a shard unnoticed.
  "test/core/youthIntake.test.ts": 190,
  "test/core/offseasonRetirement.test.ts": 906,
  "test/core/scoutDirections.test.ts": 860,
  "test/core/internationalCampaign.test.ts": 845,
  "test/core/offseason.test.ts": 625,
  "test/core/offseasonSquads.test.ts": 385,
  "test/core/offseasonFinance.test.ts": 625,
  "test/core/internationalConfederationCups.test.ts": 542,
  "test/core/internationalEquivalence.test.ts": 530,
  "test/core/cupIntegration.test.ts": 495,
  "test/core/internationalPlayerRecord.test.ts": 60,
  "test/core/worldIntegration.test.ts": 428,
  "test/validation/m3-top-scorer.test.ts": 424,
  "test/validation/m4-multiseason.test.ts": 413,
  "test/db/migrate.test.ts": 355,
  "test/core/superCup.test.ts": 353,
  "test/core/loans.test.ts": 353,
  "test/ui/transfersRender.test.tsx": 339,
  "test/core/offseasonSolvency.test.ts": 335,
  "test/core/spectator.test.ts": 311,
  "test/core/loanContracts.test.ts": 304,
  "test/core/difficulty.test.ts": 257,
  "test/core/transfers/recommendations.test.ts": 217,
  "test/core/simArchive.test.ts": 189,
  "test/core/simThrough.test.ts": 180,
  "test/core/positionChange.test.ts": 167,
  "test/core/transfers/clauseOffseason.test.ts": 167,
  "test/core/transfers/inboundOffers.test.ts": 154,
  "test/core/generate.test.ts": 55,
  // Measured at ~50s locally rather than from a CI run, so it is entered
  // unscaled and is an UNDER-estimate by roughly the 1.5x CI factor. Being low
  // costs balance only, never correctness, and it is better than the 10s
  // default this would otherwise take: most of the file's cost is the two
  // whole-world builds and the intake sweeps, which do not shrink on CI.
  // Re-take it from the next green run, the way the note above describes.
  "test/core/progressionModel.test.ts": 50,
  "test/core/autopilot.test.ts": 141,
  "test/core/nationalManager.test.ts": 114,
  "test/core/ai/transferMarket.test.ts": 45,
  // Measured at ~40s locally rather than from a CI run, so entered unscaled
  // and an UNDER-estimate by roughly the 1.5x CI factor — see the note on
  // progressionModel above. Nearly all of it is two whole-world market passes,
  // which do not shrink on CI. Re-take it from the next green run.
  "test/core/transfers/windowLock.test.ts": 40,
  "test/core/transfers/searchWorldPlayers.test.ts": 107,
  "test/core/careerSummary.test.ts": 69,
  "test/validation/m1-table-spread.test.ts": 65,
  "test/helpers/fixtureFidelity.test.ts": 37,
  "test/core/peakOvr.test.ts": 36,
  "test/core/domesticCupIntegration.test.ts": 34,
  "test/core/transfers/negotiation.test.ts": 32,
};

/**
 * What an unlisted file is assumed to cost. Set from the measured residual: the
 * suite totals ~75 minutes of work, the files listed above account for roughly
 * 45 of it, and the remainder spread over the ~155 files that aren't listed
 * comes out near ten seconds each. Sharding is insensitive to this being a few
 * seconds off — it only decides the order light files get topped up in.
 */
export const DEFAULT_WEIGHT_SECONDS = 10;

export function weightFor(relPath: string): number {
  return FILE_WEIGHTS_SECONDS[relPath] ?? DEFAULT_WEIGHT_SECONDS;
}

/**
 * Split `relPaths` into `count` groups of roughly equal total weight.
 *
 * `capacities` optionally makes the groups *unequal* — group `i` is given work
 * in proportion to `capacities[i]`. CI passes nothing and gets equal shards.
 * The two-machine local runner (`scripts/testCluster.sh`) passes a measured
 * throughput ratio, because a 16GB machine and an 8GB one are not the same
 * amount of test runner. Omitted, it behaves exactly as it always did.
 *
 * Greedy longest-processing-time: heaviest file first, each one onto whichever
 * shard is currently lightest. That is the standard 4/3-approximation for
 * multiway partitioning, and well inside what matters here — the real limit is
 * the single heaviest file, which no algorithm can split.
 *
 * Ties break on path so the result depends only on the file list, never on the
 * order the caller happened to supply. Every shard runs this identically and
 * they must all agree, since each one keeps only its own group.
 */
export function partitionByCost(
  relPaths: readonly string[],
  count: number,
  capacities?: readonly number[],
): string[][] {
  if (count < 1) throw new Error(`shard count must be >= 1, got ${count}`);

  const caps = capacities ?? new Array<number>(count).fill(1);
  if (caps.length !== count) {
    throw new Error(`expected ${count} capacities, got ${caps.length}`);
  }
  for (const c of caps) {
    if (!Number.isFinite(c) || c <= 0) {
      throw new Error(`every capacity must be a positive finite number, got ${c}`);
    }
  }

  const ordered = [...relPaths].sort((a, b) => {
    const d = weightFor(b) - weightFor(a);
    return d !== 0 ? d : a.localeCompare(b);
  });

  const bins: string[][] = Array.from({ length: count }, () => []);
  const totals = new Array<number>(count).fill(0);

  for (const path of ordered) {
    // Lightest *relative to capacity*. With uniform capacities every divisor is
    // 1, so this is exactly the plain "least loaded" rule and CI's split is
    // byte-for-byte what it was before capacities existed.
    let best = 0;
    for (let i = 1; i < count; i++) {
      if (totals[i] / caps[i] < totals[best] / caps[best]) best = i;
    }
    bins[best].push(path);
    totals[best] += weightFor(path);
  }

  return bins;
}
