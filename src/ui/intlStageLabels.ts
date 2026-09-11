import {
  roundsRemaining,
  type IntlConfederationCup,
  type IntlStage,
  type IntlTournament,
} from "../core/international/index.js";
import { INTL_TOURNAMENT_NAME, INTL_QUAL_LEGS } from "../core/constants.js";

/**
 * What to call the staged international campaign, in one place.
 *
 * Two surfaces play these stages — the Dashboard's Simulation card and the top
 * bar's Sim menu, which is the sim control reachable from every page — and they
 * must name the same stage the same way. Sharing the labels is the only thing
 * that guarantees it: the round names are read off the live bracket rather than
 * written per round, so a second copy would drift the first time a bracket
 * depth changed.
 */

/** A pending staged international stage — every IntlStage that still has play left. */
export type PlayableStage = Exclude<IntlStage, null | "done">;

/** True for either of the confederation cup stages. */
export function isConfederationCupStage(stage: IntlStage): boolean {
  return stage === "confederation-groups" || stage === "confederation-ko";
}

/** Where the "follow it here" link points for the stage being played. */
export function intlStageLink(stage: PlayableStage): string {
  if (stage === "qualifying") return "/national-teams/qualifying";
  if (isConfederationCupStage(stage)) return "/national-teams/confederation-cups";
  return "/national-teams/world-cup";
}

/**
 * The confederation cups this offseason is staging, written out as prose
 * ("the European Championship, Copa América and the Africa Cup of Nations").
 * Empty string when there are none.
 */
function confederationCupLabel(tournaments: IntlConfederationCup[]): string {
  const names = tournaments.map((t) => t.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and the ${names[names.length - 1]}`;
}

/**
 * What to call a knockout round that has `roundsLeft` rounds still to play,
 * counting backwards from the final. Backwards because bracket depth varies —
 * five rounds for a 48-nation World Cup, four at 32, three for a 16-nation
 * confederation cup, one for a tournament that is only a final — so a round's
 * name follows from how much is left, never from a fixed position.
 */
function knockoutRoundName(roundsLeft: number): string {
  if (roundsLeft >= 5) return "round of 32";
  if (roundsLeft === 4) return "round of 16";
  if (roundsLeft === 3) return "quarterfinals";
  if (roundsLeft === 2) return "semifinals";
  return "final";
}

/**
 * What the next confederation cup knockout stage is called. The cups are
 * aligned on their finals (see core/international/confederationCup.ts), so the
 * round is however many the deepest one has left — and since several finish
 * together the last one is plural: "the finals", not "the final".
 */
function confederationCupRoundName(tournaments: IntlConfederationCup[]): string {
  const name = knockoutRoundName(Math.max(0, ...tournaments.map(roundsRemaining)));
  return name === "final" ? "finals" : name;
}

/** What the next World Cup knockout round is called, read off its own bracket. */
function worldCupRoundName(tournament: IntlTournament | null): string {
  return knockoutRoundName(tournament ? roundsRemaining(tournament) : 1);
}

/** The button label for playing the next staged international stage. `qualRound` is 1-based. */
export function intlStageButton(
  stage: PlayableStage,
  qualRound: number,
  confederationCups: IntlConfederationCup[],
  tournament: IntlTournament | null,
): string {
  switch (stage) {
    case "qualifying":
      return `Play qualifying (round ${qualRound} of ${INTL_QUAL_LEGS})`;
    case "groups":
      return "Play the group stage";
    case "knockout":
      return `Play the ${worldCupRoundName(tournament)}`;
    case "confederation-groups":
      return "Play the group stage";
    case "confederation-ko":
      return `Play the ${confederationCupRoundName(confederationCups)}`;
  }
}

/**
 * "Play the rest of it without stopping." Offered for a tournament, never for
 * qualifying: a qualifying offseason is a single round, so there is nothing
 * left to run through once you have played it.
 */
export function intlStageThroughLabel(stage: PlayableStage): string {
  return isConfederationCupStage(stage)
    ? "Sim through the cups"
    : `Sim through the ${INTL_TOURNAMENT_NAME}`;
}

/** "Don't watch any of it." The games are still played on the way to the offseason. */
export function intlStageSkipLabel(stage: PlayableStage): string {
  if (stage === "qualifying") return "Skip qualifying";
  if (isConfederationCupStage(stage)) return "Skip the cups";
  return `Skip the ${INTL_TOURNAMENT_NAME}`;
}

/**
 * A one-line status for the staged international campaign on the Dashboard.
 *
 * The World Cup knockout is one repeating stage, so its line is built from the
 * bracket rather than written per round: the lead-in comes from whether any tie
 * has been played yet, which stays true whatever depth the bracket is (an old
 * save mid-tournament still has the three-round one).
 */
export function intlStageHeadline(
  stage: PlayableStage,
  qualRound: number,
  confederationCups: IntlConfederationCup[],
  tournament: IntlTournament | null,
): string {
  switch (stage) {
    case "qualifying":
      return qualRound < INTL_QUAL_LEGS
        ? `World Cup qualifying is on, round ${qualRound} of ${INTL_QUAL_LEGS}. Play it to move the campaign along.`
        : `The final round of World Cup qualifying, ${qualRound} of ${INTL_QUAL_LEGS}. Play it to lock in who reaches the finals.`;
    case "groups":
      return `The ${INTL_TOURNAMENT_NAME} is here. Play the group stage to get things underway.`;
    case "knockout": {
      const round = worldCupRoundName(tournament);
      if (round === "final") return "Two nations left. It's the final.";
      const lead = (tournament?.ties.length ?? 0) === 0 ? "The group stage is done. " : "";
      return `${lead}The ${round} ${round.startsWith("round of") ? "is" : "are"} next.`;
    }
    case "confederation-groups":
      return `Qualifying is done for the summer. Now for the ${confederationCupLabel(confederationCups)}: play the group stage to get things underway.`;
    case "confederation-ko":
      return confederationCupRoundName(confederationCups) === "finals"
        ? "Every cup is down to two. The finals are next."
        : `The ${confederationCupRoundName(confederationCups)} are next.`;
  }
}
