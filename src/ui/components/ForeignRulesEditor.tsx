import type { ForeignRule } from "../../core/foreignRules.js";

type Kind = ForeignRule["kind"];

/** The number each rule kind carries, and where it sits on the rule. */
const numberOf = (r: ForeignRule): number => ("max" in r ? r.max : r.min);

/** What each kind starts at when switched on: the shipped leagues' typical values. */
const DEFAULTS: Record<Kind, ForeignRule> = {
  foreignCap: { kind: "foreignCap", max: 6, basis: "nationality" },
  nonEuCap: { kind: "nonEuCap", max: 3 },
  homegrownMin: { kind: "homegrownMin", min: 8 },
  nationalMin: { kind: "nationalMin", min: 12 },
};

const ROWS: { kind: Kind; label: string }[] = [
  { kind: "foreignCap", label: "Most foreign players a club can register" },
  { kind: "nonEuCap", label: "Most non-EU players a club can register" },
  { kind: "homegrownMin", label: "Fewest homegrown players a club should keep" },
  { kind: "nationalMin", label: "Fewest domestic players a club should keep" },
];

/**
 * The four kinds of foreign-player registration rule (see core/foreignRules.ts),
 * each switched on or off with its number beside it. Caps are hard (a club at
 * one can't sign another player it counts), minimums soft (a club short of one
 * prefers eligible players), which the hint under the controls says in a line.
 */
export function ForeignRulesEditor({ value, onChange, id }: {
  value: ForeignRule[];
  onChange: (rules: ForeignRule[]) => void;
  id: string;
}) {
  const find = (kind: Kind) => value.find((r) => r.kind === kind);
  const put = (kind: Kind, rule: ForeignRule | null) => {
    const rest = value.filter((r) => r.kind !== kind);
    onChange(rule ? [...rest, rule] : rest);
  };

  return (
    <div className="mb-2">
      <label className="form-label small mb-1">Foreign-player rules</label>
      {ROWS.map(({ kind, label }) => {
        const rule = find(kind);
        const inputId = `${id}-${kind}`;
        return (
          <div key={kind} className="d-flex flex-wrap align-items-center gap-2 mb-1">
            <div className="form-check form-switch small m-0" style={{ minWidth: 0, flex: "1 1 16rem" }}>
              <input
                id={inputId}
                type="checkbox"
                className="form-check-input"
                checked={!!rule}
                onChange={(e) => put(kind, e.target.checked ? DEFAULTS[kind] : null)}
              />
              <label className="form-check-label" htmlFor={inputId}>{label}</label>
            </div>
            {rule && (
              <input
                type="number"
                className="form-control form-control-sm"
                style={{ width: "4.5rem" }}
                min={0}
                max={30}
                value={numberOf(rule)}
                aria-label={label}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(30, Math.round(Number(e.target.value) || 0)));
                  put(kind, "max" in rule ? { ...rule, max: n } : { ...rule, min: n });
                }}
              />
            )}
            {rule?.kind === "foreignCap" && (
              <select
                className="form-select form-select-sm"
                style={{ width: "auto" }}
                value={rule.basis}
                aria-label="What counts as foreign"
                onChange={(e) => put(kind, { ...rule, basis: e.target.value as "nationality" | "trained" })}
              >
                <option value="nationality">by nationality</option>
                <option value="trained">trained abroad</option>
              </select>
            )}
            {rule?.kind === "nonEuCap" && (
              <>
                <div className="form-check small m-0">
                  <input
                    id={`${inputId}-acp`}
                    type="checkbox"
                    className="form-check-input"
                    checked={!!rule.acp}
                    onChange={(e) => put(kind, { ...rule, acp: e.target.checked || undefined })}
                  />
                  <label className="form-check-label" htmlFor={`${inputId}-acp`}>ACP nations count as EU</label>
                </div>
                <div className="form-check small m-0">
                  <input
                    id={`${inputId}-uk`}
                    type="checkbox"
                    className="form-check-input"
                    checked={!!rule.uk}
                    onChange={(e) => put(kind, { ...rule, uk: e.target.checked || undefined })}
                  />
                  <label className="form-check-label" htmlFor={`${inputId}-uk`}>So do UK players</label>
                </div>
              </>
            )}
          </div>
        );
      })}
      <div className="form-text">
        Caps block signings; minimums only steer them. Nobody already signed is let go.
      </div>
    </div>
  );
}
