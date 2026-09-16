/**
 * What the scout directions actually do to the academy's yearly intake,
 * measured on a real offseason rather than argued from the constants.
 *
 * Run it before touching SCOUT_POSITION_SHARE: it is sized against what the user
 * can SEE in his group, not against the share it is applied at, and the two
 * differ because positions reach only the scouted extras (see
 * SCOUT_POSITION_SHARE for why they must).
 *
 *   npx tsx scripts/scoutDirectionsProbe.ts
 *
 * The OVR line is the one to watch. Steering positions must not change how GOOD
 * the group is, only which positions it fills — a keeper and a striker are
 * generated off the same academy base — so a systematic move there would mean
 * the skew had become a balance lever rather than a preference.
 *
 * SEED=n picks a different world (default 4).
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import type { Position } from "../src/core/players/types.js";
import { USER_ACADEMY_ENTRY_AGE } from "../src/core/constants.js";

const SEED = Number(process.env.SEED ?? 4);

/**
 * simThrough halts before the user's own cup final, so one call finishes a
 * season only when his club happens not to reach one — and simOffseason handed
 * a half-played season silently does nothing at all.
 */
function playSeason(league: LeagueStore, rng: () => number): LeagueStore {
  let out = league;
  for (let i = 0; i < 4 && out.phase !== "offseason"; i++) out = simThrough(out, "season", rng);
  if (out.phase !== "offseason") throw new Error(`season did not finish (phase ${out.phase})`);
  return out;
}

function run(positions: Position[]) {
  const rng = mulberry32(SEED);
  let league = createLeagueState(0, rng);
  league = {
    ...league,
    teams: league.teams.map((t) => (t.tid === league.meta.userTid
      ? { ...t, scoutingPositions: positions } as typeof t
      : t)),
  };
  league = simOffseason(playSeason(league, rng), rng);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  // This summer's intake: the academy kids who arrived at the entry age. A
  // fresh world's academy is empty, so after one offseason that is all of them.
  const group = league.teams.find((t) => t.tid === league.meta.userTid)!.academyRoster
    .map((pid) => byPid.get(pid)!)
    .filter((p) => league.season - p.born === USER_ACADEMY_ENTRY_AGE);
  const mean = (f: (p: (typeof group)[number]) => number) =>
    group.reduce((s, p) => s + f(p), 0) / group.length;
  return {
    positions: group.map((p) => p.pos),
    ovrs: group.map((p) => p.ovr).sort((a, b) => b - a),
    speed: mean((p) => p.ratings.speed),
    shortPass: mean((p) => p.ratings.shortPass),
    positioning: mean((p) => p.ratings.positioning),
  };
}

// The three RAREST positions: ROSTER_COMPOSITION keeps only two of each, so an
// untargeted intake produces few and the skew has somewhere to show. Targeting
// CB/FB/CM would mostly be measuring the baseline back.
const TARGETS: Position[] = ["GK", "DM", "AM"];

const plain = run([]);
const targeted = run(TARGETS);
const share = (r: { positions: Position[] }) =>
  r.positions.filter((p) => TARGETS.includes(p)).length / r.positions.length;

console.log(`seed ${SEED}, group of ${plain.positions.length}\n`);
console.log("POSITIONS");
console.log(`  target share (${TARGETS.join("/")}): ` +
  `${(share(plain) * 100).toFixed(1)}% -> ${(share(targeted) * 100).toFixed(1)}%`);
console.log(`  none    : ${plain.positions.join(" ")}`);
console.log(`  targeted: ${targeted.positions.join(" ")}\n`);

console.log("GROUP QUALITY (steering positions must not change it)");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`  none    : mean OVR ${mean(plain.ovrs).toFixed(1)}  ${plain.ovrs.join(",")}`);
console.log(`  targeted: mean OVR ${mean(targeted.ovrs).toFixed(1)}  ${targeted.ovrs.join(",")}`);
