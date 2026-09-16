/**
 * Who qualifies for and wins the World Cup, on the world with the Americas
 * against the same world without them.
 *
 * Adding Brazil, Argentina, Mexico and the US took eligible nations from ~44 to
 * ~74 and changed which confederations can fill their places, so this checks
 * the results rather than the field: qualification rates by squad-rating rank,
 * how often a strong nation misses out, and the spread of finalists and winners
 * by nation and confederation.
 *
 * Squads are read once off a freshly generated world and replayed over several
 * cycles (each cycle a different season, so a different draw and different match
 * streams). Players don't age between cycles, so this measures how the format
 * treats a fixed pool, not a dynasty.
 *
 *   SEEDS=1,2,3,4 CYCLES=8 npx tsx scripts/intlOutcomeProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import {
  worldCompetitions, buildCompetitions, worldLeagueSpecs, type Competition,
} from "../src/core/competitions.js";
import { COUNTRY_REGION } from "../src/core/constants.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";
import { buildSquads, confederationOf, summarize } from "../src/core/international/index.js";
import { runQualifying } from "../src/core/international/qualifying.js";
import { runTournament } from "../src/core/international/tournament.js";

const SEEDS = (process.env.SEEDS ?? "1,2,3,4").split(",").map(Number);
const CYCLES = Number(process.env.CYCLES ?? 8);
const WATCH = ["Brazil", "Argentina", "Mexico", "United States"];

interface NationTally {
  rankSum: number;
  worlds: number;
  entered: number;
  qualified: number;
  semi: number;
  final: number;
  won: number;
}

function worlds(): { name: string; comps: Competition[] }[] {
  return [
    { name: "with the Americas", comps: worldCompetitions() },
    {
      name: "Europe only (control)",
      comps: buildCompetitions(worldLeagueSpecs().filter((s) => !COUNTRY_REGION[s.country])),
    },
  ];
}

for (const { name, comps } of worlds()) {
  const tally = new Map<string, NationTally>();
  const t = (n: string) => {
    let x = tally.get(n);
    if (!x) {
      x = { rankSum: 0, worlds: 0, entered: 0, qualified: 0, semi: 0, final: 0, won: 0 };
      tally.set(n, x);
    }
    return x;
  };
  const confWins = new Map<string, number>();
  const confQualified = new Map<string, number>();
  const confEntered = new Map<string, number>();
  const winnerRanks: number[] = [];
  const finalistRanks: number[] = [];
  let topSixteenMisses = 0;
  let tournaments = 0;
  const fieldSizes = new Set<number>();
  const eligibleCounts: number[] = [];

  for (const seed of SEEDS) {
    const t0 = Date.now();
    const league = createLeagueState(SPECTATOR_TID, mulberry32(seed), 0, undefined, comps);
    const squads = buildSquads(league.players);
    eligibleCounts.push(squads.length);
    const rankOf = new Map(squads.map((s, i) => [s.nation, i + 1]));
    for (const s of squads) {
      const x = t(s.nation);
      x.rankSum += rankOf.get(s.nation)!;
      x.worlds++;
    }
    const topSixteen = new Set(squads.slice(0, 16).map((s) => s.nation));

    for (let c = 1; c <= CYCLES; c++) {
      const q = runQualifying(league.players, 4 * c - 3, seed, league.worldCupSize);
      if (!q) continue;
      const { campaign } = q;
      fieldSizes.add(campaign.qualified.length);
      for (const n of campaign.nations) {
        t(n).entered++;
        const conf = confederationOf(n) ?? "?";
        confEntered.set(conf, (confEntered.get(conf) ?? 0) + 1);
      }
      for (const n of campaign.qualified) {
        t(n).qualified++;
        const conf = confederationOf(n) ?? "?";
        confQualified.set(conf, (confQualified.get(conf) ?? 0) + 1);
      }
      for (const n of topSixteen) if (!campaign.qualified.includes(n)) topSixteenMisses++;

      const played = runTournament(campaign.qualified, league.players, 4 * c, seed);
      if (!played) continue;
      const summary = summarize(played.tournament, league.players);
      if (!summary) continue;
      tournaments++;
      const lastRound = Math.max(...summary.knockout.map((k) => k.round));
      for (const k of summary.knockout.filter((k) => k.round === lastRound - 1)) {
        t(k.home).semi++;
        t(k.away).semi++;
      }
      t(summary.champion).final++;
      t(summary.runnerUp).final++;
      t(summary.champion).won++;
      const conf = confederationOf(summary.champion) ?? "?";
      confWins.set(conf, (confWins.get(conf) ?? 0) + 1);
      winnerRanks.push(rankOf.get(summary.champion) ?? 99);
      finalistRanks.push(rankOf.get(summary.champion) ?? 99, rankOf.get(summary.runnerUp) ?? 99);
    }
    console.error(`  [${name}] seed ${seed} done in ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };

  console.log(`\n=== ${name}: ${SEEDS.length} seeds x ${CYCLES} cycles = ${tournaments} World Cups`);
  console.log(`eligible nations per world: ${eligibleCounts.join(", ")}; World Cup size: ${[...fieldSizes].join("/")}`);
  console.log(
    `winner's squad-rating rank: median ${median(winnerRanks)}, top 4 ${pct(winnerRanks.filter((r) => r <= 4).length, winnerRanks.length)}, `
      + `top 8 ${pct(winnerRanks.filter((r) => r <= 8).length, winnerRanks.length)}, worst ${Math.max(...winnerRanks)}`,
  );
  console.log(`finalists' median rank: ${median(finalistRanks)}`);
  console.log(
    `top-16-rated nations failing to qualify: ${(topSixteenMisses / (SEEDS.length * CYCLES)).toFixed(2)} per cycle`,
  );

  console.log("\nby confederation (entrants per cycle, qualified per cycle, World Cups won):");
  const cycles = SEEDS.length * CYCLES;
  for (const conf of [...confEntered.keys()].sort((a, b) => (confEntered.get(b)! - confEntered.get(a)!))) {
    console.log(
      `  ${conf.padEnd(14)} entered ${(confEntered.get(conf)! / cycles).toFixed(1).padStart(5)}  `
        + `qualified ${((confQualified.get(conf) ?? 0) / cycles).toFixed(1).padStart(5)}  `
        + `won ${confWins.get(conf) ?? 0}`,
    );
  }

  console.log("\ntop 24 nations by mean squad-rating rank (qualified / semi-final / final / won, over their entries):");
  const rows = [...tally.entries()]
    .filter(([, x]) => x.worlds > 0)
    .map(([n, x]) => ({ n, rank: x.rankSum / x.worlds, ...x }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 24);
  for (const r of rows) {
    console.log(
      `  ${r.n.padEnd(20)} rank ${r.rank.toFixed(1).padStart(5)}  ${(confederationOf(r.n) ?? "?").padEnd(14)} `
        + `Q ${pct(r.qualified, r.entered).padStart(4)}  SF ${String(r.semi).padStart(3)}  F ${String(r.final).padStart(3)}  W ${String(r.won).padStart(3)}`,
    );
  }

  console.log("\nthe four new league countries:");
  for (const n of WATCH) {
    const x = tally.get(n);
    if (!x || x.worlds === 0) {
      console.log(`  ${n}: not eligible`);
      continue;
    }
    console.log(
      `  ${n.padEnd(14)} rank ${(x.rankSum / x.worlds).toFixed(1)}  Q ${pct(x.qualified, x.entered)}  SF ${x.semi}  F ${x.final}  W ${x.won}`,
    );
  }

  const allWinners = [...tally.entries()].filter(([, x]) => x.won > 0).sort((a, b) => b[1].won - a[1].won);
  console.log(`\nWorld Cup winners: ${allWinners.map(([n, x]) => `${n} ${x.won}`).join(", ")}`);
}
