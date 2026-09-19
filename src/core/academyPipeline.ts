/**
 * The user's academy as a pipeline: kids join it automatically, and the
 * decisions come at two checkpoints rather than at the door.
 *
 *   - USER_ACADEMY_ENTRY_AGE    they arrive (offseason step 5), unsigned by nobody.
 *   - ACADEMY_SCHOLARSHIP_AGE   the first academy deal is up. Kept while there's
 *                               room, the lowest-scouted cut when there isn't.
 *   - ACADEMY_GRADUATION_AGE    senior contract or release. Promoted while the
 *                               senior roster has room, best-scouted first.
 *
 * **The scouts decide by default and the user can overrule them, kid by kid.**
 * A kid with no entry in `StoredTeam.academyDecisions` gets the default below; a
 * kid with one gets the user's call (keep or release at the scholarship cut,
 * promote or release at the professional cut). A call is only accepted while it
 * fits (`setAcademyDecision`): a promote needs a senior place the rollover will
 * have, a keep needs an academy place once the new intake arrives. The rollover
 * applies them and clears the map. A user who never opens the Academy still gets
 * a working pipeline, and releasing or promoting a kid on the spot still works
 * as before.
 *
 * **The checkpoint IS the contract expiry.** An academy deal for a kid under the
 * professional cut runs to the season before his next checkpoint
 * (`academyCheckpointExpiry`), so every kid who reaches one is exactly the set
 * whose deal is up AND was running to a cut. The offseason keeps those kids off
 * `releaseExpiredContracts` and resolves them here instead, which is what stops a
 * deal lapsing silently. A prospect signed out of free agency on an ordinary
 * deal is not at a checkpoint, and his deal lapses like anyone else's.
 *
 * **Ranked on what the user could see before the rollover.** Default cuts and
 * promotions order kids by the middle of the scouting band, never by their true
 * potential: ranking on the truth would make the default quietly perfect and
 * hand the hidden number back through who survived. The order is taken ONCE, off
 * the league as it stood when the offseason began (`academyRanking`), because
 * the rollover re-estimates every potential (progression, step 2) and locks in
 * next season's scouting spend (step 3.5) before the cuts run. Ranking after
 * either could reorder two kids the Academy page had just shown the other way
 * round.
 *
 * User's club only, pure, and rng-free.
 */
import type { Player } from "./players/types.js";
import type { StoredTeam, AcademyChoice } from "./teams/clubs.js";
import type { ActiveLoan } from "./loans.js";
import { potentialFog } from "./scouting/potentialFog.js";
import { academyCheckpointExpiry, academyContractTerms, contractTerms } from "./contracts.js";
import { computeOvr } from "./players/ovr.js";
import { youthRatingsAt } from "./players/progression.js";
import {
  ACADEMY_ROSTER_CAP, ACADEMY_SCHOLARSHIP_AGE, ACADEMY_GRADUATION_AGE, ROSTER_CAP,
  USER_ACADEMY_INTAKE_MAX, YOUTH_BASE_REFERENCE_AGE, type Difficulty, type ProgressionModel,
} from "./constants.js";

export type { AcademyChoice } from "./teams/clubs.js";

/** Which cut a kid is in front of. */
export type AcademyCheckpoint = "scholarship" | "professional";

/**
 * What the next rollover does with a kid. `atRisk` is the scholarship cut's
 * "released if the academy is full": the exact intake size is drawn at the
 * rollover, so a preview can only say he is below the line for the largest
 * intake possible.
 */
export type AcademyOutcome = "promote" | "release" | "keep" | "atRisk";

export interface AcademyDecision {
  pid: number;
  checkpoint: AcademyCheckpoint;
  /** What the rollover does with him, the user's call included. */
  outcome: AcademyOutcome;
  /** The user's call, or null while the scouts' default stands. */
  chosen: AcademyChoice | null;
  /**
   * The calls he can be given right now. Only the two that belong to his
   * checkpoint appear; one that no longer fits (no senior place for another
   * promote, no academy place for another keep) reads false.
   */
  options: Partial<Record<AcademyChoice, boolean>>;
}

/** A kid's place in the default order, 0 = best. See `academyRanking`. */
export type AcademyRanking = ReadonlyMap<number, number>;

