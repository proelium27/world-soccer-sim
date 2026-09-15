import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { seasonYear } from "../format.js";
import {
  AWARD_GROUPS, AWARD_PRESETS, DEFAULT_AWARD_FORMULA, matchingPreset, resolveAwardFormula,
  type AwardFormula, type AwardGroup, type WorldAwardFormula,
} from "../../core/awardFormula.js";
import { lastCompletedSeason, scoreSeasonAwards, type ScoredSeason } from "../../core/awardPreview.js";
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

/** Deep copy. structuredClone rather than a JSON round trip, which would turn a cleared box's NaN into null. */
const copy = (f: Readonly<AwardFormula>): AwardFormula => structuredClone(f) as AwardFormula;
const same = (a: Readonly<AwardFormula>, b: Readonly<AwardFormula>) => JSON.stringify(a) === JSON.stringify(b);

function formatCount(n: number): string {
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(rounded);
}

/**
 * A score expressed as the goals a forward would need to earn the same, which
 * is the one yardstick on this page a player already has a feel for. Every
 * explanation reads off the DRAFT, so it moves as the boxes do. Falls back to
 * raw award points if the forward goal weight has been set to nothing.
 */
export function inForwardGoals(points: number, f: Readonly<AwardFormula>): string {
  const fwd = f.goalWeight.FWD;
  if (!Number.isFinite(points)) return "nothing yet";
  if (!(fwd > 0)) return `${formatCount(points)} award points`;
  const n = points / fwd;
  const count = formatCount(n);
  return `about ${count} ${count === "1" ? "goal" : "goals"} by a forward`;
}

function times(m: number): string {
  if (!Number.isFinite(m)) return "the same as";
  if (m === 1) return "the same as";
  if (m === 2) return "double";
  if (m === 0) return "nothing next to";
  return `${formatCount(m)} times`;
}

type WorldNumberKey = Exclude<keyof WorldAwardFormula, "cupRunBonus">;

interface WorldField {
  key: WorldNumberKey;
  label: string;
  explain: (v: number, f: Readonly<AwardFormula>) => string;
}

const WORLD_GROUPS: { title: string; fields: WorldField[] }[] = [
  {
    title: "League strength",
    fields: [
      {
        key: "leagueStrengthWeight",
        label: "Playing in a stronger league",
        explain: (v, f) => `A league 5 points of overall above the world average is worth ${inForwardGoals(5 * v, f)}.`,
      },
      {
        key: "ovrWeight",
        label: "Extra weight on overall rating",
        explain: (v, f) => `Ten more points of overall adds ${inForwardGoals(10 * v, f)}, on top of the Player of the Season weight.`,
      },
    ],
  },
  {
    title: "Trophies",
    fields: [
      { key: "leagueTitleBonus", label: "Winning his league", explain: (v, f) => `Worth ${inForwardGoals(v, f)} to a regular in the side.` },
      { key: "domesticCupBonus", label: "Winning his domestic cup", explain: (v, f) => `Worth ${inForwardGoals(v, f)} to a regular in the side.` },
      {
        key: "trophyStrengthWeight",
        label: "Strong leagues' trophies count for more",
        explain: (v) => `A league 5 points of overall above the world average adds ${Math.round(5 * v * 100)}% to both trophies.`,
      },
    ],
  },
  {
    title: "International",
    fields: [
      { key: "intlGoalWeight", label: "A goal for his country", explain: (v, f) => `Worth ${inForwardGoals(v, f)} in the league.` },
      { key: "intlAssistWeight", label: "An assist for his country", explain: (v, f) => `Worth ${inForwardGoals(v, f)} in the league.` },
      { key: "intlCapWeight", label: "A cap", explain: (v, f) => `Ten caps are worth ${inForwardGoals(10 * v, f)}.` },
      { key: "worldCupMultiplier", label: "World Cup matches", explain: (v) => `A World Cup goal, assist or cap counts ${times(v)} a qualifier.` },
      { key: "worldCupBonus", label: "Winning the World Cup", explain: (v, f) => `Worth ${inForwardGoals(v, f)} to everyone who played.` },
      { key: "confederationCupMultiplier", label: "Confederation cup matches", explain: (v) => `A goal, assist or cap there counts ${times(v)} a qualifier.` },
      { key: "confederationCupBonus", label: "Winning a confederation cup", explain: (v, f) => `Worth ${inForwardGoals(v, f)} to everyone who played.` },
    ],
  },
  {
    title: "World XI, Goalkeeper and Defender of the Year",
    fields: [
      {
        key: "positionAwardTrophyMultiplier",
        label: "How much cups and trophies count",
        explain: (v) => `These three awards count cups, trophies and internationals ${times(v)} the Ballon d'Or does.`,
      },
    ],
  },
];

