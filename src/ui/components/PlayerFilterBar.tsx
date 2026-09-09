import type { ReactNode } from "react";
import type { Competition } from "../../core/competitions.js";
import { decodeScope, encodeScope, scopeCompIds, ALL_COMPETITIONS } from "../../core/competitions.js";
import type { PlayerFieldFilters } from "../../core/players/playerQuery.js";
import type { PlayerValueFilters } from "../../core/transfers/recommendations.js";
import { POSITIONS } from "../../core/players/types.js";
import { CompetitionScopeSelect } from "./CompetitionScopeSelect.js";

/**
 * The scouting filter bar shared by both panels on the Transfers page (the
 * recommended shortlist and the world search). One component rather than two
 * copies: the panels ask the same questions of the same world, and when they
 * were two near-identical blocks of JSX a filter added to one quietly went
 * missing from the other.
 *
 * Every field is held as a *string* — the raw text in the input — and parsed
 * only on the way into the search. That keeps typing instant (an in-progress
 * "1" on the way to "18" is just a filter, not an error state) and lets an
 * empty box mean "no constraint" without a separate null.
 */
export interface PlayerFilterState {
  position: string;
  nationality: string;
  /**
   * Which competitions to look in, as `encodeScope`'s string — "all", one
   * competition, one country, a whole tier, or the strongest countries' top
   * flights. A string so it round-trips through a `<select>` (and, on the
   * database page, a URL query parameter) without a second encoding.
   */
  scope: string;
  minOvr: string;
  maxOvr: string;
  minPot: string;
  maxPot: string;
  minAge: string;
  maxAge: string;
  minValue: string;
  maxValue: string;
  /** Weekly wage ceiling, matching the wage column. */
  maxWage: string;
  /** Seasons left on the contract, at most ("" = any). */
  maxContractYears: string;
}

export const EMPTY_PLAYER_FILTERS: PlayerFilterState = {
  position: "",
  nationality: "",
  scope: encodeScope(ALL_COMPETITIONS),
  minOvr: "",
  maxOvr: "",
  minPot: "",
  maxPot: "",
  minAge: "",
  maxAge: "",
  minValue: "",
  maxValue: "",
  maxWage: "",
  maxContractYears: "",
};

/** Parse a plain numeric field (""/invalid → no constraint). */
export function numFilter(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a money field, accepting the shorthand people actually type: "50m",
 * "2.5M", "800k", "$50m", "50,000,000". A bare number is still dollars, so a
 * value typed the old long way keeps meaning what it always did.
 */
export function moneyFilter(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/[$£€,\s]/g, "");
  if (t === "") return null;
  const m = /^(\d*\.?\d+)([km])?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return n * mult;
}

/**
 * True when the user has set anything at all (drives the "no matches" copy).
 *
 * Compared against the empty state field by field rather than against `""`,
 * because `scope` is not blank when unset — it holds the encoded "everything"
 * scope, which would otherwise read as a filter on every page load.
 */
export function hasAnyFilter(f: PlayerFilterState): boolean {
  return (Object.keys(f) as (keyof PlayerFilterState)[])
    .some((k) => f[k] !== EMPTY_PLAYER_FILTERS[k]);
}

/**
 * Convert the raw text state into the constraints the core search takes.
 *
 * Takes the world's competitions because the scope is resolved here: a preset
 * ("top divisions", "the five strongest countries") is a *set* of competition
 * ids, and which ids those are is a property of this save's world.
 */
export function toSearchFilters(
  f: PlayerFilterState,
  competitions: Competition[],
): PlayerFieldFilters & PlayerValueFilters {
  return {
    position: f.position || undefined,
    nationality: f.nationality || undefined,
    compIds: scopeCompIds(competitions, decodeScope(f.scope)),
    minOvr: numFilter(f.minOvr),
    maxOvr: numFilter(f.maxOvr),
    minPot: numFilter(f.minPot),
    maxPot: numFilter(f.maxPot),
    minAge: numFilter(f.minAge),
    maxAge: numFilter(f.maxAge),
    minValue: moneyFilter(f.minValue),
    maxValue: moneyFilter(f.maxValue),
    maxWeeklyWage: moneyFilter(f.maxWage),
    maxContractYears: numFilter(f.maxContractYears),
  };
}