/**
 * Academy pids who reach a checkpoint at the end of `season`: a deal that is up
 * AND was running to a cut. The second half keeps a prospect signed out of free
 * agency on an ordinary deal out of it, and it is the same test `renewalsDue`
 * and the Academy page's Extend button use, so the three can't disagree about
 * who is at a decision and who simply needs re-signing.
 */
export function academyDuePids(
  team: StoredTeam | undefined,
  players: Player[],
  season: number,
): Set<number> {
  if (!team) return new Set();
  const inAcademy = new Set(team.academyRoster);
  return new Set(
    players
      .filter((p) =>
        inAcademy.has(p.pid)
        && p.contract.expiresSeason <= season
        && academyCheckpointExpiry(p.born, season) !== null)
      .map((p) => p.pid),
  );
}

/** The middle of the scouting band the user sees for him in `viewSeason`. */
function scoutedEstimate(
  p: Player, team: StoredTeam, viewSeason: number, difficulty?: Difficulty,
): number {
  const fog = potentialFog(
    p.potential, p.pid, viewSeason, team.scoutingObserved?.[p.pid] ?? null,
    team.scoutingSpend, difficulty,
  );
  return (fog.low + fog.high) / 2;
}

/**
 * Every academy kid's place in the default order, best first: the middle of the
 * scouting band the user sees in `viewSeason`, then current rating, then pid for
 * a stable order. The offseason takes this before it changes anything and the
 * preview takes it off the same league, which is what makes the two agree.
 */
export function academyRanking(
  team: StoredTeam, players: Player[], viewSeason: number, difficulty?: Difficulty,
): AcademyRanking {
  const inAcademy = new Set(team.academyRoster);
  const kids = players
    .filter((p) => inAcademy.has(p.pid))
    .map((p) => ({ p, est: scoutedEstimate(p, team, viewSeason, difficulty) }))
    .sort((a, b) => b.est - a.est || b.p.ovr - a.p.ovr || a.p.pid - b.p.pid);
  return new Map(kids.map(({ p }, i) => [p.pid, i]));
}

/** Best first by a ranking; a kid it doesn't know sorts last, by pid. */
function byRanking(ranking: AcademyRanking): (a: Player, b: Player) => number {
  const at = (p: Player) => ranking.get(p.pid) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) => at(a) - at(b) || a.pid - b.pid;
}

function checkpointOf(p: Player, nextSeason: number): AcademyCheckpoint {
  return nextSeason - p.born >= ACADEMY_GRADUATION_AGE ? "professional" : "scholarship";
}

/**
 * The user's call on a kid, if it belongs to the checkpoint he is actually at.
 * A promote can only mean something at the professional cut and a keep only at
 * the scholarship cut, so a stored call for the wrong one is read as no call.
 */
function choiceFor(team: StoredTeam, p: Player, nextSeason: number): AcademyChoice | null {
  const c = team.academyDecisions?.[p.pid];
  if (!c) return null;
  if (c === "release") return c;
  return (c === "promote") === (checkpointOf(p, nextSeason) === "professional") ? c : null;
}

/**
 * A kid arriving from the yearly intake: his first academy deal, running to the
 * scholarship cut, and his ratings history started in the academy rather than
 * with a stray senior point before his first academy season.
 */
export function enrolAcademyYouth(
  p: Player,
  season: number,
  model: ProgressionModel = "random",
): Player {
  const terms = academyContractTerms(season, p.born);
  // A kid below the reference age was rolled as the player he will be at it.
  // Keep that as his target and show him the younger version, so he grows into
  // it (see `youthRatingsAt`). Potential stays as generated: it was forecast
  // from those rolled ratings, which is exactly what he lands on. peakOvr is
  // authoritative once set, so it has to come down with the ovr it describes.
  const age = season - p.born;
  const growing = age < YOUTH_BASE_REFERENCE_AGE;
  const ratings = growing ? youthRatingsAt(p.ratings, p.pid, age, model) : p.ratings;
  const ovr = growing ? computeOvr(p.pos, ratings, p.heightCm) : p.ovr;
  return {
    ...p,
    ratings,
    ovr,
    peakOvr: growing ? ovr : p.peakOvr,
    ...(growing ? { youthTarget: p.ratings } : {}),
    contract: { salary: terms.salary, expiresSeason: terms.expiresSeason },
    recentHist: p.recentHist.map((h) => (growing ? { ...h, academy: true, ratings, ovr } : { ...h, academy: true })),
  };
}

