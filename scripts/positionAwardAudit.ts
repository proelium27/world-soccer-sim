/**
 * Audit for the Goalkeeper of the Year and Defender of the Year
 * (core/worldAwards.ts).
 *
 * These awards exist because the Ballon d'Or is built on `potyScore`, which
 * carries no defensive statistics at all — measured over eight seasons of a
 * 240-club world, its top ten was 45% ST / 30% AM / 20% W / 5% FB and no
 * centre-back, holding midfielder or goalkeeper ever reached it. Both new
 * awards are scored on `totsScore` instead, which does credit tackles,
 * interceptions, saves and goals conceded.
 *
 * The four questions worth asking of them, in order of how likely they are to
 * be wrong:
 *
 *  1. **Does the Defender of the Year split sensibly between centre-backs and
 *     full-backs?** This is the real risk in the design. `totsScore` is a
 *     *within-position* statistic (see the note on TOTS_SLOTS in awards.ts):
 *     it pays a defender 0.03 a tackle against a forward's 0.01, so it is only
 *     commensurable inside a position group. CB and FB share a group and so
 *     share a weight column, which makes the comparison defensible — but they
 *     do not collect the same stats in the same volume, so an all-CB or all-FB
 *     board would say the two are not really comparable after all.
 *  2. **Does the Goalkeeper of the Year agree with the World XI's keeper?** It
 *     should, essentially always: both are picked off the same number, and that
 *     agreement is a design goal rather than a coincidence. A low rate means
 *     something has drifted apart that shouldn't have.
 *  3. **Do the winners come from strong leagues?** The same weak-league drift
 *     the Ballon d'Or's league-strength correction exists to stop applies here,
 *     since these awards carry the same correction.
 *  4. **Are the winners actually the best players at their position?** Reported
 *     as the winner's ovr rank among everyone in the world in his group.
 *
 *   npx tsx scripts/positionAwardAudit.ts
 *   SEASONS=8 SEEDS=1,2 npx tsx scripts/positionAwardAudit.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { competitionOf } from "../src/core/competitions.js";
import { positionGroup, ovrDuringSeason, statsFor } from "../src/core/awards.js";
import { TOTS_POSITION_WORK } from "../src/core/constants.js";
import type { Position } from "../src/core/players/types.js";

const SEASONS = Number(process.env.SEASONS ?? 8);
const SEEDS = (process.env.SEEDS ?? "1,2").split(",").map(Number);

const keeperCountry = new Map<string, number>();
const defenderCountry = new Map<string, number>();
const defenderPos = new Map<Position, number>();
/** Shortlist composition, which says more than the winner alone about CB vs FB. */
const defenderShortlistPos = new Map<Position, number>();
const keeperOvrRanks: number[] = [];
const defenderOvrRanks: number[] = [];
let keeperMatchesXI = 0;
let keeperSeasons = 0;
let defenderSeasons = 0;
/** How often the same man wins it twice running — a dominant-keeper check. */
let keeperRepeat = 0;
let defenderRepeat = 0;
let lastKeeper: number | null = null;
let lastDefender: number | null = null;
/**
 * How much of a winner's score came from raw counting stats.
 *
 * The number that matters most here: tackles and interceptions are NOT
 * z-normalized the way match ratings are, so a defender in a weak league or on
 * a leaky team simply gets more defending to do and collects more of both. The
 * league-strength correction only shifts the *rating* term, so it cannot undo
 * this. A high share means the award is measuring volume of work rather than
 * quality of it.
 */
const volumeShare: number[] = [];
/** Share of the winning score that came from outside his own league season. */
const trophyShare: number[] = [];
const keeperTrophyShare: number[] = [];
const keeperVolumeShare: number[] = [];
/** The Ballon d'Or's own country spread over the same run, as a reference point. */
const ballonCountry = new Map<string, number>();
/** The Ballon d'Or's own beyond-league share, so the two are compared like for like. */
const ballonTrophyShare: number[] = [];
/**
 * Whether the Defender of the Year also took a back-four slot in the World XI.
 *
 * The point of asking: both are picked off the same `worldTotsParts` score, so
 * a high rate means this award is naming a choice the game was already making
 * rather than introducing a new one — which is what decides whether anything
 * odd about the winners is a NEW problem or a pre-existing one now given a
 * trophy.
 */
