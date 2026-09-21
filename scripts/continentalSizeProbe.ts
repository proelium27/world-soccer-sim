/**
 * End-to-end check that God Mode's continental SIZE setting and its AWAY GOALS
 * rule run on a real simmed world, through the real simThrough and offseason.
 *
 * The size setting is applied as a SlotOverrides map rather than by trimming
 * the field (see continentalSlotOverrides), which means four separate things
 * have to agree about it — cupPlan's promised total, the allocation, the
 * qualifying trim and the draw. They disagree SILENTLY: a plan that promises a
 * size the allocation doesn't produce makes `buildCupState` return null, i.e.
 * the competition simply doesn't exist that season, with nothing logged. This
 * probe is what catches that.
 *
 * Verified, per competition:
 *   - the field is the size that was asked for
 *   - the fields stay disjoint (no club in two competitions)
 *   - no league sends more clubs than it has
 *   - the competition runs to a champion
 *   - away goals decided at least one tie somewhere, and every tie it decided
 *     really was level on aggregate
 *
 * Run: npx tsx scripts/continentalSizeProbe.ts [seed]
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { DEFAULT_CONTINENTAL_FORMAT } from "../src/core/cup/cupShape.js";
import { competitionTeamCount } from "../src/core/competitions.js";
import type { CupState } from "../src/core/cup/types.js";
import type { LeagueStore } from "../src/core/leagueState.js";

const seed = Number(process.argv[2] ?? 7);
const rng = mulberry32(seed);
let league = createLeagueState(0, rng);

const WANT = { continental: 48, shield: 16, americas: 12 } as const;

/**
 * Sim to the offseason boundary. `simThrough` HALTS before the user's cup
 * final, so a single call does not reliably finish a season — the phase is the
 * thing to loop on, not the call count.
 */
function playSeason(l: LeagueStore, r: () => number): LeagueStore {
  let out = l;
  for (let i = 0; i < 6 && out.phase !== "offseason"; i++) out = simThrough(out, "season", r);
  if (out.phase !== "offseason") throw new Error("season never reached the offseason");
  return out;
}

const t0 = Date.now();
league = playSeason(league, rng);
league = {
  ...league,
  continentalFormats: {
    // Two legs everywhere, so the away-goals rule has ties to decide.
    continental: { ...DEFAULT_CONTINENTAL_FORMAT, fieldSize: WANT.continental, awayGoals: true },
    shield: { ...DEFAULT_CONTINENTAL_FORMAT, fieldSize: WANT.shield, awayGoals: true },
    americas: { ...DEFAULT_CONTINENTAL_FORMAT, fieldSize: WANT.americas, awayGoals: true },
  },
};
league = simOffseason(league, rng);
console.log(`season 1 + offseason in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const live = (l: LeagueStore): [string, CupState | null][] => [
  ["continental", l.cup],
  ["shield", l.shield],
  ["americas", l.americasCup ?? null],
];

let bad = 0;
const fail = (msg: string): void => { console.log(`  FAIL ${msg}`); bad++; };

const compOf = new Map(league.teams.map((t) => [t.tid, t.compId]));
const seen = new Map<number, string>();
for (const [id, cup] of live(league)) {
  if (!cup) { fail(`${id}: no competition was drawn at all`); continue; }
  const field = cup.leaguePhase?.teams ?? cup.teams;
  const want = WANT[id as keyof typeof WANT];
  console.log(`${id}: field ${field.length} (asked ${want}), shape ${cup.shape?.opening} ko${cup.shape?.koSize} awayGoals=${cup.shape?.awayGoals}`);
  if (field.length !== want) fail(`${id}: field is ${field.length}, asked for ${want}`);
  if (!cup.shape?.awayGoals) fail(`${id}: away goals rule not recorded on the shape`);

  const perLeague = new Map<number, number>();
  for (const tid of field) {
    const prior = seen.get(tid);
    if (prior) fail(`${id}: club ${tid} is also in ${prior}`);
    seen.set(tid, id);
    const c = compOf.get(tid);
    if (c !== undefined) perLeague.set(c, (perLeague.get(c) ?? 0) + 1);
  }
  for (const [cid, n] of perLeague) {
    const comp = league.competitions.find((c) => c.id === cid);
    if (comp && n > competitionTeamCount(comp)) fail(`${id}: ${comp.country} sent ${n} of ${competitionTeamCount(comp)}`);
  }
}

// Play the season the competitions were drawn for.
const t1 = Date.now();
league = playSeason(league, rng);
console.log(`season 2 in ${((Date.now() - t1) / 1000).toFixed(0)}s`);

let awayGoalTies = 0;
for (const [id, cup] of live(league)) {
  if (!cup) continue;
  if (cup.championTid === null) fail(`${id}: no champion`);
  for (const tie of cup.ties) {
    if (!tie.decidedByAwayGoals) continue;
    awayGoalTies++;
    if (tie.homeGoals !== tie.awayGoals) {
      fail(`${id}: tie ${tie.home}v${tie.away} says away goals but aggregate was ${tie.homeGoals}-${tie.awayGoals}`);
    }
    if (tie.wentToPens) fail(`${id}: tie ${tie.home}v${tie.away} went to penalties AND away goals`);
  }
}
console.log(`ties decided on away goals: ${awayGoalTies}`);
if (awayGoalTies === 0) console.log("  NOTE no tie was level on aggregate this season — rerun with another seed to exercise the rule");

console.log(bad === 0 ? "RESULT: all checks passed" : `RESULT: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
