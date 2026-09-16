/**
 * What happens to national teams over a real dynasty.
 *
 * `intlOutcomeProbe.ts` replays one generated pool of players over several
 * World Cups, so it measures the format and not time: nobody ages, retires or
 * is replaced. This runs real seasons (simThrough + simOffseason, the same
 * seeded streams `weakLeaguesAudit.ts` uses) and samples the international
 * picture after every offseason:
 *   - eligible nations, by confederation, and the World Cup size "auto" would
 *     draw from that count (the risk being a default save flipping 32 -> 48)
 *   - every nation's squad rating and rank, and each confederation's top-5 mean
 *   - where the watch nations' named squads play (own country, Europe, the
 *     Americas, unsigned)
 *   - every World Cup, confederation cup and qualifying campaign that finished
 *
 * Spectator worlds, so no unmanaged user club rots in the tables.
 *
 * Resumable, because long runs are killed when backgrounded: each invocation
 * sims at most CHUNK seasons and saves the league and the samples to STATE_DIR.
 * Re-run the same command until it prints "done". Chunking cannot change the
 * result: every season draws from mulberry32(seed*1000+s) / (seed*2000+s).
 *
 *   WORLD=americas SEED=1 SEASONS=24 CHUNK=6 npx tsx scripts/intlDynastyProbe.ts
 *   WORLD=europe   SEED=1 ...                                    (control)
 *   REPORT=americas-s1,americas-s2,europe-s1 npx tsx scripts/intlDynastyProbe.ts
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { join } from "node:path";
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import {
  worldCompetitions, buildCompetitions, worldLeagueSpecs, competitionOf, competitionRegion,
} from "../src/core/competitions.js";
import { COUNTRY_REGION } from "../src/core/constants.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";
import { buildSquads, confederationOf } from "../src/core/international/index.js";
import { nationPools } from "../src/core/international/squads.js";
import { resolveWorldCupSize } from "../src/core/international/format.js";
import type { IntlTournamentSummary } from "../src/core/international/types.js";

type WorldCupSetting = NonNullable<Parameters<typeof createLeagueState>[8]>;

const WORLD = process.env.WORLD ?? "americas";
const SEED = Number(process.env.SEED ?? 1);
const SEASONS = Number(process.env.SEASONS ?? 24);
const CHUNK = Number(process.env.CHUNK ?? 6);
const WC_RAW = process.env.WC ?? "auto";
const WC = (WC_RAW === "auto" ? "auto" : Number(WC_RAW)) as WorldCupSetting;
const DIR = process.env.STATE_DIR ?? join(process.cwd(), ".intl-dynasty");
const REPORT = process.env.REPORT?.split(",").map((s) => s.trim()).filter(Boolean);

const WATCH = [
  "Brazil", "Argentina", "Mexico", "United States", "Canada", "Uruguay", "Colombia",
  "Japan", "England", "France", "Spain", "Germany", "Portugal", "Netherlands",
];

interface TournamentRow {
  name: string;
  confederation?: string;
  season: number;
  size: number;
  champion: string;
  runnerUp: string;
  semis: string[];
  fieldByConf: Record<string, number>;
}

interface WatchRow {
  pool: number;
  rostered: number;
  rank: number | null;
  rating: number | null;
  home: number;
  europe: number;
  americas: number;
  free: number;
}

interface Sample {
  /** 0 = generation; N = after season N's offseason. */
  season: number;
  eligible: number;
  eligibleByConf: Record<string, number>;
  autoWorldCupSize: number | null;
  ranks: [string, number][];
  confTop5: Record<string, number>;
  /** Share of the 32 strongest squads' named players signed to clubs in the Americas / unsigned. */
  top32AtAmericasClubs: number;
  top32Unsigned: number;
  watch: Record<string, WatchRow>;
  worldCups: TournamentRow[];
  confCups: TournamentRow[];
  qualifying: { season: number; entered: number; size: number; qualifiedByConf: Record<string, number> }[];
  secs: number;
}

