import type { ImportSelection, RosterFileContents } from "../../core/teams/leagueFile.js";

interface Props {
  contents: RosterFileContents;
  selection: ImportSelection;
  /** Leagues (by competitionKey) this world has nowhere to put. Shown, but can't be ticked. */
  unplaceable: ReadonlySet<string>;
  onChange: (next: ImportSelection) => void;
}

/** Past this many leagues the list gets All/None buttons and scrolls in its own box. */
const LONG_LIST = 6;

/**
 * What to take from a loaded league file, Basketball GM style: one box per kind
 * of thing the file holds, then one per league in it.
 *
 * Only what the file actually contains gets a box. A squads box on a file with
 * no squads would do nothing when cleared, which reads as broken, so it isn't
 * drawn. Names and colours are always there, since every club entry must carry
 * both.
 *
 * Bare `form-check`, not `form-switch`: this is picking items out of a list,
 * the case CLAUDE.md's UI conventions reserve plain checkboxes for.
 */
export function ImportChecklist({ contents, selection, unplaceable, onChange }: Props) {
  const set = (patch: Partial<ImportSelection>) => onChange({ ...selection, ...patch });

  function toggleLeague(key: string, on: boolean) {
    const excluded = new Set(selection.excluded);
    if (on) excluded.delete(key);
    else excluded.add(key);
    set({ excluded });
  }

  const categories: { id: keyof Pick<ImportSelection, "names" | "colors" | "squads" | "logos">; label: string; show: boolean }[] = [
    { id: "names", label: "Club names and abbreviations", show: true },
    { id: "colors", label: "Club colors", show: true },
    {
      id: "squads",
      label: `Squads (${contents.squads} ${contents.squads === 1 ? "club" : "clubs"})`,
      show: contents.squads > 0,
    },
    {
      id: "logos",
      label: `Badges (${contents.logos} ${contents.logos === 1 ? "club" : "clubs"})`,
      show: contents.logos > 0,
    },
  ];

  const placeable = contents.competitions.filter((c) => !unplaceable.has(c.key));
  const long = contents.competitions.length > LONG_LIST;

  return (
    <div className="import-checklist mt-2">
      <div className="row g-3">
        <div className="col-sm-5">
          <div className="small fw-semibold text-uppercase text-muted mb-1">What to import</div>
          {categories.filter((c) => c.show).map((c) => (
            <div className="form-check" key={c.id}>
              <input
                className="form-check-input"
                type="checkbox"
                id={`import-${c.id}`}
                checked={selection[c.id]}
                onChange={(e) => set({ [c.id]: e.target.checked })}
              />
              <label className="form-check-label small" htmlFor={`import-${c.id}`}>
                {c.label}
              </label>
            </div>
          ))}
          {!selection.names && (
            <div className="small text-muted mt-1">
              Clubs keep their fictional names, so anything else you import lands on those.
            </div>
          )}
        </div>
        <div className="col-sm-7">
          <div className="d-flex align-items-baseline gap-2 mb-1">
            <span className="small fw-semibold text-uppercase text-muted">Leagues</span>
            {long && (
              <>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={() => set({ excluded: new Set() })}
                >
                  All
                </button>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={() => set({ excluded: new Set(placeable.map((c) => c.key)) })}
                >
                  None
                </button>
              </>
            )}
          </div>
          <div className={long ? "import-checklist-leagues" : undefined}>
            {contents.competitions.map((c) => {
              const missing = unplaceable.has(c.key);
              const extras = [
                `${c.clubs} ${c.clubs === 1 ? "club" : "clubs"}`,
                c.squads > 0 ? "squads" : null,
                c.logos > 0 ? "badges" : null,
              ].filter(Boolean).join(" · ");
              return (
                <div className="form-check" key={c.key}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`import-league-${c.key}`}
                    checked={!missing && !selection.excluded.has(c.key)}
                    disabled={missing}
                    onChange={(e) => toggleLeague(c.key, e.target.checked)}
                  />
                  <label
                    className={`form-check-label small${missing ? " text-muted" : ""}`}
                    htmlFor={`import-league-${c.key}`}
                  >
                    {c.match}{" "}
                    <span className="text-muted">
                      {missing ? "(not in this world)" : `(${extras})`}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
