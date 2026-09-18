/**
 * Is a transfer clause priced honestly?
 *
 * A clause never adds money to a deal: the other club's total willingness to
 * pay is fixed, and the clause converts part of it from cash into contingency
 * (see core/transfers/clauses.ts). So the whole exploit surface is the pricing.
 * Over-price one and the user is robbed — he gives up more cash than the clause
 * is worth. **Under-price one and it is free money**, because he keeps nearly
 * the full cash fee *and* the upside, on every deal, forever. That is the
 * direction to worry about, and it is what this measures.
 *
 * The method deliberately does NOT require clauses to exist. It sims a world,
 * then for every completed transfer asks two questions off the same history:
 *
 *   PRICED    what `clauseValue` would have quoted at the moment of the deal
 *   REALIZED  what the clause would actually have paid, from what then happened
 *
 * A ratio of realized/priced near 1.0 means the model is honest. Well above 1
 * means the user is being handed value; well below 1 means he is overpaying for
 * contingency. Read the ratio, not either column alone — both scale with the
 * share and the world's fee level.
 *
 * It also reports the three inputs the model rests on, so
 * SELL_ON_RESALE_PROBABILITY and SELL_ON_PRICING_HORIZON can be set from
 * measurement rather than taste:
 *
 *   - how often a bought player is actually sold on inside the clause window
 *   - how long that takes when it happens
 *   - how often each bonus trigger really fires
 *
 * Caveat worth keeping: these are AI↔AI deals, and the user's own buying is not
 * drawn from the same distribution (he buys through `reservationPrice`, with a
 * difficulty scale on top). Treat the numbers as the market's central tendency,
 * which is what a club pricing a clause would have to go on anyway.
 *
 *   npx tsx scripts/clausePricingProbe.ts [seasons] [seed]
 */
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { mulberry32 } from "../src/engine/rng.js";
import type { LeagueStore } from "../src/core/leagueState.js";
import type { Player } from "../src/core/players/types.js";
import type { CompletedTransfer } from "../src/core/transfers/negotiation.js";
import { isFreeAgentTid } from "../src/core/transfers/negotiation.js";
import {
  clauseValue, projectedValue, triggerProbability, suggestedBonuses,
} from "../src/core/transfers/clauses.js";
import { deriveLeagueContexts } from "../src/core/ai/clubContext.js";
import type { StoredTeam } from "../src/core/teams/clubs.js";
import type { BonusTrigger } from "../src/core/transfers/clauses.js";
import { tierOf, competitionTeamCount } from "../src/core/competitions.js";
import {
  SELL_ON_CLAUSE_SEASONS, SELL_ON_RESALE_PROBABILITY, SELL_ON_PRICING_HORIZON,
  BONUS_CLAUSE_SEASONS,
} from "../src/core/constants.js";

const SEASONS = Number(process.argv[2] ?? 12);
const SEED = Number(process.argv[3] ?? 1);
/** The share to price the comparison at. Cancels out of the ratio. */
const SHARE = 0.2;

const money = (n: number) => `£${(n / 1_000_000).toFixed(2)}M`;
const pct = (n: number) => `${(100 * n).toFixed(1)}%`;

const rng = mulberry32(SEED);
let league = createLeagueState(0, rng);

/**
 * A snapshot per season of what we need to look BACK at, because the live
 * league only has today's players and today's tables. Ratings move every
 * offseason and a resold player must be priced as he was on the day he was
 * bought, not as he is now.
 */
interface Snapshot {
  season: number;
  players: Map<number, Player>;
  /** posWeakestStarterOvr per club, for the model's "will he play" terms. */
  weakestStarter: Map<number, Record<string, number> | undefined>;
  teams: Map<number, StoredTeam>;
  compIdByTid: Map<number, number>;
  qualified: Set<number>;
  rosterOf: Map<number, number>;
}
const snaps: Snapshot[] = [];

