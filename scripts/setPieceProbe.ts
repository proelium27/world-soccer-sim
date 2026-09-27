/**
 * Corners and penalty takers on real simmed seasons.
 *
 * Corners: real top-flight football averages ~10 a match (~5 a side), with a
 * goalless-corners match almost unheard of and the side on top winning more.
 * Penalties: a real club has one regular taker, so the share of a club's
 * penalties taken by its most-used taker should sit near 1.
 *
 * SEASONS=2 npx tsx scripts/setPieceProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";

const SEASONS = Number(process.env.SEASONS ?? 2);

let matches = 0;
let corners = 0;
let zeroCornerMatches = 0;
let zeroCornerSides = 0;
let cornerHeaders = 0;
let goals = 0;
let cornerGoals = 0;
let shots = 0;
const hist = new Map<number, number>();
// Corners for the side with more shots vs fewer, when they differ.
let moreShotsCorners = 0;
let fewerShotsCorners = 0;
let unequal = 0;
// Penalty takers per team (keyed by the first pid named in a side's lineup
// set, approximated by team index in the season's match list).
const takersByTeam = new Map<string, Map<number, number>>();

for (let i = 0; i < SEASONS; i++) {
  const s = simSeason(mulberry32(777 + i * 131));
  for (const m of s.matches) {
    matches++;
    const box = m.boxScore;
    const ev = box.events;
    const c = { home: 0, away: 0 };
    const sh = { home: 0, away: 0 };
    ev.forEach((e, at) => {
      if (e.type === "corner") c[e.side]++;
      if (e.type === "goal" || e.type === "shot_saved" || e.type === "shot_blocked" || e.type === "shot_off_target") {
        sh[e.side]++;
        const afterCorner = ev.some(
          (x, k) => k < at && x.clock === e.clock && x.type === "corner" && x.side === e.side,
        );
        if (afterCorner) {
          cornerHeaders++;
          if (e.type === "goal") cornerGoals++;
        }
        if (e.type === "goal") goals++;
      }
      if (e.type === "penalty") {
        const key = `${i}:${m.home}:${m.away}:${e.side}`;
        // Team identity: the tid on that side.
        const tid = e.side === "home" ? m.home : m.away;
        const tk = `${i}:${tid}`;
        void key;
        const map = takersByTeam.get(tk) ?? new Map<number, number>();
        map.set(e.pids[0], (map.get(e.pids[0]) ?? 0) + 1);
        takersByTeam.set(tk, map);
      }
    });
    shots += sh.home + sh.away;
    const total = c.home + c.away;
    corners += total;
    hist.set(total, (hist.get(total) ?? 0) + 1);
    if (total === 0) zeroCornerMatches++;
    if (c.home === 0) zeroCornerSides++;
    if (c.away === 0) zeroCornerSides++;
    if (sh.home !== sh.away) {
      unequal++;
      moreShotsCorners += sh.home > sh.away ? c.home : c.away;
      fewerShotsCorners += sh.home > sh.away ? c.away : c.home;
    }
  }
}

let pens = 0;
let topTakerPens = 0;
let teamsWithPens = 0;
let distinctTakers = 0;
for (const map of takersByTeam.values()) {
  const counts = [...map.values()];
  const n = counts.reduce((a, b) => a + b, 0);
  pens += n;
  topTakerPens += Math.max(...counts);
  teamsWithPens++;
  distinctTakers += map.size;
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
console.log(`matches ${matches}`);
console.log(`corners/match ${(corners / matches).toFixed(2)}  zero-corner matches ${pct(zeroCornerMatches, matches)}  zero-corner sides ${pct(zeroCornerSides, 2 * matches)}`);
console.log(`corner headers/match ${(cornerHeaders / matches).toFixed(3)}  corner goals share ${pct(cornerGoals, goals)}  goals/match ${(goals / matches).toFixed(2)}  shots/match ${(shots / matches).toFixed(1)}`);
console.log(`corners, side with more shots ${(moreShotsCorners / Math.max(1, unequal)).toFixed(2)} vs fewer ${(fewerShotsCorners / Math.max(1, unequal)).toFixed(2)}`);
const keys = [...hist.keys()].sort((a, b) => a - b);
console.log(`histogram ${keys.map((k) => `${k}:${hist.get(k)}`).join(" ")}`);
console.log(`penalties/match ${(pens / matches).toFixed(3)}  top taker share ${pct(topTakerPens, pens)}  distinct takers per team-season ${(distinctTakers / Math.max(1, teamsWithPens)).toFixed(2)}`);
