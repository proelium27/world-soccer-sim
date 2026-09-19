import { useRef, useState } from "react";
import type { LeagueSpec, Competition } from "../../core/competitions.js";
import {
  worldLeagueSpecs, worldTuningWarnings, suggestedBudgetScale,
  buildCompetitions, competitionTeamCount, worldCompetitions,
  competitionStrengthOffset, competitionBudgetScale,
  resolveLeagueSpec, type ResolvedLeagueSpec,
  normalizeLeagueSpec, maxDivisionTeams, maxCrossRounds, titlePlayoffHalfNeed,
} from "../../core/competitions.js";
import {
  MAX_PROMOTION_SPOTS, AMERICAS_CUP_LEAGUE_SLOTS,
  type PlayoffFormat, type ContinentalRegion, type TitlePlayoffFormat, type ConferenceFormat,
} from "../../core/constants.js";
import { REGION_LABELS, REGION_ORDER, groupByRegion } from "../continents.js";

/** What the code box suggests when left empty — the same rule competitionAbbrev uses. */
function defaultAbbrev(country: string): string {
  return country.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
}
import { MIN_DIVISION_TEAMS } from "../../core/calendar.js";
import {
  parseRosterFile, retargetRosterFile, type NamedRosterFile,
} from "../../core/teams/rosterFile.js";
import { NationalityEditor, DEFAULT_ADDED_LEAGUE_NATIONALITIES } from "./NationalityEditor.js";
import type { NationalityWeights } from "../../core/players/nationalities.js";

/**
 * One row of the world editor. Kept as its own shape rather than a bare
 * LeagueSpec[] because the screen has to remember a shipped league the player
 * has switched *off* — it still needs to be listed so it can be switched back
 * on, and it must not reach the generated world while it's off.
 */
export interface WorldEntry {
  /**
   * Stable across edits, and used as the list key. It cannot be the country
   * name: that IS the text being edited, so keying on it remounts the input on
   * every keystroke and the field loses focus after one character.
   */
  id: string;
  spec: LeagueSpec;
  included: boolean;
  /** A league the game ships. Its clubs and nationalities already exist. */
  shipped: boolean;
  /** Keep money in step with strength. See the note by the money slider. */
  linkMoney: boolean;
  /**
   * Roster files loaded for THIS league only, in load order. Their competitions
   * are retargeted onto this league's divisions at build time, so a file written
   * for any world at all can be dropped into a league the player just invented.
   * Added leagues only — a shipped country is dressed through the world-wide
   * Import Custom League flow instead.
   */
  rosterSources?: NamedRosterFile[];
}

export function defaultWorldEntries(): WorldEntry[] {
  return worldLeagueSpecs().map((spec) => ({
    id: `shipped:${spec.country}`, spec, included: true, shipped: true, linkMoney: true,
  }));
}

/** Monotonic within a session; only ever used as a React key. */
let nextAddedId = 0;

/** The leagues that will actually be built, in order. */
/**
 * The continent a world entry's league plays in — the same resolution that
 * decides its continental competition, so an added league with no region set
 * sits under Europe, which is where it would play.
 */
export function entryRegion(entry: WorldEntry): ContinentalRegion {
  return resolveLeagueSpec(entry.spec).region;
}

/**
 * Switch every league on one continent on or off at once. Entries on other
 * continents, and entries already in the requested state, come back by
 * reference.
 */
export function setRegionIncluded(
  entries: WorldEntry[],
  region: ContinentalRegion,
  included: boolean,
): WorldEntry[] {
  return entries.map((e) =>
    entryRegion(e) === region && e.included !== included ? { ...e, included } : e,
  );
}

export function includedSpecs(entries: WorldEntry[]): LeagueSpec[] {
  return entries.filter((e) => e.included).map((e) => e.spec);
}

/**
 * Every per-league roster file, retargeted onto the division names its league
 * will actually have in the world being built, ready to be folded together and
 * applied like any other roster import.
 *
 * Retargeting has to happen here rather than at pick time because a league's
 * division names follow its country name, and the player can still rename it
 * after loading the file.
 */
export function leagueRosterFiles(
  entries: WorldEntry[],
  competitions: Competition[],
): { files: NamedRosterFile[]; warnings: string[] } {
  const files: NamedRosterFile[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (!entry.included || !entry.rosterSources?.length) continue;
    const divisions = competitions
      .filter((c) => c.country === entry.spec.country)
      .sort((a, b) => a.tier - b.tier)
      .map((c) => c.name);
    if (divisions.length === 0) continue;

    for (const source of entry.rosterSources) {
      const { file, warnings: w } = retargetRosterFile(source.file, divisions);
      files.push({ name: `${source.name} (${entry.spec.country})`, file });
      warnings.push(...w);
    }
  }
  return { files, warnings };
}

