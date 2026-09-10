import { useMemo, useState } from "react";
import { useLeague } from "../../context/LeagueContext.js";
import { seasonYear } from "../../format.js";
import { CONFEDERATIONS, confederationOf, nationForm, noNationForm } from "../../../core/international/index.js";
import type { IntlPowerSnapshot, NationFormStats, InternationalState } from "../../../core/international/index.js";
import { NationalTeamsLayout, NationName, SeasonSelect, useHasInternational, IntlEmpty } from "./shared.js";

/** Rank change vs the previous snapshot: up (green), down (red), steady, or new. */
function Movement({ delta, isNew }: { delta: number; isNew: boolean }) {
  if (isNew) return <span className="text-muted small">new</span>;
  if (delta > 0) return <span className="text-success small">+{delta}</span>;
  if (delta < 0) return <span className="text-danger small">{delta}</span>;
  return <span className="text-muted small">-</span>;
}

/** One rendered row: where a nation sits in the table shown, and in the world. */
export interface PowerRow {
  nation: string;
  /** Best-available-squad strength, the number the snapshot stores. */
  rating: number;
  /** Squad strength blended with recent results — what the table is ranked on. */
  power: number;
  form: NationFormStats;
  /** Position in the table being shown — within the confederation when one is picked. */
  rank: number;
  /** Position among every eligible nation, whatever the filter says. */
  worldRank: number;
  /** Places gained since the previous snapshot, measured in the same view. */
  delta: number;
  /** Absent from the previous snapshot, so there is no movement to report. */
  isNew: boolean;
}

/** Squad strength plus the form bonus, the national counterpart of a club's Power score. */
function powerOf(rating: number, form: NationFormStats): number {
  return rating + form.performanceBonus;
}

/**
 * Every nation in one snapshot ranked by Power, strongest first.
 *
 * Ranked here rather than taken in the order the snapshot stores, because that
 * order is squad strength alone. **The stored order is deliberately left
 * alone**: `nationExpectations` reads it to set the bar a federation judges its
 * manager against, so re-sorting the snapshot itself would change who gets
 * sacked. This is a display ranking over the same data.
 */
function rankedByPower(
  snapshot: IntlPowerSnapshot,
  forms: Map<string, NationFormStats>,
): { nation: string; rating: number; power: number; form: NationFormStats }[] {
  return snapshot.ranks
    .map((r) => {
      const form = forms.get(r.nation) ?? noNationForm();
      return { nation: r.nation, rating: r.rating, power: powerOf(r.rating, form), form };
    })
    // Ties break on the stored rating so the order stays stable before anyone
    // has played, when every nation's bonus is 0 and Power is just the rating.
    .sort((a, b) => b.power - a.power || b.rating - a.rating || a.nation.localeCompare(b.nation));
}

/**
 * The rows for one snapshot, optionally narrowed to a single confederation.
 *
 * Movement is measured **in the view being shown**, not always against the
 * world table, and the two columns have to agree or the page reads as broken:
 * narrowed to a confederation, a nation can hold its world rank and still gain
 * a place on its neighbours because someone above it slipped. That is the
 * question the filter asks — how do we compare to the rest of our federation —
 * so the previous snapshot is narrowed the same way before its ranks are read.
 *
 * `worldRank` rides along regardless, since a confederation table on its own
 * says nothing about where those nations stand against everybody else.
 */
export function powerRows(
  snapshot: IntlPowerSnapshot,
  previous: IntlPowerSnapshot | null,
  confederation: string | null,
  // Optional so that omitting them means what it should — nothing played, every
  // bonus 0, Power identical to the stored rating. Same contract as
  // `computeStandings`' deductions map.
  forms: Map<string, NationFormStats> = new Map(),
  previousForms: Map<string, NationFormStats> = new Map(),
): PowerRow[] {
  const inView = (nation: string) =>
    confederation === null || confederationOf(nation) === confederation;

  const ranked = rankedByPower(snapshot, forms);
  const worldRank = new Map(ranked.map((r, i) => [r.nation, i + 1]));
  // The previous snapshot is ranked by ITS OWN form, not this one's — movement
  // has to compare each table to the table that was actually shown last time.
  const before = new Map(
    (previous ? rankedByPower(previous, previousForms) : [])
      .filter((r) => inView(r.nation))
      .map((r, i) => [r.nation, i + 1]),
  );

  return ranked
    .filter((r) => inView(r.nation))
    .map((r, i) => {
      const was = before.get(r.nation);
      return {
        nation: r.nation,
        rating: r.rating,
        power: r.power,
        form: r.form,
        rank: i + 1,
        worldRank: worldRank.get(r.nation) ?? i + 1,
        delta: was === undefined ? 0 : was - (i + 1),
        isNew: was === undefined,
      };
    });
}

/**
 * Which confederations this snapshot has nations in.
 *
 * Derived rather than listed, because a world only fields the confederations
 * its leagues supply players to: on the shipped twelve-country world Oceania
 * has no eligible nation at all, so offering it would be a filter that can only
 * ever produce an empty table.
 */
