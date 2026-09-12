/**
 * Does shrinking the defensive counting-stat weights in `totsScore` shift the
 * game's difficulty?
 *
 * The question behind it. `totsScore` counts tackles and interceptions at 0.03
 * apiece, and a defender collects ~380 of them a season, so his "what he did"
 * term reaches ~11 points against a striker's ~2.6 from goals. That inflation
 * is why the Defender of the Year drifted to weak leagues, and it was patched
 * from the outside with `WORLD_TOTS_TROPHY_MULTIPLIER`. Shrinking the weights
 * themselves is the better fix — it lifts ovr and match rating too, where the
 * multiplier actually squashes them — **but `totsScore` also picks every
 * league's Team of the Season, and a Team of the Season place is one of the
 * three routes onto the protected-star list, which is a tuned difficulty
 * lever**: a protected player is off the transfer market at any price.
 *
 * So the load-bearing measurement is NOT "are the awards better". It is:
 *
 *   1. **How many players are protected**, before and after. More protected
 *      means fewer buyable stars means a harder game.
 *   2. **How many are protected _only_ because of an award** — i.e. ovr < 80,
 *      so the honour is doing the work. Only these can move when `totsScore`
 *      moves. If nearly everyone clears the ovr bar anyway, the whole concern
 *      evaporates and the change is close to free.
 *   3. **Of those, how many via a Team of the Season place** specifically,
 *      rather than Player of the Season or the Golden Boot (neither of which
 *      reads `totsScore` at all).
 *
 * The predicted direction, worth stating before measuring so the result can
 * contradict it: today's volume-heavy formula favours defenders at *bad* clubs
 * (bad clubs defend a lot), and those clubs rarely finish top four, so those
 * picks mostly fail the other half of the gate. A quality-weighted formula
 * should move picks toward good clubs, which do finish top four — so the
 * protected count should go UP and the game should get harder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MEASURED AND REJECTED, 2026-08-24. 4 seeds x 6 seasons per config, pooled
 * over all 24 season-measurements (NOT medians of per-seed medians, which is
 * what an earlier 2-seed read did and is how it reached the wrong answer).
 *
 * | config                    | protected/season | GK rank med/mean | DEF rank med/mean | big-four GK | big-four DEF |
 * |---------------------------|------------------|------------------|-------------------|-------------|--------------|
 * | shipped   0.03  / x3      | 48.0             | 4.5 / 6.0        | 10.5 / 19.1       | 96%         | 75%          |
 * | reweighted 0.007 / x1.5   | 55.2  (+15%)     | 5.0 / 8.6        | 8.5 / 15.6        | 100%        | 77%          |
 * | reweighted 0.007 / x1     | 56.2  (+17%)     | 3.0 / 8.2        | 7.5 / 10.0        | 100%        | 75%          |
 *                                                                    (x1 row is 2 seeds only)
 *
 * Three findings, in order of how much they should change your mind:
 *
 *  1. **The difficulty cost is the only consistent number**: +15% protected
 *     stars, +30% of them arriving via a Team of the Season place, +55% of
 *     those being defenders. Reproduced on every seed. That is a real change
 *     to a tuned difficulty lever.
 *  2. **The award gain is much smaller than a 2-seed read suggested, and is
 *     not uniform.** Defenders improve (mean rank 19.1 -> 15.6); keepers get
 *     *worse* (6.0 -> 8.6). League distribution barely moves, because the
 *     shipped config was already at 96% / 75% big-four winners.
 *  3. **A smaller multiplier is worse than none.** On identical seeds, x1.5
 *     produces worse defender winners than x1 (seed 1 mean 11.2 vs 7.0; seed 2
 *     34 vs 13). Once the weights are sane, ovr carries the signal and extra
 *     trophy weight dilutes it again. So "halve the multiplier" is not a
 *     middle ground; zero is the better end of that axis.
 *
 * Net: the reweight buys a modest defender improvement, costs a keeper
 * regression and a 15% difficulty shift, and would need a full dynasty audit
 * on top because it moves the protected list and therefore the rng stream.
 * Not shipped. If the defender tail is ever worth attacking on its own (the
 * shipped config produced winners ranked 138th, 68th and 37th), do it with a
 * change that cannot touch the per-league Team of the Season.
 *
 * **Methodology note worth keeping:** an earlier 2-seed pass reported the
 * keeper award improving from rank 8.5 to 3 and drove a wrong recommendation.
 * Two seeds of six seasons is 12 numbers spanning 1 to 138 — the seed-to-seed
 * noise is larger than every effect being measured except the protected count.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Run it once per variant, comparing the JSON:
 *   RUN=baseline SEASONS=6 SEEDS=1 npx tsx scripts/totsWeightProbe.ts
 *   (edit the TOTS weights, then)
 *   RUN=variant  SEASONS=6 SEEDS=1 npx tsx scripts/totsWeightProbe.ts
 */
