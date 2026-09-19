/**
 * What the off-roster players in an aged save actually are.
 *
 * Retirement already deletes players from `league.players` outright (offseason
 * step 3), so a save holds NO retired players. Every off-roster player is an
 * unsigned free agent, and that pool is never culled — it just accumulates.
 * This sizes it by age and career-peak ovr so a cull can target players who
 * will realistically never be signed.
 *
 * Reads the cached league from leagueSizeDeepDive.ts (no re-sim).
 */
import { readFileSync, existsSync } from "node:fs";
import type { LeagueStore } from "../src/core/leagueState.js";
import type { Player } from "../src/core/players/types.js";

const cachePath = process.argv[2]
  ?? `${process.env.CLAUDE_JOB_DIR ?? "/tmp"}/tmp/league14.json`;
if (!existsSync(cachePath)) {
  console.error(`No cached league at ${cachePath}. Run leagueSizeDeepDive.ts first.`);
  process.exit(1);
}
const league = JSON.parse(readFileSync(cachePath, "utf8")) as LeagueStore;

const mb = (n: number) => (n / 1e6).toFixed(1).padStart(6);
const size = (v: unknown) => JSON.stringify(v ?? null).length;
const total = size(league);

const onRoster = new Set(league.teams.flatMap((t) => [...t.roster, ...t.academyRoster]));
const pool = league.players.filter((p) => !onRoster.has(p.pid));
const age = (p: Player) => league.season - p.born;
/** Best ovr the player ever reached, from his ratings snapshots. */
const peak = (p: Player) =>
  Math.max(p.ovr, ...(p.recentHist ?? []).map((h) => h.ovr));

console.log(`season ${league.season}, save ${mb(total)} MB`);
console.log(`players ${league.players.length}: ${onRoster.size} on a roster, ${pool.length} unsigned free agents\n`);

console.log("free-agent pool by age");
const ageBuckets: [string, (p: Player) => boolean][] = [
  ["<= 19", (p) => age(p) <= 19],
  ["20-23", (p) => age(p) >= 20 && age(p) <= 23],
  ["24-27", (p) => age(p) >= 24 && age(p) <= 27],
  ["28-31", (p) => age(p) >= 28 && age(p) <= 31],
  ["32+   ", (p) => age(p) >= 32],
];
for (const [label, pred] of ageBuckets) {
  const g = pool.filter(pred);
  console.log(`  ${label}  ${String(g.length).padStart(5)} players  ${mb(g.reduce((n, p) => n + size(p), 0))} MB`);
}

console.log("\nfree-agent pool by career-peak ovr");
const ovrBuckets: [string, (p: Player) => boolean][] = [
  ["<= 55", (p) => peak(p) <= 55],
  ["56-60", (p) => peak(p) >= 56 && peak(p) <= 60],
  ["61-65", (p) => peak(p) >= 61 && peak(p) <= 65],
  ["66-70", (p) => peak(p) >= 66 && peak(p) <= 70],
  ["71+  ", (p) => peak(p) >= 71],
];
for (const [label, pred] of ovrBuckets) {
  const g = pool.filter(pred);
  console.log(`  ${label}  ${String(g.length).padStart(5)} players  ${mb(g.reduce((n, p) => n + size(p), 0))} MB`);
}

// What the user proposed, adapted to reality: cull unsigned free agents whose
// career peak never cleared a threshold.
console.log("\nif we delete unsigned free agents who never peaked above...");
for (const t of [60, 62, 65, 68]) {
  const g = pool.filter((p) => peak(p) <= t);
  const bytes = g.reduce((n, p) => n + size(p), 0);
  console.log(
    `  ovr ${t}: ${String(g.length).padStart(5)} players  -${mb(bytes)} MB  (${((bytes / total) * 100).toFixed(1)}% of save)`,
  );
}

// Referential integrity: these pids are referenced elsewhere in the save.
const referenced = new Map<string, Set<number>>();
const add = (k: string, pid: number) => {
  if (!referenced.has(k)) referenced.set(k, new Set());
  referenced.get(k)!.add(pid);
};
for (const t of league.transfers) add("transfers", t.pid);
for (const e of league.newsEvents as unknown as { pid?: number }[]) {
  if (typeof e.pid === "number") add("newsEvents", e.pid);
}
for (const h of league.seasonHistory) {
  for (const aw of Object.values(h.awards ?? {}) as unknown as Record<string, unknown>[]) {
    const walk = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.pid === "number") add("seasonHistory.awards", o.pid);
        Object.values(o).forEach(walk);
      }
    };
    walk(aw);
  }
}
for (const cup of [...league.cupHistory, ...(league.cup ? [league.cup] : [])]) {
  for (const tie of cup.ties) {
    if (!tie.boxScore) continue;
    for (const side of [tie.boxScore.home, tie.boxScore.away]) {
      for (const l of side) add("cupHistory.ties", l.pid);
    }
  }
}

console.log("\nhow many of the ovr<=65 cull would still be referenced elsewhere");
const culled = new Set(pool.filter((p) => peak(p) <= 65).map((p) => p.pid));
for (const [k, pids] of referenced) {
  let hits = 0;
  for (const pid of pids) if (culled.has(pid)) hits++;
  console.log(`  ${k.padEnd(22)} ${String(hits).padStart(5)} of ${String(pids.size).padStart(6)} referenced pids would dangle`);
}
