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
 * **Undecided means the DEFAULT, and the user's decisions are the buttons that
 * already exist.** Releasing a kid early is `releaseAcademyPlayer`, promoting one
 * early is `promoteFromAcademy`, and keeping one is doing nothing. So there is
 * no stored "decision" state to migrate or keep in sync, and a user who never
 * opens the Academy still gets a working pipeline — the property the trial group
 * this replaced lacked, since an ignored trial screen emptied the academy.
 *
 * **The checkpoint IS the contract expiry.** An academy deal for a kid under the
 * professional cut runs to the season before his next checkpoint
 * (`academyCheckpointExpiry`), so every kid who reaches one is exactly the set
 * whose deal is up. The offseason keeps those kids off `releaseExpiredContracts`
 * and resolves them here instead, which is what stops a deal lapsing silently.
 *
 * **Ranked on what the user can see.** Default cuts and promotions order kids by
 * the middle of the scouting band as of the season the user is looking at, never
 * by their true potential. Ranking on the truth would make the default quietly
 * perfect and hand the hidden number back through who survived. It is also what
 * lets the Academy page preview the rollover exactly (`projectAcademyCheckpoints`).
 *
 * User's club only, pure, and rng-free.
 */
import type { Player } from "./players/types.js";
import type { StoredTeam } from "./teams/clubs.js";
import { potentialFog } from "./scouting/potentialFog.js";
import { academyContractTerms, contractTerms } from "./contracts.js";
import {
  ACADEMY_ROSTER_CAP, ACADEMY_SCHOLARSHIP_AGE, ACADEMY_GRADUATION_AGE, ROSTER_CAP,
  USER_ACADEMY_INTAKE_MAX, type Difficulty,
} from "./constants.js";

/** Which cut a kid is in front of. */
export type AcademyCheckpoint = "scholarship" | "professional";

/**
 * What the next rollover does with a kid if nobody decides. `atRisk` is the
 * scholarship cut's "released if the academy is full": the exact intake size is
 * drawn at the rollover, so a preview can only say he is below the line for the
 * largest intake possible.
 */
export type AcademyOutcome = "promote" | "release" | "keep" | "atRisk";

export interface AcademyDecision {
  pid: number;
  checkpoint: AcademyCheckpoint;
  outcome: AcademyOutcome;
}

