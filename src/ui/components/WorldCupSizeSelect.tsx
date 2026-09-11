import { WORLD_CUP_SIZES, type WorldCupSize } from "../../core/constants.js";
import { autoWorldCupThreshold } from "../../core/international/format.js";

/**
 * What each World Cup size plays, in one line. Shared by the New League screen
 * and the Qualifying page so the two can't describe the same setting
 * differently.
 */
export function worldCupSizeBlurb(size: WorldCupSize): string {
  switch (size) {
    case "auto":
      return `Sized to your world. The standard world plays 32; a world with ${autoWorldCupThreshold(48)} or more nations able to field a squad plays 48.`;
    case 16:
      return "Four groups of four, and the top two go through to the quarter-finals.";
    case 24:
      return "Six groups of four. The top two and the four best third-placed teams go through to a round of 16.";
    case 32:
      return "Eight groups of four, and the top two go through to a round of 16.";
    case 48:
      return "Twelve groups of four. The top two and the eight best third-placed teams go through to a round of 32.";
  }
}

/** "Auto" or "48 nations", for the option list and for saying what a save is set to. */
export function worldCupSizeLabel(size: WorldCupSize): string {
  return size === "auto" ? "Auto" : `${size} nations`;
}

const OPTIONS: WorldCupSize[] = ["auto", ...WORLD_CUP_SIZES];

/** The World Cup size picker: a plain select, since it's one choice out of five. */
export function WorldCupSizeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: WorldCupSize;
  onChange: (size: WorldCupSize) => void;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className="form-select form-select-sm w-auto"
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "auto" ? "auto" : (Number(raw) as WorldCupSize));
      }}
    >
      {OPTIONS.map((size) => (
        <option key={String(size)} value={String(size)}>{worldCupSizeLabel(size)}</option>
      ))}
    </select>
  );
}
