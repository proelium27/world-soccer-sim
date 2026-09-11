import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { LeagueStore } from "../core/leagueState.js";
import { SKILL_KEYS, type Player, type SeasonStats, type SkillKey } from "../core/players/types.js";
import { SKILL_ABBREV, SKILL_LABELS } from "./components/PlayerRatingsTooltip.js";
import { SortableTh, type SortDir, type SortState } from "./components/SortableTable.js";
import { getRatingColor } from "./utils/ratingColor.js";
import { ColumnSetPills } from "./pages/databaseShared.js";
import { STAT_COLUMNS, type StatSortKey } from "./playerDatabase.js";
import { seasonYear } from "./format.js";
import { RATING_LEADER_QUALIFY_FRACTION } from "../core/constants.js";

/**
 * A three-way switch for the player tables you shop from — Transfers, Free
 * Agents, the Watchlist and the national Player Pool / My Squad — so the same
 * rows can be read as a price list, an attribute sheet or a form guide.
 *
 * The Database page already did this with its own column sets; these tables
 * didn't, and they are where the decision actually gets made. The columns come
 * from the Database's own definitions (skill labels, `STAT_COLUMNS`), so a
 * header reads the same on every page that shows it.
 *
 * What each page keeps for itself is the identity block (name, position, age,
 * club) and its action column (offer, sign, call up): the view swaps only the
 * numbers in between. Ovr leads every view, because it is the one number worth
 * having beside both an attribute sheet and a form line.
 */

export type PlayerView = "overview" | "attributes" | "performance";

export const PLAYER_VIEWS: readonly { key: PlayerView; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "attributes", label: "Attributes" },
  { key: "performance", label: "Performance" },
];

/**
 * Which view a table is showing, held in the query string (`?view=attributes`).
 *
 * The URL rather than component state for the same two reasons the Database's
 * column sets use it: a narrowed, sorted attribute sheet is worth being able to
 * link back to, and a render test can only reach a view it can name — a click
 * is out of reach of server rendering, so a view held in state would leave the
 * wide tables, the ones a DOM budget is actually for, untested. The overview is
 * the default and is left out of the URL, as is anything unrecognised.
 *
 * `param` lets a page with two tables (Transfers) give each its own.
 */
export function usePlayerView(param = "view"): [PlayerView, (next: PlayerView) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const view = PLAYER_VIEWS.some((v) => v.key === raw) ? (raw as PlayerView) : "overview";
  // The functional form, so this can't discard another param written in the
  // same handler — each call builds on the latest params, not this render's.
  const set = (next: PlayerView) =>
    setParams((prev) => {
      const updated = new URLSearchParams(prev);
      if (next === "overview") updated.delete(param);
      else updated.set(param, next);
      return updated;
    }, { replace: true });
  return [view, set];
}

/**
 * The stats the performance view shows, a subset of the Database's season set.
 *
 * Nine rather than all sixteen, because these tables also carry an action
 * column and sit inside cards: enough to judge a season at any position (a
 * forward's goals and xG, a defender's tackles and interceptions, a keeper's
 * saves) without the passes, crosses, fouls and cards a scout skips past.
 */
const PERFORMANCE_KEYS = [
  "stat_appearances", "stat_minutesPlayed", "stat_avgRating", "stat_goals", "stat_assists",
  "stat_xg", "stat_tackles", "stat_interceptions", "stat_saves",
] as const satisfies readonly StatSortKey[];

export type PerformanceKey = (typeof PERFORMANCE_KEYS)[number];

export const PERFORMANCE_COLUMNS = PERFORMANCE_KEYS.map((key) => {
  const col = STAT_COLUMNS.find((c) => c.key === key);
  if (!col) throw new Error(`No stat column for ${key}`);
  return col;
});

/** Every sort key a non-overview view adds. Namespaced stats can't collide with skills. */
export type ViewSortKey = SkillKey | PerformanceKey;

const SKILL_SET = new Set<string>(SKILL_KEYS);
const PERFORMANCE_SET = new Set<string>(PERFORMANCE_KEYS);

