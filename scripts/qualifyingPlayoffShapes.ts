/**
 * Which qualifying playoffs a world actually produces: for every World Cup size
 * and confederation, how many nations finish at the position that is only
 * partly through, and how many places they play for. Run before touching the
 * playoff bracket shape, since byes appear only where a position sends more
 * than half its nations.
 *
 *   npx tsx scripts/qualifyingPlayoffShapes.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { initQualifying, qualifyingPlan } from "../src/core/international/qualifying.js";

const SIZES = [16, 24, 32, 48] as const;
const SEEDS = [1, 2];

for (const seed of SEEDS) {
  const league = createLeagueState(0, mulberry32(seed));
  for (const size of SIZES) {
    const campaign = initQualifying(league.players, 1, size);
    if (!campaign) {
      console.log(`seed ${seed} size ${size}: world cannot fill it`);
      continue;
    }
    const lines = qualifyingPlan(campaign).map((p) => {
      if (p.groups === 0) return `${p.confederation} ${p.slots}/${p.nations} direct`;
      const last = p.byPosition.length - 1;
      const take = p.byPosition[last];
      const partial = take < p.groups ? ` partial pos ${last + 1}: ${take} of ${p.groups}` : " (no partial)";
      return `${p.confederation} ${p.slots} from ${p.groups}g [${p.byPosition.join(",")}]${partial}`;
    });
    console.log(`seed ${seed} size ${size}: ${lines.join(" | ")}`);
  }
}
