import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint } from "../components/HelpHint.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { ClubLink } from "../components/ClubLink.js";
import { seasonYear } from "../format.js";
import type { CupState, CupTie, KnockoutLeg } from "../../core/cup/types.js";
import {
  matchupsForRound, cupRoundName, cupFinalists, isCupComplete, worldHasCup,
  isSwissCup, koRoundsOf, cupSplitPlan, hasOpeningStage, prelimRoundName,
} from "../../core/cup/cup.js";
import { leaguePhaseTable, groupTable, groupQualifiers } from "../../core/cup/leaguePhase.js";
import {
  DEFAULT_CONTINENTAL_FORMAT, continentalFormatFor, describeCupShape, isDefaultContinentalFormat, resolveCupShape,
} from "../../core/cup/cupShape.js";
import { countryCoefficients, reallocateCupSlots } from "../../core/cup/coefficients.js";
import { cupSlotsForCompetition } from "../../core/cup/qualification.js";
import type { LeagueStore } from "../../core/leagueState.js";
import type { CupCompetitionId } from "../../core/constants.js";
import {
  CUP_FORMATS, CONTINENTAL_CUP_FORMAT, cupKnockoutPlan, largestValidCupField,
} from "../../core/constants.js";
import { EmptyState } from "../components/EmptyState.js";

/**
 * How a field of this size splits, in a sentence — "the top four go straight to
 * the quarter-finals, the next eight fight through a playoff round, and the
 * rest are out". Generated rather than written down because the cut lines scale
 * with the field (see cupKnockoutPlan): a smaller competition sends fewer
 * through, opens at a shallower round, and may have no playoff at all.
 */
function splitBlurb(fieldSize: number): string {
  const played = largestValidCupField(fieldSize);
  const { koSize, directQF, playoffTeams } = cupKnockoutPlan(played);
  const opener = cupRoundName(0, Math.round(Math.log2(koSize))).toLowerCase();
  if (playoffTeams === 0) return `the top ${directQF} go straight to the ${opener} and the rest are out`;
  if (directQF === 0) return `the top ${playoffTeams} fight through a playoff round for the ${opener}, and the rest are out`;
  return `the top ${directQF} go straight to the ${opener}, the next ${playoffTeams}`
    + " fight through a playoff round, and the rest are out";
}

/** One slot in a bracket column: a finished tie, a two-legged tie with only its first leg played, a known-but-unplayed pairing, or a yet-undecided placeholder. */
type Slot =
  | { kind: "played"; tie: CupTie }
  | { kind: "firstLeg"; leg: KnockoutLeg }
  | { kind: "pending"; home: number; away: number }
  | { kind: "tbd" };

function roundSlots(cup: CupState, round: number): Slot[] {
  const played = cup.ties.filter((t) => t.round === round);
  if (played.length > 0) return played.map((tie) => ({ kind: "played" as const, tie }));
  // Two-legged round with its first leg played but the second leg still to come.
  const firstLegs = (cup.koLegs ?? []).filter((l) => l.round === round);
  if (firstLegs.length > 0) return firstLegs.map((leg) => ({ kind: "firstLeg" as const, leg }));
  const pairs = matchupsForRound(cup, round); // known only once the prior round is complete (round 0 always)
  if (pairs.length > 0 && pairs.every(([h, a]) => h >= 0 && a >= 0)) {
    return pairs.map(([home, away]) => ({ kind: "pending" as const, home, away }));
  }
  const tieCount = 2 ** (koRoundsOf(cup) - 1 - round);
  return Array.from({ length: tieCount }, () => ({ kind: "tbd" as const }));
}

/** A preliminary round (Swiss playoff or legacy play-in): its ties if played, else the pending pairings. */
function prelimSlots(round: { teams: number[]; ties: CupTie[] }): Slot[] {
  if (round.ties.length > 0) return round.ties.map((tie) => ({ kind: "played" as const, tie }));
  const slots: Slot[] = [];
  for (let i = 0; i + 1 < round.teams.length; i += 2) {
    slots.push({ kind: "pending", home: round.teams[i], away: round.teams[i + 1] });
  }
  return slots;
}

