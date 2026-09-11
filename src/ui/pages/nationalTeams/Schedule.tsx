import { useMemo, useState } from "react";
import { useLeague } from "../../context/LeagueContext.js";
import type { IntlTournament, IntlQualifyingCampaign } from "../../../core/international/index.js";
import { INTL_TOURNAMENT_NAME, INTL_QUALIFY_PER_GROUP } from "../../../core/constants.js";
import { bestThirdsFor } from "../../../core/international/format.js";
import {
  NationalTeamsLayout, NationName, koRoundName, useHasInternational, IntlEmpty, liveCampaign,
} from "./shared.js";

/** One fixture row: a played result shows its scoreline, an unplayed one shows "v". */
function Fixture({ home, away, homeGoals, awayGoals }: {
  home: string; away: string; homeGoals: number; awayGoals: number;
}) {
  const played = homeGoals >= 0;
  return (
    <div className="d-flex align-items-center small py-1 border-bottom">
      <span className="text-end pe-2" style={{ flex: 1 }}><NationName nation={home} /></span>
      <span className="fw-bold" style={{ minWidth: "3rem", textAlign: "center" }}>
        {played ? `${homeGoals}-${awayGoals}` : "v"}
      </span>
      <span className="ps-2" style={{ flex: 1 }}><NationName nation={away} /></span>
    </div>
  );
}

