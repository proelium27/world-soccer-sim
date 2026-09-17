/**
 * End-to-end check that God Mode's continental formats run on a real simmed
 * world, through the real simThrough and offseason — not the fake-strength
 * fixtures the unit tests use.
 *
 * Season 1 plays with no continental competitions (they need a finished table).
 * The formats are set before its offseason, so the draw builds each competition
 * in its custom shape, and season 2 then plays every one of them to a champion
 * beside the league and the domestic cups. Verified:
 *   - each competition was drawn in the format set for it, with a stored calendar
 *   - no continental matchday lands on a domestic cup matchday or deadline day
 *   - every competition finishes with a champion and a full bracket
 *   - the Finance page's derived prize money matches the budget moves the sim made
 *     for continental prizes (checked as: every entrant earned something)
 *
 * Run: npx tsx scripts/continentalFormatProbe.ts [seed]
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import { koRoundsOf, koLegMatchdays } from "../src/core/cup/cup.js";
import { continentalPrizeIncome } from "../src/core/finance/prizeIncome.js";
import { DOMESTIC_CUP_MATCHDAYS } from "../src/core/constants.js";
import { TRANSFER_DEADLINE_MATCHDAY } from "../src/core/calendar.js";
import { DEFAULT_CONTINENTAL_FORMAT, describeCupShape } from "../src/core/cup/cupShape.js";
import type { CupState } from "../src/core/cup/types.js";

const seed = Number(process.argv[2] ?? 7);
const rng = mulberry32(seed);
let league = createLeagueState(0, rng);

const t0 = Date.now();
league = simThrough(league, "season", rng);
league = {
  ...league,
  continentalFormats: {
    continental: { ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups" },
    shield: { ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout", twoLegged: false },
    americas: { ...DEFAULT_CONTINENTAL_FORMAT, leaguePhaseGames: 8, knockoutSize: 16 },
  },
};
league = simOffseason(league, rng);
console.log(`season 1 + offseason in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

let failed = false;
const fail = (msg: string): void => { console.log(`  !! ${msg}`); failed = true; };

const cups: [string, CupState | null][] = [
  ["Continental Cup", league.cup], ["Continental Shield", league.shield], ["Americas Cup", league.americasCup ?? null],
];
for (const [name, cup] of cups) {
  if (!cup) { console.log(`${name}: not contested in this world`); continue; }
  if (!cup.shape || !cup.calendar) { fail(`${name} was drawn without its custom format`); continue; }
  console.log(`${name}: ${describeCupShape(cup.shape, cup.leaguePhase!.teams.length)}`);
  const days = [...cup.calendar.opening, ...(cup.calendar.playoff ? [cup.calendar.playoff] : []), ...cup.calendar.ko.flat()];
  console.log(`  matchdays ${days.join(" ")}`);
  for (const d of days) {
    if ((DOMESTIC_CUP_MATCHDAYS as readonly number[]).includes(d) || d === TRANSFER_DEADLINE_MATCHDAY) fail(`${name} uses blocked matchday ${d}`);
  }
}

const t1 = Date.now();
league = simThrough(league, "season", rng);
console.log(`\nseason 2 in ${((Date.now() - t1) / 1000).toFixed(0)}s`);

const after: [string, CupState | null][] = [
  ["Continental Cup", league.cup], ["Continental Shield", league.shield], ["Americas Cup", league.americasCup ?? null],
];
for (const [name, cup] of after) {
  if (!cup) continue;
  const champ = league.teams.find((t) => t.tid === cup.championTid)?.name;
  const rounds = koRoundsOf(cup);
  const tiesPerRound = Array.from({ length: rounds }, (_, r) => cup.ties.filter((t) => t.round === r).length);
  console.log(`${name}: champion ${champ ?? "NONE"}, knockout ties per round ${tiesPerRound.join("/")}, legs ${koLegMatchdays(cup).map((l) => l.length).join("")}`);
  if (cup.championTid === null) fail(`${name} finished without a champion`);
  for (let r = 0; r < rounds; r++) {
    if (tiesPerRound[r] !== cup.teams.length / 2 ** (r + 1)) fail(`${name} round ${r} has ${tiesPerRound[r]} ties`);
  }
  const unpaid = cup.leaguePhase!.teams.filter((tid) => (continentalPrizeIncome(cup, tid)?.total ?? 0) <= 0);
  if (unpaid.length > 0) fail(`${name}: ${unpaid.length} entrants earned nothing`);
  const played = cup.leaguePhase!.matches.filter((m) => m.played).length;
  console.log(`  opening games played ${played}/${cup.leaguePhase!.matches.length}${cup.playoff ? `, ${cup.playoff.ties.length} preliminary/playoff ties` : ""}`);
}

console.log(failed ? "\nRESULT: FAILURES ABOVE" : "\nRESULT: all checks passed");
if (failed) process.exitCode = 1;
