/**
 * Dump every awards-eligible player season, plus the season's award results,
 * to a JSON file, so Team of the Season formulas can be tried offline in
 * seconds instead of re-simulating a world for every variant.
 *
 * Players are grouped by the competition of the club whose roster they are on
 * when the offseason scores the awards — the same rule awardsByCompetition
 * applies — and carry the ovr they played the season with.
 *
 *   OUT=/tmp/tots.json SEASONS=5 SEEDS=1,2 npx tsx scripts/totsDataDump.ts
 */
import { writeFileSync } from "node:fs";
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { statsFor, ovrDuringSeason } from "../src/core/awards.js";

const SEASONS = Number(process.env.SEASONS ?? 5);
const SEEDS = (process.env.SEEDS ?? "1,2").split(",").map(Number);
const OUT = process.env.OUT ?? "tots-data.json";

const out: unknown[] = [];

for (const seed of SEEDS) {
  const rng = mulberry32(seed);
  let league = createLeagueState(0, rng);
  for (let s = 0; s < SEASONS; s++) {
    while (league.phase !== "offseason") league = simThrough(league, "season", rng);
    const before = league;
    league = simOffseason(league, rng);
    const entry = league.seasonHistory.at(-1)!;
    const season = entry.season;
    const comps = before.competitions.map((comp) => {
      const roster = new Set(before.teams.filter((t) => t.compId === comp.id).flatMap((t) => t.roster));
      const players = before.players
        .filter((p) => roster.has(p.pid))
        .map((p) => ({ p, st: statsFor(p, season) }))
        .filter((x) => x.st && x.st.appearances > 0)
        .map(({ p, st }) => ({
          pid: p.pid, pos: p.pos, ovr: ovrDuringSeason(p, season), stats: st,
        }));
      const a = entry.awards[comp.id];
      return {
        compId: comp.id, tier: comp.tier, country: comp.country, players,
        poty: a?.playerOfSeasonPid ?? null, goldenBoot: a?.goldenBootPid ?? null,
        shippedXI: a?.teamOfSeason ?? [],
      };
    });
    out.push({
      seed, season, comps,
      ballonDOr: (entry.world?.ballonDOr ?? []).slice(0, 3).map((e) => e.pid),
      worldXI: entry.world?.worldTeamOfYear ?? [],
      goalkeeperOfYear: entry.world?.goalkeeperOfYear?.[0]?.pid ?? null,
      defenderOfYear: entry.world?.defenderOfYear?.[0]?.pid ?? null,
    });
    writeFileSync(OUT, JSON.stringify(out));
    console.error(`seed ${seed} season ${season} dumped`);
  }
}
console.error(`wrote ${OUT}`);