function snapshot(l: LeagueStore): Snapshot {
  const contexts = deriveLeagueContexts(l);
  const rosterOf = new Map<number, number>();
  for (const t of l.teams) for (const pid of t.roster) rosterOf.set(pid, t.tid);
  // Who is actually IN a continental competition this season.
  //
  // `CupState.teams` is the KNOCKOUT BRACKET, not the field — eight clubs, with
  // -1 in every slot until a result fills it. Reading that reported 0.0% of
  // buyers ever qualifying, which is the shape of trap CLAUDE.md warns about
  // twice for this type. The field is `leaguePhase.teams`.
  const qualified = new Set<number>([
    ...(l.cup?.leaguePhase?.teams ?? []),
    ...(l.shield?.leaguePhase?.teams ?? []),
  ]);
  return {
    season: l.season,
    // Shallow copies are enough: nothing here mutates a player, and the sim
    // replaces them wholesale each offseason rather than editing in place.
    players: new Map(l.players.map((p) => [p.pid, p])),
    weakestStarter: new Map(
      l.teams.map((t) => [t.tid, contexts.get(t.tid)?.posWeakestStarterOvr]),
    ),
    teams: new Map(l.teams.map((t) => [t.tid, t])),
    compIdByTid: new Map(l.teams.map((t) => [t.tid, t.compId])),
    qualified,
    rosterOf,
  };
}

process.stdout.write(`Simming ${SEASONS} seasons (seed ${SEED})…\n`);
for (let s = 0; s < SEASONS; s++) {
  snaps.push(snapshot(league));
  league = simThrough(league, "season", rng);
  league = simOffseason(league, rng);
}
snaps.push(snapshot(league));

const snapAt = (season: number) => snaps.find((s) => s.season === season);

/** Only real club↔club sales: a free transfer or a loan has no fee to share. */
const sales: CompletedTransfer[] = league.transfers.filter(
  (t) => !isFreeAgentTid(t.fromTid) && !isFreeAgentTid(t.toTid)
    && t.loanSeasons === undefined && !t.loanReturn && t.fee > 0,
);

// Indexed once: the naive `sales.find(...)` inside a loop over `sales` is
// quadratic, and a 12-season world has five figures of them.
const salesByPid = new Map<number, CompletedTransfer[]>();
for (const t of sales) {
  const list = salesByPid.get(t.pid);
  if (list) list.push(t); else salesByPid.set(t.pid, [t]);
}
const livePlayers = new Map(league.players.map((p) => [p.pid, p]));

/* ── Sell-on: what it would have been priced at, vs what it would have paid ── */

let pricedTotal = 0;
let realizedTotal = 0;
let n = 0;
let resold = 0;
let resoldAtProfit = 0;
let horizonSum = 0;
/** Deals where the model said one thing and reality said very much another. */
let bigUnderprice = 0;

for (const deal of sales) {
  const snap = snapAt(deal.season);
  if (!snap) continue;
  const player = snap.players.get(deal.pid);
  if (!player) continue;

  // What the buyer would have been charged for granting a SHARE sell-on.
  // `clauseValue` needs the obligor only for the bonus branch, so any club
  // object is fine here; pass the buyer's for honesty.
  const buyerComp = snap.compIdByTid.get(deal.toTid);
  if (buyerComp === undefined) continue;
  const obligor = { tid: deal.toTid, compId: buyerComp } as never;
  const priced = clauseValue(
    { kind: "sellOn", share: SHARE }, player, deal.season, deal.fee,
    obligor, league.competitions, null,
  );

  // What actually happened: did the buyer sell him on inside the window?
  const next = (salesByPid.get(deal.pid) ?? []).find(
    (t) => t.fromTid === deal.toTid
      && t.season > deal.season && t.season <= deal.season + SELL_ON_CLAUSE_SEASONS,
  );
  const realized = next ? Math.round(SHARE * Math.max(0, next.fee - deal.fee)) : 0;

  pricedTotal += priced;
  realizedTotal += realized;
  n++;
  if (next) {
    resold++;
    horizonSum += next.season - deal.season;
    if (next.fee > deal.fee) resoldAtProfit++;
  }
  if (realized > 3 * priced && realized > 1_000_000) bigUnderprice++;
}

/* ── Bonuses: priced against realized, AT THE THRESHOLDS ACTUALLY OFFERED ─── */

/**
 * The bonus half of the realized/priced discipline.
 *
 * It evaluates at the thresholds `suggestedBonuses` really produces for each
 * deal, not at a fixed grid, because those are the only ones the game ever
 * offers: a threshold is a suggestion here, never something a user types. That
 * makes this the exact question that matters — is what we quote for the bonus
 * we actually propose close to what it pays — and it is a far easier one than
 * "is the model right at every conceivable threshold", which it is not (goal
 * counts are over-dispersed relative to a Poisson at both tails).
 */
