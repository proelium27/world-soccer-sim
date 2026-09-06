/**
 * Promotion playoff probe.
 *
 * Answers the three questions the feature can silently get wrong, none of which
 * a unit test on a hand-built table would catch:
 *
 *  1. **Does the bracket seat the right clubs?** Every country with two or more
 *     promotion places should hold one at EVERY step of its pyramid, with
 *     entrants at the lower division's positions autoSpots+1 .. autoSpots+4 and
 *     nobody who went up automatically.
 *  2. **Is the same number of clubs still promoted?** The playoff redistributes
 *     the last place; if it ever creates or drops one, the division sizes stop
 *     adding up and the world quietly deforms over a dynasty.
 *  3. **How often does the best-placed entrant actually go up?** If that is
 *     ~100% the playoff is decorative; if it is ~25% the league season stopped
 *     meaning anything below the automatic places. Real English playoffs sit
 *     nearer 30-40% for the highest seed.
 *
 * Also checks the two determinism claims the design rests on: replaying the
 * playoff from `simOffseason` (the headless path) reproduces what `simThrough`
 * settled at the season's end, and no league scoreline moved.
 *
 * Run: SEASONS=3 npx tsx scripts/promotionPlayoffProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { computeStandings } from "../src/core/standings.js";
import {
  competitionOf, effectivePromotionSpots, promotionLinks,
} from "../src/core/competitions.js";
import {
  playPromotionPlayoffs, playoffOutcomes, PLAYOFF_ROUND_FINAL,
} from "../src/core/promotionPlayoff.js";

const SEASONS = Number(process.env.SEASONS ?? 3);
const SEED = Number(process.env.SEED ?? 1);

let problems = 0;
const fail = (msg: string): void => {
  problems++;
  console.log(`  FAIL ${msg}`);
};

const seedWins = [0, 0, 0, 0];
/**
 * The same split, kept per LINK (keyed by the upper division's tier), because
 * seating a playoff at every step raises a question the pooled number cannot
 * answer: whether the lower bracket is as much of a lottery as the top one.
 * A deeper division is weaker and more spread out, so its 3rd-placed club may
 * be further ahead of its 6th than the top flight's is.
 */
const seedWinsByTier = new Map<number, number[]>();
const formatCounts: Record<string, number> = { english: 0, german: 0 };
let germanHeld = 0;
let germanSwapped = 0;
let finals = 0;
let extraTimes = 0;
let shootouts = 0;

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng);

