import { useMemo, useState } from "react";
import { useLeague } from "../../context/LeagueContext.js";
import { seasonYear } from "../../format.js";
import { INTL_TOURNAMENT_NAME, INTL_FIELD_SIZE } from "../../../core/constants.js";
import {
  qualifyingPlan, manageableNations, type ConfederationQualifyingPlan,
} from "../../../core/international/index.js";
import { resolveWorldCupSize } from "../../../core/international/format.js";
import { WorldCupSizeSelect, worldCupSizeBlurb } from "../../components/WorldCupSizeSelect.js";
import {
  NationalTeamsLayout, NationName, GroupStandings, liveGroupRows, SeasonSelect,
  useHasInternational, IntlEmpty, type StandingRow, type RowMark,
} from "./shared.js";

/** A confederation's groups, already normalized to nation-keyed standings. */
interface ConfGroups {
  confederation: string;
  groups: StandingRow[][];
  /** Its allocation, when the campaign is live enough to derive one. */
  plan?: ConfederationQualifyingPlan;
}

/** What to call the nations finishing in a given group position, index 0 = first. */
const PLACE_NAMES = [
  "group winners", "runners-up", "third-placed nations", "fourth-placed nations",
  "fifth-placed nations", "sixth-placed nations",
];

function placeName(position: number): string {
  return PLACE_NAMES[position] ?? `nations finishing ${position + 1}${nth(position + 1)}`;
}

/**
 * The confederation's allocation in words, e.g. "13 of the 32 places, from 7
 * groups: every group winner, plus the 6 best runners-up." All of it is settled
 * at the draw, three offseasons before the last leg is played, which is the
 * whole reason it is worth printing before a ball is kicked.
 *
 * A position that takes every group's place is stated as a guarantee rather
 * than a count. One that takes only some is stated as "the N best", because
 * those are ranked against each other across the confederation's groups and no
 * single group can be read on its own.
 */
function planSentence(plan: ConfederationQualifyingPlan, fieldSize: number): string {
  const places = `${plan.slots} of the ${fieldSize} places`;

  if (plan.groups === 0) {
    return plan.nations === 1
      ? `${places} for its one nation, which is through without playing a qualifier.`
      : `${places} for ${count(plan.nations)} nations, so all of them are through without `
        + "playing a qualifier.";
  }

  // The quota is always some run of positions that take every group's place,
  // then at most one that takes only part of the next (placesByPosition stops
  // the moment the places run out). Saying the run as a run reads far better
  // than listing it: "every group's top three" over "every group's winner,
  // every group's runner-up, every group's third-placed nation".
  const full = plan.byPosition.filter((take) => take === plan.groups).length;
  const partial = plan.byPosition.length > full ? plan.byPosition[full] : 0;
  const each = plan.groups === 1 ? "the" : "every group's";

  const parts: string[] = [];
  if (full === 1) parts.push(plan.groups === 1 ? "the group winner" : "every group winner");
  else if (full > 1) parts.push(`${each} top ${count(full)}`);
  if (partial > 0) parts.push(`the ${count(partial)} best ${placeName(full)}`);

  const groups = `${count(plan.groups)} ${plan.groups === 1 ? "group" : "groups"}`;
  return `${places}, from ${groups}: ${parts.join(", plus ")}.`;
}

/** Small counts read better as words in prose; anything larger stays a numeral. */
const COUNT_WORDS = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
];

