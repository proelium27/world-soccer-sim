import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { LeagueStore } from "../../core/leagueState.js";
import type { SimThrough, IntlMode } from "../../worker/protocol.js";
import { useSimWorker, type SimProgress, type JumpProgressUpdate } from "../useSimWorker.js";
import { saveLeague, loadLeague } from "../../db/leagueDb.js";
import { loadCrests, saveCrests } from "../../db/crestDb.js";
import { getActiveLid, setActiveLid, clearActiveLid } from "../../db/activeLeague.js";
import { setSeasonStartYear } from "../format.js";
import { exportLeagueJSON, importLeagueJSON } from "../../db/exportImport.js";
import {
  signFreeAgent, releasePlayer, signToAcademy, promoteFromAcademy, releaseAcademyPlayer,
  signTrialist,
} from "../../core/freeAgency.js";
import { scoutDirectionsOf, type ScoutDirections } from "../../core/scouting/scoutDirections.js";
import { clampScoutingSpend } from "../../core/finance/scouting.js";
import type { ProposedClause } from "../../core/transfers/clauses.js";
import { makeTransferOffer, acceptCounterOffer, FREE_AGENT_TID } from "../../core/transfers/negotiation.js";
import { freeAgentSigningWindow } from "../../core/transfers/window.js";
import {
  acceptInboundOffer, rejectInboundOffer, counterInboundOffer, setTransferListed,
} from "../../core/transfers/inboundOffers.js";
import { setMoreMinutes } from "../../core/lineup/moreMinutes.js";
import { toggleWatched } from "../../core/watchlist.js";
import { extendContract, extendAcademyContract } from "../../core/contracts.js";
import type { RenewalGroup } from "../../core/contractRenewal.js";
import { renewalsDue, extendAllContracts } from "../../core/contractRenewal.js";
import {
  listPlayerForLoan, unlistPlayerForLoan, acceptLoanOffer, rejectLoanOffer,
} from "../../core/loans.js";
import { wouldRefuseExtension } from "../../core/ai/breakoutRefusal.js";
import { applyTeamIdentities, type TeamIdentityEdit } from "../../core/teams/customize.js";
import {
  movePlayerToClub, detachPlayer, applyPlayerEdit, createCustomPlayer, setClubFinances,
  type PlayerEdit, type NewPlayerSpec,
} from "../../core/godMode.js";
import { switchClub } from "../../core/manager/switchClub.js";
import { takeNationalJob, leaveNationalJob } from "../../core/nationalManager/index.js";
import {
  editableSquad, writeSquad, isValidNationSquad, squadRating, isEligibleNation,
} from "../../core/international/index.js";
import { isSpectator } from "../../core/spectator.js";
import { isManagerDecisionPending } from "../../core/manager/index.js";
import { isValidStarters } from "../../core/lineup/resolveXI.js";
import { teamSlots, chooseBestFormation, FORMATIONS, FORMATION_IDS, type FormationId } from "../../core/lineup/formations.js";
import { SimOverlay } from "../components/SimOverlay.js";
import { LiveMatchOverlay } from "../components/LiveMatchOverlay.js";
import { LiveMatchPicker } from "../components/LiveMatchPicker.js";
import { JumpOverlay, type JumpResult } from "../components/JumpOverlay.js";
import { liveCandidates, type LiveCandidate } from "../live/liveCandidates.js";
import { playSuperCups, superCupsPending } from "../../core/superCup/superCup.js";
import { superCupChampion } from "../../core/superCup/types.js";
import { usePlayerMap } from "../usePlayerMap.js";
import type { PlayedMatch } from "../../core/standings.js";
import { trackEvent } from "../analytics.js";

interface LeagueContextValue {
  league: LeagueStore | null;
  loadingActiveLeague: boolean;
  /**
   * Custom club badges for the active save, as tid -> data URL.
   *
   * Not part of `league`, and that is deliberate rather than incidental: crest
   * art is megabytes and the league record is rewritten in full on every
   * mutation and cloned to the worker on every sim (see src/db/database.ts).
   * It lives in its own store and is loaded alongside the league instead.
   */
  crests: ReadonlyMap<number, string>;
  setLeague: (l: LeagueStore, crests?: ReadonlyMap<number, string>) => void;
  loadLeagueAction: (lid: number) => Promise<void>;
  switchLeagueAction: () => void;
  customizeTeamsAction: (lid: number, edits: TeamIdentityEdit[]) => Promise<void>;
  /** Overlay a parsed roster file onto a save (identities + optional real squads). Returns a summary of what changed. */
  simAction: (through: SimThrough) => Promise<void>;
  /**
   * Play the next matchday and watch your club's match minute by minute.
   * Same sim as simAction("game") — the result is already decided before the
   * first whistle; the viewer replays its recorded event stream. The matchday
   * is not committed until the viewer is closed.
   */
  simLiveAction: () => Promise<void>;
  /** Play `seasons` whole seasons with the AI managing the user's club (core/autopilot.ts). */
  jumpSeasonsAction: (seasons: number) => Promise<void>;
  offseasonAction: () => Promise<void>;
  /** Play the next staged international stage ("stage") or every remaining one ("through"). */
  intlStageAction: (mode: IntlMode) => Promise<void>;
  signFreeAgentAction: (pid: number) => Promise<void>;
  releasePlayerAction: (pid: number) => Promise<void>;
  signToAcademyAction: (pid: number) => Promise<void>;
  /** Sign one of this year's youth trialists into the academy. */
  signTrialistAction: (pid: number) => Promise<void>;
  /**
   * Set what the youth scouts have been told — countries and positions — as a
   * partial, so a panel can change one without restating the other. See
   * ScoutDirections.
   */
  setScoutDirectionsAction: (next: Partial<ScoutDirections>) => Promise<void>;
  promoteFromAcademyAction: (pid: number) => Promise<void>;
  releaseAcademyPlayerAction: (pid: number) => Promise<void>;
  extendAcademyContractAction: (pid: number) => Promise<void>;
  setScoutingSpendAction: (spend: number) => Promise<void>;
  makeOfferAction: (pid: number, amount: number, clauses?: ProposedClause[]) => Promise<void>;
  acceptCounterAction: (pid: number, clauses?: ProposedClause[]) => Promise<void>;
  acceptInboundOfferAction: (pid: number, clauses?: ProposedClause[]) => Promise<void>;
  rejectInboundOfferAction: (pid: number) => Promise<void>;
  counterInboundOfferAction: (pid: number, amount: number, clauses?: ProposedClause[]) => Promise<void>;
  extendContractAction: (pid: number, lengthSeasons?: number) => Promise<void>;
  extendAllContractsAction: (group: RenewalGroup) => Promise<void>;
  listPlayerForLoanAction: (pid: number, seasons: 1 | 2 | 3) => Promise<void>;
  unlistPlayerForLoanAction: (pid: number) => Promise<void>;
  acceptLoanOfferAction: (pid: number) => Promise<void>;
  rejectLoanOfferAction: (pid: number) => Promise<void>;
  setTransferListedAction: (pid: number, listed: boolean) => Promise<void>;
  setMoreMinutesAction: (pid: number, enabled: boolean) => Promise<void>;
  /** Star or unstar any player in the world — the /watchlist shortlist. */
  toggleWatchedAction: (pid: number) => Promise<void>;
  setLineupAction: (starters: number[]) => Promise<void>;
  setFormationAction: (formation: FormationId) => Promise<void>;
  autoPickBestXIAction: () => Promise<void>;
  playSuperCupsAction: () => Promise<void>;
  // God Mode sandbox actions (no-ops in the UI unless league.godMode is true).
  setGodModeAction: (on: boolean) => Promise<void>;
  /** Take one of the jobs on the table, handing the current club to the AI. */
  acceptJobOfferAction: (tid: number) => Promise<void>;
  /** Turn down every offer and stay put. Only available while you still have a job. */
  declineJobOffersAction: () => Promise<void>;
  /** Save-level switch for whether the board can sack you at all. */
  setSackingEnabledAction: (on: boolean) => Promise<void>;
  /** Take charge of a national team, leaving whichever one you had. */
  takeNationalJobAction: (nation: string) => Promise<void>;
  /** Step down from the national job, going back to club football only. */
  leaveNationalJobAction: () => Promise<void>;
  /** Turn down every national approach on the table. */
  declineNationalOffersAction: () => Promise<void>;
  /** Save-level switch for whether a federation can dismiss you. */
  setNationalSackingEnabledAction: (on: boolean) => Promise<void>;
  /** Name the 23 for your nation's current campaign. */
  setNationalSquadAction: (pids: number[]) => Promise<void>;
  /** Pick your nation's starting eleven. */
  setNationalLineupAction: (starters: number[]) => Promise<void>;
  /** Change your nation's shape, clearing the manual eleven so it re-picks. */
  setNationalFormationAction: (formation: FormationId) => Promise<void>;
  /** Let the game pick your nation's best shape and eleven. */
  autoPickNationalXIAction: () => Promise<void>;
  /**
   * God Mode: take charge of any club in the world, right now, with no offer
   * and no offseason. Same handover as accepting a job offer.
   */
  godModeSwitchClubAction: (tid: number) => Promise<void>;
  /** God Mode: take charge of any country, offer or not. */
  godModeTakeNationalJobAction: (nation: string) => Promise<void>;
  movePlayerToClubAction: (pid: number, tid: number) => Promise<void>;
  releasePlayerGodModeAction: (pid: number) => Promise<void>;
  editPlayerAction: (pid: number, edit: PlayerEdit) => Promise<void>;
  createPlayerAction: (spec: NewPlayerSpec) => Promise<void>;
  setClubFinancesAction: (tid: number, budget: number, hype: number) => Promise<void>;
  simming: boolean;
  saveToDb: () => Promise<void>;
  exportJSON: () => void;
  importJSON: (file: File) => Promise<void>;
}

