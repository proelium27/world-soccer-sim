import { mulberry32 } from "../src/engine/rng.js";
import { createLeagueState } from "../src/core/leagueState.js";
import { simThrough } from "../src/core/simThrough.js";
import { simOffseason } from "../src/core/offseason.js";
import type { LeagueStore } from "../src/core/leagueState.js";
import type { SeasonHistoryEntry } from "../src/core/standings.js";
import { isProtectedStar } from "../src/core/transfers/protectedStars.js";

// Difficulty-lever audit for the "capped values + protected star" change
// (run: `npx tsx scripts/protectedStarsAudit.ts`). userTid is excluded from
// talent/market metrics — the user's club is unmanaged headless and rots,
// producing artificial extremes.
//
// Metrics per seed:
//   - maxFee:           largest transfer fee ever logged (must be <= $350M)
//   - eliteMoves:       80+ OVR players that changed clubs across a rollover
//   - GATE-FAILURES:    AUTHORITATIVE — paid sales of a player who was genuinely
//                       protected at the time (re-runs the real isProtectedStar
//                       gate against the exact season record that market used,
//                       with the player's OVR as it was then). Must be 0.
//   - eliteTop4PaidSales: looser context count — an 80+ player sold from a club
//                       that was top-4 in the *governing* season. Legitimate
//                       down-year sales (club top-4 last-1 but not last) don't
//                       count here; a nonzero value would be a real leak.
//   - snapshotTop4Leaks: crude roster-diff count (top-4 keyed on the PRIOR
//                       season) — inflated by legitimate down-year sales; kept
//                       only to show why the authoritative metric is needed.
//   - champions:        distinct England-D1 champions / max titles by one club
//   - eliteOnTop4:      share of 80+ OVR players on a top-4 tier-1 club

const SEASONS = 10;
const SEEDS = [1, 2];
const ELITE_OVR = 80;
const TOP_FINISH = 4;
const ENGLAND_D1 = 0;

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function money(n: number): string {
  return "$" + (n / 1_000_000).toFixed(1) + "M";
}

/** tid -> finishing rank (0-based) within its own competition, from a season record. */
function ranksByTid(rec: SeasonHistoryEntry): Map<number, number> {
  const out = new Map<number, number>();
  const byComp = new Map<number, { tid: number }[]>();
  for (const r of rec.table) {
    const comp = rec.compsByTid[r.tid];
    const arr = byComp.get(comp) ?? [];
    arr.push(r);
    byComp.set(comp, arr);
  }
  for (const rows of byComp.values()) {
    rows.forEach((r, i) => out.set(r.tid, i));
  }
  return out;
}

/** tier-1 competition ids. */
function tier1Comps(league: LeagueStore): Set<number> {
  return new Set(league.competitions.filter((c) => c.tier === 1).map((c) => c.id));
}