export interface CheckpointResult {
  teams: StoredTeam[];
  players: Player[];
  promoted: number[];
  released: number[];
}

/**
 * Resolve every kid whose deal is up at the end of `endingSeason` (offseason
 * step 5.0, before the new intake arrives).
 *
 * Professional cut: the kids the user marked promote take the senior places
 * first, then the unmarked ones in `ranking` order, while the roster is under
 * ROSTER_CAP; everyone else leaves, including anyone marked release. Scholarship
 * cut: a kid marked release leaves now, and the rest are re-contracted to the
 * professional cut here; `trimAcademyToCap` takes the lowest-ranked unmarked ones
 * back out once the intake has arrived and the real headcount is known.
 * Splitting it that way is what makes the cut exact rather than a guess at how
 * many kids the intake will bring.
 */
export function resolveAcademyCheckpoints(
  teams: StoredTeam[],
  players: Player[],
  userTid: number,
  endingSeason: number,
  nextSeason: number,
  ranking: AcademyRanking,
): CheckpointResult {
  const team = teams.find((t) => t.tid === userTid);
  const due = academyDuePids(team, players, endingSeason);
  if (!team || due.size === 0) return { teams, players, promoted: [], released: [] };

  const byPid = new Map(players.map((p) => [p.pid, p]));
  const order = byRanking(ranking);
  const choice = (p: Player) => choiceFor(team, p, nextSeason);
  const dueKids = [...due].map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);

  const graduating = dueKids.filter((p) => checkpointOf(p, nextSeason) === "professional").sort(order);
  const picked = graduating.filter((p) => choice(p) === "promote");
  const unmarked = graduating.filter((p) => choice(p) === null);
  const room = Math.max(0, ROSTER_CAP - team.roster.length);
  const promoted = [...picked, ...unmarked].slice(0, room).map((p) => p.pid);
  const promotedSet = new Set(promoted);

  const scholarship = dueKids.filter((p) => checkpointOf(p, nextSeason) === "scholarship");
  const staying = scholarship.filter((p) => choice(p) !== "release");
  const released = [
    ...graduating.filter((p) => !promotedSet.has(p.pid)).map((p) => p.pid),
    ...scholarship.filter((p) => choice(p) === "release").map((p) => p.pid),
  ];
  const leaving = new Set([...promoted, ...released]);

  const updated = new Map<number, Player>();
  for (const pid of promoted) {
    const p = byPid.get(pid)!;
    // Offseason, so no charge here: the season-start wage charge picks his new
    // senior salary up with everyone else's, exactly as promoteFromAcademy does.
    const terms = contractTerms(p, nextSeason);
    updated.set(pid, { ...p, contract: { salary: terms.salary, expiresSeason: terms.expiresSeason } });
  }
  for (const p of staying) {
    const terms = academyContractTerms(nextSeason, p.born);
    updated.set(p.pid, { ...p, contract: { salary: terms.salary, expiresSeason: terms.expiresSeason } });
  }

  return {
    teams: teams.map((t) =>
      t.tid === userTid
        ? {
            ...t,
            roster: [...t.roster, ...promoted],
            academyRoster: t.academyRoster.filter((pid) => !leaving.has(pid)),
          }
        : t,
    ),
    players: updated.size === 0 ? players : players.map((p) => updated.get(p.pid) ?? p),
    promoted,
    released,
  };
}

/**
 * The scholarship cut's default, applied once the intake has arrived (offseason
 * step 5.4): while the academy is over ACADEMY_ROSTER_CAP, release the
 * lowest-ranked kid among those turning ACADEMY_SCHOLARSHIP_AGE that the user
 * hasn't marked keep.
 *
 * Only that year is ever cut. A kid still on his first deal has not reached a
 * decision, and one past the scholarship cut was kept at it, so releasing either
 * would be the rollover taking a decision nobody was in front of. The academy can
 * therefore stay over the cap — a user who signed a crowd of free agents into it
 * keeps them — which is the same convention the yearly intake follows.
 */
