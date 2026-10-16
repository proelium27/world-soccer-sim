import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useLeague } from "../../context/LeagueContext.js";
import type { IntlTournament, IntlQualifyingCampaign } from "../../../core/international/index.js";
import { isIntlStagePending, nextKnockoutRound, roundsRemaining } from "../../../core/international/index.js";
import { INTL_TOURNAMENT_NAME, INTL_QUALIFY_PER_GROUP, qualifyingLeg } from "../../../core/constants.js";
import { bestThirdsFor } from "../../../core/international/format.js";
import {
  NationalTeamsLayout, NationName, koRoundName, useHasInternational, IntlEmpty, liveCampaign,
} from "./shared.js";
import { fieldPairs, nextStagePairs, pairKey, stageComp, type IntlComp } from "../../live/intlLive.js";
import { intlStageButton, intlStageThroughLabel, type PlayableStage } from "../../intlStageLabels.js";

/** Asks whether a fixture is in the next stage, and if so plays the stage and watches it. */
type WatchFn = ((home: number, away: number) => (() => void) | null) | null;

/** One fixture row: a played result shows its scoreline, an unplayed one shows "v". */
function Fixture({ home, away, homeGoals, awayGoals, onWatch }: {
  home: string; away: string; homeGoals: number; awayGoals: number; onWatch?: (() => void) | null;
}) {
  const { simming } = useLeague();
  const played = homeGoals >= 0;
  return (
    <div className="d-flex align-items-center small py-1 border-bottom">
      <span className="text-end pe-2" style={{ flex: 1 }}><NationName nation={home} /></span>
      <span className="fw-bold" style={{ minWidth: "3rem", textAlign: "center" }}>
        {played ? `${homeGoals}-${awayGoals}` : "v"}
      </span>
      <span className="ps-2" style={{ flex: 1 }}><NationName nation={away} /></span>
      {onWatch && (
        <button type="button" className="btn btn-sm btn-primary py-0 ms-2" disabled={simming} onClick={onWatch}>
          Watch
        </button>
      )}
    </div>
  );
}

/** Group stage, or the knockout round that's next to be played. */
function openingStage(tournament: IntlTournament, koRounds: number): number {
  if (tournament.groups.some((g) => g.matches.some((m) => m.homeGoals < 0))) return 0;
  if (roundsRemaining(tournament) === 0) return koRounds;
  return Math.min(koRounds, nextKnockoutRound(tournament).round + 1);
}

