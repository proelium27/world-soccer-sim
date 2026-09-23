/**
 * Nationality drift: how far each top flight's domestic share moves from its
 * real breakdown over a dynasty, and through which doors players come and go.
 * The gate for home-country pull (docs/club-reputation.md).
 *
 * Per league it reports the domestic share every season, then flows summed over
 * the run, split by DIRECTION (in / out) and NATIONALITY (home / foreign) and by
 * route:
 *
 *   in:  free agent, bought (same country), bought (abroad), loan in,
 *        ceiling sweep (fee-0 move), promoted with club, youth intake, other
 *   out: sold/moved (same country), sold abroad, loaned out, released (tagged
 *        with where he is by the end of the offseason: signed at home, signed
 *        abroad, or unsigned), retired or culled, relegated with club
 *
 * Then, per top flight: clubs at a registration cap, and clubs more than 5
 * points above their league's real domestic share (overshoot).
 *
 * Losing home players and gaining foreign ones need different fixes, which is
 * why the two directions are kept apart.
 *
 * Headless and a spectator save, so no unmanaged user club skews anything.
 * APPEAL_HOME is read from constants; edit it to tune.
 *
 * Run: SEASONS=20 SEED=1 npx tsx scripts/nationalityDriftProbe.ts
 */
import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState, type LeagueStore } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import { SPECTATOR_TID } from "../src/core/spectator.js";
import { APPEAL_HOME } from "../src/core/constants.js";
import { domesticShare } from "../src/core/transfers/homePull.js";
import { worldRules, competitionForeignRules } from "../src/core/foreignRules.js";
import { FREE_AGENT_TID, type CompletedTransfer } from "../src/core/transfers/negotiation.js";

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 1);
const EVERY = Number(process.env.EVERY ?? 5);

type Snap = Map<number, number>; // pid -> tid, top-flight rosters only

function topFlight(l: LeagueStore): { snap: Snap; countryOfTid: Map<number, string> } {
  const tier1 = new Map(l.competitions.filter((c) => c.tier === 1).map((c) => [c.id, c.country]));
  const snap: Snap = new Map();
  const countryOfTid = new Map<number, string>();
  for (const t of l.teams) {
    const country = tier1.get(t.compId);
    if (!country) continue;
    countryOfTid.set(t.tid, country);
    for (const pid of t.roster) snap.set(pid, t.tid);
  }
  return { snap, countryOfTid };
}

function countryOfAnyTid(l: LeagueStore): Map<number, string> {
  const comp = new Map(l.competitions.map((c) => [c.id, c.country]));
  return new Map(l.teams.map((t) => [t.tid, comp.get(t.compId)!]));
}

const rng = mulberry32(SEED);
let league = createLeagueState(SPECTATOR_TID, rng, SEED);
const countries = league.competitions.filter((c) => c.tier === 1).map((c) => c.country);
const real = new Map(league.competitions.filter((c) => c.tier === 1).map((c) => [c.country, domesticShare(c)]));

const shareHistory = new Map<string, number[]>(countries.map((c) => [c, []]));
const flows = new Map<string, Map<string, { home: number; foreign: number }>>(countries.map((c) => [c, new Map()]));
const bump = (country: string, key: string, home: boolean) => {
  const m = flows.get(country)!;
  const r = m.get(key) ?? { home: 0, foreign: 0 };
  if (home) r.home++; else r.foreign++;
  m.set(key, r);
};

function recordShares(l: LeagueStore): void {
  const byPid = new Map(l.players.map((p) => [p.pid, p]));
  const { snap, countryOfTid } = topFlight(l);
  const tally = new Map<string, [number, number]>();
  for (const [pid, tid] of snap) {
    const c = countryOfTid.get(tid)!;
    const r = tally.get(c) ?? [0, 0];
    r[1]++;
    if (byPid.get(pid)?.nationality === c) r[0]++;
    tally.set(c, r);
  }
  for (const c of countries) { const [d, n] = tally.get(c) ?? [0, 1]; shareHistory.get(c)!.push(d / n); }
}

