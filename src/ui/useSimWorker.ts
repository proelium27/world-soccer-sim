/// <reference lib="dom" />
import { useCallback, useEffect, useRef, useState } from "react";
import type { LeagueStore } from "../core/leagueState.js";
import type { PlayedMatch } from "../core/standings.js";
import type { CupTie } from "../core/cup/types.js";
import type { DomesticTieResult } from "../core/simThrough.js";
import type { SimThrough, IntlMode, PlayoffMode, WorkerResponse } from "../worker/protocol.js";
import type { LeagueArchive } from "../core/simArchive.js";
import {
  detachArchive, reattachArchive, detachPlayed, reattachPlayed,
  detachCareer, reattachCareer, detachNews, reattachNews,
  detachTransfers, reattachTransfers,
} from "../core/simArchive.js";
import { referencedPids } from "../core/players/playerNames.js";
import { honourSourcesOf } from "../core/frivolities/goat.js";
import { computeTeamSeasonStats } from "../core/standings.js";
import { offseasonCoefficientSlots } from "../core/cup/coefficients.js";

export type SimProgress = {
  matchday: number;
  matchdayIndex: number;
  totalMatchdays: number;
  results: PlayedMatch[];
  cupTies: CupTie[];
  domesticTies: DomesticTieResult[];
};

/** Where a multi-season jump has got to (see core/autopilot.ts). */
export type JumpProgressUpdate = {
  seasonsDone: number;
  totalSeasons: number;
  season: number;
};

type Pending = {
  resolve: (league: LeagueStore) => void;
  reject: (err: Error) => void;
  /**
   * The append-only history held back from this command (core/simArchive.ts),
   * folded back onto whatever the worker returns.
   */
  archive: LeagueArchive;
  /**
   * The real box scores of already-played matches, held back the same way.
   * `null` when this command was sent with them intact (see `post`).
   */
  played: PlayedMatch[] | null;
  /** The part of each player's career the worker was not given. */
  careers: ReturnType<typeof detachCareer>["careers"] | null;
  /** The older transfer rows the worker was not given. */
  transfers: ReturnType<typeof detachTransfers>["transfers"] | null;
  /** The news feed and archived cups the worker was not given. */
  news: ReturnType<typeof detachNews>["news"] | null;
};