let defenderInXI = 0;

const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

for (const seed of SEEDS) {
  const rng = mulberry32(seed);
  let league = createLeagueState(0, rng);
  console.log(`\n=== seed ${seed} ===`);

  for (let s = 0; s < SEASONS; s++) {
    league = simThrough(league, "season", rng);
    league = simOffseason(league, rng);
    const entry = league.seasonHistory.at(-1)!;
    const world = entry.world;
    const keepers = world.goalkeeperOfYear ?? [];
    const defenders = world.defenderOfYear ?? [];
    if (keepers.length === 0 && defenders.length === 0) continue;

    const byPid = new Map(league.players.map((p) => [p.pid, p]));
    const countryOf = (tid: number): string => {
      const cid = entry.compsByTid[tid];
      return cid === undefined ? "?" : competitionOf(league.competitions, cid)?.country ?? "?";
    };

    // Everyone who played that season, so a winner's ovr rank is measured
    // against the field he actually beat rather than today's pool.
    const played = league.players.filter((p) => {
      const st = statsFor(p, entry.season);
      return st !== undefined && st.appearances > 0;
    });
    const rankIn = (group: "GK" | "DEF", pid: number): number => {
      const pool = played
        .filter((p) => positionGroup(p.pos) === group)
        .map((p) => ({ pid: p.pid, ovr: ovrDuringSeason(p, entry.season) }))
        .sort((a, b) => b.ovr - a.ovr);
      return pool.findIndex((r) => r.pid === pid) + 1;
    };

    if (world.ballonDOr.length > 0) {
      const b = world.ballonDOr[0];
      bump(ballonCountry, countryOf(b.tid));
      if (b.score > 0) ballonTrophyShare.push((b.score - b.league) / b.score);
    }

    if (keepers.length > 0) {
      const w = keepers[0];
      keeperSeasons++;
      bump(keeperCountry, countryOf(w.tid));
      keeperOvrRanks.push(rankIn("GK", w.pid));
      // Slot 0 of the World XI is the keeper's (TOTS_SLOTS starts "GK").
      if (world.worldTeamOfYear[0] === w.pid) keeperMatchesXI++;
      if (lastKeeper === w.pid) keeperRepeat++;
      lastKeeper = w.pid;
      const p = byPid.get(w.pid);
      const st = p ? statsFor(p, entry.season) : undefined;
      // The per-game conceded term's share of his score (absolute: it's a penalty).
      if (st && w.score > 0 && st.appearances > 0) {
        keeperVolumeShare.push(
          Math.abs((st.goalsAgainst / st.appearances) * TOTS_POSITION_WORK.GK.concededPerGame) / w.score,
        );
      }
      if (w.score > 0) keeperTrophyShare.push((w.score - w.league) / w.score);
      console.log(
        `  s${entry.season} GK  ${p?.name ?? `#${w.pid}`} (${countryOf(w.tid)}, ovr ` +
        `${p ? ovrDuringSeason(p, entry.season) : "?"}) ` +
        `${st?.saves ?? "?"} saves, ${st?.goalsAgainst ?? "?"} conceded, ` +
        `${st ? st.avgRating.toFixed(2) : "?"} rating, score ${w.score.toFixed(2)}`,
      );
    }

    if (defenders.length > 0) {
      const w = defenders[0];
      defenderSeasons++;
      bump(defenderCountry, countryOf(w.tid));
      defenderOvrRanks.push(rankIn("DEF", w.pid));
      if (lastDefender === w.pid) defenderRepeat++;
      lastDefender = w.pid;
      const p = byPid.get(w.pid);
      // Position as of the season he won it. `awardWinners` snapshots it at the
      // time; the live pool does not, and players are reclassified over a
      // career, so a present-day lookup reports positions they never won at
      // (it showed a DM winning a defenders' award, which cannot happen --
      // `positionGroup` puts DM in MID).
      const posAt = new Map((entry.awardWinners ?? []).map((a) => [a.pid, a.pos]));
      const winnerPos = posAt.get(w.pid) ?? p?.pos;
      if (winnerPos) bump(defenderPos, winnerPos);
      for (const e of defenders) {
        const sp = posAt.get(e.pid) ?? byPid.get(e.pid)?.pos;
        if (sp) bump(defenderShortlistPos, sp);
      }
      // Slots 1-4 of TOTS_SLOTS are CB, CB, FB, FB.
      if (world.worldTeamOfYear.slice(1, 5).includes(w.pid)) defenderInXI++;
      const st = p ? statsFor(p, entry.season) : undefined;
      if (st && w.score > 0) {
        // The per-game defending term's share of his score.
        const pos = (winnerPos ?? p?.pos ?? "CB") as Position;
        const vol = st.appearances > 0
          ? ((st.tackles + st.interceptions) / st.appearances) * TOTS_POSITION_WORK[pos].defendingPerGame
          : 0;
        volumeShare.push(vol / w.score);
        trophyShare.push((w.score - w.league) / w.score);
      }
      console.log(
        `  s${entry.season} DEF ${p?.name ?? `#${w.pid}`} ${p?.pos ?? "?"} (${countryOf(w.tid)}, ovr ` +
        `${p ? ovrDuringSeason(p, entry.season) : "?"}) ` +
        `${st?.tackles ?? "?"} tackles, ${st?.interceptions ?? "?"} int, ` +
        `${st ? st.avgRating.toFixed(2) : "?"} rating, score ${w.score.toFixed(2)}`,
      );
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`);
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const table = <K,>(m: Map<K, number>) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");

console.log(`\n=== ${SEEDS.length} seeds x ${SEASONS} seasons ===`);
console.log(`\nGoalkeeper of the Year (${keeperSeasons} awarded)`);
console.log(`  by country:        ${table(keeperCountry)}`);
console.log(`  winner's ovr rank among keepers: median ${median(keeperOvrRanks)}, worst ${Math.max(...keeperOvrRanks)}`);
console.log(`  also the World XI keeper:        ${pct(keeperMatchesXI, keeperSeasons)}  <- should be ~100%`);
console.log(`  won back-to-back:  ${keeperRepeat}`);

console.log(`\nDefender of the Year (${defenderSeasons} awarded)`);
console.log(`  by country:        ${table(defenderCountry)}`);
console.log(`  winner's position: ${table(defenderPos)}  <- the CB/FB split to watch`);
console.log(`  shortlist spread:  ${table(defenderShortlistPos)}`);
console.log(`  winner's ovr rank among defenders: median ${median(defenderOvrRanks)}, worst ${Math.max(...defenderOvrRanks)}`);
console.log(`  won back-to-back:  ${defenderRepeat}`);
console.log(`  also in the World XI back four:  ${pct(defenderInXI, defenderSeasons)}  <- high means this award only names a pick the game already made`);

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
console.log(`\nHow much of the winning score is raw volume, not quality`);
console.log(`  keeper, from saves:              ${(mean(keeperVolumeShare) * 100).toFixed(0)}%`);
console.log(`  defender, from tackles + int:    ${(mean(volumeShare) * 100).toFixed(0)}%`);
console.log(`
How much of the winning score came from beyond his own league`);
console.log(`  Ballon d'Or: ${(mean(ballonTrophyShare) * 100).toFixed(0)}%   <- the yardstick`);
console.log(`  keeper:    ${(mean(keeperTrophyShare) * 100).toFixed(0)}%`);
console.log(`  defender:  ${(mean(trophyShare) * 100).toFixed(0)}%`);
console.log(`\nCountry spread, for comparison`);
console.log(`  Ballon d'Or:       ${table(ballonCountry)}`);
console.log(`  Goalkeeper:        ${table(keeperCountry)}`);
console.log(`  Defender:          ${table(defenderCountry)}`);
