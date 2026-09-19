/**
 * Fast card-rate measurement for tuning YELLOW_GIVEN_FOUL / RED_STRAIGHT_GIVEN_FOUL.
 *
 * Runs `simSeason` (one 20-club league, 380 matches) over a few seeds and
 * prints the three numbers that decide whether a card-rate change is safe:
 *
 *   - yellows/match, reds/match — the thing being tuned. Real top-flight
 *     reference: ~3.5-4.5 yellows, ~0.15-0.25 reds (second yellows included).
 *   - second yellows vs straight reds — the split matters, because second
 *     yellows scale roughly with the SQUARE of the yellow rate (they need two
 *     bookings on one player), so reds rise much faster than yellows do.
 *   - goals/match — the reason this isn't a free knob. Every card calls
 *     `bumpEvent()`, and stoppage time is STOPPAGE_SECONDS_PER_EVENT (20s) per
 *     event, so more cards means longer matches means more scoring. The M1
 *     benchmark bands are on goals/game, so this is what would break them.
 *
 * Deliberately on simSeason rather than a full 16-competition world: it's the
 * same simMatchDetailed path at a fraction of the cost, and card rate is a
 * per-match property that doesn't need the world.
 *
 * Run: npx tsx scripts/cardRateSweep.ts   (SEEDS=5 to widen)
 */
import { mulberry32 } from "../src/engine/rng.js";
import { simSeason } from "../src/core/season.js";
import { YELLOW_GIVEN_FOUL, RED_STRAIGHT_GIVEN_FOUL, FOUL_BASE_DETAILED, FOUL_RATE_MULTIPLIER, BOOKED_FOUL_WEIGHT } from "../src/engine/constants.js";

const SEEDS = Number(process.env.SEEDS ?? 3);

console.log(
  `FOUL_BASE_DETAILED=${FOUL_BASE_DETAILED.toFixed(4)} (x${FOUL_RATE_MULTIPLIER})  BOOKED_FOUL_WEIGHT=${BOOKED_FOUL_WEIGHT}  YELLOW_GIVEN_FOUL=${YELLOW_GIVEN_FOUL}  RED_STRAIGHT_GIVEN_FOUL=${RED_STRAIGHT_GIVEN_FOUL}`,
);

let tY = 0, tR = 0, tSecond = 0, tStraight = 0, tGoals = 0, tMatches = 0, tFouls = 0, tShots = 0;

for (let s = 0; s < SEEDS; s++) {
  const { matches } = simSeason(mulberry32(7000 + s));
  let y = 0, r = 0, second = 0, straight = 0, goals = 0, fouls = 0, shots = 0;

  for (const m of matches) {
    goals += m.homeGoals + m.awayGoals;
    for (const l of [...m.boxScore.home, ...m.boxScore.away]) {
      y += l.yellowCards;
      r += l.redCards;
      fouls += l.foulsCommitted;
      shots += l.shots;
      if (l.redCards > 0) {
        if (l.yellowCards >= 2) second++;
        else straight++;
      }
    }
  }

  console.log(
    `  seed ${s}: yellows/match ${(y / matches.length).toFixed(2)}  ` +
      `reds/match ${(r / matches.length).toFixed(3)}  goals/match ${(goals / matches.length).toFixed(4)}`,
  );

  tY += y; tR += r; tSecond += second; tStraight += straight;
  tGoals += goals; tMatches += matches.length; tFouls += fouls; tShots += shots;
}

console.log(
  `\nMEAN over ${SEEDS} seeds (${tMatches} matches)\n` +
    `  fouls/match    ${(tFouls / tMatches).toFixed(2)}\n` +
    `  yellows/match  ${(tY / tMatches).toFixed(3)}   (real ~3.5-4.5)\n` +
    `  reds/match     ${(tR / tMatches).toFixed(4)}   (real ~0.15-0.25)\n` +
    `  red split      ${tSecond} second yellow / ${tStraight} straight\n` +
    `  shots/match    ${(tShots / tMatches).toFixed(3)}\n` +
    `  goals/match    ${(tGoals / tMatches).toFixed(4)}   <- watch this\n`,
);
