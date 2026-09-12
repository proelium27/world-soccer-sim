import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnchoredPanel } from "./anchoredPanel.js";

/**
 * A small circular "?" badge shown next to a section title. On hover or
 * keyboard focus it reveals a short plain-language blurb explaining what that
 * feature does — the same accessible hover/focus/Escape pattern as
 * PlayerRatingsTooltip, scoped to a paragraph of help text. Rendered with
 * spans so it can sit inline inside a heading without invalid nesting.
 *
 * Keep the copy to a sentence or three and never spoil hidden values (mirror
 * the Manual's standard) — this is a pointer, not a substitute for the Manual.
 */
export function HelpHint({
  children,
  label = "What is this?",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  const panelId = useId();
  // Portalled for the same reason the ratings tooltip is: a "?" in a table
  // header sits inside a scroll container that clips it. See anchoredPanel.tsx.
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={anchorRef}
      className="help-hint"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-expanded={visible}
      aria-describedby={visible ? panelId : undefined}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setVisible(false);
      }}
    >
      <span className="help-hint-icon" aria-hidden="true">?</span>
      {visible && (
        <AnchoredPanel
          anchor={anchorRef.current}
          onDismiss={() => setVisible(false)}
          id={panelId}
          role="tooltip"
          className="help-hint-panel"
        >
          {children}
        </AnchoredPanel>
      )}
    </span>
  );
}

/**
 * The standard "what is potential?" hint, dropped next to a POT column header
 * anywhere potential is shown. Kept as one component so the copy stays
 * identical across the whole game.
 */
export function PotHelp() {
  return (
    <HelpHint label="What is potential?">
      Potential is basically our scouts' guess at how good a player could get. It shows up as a
      range until you've scouted him enough. Spend more on scouting (and keep him around longer)
      and the range tightens toward his real ceiling, so you'll see the exact number sooner.
    </HelpHint>
  );
}
