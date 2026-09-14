/**
 * Try Team of the Season formulas offline against a dump from
 * scripts/totsDataDump.ts. Seconds per run, so formula variants can be compared
 * on identical seasons.
 *
 *   DATA=/tmp/tots.json npx tsx scripts/totsFormulaEval.ts
 *
 * Prints two things:
 *  1. Per position, how each stat (per appearance) correlates with the ovr the
 *     player played the season at. A stat that rises with ovr is evidence of
 *     quality; one that falls with it is mostly evidence of a busy defence.
 *  2. Per formula set: how often the league Player of the Season, the Golden
 *     Boot and the Ballon d'Or winner/top-3 make their league's XI, the XI's
 *     mean ovr, and how often each XI slot went to the best-ovr qualified
 *     player at that position.
 */
import { readFileSync } from "node:fs";

type Pos = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "W" | "ST";
type Stats = {
  appearances: number; goals: number; assists: number; shots: number; shotsOnTarget: number;
  xg: number; goalsAgainst: number; xga: number; saves: number; tackles: number;
  interceptions: number; passes: number; passesCompleted: number; crosses: number;
  foulsCommitted: number; yellowCards: number; redCards: number; minutesPlayed: number;
  avgRating: number;
};
type P = { pid: number; pos: Pos; ovr: number; stats: Stats };
type Comp = {
  compId: number; tier: number; country: string; players: P[];
  poty: number | null; goldenBoot: number | null; shippedXI: (number | null)[];
};
type Season = { seed: number; season: number; comps: Comp[]; ballonDOr: number[] };

const DATA = process.env.DATA ?? "tots-data.json";
const seasons: Season[] = JSON.parse(readFileSync(DATA, "utf8"));
/**
 * The XI shape. Defaults to the shipped TOTS_SLOTS; pass SLOTS=GK,CB,CB,... to
 * try another (e.g. two strikers) on the same data.
 */
const SLOTS: Pos[] = (process.env.SLOTS?.split(",") as Pos[] | undefined)
  ?? ["GK", "CB", "CB", "FB", "FB", "DM", "CM", "AM", "W", "W", "ST"];
const POSITIONS: Pos[] = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];
const MIN_APPS = 19;
const OVR_BASE = 76;

// ---------- 1. what tracks quality at each position ----------
function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
const perApp: Record<string, (s: Stats) => number> = {
  rating: (s) => s.avgRating,
  goals: (s) => s.goals / s.appearances,
  assists: (s) => s.assists / s.appearances,
  sot: (s) => s.shotsOnTarget / s.appearances,
  xg: (s) => s.xg / s.appearances,
  gMinusXg: (s) => (s.goals - s.xg) / s.appearances,
  def: (s) => (s.tackles + s.interceptions) / s.appearances,
  passPct: (s) => (s.passes ? s.passesCompleted / s.passes : 0),
  crosses: (s) => s.crosses / s.appearances,
  saves: (s) => s.saves / s.appearances,
  ga: (s) => s.goalsAgainst / s.appearances,
  prevented: (s) => (s.xga - s.goalsAgainst) / s.appearances,
  cards: (s) => (s.yellowCards + 3 * s.redCards) / s.appearances,
};
if (!process.env.SKIP_CORR) {
  console.log("per-appearance stat vs ovr, qualified players (r, then mean)");
  for (const pos of POSITIONS) {
    const pool = seasons.flatMap((s) => s.comps.filter((c) => c.tier === 1).flatMap((c) => c.players))
      .filter((p) => p.pos === pos && p.stats.appearances >= MIN_APPS);
    const ovr = pool.map((p) => p.ovr);
    const cells = Object.entries(perApp).map(([k, f]) => {
      const v = pool.map((p) => f(p.stats));
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return `${k} ${corr(v, ovr).toFixed(2)}/${mean.toFixed(2)}`;
    });
    console.log(`${pos} n=${pool.length}  ${cells.join("  ")}`);
  }
}

// ---------- 2. formula sets ----------
type Formula = (p: P) => number;
const ovrTerm = (p: P, w = 0.06) => (p.ovr - OVR_BASE) * w;

const GROUP: Record<Pos, "GK" | "DEF" | "MID" | "FWD"> = {
  GK: "GK", CB: "DEF", FB: "DEF", DM: "MID", CM: "MID", AM: "FWD", W: "FWD", ST: "FWD",
};
const shipped: Formula = (p) => {
  const g = GROUP[p.pos];
  const s = p.stats;
  const gw = { FWD: 0.06, MID: 0.08, DEF: 0.11, GK: 0.3 }[g];
  const aw = { FWD: 0.04, MID: 0.055, DEF: 0.07, GK: 0.2 }[g];
  const tw = { FWD: 0.01, MID: 0.02, DEF: 0.03, GK: 0 }[g];
  const gap = { FWD: 0, MID: 0.006, DEF: 0.02, GK: 0.03 }[g];
  return s.avgRating + s.goals * gw + s.assists * aw + (s.tackles + s.interceptions) * tw
    + (g === "GK" ? s.saves * 0.035 : 0) - s.goalsAgainst * gap + ovrTerm(p);
};
const poty: Formula = (p) => {
  const g = GROUP[p.pos];
  const s = p.stats;
  return s.avgRating + s.goals * { FWD: 0.08, MID: 0.1, DEF: 0.14, GK: 0.22 }[g]
    + s.assists * { FWD: 0.05, MID: 0.07, DEF: 0.09, GK: 0.16 }[g] + ovrTerm(p);
};