/**
 * Division sizes on offer. Even only, because the fixture generator pairs clubs
 * off each round and an odd field leaves one unpaired; capped because a division
 * of n clubs plays 2(n-1) matchdays and the season is a fixed grid.
 */
/**
 * The engine stores league strength as a HANDICAP (`strengthOffset`), where 0 is
 * level with the strongest leagues and higher is weaker. That reads backwards on
 * a slider labelled "Strength", so the control shows it flipped: the number the
 * player moves counts UP toward stronger, and only this pair of functions knows
 * about the flip.
 *
 * Deliberately a display concern rather than a change to the field. The offset's
 * direction is baked into COUNTRY_STRENGTH_OFFSET, the ladder audits and a lot
 * of documented reasoning; inverting it in the engine would be a large, risky
 * rename that buys the player nothing this doesn't.
 */
const STRENGTH_SCALE_MAX = 20;

export function strengthDial(offset: number): number {
  return STRENGTH_SCALE_MAX - offset;
}

export function strengthOffsetFromDial(dial: number): number {
  return STRENGTH_SCALE_MAX - dial;
}

/**
 * Division sizes on offer for one division, capped by `maxDivisionTeams`, which
 * lets a division split into two halves run past the 20 a single table can fit
 * (MLS's and Argentina's 30). Odd sizes are offered too: a single table plays
 * them with a bye each round, and a split one in two unequal halves, like the
 * shipped US second division.
 */
function divisionSizes(split: boolean): number[] {
  const max = maxDivisionTeams(split);
  return Array.from({ length: max - MIN_DIVISION_TEAMS + 1 }, (_, i) => MIN_DIVISION_TEAMS + i);
}

/**
 * How many clubs this league can sensibly promote and relegate: half its
 * smallest division, capped. Above half, the divisions are trading places
 * rather than running a promotion race, and a count above a division's size
 * would swap them outright.
 */
function maxPromoSpots(resolved: ResolvedLeagueSpec): number {
  const smallest = Math.min(resolved.d1Teams, resolved.d2Teams);
  return Math.min(MAX_PROMOTION_SPOTS, Math.floor(smallest / 2));
}

/**
 * The value the picker shows. Clamped rather than reset, so shrinking the
 * divisions after choosing 6 up and down quietly takes what still fits instead
 * of keeping a number the league can no longer honour.
 */
function promoSpotsOf(resolved: ResolvedLeagueSpec): number {
  return Math.min(resolved.promotionSpots, maxPromoSpots(resolved));
}

/** The second-to-third link's ceiling: the same rule, over the divisions it joins. */
function maxLowerPromoSpots(resolved: ResolvedLeagueSpec): number {
  const smallest = Math.min(resolved.d2Teams, resolved.d3Teams);
  return Math.min(MAX_PROMOTION_SPOTS, Math.floor(smallest / 2));
}

function lowerPromoSpotsOf(resolved: ResolvedLeagueSpec): number {
  return Math.min(resolved.d3PromotionSpots, maxLowerPromoSpots(resolved));
}

/**
 * One promotion link's two controls: how many clubs swap, and how the last of
 * those places is settled. The playoff picker only appears where there are
 * places to settle, since a link swapping nobody has nothing to play for.
 */
function PromotionLinkControls({
  label, spots, max, format, onSpots, onFormat,
}: {
  /** Which divisions the link joins, or null when the country only has one link. */
  label: string | null;
  spots: number;
  max: number;
  format: PlayoffFormat;
  onSpots: (n: number) => void;
  onFormat: (f: PlayoffFormat) => void;
}) {
  const suffix = label ? ` (divisions ${label})` : "";
  return (
    <>
      <div className="col">
        <label className="form-label small mb-1">Up and down{label ? `, ${label}` : ""}</label>
        <select
          className="form-select form-select-sm"
          value={spots}
          aria-label={`Clubs promoted and relegated each season${suffix}`}
          onChange={(e) => onSpots(Number(e.target.value))}
        >
          {Array.from({ length: max + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? "None, closed divisions" : `${n} up, ${n} down`}
            </option>
          ))}
        </select>
      </div>
      {spots > 0 && (
        <div className="col">
          <label className="form-label small mb-1">Playoff{label ? `, ${label}` : ""}</label>
          <select
            className="form-select form-select-sm"
            value={format}
            aria-label={`How the last promotion place is decided${suffix}`}
            onChange={(e) => onFormat(e.target.value as PlayoffFormat)}
          >
            <option value="none">None, straight swap</option>
            {/* The English bracket sits BELOW the automatic places, so it
                needs at least one of them to sit below. At a single place the
                only bracket available would be positions 1-4, which takes
                promotion off the champion. */}
            <option value="english" disabled={spots < 2}>
              English, four-club bracket
            </option>
            <option value="german">German, v the club above</option>
            {/* The French ladder ends in the German tie and seats its first two
                rounds below the automatic places, so it works at any count. */}
            <option value="french">
              French, ladder then v the club above
            </option>
          </select>
        </div>
      )}
    </>
  );
}

