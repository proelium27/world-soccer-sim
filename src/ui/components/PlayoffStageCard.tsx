import { Link } from "react-router-dom";
import type { LeagueStore } from "../../core/leagueState.js";
import { nextPlayoffStage, playoffStageProgress, type PlayoffStageEntry } from "../../core/playoffStages.js";
import { seasonYear } from "../format.js";
import { isSpectator } from "../../core/spectator.js";

/*
 * The staged playoffs on the offseason card. Shared by the managed and the
 * spectator dashboards, and its button labels by the top bar's Sim menu, so the
 * three name the same block the same way.
 */

/** The label for the button that plays the next block. */
export function playoffStageButton(league: LeagueStore): string {
  const { stage, stages } = playoffStageProgress(league);
  return stage >= stages ? "Play the playoff finals" : `Play playoff round ${stage} of ${stages}`;
}

/** Whether there is more than one block left, i.e. whether "sim through" means anything. */
export function playoffStagesLeft(league: LeagueStore): number {
  const { stage, stages } = playoffStageProgress(league);
  return Math.max(0, stages - stage + 1);
}

/**
 * What the next block plays, as prose: the title playoffs by name, the
 * promotion playoffs counted (a summer holds a couple of dozen of them across
 * Europe, and naming each would bury the rest).
 */
function describe(entries: PlayoffStageEntry[]): string {
  // "the wild card in the United States" rather than a possessive, which reads
  // badly on a country whose name ends in s.
  const place = (country: string) => (country === "United States" ? "the United States" : country);
  // A numbered round ("round one") takes no article; a named one ("the final") does.
  const round = (name: string) => {
    const r = name.toLowerCase();
    return /^round \w+$/.test(r) ? r : `the ${r}`;
  };
  const titles = entries
    .filter((e) => e.kind === "title")
    .map((e) => `${round(e.roundName)} in ${place(e.country)}`);
  const promotion = entries.filter((e) => e.kind === "promotion");
  const parts = [...titles];
  if (promotion.length > 0) {
    const rounds = [...new Set(promotion.map((e) => e.roundName.toLowerCase()))].join(" and ");
    parts.push(`${promotion.length} promotion ${promotion.length === 1 ? "playoff" : "playoffs"} (${rounds})`);
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function PlayoffStageCard({
  league,
  simming,
  onStage,
  onThrough,
}: {
  league: LeagueStore;
  simming: boolean;
  onStage: () => void;
  onThrough: () => void;
}) {
  const entries = nextPlayoffStage(league);
  const userIn = entries.some((e) => e.includesUser);
  const { stage, stages } = playoffStageProgress(league);
  const hasTitles = (league.titlePlayoffs ?? []).some((p) => p.season === league.season);

  return (
    <>
      <p className="card-text">
        The {seasonYear(league.season)} league season is over, and the playoffs are on: round{" "}
        {stage} of {stages}. Next up, {describe(entries)}. Follow them on the{" "}
        {hasTitles && (
          <>
            <Link to="/title-playoffs">Title Playoffs</Link> and{" "}
          </>
        )}
        <Link to="/promotion-playoffs">Promotion Playoffs</Link> pages. The season moves on once
        the finals are played.
      </p>
      {userIn && (
        <p className="card-text">
          <strong>Your club plays in this round.</strong> Check your{" "}
          <Link to="/roster">lineup</Link> before you play it.
        </p>
      )}
      <div className="d-flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={simming} onClick={onStage}>
          {playoffStageButton(league)}
        </button>
        {stage < stages && (
          <button className="btn btn-outline-primary" disabled={simming} onClick={onThrough}>
            Sim through the playoffs
          </button>
        )}
      </div>
      {stage < stages && !isSpectator(league) && (
        <p className="card-text text-muted small mt-2 mb-0">
          Simming through stops before any round your club plays in, so you can pick your team.
        </p>
      )}
    </>
  );
}
