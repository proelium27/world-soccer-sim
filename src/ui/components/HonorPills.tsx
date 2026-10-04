import type { ReactNode } from "react";
import type { Competition } from "../../core/competitions.js";
import type { HonorsByLeague, PlayerHonors } from "../../core/playerHonors.js";
import { seasonYear } from "../format.js";
import { TrophyIcon } from "./TrophyIcon.js";
import { GoldenBootIcon } from "./GoldenBootIcon.js";

/** One career-honor badge, e.g. "3x Golden Boot" — omits the count for a single win. */
function AwardPill({ label, seasons, icon }: { label: string; seasons: number[]; icon?: ReactNode }) {
  if (seasons.length === 0) return null;
  const years = [...seasons].sort((a, b) => a - b).map(seasonYear);
  return (
    <span className="award-pill" title={years.join(", ")}>
      {icon}
      {years.length > 1 && <span className="award-pill-count">{years.length}x</span>}
      {label}
    </span>
  );
}

/**
 * A player's career honours as pills, shared by the living and retired profile.
 *
 * League honours are named for the league they were won in ("Spanish Division 1
 * Champion", "English Division 1 Golden Boot") and domestic cups by the cup's own
 * name, so a career that took in two countries reads as two sets of trophies
 * rather than one undifferentiated count. A league that God Mode has since
 * removed falls back to the generic label.
 */
export function HonorPills({ honors, competitions }: { honors: PlayerHonors; competitions: Competition[] }) {
  const compName = new Map(competitions.map((c) => [c.id, c.name] as const));
  const byLeague = (split: HonorsByLeague[], suffix: string, fallback: string, icon?: ReactNode) =>
    split.map(({ compId, seasons }) => {
      const name = compName.get(compId);
      return (
        <AwardPill key={`${suffix}-${compId}`} label={name ? `${name} ${suffix}` : fallback} seasons={seasons} icon={icon} />
      );
    });

  return (
    <div className="award-pills">
      <AwardPill label="Ballon d'Or" seasons={honors.ballonDOr} />
      <AwardPill label="World Team of the Year" seasons={honors.worldTeamOfYear} />
      <AwardPill label="Goalkeeper of the Year" seasons={honors.goalkeeperOfYear} />
      <AwardPill label="Defender of the Year" seasons={honors.defenderOfYear} />
      <AwardPill label="Americas Player of the Year" seasons={honors.americasPlayerOfYear} />
      <AwardPill label="Americas Team of the Year" seasons={honors.americasTeamOfYear} />
      <AwardPill label="Americas Goalkeeper of the Year" seasons={honors.americasGoalkeeperOfYear} />
      <AwardPill label="Americas Defender of the Year" seasons={honors.americasDefenderOfYear} />
      {byLeague(honors.playerOfSeasonByComp, "Player of the Season", "Player of the Season")}
      {byLeague(honors.goldenBootByComp, "Golden Boot", "Golden Boot", <GoldenBootIcon />)}
      {byLeague(honors.teamOfSeasonByComp, "Team of the Season", "Team of the Season")}
      {byLeague(honors.leagueTitlesByComp, "Champion", "League Champion", <TrophyIcon />)}
      <AwardPill label="Continental Cup" seasons={honors.continentalCups} />
      <AwardPill label="Continental Shield" seasons={honors.shields} />
      <AwardPill label="Americas Cup" seasons={honors.americasCups} />
      {honors.domesticCupsByName.map(({ name, seasons }) => (
        <AwardPill key={`cup-${name}`} label={name || "Domestic Cup"} seasons={seasons} />
      ))}
    </div>
  );
}