import { writeFileSync } from "node:fs";
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { protectedStarPids, lastCompletedSeason } from "../src/core/transfers/protectedStars.js";
import { positionGroup, ovrDuringSeason, statsFor } from "../src/core/awards.js";
import {
  PROTECTED_STAR_OVR, TOTS_POSITION_WORK,
  WORLD_TOTS_TROPHY_MULTIPLIER,
} from "../src/core/constants.js";

const RUN = process.env.RUN ?? "unnamed";
const SEASONS = Number(process.env.SEASONS ?? 6);
const SEEDS = (process.env.SEEDS ?? "1").split(",").map(Number);

interface SeasonRow {
  seed: number;
  season: number;
  /** Every protected pid across all AI clubs. */
  protectedTotal: number;
  /** Protected and ovr >= PROTECTED_STAR_OVR — would be protected with no awards at all. */
  protectedByOvr: number;
  /** Protected with ovr BELOW the bar, so an honour is carrying him. These are the movable ones. */
  protectedByHonourOnly: number;
  /** Of the honour-only group, those whose honour was a Team of the Season place. */
  protectedByTotsOnly: number;
  /** Position mix of the honour-only group, which is where a defensive reweight lands. */
  honourOnlyByGroup: Record<string, number>;
  /** Sanity: the world award winners, so award quality can be read off the same run. */
  keeperWinnerOvrRank: number | null;
  defenderWinnerOvrRank: number | null;
  keeperCountry: string | null;
  defenderCountry: string | null;
}

const rows: SeasonRow[] = [];
/**
 * Seasons already measured, per seed.
 *
 * `simThrough` deliberately halts before the *user's* cup final, so one loop
 * iteration can end without the season actually completing — and the next
 * iteration then re-measures the same season-history entry. Seen live: a run
 * printed s1, s2, s2, s3... and double-counted that season in every mean.
 */
const measured = new Set<string>();

for (const seed of SEEDS) {
  const rng = mulberry32(seed);
  let league = createLeagueState(0, rng);
  console.log(`\n=== seed ${seed} (${RUN}) ===`);

  for (let s = 0; s < SEASONS; s++) {
    league = simThrough(league, "season", rng);
    league = simOffseason(league, rng);

    const last = lastCompletedSeason(league);
    if (!last) continue;
    const entry = league.seasonHistory.at(-1)!;
    const byPid = new Map(league.players.map((p) => [p.pid, p]));

    const protectedPids = protectedStarPids(
      last, league.teams, league.players, league.competitions, league.meta.userTid,
    );

    // Which honour, if any, is carrying a sub-80 player onto the list.
    const totsPids = new Set<number>();
    const otherHonourPids = new Set<number>();
    for (const a of Object.values(last.awards)) {
      for (const pid of a.teamOfSeason ?? []) if (pid != null) totsPids.add(pid);
      if (a.playerOfSeasonPid != null) otherHonourPids.add(a.playerOfSeasonPid);
      if (a.goldenBootPid != null) otherHonourPids.add(a.goldenBootPid);
    }

    let byOvr = 0;
    let honourOnly = 0;
    let totsOnly = 0;
    const honourOnlyByGroup: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const pid of protectedPids) {
      const p = byPid.get(pid);
      if (!p) continue;
      if (p.ovr >= PROTECTED_STAR_OVR) {
        byOvr++;
        continue;
      }
      honourOnly++;
      honourOnlyByGroup[positionGroup(p.pos)]++;
      // A Team of the Season place, and NOT also a POTS/Golden Boot (which
      // would protect him whatever totsScore does).
      if (totsPids.has(pid) && !otherHonourPids.has(pid)) totsOnly++;
    }

    // Award quality on the same run, so one sim answers both questions.
    const played = league.players.filter((p) => {
      const st = statsFor(p, entry.season);
      return st !== undefined && st.appearances > 0;
    });
    const rankIn = (group: "GK" | "DEF", pid: number): number | null => {
      const pool = played
        .filter((p) => positionGroup(p.pos) === group)
        .map((p) => ({ pid: p.pid, ovr: ovrDuringSeason(p, entry.season) }))
        .sort((a, b) => b.ovr - a.ovr);
      const i = pool.findIndex((r) => r.pid === pid);
      return i < 0 ? null : i + 1;
    };
    const countryOf = (tid: number): string | null => {
      const cid = entry.compsByTid[tid];
      return cid === undefined ? null : competitionOf(league.competitions, cid)?.country ?? null;
    };
    const gk = entry.world.goalkeeperOfYear?.[0];
    const def = entry.world.defenderOfYear?.[0];

    const row: SeasonRow = {
      seed,
      season: entry.season,
      protectedTotal: protectedPids.size,
      protectedByOvr: byOvr,
      protectedByHonourOnly: honourOnly,
      protectedByTotsOnly: totsOnly,
      honourOnlyByGroup,
      keeperWinnerOvrRank: gk ? rankIn("GK", gk.pid) : null,
      defenderWinnerOvrRank: def ? rankIn("DEF", def.pid) : null,
      keeperCountry: gk ? countryOf(gk.tid) : null,
      defenderCountry: def ? countryOf(def.tid) : null,
    };
    const key = `${seed}:${row.season}`;
    if (measured.has(key)) continue;
    measured.add(key);
    rows.push(row);
    console.log(
      `  s${row.season} protected ${row.protectedTotal} ` +
      `(ovr ${row.protectedByOvr}, honour-only ${row.protectedByHonourOnly}, of which TOTS ${row.protectedByTotsOnly}) ` +
      `| GK ${row.keeperCountry ?? "-"} rank ${row.keeperWinnerOvrRank ?? "-"} ` +
      `| DEF ${row.defenderCountry ?? "-"} rank ${row.defenderWinnerOvrRank ?? "-"}`,
    );
  }
}

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs: number[]) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return a.length === 0 ? NaN : a[Math.floor(a.length / 2)];
};