const TRIGGERS: BonusTrigger[] = ["appearances", "goals", "continental", "promotion"];
const predicted = new Map<BonusTrigger, number>(TRIGGERS.map((t) => [t, 0]));
const realizedHits = new Map<BonusTrigger, number>(TRIGGERS.map((t) => [t, 0]));
const offered = new Map<BonusTrigger, number>(TRIGGERS.map((t) => [t, 0]));
const thresholdSum = new Map<BonusTrigger, number>(TRIGGERS.map((t) => [t, 0]));
const thresholdMin = new Map<BonusTrigger, number>(TRIGGERS.map((t) => [t, Infinity]));
const thresholdMax = new Map<BonusTrigger, number>(TRIGGERS.map((t) => [t, 0]));
let bonusN = 0;

for (const deal of sales) {
  const snap = snapAt(deal.season);
  if (!snap) continue;
  const obligor = snap.teams.get(deal.toTid);
  const player = snap.players.get(deal.pid);
  if (!obligor || !player) continue;
  bonusN++;

  const starter = snap.weakestStarter.get(deal.toTid)?.[player.pos] ?? null;
  const suggestions = suggestedBonuses(
    player, obligor, league.competitions, starter, Math.max(1, deal.fee),
  );

  // What actually happened over the clause window, while he was still there.
  let bestApps = 0, bestGoals = 0, hitCont = false, hitPromo = false;
  const live = livePlayers.get(deal.pid);
  for (let k = 0; k < BONUS_CLAUSE_SEASONS; k++) {
    const season = deal.season + k;
    const later = snapAt(season + 1);
    if (!later) break;
    if (later.rosterOf.get(deal.pid) !== deal.toTid) break;
    const line = live?.recentStats.find((st) => st.season === season && st.tid === deal.toTid);
    bestApps = Math.max(bestApps, line?.appearances ?? 0);
    bestGoals = Math.max(bestGoals, line?.goals ?? 0);
    if (later.qualified.has(deal.toTid)) hitCont = true;
    const before = snapAt(season)?.compIdByTid.get(deal.toTid);
    const after = later.compIdByTid.get(deal.toTid);
    if (
      before !== undefined && after !== undefined
      && tierOf(league.competitions, before) > tierOf(league.competitions, after)
    ) hitPromo = true;
  }

  for (const sug of suggestions) {
    const t = sug.trigger;
    offered.set(t, offered.get(t)! + 1);
    predicted.set(t, predicted.get(t)! + triggerProbability(
      t, player, obligor, league.competitions, starter, BONUS_CLAUSE_SEASONS, sug.threshold,
    ));
    if (sug.threshold !== undefined) {
      thresholdSum.set(t, thresholdSum.get(t)! + sug.threshold);
      thresholdMin.set(t, Math.min(thresholdMin.get(t)!, sug.threshold));
      thresholdMax.set(t, Math.max(thresholdMax.get(t)!, sug.threshold));
    }
    const hit =
      t === "appearances" ? bestApps >= (sug.threshold ?? 0)
      : t === "goals" ? bestGoals >= (sug.threshold ?? 0)
      : t === "continental" ? hitCont
      : hitPromo;
    if (hit) realizedHits.set(t, realizedHits.get(t)! + 1);
  }
}

/* ── Distributions: what a threshold model has to reproduce ──────────────── */

/**
 * One season a bought player spent at the club that bought him.
 *
 * A per-player bonus threshold is only honest if the probability responds to
 * it, so the model needs the real SHAPE of these two distributions, not just
 * their means: how often a player clears 15 games is a different question from
 * how often he clears 30, and a single base rate cannot answer both.
 */
interface Obs {
  edge: number;        // ovr over the incumbent starter he had to displace
  pos: string;
  apps: number;
  goals: number;
  games: number;       // league games his competition played that season
}
const obs: Obs[] = [];