export function useSimWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [simming, setSimming] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  const progressRef = useRef<((progress: SimProgress) => void) | null>(null);
  const jumpProgressRef = useRef<((progress: JumpProgressUpdate) => void) | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../worker/simWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === "simProgress") {
        const { matchday, matchdayIndex, totalMatchdays, results, cupTies, domesticTies } = e.data;
        progressRef.current?.({
          matchday, matchdayIndex, totalMatchdays, results, cupTies,
          // Absent on a message from an older worker build mid-upgrade.
          domesticTies: domesticTies ?? [],
        });
        return;
      }
      if (e.data.type === "jumpProgress") {
        const { seasonsDone, totalSeasons, season } = e.data;
        jumpProgressRef.current?.({ seasonsDone, totalSeasons, season });
        return;
      }
      if (
        e.data.type === "simResult" ||
        e.data.type === "offseasonResult" ||
        e.data.type === "intlResult" ||
        e.data.type === "playoffsResult" ||
        e.data.type === "jumpResult"
      ) {
        setSimming(false);
        const pending = pendingRef.current;
        if (pending) {
          let league = e.data.league;
          // Whoever the free-agent cull deleted. The worker could only scrub
          // its own copies, so every held-back list that carries a pid gets the
          // same treatment here. Empty for anything but an offseason.
          const culled = new Set(
            e.data.type === "offseasonResult" ? e.data.culledPids ?? [] : [],
          );
          if (pending.news) league = reattachNews(league, pending.news, culled);
          if (pending.transfers) {
            league = reattachTransfers(league, pending.transfers, culled);
          }
          if (pending.careers) league = reattachCareer(league, pending.careers);
          if (pending.played) league = reattachPlayed(league, pending.played);
          if (pending.archive) league = reattachArchive(league, pending.archive);
          pending.resolve(league);
        }
        pendingRef.current = null;
        progressRef.current = null;
        jumpProgressRef.current = null;
      }
    };
    // An uncaught exception in the worker must reject the pending promise;
    // otherwise the caller awaits forever and the UI is stuck "simming".
    const fail = (message: string) => {
      setSimming(false);
      pendingRef.current?.reject(new Error(message));
      pendingRef.current = null;
      progressRef.current = null;
      jumpProgressRef.current = null;
    };
    worker.onerror = (e: ErrorEvent) => fail(e.message || "simulation worker crashed");
    worker.onmessageerror = () => fail("simulation worker message could not be deserialized");
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const post = useCallback(
    (
      command:
        | { type: "sim"; through: SimThrough; league: LeagueStore }
        | { type: "offseason"; league: LeagueStore }
        | { type: "intl"; mode: IntlMode; league: LeagueStore }
        | { type: "playoffs"; mode: PlayoffMode; league: LeagueStore }
        | { type: "jump"; seasons: number; league: LeagueStore },
      handlers: {
        onProgress?: (progress: SimProgress) => void;
        onJumpProgress?: (progress: JumpProgressUpdate) => void;
      } = {},
    ): Promise<LeagueStore> => {
      return new Promise((resolve, reject) => {
        if (pendingRef.current) {
          reject(new Error("a simulation is already running"));
          return;
        }
        setSimming(true);
        // Hold back everything the worker will not read rather than
        // structured-cloning it out and straight back again — that round trip
        // is what runs a save out of memory on mobile. See core/simArchive.ts.
        const { payload: base, archive } = detachArchive(command.league);

        // A multi-season jump crosses offseasons, and `played` is wiped at each
        // one, so the leading-stub rule reattachPlayed relies on does not hold:
        // it would be re-merging a previous season's matches into a later one.
        // Jump therefore carries real box scores. It is one deliberate,
        // already-slow action, against every matchday advance in a season.
        const stripPlayed = command.type !== "jump";
        const { payload: withoutPlayed, played } = stripPlayed
          ? detachPlayed(base)
          : { payload: base, played: null };

        // Careers go the same way, and for the same reason `jump` is exempt from
        // the above: it crosses offseasons, where players retire and youth
        // arrive, so the per-pid merge on the way back is not worth the risk on
        // an action already accepted as slow.
        const { payload: withoutCareers, careers } = stripPlayed
          ? detachCareer(withoutPlayed)
          : { payload: withoutPlayed, careers: null };

        // The news feed and the archived cups, ~23 MB on a long save. Exempt
        // from `jump` with the rest: it crosses offseasons, so it would need a
        // culled pid set per season rather than one.
        const { payload: withoutNews, news } = stripPlayed
          ? detachNews(withoutCareers)
          : { payload: withoutCareers, news: null };

        // All but the last few seasons of the transfer log, 14.8 MB on the
        // reported save. The sim does read this one, but only through
        // `joinedSeasons`, whose answer is fixed after PLAYER_SETTLED_SEASONS —
        // so the window it is cut to is exactly as good as the whole log. Same
        // exemption for `jump`: its offseasons each cull, and only the last
        // one's pids come back.
        const { payload, transfers } = stripPlayed
          ? detachTransfers(withoutNews)
          : { payload: withoutNews, transfers: null };

        // The offseason is the one place the sim reads a box score it did not
        // just play (computeTeamSeasonStats). Working it out here is what makes
        // stripping them safe; without it the offseason would aggregate stubs
        // and quietly record a season of zeroes.
        const outgoing =
          command.type === "offseason" && stripPlayed
            ? {
                ...command,
                league: payload,
                teamStats: computeTeamSeasonStats(
                  command.league.teams.map((t) => t.tid),
                  command.league.played,
                ),
                // extendPlayerNames walks the history we just held back, so the
                // answer is worked out here instead. See detachNews.
                referencedPids: [...referencedPids(command.league)],
                // Read off the full league, before `detachNews` empties the cup
                // histories on the way to the worker.
                cupChampions: honourSourcesOf(command.league),
                // The coefficient reads the same held-back cup history, so it is
                // worked out here too. Without it the worker saw at most one
                // season of record and never reallocated a single place.
                cupSlots: (() => {
                  const slots = offseasonCoefficientSlots(command.league);
                  return slots ? [...slots] : null;
                })(),
              }
            : { ...command, league: payload };

        pendingRef.current = { resolve, reject, archive, played, careers, news, transfers };
        progressRef.current = handlers.onProgress ?? null;
        jumpProgressRef.current = handlers.onJumpProgress ?? null;
        workerRef.current?.postMessage(outgoing);
      });
    },
    [],
  );

  const sim = useCallback(
    (
      through: SimThrough,
      league: LeagueStore,
      onProgress?: (progress: SimProgress) => void,
    ): Promise<LeagueStore> => post({ type: "sim", through, league }, { onProgress }),
    [post],
  );

  const runOffseason = useCallback(
    (league: LeagueStore): Promise<LeagueStore> => post({ type: "offseason", league }),
    [post],
  );

  const runIntlStage = useCallback(
    (mode: IntlMode, league: LeagueStore): Promise<LeagueStore> => post({ type: "intl", mode, league }),
    [post],
  );

  const runPlayoffStage = useCallback(
    (mode: PlayoffMode, league: LeagueStore): Promise<LeagueStore> => post({ type: "playoffs", mode, league }),
    [post],
  );

  const runJump = useCallback(
    (
      seasons: number,
      league: LeagueStore,
      onJumpProgress?: (progress: JumpProgressUpdate) => void,
    ): Promise<LeagueStore> => post({ type: "jump", seasons, league }, { onJumpProgress }),
    [post],
  );

  return { sim, runOffseason, runIntlStage, runPlayoffStage, runJump, simming };
}
