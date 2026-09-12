import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { SKILL_KEYS } from "../../core/players/types.js";
import type { Player, SkillKey } from "../../core/players/types.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { useLeague } from "../context/LeagueContext.js";
import { Flag } from "./Flag.js";
import { PotDisplay } from "./PotDisplay.js";
import { AnchoredPanel } from "./anchoredPanel.js";

export const SKILL_LABELS: Record<SkillKey, string> = {
  speed: "Speed",
  strength: "Strength",
  stamina: "Stamina",
  jumping: "Jumping",
  shortPass: "Short Pass",
  longPass: "Long Pass",
  crosses: "Crosses",
  dribbling: "Dribbling",
  longShot: "Long Shot",
  finishing: "Finishing",
  tackling: "Tackling",
  interceptions: "Interceptions",
  positioning: "Positioning",
  goalkeeping: "Goalkeeping",
};

/**
 * Column-header abbreviations for the attribute tables.
 *
 * These are spelled out rather than derived, because deriving them from
 * SKILL_LABELS by initials — which the Player Profile did — gives **three
 * columns all labelled "S"**: Speed, Strength and Stamina. Fourteen numeric
 * columns where the first three headers are identical is unreadable, and a
 * hover title is not a fix for a header you can't tell apart at a glance.
 *
 * Every value must stay unique; a test pins that.
 */
export const SKILL_ABBREV: Record<SkillKey, string> = {
  speed: "SPD",
  strength: "STR",
  stamina: "STA",
  jumping: "JMP",
  shortPass: "SP",
  longPass: "LP",
  crosses: "CRO",
  dribbling: "DRI",
  longShot: "LS",
  finishing: "FIN",
  tackling: "TAC",
  interceptions: "INT",
  positioning: "POS",
  goalkeeping: "GK",
};

/**
 * Wraps player name text; on hover or keyboard focus, shows a color-coded
 * breakdown of all attribute ratings. Rendered entirely with spans (the anchor
 * sits inside a table cell as inline content, where a div would be invalid).
 */
export function PlayerRatingsTooltip({ player, children }: { player: Player; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const { league } = useLeague();
  const panelId = `player-ratings-tooltip-${player.pid}`;
  // The panel is rendered through a portal rather than inside this span: most
  // of the tables that carry it sit in a `.table-responsive`, which clips
  // vertically and would cut the panel off (see anchoredPanel.tsx).
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={anchorRef}
      className="player-ratings-tooltip-anchor"
      tabIndex={0}
      aria-describedby={visible ? panelId : undefined}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setVisible(false);
      }}
    >
      {children}
      {visible && (
        <AnchoredPanel
          anchor={anchorRef.current}
          onDismiss={() => setVisible(false)}
          id={panelId}
          role="tooltip"
          className="player-ratings-tooltip-panel"
        >
          <span className="player-ratings-tooltip-title">
            {player.name} <Flag nationality={player.nationality} />
            {league && <>{" "}&middot; Age {league.season - player.born}</>}
            {" "}&middot; OVR {player.ovr} / POT <PotDisplay player={player} />
          </span>
          <span className="player-ratings-tooltip-grid">
            {SKILL_KEYS.map((key) => (
              <span key={key} className="player-ratings-tooltip-row">
                <span className="player-ratings-tooltip-label">{SKILL_LABELS[key]}</span>
                <span
                  className="player-ratings-tooltip-value"
                  style={{ color: getRatingColor(player.ratings[key]) }}
                >
                  {player.ratings[key]}
                </span>
              </span>
            ))}
          </span>
        </AnchoredPanel>
      )}
    </span>
  );
}