function newLeagueEntry(index: number): WorldEntry {
  const strengthOffset = 8;
  return {
    id: `added:${nextAddedId++}`,
    spec: {
      // academyOffset is deliberately left unset: it falls back to strength, so
      // an added league holds its level for the life of the save exactly like
      // the shipped eight do. The field still exists on Competition and the
      // engine still reads it — there is simply no control for it, because a
      // second 0-20 slider made you do arithmetic against the first one to work
      // out which way the league was pointing.
      country: `New Country ${index}`,
      strengthOffset,
      budgetScale: suggestedBudgetScale(strengthOffset),
      cupSlots: 2,
      shieldSlots: 2,
      // Set explicitly rather than left absent, and it is a real choice rather
      // than a display one: an invented country matches no shipped table, so
      // absent means England's full distribution — 38% English players with
      // English names, forever, since youth intake redraws from the same table
      // every offseason. The rest-of-world bucket is the honest starting point
      // for a league nobody has described yet.
      nationalities: DEFAULT_ADDED_LEAGUE_NATIONALITIES,
    },
    included: true,
    shipped: false,
    linkMoney: true,
  };
}

interface Props {
  entries: WorldEntry[];
  onChange: (entries: WorldEntry[]) => void;
  /**
   * Whether the card starts open. Collapsed is the right default on the New
   * League page — twelve shipped countries is a tall block to sit above the club
   * picker on every visit, and most saves take the world as it ships — but a
   * loaded roster file inverts that: adding or renaming a league in here is the
   * ONLY way to make a file the world has no league for apply at all, so hiding
   * the editor would hide the fix for the commonest import failure.
   */
  defaultOpen?: boolean;
}

