import { useLeague } from "../context/LeagueContext.js";
import {
  CONTINENTAL_ORDER, CUP_FORMATS, largestValidCupField, type CupCompetitionId,
} from "../../core/constants.js";
import { cupPlan, worldHasCup, continentalSlotOverrides } from "../../core/cup/cup.js";
import {
  DEFAULT_CONTINENTAL_FORMAT, FIELD_SIZE_OPTIONS, KNOCKOUT_SIZE_OPTIONS, LEAGUE_PHASE_GAME_OPTIONS,
  continentalFormatFor, describeCupShape, isDefaultContinentalFormat, resolveCupShape,
  type ContinentalFormatSettings, type CupKnockoutSize, type CupOpeningStage,
} from "../../core/cup/cupShape.js";

/** One-click formats, each a real competition people will recognise. */
const PRESETS: { label: string; hint: string; settings: ContinentalFormatSettings }[] = [
  {
    label: "The game's format",
    hint: "Six-game league phase, playoff round, two-legged knockout.",
    settings: { ...DEFAULT_CONTINENTAL_FORMAT },
  },
  {
    label: "Groups and a Round of 16",
    hint: "Groups of four, top two go through. The old Champions League.",
    settings: { ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups" },
  },
  {
    label: "Long league phase",
    hint: "Eight games each, a playoff, then a Round of 16. Today's Champions League.",
    settings: { ...DEFAULT_CONTINENTAL_FORMAT, leaguePhaseGames: 8, knockoutSize: 16 },
  },
  {
    label: "Straight knockout",
    hint: "No group games. Every tie is win or go home.",
    settings: { ...DEFAULT_CONTINENTAL_FORMAT, opening: "knockout" },
  },
  {
    label: "One-off ties",
    hint: "The game's format, but every knockout tie is a single match.",
    settings: { ...DEFAULT_CONTINENTAL_FORMAT, twoLegged: false },
  },
  {
    label: "Away goals era",
    hint: "Groups of four and a Round of 16, with away goals settling a level tie. Europe before 2021.",
    settings: { ...DEFAULT_CONTINENTAL_FORMAT, opening: "groups", awayGoals: true },
  },
];

const OPENING_LABELS: Record<CupOpeningStage, string> = {
  league: "League phase (everyone in one table)",
  groups: "Groups of four",
  knockout: "Straight knockout",
};

const sizeLabel = (s: CupKnockoutSize): string =>
  s === "auto" ? "Automatic (sized to the field)" : s === 16 ? "Round of 16" : s === 8 ? "Quarter-finals" : "Semi-finals";

const sameSettings = (a: ContinentalFormatSettings, b: ContinentalFormatSettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * God Mode: how each club continental competition is played. A change is read
 * at the next offseason draw, so the competition already under way finishes in
 * the format it was drawn with.
 */
export function ContinentalFormats() {
  const { league, godModeSetContinentalFormatAction } = useLeague();
  if (!league) return null;
  // The size settings reach every qualification question through this map, so
  // the preview has to be built from it too — otherwise the sentence describes
  // a field the draw won't produce. The coefficients are deliberately NOT
  // recomputed here: they are zero-sum, so they move places between countries
  // without changing the total, and the total is all a preview needs.
  const overrides = continentalSlotOverrides(league.competitions, league.continentalFormats, null) ?? undefined;
  const fieldOf = (id: CupCompetitionId): number =>
    largestValidCupField(cupPlan(league.competitions, CUP_FORMATS[id], overrides)?.total ?? 0);
  const competitions = CONTINENTAL_ORDER.filter((id) => worldHasCup(league.competitions, CUP_FORMATS[id], overrides));

  return (
    <div>
      <p className="small text-secondary">
        Change how the club continental competitions are played. A change starts with next
        season&apos;s draw, so anything already under way finishes the way it started. Prize money is
        paid for the stages each format plays. Everything but the size leaves qualifying alone:
        change the size and each league sends more or fewer clubs to match.
      </p>
      {competitions.length === 0 && (
        <p className="text-muted">This world doesn&apos;t have enough top-flight leagues for a continental competition.</p>
      )}
      {competitions.map((id) => (
        <CompetitionFormat
          key={id}
          competition={id}
          field={fieldOf(id)}
          settings={continentalFormatFor(league.continentalFormats, id)}
          onChange={(s) => godModeSetContinentalFormatAction(id, isDefaultContinentalFormat(s) ? null : s)}
        />
      ))}
    </div>
  );
}

function CompetitionFormat({ competition, field, settings, onChange }: {
  competition: CupCompetitionId;
  field: number;
  settings: ContinentalFormatSettings;
  onChange: (s: ContinentalFormatSettings) => void;
}) {
  const format = CUP_FORMATS[competition];
  const set = (patch: Partial<ContinentalFormatSettings>) => onChange({ ...settings, ...patch });
  const shape = resolveCupShape(field, settings);
  const idp = `cf-${competition}`;

  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline mb-2">
          <h2 className="h6 m-0">{format.name}</h2>
          {!isDefaultContinentalFormat(settings) && <span className="badge text-bg-warning">Changed</span>}
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              title={p.hint}
              className={`btn btn-sm ${sameSettings(p.settings, settings) ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => onChange({ ...p.settings })}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p className="small mb-3" aria-live="polite">
          <strong>Next season:</strong> {describeCupShape(shape, field)}
        </p>

        <details>
          <summary className="small">Fine-tune</summary>
          <div className="row g-3 mt-1">
            <div className="col-sm-6">
              <label className="form-label small" htmlFor={`${idp}-opening`}>How it opens</label>
              <select
                id={`${idp}-opening`}
                className="form-select form-select-sm"
                value={settings.opening}
                onChange={(e) => set({ opening: e.target.value as CupOpeningStage })}
              >
                {(Object.keys(OPENING_LABELS) as CupOpeningStage[]).map((o) => (
                  <option key={o} value={o}>{OPENING_LABELS[o]}</option>
                ))}
              </select>
            </div>
            <div className="col-sm-6">
              <label className="form-label small" htmlFor={`${idp}-ko`}>Knockout starts at</label>
              <select
                id={`${idp}-ko`}
                className="form-select form-select-sm"
                value={String(settings.knockoutSize)}
                onChange={(e) => set({ knockoutSize: (e.target.value === "auto" ? "auto" : Number(e.target.value)) as CupKnockoutSize })}
              >
                {KNOCKOUT_SIZE_OPTIONS.map((s) => <option key={s} value={String(s)}>{sizeLabel(s)}</option>)}
              </select>
              {settings.knockoutSize !== "auto" && shape.koSize !== settings.knockoutSize && (
                <div className="form-text">This field can&apos;t fill that, so it starts at the {sizeLabel(shape.koSize as CupKnockoutSize).toLowerCase()}.</div>
              )}
            </div>
            {settings.opening === "league" && (
              <div className="col-sm-6">
                <label className="form-label small" htmlFor={`${idp}-games`}>League phase games per club</label>
                <select
                  id={`${idp}-games`}
                  className="form-select form-select-sm"
                  value={settings.leaguePhaseGames}
                  onChange={(e) => set({ leaguePhaseGames: Number(e.target.value) as 4 | 6 | 8 })}
                >
                  {LEAGUE_PHASE_GAME_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
            <div className="col-sm-6">
              <label className="form-label small" htmlFor={`${idp}-size`}>How many clubs are in it</label>
              <select
                id={`${idp}-size`}
                className="form-select form-select-sm"
                value={String(settings.fieldSize)}
                onChange={(e) => set({ fieldSize: e.target.value === "auto" ? "auto" : Number(e.target.value) })}
              >
                <option value="auto">Automatic (whatever the leagues send)</option>
                {FIELD_SIZE_OPTIONS.map((n) => <option key={n} value={String(n)}>{n} clubs</option>)}
              </select>
              {settings.fieldSize !== "auto" && field !== settings.fieldSize && (
                <div className="form-text">
                  The leagues can only fill {field}, so that&apos;s what it plays.
                </div>
              )}
              {settings.fieldSize !== "auto" && field === settings.fieldSize && (
                <div className="form-text">
                  Each league sends more or fewer in proportion, so the competitions below this one
                  shift down the tables to match.
                </div>
              )}
              {/*
                * On "auto" the bracket is sized by the shipped rule, which stops at
                * the quarter-finals however big the field is — so a 48-club league
                * phase sends 36 clubs home after six games. That is correct and it
                * reads as a bug, so say so and point at the control that fixes it
                * rather than changing a rule five other formats depend on.
                */}
              {settings.opening !== "knockout" && settings.knockoutSize === "auto"
                && shape.directQF + shape.playoffTeams < field / 3 && (
                <div className="form-text">
                  Only {shape.directQF + shape.playoffTeams} of {field} get out of the opening stage.
                  Set <em>Knockout starts at</em> to a bigger round if you want more of them through.
                </div>
              )}
            </div>
            <div className="col-sm-6 d-flex flex-column justify-content-end gap-1">
              {settings.opening === "league" && (
                <div className="form-check form-switch">
                  <input
                    id={`${idp}-playoff`}
                    className="form-check-input"
                    type="checkbox"
                    checked={settings.playoffRound}
                    onChange={(e) => set({ playoffRound: e.target.checked })}
                  />
                  <label className="form-check-label small" htmlFor={`${idp}-playoff`}>Playoff round for the last places</label>
                </div>
              )}
              <div className="form-check form-switch">
                <input
                  id={`${idp}-legs`}
                  className="form-check-input"
                  type="checkbox"
                  checked={settings.twoLegged}
                  onChange={(e) => set({ twoLegged: e.target.checked })}
                />
                <label className="form-check-label small" htmlFor={`${idp}-legs`}>Two-legged ties (the final is always one match)</label>
              </div>
              {settings.twoLegged && (
                <div className="form-check form-switch">
                  <input
                    id={`${idp}-away`}
                    className="form-check-input"
                    type="checkbox"
                    checked={settings.awayGoals}
                    onChange={(e) => set({ awayGoals: e.target.checked })}
                  />
                  <label className="form-check-label small" htmlFor={`${idp}-away`}>
                    Away goals break a level tie (extra time included)
                  </label>
                </div>
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
