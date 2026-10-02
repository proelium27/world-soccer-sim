import { useMemo, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import {
  countriesOf, divisionsOf, normalizeLeagueSpec, type LeagueSpec,
} from "../../core/competitions.js";
import { competitionForeignRules, type ForeignRule } from "../../core/foreignRules.js";
import { editedCountries, leagueSpecFromDivisions, rebuildCountry } from "../../core/worldEdit.js";
import { LeagueSettings, type WorldEntry } from "../components/WorldSetup.js";
import { ForeignRulesEditor } from "../components/ForeignRulesEditor.js";

/** A rule list with no `undefined` flags, so an unticked box stores nothing. */
const cleanRules = (rules: ForeignRule[]): ForeignRule[] => JSON.parse(JSON.stringify(rules));

/**
 * God Mode: change any league's settings from next season on, the same panel
 * the new-save screen uses, minus what needs new clubs (see core/worldEdit.ts).
 * Saved changes queue on the save and take over at the next offseason, after
 * promotion and relegation, so the season under way finishes under its own
 * rules. That makes a year-by-year historical world a matter of queuing each
 * season's rules before advancing.
 */
export function LeagueRules() {
  const { league, godModeQueueLeagueEditAction, godModeDiscardLeagueEditAction, simming } = useLeague();
  const countries = useMemo(() => (league ? countriesOf(league.competitions) : []), [league]);
  const [country, setCountry] = useState<string>(() => countries[0] ?? "");
  if (!league) return null;

  const queued = editedCountries(league.competitions, league.pendingCompetitions);
  const base = league.pendingCompetitions ?? league.competitions;

  return (
    <div>
      <p className="small text-secondary">
        Change how a league runs, from next season. The season under way finishes under its
        current rules, then your changes start after promotion and relegation. Club counts
        and strength stay as they are.
      </p>

      <div className="mb-3" style={{ maxWidth: 420 }}>
        <label className="form-label form-label-sm" htmlFor="gm-league-country">League</label>
        <select
          id="gm-league-country"
          className="form-select form-select-sm"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          {countries.map((c) => (
            <option key={c} value={c}>{queued.has(c) ? `${c} (changed for next season)` : c}</option>
          ))}
        </select>
      </div>

      {country && (
        <CountryEditor
          // Remount on switching country, and after a save or undo changes what
          // the draft starts from, so it never carries one league's edits to another.
          key={`${country}:${JSON.stringify(divisionsOf(base, country))}`}
          country={country}
          divisions={divisionsOf(base, country)}
          queued={queued.has(country)}
          busy={simming}
          onSave={(spec, rules) => godModeQueueLeagueEditAction(country, spec, rules)}
          onUndo={() => godModeDiscardLeagueEditAction(country)}
        />
      )}
    </div>
  );
}

function CountryEditor({ country, divisions, queued, busy, onSave, onUndo }: {
  country: string;
  divisions: ReturnType<typeof divisionsOf>;
  queued: boolean;
  busy: boolean;
  onSave: (spec: LeagueSpec, rules: ForeignRule[] | null) => Promise<void>;
  onUndo: () => Promise<void>;
}) {
  const start = useMemo(() => leagueSpecFromDivisions(divisions), [divisions]);
  const startRules = useMemo(() => competitionForeignRules(divisions[0]), [divisions]);
  const [spec, setSpec] = useState<LeagueSpec>(start);
  // null until the rules are touched, so an untouched league keeps each
  // division's own (France's second tier has a stricter cap than its first).
  const [rules, setRules] = useState<ForeignRule[] | null>(null);

  const dirty = JSON.stringify(spec) !== JSON.stringify(start) || rules !== null;
  const fits = rebuildCountry(divisions, spec, rules) !== null;
  const entry: WorldEntry = { id: `save-${country}`, spec, included: true, shipped: false, linkMoney: false };

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
          onSpec={(next) => setSpec((s) => normalizeLeagueSpec({ ...s, ...next }))}
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

        {!fits && (
          <p className="small text-warning">That shape needs a different number of clubs, so it can&apos;t be saved.</p>
        )}
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
            <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => onUndo()}>
              Keep this season&apos;s rules
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
