import { useRef } from "react";
import { LOGO_PICKER_ACCEPT } from "../logoImages.js";

/**
 * The club-badge loader on the New League screen.
 *
 * Its own component rather than another block in NewLeague.tsx, which is
 * already 1200 lines — but the state lives up there beside the roster sources,
 * deliberately, because the two are picked together and cleared together and a
 * second copy of "what has the user loaded" is exactly how the club picker and
 * the save end up disagreeing.
 *
 * The card reports what a pack will actually do rather than that a file was
 * read: how many clubs it badges out of how many it names. Those two numbers
 * are different whenever a name doesn't match, which is the failure this
 * feature has — a badge that lands nowhere looks identical to no badge at all,
 * so the count is the only place it can surface.
 */

export interface LogoSetupPreview {
  tid: number;
  name: string;
  image: string;
}

export interface LogoSetupProps {
  /** Names of the packs and picture batches loaded so far. */
  sources: string[];
  /** How many clubs the loaded packs will actually badge. */
  matched: number;
  /** Club names the packs asked for and this world hasn't got. */
  unmatched: string[];
  /** A few resolved badges, to show it worked before the save exists. */
  preview: LogoSetupPreview[];
  error: string | null;
  onPick: (files: File[]) => void;
  onClear: () => void;
}

/** How many badges the card shows. Enough to recognise, not enough to fill the page. */
const PREVIEW_LIMIT = 12;

export function LogoSetup({
  sources, matched, unmatched, preview, error, onPick, onClear,
}: LogoSetupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const loaded = sources.length > 0;

  return (
    <div className="mb-3">
      <div className="d-flex gap-2 flex-wrap align-items-center">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => inputRef.current?.click()}
        >
          {loaded ? "Add more logos" : "Load club logos"}
        </button>
        {loaded && (
          <button type="button" className="btn btn-link btn-sm p-0" onClick={onClear}>
            Start over
          </button>
        )}
      </div>

      {!loaded && (
        <p className="text-muted small mt-2 mb-0">
          Optional. Pick a folder of picture files named after the clubs
          (<code>Liverpool.png</code>), or a logo pack somebody sent you. The game
          shrinks each one down so a whole world of badges doesn't bloat your save.
        </p>
      )}

      {loaded && (
        <div className="alert alert-secondary py-2 mt-2 mb-0">
          <div>
            Loaded <strong>{sources.join(", ")}</strong> — {matched}{" "}
            {matched === 1 ? "club" : "clubs"} will wear a custom badge.
          </div>
          {/* Named separately from the count because the two say different
              things: a badge that matched no club is silently absent in the
              save, and this is the only place anyone would find out. */}
          {unmatched.length > 0 && (
            <div className="small text-muted mt-1">
              No club here is called{" "}
              {unmatched.slice(0, 5).map((n) => `"${n}"`).join(", ")}
              {unmatched.length > 5 ? ` (and ${unmatched.length - 5} more)` : ""} — those
              were skipped. Load your roster file first if the clubs come from one.
            </div>
          )}
          {error && <div className="small text-danger mt-1">{error}</div>}
          {preview.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mt-2">
              {preview.slice(0, PREVIEW_LIMIT).map((p) => (
                <img
                  key={p.tid}
                  src={p.image}
                  alt={p.name}
                  title={p.name}
                  width={28}
                  height={28}
                  style={{ objectFit: "contain" }}
                />
              ))}
              {preview.length > PREVIEW_LIMIT && (
                <span className="text-muted small align-self-center">
                  +{preview.length - PREVIEW_LIMIT} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!loaded && error && <div className="small text-danger mt-1">{error}</div>}

      <input
        ref={inputRef}
        type="file"
        accept={LOGO_PICKER_ACCEPT}
        multiple
        className="d-none"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = ""; // so the same folder can be re-picked after a fix
          if (picked.length > 0) onPick(picked);
        }}
      />
    </div>
  );
}