/** Per-position weights. `def` and `ga` are per appearance, so volume is not rewarded. */
type W = Partial<Record<"goals" | "assists" | "defPerApp" | "gaPerApp" | "savesPerApp" | "preventedPerApp" | "ovr", number>>;
function perPosition(table: Record<Pos, W>): Formula {
  return (p) => {
    const w = table[p.pos];
    const s = p.stats;
    const n = s.appearances;
    return s.avgRating
      + s.goals * (w.goals ?? 0)
      + s.assists * (w.assists ?? 0)
      + ((s.tackles + s.interceptions) / n) * (w.defPerApp ?? 0)
      - (s.goalsAgainst / n) * (w.gaPerApp ?? 0)
      + (s.saves / n) * (w.savesPerApp ?? 0)
      + ((s.xga - s.goalsAgainst) / n) * (w.preventedPerApp ?? 0)
      + ovrTerm(p, w.ovr ?? 0.06);
  };
}

const SETS: Record<string, Formula> = {
  shipped,
  "poty everywhere": poty,
};

// Candidate sets live in scripts/totsFormulas.ts so they can be edited without
// touching this harness.
const extra = await import("./totsFormulas.js");
Object.assign(SETS, extra.FORMULAS(perPosition as never));

function pickXI(players: P[], f: Formula): (number | null)[] {
  const used = new Set<number>();
  return SLOTS.map((slot) => {
    let best: P | null = null;
    let bestScore = -Infinity;
    for (const p of players) {
      if (p.pos !== slot || used.has(p.pid)) continue;
      const sc = (p.stats.appearances >= MIN_APPS ? 1000 : 0) + f(p);
      if (sc > bestScore) { best = p; bestScore = sc; }
    }
    if (!best) return null;
    used.add(best.pid);
    return best.pid;
  });
}

const missLines: string[] = [];
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const fmt = (m: Map<string, number>) =>
  [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" ") || "none";

console.log("\nformula set               POTY in XI   Golden Boot  BdO winner  BdO top3   XI mean ovr  top-ovr slots  changed vs shipped");
for (const [name, f] of Object.entries(SETS)) {
  let potyN = 0, potyY = 0, gbN = 0, gbY = 0, bdoN = 0, bdoY = 0, b3N = 0, b3Y = 0;
  const potyMiss = new Map<string, number>();
  const gbMiss = new Map<string, number>();
  const bdoMiss = new Map<string, number>();
  let ovrSum = 0, ovrN = 0, topN = 0, topY = 0, changed = 0, shippedPlaces = 0;
  for (const season of seasons) {
    const xiByComp = new Map<number, (number | null)[]>();
    for (const c of season.comps) {
      const xi = pickXI(c.players, f);
      xiByComp.set(c.compId, xi);
      const byPid = new Map(c.players.map((p) => [p.pid, p]));
      const posOf = (pid: number) => byPid.get(pid)?.pos ?? "?";
      if (c.poty !== null) {
        potyN++;
        if (xi.includes(c.poty)) potyY++; else bump(potyMiss, posOf(c.poty));
      }
      if (c.goldenBoot !== null) {
        gbN++;
        if (xi.includes(c.goldenBoot)) gbY++; else bump(gbMiss, posOf(c.goldenBoot));
      }
      const baseline = pickXI(c.players, shipped);
      for (const pid of xi) {
        if (pid === null) continue;
        ovrSum += byPid.get(pid)!.ovr; ovrN++;
        shippedPlaces++;
        if (!baseline.includes(pid)) changed++;
      }
      // best-ovr check per position: the slot count at that position vs the top-k by ovr
      for (const pos of POSITIONS) {
        const k = SLOTS.filter((x) => x === pos).length;
        const qualified = c.players.filter((p) => p.pos === pos && p.stats.appearances >= MIN_APPS);
        if (qualified.length < k) continue;
        const topOvr = new Set([...qualified].sort((a, b) => b.ovr - a.ovr).slice(0, k).map((p) => p.pid));
        for (const pid of xi) {
          if (pid !== null && byPid.get(pid)!.pos === pos) { topN++; if (topOvr.has(pid)) topY++; }
        }
      }
    }
    season.ballonDOr.forEach((pid, i) => {
      const comp = season.comps.find((c) => c.players.some((p) => p.pid === pid));
      if (!comp) return;
      const inXI = xiByComp.get(comp.compId)!.includes(pid);
      if (i === 0) {
        bdoN++;
        if (inXI) bdoY++;
        else bump(bdoMiss, comp.players.find((p) => p.pid === pid)!.pos);
      }
      b3N++; if (inXI) b3Y++;
    });
  }
  missLines.push(`${name.padEnd(24)}  POTY: ${fmt(potyMiss)} | Golden Boot: ${fmt(gbMiss)} | BdO winner: ${fmt(bdoMiss)}`);
  const pct = (y: number, n: number) => `${((100 * y) / n).toFixed(1)}%`.padStart(6);
  console.log(
    `${name.padEnd(24)}  ${pct(potyY, potyN)}       ${pct(gbY, gbN)}      ${bdoY}/${bdoN}`.padEnd(64) +
    `${b3Y}/${b3N}      ${(ovrSum / ovrN).toFixed(2)}        ${pct(topY, topN)}         ${changed}/${shippedPlaces}`,
  );
}
console.log("\nmisses by position");
for (const line of missLines) console.log(line);
