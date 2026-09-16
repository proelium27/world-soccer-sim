import type { LeagueStore } from "../core/leagueState.js";
import type { SimThrough } from "../core/simThrough.js";
import type { PlayedMatch, TeamSeasonStats } from "../core/standings.js";
import type { CupTie } from "../core/cup/types.js";
import type { DomesticTieResult } from "../core/simThrough.js";
import type { OffseasonInputs } from "../core/offseason.js";

// Re-exported rather than redeclared: the two used to be separate unions and
// could drift apart silently, since the worker boundary erases types.
export type { SimThrough } from "../core/simThrough.js";

/** Play one staged international stage, or blast through every remaining one. */
export type IntlMode = "stage" | "through";

/**
 * Play the next playoff block, or keep playing blocks until the playoffs are
 * done or the next one is a round the user's club is in.
 */
export type PlayoffMode = "stage" | "through";

// UI -> Worker
export type WorkerCommand =
  | { type: "sim"; through: SimThrough; league: LeagueStore }
  /**
   * `teamStats` is this season's aggregate, worked out on the main thread. The
   * offseason is the only place the sim reads a box score belonging to a
   * matchday it did not just play, so supplying it is what lets `detachPlayed`
   * strip them (see core/simArchive.ts). Optional: without it the offseason
   * derives its own, which is right for any caller that sent real box scores.
   */
  | {
      type: "offseason";
      league: LeagueStore;
      teamStats?: TeamSeasonStats[];
      /**
       * Every pid the surviving history points at, for `extendPlayerNames`.
       * An array rather than a Set so the protocol stays plainly serialisable.
       * Supplying it is what lets `detachNews` keep that history off the worker.
       */
      referencedPids?: number[];
      /**
       * Who won each past cup, for ranking the offseason's retirees by career.
       * Same reason as `referencedPids`: `detachNews` empties the cup histories,
       * and a retiree scored against an empty one loses every trophy he won.
       */
      cupChampions?: OffseasonInputs["cupChampions"];
    }
  | { type: "intl"; mode: IntlMode; league: LeagueStore }
  | { type: "playoffs"; mode: PlayoffMode; league: LeagueStore }
  /** Play `seasons` whole seasons with the AI running the user's club (core/autopilot.ts). */
  | { type: "jump"; seasons: number; league: LeagueStore };

// Worker -> UI
export type WorkerResponse =
  | { type: "simResult"; league: LeagueStore }
  | {
      type: "offseasonResult";
      league: LeagueStore;
      /**
       * Who the free-agent cull deleted. The main thread scrubs their rows out
       * of the history it held back, which the worker could not do to arrays it
       * never had. See `reattachNews`.
       */
      culledPids?: number[];
    }
  | { type: "intlResult"; league: LeagueStore }
  | { type: "playoffsResult"; league: LeagueStore }
  | { type: "jumpResult"; league: LeagueStore }
  /**
   * Fired as each jumped season starts playing out. The whole jump is one
   * command rather than one per season precisely so the league is
   * structured-cloned across the worker boundary twice in total instead of
   * twice per season — at tens of megabytes that is the difference between a
   * progress bar and a slideshow.
   */
  | { type: "jumpProgress"; seasonsDone: number; totalSeasons: number; season: number }
  | {
      type: "simProgress";
      matchday: number;
      matchdayIndex: number;
      totalMatchdays: number;
      results: PlayedMatch[];
      cupTies: CupTie[];
      /** Domestic cup ties played on this matchday, each with its own cup/round labels. */
      domesticTies: DomesticTieResult[];
    };