recordShares(league);
const t0 = Date.now();
for (let s = 0; s < SEASONS; s++) {
  const before = topFlight(league);
  const beforeTransfers = new Set(league.transfers);
  const nationalityBefore = new Map(league.players.map((p) => [p.pid, p.nationality]));
  const maxPidBefore = Math.max(...league.players.map((p) => p.pid));

  const r = mulberry32(SEED * 1000 + s);
  league = simThrough(league, "season", r);
  for (let k = 0; (league.phase as string) !== "offseason" && k < 3; k++) league = simThrough(league, "season", r);
  league = simOffseason(league, mulberry32(SEED * 2000 + s));

  const after = topFlight(league);
  const anyCountry = countryOfAnyTid(league);
  const alive = new Set(league.players.map((p) => p.pid));
  const nat = new Map(league.players.map((p) => [p.pid, p.nationality]));
  const fresh = league.transfers.filter((t) => !beforeTransfers.has(t));
  const anywhere = new Map<number, number>();
  for (const t of league.teams) for (const pid of t.roster) anywhere.set(pid, t.tid);
  const lastInto = new Map<string, CompletedTransfer>();
  const lastOutOf = new Map<string, CompletedTransfer>();
  for (const t of fresh) { lastInto.set(`${t.pid}:${t.toTid}`, t); lastOutOf.set(`${t.pid}:${t.fromTid}`, t); }

  // Arrivals into a top flight (a player now at a top-flight club who was not
  // at that same club before).
  for (const [pid, tid] of after.snap) {
    if (before.snap.get(pid) === tid) continue;
    const country = after.countryOfTid.get(tid)!;
    const home = nat.get(pid) === country;
    const tr = lastInto.get(`${pid}:${tid}`);
    let route: string;
    if (!before.countryOfTid.has(tid) && !tr) route = "in: promoted with club";
    else if (!tr) route = pid > maxPidBefore ? "in: youth intake" : "in: other";
    else if (tr.loanSeasons || tr.loanReturn) route = "in: loan";
    else if (tr.fromTid === FREE_AGENT_TID) route = "in: free agent";
    else if (tr.fee === 0) route = "in: ceiling sweep";
    else route = anyCountry.get(tr.fromTid) === country ? "in: bought, same country" : "in: bought abroad";
    bump(country, route, home);
  }
  // Departures from a top flight.
  for (const [pid, tid] of before.snap) {
    if (after.snap.get(pid) === tid) continue;
    const country = before.countryOfTid.get(tid)!;
    const home = nationalityBefore.get(pid) === country;
    const tr = lastOutOf.get(`${pid}:${tid}`);
    let route: string;
    if (!alive.has(pid)) route = "out: retired or culled";
    else if (!after.countryOfTid.has(tid) && !tr) route = "out: relegated with club";
    else if (!tr) {
      // Where a released player is by the end of the offseason: re-signed at
      // home, signed abroad, or still unsigned.
      const now = anywhere.get(pid);
      route = now === undefined ? "out: released, unsigned"
        : anyCountry.get(now) === country ? "out: released, signed at home" : "out: released, signed abroad";
    }
    else if (tr.loanSeasons) route = "out: loaned out";
    else route = anyCountry.get(tr.toTid) === country ? "out: moved, same country" : "out: sold abroad";
    bump(country, route, home);
  }

  recordShares(league);
  if ((s + 1) % EVERY === 0 || s + 1 === SEASONS) {
    console.log(`season ${s + 1} done (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`\n=== top-flight domestic share (APPEAL_HOME=${APPEAL_HOME}, seed ${SEED}) ===`);
const cols = [0, ...Array.from({ length: Math.floor(SEASONS / EVERY) }, (_, i) => (i + 1) * EVERY)];
if (cols[cols.length - 1] !== SEASONS) cols.push(SEASONS);
console.log("league".padEnd(15), "real".padStart(6), ...cols.map((c) => `s${c}`.padStart(6)), "  gap");
let worst = 0;
for (const c of countries) {
  const h = shareHistory.get(c)!;
  const gap = h[SEASONS] - real.get(c)!;
  worst = Math.max(worst, Math.abs(gap));
  console.log(c.padEnd(15), pct(real.get(c)!).padStart(6), ...cols.map((i) => pct(h[i]).padStart(6)), ` ${(gap * 100).toFixed(1)}`);
}
console.log(`worst gap at season ${SEASONS}: ${(worst * 100).toFixed(1)} points`);

console.log(`\n=== flows over ${SEASONS} seasons, all top flights (home / foreign) ===`);
const total = new Map<string, { home: number; foreign: number }>();
for (const m of flows.values()) for (const [k, v] of m) {
  const r = total.get(k) ?? { home: 0, foreign: 0 };
  r.home += v.home; r.foreign += v.foreign; total.set(k, r);
}
for (const [k, v] of [...total].sort()) console.log(k.padEnd(28), String(v.home).padStart(7), String(v.foreign).padStart(8));

// Supply: can the country even field its real share? Every home-pyramid roster
// spot times the real share is how many nationals the pyramid needs; set that
// against where the nation's players actually are.
console.log(`\n=== supply at season ${SEASONS}: nationals by where they play ===`);
console.log("country".padEnd(15), "needed", "home", "abroad", "unsigned", "home/needed");
{
  const compById = new Map(league.competitions.map((c) => [c.id, c]));
  const clubCountry = new Map(league.teams.map((t) => [t.tid, compById.get(t.compId)!.country]));
  const where = new Map<number, string>();
  for (const t of league.teams) for (const pid of t.roster) where.set(pid, clubCountry.get(t.tid)!);
  for (const c of countries) {
    const spots = league.teams.filter((t) => clubCountry.get(t.tid) === c).reduce((a, t) => a + t.roster.length, 0);
    const needed = Math.round(spots * real.get(c)!);
    let home = 0, abroad = 0, unsigned = 0;
    for (const p of league.players) {
      if (p.nationality !== c) continue;
      const w = where.get(p.pid);
      if (w === undefined) unsigned++; else if (w === c) home++; else abroad++;
    }
    console.log(c.padEnd(15), String(needed).padStart(6), String(home).padStart(5), String(abroad).padStart(6), String(unsigned).padStart(8), (home / needed).toFixed(2).padStart(11));
  }
}

// Per league: clubs at a registration cap, and clubs already above their
// league's real domestic share (overshoot), at the end of the run.
console.log(`\n=== top flights at season ${SEASONS}: rule limits and overshoot ===`);
console.log("league".padEnd(15), "clubs", "at cap", "over real share");
{
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const rules = worldRules(league.teams, league.competitions, (pid) => byPid.get(pid), league.season);
  for (const comp of league.competitions.filter((c) => c.tier === 1)) {
    const clubs = league.teams.filter((t) => t.compId === comp.id);
    let atCap = 0;
    let over = 0;
    for (const t of clubs) {
      if (rules.standings(t.tid, t.roster).some((s) =>
        (s.rule.kind === "foreignCap" || s.rule.kind === "nonEuCap") && s.count >= s.limit)) atCap++;
      const home = t.roster.filter((pid) => byPid.get(pid)?.nationality === comp.country).length;
      if (t.roster.length > 0 && home / t.roster.length > real.get(comp.country)! + 0.05) over++;
    }
    const hasCap = competitionForeignRules(comp).some((r) => r.kind === "foreignCap" || r.kind === "nonEuCap");
    console.log(comp.country.padEnd(15), String(clubs.length).padStart(5), (hasCap ? String(atCap) : "-").padStart(6), String(over).padStart(15));
  }
}

console.log(`\n=== per league: net home players (in - out) and foreign in, by route ===`);
for (const c of countries) {
  const m = flows.get(c)!;
  const homeIn = [...m].filter(([k]) => k.startsWith("in")).reduce((a, [, v]) => a + v.home, 0);
  const homeOut = [...m].filter(([k]) => k.startsWith("out")).reduce((a, [, v]) => a + v.home, 0);
  const foreignIn = [...m].filter(([k]) => k.startsWith("in")).map(([k, v]) => [k.slice(4), v.foreign] as const)
    .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`${c.padEnd(15)} home in ${homeIn}, out ${homeOut} | foreign in: ${foreignIn}`);
}