for (const deal of sales) {
  const snap = snapAt(deal.season);
  if (!snap) continue;
  const player0 = snap.players.get(deal.pid);
  if (!player0) continue;
  const starter = snap.weakestStarter.get(deal.toTid)?.[player0.pos];
  if (starter === undefined) continue;
  const buyerComp = snap.compIdByTid.get(deal.toTid);
  if (buyerComp === undefined) continue;
  const comp = league.competitions.find((c) => c.id === buyerComp);
  if (!comp) continue;
  const games = 2 * (competitionTeamCount(comp) - 1);
  const live = livePlayers.get(deal.pid);
  for (let k = 0; k < BONUS_CLAUSE_SEASONS; k++) {
    const season = deal.season + k;
    const later = snapAt(season + 1);
    if (!later) break;
    if (later.rosterOf.get(deal.pid) !== deal.toTid) break;
    const line = live?.recentStats.find((st) => st.season === season && st.tid === deal.toTid);
    obs.push({
      edge: player0.ovr - starter,
      pos: player0.pos,
      apps: line?.appearances ?? 0,
      goals: line?.goals ?? 0,
      games,
    });
  }
}

const EDGE_BUCKETS = [-99, -10, -5, 0, 5, 10, 99];
const APP_GRID = [10, 15, 20, 25, 30];
const GOAL_GRID = [3, 5, 8, 10, 15];

function bucketLabel(i: number): string {
  const lo = EDGE_BUCKETS[i];
  const hi = EDGE_BUCKETS[i + 1];
  if (lo === -99) return `<${hi}`;
  if (hi === 99) return `${lo}+`;
  return `${lo}..${hi}`;
}

function appLines(): string {
  const out: string[] = [];
  out.push(`  edge      n     mean    sd    share   ` + APP_GRID.map((t) => `P>=${t}`.padStart(7)).join(""));
  for (let i = 0; i < EDGE_BUCKETS.length - 1; i++) {
    const inB = obs.filter((o) => o.edge >= EDGE_BUCKETS[i] && o.edge < EDGE_BUCKETS[i + 1]);
    if (inB.length === 0) continue;
    const mean = inB.reduce((a, o) => a + o.apps, 0) / inB.length;
    const sd = Math.sqrt(inB.reduce((a, o) => a + (o.apps - mean) ** 2, 0) / inB.length);
    const share = inB.reduce((a, o) => a + o.apps / Math.max(1, o.games), 0) / inB.length;
    const ps = APP_GRID.map((t) =>
      pct(inB.filter((o) => o.apps >= t).length / inB.length).padStart(7)).join("");
    out.push(
      `  ${bucketLabel(i).padEnd(8)} ${String(inB.length).padStart(5)} ${mean.toFixed(1).padStart(6)}`
      + ` ${sd.toFixed(1).padStart(5)} ${share.toFixed(3).padStart(7)} ${ps}`,
    );
  }
  return out.join("\n");
}

function goalLines(): string {
  const out: string[] = [];
  out.push(`  pos       n     mean   per90*  ` + GOAL_GRID.map((t) => `P>=${t}`.padStart(7)).join(""));
  const positions = [...new Set(obs.map((o) => o.pos))].sort();
  for (const pos of positions) {
    const inP = obs.filter((o) => o.pos === pos);
    const mean = inP.reduce((a, o) => a + o.goals, 0) / inP.length;
    const totalApps = inP.reduce((a, o) => a + o.apps, 0);
    const perApp = totalApps > 0 ? inP.reduce((a, o) => a + o.goals, 0) / totalApps : 0;
    const ps = GOAL_GRID.map((t) =>
      pct(inP.filter((o) => o.goals >= t).length / inP.length).padStart(7)).join("");
    out.push(
      `  ${pos.padEnd(8)} ${String(inP.length).padStart(5)} ${mean.toFixed(2).padStart(6)}`
      + ` ${perApp.toFixed(3).padStart(7)}  ${ps}`,
    );
  }
  return out.join("\n");
}

