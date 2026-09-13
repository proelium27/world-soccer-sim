/**
 * Which keeper formula picks genuinely good keepers? Reads a dump from
 * scripts/totsDataDump.ts, so every formula is judged on identical seasons.
 *
 *   DATA=/tmp/tots.json npx tsx scripts/keeperFormulaEval.ts
 *
 * Why this exists: the per-position Team of the Season formula judged keepers
 * on goals conceded per game, and the Goalkeeper of the Year winner's median
 * ovr rank among the world's keepers fell from 5 to 15. Goals conceded mostly
 * measures the defence in front of him.
 *
 * Prints:
 *  1. How each keeper stat tracks ovr, and how each tracks the quality of the
 *     team in front of him (mean ovr of his club's other players). A good keeper
 *     stat rises with his own ovr and NOT with his defence's.
 *  2. Per formula:
 *     - league: how often the Team of the Season keeper is his league's
 *       best-rated qualified keeper, and his mean ovr rank in the league.
 *     - world proxy: the Goalkeeper of the Year pick with the league-strength
 *       correction but NO trophy terms, and the winner's ovr rank among every
 *       qualified keeper in the world (median / mean over seasons). Trophies are
 *       left out on purpose so the formula is measured on its own.
 */
import { readFileSync } from "node:fs";

type Stats = {
  appearances: number; goalsAgainst: number; xga: number; saves: number; avgRating: number; tid: number;
};
type P = { pid: number; pos: string; ovr: number; stats: Stats };
type Comp = { compId: number; tier: number; country: string; players: P[] };
type Season = { seed: number; season: number; comps: Comp[] };

const DATA = process.env.DATA ?? "tots-data.json";
const seasons: Season[] = JSON.parse(readFileSync(DATA, "utf8"));
const MIN_APPS = 19;
const OVR_BASE = 76;
const STRENGTH_WEIGHT = 0.05; // WORLD_AWARD_LEAGUE_STRENGTH_WEIGHT

type K = P & { compId: number; tier: number; teamOvr: number; strength: number };

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Every qualified keeper, per season, with his club's outfield quality and his league's strength offset. */
const bySeason: K[][] = seasons.map((s) => {
  const everyone = s.comps.flatMap((c) => c.players);
  const worldMean = everyone.reduce((a, p) => a + p.ovr, 0) / everyone.length;
  const out: K[] = [];
  for (const c of s.comps) {
    const compMean = c.players.reduce((a, p) => a + p.ovr, 0) / c.players.length;
    const strength = (compMean - worldMean) * STRENGTH_WEIGHT;
    const outfieldByTid = new Map<number, number[]>();
    for (const p of c.players) {
      if (p.pos === "GK") continue;
      const list = outfieldByTid.get(p.stats.tid) ?? [];
      list.push(p.ovr);
      outfieldByTid.set(p.stats.tid, list);
    }
    for (const p of c.players) {
      if (p.pos !== "GK" || p.stats.appearances < MIN_APPS) continue;
      const mates = outfieldByTid.get(p.stats.tid) ?? [p.ovr];
      out.push({
        ...p, compId: c.compId, tier: c.tier, strength,
        teamOvr: mates.reduce((a, b) => a + b, 0) / mates.length,
      });
    }
  }
  return out;
});
const allKeepers = bySeason.flat();