function TournamentSchedule({ tournament, watch }: { tournament: IntlTournament; watch: WatchFn }) {
  const nations = tournament.nations;

  // Round names are derived from this tournament's own depth rather than from
  // the full KO_ROUND_NAMES list, because depth varies: eight groups of four
  // give a four-round bracket, while a tournament drawn before the field grew
  // to 32 has three. Naming off the list directly would label an old save's
  // quarter-finals "Round of 16". Read off the groups because the bracket is
  // empty until they are played.
  const qualifyPerGroup = "qualifyPerGroup" in tournament
    ? (tournament as { qualifyPerGroup: number }).qualifyPerGroup
    : INTL_QUALIFY_PER_GROUP;
  const advancing = tournament.groups.length * qualifyPerGroup
    + bestThirdsFor(tournament.groups.length, qualifyPerGroup);
  const koRounds = Math.max(1, Math.round(Math.log2(advancing)));
  const options = ["Group stage", ...Array.from({ length: koRounds }, (_, i) => koRoundName(i, koRounds))];
  // Opens on the stage about to be played (or just played), and a pick sticks
  // until the tournament moves on.
  const [picked, setPicked] = useState<number | null>(null);
  const stage = picked ?? openingStage(tournament, koRounds);

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
                  <Fixture
                    key={j} home={nations[m.home]} away={nations[m.away]}
                    homeGoals={m.homeGoals} awayGoals={m.awayGoals}
                    onWatch={m.homeGoals < 0 ? watch?.(m.home, m.away) : null}
                  />
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
    const next = nextKnockoutRound(tournament);
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
    } else if (round === next.round && next.field.length > 1) {
      // The round about to be played: its pairings are already known.
      body = (
        <div className="card">
          <div className="card-body py-1">
            {fieldPairs(next.field).map(([h, a], j) => (
              <Fixture
                key={j} home={nations[h]} away={nations[a]} homeGoals={-1} awayGoals={-1}
                onWatch={watch?.(h, a)}
              />
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
        aria-label="Stage"
        value={stage}
        onChange={(e) => setPicked(Number(e.target.value))}
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

function QualifyingSchedule({ campaign, watch }: { campaign: IntlQualifyingCampaign; watch: WatchFn }) {
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
            aria-label="Round"
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
            aria-label="Confederation"
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
                  <Fixture
                    key={j} home={nations[m.home]} away={nations[m.away]}
                    homeGoals={m.homeGoals} awayGoals={m.awayGoals}
                    onWatch={m.homeGoals < 0 ? watch?.(m.home, m.away) : null}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function compKey(c: IntlComp): string {
  return c.kind === "confederation" ? `conf:${c.confederation}` : c.kind;
}

function parseComp(key: string): IntlComp {
  if (key.startsWith("conf:")) return { kind: "confederation", confederation: key.slice(5) };
  return key === "worldCup" ? { kind: "worldCup" } : { kind: "qualifying" };
}

export function NTSchedule() {
  const { league, intlStageAction, intlLiveAction, simming } = useLeague();
  const hasIntl = useHasInternational();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  if (!hasIntl || !league) return <IntlEmpty />;

  const intl = league.international;
  const { tournament, qualifying, showing } = liveCampaign(intl);

  // Every competition with fixtures on file: qualifying, the World Cup, and
  // this cycle's confederation cups.
  const comps: { comp: IntlComp; label: string }[] = [];
  if (qualifying) comps.push({ comp: { kind: "qualifying" }, label: `${INTL_TOURNAMENT_NAME} qualifying` });
  if (tournament) comps.push({ comp: { kind: "worldCup" }, label: tournament.name });
  for (const c of intl.confederationCups) {
    comps.push({ comp: { kind: "confederation", confederation: c.confederation }, label: c.name });
  }

  // Opens on whatever the next stage plays; between campaigns, on the most
  // recent one, so its fixtures stay browsable.
  const fallback: IntlComp | null = stageComp(intl)
    ?? (showing === "tournament" ? { kind: "worldCup" } : showing === "qualifying" ? { kind: "qualifying" } : comps[0]?.comp ?? null);
  const viewParam = params.get("view");
  const comp = viewParam && comps.some((c) => compKey(c.comp) === viewParam) ? parseComp(viewParam) : fallback;

  const pending = league.phase === "offseason" && isIntlStagePending(intl);
  const stage = pending ? (intl.stage as PlayableStage) : null;
  const returnTo = location.pathname + location.search;
  const nextPairs = pending && comp ? nextStagePairs(intl, comp) : null;
  const watch: WatchFn = nextPairs && comp
    ? (home, away) => (nextPairs.has(pairKey(home, away))
      ? () => intlLiveAction({ comp, home, away }, returnTo)
      : null)
    : null;
  // Remounting on progress resets each view's round pick to the stage now up
  // next, so pressing a stage button here doesn't leave you on the old one.
  const progress = (groups: { matches: { homeGoals: number }[] }[], ties = 0) =>
    groups.reduce((n, g) => n + g.matches.filter((m) => m.homeGoals >= 0).length, 0) + ties;

  const confCup = comp?.kind === "confederation"
    ? intl.confederationCups.find((c) => c.confederation === comp.confederation) ?? null
    : null;

  return (
    <NationalTeamsLayout title="Schedule">
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {comps.length > 1 && comp && (
          <select
            className="form-select form-select-sm w-auto"
            aria-label="Competition"
            value={compKey(comp)}
            onChange={(e) => setParams({ view: e.target.value }, { replace: true })}
          >
            {comps.map((c) => (
              <option key={compKey(c.comp)} value={compKey(c.comp)}>{c.label}</option>
            ))}
          </select>
        )}
        {stage && (
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={simming} onClick={() => intlStageAction("stage")}>
              {intlStageButton(stage, qualifyingLeg(league.season) + 1, intl.confederationCups, intl.tournament)}
            </button>
            {stage !== "qualifying" && (
              <button type="button" className="btn btn-sm btn-outline-secondary" disabled={simming} onClick={() => intlStageAction("through")}>
                {intlStageThroughLabel(stage)}
              </button>
            )}
          </>
        )}
      </div>
      {comp?.kind === "qualifying" && qualifying ? (
        <QualifyingSchedule key={`qualifying-${progress(qualifying.groups)}`} campaign={qualifying} watch={watch} />
      ) : comp?.kind === "worldCup" && tournament ? (
        <TournamentSchedule key={`worldCup-${progress(tournament.groups, tournament.ties.length)}`} tournament={tournament} watch={watch} />
      ) : confCup ? (
        <TournamentSchedule key={`${confCup.confederation}-${progress(confCup.groups, confCup.ties.length)}`} tournament={confCup} watch={watch} />
      ) : (
        <p className="text-muted">No fixtures to show yet.</p>
      )}
    </NationalTeamsLayout>
  );
}