interface RunState {
  samples: Sample[];
  cursor: { h: number; c: number; q: number };
  done: number;
}

const count = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
};
const conf = (n: string) => confederationOf(n) ?? "?";

function tournamentRow(s: IntlTournamentSummary): TournamentRow {
  const total = s.knockout.reduce((m, k) => Math.max(m, k.round + 1), 0);
  const semis = total >= 2
    ? [...new Set(s.knockout.filter((k) => k.round === total - 2).flatMap((k) => [k.home, k.away]))]
    : [];
  return {
    name: s.name, confederation: s.confederation, season: s.season, size: s.field.length,
    champion: s.champion, runnerUp: s.runnerUp, semis, fieldByConf: count(s.field.map(conf)),
  };
}

function measure(league: LeagueStore, season: number, state: RunState, secs: number): Sample {
  const clubs = new Map<number, { country: string; region: string }>();
  for (const t of league.teams) {
    const comp = competitionOf(league.competitions, t.compId);
    const info = { country: comp.country, region: competitionRegion(comp) };
    for (const pid of t.roster) clubs.set(pid, info);
    for (const pid of t.academyRoster ?? []) clubs.set(pid, info);
  }
  const squads = buildSquads(league.players);
  const pools = nationPools(league.players);
  const rankOf = new Map(squads.map((s, i) => [s.nation, i + 1]));

  const byConf = new Map<string, number[]>();
  for (const s of squads) {
    const k = conf(s.nation);
    byConf.set(k, [...(byConf.get(k) ?? []), s.rating]);
  }
  const confTop5: Record<string, number> = {};
  for (const [k, rs] of byConf) {
    const top = rs.slice(0, 5);
    confTop5[k] = top.reduce((a, b) => a + b, 0) / top.length;
  }

  let named = 0, atAmericas = 0, unsigned = 0;
  for (const s of squads.slice(0, 32)) {
    for (const pid of s.pids) {
      named++;
      const club = clubs.get(pid);
      if (!club) unsigned++;
      else if (club.region === "americas") atAmericas++;
    }
  }

  const watch: Record<string, WatchRow> = {};
  for (const nation of WATCH) {
    const pool = pools.get(nation) ?? [];
    const squad = squads.find((s) => s.nation === nation);
    const row: WatchRow = {
      pool: pool.length,
      rostered: pool.filter((p) => clubs.has(p.pid)).length,
      rank: rankOf.get(nation) ?? null,
      rating: squad ? Math.round(squad.rating * 10) / 10 : null,
      home: 0, europe: 0, americas: 0, free: 0,
    };
    for (const pid of squad?.pids ?? []) {
      const club = clubs.get(pid);
      if (!club) row.free++;
      else {
        if (club.country === nation) row.home++;
        if (club.region === "americas") row.americas++;
        else row.europe++;
      }
    }
    watch[nation] = row;
  }

  const intl = league.international;
  const worldCups = intl.history.slice(state.cursor.h).map(tournamentRow);
  const confCups = intl.confederationCupHistory.slice(state.cursor.c).map(tournamentRow);
  const qualifying = intl.qualifyingHistory.slice(state.cursor.q).map((q) => ({
    season: q.season, entered: q.entered, size: q.qualified.length,
    qualifiedByConf: count(q.qualified.map(conf)),
  }));
  state.cursor = {
    h: intl.history.length, c: intl.confederationCupHistory.length, q: intl.qualifyingHistory.length,
  };

  return {
    season,
    eligible: squads.length,
    eligibleByConf: count(squads.map((s) => conf(s.nation))),
    autoWorldCupSize: resolveWorldCupSize("auto" as WorldCupSetting, squads.length),
    ranks: squads.map((s) => [s.nation, Math.round(s.rating * 10) / 10]),
    confTop5,
    top32AtAmericasClubs: named ? atAmericas / named : 0,
    top32Unsigned: named ? unsigned / named : 0,
    watch,
    worldCups,
    confCups,
    qualifying,
    secs,
  };
}

