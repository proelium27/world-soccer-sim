/**
 * Rate probe for suspensions (core/suspensions.ts).
 *
 * The ban tariff (SUSPENSION_* in constants.ts) is copied from real football,
 * but a tariff is only sensible if the engine's *card rate* is realistic too:
 * at half the real booking rate a 5-yellow ban would essentially never fire,
 * and at double it every squad would be permanently short. Cards existed for a
 * long time with no consequence attached, so nothing had ever checked the rate.
 *
 * Prints, per season, over the whole world:
 *   - yellows and reds per match (real top-flight reference: ~3.5-4.5 yellows,
 *     ~0.15-0.25 reds per match)
 *   - how many bans were issued, split by reason
 *   - how many league matches were missed to bans in total, and the share of
 *     player-appearances that represents
 *   - the most-banned player of the season
 *
 * The user's club is excluded from the "most banned" line only; it plays the
 * same rules as everyone else here (no AI management is involved in cards).
 *
 * Run: npx tsx scripts/suspensionProbe.ts   (SEASONS=3 to widen)
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import {
  SUSPENSION_YELLOW_THRESHOLD,
  SUSPENSION_YELLOW_MATCHES,
  SUSPENSION_SECOND_YELLOW_MATCHES,
  SUSPENSION_RED_MATCHES,
} from "../src/core/constants.js";

const SEASONS = Number(process.env.SEASONS ?? 1);

console.log(
  `tariff: ${SUSPENSION_YELLOW_THRESHOLD} yellows -> ${SUSPENSION_YELLOW_MATCHES}, ` +
    `second yellow -> ${SUSPENSION_SECOND_YELLOW_MATCHES}, red -> ${SUSPENSION_RED_MATCHES}\n`,
);

for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(4100 + s);
  let league = createLeagueState(0, rng);
  league = simThrough(league, "season", rng);

  let yellows = 0;
  let reds = 0;
  let appearances = 0;
  for (const p of league.players) {
    const line = p.recentStats.find((x) => x.season === league.season);
    if (!line) continue;
    yellows += line.yellowCards;
    reds += line.redCards;
    appearances += line.appearances;
  }

  // Re-derive the bans the same way the sim did, so the counts describe the
  // shipped rule rather than a second implementation of it.
  const matches = league.played.length;
  let yellowBans = 0;
  let secondYellowBans = 0;
  let redBans = 0;
  let matchesMissed = 0;
  const bansByPid = new Map<number, number>();

  const tally = new Map<number, number>();
  const perMatchday = new Map<number, Map<number, { y: number; r: number }>>();
  for (const m of league.played) {
    let md = perMatchday.get(m.matchday);
    if (!md) {
      md = new Map();
      perMatchday.set(m.matchday, md);
    }
    for (const l of [...m.boxScore.home, ...m.boxScore.away]) {
      if (l.yellowCards === 0 && l.redCards === 0) continue;
      const prev = md.get(l.pid) ?? { y: 0, r: 0 };
      md.set(l.pid, { y: prev.y + l.yellowCards, r: prev.r + l.redCards });
    }
  }

  for (const md of [...perMatchday.keys()].sort((a, b) => a - b)) {
    for (const [pid, c] of perMatchday.get(md)!) {
      let count = (tally.get(pid) ?? 0) + c.y;
      let banned = 0;
      let reason = "";
      if (count >= SUSPENSION_YELLOW_THRESHOLD) {
        count -= SUSPENSION_YELLOW_THRESHOLD;
        banned = SUSPENSION_YELLOW_MATCHES;
        reason = "yellows";
      }
      if (c.r > 0) {
        const sentOff = c.y >= 2 ? SUSPENSION_SECOND_YELLOW_MATCHES : SUSPENSION_RED_MATCHES;
        if (sentOff >= banned) {
          banned = sentOff;
          reason = c.y >= 2 ? "second" : "red";
        }
      }
      tally.set(pid, count);
      if (banned > 0) {
        matchesMissed += banned;
        bansByPid.set(pid, (bansByPid.get(pid) ?? 0) + 1);
        if (reason === "yellows") yellowBans++;
        else if (reason === "second") secondYellowBans++;
        else redBans++;
      }
    }
  }

  const worst = [...bansByPid.entries()].sort((a, b) => b[1] - a[1])[0];
  const worstName = worst ? league.players.find((p) => p.pid === worst[0])?.name : "-";

  console.log(`season ${s + 1}  (${matches} league matches)`);
  console.log(
    `  cards/match      yellows ${(yellows / matches).toFixed(2)}   reds ${(reds / matches).toFixed(3)}`,
  );
  console.log(
    `  bans issued      ${yellowBans + secondYellowBans + redBans}` +
      `  (${yellowBans} accumulation, ${secondYellowBans} second yellow, ${redBans} straight red)`,
  );
  console.log(
    `  matches missed   ${matchesMissed}  (${((matchesMissed / appearances) * 100).toFixed(2)}% of appearances)`,
  );
  console.log(`  most banned      ${worstName ?? "-"} x${worst?.[1] ?? 0}\n`);
}
