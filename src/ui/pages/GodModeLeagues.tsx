import { useMemo, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import {
  countriesOf, divisionsOf, normalizeLeagueSpec, resolveLeagueSpec,
  type Competition, type LeagueSpec,
} from "../../core/competitions.js";
import { competitionForeignRules, type ForeignRule } from "../../core/foreignRules.js";
import {
  canAddCountry, editedCountries, leagueSpecFromDivisions, rebuildCountry, userCountryOf,
} from "../../core/worldEdit.js";
import {
  LeagueSettings, applySpecEdit, newLeagueEntry, type WorldEntry,
} from "../components/WorldSetup.js";
import { ForeignRulesEditor } from "../components/ForeignRulesEditor.js";

/** A rule list with no `undefined` flags, so an unticked box stores nothing. */
const cleanRules = (rules: ForeignRule[]): ForeignRule[] => JSON.parse(JSON.stringify(rules));

const ADD = "__add__";

/**
 * God Mode: change the world from next season on. Any league's settings, its
 * divisions and club counts; add a league; remove one. The same panel the
 * new-save screen uses. Saved changes queue on the save and take over at the
 * next offseason, after promotion and relegation (core/worldEdit.ts queues,
 * core/worldRestructure.ts applies), so the season under way finishes as it
 * started. A year-by-year historical world is a matter of queuing each
 * season's changes before advancing.
 */
export function LeagueRules() {
  const {
    league, godModeQueueLeagueEditAction, godModeDiscardLeagueEditAction,
    godModeAddLeagueAction, godModeRemoveLeagueAction, simming,
  } = useLeague();
  const [choice, setChoice] = useState<string | null>(null);
  const live = league?.competitions ?? [];
  const pending = league?.pendingCompetitions;
  const base = pending ?? live;
  // Every league the picker can name: the queued world's, then any it removes.
  const countries = useMemo(() => {
    const queued = countriesOf([...base]);
    return [...queued, ...countriesOf([...live]).filter((c) => !queued.includes(c))];
  }, [base, live]);
  if (!league) return null;

  const liveCountries = new Set(live.map((c) => c.country));
  const queuedCountries = new Set(base.map((c) => c.country));
  const changed = editedCountries(live, pending);
  const userCountry = userCountryOf(league);
  const selected = choice ?? countries[0] ?? ADD;
  const label = (c: string) =>
    !liveCountries.has(c) ? `${c} (new next season)`
      : !queuedCountries.has(c) ? `${c} (removed next season)`
        : changed.has(c) ? `${c} (changed for next season)` : c;
  const clubsIn = (comps: readonly Competition[]) => {
    const ids = new Set(comps.map((c) => c.id));
    return league.teams.filter((t) => ids.has(t.compId)).length;
  };

  return (
    <div>
      <p className="small text-secondary">
        Change the world from next season on: any league&apos;s settings, its divisions and
        club counts, new leagues and removed ones. The season under way finishes as it started,
        then your changes take over after promotion and relegation.
      </p>

      <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
        <div style={{ minWidth: 0, flex: "0 1 420px" }}>
          <label className="form-label form-label-sm" htmlFor="gm-league-country">League</label>
          <select
            id="gm-league-country"
            className="form-select form-select-sm"
            value={selected}
            onChange={(e) => setChoice(e.target.value)}
          >
            {countries.map((c) => <option key={c} value={c}>{label(c)}</option>)}
            <option value={ADD}>Add a league…</option>
          </select>
        </div>
      </div>

      {selected === ADD && (
        <NewLeagueEditor
          key="add"
          busy={simming}
          taken={(name) => !canAddCountry(live, pending, name)}
          onSave={async (spec) => { await godModeAddLeagueAction(spec); setChoice(spec.country.trim()); }}
        />
      )}

      {selected !== ADD && !liveCountries.has(selected) && (
        <NewLeagueEditor
          key={`added:${selected}:${JSON.stringify(divisionsOf([...base], selected))}`}
          busy={simming}
          start={leagueSpecFromDivisions(divisionsOf([...base], selected))}
          taken={(name) => name.trim() !== selected && !canAddCountry(live, pending, name)}
          onSave={async (spec) => {
            await godModeAddLeagueAction(spec, selected);
            setChoice(spec.country.trim());
          }}
          onCancel={async () => { await godModeDiscardLeagueEditAction(selected); setChoice(null); }}
        />
      )}

      {liveCountries.has(selected) && !queuedCountries.has(selected) && (
        <div className="card mb-3">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-baseline mb-2">
              <h2 className="h6 m-0">{selected}</h2>
              <span className="badge text-bg-danger">Removed next season</span>
            </div>
            <p className="small">
              At the end of this season all {clubsIn(divisionsOf([...live], selected))} of its clubs
              fold. Their players become free agents, and the clubs stay in the history books.
            </p>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={simming}
              onClick={() => godModeDiscardLeagueEditAction(selected)}
            >
              Keep this league
            </button>
          </div>
        </div>
      )}

      {liveCountries.has(selected) && queuedCountries.has(selected) && (
        <CountryEditor
          // Remount on switching league, and after a save or undo changes what
          // the draft starts from, so it never carries one league's edits to another.
          key={`${selected}:${JSON.stringify(divisionsOf([...base], selected))}`}
          country={selected}
          divisions={divisionsOf([...base], selected)}
          liveDivisions={divisionsOf([...live], selected)}
          liveCounts={divisionsOf([...live], selected).map((d) => clubsIn([d]))}
          queued={changed.has(selected)}
          isUserCountry={userCountry === selected}
          busy={simming}
          onSave={(spec, rules) => godModeQueueLeagueEditAction(selected, spec, rules)}
          onUndo={() => godModeDiscardLeagueEditAction(selected)}
          onRemove={() => godModeRemoveLeagueAction(selected)}
        />
      )}
    </div>
  );
}

/** What the rollover will do to a live league's clubs, one line each. */
function rolloverLines(
  liveDivisions: readonly Competition[],
  liveCounts: readonly number[],
  spec: LeagueSpec,
  isUserCountry: boolean,
): string[] {
  const r = resolveLeagueSpec(spec);
  const sizes = [r.d1Teams, r.d2Teams, r.d3Teams].slice(0, r.divisions);
  const names = [spec.d1Name, spec.d2Name, spec.d3Name];
  const lines: string[] = [];
  sizes.forEach((size, i) => {
    const name = names[i] || `${spec.country} Division ${i + 1}`;
    const have = liveCounts[i];
    if (have === undefined) lines.push(`${name} is new: ${size} new clubs join it.`);
    else if (size > have) lines.push(`${size - have} new ${size - have === 1 ? "club joins" : "clubs join"} ${name}.`);
    else if (size < have) {
      lines.push(`The bottom ${have - size} in ${name} fold. Clubs promoted into it are safe.`);
    }
  });
  liveDivisions.slice(r.divisions).forEach((d, i) => {
    lines.push(`${d.name} goes: its ${liveCounts[r.divisions + i]} clubs fold.`);
  });
  if (isUserCountry && lines.length > 0) {
    lines.push("Your club never folds. If its division goes, it drops into the lowest one left.");
  }
  return lines;
}

function CountryEditor({
  country, divisions, liveDivisions, liveCounts, queued, isUserCountry, busy, onSave, onUndo, onRemove,
}: {
  country: string;
  divisions: Competition[];
  liveDivisions: Competition[];
  liveCounts: number[];
  queued: boolean;
  isUserCountry: boolean;
  busy: boolean;
  onSave: (spec: LeagueSpec, rules: ForeignRule[] | null) => Promise<void>;
  onUndo: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const start = useMemo(() => leagueSpecFromDivisions(divisions), [divisions]);
  const startRules = useMemo(() => competitionForeignRules(divisions[0]), [divisions]);
  const [spec, setSpec] = useState<LeagueSpec>(start);
  // null until the rules are touched, so an untouched league keeps each
  // division's own (France's second tier has a stricter cap than its first).
  const [rules, setRules] = useState<ForeignRule[] | null>(null);

  const dirty = JSON.stringify(spec) !== JSON.stringify(start) || rules !== null;
  const fits = rebuildCountry(divisions, spec, rules, { nextId: Number.MAX_SAFE_INTEGER - 3 }) !== null;
  const entry: WorldEntry = { id: `save-${country}`, spec, included: true, shipped: false, linkMoney: false };
  const effects = rolloverLines(liveDivisions, liveCounts, spec, isUserCountry);

  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline mb-2">
          <h2 className="h6 m-0">{country}</h2>
          {queued && <span className="badge text-bg-warning">Changed for next season</span>}
        </div>

        <LeagueSettings
          entry={entry}
          midSave
          onEntry={(next) => { if (next.spec) setSpec(normalizeLeagueSpec(next.spec)); }}
          onSpec={(next) => setSpec((s) => applySpecEdit({ ...entry, spec: s }, next))}
        >
          <ForeignRulesEditor
            id={`gm-rules-${country}`}
            value={rules ?? startRules}
            onChange={(r) => setRules(cleanRules(r))}
          />
          {rules === null && divisions.length > 1
            && divisions.some((d) => JSON.stringify(competitionForeignRules(d)) !== JSON.stringify(startRules)) && (
            <div className="form-text mb-2">
              Showing the top division&apos;s rules. The lower divisions have their own until you change these.
            </div>
          )}
        </LeagueSettings>

        {effects.length > 0 && (
          <div className="gm-panel mb-3">
            <div className="gm-panel-title">At the rollover</div>
            {effects.map((line) => <p key={line} className="small mb-1">{line}</p>)}
          </div>
        )}

        {!fits && <p className="small text-warning">That shape can&apos;t be built, so it can&apos;t be saved.</p>}
        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!dirty || !fits || busy}
            onClick={() => onSave(spec, rules)}
          >
            Save for next season
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            disabled={!dirty || busy}
            onClick={() => { setSpec(start); setRules(null); }}
          >
            Discard edits
          </button>
          {queued && (
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => onUndo()}>
              Keep this season&apos;s setup
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-danger ms-auto"
            disabled={busy || isUserCountry}
            title={isUserCountry ? "Your club plays here" : undefined}
            onClick={() => onRemove()}
          >
            Remove this league
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A league to add at the next rollover, or one added and not yet played. The
 * full new-save panel: strength and continent are open here, because its clubs
 * don't exist yet.
 */
function NewLeagueEditor({ start, taken, busy, onSave, onCancel }: {
  start?: LeagueSpec;
  taken: (name: string) => boolean;
  busy: boolean;
  onSave: (spec: LeagueSpec) => Promise<void>;
  onCancel?: () => Promise<void>;
}) {
  const [entry, setEntry] = useState<WorldEntry>(() => {
    const fresh = newLeagueEntry(1);
    return start ? { ...fresh, spec: start, linkMoney: false } : { ...fresh, spec: { ...fresh.spec, country: "" } };
  });
  const name = entry.spec.country.trim();
  const clash = name.length > 0 && taken(name);
  const clubs = (() => {
    const r = resolveLeagueSpec(entry.spec);
    return [r.d1Teams, r.d2Teams, r.d3Teams].slice(0, r.divisions).reduce((a, b) => a + b, 0);
  })();

  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline mb-2">
          <h2 className="h6 m-0">{start ? name || "New league" : "Add a league"}</h2>
          {start && <span className="badge text-bg-warning">New next season</span>}
        </div>
        <div className="mb-3" style={{ maxWidth: 420 }}>
          <label className="form-label small mb-1" htmlFor="gm-new-country">Country</label>
          <input
            id="gm-new-country"
            type="text"
            className="form-control form-control-sm"
            value={entry.spec.country}
            placeholder="Netherlands"
            onChange={(e) => setEntry({ ...entry, spec: { ...entry.spec, country: e.target.value } })}
          />
          {clash && <div className="form-text text-warning">There&apos;s already a league called that.</div>}
        </div>

        <LeagueSettings
          entry={entry}
          noRosterFiles
          onEntry={(next) => setEntry({ ...entry, ...next })}
          onSpec={(next) => setEntry({ ...entry, spec: applySpecEdit(entry, next) })}
        />

        <p className="small text-muted">
          Its {clubs} clubs are created at the end of this season, squads and all. It gets
          continental places from the season after.
        </p>
        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || name.length === 0 || clash}
            onClick={() => onSave({ ...entry.spec, country: name })}
          >
            {start ? "Save for next season" : "Add for next season"}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => onCancel()}>
              Don&apos;t add it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
