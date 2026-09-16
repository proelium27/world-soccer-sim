import type { Position } from "./players/types.js";
import {
  AWARD_MIN_APPEARANCES, AWARD_OVR_WEIGHT,
  POTY_GOAL_WEIGHT, POTY_ASSIST_WEIGHT, TOTS_POSITION_WORK,
  WORLD_AWARD_OVR_WEIGHT, WORLD_AWARD_LEAGUE_STRENGTH_WEIGHT,
  WORLD_AWARD_CUP_MULTIPLIER, WORLD_AWARD_CUP_RATING_WEIGHT, WORLD_AWARD_CUP_RUN_BONUS,
  WORLD_AWARD_LEAGUE_TITLE_BONUS, WORLD_AWARD_DOMESTIC_CUP_BONUS, WORLD_AWARD_TROPHY_STRENGTH_WEIGHT,
  WORLD_AWARD_INTL_GOAL_WEIGHT, WORLD_AWARD_INTL_ASSIST_WEIGHT, WORLD_AWARD_INTL_CAP_WEIGHT,
  WORLD_AWARD_INTL_TOURNAMENT_MULTIPLIER, WORLD_AWARD_WORLD_CUP_BONUS,
  WORLD_AWARD_INTL_CONFEDERATION_CUP_MULTIPLIER, WORLD_AWARD_CONFEDERATION_CUP_BONUS,
  WORLD_TOTS_TROPHY_MULTIPLIER,
} from "./constants.js";

/** The weight columns awards price end product in. Same groups as `positionGroup` in awards.ts. */
export type AwardGroup = "GK" | "DEF" | "MID" | "FWD";
export const AWARD_GROUPS: readonly AwardGroup[] = ["GK", "DEF", "MID", "FWD"];

/** Per-position work a Team of the Season score adds on top of the Player of the Season score. */
export interface PositionWork {
  defendingPerGame: number;
  savePct: number;
}

/**
 * Every weight the end-of-season awards are scored with, as one editable value.
 *
 * The shipped weights live in constants.ts with the measurements behind them;
 * `DEFAULT_AWARD_FORMULA` is those constants gathered up, and a save that has
 * never touched this scores with exactly them. God Mode stores an edited copy on
 * `LeagueStore.awardFormula`.
 *
 * **Only weights are here, deliberately not baselines.** `AWARD_OVR_BASELINE`
 * and `TOTS_KEEPER_SAVE_PCT_BASELINE` subtract the same constant from every
 * player an award compares, so they move every score equally and can never
 * change who wins. Offering them as knobs would be offering controls that do
 * nothing. The pro-rating shape (how many games count as a full season, the
 * trophy-strength floor and cap) stays fixed for the same kind of reason: those
 * are how a term is measured, not how much it is worth.
 *
 * **Editing it moves the world, not just the trophy cabinet.** A Team of the
 * Season place is one of the routes onto the protected-star list
 * (`transfers/protectedStars.ts`), so a different XI changes who AI clubs will
 * sell, which changes the transfer market's draw count and therefore every
 * season after. That is fine in a sandbox and is why this is a God Mode control.
 */
export interface AwardFormula {
  /** Appearances needed to qualify for Player/Team of the Season and the worldwide awards. */
  minAppearances: number;
  /** Weight on a player's average match rating. Implicitly 1 in the shipped formula. */
  ratingWeight: number;
  /** Per point of ovr above the baseline, inside every award. */
  ovrWeight: number;
  goalWeight: Record<AwardGroup, number>;
  assistWeight: Record<AwardGroup, number>;
  /** Team of the Season, per listed position. `savePct` only ever bites for keepers. */
  positionWork: Record<Position, PositionWork>;
  world: WorldAwardFormula;
}

export interface WorldAwardFormula {
  /** Extra ovr weight the worldwide awards add on top of `ovrWeight`. */
  ovrWeight: number;
  /** Rating points per point of league mean ovr above the world's. */
  leagueStrengthWeight: number;
  /** Multiplier on Continental Cup goals and assists. */
  cupMultiplier: number;
  /** Weight on Continental Cup match rating above the baseline. */
  cupRatingWeight: number;
  /** Continental Cup run bonus by rounds from the final: [winner, runner-up, semi, quarter]. */
  cupRunBonus: number[];
  leagueTitleBonus: number;
  domesticCupBonus: number;
  /** How much a league title or domestic cup scales with the strength of the league that awarded it. */
  trophyStrengthWeight: number;
  intlGoalWeight: number;
  intlAssistWeight: number;
  intlCapWeight: number;
  /** Multiplier on World Cup goals, assists and caps against a qualifier. */
  worldCupMultiplier: number;
  worldCupBonus: number;
  /** Multiplier on confederation cup goals, assists and caps against a qualifier. */
  confederationCupMultiplier: number;
  confederationCupBonus: number;
  /** Scales everything beyond his league season for the World XI and the Goalkeeper/Defender of the Year. */
  positionAwardTrophyMultiplier: number;
}

