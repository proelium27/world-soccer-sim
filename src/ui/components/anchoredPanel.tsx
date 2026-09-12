import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * A hover panel that escapes whatever is clipping it.
 *
 * Both of this app's hover panels (the attribute breakdown on a player's name,
 * the "?" help badge) used to be `position: absolute` inside their anchor. That
 * works until the anchor sits inside a scroll container, and most of the tables
 * that carry them do: Bootstrap's `.table-responsive` is `overflow-x: auto`,
 * and CSS computes `overflow-y` to `auto` alongside it, so the box clips
 * vertically as well. No `z-index` escapes a clipping ancestor.
 *
 * Measured on `/database/players` before this existed: hovering the last row
 * showed **5.8% of a 366px panel**, the other 344px cut off at the wrapper's
 * edge. On the national My Squad page that edge is where the substitutes table
 * begins, so it read as the bench table covering the tooltip — which is how it
 * was reported.
 *
 * So the panel is rendered through a portal onto `document.body` and positioned
 * `fixed` against the anchor's viewport rect. It stays inside the React tree, so
 * context (the league, for the age and potential lines) still reaches it.
 */

export interface PanelPos {
  top: number;
  left: number;
}

/** Gap between the anchor and the panel, and the least room left at the edges. */
const GAP = 4;
const MARGIN = 8;

/**
 * Where to put a panel of this size against this anchor.
 *
 * Below the anchor when there is room, flipped above when there isn't, and
 * always clamped inside the viewport — a panel pushed off the bottom of the
 * screen is exactly as unreadable as one clipped by a table. Pure so the rules
 * can be tested without a DOM.
 */
export function placePanel(
  anchor: { top: number; bottom: number; left: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): PanelPos {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - panel.height;
  // Flip only if the panel genuinely doesn't fit below AND fits better above,
  // so a panel taller than the viewport still opens downward from the anchor
  // rather than being pinned to a top edge the reader has to scroll to.
  const fitsBelow = below + panel.height <= viewport.height - MARGIN;
  const top = fitsBelow || above < MARGIN ? below : above;
  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, viewport.width - MARGIN - panel.width),
  );
  return {
    top: Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - panel.height)),
    left,
  };
}

/**
 * Positions `children` against `anchor` and renders them on `document.body`.
 *
 * Renders nothing until the anchor exists, and renders the panel hidden for one
 * frame while it is measured — the measurement runs in a layout effect, so the
 * reader never sees the unplaced position.
 */
export function AnchoredPanel({
  anchor, onDismiss, children, ...rest
}: {
  anchor: HTMLElement | null;
  /** Called when the page scrolls or resizes under an open panel. */
  onDismiss: () => void;
  children: ReactNode;
  id?: string;
  role?: string;
  className?: string;
}) {
  const panelRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    setPos(placePanel(
      anchor.getBoundingClientRect(),
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [anchor]);

  // A fixed panel doesn't travel with the page, so scrolling under an open one
  // would leave it stranded beside the wrong row. Closing is the honest answer
  // and it is what the pointer is about to do anyway.
  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => onDismiss();
    window.addEventListener("scroll", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss, { passive: true });
    return () => {
      window.removeEventListener("scroll", dismiss, { capture: true });
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor, onDismiss]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      {...rest}
      ref={panelRef}
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </span>,
    document.body,
  );
}
