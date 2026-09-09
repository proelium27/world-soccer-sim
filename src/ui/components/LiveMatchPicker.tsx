/**
 * Which match do you want to watch?
 *
 * Cup matchdays are ordinary league matchdays too — the schedule has no cup
 * awareness, so on matchday 3 a qualified club plays its league fixture *and*
 * its Continental Cup tie. Rather than sit you through both every time, or pick
 * one for you and silently bury the other, this asks. Whichever you don't
 * watch is still played and still has its box score.
 *
 * Page content rather than a dialog, like the viewer it leads into — see
 * LiveMatchView's header for why.
 */
import type { ReactNode } from "react";

export interface LiveChoice {
  key: string;
  /** The competition — "Continental Cup". */
  title: string;
  /** What the match is — "Quarter-final, second leg away to Kestrel City". */
  detail: string;
}

interface LiveMatchPickerProps {
  choices: LiveChoice[];
  onPick: (key: string) => void;
  /** Play the matchday without watching anything. */
  onSkip: () => void;
}

export function LiveMatchPicker({ choices, onPick, onSkip }: LiveMatchPickerProps): ReactNode {
  return (
    <div className="live-picker card">
      <div className="card-body">
        <h1 className="card-title h5">You&apos;ve got two matches</h1>
        <p className="text-muted small mb-3">
          Both are played either way. Pick the one you want to watch.
        </p>
        <div className="live-picker-list">
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              className="live-picker-choice"
              onClick={() => onPick(c.key)}
            >
              <span className="live-picker-title">{c.title}</span>
              <span className="live-picker-detail">{c.detail}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary mt-3" onClick={onSkip}>
          Skip both
        </button>
      </div>
    </div>
  );
}