function count(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function nth(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
}

/**
 * Which finishing places are marked while a campaign is still being played. A
 * position that takes every group's place is settled, so it is marked as
 * qualifying; one that takes only some is a contest across the confederation's
 * groups, so it can only be marked as contended.
 */
function zonesOf(plan: ConfederationQualifyingPlan): (position: number) => RowMark {
  return (position) => {
    const take = plan.byPosition[position];
    if (take === undefined) return null;
    return take === plan.groups ? "through" : "contending";
  };
}

function QualifyingView({
  entered,
  qualified,
  byConfederation,
  fieldSize,
}: {
  entered: number;
  qualified: string[];
  byConfederation: ConfGroups[];
  /** Places the campaign played for; an archived one reads it off its qualifiers. */
  fieldSize: number;
}) {
  const qualifiedSet = new Set(qualified);
  // `qualified` fills only when the last of the three legs is played, so an
  // empty list means the campaign is still running rather than that nobody got
  // in. Until then there is no nation to mark, only a place.
  const stillPlaying = qualified.length === 0;
  return (
    <>
      <h6>Qualified for the {INTL_TOURNAMENT_NAME}</h6>
      <div className="mb-3 d-flex flex-wrap gap-2">
        {qualified.length === 0
          ? <span className="text-muted">Qualifying is still being played.</span>
          : qualified.map((nation) => (
              <span className="qualified-pill" key={nation}><NationName nation={nation} /></span>
            ))}
      </div>

      <p className="text-muted small">
        {entered} nations entered for {fieldSize} places. Groups are played home and away, and
        how many places each confederation gets depends on how many genuinely competitive nations
        it has, though every group plays for at least its winner's place. That split, and the
        groups it's played in, are settled when the campaign is drawn, so what each confederation
        is playing for is known before the first match.
      </p>

      {stillPlaying && (
        <div className="qual-key text-muted small mb-3">
          <span className="qual-key-item">
            <span className="qual-bar qual-key-swatch qual-bar-through" /> qualifies
          </span>
          <span className="qual-key-item">
            <span className="qual-bar qual-key-swatch qual-bar-contending" /> in the running for
            the places left
          </span>
        </div>
      )}

      {byConfederation.map(({ confederation, groups, plan }) => (
        <div className="mb-3" key={confederation}>
          <h6 className="mb-1">{confederation}</h6>
          {plan && <p className="text-muted small mb-2">{planSentence(plan, fieldSize)}</p>}
          <div className="row g-3">
            {groups.map((rows, i) => (
              <div className="col-12 col-lg-6" key={i}>
                <div className="card">
                  <div className="card-header py-1 small fw-bold">Group {i + 1}</div>
                  <GroupStandings
                    rows={rows}
                    // Once the qualifiers are known they are the truth and the
                    // zones are noise: a runner-up who missed out must not keep
                    // a mark that says he's in the running.
                    highlight={stillPlaying ? undefined : (n) => qualifiedSet.has(n)}
                    zoneAt={stillPlaying && plan ? zonesOf(plan) : undefined}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Bucket a flat list of {confederation, rows} groups into per-confederation
 * columns, attaching each one's allocation when `plans` is supplied.
 *
 * Plans lead, groups follow. A confederation with no more nations than places
 * plays no qualifying at all and so contributes no groups, which used to leave
 * it off this page entirely: its nations appeared among the qualifiers having
 * apparently come from nowhere. Ordering by the plan lists it with its own
 * one-line explanation and no table.
 */
function bucketByConfederation(
  groups: { confederation: string | null; rows: StandingRow[] }[],
  plans: ConfederationQualifyingPlan[] = [],
): ConfGroups[] {
  const map = new Map<string, StandingRow[][]>();
  for (const plan of plans) map.set(plan.confederation, []);
  for (const g of groups) {
    const key = g.confederation ?? "Other";
    const list = map.get(key);
    if (list) list.push(g.rows);
    else map.set(key, [g.rows]);
  }
  const planOf = new Map(plans.map((p) => [p.confederation, p]));
  return [...map.entries()].map(([confederation, groups]) => ({
    confederation,
    groups,
    plan: planOf.get(confederation),
  }));
}

export function NTQualifying() {
  const { league } = useLeague();
  const hasIntl = useHasInternational();
  const current = league?.international.qualifying ?? null;
  const history = league?.international.qualifyingHistory ?? [];

  const seasons = useMemo(() => {
    const set = new Set<number>();
    if (current) set.add(current.season);
    for (const h of history) set.add(h.season);
    return [...set].sort((a, b) => b - a);
  }, [current, history]);

  const [season, setSeason] = useState<number | null>(null);
  const selected = season ?? seasons[0] ?? null;

  if (!hasIntl || !league) return <IntlEmpty footer={<WorldCupSizeCard />} />;

  const showingCurrent = current !== null && selected === current.season;
  const archived = history.find((h) => h.season === selected) ?? null;

  let body;
  if (showingCurrent && current) {
    body = (
      <QualifyingView
        entered={current.nations.length}
        qualified={current.qualified}
        fieldSize={current.fieldSize ?? INTL_FIELD_SIZE}
        byConfederation={bucketByConfederation(
          current.groups.map((g) => ({ confederation: g.confederation, rows: liveGroupRows(g, current.nations) })),
          // Only the live campaign can carry a plan: an archived summary keeps
          // results, not the nation list the allocation is derived from. It
          // shows the qualifiers themselves instead, which is the better answer
          // once they're known anyway.
          qualifyingPlan(current),
        )}
      />
    );
  } else if (archived) {
    body = (
      <QualifyingView
        entered={archived.entered}
        qualified={archived.qualified}
        fieldSize={archived.qualified.length}
        byConfederation={bucketByConfederation(archived.groups)}
      />
    );
  } else {
    body = <p className="text-muted">No qualifying campaign has been played yet.</p>;
  }

  return (
    <NationalTeamsLayout title="Qualifying">
      <SeasonSelect
        seasons={seasons}
        value={selected ?? 0}
        onChange={setSeason}
        labelFor={(s) => `Qualifying ${seasonYear(s)}`}
      />
      {body}
      <WorldCupSizeCard />
    </NationalTeamsLayout>
  );
}

/**
 * The save's World Cup size, and what it means for the next draw.
 *
 * Lives here rather than in God Mode because it can't touch anything already
 * under way: a qualifying campaign records the size it was drawn at, so a
 * change only reaches the next one (see LeagueStore.worldCupSize). The card
 * says which size the current cycle is locked to, because otherwise changing
 * the setting mid-cycle looks like it did nothing.
 */
export function WorldCupSizeCard() {
  const { league, setWorldCupSizeAction, simming } = useLeague();
  const players = league?.players;
  const eligible = useMemo(() => (players ? manageableNations(players).length : 0), [players]);
  if (!league) return null;

  const setting = league.worldCupSize ?? INTL_FIELD_SIZE;
  const next = resolveWorldCupSize(setting, eligible);
  const q = league.international.qualifying;
  const t = league.international.tournament;
  // A qualifying campaign stays on the state after its World Cup is played, so
  // it is only "this cycle" until a tournament drawn from it exists.
  const lockedTo = q && !(t && t.season > q.season) ? (q.fieldSize ?? INTL_FIELD_SIZE) : null;

  return (
    <div className="card mt-4">
      <div className="card-body">
        <h6 className="mb-2"><label htmlFor="world-cup-size-setting" className="mb-0">World Cup size</label></h6>
        <WorldCupSizeSelect
          id="world-cup-size-setting"
          value={setting}
          disabled={simming}
          onChange={(size) => void setWorldCupSizeAction(size)}
        />
        <p className="text-muted small mt-2 mb-1">{worldCupSizeBlurb(setting)}</p>
        <p className="text-muted small mb-0">
          {next === null
            ? `Your world has ${eligible} nations with enough players to field a squad, which isn't enough for a World Cup yet.`
            : `Your world has ${eligible} nations with enough players to field a squad, so the next qualifying draw will be for a ${next}-nation World Cup.`}
          {lockedTo !== null && (
            ` This cycle's qualifying was drawn for ${lockedTo} places, so the World Cup at the end of it stays that size. A change here starts with the next draw.`
          )}
        </p>
      </div>
    </div>
  );
}