/**
 * Whether a sort survives switching to `view`.
 *
 * A key with no header in the new view would leave the table sorted by a
 * column the reader can't see — sorted by wage while showing attributes — so
 * the page falls back to its default instead. `overviewOnly` is the page's own
 * list of keys that exist only on its overview (wage, value, pot…); anything
 * else not a skill or a stat is shared by every view (name, age, ovr…).
 */
export function viewKeepsSort(key: string, view: PlayerView, overviewOnly: readonly string[]): boolean {
  if (SKILL_SET.has(key)) return view === "attributes";
  if (PERFORMANCE_SET.has(key)) return view === "performance";
  if (overviewOnly.includes(key)) return view === "overview";
  return true;
}

/**
 * The season the performance view opens on: the one being played, once
 * anyone has a stat line in it, and otherwise the one before.
 *
 * `league.played` is emptied at the rollover, so on matchday 1 nobody has a
 * line for the new season yet — opening there would show a table of dashes on
 * a save full of history. During the summer (international windows included)
 * the season just finished is still `league.season`, which is exactly the form
 * a squad gets picked on.
 */
export function performanceSeason(league: LeagueStore): number {
  const season = league.season;
  if (season <= 1) return season;
  const started = league.players.some((p) => p.stats.some((s) => s.season === season));
  return started ? season : season - 1;
}

/** The seasons offered in the performance view's picker, newest first. */
export function performanceSeasonOptions(league: LeagueStore): number[] {
  const latest = performanceSeason(league);
  return [latest, latest - 1, latest - 2].filter((s) => s >= 1);
}

/** A player's league line for one season, if he has one. */
export function statLineFor(player: Player, season: number): SeasonStats | undefined {
  return player.stats.find((s) => s.season === season);
}

function statOf(line: SeasonStats, key: PerformanceKey): number {
  return line[key.slice("stat_".length) as keyof SeasonStats] as number;
}

/**
 * Sort accessors for every view column, to spread into a page's own map.
 *
 * A player with no line for the season sorts below one who has a line of
 * zeroes, so "never played" can't sit in the middle of a column it has no
 * number in.
 *
 * Match rating gets the Stat Leaders treatment, because an average over one or
 * two games is noise: sorted on its own, a single standout cameo tops the whole
 * list. Anyone with fewer than `RATING_LEADER_QUALIFY_FRACTION` of the most
 * appearances among `rows` sorts below the regulars — still in rating order
 * among themselves, and still on the list, just not above players who earned
 * it over a season. Relative to the rows rather than to a fixed count, since
 * these tables mix divisions that play 22 games and ones that play 38.
 */
export function viewSortAccessors<T>(
  playerOf: (row: T) => Player,
  season: number,
  rows: readonly T[] = [],
): Record<ViewSortKey, (row: T) => number> {
  const out = {} as Record<ViewSortKey, (row: T) => number>;
  for (const key of SKILL_KEYS) out[key] = (r) => playerOf(r).ratings[key];
  for (const key of PERFORMANCE_KEYS) {
    out[key] = (r) => {
      const line = statLineFor(playerOf(r), season);
      return line ? statOf(line, key) : -1;
    };
  }
  let mostApps = 0;
  for (const r of rows) {
    mostApps = Math.max(mostApps, statLineFor(playerOf(r), season)?.appearances ?? 0);
  }
  const floor = Math.ceil(mostApps * RATING_LEADER_QUALIFY_FRACTION);
  out.stat_avgRating = (r) => {
    const line = statLineFor(playerOf(r), season);
    if (!line || line.appearances === 0) return -1000;
    return line.appearances >= floor ? line.avgRating : line.avgRating - 100;
  };
  return out;
}

/**
 * The view switch, plus the season picker when the performance view is on.
 *
 * The picker says "league" because that is what a season line records — cup
 * and international matches keep their own tallies elsewhere.
 */