/** A labelled control, so every filter in the bar lines up the same way. */
function Field({ label, htmlFor, children }: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="form-label small mb-0" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/**
 * A min/max pair under one label. Ranges are two boxes rather than two
 * separate filters because "overall 70 to 80" is one thought, and splitting it
 * across the bar makes a dozen controls impossible to scan.
 */
function RangeField({ label, idBase, min, max, onMin, onMax, width = "4.25rem", placeholder }: {
  label: string;
  idBase: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  width?: string;
  placeholder?: [string, string];
}) {
  return (
    <div>
      <label className="form-label small mb-0" htmlFor={`${idBase}-min`}>{label}</label>
      <div className="d-flex align-items-center gap-1">
        <input
          id={`${idBase}-min`}
          type="text"
          inputMode="decimal"
          className="form-control form-control-sm"
          style={{ width }}
          placeholder={placeholder?.[0] ?? "min"}
          value={min}
          onChange={(e) => onMin(e.target.value)}
        />
        <span className="text-muted small">to</span>
        <input
          id={`${idBase}-max`}
          type="text"
          inputMode="decimal"
          className="form-control form-control-sm"
          style={{ width }}
          placeholder={placeholder?.[1] ?? "max"}
          value={max}
          onChange={(e) => onMax(e.target.value)}
        />
      </div>
    </div>
  );
}

interface PlayerFilterBarProps {
  /** Distinguishes the two bars' input ids (labels must point at one field). */
  idPrefix: string;
  value: PlayerFilterState;
  onChange: (next: PlayerFilterState) => void;
  onClear: () => void;
  /** Nationalities present in this world, alphabetical — see nationalitiesInWorld. */
  nationalities: string[];
  competitions: Competition[];
  /**
   * Show the scout-value range. On by default; off for the loan search, where a
   * fee is a fixed fraction of market value and the panel never asks about
   * value at all — a control that filtered nothing would be worse than absent.
   */
  showValue?: boolean;
  /** Panel-specific controls (the search's name box and for-sale toggle). */
  children?: ReactNode;
}

export function PlayerFilterBar({
  idPrefix, value, onChange, onClear, nationalities, competitions,
  showValue = true, children,
}: PlayerFilterBarProps) {
  const set = (patch: Partial<PlayerFilterState>) => onChange({ ...value, ...patch });
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
      {children}
      <Field label="Position" htmlFor={id("pos")}>
        <select
          id={id("pos")}
          className="form-select form-select-sm"
          value={value.position}
          onChange={(e) => set({ position: e.target.value })}
        >
          <option value="">All</option>
          {POSITIONS.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </Field>
      <Field label="Nationality" htmlFor={id("nat")}>
        <select
          id={id("nat")}
          className="form-select form-select-sm"
          style={{ width: "10rem" }}
          value={value.nationality}
          onChange={(e) => set({ nationality: e.target.value })}
        >
          <option value="">Any</option>
          {nationalities.map((nat) => (
            <option key={nat} value={nat}>{nat}</option>
          ))}
        </select>
      </Field>
      <Field label="League" htmlFor={id("comp")}>
        <CompetitionScopeSelect
          id={id("comp")}
          competitions={competitions}
          value={decodeScope(value.scope)}
          onChange={(scope) => set({ scope: encodeScope(scope) })}
          style={{ width: "12rem" }}
        />
      </Field>
      <RangeField
        label="Overall"
        idBase={id("ovr")}
        min={value.minOvr}
        max={value.maxOvr}
        onMin={(v) => set({ minOvr: v })}
        onMax={(v) => set({ maxOvr: v })}
      />
      <RangeField
        label="Potential"
        idBase={id("pot")}
        min={value.minPot}
        max={value.maxPot}
        onMin={(v) => set({ minPot: v })}
        onMax={(v) => set({ maxPot: v })}
      />
      <RangeField
        label="Age"
        idBase={id("age")}
        min={value.minAge}
        max={value.maxAge}
        onMin={(v) => set({ minAge: v })}
        onMax={(v) => set({ maxAge: v })}
      />
      {showValue && (
        <RangeField
          label="Scout value"
          idBase={id("value")}
          min={value.minValue}
          max={value.maxValue}
          onMin={(v) => set({ minValue: v })}
          onMax={(v) => set({ maxValue: v })}
          width="6rem"
          placeholder={["1m", "50m"]}
        />
      )}
      <Field label="Max wage" htmlFor={id("wage")}>
        <input
          id={id("wage")}
          type="text"
          inputMode="decimal"
          className="form-control form-control-sm"
          style={{ width: "6rem" }}
          placeholder="200k/wk"
          value={value.maxWage}
          onChange={(e) => set({ maxWage: e.target.value })}
        />
      </Field>
      <Field label="Contract" htmlFor={id("contract")}>
        <select
          id={id("contract")}
          className="form-select form-select-sm"
          style={{ width: "9rem" }}
          value={value.maxContractYears}
          onChange={(e) => set({ maxContractYears: e.target.value })}
        >
          <option value="">Any length</option>
          <option value="0">Expiring now</option>
          <option value="1">1 year or less</option>
          <option value="2">2 years or less</option>
          <option value="3">3 years or less</option>
        </select>
      </Field>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