function TournamentSchedule({ tournament }: { tournament: IntlTournament }) {
  const nations = tournament.nations;
  // Stages: 0 = group stage, then one per knockout round.
  const [stage, setStage] = useState(0);

  // Round names are derived from this tournament's own depth rather than from
  // the full KO_ROUND_NAMES list, because depth varies: eight groups of four
  // give a four-round bracket, while a tournament drawn before the field grew
  // to 32 has three. Naming off the list directly would label an old save's
  // quarter-finals "Round of 16". Read off the groups because the bracket is
  // empty until they are played.
  const advancing = tournament.groups.length * INTL_QUALIFY_PER_GROUP
    + bestThirdsFor(tournament.groups.length, INTL_QUALIFY_PER_GROUP);
  const koRounds = Math.max(1, Math.round(Math.log2(advancing)));
  const options = ["Group stage", ...Array.from({ length: koRounds }, (_, i) => koRoundName(i, koRounds))];

  let body;
  if (stage === 0) {
    body = (
      <div className="row g-3">
        {tournament.groups.map((group, i) => (
          <div className="col-12 col-lg-6" key={i}>
            <div className="card">
              <div className="card-header py-1 small fw-bold">Group {String.fromCharCode(65 + i)}</div>
              <div className="card-body py-1">
                {group.matches.map((m, j) => (
                  <Fixture key={j} home={nations[m.home]} away={nations[m.away]} homeGoals={m.homeGoals} awayGoals={m.awayGoals} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    const round = stage - 1;
    const played = tournament.ties.filter((t) => t.round === round);
    if (played.length > 0) {
      body = (
        <div className="card">
          <div className="card-body py-1">
            {played.map((t, j) => (
              <Fixture key={j} home={nations[t.home]} away={nations[t.away]} homeGoals={t.homeGoals} awayGoals={t.awayGoals} />
            ))}
          </div>
        </div>
      );
    } else if (round === 0 && tournament.bracket.length > 0) {
      // First round seeded but not yet played: show the known pairings.
      const pairs = [];
      for (let i = 0; i + 1 < tournament.bracket.length; i += 2) {
        pairs.push([tournament.bracket[i], tournament.bracket[i + 1]] as const);
      }
      body = (
        <div className="card">
          <div className="card-body py-1">
            {pairs.map(([h, a], j) => (
              <Fixture key={j} home={nations[h]} away={nations[a]} homeGoals={-1} awayGoals={-1} />
            ))}
          </div>
        </div>
      );
    } else {
      body = <p className="text-muted">To be decided once the previous round is played.</p>;
    }
  }

  return (
    <>
      <select
        className="form-select form-select-sm w-auto mb-3"
        value={stage}
        onChange={(e) => setStage(Number(e.target.value))}
      >
        {options.map((label, i) => (
          <option key={i} value={i}>{label}</option>
        ))}
      </select>
      {body}
    </>
  );
}

/**
 * The round a qualifying campaign is currently on: the lowest round with a
 * fixture still unplayed (the one the next offseason will play), or the last
 * round once the campaign is finished. Mirrors playQualifyingRound's own
 * "which leg is next" rule, so the page opens on the round you just watched or
 * are about to.
 */
function currentLegOf(campaign: IntlQualifyingCampaign): number {
  const legs = campaign.groups.flatMap((g) => g.matches.map((m) => ({ leg: m.leg ?? 0, played: m.homeGoals >= 0 })));
  const pending = legs.filter((l) => !l.played).map((l) => l.leg);
  if (pending.length > 0) return Math.min(...pending);
  return legs.length > 0 ? Math.max(...legs.map((l) => l.leg)) : 0;
}

function QualifyingSchedule({ campaign }: { campaign: IntlQualifyingCampaign }) {
  const nations = campaign.nations;
  const confederations = useMemo(
    () => [...new Set(campaign.groups.map((g) => g.confederation ?? "Other"))],
    [campaign.groups],
  );
  const legs = useMemo(
    () => [...new Set(campaign.groups.flatMap((g) => g.matches.map((m) => m.leg ?? 0)))].sort((a, b) => a - b),
    [campaign.groups],
  );
  const [conf, setConf] = useState("");
  // One round at a time by default. A full campaign is hundreds of fixtures
  // across every confederation, which is both slow to draw and more than anyone
  // wants at once; "All rounds" is still there for when you do.
  const [leg, setLeg] = useState<number | "all">(() => currentLegOf(campaign));

  const shown = useMemo(
    () =>
      campaign.groups
        .map((g, index) => ({ g, index }))
        .filter(({ g }) => !conf || (g.confederation ?? "Other") === conf)
        .map(({ g, index }) => ({
          index,
          confederation: g.confederation,
          matches: leg === "all" ? g.matches : g.matches.filter((m) => (m.leg ?? 0) === leg),
        }))
        .filter(({ matches }) => matches.length > 0),
    [campaign.groups, conf, leg],
  );

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3">
        {legs.length > 1 && (
          <select
            className="form-select form-select-sm w-auto"
            value={String(leg)}
            onChange={(e) => setLeg(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            {legs.map((l) => (
              <option key={l} value={l}>Round {l + 1} of {legs.length}</option>
            ))}
            <option value="all">All rounds</option>
          </select>
        )}
        {confederations.length > 1 && (
          <select
            className="form-select form-select-sm w-auto"
            value={conf}
            onChange={(e) => setConf(e.target.value)}
          >
            <option value="">All confederations</option>
            {confederations.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      <div className="row g-3">
        {shown.map(({ confederation, index, matches }) => (
          <div className="col-12 col-lg-6" key={index}>
            <div className="card">
              <div className="card-header py-1 small fw-bold">
                {confederation ?? "Group"} &middot; Group {index + 1}
              </div>
              <div className="card-body py-1">
                {matches.map((m, j) => (
                  <Fixture key={j} home={nations[m.home]} away={nations[m.away]} homeGoals={m.homeGoals} awayGoals={m.awayGoals} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function NTSchedule() {
  const { league } = useLeague();
  const hasIntl = useHasInternational();
  if (!hasIntl || !league) return <IntlEmpty />;

  // Show whichever campaign is live this offseason; between campaigns, fall back
  // to the most recent one so its fixtures stay browsable.
  const { tournament, qualifying, showing } = liveCampaign(league.international);

  return (
    <NationalTeamsLayout title="Schedule">
      {showing === "tournament" && tournament ? (
        <>
          <p className="text-muted small">{INTL_TOURNAMENT_NAME} fixtures. Pick a stage to see its matches.</p>
          <TournamentSchedule tournament={tournament} />
        </>
      ) : qualifying ? (
        <>
          <p className="text-muted small">
            Qualifying fixtures, played home and away within each confederation. One round is played
            each offseason, so this opens on the round being played now.
          </p>
          <QualifyingSchedule campaign={qualifying} />
        </>
      ) : (
        <p className="text-muted">No fixtures to show yet.</p>
      )}
    </NationalTeamsLayout>
  );
}
