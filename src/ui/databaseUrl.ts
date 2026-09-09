import { EMPTY_PLAYER_FILTERS, type PlayerFilterState } from "./components/PlayerFilterBar.js";
import type { PlayerStatusFilter } from "./playerDatabase.js";
import type { SortDir } from "./components/SortableTable.js";

/**
 * The database's view — filters, sort, column set, season — as query
 * parameters, so a table somebody has narrowed and sorted is a link they can
 * come back to or hand to someone else.
 *
 * **Only what differs from the default is written.** A URL carrying a dozen
 * empty parameters is unreadable and, worse, makes "did I filter this?"
 * unanswerable at a glance — an empty box means no constraint everywhere else
 * in this app and it should mean that here too. The corollary is that reading
 * is lenient: anything missing or unparseable falls back to the default rather
 * than leaving the page in a state nobody chose.
 */

export interface DatabaseView {
  filters: PlayerFilterState;
  name: string;
  status: PlayerStatusFilter;
  sortKey: string;
  sortDir: SortDir;
  /** Which season the season columns describe; null = the one being played. */
  season: number | null;
}

/** Short parameter names for each filter field, so the URL stays readable. */
const FILTER_PARAMS: Record<keyof PlayerFilterState, string> = {
  position: "pos",
  nationality: "nat",
  scope: "in",
  minOvr: "ovr",
  maxOvr: "ovrmax",
  minPot: "pot",
  maxPot: "potmax",
  minAge: "age",
  maxAge: "agemax",
  minValue: "val",
  maxValue: "valmax",
  maxWage: "wage",
  maxContractYears: "yrs",
};

const STATUSES: PlayerStatusFilter[] = ["all", "contracted", "free", "academy"];

export function defaultView(sortKey: string, sortDir: SortDir): DatabaseView {
  return {
    filters: EMPTY_PLAYER_FILTERS,
    name: "",
    status: "all",
    sortKey,
    sortDir,
    season: null,
  };
}

/** Read a view out of the query string, falling back field by field. */
export function viewFromParams(
  params: URLSearchParams,
  fallback: DatabaseView,
): DatabaseView {
  const filters = { ...EMPTY_PLAYER_FILTERS };
  for (const [field, param] of Object.entries(FILTER_PARAMS) as [keyof PlayerFilterState, string][]) {
    const raw = params.get(param);
    if (raw !== null) filters[field] = raw;
  }
  const status = params.get("status");
  const dir = params.get("dir");
  const season = Number(params.get("season"));
  return {
    filters,
    name: params.get("q") ?? "",
    status: STATUSES.includes(status as PlayerStatusFilter)
      ? (status as PlayerStatusFilter)
      : "all",
    sortKey: params.get("sort") ?? fallback.sortKey,
    sortDir: dir === "asc" || dir === "desc" ? dir : fallback.sortDir,
    season: params.get("season") !== null && Number.isFinite(season) ? season : null,
  };
}

/**
 * Write a view into the query string, dropping everything at its default.
 *
 * Takes the existing params so it preserves anything it does not own — the
 * column set (`cols`) is written by its own hook, and clobbering it here would
 * reset the table's columns every time a filter changed.
 */
export function viewToParams(
  view: DatabaseView,
  fallback: DatabaseView,
  existing: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(existing);
  const set = (key: string, value: string, isDefault: boolean) => {
    if (isDefault) out.delete(key);
    else out.set(key, value);
  };
  for (const [field, param] of Object.entries(FILTER_PARAMS) as [keyof PlayerFilterState, string][]) {
    set(param, view.filters[field], view.filters[field] === EMPTY_PLAYER_FILTERS[field]);
  }
  set("q", view.name, view.name === "");
  set("status", view.status, view.status === "all");
  set("sort", view.sortKey, view.sortKey === fallback.sortKey);
  set("dir", view.sortDir, view.sortDir === fallback.sortDir);
  set("season", String(view.season), view.season === null);
  return out;
}