export function confederationsPresent(snapshot: IntlPowerSnapshot): string[] {
  const present = new Set(snapshot.ranks.map((r) => confederationOf(r.nation)));
  return CONFEDERATIONS.filter((c) => present.has(c));
}

/** Form for one snapshot, scored against that snapshot's own squad ratings. */
function formsFor(intl: InternationalState, snapshot: IntlPowerSnapshot | null) {
  if (!snapshot) return new Map<string, NationFormStats>();
  return nationForm(intl, snapshot.season, new Map(snapshot.ranks.map((r) => [r.nation, r.rating])));
}

export function NTPowerRankings() {
  const { league } = useLeague();
  const hasIntl = useHasInternational();
  const intl = league?.international;
  const snapshots = intl?.powerRankings ?? [];

  const seasons = useMemo(
    () => snapshots.map((s) => s.season).sort((a, b) => b - a),
    [snapshots],
  );
  const [season, setSeason] = useState<number | null>(null);
  const [confederation, setConfederation] = useState<string | null>(null);
  const selected = season ?? seasons[0] ?? null;

  const idx = snapshots.findIndex((s) => s.season === selected);
  const snapshot = idx >= 0 ? snapshots[idx] : null;
  const previous = idx > 0 ? snapshots[idx - 1] : null;

  // Walks every archived campaign in the window, so it is held against the
  // snapshot rather than recomputed on each filter change.
  const forms = useMemo(() => (intl ? formsFor(intl, snapshot) : new Map()), [intl, snapshot]);
  const previousForms = useMemo(
    () => (intl ? formsFor(intl, previous) : new Map()), [intl, previous],
  );

  if (!hasIntl) return <IntlEmpty />;

  // A season browsed back to may not field the confederation currently picked.
  const available = snapshot ? confederationsPresent(snapshot) : [];
  const shown = confederation !== null && available.includes(confederation) ? confederation : null;
  const rows = snapshot ? powerRows(snapshot, previous, shown, forms, previousForms) : [];
  const anyPlayed = rows.some((r) => r.form.played > 0);

  return (
    <NationalTeamsLayout title="Power Rankings">
      {snapshot === null ? (
        <p className="text-muted">No rankings yet. They're taken each time a campaign is drawn.</p>
      ) : (
        <>
          <p className="text-muted small">
            Every eligible nation, ranked by Power: its best-available-squad rating, plus a bonus or
            penalty for how it has been playing. Form counts the last four seasons of international
            football, including the campaign in progress. Beating a nation you were expected to lose
            to is worth more than beating one you weren't, and where the game was played counts too
            &mdash; a World Cup knockout tie moves the needle further than a qualifier, on the same
            scale FIFA uses. Movement is against the previous ranking.
            {shown !== null && " Narrowed to one confederation, the rank and the movement are both"
              + " against the other nations in it, and World is the place overall."}
          </p>
          <div className="d-flex flex-wrap gap-2 mb-3">
            <SeasonSelect
              seasons={seasons}
              value={selected ?? 0}
              onChange={setSeason}
              labelFor={(s) => `Rankings ${seasonYear(s)}`}
            />
            <select
              className="form-select form-select-sm w-auto"
              value={shown ?? ""}
              onChange={(e) => setConfederation(e.target.value === "" ? null : e.target.value)}
              aria-label="Confederation"
            >
              <option value="">Every confederation</option>
              {available.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {!anyPlayed && (
            <p className="text-muted small">
              No international football has been played yet, so every nation is ranked on squad
              strength alone.
            </p>
          )}
          <table className="table table-sm w-auto">
            <thead>
              <tr>
                <th className="text-end">#</th>
                <th>Nation</th>
                {shown !== null && <th className="text-end">World</th>}
                <th className="text-end">Record</th>
                <th className="text-end">GD</th>
                <th className="text-end">Rating</th>
                <th className="text-end">Power</th>
                <th className="text-end">Move</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.nation}>
                  <td className="text-end text-muted">{r.rank}</td>
                  <td><NationName nation={r.nation} /></td>
                  {shown !== null && <td className="text-end text-muted">{r.worldRank}</td>}
                  <td className="text-end text-muted text-nowrap">
                    {r.form.played > 0 ? `${r.form.won}-${r.form.drawn}-${r.form.lost}` : "-"}
                  </td>
                  <td className="text-end text-muted">
                    {r.form.played > 0 ? (r.form.gd > 0 ? `+${r.form.gd}` : r.form.gd) : "-"}
                  </td>
                  <td className="text-end text-muted">{r.rating.toFixed(1)}</td>
                  <td className="text-end fw-bold">{r.power.toFixed(1)}</td>
                  <td className="text-end">
                    <Movement delta={r.delta} isNew={r.isNew} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </NationalTeamsLayout>
  );
}
