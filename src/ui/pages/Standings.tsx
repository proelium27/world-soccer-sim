import { useMemo, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint, PotHelp } from "../components/HelpHint.js";
import { computeStandings, type StandingsRow } from "../../core/standings.js";
import { pointsDeductionMap } from "../../core/finance/debt.js";
import { computeTeamRating } from "../../core/teams/teamRating.js";
import { teamSlots } from "../../core/lineup/formations.js";
import {
  tierOf, competitionRegion, competitionConferences, competitionTitlePlayoff,
} from "../../core/competitions.js";
import { conferenceMembers } from "../../core/conferences.js";
import { worldHasCup, cupSlotsForCompetition, cupSlotRange } from "../../core/cup/cup.js";
import { seasonQualification } from "../../core/cup/seasonQualification.js";
import type { QualificationRoute } from "../../core/cup/qualification.js";
import type { CupCompetitionId } from "../../core/constants.js";
import {
  SHIELD_FORMAT, AMERICAS_CUP_FORMAT, CONFERENCE_PLAYOFF_TEAMS, ZONE_PLAYOFF_TEAMS,
} from "../../core/constants.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { ClubLink } from "../components/ClubLink.js";
import { TrophyIcon } from "../components/TrophyIcon.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import { seasonYear, ordinal } from "../format.js";

/** One club's continental place this season, from core/cup/seasonQualification. */
type QualifiedPlace = { competition: CupCompetitionId; route: QualificationRoute };

type StandingsSortKey =
  | "pos" | "team" | "p" | "w" | "d" | "l" | "gf" | "ga" | "gd" | "pts" | "ovr" | "pot";

/**
 * The qualification bar on a row's leading edge, or null if the club has not
 * qualified for anything. Continental Cup and Shield get their own colour, and
 * each bar carries a title the legend below the table repeats.
 *
 * The two zones are no longer guaranteed to be contiguous bands at the top of
 * the table: a club can also enter by winning his domestic cup or by holding a
 * continental trophy, and either can come from mid-table. So the shading is
 * driven by the real allocation (see core/cup/seasonQualification) rather than
 * by a rank range, and the title says which route it was when it wasn't the
 * league — otherwise a bar beside 9th place reads as a bug.
 */
function qualBarClass(place: QualifiedPlace | undefined): string | null {
  if (!place) return null;
  // The Americas Cup is the Americas' top competition, so it wears the top
  // competition's colour; no table ever shows it beside the Continental Cup.
  return place.competition === "shield"
    ? "qual-bar qual-bar-shield"
    : "qual-bar qual-bar-cup";
}

const COMPETITION_LABEL: Record<CupCompetitionId, string> = {
  continental: "Continental Cup",
  shield: "Continental Shield",
  americas: "Americas Cup",
};

function qualTitle(place: QualifiedPlace | undefined): string | undefined {
  if (!place) return undefined;
  const name = COMPETITION_LABEL[place.competition];
  if (place.route === "domestic-cup") return `${name} place, as domestic cup winners`;
  if (place.route === "holder") return `${name} place, as holders`;
  return `${name} place`;
}