for (const seed of SEEDS) {
  const rng = mulberry32(seed);
  let league = createLeagueState(0, rng);
  const userTid = league.meta.userTid;
  const t1 = tier1Comps(league);

  let maxFee = 0;
  let eliteMoves = 0;
  let top4Leaks = 0;
  let top4SaleLeaks = 0; // of the leaks, how many were an actual paid transfer (gate failure)
  const eliteOnTop4Shares: number[] = [];
  const champs: number[] = [];

  // Snapshot of each pid's club + ovr, taken after each offseason.
  let prevPidTid = new Map<number, number>();
  let prevPidOvr = new Map<number, number>();
  let prevRecord: SeasonHistoryEntry | null = null;

  for (let s = 1; s <= SEASONS; s++) {
    const beforeTransfers = league.transfers.length;
    league = simThrough(league, "season", rng);
    league = simOffseason(league, rng);
    process.stderr.write(`  seed ${seed} season ${s}/${SEASONS} done\n`);

    // This season's newly-logged market transfers (paid or free); used both for
    // the max-fee check and to tell a genuine sale from a free-agent departure.
    const seasonTransfers = league.transfers.slice(beforeTransfers);
    for (const tr of seasonTransfers) maxFee = Math.max(maxFee, tr.fee);

    const rec = league.seasonHistory[league.seasonHistory.length - 1];
    if (rec) {
      // England-D1 champion (rank 0 in comp 0).
      const ranks = ranksByTid(rec);
      for (const [tid, rank] of ranks) {
        if (rec.compsByTid[tid] === ENGLAND_D1 && rank === 0) champs.push(tid);
      }
    }

    // Current club + ovr of every player.
    const pidTid = new Map<number, number>();
    const pidOvr = new Map<number, number>();
    for (const t of league.teams) {
      for (const pid of t.roster) pidTid.set(pid, t.tid);
    }
    for (const p of league.players) pidOvr.set(p.pid, p.ovr);

    // Share of elite players (non-user) on a top-4 tier-1 club, using this
    // season's just-finished ranks.
    if (rec) {
      const ranks = ranksByTid(rec);
      let eliteTotal = 0, eliteTop4 = 0;
      for (const p of league.players) {
        if (p.ovr < ELITE_OVR) continue;
        const tid = pidTid.get(p.pid);
        if (tid === undefined || tid === userTid) continue;
        eliteTotal++;
        const comp = rec.compsByTid[tid];
        const rank = ranks.get(tid);
        if (comp !== undefined && t1.has(comp) && rank !== undefined && rank < TOP_FINISH) eliteTop4++;
      }
      if (eliteTotal > 0) eliteOnTop4Shares.push(eliteTop4 / eliteTotal);
    }

    // Elite player club changes across this rollover, and whether they left a
    // club that had finished top-4 of a tier-1 league the prior season.
    if (prevRecord) {
      const prevRanks = ranksByTid(prevRecord);
      for (const [pid, fromTid] of prevPidTid) {
        if (fromTid === userTid) continue;
        const toTid = pidTid.get(pid);
        if (toTid === undefined || toTid === fromTid) continue;
        const wasElite = (prevPidOvr.get(pid) ?? 0) >= ELITE_OVR;
        if (!wasElite) continue;
        eliteMoves++;
        const fromComp = prevRecord.compsByTid[fromTid];
        const fromRank = prevRanks.get(fromTid);
        if (fromComp !== undefined && t1.has(fromComp) && fromRank !== undefined && fromRank < TOP_FINISH) {
          top4Leaks++;
          // Was it an actual paid transfer out of that top-4 club (a gate
          // failure), or a free departure at contract end (not the gate's job)?
          if (seasonTransfers.some((tr) => tr.pid === pid && tr.fromTid === fromTid && tr.fee > 0)) {
            top4SaleLeaks++;
          }
        }
      }
    }

    prevPidTid = pidTid;
    prevPidOvr = pidOvr;
    prevRecord = rec ?? null;
  }

  const titleCounts = new Map<number, number>();
  for (const tid of champs) titleCounts.set(tid, (titleCounts.get(tid) ?? 0) + 1);
  const distinctChamps = titleCounts.size;
  const maxTitles = Math.max(...titleCounts.values());

  // Authoritative gate-failure check: for every PAID market transfer ever
  // logged, re-run the real isProtectedStar gate against the exact season
  // record that market used (a transfer logged in season S was decided off the
  // season-(S-1) record — that's lastCompletedSeason at the time, for both the
  // winter and offseason-summer callers), with the player's OVR as it was that
  // season. A player who was genuinely protected but still got sold is a true
  // leak. `eliteTop4PaidSales` is the looser "elite left a top-4 club for a
  // fee" count for context (includes legitimate down-year sales).
  const playerById = new Map(league.players.map((p) => [p.pid, p]));
  const recBySeason = new Map(league.seasonHistory.map((h) => [h.season, h]));
  const histOvr = (p: (typeof league.players)[number], season: number) =>
    p.recentHist.find((h) => h.season === season)?.ovr ?? p.ovr;
  let protectedSales = 0;
  let eliteTop4PaidSales = 0;
  for (const tr of league.transfers) {
    if (tr.fee <= 0 || tr.loanSeasons || tr.loanReturn) continue;
    if (tr.fromTid === userTid) continue;
    const rec = recBySeason.get(tr.season - 1);
    const p = playerById.get(tr.pid);
    if (!rec || !p) continue;
    const probe = { ...p, ovr: histOvr(p, tr.season - 1) };
    if (isProtectedStar(rec, league.competitions, tr.fromTid, probe)) protectedSales++;
    // looser context metric
    const comp = rec.compsByTid[tr.fromTid];
    if (comp !== undefined && t1.has(comp) && probe.ovr >= ELITE_OVR) {
      const rows = rec.table.filter((r) => rec.compsByTid[r.tid] === comp);
      if (rows.findIndex((r) => r.tid === tr.fromTid) < TOP_FINISH) eliteTop4PaidSales++;
    }
  }

  console.log(`seed ${seed}: maxFee=${money(maxFee)} eliteMoves=${eliteMoves} ` +
    `GATE-FAILURES(protectedSold)=${protectedSales} eliteTop4PaidSales(incl.down-year)=${eliteTop4PaidSales} ` +
    `snapshotTop4Leaks=${top4Leaks}(paid=${top4SaleLeaks}) ` +
    `distinctEngChamps=${distinctChamps}/${champs.length} maxTitles1club=${maxTitles} ` +
    `eliteOnTop4=${(100 * avg(eliteOnTop4Shares)).toFixed(0)}%`);
}