export function WorldSetup({ entries, onChange, defaultOpen = false }: Props) {
  const specs = includedSpecs(entries);
  const warnings = worldTuningWarnings(specs);
  const comps = buildCompetitions(specs);
  const clubs = comps.reduce((n, c) => n + competitionTeamCount(c), 0);
  const [open, setOpen] = useState(defaultOpen);
  /**
   * Which shipped leagues have their settings panel open. Behind a toggle
   * because a shipped row is otherwise a single line, and eight countries' worth
   * of always-on sliders buries the checkboxes that most people came for. Added
   * leagues show theirs unconditionally — you only get one by asking for it, so
   * it is already the thing you are looking at.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function update(index: number, next: Partial<WorldEntry>) {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...next } : e)));
  }

  function updateSpec(index: number, next: Partial<LeagueSpec>) {
    const entry = entries[index];
    // Normalised on every edit, so no combination of controls can produce a
    // league the engine cannot build — a 30-club division switched back to one
    // table, say, which would not fit the season calendar.
    const spec = normalizeLeagueSpec({ ...entry.spec, ...next });
    // Money follows strength unless the player has deliberately unlinked it —
    // the pairing is what keeps the ladder from inverting over a long save.
    if (entry.linkMoney && next.strengthOffset !== undefined) {
      spec.budgetScale = suggestedBudgetScale(next.strengthOffset);
    }
    // Shrinking the divisions lowers the swap ceiling, so the stored number has
    // to come down with it. Clamping only the displayed value would leave the
    // picker reading 4 while the world was still built with the 6 chosen before
    // the divisions got smaller.
    if (spec.promotionSpots !== undefined) {
      spec.promotionSpots = Math.min(spec.promotionSpots, maxPromoSpots(resolveLeagueSpec(spec)));
    }
    if (spec.d3PromotionSpots !== undefined) {
      spec.d3PromotionSpots = Math.min(spec.d3PromotionSpots, maxLowerPromoSpots(resolveLeagueSpec(spec)));
    }
    update(index, { spec });
  }

  return (
    <div className="card mb-3">
      <div className="card-body">
        {/*
          The summary is what makes collapsing safe: it says what world you would
          get without making you open the card to find out. A tuning warning is
          counted on the header too, so advice the editor raised can never be
          hidden by the card being shut.
        */}
        <div className="d-flex justify-content-between align-items-center gap-2">
          <h5 className="mb-0 d-flex align-items-center gap-2">
            World setup
            {!open && warnings.length > 0 && (
              <span className="badge text-bg-warning">{warnings.length}</span>
            )}
          </h5>
          <div className="d-flex align-items-center gap-3">
            <span className="text-muted small">
              {specs.length} {specs.length === 1 ? "country" : "countries"},{" "}
              {comps.length} {comps.length === 1 ? "division" : "divisions"}, {clubs} clubs
            </span>
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              aria-expanded={open}
              aria-controls="world-setup-body"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Done" : "Customize"}
            </button>
          </div>
        </div>

        {open && (
        <div id="world-setup-body" className="mt-2">
        <p className="text-muted small mb-3">
          Pick which countries your world has, or add your own. Fixed once you start.
        </p>

        {/*
          One heading per continent, each with a checkbox that switches that
          whole continent's leagues on or off. It reads as ticked only when every
          league under it is on, and as a dash when some are, so it always
          describes the rows beneath it. Rows keep their index into `entries`,
          which every per-row control below writes through.
        */}
        {groupByRegion(entries.map((entry, i) => ({ entry, i })), ({ entry }) => entryRegion(entry)).map((group) => {
          const on = group.items.filter(({ entry }) => entry.included).length;
          const all = on === group.items.length;
          const label = REGION_LABELS[group.region];
          return (
          <div key={group.region} className="mb-3">
          <div className="d-flex align-items-center gap-2 mb-1">
            <input
              type="checkbox"
              className="form-check-input mt-0"
              id={`region-on-${group.region}`}
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = on > 0 && !all;
              }}
              onChange={(e) => onChange(setRegionIncluded(entries, group.region, e.target.checked))}
            />
            <label htmlFor={`region-on-${group.region}`} className="page-eyebrow mb-0">
              {label}
            </label>
            <span className="text-muted small">
              {on} of {group.items.length}
            </span>
          </div>
        <ul className="list-unstyled mb-0">
          {group.items.map(({ entry, i }) => (
            <li key={entry.id} className="border-top py-2">
              <div className="d-flex align-items-center gap-2">
                <input
                  type="checkbox"
                  className="form-check-input mt-0"
                  checked={entry.included}
                  id={`league-on-${i}`}
                  onChange={(e) => update(i, { included: e.target.checked })}
                />
                {entry.shipped ? (
                  <>
                  <label htmlFor={`league-on-${i}`} className="flex-grow-1 mb-0">
                    {entry.spec.country}
                  </label>
                  {entry.included && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0"
                      onClick={() => toggleExpanded(entry.id)}
                    >
                      {expanded.has(entry.id) ? "Done" : "Customize"}
                    </button>
                  )}
                  </>
                ) : (
                  <>
                  <input
                    type="text"
                    className="form-control form-control-sm flex-grow-1"
                    value={entry.spec.country}
                    aria-label="Country name"
                    onChange={(e) => updateSpec(i, { country: e.target.value })}
                  />
                  {/*
                    A placeholder rather than a pre-filled value: leaving the box
                    empty falls back to the country's first three letters, so
                    showing that as a suggestion is honest, and typing over it is
                    the only thing that stores anything.
                  */}
                  <input
                    type="text"
                    className="form-control form-control-sm text-uppercase"
                    style={{ width: 72, flex: "0 0 auto" }}
                    maxLength={3}
                    value={entry.spec.abbrev ?? ""}
                    aria-label="Three-letter code"
                    placeholder={defaultAbbrev(entry.spec.country)}
                    title="Three-letter code, shown where a flag would go"
                    onChange={(e) => updateSpec(i, { abbrev: e.target.value.toUpperCase() })}
                  />
                  </>
                )}
                {!entry.shipped && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => onChange(entries.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>


              {/*
                One panel, whichever kind of league this is. A shipped country's
                knobs and an added one's are the same knobs — every one of them
                is an optional field on Competition that falls back to the
                country table when absent — so the only real difference is that a
                shipped row keeps its panel shut until asked, and that its
                controls open on the values that country actually ships with.
              */}
              {entry.included && (!entry.shipped || expanded.has(entry.id)) && (
                <div className="mt-2 ps-4">
                  <LeagueSettings
                    entry={entry}
                    onEntry={(next) => update(i, next)}
                    onSpec={(next) => updateSpec(i, next)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
          </div>
          );
        })}

        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={() => onChange([...entries, newLeagueEntry(entries.filter((e) => !e.shipped).length + 1)])}
        >
          Add a league
        </button>

        {warnings.length > 0 && (
          <div className="alert alert-warning py-2 mt-3 mb-0 small" role="alert">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
        </div>
        )}
      </div>
    </div>
  );
}

/**
 * The per-tier fields on a LeagueSpec, in pyramid order. A table rather than a
 * `d${tier}Name` string build so the keys stay real, typed fields: `divisions`
 * is 1-3, and a fourth tier would have to add its fields here before the UI
 * could offer it.
 */
const DIVISION_FIELDS = [
  { name: "d1Name", teams: "d1Teams", split: "d1Conferences", label: "Top division", noun: "top division" },
  { name: "d2Name", teams: "d2Teams", split: "d2Conferences", label: "Second division", noun: "second division" },
  { name: "d3Name", teams: "d3Teams", split: "d3Conferences", label: "Third division", noun: "third division" },
] as const;

/** What a freshly split division's halves are called until the player names them. */
const DEFAULT_HALF_NAMES: readonly [string, string] = ["Conference A", "Conference B"];

/**
 * Each division's name, size and shape: one table, or two halves that play
 * their own schedules (MLS's conferences, Argentina's zones). Splitting is what
 * lets a division run past 20 clubs — each club plays only its own half twice,
 * plus however many games against the other half the player asks for — so the
 * size picker widens when a division is split.
 *
 * Names are worth a control of their own: real leagues are not called
 * "<Country> Division 1", and a world-wide roster file written for "Eredivisie"
 * finds the league it fills BY THAT NAME. Renaming no longer breaks a file
 * written for the old name (resolveRosterSlots falls back to the country and
 * tier the name describes). Empty means "no name of my own": shown as a
 * placeholder and stored as absent, so a name keeps following the country.
 *
 * Every control shows the resolved value and writes only on change, like the
 * rest of the panel.
 */
function DivisionShapes({
  spec,
  resolved,
  onChange,
}: {
  spec: LeagueSpec;
  resolved: ResolvedLeagueSpec;
  onChange: (next: Partial<LeagueSpec>) => void;
}) {
  const divisions = resolved.divisions;
  const sizes = [resolved.d1Teams, resolved.d2Teams, resolved.d3Teams];
  return (
    <>
      {DIVISION_FIELDS.slice(0, divisions).map((f, i) => {
        const nameLabel = divisions === 1 ? "League name" : `${f.label} name`;
        const noun = divisions === 1 ? "league" : f.noun;
        const split = resolved.conferences[i];
        const size = sizes[i];
        const halves = size % 2 === 0 ? `two halves of ${size / 2}`
          : `halves of ${Math.ceil(size / 2)} and ${Math.floor(size / 2)}`;
        const half = Math.floor(size / 2);
        const maxCross = maxCrossRounds(size);
        const setSplit = (next: ConferenceFormat | null) => onChange({ [f.split]: next });
        return (
          <div key={f.name} className="mb-2">
            <div className="row g-2">
              <div className="col-12 col-sm-6">
                <label className="form-label small mb-1">{nameLabel}</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={spec[f.name] ?? ""}
                  placeholder={`${spec.country} Division ${i + 1}`}
                  aria-label={nameLabel}
                  onChange={(e) => onChange({ [f.name]: e.target.value || undefined })}
                />
              </div>
              <div className="col">
                <label className="form-label small mb-1">Clubs</label>
                <select
                  className="form-select form-select-sm"
                  value={size}
                  aria-label={`Clubs in the ${noun}`}
                  onChange={(e) => onChange({ [f.teams]: Number(e.target.value) })}
                >
                  {divisionSizes(!!split).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="col">
                <label className="form-label small mb-1">Played as</label>
                <select
                  className="form-select form-select-sm"
                  value={split ? "split" : "table"}
                  aria-label={`How the ${noun} is played`}
                  onChange={(e) => setSplit(e.target.value === "split"
                    ? { names: DEFAULT_HALF_NAMES, crossRounds: 0 }
                    : null)}
                >
                  <option value="table">One table</option>
                  <option value="split">Two halves</option>
                </select>
              </div>
            </div>
            {split && (
              <div className="row g-2 mt-0">
                <div className="col">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={split.names[0]}
                    aria-label={`First half of the ${noun}`}
                    onChange={(e) => setSplit({ ...split, names: [e.target.value, split.names[1]] })}
                  />
                </div>
                <div className="col">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={split.names[1]}
                    aria-label={`Second half of the ${noun}`}
                    onChange={(e) => setSplit({ ...split, names: [split.names[0], e.target.value] })}
                  />
                </div>
                {maxCross > 0 && (
                <div className="col">
                  <select
                    className="form-select form-select-sm"
                    value={Math.min(split.crossRounds, maxCross)}
                    aria-label={`Extra games against the other half of the ${noun}`}
                    onChange={(e) => setSplit({ ...split, crossRounds: Number(e.target.value) })}
                  >
                    {Array.from({ length: maxCross + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "No extra games" : `${n} extra ${n === 1 ? "game" : "games"}`}
                      </option>
                    ))}
                  </select>
                </div>
                )}
                <div className="col-12 text-muted" style={{ fontSize: "0.75rem" }}>
                  Played in {halves}. Each club plays its own half home and away
                  {size % 2 === 0 && half % 2 === 1 ? ", plus a fixed rival from the other half home and away" : ""}
                  {maxCross > 0 && split.crossRounds > 0 ? `, plus ${Math.min(split.crossRounds, maxCross)} more against the other half` : ""}.
                  {size % 2 === 1 ? " Unequal halves play no games against each other." : ""}
                  One table still decides promotion, relegation and prize money.
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-muted small mb-2">
        Renaming is safe for roster files: one written for this country's old
        division names still finds it. A single table holds up to 20 clubs; split
        into two halves, a division can hold up to {maxDivisionTeams(true)}.
      </p>
    </>
  );
}

/** The ways a top flight can crown its champion. See TitlePlayoffFormat. */
const TITLE_PLAYOFF_OPTIONS: { value: TitlePlayoffFormat; label: string }[] = [
  { value: "none", label: "Top of the table" },
  { value: "single", label: "Top-8 playoff, one game a round" },
  { value: "two-legged", label: "Top-8 playoff, home and away" },
  { value: "conference", label: "Conference playoffs, top 9 of each half" },
  { value: "zones", label: "Zone playoffs, top 8 of each half" },
];

/**
 * Load roster files for one added league. Scoped deliberately: the file's own
 * competition names are ignored and its competitions are mapped onto THIS
 * league's divisions in order, so a file written for any world can dress a
 * league that did not exist when it was authored.
 */
function RosterPicker({
  entry,
  onChange,
}: {
  entry: WorldEntry;
  onChange: (
    sources: NamedRosterFile[] | undefined,
    nationalities?: NationalityWeights,
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const sources = entry.rosterSources ?? [];

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;

    const loaded: NamedRosterFile[] = [];
    const failed: string[] = [];
    for (const file of picked) {
      try {
        loaded.push({ name: file.name, file: parseRosterFile(await file.text()) });
      } catch (err) {
        // Named rather than swallowed: a batch of files where one is the wrong
        // shape should still load the rest, and say which one didn't.
        failed.push(`${file.name} (${err instanceof Error ? err.message : "unreadable"})`);
      }
    }
    setError(failed.length > 0 ? `Couldn't read ${failed.join(", ")}` : null);
    if (loaded.length === 0) return;
    // The last file that names a mix wins, matching how a later file already
    // wins for a competition both files claim.
    const declared = loaded.map((l) => l.file.nationalities).filter(Boolean).pop();
    onChange([...sources, ...loaded], declared ?? undefined);
  }

  const clubs = sources.reduce(
    (n, s) => n + s.file.competitions.reduce((m, c) => m + c.clubs.length, 0),
    0,
  );

  return (
    <div className="mt-3 pt-2 border-top">
      <div className="d-flex align-items-baseline justify-content-between gap-2">
        <label className="form-label small mb-1">Clubs and squads</label>
        {sources.length > 0 && (
          <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={() => { onChange(undefined); setError(null); }}
          >
            Clear
          </button>
        )}
      </div>

      {sources.length === 0 ? (
        <p className="text-muted mb-2" style={{ fontSize: "0.75rem" }}>
          Leave this alone and the league gets invented clubs. Or load a roster file for
          your own, its first competition filling the top division. To only rename them,
          tick <strong>Name the clubs yourself</strong> below.
        </p>
      ) : (
        <p className="text-muted mb-2" style={{ fontSize: "0.75rem" }}>
          {sources.map((s) => s.name).join(", ")}: {clubs} {clubs === 1 ? "club" : "clubs"}.
        </p>
      )}

      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={() => inputRef.current?.click()}
      >
        {sources.length > 0 ? "Add another file" : "Import roster"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        multiple
        className="d-none"
        onChange={handleFiles}
      />

      {error && <div className="small text-danger mt-1">{error}</div>}
    </div>
  );
}

/**
 * Where the leagues already in the game sit, so the sliders have a baseline to
 * read against rather than being bare numbers.
 *
 * Derived from the shipped competitions through the same accessors the engine
 * uses, so it cannot drift from the values it is describing.
 */
function ShippedLeagueTable() {
  const rows = worldCompetitions()
    .filter((c) => c.tier === 1)
    .map((c) => ({
      country: c.country,
      strength: strengthDial(competitionStrengthOffset(c)),
      money: competitionBudgetScale(c),
    }));

  return (
    <details className="mb-2">
      <summary className="small text-muted" style={{ cursor: "pointer" }}>
        Where the leagues already in the game sit
      </summary>
      <div className="table-responsive mt-2">
        <table className="table table-sm mb-1" style={{ fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th scope="col">League</th>
              <th scope="col" className="text-end">Strength</th>
              <th scope="col" className="text-end">Money</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.country}>
                <td>{r.country}</td>
                <td className="text-end">{r.strength}</td>
                <td className="text-end">{r.money.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted mb-0" style={{ fontSize: "0.75rem" }}>
        Strength 20 is the top of the game. Each point below costs a league about
        1 OVR across its squads, so a league at 10 has a champion around the
        quality of a mid-table English club. Money is against 1.00 for the
        richest leagues.
      </p>
    </details>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

interface SliderProps {
  label: string;
  /** Optional: the world editor collects its explanations below the controls instead. */
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}

function Slider({ label, hint, min, max, step, value, display, onChange }: SliderProps) {
  return (
    <div className="mb-2">
      <div className="d-flex justify-content-between align-items-baseline">
        <label className="form-label small mb-0">{label}</label>
        <span className="small text-muted">{display}</span>
      </div>
      <input
        type="range"
        className="form-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="text-muted" style={{ fontSize: "0.75rem" }}>{hint}</div>}
    </div>
  );
}

/**
 * Everything you can set about one league: its division names, how strong and
 * how rich it is, its shape, its continental places, who it produces and which
 * clubs fill it.
 *
 * Shared by every row in the world editor rather than living inside the added-
 * league branch, which is where it used to sit. A shipped country was editable
 * in name only, and that was never a statement about the engine — every knob
 * here is an optional field on Competition whose absence means "use the shipped
 * country table", which is precisely what makes it safe to write one.
 *
 * **Every control shows the RESOLVED value and writes only on change.** That is
 * the load-bearing detail. Reading `spec.strengthOffset ?? 0` was fine while
 * only added leagues had sliders — they set theirs at creation — but on England
 * it would show a handicap of 0 as strength 20 by luck and on France it would
 * show 20 when the league is really at 15. Meanwhile writing the resolved value
 * back on mount would make every shipped league carry explicit knobs, and
 * `buildCompetitions(worldLeagueSpecs())` would stop equalling
 * `worldCompetitions()` — pinned by a test, and the thing that keeps a default
 * world byte-identical to the one the game has always generated.
 *
 * Exported so it can be rendered on its own: the shipped rows keep it collapsed
 * behind a button, and component state is out of reach of a static render test.
 */
export function LeagueSettings({
  entry,
  onEntry,
  onSpec,
}: {
  entry: WorldEntry;
  onEntry: (next: Partial<WorldEntry>) => void;
  onSpec: (next: Partial<LeagueSpec>) => void;
}) {
  const spec = entry.spec;
  const resolved = resolveLeagueSpec(spec);

  return (
    <>
      <Slider
        label="Strength"
        min={0}
        max={STRENGTH_SCALE_MAX}
        step={1}
        value={strengthDial(resolved.strengthOffset)}
        display={String(strengthDial(resolved.strengthOffset))}
        onChange={(v) => onSpec({ strengthOffset: strengthOffsetFromDial(v) })}
      />
      <Slider
        label="Money"
        min={0.2}
        max={1.2}
        step={0.05}
        value={resolved.budgetScale}
        display={resolved.budgetScale.toFixed(2)}
        onChange={(v) => onSpec({ budgetScale: v })}
      />
      <div className="form-check form-switch small mb-2">
        <input
          type="checkbox"
          className="form-check-input"
          id={`link-money-${entry.id}`}
          checked={entry.linkMoney}
          onChange={(e) => {
            // One call, carrying the spec with it. onEntry and onSpec each
            // rebuild the whole list from the entries array as it stands, so two
            // calls in a row both read the same array and the second silently
            // discards the first — see the roster picker below, which had this.
            const linkMoney = e.target.checked;
            onEntry({
              linkMoney,
              ...(linkMoney
                ? { spec: { ...spec, budgetScale: suggestedBudgetScale(resolved.strengthOffset) } }
                : {}),
            });
          }}
        />
        <label className="form-check-label text-muted" htmlFor={`link-money-${entry.id}`}>
          Keep money in step with strength
        </label>
      </div>

      {/*
        Sits directly under the two sliders it calibrates rather than at the foot
        of the card: the numbers only mean anything against the leagues already
        in the game, and a reference you have to scroll away to find is one you
        don't use.
      */}
      <ShippedLeagueTable />

      <div className="row g-2 mb-2">
        <div className="col">
          <label className="form-label small mb-1">Continent</label>
          {/* Which club competitions the league feeds: Europe's Continental Cup
              and Shield, or the Americas Cup. A hard boundary in the engine
              (cupSlotsForCompetition), so a league can only ever play one. */}
          <select
            className="form-select form-select-sm"
            value={resolved.region}
            aria-label="Continent"
            onChange={(e) => onSpec({ region: e.target.value as ContinentalRegion })}
          >
            {REGION_ORDER.map((r) => (
              <option key={r} value={r}>{REGION_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div className="col">
          <label className="form-label small mb-1">Divisions</label>
          <select
            className="form-select form-select-sm"
            value={resolved.divisions}
            aria-label="Divisions"
            onChange={(e) => {
              const n = Number(e.target.value);
              onSpec({ divisions: n === 1 ? 1 : n === 3 ? 3 : 2 });
            }}
          >
            <option value={1}>One</option>
            <option value={2}>Two</option>
            <option value={3}>Three</option>
          </select>
        </div>
      </div>

      <DivisionShapes spec={spec} resolved={resolved} onChange={onSpec} />

      <div className="row g-2 mb-2">
        {/* Nothing to size in a one-division league: it has no second tier to
            swap with. Each link in a deeper pyramid gets its own pair of
            controls, because real countries run different rules at each step
            (Spain sends three up from its second tier and four from its third,
            and the Netherlands' third tier has no way up at all). */}
        {resolved.divisions >= 2 && (
          <PromotionLinkControls
            label={resolved.divisions === 3 ? "1 and 2" : null}
            spots={promoSpotsOf(resolved)}
            max={maxPromoSpots(resolved)}
            format={resolved.playoffFormat}
            onSpots={(n) => onSpec({ promotionSpots: n })}
            onFormat={(f) => onSpec({ playoffFormat: f })}
          />
        )}
        {resolved.divisions === 3 && (
          <PromotionLinkControls
            label="2 and 3"
            spots={lowerPromoSpotsOf(resolved)}
            max={maxLowerPromoSpots(resolved)}
            format={resolved.d3PlayoffFormat}
            onSpots={(n) => onSpec({ d3PromotionSpots: n })}
            onFormat={(f) => onSpec({ d3PlayoffFormat: f })}
          />
        )}
        <div className="col">
          <label className="form-label small mb-1">Champion</label>
          {/* Only the title moves: prize money, continental places and
              relegation still read the table. A per-half format needs the top
              flight split with enough clubs in each half, or the playoff builder
              skips the league — so those are only offered where they'd run. */}
          <select
            className="form-select form-select-sm"
            value={resolved.titlePlayoff}
            aria-label="How the champion is decided"
            onChange={(e) => onSpec({ titlePlayoff: e.target.value as TitlePlayoffFormat })}
          >
            {TITLE_PLAYOFF_OPTIONS.map((o) => {
              const need = titlePlayoffHalfNeed(o.value);
              const fits = need === 0
                || (!!resolved.conferences[0] && Math.floor(resolved.d1Teams / 2) >= need);
              return (
                <option key={o.value} value={o.value} disabled={!fits}>{o.label}</option>
              );
            })}
          </select>
        </div>
      </div>

      {resolved.region === "europe" ? (
        <div className="row g-2">
          <div className="col">
            <label className="form-label small mb-1">Continental Cup places</label>
            <input
              type="number"
              className="form-control form-control-sm"
              min={0}
              max={8}
              value={resolved.cupSlots}
              aria-label="Continental Cup places"
              onChange={(e) => onSpec({ cupSlots: clampInt(e.target.value, 0, 8) })}
            />
          </div>
          <div className="col">
            <label className="form-label small mb-1">Continental Shield places</label>
            <input
              type="number"
              className="form-control form-control-sm"
              min={0}
              max={8}
              value={resolved.shieldSlots}
              aria-label="Continental Shield places"
              onChange={(e) => onSpec({ shieldSlots: clampInt(e.target.value, 0, 8) })}
            />
          </div>
        </div>
      ) : (
        <p className="text-muted small mb-0">
          Sends {AMERICAS_CUP_LEAGUE_SLOTS} clubs a season to the Americas Cup,
          the same as every league in the Americas.
        </p>
      )}
      <NationalityEditor
        value={resolved.nationalities}
        onChange={(nationalities) => onSpec({ nationalities })}
      />

      <RosterPicker
        entry={entry}
        onChange={(rosterSources, nationalities) => {
          // A file that declares a mix pre-fills the editor rather than
          // overriding it out of sight, so there is one visible source of truth
          // and no precedence rule to remember. The player can then adjust what
          // the file gave them.
          //
          // Both halves go in ONE call. Setting the files and then the mix meant
          // two writes built from the same entries array, and the second dropped
          // the first — so a roster file that declared nationalities loaded its
          // mix and lost its clubs.
          onEntry({
            rosterSources,
            ...(nationalities ? { spec: { ...spec, nationalities } } : {}),
          });
        }}
      />
    </>
  );
}
