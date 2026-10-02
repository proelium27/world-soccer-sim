import type { RetireeCareer } from "../core/players/archive.js";
import type { IntlCareer } from "../core/international/career.js";
import { emptySeasonStats, type SeasonStatLine, type SeasonStats } from "../core/players/types.js";

/**
 * A retiree's stat lines as they sit on disk: each season a bare array of
 * numbers under one shared column list, instead of an object repeating every
 * key name.
 *
 * **Size is the only reason, and it is most of it.** Measured on real player
 * saves: a season row is 309 bytes as an object and 123 as an array (structured
 * clone), and an archived retiree averages ~19-20 seasons once a save has run a
 * while, so the store at `RETIREE_ARCHIVE_LIMIT`'s 20,000 rows comes to ~48 MB
 * instead of ~120 MB. Gzipped in an export it is 32.5 bytes a row against 45.2.
 *
 * `cols` travels with every row rather than living in code, so the format is
 * self-describing: a field added to `SeasonStats` later unpacks as its empty
 * default on an old row, and one removed is simply ignored. Every field but
 * `stints` is a number, which is what lets a row be one flat array.
 */
export interface PackedRetireeCareer {
  pid: number;
  cols: string[];
  rows: number[][];
  /** Row index -> that season's per-club lines, packed under the same `cols`. Absent when no season was split. */
  stints?: Record<number, number[][]>;
  intl: IntlCareer | null;
}

function columnsOf(stats: SeasonStats[]): string[] {
  const cols = new Set<string>();
  for (const s of stats) {
    for (const k of Object.keys(s)) if (k !== "stints") cols.add(k);
  }
  return [...cols];
}

function packLine(line: SeasonStatLine, cols: string[]): number[] {
  const rec = line as unknown as Record<string, number | undefined>;
  return cols.map((c) => rec[c] ?? 0);
}

function unpackLine(row: number[], cols: string[]): SeasonStatLine {
  const line = emptySeasonStats(0) as unknown as Record<string, number>;
  cols.forEach((c, i) => {
    if (typeof row[i] === "number") line[c] = row[i];
  });
  return line as unknown as SeasonStatLine;
}

export function packRetireeCareer(career: RetireeCareer): PackedRetireeCareer {
  const cols = columnsOf(career.stats);
  const stints: Record<number, number[][]> = {};
  career.stats.forEach((s, i) => {
    if (s.stints) stints[i] = s.stints.map((l) => packLine(l, cols));
  });
  return {
    pid: career.pid,
    cols,
    rows: career.stats.map((s) => packLine(s, cols)),
    ...(Object.keys(stints).length > 0 ? { stints } : {}),
    intl: career.intl,
  };
}

export function unpackRetireeCareer(packed: PackedRetireeCareer): RetireeCareer {
  return {
    pid: packed.pid,
    stats: packed.rows.map((row, i) => {
      const line: SeasonStats = unpackLine(row, packed.cols);
      const stints = packed.stints?.[i];
      return stints ? { ...line, stints: stints.map((l) => unpackLine(l, packed.cols)) } : line;
    }),
    intl: packed.intl ?? null,
  };
}

/** A packed row read from somewhere untrusted (an imported file) that is shaped well enough to store. */
export function isPackedRetireeCareer(value: unknown): value is PackedRetireeCareer {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<PackedRetireeCareer>;
  return typeof r.pid === "number"
    && Array.isArray(r.cols) && r.cols.every((c) => typeof c === "string")
    && Array.isArray(r.rows) && r.rows.every((row) => Array.isArray(row));
}
