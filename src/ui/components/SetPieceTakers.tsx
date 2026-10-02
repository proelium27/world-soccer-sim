import type { Player, Position } from "../../core/players/types.js";
import { toMatchPlayer } from "../../core/league/matchPlayers.js";
import { penaltyTakerOf, cornerTakerOf } from "../../engine/attribution.js";
import type { TakerRole } from "../../core/lineup/setPieceTakers.js";

interface Props {
  /** The Starting XI in formation order, aligned with `slots`. */
  xi: Player[];
  slots: Position[];
  /** Everyone on the senior roster, the options in each list. */
  players: Player[];
  penaltyTaker: number | null;
  setPieceTaker: number | null;
  onChange: (role: TakerRole, pid: number | null) => void;
}

/**
 * The penalty and set-piece taker pickers. "Auto" names who the match would
 * actually pick from today's XI, off the same numbers the engine reads, so the
 * label can't disagree with who steps up.
 */
export function SetPieceTakers({ xi, slots, players, penaltyTaker, setPieceTaker, onChange }: Props) {
  const onPitch = xi.map((p, i) => toMatchPlayer(p, slots[i] ?? p.pos));
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const autoPen = byPid.get(penaltyTakerOf(onPitch)?.pid ?? -1);
  const autoSet = byPid.get(cornerTakerOf(onPitch)?.pid ?? -1);

  const outfield = players.filter((p) => p.pos !== "GK");
  const shooting = (p: Player) => (p.ratings.finishing + p.ratings.longShot) / 2;
  const passing = (p: Player) => (p.ratings.shortPass + p.ratings.longPass) / 2;

  const picker = (
    role: TakerRole,
    label: string,
    value: number | null,
    auto: Player | undefined,
    score: (p: Player) => number,
  ) => {
    // A named taker who has since left reads as auto, which is what the match does.
    const current = value !== null && byPid.has(value) ? value : null;
    const named = current !== null ? byPid.get(current) : undefined;
    const benched = named !== undefined && !xi.some((p) => p.pid === named.pid);
    const options = [...outfield].sort((a, b) => score(b) - score(a));
    return (
      <div className="d-flex align-items-center gap-2">
        <label htmlFor={`taker-${role}`} className="form-label mb-0 small text-muted">
          {label}
        </label>
        <select
          id={`taker-${role}`}
          className="form-select form-select-sm"
          style={{ width: "auto", maxWidth: "16rem" }}
          value={current ?? ""}
          onChange={(e) => onChange(role, e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Auto{auto ? ` (${auto.name})` : ""}</option>
          {options.map((p) => (
            <option key={p.pid} value={p.pid}>
              {p.name} ({Math.round(score(p))})
            </option>
          ))}
        </select>
        {benched && (
          <span className="small text-muted">not starting, auto until he's on</span>
        )}
      </div>
    );
  };

  return (
    <div className="d-flex align-items-center gap-3 mb-2 flex-wrap">
      {picker("penalty", "Penalties", penaltyTaker, autoPen, shooting)}
      {picker("setPiece", "Set pieces", setPieceTaker, autoSet, passing)}
    </div>
  );
}