/**
 * A number box that reports NaN when cleared rather than 0, so emptying a field
 * doesn't quietly save a zero. `resolveAwardFormula` turns a NaN back into the
 * game's default when the formula is saved.
 */
function NumberBox({ id, value, fallback, onChange, step = 0.01, label }: {
  id: string;
  value: number;
  fallback: number;
  onChange: (v: number) => void;
  step?: number;
  label?: string;
}) {
  const changed = !Number.isNaN(value) && value !== fallback;
  return (
    <input
      id={id}
      type="number"
      step={step}
      aria-label={label}
      className={`form-control form-control-sm${changed ? " border-warning" : ""}`}
      style={{ maxWidth: 100 }}
      value={Number.isNaN(value) ? "" : value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
    />
  );
}

/** One weight: its name, what it's worth in words, and the game's default when you've moved off it. */
function FieldRow({ id, label, explain, value, fallback, onChange, step }: {
  id: string;
  label: string;
  explain: string;
  value: number;
  fallback: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  const changed = !Number.isNaN(value) && value !== fallback;
  return (
    <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
      <div>
        <label className="form-label form-label-sm m-0 d-block" htmlFor={id}>{label}</label>
        <div className="text-muted small">
          {explain}
          {changed && <span className="text-warning"> Game default {fallback}.</span>}
        </div>
      </div>
      <NumberBox id={id} value={value} fallback={fallback} onChange={onChange} step={step} />
    </div>
  );
}

/** How many of a team's places go to someone new. Order-blind, since two centre-backs swapping slots is no change. */
function placesChanged(next: (number | null)[], now: (number | null)[]): number {
  const before = new Set(now.filter((pid): pid is number => pid !== null));
  return next.filter((pid) => pid !== null && !before.has(pid)).length;
}

/**
 * What last season's awards would have been under the draft, beside what they
 * are under the save's formula now. Both sides are scored on the same players
 * (see `scoreSeasonAwards`), so any difference is the formula.
 */
function Preview({ now, next, dirty, compId, compName }: {
  now: ScoredSeason;
  next: ScoredSeason;
  dirty: boolean;
  compId: number | null;
  compName: string;
}) {
  const { league } = useLeague();
  const playerById = usePlayerMap(league?.players);
  const name = (pid: number | null | undefined): ReactNode => {
    if (pid === null || pid === undefined) return <span className="text-muted">nobody</span>;
    const p = playerById.get(pid);
    return p ? <Link to={`/player/${pid}`}>{p.name}</Link> : `Player ${pid}`;
  };

  const rows: { label: string; now: number | null | undefined; next: number | null | undefined }[] = [
    { label: "Ballon d'Or", now: now.world.ballonDOr[0]?.pid, next: next.world.ballonDOr[0]?.pid },
    { label: "Goalkeeper of the Year", now: now.world.goalkeeperOfYear?.[0]?.pid, next: next.world.goalkeeperOfYear?.[0]?.pid },
    { label: "Defender of the Year", now: now.world.defenderOfYear?.[0]?.pid, next: next.world.defenderOfYear?.[0]?.pid },
  ];
  if (compId !== null) {
    rows.push({
      label: `${compName} Player of the Season`,
      now: now.awards[compId]?.playerOfSeasonPid,
      next: next.awards[compId]?.playerOfSeasonPid,
    });
  }
  const worldXi = placesChanged(next.world.worldTeamOfYear, now.world.worldTeamOfYear);
  const leagueXi = compId === null
    ? null
    : placesChanged(next.awards[compId]?.teamOfSeason ?? [], now.awards[compId]?.teamOfSeason ?? []);
  const places = (n: number) => (n === 0 ? "no change" : `${n} of 11 places change`);

  return (
    <div className="gm-panel mb-3" aria-live="polite">
      <div className="gm-panel-title">If {seasonYear(now.season)} had used these numbers</div>
      {!dirty && (
        <div className="text-muted small mb-2">Change a style or a number and this shows who would have won instead.</div>
      )}
      <table className="table table-sm mb-0">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="small text-secondary" style={{ width: "45%" }}>{r.label}</td>
              <td className="small">
                {name(r.next)}
                {dirty && (r.next === r.now
                  ? <span className="text-muted"> (no change)</span>
                  : <span className="text-warning"> instead of {name(r.now)}</span>)}
              </td>
            </tr>
          ))}
          {dirty && (
            <tr>
              <td className="small text-secondary">World XI</td>
              <td className="small">{places(worldXi)}</td>
            </tr>
          )}
          {dirty && leagueXi !== null && (
            <tr>
              <td className="small text-secondary">{compName} Team of the Season</td>
              <td className="small">{places(leagueXi)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * God Mode's award formula editor.
 *
 * Built so nobody has to reason about raw weights to use it: a named style
 * sets the whole formula in one click, a preview re-scores the last finished
 * season so the effect of a change is visible before it is saved, and every
 * number underneath is explained as what it is worth in forward goals. The
 * numbers sit behind a Fine-tune disclosure because most people only need the
 * styles.
 *
 * Staged, not live: a formula is a set of numbers that only mean something
 * together, and nothing reads it until the next awards anyway.
 *
 * Exported so `awardFormulaReach.test.tsx` can render it directly: server
 * rendering cannot click a tab, the limitation `Development` documents too.
 */
export function AwardFormulas() {
  const { league, godModeSetAwardFormulaAction, simming } = useLeague();
  const stored = useMemo(() => resolveAwardFormula(league?.awardFormula), [league?.awardFormula]);
  const [draft, setDraft] = useState<AwardFormula>(() => copy(stored));
  const [saved, setSaved] = useState(false);
  // A save writes the whole league, which takes a moment on a big world. Without
  // this the bar kept saying "Unsaved changes" with Save still clickable while
  // the write was in flight (seen in a browser on a 626-club save).
  const [saving, setSaving] = useState(false);
  // Open the numbers straight away only for a save that is already hand-tuned,
  // since that is the one case where the styles above can't describe it.
  const [startOpen] = useState(() => matchingPreset(league?.awardFormula) === null);
  // Scoring a season walks the whole player pool, so typing into a box renders
  // the box first and catches the preview up after.
  const previewDraft = useDeferredValue(draft);

  const season = league ? lastCompletedSeason(league) : null;
  const now = useMemo(
    () => (league && season !== null ? scoreSeasonAwards(league, season, stored) : null),
    [league, season, stored],
  );
  const next = useMemo(
    () => (league && season !== null ? scoreSeasonAwards(league, season, resolveAwardFormula(previewDraft)) : null),
    [league, season, previewDraft],
  );

  if (!league) return null;

  const d = DEFAULT_AWARD_FORMULA;
  const dirty = !same(draft, stored);
  const preset = matchingPreset(draft);

  const edit = (fn: (f: AwardFormula) => void) => {
    setDraft((prev) => {
      const nextDraft = copy(prev);
      fn(nextDraft);
      return nextDraft;
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await godModeSetAwardFormulaAction(draft);
      setDraft(copy(resolveAwardFormula(draft)));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  // Your own league's Player of the Season is the award you'll look at first.
  const entry = season === null ? undefined : league.seasonHistory.find((h) => h.season === season);
  const userCompId = entry?.compsByTid[league.meta.userTid] ?? null;
  const compName = league.competitions.find((c) => c.id === userCompId)?.name ?? "";

  return (
    <div style={{ maxWidth: 680 }}>
      <p className="text-secondary small mb-3">
        Choose what the end-of-season awards reward. Your choice is used the next time awards are
        handed out, and seasons already played keep their winners. A Team of the Season place is part
        of what makes a big club refuse to sell a star, so changing that also changes who&apos;s on the
        transfer market.
      </p>

      <div className="gm-panel mb-3">
        <div className="gm-panel-title">Award style</div>
        {AWARD_PRESETS.map((p) => (
          <div key={p.id} className="form-check mb-2">
            <input
              type="radio"
              className="form-check-input"
              name="award-preset"
              id={`award-preset-${p.id}`}
              checked={preset === p.id}
              onChange={() => { setDraft(copy(p.formula)); setSaved(false); }}
            />
            <label className="form-check-label" htmlFor={`award-preset-${p.id}`}>
              <span className="fw-semibold">{p.label}</span>
              <span className="d-block text-muted small">{p.description}</span>
            </label>
          </div>
        ))}
        {preset === null && (
          <div className="small text-warning">Custom: your own numbers, set under Fine-tune below.</div>
        )}
      </div>

      {now && next ? (
        <Preview now={now} next={next} dirty={dirty} compId={userCompId} compName={compName} />
      ) : (
        <div className="gm-panel mb-3">
          <div className="gm-panel-title">Preview</div>
          <div className="text-muted small">
            Once a season has finished, this shows who would have won its awards under your numbers.
          </div>
        </div>
      )}

      <details className="gm-panel mb-3" open={startOpen || undefined}>
        <summary className="gm-panel-title" style={{ cursor: "pointer" }}>Fine-tune the numbers</summary>
        <div className="text-muted small mb-3">
          Every award is a score added up from these. They&apos;re explained as what they&apos;re worth in
          goals by a forward, using the numbers you have in the boxes right now.
        </div>

        <div className="fw-semibold small mb-2">Who can win</div>
        <FieldRow
          id="award-minAppearances"
          label="League games needed to qualify"
          explain="Players over this come first. If nobody in a league gets there, the best of whoever played wins."
          value={draft.minAppearances}
          fallback={d.minAppearances}
          step={1}
          onChange={(v) => edit((f) => { f.minAppearances = v; })}
        />

        <div className="fw-semibold small mt-3 mb-2">Player of the Season (the starting point for every award)</div>
        <FieldRow
          id="award-ratingWeight"
          label="Average match rating"
          explain={`Half a point of average rating is worth ${inForwardGoals(0.5 * draft.ratingWeight, draft)}.`}
          value={draft.ratingWeight}
          fallback={d.ratingWeight}
          onChange={(v) => edit((f) => { f.ratingWeight = v; })}
        />
        <FieldRow
          id="award-ovrWeight"
          label="Overall rating"
          explain={`Ten points of overall is worth ${inForwardGoals(10 * draft.ovrWeight, draft)}.`}
          value={draft.ovrWeight}
          fallback={d.ovrWeight}
          onChange={(v) => edit((f) => { f.ovrWeight = v; })}
        />
        <div className="text-muted small mb-1">
          What a goal and an assist add. A goal is worth more the further back a player plays,
          because he gets so few.
        </div>
        <table className="table table-sm align-middle mb-3">
          <thead>
            <tr><th>Position</th><th>A goal</th><th>An assist</th></tr>
          </thead>
          <tbody>
            {AWARD_GROUPS.map((g) => (
              <tr key={g}>
                <td className="small">{GROUP_LABELS[g]}</td>
                <td>
                  <NumberBox
                    id={`award-goal-${g}`} label={`${GROUP_LABELS[g]}: a goal`}
                    value={draft.goalWeight[g]} fallback={d.goalWeight[g]}
                    onChange={(v) => edit((f) => { f.goalWeight[g] = v; })}
                  />
                </td>
                <td>
                  <NumberBox
                    id={`award-assist-${g}`} label={`${GROUP_LABELS[g]}: an assist`}
                    value={draft.assistWeight[g]} fallback={d.assistWeight[g]}
                    onChange={(v) => edit((f) => { f.assistWeight[g] = v; })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="fw-semibold small mt-3 mb-2">Team of the Season (also the World XI and the Goalkeeper and Defender of the Year)</div>
        <FieldRow
          id="award-work-GK-savePct"
          label="Keeper's save percentage"
          explain={`Five percentage points above an average keeper is worth ${inForwardGoals(0.05 * draft.positionWork.GK.savePct, draft)}.`}
          value={draft.positionWork.GK.savePct}
          fallback={d.positionWork.GK.savePct}
          onChange={(v) => edit((f) => { f.positionWork.GK.savePct = v; })}
        />
        <div className="text-muted small mb-1">Tackles and interceptions, counted per game rather than over the season.</div>
        <table className="table table-sm align-middle mb-3">
          <thead>
            <tr><th>Position</th><th>Weight</th><th>One more a game is worth</th></tr>
          </thead>
          <tbody>
            {OUTFIELD_POSITIONS.map((pos) => (
              <tr key={pos}>
                <td className="small">{pos}</td>
                <td>
                  <NumberBox
                    id={`award-work-${pos}`} label={`${pos}: tackles and interceptions per game`}
                    value={draft.positionWork[pos].defendingPerGame}
                    fallback={d.positionWork[pos].defendingPerGame}
                    onChange={(v) => edit((f) => { f.positionWork[pos].defendingPerGame = v; })}
                  />
                </td>
                <td className="small text-muted">
                  {draft.positionWork[pos].defendingPerGame === 0
                    ? "nothing"
                    : inForwardGoals(draft.positionWork[pos].defendingPerGame, draft)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="fw-semibold small mt-3 mb-1">Worldwide awards</div>
        <div className="text-muted small mb-2">
          The Ballon d&apos;Or, World XI and Goalkeeper and Defender of the Year add all of these on top of a
          player&apos;s league season.
        </div>

        <div className="small text-secondary mt-2 mb-2">Continental Cup</div>
        <FieldRow
          id="award-world-cupMultiplier"
          label="His cup goals and assists"
          explain={`A cup goal counts ${times(draft.world.cupMultiplier)} a league goal.`}
          value={draft.world.cupMultiplier}
          fallback={d.world.cupMultiplier}
          onChange={(v) => edit((f) => { f.world.cupMultiplier = v; })}
        />
        <FieldRow
          id="award-world-cupRatingWeight"
          label="His cup match rating"
          explain={`Half a point above average across a full cup run is worth ${inForwardGoals(0.5 * draft.world.cupRatingWeight, draft)}.`}
          value={draft.world.cupRatingWeight}
          fallback={d.world.cupRatingWeight}
          onChange={(v) => edit((f) => { f.world.cupRatingWeight = v; })}
        />
        {CUP_RUN_LABELS.map((runLabel, i) => (
          <FieldRow
            key={runLabel}
            id={`award-world-cupRun-${i}`}
            label={`His club's run: ${runLabel.toLowerCase()}`}
            explain={`Worth ${inForwardGoals(draft.world.cupRunBonus[i], draft)} to a regular in the side.`}
            value={draft.world.cupRunBonus[i]}
            fallback={d.world.cupRunBonus[i]}
            onChange={(v) => edit((f) => { f.world.cupRunBonus[i] = v; })}
          />
        ))}

        {WORLD_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="small text-secondary mt-3 mb-2">{group.title}</div>
            {group.fields.map((field) => (
              <FieldRow
                key={field.key}
                id={`award-world-${field.key}`}
                label={field.label}
                explain={field.explain(draft.world[field.key], draft)}
                value={draft.world[field.key]}
                fallback={d.world[field.key]}
                onChange={(v) => edit((f) => { f.world[field.key] = v; })}
              />
            ))}
          </div>
        ))}
      </details>

      <div className="gm-award-actions d-flex align-items-center gap-2 flex-wrap">
        <button className="btn btn-sm btn-warning" disabled={!dirty || simming || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          disabled={!dirty || saving}
          onClick={() => { setDraft(copy(stored)); setSaved(false); }}
        >
          Discard changes
        </button>
        <span className="small text-muted">
          {saving
            ? "Saving your formula…"
            : dirty
            ? "Unsaved changes."
            : saved
              ? "Saved."
              : preset === "shipped"
                ? "Using the game's own formula."
                : "Using your custom formula."}
        </span>
      </div>
    </div>
  );
}