const POSITION_KEYS: readonly Position[] = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];

/** The shipped formula. Frozen, since every save without an edit shares it. */
export const DEFAULT_AWARD_FORMULA: Readonly<AwardFormula> = deepFreeze({
  minAppearances: AWARD_MIN_APPEARANCES,
  ratingWeight: 1,
  ovrWeight: AWARD_OVR_WEIGHT,
  goalWeight: { ...POTY_GOAL_WEIGHT },
  assistWeight: { ...POTY_ASSIST_WEIGHT },
  positionWork: Object.fromEntries(
    POSITION_KEYS.map((pos) => [pos, { ...TOTS_POSITION_WORK[pos] }]),
  ) as Record<Position, PositionWork>,
  world: {
    ovrWeight: WORLD_AWARD_OVR_WEIGHT,
    leagueStrengthWeight: WORLD_AWARD_LEAGUE_STRENGTH_WEIGHT,
    cupMultiplier: WORLD_AWARD_CUP_MULTIPLIER,
    cupRatingWeight: WORLD_AWARD_CUP_RATING_WEIGHT,
    cupRunBonus: [...WORLD_AWARD_CUP_RUN_BONUS],
    leagueTitleBonus: WORLD_AWARD_LEAGUE_TITLE_BONUS,
    domesticCupBonus: WORLD_AWARD_DOMESTIC_CUP_BONUS,
    trophyStrengthWeight: WORLD_AWARD_TROPHY_STRENGTH_WEIGHT,
    intlGoalWeight: WORLD_AWARD_INTL_GOAL_WEIGHT,
    intlAssistWeight: WORLD_AWARD_INTL_ASSIST_WEIGHT,
    intlCapWeight: WORLD_AWARD_INTL_CAP_WEIGHT,
    worldCupMultiplier: WORLD_AWARD_INTL_TOURNAMENT_MULTIPLIER,
    worldCupBonus: WORLD_AWARD_WORLD_CUP_BONUS,
    confederationCupMultiplier: WORLD_AWARD_INTL_CONFEDERATION_CUP_MULTIPLIER,
    confederationCupBonus: WORLD_AWARD_CONFEDERATION_CUP_BONUS,
    positionAwardTrophyMultiplier: WORLD_TOTS_TROPHY_MULTIPLIER,
  },
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** A finite number, or the fallback. NaN in a score silently breaks every sort that ranks on it. */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function mergeRecord<K extends string>(
  stored: unknown,
  fallback: Readonly<Record<K, number>>,
): Record<K, number> {
  const src = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = {} as Record<K, number>;
  for (const k of Object.keys(fallback) as K[]) out[k] = num(src[k], fallback[k]);
  return out;
}

/**
 * The formula a save scores its awards with: its stored edit merged over the
 * shipped weights, field by field.
 *
 * Lenient on purpose. A stored formula is read on every offseason, so a field
 * added to `AwardFormula` after a save stored its edit must fall back to the
 * default rather than reading undefined, and a non-finite number (a cleared
 * input, a hand-edited export) falls back rather than poisoning every score.
 * With nothing stored it returns the shared default itself.
 */
export function resolveAwardFormula(stored?: unknown): AwardFormula {
  if (!stored || typeof stored !== "object") return DEFAULT_AWARD_FORMULA as AwardFormula;
  const s = stored as Partial<Record<keyof AwardFormula, unknown>>;
  const d = DEFAULT_AWARD_FORMULA;
  const w = (s.world && typeof s.world === "object" ? s.world : {}) as Partial<Record<keyof WorldAwardFormula, unknown>>;
  const storedWork = (s.positionWork && typeof s.positionWork === "object" ? s.positionWork : {}) as Record<string, unknown>;
  const storedRun = Array.isArray(w.cupRunBonus) ? w.cupRunBonus : [];

  return {
    // A whole number of games, never negative.
    minAppearances: Math.max(0, Math.round(num(s.minAppearances, d.minAppearances))),
    ratingWeight: num(s.ratingWeight, d.ratingWeight),
    ovrWeight: num(s.ovrWeight, d.ovrWeight),
    goalWeight: mergeRecord(s.goalWeight, d.goalWeight),
    assistWeight: mergeRecord(s.assistWeight, d.assistWeight),
    positionWork: Object.fromEntries(
      POSITION_KEYS.map((pos) => [pos, mergeRecord(storedWork[pos], d.positionWork[pos])]),
    ) as Record<Position, PositionWork>,
    world: {
      ovrWeight: num(w.ovrWeight, d.world.ovrWeight),
      leagueStrengthWeight: num(w.leagueStrengthWeight, d.world.leagueStrengthWeight),
      cupMultiplier: num(w.cupMultiplier, d.world.cupMultiplier),
      cupRatingWeight: num(w.cupRatingWeight, d.world.cupRatingWeight),
      cupRunBonus: d.world.cupRunBonus.map((v, i) => num(storedRun[i], v)),
      leagueTitleBonus: num(w.leagueTitleBonus, d.world.leagueTitleBonus),
      domesticCupBonus: num(w.domesticCupBonus, d.world.domesticCupBonus),
      trophyStrengthWeight: num(w.trophyStrengthWeight, d.world.trophyStrengthWeight),
      intlGoalWeight: num(w.intlGoalWeight, d.world.intlGoalWeight),
      intlAssistWeight: num(w.intlAssistWeight, d.world.intlAssistWeight),
      intlCapWeight: num(w.intlCapWeight, d.world.intlCapWeight),
      worldCupMultiplier: num(w.worldCupMultiplier, d.world.worldCupMultiplier),
      worldCupBonus: num(w.worldCupBonus, d.world.worldCupBonus),
      confederationCupMultiplier: num(w.confederationCupMultiplier, d.world.confederationCupMultiplier),
      confederationCupBonus: num(w.confederationCupBonus, d.world.confederationCupBonus),
      positionAwardTrophyMultiplier: num(w.positionAwardTrophyMultiplier, d.world.positionAwardTrophyMultiplier),
    },
  };
}

/** Whether a stored formula actually differs from the shipped one once resolved. */
export function isCustomAwardFormula(stored?: unknown): boolean {
  if (!stored) return false;
  return JSON.stringify(resolveAwardFormula(stored)) !== JSON.stringify(DEFAULT_AWARD_FORMULA);
}

export type AwardPresetId = "shipped" | "goals" | "defenders" | "trophies" | "form";

/**
 * A named award style: a whole formula a player can pick with one click
 * instead of reasoning about forty weights. Each is the shipped formula with
 * one idea turned up, so picking one and then fine-tuning starts from somewhere
 * recognisable.
 */
export interface AwardPreset {
  id: AwardPresetId;
  label: string;
  description: string;
  formula: Readonly<AwardFormula>;
}

/** Two decimal places, so a scaled weight reads 1.65 rather than 1.6500000000000001. */
const tidy = (v: number) => Math.round(v * 100) / 100;

function derive(edit: (f: AwardFormula) => void): Readonly<AwardFormula> {
  const f = structuredClone(DEFAULT_AWARD_FORMULA) as AwardFormula;
  edit(f);
  return deepFreeze(f);
}

export const AWARD_PRESETS: readonly AwardPreset[] = [
  {
    id: "shipped",
    label: "As shipped",
    description: "The formula the game comes with.",
    formula: DEFAULT_AWARD_FORMULA,
  },
  {
    id: "goals",
    label: "Goals win awards",
    description: "Goals and assists count double and match rating half as much, so the big scorers take the awards.",
    formula: derive((f) => {
      f.ratingWeight = 0.5;
      for (const g of AWARD_GROUPS) {
        f.goalWeight[g] = tidy(f.goalWeight[g] * 2);
        f.assistWeight[g] = tidy(f.assistWeight[g] * 2);
      }
    }),
  },
  {
    id: "defenders",
    label: "Defenders get their due",
    description: "Tackles, interceptions and a keeper's save percentage count double for the Team of the Season, the World XI and the Goalkeeper and Defender of the Year. The Ballon d'Or doesn't look at defending, so it's unchanged.",
    formula: derive((f) => {
      for (const pos of POSITION_KEYS) f.positionWork[pos].defendingPerGame = tidy(f.positionWork[pos].defendingPerGame * 2);
      f.positionWork.GK.savePct = tidy(f.positionWork.GK.savePct * 2);
    }),
  },
  {
    id: "trophies",
    label: "Trophies decide it",
    description: "League titles, cup runs and cup wins are worth three times as much and international trophies twice as much, so players at winning clubs and nations take the world awards.",
    formula: derive((f) => {
      f.world.leagueTitleBonus = tidy(f.world.leagueTitleBonus * 3);
      f.world.domesticCupBonus = tidy(f.world.domesticCupBonus * 3);
      f.world.cupRunBonus = f.world.cupRunBonus.map((v) => tidy(v * 3));
      f.world.worldCupBonus = tidy(f.world.worldCupBonus * 2);
      f.world.confederationCupBonus = tidy(f.world.confederationCupBonus * 2);
    }),
  },
  {
    id: "form",
    label: "Form only",
    description: "A player's overall rating counts for nothing, so awards go purely on the season he had rather than on how good he is.",
    formula: derive((f) => {
      f.ovrWeight = 0;
      f.world.ovrWeight = 0;
    }),
  },
];

/** Which preset a formula is exactly, or null for a hand-tuned one. */
export function matchingPreset(formula: unknown): AwardPresetId | null {
  const resolved = JSON.stringify(resolveAwardFormula(formula));
  return AWARD_PRESETS.find((p) => JSON.stringify(p.formula) === resolved)?.id ?? null;
}
