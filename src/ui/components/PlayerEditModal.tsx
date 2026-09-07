import { useState, useEffect } from "react";
import type { Player, Position } from "../../core/players/types.js";
import { SKILL_KEYS, POSITIONS } from "../../core/players/types.js";
import { NATIONALITIES } from "../../core/players/nationalities.js";
import { SKILL_LABELS } from "./PlayerRatingsTooltip.js";
import type { PlayerEdit } from "../../core/godMode.js";
import { useLeague } from "../context/LeagueContext.js";
import { isSuspended, matchesLabel } from "../../core/suspensions.js";

const NATION_NAMES = Object.keys(NATIONALITIES);

/**
 * God Mode player editor. Pre-fills from the player, tracks all edits locally,
 * and on Save calls editPlayerAction with a full PlayerEdit (OVR is recomputed
 * inside the core helper). Only rendered when league.godMode is true.
 */
export function PlayerEditModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const { league, editPlayerAction } = useLeague();
  const season = league?.season ?? player.born;

  const [name, setName] = useState(player.name);
  const [nationality, setNationality] = useState(player.nationality);
  const [pos, setPos] = useState<Position>(player.pos);
  const [age, setAge] = useState(season - player.born);
  const [heightCm, setHeightCm] = useState(player.heightCm);
  const [potential, setPotential] = useState(player.potential);
  const [salary, setSalary] = useState(player.contract.salary);
  const [expiresSeason, setExpiresSeason] = useState(player.contract.expiresSeason);
  const [ratings, setRatings] = useState({ ...player.ratings });
  const [clearInjury, setClearInjury] = useState(false);
  const [clearBan, setClearBan] = useState(false);
  const [ratingsLocked, setRatingsLocked] = useState(player.ratingsLocked === true);

  // Close on Escape, matching the app's other click-away popovers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    const edit: PlayerEdit = {
      name,
      nationality,
      pos,
      age,
      heightCm,
      potential,
      contract: { salary, expiresSeason },
      ratings,
      clearInjury: player.injury ? clearInjury : undefined,
      clearSuspension: isSuspended(player) ? clearBan : undefined,
      ratingsLocked,
    };
    await editPlayerAction(player.pid, edit);
    onClose();
  };

  return (
    <div className="gm-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="gm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h5 m-0">Edit Player</h2>
          <button className="btn btn-sm btn-outline-secondary" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="row g-2 mb-3">
          <div className="col-12 col-md-6">
            <label className="form-label form-label-sm">Name</label>
            <input className="form-control form-control-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label form-label-sm">Nationality</label>
            <select className="form-select form-select-sm" value={nationality} onChange={(e) => setNationality(e.target.value)}>
              {NATION_NAMES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label form-label-sm">Position</label>
            <select className="form-select form-select-sm" value={pos} onChange={(e) => setPos(e.target.value as Position)}>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label form-label-sm">Age</label>
            <input type="number" className="form-control form-control-sm" value={age} onChange={(e) => setAge(Number(e.target.value))} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label form-label-sm">Height (cm)</label>
            <input type="number" className="form-control form-control-sm" value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label form-label-sm">Potential</label>
            <input type="number" className="form-control form-control-sm" value={potential} onChange={(e) => setPotential(Number(e.target.value))} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label form-label-sm">Season wage (£)</label>
            <input type="number" className="form-control form-control-sm" value={salary} onChange={(e) => setSalary(Number(e.target.value))} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label form-label-sm">Contract expires (season)</label>
            <input type="number" className="form-control form-control-sm" value={expiresSeason} onChange={(e) => setExpiresSeason(Number(e.target.value))} />
          </div>
        </div>

        <div className="gm-panel-title">Ratings</div>
        <div className="gm-ratings-grid mb-3">
          {SKILL_KEYS.map((key) => (
            <div key={key}>
              <label className="form-label form-label-sm m-0">{SKILL_LABELS[key]}</label>
              <input
                type="number"
                min={0}
                max={100}
                className="form-control form-control-sm"
                value={ratings[key]}
                onChange={(e) => setRatings((r) => ({ ...r, [key]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>

        {/* Staged like the two clear-this checkboxes below rather than flipped
            live, because it saves with the rest of the edit. */}
        <div className="form-check mb-3">
          <input
            type="checkbox"
            className="form-check-input"
            id="gm-lock-ratings"
            checked={ratingsLocked}
            onChange={(e) => setRatingsLocked(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="gm-lock-ratings">
            Lock ratings
            <span className="d-block text-muted small">
              He stops developing: these ratings, his overall and his potential stay put every
              offseason until you unlock him. Everything else about him carries on as normal.
            </span>
          </label>
        </div>

        {player.injury && (
          <div className="form-check mb-3">
            <input
              type="checkbox"
              className="form-check-input"
              id="gm-clear-injury"
              checked={clearInjury}
              onChange={(e) => setClearInjury(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="gm-clear-injury">
              Clear injury ({player.injury.type}, {player.injury.gamesRemaining} games)
            </label>
          </div>
        )}

        {isSuspended(player) && (
          <div className="form-check mb-3">
            <input
              type="checkbox"
              className="form-check-input"
              id="gm-clear-suspension"
              checked={clearBan}
              onChange={(e) => setClearBan(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="gm-clear-suspension">
              Clear suspension ({player.suspension!.reason},{" "}
              {matchesLabel(player.suspension!.matchesRemaining)})
            </label>
          </div>
        )}

        <div className="d-flex justify-content-end gap-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-warning" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