/**
 * The empty badge set, as one shared object.
 *
 * A fresh `new Map()` per commit would be a new context value on every
 * mutation, which would re-render every `ClubCrest` on the page — on the news
 * feed that is thousands of them — for a save that has no custom badges at all,
 * which is nearly every save.
 */
const NO_CRESTS: ReadonlyMap<number, string> = new Map();

const Ctx = createContext<LeagueContextValue | null>(null);

export function useLeague(): LeagueContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLeague must be inside LeagueProvider");
  return ctx;
}

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [league, setLeagueState] = useState<LeagueStore | null>(null);
  const [crests, setCrests] = useState<ReadonlyMap<number, string>>(NO_CRESTS);
  const [loadingActiveLeague, setLoadingActiveLeague] = useState(
    () => getActiveLid() !== null,
  );
  const { sim, runOffseason, runIntlStage, runJump, simming } = useSimWorker();

  // A multi-season jump owns the screen the same way the sim overlay does, and
  // for the same reason: the league it returns replaces several seasons of
  // state, so nothing else may act on the league meanwhile. Its progress is
  // held here rather than in the context value so a per-season tick doesn't
  // re-render every consumer (see the memo comment further down).
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpProgress, setJumpProgress] = useState<JumpProgressUpdate | null>(null);
  const [jumpResult, setJumpResult] = useState<JumpResult | null>(null);
  const jumpOpenRef = useRef(false);

  const [simOverlayOpen, setSimOverlayOpen] = useState(false);
  const [animQueue, setAnimQueue] = useState<SimProgress[]>([]);
  const [animDone, setAnimDone] = useState(false);
  const pendingResultRef = useRef<LeagueStore | null>(null);
  const overlayOpenRef = useRef(false);

  // Everything the live match viewer needs, captured from the pre-sim league
  // plus the simmed matchday. Null whenever no match is being watched.
  const [watchable, setLiveCandidates] = useState<LiveCandidate[] | null>(null);
  // Which candidate is being watched. Null while the picker is up, which only
  // happens when the matchday offered more than one.
  const [liveChoice, setLiveChoice] = useState<string | null>(null);
  const liveOpenRef = useRef(false);
  // The viewer names scorers and bookings, so it needs the pid lookup. Memoized
  // on the players array, so it is rebuilt once per commit rather than per tick
  // of the match clock.
  const playerMap = usePlayerMap(league?.players);
  const playerName = useCallback(
    (pid: number) => playerMap.get(pid)?.name ?? `Player ${pid}`,
    [playerMap],
  );

  // Every league mutation runs through runExclusive and reads the league from
  // leagueRef at execution time. React state alone isn't enough: a callback
  // captures the league from the render it was created in, so two actions
  // fired inside one save's IndexedDB round-trip would both compute from the
  // same stale snapshot and the second save would silently revert the first
  // (lost update). The ref gives queued actions the freshest committed value;
  // the promise chain guarantees only one read-modify-save runs at a time.
  const leagueRef = useRef<LeagueStore | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingOpsRef = useRef(0);
  const [busy, setBusy] = useState(false);

  /**
   * Which save's badges `crests` currently holds, so a commit that isn't a
   * change of save doesn't re-read them. `commitLeague` runs on every mutation
   * — a lineup drag, a signing, every matchday — and the badges only ever
   * change when a pack is imported, so keying the load on the lid is the
   * difference between one read per save and one per action.
   *
   * Doubles as the guard against a slow read landing after the user has moved
   * on: the resolved map is only adopted while the lid it was read for is still
   * the one on screen.
   */
  const crestLidRef = useRef<number | null>(null);

  const adoptCrests = useCallback(
    (lid: number | null, known?: ReadonlyMap<number, string>) => {
      if (lid === null || !lid) {
        crestLidRef.current = null;
        setCrests(NO_CRESTS);
        return;
      }
      // The caller already has them — a pack just imported, or a save just
      // brought in from a file — so there is nothing to read back.
      if (known) {
        crestLidRef.current = lid;
        setCrests(known);
        return;
      }
      if (crestLidRef.current === lid) return;
      crestLidRef.current = lid;
      setCrests(NO_CRESTS);
      loadCrests(lid).then((m) => {
        if (crestLidRef.current === lid) setCrests(m);
      });
    },
    [],
  );

  const commitLeague = useCallback((l: LeagueStore | null, knownCrests?: ReadonlyMap<number, string>) => {
    leagueRef.current = l;
    // Every league — loaded, created, imported, or switched away from — passes
    // through here, which is why the season→year display offset is set here
    // rather than at the ~90 places that format a season (see format.ts). The
    // badges follow for the same reason: one funnel, so no action can forget.
    setSeasonStartYear(l?.meta.startYear);
    adoptCrests(l?.lid ?? null, knownCrests);
    setLeagueState(l);
  }, [adoptCrests]);

  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    pendingOpsRef.current++;
    setBusy(true);
    const run = chainRef.current.then(fn).finally(() => {
      pendingOpsRef.current--;
      if (pendingOpsRef.current === 0) setBusy(false);
    });
    chainRef.current = run.catch(() => {});
    return run;
  }, []);

  /** Serialized read-modify-save; `fn` returning null (or the input) is a no-op. */
  const mutate = useCallback(
    (fn: (league: LeagueStore) => LeagueStore | null) =>
      runExclusive(async () => {
        const current = leagueRef.current;
        if (!current) return;
        const updated = fn(current);
        if (!updated || updated === current) return;
        const lid = await saveLeague(updated);
        commitLeague({ ...updated, lid });
      }),
    [runExclusive, commitLeague],
  );

  useEffect(() => {
    const activeLid = getActiveLid();
    if (activeLid === null) return;
    loadLeague(activeLid).then((l) => {
      if (l) commitLeague(l);
      else clearActiveLid();
      setLoadingActiveLeague(false);
    });
  }, [commitLeague]);

  /**
   * Persist a league and make it the active one, optionally with the custom
   * badges it was created with.
   *
   * The badges are a second argument rather than a separate action because they
   * cannot be written before the league is: a fresh save has no lid until
   * IndexedDB assigns one, and the crest rows are keyed by it. Passing them here
   * means the only caller that has any (the new-league screen) hands them over
   * once and never has to think about the ordering.
   */
  const setLeague = useCallback(async (l: LeagueStore, crests?: ReadonlyMap<number, string>) => {
    const lid = await saveLeague(l);
    const saved = { ...l, lid };
    if (crests && crests.size > 0) await saveCrests(lid, crests);
    setActiveLid(lid);
    commitLeague(saved, crests);
  }, [commitLeague]);

  const loadLeagueAction = useCallback(async (lid: number) => {
    const l = await loadLeague(lid);
    if (l) {
      setActiveLid(lid);
      commitLeague(l);
    }
  }, [commitLeague]);

  const switchLeagueAction = useCallback(() => {
    clearActiveLid();
    commitLeague(null);
  }, [commitLeague]);

  // Unlike the mutate-based actions this can target any save, not just the
  // active one — but it still runs through the exclusive chain, and if the
  // edited save IS the active league the fresh copy is committed so the
  // in-memory state can't later overwrite the customization with stale data.
  const customizeTeamsAction = useCallback(
    (lid: number, edits: TeamIdentityEdit[]) =>
      runExclusive(async () => {
        const active = leagueRef.current;
        const target = active?.lid === lid ? active : await loadLeague(lid);
        if (!target) return;
        const updated = applyTeamIdentities(target, edits);
        await saveLeague(updated);
        if (active?.lid === lid) commitLeague(updated);
      }),
    [runExclusive, commitLeague],
  );

  const closeOverlay = useCallback(() => {
    overlayOpenRef.current = false;
    setSimOverlayOpen(false);
    setAnimQueue([]);
    setAnimDone(false);
  }, []);

  const finishSimAnimation = useCallback(() => runExclusive(async () => {
    const result = pendingResultRef.current;
    pendingResultRef.current = null;
    // Persist before dropping the overlay: the overlay is what blocks other
    // actions, so closing it first would open a window where a click reads
    // pre-sim state and gets clobbered by this save.
    if (result) {
      const lid = await saveLeague(result);
      commitLeague({ ...result, lid });
    }
    closeOverlay();
  }), [runExclusive, commitLeague, closeOverlay]);

  const simAction = useCallback((through: SimThrough) => runExclusive(async () => {
    const current = leagueRef.current;
    if (!current || overlayOpenRef.current) return;
    setAnimQueue([]);
    setAnimDone(false);
    overlayOpenRef.current = true;
    setSimOverlayOpen(true);
    try {
      const result = await sim(through, current, (progress) => {
        setAnimQueue((q) => [...q, progress]);
      });
      // Reference equality can't survive the worker's structured clone, so
      // detect a no-op sim by comparing played-game counts.
      if (result.played.length === current.played.length) {
        // Nothing was simmed (e.g. no schedule left) — skip the overlay.
        pendingResultRef.current = null;
        closeOverlay();
        return;
      }
      pendingResultRef.current = result;
      setAnimDone(true);
      // How far a "sim to matchday" run actually went — bucketed, since the
      // raw number would be a high-cardinality property.
      const matchdaysPlayed =
        new Set(current.schedule.map((g) => g.matchday)).size -
        new Set(result.schedule.map((g) => g.matchday)).size;
      trackEvent("season_simmed", {
        through: typeof through === "object" ? "matchday" : through,
        matchdays:
          matchdaysPlayed <= 1 ? "1"
          : matchdaysPlayed <= 5 ? "2-5"
          : matchdaysPlayed <= 15 ? "6-15"
          : "16+",
      });
    } catch (err) {
      pendingResultRef.current = null;
      closeOverlay();
      console.error("Simulation failed:", err);
    }
  }), [runExclusive, sim, closeOverlay]);

  /**
   * Commit the watched matchday and close the viewer.
   *
   * The result has been sitting in pendingResultRef since before kickoff — the
   * match was simulated up front and only *shown* over the following minutes —
   * so this is the same commit the normal sim does, just deferred. Deferring it
   * is what lets a later version re-run the matchday with a substitution the
   * user made while watching, rather than having to undo a committed one.
   */
  const finishLiveMatch = useCallback(() => runExclusive(async () => {
    const result = pendingResultRef.current;
    pendingResultRef.current = null;
    // Persist before clearing the viewer, for the same reason the sim overlay
    // does: the viewer is what blocks every other action.
    if (result) {
      const lid = await saveLeague(result);
      commitLeague({ ...result, lid });
    }
    liveOpenRef.current = false;
    setLiveCandidates(null);
    setLiveChoice(null);
  }), [runExclusive, commitLeague]);

  const simLiveAction = useCallback(() => runExclusive(async () => {
    const current = leagueRef.current;
    if (!current || overlayOpenRef.current || liveOpenRef.current) return;
    try {
      // The progress callback hands over the matchday's results directly, which
      // saves picking them back out of the returned league by matchday number.
      let mdResults: PlayedMatch[] = [];
      const result = await sim("game", current, (progress) => {
        mdResults = progress.results;
      });
      // Reference equality can't survive the worker's structured clone, so
      // detect a no-op sim by comparing played-game counts.
      if (result.played.length === current.played.length) return;

      const clubName = (tid: number) =>
        current.teams.find((t) => t.tid === tid)?.name ?? `#${tid}`;
      // A cup matchday is an ordinary league matchday too, so this can hand
      // back two matches — the cup tie and the league fixture.
      const candidates = liveCandidates(current, result, mdResults, clubName);
      if (candidates.length === 0) {
        // Nothing of the user's to watch — commit it like an ordinary sim
        // rather than opening an empty viewer.
        const lid = await saveLeague(result);
        commitLeague({ ...result, lid });
        return;
      }

      pendingResultRef.current = result;
      liveOpenRef.current = true;
      setLiveCandidates(candidates);
      // Only ask when there is genuinely a choice to make.
      setLiveChoice(candidates.length === 1 ? candidates[0].key : null);
      trackEvent("season_simmed", { through: "game", live: true });
    } catch (err) {
      pendingResultRef.current = null;
      liveOpenRef.current = false;
      setLiveCandidates(null);
      setLiveChoice(null);
      console.error("Live simulation failed:", err);
    }
  }), [runExclusive, sim, commitLeague]);

  /**
   * Jump forward whole seasons with the AI running the club.
   *
   * Committed in one write at the end rather than season by season: the worker
   * holds the only copy while it runs, and a half-jumped save on disk would be
   * a save whose owner spent five seasons somewhere they never chose to be. If
   * it throws, the pre-jump league is simply still the committed one.
   */
  const jumpSeasonsAction = useCallback((seasons: number) => runExclusive(async () => {
    const current = leagueRef.current;
    if (!current || overlayOpenRef.current || liveOpenRef.current || jumpOpenRef.current) return;
    const from = current.season;
    jumpOpenRef.current = true;
    setJumpProgress(null);
    setJumpResult(null);
    setJumpOpen(true);
    try {
      const result = await runJump(seasons, current, setJumpProgress);
      const lid = await saveLeague(result);
      const saved = { ...result, lid };
      commitLeague(saved);
      // Which seasons the AI actually picked the team for — the tail of the
      // save's own record, so the recap can't disagree with the history page.
      setJumpResult({
        league: saved,
        managedSeasons: saved.aiManagedSeasons.filter((s) => s >= from),
      });
      const jumped = saved.season - from;
      trackEvent("seasons_jumped", {
        seasons:
          jumped <= 1 ? "1"
          : jumped <= 5 ? "2-5"
          : jumped <= 10 ? "6-10"
          : "11+",
      });
    } catch (err) {
      jumpOpenRef.current = false;
      setJumpOpen(false);
      setJumpProgress(null);
      console.error("Season jump failed:", err);
    }
  }), [runExclusive, runJump, commitLeague]);

  /**
   * Dismissing the recap lands the user on Season History.
   *
   * A jump is the one action that plays years of the whole world without the
   * user seeing a screen of it, and the recap answers only half of that: it is
   * their club's seasons. Who won everything else is exactly what they are
   * about to go looking for, and clicking through twenty seasons of the Awards
   * and cup pages to find out is the complaint that page was built for.
   *
   * The navigation lives here rather than in `JumpOverlay` because this is the
   * only thing that closes it — the overlay renders its button solely in the
   * finished state, so there is no path that dismisses a running or failed jump
   * through here (a failure clears the overlay in `jumpSeasonsAction`'s catch).
   * It also keeps the overlay a presentational component its render test can
   * mount without a router.
   */
  const navigate = useNavigate();
  const closeJump = useCallback(() => {
    jumpOpenRef.current = false;
    setJumpOpen(false);
    setJumpProgress(null);
    setJumpResult(null);
    navigate("/season-history");
  }, [navigate]);

  const offseasonAction = useCallback(() => runExclusive(async () => {
    const current = leagueRef.current;
    if (!current) return;
    // A sacked manager has to answer the offer list before the save moves on.
    // The Dashboard swaps its Advance button for that gate, but /set-scouting
    // renders on phase alone and its own button calls straight through here, so
    // a typed URL or a back-navigation would otherwise advance the season with
    // `sacked` still set and offers belonging to a season that has gone.
    if (isManagerDecisionPending(current.manager)) return;
    try {
      const result = await runOffseason(current);
      // Offers belong to the boundary that produced them. Left in place they
      // survive into the next season, where accepting one is neither the job
      // the user was offered nor a move `switchClub` is safe to make.
      const advanced = { ...result, manager: { ...result.manager, offers: [] } };
      const lid = await saveLeague(advanced);
      commitLeague({ ...advanced, lid });
      trackEvent("offseason_advanced");
    } catch (err) {
      console.error("Offseason failed:", err);
    }
  }), [runExclusive, runOffseason, commitLeague]);

  const intlStageAction = useCallback((mode: IntlMode) => runExclusive(async () => {
    const current = leagueRef.current;
    if (!current) return;
    try {
      const result = await runIntlStage(mode, current);
      const lid = await saveLeague(result);
      commitLeague({ ...result, lid });
      trackEvent("intl_stage_played", { mode });
    } catch (err) {
      console.error("International stage failed:", err);
    }
  }), [runExclusive, runIntlStage, commitLeague]);

  const signFreeAgentAction = useCallback((pid: number) => mutate((l) => {
    const { teams, players } = signFreeAgent(
      l.teams,
      l.players,
      l.meta.userTid,
      pid,
      l.season,
      l.phase,
      l.activeLoans,
    );
    if (teams === l.teams && players === l.players) return null;
    trackEvent("free_agent_signed");
    // Log the signing as a fee-0 transfer FROM the free-agent sentinel so the
    // player's club-by-season history (profile, OVR chart, champion credit)
    // and the News Feed register that he joined this club — an unrecorded
    // free-agent arrival used to be silently attributed to whatever club his
    // last paid move landed him at.
    const { season, window } = freeAgentSigningWindow(l);
    return {
      ...l, teams, players,
      transfers: [
        ...l.transfers,
        { pid, fromTid: FREE_AGENT_TID, toTid: l.meta.userTid, fee: 0, season, window },
      ],
    };
  }), [mutate]);

  const makeOfferAction = useCallback((pid: number, amount: number, clauses: ProposedClause[] = []) => mutate(
    (l) => {
      const updated = makeTransferOffer(l, pid, amount, clauses);
      if (updated && updated !== l) trackEvent("transfer_offer_made");
      return updated;
    },
  ), [mutate]);

  const acceptCounterAction = useCallback((pid: number, clauses: ProposedClause[] = []) => mutate(
    (l) => acceptCounterOffer(l, pid, clauses),
  ), [mutate]);

  const acceptInboundOfferAction = useCallback((pid: number, clauses: ProposedClause[] = []) => mutate(
    (l) => {
      const updated = acceptInboundOffer(l, pid, clauses);
      if (updated && updated !== l) trackEvent("inbound_offer_accepted");
      return updated;
    },
  ), [mutate]);

  const rejectInboundOfferAction = useCallback((pid: number) => mutate(
    (l) => rejectInboundOffer(l, pid),
  ), [mutate]);

  const counterInboundOfferAction = useCallback((pid: number, amount: number, clauses: ProposedClause[] = []) => mutate(
    (l) => counterInboundOffer(l, pid, amount, clauses),
  ), [mutate]);

  const extendContractAction = useCallback((pid: number, lengthSeasons?: number) => mutate((l) => {
    const player = l.players.find((p) => p.pid === pid);
    // The club he belongs to, which on a loan is not the club he's rostered
    // at: the parent owns the contract, and it's the parent's division the
    // refusal check is about. Looking him up by roster would ask whether he'd
    // re-sign for the club borrowing him.
    const loan = l.activeLoans.find((a) => a.pid === pid);
    const team = loan
      ? l.teams.find((t) => t.tid === loan.parentTid)
      : l.teams.find((t) => t.roster.includes(pid));
    if (player && team && wouldRefuseExtension(player, team, l.competitions)) return null;
    trackEvent("contract_extended");
    return { ...l, players: extendContract(l.players, pid, l.season, lengthSeasons) };
  }), [mutate]);

  // Re-signs a whole group in ONE commit rather than looping the single-player
  // action: each mutate writes the save, so N calls would be N IndexedDB
  // writes serialized through the promise chain.
  const extendAllContractsAction = useCallback((group: RenewalGroup) => mutate((l) => {
    const { pids } = renewalsDue(l, group);
    if (pids.length === 0) return null;
    trackEvent("contracts_extended_all", {
      group,
      // Bucketed for the same reason season_simmed.matchdays is: a raw count
      // would be a high-cardinality property.
      count: pids.length <= 1 ? "1" : pids.length <= 5 ? "2-5" : pids.length <= 15 ? "6-15" : "16+",
    });
    return extendAllContracts(l, group);
  }), [mutate]);

  const setTransferListedAction = useCallback((pid: number, listed: boolean) => mutate(
    (l) => setTransferListed(l, pid, listed),
  ), [mutate]);

  const setMoreMinutesAction = useCallback((pid: number, enabled: boolean) => mutate(
    (l) => setMoreMinutes(l, pid, enabled),
  ), [mutate]);

  const toggleWatchedAction = useCallback((pid: number) => mutate(
    (l) => toggleWatched(l, pid),
  ), [mutate]);

  const releasePlayerAction = useCallback((pid: number) => mutate((l) => {
    const teams = releasePlayer(l.teams, l.players, l.meta.userTid, pid);
    if (teams === l.teams) return null;
    trackEvent("player_released");
    return { ...l, teams };
  }), [mutate]);

  const signToAcademyAction = useCallback((pid: number) => mutate((l) => {
    const { teams, players } = signToAcademy(
      l.teams, l.players, l.meta.userTid, pid, l.season, l.phase, l.activeLoans,
    );
    if (teams === l.teams && players === l.players) return null;
    trackEvent("player_signed_to_academy");
    // An academy signing is a free arrival at the club just like a senior one,
    // so it gets the same fee-0 sentinel record. Without it his history would
    // still name whichever club last had a record for him (now more often, not
    // less, since AI free signings are logged) while he sits in your academy.
    // Promotion academy -> senior needs no record: same club, so the owner this
    // record establishes is already correct.
    const { season, window } = freeAgentSigningWindow(l);
    return {
      ...l, teams, players,
      transfers: [
        ...l.transfers,
        { pid, fromTid: FREE_AGENT_TID, toTid: l.meta.userTid, fee: 0, season, window },
      ],
    };
  }), [mutate]);

  const signTrialistAction = useCallback((pid: number) => mutate((l) => {
    const { teams, players } = signTrialist(
      l.teams, l.players, l.meta.userTid, pid, l.season, l.phase,
    );
    if (teams === l.teams && players === l.players) return null;
    // Reuses the academy event rather than adding one: the analytics set is
    // deliberately "a handful of meaningful moments, not one event per click"
    // (see analytics.ts), and this is an academy signing by another route.
    trackEvent("player_signed_to_academy");
    // Same fee-0 sentinel record an academy signing gets: he arrives at the
    // club from nowhere, and without it his club-by-season history would name
    // whichever club last had a record for him (none, for a youth product).
    const { season, window } = freeAgentSigningWindow(l);
    return {
      ...l, teams, players,
      transfers: [
        ...l.transfers,
        { pid, fromTid: FREE_AGENT_TID, toTid: l.meta.userTid, fee: 0, season, window },
      ],
    };
  }), [mutate]);

  const setScoutDirectionsAction = useCallback((next: Partial<ScoutDirections>) => mutate((l) => {
    const team = l.teams.find((t) => t.tid === l.meta.userTid);
    if (!team) return null;
    // Sanitized here rather than trusted from the panel, for the same reason
    // the offseason sanitizes on the way out: this is persisted state, and a
    // save can reach it from an older build or a hand edit.
    const current = scoutDirectionsOf(team);
    const clean = scoutDirectionsOf({
      scoutingRegions: next.regions ?? current.regions,
      scoutingPositions: next.positions ?? current.positions,
    });
    const sameList = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    // Every mutate writes the whole save, so a no-op change must not.
    if (sameList(current.regions, clean.regions)
      && sameList(current.positions, clean.positions)) return null;
    return {
      ...l,
      teams: l.teams.map((t) => (t.tid === l.meta.userTid
        ? { ...t, scoutingRegions: clean.regions, scoutingPositions: clean.positions }
        : t)),
    };
  }), [mutate]);

  const promoteFromAcademyAction = useCallback((pid: number) => mutate((l) => {
    const { teams, players } = promoteFromAcademy(
      l.teams, l.players, l.meta.userTid, pid, l.season, l.phase,
    );
    if (teams === l.teams && players === l.players) return null;
    trackEvent("player_promoted_from_academy");
    return { ...l, teams, players };
  }), [mutate]);

  const releaseAcademyPlayerAction = useCallback((pid: number) => mutate((l) => {
    const teams = releaseAcademyPlayer(l.teams, l.meta.userTid, pid);
    if (teams === l.teams) return null;
    return { ...l, teams };
  }), [mutate]);

  const extendAcademyContractAction = useCallback((pid: number) => mutate(
    (l) => ({ ...l, players: extendAcademyContract(l.players, pid, l.season) }),
  ), [mutate]);

  const listPlayerForLoanAction = useCallback((pid: number, seasons: 1 | 2 | 3) => mutate(
    (l) => {
      const updated = listPlayerForLoan(l, pid, seasons);
      if (updated && updated !== l) trackEvent("player_loaned_out", { seasons });
      return updated;
    },
  ), [mutate]);

  const unlistPlayerForLoanAction = useCallback((pid: number) => mutate(
    (l) => unlistPlayerForLoan(l, pid),
  ), [mutate]);

  const acceptLoanOfferAction = useCallback((pid: number) => mutate(
    (l) => {
      const updated = acceptLoanOffer(l, pid);
      if (updated && updated !== l) trackEvent("loan_offer_accepted");
      return updated;
    },
  ), [mutate]);

  const rejectLoanOfferAction = useCallback((pid: number) => mutate(
    (l) => rejectLoanOffer(l, pid),
  ), [mutate]);

  const setLineupAction = useCallback((starters: number[]) => mutate((l) => {
    const user = l.teams.find((t) => t.tid === l.meta.userTid);
    if (!user) return null;
    const rosterSet = new Set(user.roster);
    const rosterPlayers = l.players.filter((p) => rosterSet.has(p.pid));
    // Refuse invalid lineups (duplicate pids, off-roster pids, non-GK in the
    // GK slot) at the action layer so bad state can never be persisted, no
    // matter what the drag-and-drop UI lets through. Validated against the
    // user's current formation, since its slot shape decides which pids are GK.
    if (!isValidStarters(rosterPlayers, teamSlots(user), starters)) return null;
    return {
      ...l,
      teams: l.teams.map((t) => (t.tid === l.meta.userTid ? { ...t, starters } : t)),
    };
  }), [mutate]);

  // Change the user's formation and clear their manual starters, so the new
  // shape auto-picks a fresh best XI (a saved lineup for the old shape would
  // otherwise drop players into positionally-wrong slots). The user can then
  // re-drag. Only the user's team ever has a chosen formation; AI stays 4-3-3.
  const setFormationAction = useCallback((formation: FormationId) => mutate((l) => {
    if (!(FORMATION_IDS as readonly string[]).includes(formation)) return null;
    trackEvent("formation_changed", { formation });
    return {
      ...l,
      teams: l.teams.map((t) =>
        t.tid === l.meta.userTid ? { ...t, formation, starters: null } : t,
      ),
    };
  }), [mutate]);

  // Pick the shape that lets the user field their strongest eleven (the same
  // chooseBestFormation the AI uses on its own squads) and clear the manual
  // lineup so that shape's best XI auto-fills — a one-click "just play my best
  // team" for people who don't want to fiddle with formations and drag-drop.
  const autoPickBestXIAction = useCallback(() => mutate((l) => {
    const user = l.teams.find((t) => t.tid === l.meta.userTid);
    if (!user) return null;
    const rosterSet = new Set(user.roster);
    const rosterPlayers = l.players.filter((p) => rosterSet.has(p.pid));
    if (rosterPlayers.length === 0) return null;
    const formation = chooseBestFormation(rosterPlayers);
    trackEvent("best_xi_auto_picked", { formation });
    return {
      ...l,
      teams: l.teams.map((t) =>
        t.tid === l.meta.userTid ? { ...t, formation, starters: null } : t,
      ),
    };
  }), [mutate]);

  // Play the preseason super cups. Cheap enough to run on the main thread — it
  // is at most one match per country plus the continental one, against a
  // matchday's several hundred — so it needs no worker round trip, and unlike a
  // matchday it draws on its own seeded stream rather than the league's.
  //
  // The user is never *required* to come here: `simThrough` plays anything
  // still pending on its way into the season, so this button is the chance to
  // watch it happen rather than a gate that can trap a save.
  const playSuperCupsAction = useCallback(() => mutate((l) => {
    if (!superCupsPending(l.superCups ?? [])) return null;
    const superCups = playSuperCups(l.superCups, l.competitions, l.teams, l.players, l.lid);
    const won = superCups.some((sc) => superCupChampion(sc) === l.meta.userTid);
    trackEvent("super_cups_played", { count: superCups.length, userWon: won });
    return { ...l, superCups };
  }), [mutate]);

  // --- God Mode sandbox actions ---
  // All routed through `mutate` like every other action, so they serialize and
  // can't lose a write. They bypass the realism guardrails on purpose; the UI
  // only exposes them when league.godMode is true.
  const setGodModeAction = useCallback(
    (on: boolean) => mutate((l) => ({ ...l, godMode: on })),
    [mutate],
  );

  const movePlayerToClubAction = useCallback(
    (pid: number, tid: number) => mutate((l) => movePlayerToClub(l, pid, tid)),
    [mutate],
  );

  const acceptJobOfferAction = useCallback(
    (tid: number) => mutate((l) => {
      // Only a club that actually offered — the page can't be trusted to have a
      // fresh list, and taking a job nobody offered is the whole feature bypassed.
      if (!l.manager.offers.some((o) => o.tid === tid)) return null;
      // Offseason only. `switchClub` assumes it runs at the boundary: it opens
      // the new stint at `season + 1`, and the season's wages are already
      // charged to both clubs. Accepting on matchday 20 would date the stint a
      // year into the future and leave the board judging the user on a season
      // they managed half of.
      if (l.phase !== "offseason") return null;
      return switchClub(l, tid, l.manager.sacked ? "sacked" : "left");
    }),
    [mutate],
  );

  const declineJobOffersAction = useCallback(
    () => mutate((l) => (
      // A sacked manager has no club to stay at, so declining is not an option
      // for them — the offer list is the only way the save continues.
      l.manager.sacked ? null : { ...l, manager: { ...l.manager, offers: [] } }
    )),
    [mutate],
  );

  const setSackingEnabledAction = useCallback(
    (on: boolean) => mutate((l) => ({ ...l, manager: { ...l.manager, sackingEnabled: on } })),
    [mutate],
  );

  // --- National team ------------------------------------------------------
  // Every squad edit goes through the same three steps: find which campaign the
  // pending stage belongs to (editableSquad is the one answer to that), validate
  // against what the sim can actually field, then write that one squad back.
  // Refusing invalid state at the action layer rather than trusting the screen
  // is the same rule setLineupAction follows, and it matters more here: an
  // eleven with no keeper doesn't fail, it silently wrecks the keeping composite.

  const takeNationalJobAction = useCallback(
    (nation: string) => mutate((l) => {
      // Only a country that actually approached. Same reasoning as accepting a
      // club job: the page can't be trusted to hold a fresh list, and taking a
      // job nobody offered bypasses the whole feature.
      if (!l.nationalManager.offers.some((o) => o.nation === nation)) return null;
      trackEvent("national_job_accepted");
      return takeNationalJob(l, nation);
    }),
    [mutate],
  );

  const leaveNationalJobAction = useCallback(
    () => mutate((l) => (l.nationalManager.nation ? leaveNationalJob(l, "left") : null)),
    [mutate],
  );

  const declineNationalOffersAction = useCallback(
    () => mutate((l) => (
      l.nationalManager.offers.length === 0
        ? null
        : { ...l, nationalManager: { ...l.nationalManager, offers: [] } }
    )),
    [mutate],
  );

  const setNationalSackingEnabledAction = useCallback(
    (on: boolean) => mutate((l) => (
      { ...l, nationalManager: { ...l.nationalManager, sackingEnabled: on } }
    )),
    [mutate],
  );

  const setNationalSquadAction = useCallback((pids: number[]) => mutate((l) => {
    const nation = l.nationalManager.nation;
    const found = editableSquad(l.international, nation);
    if (!nation || !found) return null;
    const pool = l.players.filter((p) => p.nationality === nation);
    if (!isValidNationSquad(pids, pool)) return null;
    // A chosen eleven survives a squad change only while every man in it is
    // still called up. resolveXI would fall back on its own, but clearing it
    // here means the screen shows the auto-pick straight away instead of an
    // eleven the sim has quietly stopped using.
    const named = new Set(pids);
    const starters = found.squad.starters?.every((pid) => named.has(pid))
      ? found.squad.starters
      : null;
    const squad = { ...found.squad, pids, starters };
    return {
      ...l,
      international: writeSquad(
        l.international, found.slot, nation,
        // The draw is long since done by the time a squad can be edited, so the
        // rating is only ever redisplayed — see squadRating.
        { ...squad, rating: squadRating(squad, l.players) },
      ),
    };
  }), [mutate]);

  const setNationalLineupAction = useCallback((starters: number[]) => mutate((l) => {
    const nation = l.nationalManager.nation;
    const found = editableSquad(l.international, nation);
    if (!nation || !found) return null;
    const named = new Set(found.squad.pids);
    const squadPlayers = l.players.filter((p) => named.has(p.pid));
    if (!isValidStarters(squadPlayers, FORMATIONS[found.squad.formation], starters)) return null;
    return {
      ...l,
      international: writeSquad(l.international, found.slot, nation, { ...found.squad, starters }),
    };
  }), [mutate]);

  const setNationalFormationAction = useCallback((formation: FormationId) => mutate((l) => {
    const nation = l.nationalManager.nation;
    const found = editableSquad(l.international, nation);
    if (!nation || !found) return null;
    if (!(FORMATION_IDS as readonly string[]).includes(formation)) return null;
    // Clear the eleven with the shape, exactly as the club version does: a
    // lineup picked for the old slots would drop players into the wrong jobs.
    return {
      ...l,
      international: writeSquad(
        l.international, found.slot, nation, { ...found.squad, formation, starters: null },
      ),
    };
  }), [mutate]);

  const autoPickNationalXIAction = useCallback(() => mutate((l) => {
    const nation = l.nationalManager.nation;
    const found = editableSquad(l.international, nation);
    if (!nation || !found) return null;
    const named = new Set(found.squad.pids);
    const squadPlayers = l.players.filter((p) => named.has(p.pid));
    if (squadPlayers.length === 0) return null;
    const formation = chooseBestFormation(squadPlayers);
    return {
      ...l,
      international: writeSquad(
        l.international, found.slot, nation, { ...found.squad, formation, starters: null },
      ),
    };
  }), [mutate]);

  /**
   * God Mode: hand the user any club in the world. Runs the same handover as
   * accepting a job offer (the old club's academy graduates, it goes to the AI
   * with its user-only fields stripped, the new squad arrives fogged, and the
   * career picks up a stint) but skips the two gates that make an offer an
   * offer: that somebody asked, and that it is the offseason.
   *
   * Mid-season the new stint opens on the season in progress rather than the
   * next one, because that is when the user actually starts picking this squad.
   * The board then judges *this* club at season end, on a fresh honeymoon
   * confidence, which is the honest reading of a takeover.
   *
   * Deliberately club-only. The national job is its own appointment with its
   * own offers and its own federation, and `switchClub` does not touch it, so a
   * God Mode move between clubs leaves whatever nation you manage alone.
   */
  const godModeSwitchClubAction = useCallback(
    (tid: number) => mutate((l) => {
      if (!l.godMode) return null;
      if (tid === l.meta.userTid) return null;
      if (!l.teams.some((t) => t.tid === tid)) return null;
      return switchClub(l, tid, "left", l.phase === "offseason" ? l.season + 1 : l.season);
    }),
    [mutate],
  );

  /**
   * God Mode: hand the user any country in the world. The national counterpart
   * of the club switch above, and it removes the same single gate — that a
   * federation actually approached — by calling `takeNationalJob` directly
   * rather than reassigning `nationalManager.nation` itself. That function
   * already leaves the old job properly (closing the stint, handing the eleven
   * back so the AI picks its own again) and it is already good at any point in
   * the season, because a national team owns nothing that a mid-season handover
   * could strand.
   *
   * Two things are still refused. A country that cannot field a squad in this
   * world would be a job with no team attached, so it is checked with the very
   * same `isEligibleNation` the picker builds its list from. And a spectator
   * save is left alone: `reviewNationalCampaign` returns early for one, so a
   * country taken there would never be judged, never be offered another job and
   * never sack you — the whole federation career would be quietly inert. The
   * way in is the Switch Club tab, which ends spectating for good.
   */
  const godModeTakeNationalJobAction = useCallback(
    (nation: string) => mutate((l) => {
      if (!l.godMode) return null;
      if (isSpectator(l)) return null;
      if (l.nationalManager.nation === nation) return null;
      if (!isEligibleNation(nation, l.players.filter((p) => p.nationality === nation))) return null;
      return takeNationalJob(l, nation);
    }),
    [mutate],
  );

  const releasePlayerGodModeAction = useCallback(
    (pid: number) => mutate((l) => detachPlayer(l, pid)),
    [mutate],
  );

  const editPlayerAction = useCallback(
    (pid: number, edit: PlayerEdit) =>
      mutate((l) => ({ ...l, players: applyPlayerEdit(l.players, pid, l.season, edit) })),
    [mutate],
  );

  const createPlayerAction = useCallback(
    (spec: NewPlayerSpec) => mutate((l) => createCustomPlayer(l, spec).league),
    [mutate],
  );

  const setClubFinancesAction = useCallback(
    (tid: number, budget: number, hype: number) =>
      mutate((l) => ({ ...l, teams: setClubFinances(l.teams, tid, budget, hype) })),
    [mutate],
  );

  // Scouting spend is only adjustable during the offseason phase, and it edits
  // nextScoutingSpend (the level that locks in for the coming season), never the
  // current season's committed scoutingSpend. This is what prevents the peek
  // exploit: dragging the slider can't sharpen the fog you're currently seeing.
  const setScoutingSpendAction = useCallback((spend: number) => mutate((l) => {
    if (l.phase !== "offseason") return l;
    return {
      ...l,
      teams: l.teams.map((t) => {
        if (t.tid !== l.meta.userTid) return t;
        return { ...t, nextScoutingSpend: clampScoutingSpend(spend, t.budget) };
      }),
    };
  }), [mutate]);

  const saveToDb = useCallback(async () => {
    if (leagueRef.current) await saveLeague(leagueRef.current);
  }, []);

  const doExport = useCallback(async () => {
    if (league) await exportLeagueJSON(league, crests);
  }, [league, crests]);

  const doImport = useCallback(async (file: File) => {
    const { league: imported, crests: importedCrests } = await importLeagueJSON(file);
    // An import always lands as a NEW save. The file still carries the lid it
    // held in whatever browser exported it, and saveLeague keys off that lid —
    // so keeping it silently overwrote whatever league already sat at that key
    // (someone else's save, or your own from another browser), destroying it
    // with no warning and no way back. lid 0 makes saveLeague autoIncrement a
    // fresh key instead, leaving every existing league untouched.
    const lid = await saveLeague({ ...imported, lid: 0 });
    // After the league, because the crest rows are keyed by the lid IndexedDB
    // has only just handed out — the same ordering setLeague documents.
    if (importedCrests.size > 0) await saveCrests(lid, importedCrests);
    setActiveLid(lid);
    commitLeague({ ...imported, lid }, importedCrests);
  }, [commitLeague]);

  // Memoize the context value so its identity only changes when something a
  // consumer actually reads changes. Without this, the provider re-renders on
  // every rapidly-changing bit of transient state it holds — most importantly
  // the per-matchday `animQueue` push during a sim — and each re-render would
  // rebuild this object, forcing every `useLeague()` consumer (all 23 pages,
  // the sidebar, etc.) to re-render dozens of times per sim. `animQueue` and
  // `animDone` are deliberately NOT read here (they go straight to SimOverlay),
  // so progress ticks no longer touch this value's identity.
  const value = useMemo<LeagueContextValue>(() => ({
    league,
    crests,
    loadingActiveLeague,
    setLeague,
    loadLeagueAction,
    switchLeagueAction,
    customizeTeamsAction,
    simAction,
    simLiveAction,
    jumpSeasonsAction,
    offseasonAction,
    intlStageAction,
    signFreeAgentAction,
    releasePlayerAction,
    signToAcademyAction,
    signTrialistAction,
    setScoutDirectionsAction,
    promoteFromAcademyAction,
    releaseAcademyPlayerAction,
    extendAcademyContractAction,
    setScoutingSpendAction,
    makeOfferAction,
    acceptCounterAction,
    acceptInboundOfferAction,
    rejectInboundOfferAction,
    counterInboundOfferAction,
    extendContractAction,
    extendAllContractsAction,
    listPlayerForLoanAction,
    unlistPlayerForLoanAction,
    acceptLoanOfferAction,
    rejectLoanOfferAction,
    setTransferListedAction,
    setMoreMinutesAction,
    toggleWatchedAction,
    setLineupAction,
    setFormationAction,
    autoPickBestXIAction,
    playSuperCupsAction,
    setGodModeAction,
    acceptJobOfferAction, declineJobOffersAction, setSackingEnabledAction,
    takeNationalJobAction, leaveNationalJobAction, declineNationalOffersAction,
    setNationalSackingEnabledAction, setNationalSquadAction, setNationalLineupAction,
    setNationalFormationAction, autoPickNationalXIAction,
    movePlayerToClubAction,
    godModeSwitchClubAction,
    godModeTakeNationalJobAction,
    releasePlayerGodModeAction,
    editPlayerAction,
    createPlayerAction,
    setClubFinancesAction,
    // The live viewer blocks other actions the same way the sim overlay does:
    // its matchday is simmed but uncommitted, so anything else acting on the
    // league would be computing from a state that is about to be replaced.
    simming: simming || simOverlayOpen || watchable !== null || jumpOpen || busy,
    saveToDb,
    exportJSON: doExport,
    importJSON: doImport,
  }), [
    league, crests, loadingActiveLeague, setLeague, loadLeagueAction, switchLeagueAction,
    customizeTeamsAction, simAction, simLiveAction, jumpSeasonsAction, offseasonAction,
    intlStageAction, signFreeAgentAction,
    releasePlayerAction, signToAcademyAction, signTrialistAction,
    setScoutDirectionsAction,
    promoteFromAcademyAction,
    releaseAcademyPlayerAction, extendAcademyContractAction, setScoutingSpendAction,
    makeOfferAction, acceptCounterAction, acceptInboundOfferAction,
    rejectInboundOfferAction, counterInboundOfferAction, extendContractAction,
    extendAllContractsAction,
    listPlayerForLoanAction, unlistPlayerForLoanAction, acceptLoanOfferAction,
    rejectLoanOfferAction, setTransferListedAction, setMoreMinutesAction, toggleWatchedAction,
    setLineupAction, setFormationAction,
    autoPickBestXIAction,
    playSuperCupsAction,
    setGodModeAction, movePlayerToClubAction, releasePlayerGodModeAction,
    godModeSwitchClubAction,
    godModeTakeNationalJobAction,
    acceptJobOfferAction, declineJobOffersAction, setSackingEnabledAction,
    takeNationalJobAction, leaveNationalJobAction, declineNationalOffersAction,
    setNationalSackingEnabledAction, setNationalSquadAction, setNationalLineupAction,
    setNationalFormationAction, autoPickNationalXIAction,
    editPlayerAction, createPlayerAction, setClubFinancesAction,
    simming, simOverlayOpen, watchable, jumpOpen, busy, saveToDb, doExport, doImport,
  ]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <SimOverlay
        open={simOverlayOpen}
        teams={league?.teams ?? []}
        queue={animQueue}
        done={animDone}
        userTid={league?.meta.userTid ?? -1}
        onComplete={finishSimAnimation}
      />
      <JumpOverlay
        open={jumpOpen}
        progress={jumpProgress}
        result={jumpResult}
        onClose={closeJump}
      />
      {/* Two matches on this matchday: ask before playing either. */}
      {watchable && liveChoice === null && (
        <LiveMatchPicker
          open
          choices={watchable.map((c) => c.choice)}
          onPick={setLiveChoice}
          onSkip={finishLiveMatch}
        />
      )}
      {watchable && liveChoice !== null && (() => {
        const chosen = watchable.find((c) => c.key === liveChoice);
        if (!chosen) return null;
        return (
          <LiveMatchOverlay
            open
            match={chosen.view.match}
            otherMatches={chosen.view.otherMatches}
            teams={league?.teams ?? []}
            playerName={playerName}
            competitionName={chosen.view.competitionName}
            subtitle={chosen.view.subtitle}
            tableAtMinute={chosen.view.tableAtMinute}
            onComplete={finishLiveMatch}
          />
        );
      })()}
    </Ctx.Provider>
  );
}