/** Goals among players who actually played, which is what a bonus is about. */
function goalLinesPlaying(): string {
  const out: string[] = [];
  out.push(`  pos       n     mean    ` + GOAL_GRID.map((t) => `P>=${t}`.padStart(7)).join(""));
  const positions = [...new Set(obs.map((o) => o.pos))].sort();
  for (const pos of positions) {
    const inP = obs.filter((o) => o.pos === pos && o.apps >= 15);
    if (inP.length === 0) continue;
    const mean = inP.reduce((a, o) => a + o.goals, 0) / inP.length;
    const ps = GOAL_GRID.map((t) =>
      pct(inP.filter((o) => o.goals >= t).length / inP.length).padStart(7)).join("");
    out.push(`  ${pos.padEnd(8)} ${String(inP.length).padStart(5)} ${mean.toFixed(2).padStart(6)}    ${ps}`);
  }
  return out.join("\n");
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const ratio = pricedTotal > 0 ? realizedTotal / pricedTotal : Number.NaN;

process.stdout.write(`
SELL-ON PRICING  (${n} club-to-club sales, share ${pct(SHARE)}, ${SEASONS} seasons, seed ${SEED})

  priced (what the model charges)   ${money(pricedTotal)}   mean ${money(pricedTotal / Math.max(1, n))}
  realized (what it would have paid) ${money(realizedTotal)}   mean ${money(realizedTotal / Math.max(1, n))}
  realized / priced                 ${ratio.toFixed(3)}   ${verdict(ratio)}

  deals where realized > 3x priced  ${bigUnderprice}  (${pct(bigUnderprice / Math.max(1, n))})

MODEL INPUTS  (set the constants from these, not from taste)

  resold inside ${SELL_ON_CLAUSE_SEASONS} seasons        ${pct(resold / Math.max(1, n))}   SELL_ON_RESALE_PROBABILITY = ${SELL_ON_RESALE_PROBABILITY}
  ...of those, at a profit          ${pct(resoldAtProfit / Math.max(1, resold))}
  mean seasons to resale            ${(horizonSum / Math.max(1, resold)).toFixed(2)}   SELL_ON_PRICING_HORIZON = ${SELL_ON_PRICING_HORIZON}


BONUS PRICING at the thresholds actually SUGGESTED (${bonusN} deals; 1.0 is honest)

${TRIGGERS.map(bonusRow).join("\n")}

Note: a projected value is what the model thinks he'll be worth; at the median
deal that is ${money(medianProjection())}, against a median fee of ${money(medianFee())}.

APPEARANCES PER SEASON at the buying club, by ovr over the incumbent starter
(${obs.length} player-seasons). "share" is appearances / league games.

${appLines()}

GOALS PER SEASON, all bought players

${goalLines()}
  * per90 here is goals per APPEARANCE, not per 90 minutes.

GOALS PER SEASON, only player-seasons with 15+ appearances

${goalLinesPlaying()}
`);

function bonusRow(t: BonusTrigger): string {
  const n = offered.get(t)!;
  const pred = predicted.get(t)! / Math.max(1, n);
  const real = realizedHits.get(t)! / Math.max(1, n);
  const ratio = pred > 0 ? real / pred : Number.NaN;
  const flag = !Number.isFinite(ratio) ? ""
    : ratio > 1.25 ? "  UNDER-PRICED"
    : ratio < 0.8 ? "  OVER-PRICED"
    : "  ok";
  const span = thresholdMax.get(t)! > 0
    ? `  threshold ${thresholdMin.get(t)}-${thresholdMax.get(t)}`
      + ` (mean ${(thresholdSum.get(t)! / Math.max(1, n)).toFixed(1)})`
    : "";
  return `  ${t.padEnd(13)} offered ${String(n).padStart(6)}   predicted ${pct(pred).padStart(6)}`
    + `   realized ${pct(real).padStart(6)}   ratio ${Number.isFinite(ratio) ? ratio.toFixed(3) : "n/a"}`
    + `${flag}${span}`;
}


function verdict(r: number): string {
  if (!Number.isFinite(r)) return "(no data)";
  if (r > 1.35) return "UNDER-PRICED — the user keeps the cash and the upside";
  if (r < 0.65) return "OVER-PRICED — the user pays too much for contingency";
  return "OK";
}

function medianFee(): number {
  const f = sales.map((s) => s.fee).sort((a, b) => a - b);
  return f[Math.floor(f.length / 2)] ?? 0;
}

function medianProjection(): number {
  const v: number[] = [];
  for (const deal of sales) {
    const snap = snapAt(deal.season);
    const p = snap?.players.get(deal.pid);
    if (p) v.push(projectedValue(p, deal.season, SELL_ON_PRICING_HORIZON));
  }
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
}