export function Standings() {
  const { league } = useLeague();
  const [season, setSeason] = useState<number | "current">("current");
  const [compIdOverride, setCompIdOverride] = useState<number | null>(null);
  // A split league (MLS's conferences, Argentina's zones) opens on its two
  // halves; "overall" is the single table everything but the title reads.
  const [view, setView] = useState<"conferences" | "overall">("conferences");
  // Default "pos" ascending keeps the natural league-table order (1st on top).
  const { sort, toggle } = useTableSort<StandingsSortKey>("pos", "asc");

  // Who actually holds a continental place, rather than which finishing
  // positions usually earn one — a domestic cup winner or a trophy holder can
  // qualify from anywhere in the table, and neither shows up in a rank range.
  // Memoised on the league object (the context hands out a fresh one per commit)
  // because it rebuilds every competition's table.
  //
  // ABOVE the early returns, and null-guarded rather than moved down beside the
  // code that reads it. React counts hooks per render, so a hook after a return
  // runs a different number of times depending on which branch was taken: the
  // page renders three hooks on a league with no matches, then four the moment
  // one is played, and throws "Rendered more hooks than during the previous
  // render" without ever having been wrong about the football. Open Standings on
  // a fresh save and hit Sim and you were there.
  const qualification = useMemo(
    () => (league ? seasonQualification(league, season) : null),
    [league, season],
  );

  // qualification is null exactly when league is, so one guard narrows both.
  if (!league || !qualification) {
    return <p className="p-3">Loading...</p>;
  }

  if (league.played.length === 0 && league.seasonHistory.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Standings</h4>
        <p>No matches played yet.</p>
      </div>
    );
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  const compId = compIdOverride ?? userTeam?.compId ?? league.competitions[0].id;
  const isTier1 = tierOf(league.competitions, compId) === 1;
  // Each tier-1 table's top clubs qualify for the Continental Cup — four for a
  // strong league, two for a weak one. Only mark the zone in worlds that field a
  // cup.
  const comp = league.competitions.find((c) => c.id === compId);
  // A league only ever shows its own continent's competitions: a Brazilian table
  // has no Continental Cup zone, and a European one has no Americas Cup zone.
  const inEurope = !!comp && competitionRegion(comp) === "europe";
  const showCupZone = isTier1 && inEurope && worldHasCup(league.competitions);
  const cupSlots = comp ? cupSlotsForCompetition(comp) : 0;
  // Directly below it, the Continental Shield's places. A world can field a Cup
  // and not a Shield (it needs more top-flight leagues), so this is asked
  // separately rather than assumed to come along with the Cup zone.
  const showShieldZone = isTier1 && inEurope && worldHasCup(league.competitions, SHIELD_FORMAT);
  const [shieldFrom, shieldTo] = comp ? cupSlotRange(comp, SHIELD_FORMAT) : [0, -1];
  const showAmericasZone = isTier1 && !!comp && !inEurope
    && worldHasCup(league.competitions, AMERICAS_CUP_FORMAT);
  const americasSlots = comp ? cupSlotsForCompetition(comp, AMERICAS_CUP_FORMAT) : 0;
  const zoneShown: Record<CupCompetitionId, boolean> = {
    continental: showCupZone, shield: showShieldZone, americas: showAmericasZone,
  };

  const seasonOptions = [...league.seasonHistory.map((h) => h.season)].sort((a, b) => b - a);

  let standings: StandingsRow[];
  let championTid: number;
  if (season === "current") {
    const teamIds = league.teams.filter((t) => t.compId === compId).map((t) => t.tid);
    standings = computeStandings(
      teamIds,
      league.played.filter((m) => {
        const home = league.teams.find((t) => t.tid === m.home);
        return home?.compId === compId;
      }),
      // A past season's stored table already has its deductions applied — the
      // offseason computed it that way — so only the live table needs them here.
      pointsDeductionMap(league.debtSanctions, league.season),
    );
    // A "champion" only means something once the season has actually been
    // DECIDED, which is the offseason phase — not merely once a ball has been
    // kicked. Testing `played.length > 0` (as this did) crowned whoever led the
    // table from matchday 1 onwards, so a club one game into the season was
    // labelled champion. `phase === "offseason"` is the same "the football is
    // over, the table is final" test core/clubSeason.ts uses for its
    // `awaitingRollover` flag.
    // Where a title playoff has already been played for this league, its winner
    // is the champion rather than whoever topped the table.
    const playoffWinner = (league.titlePlayoffs ?? [])
      .find((p) => p.compId === compId && p.season === league.season)?.winnerTid;
    championTid = league.phase === "offseason"
      ? (playoffWinner ?? standings[0]?.tid ?? -1)
      : -1;
  } else {
    const entry = league.seasonHistory.find((h) => h.season === season)!;
    const compTids = new Set(
      Object.entries(entry.compsByTid)
        .filter(([, c]) => c === compId)
        .map(([tid]) => Number(tid)),
    );
    standings = entry.table.filter((row) => compTids.has(row.tid));
    championTid = entry.championTidByCompId[compId] ?? (standings[0]?.tid ?? -1);
  }

  // The two halves of a split league. Only for the season being played: no
  // record of who sat in which half is kept for a past season, and in Argentina
  // promotion changes it every year, so a past season shows its overall table.
  const split = comp ? competitionConferences(comp) : null;
  const halves = split && comp && season === "current" ? conferenceMembers(league.teams, comp) : null;
  const titleFormat = comp ? competitionTitlePlayoff(comp) : "none";
  const playoffCut = titleFormat === "conference" ? CONFERENCE_PLAYOFF_TEAMS
    : titleFormat === "zones" ? ZONE_PLAYOFF_TEAMS
      : 0;
  const showHalves = !!halves && view === "conferences";

  // OVR/POT are only shown (and sortable) for the current season. Precompute
  // once so the sort accessor and the row render share the same numbers.
  const ratingByTid = new Map<number, { ovr: number; pot: number }>();
  if (season === "current") {
    for (const row of standings) {
      const team = league.teams.find((t) => t.tid === row.tid);
      if (team) {
        ratingByTid.set(
          row.tid,
          computeTeamRating(
            league.players.filter((p) => team.roster.includes(p.pid)),
            team.starters,
            teamSlots(team),
          ),
        );
      }
    }
  }
  const naturalOrder = sort.key === "pos" && sort.dir === "asc";

  /**
   * One table. `rows` is in finishing order, so a club's position is its index
   * — captured before any re-sort so the "#" column and the qualification
   * shading reflect real standing, not display order. `cut` draws the playoff
   * line under that many clubs, and only while the table is in its natural
   * order, where a line mid-table means something.
   */
  const renderTable = (rows: StandingsRow[], cut: number) => {
    const posByTid = new Map(rows.map((row, i) => [row.tid, i]));
    const displayRows = sortRows(rows, sort, {
      pos: (r) => posByTid.get(r.tid) ?? 0,
      team: (r) => league.teams.find((t) => t.tid === r.tid)?.name ?? `Team ${r.tid}`,
      p: (r) => r.played,
      w: (r) => r.won,
      d: (r) => r.drawn,
      l: (r) => r.lost,
      gf: (r) => r.gf,
      ga: (r) => r.ga,
      gd: (r) => r.gd,
      pts: (r) => r.points,
      ovr: (r) => ratingByTid.get(r.tid)?.ovr ?? -1,
      pot: (r) => ratingByTid.get(r.tid)?.pot ?? -1,
    });
    return (
      <table className="table table-striped table-sm">
        <thead>
          <tr>
            <SortableTh sortKey="pos" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">#</SortableTh>
            <SortableTh sortKey="team" sort={sort} onSort={toggle} defaultDir="asc">Team</SortableTh>
            <SortableTh sortKey="p" sort={sort} onSort={toggle} className="text-end">P</SortableTh>
            <SortableTh sortKey="w" sort={sort} onSort={toggle} className="text-end">W</SortableTh>
            <SortableTh sortKey="d" sort={sort} onSort={toggle} className="text-end">D</SortableTh>
            <SortableTh sortKey="l" sort={sort} onSort={toggle} className="text-end">L</SortableTh>
            <SortableTh sortKey="gf" sort={sort} onSort={toggle} className="text-end">GF</SortableTh>
            <SortableTh sortKey="ga" sort={sort} onSort={toggle} className="text-end">GA</SortableTh>
            <SortableTh sortKey="gd" sort={sort} onSort={toggle} className="text-end">GD</SortableTh>
            <SortableTh sortKey="pts" sort={sort} onSort={toggle} className="text-end">Pts</SortableTh>
            {season === "current" && <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">OVR</SortableTh>}
            {season === "current" && <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">POT <PotHelp /></SortableTh>}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => {
            const pos = posByTid.get(row.tid) ?? 0;
            const isUser = row.tid === league.meta.userTid;
            const isChampion = row.tid === championTid;
            const place = qualification.byTid.get(row.tid);
            const shown = place && zoneShown[place.competition] ? place : undefined;
            const rowClass = [
              isUser && "team-highlight",
              isChampion && "champion-highlight",
              naturalOrder && cut > 0 && pos === cut - 1 && "playoff-cut",
            ]
              .filter(Boolean)
              .join(" ") || undefined;
            const qualBar = qualBarClass(shown);
            const rating = ratingByTid.get(row.tid) ?? null;
            return (
              <tr key={row.tid} className={rowClass}>
                <td className="text-end qual-pos">
                  {/* Qualification is a bar on the row's leading edge, the
                      league-table convention. It is absolutely positioned, so
                      it neither indents the number nor competes with the row
                      background, which already carries win/loss, your club
                      and the champion. */}
                  {qualBar && <span className={qualBar} title={qualTitle(shown)} />}
                  {pos + 1}
                </td>
                <td>
                  <span className="d-inline-flex align-items-center gap-1">
                    <ClubLink
                      tid={row.tid}
                      season={season === "current" ? undefined : season}
                      crest
                      crestSize={20}
                      className="d-inline-flex align-items-center gap-1 text-decoration-none"
                    />
                    {isChampion && (
                      <span className="text-muted small d-inline-flex align-items-center gap-1">
                        {isTier1 ? (
                          <>
                            <TrophyIcon />
                            (Champion)
                          </>
                        ) : (
                          "(1st)"
                        )}
                      </span>
                    )}
                  </span>
                </td>
                <td className="text-end">{row.played}</td>
                <td className="text-end">{row.won}</td>
                <td className="text-end">{row.drawn}</td>
                <td className="text-end">{row.lost}</td>
                <td className="text-end">{row.gf}</td>
                <td className="text-end">{row.ga}</td>
                <td className="text-end">{row.gd}</td>
                <td className="text-end">
                  {row.points}
                  {row.deducted !== undefined && (
                    // Without this the points column simply does not add up
                    // against the W/D/L beside it, which reads as a bug
                    // rather than as a penalty.
                    <span
                      className="text-danger ms-1 small"
                      title={`${row.deducted}-point deduction for breaching the club's overdraft`}
                    >
                      (-{row.deducted})
                    </span>
                  )}
                </td>
                {season === "current" && <td className="text-end">{rating?.ovr ?? "-"}</td>}
                {season === "current" && <td className="text-end">{rating?.pot ?? "-"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="container-fluid p-3">
      <h4>
        Standings
        <HelpHint>
          The top clubs of each top-flight league qualify for their continent&apos;s cup: the
          Continental Cup in Europe, the Americas Cup in the Americas. The US and Argentina split
          their top flights in two, and the two halves are shown as separate tables; the overall
          table still decides prize money, continental places and relegation.
        </HelpHint>
      </h4>
      <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto", display: "inline-block" }}
          value={season}
          onChange={(e) => setSeason(e.target.value === "current" ? "current" : Number(e.target.value))}
        >
          <option value="current">Current Season ({seasonYear(league.season)})</option>
          {seasonOptions.map((s) => (
            <option key={s} value={s}>{seasonYear(s)}</option>
          ))}
        </select>
        <CompetitionSelect
          competitions={league.competitions}
          value={compId}
          onChange={(v) => setCompIdOverride(v === "all" ? null : v)}
        />
        {halves && split && (
          <ul className="nav nav-pills nav-sm">
            <li className="nav-item">
              <button
                type="button"
                className={`nav-link py-1 px-2${view === "conferences" ? " active" : ""}`}
                onClick={() => setView("conferences")}
              >
                {split.names[0].startsWith("Zone") ? "Zones" : "Conferences"}
              </button>
            </li>
            <li className="nav-item">
              <button
                type="button"
                className={`nav-link py-1 px-2${view === "overall" ? " active" : ""}`}
                onClick={() => setView("overall")}
              >
                Overall
              </button>
            </li>
          </ul>
        )}
      </div>
      {standings.length === 0 ? (
        <p>No matches played yet.</p>
      ) : (
        <>
        {showHalves && halves && split ? (
          halves.map((half, i) => {
            const inHalf = new Set(half);
            return (
              <div key={i}>
                <h6 className="mt-2 mb-1">{split.names[i]}</h6>
                {renderTable(standings.filter((r) => inHalf.has(r.tid)), playoffCut)}
              </div>
            );
          })
        ) : (
          renderTable(standings, 0)
        )}
        {showHalves && playoffCut > 0 && (
          <p className="qual-key text-muted small mt-2 mb-0">
            <span className="qual-key-item">
              The top {playoffCut} in each {titleFormat === "zones" ? "zone" : "conference"} go into
              the title playoff (the dashed line).
            </span>
          </p>
        )}
        {showAmericasZone && (
          <p className="qual-key text-muted small mt-2 mb-0">
            <span className="qual-key-item">
              <span className="qual-bar qual-bar-cup qual-key-swatch" /> Top {americasSlots}
              {halves ? " overall" : ""} to the Americas Cup
            </span>
            <span className="qual-key-item">
              {qualification.settled
                ? "Your domestic cup winner takes one of those places, and the holders keep theirs."
                : "Once the cup finals are played, your domestic cup winner takes one of those places and the holders keep theirs."}
            </span>
          </p>
        )}
        {(showCupZone || showShieldZone) && (
          <p className="qual-key text-muted small mt-2 mb-0">
            {showCupZone && (
              <span className="qual-key-item">
                <span className="qual-bar qual-bar-cup qual-key-swatch" /> Top {cupSlots} to the Continental Cup
              </span>
            )}
            {showShieldZone && (
              <span className="qual-key-item">
                <span className="qual-bar qual-bar-shield qual-key-swatch" />{" "}
                {shieldFrom === shieldTo
                  ? ordinal(shieldFrom)
                  : `${ordinal(shieldFrom)} and ${ordinal(shieldTo)}`}
                {" "}to the Continental Shield
              </span>
            )}
            {/* The bands above are the usual case, not the rule: winning your
                domestic cup or holding a continental trophy also gets you in,
                from anywhere in the table. Saying so is what stops a shaded
                9th place reading as a bug. */}
            <span className="qual-key-item">
              {qualification.settled
                ? "Your domestic cup winner takes a Shield place, and holders keep theirs."
                : "Once the cup finals are played, your domestic cup winner takes a Shield place and holders keep theirs."}
            </span>
          </p>
        )}
        </>
      )}
    </div>
  );
}
