import posthog from "posthog-js";

// Custom gameplay events reported to PostHog.
//
// The whole game runs client-side (state lives in IndexedDB and never reaches a
// server), so these capture() calls are our ONLY window into what players
// actually do. PostHog already reports page views for free; this adds the
// in-game actions page views can't see.
//
// Two rules keep the dashboard useful and privacy-clean:
//   1. Keep the event set small and stable — a handful of meaningful moments,
//      not one event per click.
//   2. Property values must stay LOW-CARDINALITY: bucketed/enumerated strings
//      and small numbers only. Never send raw player/team ids, names, or
//      anything that could identify or fingerprint a person — Vercel groups the
//      dashboard by these values, so high-cardinality props make it unreadable
//      AND leak detail we don't want.

/** Every gameplay event and the exact shape of its properties. */
export interface GameEvents {
  /** A brand-new save was created. `roster` marks one started from a roster file. */
  league_created: {
    country: string;
    /**
     * Which division the user's club plays in, or **null** when they picked no
     * club at all (`spectate`). Nullable rather than defaulted, because
     * `tierForTid` answers 1 for a tid it cannot find and a default would
     * quietly file every spectator save as a top-flight start.
     *
     * A plain number, not a literal union: every country runs three divisions
     * and a custom one can be built shallower, so the value is 1 to
     * MAX_DIVISIONS. Still low-cardinality, which is the rule that matters here.
     */
    tier: number | null;
    /** The save has no manager: every club is AI-run (see core/spectator.ts). */
    spectate?: boolean;
    roster?: boolean; difficulty?: string;
    /** Whether Cup places are re-earned on the country coefficient (the default). */
    rollingCoefficients?: boolean;
    /** Which development model the save runs (see ProgressionModel). */
    progressionModel?: string;
  };
  /**
   * The user simulated forward. `through` is how far: a single game, a chosen
   * target matchday, or the rest of the season. `matchdays` is how many were
   * played, bucketed to keep the property low-cardinality. `live` marks a
   * matchday watched in the live viewer rather than simmed straight through,
   * so the two ways of playing the same game stay tellable apart.
   */
  season_simmed: {
    through: "game" | "matchday" | "season";
    matchdays?: "1" | "2-5" | "6-15" | "16+";
    live?: boolean;
  };
  /** The user advanced past the offseason into a new season. */
  offseason_advanced: Record<string, never>;
  /**
   * The user jumped forward whole seasons with the AI running their club.
   * Bucketed like `season_simmed.matchdays`, for the same reason — the raw
   * count would be a high-cardinality property.
   */
  seasons_jumped: { seasons: "1" | "2-5" | "6-10" | "11+" };
  /** The user played a staged international stage (one stage, or through the rest). */
  intl_stage_played: { mode: "stage" | "through" };
  /** The user made a transfer bid for another club's player. */
  transfer_offer_made: Record<string, never>;
  /** The user accepted an AI club's offer for one of their players. */
  inbound_offer_accepted: Record<string, never>;
  /** The user signed a free agent to their senior roster. */
  free_agent_signed: Record<string, never>;
  /** The user changed their team's formation. */
  formation_changed: { formation: string };
  /** The user clicked "Best XI" to auto-pick the strongest formation + lineup. */
  best_xi_auto_picked: { formation: string };
  /**
   * The user played the preseason super cups from the button rather than
   * letting the season's first advance play them. Fires at most once a season,
   * and it is the only signal for whether the preseason gate is a moment people
   * stop for or one they walk straight past.
   */
  super_cups_played: { count: number; userWon: boolean };
  /**
   * The user took charge of a national team. A rare, deliberate moment — once
   * every few seasons at most — and the only signal for whether anyone manages
   * a country at all, which is the one thing worth knowing about the feature.
   */
  national_job_accepted: Record<string, never>;
  /** The user listed one of their players for loan. */
  player_loaned_out: { seasons: 1 | 2 | 3 };
  player_loaned_in: { seasons: 1 | 2 | 3 };
  /** The user released a player from their senior roster. */
  player_released: Record<string, never>;
  /** The user extended a player's contract on their senior roster. */
  contract_extended: Record<string, never>;
  /**
   * The user re-signed a whole group of out-of-contract players in one click.
   * `group` names the surface it ran from (see core/contractRenewal.ts);
   * `count` is bucketed, like season_simmed.matchdays.
   */
  contracts_extended_all: {
    group: "senior" | "academy" | "loanedOut";
    count: "1" | "2-5" | "6-15" | "16+";
  };
  /** The user signed a prospect to their youth academy. */
  player_signed_to_academy: Record<string, never>;
  /** The user promoted an academy player to the senior roster. */
  player_promoted_from_academy: Record<string, never>;
  /** The user accepted an AI club's loan offer for one of their listed players. */
  loan_offer_accepted: Record<string, never>;
  /** The user imported a save file. */
  league_imported: Record<string, never>;
}

/**
 * Report a gameplay event. Typed so a call can't send the wrong props, and
 * wrapped so analytics can never throw into gameplay — a tracking failure
 * should be invisible to the player.
 */
export function trackEvent<K extends keyof GameEvents>(
  name: K,
  ...props: GameEvents[K] extends Record<string, never> ? [] : [GameEvents[K]]
): void {
  try {
    posthog.capture(name, props[0]);
  } catch {
    // Analytics must never break the game.
  }
}