/** Academy pids whose deal is up at the end of `season`, i.e. who reach a checkpoint. */
export function academyDuePids(
  team: StoredTeam | undefined,
  players: Player[],
  season: number,
): Set<number> {
  if (!team) return new Set();
  const inAcademy = new Set(team.academyRoster);
  return new Set(
    players
      .filter((p) => inAcademy.has(p.pid) && p.contract.expiresSeason <= season)
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

/** Best first: scouted estimate, then current rating, then pid for a stable order. */
function bestScoutedFirst(
  team: StoredTeam, viewSeason: number, difficulty?: Difficulty,
): (a: Player, b: Player) => number {
  const est = new Map<number, number>();
  const estimate = (p: Player) => {
    let v = est.get(p.pid);
    if (v === undefined) {
      v = scoutedEstimate(p, team, viewSeason, difficulty);
      est.set(p.pid, v);
    }
    return v;
  };
  return (a, b) => estimate(b) - estimate(a) || b.ovr - a.ovr || a.pid - b.pid;
}

function checkpointOf(p: Player, nextSeason: number): AcademyCheckpoint {
  return nextSeason - p.born >= ACADEMY_GRADUATION_AGE ? "professional" : "scholarship";
}

/**
 * A kid arriving from the yearly intake: his first academy deal, running to the
 * scholarship cut, and his ratings history started in the academy rather than
 * with a stray senior point before his first academy season.
 */
export function enrolAcademyYouth(p: Player, season: number): Player {
  const terms = academyContractTerms(season, p.born);
  return {
    ...p,
    contract: { salary: terms.salary, expiresSeason: terms.expiresSeason },
    hist: p.hist.map((h) => ({ ...h, academy: true })),
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
 * Professional cut: promoted onto senior terms while the roster is under
 * ROSTER_CAP, best-scouted first; the rest leave. Scholarship cut: every one is
 * re-contracted to the professional cut here, and `trimAcademyToCap` takes the
 * lowest-scouted back out once the intake has arrived and the real headcount is
 * known. Splitting it that way is what makes the cut exact rather than a guess
 * at how many kids the intake will bring.
 */
export function resolveAcademyCheckpoints(
  teams: StoredTeam[],
  players: Player[],
  userTid: number,
  endingSeason: number,
  nextSeason: number,
  difficulty?: Difficulty,
): CheckpointResult {
  const team = teams.find((t) => t.tid === userTid);
  const due = academyDuePids(team, players, endingSeason);
  if (!team || due.size === 0) return { teams, players, promoted: [], released: [] };

  const byPid = new Map(players.map((p) => [p.pid, p]));
  const dueKids = [...due].map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);
  const graduating = dueKids
    .filter((p) => checkpointOf(p, nextSeason) === "professional")
    .sort(bestScoutedFirst(team, endingSeason, difficulty));
  const staying = dueKids.filter((p) => checkpointOf(p, nextSeason) === "scholarship");

  const room = Math.max(0, ROSTER_CAP - team.roster.length);
  const promoted = graduating.slice(0, room).map((p) => p.pid);
  const released = graduating.slice(room).map((p) => p.pid);
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
 * step 5.4): while the academy is over ACADEMY_ROSTER_CAP, release the kid the
 * user's scouts rate lowest among those turning ACADEMY_SCHOLARSHIP_AGE.
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
  viewSeason: number,
  nextSeason: number,
  difficulty?: Difficulty,
): { teams: StoredTeam[]; released: number[] } {
  const team = teams.find((t) => t.tid === userTid);
  if (!team || team.academyRoster.length <= ACADEMY_ROSTER_CAP) return { teams, released: [] };

  const byPid = new Map(players.map((p) => [p.pid, p]));
  const cuttable = team.academyRoster
    .map((pid) => byPid.get(pid))
    .filter((p): p is Player => p != null && nextSeason - p.born === ACADEMY_SCHOLARSHIP_AGE)
    .sort(bestScoutedFirst(team, viewSeason, difficulty))
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
 * What the next rollover will do with every kid in front of a checkpoint, if
 * nobody decides first — the Academy page's preview.
 *
 * Built from the same ranking and the same rules the offseason applies, so the
 * page and the rollover cannot disagree about who is promoted. Two inputs are
 * unknowable in advance and are assumed on the cautious side: the intake is
 * taken at USER_ACADEMY_INTAKE_MAX (hence `atRisk` rather than `release` at the
 * scholarship cut), and senior room counts every expiring senior deal as gone.
 */
export function projectAcademyCheckpoints(
  team: StoredTeam,
  players: Player[],
  season: number,
  difficulty?: Difficulty,
): Map<number, AcademyDecision> {
  const out = new Map<number, AcademyDecision>();
  const due = academyDuePids(team, players, season);
  if (due.size === 0) return out;

  const nextSeason = season + 1;
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const order = bestScoutedFirst(team, season, difficulty);
  const dueKids = [...due].map((pid) => byPid.get(pid)).filter((p): p is Player => p != null);

  const graduating = dueKids.filter((p) => checkpointOf(p, nextSeason) === "professional").sort(order);
  const seniorsStaying = team.roster.filter(
    (pid) => (byPid.get(pid)?.contract.expiresSeason ?? Infinity) > season,
  ).length;
  const room = Math.max(0, ROSTER_CAP - seniorsStaying);
  graduating.forEach((p, i) =>
    out.set(p.pid, { pid: p.pid, checkpoint: "professional", outcome: i < room ? "promote" : "release" }),
  );

  const scholarship = dueKids.filter((p) => checkpointOf(p, nextSeason) === "scholarship");
  const afterRollover =
    team.academyRoster.length - graduating.length + USER_ACADEMY_INTAKE_MAX;
  const excess = Math.max(0, afterRollover - ACADEMY_ROSTER_CAP);
  const cuttable = scholarship
    .filter((p) => nextSeason - p.born === ACADEMY_SCHOLARSHIP_AGE)
    .sort(order)
    .reverse();
  const atRisk = new Set(cuttable.slice(0, excess).map((p) => p.pid));
  for (const p of scholarship) {
    out.set(p.pid, {
      pid: p.pid, checkpoint: "scholarship", outcome: atRisk.has(p.pid) ? "atRisk" : "keep",
    });
  }
  return out;
}