/**
 * One continental competition's page. The Cup and the Shield share everything
 * structural — same league phase, same playoff, same two-legged knockout — so
 * they share this component too, and differ only by which state they read and
 * the numbers on their format (see CUP_FORMATS).
 */
/**
 * How many Cup places each country currently has, and the record that earned
 * them. Shown only on the Continental Cup's page, because only the Cup's places
 * move — the Shield gives every league the same two.
 *
 * Worth showing at all because a country quietly gaining or losing a place is
 * otherwise invisible: the player sees a different number of shaded rows on the
 * Standings table one season and has nothing to attribute it to.
 */
function CoefficientTable({ league }: { league: LeagueStore }) {
  // Nothing to show on a save that fixed its allocation at creation: the places
  // can't move, so a table of coefficients would describe a mechanic this save
  // doesn't run. Checked inside the memo as well as before the render so the
  // walk over the cup archive is skipped entirely.
  const enabled = league.rollingCoefficients ?? true;
  const rows = useMemo(() => {
    if (!enabled) return [];
    const live = [league.cup, league.shield].filter(
      (c): c is NonNullable<typeof c> => !!c && c.championTid !== null,
    );
    const coeffs = countryCoefficients(
      league.competitions,
      league.teams,
      [league.cupHistory ?? [], league.shieldHistory ?? [], live],
      league.season + 1,
    );
    const byComp = reallocateCupSlots(league.competitions, coeffs);
    const compOfCountry = new Map(
      league.competitions.filter((c) => c.tier === 1).map((c) => [c.country, c]),
    );
    return coeffs.map((c) => {
      const comp = compOfCountry.get(c.country);
      return {
        ...c,
        slots: comp
          ? byComp?.get(comp.id) ?? cupSlotsForCompetition(comp, CONTINENTAL_CUP_FORMAT)
          : 0,
      };
    });
  }, [league, enabled]);

  if (!enabled) return null;
  if (rows.every((r) => r.clubsEntered === 0)) return null;

  return (
    <div className="mb-4">
      <div className="cup-round-title">Country coefficients</div>
      <p className="text-muted small mb-2">
        How your country&apos;s clubs have done in Europe over the last few seasons decides how many
        places it gets next season. Win things and your league sends more clubs; go out early for
        years and it sends fewer.
      </p>
      <table className="table table-sm table-striped" style={{ maxWidth: 460 }}>
        <thead>
          <tr>
            <th>#</th>
            <th>Country</th>
            <th className="text-end">Coefficient</th>
            <th className="text-end">Places</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.country}>
              <td className="text-muted">{i + 1}</td>
              <td>{r.country}</td>
              <td className="text-end">{r.coefficient.toFixed(2)}</td>
              <td className="text-end">{r.slots}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Cup({ competition = "continental" }: { competition?: CupCompetitionId }) {
  const { league } = useLeague();
  const [seasonSel, setSeasonSel] = useState<number | "current">("current");

  if (!league) return <p className="p-3">Loading...</p>;

  const format = CUP_FORMATS[competition];
  const isShield = competition === "shield";
  const isAmericas = competition === "americas";
  const currentCup = isAmericas
    ? (league.americasCup ?? null)
    : isShield ? league.shield : league.cup;
  const history = [...(isAmericas
    ? league.americasCupHistory ?? []
    : isShield ? league.shieldHistory ?? [] : league.cupHistory)]
    .sort((a, b) => b.season - a.season);
  const hasAny = currentCup !== null || history.length > 0;
  // The format the next draw will use, which God Mode can change.
  const nextSettings = continentalFormatFor(league.continentalFormats, competition);
  const customNext = !isDefaultContinentalFormat(nextSettings);
  // Only worth saying when next season really plays differently from the cup
  // on screen, in either direction: a custom cup going back to the game's own
  // format is a change too, and the same custom format again is not.
  const nextField = largestValidCupField(format.fieldSize);
  const nextShape = resolveCupShape(nextField, nextSettings);
  const nextSentence = describeCupShape(nextShape, nextField);
  const currentField = currentCup?.leaguePhase?.teams.length ?? nextField;
  const currentShape = currentCup
    ? currentCup.shape ?? resolveCupShape(currentField, DEFAULT_CONTINENTAL_FORMAT)
    : null;
  const nextDiffers = currentShape
    ? describeCupShape(currentShape, currentField) !== nextSentence
    : customNext;

  if (!hasAny) {
    return (
      <div className="container-fluid p-3">
        <h4>{format.name}</h4>
        {worldHasCup(league.competitions, format) ? (
          <EmptyState
            headline={`The ${format.name} kicks off next season.`}
          >
            <p>
              {isAmericas ? (
                <>
                  A {format.fieldSize}-club competition played alongside the league for the best
                  clubs in the Americas. The top four of each American top flight get in, and a
                  country&apos;s domestic cup winner takes one of those four places if they didn&apos;t
                  finish there already. Clubs from Europe never play in it.
                </>
              ) : isShield ? (
                <>
                  A {format.fieldSize}-club competition played alongside the league, for the clubs
                  that just miss out on the Continental Cup. Every European league sends the next
                  two clubs below its Continental Cup places, and a country&apos;s domestic cup
                  winner takes one of those spots if they didn&apos;t qualify some other way.
                </>
              ) : (
                <>
                  A {format.fieldSize}-club competition played alongside the league. The strongest
                  European leagues send their top four and the rest their top two, and unless
                  you&apos;ve switched it off, which leagues count as strongest is decided by a
                  five-season record of how their clubs have done in Europe.
                </>
              )}
            </p>
            <p>
              {customNext
                ? describeCupShape(resolveCupShape(largestValidCupField(format.fieldSize), nextSettings), largestValidCupField(format.fieldSize))
                : <>Everyone starts together in a single league phase of six games, then the table splits:{" "}{splitBlurb(format.fieldSize)}.</>}
            </p>
            <p>
              Who gets in is decided by this season&apos;s final league tables, so the place you are
              playing for right now is a place in this.
            </p>
          </EmptyState>
        ) : (
          <EmptyState headline={`The ${format.name} isn't contested in this world.`}>
            <p>
              It needs enough top-flight leagues to fill its {format.fieldSize}-club field. Start a
              save with more countries switched on and it runs.
            </p>
          </EmptyState>
        )}
      </div>
    );
  }

  const cup: CupState | undefined =
    seasonSel === "current"
      ? currentCup ?? undefined
      : history.find((h) => h.season === seasonSel);

  // The season this bracket belongs to, so every club on it links to what that
  // club did that year rather than to today.
  const shownSeason = cup?.season;
  const teamColors = (tid: number): [string, string] =>
    league.teams.find((t) => t.tid === tid)?.colors ?? ["#888888", "#888888"];
  const userTid = league.meta.userTid;

  const teamCell = (tid: number, isWinner: boolean) => (
    <span className={`cup-team${isWinner ? " cup-team-winner" : ""}${tid === userTid ? " cup-team-user" : ""}`}>
      <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />
      <span className="cup-team-name">
        <ClubLink tid={tid} season={shownSeason} />
      </span>
    </span>
  );

  const renderTie = (slot: Slot) => {
    if (slot.kind === "tbd") return <div className="cup-tie-tbd">To be decided</div>;
    if (slot.kind === "pending") {
      return (
        <>
          <div className="cup-tie-row">{teamCell(slot.home, false)}</div>
          <div className="cup-tie-row">{teamCell(slot.away, false)}</div>
        </>
      );
    }
    if (slot.kind === "firstLeg") {
      return (
        <>
          <div className="cup-tie-row">
            {teamCell(slot.leg.home, false)}
            <span className="cup-tie-score">{slot.leg.homeGoals}</span>
          </div>
          <div className="cup-tie-row">
            {teamCell(slot.leg.away, false)}
            <span className="cup-tie-score">{slot.leg.awayGoals}</span>
          </div>
          <div className="cup-tie-note">first leg · second leg to play</div>
        </>
      );
    }
    const legs = slot.tie.legs;
    const rowClass = (tid: number) =>
      `cup-tie-row ${slot.tie.winner === tid ? "cup-tie-row--won" : "cup-tie-row--out"}`;
    return (
      <>
        <div className={rowClass(slot.tie.home)}>
          {teamCell(slot.tie.home, slot.tie.winner === slot.tie.home)}
          <span className="cup-tie-score">{slot.tie.homeGoals}</span>
        </div>
        <div className={rowClass(slot.tie.away)}>
          {teamCell(slot.tie.away, slot.tie.winner === slot.tie.away)}
          <span className="cup-tie-score">{slot.tie.awayGoals}</span>
        </div>
        {legs && legs.length === 2 && (
          // Each leg is its own nowrap span so a narrow column breaks the note
          // between the legs rather than through a scoreline, which was
          // orphaning the second digit on a line of its own.
          <div className="cup-tie-note">
            <span className="cup-tie-seg">agg over two legs</span>{" · "}
            <span className="cup-tie-seg">1st {legs[0].homeGoals}–{legs[0].awayGoals}</span>{" · "}
            <span className="cup-tie-seg">2nd {legs[1].awayGoals}–{legs[1].homeGoals}</span>
          </div>
        )}
        {(slot.tie.wentToExtraTime || slot.tie.wentToPens) && (
          <div className="cup-tie-note">
            {slot.tie.wentToPens
              ? `${slot.tie.homePens}–${slot.tie.awayPens} on pens`
              : "after extra time"}
          </div>
        )}
      </>
    );
  };

  const finalists = cup ? cupFinalists(cup) : [];
  const userIsFinalist = finalists.includes(userTid);
  const swiss = cup ? isSwissCup(cup) : false;
  const userInCup = cup
    ? (swiss ? cup.leaguePhase!.teams.includes(userTid) : cup.teams.includes(userTid))
    : false;

  return (
    <div className="container-fluid p-3">
      <h4>
        {format.name}
        <HelpHint>
          A {format.fieldSize}-club competition played alongside the league
          {isShield ? ", for the clubs that finish just below the Continental Cup places" : ""}.{" "}
          {currentCup?.shape ? (
            <>{describeCupShape(currentCup.shape, currentCup.leaguePhase?.teams.length ?? format.fieldSize)}{" "}</>
          ) : (
            <>
              It opens with a league phase where everyone plays six games in one table, then{" "}
              {splitBlurb(currentCup ? currentCup.leaguePhase?.teams.length ?? format.fieldSize : format.fieldSize)}.
              From there it&apos;s a straight knockout.{" "}
            </>
          )}
          {nextDiffers && (
            <>From next season it&apos;s played a different way: {nextSentence}{" "}</>
          )}
          If your club reaches the final, the sim pauses so you can play it.
        </HelpHint>
      </h4>
      {(currentCup?.shape || nextDiffers) && (
        // Visible, not only in the help popover: a format God Mode changed is
        // the first thing to explain on a page whose stages no longer match the
        // Manual's description.
        <p className="text-muted small mb-2">
          {currentCup?.shape && describeCupShape(currentCup.shape, currentCup.leaguePhase?.teams.length ?? format.fieldSize)}
          {nextDiffers && <>{currentCup?.shape ? " " : ""}From next season: {nextSentence}</>}
        </p>
      )}
      <div className="mb-3">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto", display: "inline-block" }}
          value={seasonSel}
          onChange={(e) => setSeasonSel(e.target.value === "current" ? "current" : Number(e.target.value))}
        >
          {currentCup && <option value="current">Current Season ({seasonYear(league.season)})</option>}
          {history.map((h) => (
            <option key={h.season} value={h.season}>{seasonYear(h.season)}</option>
          ))}
        </select>
      </div>

      {!cup ? (
        <p className="text-muted">No {isShield ? "Shield" : isAmericas ? "Americas Cup" : "cup"} for this season.</p>
      ) : (
        <>
          {cup.championTid !== null ? (
            <div className="cup-champion-banner mb-3">
              <span className="cup-champion-label">Champions</span>{" "}
              <ClubCrest tid={cup.championTid} colors={teamColors(cup.championTid)} size={22} />{" "}
              <strong><ClubLink tid={cup.championTid} season={shownSeason} /></strong>
            </div>
          ) : userIsFinalist ? (
            <div className="alert alert-warning py-2 mb-3">
              Your club has reached the final! Sim on to play it.
            </div>
          ) : userInCup ? (
            <p className="text-muted small mb-3">Your club is in this season&apos;s {format.name}.</p>
          ) : null}

          {!isShield && !isAmericas && seasonSel === "current" && <CoefficientTable league={league} />}

          {swiss && cup.leaguePhase && hasOpeningStage(cup) && (
            cup.leaguePhase.groups
              ? <GroupStageSection cup={cup} teamCell={teamCell} userTid={userTid} />
              : <LeaguePhaseSection cup={cup} teamCell={teamCell} userTid={userTid} />
          )}

          {/* A real bracket: the knockout pairings are fixed, so each tie sits
              between the two that feed it. Grid rows do the centring exactly
              (a round-r tie spans 2^r rows) and give the connectors something
              reliable to attach to. The qualifying rounds that hang off the
              front of it are drawn as plain columns, since nothing feeds them. */}
          <div className="cup-bracket cup-bracket--tree">
            {cup.playoff && (
              <div className="cup-round" key="playoff">
                <div className="cup-round-title">
                  <span>{prelimRoundName(cup)}</span>
                  <span className="cup-round-count">{prelimSlots(cup.playoff).length}</span>
                </div>
                <div className="cup-round-body">
                  {/* Same slot wrapper the knockout rounds use, for the same
                      reason: the row is a share of the bracket's height, so a
                      bare card would stretch to fill it and read as a box with
                      a hole in the bottom of it. No row span — nothing feeds
                      these, so they sit one per row. */}
                  {prelimSlots(cup.playoff).map((slot, i) => (
                    <div className="cup-slot" key={i}>
                      <div className="cup-tie">{renderTie(slot)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cup.playIn && (
              <div className="cup-round" key="playin">
                <div className="cup-round-title">
                  <span>Play-in round</span>
                  <span className="cup-round-count">{prelimSlots(cup.playIn).length}</span>
                </div>
                <div className="cup-round-body">
                  {prelimSlots(cup.playIn).map((slot, i) => (
                    <div className="cup-slot" key={i}>
                      <div className="cup-tie">{renderTie(slot)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Array.from({ length: koRoundsOf(cup) }, (_, round) => {
              const slots = roundSlots(cup, round);
              const isFinal = round === koRoundsOf(cup) - 1;
              return (
                <div
                  className={`cup-round${round > 0 ? " cup-round--linked" : ""}`}
                  key={round}
                >
                  <div className="cup-round-title">
                    <span>{cupRoundName(round, koRoundsOf(cup))}</span>
                    <span className="cup-round-count">{slots.length}</span>
                  </div>
                  <div className="cup-round-body">
                    {slots.map((slot, i) => (
                      // The slot is the grid item and fills the whole row span;
                      // the tie card sits centred inside it. They have to be two
                      // elements: the connectors are drawn as a fraction of the
                      // SLOT (the feeders' centres land at 25% and 75% of it),
                      // while the card is only as tall as its own content.
                      <div
                        className="cup-slot"
                        key={i}
                        // Span 2^round rows so this tie centres on its feeders.
                        style={{ gridRow: `span ${2 ** round}` }}
                      >
                        <div className={`cup-tie${isFinal ? " cup-tie--final" : ""}`}>
                          {renderTie(slot)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {!isCupComplete(cup) && (
            <p className="text-muted small mt-3">
              Stages are played automatically as the season reaches them.{" "}
              <Link to="/schedule">Sim on</Link> to advance it.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The Continental Shield's page — the same component, reading the Shield's state. */
export function Shield() {
  return <Cup competition="shield" />;
}

/** The Americas Cup's page — the same component again, reading the Americas Cup's state. */
export function AmericasCup() {
  return <Cup competition="americas" />;
}

/** The Swiss league-phase table, with the qualification cut lines shaded. */
function LeaguePhaseSection({
  cup, teamCell, userTid,
}: {
  cup: CupState;
  teamCell: (tid: number, isWinner: boolean) => ReactNode;
  userTid: number;
}) {
  const table = leaguePhaseTable(cup.leaguePhase!, cup.seeds);
  const played = cup.leaguePhase!.matches.some((m) => m.played);
  const rounds = new Set(cup.leaguePhase!.matches.map((m) => m.round)).size;
  const { directQF, playoffTeams } = cupSplitPlan(cup);
  const opener = cupRoundName(0, koRoundsOf(cup));
  const zoneClass = (pos: number): string => {
    if (pos <= directQF) return "cup-lp-direct";
    if (pos <= directQF + playoffTeams) return "cup-lp-playoff";
    return "cup-lp-out";
  };
  return (
    <div className="cup-league-phase mb-4">
      <div className="cup-round-title">League Phase</div>
      {!played && (
        <p className="text-muted small mb-2">
          The draw is set. Standings fill in as the {rounds} league-phase rounds are played.
        </p>
      )}
      <table className="table table-sm cup-lp-table">
        <thead>
          <tr>
            <th>#</th><th>Club</th>
            <th className="text-end">P</th><th className="text-end">W</th>
            <th className="text-end">D</th><th className="text-end">L</th>
            <th className="text-end">GD</th><th className="text-end">Pts</th>
          </tr>
        </thead>
        <tbody>
          {table.map((r, i) => {
            const pos = i + 1;
            return (
              <tr key={r.tid} className={`${zoneClass(pos)}${r.tid === userTid ? " cup-lp-user" : ""}`}>
                <td>{pos}</td>
                <td>{teamCell(r.tid, false)}</td>
                <td className="text-end">{r.played}</td>
                <td className="text-end">{r.won}</td>
                <td className="text-end">{r.drawn}</td>
                <td className="text-end">{r.lost}</td>
                <td className="text-end">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td className="text-end fw-bold">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cup-lp-key small text-muted">
        {directQF > 0 && (
          <span className="cup-lp-key-item"><span className="cup-lp-swatch cup-lp-direct" /> Top {directQF} to the {opener.toLowerCase()}</span>
        )}
        {playoffTeams > 0 && (
          <span className="cup-lp-key-item"><span className="cup-lp-swatch cup-lp-playoff" /> {directQF > 0 ? "Next" : "Top"} {playoffTeams} to the playoff</span>
        )}
        <span className="cup-lp-key-item"><span className="cup-lp-swatch cup-lp-out" /> Rest eliminated</span>
      </div>
    </div>
  );
}

/**
 * A groups-format cup's group stage: one small table per group, with the clubs
 * currently in a qualifying place shaded. Who is "in" is read off the same
 * groupQualifiers the draw uses, so a third-placed side the bracket would take
 * is shaded too and the shading can't disagree with who goes through.
 */
function GroupStageSection({
  cup, teamCell, userTid,
}: {
  cup: CupState;
  teamCell: (tid: number, isWinner: boolean) => ReactNode;
  userTid: number;
}) {
  const lp = cup.leaguePhase!;
  const played = lp.matches.some((m) => m.played);
  const through = new Set(groupQualifiers(lp, cup.seeds, cup.teams.length).map((q) => q.tid));
  const opener = cupRoundName(0, koRoundsOf(cup)).toLowerCase();
  return (
    <div className="cup-league-phase mb-4">
      <div className="cup-round-title">Group stage</div>
      <p className="text-muted small mb-2">
        {played
          ? `Shaded clubs are in a place that goes through to the ${opener} right now.`
          : "The draw is set. Each group plays home and away over six rounds."}
      </p>
      <div className="row g-3">
        {lp.groups!.map((group, gi) => (
          <div className="col-12 col-md-6 col-xl-3" key={gi}>
            <div className="small fw-semibold mb-1">Group {String.fromCharCode(65 + gi)}</div>
            <table className="table table-sm cup-lp-table mb-0">
              <thead>
                <tr>
                  <th>Club</th>
                  <th className="text-end">P</th><th className="text-end">GD</th><th className="text-end">Pts</th>
                </tr>
              </thead>
              <tbody>
                {groupTable(lp, group, cup.seeds).map((r) => (
                  <tr
                    key={r.tid}
                    className={`${played && through.has(r.tid) ? "cup-lp-direct" : "cup-lp-out"}${r.tid === userTid ? " cup-lp-user" : ""}`}
                  >
                    <td>{teamCell(r.tid, false)}</td>
                    <td className="text-end">{r.played}</td>
                    <td className="text-end">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="text-end fw-bold">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