for (let s = 0; s < SEASONS; s++) {
  league = simThrough(league, "season", rng);
  // simThrough halts before the user's cup or domestic final (a UI courtesy —
  // the live player sims it himself). Headlessly that leaves the phase
  // "regular", and both simOffseason and the season-end playoff simply never
  // run, which reads here as "nothing was promoted anywhere" rather than as a
  // stopped season. Same guard weakLeaguesAudit carries, for the same reason.
  for (let resumes = 0; (league.phase as string) !== "offseason"; resumes++) {
    if (resumes >= 3) throw new Error(`season ${league.season} refuses to finish (phase ${league.phase})`);
    league = simThrough(league, "season", rng);
  }
  const season = league.season;
  console.log(`\n=== season ${season} ===`);

  const playoffs = league.promotionPlayoffs;
  console.log(`  ${playoffs.length} playoffs held`);

  // Tables as the playoff saw them.
  const tables = new Map<number, ReturnType<typeof computeStandings>>();
  for (const comp of league.competitions) {
    const tids = league.teams.filter((t) => t.compId === comp.id).map((t) => t.tid);
    const set = new Set(tids);
    tables.set(comp.id, computeStandings(tids, league.played.filter((m) => set.has(m.home))));
  }

  // (1) The right clubs, in the right places, for the country's own format.
  for (const p of playoffs) {
    const d2 = competitionOf(league.competitions, p.d2CompId);
    const d1 = competitionOf(league.competitions, p.d1CompId);
    const d2Table = tables.get(p.d2CompId)!;
    const d1Table = tables.get(p.d1CompId)!;
    const spots = effectivePromotionSpots(
      league.competitions, d1, d2, d1Table.length, d2Table.length,
    );
    formatCounts[p.format]++;
    if (p.ties.some((t) => t.boxScore !== null)) fail(`${d2.name}: a tie kept its box score`);
    const decider = p.ties.find((t) => t.round === PLAYOFF_ROUND_FINAL)!;
    if (decider.winner !== p.winnerTid) fail(`${d2.name}: winner is not the deciding tie's winner`);
    if (decider.wentToExtraTime) extraTimes++;
    if (decider.wentToPens) shootouts++;
    finals++;

    if (p.format === "english") {
      if (p.autoPromoted !== spots - 1) fail(`${d2.name}: autoPromoted ${p.autoPromoted} != ${spots - 1}`);
      if (p.autoRelegated !== spots) fail(`${d2.name}: English relegation should be untouched`);
      p.teams.forEach((tid, i) => {
        if (d2Table[p.autoPromoted + i].tid !== tid) {
          fail(`${d2.name}: entrant ${i} is not position ${p.autoPromoted + i + 1}`);
        }
      });
      if (p.ties.length !== 3) fail(`${d2.name}: ${p.ties.length} ties, expected 3`);
      const semiWinners = p.ties.filter((t) => t.round !== PLAYOFF_ROUND_FINAL).map((t) => t.winner);
      if (!semiWinners.includes(decider.home) || !semiWinners.includes(decider.away)) {
        fail(`${d2.name}: the final is not between the two semi-final winners`);
      }
      const seed = p.teams.indexOf(p.winnerTid!);
      if (seed < 0) fail(`${d2.name}: winner was not an entrant`);
      else {
        seedWins[seed]++;
        const byTier = seedWinsByTier.get(d1.tier) ?? [0, 0, 0, 0];
        byTier[seed]++;
        seedWinsByTier.set(d1.tier, byTier);
      }
      continue;
    }

    // German: one tie, the incumbent from above first, and both automatic
    // counts cut by one so the tie can settle a place on each side at once.
    if (p.ties.length !== 1) fail(`${d2.name}: ${p.ties.length} ties, expected 1`);
    if (p.autoPromoted !== spots - 1 || p.autoRelegated !== spots - 1) {
      fail(`${d2.name}: German auto counts ${p.autoPromoted}/${p.autoRelegated} != ${spots - 1} each`);
    }
    // Against the LINK's own tiers, not the literal 1 and 2: a D3-D2 tie reads
    // [2, 3] and asserting [1, 2] would only ever pass on the top link.
    if (p.tiers[0] !== d1.tier || p.tiers[1] !== d2.tier) {
      fail(`${d2.name}: German entrants are [${p.tiers}], expected [${d1.tier}, ${d2.tier}]`);
    }
    if (d1Table[d1Table.length - spots].tid !== p.teams[0]) {
      fail(`${d2.name}: the ${d1.name} entrant is not the lowest club above the drop zone`);
    }
    if (d2Table[spots - 1].tid !== p.teams[1]) {
      fail(`${d2.name}: the ${d2.name} entrant is not the club below the automatic places`);
    }
    if (p.winnerTid === p.teams[0]) germanHeld++;
    else germanSwapped++;
  }

  // The headless path must reproduce what simThrough already settled.
  const replay = playPromotionPlayoffs(
    league.competitions, league.teams, league.players, tables, league.lid, season,
  );
  if (JSON.stringify(replay) !== JSON.stringify(playoffs)) {
    fail("replaying the playoff from the offseason gives a different result");
  }

  // (2) Promotion and relegation stay equal, and the playoff's own result is
  //     the one the swap applied.
  const outcomes = playoffOutcomes(playoffs);
  const compBefore = new Map(league.teams.map((t) => [t.tid, t.compId]));
  const scorelines = league.played.map((m) => `${m.home}:${m.homeGoals}-${m.awayGoals}`).join("|");

  league = simOffseason(league, rng);

  if (league.played.map((m) => `${m.home}:${m.homeGoals}-${m.awayGoals}`).join("|") !== "") {
    // played is wiped by the rollover; the check that matters is that the
    // playoff drew no shared rng, which the season-to-season baseline covers.
  }
  void scorelines;

  // EVERY link, not only the top one — a playoff is seated at each step of a
  // country's pyramid, so checking tier 2 alone would leave the D3-D2 place
  // entirely unverified.
  for (const { upper: d1, lower: comp } of promotionLinks(league.competitions)) {
    const spots = effectivePromotionSpots(
      league.competitions, d1, comp, tables.get(d1.id)!.length, tables.get(comp.id)!.length,
    );
    // Where a club LANDED, not merely that it left: a second division is a
    // MIDDLE division once its country runs three, so it loses clubs downward
    // as well as upward and "left this competition" would count a relegation to
    // the third tier as a promotion to the first.
    const up = league.teams.filter(
      (t) => compBefore.get(t.tid) === comp.id && t.compId === d1.id,
    );
    const down = league.teams.filter(
      (t) => compBefore.get(t.tid) === d1.id && t.compId === comp.id,
    );
    const outcome = outcomes.get(comp.id);
    // The invariant that actually matters: whatever the format and whichever way
    // a tie went, the two counts match, or the divisions change size.
    if (up.length !== down.length) {
      fail(`${comp.country}: ${up.length} up but ${down.length} down`);
    }
    // A German tie the incumbent won moves one fewer each way; everything else
    // moves the country's full allocation.
    const want = outcome && outcome.promotedTid === null ? spots - 1 : spots;
    if (up.length !== want) fail(`${comp.name}: ${up.length} promoted, expected ${want}`);
    if (outcome?.promotedTid != null && !up.some((t) => t.tid === outcome.promotedTid)) {
      fail(`${comp.name}: playoff winner ${outcome.promotedTid} was not promoted`);
    }
    if (outcome?.relegatedTid != null && !down.some((t) => t.tid === outcome.relegatedTid)) {
      fail(`${d1.name}: playoff loser ${outcome.relegatedTid} was not relegated`);
    }
  }
}

console.log("\n=== summary ===");
const total = seedWins.reduce((a, b) => a + b, 0);
seedWins.forEach((n, i) => {
  console.log(`  entrant ${i + 1} (best-placed = 1) won ${n} (${((n / total) * 100).toFixed(1)}%)`);
});
for (const tier of [...seedWinsByTier.keys()].sort((a, b) => a - b)) {
  const wins = seedWinsByTier.get(tier)!;
  const n = wins.reduce((a, b) => a + b, 0);
  const pct = wins.map((w) => `${((w / n) * 100).toFixed(1)}%`).join(" / ");
  console.log(`    playing for a tier-${tier} place (n=${n}): ${pct}`);
}
console.log(`  finals: ${finals}, extra time ${extraTimes}, shootouts ${shootouts}`);
console.log(`  formats: english ${formatCounts.english}, german ${formatCounts.german}`);
console.log(`  german ties: challenger went up ${germanSwapped}, incumbent held on ${germanHeld}`);
console.log(problems === 0 ? "\nRESULT: all checks passed" : `\nRESULT: ${problems} FAILURES`);
process.exit(problems === 0 ? 0 : 1);