export function trimAcademyToCap(
  teams: StoredTeam[],
  players: Player[],
  userTid: number,
  nextSeason: number,
  ranking: AcademyRanking,
): { teams: StoredTeam[]; released: number[] } {
  const team = teams.find((t) => t.tid === userTid);
  if (!team || team.academyRoster.length <= ACADEMY_ROSTER_CAP) return { teams, released: [] };

  const byPid = new Map(players.map((p) => [p.pid, p]));
  const cuttable = team.academyRoster
    .map((pid) => byPid.get(pid))
    .filter((p): p is Player =>
      p != null
      && nextSeason - p.born === ACADEMY_SCHOLARSHIP_AGE
      && team.academyDecisions?.[p.pid] !== "keep")
    .sort(byRanking(ranking))
    .reverse();
  const excess = team.academyRoster.length - ACADEMY_ROSTER_CAP;
  const released = cuttable.slice(0, excess).map((p) => p.pid);
  if (released.length === 0) return { teams, released };

  const out = new Set(released);
  return {
    teams: teams.map((t) =>
      t.tid === userTid ? { ...t, academyRoster: t.academyRoster.filter((pid) => !out.has(pid)) } : t,
    ),
    released,
  };
}

/**
 * The user's calls are for one rollover, so the offseason drops them once it has
 * applied them. Done by removing the field rather than emptying it, so a club
 * with no calls reads exactly as it did before calls existed.
 */
export function clearAcademyDecisions(teams: StoredTeam[], tid: number): StoredTeam[] {
  return teams.map((t) => {
    if (t.tid !== tid || t.academyDecisions === undefined) return t;
    const { academyDecisions: _cleared, ...rest } = t;
    return rest;
  });
}

/**
 * How many senior players the user's club carries when the professional cut runs
 * (offseason step 5.0), replaying the steps before it that change that roster:
 * loans ending this summer (step 1, a borrowed player goes back and a lent-out one
 * comes home) and expired contracts (step 1.5, which skips anyone whose loan runs
 * on). `academyPipeline.test.ts` pins it against the real `processLoanReturns`
 * and `releaseExpiredContracts`.
 *
 * Two things are counted as staying though they might not: a senior who retires
 * over the summer (step 3 is a roll), and a borrowed player whose deal is up while
 * his loan runs on (his own club may renew him at step 1). Both can only free
 * places, so a promotion this counts on is one the rollover makes.
 */
function seniorsAtCheckpoint(
  team: StoredTeam, byPid: ReadonlyMap<number, Player>, activeLoans: readonly ActiveLoan[], season: number,
): number {
  const nextSeason = season + 1;
  const ending = activeLoans.filter((l) => l.returnSeason <= nextSeason);
  const goingBack = new Set(ending.filter((l) => l.loaneeTid === team.tid).map((l) => l.pid));
  const kept = team.roster.filter((pid) => !goingBack.has(pid));
  const keptSet = new Set(kept);
  const comingHome = ending
    .filter((l) => l.parentTid === team.tid && !keptSet.has(l.pid))
    .map((l) => l.pid);
  const runningOn = new Set(activeLoans.filter((l) => l.returnSeason > nextSeason).map((l) => l.pid));
  return [...kept, ...comingHome].filter((pid) => {
    const p = byPid.get(pid);
    return !p || p.contract.expiresSeason > season || runningOn.has(pid);
  }).length;
}

/**
 * What the next rollover will do with every kid in front of a checkpoint, the
 * user's calls included — the Academy page's column, and what its dropdowns
 * allow.
 *
 * Built from the same ranking (taken off the league as it stands, exactly as the
 * offseason takes it) and the same rules the offseason applies. What it can't
 * know it assumes on the cautious side, so `promote` and `keep` are promises and
 * `release` and `atRisk` are worst cases: the intake is taken at
 * USER_ACADEMY_INTAKE_MAX, and senior retirements over the summer are assumed
 * not to happen (see `seniorsAtCheckpoint`). The same caution sets which calls
 * fit, which is why a call the preview allows is one the rollover can honour.
 */
