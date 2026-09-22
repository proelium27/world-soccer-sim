/**
 * Does a squad's OVR predict its results, and which positions' OVR actually
 * buys points? Plays every competition's double round robin on a fixed set of
 * squads (no progression, no transfers, no injuries), and reports:
 *
 *   - r(xi OVR, points per game) within each competition, averaged;
 *   - a pooled regression of within-competition z(ppg) on each position group's
 *     z(mean OVR);
 *   - pts38PerOvrPoint: points per 38 games bought by +1 OVR on ONE starter at
 *     each position. This is the number the composite group weights in
 *     core/composites.ts were calibrated against — roughly equal across the
 *     outfield positions means OVR means the same thing everywhere;
 *   - goals/match, home-win and draw rate, champion points per 38 games.
 *
 * Measured noise: the per-position values move ~±0.02 between sim seeds.
 *
 * Usage (SAVE is a slim {competitions, teams, players} JSON pulled from a save):
 *   SOURCE=gen|save SAVE=path REPS=4 SEED=1 FINE=1 ALL_TIERS=1 npx tsx scripts/deadAttrProbe.ts
 */
import { readFileSync } from "node:fs";
import { mulberry32, hashInts } from "../src/engine/rng.js";
import { simMatchDetailed } from "../src/engine/matchSim.js";
import { leagueMatchData } from "../src/core/league/composites.js";
import { doubleRoundRobin } from "../src/core/schedule.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";

const REPS = Number(process.env.REPS ?? 2);
const SOURCE = process.env.SOURCE ?? "gen";
const SEED = Number(process.env.SEED ?? 1);
const LABEL = process.env.LABEL ?? "current";

type AnyTeam = { tid: number; compId: number; roster: number[]; formation?: string; starters?: number[] | null; name: string };
let competitions: { id: number; tier: number }[];
let teams: AnyTeam[];
let players: any[];
if (SOURCE === "save") {
  const w = JSON.parse(readFileSync(process.env.SAVE!, "utf8"));
  competitions = w.competitions;
  teams = w.teams;
  players = w.players;
} else {
  const l = createLeagueState(SPECTATOR_TID, mulberry32(SEED), 1);
  competitions = l.competitions;
  teams = l.teams.map((t) => ({ ...t, starters: null }));
  players = l.players;
}
players = players.map((p) => ({ ...p, injury: undefined, suspension: undefined }));
const byPid = new Map(players.map((p) => [p.pid, p]));

const GROUPS: Record<string, string[]> = process.env.FINE === "1"
  ? { GK: ["GK"], CB: ["CB"], FB: ["FB"], DM: ["DM"], CM: ["CM"], AM: ["AM"], W: ["W"], ST: ["ST"] }
  : { GK: ["GK"], CB: ["CB"], FB: ["FB"], MID: ["DM", "CM", "AM"], FWD: ["W", "ST"] };
const groupKeys = Object.keys(GROUPS);

let goals = 0, matches = 0, homeWins = 0, draws = 0;
const champ38: number[] = [];
const rs: { r: number; n: number }[] = [];
const rows: { y: number; x: number[] }[] = [];
const rawRows: { y: number; x: number[] }[] = [];

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
const z = (a: number[]) => { const m = mean(a), s = sd(a); return a.map((x) => (x - m) / s); };
const corr = (a: number[], b: number[]) => { const za = z(a), zb = z(b); return mean(za.map((x, i) => x * zb[i])); };

for (const comp of competitions) {
  if (comp.tier !== 1 && process.env.ALL_TIERS !== "1") continue;
  const ct = teams.filter((t) => t.compId === comp.id);
  if (ct.length < 8) continue;
  const data = leagueMatchData({ teams: ct as any, players } as any);
  const pts = new Array(ct.length).fill(0);
  const gp = new Array(ct.length).fill(0);
  for (let rep = 0; rep < REPS; rep++) {
    const rng = mulberry32(hashInts(SEED, comp.id, rep, 777));
    for (const f of doubleRoundRobin(ct.map((_, i) => i))) {
      const h = data[f.home], a = data[f.away];
      const r = simMatchDetailed(rng, h.composites, a.composites, h.xi, a.xi, h.bench, a.bench, {
        recompute: { home: h.recompute, away: a.recompute },
      });
      goals += r.home + r.away; matches++;
      if (r.home > r.away) { homeWins++; pts[f.home] += 3; }
      else if (r.home < r.away) pts[f.away] += 3;
      else { draws++; pts[f.home]++; pts[f.away]++; }
      gp[f.home]++; gp[f.away]++;
    }
  }
  const ppg = pts.map((p, i) => p / gp[i]);
  champ38.push(Math.max(...ppg) * 38);
  const xiOvr = data.map((d) => mean(d.xi.map((p) => p.ovr)));
  rs.push({ r: corr(xiOvr, ppg), n: ct.length });
  // per-group mean OVR of the XI by slot
  const g = groupKeys.map((k) => data.map((d) => {
    const ps = d.xi.filter((p) => GROUPS[k].includes(p.slot));
    return ps.length ? mean(ps.map((p) => byPid.get(p.pid).ovr)) : NaN;
  }));
  const gz = g.map((col) => { const ok = col.map((v) => (Number.isNaN(v) ? mean(col.filter((x) => !Number.isNaN(x))) : v)); return z(ok); });
  const yz = z(ppg);
  ct.forEach((_, i) => rows.push({ y: yz[i], x: gz.map((col) => col[i]) }));
  // Raw units: each group's SUM of OVR over its players (deviation from the
  // competition mean), so the coefficient is points-per-game per +1 OVR on ONE
  // starter in that group. Equal numbers across groups = OVR means the same
  // thing everywhere.
  const gs = groupKeys.map((k) => data.map((d) =>
    d.xi.filter((p) => GROUPS[k].includes(p.slot)).reduce((s, p) => s + byPid.get(p.pid).ovr, 0)));
  const gsc = gs.map((col) => { const m = mean(col); return col.map((v) => v - m); });
  const pm = mean(ppg);
  ct.forEach((_, i) => rawRows.push({ y: ppg[i] - pm, x: gsc.map((col) => col[i]) }));
}

// OLS: y = X b (no intercept, all z-scored)
function ols(rows: { y: number; x: number[] }[]): number[] {
  const k = rows[0].x.length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (const { y, x } of rows) for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * y; }
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => row[k] / A[i][i]);
}
const b = ols(rows);
const braw = ols(rawRows);
const nTot = rs.reduce((s, x) => s + x.n, 0);
const rMean = rs.reduce((s, x) => s + x.r * x.n, 0) / nTot;
console.log(JSON.stringify({
  model: LABEL, w: {}, source: SOURCE, seed: SEED, comps: rs.length, teams: nTot,
  rXiOvrPpg: +rMean.toFixed(3),
  pointsPerSdOvr: Object.fromEntries(groupKeys.map((k, i) => [k, +b[i].toFixed(3)])),
  // points per 38 games per +1 OVR on one starter at that position
  pts38PerOvrPoint: Object.fromEntries(groupKeys.map((k, i) => [k, +(braw[i] * 38).toFixed(2)])),
  goalsPerMatch: +(goals / matches).toFixed(3),
  homeWin: +(homeWins / matches).toFixed(3),
  draw: +(draws / matches).toFixed(3),
  champPts38: +mean(champ38).toFixed(1),
}));
