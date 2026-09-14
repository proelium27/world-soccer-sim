import { useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import {
  AWARD_GROUPS, DEFAULT_AWARD_FORMULA, isCustomAwardFormula, resolveAwardFormula,
  type AwardFormula, type AwardGroup, type WorldAwardFormula,
} from "../../core/awardFormula.js";
import type { Position } from "../../core/players/types.js";

const GROUP_LABELS: Record<AwardGroup, string> = {
  GK: "Keepers",
  DEF: "Defenders (CB, FB)",
  MID: "Midfielders (DM, CM)",
  FWD: "Forwards (AM, W, ST)",
};

/** Keepers are left out: their Team of the Season work is save percentage, which gets its own field. */
const OUTFIELD_POSITIONS: Position[] = ["CB", "FB", "DM", "CM", "AM", "W", "ST"];

const CUP_RUN_LABELS = ["Won it", "Runner-up", "Semi-finals", "Quarter-finals"];

type WorldNumberKey = Exclude<keyof WorldAwardFormula, "cupRunBonus">;

const WORLD_GROUPS: { title: string; fields: { key: WorldNumberKey; label: string }[] }[] = [
  {
    title: "League strength",
    fields: [
      { key: "leagueStrengthWeight", label: "Per point his league's average overall sits above the world's" },
      { key: "ovrWeight", label: "Extra weight on overall, on top of the Player of the Season one" },
    ],
  },
  {
    title: "Trophies",
    fields: [
      { key: "leagueTitleBonus", label: "Winning his league" },
      { key: "domesticCupBonus", label: "Winning his domestic cup" },
      { key: "trophyStrengthWeight", label: "How much a strong league boosts those two" },
    ],
  },
  {
    title: "International",
    fields: [
      { key: "intlGoalWeight", label: "Per goal" },
      { key: "intlAssistWeight", label: "Per assist" },
      { key: "intlCapWeight", label: "Per cap" },
      { key: "worldCupMultiplier", label: "World Cup multiplier on those" },
      { key: "worldCupBonus", label: "Winning the World Cup" },
      { key: "confederationCupMultiplier", label: "Confederation cup multiplier on those" },
      { key: "confederationCupBonus", label: "Winning a confederation cup" },
    ],
  },
  {
    title: "World XI, Goalkeeper and Defender of the Year",
    fields: [
      { key: "positionAwardTrophyMultiplier", label: "Multiplier on everything beyond his league season" },
    ],
  },
];

/**
 * Deep copy, because the shipped formula is frozen and the draft is edited in
 * place by path. structuredClone rather than a JSON round trip, which would turn
 * a cleared box's NaN into null.
 */
const copy = (f: AwardFormula): AwardFormula => structuredClone(f);
const same = (a: AwardFormula, b: AwardFormula) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A number box that reports NaN when cleared rather than 0, so emptying a field
 * doesn't quietly save a zero. `resolveAwardFormula` turns a NaN back into the
 * shipped value when the formula is saved.
 */
function NumberBox({ id, value, shipped, onChange, step = 0.01, label }: {
  id: string;
  value: number;
  shipped: number;
  onChange: (v: number) => void;
  step?: number;
  label?: string;
}) {
  const changed = !Number.isNaN(value) && value !== shipped;
  return (
    <input
      id={id}
      type="number"
      step={step}
      aria-label={label}
      title={`Shipped: ${shipped}`}
      className={`form-control form-control-sm${changed ? " border-warning" : ""}`}
      style={{ maxWidth: 110 }}
      value={Number.isNaN(value) ? "" : value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
    />
  );
}

function FieldRow({ id, label, value, shipped, onChange, step }: {
  id: string;
  label: string;
  value: number;
  shipped: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="d-flex align-items-center justify-content-between gap-3 mb-2">
      <label className="form-label form-label-sm m-0" htmlFor={id}>
        {label}
        <span className="text-muted ms-2">shipped {shipped}</span>
      </label>
      <NumberBox id={id} value={value} shipped={shipped} onChange={onChange} step={step} />
    </div>
  );
}

/**
 * God Mode's award formula editor: every weight the end-of-season awards are
 * scored with, staged in a draft and applied on Save.
 *
 * Staged rather than live, like the player editor, because a formula is a set
 * of numbers that only mean something together, and because nothing reads it
 * until the next time awards are handed out anyway.
 *
 * Exported so `awardFormulaReach.test.tsx` can render it directly: server
 * rendering cannot click a tab, the limitation `Development` documents too.
 */
export function AwardFormulas() {
  const { league, godModeSetAwardFormulaAction, simming } = useLeague();
  const [draft, setDraft] = useState<AwardFormula>(() => copy(resolveAwardFormula(league?.awardFormula)));
  const [saved, setSaved] = useState(false);
  if (!league) return null;

  const d = DEFAULT_AWARD_FORMULA;
  const stored = resolveAwardFormula(league.awardFormula);
  const dirty = !same(draft, stored);
  const custom = isCustomAwardFormula(league.awardFormula);

  const edit = (fn: (f: AwardFormula) => void) => {
    setDraft((prev) => {
      const next = copy(prev);
      fn(next);
      return next;
    });
    setSaved(false);
  };

  const save = async () => {
    await godModeSetAwardFormulaAction(draft);
    setDraft(copy(resolveAwardFormula(draft)));
    setSaved(true);
  };

  const reset = async () => {
    await godModeSetAwardFormulaAction(null);
    setDraft(copy(d as AwardFormula));
    setSaved(true);
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <p className="text-secondary small mb-2">
        Every award is a score, and these are the weights that build it. Change what gets rewarded
        and the next awards handed out, at the end of this season, use your numbers. Seasons
        already played keep the winners they had.
      </p>
      <p className="text-secondary small mb-3">
        One knock-on worth knowing: a Team of the Season place is one of the things that makes a
        big club refuse to sell a star, so reshaping that formula also changes who&apos;s on the
        transfer market from next season.
      </p>

      <div className="small mb-3">
        {custom
          ? <span className="text-warning">This save is using custom award formulas.</span>
          : <span className="text-muted">This save is using the shipped award formulas.</span>}
      </div>

      <div className="gm-panel mb-3">
        <div className="gm-panel-title">Who can win</div>
        <FieldRow
          id="award-minAppearances"
          label="Appearances needed to qualify"
          value={draft.minAppearances}
          shipped={d.minAppearances}
          step={1}
          onChange={(v) => edit((f) => { f.minAppearances = v; })}
        />
        <div className="text-muted small">
          Anyone over the bar comes first. If nobody in a league reaches it, the award goes to the
          best of whoever did play.
        </div>
      </div>

      <div className="gm-panel mb-3">
        <div className="gm-panel-title">Player of the Season</div>
        <div className="text-muted small mb-2">
          Also the starting point for the Ballon d&apos;Or and every Team of the Season.
        </div>
        <FieldRow
          id="award-ratingWeight"
          label="Per point of his average match rating"
          value={draft.ratingWeight}
          shipped={d.ratingWeight}
          onChange={(v) => edit((f) => { f.ratingWeight = v; })}
        />
        <FieldRow
          id="award-ovrWeight"
          label="Per point of overall"
          value={draft.ovrWeight}
          shipped={d.ovrWeight}
          onChange={(v) => edit((f) => { f.ovrWeight = v; })}
        />
        <table className="table table-sm align-middle mb-0 mt-2">
          <thead>
            <tr><th>Position</th><th>Per goal</th><th>Per assist</th></tr>
          </thead>
          <tbody>
            {AWARD_GROUPS.map((g) => (
              <tr key={g}>
                <td className="small">{GROUP_LABELS[g]}</td>
                <td>
                  <NumberBox
                    id={`award-goal-${g}`} label={`${GROUP_LABELS[g]} per goal`}
                    value={draft.goalWeight[g]} shipped={d.goalWeight[g]}
                    onChange={(v) => edit((f) => { f.goalWeight[g] = v; })}
                  />
                </td>
                <td>
                  <NumberBox
                    id={`award-assist-${g}`} label={`${GROUP_LABELS[g]} per assist`}
                    value={draft.assistWeight[g]} shipped={d.assistWeight[g]}
                    onChange={(v) => edit((f) => { f.assistWeight[g] = v; })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="gm-panel mb-3">
        <div className="gm-panel-title">Team of the Season</div>
        <div className="text-muted small mb-2">
          Each position adds its own work on top of the Player of the Season score. The same
          numbers pick the World XI and the Goalkeeper and Defender of the Year.
        </div>
        <FieldRow
          id="award-work-GK-savePct"
          label="Keepers: save percentage above average (4 is 0.04 a percentage point)"
          value={draft.positionWork.GK.savePct}
          shipped={d.positionWork.GK.savePct}
          onChange={(v) => edit((f) => { f.positionWork.GK.savePct = v; })}
        />
        <table className="table table-sm align-middle mb-0 mt-2">
          <thead>
            <tr><th>Position</th><th>Per tackle or interception, per game</th></tr>
          </thead>
          <tbody>
            {OUTFIELD_POSITIONS.map((pos) => (
              <tr key={pos}>
                <td className="small">{pos}</td>
                <td>
                  <NumberBox
                    id={`award-work-${pos}`} label={`${pos} per tackle or interception per game`}
                    value={draft.positionWork[pos].defendingPerGame}
                    shipped={d.positionWork[pos].defendingPerGame}
                    onChange={(v) => edit((f) => { f.positionWork[pos].defendingPerGame = v; })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="gm-panel mb-3">
        <div className="gm-panel-title">Worldwide awards</div>
        <div className="text-muted small mb-2">
          The Ballon d&apos;Or, World XI and Goalkeeper and Defender of the Year add all of this on
          top of a player&apos;s league season.
        </div>

        <div className="fw-semibold small mt-2 mb-1">Continental Cup</div>
        <FieldRow
          id="award-world-cupMultiplier"
          label="Multiplier on his cup goals and assists"
          value={draft.world.cupMultiplier}
          shipped={d.world.cupMultiplier}
          onChange={(v) => edit((f) => { f.world.cupMultiplier = v; })}
        />
        <FieldRow
          id="award-world-cupRatingWeight"
          label="Per point of cup match rating above average"
          value={draft.world.cupRatingWeight}
          shipped={d.world.cupRatingWeight}
          onChange={(v) => edit((f) => { f.world.cupRatingWeight = v; })}
        />
        {CUP_RUN_LABELS.map((label, i) => (
          <FieldRow
            key={label}
            id={`award-world-cupRun-${i}`}
            label={`His club's run: ${label.toLowerCase()}`}
            value={draft.world.cupRunBonus[i]}
            shipped={d.world.cupRunBonus[i]}
            onChange={(v) => edit((f) => { f.world.cupRunBonus[i] = v; })}
          />
        ))}

        {WORLD_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="fw-semibold small mt-3 mb-1">{group.title}</div>
            {group.fields.map((field) => (
              <FieldRow
                key={field.key}
                id={`award-world-${field.key}`}
                label={field.label}
                value={draft.world[field.key]}
                shipped={d.world[field.key]}
                onChange={(v) => edit((f) => { f.world[field.key] = v; })}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="d-flex align-items-center gap-2 flex-wrap">
        <button className="btn btn-sm btn-warning" disabled={!dirty || simming} onClick={save}>
          Save formulas
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          disabled={!dirty}
          onClick={() => { setDraft(copy(stored)); setSaved(false); }}
        >
          Discard changes
        </button>
        <button
          className="btn btn-sm btn-outline-danger"
          disabled={simming || (!custom && same(draft, d as AwardFormula))}
          onClick={reset}
        >
          Reset to shipped formulas
        </button>
        {saved && !dirty && <span className="text-success small">Saved.</span>}
      </div>
    </div>
  );
}
