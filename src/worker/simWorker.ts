/// <reference lib="webworker" />
import { simThrough } from "../core/simThrough.js";
import { simOffseasonReporting } from "../core/offseason.js";
import { jumpSeasons } from "../core/autopilot.js";
import { playIntlStage, simThroughInternational } from "../core/international/index.js";
import { playPlayoffStage, simThroughPlayoffs } from "../core/playoffStages.js";
import { mulberry32, mulberry32Resumable } from "../engine/rng.js";
import { slimMatchdayProgress } from "../core/simArchive.js";
import type { WorkerCommand, WorkerResponse } from "./protocol.js";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;
  if (cmd.type === "sim") {
    // Derive seed from league state so each sim batch is deterministic but
    // different — unless this is a later chunk of a split sim, which carries on
    // the stream the previous chunk left off (core/simChunks.ts).
    const seed = (cmd.league.lid * 1000 + cmd.league.played.length) >>> 0;
    const rng = mulberry32Resumable(cmd.rngState ?? seed);
    const result = simThrough(
      cmd.league,
      cmd.through,
      rng.next,
      (matchday, matchdayIndex, totalMatchdays, results, cupTies, domesticTies) => {
        const full = { matchday, matchdayIndex, totalMatchdays, results, cupTies, domesticTies };
        const progress: WorkerResponse = {
          type: "simProgress",
          ...(cmd.slimProgress ? slimMatchdayProgress(full) : full),
        };
        self.postMessage(progress);
      },
      // The game plays the playoffs a round per sim block, so a season that
      // ends here only draws them (see core/playoffStages.ts).
      { stagePlayoffs: true, batchStartMatchday: cmd.batchStartMatchday },
    );
    const response: WorkerResponse = { type: "simResult", league: result, rngState: rng.state() };
    self.postMessage(response);
  } else if (cmd.type === "offseason") {
    const seed = (cmd.league.lid * 1000 + cmd.league.season) >>> 0;
    const rng = mulberry32(seed);
    const { league: result, report } = simOffseasonReporting(cmd.league, rng, {
      teamStats: cmd.teamStats,
      referencedPids: cmd.referencedPids ? new Set(cmd.referencedPids) : undefined,
      cupChampions: cmd.cupChampions,
      cupSlots: cmd.cupSlots === undefined ? undefined : cmd.cupSlots && new Map(cmd.cupSlots),
    });
    const response: WorkerResponse = {
      type: "offseasonResult",
      league: result,
      // An array, not a Set: structuredClone handles Sets, but the protocol
      // stays plainly serialisable so a future transport cannot be surprised.
      culledPids: [...report.culledPids],
    };
    self.postMessage(response);
  } else if (cmd.type === "jump") {
    // No rng is threaded in: a jump is many seasons, and each one seeds itself
    // exactly the way the equivalent button click above does (see
    // core/autopilot.ts), so jumping five seasons and clicking through five
    // seasons land on the same world.
    const result = jumpSeasons(
      cmd.league,
      cmd.seasons,
      (seasonsDone, totalSeasons, season) => {
        const progress: WorkerResponse = { type: "jumpProgress", seasonsDone, totalSeasons, season };
        self.postMessage(progress);
      },
      { seasonAcc: cmd.seasonAcc },
    );
    const response: WorkerResponse = { type: "jumpResult", league: result };
    self.postMessage(response);
  } else if (cmd.type === "intl") {
    // Staged international football: play one stage, or every remaining stage.
    // No rng is threaded in — each international stage runs on its own seeded
    // stream (see core/international/simIntl.ts), so this stays deterministic.
    const { international, players } =
      cmd.mode === "through"
        ? simThroughInternational(cmd.league.international, cmd.league.players, cmd.league.lid, cmd.league.season)
        : playIntlStage(cmd.league.international, cmd.league.players, cmd.league.lid, cmd.league.season);
    const result = { ...cmd.league, international, players };
    const response: WorkerResponse = { type: "intlResult", league: result };
    self.postMessage(response);
  } else if (cmd.type === "playoffs") {
    // One playoff block, or blocks until the playoffs are done or the next one
    // is a round the user's club plays in. No rng: every tie runs on its own
    // seeded stream (see core/playoffStages.ts).
    const result = cmd.mode === "through"
      ? simThroughPlayoffs(cmd.league, { stopBeforeUserRound: true })
      : playPlayoffStage(cmd.league);
    const response: WorkerResponse = { type: "playoffsResult", league: result };
    self.postMessage(response);
  }
};