// ---------- 1. signals ----------
const g = (k: K) => k.stats.appearances;
const SIGNALS: Record<string, (k: K) => number> = {
  "goals conceded/game": (k) => k.stats.goalsAgainst / g(k),
  "xG faced/game": (k) => k.stats.xga / g(k),
  "saves/game": (k) => k.stats.saves / g(k),
  "save %": (k) => k.stats.saves / Math.max(1, k.stats.saves + k.stats.goalsAgainst),
  "prevented/game": (k) => (k.stats.xga - k.stats.goalsAgainst) / g(k),
  "conceded/xG": (k) => k.stats.goalsAgainst / Math.max(0.1, k.stats.xga),
  "match rating": (k) => k.stats.avgRating,
};
console.log(`${allKeepers.length} qualified keeper-seasons over ${seasons.length} seasons\n`);
console.log("signal                  r with own ovr   r with team's outfield ovr");
const ovrs = allKeepers.map((k) => k.ovr);
const teams = allKeepers.map((k) => k.teamOvr);
console.log(`(own ovr vs team ovr: ${corr(ovrs, teams).toFixed(2)})`);
for (const [name, f] of Object.entries(SIGNALS)) {
  const v = allKeepers.map(f);
  console.log(`${name.padEnd(22)}  ${corr(v, ovrs).toFixed(2).padStart(6)}           ${corr(v, teams).toFixed(2).padStart(6)}`);
}

// ---------- 2. formulas ----------
const ovrTerm = (k: K, w = 0.06) => (k.ovr - OVR_BASE) * w;
const base = (k: K) => k.stats.avgRating + ovrTerm(k);
const savePct = SIGNALS["save %"];
const prevented = SIGNALS["prevented/game"];
const meanSavePct = allKeepers.reduce((a, k) => a + savePct(k), 0) / allKeepers.length;

const FORMULAS: Record<string, (k: K) => number> = {
  "old (season totals)": (k) => k.stats.avgRating + k.stats.saves * 0.035 - k.stats.goalsAgainst * 0.03 + ovrTerm(k),
  "shipped: conceded/game x1.2": (k) => base(k) - 1.2 * (k.stats.goalsAgainst / g(k)),
  "rating + ovr only": base,
  "prevented/game x1": (k) => base(k) + prevented(k),
  "prevented/game x2": (k) => base(k) + 2 * prevented(k),
  "prevented/game x4": (k) => base(k) + 4 * prevented(k),
  "save% x4": (k) => base(k) + 4 * (savePct(k) - meanSavePct),
  "save% x8": (k) => base(k) + 8 * (savePct(k) - meanSavePct),
  "save% x16": (k) => base(k) + 16 * (savePct(k) - meanSavePct),
  "ovr x0.12": (k) => k.stats.avgRating + ovrTerm(k, 0.12),
  "ovr x0.12 + prevented x2": (k) => k.stats.avgRating + ovrTerm(k, 0.12) + 2 * prevented(k),
  "ovr x0.12 + save% x8": (k) => k.stats.avgRating + ovrTerm(k, 0.12) + 8 * (savePct(k) - meanSavePct),
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log("\nformula                        league: best keeper picked  mean rank   world proxy winner rank: median  mean  worst");
for (const [name, f] of Object.entries(FORMULAS)) {
  let leagues = 0, bestPicked = 0, rankSum = 0;
  const worldRanks: number[] = [];
  for (const keepers of bySeason) {
    const byComp = new Map<number, K[]>();
    for (const k of keepers) byComp.set(k.compId, [...(byComp.get(k.compId) ?? []), k]);
    for (const list of byComp.values()) {
      const pick = list.reduce((a, b) => (f(b) > f(a) ? b : a));
      const rank = list.filter((k) => k.ovr > pick.ovr).length + 1;
      leagues++; rankSum += rank;
      if (rank === 1) bestPicked++;
    }
    const winner = keepers.reduce((a, b) => (f(b) + b.strength > f(a) + a.strength ? b : a));
    worldRanks.push(keepers.filter((k) => k.ovr > winner.ovr).length + 1);
  }
  console.log(
    `${name.padEnd(30)} ${((100 * bestPicked) / leagues).toFixed(1).padStart(6)}%              ` +
    `${(rankSum / leagues).toFixed(2)}      ${String(median(worldRanks)).padStart(4)}` +
    `  ${(worldRanks.reduce((a, b) => a + b, 0) / worldRanks.length).toFixed(1).padStart(5)}  ${Math.max(...worldRanks)}`,
  );
}
