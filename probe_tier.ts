import { makeLeague } from "./test/helpers/league.js";
import { searchLoanTargets } from "./src/core/loanSearch.js";
import type { LeagueStore } from "./src/core/leagueState.js";

const base = makeLeague(0, 1);
// A few clubs per tier, since one club's shape is not a tier.
const byTier = new Map<number, number[]>();
for (const t of base.teams) {
  const tier = base.competitions.find((c) => c.id === t.compId)!.tier;
  const arr = byTier.get(tier) ?? [];
  if (arr.length < 6) arr.push(t.tid);
  byTier.set(tier, arr);
}

for (const tier of [1, 2, 3]) {
  const counts: number[] = [];
  const bests: number[] = [];
  for (const tid of byTier.get(tier)!) {
    const league = { ...base, meta: { ...base.meta, userTid: tid } } as LeagueStore;
    const rows = searchLoanTargets(league, 1, { availableOnly: true });
    counts.push(rows.length);
    bests.push(rows.length ? Math.max(...rows.map((r) => r.player.ovr)) : 0);
  }
  console.log(
    `tier ${tier}: available rows per club ${counts.join(",")}`,
    `| best borrowable ovr ${bests.join(",")}`,
  );
}