function competitionsFor(world: string) {
  if (world === "americas") return worldCompetitions();
  if (world === "europe") return buildCompetitions(worldLeagueSpecs().filter((s) => !COUNTRY_REGION[s.country]));
  throw new Error(`WORLD must be "americas" or "europe"; got "${world}"`);
}

function run(): void {
  mkdirSync(DIR, { recursive: true });
  const name = `${WORLD}-s${SEED}`;
  // The league is saved with v8.serialize, not JSON: an 898-club save grows
  // ~20MB a season and a JSON string near 500MB hits V8's string length cap.
  const leaguePath = join(DIR, `${name}.league.v8`);
  const legacyJsonPath = join(DIR, `${name}.league.json`);
  const statePath = join(DIR, `${name}.metrics.json`);

  let league: LeagueStore;
  let state: RunState;
  if ((existsSync(leaguePath) || existsSync(legacyJsonPath)) && existsSync(statePath)) {
    const t0 = Date.now();
    league = existsSync(leaguePath)
      ? (deserialize(readFileSync(leaguePath)) as LeagueStore)
      : (JSON.parse(readFileSync(legacyJsonPath, "utf8")) as LeagueStore);
    state = JSON.parse(readFileSync(statePath, "utf8")) as RunState;
    console.error(`[${name}] resumed after season ${state.done} (${((Date.now() - t0) / 1000).toFixed(1)}s load)`);
  } else {
    const t0 = Date.now();
    league = createLeagueState(
      SPECTATOR_TID, mulberry32(SEED), 0, undefined, competitionsFor(WORLD), true, null, "random", WC,
    );
    state = { samples: [], cursor: { h: 0, c: 0, q: 0 }, done: 0 };
    state.samples.push(measure(league, 0, state, (Date.now() - t0) / 1000));
    console.error(`[${name}] generated: ${league.teams.length} clubs, ${state.samples[0].eligible} eligible nations`);
  }

  const stop = Math.min(SEASONS, state.done + CHUNK);
  for (let s = state.done; s < stop; s++) {
    const t0 = Date.now();
    const seasonRng = mulberry32(SEED * 1000 + s);
    league = simThrough(league, "season", seasonRng);
    // simThrough can pause before a final; simOffseason silently no-ops on any
    // phase but "offseason". Same guard as weakLeaguesAudit.
    for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
      if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish (phase ${league.phase})`);
      league = simThrough(league, "season", seasonRng);
    }
    league = simOffseason(league, mulberry32(SEED * 2000 + s));
    const secs = (Date.now() - t0) / 1000;
    state.samples.push(measure(league, s + 1, state, secs));
    state.done = s + 1;
    const buf = serialize(league);
    writeFileSync(leaguePath, buf);
    if (existsSync(legacyJsonPath)) unlinkSync(legacyJsonPath);
    writeFileSync(statePath, JSON.stringify(state));
    const last = state.samples[state.samples.length - 1];
    const wc = last.worldCups.map((w) => `${w.name}: ${w.champion}`).join("; ");
    console.error(
      `[${name}] season ${s + 1} ${secs.toFixed(0)}s, eligible ${last.eligible}, save ${(buf.length / 1e6).toFixed(0)}MB, `
        + `heap ${(process.memoryUsage().heapUsed / 1e9).toFixed(2)}GB${wc ? `, ${wc}` : ""}`,
    );
  }
  console.log(state.done >= SEASONS ? `[${name}] done (${state.done} seasons)` : `[${name}] paused at season ${state.done}; run again`);
}

// ---------------------------------------------------------------- report

function report(names: string[]): void {
  const runs = names.map((n) => ({
    name: n,
    state: JSON.parse(readFileSync(join(DIR, `${n}.metrics.json`), "utf8")) as RunState,
  }));
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  const checkpoints = (st: RunState) => st.samples.filter((s) => s.season % 4 === 0);

  console.log("\n== Eligible nations (by confederation) and the World Cup size 'auto' would draw ==");
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    for (const s of checkpoints(state)) {
      const confs = Object.entries(s.eligibleByConf).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(`  s${String(s.season).padStart(2)}  ${String(s.eligible).padStart(3)} eligible -> auto ${s.autoWorldCupSize}   (${confs})`);
    }
    const all = state.samples.map((s) => s.eligible);
    console.log(`  range over every season: ${Math.min(...all)}-${Math.max(...all)}`);
  }

  console.log("\n== Confederation strength: mean squad rating of its top 5 nations ==");
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    const confs = Object.keys(state.samples[0].confTop5).sort();
    console.log(`  season ${confs.map((c) => c.slice(0, 13).padStart(14)).join("")}`);
    for (const s of checkpoints(state)) {
      console.log(`  s${String(s.season).padStart(4)} ${confs.map((c) => (s.confTop5[c]?.toFixed(1) ?? "-").padStart(14)).join("")}`);
    }
  }

  console.log("\n== Watch nations: rank / squad rating [squad players at home clubs, in Europe, in the Americas, unsigned] ==");
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    const cps = checkpoints(state);
    console.log(`  ${"".padEnd(14)}${cps.map((s) => `s${s.season}`.padStart(22)).join("")}`);
    for (const nation of WATCH) {
      const cells = cps.map((s) => {
        const w = s.watch[nation];
        if (!w || w.rank == null) return `pool ${w?.pool ?? 0}, not eligible`.padStart(22);
        return `#${w.rank} ${w.rating} [${w.home}/${w.europe}/${w.americas}/${w.free}]`.padStart(22);
      });
      console.log(`  ${nation.padEnd(14)}${cells.join("")}`);
    }
    console.log(`  top-32 squads' players at Americas clubs: ${cps.map((s) => pct(s.top32AtAmericasClubs)).join(" -> ")}; unsigned: ${cps.map((s) => pct(s.top32Unsigned)).join(" -> ")}`);
  }

  console.log("\n== Rating at #1 / #16 / #32 / #48 / last ==");
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    for (const s of checkpoints(state)) {
      const at = (i: number) => (s.ranks[i - 1]?.[1]?.toFixed(1) ?? "-").padStart(6);
      console.log(`  s${String(s.season).padStart(2)} ${at(1)} ${at(16)} ${at(32)} ${at(48)} ${(s.ranks[s.ranks.length - 1]?.[1].toFixed(1) ?? "-").padStart(6)}   top 5: ${s.ranks.slice(0, 5).map((r) => r[0]).join(", ")}`);
    }
  }

  console.log("\n== World Cups ==");
  const confWins = new Map<string, Map<string, number>>();
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    const wins = new Map<string, number>();
    for (const s of state.samples) {
      for (const w of s.worldCups) {
        const fb = Object.entries(w.fieldByConf).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(0, 3)} ${v}`).join(" ");
        console.log(`  s${w.season} (${w.size}) ${w.champion} (${conf(w.champion)}) beat ${w.runnerUp}; SF ${w.semis.join(", ")}  | field: ${fb}`);
        wins.set(conf(w.champion), (wins.get(conf(w.champion)) ?? 0) + 1);
      }
    }
    confWins.set(name, wins);
    console.log(`  wins by confederation: ${[...wins].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }

  console.log("\n== Qualifying: places won by confederation ==");
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    for (const s of state.samples) {
      for (const q of s.qualifying) {
        console.log(`  s${q.season} ${q.entered} entered for ${q.size}: ${Object.entries(q.qualifiedByConf).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      }
    }
  }

  console.log("\n== Confederation cups ==");
  for (const { name, state } of runs) {
    console.log(`\n${name}`);
    for (const s of state.samples) {
      for (const c of s.confCups) {
        console.log(`  s${c.season} ${c.name.padEnd(20)} (${String(c.size).padStart(2)}) ${c.champion} beat ${c.runnerUp}`);
      }
    }
  }
}

if (REPORT) report(REPORT);
else run();
