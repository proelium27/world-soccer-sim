/**
 * What the derived shot locations actually produce on real matches
 * (`ui/matchNarration.ts`, `shotLocation`).
 *
 * The labels are picked to fit each shot's outcome, off real-football tables.
 * Two things can still go wrong and neither shows on a single box score:
 *
 *  1. The MIX drifts from real football — position shading reweights every
 *     outcome row, and the engine's shooters are mostly strikers and wingers.
 *     Targets, top-flight open play: shots ~7 / 55 / 38 (six-yard / box /
 *     outside), goals ~21 / 66 / 13.
 *  2. The HASH misbehaves — the zone roll is a hash of (pid, clock), and
 *     neighbouring clocks feeding a weak mixer could skew it. So this also
 *     prints the share the weights PREDICT for the very same shots beside the
 *     share the rolls DELIVERED; a gap there is the hash, not the tables.
 *
 * SEASONS=2 npx tsx scripts/shotZoneProbe.ts
 */
import { mulberry32, hashInts } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";
import { shotLocation, type ShotOrigin } from "../src/ui/matchNarration.js";
import type { MatchEvent, MatchPosition } from "../src/engine/attribution.js";

const SEASONS = Number(process.env.SEASONS ?? 2);
const SHOTS = new Set(["goal", "shot_saved", "shot_blocked", "shot_off_target"]);
const ZONES = ["close", "box", "outside"] as const;

type Tally = Record<ShotOrigin, number>;
const blank = (): Tally => ({ close: 0, box: 0, outside: 0, penalty: 0, corner: 0, freeKick: 0 });

const all = blank();
const goals = blank();
const byOutcome = new Map<string, Tally>();
const goalsBySlot = new Map<string, Tally>();
const labels = new Map<string, number>();
let shots = 0;

for (let i = 0; i < SEASONS; i++) {
  const s = simSeason(mulberry32(777 + i * 131));
  for (const m of s.matches) {
    const box = m.boxScore;
    const slots = new Map<number, MatchPosition | undefined>();
    for (const l of [...box.home, ...box.away]) slots.set(l.pid, l.slot);
    const events: MatchEvent[] = box.events;
    events.forEach((e, at) => {
      if (!SHOTS.has(e.type)) return;
      const sameTick = events.filter((x) => x.clock === e.clock && x !== e);
      const afterCorner = events.some(
        (x, k) => k < at && x.clock === e.clock && x.type === "corner" && x.side === e.side,
      );
      const slot = slots.get(e.pids[0]);
      const { origin, label } = shotLocation(e, sameTick, slot, afterCorner);
      shots++;
      all[origin]++;
      labels.set(label, (labels.get(label) ?? 0) + 1);
      const o = byOutcome.get(e.type) ?? blank();
      o[origin]++;
      byOutcome.set(e.type, o);
      if (e.type === "goal") {
        goals[origin]++;
        const key = slot ?? "?";
        const g = goalsBySlot.get(key) ?? blank();
        g[origin]++;
        goalsBySlot.set(key, g);
      }
    });
  }
}

const zoneShare = (t: Tally) => {
  const n = ZONES.reduce((s, z) => s + t[z], 0);
  return ZONES.map((z) => `${z} ${((100 * t[z]) / Math.max(1, n)).toFixed(1)}%`).join("  ");
};
const pct = (n: number) => `${((100 * n) / shots).toFixed(1)}%`;

console.log(`${shots} shots over ${SEASONS} season(s)\n`);
console.log("EXACT origins (share of all shots)");
console.log(`  penalty ${pct(all.penalty)}  corner header ${pct(all.corner)}  free kick ${pct(all.freeKick)}\n`);
console.log("OPEN PLAY by zone (target shots ~7/55/38, goals ~21/66/13)");
console.log(`  all shots  ${zoneShare(all)}`);
console.log(`  goals      ${zoneShare(goals)}`);
for (const [type, t] of byOutcome) console.log(`  ${type.padEnd(15)} ${zoneShare(t)}`);
console.log("\nGOALS by the shooter's slot");
for (const [slot, t] of [...goalsBySlot].sort()) {
  const n = ZONES.reduce((s, z) => s + t[z], 0);
  console.log(`  ${slot.padEnd(3)} n=${String(n).padStart(5)}  ${zoneShare(t)}`);
}

// Hash check: roll uniformity on the exact seeds the zone roll uses.
const bins = new Array(10).fill(0);
let n = 0;
for (let pid = 1; pid <= 400; pid++) {
  for (let clock = 5400; clock > -600; clock -= 7) {
    bins[Math.floor((hashInts(pid, clock, 1, 613) / 4294967296) * 10)]++;
    n++;
  }
}
console.log("\nHASH uniformity, 10 bins (each should be ~10%)");
console.log("  " + bins.map((b) => `${((100 * b) / n).toFixed(1)}`).join(" "));

console.log("\nLABELS");
for (const [label, c] of [...labels].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pct(c).padStart(6)}  ${label}`);
}
