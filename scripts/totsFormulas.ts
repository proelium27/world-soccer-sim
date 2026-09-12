/**
 * Candidate per-position Team of the Season formulas, loaded by
 * scripts/totsFormulaEval.ts. Edit freely; the harness re-reads this file every
 * run.
 *
 * Attacking positions (AM/W/ST) use the Player of the Season weights with no
 * defending, so a forward's league POTY is also the best forward at his
 * position by construction. Defensive positions count defensive work and goals
 * conceded PER APPEARANCE rather than as season totals, so a defence that faces
 * more attacks isn't rewarded for the volume.
 */
type Pos = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "W" | "ST";
type W = Partial<Record<"goals" | "assists" | "defPerApp" | "gaPerApp" | "savesPerApp" | "preventedPerApp" | "ovr", number>>;
type Formula = (p: { pos: Pos; ovr: number; stats: Record<string, number> }) => number;

function withOvr(table: Record<Pos, W>, ovr: Partial<Record<Pos, number>>): Record<Pos, W> {
  const out = { ...table };
  for (const [pos, w] of Object.entries(ovr)) out[pos as Pos] = { ...out[pos as Pos], ovr: w };
  return out;
}

const V1: Record<Pos, W> = {
  GK: { preventedPerApp: 3, gaPerApp: 1.0 },
  CB: { goals: 0.14, assists: 0.09, defPerApp: 0.15, gaPerApp: 0.8 },
  FB: { goals: 0.14, assists: 0.09, defPerApp: 0.12, gaPerApp: 0.6 },
  DM: { goals: 0.1, assists: 0.07, defPerApp: 0.12, gaPerApp: 0.3 },
  CM: { goals: 0.1, assists: 0.07, defPerApp: 0.06 },
  AM: { goals: 0.08, assists: 0.05 },
  W: { goals: 0.08, assists: 0.05 },
  ST: { goals: 0.08, assists: 0.05 },
};

/**
 * v2, after measuring which per-appearance stats track ovr at each position:
 * goalsAgainst is recorded for keepers only, so the outfield GA terms above were
 * reading zero and are gone; a keeper's goals conceded per game tracks his ovr
 * (r -0.56) where saves run the other way (-0.27, busier keepers are worse ones)
 * and goals prevented barely registers (0.10).
 */
const V2: Record<Pos, W> = {
  GK: { gaPerApp: 1.2 },
  CB: { goals: 0.14, assists: 0.09, defPerApp: 0.15 },
  FB: { goals: 0.14, assists: 0.09, defPerApp: 0.12 },
  DM: { goals: 0.1, assists: 0.07, defPerApp: 0.12 },
  CM: { goals: 0.1, assists: 0.07, defPerApp: 0.06 },
  AM: { goals: 0.08, assists: 0.05 },
  W: { goals: 0.08, assists: 0.05 },
  ST: { goals: 0.08, assists: 0.05 },
};

export function FORMULAS(
  perPosition: (t: Record<Pos, W>) => Formula,
): Record<string, Formula> {
  const all = (w: number) => ({ GK: w, CB: w, FB: w, DM: w, CM: w, AM: w, W: w, ST: w });
  return {
    "per-position v1": perPosition(V1),
    "v1, ovr 0.10": perPosition(withOvr(V1, all(0.1))),
    "v2": perPosition(V2),
    "v2, GK ga 2.0": perPosition({ ...V2, GK: { gaPerApp: 2.0 } }),
    "v2, CB/FB/DM def x2": perPosition({
      ...V2,
      CB: { ...V2.CB, defPerApp: 0.3 }, FB: { ...V2.FB, defPerApp: 0.24 }, DM: { ...V2.DM, defPerApp: 0.24 },
    }),
    "v2, ST goals 0.10": perPosition({ ...V2, ST: { goals: 0.1, assists: 0.05 } }),
    "v2, AM assists 0.07": perPosition({ ...V2, AM: { goals: 0.08, assists: 0.07 } }),
  };
}