export function PlayerViewSwitch({
  value, onChange, season, seasons, onSeason,
}: {
  value: PlayerView;
  onChange: (next: PlayerView) => void;
  /** The performance view's season; omit on a page with no picker. */
  season?: number;
  seasons?: readonly number[];
  onSeason?: (next: number) => void;
}) {
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
      <ColumnSetPills options={PLAYER_VIEWS} value={value} onChange={onChange} />
      {value === "performance" && season !== undefined && (
        seasons && seasons.length > 1 && onSeason ? (
          <select
            className="form-select form-select-sm w-auto"
            aria-label="Season"
            value={season}
            onChange={(e) => onSeason(Number(e.target.value))}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>{seasonYear(s)} league stats</option>
            ))}
          </select>
        ) : (
          <span className="text-muted small">{seasonYear(season)} league stats</span>
        )
      )}
    </div>
  );
}

const RATING_SORT_TITLE =
  "Average match rating. When sorted, anyone who played under half as many games as the "
  + "busiest player here sorts below the regulars.";

type HeaderSort = {
  sort: SortState<string>;
  onSort: (key: ViewSortKey | "ovr", defaultDir?: SortDir) => void;
};

/**
 * Header cells for an attributes or performance view. Sortable when the page
 * passes its sort state; plain headings when it doesn't (My Squad, whose rows
 * are a team sheet in slot order and shouldn't be reshuffled by a click).
 */
export function PlayerViewHeaders({
  view, sort,
}: {
  view: Exclude<PlayerView, "overview">;
  sort?: HeaderSort;
}) {
  const th = (key: ViewSortKey | "ovr", label: ReactNode, className: string) =>
    sort ? (
      <SortableTh
        key={key}
        sortKey={key}
        sort={sort.sort}
        onSort={(k, d) => sort.onSort(k as ViewSortKey | "ovr", d)}
        className={className}
      >
        {label}
      </SortableTh>
    ) : (
      <th key={key} className={className}>{label}</th>
    );
  return (
    <>
      {th("ovr", "Ovr", "text-end db-divide")}
      {view === "attributes"
        ? SKILL_KEYS.map((key) =>
          th(key, <abbr title={SKILL_LABELS[key]}>{SKILL_ABBREV[key]}</abbr>, "text-end"))
        : PERFORMANCE_COLUMNS.map((col) =>
          th(
            col.key as PerformanceKey,
            <abbr title={col.key === "stat_avgRating" && sort ? RATING_SORT_TITLE : col.title}>
              {col.label}
            </abbr>,
            "text-end",
          ))}
    </>
  );
}

/** One row's cells for an attributes or performance view, matching `PlayerViewHeaders`. */
export function PlayerViewCells({
  view, player, season,
}: {
  view: Exclude<PlayerView, "overview">;
  player: Player;
  /** The performance view's season; ignored by the attributes view. */
  season: number;
}) {
  const ovr = (
    <td className="text-end fw-semibold db-divide" style={{ color: getRatingColor(player.ovr) }}>
      {player.ovr}
    </td>
  );
  if (view === "attributes") {
    return (
      <>
        {ovr}
        {SKILL_KEYS.map((key) => (
          <td key={key} className="text-end">{player.ratings[key]}</td>
        ))}
      </>
    );
  }
  const line = statLineFor(player, season);
  return (
    <>
      {ovr}
      {PERFORMANCE_COLUMNS.map((col) => {
        if (!line) return <td key={col.key} className="text-end text-muted">&mdash;</td>;
        const v = statOf(line, col.key as PerformanceKey);
        const text = col.dashOnZero && v === 0
          ? "—"
          : col.decimals ? v.toFixed(col.decimals) : v.toLocaleString();
        return <td key={col.key} className="text-end">{text}</td>;
      })}
    </>
  );
}

/**
 * Wraps a table in a horizontal scroller, but only for the wide views.
 *
 * Fifteen numeric columns will not fit a phone, and the page body must never
 * scroll sideways, so the attributes and performance views scroll inside their
 * own box. The overview is left unwrapped on purpose: several overviews carry
 * "?" help badges in their headers, whose panels are absolutely positioned and
 * would be clipped by an `overflow` container on a short table.
 */
export function ViewTableWrap({ view, children }: { view: PlayerView; children: ReactNode }) {
  return view === "overview" ? <>{children}</> : <div className="table-responsive">{children}</div>;
}

/** Class for a table showing a wide view; see `.player-view-table` in styles.css. */
export function viewTableClass(view: PlayerView): string {
  return view === "overview" ? "" : " player-view-table";
}