export function projectAcademyCheckpoints(
  team: StoredTeam,
  players: Player[],
  activeLoans: readonly ActiveLoan[],
  season: number,
  difficulty?: Difficulty,
): Map<number, AcademyDecision> {
  const out = new Map<number, AcademyDecision>();
  const due = academyDuePids(team, players, season);
  if (due.size === 0) return out;

  const nextSeason = season + 1;
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const order = byRanking(academyRanking(team, players, season, difficulty));
  const choice = (p: Player) => choiceFor(team, p, nextSeason);
  const dueKids = [...due].map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);

  // Professional cut: marked promotes go first, then unmarked kids by rank.
  const graduating = dueKids.filter((p) => checkpointOf(p, nextSeason) === "professional").sort(order);
  const picked = graduating.filter((p) => choice(p) === "promote");
  const unmarked = graduating.filter((p) => choice(p) === null);
  const room = Math.max(0, ROSTER_CAP - seniorsAtCheckpoint(team, byPid, activeLoans, season));
  const promoted = new Set([...picked, ...unmarked].slice(0, room).map((p) => p.pid));
  for (const p of graduating) {
    const c = choice(p);
    out.set(p.pid, {
      pid: p.pid,
      checkpoint: "professional",
      outcome: promoted.has(p.pid) ? "promote" : "release",
      chosen: c,
      options: { promote: c === "promote" || picked.length < room, release: true },
    });
  }

  // Scholarship cut. Everyone who has left the academy by the time the intake
  // arrives: every graduate, promoted or not, every kid marked release, and any
  // prospect whose ordinary deal lapses at step 1.5.
  const scholarship = dueKids.filter((p) => checkpointOf(p, nextSeason) === "scholarship").sort(order);
  const graduatingPids = new Set(graduating.map((p) => p.pid));
  const releasedPids = new Set(scholarship.filter((p) => choice(p) === "release").map((p) => p.pid));
  const departing = team.academyRoster.filter((pid) => {
    if (graduatingPids.has(pid) || releasedPids.has(pid)) return true;
    const p = byPid.get(pid);
    return p != null && !due.has(pid) && p.contract.expiresSeason <= season;
  }).length;
  const afterRollover = team.academyRoster.length - departing + USER_ACADEMY_INTAKE_MAX;
  const excess = Math.max(0, afterRollover - ACADEMY_ROSTER_CAP);

  // Only kids turning sixteen are ever cut. A keep protects one of them, so at
  // least `excess` must stay unmarked for the trim to have someone to take.
  const atSixteen = scholarship.filter(
    (p) => nextSeason - p.born === ACADEMY_SCHOLARSHIP_AGE && choice(p) !== "release",
  );
  const kept = atSixteen.filter((p) => choice(p) === "keep");
  const cuttable = atSixteen.filter((p) => choice(p) === null).reverse();
  const atRisk = new Set(cuttable.slice(0, excess).map((p) => p.pid));
  const keepRoom = Math.max(0, atSixteen.length - excess);
  for (const p of scholarship) {
    const c = choice(p);
    const turningSixteen = nextSeason - p.born === ACADEMY_SCHOLARSHIP_AGE;
    out.set(p.pid, {
      pid: p.pid,
      checkpoint: "scholarship",
      outcome: c === "release" ? "release" : atRisk.has(p.pid) ? "atRisk" : "keep",
      chosen: c,
      options: {
        keep: c === "keep" || !turningSixteen || kept.length < keepRoom,
        release: true,
      },
    });
  }
  return out;
}

/**
 * Record (or, with `null`, withdraw) the user's call on one academy kid at the
 * next rollover. Returns the team unchanged when the call doesn't apply: the kid
 * isn't at a checkpoint, the call belongs to the other checkpoint, or it no longer
 * fits (`AcademyDecision.options`). Checking here as well as greying out the
 * dropdown means a stale page can't store a call the rollover would have to break.
 */
export function setAcademyDecision(
  team: StoredTeam,
  players: Player[],
  activeLoans: readonly ActiveLoan[],
  season: number,
  pid: number,
  choice: AcademyChoice | null,
  difficulty?: Difficulty,
): StoredTeam {
  const current = team.academyDecisions ?? {};
  if (choice === null) {
    if (!(pid in current)) return team;
    const { [pid]: _withdrawn, ...rest } = current;
    return { ...team, academyDecisions: rest };
  }
  const decision = projectAcademyCheckpoints(team, players, activeLoans, season, difficulty).get(pid);
  if (!decision || decision.chosen === choice || !decision.options[choice]) return team;
  return { ...team, academyDecisions: { ...current, [pid]: choice } };
}