const summary = {
  run: RUN,
  seeds: SEEDS,
  seasons: SEASONS,
  weights: {
    work: TOTS_POSITION_WORK,
    trophyMultiplier: WORLD_TOTS_TROPHY_MULTIPLIER,
  },
  protectedTotal: mean(rows.map((r) => r.protectedTotal)),
  protectedByOvr: mean(rows.map((r) => r.protectedByOvr)),
  protectedByHonourOnly: mean(rows.map((r) => r.protectedByHonourOnly)),
  protectedByTotsOnly: mean(rows.map((r) => r.protectedByTotsOnly)),
  honourOnlyDEF: mean(rows.map((r) => r.honourOnlyByGroup.DEF)),
  honourOnlyGK: mean(rows.map((r) => r.honourOnlyByGroup.GK)),
  keeperRankMedian: median(rows.map((r) => r.keeperWinnerOvrRank ?? NaN)),
  defenderRankMedian: median(rows.map((r) => r.defenderWinnerOvrRank ?? NaN)),
  rows,
};

const out = `/tmp/totsWeightProbe-${RUN}.json`;
writeFileSync(out, JSON.stringify(summary, null, 2));

console.log(`\n=== ${RUN}: ${SEEDS.length} seed(s) x ${SEASONS} seasons ===`);
console.log(
  `  weights: CB defending/game ${TOTS_POSITION_WORK.CB.defendingPerGame},` +
  ` GK conceded/game ${TOTS_POSITION_WORK.GK.concededPerGame}, trophy x${WORLD_TOTS_TROPHY_MULTIPLIER}`,
);
console.log(`  protected stars per season:      ${summary.protectedTotal.toFixed(1)}`);
console.log(`    ...clearing the ovr bar alone: ${summary.protectedByOvr.toFixed(1)}`);
console.log(`    ...carried by an honour:       ${summary.protectedByHonourOnly.toFixed(1)}   <- only these can move`);
console.log(`    ...carried by a TOTS place:    ${summary.protectedByTotsOnly.toFixed(1)}   <- only these can move when totsScore moves`);
console.log(`    honour-only, defenders:        ${summary.honourOnlyDEF.toFixed(1)}`);
console.log(`    honour-only, keepers:          ${summary.honourOnlyGK.toFixed(1)}`);
console.log(`  keeper winner ovr rank (median):   ${summary.keeperRankMedian}`);
console.log(`  defender winner ovr rank (median): ${summary.defenderRankMedian}`);
console.log(`\n  wrote ${out}`);
