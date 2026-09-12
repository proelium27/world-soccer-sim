/**
 * The federation's review: judge the campaign just played, then decide whether
 * the manager keeps the job and which other countries want them.
 *
 * Runs inside `simOffseason`, immediately after `simThroughInternational`,
 * rather than at the season boundary where the club board sits. That is forced
 * by when international football actually happens: the campaign is *drawn* at
 * the boundary but *played* during the offseason, one stage at a time, so at the
 * boundary there is nothing to judge yet. Placing the review right after the
 * stages complete means it always sees a finished campaign — including one the
 * user skipped, since that call plays out whatever they left unplayed.
 *
 * Pure with respect to the shared rng stream: offers draw on their own seeded
 * stream (see offers.ts), and nothing here touches a player, a rating or a
 * club's money. A save that manages no nation is left byte-identical apart from
 * its offer list.
 */
import type { LeagueStore } from "../leagueState.js";
import { difficultyProfile } from "../constants.js";
import { AUTOPILOT_TID } from "../autopilot.js";
import { isSpectator } from "../spectator.js";
import { nationExpectations, fieldExpectation } from "./expectation.js";
import { judgeCampaign, type CampaignVerdict } from "./confidence.js";
import { concludedCampaigns, tournamentPlacement, qualifyingPlacement } from "./outcome.js";
import { generateNationOffers, nationalReputation } from "./offers.js";
import { managerReputation } from "../manager/jobOffers.js";
import { leaveNationalJob } from "./switchNation.js";
import { currentNationalStint, type NationalManagerState, type NationalStint } from "./types.js";

export * from "./types.js";
export * from "./expectation.js";
export * from "./confidence.js";
export * from "./outcome.js";
export * from "./offers.js";
export * from "./interests.js";
export { takeNationalJob, leaveNationalJob, mapNationSquads } from "./switchNation.js";

/**
 * Judge whatever campaign concluded this offseason, then refresh the offer list.
 *
 * Returns the league with `nationalManager` (and, on a dismissal, the departed
 * nation's starting elevens) updated. Everything else is untouched.
 */
export function reviewNationalCampaign(league: LeagueStore): LeagueStore {
  // A multi-season jump hands the whole save to the AI, which parks
  // `meta.userTid` at the autopilot sentinel for its duration. The club board
  // sits the jump out for a reason that applies word for word here — you
  // weren't picking the team, so you can't be sacked for it — and it also stops
  // a jump ending with a country lost to campaigns the user never saw.
  if (league.meta.userTid === AUTOPILOT_TID) return league;

  // A spectator manages nobody, so no federation comes calling. Without this
  // the offer pass below would still run (it does not depend on holding a job —
  // that is how an unemployed national manager gets back in) and would hand a
  // save whose whole premise is watching a country to run.
  if (isSpectator(league)) return league;

  const state = league.nationalManager;
  const snapshot = league.international.powerRankings[league.international.powerRankings.length - 1];
  const expectations = nationExpectations(snapshot);

  let updated: NationalManagerState = state;
  let sackedNow = false;

  const nation = state.nation;
  if (nation) {
    const mine = expectations.get(nation);
    const patience = difficultyProfile(league.difficulty).boardPatience;

    for (const campaign of concludedCampaigns(league.international, nation, league.season)) {
      // Judge each campaign exactly once. simOffseason can only run once per
      // season (it gates on the phase and then changes it), so this is a
      // backstop rather than the load-bearing guard the club board needs — but
      // a second verdict would decay confidence twice and count one campaign as
      // two, which is worth being certain about.
      if (
        updated.lastVerdict?.season === league.season
        && updated.lastVerdict.competition === campaign.competition
        && updated.lastVerdict.nation === nation
      ) continue;

      const seeded = fieldExpectation(campaign.field, nation, snapshot);
      if (!seeded) continue;

      const placement = campaign.qualifying
        ? qualifyingPlacement(campaign.qualifying, nation, seeded.rank)
        : campaign.tournament
          ? tournamentPlacement(campaign.tournament, nation)
          : null;
      // A bracket still mid-flight has no placement yet, so there is nothing to
      // judge. Shouldn't happen after simThroughInternational, but a verdict
      // built on a half-played tournament would be worse than none.
      if (placement === null) continue;

      const verdict: CampaignVerdict = judgeCampaign(
        {
          kind: campaign.kind,
          competition: campaign.competition,
          placement,
          expectedRank: seeded.rank,
          nations: seeded.nations,
          demand: mine?.demand ?? 0.5,
          titles: campaign.title ? 1 : 0,
          continentalTitles: campaign.continentalTitle ? 1 : 0,
          qualified: campaign.qualified,
        },
        updated.confidence,
        currentNationalStint(updated)?.campaigns ?? 0,
        updated.sackingEnabled,
        patience,
      );

      const stint = currentNationalStint(updated);
      const stints: NationalStint[] = stint
        ? [
          ...updated.stints.slice(0, -1),
          {
            ...stint,
            campaigns: stint.campaigns + 1,
            titles: stint.titles + verdict.titles,
            continentalTitles: stint.continentalTitles + verdict.continentalTitles,
            qualifications: stint.qualifications + (campaign.qualified === true ? 1 : 0),
            overperformance: stint.overperformance + verdict.overperformance,
          },
        ]
        : updated.stints;

      updated = {
        ...updated,
        confidence: verdict.confidence,
        stints,
        lastVerdict: {
          ...verdict,
          season: league.season,
          nation,
          previousConfidence: updated.confidence,
        },
      };
      if (verdict.sacked) sackedNow = true;
    }
  }

  // `sacked` is a headline about *this* offseason, not a lasting condition —
  // the job is already gone and `nation` is null either way. Cleared at the top
  // of every later review so a manager who takes the summer off doesn't keep
  // being told, three seasons on, that a federation has just let them go.
  if (updated.sacked && !sackedNow) updated = { ...updated, sacked: false };

  // A dismissal ends the stint and hands the nation back before offers are
  // drawn, so the list is scoped to a manager without a job rather than to the
  // one they just lost.
  let out: LeagueStore = { ...league, nationalManager: updated };
  if (sackedNow) out = leaveNationalJob(out, "sacked");

  const after = out.nationalManager;
  const offers = generateNationOffers({
    lid: league.lid,
    season: league.season,
    currentNation: after.nation,
    expectations,
    sacked: sackedNow,
    reputation: nationalReputation(after.stints),
    // Federations see a discounted slice of the club career. Read here rather
    // than folded into `nationalReputation`, which is displayed to the player as
    // their international standing and must keep saying what it means — and
    // which also feeds nothing else, so the confidence and sacking model stays
    // strictly on the national record.
    clubReputation: managerReputation(league.manager.stints),
    lastOverperformance: after.lastVerdict?.overperformance ?? 0,
    interests: after.interests,
  });

  return { ...out, nationalManager: { ...after, offers } };
}
