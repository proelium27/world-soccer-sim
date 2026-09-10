import { useMemo, useState } from "react";
import { useLeague } from "../../context/LeagueContext.js";
import { seasonYear } from "../../format.js";
import { CONFEDERATIONS, confederationOf } from "../../../core/international/index.js";
import type { IntlPowerSnapshot } from "../../../core/international/index.js";
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
  rating: number;
  /** Position in the table being shown — within the confederation when one is picked. */
  rank: number;
  /** Position among every eligible nation, whatever the filter says. */
  worldRank: number;
  /** Places gained since the previous snapshot, measured in the same view. */
  delta: number;
  /** Absent from the previous snapshot, so there is no movement to report. */
  isNew: boolean;
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
): PowerRow[] {
  const inView = (nation: string) =>
    confederation === null || confederationOf(nation) === confederation;

  const worldRank = new Map(snapshot.ranks.map((r, i) => [r.nation, i + 1]));
  const before = new Map(
    (previous?.ranks ?? []).filter((r) => inView(r.nation)).map((r, i) => [r.nation, i + 1]),
  );

  return snapshot.ranks
    .filter((r) => inView(r.nation))
    .map((r, i) => {
      const was = before.get(r.nation);
      return {
        nation: r.nation,
        rating: r.rating,
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

export function NTPowerRankings() {
  const { league } = useLeague();
  const hasIntl = useHasInternational();
  const snapshots = league?.international.powerRankings ?? [];

  const seasons = useMemo(
    () => snapshots.map((s) => s.season).sort((a, b) => b - a),
    [snapshots],
  );
  const [season, setSeason] = useState<number | null>(null);
  const [confederation, setConfederation] = useState<string | null>(null);
  const selected = season ?? seasons[0] ?? null;

  if (!hasIntl) return <IntlEmpty />;

  const idx = snapshots.findIndex((s) => s.season === selected);
  const snapshot = idx >= 0 ? snapshots[idx] : null;
  const previous = idx > 0 ? snapshots[idx - 1] : null;

  // A season browsed back to may not field the confederation currently picked.
  const available = snapshot ? confederationsPresent(snapshot) : [];
  const shown = confederation !== null && available.includes(confederation) ? confederation : null;
  const rows = snapshot ? powerRows(snapshot, previous, shown) : [];

  return (
    <NationalTeamsLayout title="Power Rankings">
      {snapshot === null ? (
        <p className="text-muted">No rankings yet. They're taken each time a campaign is drawn.</p>
      ) : (
        <>
          <p className="text-muted small">
            Every eligible nation, ranked by its best-available-squad rating at the end of the
            season. Movement is against the previous ranking.
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
          <table className="table table-sm w-auto">
            <thead>
              <tr>
                <th className="text-end">#</th>
                <th>Nation</th>
                {shown !== null && <th className="text-end">World</th>}
                <th className="text-end">Rating</th>
                <th className="text-end">Move</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.nation}>
                  <td className="text-end text-muted">{r.rank}</td>
                  <td><NationName nation={r.nation} /></td>
                  {shown !== null && <td className="text-end text-muted">{r.worldRank}</td>}
                  <td className="text-end fw-bold">{r.rating.toFixed(1)}</td>
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
